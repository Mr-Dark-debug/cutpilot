//! Detection, download and installation of external tools: ffmpeg, whisper.cpp
//! (+ models), yt-dlp, and the Claude Code / Codex CLIs.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::{proc, settings, util};

const WHISPER_VERSION: &str = "v1.9.2";
const FFMPEG_URLS: &[&str] = &[
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
];
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub version: String,
    pub path: String,
    pub detail: String,
    /// Only for AI engines.
    pub logged_in: Option<bool>,
    pub account: String,
    pub required: bool,
    pub can_install: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub size_mb: u32,
    pub note: String,
}

pub fn whisper_models() -> Vec<ModelInfo> {
    let m = |id: &str, label: &str, size_mb: u32, note: &str| ModelInfo {
        id: id.into(),
        label: label.into(),
        size_mb,
        note: note.into(),
    };
    vec![
        m("tiny", "Tiny", 75, "Fastest, rough accuracy"),
        m("base", "Base", 142, "Fast, good for clear speech (default)"),
        m("small", "Small", 466, "Better accuracy, good for Hindi/Hinglish"),
        m("medium", "Medium", 1500, "High accuracy, slow on CPU"),
        m("large-v3-turbo", "Large v3 Turbo", 1600, "Best accuracy, use with GPU"),
    ]
}

/// whisper.cpp `-dtw` preset for a model name.
pub fn dtw_preset(model: &str) -> Option<String> {
    let known = ["tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en"];
    if known.contains(&model) {
        return Some(model.to_string());
    }
    match model {
        "large-v3-turbo" => Some("large.v3.turbo".into()),
        "large-v3" => Some("large.v3".into()),
        "large-v2" => Some("large.v2".into()),
        _ => None,
    }
}

// ---------------------------------------------------------------- locating

fn on_path(name: &str) -> Option<PathBuf> {
    which::which(name).ok()
}

pub fn ffmpeg_path() -> Option<PathBuf> {
    let local = util::tools_dir().join("ffmpeg").join("ffmpeg.exe");
    if local.exists() {
        return Some(local);
    }
    on_path("ffmpeg")
}

pub fn ffprobe_path() -> Option<PathBuf> {
    let local = util::tools_dir().join("ffmpeg").join("ffprobe.exe");
    if local.exists() {
        return Some(local);
    }
    on_path("ffprobe")
}

pub fn ffmpeg() -> Result<PathBuf> {
    ffmpeg_path().ok_or_else(|| anyhow!("ffmpeg is not installed. Open Settings ▸ Tools and install it."))
}

pub fn ffprobe() -> Result<PathBuf> {
    ffprobe_path().ok_or_else(|| anyhow!("ffprobe is not installed. Open Settings ▸ Tools and install ffmpeg."))
}

fn whisper_dir(gpu: bool) -> PathBuf {
    util::tools_dir().join(if gpu { "whisper-cuda" } else { "whisper" })
}

pub fn whisper_path_for(gpu: bool) -> Option<PathBuf> {
    let p = whisper_dir(gpu).join("whisper-cli.exe");
    p.exists().then_some(p)
}

/// The whisper binary to use: CUDA build if enabled and installed, else CPU build, else PATH.
pub fn whisper() -> Result<PathBuf> {
    let s = settings::get();
    if s.whisper_gpu {
        if let Some(p) = whisper_path_for(true) {
            return Ok(p);
        }
    }
    whisper_path_for(false)
        .or_else(|| on_path("whisper-cli"))
        .ok_or_else(|| anyhow!("whisper.cpp is not installed. Open Settings ▸ Tools and install it."))
}

pub fn model_path(name: &str) -> PathBuf {
    util::models_dir().join(format!("ggml-{name}.bin"))
}

pub fn ytdlp_path() -> Option<PathBuf> {
    let local = util::tools_dir().join("yt-dlp.exe");
    if local.exists() {
        return Some(local);
    }
    on_path("yt-dlp")
}

pub fn claude_path() -> Option<PathBuf> {
    if let Some(p) = on_path("claude") {
        return Some(p);
    }
    let home = dirs::home_dir()?;
    [home.join(".local/bin/claude.exe"), home.join("AppData/Roaming/npm/claude.cmd")]
        .into_iter()
        .find(|p| p.exists())
}

