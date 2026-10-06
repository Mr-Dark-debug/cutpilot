//! The editing pipeline: analyze → (references) → plan → B-roll → export.
//! Every stage caches its output on disk, so re-planning never re-transcribes.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::edit::{self, CutParams, Edit, Plan, SourceRef, Timeline};
use crate::jobs::Ctx;
use crate::media::{self, AudioAnalysis, MediaInfo, Sheet};
use crate::project::{self, ChatMessage, EditMeta, EngineChoice, ExportItem, Project};
use crate::style::{self, RefAnalysis, RefMetrics, StyleSummary};
use crate::transcribe::{self, Transcript};
use crate::{agent, broll, export, prompts, render, settings, tools, util};

// ------------------------------------------------------------------ status helpers

fn set_status(ctx: &Ctx, project_id: &str, state: &str, stage: &str, message: &str) {
    let job = ctx.id.clone();
    let _ = project::update(project_id, |p| {
        p.status.state = state.into();
        p.status.stage = stage.into();
        p.status.message = message.into();
        p.status.job_id = if state == "running" || state == "queued" { Some(job) } else { None };
        Ok(())
    });
    ctx.project_changed(project_id);
}

/// Wraps a project job: marks the project running, then ready/error/cancelled.
pub async fn with_status<F, Fut>(ctx: Ctx, project_id: String, f: F) -> Result<Option<Value>>
where
    F: FnOnce(Ctx) -> Fut,
    Fut: std::future::Future<Output = Result<Option<Value>>>,
{
    set_status(&ctx, &project_id, "running", "Starting", "");
    let res = f(ctx.clone()).await;
    match &res {
        Ok(_) => set_status(&ctx, &project_id, "ready", "", ""),
        Err(_) if ctx.cancel.is_cancelled() => set_status(&ctx, &project_id, "cancelled", "", "Cancelled"),
        Err(e) => set_status(&ctx, &project_id, "error", "", &format!("{e}")),
    }
    res
}

// ------------------------------------------------------------------ sources

