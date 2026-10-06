//! whisper.cpp transcription and utterance segmentation.
//!
//! Whisper's own word times drift by up to ~1 s, so cut points never come from
//! them. Speech regions come from the waveform (`media::analyze_audio`); DTW word
//! times are only used to assign words to those regions.

use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::media::{AudioAnalysis, Span};
use crate::{proc, settings, tools};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub p: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub language: String,
    pub model: String,
    pub words: Vec<Word>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Utterance {
    pub id: String,
    pub source: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    /// Index range into the source transcript's words (end exclusive).
    pub word_start: usize,
    pub word_end: usize,
    /// "speech" or "sound" (audible but no recognised words – breath, filler, noise).
    pub kind: String,
}

pub async fn run_whisper(
    wav: &Path,
    out_base: &Path,
    cancel: &CancellationToken,
    progress: &(dyn Fn(f64) + Send + Sync),
) -> Result<Transcript> {
    let s = settings::get();
    let exe = tools::whisper()?;
    let model = tools::model_path(&s.whisper_model);
    if !model.exists() {
        bail!("Whisper model '{}' is not downloaded. Open Settings ▸ Tools.", s.whisper_model);
    }
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
    let mut args: Vec<String> = vec![
        "-m".into(),
        model.to_string_lossy().into(),
        "-f".into(),
        wav.to_string_lossy().into(),
        "-l".into(),
        if s.language.trim().is_empty() { "auto".into() } else { s.language.clone() },
        "-t".into(),
        threads.to_string(),
        "-ojf".into(),
        "-of".into(),
        out_base.to_string_lossy().into(),
        "-pp".into(),
        // Suppress non-speech tokens ([MUSIC], [BLANK_AUDIO], …).
        "-sns".into(),
    ];
    if let Some(preset) = tools::dtw_preset(&s.whisper_model) {
        // DTW token timestamps need flash attention off.
        args.extend(["-dtw".into(), preset, "-nfa".into()]);
    }
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<f64>();
    let re = regex::Regex::new(r"progress\s*=\s*(\d+)%").unwrap();
    let fut = proc::run_ok(
        &exe,
        &args,
        proc::RunOpts {
            cancel: Some(cancel.clone()),
            keep_bytes: 64 * 1024,
            on_stderr: Some(Box::new(move |line| {
                if let Some(c) = re.captures(line) {
                    if let Ok(p) = c[1].parse::<f64>() {
                        let _ = tx.send(p / 100.0);
                    }
                }
            })),
            ..Default::default()
        },
    );
    tokio::pin!(fut);
    loop {
        tokio::select! {
            r = &mut fut => { r?; break; }
            Some(p) = rx.recv() => progress(p),
        }
    }
    let json_path = out_base.with_extension("json");
    let raw = std::fs::read(&json_path).with_context(|| format!("whisper produced no {}", json_path.display()))?;
    let v: serde_json::Value = serde_json::from_slice(&raw).context("whisper JSON")?;
    let mut t = parse_whisper_json(&v);
    t.model = s.whisper_model;
    Ok(t)
}

fn is_punct(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| !c.is_alphanumeric())
}

