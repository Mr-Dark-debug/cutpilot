import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertCircle, ArrowLeft, Check, Clapperboard, FolderOpen, Loader2, RotateCw, Send, Sparkles, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JobLog } from "../../components/JobLog";
import { StatusPill } from "../../components/ProjectBits";
import { Button, Card, IconButton, Progress, Segmented, clsx } from "../../components/ui";
import { api, errorText } from "../../lib/api";
import { useProjectJob, useStore } from "../../lib/store";
import { BrollPanel } from "./BrollPanel";
import { ChatPanel } from "./ChatPanel";
import { ExportTab } from "./ExportTab";
import { FootageTab } from "./FootageTab";
import { NotesPanel } from "./NotesPanel";
import { Player, type PlayerHandle } from "./Player";
import { StoryPanel } from "./StoryPanel";
import { TimelineStrip } from "./TimelineStrip";
import { TitlesPanel } from "./TitlesPanel";
import { useEditor } from "./useEditor";

type Tab = "edit" | "footage" | "export" | "activity";
type Lower = "story" | "broll" | "titles" | "notes";

export function ProjectView({ id, initialTab }: { id: string; initialTab?: string }) {
  const project = useStore((s) => s.projects.find((p) => p.id === id));
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const refreshProject = useStore((s) => s.refreshProject);
  const jobs = useStore((s) => s.jobs);
  const job = useProjectJob(id);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || "edit");
  const [lower, setLower] = useState<Lower>("story");
  const [time, setTime] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const player = useRef<PlayerHandle>(null);

  // Reload the edit whenever a job for this project finishes.
  const finishedKey = Object.values(jobs)
    .filter((j) => j.projectId === id && j.state === "done")
    .map((j) => j.id)
    .join(",");
  useEffect(() => {
    if (finishedKey) {
      setReloadToken((n) => n + 1);
      refreshProject(id);
    }
  }, [finishedKey, id, refreshProject]);

  useEffect(() => {
    refreshProject(id);
  }, [id, refreshProject]);

  const { bundle, setBundle, error, saving, update, sources } = useEditor(project, reloadToken);
  const onSeek = useCallback((t: number) => player.current?.seek(t), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || tab !== "edit") return;
      if (e.code === "Space") {
        e.preventDefault();
        player.current?.toggle();
      } else if (e.key === "j" || e.key === "ArrowLeft") player.current?.seek(time - (e.key === "j" ? 5 : 1));
      else if (e.key === "l" || e.key === "ArrowRight") player.current?.seek(time + (e.key === "l" ? 5 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, time]);

  const lastError = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.projectId === id)
        .sort((a, b) => b.created.localeCompare(a.created))[0],
    [jobs, id],
  );

  if (!project)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading project…
      </div>
    );

  const start = async () => {
    try {
      await api.startPipeline(project.id);
      refreshProject(project.id);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const hasEdit = !!project.currentEdit && !!bundle;
  const multiSource = project.sources.length > 1;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <IconButton label="Back to projects" onClick={() => navigate({ name: "projects" })}>
          <ArrowLeft className="size-4" />
        </IconButton>
        {renaming ? (
          <input
            autoFocus
            defaultValue={project.name}
            className="h-8 rounded-lg border border-accent bg-surface px-2 text-[15px] font-semibold outline-none"
            onBlur={async (e) => {
              setRenaming(false);
              const name = e.target.value.trim();
              if (name && name !== project.name) {
                await api.updateProject(project.id, { name });
                refreshProject(project.id);
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button onDoubleClick={() => setRenaming(true)} title="Double-click to rename" className="max-w-[340px] truncate text-[15px] font-semibold">
            {project.name}
          </button>
        )}
        <StatusPill project={project} />
        {saving !== "idle" && (
          <span className="flex items-center gap-1 text-[12px] text-muted">
            {saving === "saving" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-ok" />}
            {saving === "saving" ? "Saving" : "Saved"}
          </span>
        )}
        <div className="flex-1" />
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "edit", label: "Edit" },
            { value: "footage", label: "Footage & style" },
            { value: "export", label: "Export" },
            { value: "activity", label: "Activity" },
          ]}
        />
        <div className="flex-1" />
        <IconButton label="Open project folder" onClick={() => revealItemInDir(project.dir + "\\project.json")}>
          <FolderOpen className="size-4" />
        </IconButton>
        {hasEdit && (
          <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} onClick={() => setTab("export")}>
            Export
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "footage" && <FootageTab project={project} />}
        {tab === "export" && <ExportTab project={project} />}
        {tab === "activity" && (
          <div className="mx-auto max-w-[980px] p-6">
            {lastError ? (
              <Card className="overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-semibold">
                  {lastError.title}
                  <span className="text-[12px] font-normal text-muted">· {lastError.state}</span>
                </div>
                <JobLog jobId={lastError.id} className="h-[60vh]" />
              </Card>
            ) : (
              <div className="p-10 text-center text-[13px] text-muted">No activity in this session yet. Logs of past runs are in the project's logs folder.</div>
            )}
          </div>
        )}

        {tab === "edit" &&
          (hasEdit ? (
            <div className="flex h-full min-h-[640px]">
              <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
                <div className="h-[46vh] min-h-[300px] shrink-0">
                  <Player ref={player} project={project} timeline={bundle.timeline} onTime={setTime} />
                </div>
                <TimelineStrip
                  timeline={bundle.timeline}
                  edit={bundle.edit}
                  time={time}
                  onSeek={onSeek}
                  selected={selected}
                  onSelect={(kind, sid) => {
                    setSelected(sid);
                    setLower(kind === "clip" ? "story" : kind === "broll" ? "broll" : "titles");
                  }}
                />
                {job && (
                  <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft/50 px-3 py-2 text-[12.5px]">
                    <Loader2 className="size-3.5 animate-spin text-accent" />
                    <span className="truncate">{job.message || job.stage}</span>
                    <Progress value={job.progress} className="w-40" />
                  </div>
                )}
                <div>
                  <div className="mb-3 flex items-center gap-1 border-b border-line">
                    {(
                      [
                        ["story", `Story · ${bundle.edit.segments.length} sections`],
                        ["broll", `B-roll · ${bundle.edit.broll.length}`],
                        ["titles", `Titles · ${bundle.edit.titles.length}`],
                        ["notes", "Notes & YouTube"],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => setLower(k)}
                        className={clsx(
                          "-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium transition-colors",
                          lower === k ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {lower === "story" && (
                    <StoryPanel
                      edit={bundle.edit}
                      timeline={bundle.timeline}
                      sources={sources}
                      time={time}
                      update={update}
                      onSeek={onSeek}
                      selected={selected}
                      multiSource={multiSource}
                    />
                  )}
                  {lower === "broll" && (
                    <BrollPanel project={project} edit={bundle.edit} timeline={bundle.timeline} update={update} onSeek={onSeek} setBundle={setBundle} selected={selected} />
                  )}
                  {lower === "titles" && <TitlesPanel edit={bundle.edit} timeline={bundle.timeline} time={time} update={update} onSeek={onSeek} selected={selected} />}
                  {lower === "notes" && <NotesPanel edit={bundle.edit} timeline={bundle.timeline} />}
                </div>
              </div>
              <aside className="w-[340px] shrink-0 border-l border-line bg-sidebar">
                <ChatPanel project={project} versions={bundle.versions} />
              </aside>
            </div>
          ) : project.currentEdit && !error && !job ? (
            <div className="flex h-full items-center justify-center text-[13px] text-muted">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading the edit…
            </div>
          ) : (
            <Progressing project={project} start={start} error={error} lastJobId={lastError?.id} />
          ))}
      </div>
    </div>
  );
}

function Progressing({ project, start, error, lastJobId }: { project: ReturnType<typeof useStore.getState>["projects"][number]; start: () => void; error: string | null; lastJobId?: string }) {
  const job = useProjectJob(project.id);
  const failed = !job && project.status.state === "error";
  // Pipeline progress bands: analysis 0–0.6 (transcription inside), references to 0.7,
  // AI planning 0.7–0.9, B-roll 0.9–0.97, export after.
  const bands = [0.5, 0.6, 0.9, 0.97, 1.01];
  const p = job?.progress ?? 0;
  const stepIndex = bands.findIndex((b) => p < b);
  return (
    <div className="dotted flex h-full items-start justify-center overflow-auto p-8">
      <Card className="w-full max-w-[640px] p-7">
        {job ? (
          <>
            <div className="mb-1 flex items-center gap-2 text-[16px] font-semibold">
              <Sparkles className="size-4.5 text-accent" /> Making the first cut
            </div>
            <p className="mb-5 text-[13px] text-muted">You can leave this page. CutPilot keeps working and lets you know when it's ready.</p>
            <Progress value={job.progress} className="mb-2 h-2" />
            <div className="mb-5 flex justify-between text-[12.5px] text-text-2">
              <span className="truncate">{job.message || job.stage || "Starting…"}</span>
              <span className="text-muted tabular-nums">{Math.round(job.progress * 100)}%</span>
            </div>
            <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-2">
              {["Transcribe with word timing", "Detect pauses, retakes & scenes", "AI decides what stays", "B-roll, titles & chapters", "Timeline for Resolve"].map((s, i) => {
                const done = i < stepIndex;
                const active = i === stepIndex;
                return (
                  <div key={s} className={clsx("flex items-center gap-2 text-[12.5px]", done ? "text-text" : active ? "font-medium text-accent-text" : "text-faint")}>
                    {done ? <Check className="size-3.5 text-ok" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : <span className="size-3.5 rounded-full border border-line-strong" />}
                    {s}
                  </div>
                );
              })}
            </div>
            <JobLog jobId={job.id} className="h-56 rounded-xl border border-line" />
            <div className="mt-4 flex justify-end">
              <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => api.cancelJob(job.id)}>
                Stop
              </Button>
            </div>
          </>
        ) : failed ? (
          <>
            <div className="mb-2 flex items-center gap-2 text-[16px] font-semibold text-bad">
              <AlertCircle className="size-5" /> The edit didn't finish
            </div>
            <p className="selectable mb-5 text-[13px] leading-relaxed text-text-2">{project.status.message || error}</p>
            {lastJobId && <JobLog jobId={lastJobId} className="mb-5 h-48 rounded-xl border border-line" />}
            <Button variant="primary" icon={<RotateCw className="size-4" />} onClick={start}>
              Try again
            </Button>
          </>
        ) : (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
              <Clapperboard className="size-5" />
            </div>
            <div className="text-[16px] font-semibold">Ready when you are</div>
            <p className="mx-auto mt-1.5 mb-5 max-w-sm text-[13px] text-muted">
              {project.sources.length} video{project.sources.length > 1 ? "s" : ""} added. Check the brief and style under Footage & style, then start.
            </p>
            <Button variant="primary" icon={<Wand2 className="size-4" />} onClick={start}>
              Start editing
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
