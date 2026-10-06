//! ffprobe/ffmpeg helpers and audio analysis.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::{proc, tools};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaInfo {
    pub duration: f64,
    pub has_video: bool,
    pub has_audio: bool,
    /// Display size (rotation applied).
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub vcodec: String,
    pub acodec: String,
    pub container: String,
    pub audio_rate: u32,
    pub audio_channels: u32,
    pub rotation: i32,
    /// Embedded start timecode in seconds (camera files), 0 if none.
    pub timecode: f64,
}

impl MediaInfo {
    pub fn fps(&self) -> f64 {
        if self.fps_den == 0 {
            30.0
        } else {
            self.fps_num as f64 / self.fps_den as f64
        }
    }
    pub fn is_image(&self) -> bool {
        self.has_video && self.duration <= 0.05
    }
}

fn parse_rate(s: &str) -> Option<(u32, u32)> {
    let (a, b) = s.split_once('/')?;
    let (a, b) = (a.parse::<u32>().ok()?, b.parse::<u32>().ok()?);
    (a > 0 && b > 0).then_some((a, b))
}

/// Snaps a measured frame rate to the nearest standard timeline rate.
pub fn standard_rate(fps: f64) -> (u32, u32) {
    let table: [(u32, u32); 9] =
        [(24000, 1001), (24, 1), (25, 1), (30000, 1001), (30, 1), (48, 1), (50, 1), (60000, 1001), (60, 1)];
    let mut best = (30, 1);
    let mut diff = f64::MAX;
    for (n, d) in table {
        let r = n as f64 / d as f64;
        if (r - fps).abs() < diff {
            diff = (r - fps).abs();
            best = (n, d);
        }
    }
    best
}

