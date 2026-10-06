//! Runs the user's own Claude Code or Codex CLI headlessly and returns
//! schema-validated JSON. No credentials are handled here – the CLIs use their
//! existing sign-in.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::project::EngineChoice;
use crate::{proc, tools, util};

pub struct Request {
    pub prompt: String,
    pub schema: Value,
    /// Working directory: files the engine may read (contact sheets, thumbnails).
    pub cwd: PathBuf,
    /// Images to look at (Codex attaches them; Claude reads them with its Read tool).
    pub images: Vec<PathBuf>,
    /// Where to append the raw event stream for debugging.
    pub log_path: Option<PathBuf>,
    pub timeout: Duration,
}

/// Human-readable progress lines from the engine.
pub type EventFn<'a> = &'a (dyn Fn(&str) + Send + Sync);

pub async fn run(engine: &EngineChoice, req: &Request, cancel: &CancellationToken, on_event: EventFn<'_>) -> Result<Value> {
    std::fs::create_dir_all(&req.cwd)?;
    match engine.provider.as_str() {
        "codex" => run_codex(engine, req, cancel, on_event).await,
        _ => run_claude(engine, req, cancel, on_event).await,
    }
}

fn is_limit_error(msg: &str) -> bool {
    msg.contains("usage limit")
}

/// The other engine, if it's installed and signed in.
async fn fallback_engine(engine: &EngineChoice) -> Option<EngineChoice> {
    if !crate::settings::get().engine_fallback {
        return None;
    }
    let s = crate::settings::get().engine;
    let other = if engine.provider == "codex" {
        let st = tools::claude_status().await;
        (st.installed && st.logged_in == Some(true)).then(|| EngineChoice { provider: "claude".into(), model: s.claude_model, effort: s.claude_effort })
    } else {
        let st = tools::codex_status().await;
        (st.installed && st.logged_in == Some(true)).then(|| EngineChoice { provider: "codex".into(), model: s.codex_model, effort: s.codex_effort })
    };
    other
}

/// Like `run_validated_once`, but if the engine is out of usage, switches to the
/// other signed-in engine (when enabled in Settings).
pub async fn run_validated<T>(
    engine: &EngineChoice,
    req: Request,
    cancel: &CancellationToken,
    on_event: EventFn<'_>,
    parse: impl Fn(Value) -> Result<T>,
) -> Result<T> {
    let backup = Request { prompt: req.prompt.clone(), schema: req.schema.clone(), cwd: req.cwd.clone(), images: req.images.clone(), log_path: req.log_path.clone(), timeout: req.timeout };
    match run_validated_once(engine, req, cancel, on_event, &parse).await {
        Err(e) if is_limit_error(&e.to_string()) && !cancel.is_cancelled() => {
            let Some(other) = fallback_engine(engine).await else { return Err(e) };
            on_event(&format!("{} is out of usage – switching to {}", engine.label(), other.label()));
            run_validated_once(&other, backup, cancel, on_event, &parse).await
        }
        r => r,
    }
}

/// Runs, parses and validates with `parse`; on failure retries once with the error appended.
pub async fn run_validated_once<T>(
    engine: &EngineChoice,
    req: Request,
    cancel: &CancellationToken,
    on_event: EventFn<'_>,
    parse: &impl Fn(Value) -> Result<T>,
) -> Result<T> {
    let first = run(engine, &req, cancel, on_event).await;
    let err = match first.and_then(parse) {
        Ok(v) => return Ok(v),
        Err(e) => e,
    };
    if cancel.is_cancelled() || err.to_string() == "cancelled" {
        bail!("cancelled");
    }
    let msg = err.to_string();
    // Don't retry problems a retry can't fix.
    if msg.contains("not installed") || msg.contains("not signed in") || msg.contains("usage limit") {
        return Err(err);
    }
    on_event(&format!("Retrying once: {}", util::clip_text(&msg, 160)));
    let retry = Request {
        prompt: format!(
            "{}\n\nIMPORTANT: your previous answer was rejected: {}\nReturn a corrected answer that matches the schema exactly.",
            req.prompt, msg
        ),
        ..req
    };
    let v = run(engine, &retry, cancel, on_event).await?;
    parse(v)
}

