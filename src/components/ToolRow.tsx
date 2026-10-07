import { AudioLines, Brain, Cpu, Download, Film, Link2, LogIn, Loader2, Wrench } from "lucide-react";
import { ClaudeLogo, DaVinciLogo, OpenAILogo } from "./BrandIcons";
import { api, errorText } from "../lib/api";
import { useStore } from "../lib/store";
import type { ToolStatus } from "../lib/types";
import { Badge, Button, Progress, clsx } from "./ui";

export function useInstallJob(toolId: string) {
  return useStore((s) => Object.values(s.jobs).find((j) => j.kind === "install" && j.target === toolId && (j.state === "running" || j.state === "queued")));
}

export async function installTool(id: string) {
  const { toast, loadTools } = useStore.getState();
  try {
    await api.installTool(id);
    if (id === "claude" || id === "codex") {
      toast("A terminal window opened. Finish there, then click Refresh.", "info");
      setTimeout(loadTools, 4000);
    }
  } catch (e) {
    toast(errorText(e), "error");
  }
}

export function toolIcon(id: string) {
  switch (id) {
    case "claude":
      return <ClaudeLogo size={18} />;
    case "codex":
      return <OpenAILogo size={18} />;
    case "resolve":
      return <DaVinciLogo size={18} />;
    case "ffmpeg":
      return <Film className="size-4" />;
    case "whisper":
      return <AudioLines className="size-4" />;
    case "whisper-gpu":
      return <Cpu className="size-4" />;
    case "model":
      return <Brain className="size-4" />;
    case "ytdlp":
      return <Link2 className="size-4" />;
    default:
      return <Wrench className="size-4" />;
  }
}

export function ToolRow({ tool, compact }: { tool: ToolStatus; compact?: boolean }) {
  const realJob = useInstallJob(tool.id);
  const engine = tool.id === "claude" || tool.id === "codex";
  const ok = tool.installed && (!engine || tool.loggedIn);
  return (
    <div className={clsx("flex items-center gap-3 border-b border-line last:border-b-0", compact ? "px-3.5 py-2.5" : "px-4 py-3")}>
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text-2 ring-1 ring-line">
        {toolIcon(tool.id)}
        <span
          title={ok ? "Ready" : tool.installed ? "Needs attention" : "Not installed"}
          className={clsx(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface",
            ok ? "bg-ok" : tool.installed || tool.required || engine ? "bg-warn" : "bg-line-strong",
          )}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold">{tool.name}</span>
          {tool.version && <span className="truncate text-[12px] text-muted">{tool.version}</span>}
          {tool.required && !tool.installed && <Badge tone="warn">required</Badge>}
        </div>
        {realJob ? (
          <div className="mt-1.5 max-w-[360px]">
            <Progress value={realJob.progress} />
            <div className="mt-1 truncate text-[11.5px] text-muted">{realJob.message || "Starting download…"}</div>
          </div>
        ) : (
          <div className="truncate text-[12px] text-muted">{tool.account ? `${tool.detail} · ${tool.account}` : tool.detail}</div>
        )}
      </div>
      {realJob ? (
        <Loader2 className="size-4 animate-spin text-accent" />
      ) : !tool.installed && tool.canInstall ? (
        <Button size="sm" variant={tool.required || engine ? "primary" : "secondary"} icon={<Download className="size-3.5" />} onClick={() => installTool(tool.id)}>
          Install
        </Button>
      ) : engine && tool.installed && !tool.loggedIn ? (
        <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => api.openLogin(tool.id).catch((e) => useStore.getState().toast(errorText(e), "error"))}>
          Sign in
        </Button>
      ) : null}
    </div>
  );
}
