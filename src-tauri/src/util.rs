use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{de::DeserializeOwned, Serialize};

pub const APP_DIR_NAME: &str = "CutPilot";
pub const APP_ID: &str = "com.mrdarkdebug.cutpilot";

/// `%LOCALAPPDATA%\com.mrdarkdebug.cutpilot` – tools, models, styles, library index,
/// settings. (The installer puts the program itself in `%LOCALAPPDATA%\CutPilot`.)
pub fn app_data_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir);
    base.join(APP_ID)
}

/// 1.0.0 kept its data next to the installed program; move it to the data folder once.
pub fn migrate_legacy_data() {
    let Some(base) = dirs::data_local_dir() else { return };
    let old = base.join(APP_DIR_NAME);
    let new = app_data_dir();
    let items = ["settings.json", "library.json", "tools", "models", "styles", "cache", "thumbs"];
    if !items.iter().any(|i| old.join(i).exists()) {
        return;
    }
    let _ = std::fs::create_dir_all(&new);
    for i in items {
        let (from, to) = (old.join(i), new.join(i));
        if from.exists() && !to.exists() {
            let _ = std::fs::rename(&from, &to);
        }
    }
    // Stored absolute paths (library thumbnails, reference thumbnails) point at the old folder.
    let (o, n) = (old.to_string_lossy().to_string(), new.to_string_lossy().to_string());
    let (oj, nj) = (o.replace('\\', "\\\\"), n.replace('\\', "\\\\"));
    let mut files = vec![new.join("library.json")];
    if let Ok(rd) = std::fs::read_dir(new.join("styles")) {
        files.extend(rd.flatten().map(|e| e.path()).filter(|p| p.extension().map(|x| x == "json").unwrap_or(false)));
    }
    for f in files {
        if let Ok(text) = std::fs::read_to_string(&f) {
            if text.contains(&oj) {
                let _ = std::fs::write(&f, text.replace(&oj, &nj));
            }
        }
    }
}

pub fn tools_dir() -> PathBuf {
    app_data_dir().join("tools")
}

pub fn models_dir() -> PathBuf {
    app_data_dir().join("models")
}

pub fn styles_dir() -> PathBuf {
    app_data_dir().join("styles")
}

pub fn cache_dir() -> PathBuf {
    app_data_dir().join("cache")
}

pub fn default_projects_dir() -> PathBuf {
    dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_DIR_NAME)
        .join("Projects")
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
}

/// Writes JSON atomically (temp file + rename) so a crash never leaves half a file.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(&tmp, path).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in name.chars() {
        if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
        if out.len() >= 40 {
            break;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "video".into()
    } else {
        out
    }
}

/// File name without extension, for display.
pub fn file_stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// `mm:ss.cc` (or `h:mm:ss.cc`) for prompts and logs.
pub fn fmt_time(t: f64) -> String {
    let t = t.max(0.0);
    let h = (t / 3600.0).floor() as u64;
    let m = ((t % 3600.0) / 60.0).floor() as u64;
    let s = t % 60.0;
    if h > 0 {
        format!("{h}:{m:02}:{s:05.2}")
    } else {
        format!("{m:02}:{s:05.2}")
    }
}

pub fn is_video_ext(path: &Path) -> bool {
    matches!(
        path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref(),
        Some("mp4" | "mov" | "mkv" | "m4v" | "avi" | "webm" | "mts" | "m2ts" | "mxf" | "wmv" | "3gp")
    )
}

pub fn is_image_ext(path: &Path) -> bool {
    matches!(
        path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref(),
        Some("jpg" | "jpeg" | "png" | "webp" | "bmp")
    )
}

pub fn is_audio_ext(path: &Path) -> bool {
    matches!(
        path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref(),
        Some("mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" | "opus")
    )
}

/// Truncates text for prompts, keeping it on a char boundary.
pub fn clip_text(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}