pub fn parse_whisper_json(v: &serde_json::Value) -> Transcript {
    let language = v["result"]["language"].as_str().unwrap_or("").to_string();
    let mut words: Vec<Word> = vec![];
    let mut probs: Vec<Vec<f32>> = vec![];
    for seg in v["transcription"].as_array().cloned().unwrap_or_default() {
        let seg_end = seg["offsets"]["to"].as_f64().unwrap_or(0.0) / 1000.0;
        for tok in seg["tokens"].as_array().cloned().unwrap_or_default() {
            let text = tok["text"].as_str().unwrap_or("");
            if text.starts_with("[_") {
                continue;
            }
            let dtw = tok["t_dtw"].as_f64().unwrap_or(-1.0);
            let t = if dtw >= 0.0 { dtw / 100.0 } else { tok["offsets"]["from"].as_f64().unwrap_or(0.0) / 1000.0 };
            let p = tok["p"].as_f64().unwrap_or(0.0) as f32;
            let starts_word = text.starts_with(' ') || words.is_empty();
            let clean = text.trim();
            if clean.is_empty() {
                continue;
            }
            if starts_word && !is_punct(clean) {
                words.push(Word { text: clean.to_string(), start: t, end: seg_end, p });
                probs.push(vec![p]);
            } else if let Some(last) = words.last_mut() {
                last.text.push_str(clean);
                if let Some(pp) = probs.last_mut() {
                    if !is_punct(clean) {
                        pp.push(p);
                    }
                }
            } else {
                words.push(Word { text: clean.to_string(), start: t, end: seg_end, p });
                probs.push(vec![p]);
            }
        }
    }
    // Drop non-speech annotations like "[BLANK_AUDIO]" or "(music)".
    let re = regex::Regex::new(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*").unwrap();
    let mut keep_w = vec![];
    let mut keep_p = vec![];
    for (w, p) in words.into_iter().zip(probs.into_iter()) {
        let text = re.replace_all(&w.text, "").trim().to_string();
        if !text.is_empty() && text.chars().any(|c| c.is_alphanumeric()) {
            keep_w.push(Word { text, ..w });
            keep_p.push(p);
        }
    }
    let (mut words, probs) = (keep_w, keep_p);
    // Monotonic starts; end = next start.
    for i in 1..words.len() {
        if words[i].start < words[i - 1].start {
            words[i].start = words[i - 1].start;
        }
    }
    for i in 0..words.len() {
        if i + 1 < words.len() {
            words[i].end = words[i + 1].start.max(words[i].start);
        }
        let pp = &probs[i];
        words[i].p = if pp.is_empty() { 0.0 } else { pp.iter().sum::<f32>() / pp.len() as f32 };
    }
    Transcript { language, model: String::new(), words }
}

fn ends_sentence(text: &str) -> bool {
    let t = text.trim_end_matches(['"', '\'', ')', '”', '’']);
    t.ends_with('.') || t.ends_with('?') || t.ends_with('!') || t.ends_with('।')
}

/// Assigns words to acoustic speech regions, retimes them inside their region,
/// and groups regions into utterances. Returns (utterances, retimed words).
pub fn build_utterances(
    source_id: &str,
    transcript: &Transcript,
    audio: &AudioAnalysis,
    first_id: usize,
) -> (Vec<Utterance>, Vec<Word>) {
    let regions: Vec<Span> = audio.speech.clone();
    let mut words = transcript.words.clone();
    if regions.is_empty() {
        return (vec![], words);
    }

    // 1. Region index for each word (monotonic, biased to the previous region
    //    because DTW anchors lag the onset slightly).
    let mut assign = vec![0usize; words.len()];
    let mut min_idx = 0usize;
    for (wi, w) in words.iter().enumerate() {
        let t = w.start;
        let mut idx = match regions.iter().position(|r| t >= r.start && t <= r.end) {
            Some(i) => i,
            None => {
                let next = regions.iter().position(|r| r.start > t);
                match next {
                    Some(0) => 0,
                    Some(n) => {
                        let d_prev = t - regions[n - 1].end;
                        let d_next = regions[n].start - t;
                        if d_prev <= d_next * 1.5 {
                            n - 1
                        } else {
                            n
                        }
                    }
                    None => regions.len() - 1,
                }
            }
        };
        if idx < min_idx {
            idx = min_idx;
        }
        min_idx = idx;
        assign[wi] = idx;
    }
    realign_anomalies(&words, &regions, &mut assign);

    // 2. Retimes words inside their region, keeping order.
    let mut by_region: Vec<Vec<usize>> = vec![vec![]; regions.len()];
    for (wi, &ri) in assign.iter().enumerate() {
        by_region[ri].push(wi);
    }
    for (ri, list) in by_region.iter().enumerate() {
        let r = regions[ri];
        let mut prev = r.start;
        for (k, &wi) in list.iter().enumerate() {
            let mut s = words[wi].start.clamp(r.start, r.end);
            if k == 0 {
                s = r.start;
            }
            if s < prev {
                s = prev;
            }
            words[wi].start = s;
            prev = s;
        }
        for (k, &wi) in list.iter().enumerate() {
            words[wi].end = if k + 1 < list.len() { words[list[k + 1]].start.max(words[wi].start + 0.02) } else { r.end };
            if words[wi].end > r.end {
                words[wi].end = r.end;
            }
        }
    }

    // 3. Group regions into utterances.
    struct Group {
        regions: Vec<usize>,
    }
    let mut groups: Vec<Group> = vec![];
    for ri in 0..regions.len() {
        let r = regions[ri];
        let has_words = !by_region[ri].is_empty();
        if let Some(g) = groups.last_mut() {
            let prev_ri = *g.regions.last().unwrap();
            let gap = r.start - regions[prev_ri].end;
            let g_start = regions[g.regions[0]].start;
            let last_word_text = g
                .regions
                .iter()
                .rev()
                .find_map(|&x| by_region[x].last().map(|&wi| words[wi].text.clone()))
                .unwrap_or_default();
            let g_has_words = g.regions.iter().any(|&x| !by_region[x].is_empty());
            let len = r.start - g_start;
            let sentence = ends_sentence(&last_word_text);
            let split = gap >= 0.55
                || (sentence && gap >= 0.25)
                || (sentence && len > 8.0 && gap >= 0.12)
                || (len > 20.0 && gap >= 0.12)
                || (g_has_words != has_words && gap >= 0.3);
            if !split {
                g.regions.push(ri);
                continue;
            }
        }
        groups.push(Group { regions: vec![ri] });
    }

    let mut utts = vec![];
    let mut next_id = first_id;
    for g in groups {
        let start = regions[g.regions[0]].start;
        let end = regions[*g.regions.last().unwrap()].end;
        let wids: Vec<usize> = g.regions.iter().flat_map(|&ri| by_region[ri].iter().copied()).collect();
        if wids.is_empty() {
            if end - start < 0.3 {
                continue;
            }
            utts.push(Utterance {
                id: format!("U{next_id}"),
                source: source_id.into(),
                start,
                end,
                text: format!("[non-speech sound {:.1}s – breath, filler or noise]", end - start),
                word_start: 0,
                word_end: 0,
                kind: "sound".into(),
            });
        } else {
            let text = wids.iter().map(|&wi| words[wi].text.as_str()).collect::<Vec<_>>().join(" ");
            utts.push(Utterance {
                id: format!("U{next_id}"),
                source: source_id.into(),
                start,
                end,
                text,
                word_start: *wids.first().unwrap(),
                word_end: *wids.last().unwrap() + 1,
                kind: "speech".into(),
            });
        }
        next_id += 1;
    }
    (utts, words)
}

/// Spoken length proxy: letters/digits plus one per word gap.
fn word_chars(w: &Word) -> f64 {
    w.text.chars().filter(|c| c.is_alphanumeric()).count() as f64 + 1.0
}

/// Whisper's timing often breaks down on repeated phrases (retakes): words pile up
/// on one timestamp, or a phrase lands in the wrong breath group. Regions whose
/// speaking rate is implausible (or that hold collapsed timestamps) are re-aligned
/// together with their neighbours by a small dynamic program that trades off
/// "the words fit the region's duration" against "words stay near Whisper's time".
fn realign_anomalies(words: &[Word], regions: &[Span], assign: &mut [usize]) {
    let m = regions.len();
    if words.len() < 4 || m < 2 {
        return;
    }
    let mut chars = vec![0.0; m];
    for (wi, &r) in assign.iter().enumerate() {
        chars[r] += word_chars(&words[wi]);
    }
    let mut rates: Vec<f64> = (0..m)
        .filter(|&j| regions[j].len() >= 0.8 && chars[j] > 0.0)
        .map(|j| chars[j] / regions[j].len())
        .collect();
    if rates.len() < 2 {
        return;
    }
    rates.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let rho = rates[rates.len() / 2].max(1.0);

    let mut bad = vec![false; m];
    for j in 0..m {
        let d = regions[j].len();
        let r = chars[j] / d.max(0.01);
        if d >= 1.2 && chars[j] > 0.0 && (r > 2.5 * rho || r < 0.3 * rho) {
            bad[j] = true;
        }
    }
    for wi in 2..words.len() {
        if (words[wi].start - words[wi - 1].start).abs() < 0.011 && (words[wi - 1].start - words[wi - 2].start).abs() < 0.011 {
            bad[assign[wi]] = true;
        }
    }

    let mut j = 0;
    while j < m {
        if !bad[j] {
            j += 1;
            continue;
        }
        let mut end = j;
        while end + 1 < m && (bad[end + 1] || (end + 2 < m && bad[end + 2])) {
            end += 1;
        }
        let (ja, jb) = (j.saturating_sub(1), (end + 1).min(m - 1));
        realign_window(words, regions, assign, ja, jb, rho);
        j = end + 2;
    }
}

fn realign_window(words: &[Word], regions: &[Span], assign: &mut [usize], ja: usize, jb: usize, rho: f64) {
    const RATE_W: f64 = 2.0;
    let Some(wa) = assign.iter().position(|&r| r >= ja && r <= jb) else { return };
    let wb = assign.iter().rposition(|&r| r >= ja && r <= jb).unwrap() + 1;
    let n = wb - wa;
    if n == 0 || n > 400 {
        return;
    }
    let time_cost = |k: usize, j: usize| {
        let t = words[k].start;
        let r = regions[j];
        let d = if t < r.start { r.start - t } else if t > r.end { t - r.end } else { 0.0 };
        // Weak: this window was flagged because Whisper's timing broke down here.
        d.min(1.5) * 0.15
    };
    // Prefix sums (indices relative to wa) so a block's cost is O(1).
    let mut chars_pre = vec![0.0; n + 1];
    for k in 0..n {
        chars_pre[k + 1] = chars_pre[k] + word_chars(&words[wa + k]);
    }
    let time_pre: Vec<Vec<f64>> = (ja..=jb)
        .map(|j| {
            let mut v = vec![0.0; n + 1];
            for k in 0..n {
                v[k + 1] = v[k] + time_cost(wa + k, j);
            }
            v
        })
        .collect();
    // a, b are absolute word indices (a == b means an empty region).
    let block_cost = |j: usize, a: usize, b: usize| {
        if a == b {
            return RATE_W * regions[j].len();
        }
        let (ra, rb) = (a - wa, b - wa);
        let c = chars_pre[rb] - chars_pre[ra];
        let rate = RATE_W * (c / rho - regions[j].len()).abs();
        // Pauses usually follow punctuation.
        let last = words[b - 1].text.trim_end_matches(['"', '\'', ')', '”', '’']);
        let punct = if last.ends_with(['.', ',', '?', '!', ';', ':', '…', '।']) { 0.0 } else { 1.0 };
        rate + punct + time_pre[j - ja][rb] - time_pre[j - ja][ra]
    };
    // Current cost, to only accept improvements.
    let mut current = 0.0;
    for j in ja..=jb {
        let ks: Vec<usize> = (wa..wb).filter(|&k| assign[k] == j).collect();
        current += match (ks.first(), ks.last()) {
            (Some(&a), Some(&b)) => block_cost(j, a, b + 1),
            _ => block_cost(j, 0, 0),
        };
    }
    // dp[j][b]: best cost with words wa..wa+b assigned to regions ja..ja+j.
    let rows = jb - ja + 1;
    let mut dp = vec![vec![f64::INFINITY; n + 1]; rows + 1];
    let mut from = vec![vec![0usize; n + 1]; rows + 1];
    dp[0][0] = 0.0;
    for jj in 1..=rows {
        let j = ja + jj - 1;
        for b in 0..=n {
            for a in 0..=b {
                let prev = dp[jj - 1][a];
                if !prev.is_finite() {
                    continue;
                }
                let c = prev + if a == b { block_cost(j, 0, 0) } else { block_cost(j, wa + a, wa + b) };
                if c < dp[jj][b] {
                    dp[jj][b] = c;
                    from[jj][b] = a;
                }
            }
        }
    }
    if dp[rows][n] + 0.5 >= current {
        return;
    }
    let mut b = n;
    for jj in (1..=rows).rev() {
        let a = from[jj][b];
        for k in a..b {
            assign[wa + k] = ja + jj - 1;
        }
        b = a;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_phrase_with_collapsed_timestamps_is_realigned() {
        // Real failure: a retake where whisper put take 1's tail into take 2 and
        // stamped all of take 2 at one time.
        let audio = AudioAnalysis {
            duration: 26.0,
            speech: vec![
                Span { start: 1.3, end: 2.98 },
                Span { start: 5.14, end: 5.54 },
                Span { start: 8.46, end: 10.66 },
                Span { start: 12.49, end: 15.25 },
                Span { start: 17.63, end: 18.3 },
                Span { start: 19.2, end: 20.89 },
                Span { start: 22.57, end: 24.86 },
            ],
            ..Default::default()
        };
        let mut words = vec![];
        let mut push = |s: &str, t: f64| words.push(Word { text: s.into(), start: t, end: t, p: 0.9 });
        for (w, t) in [("Okay,", 1.6), ("is", 2.28), ("it", 2.54), ("recording?", 2.9), ("Okay.", 5.44)] {
            push(w, t);
        }
        for (w, t) in [("Three", 8.62), ("things", 8.96), ("to", 9.64), ("do", 9.82), ("before", 13.64), ("your", 13.86), ("dental", 14.16), ("cleaning.", 14.56)] {
            push(w, t);
        }
        for w in ["Three", "things", "to", "do", "before", "your", "dental", "cleaning", "appointment."] {
            push(w, 15.32);
        }
        for (w, t) in [("Number", 17.7), ("1.", 18.0), ("Make", 19.3), ("a", 19.5), ("list", 19.7), ("of", 19.9), ("your", 20.1), ("medications.", 20.4)] {
            push(w, t);
        }
        for (w, t) in [("Your", 22.6), ("dentist", 22.9), ("needs", 23.3), ("to", 23.5), ("know", 23.7), ("about", 23.9), ("blood", 24.2), ("thinners.", 24.5)] {
            push(w, t);
        }
        let t = Transcript { language: "en".into(), model: "base".into(), words };
        let (utts, _) = build_utterances("A1", &t, &audio, 1);
        let texts: Vec<&str> = utts.iter().map(|u| u.text.as_str()).collect();
        assert!(texts.contains(&"Three things to do before your dental cleaning."), "{texts:?}");
        assert!(texts.contains(&"Three things to do before your dental cleaning appointment."), "{texts:?}");
    }

    fn w(text: &str, t: f64) -> Word {
        Word { text: text.into(), start: t, end: t, p: 0.9 }
    }

    #[test]
    fn words_snap_to_regions_and_split_on_pauses() {
        let audio = AudioAnalysis {
            duration: 20.0,
            speech: vec![
                Span { start: 1.6, end: 4.5 },
                Span { start: 6.3, end: 9.3 },
                Span { start: 11.4, end: 12.7 },
                Span { start: 15.1, end: 18.4 },
            ],
            ..Default::default()
        };
        let t = Transcript {
            language: "en".into(),
            model: "base".into(),
            words: vec![
                w("Hi", 1.78),
                w("channel.", 5.14), // in silence, closer to region 0
                w("Today", 6.56),
                w("you,", 9.5),
                w("let", 11.58),
                w("again.", 12.66),
                w("Today", 15.34),
                w("brush.", 18.0),
            ],
        };
        let (utts, words) = build_utterances("A1", &t, &audio, 1);
        assert_eq!(utts.len(), 4);
        assert_eq!(utts[0].text, "Hi channel.");
        assert_eq!(utts[0].start, 1.6);
        assert_eq!(utts[1].text, "Today you,");
        assert_eq!(utts[2].text, "let again.");
        assert_eq!(utts[3].id, "U4");
        assert!(words[1].end <= 4.5);
    }

    #[test]
    fn sound_only_regions_become_sound_utterances() {
        let audio = AudioAnalysis {
            duration: 10.0,
            speech: vec![Span { start: 1.0, end: 2.0 }, Span { start: 4.0, end: 5.0 }],
            ..Default::default()
        };
        let t = Transcript { language: "en".into(), model: "base".into(), words: vec![w("Hello.", 1.2)] };
        let (utts, _) = build_utterances("A1", &t, &audio, 1);
        assert_eq!(utts.len(), 2);
        assert_eq!(utts[1].kind, "sound");
    }
}
