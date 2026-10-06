import { Plus, Trash2, Type } from "lucide-react";
import { Button, Empty, IconButton, Input, Select, Switch, clsx } from "../../components/ui";
import { fmtTime } from "../../lib/format";
import type { Edit, TitleItem, Timeline } from "../../lib/types";

interface Props {
  edit: Edit;
  timeline: Timeline;
  time: number;
  update: (fn: (e: Edit) => Edit) => void;
  onSeek: (t: number) => void;
  selected: string | null;
}

const KINDS = [
  { value: "title", label: "Section title", hint: "Big, centred" },
  { value: "callout", label: "Callout", hint: "Key term or number" },
  { value: "lower_third", label: "Lower third", hint: "Name or intro" },
];

/** Maps a timeline time back to a source anchor (so the title survives re-cuts). */
function anchorAt(timeline: Timeline, t: number) {
  const c = timeline.clips.find((x) => t >= x.start && t < x.end) ?? timeline.clips[0];
  return c ? { source: c.source, anchor: c.srcIn + (t - c.start) } : null;
}

export function TitlesPanel({ edit, timeline, time, update, onSeek, selected }: Props) {
  const set = (id: string, patch: Partial<TitleItem>) => update((e) => ({ ...e, titles: e.titles.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const add = () => {
    const a = anchorAt(timeline, time);
    if (!a) return;
    update((e) => {
      const n = Math.max(0, ...e.titles.map((t) => Number(t.id.replace(/\D/g, "")) || 0)) + 1;
      return { ...e, titles: [...e.titles, { id: `t${n}`, ...a, duration: 3, text: "New title", kind: "callout", enabled: true }] };
    });
  };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[12px] text-muted">Titles export to Resolve as text and are burned into MP4 renders.</div>
        <Button size="sm" variant="soft" icon={<Plus className="size-3.5" />} onClick={add}>
          Add at playhead ({fmtTime(time)})
        </Button>
      </div>
      {edit.titles.length === 0 ? (
        <Empty icon={<Type className="size-5" />} title="No on-screen titles">
          Add one at the playhead, or ask the AI for key-term callouts.
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          {edit.titles.map((t) => {
            const tl = timeline.titles.find((x) => x.id === t.id);
            return (
              <div
                key={t.id}
                className={clsx("flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0", selected === t.id && "bg-accent-soft/60", !t.enabled && "opacity-55")}
              >
                <button onClick={() => tl && onSeek(tl.start)} className="w-12 shrink-0 text-left text-[11.5px] text-muted tabular-nums hover:text-text">
                  {tl ? fmtTime(tl.start) : "–"}
                </button>
                <Input value={t.text} onChange={(e) => set(t.id, { text: e.target.value })} className="h-8 flex-1" />
                <Select compact className="w-36" value={t.kind} onChange={(kind) => set(t.id, { kind })} options={KINDS} align="right" />
                <select
                  value={t.duration}
                  onChange={(e) => set(t.id, { duration: Number(e.target.value) })}
                  className="h-8 rounded-xl border border-line bg-surface px-1.5 text-[12px] text-text-2"
                >
                  {[1.5, 2, 2.5, 3, 4, 5, 6, 8].map((d) => (
                    <option key={d} value={d}>
                      {d}s
                    </option>
                  ))}
                </select>
                <Switch checked={t.enabled} onChange={(v) => set(t.id, { enabled: v })} label="Show title" />
                <IconButton label="Delete title" onClick={() => update((e) => ({ ...e, titles: e.titles.filter((x) => x.id !== t.id) }))}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
