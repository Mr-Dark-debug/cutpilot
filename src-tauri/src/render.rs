//! Renders a timeline to MP4 with ffmpeg.
//!
//! Pass A assembles the kept clips in chunks (input seeking + re-encode = frame
//! accurate, short audio fades at every cut). Pass B overlays B-roll, titles and
//! captions, mixes a ducked music bed and normalises loudness to −14 LUFS.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::edit::Timeline;
use crate::project::Project;
use crate::{export, media, tools};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RenderOpts {
    /// "preview" (720p, fast) or "final".
    pub quality: String,
    pub captions: bool,
    /// "16:9" (source framing) or "9:16" (centre crop).
    pub aspect: String,
    pub broll: bool,
    pub titles: bool,
    pub music: bool,
}

impl Default for RenderOpts {
    fn default() -> Self {
        Self { quality: "final".into(), captions: false, aspect: "16:9".into(), broll: true, titles: true, music: true }
    }
}

const CHUNK: usize = 24;

fn even(x: f64) -> u32 {
    ((x / 2.0).round() as u32).max(1) * 2
}

fn out_size(tl: &Timeline, opts: &RenderOpts) -> (u32, u32) {
    let preview = opts.quality == "preview";
    if opts.aspect == "9:16" {
        return if preview { (720, 1280) } else { (1080, 1920) };
    }
    let (w, h) = (tl.width.max(2) as f64, tl.height.max(2) as f64);
    let max_h = if preview { 720.0 } else { 2160.0 };
    if h > max_h {
        (even(w * max_h / h), even(max_h))
    } else {
        (even(w), even(h))
    }
}

/// Scale + pad (contain) or scale + crop (cover) to exactly W×H.
fn fit(w: u32, h: u32, cover: bool) -> String {
    if cover {
        format!("scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}")
    } else {
        format!("scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black")
    }
}

fn font_file() -> Option<PathBuf> {
    font_from(&["arialbd.ttf", "segoeuib.ttf", "arial.ttf"])
}

fn font_from(names: &[&str]) -> Option<PathBuf> {
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
    names.iter().map(|f| PathBuf::from(&windir).join("Fonts").join(f)).find(|p| p.exists())
}

/// Indic scripts (Devanagari, Bengali, Gujarati, Tamil, Telugu…) need Nirmala UI.
fn needs_indic_font(text: &str) -> bool {
    text.chars().any(|c| ('\u{0900}'..='\u{0DFF}').contains(&c))
}

