//! Prompts for the AI editor.

use std::fmt::Write as _;

use crate::broll::LibraryItem;
use crate::edit::Plan;
use crate::media::Sheet;
use crate::project::{ChatMessage, Project};
use crate::style::{RefAnalysis, Style};
use crate::transcribe::Utterance;
use crate::util::{clip_text, fmt_time};

pub struct PlanInput<'a> {
    pub project: &'a Project,
    pub style: &'a Style,
    pub utterances: &'a [Utterance],
    pub library: &'a [LibraryItem],
    /// (source id, sheets) – images the engine can look at.
    pub sheets: &'a [(String, Vec<Sheet>)],
    pub stock_available: bool,
    /// For revisions: the current edit as a plan, and the request.
    pub current: Option<&'a Plan>,
    pub request: Option<&'a str>,
}

const ROLE: &str = "You are a senior video editor for YouTube creators. You edit by making decisions, not by touching pixels: \
you receive a time-coded transcript split into numbered utterances (U1, U2, …) and return an edit plan as JSON. \
A program turns your plan into a frame-accurate timeline for DaVinci Resolve, so every decision must reference utterance ids exactly as given.";

const RULES: &str = r#"## How the plan works
- `segments` is the finished video in playback order. Each segment is a section (e.g. "Hook", "Why it happens", "What to do", "Call to action") with the utterance ids to keep, in the order they should play.
- Any utterance you don't list is cut. Gaps between kept utterances are tightened automatically, so you never need to deal with silence yourself.
- Usually keep source order. Reorder only for a hook (moving one strong line to the very start) or when the brief asks for it.
- Never invent ids, never use an id twice, never split an utterance – keep or drop it whole.
- `[non-speech sound …]` utterances are breaths, fillers or noise: drop them unless they are meaningful (e.g. laughter that lands a joke).
- Retakes: when the speaker repeats a sentence or restarts, keep only the best complete take (usually the last) and drop the stumbles and meta talk ("sorry", "let me start again", "wait").
- `broll`: cut-aways placed over the speaker. `at` = utterance id where it starts, `offset` = seconds into that utterance, `duration` 2–6 s. `query` = a concrete, filmable stock-footage search in English (3–6 words, no brand names, no on-screen text). If a library clip fits, put its id (e.g. "L3") in `library`, otherwise null. Don't cover the first 3 seconds of the hook or the call to action with B-roll.
- `titles`: short on-screen text (max 6 words). kind = "title" for section titles, "lower_third" for names/intros, "callout" for key terms or numbers.
- `chapters`: only if the finished video is longer than ~2 minutes; the first chapter starts at the first kept utterance. Short titles (2–5 words).
- `youtube`: 3 title options (max 70 characters, curiosity + clarity, no clickbait lies), a description (2 short paragraphs, no chapter list – it is added automatically), 10–15 tags, and thumbnail text (max 4 words).
- `notes`: anything a human should check (unclear audio, possible factual errors, missing content). Keep it short.
- `summary`: 1–2 sentences on what you did."#;

fn style_block(out: &mut String, style: &Style) {
    let _ = writeln!(out, "## Style: {}\n{}\n", style.name, style.description);
    if !style.instructions.trim().is_empty() {
        let _ = writeln!(out, "### House rules\n{}\n", style.instructions.trim());
    }
    if style.broll_every > 0.0 {
        let _ = writeln!(out, "- Aim for roughly one B-roll shot every {:.0} seconds of the finished video where it fits the content.", style.broll_every);
    } else {
        let _ = writeln!(out, "- B-roll is optional for this style; only add it where it clearly helps.");
    }
    if !style.titles {
        let _ = writeln!(out, "- Don't add on-screen titles unless the brief asks for them.");
    }
    if style.target_length > 0.0 {
        let _ = writeln!(out, "- Target length: about {:.0} seconds. This is a hard limit.", style.target_length);
    }
    for r in &style.references {
        reference_block(out, r);
    }
}

pub fn reference_block(out: &mut String, r: &RefAnalysis) {
    let m = &r.metrics;
    let _ = writeln!(
        out,
        "\n### Reference video: {}\nMeasured: {:.1} cuts/min, average shot {:.1} s, {:.0} words/min, speech {:.0}% of the time, {:.1} long pauses/min.",
        r.name,
        m.cuts_per_min,
        m.avg_shot,
        m.words_per_min,
        m.speech_ratio * 100.0,
        m.long_pauses_per_min
    );
    let s = &r.style;
    if !s.summary.is_empty() {
        let _ = writeln!(out, "Style: {}\nPacing: {}\nHook: {}\nB-roll: {}\nOn-screen text: {}", s.summary, s.pacing, s.hook, s.broll, s.on_screen_text);
    }
    for rule in &s.rules {
        let _ = writeln!(out, "- {rule}");
    }
}

