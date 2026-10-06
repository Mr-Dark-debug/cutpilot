import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, FolderKanban, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusPill, Thumb, projectDuration } from "../components/ProjectBits";
import { Button, Empty, IconButton, Modal, Segmented } from "../components/ui";
import { api, errorText } from "../lib/api";
import { fmtDuration, fmtTime, timeAgo } from "../lib/format";
import { useStore } from "../lib/store";
import type { Project } from "../lib/types";

type Filter = "all" | "active" | "ready" | "failed";

export function Projects() {
  const projects = useStore((s) => s.projects);
  const jobs = useStore((s) => s.jobs);
  const search = useStore((s) => s.search);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const loadProjects = useStore((s) => s.loadProjects);
  const [filter, setFilter] = useState<Filter>("all");
  const [deleting, setDeleting] = useState<Project | null>(null);

  const list = useMemo(() => {
    const active = new Set(
      Object.values(jobs)
        .filter((j) => j.state === "running" || j.state === "queued")
        .map((j) => j.projectId),
    );
    return projects.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "active") return active.has(p.id);
      if (filter === "ready") return !!p.currentEdit && !active.has(p.id);
      if (filter === "failed") return p.status.state === "error";
      return true;
    });
  }, [projects, jobs, search, filter]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1180px] px-8 py-7">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Projects</h1>
            <p className="mt-1 text-[13.5px] text-muted">Every video you've handed to CutPilot. Projects live in {useStore.getState().info?.projectsDir}.</p>
          </div>
          <div className="flex items-center gap-2">
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Editing" },
                { value: "ready", label: "Ready" },
                { value: "failed", label: "Failed" },
              ]}
            />
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate({ name: "home" })}>
              New edit
            </Button>
          </div>
        </div>

        {list.length === 0 ? (
          <Empty
            icon={<FolderKanban className="size-5" />}
            title={projects.length ? "Nothing matches" : "No projects yet"}
            action={
              !projects.length && (
                <Button variant="primary" onClick={() => navigate({ name: "home" })}>
                  Edit your first video
                </Button>
              )
            }
          >
            {projects.length ? "Try a different search or filter." : "Drop a video in the Studio and CutPilot will make the first cut."}
          </Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
            {list.map((p) => {
              const { total, edited } = projectDuration(p);
              return (
                <div
                  key={p.id}
                  onClick={() => navigate({ name: "project", id: p.id })}
                  className="group cursor-pointer overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
                >
                  <Thumb src={p.sources[0]?.thumb} className="aspect-video">
                    {total > 0 && (
                      <span className="absolute right-2 bottom-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        {fmtTime(edited || total)}
                      </span>
                    )}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <IconButton
                        label="Show in folder"
                        className="bg-surface/90 backdrop-blur"
                        onClick={(e) => {
                          e.stopPropagation();
                          revealItemInDir(p.dir + "\\project.json");
                        }}
                      >
                        <FolderOpen className="size-4" />
                      </IconButton>
                      <IconButton
                        label="Delete project"
                        className="bg-surface/90 backdrop-blur hover:text-bad"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(p);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </Thumb>
                  <div className="p-3.5">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="truncate text-[14px] font-semibold">{p.name}</div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill project={p} />
                      <span className="text-[12px] text-muted">{timeAgo(p.updated)}</span>
                    </div>
                    <div className="mt-2.5 text-[12px] text-muted">
                      {edited
                        ? `${fmtDuration(total)} → ${fmtDuration(edited)} · ${Math.round((1 - edited / Math.max(total, 0.1)) * 100)}% tighter`
                        : `${p.sources.length} video${p.sources.length > 1 ? "s" : ""}${total ? ` · ${fmtDuration(total)}` : ""}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete project?"
        width={440}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!deleting) return;
                try {
                  await api.deleteProject(deleting.id);
                  toast("Project moved to the Recycle Bin", "ok");
                  loadProjects();
                } catch (e) {
                  toast(errorText(e), "error");
                }
                setDeleting(null);
              }}
            >
              Move to Recycle Bin
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-text-2">
          “{deleting?.name}” and its edits, exports and downloaded B-roll go to the Recycle Bin. Your original videos are not touched.
        </p>
      </Modal>
    </div>
  );
}
