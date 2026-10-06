# Changelog

## 1.0.0

First release.

- Edits talking-head, vlog and YouTube footage with your own Claude Code or Codex CLI (headless, schema-validated), with automatic fallback to the other engine when one runs out of usage.
- Word-timed transcription (whisper.cpp with DTW), waveform-based speech detection and utterance segmentation, so cuts never clip words.
- AI plan → frame-accurate edit: retakes, stumbles, meta talk and dead air removed; hook, sections, B-roll, titles, chapters and YouTube metadata planned.
- Review screen: live preview without rendering, timeline with sections/B-roll/titles/chapters, story and cut lists with restore, edge nudging, titles editor, notes.
- Chat revisions with version history.
- B-roll from your own AI-described library, Pexels or Pixabay; empty slots become Resolve markers.
- Styles with house rules and reference-video analysis (local files or YouTube links).
- Batch editing with separate transcription and AI concurrency limits.
- DaVinci Resolve hand-off: FCPXML 1.10 (validated against Apple's DTD) and a Resolve menu script that imports media, timeline and captions.
- MP4 render (16:9 / 9:16) with B-roll, titles, burned-in captions, ducked music and loudness normalisation; NVENC when available.
- First-run setup that installs FFmpeg, whisper.cpp, Whisper models and yt-dlp, and opens Claude/Codex sign-in.
- Light and dark themes, drag-and-drop, desktop notifications, signed auto-updates.
