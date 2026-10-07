# Changelog

## 1.1.0

A redesign of the workspace and a real editing timeline.

- **Timeline editor:** titles, B-roll, video and audio-waveform tracks with timecode ruler, chapter flags, zoom (Ctrl+wheel / slider / fit), snapping, ripple trim by dragging clip edges, drag clips to reorder, move and resize B-roll and titles, split at playhead (S), delete (Del) and undo/redo (Ctrl+Z / Ctrl+Y).
- **Resizable workspace:** player, timeline and details panels resize vertically; the AI chat resizes and collapses. Layouts are remembered.
- **AI chat:** choose the model and reasoning effort right in the chat, see what the AI is doing live (thinking, looking at frames, writing decisions), and "Thought for Xs" with the steps on every reply. Versions moved into the ⋯ menu, with "Switch to this version" on each reply.
- **New model picker** with Claude and OpenAI logos, favourites, search and Ctrl+1–9 shortcuts, plus a reasoning-effort picker.
- **15 detailed editing styles** for common video types (talking head, vlog, travel, tutorial, explainer, podcast, Shorts/Reels, review, gaming, cooking, fitness, course, documentary, reaction, promo), with a searchable, grouped style picker.
- **Spotlight search (Ctrl+K)** across projects, styles, B-roll clips, settings and actions.
- **Sidebar:** collapses to an icon rail (Ctrl+B); projects are listed under Projects like chats; AI engine status moved to Settings with proper logos.
- **DaVinci Resolve** is now found wherever it's installed (Start-menu shortcut or a path you choose) and shows its version; new Resolve card in Settings ▸ Tools.
- Cleaner Studio screen; no coloured focus rings on inputs.
- Fixed: B-roll thumbnails from projects made before 1.0.1 didn't show.

## 1.0.2

- If the chosen AI engine is signed out, missing or out of usage, the edit continues with the other signed-in engine, and new projects default to an engine that is ready.
- Titles with a % sign render correctly, and Hindi and other Indic-script titles and captions use a font that supports them (Nirmala UI).
- Installing the GPU build of whisper.cpp keeps GPU transcription switched on (it could be switched back off by a later settings change).
- The first-run setup screen also offers available updates.

## 1.0.1

- Retakes are transcribed correctly: when Whisper's word timing collapses on a repeated sentence, CutPilot re-aligns the words to the actual breath groups, so each take gets the right text (better AI decisions and captions).
- Renders hit the YouTube loudness target more precisely (two-pass loudness normalisation).
- Closing CutPilot now stops any FFmpeg, whisper or AI CLI processes it started.
- App data moved to its own folder (`%LOCALAPPDATA%\com.mrdarkdebug.cutpilot`), separate from the installed program. Existing settings, tools, models, styles and library are moved automatically.
- Shows a notice after an update is installed.

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
