import { ArrowRight, Check, Download, RefreshCw } from "lucide-react";
import { installUpdate } from "../lib/updater";
import { useEffect } from "react";
import { LogoMark } from "../components/Logo";
import { ToolRow, installTool, useInstallJob } from "../components/ToolRow";
import { Button, Card, clsx } from "../components/ui";
import { useStore } from "../lib/store";

/** First-run setup: required tools + at least one signed-in AI engine. */
export function Setup() {
  const tools = useStore((s) => s.tools);
  const loading = useStore((s) => s.toolsLoading);
  const loadTools = useStore((s) => s.loadTools);
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const navigate = useStore((s) => s.navigate);
  const jobs = useStore((s) => s.jobs);

  const engines = tools.filter((t) => t.id === "claude" || t.id === "codex");
  const required = tools.filter((t) => t.required);
  const optional = tools.filter((t) => !t.required && t.id !== "claude" && t.id !== "codex" && t.id !== "whisper-gpu");
  const toolsReady = required.length > 0 && required.every((t) => t.installed);
  const engineReady = engines.some((t) => t.installed && t.loggedIn);
  const installing = Object.values(jobs).some((j) => j.kind === "install" && (j.state === "running" || j.state === "queued"));
  const ffJob = useInstallJob("ffmpeg");
  const update = useStore((s) => s.update);

  // Re-check every few seconds while the user signs in or installs in a terminal.
  useEffect(() => {
    if (engineReady && toolsReady) return;
    const id = setInterval(() => {
      if (!useStore.getState().toolsLoading) loadTools();
    }, 6000);
    return () => clearInterval(id);
  }, [engineReady, toolsReady, loadTools]);

  const finish = async () => {
    if (settings) await saveSettings({ ...settings, onboarded: true });
    navigate({ name: "home" });
  };

  return (
    <div className="dotted h-full overflow-auto">
      <div className="mx-auto max-w-[720px] px-8 py-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark size={52} />
          <h1 className="mt-4 text-[26px] font-semibold tracking-tight">Welcome to CutPilot</h1>
          <p className="mt-2 max-w-[520px] text-[14px] leading-relaxed text-muted">
            Two quick checks and you're editing. Everything runs on this computer; the AI work goes through your own Claude or Codex subscription.
          </p>
        </div>

        {update && update.state !== "error" && (
          <Card className="glow-card mb-7 flex items-center gap-3 p-4">
            <Download className="size-5 text-accent" />
            <div className="min-w-0 flex-1 text-[13px]">
              <b>CutPilot {update.version} is available.</b> <span className="text-muted">Install it first so setup uses the latest fixes.</span>
            </div>
            <Button size="sm" variant="primary" loading={update.state === "downloading"} onClick={installUpdate}>
              Install & restart
            </Button>
          </Card>
        )}

        <Step n={1} done={toolsReady} title="Editing tools" text="FFmpeg reads and renders video. whisper.cpp transcribes speech. About 350 MB in total, downloaded once.">
          <Card className="overflow-hidden">
            {required.map((t) => (
              <ToolRow key={t.id} tool={t} compact />
            ))}
          </Card>
          {!toolsReady && (
            <Button
              className="mt-3"
              variant="primary"
              loading={installing}
              icon={<Download className="size-4" />}
              onClick={() => required.filter((t) => !t.installed).forEach((t) => installTool(t.id))}
            >
              {installing ? (ffJob ? "Downloading FFmpeg…" : "Downloading…") : "Install everything"}
            </Button>
          )}
        </Step>

        <Step
          n={2}
          done={engineReady}
          title="An AI editor"
          text="Install and sign in to at least one. CutPilot opens a terminal for the sign-in; your login never passes through CutPilot."
        >
          <Card className="overflow-hidden">
            {engines.map((t) => (
              <ToolRow key={t.id} tool={t} compact />
            ))}
          </Card>
          <Button className="mt-3" size="sm" variant="ghost" icon={<RefreshCw className={clsx("size-3.5", loading && "animate-spin")} />} onClick={loadTools}>
            I've signed in – check again
          </Button>
        </Step>

        <Step n={3} done={false} title="Optional extras" text="You can add these any time from Settings.">
          <Card className="overflow-hidden">
            {optional.map((t) => (
              <ToolRow key={t.id} tool={t} compact />
            ))}
          </Card>
        </Step>

        <div className="mt-8 flex justify-center">
          <Button size="lg" variant="primary" disabled={!toolsReady || !engineReady} icon={<ArrowRight className="size-4" />} onClick={finish}>
            {toolsReady && engineReady ? "Start editing" : "Finish the steps above"}
          </Button>
        </div>
        {(!toolsReady || !engineReady) && (
          <div className="mt-3 text-center">
            <button onClick={finish} className="text-[12.5px] text-muted hover:text-text hover:underline">
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ n, done, title, text, children }: { n: number; done: boolean; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="mb-7 flex gap-4">
      <div
        className={clsx(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
          done ? "bg-ok text-white" : "bg-surface text-text shadow-card ring-1 ring-line",
        )}
      >
        {done ? <Check className="size-4" /> : n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="mt-0.5 mb-3 text-[13px] leading-relaxed text-muted">{text}</div>
        {children}
      </div>
    </div>
  );
}
