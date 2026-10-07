import { open } from "@tauri-apps/plugin-dialog";
import { ArrowUp, Film, Link2, Loader2, Music2, PanelRightClose, PanelRightOpen, Plus, RectangleVertical, X } from "lucide-react";
import { useEffect, useState } from "react";
import { defaultEngine } from "../components/EnginePicker";
import { EffortPicker, ModelPicker } from "../components/ModelPicker";
import { ProjectRow } from "../components/ProjectBits";
import { StylePicker } from "../components/StylePicker";
import { Button, Card, Input, Modal, Segmented, clsx } from "../components/ui";
import { api, errorText } from "../lib/api";
import { AUDIO_EXT, VIDEO_EXT, fileName, isVideo } from "../lib/format";
import { useStore, writeFlag } from "../lib/store";
import type { EngineChoice } from "../lib/types";

function readRecentOpen() {
  try {
    return localStorage.getItem("cutpilot-recent-open") !== "0";
  } catch {
    return true;
  }
}

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
  const [recentOpen, setRecentOpen] = useState(readRecentOpen);

  useEffect(() => {
    if (!dropped.length) return;
    const vids = dropped.filter(isVideo);
    if (vids.length) setFiles((f) => [...new Set([...f, ...vids])]);
    if (vids.length < dropped.length) toast("Only video files can be dropped here", "info");
    setDropped([]);
  }, [dropped, setDropped, toast]);

  useEffect(() => {
    const st = styles.find((s) => s.id === styleId);
    setAspect(st?.aspect === "9:16" ? "9:16" : "16:9");
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

  const toggleRecent = () => {
    writeFlag("cutpilot-recent-open", !recentOpen);
    setRecentOpen(!recentOpen);
  };

  const tool = "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium whitespace-nowrap text-text-2 hover:bg-surface-3 hover:text-text";

  return (
    <div className="flex h-full">
      <div className="dotted relative flex min-w-0 flex-1 flex-col overflow-auto">
        <button
          onClick={toggleRecent}
          title={recentOpen ? "Hide recent projects" : "Show recent projects"}
          className="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-text"
        >
          {recentOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
        </button>
        <div className="mx-auto flex w-full max-w-[860px] flex-1 flex-col justify-center px-8 py-10">
          <h1 className="mb-7 text-center text-[32px] leading-tight font-semibold tracking-tight">What are we editing today?</h1>

          <Card className="overflow-visible p-0">
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
                  ? "How should it be edited? e.g. “Tight 10-minute cut, hook with the best moment, B-roll on every example, chapters.”"
                  : "Drop videos anywhere, or click Add videos. Then describe the edit you want…"
              }
              className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14px] leading-relaxed outline-none placeholder:text-faint"
            />
            <div className="flex items-center gap-0.5 px-2.5 pb-2.5">
              <button onClick={pickVideos} className={tool}>
                <Plus className="size-3.5" /> Add videos
              </button>
              <button onClick={() => setRefOpen(true)} title="Add a reference video to match its style" className="inline-flex size-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-3 hover:text-text">
                <Link2 className="size-4" />
              </button>
              <button onClick={pickMusic} title="Add background music" className="inline-flex size-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-3 hover:text-text">
                <Music2 className="size-4" />
              </button>
              <span className="mx-1 h-4 w-px bg-line" />
              <ModelPicker value={engine} onChange={setEngine} />
              <EffortPicker value={engine} onChange={setEngine} />
              <StylePicker value={styleId} onChange={setStyleId} />
              <button onClick={() => setAspect(aspect === "16:9" ? "9:16" : "16:9")} title="Output shape" className={tool}>
                <RectangleVertical className={clsx("size-3.5 transition-transform", aspect === "16:9" && "rotate-90")} /> {aspect}
              </button>
              <div className="flex-1" />
              <button
                onClick={create}
                disabled={busy}
                title={files.length > 1 && batch ? `Edit ${files.length} videos (Ctrl+Enter)` : "Create edit (Ctrl+Enter)"}
                className="ml-1 flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-text px-3 text-[13px] font-medium text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                {files.length > 1 && batch ? files.length : null}
              </button>
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
          <div className="mt-3 text-center text-[12px] text-faint">Footage stays on your computer. Only the transcript and a few frame thumbnails go to your AI engine.</div>
        </div>
      </div>

      {recentOpen && (
        <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-sidebar">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div className="text-[13px] font-semibold">
              Recent projects <span className="font-normal text-muted">({projects.length})</span>
            </div>
            <button onClick={() => navigate({ name: "projects" })} className="mr-8 text-[12.5px] font-medium text-accent-text hover:underline">
              View all
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-auto px-3 pb-3">
            {projects.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line p-5 text-center text-[12.5px] leading-relaxed text-muted">
                Your edits will show up here. Start by dropping a video on the left.
              </div>
            )}
            {projects.slice(0, 12).map((p) => (
              <ProjectRow key={p.id} project={p} onClick={() => navigate({ name: "project", id: p.id })} />
            ))}
          </div>
        </aside>
      )}

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
          CutPilot studies a reference's pacing (cuts per minute, pauses, B-roll, on-screen text) and asks the AI to match its feel. Use a downloaded file or paste a
          YouTube link.
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