/// How to launch Codex: (program, leading args). The npm package installs a
/// `codex.cmd` shim, which can't receive stdin reliably, so we run its JS
/// entry point with node directly.
pub fn codex_invocation() -> Option<(PathBuf, Vec<String>)> {
    let mut candidates = vec![];
    if let Some(p) = on_path("codex") {
        candidates.push(p);
    }
    if let Some(appdata) = dirs::data_dir() {
        candidates.push(appdata.join("npm").join("codex.cmd"));
    }
    for p in candidates {
        if !p.exists() {
            continue;
        }
        let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if ext == "exe" {
            return Some((p, vec![]));
        }
        let dir = p.parent()?.to_path_buf();
        let js = dir.join("node_modules/@openai/codex/bin/codex.js");
        if js.exists() {
            let node = if dir.join("node.exe").exists() { Some(dir.join("node.exe")) } else { on_path("node") };
            if let Some(node) = node {
                return Some((node, vec![js.to_string_lossy().to_string()]));
            }
        }
        return Some((PathBuf::from("cmd"), vec!["/C".into(), p.to_string_lossy().to_string()]));
    }
    None
}

/// Finds Resolve.exe: the user's choice, the default folder, then the Start-menu
/// shortcut (Resolve can be installed anywhere, e.g. D:\davinci).
pub fn resolve_exe() -> Option<PathBuf> {
    let custom = settings::get().resolve_path;
    if !custom.trim().is_empty() && Path::new(custom.trim()).exists() {
        return Some(PathBuf::from(custom.trim()));
    }
    let default = PathBuf::from(r"C:\Program Files\Blackmagic Design\DaVinci Resolve\Resolve.exe");
    if default.exists() {
        return Some(default);
    }
    static FOUND: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    FOUND.get_or_init(find_resolve_via_shortcut).clone().filter(|p| p.exists())
}

#[cfg(windows)]
fn find_resolve_via_shortcut() -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    let script = r#"$dirs = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:PUBLIC\Desktop", "$env:USERPROFILE\Desktop");
$sh = New-Object -ComObject WScript.Shell;
Get-ChildItem $dirs -Recurse -Filter "DaVinci Resolve*.lnk" -ErrorAction SilentlyContinue | ForEach-Object { $sh.CreateShortcut($_.FullName).TargetPath } | Where-Object { $_ -like "*Resolve.exe" } | Select-Object -First 1"#;
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x0800_0000)
        .output()
        .ok()?;
    let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!p.is_empty()).then(|| PathBuf::from(p))
}

#[cfg(not(windows))]
fn find_resolve_via_shortcut() -> Option<PathBuf> {
    None
}

/// "21.0.40005" from the registry, if installed.
pub fn resolve_version() -> String {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(out) = std::process::Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\Blackmagic Design\DaVinci Resolve", "/v", "Version"])
            .creation_flags(0x0800_0000)
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(v) = text.split_whitespace().last().filter(|v| v.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)) {
                return v.to_string();
            }
        }
    }
    String::new()
}

// ---------------------------------------------------------------- status

fn first_line(s: &str) -> String {
    s.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string()
}

pub async fn claude_status() -> ToolStatus {
    let mut st = ToolStatus {
        id: "claude".into(),
        name: "Claude Code".into(),
        can_install: true,
        logged_in: Some(false),
        ..Default::default()
    };
    let Some(path) = claude_path() else {
        st.detail = "Not installed".into();
        return st;
    };
    st.path = path.to_string_lossy().to_string();
    match proc::capture(&path, &["--version"], 20).await {
        Ok(out) if out.ok() => {
            st.installed = true;
            st.version = first_line(&out.stdout).replace(" (Claude Code)", "");
        }
        Ok(out) => st.detail = out.tail(3),
        Err(e) => st.detail = e.to_string(),
    }
    if st.installed {
        if let Ok(out) = proc::capture(&path, &["auth", "status"], 30).await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(out.stdout.trim()) {
                let logged = v["loggedIn"].as_bool().unwrap_or(false);
                st.logged_in = Some(logged);
                let email = v["email"].as_str().unwrap_or("");
                let plan = v["subscriptionType"].as_str().unwrap_or(v["authMethod"].as_str().unwrap_or(""));
                st.account = if plan.is_empty() { email.into() } else { format!("{email} · {plan}") };
            } else {
                st.logged_in = Some(out.ok() && out.stdout.to_lowercase().contains("logged in"));
            }
        }
        st.detail = if st.logged_in == Some(true) { "Ready".into() } else { "Not signed in".into() };
    }
    st
}

