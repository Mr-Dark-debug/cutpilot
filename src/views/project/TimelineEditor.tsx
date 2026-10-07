import { Magnet, Maximize2, Minus, Plus, Redo2, Scissors, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconButton, clsx, segColor } from "../../components/ui";
import { fileSrc } from "../../lib/api";
import { fmtTime } from "../../lib/format";
import { computeLayout, nextId, timecode, toSource, type Layout } from "../../lib/timeline";
import type { Edit, SourceData, Timeline } from "../../lib/types";

export type Selection = { kind: "clip" | "broll" | "title"; id: string } | null;

interface Props {
  edit: Edit;
  timeline: Timeline;
  sources: Record<string, SourceData>;
  sourceDurations: Record<string, number>;
  time: number;
  onSeek: (t: number) => void;
  update: (fn: (e: Edit) => Edit) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selected: Selection;
  onSelect: (s: Selection) => void;
}

const HEAD = 104;
const ROWS = { ruler: 28, titles: 30, broll: 46, video: 58, audio: 46 };
const MAX_PPS = 400;

type DragKind = "move" | "trim-l" | "trim-r" | "playhead";
interface Drag {
  type: DragKind;
  kind?: "clip" | "broll" | "title";
  id?: string;
  startX: number;
  orig: Edit;
  layout: Layout;
  moved: boolean;
  pointerT: number;
}

