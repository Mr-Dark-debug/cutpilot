import { ChevronLeft, ChevronRight, Play, RotateCcw, Scissors } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Segmented, clsx, segColor } from "../../components/ui";
import { fmtTime } from "../../lib/format";
import type { Clip, Edit, SourceData, Timeline, Utterance } from "../../lib/types";

interface Props {
  edit: Edit;
  timeline: Timeline;
  sources: Record<string, SourceData>;
  time: number;
  update: (fn: (e: Edit) => Edit) => void;
  onSeek: (t: number) => void;
  selected: string | null;
  multiSource: boolean;
}

const NUDGE = 0.1;

export function StoryPanel({ edit, timeline, sources, time, update, onSeek, selected, multiSource }: Props) {
  const [view, setView] = useState<"kept" | "cut">("kept");

  const cut = useMemo(() => {
    const out: Utterance[] = [];
    for (const [sid, data] of Object.entries(sources)) {
      for (const u of data.utterances) {
        const covered = edit.clips.some(
          (c) => c.enabled && c.source === sid && Math.min(c.end, u.end) - Math.max(c.start, u.start) > 0.5 * (u.end - u.start),
        );
        if (!covered) out.push(u);
      }
    }
    return out.sort((a, b) => a.source.localeCompare(b.source) || a.start - b.start);
  }, [sources, edit.clips]);

  const tlStart = (clipId: string) => timeline.clips.find((c) => c.clipId === clipId)?.start;
  const active = timeline.clips.find((c) => time >= c.start && time < c.end)?.clipId;

  const setClip = (id: string, patch: Partial<Clip>) =>
    update((e) => ({ ...e, clips: e.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const nudge = (c: Clip, which: "start" | "end", delta: number) => {
    const dur = sources[c.source]?.duration ?? Infinity;
    if (which === "start") setClip(c.id, { start: Math.max(0, Math.min(c.end - 0.2, c.start + delta)) });
    else setClip(c.id, { end: Math.min(dur, Math.max(c.start + 0.2, c.end + delta)) });
  };

  const restore = (u: Utterance) =>
    update((e) => {
      const clips = [...e.clips];
      // Put it after the kept clip that precedes it in the source.
      let idx = -1;
      for (let i = 0; i < clips.length; i++) if (clips[i].source === u.source && clips[i].start < u.start) idx = i;
      const anchor = idx >= 0 ? clips[idx] : clips.find((c) => c.source === u.source) ?? clips[clips.length - 1];
      const n = Math.max(0, ...clips.map((c) => Number(c.id.replace(/\D/g, "")) || 0)) + 1;
      const clip: Clip = {
        id: `c${n}`,
        source: u.source,
        start: Math.max(0, u.start - 0.1),
        end: u.end + 0.18,
        segment: anchor?.segment ?? 0,
        enabled: true,
        text: u.text,
      };
      clips.splice(idx + 1, 0, clip);
      return { ...e, clips };
    });

  const groups = useMemo(() => {
    const out: { segment: number; clips: Clip[] }[] = [];
    for (const c of edit.clips) {
      const last = out[out.length - 1];
      if (last && last.segment === c.segment) last.clips.push(c);
      else out.push({ segment: c.segment, clips: [c] });
    }
    return out;
  }, [edit.clips]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "kept", label: `Kept · ${edit.clips.filter((c) => c.enabled).length}` },
            { value: "cut", label: (<><Scissors className="size-3" /> Cut · {cut.length}</>) },
          ]}
        />
        <div className="text-[12px] text-muted">
          {view === "kept" ? "Untick to drop a clip, nudge its edges, click to jump." : "Everything the AI removed. Restore anything you want back."}
        </div>
      </div>

      {view === "kept" ? (
        <div className="space-y-3">
          {groups.map((g, gi) => {
            const seg = edit.segments[g.segment];
            const color = segColor(g.segment);
            const len = g.clips.filter((c) => c.enabled).reduce((a, c) => a + (c.end - c.start), 0);
            return (
              <div key={gi} className="overflow-hidden rounded-xl border border-line">
                <div className="flex items-start gap-2.5 border-b border-line bg-surface-2 px-3 py-2">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">{seg?.label || `Section ${g.segment + 1}`}</div>
                    {seg?.reason && <div className="text-[12px] leading-snug text-muted">{seg.reason}</div>}
                  </div>
                  <span className="text-[11.5px] text-muted tabular-nums">{fmtTime(len)}</span>
                </div>
                {g.clips.map((c) => {
                  const start = tlStart(c.id);
                  return (
                    <div
                      key={c.id}
                      className={clsx(
                        "group flex items-start gap-2.5 border-b border-line px-3 py-2 last:border-b-0",
                        (active === c.id || selected === c.id) && "bg-accent-soft/60",
                        !c.enabled && "opacity-55",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={c.enabled}
                        onChange={(e) => setClip(c.id, { enabled: e.target.checked })}
                        className="mt-1 size-3.5 accent-[var(--accent)]"
                        title={c.enabled ? "Drop this clip" : "Keep this clip"}
                      />
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => start !== undefined && onSeek(start)}
                        disabled={start === undefined}
                      >
                        <div className={clsx("text-[13px] leading-relaxed", !c.enabled && "line-through")}>{c.text}</div>
                        <div className="mt-0.5 text-[11.5px] text-faint tabular-nums">
                          {multiSource && `${c.source} · `}
                          {fmtTime(c.start, true)}–{fmtTime(c.end, true)} · {(c.end - c.start).toFixed(1)}s
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <EdgeNudge label="Start" onEarlier={() => nudge(c, "start", -NUDGE)} onLater={() => nudge(c, "start", NUDGE)} />
                        <EdgeNudge label="End" onEarlier={() => nudge(c, "end", -NUDGE)} onLater={() => nudge(c, "end", NUDGE)} />
                        {start !== undefined && (
                          <button onClick={() => onSeek(start)} className="rounded-md p-1 text-muted hover:bg-surface-3 hover:text-text" title="Play from here">
                            <Play className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          {cut.length === 0 && <div className="p-5 text-center text-[13px] text-muted">Nothing was cut.</div>}
          {cut.map((u) => (
            <div key={`${u.source}-${u.id}`} className="flex items-start gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className={clsx("text-[13px] leading-relaxed", u.kind === "sound" ? "text-faint italic" : "text-text-2")}>{u.text}</div>
                <div className="mt-0.5 text-[11.5px] text-faint tabular-nums">
                  {multiSource && `${u.source} · `}
                  {fmtTime(u.start, true)}–{fmtTime(u.end, true)}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => restore(u)}>
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EdgeNudge({ label, onEarlier, onLater }: { label: string; onEarlier: () => void; onLater: () => void }) {
  return (
    <span className="inline-flex items-center rounded-md border border-line bg-surface text-[10.5px] text-muted">
      <button onClick={onEarlier} className="rounded-l-md p-0.5 hover:bg-surface-3 hover:text-text" title={`${label} 0.1 s earlier`}>
        <ChevronLeft className="size-3" />
      </button>
      <span className="px-0.5">{label}</span>
      <button onClick={onLater} className="rounded-r-md p-0.5 hover:bg-surface-3 hover:text-text" title={`${label} 0.1 s later`}>
        <ChevronRight className="size-3" />
      </button>
    </span>
  );
}