pub async fn codex_status() -> ToolStatus {
    let mut st = ToolStatus {
        id: "codex".into(),
        name: "Codex CLI".into(),
        can_install: true,
        logged_in: Some(false),
        ..Default::default()
    };
    let Some((prog, pre)) = codex_invocation() else {
        st.detail = "Not installed".into();
        return st;
    };
    st.path = pre.last().cloned().unwrap_or_else(|| prog.to_string_lossy().to_string());
    let mut args = pre.clone();
    args.push("--version".into());
    match proc::capture(&prog, &args, 20).await {
        Ok(out) if out.ok() => {
            st.installed = true;
            st.version = first_line(&out.stdout).replace("codex-cli ", "");
        }
        Ok(out) => st.detail = out.tail(3),
        Err(e) => st.detail = e.to_string(),
    }
    if st.installed {
        let mut args = pre;
        args.extend(["login".into(), "status".into()]);
        if let Ok(out) = proc::capture(&prog, &args, 30).await {
            st.logged_in = Some(out.ok());
            st.account = first_line(&format!("{}\n{}", out.stdout, out.stderr));
        }
        st.detail = if st.logged_in == Some(true) { "Ready".into() } else { "Not signed in".into() };
    }
    st
}

async fn version_of(path: &Path, args: &[&str]) -> String {
    match proc::capture(path, args, 20).await {
        Ok(out) => first_line(&format!("{}\n{}", out.stdout, out.stderr)),
        Err(_) => String::new(),
    }
}

pub async fn all_status() -> Vec<ToolStatus> {
    let s = settings::get();
    let (claude, codex) = tokio::join!(claude_status(), codex_status());
    let mut list = vec![claude, codex];

    let mut ff = ToolStatus { id: "ffmpeg".into(), name: "FFmpeg".into(), required: true, can_install: true, ..Default::default() };
    if let (Some(p), Some(_)) = (ffmpeg_path(), ffprobe_path()) {
        ff.installed = true;
        ff.path = p.to_string_lossy().to_string();
        let v = version_of(&p, &["-version"]).await;
        ff.version = v.split_whitespace().nth(2).unwrap_or("").to_string();
        ff.detail = "Ready".into();
    } else {
        ff.detail = "Needed for audio, analysis and rendering".into();
    }
    list.push(ff);

    let mut wh = ToolStatus { id: "whisper".into(), name: "whisper.cpp (CPU)".into(), required: true, can_install: true, ..Default::default() };
    if let Some(p) = whisper_path_for(false).or_else(|| on_path("whisper-cli")) {
        wh.installed = true;
        wh.path = p.to_string_lossy().to_string();
        wh.version = WHISPER_VERSION.into();
        wh.detail = "Ready".into();
    } else {
        wh.detail = "Speech-to-text with word timestamps".into();
    }
    list.push(wh);

    let mut whg = ToolStatus { id: "whisper-gpu".into(), name: "whisper.cpp (NVIDIA GPU)".into(), can_install: true, ..Default::default() };
    if let Some(p) = whisper_path_for(true) {
        whg.installed = true;
        whg.path = p.to_string_lossy().to_string();
        whg.version = WHISPER_VERSION.into();
        whg.detail = if s.whisper_gpu { "Ready · in use".into() } else { "Installed · enable in Transcription".into() };
    } else {
        whg.detail = "Optional · ~670 MB · much faster on NVIDIA cards".into();
    }
    list.push(whg);

    let model = model_path(&s.whisper_model);
    let info = whisper_models().into_iter().find(|m| m.id == s.whisper_model);
    list.push(ToolStatus {
        id: "model".into(),
        name: format!("Whisper model · {}", info.as_ref().map(|m| m.label.as_str()).unwrap_or(&s.whisper_model)),
        installed: model.exists(),
        path: model.to_string_lossy().to_string(),
        detail: if model.exists() {
            "Ready".into()
        } else {
            format!("Download ~{} MB", info.map(|m| m.size_mb).unwrap_or(0))
        },
        required: true,
        can_install: true,
        ..Default::default()
    });

    let mut yt = ToolStatus { id: "ytdlp".into(), name: "yt-dlp".into(), can_install: true, ..Default::default() };
    if let Some(p) = ytdlp_path() {
        yt.installed = true;
        yt.path = p.to_string_lossy().to_string();
        yt.version = version_of(&p, &["--version"]).await;
        yt.detail = "Ready".into();
    } else {
        yt.detail = "Optional · lets you use YouTube links as references".into();
    }
    list.push(yt);

    let mut rv = ToolStatus { id: "resolve".into(), name: "DaVinci Resolve".into(), ..Default::default() };
    let found = tokio::task::spawn_blocking(|| (resolve_exe(), resolve_version())).await.unwrap_or((None, String::new()));
    if let (Some(p), version) = found {
        rv.installed = true;
        rv.path = p.to_string_lossy().to_string();
        rv.version = version;
        rv.detail = "Ready · Send to Resolve imports timelines".into();
    } else {
        rv.detail = "Not found · set the path in Settings, FCPXML export still works".into();
    }
    list.push(rv);
    list
}

