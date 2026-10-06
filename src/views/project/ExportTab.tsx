import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Captions, Clapperboard, Download, FileText, FolderOpen, Info, Loader2, MonitorPlay, Play, Send, SquarePlay } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Progress, Segmented, Switch } from "../../components/ui";
import { api, errorText } from "../../lib/api";
import { fileName, timeAgo } from "../../lib/format";
import { useStore } from "../../lib/store";
import type { Project, RenderOpts, SendResult } from "../../lib/types";

export function ExportTab({ project }: { project: Project }) {
  const toast = useStore((s) => s.toast);
  const tools = useStore((s) => s.tools);
  const settings = useStore((s) => s.settings);
  const refreshProject = useStore((s) => s.refreshProject);
  const jobs = useStore((s) => s.jobs);
  const [sent, setSent] = useState<SendResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [opts, setOpts] = useState<RenderOpts>({
    quality: "final",
    captions: settings?.burnCaptions ?? false,
    aspect: (project.aspect as "16:9" | "9:16") || "16:9",
    broll: true,
    titles: true,
    music: true,
  });
  const resolve = tools.find((t) => t.id === "resolve");
  const renderJob = Object.values(jobs)
    .filter((j) => j.projectId === project.id && j.kind === "render")
    .sort((a, b) => b.created.localeCompare(a.created))[0];
  const rendering = renderJob && (renderJob.state === "running" || renderJob.state === "queued");
  const find = (kind: string) => project.exports.find((e) => e.kind === kind);

  const doExport = async () => {
    setBusy("export");
    try {
      await api.exportProject(project.id);
      refreshProject(project.id);
      toast("Exported timeline, captions and YouTube notes", "ok");
    } catch (e) {
      toast(errorText(e), "error");
    }
    setBusy(null);
  };

  const send = async () => {
    setBusy("resolve");
    try {
      const r = await api.sendToResolve(project.id);
      setSent(r);
      refreshProject(project.id);
    } catch (e) {
      toast(errorText(e), "error");
    }
    setBusy(null);
  };

  const render = async () => {
    try {
      await api.renderVideo(project.id, opts);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  if (!project.currentEdit) return <div className="p-10 text-center text-muted">Exports are available once the first edit is ready.</div>;

  return (
    <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-5 p-6">
      <Card className="glow-card p-5">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-900 text-white">
            <Clapperboard className="size-4.5" />
          </span>
          <div>
            <div className="text-[14px] font-semibold">DaVinci Resolve</div>
            <div className="text-[12px] text-muted">Timeline with cuts, B-roll on V2, titles, markers and chapters</div>
          </div>
        </div>
        <ol className="my-4 space-y-1.5 text-[12.5px] leading-relaxed text-text-2">
          <li>
            1. Click <b>Send to Resolve</b>. CutPilot exports the timeline and opens Resolve.
          </li>
          <li>
            2. In Resolve: <b>Workspace ▸ Scripts ▸ CutPilot Import</b>. Media, timeline and captions come in together.
          </li>
          <li>3. Review, grade and add effects, then deliver from Resolve.</li>
        </ol>
        {sent && (
          <div className="fade-in mb-4 rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] leading-relaxed">
            {sent.resolveFound ? (
              <>
                <b>{sent.launched ? "Resolve is starting." : "Resolve is already open."}</b> Run <b>Workspace ▸ Scripts ▸ CutPilot Import</b>. (Restart
                Resolve once if the script isn't in the menu yet.)
              </>
            ) : (
              <>
                <b>Resolve wasn't found</b> on this PC. Install DaVinci Resolve (free) from blackmagicdesign.com, or import the file by hand with{" "}
                <b>File ▸ Import ▸ Timeline…</b>
              </>
            )}
            <div className="mt-1.5 truncate text-muted">{sent.timeline}</div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<Send className="size-4" />} loading={busy === "resolve"} onClick={send}>
            Send to Resolve
          </Button>
          <Button icon={<Download className="size-4" />} loading={busy === "export"} onClick={doExport}>
            Export FCPXML
          </Button>
          {find("fcpxml") && (
            <Button variant="ghost" icon={<FolderOpen className="size-4" />} onClick={() => revealItemInDir(find("fcpxml")!.path)}>
              Show file
            </Button>
          )}
        </div>
        {!resolve?.installed && (
          <div className="mt-3 flex items-start gap-2 text-[12px] text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" /> FCPXML also imports into Final Cut Pro, and into Premiere via its XML import.
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-2 to-accent text-white">
            <MonitorPlay className="size-4.5" />
          </span>
          <div>
            <div className="text-[14px] font-semibold">Render MP4</div>
            <div className="text-[12px] text-muted">A finished video straight from CutPilot, no NLE needed</div>
          </div>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Segmented
              size="sm"
              value={opts.quality}
              onChange={(quality) => setOpts({ ...opts, quality })}
              options={[
                { value: "preview", label: "Quick 720p" },
                { value: "final", label: "Full quality" },
              ]}
            />
            <Segmented
              size="sm"
              value={opts.aspect}
              onChange={(aspect) => setOpts({ ...opts, aspect })}
              options={[
                { value: "16:9", label: "16:9" },
                { value: "9:16", label: "9:16 vertical" },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
            {(
              [
                ["captions", "Burn in captions"],
                ["broll", "B-roll"],
                ["titles", "Titles"],
                ["music", project.music ? "Music bed" : "Music (none set)"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1">
                <span className="text-text-2">{label}</span>
                <Switch checked={opts[k]} onChange={(v) => setOpts({ ...opts, [k]: v })} label={label} />
              </label>
            ))}
          </div>
          {rendering ? (
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <div className="mb-2 flex items-center gap-2 text-[12.5px]">
                <Loader2 className="size-3.5 animate-spin text-accent" /> {renderJob.message || "Rendering"}
                <span className="flex-1" />
                <span className="text-muted tabular-nums">{Math.round(renderJob.progress * 100)}%</span>
                <button onClick={() => api.cancelJob(renderJob.id)} className="text-[12px] text-muted hover:text-bad">
                  Cancel
                </button>
              </div>
              <Progress value={renderJob.progress} />
            </div>
          ) : (
            <Button variant="primary" className="w-full" icon={<Play className="size-4" />} onClick={render}>
              Render video
            </Button>
          )}
          {(find("mp4") || find("mp4-vertical")) && !rendering && (
            <div className="space-y-1.5">
              {["mp4", "mp4-vertical"].map((k) => {
                const e = find(k);
                if (!e) return null;
                return (
                  <div key={k} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate">{fileName(e.path)}</span>
                    <span className="text-muted">{timeAgo(e.created)}</span>
                    <Button size="sm" onClick={() => openPath(e.path)}>
                      Play
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => revealItemInDir(e.path)}>
                      Show
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <Captions className="size-5 text-sky-500" />
          <div className="text-[14px] font-semibold">Captions (SRT)</div>
          <Badge>re-timed to the edit</Badge>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
          Upload to YouTube for accurate subtitles, or drop onto a subtitle track in Resolve. Captions follow the cut, so they're always in sync.
        </p>
        <ExportFileRow path={find("srt")?.path} onExport={doExport} busy={busy === "export"} />
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <SquarePlay className="size-5 text-red-500" />
          <div className="text-[14px] font-semibold">YouTube details</div>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
          Title ideas, description with chapters, tags, thumbnail text and stock credits in one Markdown file. Also in the Edit tab ▸ Notes.
        </p>
        <ExportFileRow path={find("youtube")?.path} onExport={doExport} busy={busy === "export"} icon={<FileText className="size-4" />} />
      </Card>
    </div>
  );
}

function ExportFileRow({ path, onExport, busy, icon }: { path?: string; onExport: () => void; busy: boolean; icon?: React.ReactNode }) {
  if (!path)
    return (
      <Button icon={<Download className="size-4" />} loading={busy} onClick={onExport}>
        Export
      </Button>
    );
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px]">
      {icon}
      <span className="min-w-0 flex-1 truncate">{fileName(path)}</span>
      <Button size="sm" onClick={() => openPath(path)}>
        Open
      </Button>
      <Button size="sm" variant="ghost" onClick={() => revealItemInDir(path)}>
        Show
      </Button>
      <Button size="sm" variant="ghost" loading={busy} onClick={onExport}>
        Refresh
      </Button>
    </div>
  );
}
