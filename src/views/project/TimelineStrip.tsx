import { useEffect, useMemo, useRef, useState } from "react";
import { clsx, segColor } from "../../components/ui";
import { fileSrc } from "../../lib/api";
import { fmtTime } from "../../lib/format";
import type { Edit, Timeline } from "../../lib/types";

interface Props {
  timeline: Timeline;
  edit: Edit;
  time: number;
  onSeek: (t: number) => void;
  selected?: string | null;
  onSelect?: (kind: "clip" | "broll" | "title", id: string) => void;
}

function tickStep(duration: number, width: number) {
  const target = duration / Math.max(1, width / 90);
  return [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s >= target) ?? 900;
}

export function TimelineStrip({ timeline, edit, time, onSeek, selected, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState(false);
  const d = Math.max(timeline.duration, 0.1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const x = (t: number) => (t / d) * width;
  const step = tickStep(d, width);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let s = 0; s <= d; s += step) out.push(s);
    return out;
  }, [d, step]);

  const seekFromEvent = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(d, ((clientX - r.left) / r.width) * d)));
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => seekFromEvent(e.clientX);
    const up = () => setDrag(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  const removed = Math.max(0, timeline.sourceDuration - timeline.duration);

  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-card">
      <div className="mb-2 flex items-center gap-3 text-[12px] text-muted">
        <span className="font-semibold text-text">Timeline</span>
        <span>
          {timeline.clips.length} cuts · {timeline.broll.length} B-roll · {timeline.titles.length} titles
          {timeline.chapters.length > 0 && ` · ${timeline.chapters.length} chapters`}
        </span>
        <span className="flex-1" />
        <span>
          {fmtTime(timeline.sourceDuration)} raw → <span className="font-semibold text-text">{fmtTime(timeline.duration)}</span>
          {removed > 0 && <span className="ml-1.5 text-ok">−{Math.round((removed / Math.max(timeline.sourceDuration, 0.1)) * 100)}%</span>}
        </span>
      </div>
      <div
        ref={ref}
        className="relative cursor-pointer select-none"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-item]")) return;
          seekFromEvent(e.clientX);
          setDrag(true);
        }}
      >
        {/* ruler */}
        <div className="relative h-5 border-b border-line">
          {ticks.map((s) => (
            <div key={s} className="absolute top-0 h-full" style={{ left: x(s) }}>
              <div className="h-1.5 w-px bg-line-strong" />
              <div className="absolute top-1.5 -translate-x-1/2 text-[10px] text-faint tabular-nums">{fmtTime(s)}</div>
            </div>
          ))}
          {timeline.chapters.map((c, i) => (
            <div
              key={i}
              title={`Chapter: ${c.title}`}
              className="absolute top-0 z-10 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-amber-400"
              style={{ left: x(c.start) + 5 }}
            />
          ))}
        </div>

        {/* titles lane */}
        <div className="relative mt-1.5 h-5">
          {timeline.titles.map((t) => (
            <div
              key={t.id}
              data-item
              onClick={() => {
                onSelect?.("title", t.id);
                onSeek(t.start);
              }}
              title={t.text}
              className={clsx(
                "absolute top-0 flex h-5 items-center overflow-hidden rounded-md bg-pink-500/15 px-1.5 text-[10.5px] font-medium whitespace-nowrap text-pink-600 ring-1 ring-pink-500/30 dark:text-pink-300",
                selected === t.id && "ring-2 ring-pink-500",
              )}
              style={{ left: x(t.start), width: Math.max(4, x(t.end) - x(t.start)) }}
            >
              {t.text}
            </div>
          ))}
        </div>

        {/* B-roll lane */}
        <div className="relative mt-1 h-9">
          {timeline.broll.map((b) => {
            const thumb = b.asset ? fileSrc(b.asset.thumb) : "";
            return (
              <div
                key={b.id}
                data-item
                onClick={() => {
                  onSelect?.("broll", b.id);
                  onSeek(b.start);
                }}
                title={`B-roll: ${b.query}`}
                className={clsx(
                  "absolute top-0 h-9 overflow-hidden rounded-md text-[10.5px] font-medium text-white",
                  b.asset ? "bg-sky-600 ring-1 ring-sky-400/40" : "border border-dashed border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300",
                  selected === b.id && "ring-2 ring-sky-400",
                )}
                style={{ left: x(b.start), width: Math.max(4, x(b.end) - x(b.start)) }}
              >
                {thumb && <img src={thumb} className="absolute inset-0 h-full w-full object-cover opacity-80" draggable={false} />}
                <span className="relative block truncate px-1.5 pt-0.5 [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">{b.query}</span>
              </div>
            );
          })}
        </div>

        {/* main clips */}
        <div className="relative mt-1 h-12">
          {timeline.clips.map((c, i) => {
            const prev = timeline.clips[i - 1];
            const segStart = !prev || prev.segment !== c.segment;
            const color = segColor(c.segment);
            return (
              <div
                key={c.clipId}
                data-item
                onClick={(e) => {
                  onSelect?.("clip", c.clipId);
                  seekFromEvent(e.clientX);
                }}
                className={clsx("absolute top-0 h-12 overflow-hidden rounded-[5px]", selected === c.clipId && "ring-2 ring-text")}
                style={{
                  left: x(c.start) + 0.5,
                  width: Math.max(2, x(c.end) - x(c.start) - 1),
                  background: `color-mix(in srgb, ${color} 22%, var(--surface))`,
                  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 45%, transparent)`,
                }}
                title={`${edit.segments[c.segment]?.label ?? ""}\n${edit.clips.find((x) => x.id === c.clipId)?.text ?? ""}`}
              >
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
                {segStart && x(c.end) - x(c.start) > 40 && (
                  <div className="truncate px-1.5 pt-1.5 text-[10.5px] font-semibold" style={{ color: `color-mix(in srgb, ${color} 75%, var(--text))` }}>
                    {edit.segments[c.segment]?.label}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* playhead */}
        <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-text" style={{ left: x(time) }}>
          <div className="absolute -top-1 -left-[5px] size-[11px] rounded-full border-2 border-surface bg-text" />
        </div>
      </div>
    </div>
  );
}
