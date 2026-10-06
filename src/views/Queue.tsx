import { AlertCircle, CheckCircle2, ChevronRight, CircleSlash, ListVideo, Loader2, X } from "lucide-react";
import { useState } from "react";
import { JobLog } from "../components/JobLog";
import { Badge, Button, Card, Empty, IconButton, Progress, Select, clsx } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useStore } from "../lib/store";
import type { JobInfo } from "../lib/types";

export function Queue() {
  const jobs = useStore((s) => s.jobs);
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const loadJobs = useStore((s) => s.loadJobs);
  const list = Object.values(jobs).sort((a, b) => {
    const rank = (j: JobInfo) => (j.state === "running" ? 0 : j.state === "queued" ? 1 : 2);
    return rank(a) - rank(b) || b.created.localeCompare(a.created);
  });
  const active = list.filter((j) => j.state === "running" || j.state === "queued");
  const done = list.filter((j) => !(j.state === "running" || j.state === "queued"));

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[980px] px-8 py-7">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Queue</h1>
            <p className="mt-1 text-[13.5px] text-muted">
              Editing runs outside any NLE, so many videos can be planned at once. Transcription and AI work have separate limits.
            </p>
          </div>
          {settings && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <span>AI in parallel</span>
              <Select
                compact
                className="w-16"
                value={String(settings.llmConcurrency)}
                onChange={(v) => saveSettings({ ...settings, llmConcurrency: Number(v) })}
                options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }))}
              />
              <span className="ml-2">Transcription</span>
              <Select
                compact
                className="w-16"
                value={String(settings.mediaConcurrency)}
                onChange={(v) => saveSettings({ ...settings, mediaConcurrency: Number(v) })}
                options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
          )}
        </div>

        {list.length === 0 && (
          <Empty icon={<ListVideo className="size-5" />} title="Nothing in the queue">
            Drop several videos in the Studio and choose “Separate edit for each” to edit them in parallel.
          </Empty>
        )}

        {active.length > 0 && (
          <div className="mb-7 space-y-2.5">
            <div className="text-[12px] font-semibold tracking-wide text-muted uppercase">In progress · {active.length}</div>
            {active.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold tracking-wide text-muted uppercase">Finished · {done.length}</div>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await api.clearJobs();
                  loadJobs();
                }}
              >
                Clear finished
              </Button>
            </div>
            {done.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobCard({ job }: { job: JobInfo }) {
  const navigate = useStore((s) => s.navigate);
  const [open, setOpen] = useState(false);
  const running = job.state === "running" || job.state === "queued";
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 p-3.5">
        <div
          className={clsx(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            running ? "bg-accent-soft text-accent-text" : job.state === "done" ? "bg-ok-soft text-ok" : job.state === "error" ? "bg-bad-soft text-bad" : "bg-surface-3 text-muted",
          )}
        >
          {running ? (
            <Loader2 className="size-4.5 animate-spin" />
          ) : job.state === "done" ? (
            <CheckCircle2 className="size-4.5" />
          ) : job.state === "error" ? (
            <AlertCircle className="size-4.5" />
          ) : (
            <CircleSlash className="size-4.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold">{job.title}</span>
            <Badge>{job.kind}</Badge>
            {job.state === "queued" && <Badge tone="warn">waiting</Badge>}
          </div>
          {running ? (
            <div className="mt-2 flex items-center gap-3">
              <Progress value={job.progress} className="flex-1" />
              <span className="w-10 text-right text-[12px] text-muted tabular-nums">{Math.round(job.progress * 100)}%</span>
            </div>
          ) : null}
          <div className={clsx("mt-1 truncate text-[12.5px]", job.state === "error" ? "text-bad" : "text-muted")}>
            {job.state === "done" ? `Finished ${timeAgo(job.finished ?? job.created)}` : job.message || job.stage || "Starting…"}
          </div>
        </div>
        {job.projectId && (
          <Button size="sm" onClick={() => navigate({ name: "project", id: job.projectId! })}>
            Open
          </Button>
        )}
        {running && (
          <IconButton label="Cancel" onClick={() => api.cancelJob(job.id)}>
            <X className="size-4" />
          </IconButton>
        )}
        <IconButton label="Show log" onClick={() => setOpen((o) => !o)}>
          <ChevronRight className={clsx("size-4 transition-transform", open && "rotate-90")} />
        </IconButton>
      </div>
      {open && (
        <div className="border-t border-line">
          <JobLog jobId={job.id} className="max-h-72" />
        </div>
      )}
    </Card>
  );
}
