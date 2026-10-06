import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Clapperboard,
  Film,
  Link2,
  Music2,
  Plus,
  RectangleVertical,
  Smartphone,
  Sparkles,
  Stethoscope,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EngineChip, defaultEngine } from "../components/EnginePicker";
import { ProjectRow } from "../components/ProjectBits";
import { Badge, Button, Card, Input, Modal, Segmented, Select, clsx } from "../components/ui";
import { api, errorText } from "../lib/api";
import { AUDIO_EXT, VIDEO_EXT, fileName, isVideo } from "../lib/format";
import { useStore } from "../lib/store";
import type { EngineChoice } from "../lib/types";

const QUICK = [
  { style: "talking-head", title: "YouTube talking head", text: "Retakes out, tight cuts, B-roll", icon: Video, tint: "from-violet-500/15 to-violet-500/5 text-violet-500" },
  { style: "medical-edu", title: "Doctor / dentist explainer", text: "Clear, accurate, safe visuals", icon: Stethoscope, tint: "from-sky-500/15 to-sky-500/5 text-sky-500" },
  { style: "shorts", title: "Shorts / Reels", text: "Under 60 s, vertical, hook first", icon: Smartphone, tint: "from-pink-500/15 to-pink-500/5 text-pink-500" },
  { style: "vlog", title: "Vlog", text: "Story kept, natural pacing", icon: Clapperboard, tint: "from-amber-500/15 to-amber-500/5 text-amber-500" },
];

