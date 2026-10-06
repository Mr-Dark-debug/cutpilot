//! Projects on disk: `<projects_dir>/<slug>-<id>/project.json` plus work/, edits/,
//! broll/ and exports/ folders. Source media is referenced in place, never copied.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};

use crate::media::MediaInfo;
use crate::style::RefAnalysis;
use crate::transcribe::Utterance;
use crate::{settings, util};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Source {
    pub id: String,
    pub path: String,
    pub name: String,
    pub info: Option<MediaInfo>,
    /// Playback proxy (only when the original can't play in the app).
    pub proxy: Option<String>,
    pub thumb: Option<String>,
    pub analyzed: bool,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Reference {
    pub id: String,
    /// File path or URL as given by the user.
    pub input: String,
    pub name: String,
    pub analysis: Option<RefAnalysis>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineChoice {
    pub provider: String,
    pub model: String,
    pub effort: String,
}

impl Default for EngineChoice {
    fn default() -> Self {
        let s = settings::get().engine;
        if s.provider == "codex" {
            Self { provider: "codex".into(), model: s.codex_model, effort: s.codex_effort }
        } else {
            Self { provider: "claude".into(), model: s.claude_model, effort: s.claude_effort }
        }
    }
}

impl EngineChoice {
    pub fn label(&self) -> String {
        let name = if self.provider == "codex" { "Codex" } else { "Claude" };
        if self.model.is_empty() {
            name.into()
        } else {
            format!("{name} · {}", self.model)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Status {
    /// new | queued | running | ready | error | cancelled
    pub state: String,
    pub stage: String,
    pub progress: f64,
    pub message: String,
    pub job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EditMeta {
    pub version: u32,
    pub created: String,
    /// ai | revision | manual
    pub kind: String,
    pub note: String,
    pub engine: String,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportItem {
    pub kind: String,
    pub path: String,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatMessage {
    /// user | assistant
    pub role: String,
    pub text: String,
    pub created: String,
    pub version: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created: String,
    pub updated: String,
    #[serde(skip_deserializing)]
    pub dir: String,
    pub sources: Vec<Source>,
    pub references: Vec<Reference>,
    pub brief: String,
    pub style_id: String,
    pub engine: EngineChoice,
    pub music: Option<String>,
    /// "16:9" or "9:16"
    pub aspect: String,
    pub status: Status,
    pub current_edit: Option<u32>,
    pub edits: Vec<EditMeta>,
    pub exports: Vec<ExportItem>,
    pub chat: Vec<ChatMessage>,
    pub batch_id: Option<String>,
}

impl Project {
    pub fn dir(&self) -> PathBuf {
        PathBuf::from(&self.dir)
    }
    pub fn work_dir(&self, source_id: &str) -> PathBuf {
        self.dir().join("work").join(source_id)
    }
    pub fn ref_dir(&self, ref_id: &str) -> PathBuf {
        self.dir().join("refs").join(ref_id)
    }
    pub fn edits_dir(&self) -> PathBuf {
        self.dir().join("edits")
    }
    pub fn exports_dir(&self) -> PathBuf {
        self.dir().join("exports")
    }
    pub fn broll_dir(&self) -> PathBuf {
        self.dir().join("broll")
    }
    pub fn source(&self, id: &str) -> Option<&Source> {
        self.sources.iter().find(|s| s.id == id)
    }
    pub fn next_source_id(&self) -> String {
        let n = self.sources.iter().filter_map(|s| s.id.trim_start_matches('A').parse::<u32>().ok()).max().unwrap_or(0);
        format!("A{}", n + 1)
    }
    pub fn next_ref_id(&self) -> String {
        let n = self.references.iter().filter_map(|s| s.id.trim_start_matches('R').parse::<u32>().ok()).max().unwrap_or(0);
        format!("R{}", n + 1)
    }
    pub fn next_edit_version(&self) -> u32 {
        self.edits.iter().map(|e| e.version).max().unwrap_or(0) + 1
    }
}

fn locks() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static L: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_for(id: &str) -> Arc<Mutex<()>> {
    locks().lock().unwrap().entry(id.to_string()).or_default().clone()
}

/// Map of project id → directory, rebuilt on each listing.
fn index() -> &'static Mutex<HashMap<String, PathBuf>> {
    static I: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
    I.get_or_init(|| Mutex::new(HashMap::new()))
}

fn load_from(dir: &Path) -> Result<Project> {
    let mut p: Project = util::read_json(&dir.join("project.json"))?;
    p.dir = dir.to_string_lossy().to_string();
    Ok(p)
}

pub fn list() -> Vec<Project> {
    let root = settings::projects_dir();
    let mut out = vec![];
    let mut idx = HashMap::new();
    if let Ok(rd) = std::fs::read_dir(&root) {
        for entry in rd.flatten() {
            let dir = entry.path();
            if dir.join("project.json").exists() {
                if let Ok(p) = load_from(&dir) {
                    idx.insert(p.id.clone(), dir.clone());
                    out.push(p);
                }
            }
        }
    }
    *index().lock().unwrap() = idx;
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    out
}

fn dir_of(id: &str) -> Result<PathBuf> {
    if let Some(d) = index().lock().unwrap().get(id).cloned() {
        if d.join("project.json").exists() {
            return Ok(d);
        }
    }
    list();
    index().lock().unwrap().get(id).cloned().ok_or_else(|| anyhow!("project {id} not found"))
}

pub fn get(id: &str) -> Result<Project> {
    let dir = dir_of(id)?;
    let lock = lock_for(id);
    let _g = lock.lock().unwrap();
    load_from(&dir)
}

/// Read-modify-write under the project's lock.
pub fn update<F: FnOnce(&mut Project) -> Result<()>>(id: &str, f: F) -> Result<Project> {
    let dir = dir_of(id)?;
    let lock = lock_for(id);
    let _g = lock.lock().unwrap();
    let mut p = load_from(&dir)?;
    f(&mut p)?;
    p.updated = util::now_iso();
    util::write_json(&dir.join("project.json"), &p)?;
    Ok(p)
}

pub struct NewProject {
    pub name: String,
    pub sources: Vec<String>,
    pub references: Vec<String>,
    pub brief: String,
    pub style_id: String,
    pub engine: Option<EngineChoice>,
    pub aspect: String,
    pub batch_id: Option<String>,
}

pub fn create(np: NewProject) -> Result<Project> {
    if np.sources.is_empty() {
        bail!("add at least one video");
    }
    for s in &np.sources {
        if !Path::new(s).exists() {
            bail!("file not found: {s}");
        }
    }
    let id = util::new_id();
    let name = if np.name.trim().is_empty() { util::file_stem(&np.sources[0]) } else { np.name.trim().to_string() };
    let root = settings::projects_dir();
    let dir = root.join(format!("{}-{}", util::slugify(&name), &id[..6]));
    std::fs::create_dir_all(&dir)?;
    let mut p = Project {
        id: id.clone(),
        name,
        created: util::now_iso(),
        updated: util::now_iso(),
        dir: dir.to_string_lossy().to_string(),
        brief: np.brief,
        style_id: if np.style_id.is_empty() { settings::get().default_style_id } else { np.style_id },
        engine: np.engine.unwrap_or_default(),
        aspect: if np.aspect.is_empty() { "16:9".into() } else { np.aspect },
        status: Status { state: "new".into(), ..Default::default() },
        batch_id: np.batch_id,
        ..Default::default()
    };
    for path in np.sources {
        let sid = p.next_source_id();
        p.sources.push(Source { id: sid, name: util::file_stem(&path), path, ..Default::default() });
    }
    for input in np.references {
        add_reference_to(&mut p, &input);
    }
    util::write_json(&dir.join("project.json"), &p)?;
    index().lock().unwrap().insert(id, dir);
    Ok(p)
}

pub fn add_reference_to(p: &mut Project, input: &str) {
    let input = input.trim();
    if input.is_empty() || p.references.iter().any(|r| r.input == input) {
        return;
    }
    let name = if input.starts_with("http") { input.to_string() } else { util::file_stem(input) };
    let id = p.next_ref_id();
    p.references.push(Reference { id, input: input.to_string(), name, ..Default::default() });
}

/// Moves the project folder to the Recycle Bin (source media is untouched).
pub fn delete(id: &str) -> Result<()> {
    let dir = dir_of(id)?;
    trash::delete(&dir).map_err(|e| anyhow!("could not move project to the Recycle Bin: {e}"))?;
    index().lock().unwrap().remove(id);
    Ok(())
}

// ------------------------------------------------------------ analysis files

pub fn read_utterances(p: &Project, source_id: &str) -> Vec<Utterance> {
    util::read_json(&p.work_dir(source_id).join("utterances.json")).unwrap_or_default()
}

/// All utterances across analyzed sources, renumbered globally (U1…Un) in source order.
pub fn all_utterances(p: &Project) -> Vec<Utterance> {
    let mut out = vec![];
    let mut n = 1;
    for s in &p.sources {
        for mut u in read_utterances(p, &s.id) {
            u.id = format!("U{n}");
            n += 1;
            out.push(u);
        }
    }
    out
}

pub fn read_words(p: &Project, source_id: &str) -> Vec<crate::transcribe::Word> {
    util::read_json(&p.work_dir(source_id).join("words.json")).unwrap_or_default()
}
