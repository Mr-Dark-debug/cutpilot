import { AlertCircle, CheckCircle2, Clock, Film, Loader2, PauseCircle } from "lucide-react";
import { fileSrc } from "../lib/api";
import { fmtDuration, timeAgo } from "../lib/format";
import { useProjectJob } from "../lib/store";
import type { Project } from "../lib/types";
import { Badge, Progress, clsx } from "./ui";

export function Thumb({ src, className, children }: { src?: string | null; className?: string; children?: React.ReactNode }) {
  const url = fileSrc(src);
  return (
    <div className={clsx("relative overflow-hidden bg-surface-3", className)}>
      {url ? (
        <img src={url} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-faint">
          <Film className="size-5" />
        </div>
      )}
      {children}
    </div>
  );
}

export function StatusPill({ project }: { project: Project }) {
  const job = useProjectJob(project.id);
  const state = job ? job.state : project.status.state;
  if (state === "running" || state === "queued")
    return (
      <Badge tone="accent">
        <Loader2 className="size-3 animate-spin" /> {state === "queued" ? "Queued" : "Editing"}
      </Badge>
    );
  if (state === "error")
    return (
      <Badge tone="bad">
        <AlertCircle className="size-3" /> Failed
      </Badge>
    );
  if (state === "cancelled")
    return (
      <Badge>
        <PauseCircle className="size-3" /> Stopped
      </Badge>
    );
  if (project.currentEdit)
    return (
      <Badge tone="ok">
        <CheckCircle2 className="size-3" /> Ready · v{project.currentEdit}
      </Badge>
    );
  return (
    <Badge>
      <Clock className="size-3" /> Not started
    </Badge>
  );
}

export function projectDuration(p: Project) {
  const total = p.sources.reduce((a, s) => a + (s.info?.duration ?? 0), 0);
  const edit = p.edits.find((e) => e.version === p.currentEdit);
  return { total, edited: edit?.duration ?? 0 };
}

export function ProjectRow({ project, onClick }: { project: Project; onClick: () => void }) {
  const job = useProjectJob(project.id);
  const { total, edited } = projectDuration(project);
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 text-left shadow-card transition-colors hover:border-line-strong"
    >
      <Thumb src={project.sources[0]?.thumb} className="h-11 w-16 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{project.name}</div>
        {job ? (
          <div className="mt-1.5">
            <Progress value={job.progress} />
            <div className="mt-1 truncate text-[11.5px] text-muted">{job.message || job.stage || "Starting…"}</div>
          </div>
        ) : (
          <div className="mt-0.5 truncate text-[12px] text-muted">
            {edited ? `${fmtDuration(total)} → ${fmtDuration(edited)}` : project.status.state === "error" ? "Failed – open to see why" : fmtDuration(total) || "New"}
            {" · "}
            {timeAgo(project.updated)}
          </div>
        )}
      </div>
    </button>
  );
}
