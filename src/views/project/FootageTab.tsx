import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, CheckCircle2, Film, Link2, Loader2, Music2, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EngineFields } from "../../components/EnginePicker";
import { Thumb } from "../../components/ProjectBits";
import { Badge, Button, Card, Field, IconButton, Input, Modal, Segmented, Select, Textarea } from "../../components/ui";
import { api, errorText } from "../../lib/api";
import { AUDIO_EXT, VIDEO_EXT, fileName, fmtTime } from "../../lib/format";
import { useProjectJob, useStore } from "../../lib/store";
import type { Project } from "../../lib/types";

export function FootageTab({ project }: { project: Project }) {
  const styles = useStore((s) => s.styles);
  const toast = useStore((s) => s.toast);
  const refreshProject = useStore((s) => s.refreshProject);
  const job = useProjectJob(project.id);
  const [brief, setBrief] = useState(project.brief);
  const [refOpen, setRefOpen] = useState(false);
  const [refUrl, setRefUrl] = useState("");

  useEffect(() => setBrief(project.brief), [project.id, project.brief]);

  const patch = async (p: Parameters<typeof api.updateProject>[1]) => {
    try {
      await api.updateProject(project.id, p);
      refreshProject(project.id);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  const run = async (reanalyze: boolean) => {
    try {
      await api.startPipeline(project.id, { reanalyze });
      toast(reanalyze ? "Re-transcribing and re-editing…" : "Making a fresh edit…");
      refreshProject(project.id);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <div className="mx-auto grid max-w-[1180px] grid-cols-[1fr_380px] gap-5 p-6">
      <div className="space-y-5">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[14px] font-semibold">Footage</div>
            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              onClick={async () => {
                const res = await open({ multiple: true, filters: [{ name: "Video", extensions: VIDEO_EXT }] });
                if (!res) return;
                await api.addSources(project.id, Array.isArray(res) ? res : [res]);
                refreshProject(project.id);
                toast("Added. Run the edit again to include the new footage.");
              }}
            >
              Add videos
            </Button>
          </div>
          <div className="space-y-2">
            {project.sources.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                <Thumb src={s.thumb} className="h-14 w-24 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge>{s.id}</Badge>
                    <span className="truncate text-[13px] font-semibold">{s.name}</span>
                  </div>
                  <div className="mt-1 truncate text-[12px] text-muted">
                    {s.info
                      ? `${fmtTime(s.info.duration)} · ${s.info.width}×${s.info.height} · ${(s.info.fpsNum / Math.max(1, s.info.fpsDen)).toFixed(2)} fps${s.language ? ` · ${s.language}` : ""}`
                      : s.path}
                  </div>
                </div>
                {s.analyzed ? (
                  <Badge tone="ok">
                    <CheckCircle2 className="size-3" /> Transcribed
                  </Badge>
                ) : (
                  <Badge>Not analysed</Badge>
                )}
                {project.sources.length > 1 && (
                  <IconButton
                    label="Remove from project"
                    onClick={async () => {
                      try {
                        await api.removeSource(project.id, s.id);
                        refreshProject(project.id);
                      } catch (e) {
                        toast(errorText(e), "error");
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[14px] font-semibold">Reference videos</div>
            <Button size="sm" icon={<Link2 className="size-3.5" />} onClick={() => setRefOpen(true)}>
              Add reference
            </Button>
          </div>
          <p className="mb-4 text-[12.5px] text-muted">The AI matches the pacing and feel of these. They're analysed on the next edit run.</p>
          {project.references.length === 0 && <div className="rounded-xl border border-dashed border-line p-4 text-center text-[12.5px] text-muted">No references yet.</div>}
          <div className="space-y-2.5">
            {project.references.map((r) => (
              <div key={r.id} className="rounded-xl border border-line p-3">
                <div className="flex items-start gap-3">
                  <Thumb src={r.analysis?.thumb} className="h-12 w-20 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{r.analysis?.name || r.name || fileName(r.input)}</div>
                    {r.analysis ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge>{r.analysis.metrics.cutsPerMin.toFixed(1)} cuts/min</Badge>
                        <Badge>{r.analysis.metrics.avgShot.toFixed(1)}s shots</Badge>
                        <Badge>{Math.round(r.analysis.metrics.wordsPerMin)} wpm</Badge>
                        <Badge>keeps pauses ≤ {r.analysis.style.pauseKeep.toFixed(2)}s</Badge>
                      </div>
                    ) : r.error ? (
                      <div className="mt-1 flex items-center gap-1 text-[12px] text-bad">
                        <AlertCircle className="size-3.5" /> {r.error}
                      </div>
                    ) : (
                      <div className="mt-1 text-[12px] text-muted">Waiting to be analysed</div>
                    )}
                  </div>
                  <IconButton
                    label="Remove reference"
                    onClick={async () => {
                      await api.removeReference(project.id, r.id);
                      refreshProject(project.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
                {r.analysis?.style.summary && <p className="mt-2.5 text-[12.5px] leading-relaxed text-text-2">{r.analysis.style.summary}</p>}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card className="p-5">
          <div className="mb-4 text-[14px] font-semibold">How to edit</div>
          <div className="space-y-4">
            <Field label="Brief" hint="Saved when you click away. Re-run the edit to apply.">
              <Textarea rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} onBlur={() => brief !== project.brief && patch({ brief })} placeholder="What should the video be? Length, tone, hook…" />
            </Field>
            <Field label="Style">
              <Select
                value={project.styleId}
                onChange={(styleId) => patch({ styleId })}
                options={styles.map((s) => ({ value: s.id, label: s.name, hint: s.description }))}
                icon={<Sparkles className="size-3.5" />}
              />
            </Field>
            <Field label="Output shape">
              <Segmented
                className="w-full"
                value={project.aspect || "16:9"}
                onChange={(aspect) => patch({ aspect })}
                options={[
                  { value: "16:9", label: "Landscape 16:9" },
                  { value: "9:16", label: "Vertical 9:16" },
                ]}
              />
            </Field>
            <Field label="AI editor">
              <EngineFields value={project.engine} onChange={(engine) => patch({ engine })} />
            </Field>
            <Field label="Background music" hint="Mixed under the voice and ducked automatically in renders.">
              <div className="flex gap-2">
                <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line px-3 text-[13px]">
                  <Music2 className="size-3.5 shrink-0 text-muted" />
                  <span className="truncate text-text-2">{project.music ? fileName(project.music) : "None"}</span>
                </div>
                <Button
                  onClick={async () => {
                    const f = await open({ multiple: false, filters: [{ name: "Audio", extensions: AUDIO_EXT }] });
                    if (typeof f === "string") patch({ music: f });
                  }}
                >
                  Choose
                </Button>
                {project.music && (
                  <IconButton label="Remove music" onClick={() => patch({ music: "" })}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </div>
            </Field>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-1 text-[14px] font-semibold">Run again</div>
          <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
            A fresh edit keeps the transcript and makes a new version. Re-transcribe if you changed the Whisper model or language.
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="primary" icon={job ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} disabled={!!job} onClick={() => run(false)}>
              {job ? "Working…" : "Make a fresh edit"}
            </Button>
            <Button icon={<RefreshCw className="size-4" />} disabled={!!job} onClick={() => run(true)}>
              Re-transcribe and edit
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={refOpen}
        onClose={() => setRefOpen(false)}
        title="Add a reference video"
        width={500}
        footer={
          <>
            <Button
              icon={<Film className="size-4" />}
              onClick={async () => {
                const f = await open({ multiple: false, filters: [{ name: "Video", extensions: VIDEO_EXT }] });
                if (typeof f === "string") {
                  await api.addReference(project.id, f);
                  refreshProject(project.id);
                  setRefOpen(false);
                }
              }}
            >
              Choose a file…
            </Button>
            <Button
              variant="primary"
              disabled={!refUrl.trim().startsWith("http")}
              onClick={async () => {
                await api.addReference(project.id, refUrl.trim());
                setRefUrl("");
                refreshProject(project.id);
                setRefOpen(false);
              }}
            >
              Add link
            </Button>
          </>
        }
      >
        <Input value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" autoFocus />
      </Modal>
    </div>
  );
}
