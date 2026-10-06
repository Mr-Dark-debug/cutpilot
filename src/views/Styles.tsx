import { open } from "@tauri-apps/plugin-dialog";
import { Copy, Film, Link2, Loader2, Palette, Plus, RotateCcw, Save, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Thumb } from "../components/ProjectBits";
import { Badge, Button, Card, Field, IconButton, Input, Modal, Segmented, Switch, Textarea, clsx } from "../components/ui";
import { api, errorText } from "../lib/api";
import { VIDEO_EXT } from "../lib/format";
import { useStore } from "../lib/store";
import type { Style } from "../lib/types";

const DOT: Record<string, string> = {
  violet: "bg-violet-500",
  blue: "bg-sky-500",
  amber: "bg-amber-500",
  pink: "bg-pink-500",
  green: "bg-emerald-500",
  slate: "bg-slate-500",
};

export function Styles({ initialId }: { initialId?: string }) {
  const styles = useStore((s) => s.styles);
  const loadStyles = useStore((s) => s.loadStyles);
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const jobs = useStore((s) => s.jobs);
  const [selId, setSelId] = useState(initialId || styles[0]?.id);
  const [draft, setDraft] = useState<Style | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const [url, setUrl] = useState("");

  const sel = styles.find((s) => s.id === selId) ?? styles[0];
  useEffect(() => {
    if (sel) setDraft(structuredClone(sel));
  }, [sel]);

  const analyzing = Object.values(jobs).filter((j) => j.kind === "reference" && (j.state === "running" || j.state === "queued"));
  const dirty = draft && sel && JSON.stringify(draft) !== JSON.stringify(sel);

  const save = async (s: Style) => {
    try {
      const saved = await api.saveStyle(s);
      await loadStyles();
      setSelId(saved.id);
      toast("Style saved", "ok");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const addRef = async (input: string) => {
    if (!draft) return;
    if (dirty) await save(draft);
    try {
      await api.analyzeStyleReference(draft.id, input);
      toast("Studying the reference. It's added to this style when done.");
    } catch (e) {
      toast(errorText(e), "error");
    }
    setRefOpen(false);
    setUrl("");
  };

  if (!draft) return null;

  return (
    <div className="flex h-full">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          <div>
            <div className="text-[18px] font-semibold tracking-tight">Styles</div>
            <div className="text-[12px] text-muted">House rules the AI follows</div>
          </div>
          <IconButton
            label="New style"
            onClick={() =>
              save({
                ...draft,
                id: "",
                name: "My style",
                description: "",
                builtin: false,
                references: [],
                instructions: "- Describe how you like your videos edited.\n",
              })
            }
          >
            <Plus className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto px-3 pb-3">
          {styles.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelId(s.id)}
              className={clsx(
                "flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                s.id === sel?.id ? "bg-surface shadow-card ring-1 ring-line" : "hover:bg-surface-3",
              )}
            >
              <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", DOT[s.color] ?? "bg-violet-500")} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <span className="truncate">{s.name}</span>
                  {settings?.defaultStyleId === s.id && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
                </span>
                <span className="line-clamp-2 text-[12px] text-muted">{s.description || "Custom style"}</span>
              </span>
              {s.references.length > 0 && <Badge>{s.references.length} ref</Badge>}
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[860px] space-y-5 px-8 py-7">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full bg-transparent text-[22px] font-semibold tracking-tight outline-none"
              />
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Short description"
                className="mt-0.5 w-full bg-transparent text-[13.5px] text-muted outline-none"
              />
            </div>
            {settings && settings.defaultStyleId !== draft.id && (
              <Button size="sm" variant="ghost" icon={<Star className="size-3.5" />} onClick={() => saveSettings({ ...settings, defaultStyleId: draft.id })}>
                Make default
              </Button>
            )}
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => save({ ...draft, id: "", name: `${draft.name} (copy)`, builtin: false })}>
              Duplicate
            </Button>
            {draft.builtin ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw className="size-3.5" />}
                onClick={async () => {
                  await api.deleteStyle(draft.id);
                  await loadStyles();
                  toast("Reset to the built-in version");
                }}
              >
                Reset
              </Button>
            ) : (
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="size-3.5" />}
                onClick={async () => {
                  await api.deleteStyle(draft.id);
                  await loadStyles();
                  setSelId(styles[0]?.id);
                }}
              >
                Delete
              </Button>
            )}
            <Button size="sm" variant="primary" icon={<Save className="size-3.5" />} disabled={!dirty} onClick={() => save(draft)}>
              Save
            </Button>
          </div>

          <Card className="p-5">
            <Field label="House rules" hint="Plain-language rules for the AI editor. Tune these over a few videos until the first cut is nearly right.">
              <Textarea rows={11} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} className="font-mono text-[12.5px]" />
            </Field>
          </Card>

          <Card className="grid grid-cols-2 gap-x-8 gap-y-5 p-5">
            <Field label={`Pauses kept inside speech: up to ${draft.pauseKeep.toFixed(2)} s`} hint="Lower = tighter jump cuts. Longer pauses are always cut.">
              <input type="range" min={0.15} max={1.2} step={0.05} value={draft.pauseKeep} onChange={(e) => setDraft({ ...draft, pauseKeep: Number(e.target.value) })} className="w-full" />
            </Field>
            <Field label={draft.brollEvery ? `B-roll roughly every ${draft.brollEvery} s` : "B-roll: only where it clearly helps"} hint="A rhythm hint for the AI, not a hard rule.">
              <input type="range" min={0} max={60} step={1} value={draft.brollEvery} onChange={(e) => setDraft({ ...draft, brollEvery: Number(e.target.value) })} className="w-full" />
            </Field>
            <Field label="Target length" hint="0 = as long as the content needs.">
              <div className="flex items-center gap-2">
                <Input type="number" min={0} value={draft.targetLength} onChange={(e) => setDraft({ ...draft, targetLength: Number(e.target.value) })} className="w-28" />
                <span className="text-[12.5px] text-muted">seconds</span>
              </div>
            </Field>
            <Field label="Output shape">
              <Segmented
                value={draft.aspect || "16:9"}
                onChange={(aspect) => setDraft({ ...draft, aspect })}
                options={[
                  { value: "16:9", label: "16:9" },
                  { value: "9:16", label: "9:16" },
                ]}
              />
            </Field>
            <label className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-text-2">On-screen titles for key points</span>
              <Switch checked={draft.titles} onChange={(titles) => setDraft({ ...draft, titles })} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-text-2">Burn captions in renders</span>
              <Switch checked={draft.captions} onChange={(captions) => setDraft({ ...draft, captions })} />
            </label>
          </Card>

          <Card className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[14px] font-semibold">Reference videos</div>
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setRefOpen(true)}>
                Add reference
              </Button>
            </div>
            <p className="mb-4 text-[12.5px] text-muted">
              Videos whose editing you want to copy. CutPilot measures their cut rate, pauses and pacing, and the AI writes rules from what it sees.
            </p>
            {analyzing.length > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[12.5px] text-accent-text">
                <Loader2 className="size-3.5 animate-spin" /> {analyzing[0].message || "Studying reference…"}
              </div>
            )}
            {draft.references.length === 0 && analyzing.length === 0 && (
              <div className="rounded-xl border border-dashed border-line p-5 text-center text-[12.5px] text-muted">No references yet.</div>
            )}
            <div className="space-y-3">
              {draft.references.map((r, i) => (
                <div key={i} className="rounded-xl border border-line p-3.5">
                  <div className="flex items-start gap-3">
                    <Thumb src={r.thumb} className="h-14 w-24 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{r.name}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <Badge>{r.metrics.cutsPerMin.toFixed(1)} cuts/min</Badge>
                        <Badge>{r.metrics.avgShot.toFixed(1)}s average shot</Badge>
                        <Badge>{Math.round(r.metrics.wordsPerMin)} words/min</Badge>
                        <Badge>{Math.round(r.metrics.speechRatio * 100)}% speech</Badge>
                      </div>
                    </div>
                    <IconButton label="Remove" onClick={() => setDraft({ ...draft, references: draft.references.filter((_, k) => k !== i) })}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-text-2">{r.style.summary}</p>
                  {r.style.rules.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px] text-muted">
                      {r.style.rules.map((rule, k) => (
                        <li key={k}>{rule}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={refOpen}
        onClose={() => setRefOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Palette className="size-4" /> Learn from a reference
          </span>
        }
        width={500}
        footer={
          <>
            <Button
              icon={<Film className="size-4" />}
              onClick={async () => {
                const f = await open({ multiple: false, filters: [{ name: "Video", extensions: VIDEO_EXT }] });
                if (typeof f === "string") addRef(f);
              }}
            >
              Choose a file…
            </Button>
            <Button variant="primary" icon={<Link2 className="size-4" />} disabled={!url.trim().startsWith("http")} onClick={() => addRef(url.trim())}>
              Study link
            </Button>
          </>
        }
      >
        <p className="mb-3 text-[13px] leading-relaxed text-muted">The first 10 minutes are analysed. YouTube links need yt-dlp (Settings ▸ Tools).</p>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" autoFocus />
      </Modal>
    </div>
  );
}
