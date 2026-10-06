//! Edit decisions.
//!
//! `Plan` is what the AI returns: it only references utterance ids, never raw
//! timestamps. `resolve_plan` turns it into an `Edit` (clips with exact source
//! times, B-roll/titles anchored to source time). `timeline` lays the edit out
//! on a frame grid for export, render and preview.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::media::{standard_rate, MediaInfo};
use crate::transcribe::{Utterance, Word};

// ------------------------------------------------------------------ plan (AI)

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PlanSegment {
    pub ids: Vec<String>,
    pub label: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PlanBroll {
    pub at: String,
    pub offset: f64,
    pub duration: f64,
    pub query: String,
    pub library: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PlanTitle {
    pub at: String,
    pub offset: f64,
    pub duration: f64,
    pub text: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PlanChapter {
    pub at: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Youtube {
    pub titles: Vec<String>,
    pub description: String,
    pub tags: Vec<String>,
    pub thumbnail_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Plan {
    pub title: String,
    pub summary: String,
    pub segments: Vec<PlanSegment>,
    pub broll: Vec<PlanBroll>,
    pub titles: Vec<PlanTitle>,
    pub chapters: Vec<PlanChapter>,
    pub youtube: Youtube,
    pub notes: String,
}

/// JSON schema for `Plan` (strict mode compatible: all keys required, no extras).
pub fn plan_schema() -> serde_json::Value {
    serde_json::json!({
      "type": "object",
      "additionalProperties": false,
      "required": ["title", "summary", "segments", "broll", "titles", "chapters", "youtube", "notes"],
      "properties": {
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "segments": {"type": "array", "items": {
          "type": "object", "additionalProperties": false,
          "required": ["ids", "label", "reason"],
          "properties": {
            "ids": {"type": "array", "items": {"type": "string"}},
            "label": {"type": "string"},
            "reason": {"type": "string"}
          }}},
        "broll": {"type": "array", "items": {
          "type": "object", "additionalProperties": false,
          "required": ["at", "offset", "duration", "query", "library", "reason"],
          "properties": {
            "at": {"type": "string"},
            "offset": {"type": "number"},
            "duration": {"type": "number"},
            "query": {"type": "string"},
            "library": {"type": ["string", "null"]},
            "reason": {"type": "string"}
          }}},
        "titles": {"type": "array", "items": {
          "type": "object", "additionalProperties": false,
          "required": ["at", "offset", "duration", "text", "kind"],
          "properties": {
            "at": {"type": "string"},
            "offset": {"type": "number"},
            "duration": {"type": "number"},
            "text": {"type": "string"},
            "kind": {"type": "string", "enum": ["title", "lower_third", "callout"]}
          }}},
        "chapters": {"type": "array", "items": {
          "type": "object", "additionalProperties": false,
          "required": ["at", "title"],
          "properties": {"at": {"type": "string"}, "title": {"type": "string"}}}},
        "youtube": {
          "type": "object", "additionalProperties": false,
          "required": ["titles", "description", "tags", "thumbnail_text"],
          "properties": {
            "titles": {"type": "array", "items": {"type": "string"}},
            "description": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "thumbnail_text": {"type": "string"}
          }},
        "notes": {"type": "string"}
      }
    })
}

// ------------------------------------------------------------------ edit

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Segment {
    pub label: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Clip {
    pub id: String,
    pub source: String,
    pub start: f64,
    pub end: f64,
    pub segment: usize,
    pub enabled: bool,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Asset {
    /// library | pexels | pixabay | file
    pub kind: String,
    pub id: String,
    pub path: String,
    pub thumb: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub credit: String,
    pub url: String,
    pub is_image: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Broll {
    pub id: String,
    pub source: String,
    pub anchor: f64,
    pub duration: f64,
    pub query: String,
    pub reason: String,
    pub library: Option<String>,
    pub asset: Option<Asset>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TitleItem {
    pub id: String,
    pub source: String,
    pub anchor: f64,
    pub duration: f64,
    pub text: String,
    pub kind: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Chapter {
    pub source: String,
    pub anchor: f64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Edit {
    pub version: u32,
    pub created: String,
    pub kind: String,
    pub engine: String,
    pub request: String,
    pub title: String,
    pub summary: String,
    pub notes: String,
    pub segments: Vec<Segment>,
    pub clips: Vec<Clip>,
    pub broll: Vec<Broll>,
    pub titles: Vec<TitleItem>,
    pub chapters: Vec<Chapter>,
    pub youtube: Youtube,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct CutParams {
    /// Pauses up to this length inside kept speech are left alone.
    pub pause_keep: f64,
    pub pre_pad: f64,
    pub post_pad: f64,
}

impl Default for CutParams {
    fn default() -> Self {
        Self { pause_keep: 0.45, pre_pad: 0.10, post_pad: 0.18 }
    }
}

/// Turns an AI plan into an edit. `durations` maps source id → duration.
pub fn resolve_plan(plan: &Plan, utts: &[Utterance], durations: &HashMap<String, f64>, library_ids: &HashSet<String>, params: CutParams) -> Edit {
    let mut warnings = vec![];
    let by_id: HashMap<&str, usize> = utts.iter().enumerate().map(|(i, u)| (u.id.as_str(), i)).collect();
    let mut used: HashSet<usize> = HashSet::new();
    let mut segments = vec![];
    let mut clips: Vec<Clip> = vec![];

    for seg in &plan.segments {
        let mut idxs = vec![];
        for id in &seg.ids {
            let key = id.trim().trim_start_matches('[').trim_end_matches(']');
            match by_id.get(key) {
                Some(&i) if used.insert(i) => idxs.push(i),
                Some(_) => warnings.push(format!("{key} was used twice; kept the first use")),
                None => warnings.push(format!("unknown utterance id {key} ignored")),
            }
        }
        if idxs.is_empty() {
            continue;
        }
        let seg_idx = segments.len();
        segments.push(Segment { label: seg.label.clone(), reason: seg.reason.clone() });

        let mut run: Vec<usize> = vec![];
        let flush = |run: &mut Vec<usize>, clips: &mut Vec<Clip>| {
            if run.is_empty() {
                return;
            }
            let first = &utts[run[0]];
            let last = &utts[*run.last().unwrap()];
            let dur = durations.get(&first.source).copied().unwrap_or(f64::MAX);
            // Neighbours in the source (kept or not) bound the handles.
            let prev_end = run[0]
                .checked_sub(1)
                .map(|i| &utts[i])
                .filter(|u| u.source == first.source)
                .map(|u| u.end)
                .unwrap_or(0.0);
            let next_start = utts
                .get(run.last().unwrap() + 1)
                .filter(|u| u.source == first.source)
                .map(|u| u.start)
                .unwrap_or(dur);
            let pre = params.pre_pad.min(((first.start - prev_end) / 2.0).max(0.0));
            let post = params.post_pad.min(((next_start - last.end) / 2.0).max(0.0));
            let start = (first.start - pre).max(0.0);
            let end = (last.end + post).min(dur);
            let text = run.iter().map(|&i| utts[i].text.as_str()).collect::<Vec<_>>().join(" ");
            clips.push(Clip {
                id: String::new(),
                source: first.source.clone(),
                start,
                end,
                segment: seg_idx,
                enabled: true,
                text,
            });
            run.clear();
        };
        for &i in &idxs {
            if let Some(&prev) = run.last() {
                let a = &utts[prev];
                let b = &utts[i];
                let contiguous = i == prev + 1 && a.source == b.source && b.start - a.end <= params.pause_keep;
                if !contiguous {
                    flush(&mut run, &mut clips);
                }
            }
            run.push(i);
        }
        flush(&mut run, &mut clips);
    }
    for (n, c) in clips.iter_mut().enumerate() {
        c.id = format!("c{}", n + 1);
    }

    let anchor = |at: &str, offset: f64, warnings: &mut Vec<String>, what: &str| -> Option<(String, f64)> {
        let key = at.trim();
        match by_id.get(key) {
            Some(&i) => {
                let u = &utts[i];
                let t = (u.start + offset.max(0.0)).min(u.end.max(u.start));
                Some((u.source.clone(), t))
            }
            None => {
                warnings.push(format!("{what} anchored to unknown id {key} ignored"));
                None
            }
        }
    };

    let mut broll = vec![];
    for (n, b) in plan.broll.iter().enumerate() {
        let Some((source, t)) = anchor(&b.at, b.offset, &mut warnings, "B-roll") else { continue };
        let library = b.library.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && s != "null");
        let library = match library {
            Some(l) if library_ids.contains(&l) => Some(l),
            Some(l) => {
                warnings.push(format!("library clip {l} doesn't exist; will search stock instead"));
                None
            }
            None => None,
        };
        broll.push(Broll {
            id: format!("b{}", n + 1),
            source,
            anchor: t,
            duration: b.duration.clamp(1.0, 12.0),
            query: b.query.trim().to_string(),
            reason: b.reason.clone(),
            library,
            asset: None,
            enabled: true,
        });
    }
    let mut titles = vec![];
    for (n, t) in plan.titles.iter().enumerate() {
        let Some((source, a)) = anchor(&t.at, t.offset, &mut warnings, "Title") else { continue };
        if t.text.trim().is_empty() {
            continue;
        }
        titles.push(TitleItem {
            id: format!("t{}", n + 1),
            source,
            anchor: a,
            duration: t.duration.clamp(1.0, 8.0),
            text: t.text.trim().to_string(),
            kind: if t.kind.is_empty() { "title".into() } else { t.kind.clone() },
            enabled: true,
        });
    }
    let mut chapters = vec![];
    for c in &plan.chapters {
        if let Some((source, a)) = anchor(&c.at, 0.0, &mut warnings, "Chapter") {
            chapters.push(Chapter { source, anchor: a, title: c.title.trim().to_string() });
        }
    }

    Edit {
        title: plan.title.clone(),
        summary: plan.summary.clone(),
        notes: plan.notes.clone(),
        segments,
        clips,
        broll,
        titles,
        chapters,
        youtube: plan.youtube.clone(),
        warnings,
        ..Default::default()
    }
}

/// Re-expresses an edit as a plan (utterance ids) so the AI can revise it,
/// including any manual changes made in the app.
pub fn edit_to_plan(edit: &Edit, utts: &[Utterance]) -> Plan {
    let mut segments: Vec<PlanSegment> = vec![];
    let mut last_seg: Option<usize> = None;
    for c in edit.clips.iter().filter(|c| c.enabled) {
        let ids: Vec<String> = utts
            .iter()
            .filter(|u| u.source == c.source)
            .filter(|u| {
                let overlap = u.end.min(c.end) - u.start.max(c.start);
                overlap > 0.5 * (u.end - u.start).max(0.01)
            })
            .map(|u| u.id.clone())
            .collect();
        if ids.is_empty() {
            continue;
        }
        if last_seg == Some(c.segment) {
            segments.last_mut().unwrap().ids.extend(ids);
        } else {
            let s = edit.segments.get(c.segment).cloned().unwrap_or_default();
            segments.push(PlanSegment { ids, label: s.label, reason: s.reason });
            last_seg = Some(c.segment);
        }
    }
    let locate = |source: &str, t: f64| -> Option<(String, f64)> {
        let u = utts
            .iter()
            .filter(|u| u.source == source && u.start <= t + 0.01)
            .last()
            .or_else(|| utts.iter().find(|u| u.source == source))?;
        Some((u.id.clone(), (t - u.start).max(0.0)))
    };
    let broll = edit
        .broll
        .iter()
        .filter(|b| b.enabled)
        .filter_map(|b| {
            let (at, offset) = locate(&b.source, b.anchor)?;
            Some(PlanBroll {
                at,
                offset: (offset * 100.0).round() / 100.0,
                duration: b.duration,
                query: b.query.clone(),
                library: b.library.clone(),
                reason: b.reason.clone(),
            })
        })
        .collect();
    let titles = edit
        .titles
        .iter()
        .filter(|t| t.enabled)
        .filter_map(|t| {
            let (at, offset) = locate(&t.source, t.anchor)?;
            Some(PlanTitle { at, offset: (offset * 100.0).round() / 100.0, duration: t.duration, text: t.text.clone(), kind: t.kind.clone() })
        })
        .collect();
    let chapters = edit
        .chapters
        .iter()
        .filter_map(|c| Some(PlanChapter { at: locate(&c.source, c.anchor)?.0, title: c.title.clone() }))
        .collect();
    Plan {
        title: edit.title.clone(),
        summary: edit.summary.clone(),
        segments,
        broll,
        titles,
        chapters,
        youtube: edit.youtube.clone(),
        notes: edit.notes.clone(),
    }
}

// ------------------------------------------------------------------ timeline

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TlClip {
    pub clip_id: String,
    pub source: String,
    pub segment: usize,
    /// Source in/out (seconds, frame aligned).
    pub src_in: f64,
    pub src_out: f64,
    /// Timeline position (seconds, frame aligned).
    pub start: f64,
    pub end: f64,
    pub frames_in: i64,
    pub frames_len: i64,
    pub frames_start: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TlBroll {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub query: String,
    pub asset: Option<Asset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TlTitle {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TlMarker {
    pub start: f64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Caption {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub duration: f64,
    pub fps_num: u32,
    pub fps_den: u32,
    pub width: u32,
    pub height: u32,
    pub clips: Vec<TlClip>,
    pub broll: Vec<TlBroll>,
    pub titles: Vec<TlTitle>,
    pub chapters: Vec<TlMarker>,
    pub captions: Vec<Caption>,
    pub warnings: Vec<String>,
    /// Total source duration, for "removed X%" stats.
    pub source_duration: f64,
}

impl Timeline {
    pub fn fps(&self) -> f64 {
        self.fps_num as f64 / self.fps_den.max(1) as f64
    }
    /// Maps a source time to the timeline, if that moment is kept.
    pub fn map(&self, source: &str, t: f64) -> Option<f64> {
        self.clips
            .iter()
            .find(|c| c.source == source && t >= c.src_in - 1e-6 && t < c.src_out)
            .map(|c| c.start + (t - c.src_in))
    }
}

pub struct SourceRef<'a> {
    pub id: &'a str,
    pub info: &'a MediaInfo,
    pub words: &'a [Word],
}

pub fn timeline(edit: &Edit, sources: &[SourceRef]) -> Timeline {
    let first_video = sources.iter().find(|s| s.info.has_video).or(sources.first());
    let (fps_num, fps_den) = first_video.map(|s| standard_rate(s.info.fps())).unwrap_or((30, 1));
    let fps = fps_num as f64 / fps_den as f64;
    let (width, height) = first_video
        .filter(|s| s.info.width > 0)
        .map(|s| (s.info.width, s.info.height))
        .unwrap_or((1920, 1080));
    let mut tl = Timeline {
        fps_num,
        fps_den,
        width,
        height,
        source_duration: sources.iter().map(|s| s.info.duration).sum(),
        ..Default::default()
    };
    let to_f = |t: f64| (t * fps).round() as i64;
    let to_s = |f: i64| f as f64 / fps;

    let mut cursor: i64 = 0;
    for c in edit.clips.iter().filter(|c| c.enabled) {
        let fin = to_f(c.start);
        let fout = to_f(c.end);
        let len = fout - fin;
        if len < 2 {
            continue;
        }
        tl.clips.push(TlClip {
            clip_id: c.id.clone(),
            source: c.source.clone(),
            segment: c.segment,
            src_in: to_s(fin),
            src_out: to_s(fout),
            start: to_s(cursor),
            end: to_s(cursor + len),
            frames_in: fin,
            frames_len: len,
            frames_start: cursor,
        });
        cursor += len;
    }
    tl.duration = to_s(cursor);

    let clips = tl.clips.clone();
    let place = |source: &str, t: f64| -> Option<f64> {
        clips
            .iter()
            .find(|c| c.source == source && t >= c.src_in - 1e-6 && t < c.src_out)
            .map(|c| c.start + (t - c.src_in))
            .or_else(|| {
                // Anchor fell in a removed part: use the next kept moment within 3 s.
                clips.iter().filter(|c| c.source == source && c.src_in > t && c.src_in - t < 3.0).map(|c| c.start).next()
            })
    };

    let mut broll: Vec<TlBroll> = vec![];
    let mut warnings = vec![];
    for b in edit.broll.iter().filter(|b| b.enabled) {
        match place(&b.source, b.anchor) {
            Some(s) => {
                let s = to_s(to_f(s));
                let e = to_s(to_f((s + b.duration).min(tl.duration)));
                broll.push(TlBroll { id: b.id.clone(), start: s, end: e, query: b.query.clone(), asset: b.asset.clone() });
            }
            None => warnings.push(format!("B-roll \"{}\" sits in a removed part and was skipped", b.query)),
        }
    }
    broll.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap());
    let mut last_end = 0.0;
    for b in broll.iter_mut() {
        if b.start < last_end {
            b.start = last_end;
        }
        if b.end > last_end {
            last_end = b.end;
        }
    }
    tl.broll = broll.into_iter().filter(|b| b.end - b.start >= 0.75).collect();

    for t in edit.titles.iter().filter(|t| t.enabled) {
        if let Some(s) = place(&t.source, t.anchor) {
            let s = to_s(to_f(s));
            tl.titles.push(TlTitle {
                id: t.id.clone(),
                start: s,
                end: to_s(to_f((s + t.duration).min(tl.duration))),
                text: t.text.clone(),
                kind: t.kind.clone(),
            });
        }
    }
    tl.titles.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap());

    let mut chapters: Vec<TlMarker> = edit
        .chapters
        .iter()
        .filter_map(|c| place(&c.source, c.anchor).map(|s| TlMarker { start: to_s(to_f(s)), title: c.title.clone() }))
        .collect();
    chapters.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap());
    tl.chapters = youtube_chapters(chapters, tl.duration);

    tl.captions = captions(&tl, sources);
    tl.warnings = warnings;
    tl
}

/// YouTube rules: first chapter at 0:00, each at least 10 s long.
fn youtube_chapters(chapters: Vec<TlMarker>, duration: f64) -> Vec<TlMarker> {
    const MIN: f64 = 10.0;
    let mut out: Vec<TlMarker> = vec![];
    for c in chapters {
        let n = out.len();
        match out.last_mut() {
            // A too-short first chapter (e.g. a hook) gives way to the next one at 0:00.
            Some(last) if n == 1 && c.start - last.start < MIN => {
                last.title = c.title;
            }
            Some(last) if c.start - last.start < MIN => {}
            _ => out.push(c),
        }
        if let Some(first) = out.first_mut() {
            first.start = 0.0;
        }
    }
    if let Some(last) = out.last() {
        if duration - last.start < MIN && out.len() > 1 {
            out.pop();
        }
    }
    out
}

fn captions(tl: &Timeline, sources: &[SourceRef]) -> Vec<Caption> {
    const MAX_CHARS: usize = 38;
    const MAX_DUR: f64 = 3.2;
    let mut words: Vec<(f64, f64, String)> = vec![];
    for c in &tl.clips {
        let Some(src) = sources.iter().find(|s| s.id == c.source) else { continue };
        for w in src.words {
            let mid = (w.start + w.end) / 2.0;
            if mid >= c.src_in && mid < c.src_out {
                let s = c.start + (w.start.max(c.src_in) - c.src_in);
                let e = c.start + (w.end.min(c.src_out) - c.src_in);
                words.push((s, e.max(s + 0.05), w.text.clone()));
            }
        }
    }
    let mut out: Vec<Caption> = vec![];
    let mut cur: Option<Caption> = None;
    for (s, e, text) in words {
        if let Some(c) = cur.as_mut() {
            let len = c.text.chars().count() + 1 + text.chars().count();
            // Let a sentence's last word overflow a little rather than sit alone on screen.
            let ends = text.ends_with('.') || text.ends_with('?') || text.ends_with('!');
            let too_long = len > MAX_CHARS && !(ends && len <= MAX_CHARS + 12);
            let too_slow = e - c.start > MAX_DUR;
            let gap = s - c.end > 0.6;
            let sentence = c.text.ends_with('.') || c.text.ends_with('?') || c.text.ends_with('!');
            if too_long || too_slow || gap || sentence {
                out.push(cur.take().unwrap());
            }
        }
        match cur.as_mut() {
            Some(c) => {
                c.text.push(' ');
                c.text.push_str(&text);
                c.end = e;
            }
            None => cur = Some(Caption { start: s, end: e, text }),
        }
    }
    if let Some(c) = cur {
        out.push(c);
    }
    // Hold each caption until the next one (max +0.5 s) so they don't flicker.
    for i in 0..out.len() {
        let next = out.get(i + 1).map(|c| c.start).unwrap_or(tl.duration);
        out[i].end = (out[i].end + 0.5).min(next).max(out[i].start + 0.3);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(id: &str, s: f64, e: f64) -> Utterance {
        Utterance {
            id: id.into(),
            source: "A1".into(),
            start: s,
            end: e,
            text: id.into(),
            word_start: 0,
            word_end: 0,
            kind: "speech".into(),
        }
    }

    fn utts() -> Vec<Utterance> {
        vec![u("U1", 1.0, 3.0), u("U2", 3.3, 5.0), u("U3", 7.0, 9.0), u("U4", 12.0, 14.0)]
    }

    #[test]
    fn contiguous_utterances_merge_and_gaps_are_cut() {
        let plan = Plan {
            segments: vec![PlanSegment { ids: vec!["U1".into(), "U2".into(), "U3".into()], label: "Intro".into(), reason: "".into() }],
            ..Default::default()
        };
        let d = HashMap::from([("A1".to_string(), 20.0)]);
        let e = resolve_plan(&plan, &utts(), &d, &HashSet::new(), CutParams::default());
        assert_eq!(e.clips.len(), 2, "{:?}", e.clips);
        assert!((e.clips[0].start - 0.9).abs() < 1e-9);
        assert!((e.clips[0].end - 5.18).abs() < 1e-9);
        assert!((e.clips[1].start - 6.9).abs() < 1e-9);
    }

    #[test]
    fn unknown_and_duplicate_ids_warn() {
        let plan = Plan {
            segments: vec![PlanSegment { ids: vec!["U9".into(), "U4".into(), "U4".into()], ..Default::default() }],
            broll: vec![PlanBroll { at: "U4".into(), offset: 0.5, duration: 30.0, query: "teeth".into(), library: Some("L1".into()), reason: "".into() }],
            ..Default::default()
        };
        let d = HashMap::from([("A1".to_string(), 20.0)]);
        let e = resolve_plan(&plan, &utts(), &d, &HashSet::new(), CutParams::default());
        assert_eq!(e.clips.len(), 1);
        assert_eq!(e.warnings.len(), 3);
        assert_eq!(e.broll[0].duration, 12.0);
        assert_eq!(e.broll[0].library, None);
    }

    #[test]
    fn timeline_maps_anchors_and_round_trips_to_plan() {
        let plan = Plan {
            segments: vec![
                PlanSegment { ids: vec!["U3".into()], label: "Hook".into(), reason: "".into() },
                PlanSegment { ids: vec!["U1".into(), "U2".into()], label: "Body".into(), reason: "".into() },
            ],
            broll: vec![PlanBroll { at: "U1".into(), offset: 0.5, duration: 3.0, query: "x".into(), library: None, reason: "".into() }],
            chapters: vec![PlanChapter { at: "U3".into(), title: "Start".into() }],
            ..Default::default()
        };
        let d = HashMap::from([("A1".to_string(), 20.0)]);
        let e = resolve_plan(&plan, &utts(), &d, &HashSet::new(), CutParams::default());
        let info = MediaInfo { duration: 20.0, has_video: true, width: 1280, height: 720, fps_num: 30, fps_den: 1, ..Default::default() };
        let words = vec![];
        let tl = timeline(&e, &[SourceRef { id: "A1", info: &info, words: &words }]);
        assert_eq!(tl.clips.len(), 2);
        assert_eq!(tl.clips[0].frames_start, 0);
        // Hook clip is 6.9..9.18 → 2.28 s; B-roll anchored at U1+0.5 = 1.5 s source.
        let b = &tl.broll[0];
        assert!((b.start - (tl.clips[1].start + 0.6)).abs() < 0.05, "{b:?} {:?}", tl.clips);
        let ch = youtube_chapters(
            vec![
                TlMarker { start: 0.0, title: "Hook".into() },
                TlMarker { start: 1.0, title: "Why".into() },
                TlMarker { start: 30.0, title: "How".into() },
                TlMarker { start: 35.0, title: "Too close".into() },
                TlMarker { start: 95.0, title: "End".into() },
            ],
            100.0,
        );
        assert_eq!(ch.iter().map(|c| c.title.as_str()).collect::<Vec<_>>(), vec!["Why", "How"]);
        assert_eq!(ch[0].start, 0.0);
        let back = edit_to_plan(&e, &utts());
        assert_eq!(back.segments.len(), 2);
        assert_eq!(back.segments[0].ids, vec!["U3"]);
        assert_eq!(back.segments[1].ids, vec!["U1", "U2"]);
        assert_eq!(back.broll[0].at, "U1");
    }
}
