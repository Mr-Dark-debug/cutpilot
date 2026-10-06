//! B-roll: the user's own library (indexed + AI-tagged) and stock search
//! (Pexels / Pixabay, with the user's free API keys).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::edit::{Asset, Edit};
use crate::{media, settings, util};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryItem {
    pub id: String,
    pub path: String,
    pub name: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub thumb: String,
    pub description: String,
    pub tags: Vec<String>,
    pub is_image: bool,
    pub modified: u64,
}

fn library_path() -> PathBuf {
    util::app_data_dir().join("library.json")
}

pub fn library() -> Vec<LibraryItem> {
    util::read_json(&library_path()).unwrap_or_default()
}

pub fn save_library(items: &[LibraryItem]) -> Result<()> {
    util::write_json(&library_path(), &items)
}

fn stable_id(path: &str) -> String {
    // FNV-1a – stable across runs, short.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in path.to_lowercase().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("L{:06x}", h & 0xffffff)
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 6 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out, depth + 1);
        } else if util::is_video_ext(&p) || util::is_image_ext(&p) {
            out.push(p);
        }
    }
}

/// Rescans library folders: adds new files, drops missing ones, keeps descriptions.
pub async fn scan_library(cancel: &CancellationToken, progress: &(dyn Fn(f64, &str) + Send + Sync)) -> Result<Vec<LibraryItem>> {
    let folders = settings::get().library_folders;
    let mut files = vec![];
    for f in &folders {
        walk(Path::new(f), &mut files, 0);
    }
    let old = library();
    let mut out = vec![];
    let thumbs = util::app_data_dir().join("thumbs");
    let total = files.len().max(1);
    for (i, f) in files.iter().enumerate() {
        if cancel.is_cancelled() {
            bail!("cancelled");
        }
        let path = f.to_string_lossy().to_string();
        let modified = std::fs::metadata(f)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if let Some(prev) = old.iter().find(|o| o.path == path && o.modified == modified && Path::new(&o.thumb).exists()) {
            out.push(prev.clone());
            continue;
        }
        progress(i as f64 / total as f64, &format!("Indexing {}", util::file_stem(&path)));
        let Ok(info) = media::probe(f).await else { continue };
        if !info.has_video {
            continue;
        }
        let id = stable_id(&path);
        let thumb = thumbs.join(format!("{id}.jpg"));
        let is_image = util::is_image_ext(f) || info.is_image();
        if media::thumbnail(f, if is_image { 0.0 } else { info.duration * 0.4 }, &thumb, 480).await.is_err() {
            continue;
        }
        let keep = old.iter().find(|o| o.path == path);
        out.push(LibraryItem {
            id,
            name: util::file_stem(&path),
            path,
            duration: if is_image { 5.0 } else { info.duration },
            width: info.width,
            height: info.height,
            thumb: thumb.to_string_lossy().to_string(),
            description: keep.map(|k| k.description.clone()).unwrap_or_default(),
            tags: keep.map(|k| k.tags.clone()).unwrap_or_default(),
            is_image,
            modified,
        });
    }
    save_library(&out)?;
    Ok(out)
}

pub fn asset_from_library(item: &LibraryItem) -> Asset {
    Asset {
        kind: "library".into(),
        id: item.id.clone(),
        path: item.path.clone(),
        thumb: item.thumb.clone(),
        duration: item.duration,
        width: item.width,
        height: item.height,
        credit: String::new(),
        url: String::new(),
        is_image: item.is_image,
    }
}

// ------------------------------------------------------------------ stock

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StockClip {
    pub provider: String,
    pub id: String,
    pub download: String,
    pub thumb: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub credit: String,
    pub page: String,
}

pub fn stock_provider() -> Option<String> {
    let s = settings::get();
    let has_pexels = !s.pexels_key.trim().is_empty();
    let has_pixabay = !s.pixabay_key.trim().is_empty();
    match s.stock_provider.as_str() {
        "none" => None,
        "pexels" if has_pexels => Some("pexels".into()),
        "pixabay" if has_pixabay => Some("pixabay".into()),
        _ if has_pexels => Some("pexels".into()),
        _ if has_pixabay => Some("pixabay".into()),
        _ => None,
    }
}

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("CutPilot/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(60))
        .build()?)
}

