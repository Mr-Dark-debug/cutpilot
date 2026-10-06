//! Headless CutPilot for testing and power users. Runs the same pipeline as the app.
//!
//!   cutpilot-cli status
//!   cutpilot-cli install <ffmpeg|whisper|whisper-gpu|model|ytdlp> [model-name]
//!   cutpilot-cli new <video>... [--brief TEXT] [--style ID] [--engine claude|codex] [--model M] [--effort E] [--ref PATH|URL] [--name N] [--aspect 9:16]
//!   cutpilot-cli revise <project-id> <request>
//!   cutpilot-cli render <project-id> [--preview] [--vertical] [--captions]
//!   cutpilot-cli export <project-id>
//!   cutpilot-cli list

use std::sync::Arc;

use anyhow::{bail, Result};
use cutpilot_lib::jobs::{JobInfo, Jobs, Reporter};
use cutpilot_lib::project::{self, EngineChoice};
use cutpilot_lib::{pipeline, render, settings, tools};

struct Console;

impl Reporter for Console {
    fn job(&self, info: &JobInfo) {
        if info.state != "running" {
            eprintln!("[{}] {} – {}", info.state, info.title, info.message);
        }
    }
    fn log(&self, _job: &str, line: &str) {
        eprintln!("  {line}");
    }
    fn project(&self, _id: &str) {}
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn has(args: &[String], name: &str) -> bool {
    args.iter().any(|a| a == name)
}

async fn wait(jobs: &Arc<Jobs>, id: &str) -> Result<JobInfo> {
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        if let Some(j) = jobs.get(id) {
            match j.state.as_str() {
                "done" => return Ok(j),
                "error" | "cancelled" => bail!("{}: {}", j.title, j.error.unwrap_or(j.message)),
                _ => {}
            }
        }
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().cloned().unwrap_or_default();
    cutpilot_lib::util::migrate_legacy_data();
    tauri::async_runtime::block_on(async move {
        let jobs = Jobs::new(Arc::new(Console));
        match cmd.as_str() {
            "status" => {
                for t in tools::all_status().await {
                    println!(
                        "{:<28} {:<5} {:<22} {} {}",
                        t.name,
                        if t.installed { "ok" } else { "--" },
                        t.version,
                        t.detail,
                        if t.account.is_empty() { String::new() } else { format!("({})", t.account) }
                    );
                }
            }
            "install" => {
                let id = args.get(1).cloned().unwrap_or_default();
                let progress = |f: f64, m: &str| eprint!("\r{:>5.1}% {m}            ", f * 100.0);
                let msg = match args.get(2) {
                    Some(model) if id == "model" => tools::install_model(model, &progress).await?,
                    _ => tools::install(&id, &progress).await?,
                };
                eprintln!();
                println!("{msg}");
            }
            "list" => {
                for p in project::list() {
                    println!("{}  {:<30} {:<10} v{:?}  {}", p.id, p.name, p.status.state, p.current_edit, p.dir);
                }
            }
            "new" => {
                let mut sources = vec![];
                let mut i = 1;
                while i < args.len() {
                    if args[i].starts_with("--") {
                        i += if matches!(args[i].as_str(), "--preview" | "--vertical" | "--captions" | "--analyze-only") { 1 } else { 2 };
                        continue;
                    }
                    sources.push(std::fs::canonicalize(&args[i])?.to_string_lossy().trim_start_matches(r"\\?\").to_string());
                    i += 1;
                }
                let engine = flag(&args, "--engine").map(|provider| {
                    let s = settings::get().engine;
                    let model = flag(&args, "--model").unwrap_or_else(|| if provider == "codex" { s.codex_model.clone() } else { s.claude_model.clone() });
                    let effort = flag(&args, "--effort").unwrap_or_else(|| if provider == "codex" { s.codex_effort.clone() } else { s.claude_effort.clone() });
                    EngineChoice { provider, model, effort }
                });
                let p = project::create(project::NewProject {
                    name: flag(&args, "--name").unwrap_or_default(),
                    sources,
                    references: flag(&args, "--ref").into_iter().collect(),
                    brief: flag(&args, "--brief").unwrap_or_default(),
                    style_id: flag(&args, "--style").unwrap_or_default(),
                    engine,
                    aspect: flag(&args, "--aspect").unwrap_or_default(),
                    batch_id: None,
                })?;
                println!("project {} at {}", p.id, p.dir);
                let pid = p.id.clone();
                let opts = pipeline::PipelineOpts { analyze_only: has(&args, "--analyze-only"), ..Default::default() };
                let job = jobs.spawn("pipeline", Some(pid.clone()), "pipeline", move |ctx| async move {
                    pipeline::with_status(ctx, pid.clone(), move |ctx| pipeline::run_pipeline(ctx, pid, opts)).await
                });
                wait(&jobs, &job).await?;
                println!("done: {}", project::get(&p.id)?.dir);
            }
            "term" => {
                // Opens a visible PowerShell window the same way the app's Sign in buttons do.
                cutpilot_lib::proc::open_terminal("CutPilot terminal test", &args[1..].join(" "))?;
            }
            "dump" => {
                // Real data for the UI's browser-preview mock.
                let id = args.get(1).cloned().unwrap_or_default();
                let p = project::get(&id)?;
                let edit = pipeline::load_edit(&p, None)?;
                let timeline = pipeline::compute_timeline(&p, &edit);
                let mut sources = serde_json::Map::new();
                for s in &p.sources {
                    let audio: cutpilot_lib::media::AudioAnalysis =
                        cutpilot_lib::util::read_json(&p.work_dir(&s.id).join("audio.json")).unwrap_or_default();
                    sources.insert(
                        s.id.clone(),
                        serde_json::json!({
                            "words": project::read_words(&p, &s.id),
                            "utterances": project::read_utterances(&p, &s.id),
                            "peaks": audio.peaks,
                            "duration": s.info.as_ref().map(|i| i.duration).unwrap_or(0.0),
                        }),
                    );
                }
                let out = serde_json::json!({
                    "project": p,
                    "bundle": { "edit": edit, "timeline": timeline, "versions": p.edits, "current": p.current_edit },
                    "sources": sources,
                    "styles": cutpilot_lib::style::list(),
                    "library": cutpilot_lib::broll::library(),
                    "tools": tools::all_status().await,
                    "projects": project::list(),
                });
                println!("{}", serde_json::to_string(&out)?);
            }
            "library" => {
                if let Some(folder) = args.get(1) {
                    let mut s = settings::get();
                    let folder = std::fs::canonicalize(folder)?.to_string_lossy().trim_start_matches(r"\\?\").to_string();
                    if !s.library_folders.contains(&folder) {
                        s.library_folders.push(folder);
                    }
                    settings::save(s)?;
                }
                let job = jobs.spawn("library", None, "scan", move |ctx| async move {
                    let items = cutpilot_lib::broll::scan_library(&ctx.cancel, &|_, _| {}).await?;
                    Ok(Some(serde_json::json!({ "count": items.len() })))
                });
                wait(&jobs, &job).await?;
                let job = jobs.spawn("library", None, "describe", pipeline::describe_library);
                wait(&jobs, &job).await?;
                for item in cutpilot_lib::broll::library() {
                    println!("{} {:<34} {:.1}s  {}  [{}]", item.id, item.name, item.duration, item.description, item.tags.join(", "));
                }
            }
            "run" => {
                let id = args.get(1).cloned().unwrap_or_default();
                if let Some(provider) = flag(&args, "--engine") {
                    let model = flag(&args, "--model").unwrap_or_default();
                    let effort = flag(&args, "--effort").unwrap_or_else(|| "medium".into());
                    project::update(&id, |p| {
                        p.engine = EngineChoice { provider, model, effort };
                        Ok(())
                    })?;
                }
                let pid = id.clone();
                let job = jobs.spawn("pipeline", Some(id.clone()), "pipeline", move |ctx| async move {
                    pipeline::with_status(ctx, pid.clone(), move |ctx| pipeline::run_pipeline(ctx, pid, Default::default())).await
                });
                wait(&jobs, &job).await?;
            }
            "revise" => {
                let id = args.get(1).cloned().unwrap_or_default();
                let request = args.get(2).cloned().unwrap_or_default();
                project::update(&id, |p| {
                    p.chat.push(project::ChatMessage { role: "user".into(), text: request.clone(), created: cutpilot_lib::util::now_iso(), version: None });
                    Ok(())
                })?;
                let pid = id.clone();
                let job = jobs.spawn("revise", Some(id.clone()), "revise", move |ctx| async move { pipeline::revise(ctx, pid, request).await });
                wait(&jobs, &job).await?;
            }
            "render" => {
                let id = args.get(1).cloned().unwrap_or_default();
                let opts = render::RenderOpts {
                    quality: if has(&args, "--preview") { "preview".into() } else { "final".into() },
                    captions: has(&args, "--captions"),
                    aspect: if has(&args, "--vertical") { "9:16".into() } else { "16:9".into() },
                    ..Default::default()
                };
                let pid = id.clone();
                let job = jobs.spawn("render", Some(id), "render", move |ctx| async move {
                    let path = pipeline::render_project(&ctx, &pid, opts).await?;
                    Ok(Some(serde_json::json!({ "path": path })))
                });
                let j = wait(&jobs, &job).await?;
                println!("{}", j.result.unwrap_or_default());
            }
            "export" => {
                let id = args.get(1).cloned().unwrap_or_default();
                for item in pipeline::export_all(&id).await? {
                    println!("{} {}", item.kind, item.path);
                }
            }
            _ => {
                eprintln!("usage: cutpilot-cli status | install <tool> | new <video>... | revise <id> <request> | render <id> | export <id> | list");
            }
        }
        Ok(())
    })
}
