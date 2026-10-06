import { Captions, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { IconButton, clsx } from "../../components/ui";
import { fileSrc, isTauri } from "../../lib/api";
import { fmtTime } from "../../lib/format";
import type { Project, Timeline, TlBroll } from "../../lib/types";

export interface PlayerHandle {
  seek: (t: number) => void;
  toggle: () => void;
}

interface Props {
  project: Project;
  timeline: Timeline;
  onTime: (t: number) => void;
}

/**
 * Plays the edit without rendering: hops between kept ranges of the source
 * videos and overlays B-roll, titles and captions.
 */
export const Player = forwardRef<PlayerHandle, Props>(function Player({ project, timeline, onTime }, ref) {
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const broll = useRef<HTMLVideoElement | null>(null);
  const state = useRef({ ci: 0, t: 0, playing: false, brollId: "" as string, lastEmit: 0 });
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [active, setActive] = useState<string>(timeline.clips[0]?.source ?? project.sources[0]?.id ?? "");
  const [overlay, setOverlay] = useState<TlBroll | null>(null);
  const [muted, setMuted] = useState(false);
  const [cc, setCc] = useState(true);
  const [ready, setReady] = useState(false);
  const clips = timeline.clips;
  const vertical = project.aspect === "9:16";

  const emit = useCallback(
    (time: number, force = false) => {
      state.current.t = time;
      const now = performance.now();
      if (force || now - state.current.lastEmit > 60) {
        state.current.lastEmit = now;
        setT(time);
        onTime(time);
      }
    },
    [onTime],
  );

  const clipAt = useCallback(
    (time: number) => {
      if (!clips.length) return -1;
      const i = clips.findIndex((c) => time >= c.start && time < c.end);
      return i >= 0 ? i : time >= timeline.duration ? clips.length - 1 : 0;
    },
    [clips, timeline.duration],
  );

  const syncBroll = useCallback(
    (time: number, play: boolean) => {
      const b = timeline.broll.find((x) => x.asset && time >= x.start && time < x.end) ?? null;
      const st = state.current;
      if ((b?.id ?? "") !== st.brollId) {
        st.brollId = b?.id ?? "";
        setOverlay(b);
      }
      const v = broll.current;
      if (b && v && !b.asset?.isImage) {
        const skip = Math.max(0, ((b.asset?.duration ?? 0) - (b.end - b.start)) / 3);
        const want = skip + (time - b.start);
        if (Math.abs(v.currentTime - want) > 0.35) v.currentTime = want;
        if (play && v.paused) v.play().catch(() => {});
        if (!play && !v.paused) v.pause();
      }
    },
    [timeline.broll],
  );

  const seek = useCallback(
    (time: number) => {
      const tt = Math.max(0, Math.min(time, Math.max(0, timeline.duration - 0.01)));
      const i = clipAt(tt);
      if (i < 0) return;
      const c = clips[i];
      const st = state.current;
      st.ci = i;
      for (const [id, v] of Object.entries(videos.current)) if (v && id !== c.source) v.pause();
      setActive(c.source);
      const v = videos.current[c.source];
      if (v) {
        v.currentTime = c.srcIn + (tt - c.start);
        if (st.playing) v.play().catch(() => {});
      }
      syncBroll(tt, st.playing);
      emit(tt, true);
    },
    [clipAt, clips, emit, syncBroll, timeline.duration],
  );

  const play = useCallback(() => {
    const st = state.current;
    if (st.t >= timeline.duration - 0.05) seek(0);
    st.playing = true;
    setPlaying(true);
    const c = clips[st.ci];
    const v = c && videos.current[c.source];
    if (v) {
      if (v.currentTime < c.srcIn - 0.05 || v.currentTime > c.srcOut) v.currentTime = c.srcIn + (st.t - c.start);
      v.play().catch(() => {});
    }
  }, [clips, seek, timeline.duration]);

  const pause = useCallback(() => {
    state.current.playing = false;
    setPlaying(false);
    for (const v of Object.values(videos.current)) v?.pause();
    broll.current?.pause();
  }, []);

  const toggle = useCallback(() => (state.current.playing ? pause() : play()), [pause, play]);

  useImperativeHandle(ref, () => ({ seek, toggle }), [seek, toggle]);

  // Playback loop: follow the active video's clock and hop at clip ends.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const st = state.current;
      if (!st.playing) return;
      const c = clips[st.ci];
      if (!c) return;
      const v = videos.current[c.source];
      if (!v) return;
      if (v.currentTime >= c.srcOut - 0.02 || v.ended) {
        const next = clips[st.ci + 1];
        if (!next) {
          pause();
          emit(timeline.duration, true);
          return;
        }
        st.ci += 1;
        const nv = videos.current[next.source];
        if (next.source !== c.source) {
          v.pause();
          setActive(next.source);
        }
        if (nv) {
          nv.currentTime = next.srcIn;
          nv.play().catch(() => {});
        }
        emit(next.start);
        syncBroll(next.start, true);
        return;
      }
      const time = c.start + Math.max(0, v.currentTime - c.srcIn);
      emit(time);
      syncBroll(time, true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clips, emit, pause, syncBroll, timeline.duration]);

  // Timeline changed (manual edit / new version): stay at the same time.
  useEffect(() => {
    setReady(false);
    const keep = state.current.t;
    const id = setTimeout(() => seek(Math.min(keep, timeline.duration)), 30);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  useEffect(() => {
    for (const v of Object.values(videos.current)) if (v) v.muted = muted;
  }, [muted]);

  // A new B-roll element mounted: bring it to the right frame.
  useEffect(() => {
    if (!overlay || !broll.current) return;
    const v = broll.current;
    const sync = () => syncBroll(state.current.t, state.current.playing);
    v.addEventListener("loadedmetadata", sync, { once: true });
    sync();
    return () => v.removeEventListener("loadedmetadata", sync);
  }, [overlay, syncBroll]);

  const title = timeline.titles.find((x) => t >= x.start && t < x.end);
  const caption = cc ? timeline.captions.find((x) => t >= x.start && t < x.end) : undefined;
  const sources = useMemo(() => project.sources.filter((s) => clips.some((c) => c.source === s.id)), [project.sources, clips]);

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-[#0b0b0f]">
        <div className={clsx("absolute inset-0 m-auto", vertical ? "aspect-[9/16] h-full max-w-full" : "aspect-video max-h-full w-full")}>
          <div className="relative h-full w-full overflow-hidden" onClick={toggle}>
            {sources.map((s) => (
              <video
                key={s.id}
                ref={(el) => {
                  videos.current[s.id] = el;
                }}
                src={fileSrc(s.proxy || s.path)}
                preload="auto"
                playsInline
                muted={muted}
                onLoadedData={() => {
                  setReady(true);
                  if (s.id === active && !state.current.playing) seek(state.current.t);
                }}
                className={clsx("absolute inset-0 h-full w-full", vertical ? "object-cover" : "object-contain", s.id === active ? "opacity-100" : "opacity-0")}
              />
            ))}
            {overlay?.asset &&
              (overlay.asset.isImage ? (
                <img src={fileSrc(overlay.asset.path)} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <video ref={broll} key={overlay.id} src={fileSrc(overlay.asset.path)} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
              ))}
            {!overlay?.asset && timeline.broll.find((b) => !b.asset && t >= b.start && t < b.end) && (
              <div className="absolute top-3 left-3 rounded-lg border border-dashed border-white/40 bg-black/50 px-2.5 py-1.5 text-[11.5px] text-white/85">
                B-roll slot: {timeline.broll.find((b) => !b.asset && t >= b.start && t < b.end)?.query}
              </div>
            )}
            {title && (
              <div
                className={clsx(
                  "pointer-events-none absolute right-0 left-0 flex justify-center px-6",
                  title.kind === "lower_third" ? "bottom-[16%]" : title.kind === "callout" ? "bottom-[24%]" : "top-1/2 -translate-y-1/2",
                )}
              >
                <span
                  className={clsx(
                    "rounded-lg bg-black/55 px-4 py-2 text-center font-bold text-white shadow-lg",
                    title.kind === "title" ? "text-[clamp(18px,3.4vw,40px)]" : "text-[clamp(14px,2vw,24px)]",
                  )}
                >
                  {title.text}
                </span>
              </div>
            )}
            {caption && (
              <div className="pointer-events-none absolute right-0 bottom-[5%] left-0 flex justify-center px-8">
                <span className="text-center text-[clamp(13px,1.7vw,22px)] font-bold text-white [text-shadow:0_0_3px_#000,0_0_3px_#000,0_2px_4px_#000]">
                  {caption.text}
                </span>
              </div>
            )}
            {!playing && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-white/90 text-black shadow-xl transition-transform hover:scale-105">
                  <Play className="ml-0.5 size-6 fill-current" />
                </span>
              </div>
            )}
            {!isTauri && (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/50">Video preview runs in the desktop app</div>
            )}
            {isTauri && !ready && clips.length > 0 && (
              <div className="absolute bottom-3 left-3 text-[11.5px] text-white/50">Loading video…</div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1">
        <IconButton label={playing ? "Pause (Space)" : "Play (Space)"} onClick={toggle} className="text-text">
          {playing ? <Pause className="size-4.5 fill-current" /> : <Play className="size-4.5 fill-current" />}
        </IconButton>
        <IconButton label="Back 5 s (J)" onClick={() => seek(state.current.t - 5)}>
          <RotateCcw className="size-4" />
        </IconButton>
        <IconButton label="Forward 5 s (L)" onClick={() => seek(state.current.t + 5)}>
          <RotateCw className="size-4" />
        </IconButton>
        <div className="ml-1.5 text-[12.5px] text-text-2 tabular-nums">
          {fmtTime(t, true)} <span className="text-faint">/ {fmtTime(timeline.duration, true)}</span>
        </div>
        <div className="flex-1" />
        <IconButton label="Captions" active={cc} onClick={() => setCc((c) => !c)}>
          <Captions className="size-4" />
        </IconButton>
        <IconButton label={muted ? "Unmute" : "Mute"} onClick={() => setMuted((m) => !m)}>
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </IconButton>
      </div>
    </div>
  );
});
