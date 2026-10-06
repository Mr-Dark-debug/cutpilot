//! DaVinci Resolve hand-off. Free Resolve doesn't allow external scripting, so
//! CutPilot installs a menu script (Workspace ▸ Scripts ▸ CutPilot Import) that
//! reads a hand-off file and imports the media, timeline and captions.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use serde::Serialize;

use crate::{tools, util};

const SCRIPT_NAME: &str = "CutPilot Import.lua";

const SCRIPT: &str = r#"-- CutPilot Import
-- Imports the timeline CutPilot last sent to Resolve (media, timeline, captions).
local handoffPath = os.getenv("LOCALAPPDATA") .. "\\com.mrdarkdebug.cutpilot\\resolve_handoff.lua"
local ok, h = pcall(dofile, handoffPath)
if not ok or type(h) ~= "table" then
  print("CutPilot: nothing to import yet. Click 'Send to Resolve' in CutPilot first.")
  return
end

local resolve = Resolve()
local pm = resolve:GetProjectManager()
local project = pm:GetCurrentProject()

local function isEmpty(p)
  if p == nil then return false end
  local clips = p:GetMediaPool():GetRootFolder():GetClipList()
  local n = 0
  for _ in pairs(clips or {}) do n = n + 1 end
  return p:GetTimelineCount() == 0 and n == 0
end

-- Frame rate can only be set on an empty project, so use a fresh one when needed.
if not isEmpty(project) then
  project = pm:CreateProject(h.projectName) or pm:CreateProject(h.projectName .. " " .. os.time())
end
if not project then
  print("CutPilot: could not create a project. Close the current project and try again.")
  return
end
project:SetSetting("timelineFrameRate", h.fps)
project:SetSetting("timelineResolutionWidth", h.width)
project:SetSetting("timelineResolutionHeight", h.height)

local mp = project:GetMediaPool()
local root = mp:GetRootFolder()
local bin = mp:AddSubFolder(root, h.bin) or root
mp:SetCurrentFolder(bin)
mp:ImportMedia(h.media)

local tl = mp:ImportTimelineFromFile(h.timeline, { timelineName = h.timelineName, importSourceClips = false, sourceClipsFolders = { bin } })
if not tl then
  tl = mp:ImportTimelineFromFile(h.timeline, { timelineName = h.timelineName })
end
if h.srt then mp:ImportMedia({ h.srt }) end

if tl then
  project:SetCurrentTimeline(tl)
  resolve:OpenPage("edit")
  print("CutPilot: imported '" .. h.timelineName .. "'. Captions (SRT) are in the '" .. h.bin .. "' bin – drag them onto the timeline.")
else
  print("CutPilot: timeline import failed. Use File > Import > Timeline and pick: " .. h.timeline)
end
"#;

fn script_dir() -> Option<PathBuf> {
    // Per-user scripts folder (no admin rights needed).
    Some(dirs::data_dir()?.join("Blackmagic Design").join("DaVinci Resolve").join("Support").join("Fusion").join("Scripts").join("Utility"))
}

pub fn install_script() -> Result<PathBuf> {
    let dir = script_dir().ok_or_else(|| anyhow!("can't find the Resolve scripts folder"))?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(SCRIPT_NAME);
    std::fs::write(&path, SCRIPT)?;
    Ok(path)
}

fn lua_str(s: &str) -> String {
    // Long-bracket strings need no escaping; pick a level that can't clash.
    let mut eq = String::new();
    while s.contains(&format!("]{eq}]")) {
        eq.push('=');
    }
    format!("[{eq}[{s}]{eq}]")
}

fn fps_setting(num: u32, den: u32) -> String {
    match (num, den) {
        (24000, 1001) => "23.976".into(),
        (30000, 1001) => "29.97".into(),
        (60000, 1001) => "59.94".into(),
        (n, 1) => n.to_string(),
        (n, d) => format!("{:.3}", n as f64 / d as f64),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub resolve_found: bool,
    pub launched: bool,
    pub script_path: String,
    pub timeline: String,
}

pub struct Handoff<'a> {
    pub project_name: &'a str,
    pub timeline_name: &'a str,
    pub timeline: &'a Path,
    pub srt: Option<&'a Path>,
    pub media: Vec<String>,
    pub fps: (u32, u32),
    pub size: (u32, u32),
}

fn resolve_running() -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq Resolve.exe", "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("Resolve.exe"))
        .unwrap_or(false)
}

pub fn send(h: Handoff) -> Result<SendResult> {
    let script = install_script()?;
    let media = h.media.iter().map(|m| lua_str(m)).collect::<Vec<_>>().join(", ");
    let lua = format!(
        "return {{\n  projectName = {},\n  timelineName = {},\n  bin = {},\n  timeline = {},\n  srt = {},\n  media = {{ {} }},\n  fps = \"{}\",\n  width = \"{}\",\n  height = \"{}\",\n}}\n",
        lua_str(h.project_name),
        lua_str(h.timeline_name),
        lua_str(&format!("CutPilot – {}", h.project_name)),
        lua_str(&h.timeline.to_string_lossy()),
        h.srt.map(|p| lua_str(&p.to_string_lossy())).unwrap_or_else(|| "nil".into()),
        media,
        fps_setting(h.fps.0, h.fps.1),
        h.size.0,
        h.size.1,
    );
    std::fs::create_dir_all(util::app_data_dir())?;
    std::fs::write(util::app_data_dir().join("resolve_handoff.lua"), lua)?;
    let exe = tools::resolve_exe();
    let mut launched = false;
    if let Some(exe) = &exe {
        if !resolve_running() {
            std::process::Command::new(exe).spawn()?;
            launched = true;
        }
    }
    Ok(SendResult {
        resolve_found: exe.is_some(),
        launched,
        script_path: script.to_string_lossy().to_string(),
        timeline: h.timeline.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lua_strings_never_break_out() {
        assert_eq!(lua_str(r"D:\a b\c.mp4"), r"[[D:\a b\c.mp4]]");
        assert_eq!(lua_str("x]]y"), "[=[x]]y]=]");
    }

    #[test]
    fn fps_names() {
        assert_eq!(fps_setting(30000, 1001), "29.97");
        assert_eq!(fps_setting(25, 1), "25");
    }
}