pub async fn analyze_source(ctx: &Ctx, project_id: &str, source_id: &str, base: f64, span: f64, force: bool) -> Result<()> {
    let p = project::get(project_id)?;
    let src = p.source(source_id).cloned().ok_or_else(|| anyhow!("source {source_id} missing"))?;
    let path = PathBuf::from(&src.path);
    if !path.exists() {
        bail!("video file not found: {}", src.path);
    }
    let work = p.work_dir(source_id);
    if force && work.exists() {
        let _ = std::fs::remove_dir_all(&work);
    }
    std::fs::create_dir_all(&work)?;
    let at = |f: f64| base + span * f;

    ctx.stage(&format!("Reading {}", src.name), at(0.0));
    let info = media::probe(&path).await?;
    ctx.log(&format!(
        "{}: {} · {}x{} · {:.2} fps · audio {}",
        src.name,
        util::fmt_time(info.duration),
        info.width,
        info.height,
        info.fps(),
        if info.has_audio { "yes" } else { "no" }
    ));
    {
        let info = info.clone();
        project::update(project_id, |p| {
            if let Some(s) = p.sources.iter_mut().find(|s| s.id == source_id) {
                s.info = Some(info);
            }
            Ok(())
        })?;
    }
    ctx.project_changed(project_id);

    let mut language = String::new();
    if info.has_audio {
        let wav = work.join("audio.wav");
        if !wav.exists() {
            ctx.stage(&format!("Extracting audio · {}", src.name), at(0.03));
            media::extract_audio(&path, &wav, None, &ctx.cancel).await?;
        }
        ctx.check()?;
        let audio_path = work.join("audio.json");
        let audio: AudioAnalysis = match util::read_json(&audio_path) {
            Ok(a) => a,
            Err(_) => {
                let wav2 = wav.clone();
                let a = tokio::task::spawn_blocking(move || media::analyze_audio(&wav2)).await??;
                util::write_json(&audio_path, &a)?;
                a
            }
        };
        ctx.log(&format!(
            "Speech detection: {} speech regions, threshold {:.0} dB (noise {:.0} dB, speech {:.0} dB)",
            audio.speech.len(),
            audio.threshold_db,
            audio.noise_floor_db,
            audio.speech_level_db
        ));

        let tr_path = work.join("transcript.json");
        let transcript: Transcript = match util::read_json(&tr_path) {
            Ok(t) => t,
            Err(_) => {
                ctx.stage(&format!("Transcribing {}", src.name), at(0.08));
                let ctx2 = ctx.clone();
                let t = transcribe::run_whisper(&wav, &work.join("whisper"), &ctx.cancel, &move |f| {
                    ctx2.progress(at(0.08 + f * 0.62), "Transcribing");
                })
                .await?;
                util::write_json(&tr_path, &t)?;
                t
            }
        };
        language = transcript.language.clone();
        ctx.log(&format!("Transcript: {} words, language {}", transcript.words.len(), transcript.language));
        let (utts, words) = transcribe::build_utterances(source_id, &transcript, &audio, 1);
        ctx.log(&format!("{} utterances", utts.len()));
        util::write_json(&work.join("utterances.json"), &utts)?;
        util::write_json(&work.join("words.json"), &words)?;
    }
    ctx.check()?;

    let mut thumb = None;
    let mut proxy = None;
    if info.has_video {
        let t = work.join("thumb.jpg");
        if !t.exists() {
            let _ = media::thumbnail(&path, (info.duration * 0.2).min(30.0), &t, 640).await;
        }
        if t.exists() {
            thumb = Some(t.to_string_lossy().to_string());
        }
        let scenes_path = work.join("scenes.json");
        if !scenes_path.exists() {
            ctx.stage(&format!("Finding scene changes · {}", src.name), at(0.72));
            let scenes = media::detect_scenes(&path, 0.35, None, &ctx.cancel).await.unwrap_or_default();
            util::write_json(&scenes_path, &scenes)?;
        }
        if settings::get().use_frames && !work.join("sheets.json").exists() {
            ctx.stage(&format!("Making contact sheets · {}", src.name), at(0.80));
            let sheets = media::contact_sheets(&path, info.duration, &work.join("sheets"), 8, &ctx.cancel).await?;
            util::write_json(&work.join("sheets.json"), &sheets)?;
        }
        if media::needs_proxy(&path, &info) {
            let pf = work.join("proxy.mp4");
            if !pf.exists() {
                ctx.stage(&format!("Making a preview copy · {}", src.name), at(0.86));
                let ctx2 = ctx.clone();
                media::make_proxy(&path, &pf, info.duration, &ctx.cancel, &move |f| ctx2.progress(at(0.86 + f * 0.14), "Making a preview copy"))
                    .await?;
            }
            proxy = Some(pf.to_string_lossy().to_string());
        }
    }
    project::update(project_id, |p| {
        if let Some(s) = p.sources.iter_mut().find(|s| s.id == source_id) {
            s.analyzed = true;
            s.thumb = thumb;
            s.proxy = proxy;
            s.language = language;
        }
        Ok(())
    })?;
    ctx.project_changed(project_id);
    Ok(())
}

// ------------------------------------------------------------------ references