pub async fn probe(path: &Path) -> Result<MediaInfo> {
    let ffprobe = tools::ffprobe()?;
    let p = path.to_string_lossy().to_string();
    let out = proc::capture(
        &ffprobe,
        &["-v", "error", "-print_format", "json", "-show_format", "-show_streams", p.as_str()],
        60,
    )
    .await?;
    if !out.ok() {
        bail!("can't read {}: {}", path.display(), out.tail(3));
    }
    let v: serde_json::Value = serde_json::from_str(&out.stdout).context("ffprobe output")?;
    let mut info = MediaInfo {
        duration: v["format"]["duration"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0.0),
        container: v["format"]["format_name"].as_str().unwrap_or("").into(),
        ..Default::default()
    };
    for s in v["streams"].as_array().cloned().unwrap_or_default() {
        match s["codec_type"].as_str() {
            Some("video") if !info.has_video => {
                // Skip cover-art streams in audio files.
                if s["disposition"]["attached_pic"].as_i64() == Some(1) {
                    continue;
                }
                info.has_video = true;
                info.vcodec = s["codec_name"].as_str().unwrap_or("").into();
                let w = s["width"].as_u64().unwrap_or(0) as u32;
                let h = s["height"].as_u64().unwrap_or(0) as u32;
                let mut rot = s["tags"]["rotate"].as_str().and_then(|r| r.parse::<i32>().ok()).unwrap_or(0);
                if let Some(sd) = s["side_data_list"].as_array() {
                    for d in sd {
                        if let Some(r) = d["rotation"].as_i64() {
                            rot = r as i32;
                        }
                    }
                }
                info.rotation = rot;
                if rot.abs() % 180 == 90 {
                    (info.width, info.height) = (h, w);
                } else {
                    (info.width, info.height) = (w, h);
                }
                let rate = parse_rate(s["avg_frame_rate"].as_str().unwrap_or(""))
                    .or_else(|| parse_rate(s["r_frame_rate"].as_str().unwrap_or("")))
                    .unwrap_or((30, 1));
                (info.fps_num, info.fps_den) = rate;
                if info.duration <= 0.0 {
                    info.duration = s["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0);
                }
            }
            Some("audio") if !info.has_audio => {
                info.has_audio = true;
                info.acodec = s["codec_name"].as_str().unwrap_or("").into();
                info.audio_rate = s["sample_rate"].as_str().and_then(|r| r.parse().ok()).unwrap_or(48000);
                info.audio_channels = s["channels"].as_u64().unwrap_or(2) as u32;
            }
            _ => {}
        }
    }
    if !info.has_video && !info.has_audio {
        bail!("{} has no audio or video stream", path.display());
    }
    let tc = v["format"]["tags"]["timecode"].as_str().map(String::from).or_else(|| {
        v["streams"].as_array().and_then(|a| a.iter().find_map(|s| s["tags"]["timecode"].as_str().map(String::from)))
    });
    if let Some(tc) = tc {
        info.timecode = parse_timecode(&tc, info.fps());
    }
    Ok(info)
}

/// "HH:MM:SS:FF" (or ';' for drop-frame) → seconds.
pub fn parse_timecode(tc: &str, fps: f64) -> f64 {
    let parts: Vec<f64> = tc.split([':', ';', '.']).filter_map(|p| p.trim().parse().ok()).collect();
    if parts.len() != 4 {
        return 0.0;
    }
    let nominal = fps.round().max(1.0);
    let total_frames = ((parts[0] * 3600.0 + parts[1] * 60.0 + parts[2]) * nominal + parts[3]).max(0.0);
    total_frames / nominal * (nominal / fps)
}

/// True if WebView2 can't be trusted to play/seek this file directly.
pub fn needs_proxy(path: &Path, info: &MediaInfo) -> bool {
    if !info.has_video {
        return false;
    }
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let container_ok = matches!(ext.as_str(), "mp4" | "m4v" | "webm");
    let codec_ok = matches!(info.vcodec.as_str(), "h264" | "vp8" | "vp9" | "av1");
    let audio_ok = !info.has_audio || matches!(info.acodec.as_str(), "aac" | "mp3" | "opus" | "vorbis");
    !(container_ok && codec_ok && audio_ok) || info.height > 1440
}

/// 16 kHz mono WAV for analysis/transcription; `limit` caps the length (seconds).
pub async fn extract_audio(src: &Path, wav: &Path, limit: Option<f64>, cancel: &CancellationToken) -> Result<()> {
    let ffmpeg = tools::ffmpeg()?;
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-i"].map(String::from).to_vec();
    args.push(src.to_string_lossy().to_string());
    if let Some(l) = limit {
        args.extend(["-t".into(), format!("{l:.3}")]);
    }
    args.extend(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"].map(String::from));
    args.push(wav.to_string_lossy().to_string());
    proc::run_ok(
        &ffmpeg,
        &args,
        proc::RunOpts { cancel: Some(cancel.clone()), keep_bytes: 64 * 1024, ..Default::default() },
    )
    .await?;
    Ok(())
}

/// Reads 16-bit mono PCM samples from a WAV file.
pub fn read_wav_mono16(path: &Path) -> Result<(u32, Vec<i16>)> {
    let bytes = std::fs::read(path)?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        bail!("not a WAV file");
    }
    let mut pos = 12;
    let mut rate = 16000;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 8 <= bytes.len() {
            rate = u32::from_le_bytes(bytes[body + 4..body + 8].try_into().unwrap());
        } else if id == b"data" {
            let end = (body + size).min(bytes.len());
            let samples = bytes[body..end].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
            return Ok((rate, samples));
        }
        pos = body + size + (size & 1);
    }
    bail!("WAV has no data chunk")
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Span {
    pub start: f64,
    pub end: f64,
}

impl Span {
    pub fn len(&self) -> f64 {
        self.end - self.start
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioAnalysis {
    pub duration: f64,
    /// Speech (non-silent) regions, acoustically exact.
    pub speech: Vec<Span>,
    /// Gaps between speech regions.
    pub silences: Vec<Span>,
    /// Level peaks for the waveform, 20 per second, 0-100.
    pub peaks: Vec<u8>,
    pub threshold_db: f64,
    pub noise_floor_db: f64,
    pub speech_level_db: f64,
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return -90.0;
    }
    let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

/// Energy-based voice activity: adaptive threshold between the noise floor and the
/// speech level, short gaps bridged, clicks dropped.
pub fn analyze_audio(wav: &Path) -> Result<AudioAnalysis> {
    let (rate, samples) = read_wav_mono16(wav)?;
    let hop = (rate / 100).max(1) as usize; // 10 ms frames
    let n = samples.len() / hop;
    let duration = samples.len() as f64 / rate as f64;
    let mut db = Vec::with_capacity(n);
    for i in 0..n {
        let frame = &samples[i * hop..(i + 1) * hop];
        let sum: f64 = frame.iter().map(|&s| (s as f64) * (s as f64)).sum();
        let rms = (sum / hop as f64).sqrt() / 32768.0;
        db.push(if rms > 0.0 { (20.0 * rms.log10()).max(-90.0) } else { -90.0 });
    }
    let mut sorted = db.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let floor = percentile(&sorted, 0.10);
    let loud = percentile(&sorted, 0.95);
    let threshold = (floor + 0.30 * (loud - floor)).clamp(-55.0, -26.0);

    let mut speech_frames: Vec<bool> = db.iter().map(|&d| d > threshold).collect();
    // Bridge gaps shorter than 150 ms.
    let bridge = 15;
    let mut i = 0;
    while i < n {
        if !speech_frames[i] {
            let start = i;
            while i < n && !speech_frames[i] {
                i += 1;
            }
            if start > 0 && i < n && i - start < bridge {
                for f in &mut speech_frames[start..i] {
                    *f = true;
                }
            }
        } else {
            i += 1;
        }
    }
    // Collect runs; drop clicks shorter than 80 ms.
    let mut speech = vec![];
    let mut i = 0;
    while i < n {
        if speech_frames[i] {
            let start = i;
            while i < n && speech_frames[i] {
                i += 1;
            }
            if i - start >= 8 {
                speech.push(Span { start: start as f64 / 100.0, end: (i as f64 / 100.0).min(duration) });
            }
        } else {
            i += 1;
        }
    }
    let mut silences = vec![];
    let mut cursor = 0.0;
    for s in &speech {
        if s.start - cursor > 0.01 {
            silences.push(Span { start: cursor, end: s.start });
        }
        cursor = s.end;
    }
    if duration - cursor > 0.01 {
        silences.push(Span { start: cursor, end: duration });
    }
    // Waveform peaks, 50 ms buckets.
    let bucket = (rate / 20).max(1) as usize;
    let peaks = samples
        .chunks(bucket)
        .map(|c| {
            let m = c.iter().map(|s| (*s as i32).unsigned_abs()).max().unwrap_or(0) as f64 / 32768.0;
            // Perceptual-ish scaling so quiet speech is still visible.
            ((m.sqrt()) * 100.0).round().min(100.0) as u8
        })
        .collect();
    Ok(AudioAnalysis {
        duration,
        speech,
        silences,
        peaks,
        threshold_db: threshold,
        noise_floor_db: floor,
        speech_level_db: loud,
    })
}

/// Scene-change timestamps (seconds).
pub async fn detect_scenes(src: &Path, threshold: f64, limit: Option<f64>, cancel: &CancellationToken) -> Result<Vec<f64>> {
    let ffmpeg = tools::ffmpeg()?;
    let vf = format!("scale=320:-2,select='gt(scene\\,{threshold})',showinfo");
    let mut args: Vec<String> = ["-hide_banner", "-nostats", "-i"].map(String::from).to_vec();
    args.push(src.to_string_lossy().to_string());
    if let Some(l) = limit {
        args.extend(["-t".into(), format!("{l:.3}")]);
    }
    args.extend(["-an", "-sn", "-vf", &vf, "-f", "null", "-"].map(String::from));
    let out = proc::run(
        &ffmpeg,
        &args,
        proc::RunOpts { cancel: Some(cancel.clone()), keep_bytes: 4 * 1024 * 1024, ..Default::default() },
    )
    .await?;
    if !out.ok() {
        bail!("scene detection failed: {}", out.tail(4));
    }
    let re = regex::Regex::new(r"pts_time:\s*([0-9.]+)").unwrap();
    let mut cuts: Vec<f64> = out
        .stderr
        .lines()
        .filter(|l| l.contains("showinfo"))
        .filter_map(|l| re.captures(l).and_then(|c| c[1].parse().ok()))
        .collect();
    cuts.dedup_by(|a, b| (*a - *b).abs() < 0.2);
    Ok(cuts)
}

fn font_arg() -> Option<String> {
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
    for f in ["arialbd.ttf", "arial.ttf", "segoeui.ttf"] {
        let p = PathBuf::from(&windir).join("Fonts").join(f);
        if p.exists() {
            return Some(p.to_string_lossy().replace('\\', "/").replace(':', "\\:"));
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub path: String,
    pub start: f64,
    pub end: f64,
    pub step: f64,
}

/// Timestamped frame grids (4×3) covering the whole video, at most `max_sheets`.
pub async fn contact_sheets(
    src: &Path,
    duration: f64,
    out_dir: &Path,
    max_sheets: usize,
    cancel: &CancellationToken,
) -> Result<Vec<Sheet>> {
    std::fs::create_dir_all(out_dir)?;
    let ffmpeg = tools::ffmpeg()?;
    let per = 12.0;
    let step = (duration / (per * max_sheets as f64)).max(4.0);
    let span = step * per;
    let count = ((duration / span).ceil() as usize).max(1);
    let font = font_arg();
    let mut sheets = vec![];
    for k in 0..count {
        if cancel.is_cancelled() {
            bail!("cancelled");
        }
        let start = k as f64 * span;
        let len = span.min(duration - start);
        if len <= 0.2 {
            break;
        }
        let out = out_dir.join(format!("sheet_{k:02}.jpg"));
        let label = match &font {
            Some(f) => format!(
                ",drawtext=fontfile='{f}':text='%{{pts\\:hms\\:{start:.2}}}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4"
            ),
            None => String::new(),
        };
        let vf = format!("fps=1/{step:.3},scale=384:-2{label},tile=4x3:padding=4:margin=4:color=0x111111");
        let (s, o) = (src.to_string_lossy().to_string(), out.to_string_lossy().to_string());
        let st = format!("{start:.3}");
        let ln = format!("{len:.3}");
        proc::run_ok(
            &ffmpeg,
            &["-hide_banner", "-loglevel", "error", "-y", "-ss", &st, "-t", &ln, "-i", &s, "-vf", &vf, "-frames:v", "1", "-q:v", "5", &o],
            proc::RunOpts { cancel: Some(cancel.clone()), keep_bytes: 64 * 1024, ..Default::default() },
        )
        .await?;
        sheets.push(Sheet { path: o, start, end: start + len, step });
    }
    Ok(sheets)
}

pub async fn thumbnail(src: &Path, at: f64, out: &Path, width: u32) -> Result<()> {
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let ffmpeg = tools::ffmpeg()?;
    let (s, o) = (src.to_string_lossy().to_string(), out.to_string_lossy().to_string());
    let t = format!("{:.3}", at.max(0.0));
    let vf = format!("scale={width}:-2");
    let res = proc::run_ok(
        &ffmpeg,
        &["-hide_banner", "-loglevel", "error", "-y", "-ss", &t, "-i", &s, "-frames:v", "1", "-vf", &vf, "-q:v", "4", &o],
        proc::RunOpts { keep_bytes: 32 * 1024, timeout: Some(std::time::Duration::from_secs(60)), ..Default::default() },
    )
    .await;
    if res.is_err() && at > 0.0 {
        // Seeking past the end of short clips fails – fall back to the first frame.
        return Box::pin(thumbnail(src, 0.0, out, width)).await;
    }
    res.map(|_| ())
}

static NVENC: Mutex<Option<bool>> = Mutex::new(None);

/// Whether ffmpeg can encode H.264 on an NVIDIA GPU here.
pub async fn has_nvenc() -> bool {
    if let Some(v) = *NVENC.lock().unwrap() {
        return v;
    }
    let ok = match tools::ffmpeg() {
        Ok(ff) => proc::capture(
            &ff,
            &["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.2", "-c:v", "h264_nvenc", "-f", "null", "-"],
            30,
        )
        .await
        .map(|o| o.ok())
        .unwrap_or(false),
        Err(_) => false,
    };
    *NVENC.lock().unwrap() = Some(ok);
    ok
}

/// H.264 encoder args. `quality`: "preview" (fast) or "final".
pub async fn h264_args(quality: &str) -> Vec<String> {
    let v: Vec<&str> = if has_nvenc().await {
        if quality == "final" {
            vec!["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0", "-profile:v", "high"]
        } else {
            vec!["-c:v", "h264_nvenc", "-preset", "p2", "-rc", "vbr", "-cq", "26", "-b:v", "0"]
        }
    } else if quality == "final" {
        vec!["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-profile:v", "high"]
    } else {
        vec!["-c:v", "libx264", "-preset", "veryfast", "-crf", "25"]
    };
    let mut v: Vec<String> = v.into_iter().map(String::from).collect();
    v.extend(["-pix_fmt".into(), "yuv420p".into()]);
    v
}

/// 720p H.264 proxy for smooth playback in the app.
pub async fn make_proxy(src: &Path, out: &Path, duration: f64, cancel: &CancellationToken, progress: &(dyn Fn(f64) + Send + Sync)) -> Result<()> {
    let ffmpeg = tools::ffmpeg()?;
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-progress", "pipe:1", "-nostats", "-i"]
        .into_iter()
        .map(String::from)
        .collect();
    args.push(src.to_string_lossy().to_string());
    args.extend(["-vf", "scale=-2:'min(720,ih)'", "-g", "30"].map(String::from));
    args.extend(h264_args("preview").await);
    args.extend(["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"].map(String::from));
    args.push(out.to_string_lossy().to_string());
    run_with_progress(&ffmpeg, &args, None, duration, cancel, progress).await
}

/// Runs ffmpeg with `-progress pipe:1` and reports a 0..1 fraction of `total` seconds.
pub async fn run_with_progress(
    ffmpeg: &Path,
    args: &[String],
    cwd: Option<PathBuf>,
    total: f64,
    cancel: &CancellationToken,
    progress: &(dyn Fn(f64) + Send + Sync),
) -> Result<()> {
    let parse = progress_parser(total.max(0.1));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<f64>();
    let fut = proc::run_ok(
        ffmpeg,
        args,
        proc::RunOpts {
            cwd,
            cancel: Some(cancel.clone()),
            keep_bytes: 64 * 1024,
            on_stdout: Some(Box::new(move |line| {
                if let Some(f) = parse(line) {
                    let _ = tx.send(f);
                }
            })),
            ..Default::default()
        },
    );
    tokio::pin!(fut);
    loop {
        tokio::select! {
            r = &mut fut => { r?; break; }
            Some(f) = rx.recv() => progress(f),
        }
    }
    Ok(())
}

/// Parses ffmpeg `-progress` lines into a 0..1 fraction.
pub fn progress_parser(total: f64) -> impl Fn(&str) -> Option<f64> + Send + Sync {
    move |line: &str| {
        let v = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="))?;
        let us: f64 = v.trim().parse().ok()?;
        Some((us / 1e6 / total).clamp(0.0, 1.0))
    }
}
