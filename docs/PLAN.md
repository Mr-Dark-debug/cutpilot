# CutPilot — build plan

CutPilot is a Windows desktop app that edits talking-head / vlog / YouTube footage by
writing the edit as **data** (an edit decision list) instead of driving an NLE.
The AI never touches pixels: it reads a transcript, pause/scene data and contact
sheets, then returns a JSON plan. CutPilot turns that plan into a DaVinci Resolve
timeline (FCPXML), captions (SRT), YouTube metadata, and optionally a finished MP4.
Many videos can be planned in parallel; you only review.

## Engines

The app does not hold any AI credentials. It spawns the official CLIs you are
already signed in to:

| Engine | Detection | Run |
|---|---|---|
| Claude Code | `claude --version`, `claude auth status` (JSON) | `claude -p --output-format stream-json --json-schema <schema>` (prompt on stdin) |
| Codex CLI | `codex --version`, `codex login status` (exit code) | `codex exec --json --output-schema <file> -o <file> -m <model> -` |

Codex models are read from `~/.codex/models_cache.json` and passed with `-m`
explicitly (a user config may point at a model the account can't use).
Missing CLIs can be installed and signed in from Settings (opens a terminal).

## Pipeline (per video project)

1. **Probe** – ffprobe: duration, fps, size, rotation, audio.
2. **Audio** – 16 kHz mono WAV.
3. **Transcribe** – whisper.cpp (`whisper-cli`) → word-level timestamps.
4. **Analyze** – silences (ffmpeg `silencedetect`), scene cuts, waveform peaks,
   contact sheets (timestamped frame grids) and *utterances*: words grouped at
   pauses/sentence ends, each with a stable id (`U12`).
5. **References** – each reference video/URL (yt-dlp) gets the same analysis plus
   pacing metrics (cuts/min, shot length, WPM, pause ratio) and an AI style summary.
6. **Plan** – the engine gets the brief, style rules, reference style, utterance
   table, library B-roll list and (optionally) contact sheets, and returns a plan that
   references utterance **ids**, never raw timestamps (prevents hallucinated cuts).
   Retakes, fluff and dead air are dropped; B-roll, titles and chapters are anchored
   to utterances. Invalid ids are dropped with warnings; empty plans are retried.
7. **Resolve plan → edit** – ids become frame-accurate clips; pauses inside kept
   runs are tightened to the style's pause length; edges are snapped to word
   boundaries with small handles.
8. **B-roll** – library clip if the plan picked one, else Pexels / Pixabay search
   (API keys optional). Unfilled slots become timeline markers.
9. **Export** – FCPXML 1.10 (spine + connected B-roll + titles + markers), SRT,
   YouTube title/description/tags/chapters.
10. **Render (optional)** – ffmpeg: frame-accurate clip assembly, B-roll overlays,
    titles, burned captions, music bed, loudness normalisation to −14 LUFS,
    NVENC when available. 16:9 or 9:16.

Everything is cached per stage on disk, so re-planning never re-transcribes.

## Review & revise

- Instant preview: the player skips removed parts of the source live and overlays
  B-roll — no render needed.
- Transcript view: every clip with its words; toggle/trim clips, toggle/swap B-roll,
  edit titles. Manual edits autosave.
- Chat revisions ("tighter intro, more B-roll in the middle") create a new edit
  version; any version can be restored.

## Batch

Drop many videos → one project each, same style/brief/engine. A job queue runs
transcription (CPU/GPU bound) and AI planning (token bound) with separate
concurrency limits.

## DaVinci Resolve hand-off

- Export FCPXML → `File ▸ Import ▸ Timeline…` (works in free Resolve).
- “Send to Resolve” also installs a Lua menu script
  (`Workspace ▸ Scripts ▸ CutPilot Import`) that imports the media + timeline of the
  last project sent, and launches Resolve if needed.

## Tools

ffmpeg, whisper.cpp + model and yt-dlp are detected on PATH or downloaded into
`%LOCALAPPDATA%\CutPilot\tools` on first run from their official release pages.

## Releases & updates

- Tauri v2, NSIS installer, `tauri-plugin-updater` with signed updates.
- GitHub Actions builds on `v*` tags and publishes a normal (non-draft,
  non-prerelease) release with `latest.json`.
- The app checks `releases/latest/download/latest.json` at start-up and from
  Settings, shows the changelog, downloads, installs and relaunches.

## Not in scope (by decision)

- AI-generated B-roll: generated people, products and places are often wrong;
  stock + own footage is safer for credibility.
- Colour grading, effects and transitions beyond cross-dissolves: Resolve ignores
  most of them on FCPXML import, so they stay manual.
