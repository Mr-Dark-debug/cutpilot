use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::util;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EngineSettings {
    /// "claude" or "codex"
    pub provider: String,
    pub claude_model: String,
    pub claude_effort: String,
    pub codex_model: String,
    pub codex_effort: String,
}

impl Default for EngineSettings {
    fn default() -> Self {
        Self {
            provider: "claude".into(),
            claude_model: "sonnet".into(),
            claude_effort: "medium".into(),
            codex_model: String::new(),
            codex_effort: "medium".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub projects_dir: String,
    pub engine: EngineSettings,
    /// whisper model name, e.g. "base", "small", "medium", "large-v3-turbo"
    pub whisper_model: String,
    /// "auto" or ISO code
    pub language: String,
    /// Use the NVIDIA (CUDA) build of whisper.cpp when installed.
    pub whisper_gpu: bool,
    pub pexels_key: String,
    pub pixabay_key: String,
    /// "auto" | "pexels" | "pixabay" | "none"
    pub stock_provider: String,
    pub library_folders: Vec<String>,
    /// Parallel AI jobs.
    pub llm_concurrency: usize,
    /// Parallel transcription / analysis jobs.
    pub media_concurrency: usize,
    /// Send contact sheets (frames) to the engine.
    pub use_frames: bool,
    pub default_style_id: String,
    /// "system" | "light" | "dark"
    pub theme: String,
    pub auto_check_updates: bool,
    /// Burn captions into renders by default.
    pub burn_captions: bool,
    /// Switch to the other signed-in engine when one runs out of usage.
    pub engine_fallback: bool,
    /// Resolve.exe chosen by the user (empty = detect automatically).
    pub resolve_path: String,
    /// Starred models in the model picker, as "provider:model".
    pub favorite_models: Vec<String>,
    pub onboarded: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            projects_dir: util::default_projects_dir().to_string_lossy().to_string(),
            engine: EngineSettings::default(),
            whisper_model: "base".into(),
            language: "auto".into(),
            whisper_gpu: false,
            pexels_key: String::new(),
            pixabay_key: String::new(),
            stock_provider: "auto".into(),
            library_folders: vec![],
            llm_concurrency: 2,
            media_concurrency: 1,
            use_frames: true,
            default_style_id: "talking-head".into(),
            theme: "system".into(),
            auto_check_updates: true,
            burn_captions: false,
            engine_fallback: true,
            resolve_path: String::new(),
            favorite_models: vec![],
            onboarded: false,
        }
    }
}

fn settings_path() -> PathBuf {
    util::app_data_dir().join("settings.json")
}

fn store() -> &'static Mutex<Settings> {
    static STORE: OnceLock<Mutex<Settings>> = OnceLock::new();
    STORE.get_or_init(|| {
        let s = util::read_json::<Settings>(&settings_path()).unwrap_or_default();
        Mutex::new(s)
    })
}

pub fn get() -> Settings {
    store().lock().unwrap().clone()
}

pub fn save(new: Settings) -> anyhow::Result<Settings> {
    let mut new = new;
    if new.projects_dir.trim().is_empty() {
        new.projects_dir = util::default_projects_dir().to_string_lossy().to_string();
    }
    new.llm_concurrency = new.llm_concurrency.clamp(1, 8);
    new.media_concurrency = new.media_concurrency.clamp(1, 4);
    util::write_json(&settings_path(), &new)?;
    *store().lock().unwrap() = new.clone();
    Ok(new)
}

pub fn projects_dir() -> PathBuf {
    PathBuf::from(get().projects_dir)
}