fn median(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

/// Downloads (if URL) and analyzes a reference video into `dir`.
pub async fn analyze_reference_input(ctx: &Ctx, input: &str, dir: &Path, engine: &EngineChoice) -> Result<RefAnalysis> {
    std::fs::create_dir_all(dir)?;
    const LIMIT: f64 = 600.0;
    let mut name = util::file_stem(input);
    let path = if input.starts_with("http://") || input.starts_with("https://") {
        let file = dir.join("ref.mp4");
        if !file.exists() {
            let ytdlp = tools::ytdlp_path().ok_or_else(|| anyhow!("yt-dlp is needed for links. Install it in Settings ▸ Tools, or use a downloaded file."))?;
            let ffmpeg = tools::ffmpeg()?;
            ctx.stage("Downloading reference", 0.02);
            let out = crate::proc::run_ok(
                &ytdlp,
                &[
                    "--no-playlist",
                    "-f",
                    "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b",
                    "--merge-output-format",
                    "mp4",
                    "--ffmpeg-location",
                    &ffmpeg.parent().unwrap().to_string_lossy(),
                    "--download-sections",
                    "*0-600",
                    "-o",
                    &dir.join("ref.%(ext)s").to_string_lossy(),
                    "--print",
                    "after_move:title",
                    input,
                ],
                crate::proc::RunOpts { cancel: Some(ctx.cancel.clone()), keep_bytes: 64 * 1024, timeout: Some(Duration::from_secs(1800)), ..Default::default() },
            )
            .await?;
            let title = out.stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
            if !title.is_empty() {
                std::fs::write(dir.join("title.txt"), &title)?;
            }
        }
        if let Ok(t) = std::fs::read_to_string(dir.join("title.txt")) {
            name = t.trim().to_string();
        }
        if !file.exists() {
            bail!("the reference download didn't produce a video");
        }
        file
    } else {
        PathBuf::from(input)
    };
    if !path.exists() {
        bail!("reference file not found: {input}");
    }
    let info = media::probe(&path).await?;
    let analyzed = info.duration.min(LIMIT);
    let mut metrics = RefMetrics { duration: info.duration, analyzed_seconds: analyzed, ..Default::default() };
    let mut excerpt = String::new();
    {
        let _slot = ctx.media_slot().await?;
        if info.has_audio {
            let wav = dir.join("audio.wav");
            if !wav.exists() {
                ctx.stage(&format!("Listening to {name}"), 0.1);
                media::extract_audio(&path, &wav, Some(LIMIT), &ctx.cancel).await?;
            }
            let wav2 = wav.clone();
            let audio = tokio::task::spawn_blocking(move || media::analyze_audio(&wav2)).await??;
            let tr_path = dir.join("transcript.json");
            let transcript: Transcript = match util::read_json(&tr_path) {
                Ok(t) => t,
                Err(_) => {
                    ctx.stage(&format!("Transcribing {name}"), 0.15);
                    let ctx2 = ctx.clone();
                    let t = transcribe::run_whisper(&wav, &dir.join("whisper"), &ctx.cancel, &move |f| ctx2.progress(0.15 + f * 0.45, "Transcribing reference"))
                        .await?;
                    util::write_json(&tr_path, &t)?;
                    t
                }
            };
            let speech: f64 = audio.speech.iter().map(|s| s.len()).sum();
            metrics.speech_ratio = speech / analyzed.max(1.0);
            metrics.words_per_min = transcript.words.len() as f64 / (analyzed / 60.0).max(0.1);
            let inner: Vec<f64> = audio
                .silences
                .iter()
                .filter(|s| s.start > 0.05 && s.end < audio.duration - 0.05)
                .map(|s| s.len())
                .collect();
            metrics.avg_pause = if inner.is_empty() { 0.0 } else { inner.iter().sum::<f64>() / inner.len() as f64 };
            metrics.long_pauses_per_min = inner.iter().filter(|&&p| p > 0.6).count() as f64 / (analyzed / 60.0).max(0.1);
            excerpt = transcript.words.iter().take(1200).map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
        }
        if info.has_video {
            ctx.stage(&format!("Measuring cuts in {name}"), 0.62);
            let cuts = media::detect_scenes(&path, 0.3, Some(LIMIT), &ctx.cancel).await.unwrap_or_default();
            metrics.cuts = cuts.len();
            metrics.cuts_per_min = cuts.len() as f64 / (analyzed / 60.0).max(0.1);
            let mut bounds = vec![0.0];
            bounds.extend(cuts.iter().copied());
            bounds.push(analyzed);
            let mut shots: Vec<f64> = bounds.windows(2).map(|w| w[1] - w[0]).filter(|d| *d > 0.05).collect();
            metrics.avg_shot = analyzed / (cuts.len() + 1) as f64;
            metrics.median_shot = median(&mut shots);
            if !dir.join("sheets.json").exists() {
                let sheets = media::contact_sheets(&path, analyzed, &dir.join("sheets"), 3, &ctx.cancel).await?;
                util::write_json(&dir.join("sheets.json"), &sheets)?;
            }
            let thumb = dir.join("thumb.jpg");
            if !thumb.exists() {
                let _ = media::thumbnail(&path, (info.duration * 0.15).min(20.0), &thumb, 480).await;
            }
        }
    }
    ctx.check()?;
    let sheets: Vec<Sheet> = util::read_json(&dir.join("sheets.json")).unwrap_or_default();
    let images: Vec<PathBuf> = sheets.iter().map(|s| PathBuf::from(&s.path)).collect();
    ctx.stage(&format!("Studying the style of {name}"), 0.75);
    let summary: StyleSummary = {
        let _slot = ctx.llm_slot().await?;
        let ctx2 = ctx.clone();
        let req = agent::Request {
            prompt: prompts::style_prompt(&name, &metrics, &excerpt, !images.is_empty()),
            schema: style::style_summary_schema(),
            cwd: dir.to_path_buf(),
            images,
            log_path: Some(dir.join("agent.jsonl")),
            timeout: Duration::from_secs(20 * 60),
        };
        agent::run_validated(engine, req, &ctx.cancel, &move |m| ctx2.log(m), |v| Ok(serde_json::from_value::<StyleSummary>(v)?)).await?
    };
    let thumb = dir.join("thumb.jpg");
    Ok(RefAnalysis {
        name,
        input: input.to_string(),
        analyzed: util::now_iso(),
        metrics,
        style: StyleSummary { pause_keep: summary.pause_keep.clamp(0.15, 1.2), ..summary },
        thumb: thumb.exists().then(|| thumb.to_string_lossy().to_string()),
    })
}

async fn analyze_project_references(ctx: &Ctx, project_id: &str) -> Result<()> {
    let p = project::get(project_id)?;
    for r in p.references.iter().filter(|r| r.analysis.is_none()) {
        ctx.check()?;
        let dir = p.ref_dir(&r.id);
        match analyze_reference_input(ctx, &r.input, &dir, &engine_for(&p)).await {
            Ok(a) => {
                ctx.log(&format!("Reference \"{}\": {}", a.name, a.style.summary));
                let rid = r.id.clone();
                project::update(project_id, |p| {
                    if let Some(x) = p.references.iter_mut().find(|x| x.id == rid) {
                        x.name = a.name.clone();
                        x.analysis = Some(a);
                        x.error = None;
                    }
                    Ok(())
                })?;
            }
            Err(e) if ctx.cancel.is_cancelled() => return Err(e),
            Err(e) => {
                // A broken reference shouldn't block the edit.
                ctx.log(&format!("Reference {} skipped: {e}", r.input));
                let rid = r.id.clone();
                let msg = e.to_string();
                project::update(project_id, |p| {
                    if let Some(x) = p.references.iter_mut().find(|x| x.id == rid) {
                        x.error = Some(msg);
                    }
                    Ok(())
                })?;
            }
        }
        ctx.project_changed(project_id);
    }
    Ok(())
}

// ------------------------------------------------------------------ edits

pub fn engine_for(p: &Project) -> EngineChoice {
    if p.engine.provider.is_empty() {
        EngineChoice::default()
    } else {
        p.engine.clone()
    }
}

pub fn edit_path(p: &Project, version: u32) -> PathBuf {
    p.edits_dir().join(format!("v{version}.json"))
}

pub fn load_edit(p: &Project, version: Option<u32>) -> Result<Edit> {
    let v = version.or(p.current_edit).ok_or_else(|| anyhow!("this project has no edit yet"))?;
    util::read_json(&edit_path(p, v))
}

pub fn compute_timeline(p: &Project, e: &Edit) -> Timeline {
    let words: HashMap<String, Vec<transcribe::Word>> = p.sources.iter().map(|s| (s.id.clone(), project::read_words(p, &s.id))).collect();
    let infos: Vec<(String, MediaInfo)> = p.sources.iter().filter_map(|s| s.info.clone().map(|i| (s.id.clone(), i))).collect();
    let refs: Vec<SourceRef> = infos.iter().map(|(id, info)| SourceRef { id, info, words: words.get(id).map(|w| w.as_slice()).unwrap_or(&[]) }).collect();
    edit::timeline(e, &refs)
}

/// Saves an edit over its version file and refreshes the version's duration.
pub fn save_edit(project_id: &str, e: &Edit) -> Result<Timeline> {
    let p = project::get(project_id)?;
    util::write_json(&edit_path(&p, e.version), e)?;
    let tl = compute_timeline(&p, e);
    let dur = tl.duration;
    let version = e.version;
    project::update(project_id, |p| {
        if let Some(m) = p.edits.iter_mut().find(|m| m.version == version) {
            m.duration = dur;
        }
        Ok(())
    })?;
    Ok(tl)
}

fn cut_params(style: &style::Style, p: &Project) -> CutParams {
    let mut pause = style.pause_keep;
    // Project references can tighten/loosen the cut a little toward their measured style.
    let refs: Vec<f64> = p.references.iter().filter_map(|r| r.analysis.as_ref().map(|a| a.style.pause_keep)).filter(|v| *v > 0.0).collect();
    if !refs.is_empty() {
        let avg = refs.iter().sum::<f64>() / refs.len() as f64;
        pause = (pause + avg) / 2.0;
    }
    CutParams { pause_keep: pause.clamp(0.15, 1.5), ..Default::default() }
}

pub async fn plan_edit(ctx: &Ctx, project_id: &str, request: Option<String>, base: f64, span: f64) -> Result<u32> {
    let p = project::get(project_id)?;
    let style = style::get(&p.style_id);
    let utts = project::all_utterances(&p);
    if utts.iter().all(|u| u.kind != "speech") {
        bail!("No speech was found in the footage, so there is nothing to edit by transcript.");
    }
    let library = broll::library();
    let use_frames = settings::get().use_frames;
    let sheets: Vec<(String, Vec<Sheet>)> = if use_frames {
        p.sources
            .iter()
            .map(|s| (s.id.clone(), util::read_json::<Vec<Sheet>>(&p.work_dir(&s.id).join("sheets.json")).unwrap_or_default()))
            .filter(|(_, v)| !v.is_empty())
            .collect()
    } else {
        vec![]
    };
    let images: Vec<PathBuf> = sheets.iter().flat_map(|(_, v)| v.iter().map(|s| PathBuf::from(&s.path))).take(16).collect();
    let previous = if request.is_some() { load_edit(&p, None).ok() } else { None };
    let current_plan: Option<Plan> = previous.as_ref().map(|e| edit::edit_to_plan(e, &utts));
    let prompt = prompts::plan_prompt(&prompts::PlanInput {
        project: &p,
        style: &style,
        utterances: &utts,
        library: &library,
        sheets: &sheets,
        stock_available: broll::stock_provider().is_some(),
        current: current_plan.as_ref(),
        request: request.as_deref(),
    });
    let engine = engine_for(&p);
    ctx.stage(&format!("{} is editing ({} utterances)", engine.label(), utts.len()), base);
    let logs = p.dir().join("logs");
    std::fs::create_dir_all(&logs)?;
    let agent_dir = p.dir().join("work").join("agent");
    std::fs::create_dir_all(&agent_dir)?;
    std::fs::write(agent_dir.join("last-prompt.md"), &prompt)?;
    let ids: HashSet<String> = utts.iter().map(|u| u.id.clone()).collect();
    let plan: Plan = {
        let _slot = ctx.llm_slot().await?;
        let ctx2 = ctx.clone();
        let req = agent::Request {
            prompt,
            schema: edit::plan_schema(),
            cwd: agent_dir,
            images,
            log_path: Some(logs.join(format!("agent-{}.jsonl", chrono::Local::now().format("%Y%m%d-%H%M%S")))),
            timeout: Duration::from_secs(40 * 60),
        };
        let ids = ids.clone();
        agent::run_validated(&engine, req, &ctx.cancel, &move |m| ctx2.log(m), move |v| {
            let plan: Plan = serde_json::from_value(v).context("plan didn't match the schema")?;
            let listed: Vec<&String> = plan.segments.iter().flat_map(|s| s.ids.iter()).collect();
            if listed.is_empty() {
                bail!("the plan keeps no utterances");
            }
            let unknown = listed.iter().filter(|id| !ids.contains(id.trim())).count();
            if unknown * 3 > listed.len() {
                bail!("{unknown} of {} utterance ids don't exist – use only ids from the transcript", listed.len());
            }
            Ok(plan)
        })
        .await?
    };
    ctx.progress(base + span * 0.85, "Building the timeline");
    let durations: HashMap<String, f64> = p.sources.iter().filter_map(|s| s.info.as_ref().map(|i| (s.id.clone(), i.duration))).collect();
    let lib_ids: HashSet<String> = library.iter().map(|l| l.id.clone()).collect();
    let mut e = edit::resolve_plan(&plan, &utts, &durations, &lib_ids, cut_params(&style, &p));
    if e.clips.is_empty() {
        bail!("the AI's plan didn't keep any usable footage");
    }
    // Keep already-chosen B-roll when revising.
    if let Some(prev) = &previous {
        for b in e.broll.iter_mut() {
            if let Some(old) = prev.broll.iter().find(|o| o.asset.is_some() && o.query == b.query && o.library == b.library) {
                b.asset = old.asset.clone();
            }
        }
    }
    let version = p.next_edit_version();
    e.version = version;
    e.created = util::now_iso();
    e.kind = if request.is_some() { "revision".into() } else { "ai".into() };
    e.engine = engine.label();
    e.request = request.clone().unwrap_or_default();
    for w in &e.warnings {
        ctx.log(&format!("Note: {w}"));
    }
    util::write_json(&edit_path(&p, version), &e)?;
    let tl = compute_timeline(&p, &e);
    ctx.log(&format!(
        "Edit v{version}: {} clips, {} → {} ({:.0}% removed), {} B-roll, {} titles, {} chapters",
        tl.clips.len(),
        util::fmt_time(tl.source_duration),
        util::fmt_time(tl.duration),
        (1.0 - tl.duration / tl.source_duration.max(0.01)) * 100.0,
        tl.broll.len(),
        tl.titles.len(),
        tl.chapters.len()
    ));
    let summary = if e.summary.is_empty() { format!("Created edit v{version}.") } else { e.summary.clone() };
    let note = request.clone().map(|r| util::clip_text(&r, 80)).unwrap_or_else(|| "First cut".into());
    let engine_label = engine.label();
    project::update(project_id, |p| {
        p.edits.push(EditMeta { version, created: util::now_iso(), kind: e.kind.clone(), note, engine: engine_label, duration: tl.duration });
        p.current_edit = Some(version);
        p.chat.push(ChatMessage { role: "assistant".into(), text: summary, created: util::now_iso(), version: Some(version) });
        Ok(())
    })?;
    ctx.project_changed(project_id);
    Ok(version)
}

pub async fn fill_broll(ctx: &Ctx, project_id: &str, base: f64, span: f64) -> Result<(usize, usize)> {
    let p = project::get(project_id)?;
    let mut e = load_edit(&p, None)?;
    if e.broll.iter().all(|b| !b.enabled || b.asset.is_some()) {
        return Ok((0, 0));
    }
    ctx.stage("Finding B-roll", base);
    let ctx2 = ctx.clone();
    let (filled, empty) = broll::fill(&mut e, &p.broll_dir(), p.aspect == "9:16", &ctx.cancel, &move |f, m| {
        ctx2.progress(base + f * span, m);
        ctx2.log(m);
    })
    .await?;
    save_edit(project_id, &e)?;
    ctx.log(&format!(
        "B-roll: {filled} filled{}",
        if empty > 0 { format!(", {empty} left as markers (connect Pexels/Pixabay or a library in Settings to fill them)") } else { String::new() }
    ));
    ctx.project_changed(project_id);
    Ok((filled, empty))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub items: Vec<ExportItem>,
}

pub async fn export_all(project_id: &str) -> Result<Vec<ExportItem>> {
    let p = project::get(project_id)?;
    let e = load_edit(&p, None)?;
    let tl = compute_timeline(&p, &e);
    let dir = p.exports_dir();
    let base = format!("{}-v{}", util::slugify(&p.name), e.version);
    let music = match &p.music {
        Some(m) if Path::new(m).exists() => media::probe(Path::new(m)).await.ok().map(|i| (m.clone(), i)),
        _ => None,
    };
    let fcp = dir.join(format!("{base}.fcpxml"));
    export::write(&fcp, &export::fcpxml(&p, &e, &tl, music.as_ref().map(|(m, i)| (m.as_str(), i))))?;
    let srt = dir.join(format!("{base}.srt"));
    export::write(&srt, &export::srt(&tl))?;
    let md = dir.join(format!("{base}-youtube.md"));
    export::write(&md, &export::youtube_markdown(&p, &e, &tl))?;
    let now = util::now_iso();
    let items = vec![
        ExportItem { kind: "fcpxml".into(), path: fcp.to_string_lossy().into(), created: now.clone() },
        ExportItem { kind: "srt".into(), path: srt.to_string_lossy().into(), created: now.clone() },
        ExportItem { kind: "youtube".into(), path: md.to_string_lossy().into(), created: now },
    ];
    let items2 = items.clone();
    project::update(project_id, |p| {
        p.exports.retain(|x| !items2.iter().any(|i| i.kind == x.kind));
        p.exports.extend(items2);
        Ok(())
    })?;
    Ok(items)
}

pub async fn render_project(ctx: &Ctx, project_id: &str, opts: render::RenderOpts) -> Result<String> {
    let p = project::get(project_id)?;
    let e = load_edit(&p, None)?;
    let tl = compute_timeline(&p, &e);
    let suffix = format!(
        "{}{}",
        if opts.aspect == "9:16" { "-vertical" } else { "" },
        if opts.quality == "preview" { "-preview" } else { "" }
    );
    let out = p.exports_dir().join(format!("{}-v{}{suffix}.mp4", util::slugify(&p.name), e.version));
    let _slot = ctx.media_slot().await?;
    ctx.stage("Rendering", 0.0);
    let ctx2 = ctx.clone();
    render::render(&p, &tl, &opts, &out, &ctx.cancel, &move |f, m| ctx2.progress(f, m)).await?;
    let path = out.to_string_lossy().to_string();
    let kind = if opts.aspect == "9:16" { "mp4-vertical" } else { "mp4" };
    let path2 = path.clone();
    project::update(project_id, |p| {
        p.exports.retain(|x| x.kind != kind);
        p.exports.push(ExportItem { kind: kind.into(), path: path2, created: util::now_iso() });
        Ok(())
    })?;
    ctx.project_changed(project_id);
    ctx.log(&format!("Rendered {path}"));
    Ok(path)
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PipelineOpts {
    /// Re-run transcription/analysis even if cached.
    pub reanalyze: bool,
    /// Skip AI planning (analysis only).
    pub analyze_only: bool,
}

pub async fn run_pipeline(ctx: Ctx, project_id: String, opts: PipelineOpts) -> Result<Option<Value>> {
    let p = project::get(&project_id)?;
    let n = p.sources.len().max(1) as f64;
    for (i, s) in p.sources.iter().enumerate() {
        ctx.check()?;
        if s.analyzed && !opts.reanalyze && p.work_dir(&s.id).join("utterances.json").exists() {
            continue;
        }
        let _slot = ctx.media_slot().await?;
        analyze_source(&ctx, &project_id, &s.id, 0.6 * i as f64 / n, 0.6 / n, opts.reanalyze).await?;
    }
    ctx.check()?;
    if p.references.iter().any(|r| r.analysis.is_none()) {
        analyze_project_references(&ctx, &project_id).await?;
    }
    if opts.analyze_only {
        return Ok(None);
    }
    let version = plan_edit(&ctx, &project_id, None, 0.7, 0.2).await?;
    fill_broll(&ctx, &project_id, 0.9, 0.07).await?;
    ctx.stage("Exporting timeline", 0.97);
    export_all(&project_id).await?;
    ctx.project_changed(&project_id);
    Ok(Some(serde_json::json!({ "version": version })))
}

pub async fn revise(ctx: Ctx, project_id: String, request: String) -> Result<Option<Value>> {
    let version = plan_edit(&ctx, &project_id, Some(request), 0.0, 0.85).await?;
    fill_broll(&ctx, &project_id, 0.85, 0.12).await?;
    export_all(&project_id).await?;
    ctx.project_changed(&project_id);
    Ok(Some(serde_json::json!({ "version": version })))
}

/// AI descriptions for library clips without one, in batches.
pub async fn describe_library(ctx: Ctx) -> Result<Option<Value>> {
    let mut lib = broll::library();
    let todo: Vec<usize> = (0..lib.len()).filter(|&i| lib[i].description.is_empty() && Path::new(&lib[i].thumb).exists()).collect();
    if todo.is_empty() {
        return Ok(Some(serde_json::json!({ "described": 0 })));
    }
    let engine = EngineChoice::default();
    let mut done = 0;
    for (bi, batch) in todo.chunks(16).enumerate() {
        ctx.check()?;
        ctx.stage(&format!("Describing clips {}–{} of {}", bi * 16 + 1, bi * 16 + batch.len(), todo.len()), bi as f64 * 16.0 / todo.len() as f64);
        let items: Vec<(String, String, f64)> = batch.iter().map(|&i| (lib[i].id.clone(), lib[i].name.clone(), lib[i].duration)).collect();
        let images: Vec<PathBuf> = batch.iter().map(|&i| PathBuf::from(&lib[i].thumb)).collect();
        let _slot = ctx.llm_slot().await?;
        let ctx2 = ctx.clone();
        let req = agent::Request {
            prompt: prompts::library_prompt(&items),
            schema: prompts::library_schema(),
            cwd: util::app_data_dir().join("thumbs"),
            images,
            log_path: None,
            timeout: Duration::from_secs(15 * 60),
        };
        let v = agent::run_validated(&engine, req, &ctx.cancel, &move |m| ctx2.log(m), Ok).await?;
        for it in v["items"].as_array().cloned().unwrap_or_default() {
            let id = it["id"].as_str().unwrap_or("");
            if let Some(item) = lib.iter_mut().find(|l| l.id == id) {
                item.description = it["description"].as_str().unwrap_or("").to_string();
                item.tags = it["tags"].as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default();
                done += 1;
            }
        }
        broll::save_library(&lib)?;
    }
    Ok(Some(serde_json::json!({ "described": done })))
}