pub async fn search_stock(provider: &str, query: &str, vertical: bool) -> Result<Vec<StockClip>> {
    let s = settings::get();
    let q = urlencoding::encode(query.trim());
    let orientation = if vertical { "portrait" } else { "landscape" };
    match provider {
        "pexels" => {
            if s.pexels_key.trim().is_empty() {
                bail!("add a Pexels API key in Settings ▸ B-roll");
            }
            let url = format!("https://api.pexels.com/videos/search?query={q}&per_page=12&orientation={orientation}&size=medium");
            let v: serde_json::Value = client()?
                .get(&url)
                .header("Authorization", s.pexels_key.trim())
                .send()
                .await?
                .error_for_status()
                .context("Pexels search failed (check the API key)")?
                .json()
                .await?;
            let mut out = vec![];
            for vid in v["videos"].as_array().cloned().unwrap_or_default() {
                // Pick the file closest to 1920 wide (or 1080 for vertical), never above 4K.
                let target = if vertical { 1080 } else { 1920 };
                let best = vid["video_files"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|f| f["file_type"].as_str() == Some("video/mp4"))
                    .filter(|f| f["width"].as_u64().unwrap_or(0) > 0)
                    .min_by_key(|f| (f["width"].as_i64().unwrap_or(0) - target).abs());
                let Some(f) = best else { continue };
                out.push(StockClip {
                    provider: "pexels".into(),
                    id: vid["id"].to_string(),
                    download: f["link"].as_str().unwrap_or("").into(),
                    thumb: vid["image"].as_str().unwrap_or("").into(),
                    duration: vid["duration"].as_f64().unwrap_or(0.0),
                    width: f["width"].as_u64().unwrap_or(0) as u32,
                    height: f["height"].as_u64().unwrap_or(0) as u32,
                    credit: format!("{} on Pexels", vid["user"]["name"].as_str().unwrap_or("Unknown")),
                    page: vid["url"].as_str().unwrap_or("").into(),
                });
            }
            Ok(out)
        }
        "pixabay" => {
            if s.pixabay_key.trim().is_empty() {
                bail!("add a Pixabay API key in Settings ▸ B-roll");
            }
            let key = urlencoding::encode(s.pixabay_key.trim());
            let url = format!("https://pixabay.com/api/videos/?key={key}&q={q}&per_page=12&safesearch=true");
            let v: serde_json::Value = client()?
                .get(&url)
                .send()
                .await?
                .error_for_status()
                .context("Pixabay search failed (check the API key)")?
                .json()
                .await?;
            let mut out = vec![];
            for hit in v["hits"].as_array().cloned().unwrap_or_default() {
                let vids = &hit["videos"];
                let f = ["large", "medium", "small"]
                    .iter()
                    .map(|k| &vids[*k])
                    .find(|f| f["url"].as_str().map(|u| !u.is_empty()).unwrap_or(false) && f["width"].as_u64().unwrap_or(0) <= 1920);
                let Some(f) = f else { continue };
                let (w, h) = (f["width"].as_u64().unwrap_or(0) as u32, f["height"].as_u64().unwrap_or(0) as u32);
                if vertical != (h > w) && w > 0 {
                    continue;
                }
                out.push(StockClip {
                    provider: "pixabay".into(),
                    id: hit["id"].to_string(),
                    download: f["url"].as_str().unwrap_or("").into(),
                    thumb: f["thumbnail"].as_str().unwrap_or("").into(),
                    duration: hit["duration"].as_f64().unwrap_or(0.0),
                    width: w,
                    height: h,
                    credit: format!("{} on Pixabay", hit["user"].as_str().unwrap_or("Unknown")),
                    page: hit["pageURL"].as_str().unwrap_or("").into(),
                });
            }
            Ok(out)
        }
        other => bail!("unknown stock provider {other}"),
    }
}

