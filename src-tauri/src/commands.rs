//! Tauri commands (the UI's API). Errors are returned as strings.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::edit::{Edit, Timeline};
use crate::jobs::JobInfo;
use crate::project::{self, EditMeta, EngineChoice, Project};
use crate::settings::{self, Settings};
use crate::style::{self, Style};
use crate::transcribe::{Utterance, Word};
use crate::{broll, pipeline, render, resolve, tools, util, AppState};

type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    format!("{err:#}")
}

#[tauri::command]
pub fn app_info() -> Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "dataDir": util::app_data_dir(),
        "projectsDir": settings::projects_dir(),
    })
}

#[tauri::command]
pub fn get_settings() -> Settings {
    settings::get()
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> R<Settings> {
    let s = settings::save(settings).map_err(e)?;
    std::fs::create_dir_all(&s.projects_dir).map_err(e)?;
    state.jobs.apply_settings();
    Ok(s)
}

#[tauri::command]
pub async fn tools_status() -> Vec<tools::ToolStatus> {
    tools::all_status().await
}

#[tauri::command]
pub async fn install_tool(state: State<'_, AppState>, id: String, model: Option<String>) -> R<String> {
    if id == "claude" || id == "codex" {
        // Opens a terminal; nothing to track.
        tools::install(&id, &|_, _| {}).await.map_err(e)?;
        return Ok(String::new());
    }
    let title = match id.as_str() {
        "ffmpeg" => "Installing FFmpeg".to_string(),
        "whisper" => "Installing whisper.cpp".into(),
        "whisper-gpu" => "Installing whisper.cpp (GPU)".into(),
        "model" => format!("Downloading Whisper model {}", model.clone().unwrap_or_else(|| settings::get().whisper_model)),
        "ytdlp" => "Installing yt-dlp".into(),
        _ => format!("Installing {id}"),
    };
    let target = Some(id.clone());
    Ok(state.jobs.spawn_tagged("install", None, target, &title, move |ctx| async move {
        let ctx2 = ctx.clone();
        let progress = move |f: f64, m: &str| ctx2.progress(f, m);
        let msg = match (id.as_str(), model) {
            ("model", Some(name)) => tools::install_model(&name, &progress).await?,
            _ => tools::install(&id, &progress).await?,
        };
        ctx.log(&msg);
        Ok(Some(serde_json::json!({ "tool": id, "message": msg })))
    }))
}

#[tauri::command]
pub fn open_login(engine: String) -> R<()> {
    tools::login(&engine).map_err(e)
}

#[tauri::command]
pub fn engine_models() -> Value {
    serde_json::json!({ "claude": tools::claude_models(), "codex": tools::codex_models() })
}

#[tauri::command]
pub fn whisper_models() -> Vec<tools::ModelInfo> {
    tools::whisper_models()
}

// ------------------------------------------------------------------ projects

#[tauri::command]
pub fn list_projects() -> Vec<Project> {
    project::list()
}

#[tauri::command]
pub fn get_project(id: String) -> R<Project> {
    project::get(&id).map_err(e)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProjectArgs {
    #[serde(default)]
    pub name: String,
    pub sources: Vec<String>,
    #[serde(default)]
    pub references: Vec<String>,
    #[serde(default)]
    pub brief: String,
    #[serde(default)]
    pub style_id: String,
    pub engine: Option<EngineChoice>,
    #[serde(default)]
    pub aspect: String,
    #[serde(default)]
    pub music: Option<String>,
}

fn spawn_pipeline(state: &AppState, p: &Project, opts: pipeline::PipelineOpts) -> String {
    let pid = p.id.clone();
    let title = format!("Editing {}", p.name);
    let job = state.jobs.spawn("pipeline", Some(pid.clone()), &title, move |ctx| async move {
        pipeline::with_status(ctx, pid.clone(), move |ctx| pipeline::run_pipeline(ctx, pid, opts)).await
    });
    let _ = project::update(&p.id, |p| {
        p.status.state = "queued".into();
        p.status.job_id = Some(job.clone());
        Ok(())
    });
    job
}

fn new_project(args: NewProjectArgs, name: String, sources: Vec<String>, batch: Option<String>) -> R<Project> {
    let p = project::create(project::NewProject {
        name,
        sources,
        references: args.references,
        brief: args.brief,
        style_id: args.style_id,
        engine: args.engine,
        aspect: args.aspect,
        batch_id: batch,
    })
    .map_err(e)?;
    if let Some(m) = args.music.filter(|m| !m.is_empty()) {
        return project::update(&p.id, |p| {
            p.music = Some(m);
            Ok(())
        })
        .map_err(e);
    }
    Ok(p)
}

#[tauri::command]
pub fn create_project(state: State<AppState>, args: NewProjectArgs, start: bool) -> R<Project> {
    let name = args.name.clone();
    let sources = args.sources.clone();
    let p = new_project(args, name, sources, None)?;
    if start {
        spawn_pipeline(&state, &p, Default::default());
    }
    project::get(&p.id).map_err(e)
}

/// One project per video, all with the same brief/style/engine, started together.
#[tauri::command]
pub fn create_batch(state: State<AppState>, args: NewProjectArgs) -> R<Vec<Project>> {
    let batch = util::new_id();
    let mut out = vec![];
    for src in args.sources.clone() {
        let a = NewProjectArgs {
            name: String::new(),
            sources: vec![],
            references: args.references.clone(),
            brief: args.brief.clone(),
            style_id: args.style_id.clone(),
            engine: args.engine.clone(),
            aspect: args.aspect.clone(),
            music: args.music.clone(),
        };
        let p = new_project(a, util::file_stem(&src), vec![src], Some(batch.clone()))?;
        spawn_pipeline(&state, &p, Default::default());
        out.push(project::get(&p.id).map_err(e)?);
    }
    Ok(out)
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub brief: Option<String>,
    pub style_id: Option<String>,
    pub engine: Option<EngineChoice>,
    pub aspect: Option<String>,
    /// Some("") clears the music.
    pub music: Option<String>,
}

#[tauri::command]
pub fn update_project(id: String, patch: ProjectPatch) -> R<Project> {
    project::update(&id, |p| {
        if let Some(n) = patch.name.filter(|n| !n.trim().is_empty()) {
            p.name = n.trim().into();
        }
        if let Some(b) = patch.brief {
            p.brief = b;
        }
        if let Some(s) = patch.style_id {
            p.style_id = s;
        }
        if let Some(en) = patch.engine {
            p.engine = en;
        }
        if let Some(a) = patch.aspect {
            p.aspect = a;
        }
        if let Some(m) = patch.music {
            p.music = if m.is_empty() { None } else { Some(m) };
        }
        Ok(())
    })
    .map_err(e)
}

#[tauri::command]
pub fn delete_project(state: State<AppState>, id: String) -> R<()> {
    if let Some(j) = state.jobs.active_for(&id) {
        state.jobs.cancel(&j.id);
    }
    project::delete(&id).map_err(e)
}

#[tauri::command]
pub fn add_sources(id: String, paths: Vec<String>) -> R<Project> {
    project::update(&id, |p| {
        for path in paths {
            if !Path::new(&path).exists() || p.sources.iter().any(|s| s.path == path) {
                continue;
            }
            let sid = p.next_source_id();
            p.sources.push(project::Source { id: sid, name: util::file_stem(&path), path, ..Default::default() });
        }
        Ok(())
    })
    .map_err(e)
}

#[tauri::command]
pub fn remove_source(id: String, source_id: String) -> R<Project> {
    project::update(&id, |p| {
        if p.sources.len() <= 1 {
            anyhow::bail!("a project needs at least one video");
        }
        p.sources.retain(|s| s.id != source_id);
        Ok(())
    })
    .map_err(e)
}

#[tauri::command]
pub fn add_reference(id: String, input: String) -> R<Project> {
    project::update(&id, |p| {
        project::add_reference_to(p, &input);
        Ok(())
    })
    .map_err(e)
}

#[tauri::command]
pub fn remove_reference(id: String, ref_id: String) -> R<Project> {
    project::update(&id, |p| {
        p.references.retain(|r| r.id != ref_id);
        Ok(())
    })
    .map_err(e)
}

#[tauri::command]
pub fn start_pipeline(state: State<AppState>, id: String, opts: Option<pipeline::PipelineOpts>) -> R<String> {
    if let Some(j) = state.jobs.active_for(&id) {
        return Ok(j.id);
    }
    let p = project::get(&id).map_err(e)?;
    Ok(spawn_pipeline(&state, &p, opts.unwrap_or_default()))
}

#[tauri::command]
pub fn revise_edit(state: State<AppState>, id: String, request: String) -> R<String> {
    let request = request.trim().to_string();
    if request.is_empty() {
        return Err("type what you'd like to change".into());
    }
    if let Some(j) = state.jobs.active_for(&id) {
        return Err(format!("this project is busy ({}) – wait for it to finish", j.title));
    }
    let p = project::update(&id, |p| {
        if p.current_edit.is_none() {
            anyhow::bail!("create the first edit before asking for changes");
        }
        p.chat.push(project::ChatMessage { role: "user".into(), text: request.clone(), created: util::now_iso(), version: None });
        Ok(())
    })
    .map_err(e)?;
    let pid = p.id.clone();
    let job = state.jobs.spawn("revise", Some(pid.clone()), &format!("Revising {}", p.name), move |ctx| async move {
        pipeline::with_status(ctx, pid.clone(), move |ctx| pipeline::revise(ctx, pid, request)).await
    });
    Ok(job)
}

#[tauri::command]
pub fn cancel_job(state: State<AppState>, job_id: String) -> bool {
    state.jobs.cancel(&job_id)
}

#[tauri::command]
pub fn list_jobs(state: State<AppState>) -> Vec<JobInfo> {
    state.jobs.list()
}

#[tauri::command]
pub fn job_logs(state: State<AppState>, job_id: String) -> Vec<String> {
    state.jobs.logs(&job_id)
}

#[tauri::command]
pub fn clear_jobs(state: State<AppState>) {
    state.jobs.clear_finished();
}

// ------------------------------------------------------------------ edits

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditBundle {
    pub edit: Edit,
    pub timeline: Timeline,
    pub versions: Vec<EditMeta>,
    pub current: u32,
}

fn bundle(p: &Project, version: Option<u32>) -> R<EditBundle> {
    let edit = pipeline::load_edit(p, version).map_err(e)?;
    let timeline = pipeline::compute_timeline(p, &edit);
    Ok(EditBundle { current: p.current_edit.unwrap_or(edit.version), edit, timeline, versions: p.edits.clone() })
}

#[tauri::command]
pub fn get_edit(id: String, version: Option<u32>) -> R<EditBundle> {
    let p = project::get(&id).map_err(e)?;
    bundle(&p, version)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceData {
    pub words: Vec<Word>,
    pub utterances: Vec<Utterance>,
    pub peaks: Vec<u8>,
    pub duration: f64,
}

#[tauri::command]
pub fn get_source_data(id: String, source_id: String) -> R<SourceData> {
    let p = project::get(&id).map_err(e)?;
    let audio: crate::media::AudioAnalysis = util::read_json(&p.work_dir(&source_id).join("audio.json")).unwrap_or_default();
    Ok(SourceData {
        words: project::read_words(&p, &source_id),
        utterances: project::read_utterances(&p, &source_id),
        peaks: audio.peaks,
        duration: p.source(&source_id).and_then(|s| s.info.as_ref().map(|i| i.duration)).unwrap_or(audio.duration),
    })
}

#[tauri::command]
pub fn save_edit(id: String, edit: Edit) -> R<Timeline> {
    pipeline::save_edit(&id, &edit).map_err(e)
}

#[tauri::command]
pub fn set_current_edit(id: String, version: u32) -> R<Project> {
    project::update(&id, |p| {
        if !p.edits.iter().any(|m| m.version == version) {
            anyhow::bail!("version {version} doesn't exist");
        }
        p.current_edit = Some(version);
        Ok(())
    })
    .map_err(e)
}

#[tauri::command]
pub fn fill_broll(state: State<AppState>, id: String) -> R<String> {
    let p = project::get(&id).map_err(e)?;
    let pid = p.id.clone();
    Ok(state.jobs.spawn("broll", Some(pid.clone()), &format!("B-roll for {}", p.name), move |ctx| async move {
        let (filled, empty) = pipeline::fill_broll(&ctx, &pid, 0.0, 1.0).await?;
        Ok(Some(serde_json::json!({ "filled": filled, "empty": empty })))
    }))
}

#[tauri::command]
pub async fn search_stock(query: String, vertical: bool, provider: Option<String>) -> R<Vec<broll::StockClip>> {
    let provider = provider.or_else(broll::stock_provider).ok_or("connect Pexels or Pixabay in Settings ▸ B-roll to search stock footage")?;
    broll::search_stock(&provider, &query, vertical).await.map_err(e)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrollChoice {
    pub stock: Option<broll::StockClip>,
    pub library: Option<String>,
    pub file: Option<String>,
    /// Clear the asset (back to a marker).
    #[serde(default)]
    pub clear: bool,
}

#[tauri::command]
pub async fn set_broll_asset(id: String, broll_id: String, choice: BrollChoice) -> R<EditBundle> {
    let p = project::get(&id).map_err(e)?;
    let mut ed = pipeline::load_edit(&p, None).map_err(e)?;
    let asset = if choice.clear {
        None
    } else if let Some(stock) = &choice.stock {
        Some(broll::download_stock(stock, &p.broll_dir()).await.map_err(e)?)
    } else if let Some(lib) = &choice.library {
        Some(broll::asset_from_library(&broll::find_library_item(lib).map_err(e)?))
    } else if let Some(file) = &choice.file {
        Some(broll::asset_from_file(Path::new(file), &p.broll_dir()).await.map_err(e)?)
    } else {
        return Err("nothing chosen".into());
    };
    let b = ed.broll.iter_mut().find(|b| b.id == broll_id).ok_or("B-roll slot not found")?;
    b.library = asset.as_ref().filter(|a| a.kind == "library").map(|a| a.id.clone());
    b.asset = asset;
    b.enabled = true;
    pipeline::save_edit(&id, &ed).map_err(e)?;
    let p = project::get(&id).map_err(e)?;
    bundle(&p, None)
}

#[tauri::command]
pub async fn export_project(id: String) -> R<Vec<project::ExportItem>> {
    pipeline::export_all(&id).await.map_err(e)
}

#[tauri::command]
pub fn render_video(state: State<AppState>, id: String, opts: render::RenderOpts) -> R<String> {
    let p = project::get(&id).map_err(e)?;
    let pid = p.id.clone();
    let title = format!("Rendering {}{}", p.name, if opts.quality == "preview" { " (preview)" } else { "" });
    Ok(state.jobs.spawn("render", Some(pid.clone()), &title, move |ctx| async move {
        let path = pipeline::render_project(&ctx, &pid, opts).await?;
        Ok(Some(serde_json::json!({ "path": path })))
    }))
}

#[tauri::command]
pub async fn send_to_resolve(id: String) -> R<resolve::SendResult> {
    let items = pipeline::export_all(&id).await.map_err(e)?;
    let p = project::get(&id).map_err(e)?;
    let ed = pipeline::load_edit(&p, None).map_err(e)?;
    let tl = pipeline::compute_timeline(&p, &ed);
    let fcp = items.iter().find(|i| i.kind == "fcpxml").map(|i| PathBuf::from(&i.path)).ok_or("export failed")?;
    let srt = items.iter().find(|i| i.kind == "srt").map(|i| PathBuf::from(&i.path));
    let mut media: Vec<String> = p.sources.iter().map(|s| s.path.clone()).collect();
    for b in &tl.broll {
        if let Some(a) = &b.asset {
            if !media.contains(&a.path) {
                media.push(a.path.clone());
            }
        }
    }
    if let Some(m) = &p.music {
        media.push(m.clone());
    }
    resolve::send(resolve::Handoff {
        project_name: &p.name,
        timeline_name: &format!("{} v{}", p.name, ed.version),
        timeline: &fcp,
        srt: srt.as_deref(),
        media,
        fps: (tl.fps_num, tl.fps_den),
        size: (tl.width, tl.height),
    })
    .map_err(e)
}

// ------------------------------------------------------------------ styles

#[tauri::command]
pub fn list_styles() -> Vec<Style> {
    style::list()
}

#[tauri::command]
pub fn save_style(style: Style) -> R<Style> {
    style::save(style).map_err(e)
}

#[tauri::command]
pub fn delete_style(id: String) -> R<()> {
    style::delete(&id).map_err(e)
}

#[tauri::command]
pub fn analyze_style_reference(state: State<AppState>, style_id: String, input: String) -> R<String> {
    let st = style::get(&style_id);
    let title = format!("Studying reference for {}", st.name);
    Ok(state.jobs.spawn("reference", None, &title, move |ctx| async move {
        let dir = util::styles_dir().join("refs").join(util::slugify(&format!("{}-{}", style_id, util::new_id())));
        let analysis = pipeline::analyze_reference_input(&ctx, &input, &dir, &EngineChoice::default()).await?;
        let mut st = style::get(&style_id);
        st.references.push(analysis.clone());
        style::save(st)?;
        Ok(Some(serde_json::to_value(analysis)?))
    }))
}

// ------------------------------------------------------------------ library

#[tauri::command]
pub fn get_library() -> Vec<broll::LibraryItem> {
    broll::library()
}

#[tauri::command]
pub fn scan_library(state: State<AppState>) -> String {
    state.jobs.spawn("library", None, "Indexing B-roll library", move |ctx| async move {
        let ctx2 = ctx.clone();
        let items = broll::scan_library(&ctx.cancel, &move |f, m| ctx2.progress(f, m)).await?;
        Ok(Some(serde_json::json!({ "count": items.len() })))
    })
}

#[tauri::command]
pub fn describe_library(state: State<AppState>) -> String {
    state.jobs.spawn("library", None, "Describing B-roll with AI", pipeline::describe_library)
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}