pub fn plan_prompt(input: &PlanInput) -> String {
    let p = input.project;
    let mut out = String::new();
    let _ = writeln!(out, "{ROLE}\n");
    let _ = writeln!(out, "{RULES}\n");
    style_block(&mut out, input.style);
    let project_refs: Vec<&RefAnalysis> = p.references.iter().filter_map(|r| r.analysis.as_ref()).collect();
    if !project_refs.is_empty() {
        let _ = writeln!(out, "\n## Reference videos for this project (match their feel)");
        for r in project_refs {
            reference_block(&mut out, r);
        }
    }

    let _ = writeln!(out, "\n## Brief from the creator");
    let brief = p.brief.trim();
    let _ = writeln!(out, "{}", if brief.is_empty() { "(none – use your judgement and the style above)" } else { brief });
    if p.aspect == "9:16" {
        let _ = writeln!(out, "Output is vertical 9:16 for Shorts/Reels.");
    }

    let _ = writeln!(out, "\n## Footage");
    for s in &p.sources {
        if let Some(i) = &s.info {
            let _ = writeln!(out, "- {}: \"{}\", {} long, {}x{}", s.id, s.name, fmt_time(i.duration), i.width, i.height);
        }
    }

    if !input.library.is_empty() {
        let _ = writeln!(out, "\n## B-roll library (prefer these when they fit)");
        for item in input.library.iter().take(150) {
            let desc = if item.description.is_empty() { item.name.clone() } else { format!("{} – {}", item.name, item.description) };
            let _ = writeln!(out, "- {}: {} ({:.1} s)", item.id, clip_text(&desc, 140), item.duration);
        }
    }
    if !input.stock_available && input.library.is_empty() {
        let _ = writeln!(out, "\n(No B-roll source is connected yet; still suggest B-roll – it becomes timeline markers the creator can fill.)");
    }

    if !input.sheets.is_empty() {
        let _ = writeln!(
            out,
            "\n## What's on screen\nContact sheets (frame grids with timestamps) are attached. Use them to spot what the speaker shows, \
             where the framing changes, and moments that need no B-roll because something visual is already happening."
        );
        for (sid, sheets) in input.sheets {
            for sh in sheets {
                let _ = writeln!(out, "- {sid} {}–{}: one frame every {:.0} s", fmt_time(sh.start), fmt_time(sh.end), sh.step);
            }
        }
    }

    let _ = writeln!(out, "\n## Transcript (utterances)\nFormat: id [source start–end, length] (pause before) text");
    let mut prev: Option<&Utterance> = None;
    for u in input.utterances {
        let pause = match prev {
            Some(pu) if pu.source == u.source => u.start - pu.end,
            _ => u.start,
        };
        let pause_txt = if pause >= 0.8 { format!(" (+{pause:.1}s pause)") } else { String::new() };
        let _ = writeln!(
            out,
            "{} [{} {}–{}, {:.1}s]{} {}",
            u.id,
            u.source,
            fmt_time(u.start),
            fmt_time(u.end),
            u.end - u.start,
            pause_txt,
            u.text
        );
        prev = Some(u);
    }

    if let (Some(current), Some(request)) = (input.current, input.request) {
        let _ = writeln!(out, "\n## Current edit (what the creator is looking at now)");
        let _ = writeln!(out, "{}", serde_json::to_string(current).unwrap_or_default());
        let history: Vec<&ChatMessage> = p.chat.iter().filter(|m| m.role == "user").collect();
        if history.len() > 1 {
            let _ = writeln!(out, "\nEarlier requests (already applied):");
            for m in &history[..history.len() - 1] {
                let _ = writeln!(out, "- {}", clip_text(&m.text, 200));
            }
        }
        let _ = writeln!(
            out,
            "\n## Change request\n{request}\n\nApply this request to the current edit. Keep everything the request doesn't mention as it is \
             (including manual changes the creator made). Return the complete updated plan, and say what you changed in `summary`."
        );
    } else {
        let _ = writeln!(out, "\nNow return the complete edit plan as JSON.");
    }
    out
}

pub fn style_prompt(name: &str, metrics: &crate::style::RefMetrics, transcript_excerpt: &str, has_images: bool) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "You are a senior YouTube video editor. Study this reference video so another editor can match its editing style on new footage.\n"
    );
    let _ = writeln!(
        out,
        "## Reference: {name}\nMeasured over the first {:.0} s: {} scene cuts ({:.1}/min, average shot {:.1} s, median {:.1} s), {:.0} words/min, \
         speech present {:.0}% of the time, average pause between phrases {:.2} s, {:.1} pauses longer than 0.6 s per minute.",
        metrics.analyzed_seconds,
        metrics.cuts,
        metrics.cuts_per_min,
        metrics.avg_shot,
        metrics.median_shot,
        metrics.words_per_min,
        metrics.speech_ratio * 100.0,
        metrics.avg_pause,
        metrics.long_pauses_per_min
    );
    if has_images {
        let _ = writeln!(out, "Contact sheets of the video (timestamped frame grids) are attached – use them to judge framing, B-roll, on-screen text and graphics.");
    }
    let _ = writeln!(out, "\n## Transcript excerpt\n{}\n", clip_text(transcript_excerpt, 6000));
    let _ = writeln!(
        out,
        "Return JSON with: summary (2–3 sentences on the overall feel), pacing (how tight the cuts are and how pauses are handled), \
         hook (how the video opens), broll (how often and what kind of cut-aways), on_screen_text (titles/captions/graphics style), \
         rules (5–10 imperative rules an editor should follow to match this style, specific and measurable where possible), \
         pause_keep (the longest pause in seconds this style leaves inside speech, between 0.15 and 1.2)."
    );
    out
}

pub fn library_prompt(items: &[(String, String, f64)]) -> String {
    let mut out = String::from(
        "You are tagging a B-roll library for a video editor. For each image (one thumbnail per clip), write a short, concrete \
         description of what is visible (subject, action, setting, shot type) and 3–6 search tags.\n\nClips:\n",
    );
    for (id, file, dur) in items {
        let _ = writeln!(out, "- {id}: file \"{file}\", {dur:.1} s");
    }
    out.push_str("\nReturn JSON {\"items\": [{\"id\", \"description\", \"tags\"}]} with one entry per clip id above.");
    out
}

pub fn library_schema() -> serde_json::Value {
    serde_json::json!({
      "type": "object", "additionalProperties": false, "required": ["items"],
      "properties": {"items": {"type": "array", "items": {
        "type": "object", "additionalProperties": false, "required": ["id", "description", "tags"],
        "properties": {"id": {"type": "string"}, "description": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}}
      }}}
    })
}
