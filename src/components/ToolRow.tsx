import { CheckCircle2, CircleAlert, Download, LogIn, Loader2, Terminal } from "lucide-react";
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

export function ToolRow({ tool, compact }: { tool: ToolStatus; compact?: boolean }) {
  const realJob = useInstallJob(tool.id);
  const engine = tool.id === "claude" || tool.id === "codex";
  const ok = tool.installed && (!engine || tool.loggedIn);
  return (
    <div className={clsx("flex items-center gap-3 border-b border-line last:border-b-0", compact ? "px-3.5 py-2.5" : "px-4 py-3")}>
      <span className={clsx("flex size-8 shrink-0 items-center justify-center rounded-xl", ok ? "bg-ok-soft text-ok" : tool.required || engine ? "bg-warn-soft text-warn" : "bg-surface-3 text-muted")}>
        {ok ? <CheckCircle2 className="size-4" /> : engine ? <Terminal className="size-4" /> : <CircleAlert className="size-4" />}
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