// ---------------------------------------------------------------- codex models

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineModel {
    pub id: String,
    pub label: String,
    pub efforts: Vec<String>,
    pub default_effort: String,
}

fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".codex"))
}

pub fn codex_models() -> Vec<EngineModel> {
    let path = codex_home().join("models_cache.json");
    let Ok(v) = util::read_json::<serde_json::Value>(&path) else { return vec![] };
    let mut models: Vec<(i64, EngineModel)> = v["models"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|m| m["visibility"].as_str() == Some("list"))
        .map(|m| {
            let efforts = m["supported_reasoning_levels"]
                .as_array()
                .map(|a| a.iter().filter_map(|e| e["effort"].as_str().map(String::from)).collect())
                .unwrap_or_default();
            (
                m["priority"].as_i64().unwrap_or(99),
                EngineModel {
                    id: m["slug"].as_str().unwrap_or("").into(),
                    label: m["display_name"].as_str().or(m["slug"].as_str()).unwrap_or("").into(),
                    efforts,
                    default_effort: m["default_reasoning_level"].as_str().unwrap_or("medium").into(),
                },
            )
        })
        .filter(|(_, m)| !m.id.is_empty())
        .collect();
    models.sort_by_key(|(p, _)| *p);
    models.into_iter().map(|(_, m)| m).collect()
}

pub fn claude_models() -> Vec<EngineModel> {
    let efforts: Vec<String> = ["low", "medium", "high", "xhigh", "max"].iter().map(|s| s.to_string()).collect();
    let m = |id: &str, label: &str| EngineModel {
        id: id.into(),
        label: label.into(),
        efforts: efforts.clone(),
        default_effort: "medium".into(),
    };
    vec![
        m("sonnet", "Sonnet (latest) · balanced"),
        m("opus", "Opus (latest) · strongest"),
        m("fable", "Fable (latest) · frontier"),
        m("haiku", "Haiku (latest) · fastest"),
    ]
}

// ---------------------------------------------------------------- install

pub type Progress<'a> = &'a (dyn Fn(f64, &str) + Send + Sync);

async fn download(url: &str, dest: &Path, label: &str, progress: Progress<'_>) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("CutPilot/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let resp = client.get(url).send().await?.error_for_status().with_context(|| format!("downloading {url}"))?;
    let total = resp.content_length().unwrap_or(0);
    let part = dest.with_extension("part");
    let mut file = std::fs::File::create(&part)?;
    let mut got: u64 = 0;
    let mut last = std::time::Instant::now();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk)?;
        got += chunk.len() as u64;
        if last.elapsed().as_millis() > 250 {
            last = std::time::Instant::now();
            let frac = if total > 0 { got as f64 / total as f64 } else { 0.0 };
            progress(frac * 0.9, &format!("{label}: {:.0} / {:.0} MB", got as f64 / 1e6, total as f64 / 1e6));
        }
    }
    file.flush()?;
    drop(file);
    if total > 0 && got < total {
        bail!("download of {label} was interrupted");
    }
    std::fs::rename(&part, dest)?;
    Ok(())
}