export function TimelineEditor(p: Props) {
  const { edit, timeline, sources, sourceDurations, time, onSeek, update, selected, onSelect } = p;
  const fps = timeline.fpsNum / Math.max(1, timeline.fpsDen);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [vw, setVw] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [pps, setPps] = useState(10);
  const [fit, setFit] = useState(true);
  const [snap, setSnap] = useState(true);
  const [draft, setDraft] = useState<Edit | null>(null);
  const [ghost, setGhost] = useState<{ x: number; insertAt: number; insertX: number } | null>(null);
  const drag = useRef<Drag | null>(null);

  const working = draft ?? edit;
  const layout = useMemo(() => computeLayout(working, fps), [working, fps]);
  const duration = Math.max(layout.duration, 0.1);
  const fitPps = Math.max(0.5, (vw - 48) / duration);
  const minPps = Math.min(fitPps, 2);
  const effPps = fit ? fitPps : pps;
  const width = Math.max(vw, duration * effPps + 80);
  const x = (t: number) => t * effPps;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    setVw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Keep the playhead visible while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || drag.current || fit) return;
    const px = time * effPps;
    if (px < el.scrollLeft + 20 || px > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = Math.max(0, px - el.clientWidth * 0.2);
  }, [time, effPps, fit]);

  const zoomTo = useCallback(
    (next: number, anchorPx?: number) => {
      const el = scroller.current;
      const clamped = Math.min(MAX_PPS, Math.max(minPps, next));
      const ax = anchorPx ?? (el ? el.clientWidth / 2 : 0);
      const tAt = ((el?.scrollLeft ?? 0) + ax) / effPps;
      setFit(false);
      setPps(clamped);
      requestAnimationFrame(() => {
        if (el) el.scrollLeft = Math.max(0, tAt * clamped - ax);
      });
    },
    [effPps, minPps],
  );

  // Ctrl+wheel zooms around the pointer; plain wheel scrolls horizontally.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomTo(effPps * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX - r.left);
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo, effPps]);

  // ---------------------------------------------------------------- edits

  const split = useCallback(() => {
    const c = layout.clips.find((cl) => time > cl.start + 0.1 && time < cl.end - 0.1);
    if (!c) return;
    const at = c.srcIn + (time - c.start);
    update((e) => {
      const clips = [...e.clips];
      const orig = clips[c.index];
      const id = nextId("c", clips.map((x) => x.id));
      clips.splice(c.index, 1, { ...orig, end: at }, { ...orig, id, start: at });
      return { ...e, clips };
    });
  }, [layout, time, update]);

  const remove = useCallback(() => {
    if (!selected) return;
    update((e) => {
      if (selected.kind === "clip") return { ...e, clips: e.clips.map((c) => (c.id === selected.id ? { ...c, enabled: false } : c)) };
      if (selected.kind === "broll") return { ...e, broll: e.broll.filter((b) => b.id !== selected.id) };
      return { ...e, titles: e.titles.filter((t) => t.id !== selected.id) };
    });
    onSelect(null);
  }, [selected, update, onSelect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) {
        e.preventDefault();
        p.undo();
      } else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        p.redo();
      } else if (!e.ctrlKey && k === "s") {
        e.preventDefault();
        split();
      } else if (k === "delete" || k === "backspace") {
        if (selected) {
          e.preventDefault();
          remove();
        }
      } else if (k === "=" || k === "+") zoomTo(effPps * 1.4);
      else if (k === "-") zoomTo(effPps / 1.4);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p, split, remove, selected, zoomTo, effPps]);

  // ---------------------------------------------------------------- dragging

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + el.scrollLeft) / effPps);
  };

  const snapTo = (t: number, base: Layout, selfId?: string) => {
    if (!snap) return t;
    const tol = 8 / effPps;
    const points = [time, 0, base.duration, ...base.clips.flatMap((c) => [c.start, c.end]), ...[...base.broll, ...base.titles].filter((i) => i.id !== selfId).flatMap((i) => [i.start, i.end])];
    let best = t;
    let bestD = tol;
    for (const pt of points) {
      const d = Math.abs(pt - t);
      if (d < bestD) {
        bestD = d;
        best = pt;
      }
    }
    return best;
  };

  const beginDrag = (e: React.PointerEvent, type: DragKind, kind?: Drag["kind"], id?: string) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = { type, kind, id, startX: e.clientX, orig: edit, layout: computeLayout(edit, fps), moved: false, pointerT: timeAt(e.clientX) };
    if (type === "playhead") onSeek(timeAt(e.clientX));
    if (kind && id) onSelect({ kind, id });
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) < 3) return;
      d.moved = true;
      const dt = dx / effPps;
      if (d.type === "playhead") {
        onSeek(Math.min(timeAt(e.clientX), d.layout.duration));
        return;
      }
      const o = d.orig;
      if (d.kind === "clip") {
        const idx = o.clips.findIndex((c) => c.id === d.id);
        const c = o.clips[idx];
        if (d.type === "move") {
          const T = timeAt(e.clientX);
          const others = d.layout.clips.filter((lc) => lc.id !== d.id);
          let insertAt = others.length;
          for (let i = 0; i < others.length; i++) {
            if (T < (others[i].start + others[i].end) / 2) {
              insertAt = i;
              break;
            }
          }
          const insertX = insertAt < others.length ? x(others[insertAt].start) : x(d.layout.duration);
          setGhost({ x: e.clientX, insertAt, insertX });
          return;
        }
        const srcDur = sourceDurations[c.source] ?? Infinity;
        const nc = { ...c };
        if (d.type === "trim-l") nc.start = Math.min(c.end - 0.2, Math.max(0, c.start + dt));
        else nc.end = Math.max(c.start + 0.2, Math.min(srcDur, c.end + dt));
        setDraft({ ...o, clips: o.clips.map((x2, i) => (i === idx ? nc : x2)) });
        return;
      }
      const isB = d.kind === "broll";
      const item = (isB ? d.layout.broll : d.layout.titles).find((i) => i.id === d.id);
      if (!item) return;
      const len = item.end - item.start;
      let start = item.start;
      let dur = len;
      if (d.type === "move") start = Math.max(0, Math.min(d.layout.duration - len, snapTo(item.start + dt, d.layout, d.id)));
      else if (d.type === "trim-r") dur = Math.max(0.8, Math.min(isB ? 12 : 8, snapTo(item.end + dt, d.layout, d.id) - item.start));
      else {
        start = Math.max(0, Math.min(item.end - 0.8, snapTo(item.start + dt, d.layout, d.id)));
        dur = item.end - start;
      }
      const src = toSource(d.layout, start);
      if (!src) return;
      if (isB) setDraft({ ...o, broll: o.broll.map((b) => (b.id === d.id ? { ...b, source: src.source, anchor: src.time, duration: +dur.toFixed(2) } : b)) });
      else setDraft({ ...o, titles: o.titles.map((t) => (t.id === d.id ? { ...t, source: src.source, anchor: src.time, duration: +dur.toFixed(2) } : t)) });
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (!d.moved) {
        if (d.kind) onSeek(Math.min(timeAt(e.clientX), d.layout.duration));
        return;
      }
      if (d.kind === "clip" && d.type === "move" && ghost) {
        const others = d.layout.clips.filter((lc) => lc.id !== d.id);
        const targetId = others[ghost.insertAt]?.id;
        update((ed) => {
          const clips = [...ed.clips];
          const from = clips.findIndex((c) => c.id === d.id);
          const [moved] = clips.splice(from, 1);
          const to = targetId ? clips.findIndex((c) => c.id === targetId) : clips.length;
          clips.splice(to, 0, moved);
          return { ...ed, clips };
        });
      } else if (draft) {
        const final = draft;
        update(() => final);
      }
      setDraft(null);
      setGhost(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effPps, draft, ghost, sourceDurations, update, onSeek, snap, time]);

  // ---------------------------------------------------------------- waveform

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const h = ROWS.audio - 8;
    cv.width = Math.floor(vw * dpr);
    cv.height = Math.floor(h * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, vw, h);
    const mid = h / 2;
    let ci = 0;
    for (let px = 0; px < vw; px++) {
      const t0 = (scrollLeft + px) / effPps;
      const t1 = (scrollLeft + px + 1) / effPps;
      while (ci < layout.clips.length && layout.clips[ci].end <= t0) ci++;
      const c = layout.clips[ci];
      if (!c || c.start > t0) continue;
      const peaks = sources[c.source]?.peaks;
      if (!peaks?.length) continue;
      const a = Math.floor((c.srcIn + (t0 - c.start)) * 20);
      const b = Math.max(a + 1, Math.floor((c.srcIn + (Math.min(t1, c.end) - c.start)) * 20));
      let v = 0;
      for (let i = a; i < b && i < peaks.length; i++) v = Math.max(v, peaks[i]);
      const bh = Math.max(1, (v / 100) * (mid - 2));
      ctx.fillStyle = segColor(c.segment);
      ctx.globalAlpha = 0.75;
      ctx.fillRect(px, mid - bh, 1, bh * 2);
    }
  }, [layout, effPps, scrollLeft, vw, sources]);

  // ---------------------------------------------------------------- ruler

  const ticks = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const major = steps.find((s) => s * effPps >= 90) ?? 900;
    const minor = major / 5;
    const from = Math.floor(scrollLeft / effPps / major) * major;
    const to = (scrollLeft + vw) / effPps + major;
    const out: { t: number; major: boolean }[] = [];
    for (let t = from; t <= to; t += minor) out.push({ t: +t.toFixed(3), major: Math.abs(t / major - Math.round(t / major)) < 1e-6 });
    return { out, major };
  }, [effPps, scrollLeft, vw]);

  const clipText = (id: string) => working.clips.find((c) => c.id === id)?.text ?? "";
  const removedPct = Math.round((1 - layout.duration / Math.max(timeline.sourceDuration, 0.1)) * 100);
  const zoomValue = Math.log(effPps / minPps) / Math.log(MAX_PPS / minPps);

  const Handle = ({ side, onDown }: { side: "l" | "r"; onDown: (e: React.PointerEvent) => void }) => (
    <span
      onPointerDown={onDown}
      className={clsx(
        "absolute top-0 bottom-0 z-10 w-[7px] cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100",
        side === "l" ? "left-0 rounded-l-[5px]" : "right-0 rounded-r-[5px]",
        "bg-white/60 dark:bg-white/40",
      )}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {/* toolbar */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2.5">
        <div className="mr-2 rounded-lg bg-surface-2 px-2.5 py-1 font-mono text-[13px] tracking-tight text-text tabular-nums ring-1 ring-line">{timecode(time, fps)}</div>
        <IconButton label="Undo (Ctrl+Z)" onClick={p.undo} disabled={!p.canUndo}>
          <Undo2 className="size-4" />
        </IconButton>
        <IconButton label="Redo (Ctrl+Y)" onClick={p.redo} disabled={!p.canRedo}>
          <Redo2 className="size-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-line" />
        <IconButton label="Split at playhead (S)" onClick={split}>
          <Scissors className="size-4" />
        </IconButton>
        <IconButton label="Delete selected (Del)" onClick={remove} disabled={!selected}>
          <Trash2 className="size-4" />
        </IconButton>
        <IconButton label={snap ? "Snapping on" : "Snapping off"} active={snap} onClick={() => setSnap((s) => !s)}>
          <Magnet className="size-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-line" />
        <IconButton label="Zoom out (-)" onClick={() => zoomTo(effPps / 1.4)}>
          <Minus className="size-4" />
        </IconButton>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={Math.max(0, Math.min(1, zoomValue))}
          onChange={(e) => zoomTo(minPps * Math.pow(MAX_PPS / minPps, Number(e.target.value)))}
          className="w-28"
          title="Zoom (Ctrl+wheel)"
        />
        <IconButton label="Zoom in (+)" onClick={() => zoomTo(effPps * 1.4)}>
          <Plus className="size-4" />
        </IconButton>
        <IconButton label="Fit to window" active={fit} onClick={() => setFit(true)}>
          <Maximize2 className="size-3.5" />
        </IconButton>
        <div className="flex-1" />
        <div className="text-[12px] text-muted">
          {layout.clips.length} cuts · {fmtTime(timeline.sourceDuration)} raw → <span className="font-semibold text-text">{fmtTime(layout.duration)}</span>
          {removedPct > 0 && <span className="ml-1.5 text-ok">−{removedPct}%</span>}
        </div>
      </div>

      {/* tracks (scroll vertically when the panel is short) */}
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="h-max shrink-0 border-r border-line bg-surface-2" style={{ width: HEAD }}>
          <div style={{ height: ROWS.ruler }} className="border-b border-line" />
          {(
            [
              ["T1", "Titles", ROWS.titles, "text-pink-500"],
              ["V2", "B-roll", ROWS.broll, "text-sky-500"],
              ["V1", "Video", ROWS.video, "text-accent"],
              ["A1", "Audio", ROWS.audio, "text-emerald-500"],
            ] as const
          ).map(([code, name, h, tint]) => (
            <div key={code} style={{ height: h }} className="flex items-center gap-2 border-b border-line px-3 text-[11.5px]">
              <span className={clsx("font-mono text-[10.5px] font-bold", tint)}>{code}</span>
              <span className="text-text-2">{name}</span>
            </div>
          ))}
        </div>

        <div ref={scroller} className="relative h-max min-w-0 flex-1 overflow-x-auto overflow-y-hidden select-none" onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}>
          <div className="relative" style={{ width }}>
            {/* ruler */}
            <div className="relative cursor-pointer border-b border-line bg-surface-2/60" style={{ height: ROWS.ruler }} onPointerDown={(e) => beginDrag(e, "playhead")}>
              {ticks.out.map(({ t, major }) => (
                <div key={t} className="absolute bottom-0" style={{ left: x(t) }}>
                  <div className={clsx("w-px bg-line-strong", major ? "h-2.5" : "h-1.5")} />
                  {major && <div className="absolute bottom-3 -translate-x-1/2 text-[10px] whitespace-nowrap text-faint tabular-nums">{fmtTime(t)}</div>}
                </div>
              ))}
              {timeline.chapters.map((c, i) => {
                const room = (i + 1 < timeline.chapters.length ? x(timeline.chapters[i + 1].start) : width) - x(c.start) - 8;
                return (
                  <div key={i} className="absolute top-0.5 z-10 flex items-center gap-1" style={{ left: x(c.start) }} title={`Chapter: ${c.title}`}>
                    <span className="h-3 w-0.5 shrink-0 rounded bg-amber-400" />
                    {room > 24 && (
                      <span className="truncate rounded bg-amber-400/15 px-1 text-[9.5px] font-medium text-amber-700 dark:text-amber-300" style={{ maxWidth: Math.min(160, room) }}>
                        {c.title}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* titles */}
            <div className="relative border-b border-line" style={{ height: ROWS.titles }} onPointerDown={() => onSelect(null)}>
              {layout.titles.map((t) => (
                <div
                  key={t.id}
                  onPointerDown={(e) => beginDrag(e, "move", "title", t.id)}
                  className={clsx(
                    "group absolute top-1 flex h-[22px] cursor-grab items-center overflow-hidden rounded-[5px] bg-pink-500/25 px-2 text-[10.5px] font-semibold whitespace-nowrap text-pink-800 ring-1 ring-pink-500/50 active:cursor-grabbing dark:bg-pink-500/30 dark:text-pink-100",
                    selected?.id === t.id && "ring-2 ring-pink-500",
                  )}
                  style={{ left: x(t.start), width: Math.max(6, x(t.end) - x(t.start)) }}
                  title={t.label}
                >
                  <Handle side="l" onDown={(e) => beginDrag(e, "trim-l", "title", t.id)} />
                  <span className="truncate">{t.label}</span>
                  <Handle side="r" onDown={(e) => beginDrag(e, "trim-r", "title", t.id)} />
                </div>
              ))}
            </div>

            {/* B-roll */}
            <div className="relative border-b border-line" style={{ height: ROWS.broll }} onPointerDown={() => onSelect(null)}>
              {layout.broll.map((b) => {
                const thumb = b.asset ? fileSrc(b.asset.thumb) : undefined;
                return (
                  <div
                    key={b.id}
                    onPointerDown={(e) => beginDrag(e, "move", "broll", b.id)}
                    className={clsx(
                      "group absolute top-1 h-[38px] cursor-grab overflow-hidden rounded-[5px] text-[10.5px] font-medium active:cursor-grabbing",
                      b.asset ? "bg-sky-600 text-white ring-1 ring-sky-400/40" : "border border-dashed border-sky-500/70 bg-sky-500/10 text-sky-700 dark:text-sky-300",
                      selected?.id === b.id && "ring-2 ring-sky-400",
                    )}
                    style={{ left: x(b.start), width: Math.max(6, x(b.end) - x(b.start)) }}
                    title={`B-roll: ${b.label}`}
                  >
                    {thumb && <img src={thumb} className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-75" draggable={false} />}
                    <Handle side="l" onDown={(e) => beginDrag(e, "trim-l", "broll", b.id)} />
                    <span className="pointer-events-none relative block truncate px-2 pt-1 [text-shadow:0_1px_2px_rgb(0_0_0/0.45)]">{b.label}</span>
                    <Handle side="r" onDown={(e) => beginDrag(e, "trim-r", "broll", b.id)} />
                  </div>
                );
              })}
            </div>

            {/* video */}
            <div className="relative border-b border-line" style={{ height: ROWS.video }} onPointerDown={() => onSelect(null)}>
              {layout.clips.map((c, i) => {
                const prev = layout.clips[i - 1];
                const segStart = !prev || prev.segment !== c.segment;
                const color = segColor(c.segment);
                const w = x(c.end) - x(c.start);
                return (
                  <div
                    key={c.id}
                    onPointerDown={(e) => beginDrag(e, "move", "clip", c.id)}
                    className={clsx("group absolute top-1 h-[50px] cursor-grab overflow-hidden rounded-[5px] active:cursor-grabbing", selected?.id === c.id && "ring-2 ring-text")}
                    style={{
                      left: x(c.start) + 0.5,
                      width: Math.max(3, w - 1),
                      background: `color-mix(in srgb, ${color} 24%, var(--surface))`,
                      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 50%, transparent)`,
                    }}
                    title={`${working.segments[c.segment]?.label ?? ""}\n${clipText(c.id)}\n${c.source} ${fmtTime(c.srcIn, true)}–${fmtTime(c.srcOut, true)}`}
                  >
                    <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} />
                    <Handle side="l" onDown={(e) => beginDrag(e, "trim-l", "clip", c.id)} />
                    {w > 36 && (
                      <div className="pointer-events-none px-1.5 pt-1.5">
                        {segStart && (
                          <div className="truncate text-[10.5px] font-semibold" style={{ color: `color-mix(in srgb, ${color} 70%, var(--text))` }}>
                            {working.segments[c.segment]?.label}
                          </div>
                        )}
                        <div className="line-clamp-2 text-[10px] leading-tight text-text-2">{clipText(c.id)}</div>
                      </div>
                    )}
                    <Handle side="r" onDown={(e) => beginDrag(e, "trim-r", "clip", c.id)} />
                  </div>
                );
              })}
              {ghost && <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-[3px] rounded bg-text" style={{ left: ghost.insertX - 1 }} />}
            </div>

            {/* audio */}
            <div className="relative border-b border-line" style={{ height: ROWS.audio }}>
              <canvas ref={canvas} className="sticky left-0 top-1 block" style={{ width: vw, height: ROWS.audio - 8 }} />
            </div>

            {/* playhead */}
            <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-red-500" style={{ left: x(time) }}>
              <div className="absolute -top-0 -left-[5px] h-3 w-[11px] rounded-b-sm bg-red-500" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-surface-2 px-3 text-[11px] text-faint">
        <span>Drag clip edges to trim · drag clips to reorder · drag B-roll/titles to move</span>
        <span className="flex-1" />
        <span>S split · Del delete · Ctrl+Z undo · Ctrl+wheel zoom</span>
      </div>
    </div>
  );
}