/// Downloads a stock clip into the project's broll folder (cached by id).
pub async fn download_stock(clip: &StockClip, broll_dir: &Path) -> Result<Asset> {
    std::fs::create_dir_all(broll_dir)?;
    let file = broll_dir.join(format!("{}-{}.mp4", clip.provider, clip.id.trim_matches('"')));
    if !file.exists() {
        let bytes = client()?
            .get(&clip.download)
            .timeout(std::time::Duration::from_secs(600))
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;
        let part = file.with_extension("part");
        std::fs::write(&part, &bytes)?;
        std::fs::rename(&part, &file)?;
    }
    let info = media::probe(&file).await?;
    let thumb = file.with_extension("jpg");
    if !thumb.exists() {
        media::thumbnail(&file, info.duration * 0.4, &thumb, 480).await?;
    }
    Ok(Asset {
        kind: clip.provider.clone(),
        id: clip.id.clone(),
        path: file.to_string_lossy().to_string(),
        thumb: thumb.to_string_lossy().to_string(),
        duration: info.duration,
        width: info.width,
        height: info.height,
        credit: clip.credit.clone(),
        url: clip.page.clone(),
        is_image: false,
    })
}

/// Uses a local file as a B-roll asset.
pub async fn asset_from_file(path: &Path, broll_dir: &Path) -> Result<Asset> {
    let info = media::probe(path).await?;
    std::fs::create_dir_all(broll_dir)?;
    let thumb = broll_dir.join(format!("file-{}.jpg", stable_id(&path.to_string_lossy())));
    let is_image = util::is_image_ext(path) || info.is_image();
    media::thumbnail(path, if is_image { 0.0 } else { info.duration * 0.4 }, &thumb, 480).await?;
    Ok(Asset {
        kind: "file".into(),
        id: stable_id(&path.to_string_lossy()),
        path: path.to_string_lossy().to_string(),
        thumb: thumb.to_string_lossy().to_string(),
        duration: if is_image { 5.0 } else { info.duration },
        width: info.width,
        height: info.height,
        is_image,
        ..Default::default()
    })
}

/// Fills every enabled B-roll slot that has no asset yet. Returns (filled, still empty).
pub async fn fill(
    edit: &mut Edit,
    broll_dir: &Path,
    vertical: bool,
    cancel: &CancellationToken,
    progress: &(dyn Fn(f64, &str) + Send + Sync),
) -> Result<(usize, usize)> {
    let lib = library();
    let provider = stock_provider();
    let mut used: HashSet<String> = edit.broll.iter().filter_map(|b| b.asset.as_ref().map(|a| a.id.clone())).collect();
    let total = edit.broll.len().max(1);
    let (mut filled, mut empty) = (0, 0);
    for i in 0..edit.broll.len() {
        if cancel.is_cancelled() {
            bail!("cancelled");
        }
        let b = &edit.broll[i];
        if !b.enabled || b.asset.as_ref().map(|a| Path::new(&a.path).exists()).unwrap_or(false) {
            continue;
        }
        progress(i as f64 / total as f64, &format!("B-roll: {}", b.query));
        if let Some(item) = b.library.as_ref().and_then(|id| lib.iter().find(|l| &l.id == id)) {
            used.insert(item.id.clone());
            edit.broll[i].asset = Some(asset_from_library(item));
            filled += 1;
            continue;
        }
        let Some(provider) = provider.as_deref() else {
            empty += 1;
            continue;
        };
        let need = b.duration;
        let query = b.query.clone();
        match search_stock(provider, &query, vertical).await {
            Ok(mut results) => {
                results.retain(|r| !used.contains(&r.id));
                // Prefer clips long enough for the slot, then the first (most relevant) result.
                results.sort_by_key(|r| if r.duration + 0.01 >= need { 0 } else { 1 });
                let mut done = false;
                for r in results.into_iter().take(3) {
                    match download_stock(&r, broll_dir).await {
                        Ok(asset) => {
                            used.insert(r.id.clone());
                            edit.broll[i].asset = Some(asset);
                            filled += 1;
                            done = true;
                            break;
                        }
                        Err(e) => progress(i as f64 / total as f64, &format!("Download failed ({e}), trying another clip")),
                    }
                }
                if !done {
                    empty += 1;
                }
            }
            Err(e) => {
                progress(i as f64 / total as f64, &format!("Stock search failed for \"{query}\": {e}"));
                empty += 1;
            }
        }
    }
    Ok((filled, empty))
}

pub fn find_library_item(id: &str) -> Result<LibraryItem> {
    library().into_iter().find(|l| l.id == id).ok_or_else(|| anyhow!("library clip {id} not found"))
}