fn log_line(path: &Option<PathBuf>, line: &str) {
    if let Some(p) = path {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// Pulls a JSON object out of free text (handles ```json fences and prose around it).
pub fn extract_json(text: &str) -> Option<Value> {
    let t = text.trim();
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        if v.is_object() {
            return Some(v);
        }
    }
    let start = t.find('{')?;
    let end = t.rfind('}')?;
    serde_json::from_str::<Value>(&t[start..=end]).ok().filter(|v| v.is_object())
}

fn friendly_error(provider: &str, raw: &str) -> String {
    let l = raw.to_lowercase();
    if l.contains("not logged in") || l.contains("please run /login") || l.contains("invalid api key") || l.contains("401") && l.contains("auth") {
        return format!("{provider} is not signed in. Open Settings ▸ Engines and sign in.");
    }
    if l.contains("usage limit") || l.contains("rate limit") || l.contains("limit reached") || l.contains("429") {
        return format!("{provider} usage limit reached – try again later or switch engines. ({})", util::clip_text(raw.trim(), 200));
    }
    util::clip_text(raw.trim(), 600)
}

async fn run_claude(engine: &EngineChoice, req: &Request, cancel: &CancellationToken, on_event: EventFn<'_>) -> Result<Value> {
    let exe = tools::claude_path().ok_or_else(|| anyhow!("Claude Code is not installed. Open Settings ▸ Engines."))?;
    let schema = serde_json::to_string(&req.schema)?;
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--json-schema".into(),
        schema,
        "--no-session-persistence".into(),
        "--safe-mode".into(),
        "--strict-mcp-config".into(),
        "--disable-slash-commands".into(),
        "--permission-mode".into(),
        "dontAsk".into(),
    ];
    if !engine.model.is_empty() {
        args.extend(["--model".into(), engine.model.clone()]);
    }
    if !engine.effort.is_empty() {
        args.extend(["--effort".into(), engine.effort.clone()]);
    }
    let mut prompt = req.prompt.clone();
    if req.images.is_empty() {
        args.extend(["--tools".into(), String::new()]);
    } else {
        args.extend(["--tools".into(), "Read".into(), "--allowedTools".into(), "Read".into()]);
        prompt.push_str("\n\n## Images\nBefore you answer, open every one of these images with the Read tool – they show what is on screen:\n");
        for img in &req.images {
            prompt.push_str(&format!("- {}\n", img.display()));
        }
    }

    let log = req.log_path.clone();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let result: std::sync::Arc<std::sync::Mutex<Option<Value>>> = Default::default();
    let result2 = result.clone();
    let fut = proc::run(
        &exe,
        &args,
        proc::RunOpts {
            cwd: Some(req.cwd.clone()),
            stdin: Some(prompt),
            timeout: Some(req.timeout),
            cancel: Some(cancel.clone()),
            keep_bytes: 256 * 1024,
            on_stdout: Some(Box::new(move |line| {
                log_line(&log, line);
                let Ok(v) = serde_json::from_str::<Value>(line) else { return };
                match v["type"].as_str() {
                    Some("assistant") => {
                        for c in v["message"]["content"].as_array().cloned().unwrap_or_default() {
                            match c["type"].as_str() {
                                Some("text") => {
                                    let t = c["text"].as_str().unwrap_or("").trim().to_string();
                                    if !t.is_empty() {
                                        let _ = tx.send(util::clip_text(&t, 300));
                                    }
                                }
                                Some("thinking") => {
                                    let _ = tx.send("Thinking…".into());
                                }
                                Some("tool_use") => {
                                    let name = c["name"].as_str().unwrap_or("tool");
                                    let detail = c["input"]["file_path"].as_str().map(|p| {
                                        Path::new(p).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()
                                    });
                                    let _ = tx.send(match (name, detail) {
                                        ("Read", Some(f)) => format!("Looking at {f}"),
                                        ("StructuredOutput", _) => "Writing the edit decisions…".into(),
                                        (n, _) => format!("Using {n}"),
                                    });
                                }
                                _ => {}
                            }
                        }
                    }
                    Some("result") => {
                        *result2.lock().unwrap() = Some(v);
                    }
                    _ => {}
                }
            })),
            ..Default::default()
        },
    );
    tokio::pin!(fut);
    let out = loop {
        tokio::select! {
            r = &mut fut => break r?,
            Some(msg) = rx.recv() => on_event(&msg),
        }
    };
    while let Ok(msg) = rx.try_recv() {
        on_event(&msg);
    }
    let res = result.lock().unwrap().take();
    let Some(res) = res else {
        let raw = format!("{}\n{}", out.stderr, out.stdout);
        bail!("Claude returned no result: {}", friendly_error("Claude", &raw));
    };
    if res["is_error"].as_bool().unwrap_or(false) || res["subtype"].as_str().map(|s| s != "success").unwrap_or(false) {
        let msg = res["result"].as_str().map(String::from).unwrap_or_else(|| res.to_string());
        bail!("{}", friendly_error("Claude", &msg));
    }
    if let Some(cost) = res["total_cost_usd"].as_f64() {
        on_event(&format!("Claude finished ({} turns, ≈${cost:.3} API-equivalent)", res["num_turns"].as_i64().unwrap_or(1)));
    }
    if let Some(v) = res.get("structured_output").filter(|v| v.is_object()) {
        return Ok(v.clone());
    }
    let text = res["result"].as_str().unwrap_or("");
    extract_json(text).ok_or_else(|| anyhow!("Claude's answer was not valid JSON: {}", util::clip_text(text, 300)))
}