/// Extracts zip entries whose file name passes `keep` into `dest` (flattened).
fn extract_flat(zip_path: &Path, dest: &Path, keep: impl Fn(&str) -> bool) -> Result<usize> {
    std::fs::create_dir_all(dest)?;
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut n = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().replace('\\', "/");
        let base = name.rsplit('/').next().unwrap_or(&name).to_string();
        if base.is_empty() || !keep(&base) {
            continue;
        }
        let mut out = std::fs::File::create(dest.join(&base))?;
        std::io::copy(&mut entry, &mut out)?;
        n += 1;
    }
    Ok(n)
}

pub async fn install(id: &str, progress: Progress<'_>) -> Result<String> {
    let tmp = util::cache_dir().join("downloads");
    std::fs::create_dir_all(&tmp)?;
    match id {
        "ffmpeg" => {
            let zip = tmp.join("ffmpeg.zip");
            let mut last_err = None;
            for url in FFMPEG_URLS {
                match download(url, &zip, "FFmpeg", progress).await {
                    Ok(()) => {
                        last_err = None;
                        break;
                    }
                    Err(e) => last_err = Some(e),
                }
            }
            if let Some(e) = last_err {
                return Err(e);
            }
            progress(0.95, "Extracting FFmpeg…");
            let dest = util::tools_dir().join("ffmpeg");
            let n = extract_flat(&zip, &dest, |n| n == "ffmpeg.exe" || n == "ffprobe.exe")?;
            let _ = std::fs::remove_file(&zip);
            if n < 2 {
                bail!("the FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe");
            }
            Ok("FFmpeg installed".into())
        }
        "whisper" | "whisper-gpu" => {
            let gpu = id == "whisper-gpu";
            let asset = if gpu { "whisper-cublas-12.4.0-bin-x64.zip" } else { "whisper-blas-bin-x64.zip" };
            let url = format!("https://github.com/ggml-org/whisper.cpp/releases/download/{WHISPER_VERSION}/{asset}");
            let zip = tmp.join(asset);
            download(&url, &zip, "whisper.cpp", progress).await?;
            progress(0.95, "Extracting whisper.cpp…");
            let dest = whisper_dir(gpu);
            extract_flat(&zip, &dest, |n| n.ends_with(".dll") || n == "whisper-cli.exe")?;
            let _ = std::fs::remove_file(&zip);
            if !dest.join("whisper-cli.exe").exists() {
                bail!("the whisper.cpp archive did not contain whisper-cli.exe");
            }
            if gpu {
                let mut s = settings::get();
                s.whisper_gpu = true;
                settings::save(s)?;
            }
            Ok("whisper.cpp installed".into())
        }
        "model" => {
            let name = settings::get().whisper_model;
            install_model(&name, progress).await
        }
        "ytdlp" => {
            download(YTDLP_URL, &util::tools_dir().join("yt-dlp.exe"), "yt-dlp", progress).await?;
            Ok("yt-dlp installed".into())
        }
        "claude" => {
            proc::open_terminal("Install Claude Code", "irm https://claude.ai/install.ps1 | iex; Write-Host ''; Write-Host 'Done. Now run: claude auth login' -ForegroundColor Green")?;
            Ok("Installer opened in a terminal window".into())
        }
        "codex" => {
            if on_path("npm").is_none() {
                bail!("Codex is installed with npm. Install Node.js LTS from nodejs.org first, then try again.");
            }
            proc::open_terminal("Install Codex CLI", "npm install -g @openai/codex; Write-Host ''; Write-Host 'Done. Now run: codex login' -ForegroundColor Green")?;
            Ok("Installer opened in a terminal window".into())
        }
        other => bail!("unknown tool {other}"),
    }
}

pub async fn install_model(name: &str, progress: Progress<'_>) -> Result<String> {
    if !whisper_models().iter().any(|m| m.id == name) {
        bail!("unknown whisper model {name}");
    }
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{name}.bin");
    download(&url, &model_path(name), &format!("Whisper {name}"), progress).await?;
    Ok(format!("Whisper model {name} installed"))
}

pub fn login(engine: &str) -> Result<()> {
    match engine {
        "claude" => {
            let exe = claude_path().ok_or_else(|| anyhow!("Claude Code is not installed"))?;
            proc::open_terminal("Sign in to Claude", &format!("& '{}' auth login", exe.display()))
        }
        "codex" => proc::open_terminal("Sign in to Codex", "codex login"),
        other => bail!("unknown engine {other}"),
    }
}