export function Home() {
  const settings = useStore((s) => s.settings);
  const styles = useStore((s) => s.styles);
  const projects = useStore((s) => s.projects);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const dropped = useStore((s) => s.dropped);
  const setDropped = useStore((s) => s.setDropped);
  const loadProjects = useStore((s) => s.loadProjects);

  const [files, setFiles] = useState<string[]>([]);
  const [refs, setRefs] = useState<string[]>([]);
  const [music, setMusic] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [styleId, setStyleId] = useState(settings?.defaultStyleId || "talking-head");
  const [engine, setEngine] = useState<EngineChoice>(defaultEngine());
  const [aspect, setAspect] = useState<"16:9" | "9:16">("16:9");
  const [batch, setBatch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [refUrl, setRefUrl] = useState("");

  useEffect(() => {
    if (!dropped.length) return;
    const vids = dropped.filter(isVideo);
    if (vids.length) setFiles((f) => [...new Set([...f, ...vids])]);
    if (vids.length < dropped.length) toast("Only video files can be dropped here", "info");
    setDropped([]);
  }, [dropped, setDropped, toast]);

  useEffect(() => {
    const st = styles.find((s) => s.id === styleId);
    if (st?.aspect === "9:16") setAspect("9:16");
  }, [styleId, styles]);

  const pickVideos = async () => {
    const res = await open({ multiple: true, filters: [{ name: "Video", extensions: VIDEO_EXT }] });
    if (res) setFiles((f) => [...new Set([...f, ...(Array.isArray(res) ? res : [res])])]);
  };
  const pickRef = async () => {
    const res = await open({ multiple: true, filters: [{ name: "Video", extensions: VIDEO_EXT }] });
    if (res) setRefs((r) => [...new Set([...r, ...(Array.isArray(res) ? res : [res])])]);
    setRefOpen(false);
  };
  const pickMusic = async () => {
    const res = await open({ multiple: false, filters: [{ name: "Audio", extensions: AUDIO_EXT }] });
    if (typeof res === "string") setMusic(res);
  };

  const create = async () => {
    if (!files.length) {
      pickVideos();
      return;
    }
    setBusy(true);
    try {
      const args = { sources: files, references: refs, brief, styleId, engine, aspect, music };
      if (files.length > 1 && batch) {
        const ps = await api.createBatch(args);
        toast(`Started ${ps.length} edits in parallel`, "ok");
        await loadProjects();
        navigate({ name: "queue" });
      } else {
        const p = await api.createProject(args, true);
        await loadProjects();
        navigate({ name: "project", id: p.id });
      }
      setFiles([]);
      setRefs([]);
      setBrief("");
      setMusic(null);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const styleOptions = useMemo(() => styles.map((s) => ({ value: s.id, label: s.name, hint: s.description })), [styles]);
  const recent = projects.slice(0, 8);

  return (
    <div className="flex h-full">
      <div className="dotted flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col justify-center px-8 py-10">
          <div className="mb-8 text-center">
            <Badge tone="accent" className="mb-4">
              <Sparkles className="size-3" /> Edits with your Claude or Codex subscription
            </Badge>
            <h1 className="text-[34px] leading-tight font-semibold tracking-tight">What are we editing today?</h1>
            <p className="mx-auto mt-2.5 max-w-[520px] text-[14.5px] leading-relaxed text-muted">
              Drop your raw footage, say how you want it. CutPilot cuts the retakes and dead air, plans B-roll, titles and chapters,
              and hands a finished timeline to DaVinci Resolve.
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3">
            {QUICK.map((q) => {
              const active = styleId === q.style;
              return (
                <button
                  key={q.style}
                  onClick={() => {
                    setStyleId(q.style);
                    setAspect(q.style === "shorts" ? "9:16" : "16:9");
                  }}
                  className={clsx(
                    "group flex items-center gap-3 rounded-2xl border bg-surface p-3 text-left shadow-card transition-all hover:-translate-y-px",
                    active ? "border-accent ring-3 ring-accent/12" : "border-line hover:border-line-strong",
                  )}
                >
                  <span className={clsx("flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br", q.tint)}>
                    <q.icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold">{q.title}</span>
                    <span className="block truncate text-[12.5px] text-muted">{q.text}</span>
                  </span>
                  <span
                    className={clsx(
                      "flex size-6 items-center justify-center rounded-full border text-[11px]",
                      active ? "border-accent bg-accent text-white" : "border-line text-muted",
                    )}
                  >
                    {active ? "✓" : <Plus className="size-3" />}
                  </span>
                </button>
              );
            })}
          </div>

          <Card className="overflow-visible p-0 ring-1 ring-accent/10">
            {(files.length > 0 || refs.length > 0 || music) && (
              <div className="flex flex-wrap gap-1.5 border-b border-line p-3">
                {files.map((f) => (
                  <Chip key={f} icon={<Film className="size-3.5 text-accent" />} label={fileName(f)} onRemove={() => setFiles(files.filter((x) => x !== f))} />
                ))}
                {refs.map((r) => (
                  <Chip key={r} icon={<Link2 className="size-3.5 text-sky-500" />} label={`Reference · ${r.startsWith("http") ? r : fileName(r)}`} onRemove={() => setRefs(refs.filter((x) => x !== r))} />
                ))}
                {music && <Chip icon={<Music2 className="size-3.5 text-emerald-500" />} label={`Music · ${fileName(music)}`} onRemove={() => setMusic(null)} />}
              </div>
            )}
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) create();
              }}
              rows={3}
              placeholder={
                files.length
                  ? "How should it be edited? e.g. “Tight 8-minute cut, hook with the bleeding-gums question, B-roll on every tip, chapters.”"
                  : "Drop videos anywhere, or click Add videos. Then describe the edit you want…"
              }
              className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14px] leading-relaxed outline-none placeholder:text-faint"
            />
            <div className="flex items-center gap-0.5 px-2.5 pb-2.5">
              <button onClick={pickVideos} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] whitespace-nowrap font-medium text-text-2 hover:bg-surface-3 hover:text-text">
                <Plus className="size-3.5" /> Add videos
              </button>
              <button onClick={() => setRefOpen(true)} title="Add a reference video to match its style" className="inline-flex size-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-3 hover:text-text">
                <Link2 className="size-4" />
              </button>
              <button onClick={pickMusic} title="Add background music" className="inline-flex size-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-3 hover:text-text">
                <Music2 className="size-4" />
              </button>
              <span className="mx-1 h-4 w-px bg-line" />
              <EngineChip value={engine} onChange={setEngine} />
              <div className="w-[170px] shrink-0">
                <Select compact value={styleId} onChange={setStyleId} options={styleOptions} icon={<Sparkles className="size-3.5" />} />
              </div>
              <button
                onClick={() => setAspect(aspect === "16:9" ? "9:16" : "16:9")}
                title="Output shape"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] whitespace-nowrap font-medium text-text-2 hover:bg-surface-3 hover:text-text"
              >
                <RectangleVertical className={clsx("size-3.5 transition-transform", aspect === "16:9" && "rotate-90")} /> {aspect}
              </button>
              <div className="flex-1" />
              <Button variant="primary" onClick={create} loading={busy} className="rounded-xl" icon={!busy && <ArrowUp className="size-4" />}>
                {files.length > 1 && batch ? `Edit ${files.length} videos` : "Create edit"}
              </Button>
            </div>
            {files.length > 1 && (
              <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
                <span>{files.length} videos:</span>
                <Segmented
                  size="sm"
                  value={batch ? "batch" : "one"}
                  onChange={(v) => setBatch(v === "batch")}
                  options={[
                    { value: "batch", label: "Separate edit for each (batch)" },
                    { value: "one", label: "One edit from all clips" },
                  ]}
                />
              </div>
            )}
          </Card>
          <div className="mt-3 text-center text-[12px] text-faint">
            Footage stays on your computer. Only the transcript and a few frame thumbnails go to your AI engine.
          </div>
        </div>
      </div>

      <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-sidebar">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="text-[13px] font-semibold">
            Recent projects <span className="font-normal text-muted">({projects.length})</span>
          </div>
          <button onClick={() => navigate({ name: "projects" })} className="text-[12.5px] font-medium text-accent-text hover:underline">
            View all
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-auto px-3 pb-3">
          {recent.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line p-5 text-center text-[12.5px] leading-relaxed text-muted">
              Your edits will show up here. Start by dropping a video on the left.
            </div>
          )}
          {recent.map((p) => (
            <ProjectRow key={p.id} project={p} onClick={() => navigate({ name: "project", id: p.id })} />
          ))}
        </div>
      </aside>

      <Modal
        open={refOpen}
        onClose={() => setRefOpen(false)}
        title="Add a reference video"
        width={500}
        footer={
          <>
            <Button onClick={pickRef}>Choose a file…</Button>
            <Button
              variant="primary"
              disabled={!refUrl.trim().startsWith("http")}
              onClick={() => {
                setRefs((r) => [...new Set([...r, refUrl.trim()])]);
                setRefUrl("");
                setRefOpen(false);
              }}
            >
              Add link
            </Button>
          </>
        }
      >
        <p className="mb-3 text-[13px] leading-relaxed text-muted">
          CutPilot studies a reference's pacing (cuts per minute, pauses, B-roll, on-screen text) and asks the AI to match its feel. Use a
          downloaded file or paste a YouTube link (needs yt-dlp, installed from Settings ▸ Tools).
        </p>
        <Input value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" autoFocus />
      </Modal>
    </div>
  );
}

function Chip({ icon, label, onRemove }: { icon: React.ReactNode; label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-[280px] items-center gap-1.5 rounded-lg border border-line bg-surface-2 py-1 pr-1 pl-2 text-[12.5px]">
      {icon}
      <span className="truncate">{label}</span>
      <button onClick={onRemove} className="rounded p-0.5 text-muted hover:bg-surface-3 hover:text-text" aria-label="Remove">
        <X className="size-3" />
      </button>
    </span>
  );
}
