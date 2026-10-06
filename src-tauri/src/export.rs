//! Exports: FCPXML 1.10 (DaVinci Resolve / Final Cut Pro), SRT captions and
//! YouTube metadata.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::Path;

use anyhow::Result;

use crate::edit::{Edit, Timeline};
use crate::media::{standard_rate, MediaInfo};
use crate::project::Project;

fn xml_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&apos;"),
            c if (c as u32) < 0x20 && c != '\n' && c != '\t' => {}
            c => o.push(c),
        }
    }
    o
}

/// `file:///D:/My%20Videos/a.mp4`
pub fn file_url(path: &str) -> String {
    let p = path.replace('\\', "/");
    let mut out = String::from("file:///");
    for b in p.trim_start_matches('/').bytes() {
        if b.is_ascii_alphanumeric() || b"-._~/:".contains(&b) {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

/// Rational time for `frames` at the given rate: "N/Ds" (or "0s").
fn rt(frames: i64, num: u32, den: u32) -> String {
    if frames == 0 {
        "0s".into()
    } else {
        format!("{}/{}s", frames * den as i64, num)
    }
}

pub fn fcpxml(project: &Project, edit: &Edit, tl: &Timeline, music: Option<(&str, &MediaInfo)>) -> String {
    let (num, den) = (tl.fps_num, tl.fps_den);
    let fps = tl.fps();
    let fr = |t: f64| (t * fps).round() as i64;
    let mut res = String::new();
    let mut formats: Vec<(String, u32, u32, u32, u32)> = vec![]; // id, w, h, num, den
    let format_for = |w: u32, h: u32, n: u32, d: u32, formats: &mut Vec<(String, u32, u32, u32, u32)>| -> String {
        if let Some(f) = formats.iter().find(|f| f.1 == w && f.2 == h && f.3 == n && f.4 == d) {
            return f.0.clone();
        }
        let id = format!("r{}", formats.len() + 1);
        formats.push((id.clone(), w, h, n, d));
        id
    };
    let seq_fmt = format_for(tl.width, tl.height, num, den, &mut formats);

    // Source assets.
    let mut assets = String::new();
    let mut src_asset: HashMap<String, (String, i64)> = HashMap::new(); // source id → (asset id, tc start frames)
    for (i, s) in project.sources.iter().enumerate() {
        let Some(info) = &s.info else { continue };
        let aid = format!("a{}", i + 1);
        let (sn, sd) = standard_rate(info.fps());
        let fid = if info.has_video { format_for(info.width, info.height, sn, sd, &mut formats) } else { seq_fmt.clone() };
        let tc_frames = fr(info.timecode);
        let dur = fr(info.duration);
        let _ = writeln!(
            assets,
            r#"    <asset id="{aid}" name="{}" start="{}" duration="{}" hasVideo="{}" format="{fid}" hasAudio="{}" audioSources="1" audioChannels="{}" audioRate="{}">
      <media-rep kind="original-media" src="{}"/>
    </asset>"#,
            xml_escape(&s.name),
            rt(tc_frames, num, den),
            rt(dur, num, den),
            info.has_video as u8,
            info.has_audio as u8,
            info.audio_channels.max(1),
            if info.audio_rate > 0 { info.audio_rate } else { 48000 },
            xml_escape(&file_url(&s.path)),
        );
        src_asset.insert(s.id.clone(), (aid, tc_frames));
    }
    // B-roll assets.
    let mut broll_asset: HashMap<String, String> = HashMap::new(); // path → asset id
    for b in &tl.broll {
        let Some(a) = &b.asset else { continue };
        if broll_asset.contains_key(&a.path) {
            continue;
        }
        let aid = format!("b{}", broll_asset.len() + 1);
        let fid = format_for(a.width.max(1), a.height.max(1), num, den, &mut formats);
        let dur = if a.is_image { 0 } else { fr(a.duration) };
        let _ = writeln!(
            assets,
            r#"    <asset id="{aid}" name="{}" start="0s" duration="{}" hasVideo="1" format="{fid}" hasAudio="0">
      <media-rep kind="original-media" src="{}"/>
    </asset>"#,
            xml_escape(&crate::util::file_stem(&a.path)),
            rt(dur, num, den),
            xml_escape(&file_url(&a.path)),
        );
        broll_asset.insert(a.path.clone(), aid);
    }
    let music_aid = music.map(|(path, info)| {
        let _ = writeln!(
            assets,
            r#"    <asset id="m1" name="{}" start="0s" duration="{}" hasVideo="0" hasAudio="1" audioSources="1" audioChannels="{}" audioRate="{}">
      <media-rep kind="original-media" src="{}"/>
    </asset>"#,
            xml_escape(&crate::util::file_stem(path)),
            rt(fr(info.duration), num, den),
            info.audio_channels.max(1),
            if info.audio_rate > 0 { info.audio_rate } else { 48000 },
            xml_escape(&file_url(path)),
        );
        ("m1".to_string(), info.duration)
    });

    let _ = writeln!(res, "  <resources>");
    for (id, w, h, n, d) in &formats {
        let _ = writeln!(
            res,
            r#"    <format id="{id}" name="FFVideoFormat{h}p{}" frameDuration="{d}/{n}s" width="{w}" height="{h}"/>"#,
            (*n as f64 / *d as f64 * 100.0).round() / 100.0
        );
    }
    res.push_str(&assets);
    let has_titles = !tl.titles.is_empty();
    if has_titles {
        let _ = writeln!(
            res,
            r#"    <effect id="fx1" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>"#
        );
    }
    let _ = writeln!(res, "  </resources>");

    // Spine.
    let mut spine = String::new();
    let mut title_n = 0;
    for (ci, c) in tl.clips.iter().enumerate() {
        let Some((aid, tc)) = src_asset.get(&c.source) else { continue };
        let clip_start = tc + c.frames_in; // in asset time
        let clip_off = c.frames_start;
        let clip_end_tl = c.frames_start + c.frames_len;
        let name = edit.segments.get(c.segment).map(|s| s.label.clone()).filter(|l| !l.is_empty()).unwrap_or_else(|| c.clip_id.clone());
        let _ = writeln!(
            spine,
            r#"          <asset-clip ref="{aid}" offset="{}" name="{}" start="{}" duration="{}" tcFormat="NDF">"#,
            rt(clip_off, num, den),
            xml_escape(&name),
            rt(clip_start, num, den),
            rt(c.frames_len, num, den),
        );
        // DTD order: connected clips/titles first, then markers.
        let mut conn = String::new();
        let mut marks = String::new();
        // Converts a timeline frame inside this clip to the clip's local (asset) time.
        let local = |tl_frame: i64| clip_start + (tl_frame - clip_off);
        let inside = |t: f64| {
            let f = fr(t);
            f >= clip_off && f < clip_end_tl
        };
        // Segment start marker.
        if ci == 0 || tl.clips[ci - 1].segment != c.segment {
            if let Some(seg) = edit.segments.get(c.segment) {
                if !seg.label.is_empty() {
                    let _ = writeln!(
                        marks,
                        r#"            <marker start="{}" duration="{}" value="{}" note="{}"/>"#,
                        rt(local(clip_off), num, den),
                        rt(1, num, den),
                        xml_escape(&seg.label),
                        xml_escape(&seg.reason)
                    );
                }
            }
        }
        for ch in tl.chapters.iter().filter(|m| inside(m.start)) {
            let _ = writeln!(
                marks,
                r#"            <chapter-marker start="{}" duration="{}" value="{}" posterOffset="0s"/>"#,
                rt(local(fr(ch.start)), num, den),
                rt(1, num, den),
                xml_escape(&ch.title)
            );
        }
        if ci == 0 {
            if let Some((mid, mdur)) = &music_aid {
                let len = fr(*mdur).min(fr(tl.duration));
                let _ = writeln!(
                    conn,
                    r#"            <asset-clip ref="{mid}" lane="-1" offset="{}" name="Music" start="0s" duration="{}">
              <adjust-volume amount="-18dB"/>
            </asset-clip>"#,
                    rt(local(0), num, den),
                    rt(len, num, den)
                );
            }
        }
        for b in tl.broll.iter().filter(|b| inside(b.start)) {
            let start_f = fr(b.start);
            let len = (fr(b.end) - start_f).max(1);
            match b.asset.as_ref().and_then(|a| broll_asset.get(&a.path).map(|id| (a, id))) {
                Some((a, bid)) => {
                    let _ = writeln!(
                        conn,
                        r#"            <asset-clip ref="{bid}" lane="1" offset="{}" name="{}" start="0s" duration="{}" audioRole="dialogue" enabled="1"/>"#,
                        rt(local(start_f), num, den),
                        xml_escape(&format!("B-roll: {}", if b.query.is_empty() { crate::util::file_stem(&a.path) } else { b.query.clone() })),
                        rt(len, num, den)
                    );
                }
                None => {
                    let _ = writeln!(
                        marks,
                        r#"            <marker start="{}" duration="{}" value="{}" note="Add B-roll here ({:.1}s)"/>"#,
                        rt(local(start_f), num, den),
                        rt(len, num, den),
                        xml_escape(&format!("B-ROLL: {}", b.query)),
                        b.end - b.start
                    );
                }
            }
        }
        for t in tl.titles.iter().filter(|t| inside(t.start)) {
            title_n += 1;
            let start_f = fr(t.start);
            let len = (fr(t.end) - start_f).max(1);
            let (size, pos) = match t.kind.as_str() {
                "lower_third" => (54, "0 -380"),
                "callout" => (64, "0 -300"),
                _ => (88, "0 0"),
            };
            let _ = writeln!(
                conn,
                r#"            <title ref="fx1" lane="2" offset="{}" name="{}" start="0s" duration="{}">
              <param name="Position" key="9999/999166631/999166633/1/100/101" value="{pos}"/>
              <text>
                <text-style ref="ts{title_n}">{}</text-style>
              </text>
              <text-style-def id="ts{title_n}">
                <text-style font="Arial" fontSize="{size}" fontFace="Bold" fontColor="1 1 1 1" bold="1" shadowColor="0 0 0 0.75" shadowOffset="4 315" alignment="center"/>
              </text-style-def>
            </title>"#,
                rt(local(start_f), num, den),
                xml_escape(&t.text),
                rt(len, num, den),
                xml_escape(&t.text),
            );
        }
        spine.push_str(&conn);
        spine.push_str(&marks);
        let _ = writeln!(spine, "          </asset-clip>");
    }

    let total = tl.clips.iter().map(|c| c.frames_len).sum::<i64>();
    let mut out = String::new();
    let _ = writeln!(out, r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    let _ = writeln!(out, "<!DOCTYPE fcpxml>");
    let _ = writeln!(out, r#"<fcpxml version="1.10">"#);
    out.push_str(&res);
    let _ = writeln!(out, "  <library>");
    let _ = writeln!(out, r#"    <event name="CutPilot">"#);
    let name = if edit.title.trim().is_empty() { project.name.clone() } else { format!("{} (v{})", project.name, edit.version) };
    let _ = writeln!(out, r#"      <project name="{}">"#, xml_escape(&name));
    let _ = writeln!(
        out,
        r#"        <sequence format="{seq_fmt}" duration="{}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">"#,
        rt(total, num, den)
    );
    let _ = writeln!(out, "        <spine>");
    out.push_str(&spine);
    let _ = writeln!(out, "        </spine>");
    let _ = writeln!(out, "        </sequence>");
    let _ = writeln!(out, "      </project>");
    let _ = writeln!(out, "    </event>");
    let _ = writeln!(out, "  </library>");
    let _ = writeln!(out, "</fcpxml>");
    out
}

fn srt_time(t: f64) -> String {
    let ms = (t.max(0.0) * 1000.0).round() as u64;
    format!("{:02}:{:02}:{:02},{:03}", ms / 3_600_000, (ms / 60_000) % 60, (ms / 1000) % 60, ms % 1000)
}

pub fn srt(tl: &Timeline) -> String {
    let mut out = String::new();
    for (i, c) in tl.captions.iter().enumerate() {
        let _ = writeln!(out, "{}\n{} --> {}\n{}\n", i + 1, srt_time(c.start), srt_time(c.end), c.text);
    }
    out
}

fn yt_time(t: f64) -> String {
    let s = t.max(0.0).floor() as u64;
    if s >= 3600 {
        format!("{}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
    } else {
        format!("{}:{:02}", s / 60, s % 60)
    }
}

pub fn youtube_markdown(project: &Project, edit: &Edit, tl: &Timeline) -> String {
    let y = &edit.youtube;
    let mut out = String::new();
    let _ = writeln!(out, "# {}\n", project.name);
    let _ = writeln!(out, "Edit v{} · {} · {}\n", edit.version, yt_time(tl.duration), edit.engine);
    let _ = writeln!(out, "## Title options");
    for t in &y.titles {
        let _ = writeln!(out, "- {t}");
    }
    let _ = writeln!(out, "\n## Description\n\n{}", y.description.trim());
    if tl.chapters.len() >= 3 && tl.duration >= 60.0 {
        let _ = writeln!(out);
        for c in &tl.chapters {
            let _ = writeln!(out, "{} {}", yt_time(c.start), c.title);
        }
    }
    let _ = writeln!(out, "\n## Tags\n\n{}", y.tags.join(", "));
    let _ = writeln!(out, "\n## Thumbnail text\n\n{}", y.thumbnail_text);
    let credits: Vec<String> = tl
        .broll
        .iter()
        .filter_map(|b| b.asset.as_ref())
        .filter(|a| !a.credit.is_empty())
        .map(|a| format!("- {} {}", a.credit, a.url))
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    if !credits.is_empty() {
        let _ = writeln!(out, "\n## Stock footage credits\n\n{}", credits.join("\n"));
    }
    if !edit.notes.trim().is_empty() {
        let _ = writeln!(out, "\n## Editor notes (check before publishing)\n\n{}", edit.notes.trim());
    }
    out
}

pub fn write(path: &Path, content: &str) -> Result<()> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rational_times() {
        assert_eq!(rt(0, 30, 1), "0s");
        assert_eq!(rt(45, 30, 1), "45/30s");
        assert_eq!(rt(30, 30000, 1001), "30030/30000s");
    }

    #[test]
    fn file_urls_are_encoded() {
        assert_eq!(file_url(r"D:\My Videos\a&b.mp4"), "file:///D:/My%20Videos/a%26b.mp4");
    }

    #[test]
    fn srt_format() {
        assert_eq!(srt_time(3661.5), "01:01:01,500");
    }
}