pub async fn render(
    project: &Project,
    tl: &Timeline,
    opts: &RenderOpts,
    out: &Path,
    cancel: &CancellationToken,
    progress: &(dyn Fn(f64, &str) + Send + Sync),
) -> Result<()> {
    if tl.clips.is_empty() {
        bail!("the edit has no clips to render");
    }
    let ffmpeg = tools::ffmpeg()?;
    let work = project.dir().join("work").join("render");
    if work.exists() {
        let _ = std::fs::remove_dir_all(&work);
    }
    std::fs::create_dir_all(&work)?;
    let (w, h) = out_size(tl, opts);
    let fps = format!("{}/{}", tl.fps_num, tl.fps_den);
    let vertical = opts.aspect == "9:16";
    let enc = media::h264_args(&opts.quality).await;

    // ---------------- pass A: assemble clips
    let chunks: Vec<_> = tl.clips.chunks(CHUNK).collect();
    let mut parts = vec![];
    for (ci, chunk) in chunks.iter().enumerate() {
        if cancel.is_cancelled() {
            bail!("cancelled");
        }
        let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-progress", "pipe:1", "-nostats"].map(String::from).to_vec();
        let mut graph = String::new();
        for (i, c) in chunk.iter().enumerate() {
            let src = project.source(&c.source).ok_or_else(|| anyhow::anyhow!("source {} missing", c.source))?;
            let info = src.info.clone().unwrap_or_default();
            let dur = c.src_out - c.src_in;
            args.extend(["-ss".into(), format!("{:.6}", c.src_in), "-t".into(), format!("{dur:.6}"), "-i".into(), src.path.clone()]);
            if info.has_video {
                let _ = write!(graph, "[{i}:v]{},fps={fps},format=yuv420p,setsar=1[v{i}];", fit(w, h, vertical));
            } else {
                let _ = write!(graph, "color=c=black:s={w}x{h}:r={fps}:d={dur:.6},format=yuv420p,setsar=1[v{i}];");
            }
            if info.has_audio {
                let fade = 0.012_f64.min(dur / 4.0);
                let _ = write!(
                    graph,
                    "[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:{dur:.6},afade=t=in:d={fade:.3},afade=t=out:st={:.6}:d={fade:.3}[a{i}];",
                    (dur - fade).max(0.0)
                );
            } else {
                let _ = write!(graph, "anullsrc=r=48000:cl=stereo,atrim=0:{dur:.6}[a{i}];");
            }
        }
        for i in 0..chunk.len() {
            let _ = write!(graph, "[v{i}][a{i}]");
        }
        let _ = write!(graph, "concat=n={}:v=1:a=1[v][a]", chunk.len());
        let part = work.join(format!("part_{ci:03}.mkv"));
        args.extend(["-filter_complex".into(), graph, "-map".into(), "[v]".into(), "-map".into(), "[a]".into()]);
        args.extend(enc.clone());
        args.extend(["-c:a".into(), "pcm_s16le".into(), part.to_string_lossy().to_string()]);
        let chunk_dur: f64 = chunk.iter().map(|c| c.src_out - c.src_in).sum();
        let base = ci as f64 / chunks.len() as f64;
        let span = 1.0 / chunks.len() as f64;
        media::run_with_progress(&ffmpeg, &args, None, chunk_dur, cancel, &|f| {
            progress((base + f * span) * 0.6, "Assembling clips");
        })
        .await?;
        parts.push(part);
    }
    let list = work.join("parts.txt");
    let mut list_txt = String::new();
    for p in &parts {
        let _ = writeln!(list_txt, "file '{}'", p.file_name().unwrap().to_string_lossy());
    }
    std::fs::write(&list, list_txt)?;

    // Measure loudness first so pass B can normalise precisely (two-pass loudnorm).
    progress(0.6, "Measuring loudness");
    let measured = measure_loudness(&ffmpeg, &work, cancel).await.unwrap_or(None);
    let loudnorm = match &measured {
        Some(m) => format!(
            "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={}:measured_TP={}:measured_LRA={}:measured_thresh={}:offset={}:linear=true",
            m.i, m.tp, m.lra, m.thresh, m.offset
        ),
        None => "loudnorm=I=-14:TP=-1.5:LRA=11".to_string(),
    };

    // ---------------- pass B: overlays, captions, audio
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-progress", "pipe:1", "-nostats", "-f", "concat", "-safe", "0", "-i", "parts.txt"]
        .map(String::from)
        .to_vec();
    let mut graph = String::new();
    let mut vlabel = "0:v".to_string();
    let mut input_n = 1;
    let mut video_filtered = false;

    if opts.broll {
        for (k, b) in tl.broll.iter().enumerate() {
            let Some(a) = &b.asset else { continue };
            if !Path::new(&a.path).exists() {
                continue;
            }
            let dur = b.end - b.start;
            if a.is_image {
                args.extend(["-loop".into(), "1".into(), "-t".into(), format!("{dur:.3}"), "-i".into(), a.path.clone()]);
            } else {
                let skip = ((a.duration - dur) / 3.0).max(0.0);
                args.extend([
                    "-stream_loop".into(),
                    "-1".into(),
                    "-ss".into(),
                    format!("{skip:.3}"),
                    "-t".into(),
                    format!("{dur:.3}"),
                    "-i".into(),
                    a.path.clone(),
                ]);
            }
            let _ = write!(
                graph,
                "[{input_n}:v]{},fps={fps},format=yuv420p,setsar=1,setpts=PTS-STARTPTS+{:.6}/TB[b{k}];[{vlabel}][b{k}]overlay=eof_action=pass:enable='between(t,{:.4},{:.4})'[vb{k}];",
                fit(w, h, true),
                b.start,
                b.start,
                b.end
            );
            vlabel = format!("vb{k}");
            input_n += 1;
            video_filtered = true;
        }
    }

    let font = font_file();
    if let Some(f) = &font {
        let _ = std::fs::copy(f, work.join("font.ttf"));
    }
    let indic = tl.titles.iter().any(|t| needs_indic_font(&t.text)) || (opts.captions && tl.captions.iter().any(|c| needs_indic_font(&c.text)));
    if indic {
        if let Some(f) = font_from(&["Nirmala.ttc", "Nirmala.ttf"]) {
            let name = if f.extension().map(|e| e == "ttc").unwrap_or(false) { "indic.ttc" } else { "indic.ttf" };
            let _ = std::fs::copy(&f, work.join(name));
        }
    }
    let indic_font = ["indic.ttc", "indic.ttf"].into_iter().find(|f| work.join(f).exists());
    if opts.titles && font.is_some() {
        for (k, t) in tl.titles.iter().enumerate() {
            std::fs::write(work.join(format!("title_{k}.txt")), &t.text)?;
            let scale = h as f64 / 1080.0;
            let (size, y) = match t.kind.as_str() {
                "lower_third" => ((46.0 * scale) as u32, "h*0.78"),
                "callout" => ((58.0 * scale) as u32, "h*0.70"),
                _ => ((84.0 * scale) as u32, "(h-text_h)/2"),
            };
            let _ = write!(
                graph,
                "[{vlabel}]drawtext=fontfile={}:textfile=title_{k}.txt:expansion=none:fontsize={size}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw={}:x=(w-text_w)/2:y={y}:enable='between(t,{:.4},{:.4})'[vt{k}];",
                match indic_font {
                    Some(f) if needs_indic_font(&t.text) => f,
                    _ => "font.ttf",
                },
                (size as f64 * 0.35) as u32,
                t.start,
                t.end
            );
            vlabel = format!("vt{k}");
            video_filtered = true;
        }
    }
    if opts.captions && !tl.captions.is_empty() {
        std::fs::write(work.join("captions.srt"), export::srt(tl))?;
        let size = if vertical { 14 } else { 18 };
        let margin = if vertical { 70 } else { 30 };
        let cap_font = if indic_font.is_some() && tl.captions.iter().any(|c| needs_indic_font(&c.text)) { "Nirmala UI" } else { "Arial" };
        let _ = write!(
            graph,
            "[{vlabel}]subtitles=captions.srt:fontsdir=.:force_style='FontName={cap_font},FontSize={size},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV={margin}'[vc];"
        );
        vlabel = "vc".into();
        video_filtered = true;
    }

    // Audio.
    let music = project.music.as_ref().filter(|m| opts.music && Path::new(m).exists());
    if let Some(m) = music {
        args.extend(["-stream_loop".into(), "-1".into(), "-t".into(), format!("{:.3}", tl.duration), "-i".into(), m.clone()]);
        let fade_st = (tl.duration - 3.0).max(0.0);
        let _ = write!(
            graph,
            "[0:a]asplit=2[voice][key];[{input_n}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.35,afade=t=out:st={fade_st:.3}:d=3[mus];\
             [mus][key]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=450[duck];\
             [voice][duck]amix=inputs=2:duration=first:normalize=0,{loudnorm},aresample=48000[aout];"
        );
    } else {
        let _ = write!(graph, "[0:a]{loudnorm},aresample=48000[aout];");
    }
    let graph = graph.trim_end_matches(';').to_string();
    args.extend(["-filter_complex".into(), graph]);
    if video_filtered {
        args.extend(["-map".into(), format!("[{vlabel}]")]);
        args.extend(enc.clone());
    } else {
        args.extend(["-map".into(), "0:v".into(), "-c:v".into(), "copy".into()]);
    }
    args.extend(["-map".into(), "[aout]".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    args.extend(["-movflags".into(), "+faststart".into(), "-t".into(), format!("{:.6}", tl.duration)]);
    let tmp_out = out.with_extension("rendering.mp4");
    args.push(tmp_out.to_string_lossy().to_string());
    if let Some(p) = out.parent() {
        std::fs::create_dir_all(p)?;
    }
    media::run_with_progress(&ffmpeg, &args, Some(work.clone()), tl.duration, cancel, &|f| {
        progress(0.6 + f * 0.4, "Adding B-roll, titles and sound");
    })
    .await?;
    if out.exists() {
        let _ = std::fs::remove_file(out);
    }
    std::fs::rename(&tmp_out, out)?;
    let _ = std::fs::remove_dir_all(&work);
    Ok(())
}

struct Loudness {
    i: String,
    tp: String,
    lra: String,
    thresh: String,
    offset: String,
}

/// First loudnorm pass over the assembled audio (cwd = render work dir).
async fn measure_loudness(ffmpeg: &Path, work: &Path, cancel: &CancellationToken) -> Result<Option<Loudness>> {
    let out = crate::proc::run(
        ffmpeg,
        &["-hide_banner", "-nostats", "-f", "concat", "-safe", "0", "-i", "parts.txt", "-vn", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        crate::proc::RunOpts { cwd: Some(work.to_path_buf()), cancel: Some(cancel.clone()), keep_bytes: 256 * 1024, ..Default::default() },
    )
    .await?;
    let text = &out.stderr;
    let (Some(a), Some(b)) = (text.rfind('{'), text.rfind('}')) else { return Ok(None) };
    if b <= a {
        return Ok(None);
    }
    let v: serde_json::Value = match serde_json::from_str(&text[a..=b]) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let g = |k: &str| v[k].as_str().map(String::from);
    let (Some(i), Some(tp), Some(lra), Some(thresh), Some(offset)) = (g("input_i"), g("input_tp"), g("input_lra"), g("input_thresh"), g("target_offset")) else {
        return Ok(None);
    };
    // Silence measures as -inf, which loudnorm can't take back.
    if [&i, &tp, &lra, &thresh, &offset].iter().any(|x| x.contains("inf") || x.contains("nan")) {
        return Ok(None);
    }
    Ok(Some(Loudness { i, tp, lra, thresh, offset }))
}
