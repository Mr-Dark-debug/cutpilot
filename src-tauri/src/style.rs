//! Editing styles: house rules (instructions), cut tightness, B-roll rhythm, and
//! optional analyzed reference videos.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::util;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RefMetrics {
    pub duration: f64,
    pub analyzed_seconds: f64,
    pub cuts: usize,
    pub cuts_per_min: f64,
    pub avg_shot: f64,
    pub median_shot: f64,
    pub words_per_min: f64,
    pub speech_ratio: f64,
    pub avg_pause: f64,
    pub long_pauses_per_min: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StyleSummary {
    pub summary: String,
    pub pacing: String,
    pub hook: String,
    pub broll: String,
    pub on_screen_text: String,
    pub rules: Vec<String>,
    pub pause_keep: f64,
}

pub fn style_summary_schema() -> serde_json::Value {
    serde_json::json!({
      "type": "object", "additionalProperties": false,
      "required": ["summary", "pacing", "hook", "broll", "on_screen_text", "rules", "pause_keep"],
      "properties": {
        "summary": {"type": "string"},
        "pacing": {"type": "string"},
        "hook": {"type": "string"},
        "broll": {"type": "string"},
        "on_screen_text": {"type": "string"},
        "rules": {"type": "array", "items": {"type": "string"}},
        "pause_keep": {"type": "number"}
      }
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RefAnalysis {
    pub name: String,
    pub input: String,
    pub analyzed: String,
    pub metrics: RefMetrics,
    pub style: StyleSummary,
    pub thumb: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Style {
    pub id: String,
    pub name: String,
    pub description: String,
    pub builtin: bool,
    /// Markdown house rules given to the AI editor.
    pub instructions: String,
    /// Pauses (s) inside kept speech that are left alone; longer ones are cut.
    pub pause_keep: f64,
    /// Suggested seconds between B-roll shots (0 = none).
    pub broll_every: f64,
    pub titles: bool,
    pub captions: bool,
    /// Target length in seconds (0 = whatever the content needs).
    pub target_length: f64,
    pub aspect: String,
    pub color: String,
    pub references: Vec<RefAnalysis>,
    pub updated: String,
}

fn preset(
    id: &str,
    name: &str,
    description: &str,
    color: &str,
    pause_keep: f64,
    broll_every: f64,
    target_length: f64,
    aspect: &str,
    instructions: &str,
) -> Style {
    Style {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        builtin: true,
        instructions: instructions.trim().into(),
        pause_keep,
        broll_every,
        titles: true,
        captions: aspect == "9:16",
        target_length,
        aspect: aspect.into(),
        color: color.into(),
        references: vec![],
        updated: String::new(),
    }
}

pub fn builtins() -> Vec<Style> {
    vec![
        preset(
            "talking-head",
            "Talking-head YouTube",
            "Tight jump cuts, retakes removed, B-roll every ~12 s",
            "violet",
            0.40,
            12.0,
            0.0,
            "16:9",
            r#"
- Open with the strongest, most specific line as a hook (first 5–10 s). Move it to the front only if it works out of context.
- Remove every retake and false start; keep the last complete take unless an earlier one is clearly better.
- Remove meta talk ("let me start again", "is this recording?"), dead air, filler-only bits and repeated points.
- Keep the speaker's personality: a short laugh or aside that adds warmth can stay.
- B-roll over long explanations, lists and anything the speaker describes visually. Never cover the hook or the call to action.
- On-screen titles only for key terms, numbers and section changes. Keep them under 6 words.
- End on the call to action; cut anything after it.
"#,
        ),
        preset(
            "medical-edu",
            "Doctor / dentist explainer",
            "Clear, accurate patient education with safe visuals",
            "blue",
            0.45,
            14.0,
            0.0,
            "16:9",
            r#"
- Accuracy first: never cut a sentence in a way that changes medical meaning, drops a caveat, or removes "consult your dentist/doctor" advice.
- Hook with the patient's problem or question (e.g. "Why do your gums bleed when you brush?").
- Remove retakes, stumbles, meta talk and dead air. Keep a calm, trustworthy pace – not hyper-fast.
- Use titles for key terms, numbers and steps (e.g. "2 minutes, twice a day").
- B-roll must be generic and non-graphic: toothbrushes, floss, a smiling patient, a clean clinic, a calendar. No surgery, blood, needles or anatomy close-ups. No brand names.
- Add chapters for each question or step.
- In notes, flag any statement that sounds medically questionable so a professional can check it.
"#,
        ),
        preset(
            "vlog",
            "Vlog / day in the life",
            "Natural pauses, atmosphere and story kept",
            "amber",
            0.80,
            8.0,
            0.0,
            "16:9",
            r#"
- Tell a story with a beginning, middle and end. Keep moments that show emotion or atmosphere.
- Cut boring logistics, repeated takes and long silences, but keep natural breathing room.
- Use the B-roll library generously for scene-setting and transitions between locations.
- Titles for places, times and chapters of the day.
"#,
        ),
        preset(
            "shorts",
            "Shorts / Reels",
            "Under 60 s, hook in 2 s, very tight, vertical",
            "pink",
            0.20,
            5.0,
            55.0,
            "9:16",
            r#"
- The whole edit must be under 60 seconds. Pick the single best idea and drop everything else.
- The first 2 seconds must hook: a bold claim, a question or a surprising fact.
- Cut every pause, breath and filler. No intros like "hi guys" or "welcome back".
- Callout titles for the key words (2–4 words each). End with a quick call to action or a loop back to the hook.
"#,
        ),
        preset(
            "tutorial",
            "Tutorial / how-to",
            "Every step kept and labelled, few distractions",
            "green",
            0.60,
            0.0,
            0.0,
            "16:9",
            r#"
- Never remove a step. Remove mistakes only when a corrected version exists.
- Title each step ("Step 1 – …") and add a chapter for each.
- Cut waiting time and silence, but keep pauses where the viewer needs to follow an action.
- B-roll only when it clarifies something; the main footage is usually the point.
"#,
        ),
        preset(
            "podcast",
            "Podcast / interview clip",
            "Conversational, answers kept whole",
            "slate",
            0.70,
            0.0,
            0.0,
            "16:9",
            r#"
- Keep questions and answers complete; never splice half-answers together.
- Remove crosstalk, false starts, technical interruptions and long silences.
- Lower thirds for each speaker's name the first time they speak (if known from the brief).
- Chapters for each topic.
"#,
        ),
    ]
}

fn user_style_path(id: &str) -> std::path::PathBuf {
    util::styles_dir().join(format!("{id}.json"))
}

pub fn list() -> Vec<Style> {
    let mut out = builtins();
    if let Ok(rd) = std::fs::read_dir(util::styles_dir()) {
        let mut user: Vec<Style> = rd
            .flatten()
            .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
            .filter_map(|e| util::read_json::<Style>(&e.path()).ok())
            .collect();
        user.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        for s in user {
            // A saved copy of a built-in overrides it in place.
            if let Some(slot) = out.iter_mut().find(|b| b.id == s.id) {
                *slot = Style { builtin: true, ..s };
            } else {
                out.push(Style { builtin: false, ..s });
            }
        }
    }
    out
}

pub fn get(id: &str) -> Style {
    let all = list();
    all.iter().find(|s| s.id == id).cloned().unwrap_or_else(|| all[0].clone())
}

pub fn save(mut s: Style) -> Result<Style> {
    if s.name.trim().is_empty() {
        bail!("give the style a name");
    }
    if s.id.trim().is_empty() {
        s.id = format!("style-{}", util::new_id());
    }
    s.pause_keep = s.pause_keep.clamp(0.1, 2.0);
    s.broll_every = s.broll_every.clamp(0.0, 120.0);
    s.updated = util::now_iso();
    util::write_json(&user_style_path(&s.id), &s)?;
    Ok(get(&s.id))
}

/// Deletes a user style, or resets a built-in to its defaults.
pub fn delete(id: &str) -> Result<()> {
    let p = user_style_path(id);
    if p.exists() {
        std::fs::remove_file(p)?;
    }
    Ok(())
}