async fn run_codex(engine: &EngineChoice, req: &Request, cancel: &CancellationToken, on_event: EventFn<'_>) -> Result<Value> {
    let (prog, pre) = tools::codex_invocation().ok_or_else(|| anyhow!("Codex CLI is not installed. Open Settings ▸ Engines."))?;
    let tag = util::new_id();
    let schema_path = req.cwd.join(format!(".cutpilot-schema-{tag}.json"));
    let out_path = req.cwd.join(format!(".cutpilot-answer-{tag}.json"));
    std::fs::write(&schema_path, serde_json::to_vec(&req.schema)?)?;
    let model = if engine.model.is_empty() {
        tools::codex_models().first().map(|m| m.id.clone()).unwrap_or_default()
    } else {
        engine.model.clone()
    };

    let mut args = pre;
    args.push("exec".into());
    for img in &req.images {
        args.extend(["-i".into(), img.to_string_lossy().to_string()]);
    }
    args.extend([
        "--skip-git-repo-check".into(),
        "--ephemeral".into(),
        "--ignore-user-config".into(),
        "--sandbox".into(),
        "read-only".into(),
        "--json".into(),
        "--output-schema".into(),
        schema_path.to_string_lossy().to_string(),
        "-o".into(),
        out_path.to_string_lossy().to_string(),
        "-C".into(),
        req.cwd.to_string_lossy().to_string(),
    ]);
    if !model.is_empty() {
        args.extend(["-m".into(), model]);
    }
    if !engine.effort.is_empty() {
        args.extend(["-c".into(), format!("model_reasoning_effort=\"{}\"", engine.effort)]);
    }
    args.push("-".into());

    let log = req.log_path.clone();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let errors: std::sync::Arc<std::sync::Mutex<Vec<String>>> = Default::default();
    let errors2 = errors.clone();
    let fut = proc::run(
        &prog,
        &args,
        proc::RunOpts {
            cwd: Some(req.cwd.clone()),
            stdin: Some(req.prompt.clone()),
            timeout: Some(req.timeout),
            cancel: Some(cancel.clone()),
            keep_bytes: 256 * 1024,
            on_stdout: Some(Box::new(move |line| {
                log_line(&log, line);
                let Ok(v) = serde_json::from_str::<Value>(line) else { return };
                match v["type"].as_str() {
                    Some("item.started") | Some("item.completed") => {
                        let item = &v["item"];
                        match item["type"].as_str() {
                            Some("reasoning") => {
                                let t = item["text"].as_str().unwrap_or("").trim().replace("**", "");
                                if !t.is_empty() && v["type"] == "item.completed" {
                                    let _ = tx.send(util::clip_text(t.lines().next().unwrap_or(""), 200));
                                }
                            }
                            Some("agent_message") if v["type"] == "item.completed" => {
                                let _ = tx.send("Writing the edit decisions…".into());
                            }
                            Some("command_execution") if v["type"] == "item.started" => {
                                let _ = tx.send(format!("Running {}", util::clip_text(item["command"].as_str().unwrap_or(""), 80)));
                            }
                            Some("error") => {
                                let m = item["message"].as_str().unwrap_or("");
                                // Codex reports harmless notices as items of type error.
                                if !m.contains("Skill descriptions") && !m.contains("metadata") {
                                    errors2.lock().unwrap().push(m.to_string());
                                }
                            }
                            _ => {}
                        }
                    }
                    Some("turn.started") => {
                        let _ = tx.send("Codex is reading the footage notes…".into());
                    }
                    Some("error") | Some("turn.failed") => {
                        let m = v["message"].as_str().or(v["error"]["message"].as_str()).unwrap_or("").to_string();
                        errors2.lock().unwrap().push(m);
                    }
                    Some("turn.completed") => {
                        let u = &v["usage"];
                        let _ = tx.send(format!(
                            "Codex finished ({} in / {} out tokens)",
                            u["input_tokens"].as_i64().unwrap_or(0),
                            u["output_tokens"].as_i64().unwrap_or(0)
                        ));
                    }
                    _ => {}
                }
            })),
            ..Default::default()
        },
    );
    tokio::pin!(fut);
    let out = loop {
        tokio::select! {
            r = &mut fut => break r,
            Some(msg) = rx.recv() => on_event(&msg),
        }
    };
    while let Ok(msg) = rx.try_recv() {
        on_event(&msg);
    }
    let _ = std::fs::remove_file(&schema_path);
    let out = out?;
    let answer = std::fs::read_to_string(&out_path).ok();
    let _ = std::fs::remove_file(&out_path);
    let errs = errors.lock().unwrap().clone();
    match answer.filter(|a| !a.trim().is_empty()) {
        Some(text) => extract_json(&text).with_context(|| format!("Codex's answer was not valid JSON: {}", util::clip_text(&text, 300))),
        None => {
            let raw = if errs.is_empty() { format!("{}\n{}", out.stderr, out.tail(6)) } else { errs.join("\n") };
            // Codex wraps API errors as JSON strings.
            let raw = serde_json::from_str::<Value>(&raw)
                .ok()
                .and_then(|v| v["error"]["message"].as_str().map(String::from))
                .unwrap_or(raw);
            bail!("{}", friendly_error("Codex", &raw))
        }
    }
}
