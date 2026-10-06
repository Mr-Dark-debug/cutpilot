import { ArrowUp, Bot, History, Loader2, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Progress, clsx } from "../../components/ui";
import { api, errorText } from "../../lib/api";
import { fmtTime, timeAgo } from "../../lib/format";
import { useProjectJob, useStore } from "../../lib/store";
import type { EditMeta, Project } from "../../lib/types";

const SUGGESTIONS = [
  "Make it tighter – cut anything repetitive",
  "Start with a stronger hook",
  "Add more B-roll over the explanations",
  "Make a 60-second Shorts version",
  "Keep the intro, it was cut too much",
];

export function ChatPanel({ project, versions }: { project: Project; versions: EditMeta[] }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const refreshProject = useStore((s) => s.refreshProject);
  const job = useProjectJob(project.id);
  const listRef = useRef<HTMLDivElement>(null);
  const working = !!job;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [project.chat.length, working]);

  const send = async (req?: string) => {
    const request = (req ?? text).trim();
    if (!request || working) return;
    setBusy(true);
    try {
      await api.reviseEdit(project.id, request);
      setText("");
      refreshProject(project.id);
    } catch (e) {
      toast(errorText(e), "error");
    }
    setBusy(false);
  };

  const switchVersion = async (v: number) => {
    try {
      await api.setCurrentEdit(project.id, v);
      refreshProject(project.id);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
          <History className="size-4 text-muted" /> Versions
        </div>
        <div className="flex max-h-[132px] flex-col gap-1 overflow-auto">
          {[...versions].reverse().map((v) => (
            <button
              key={v.version}
              onClick={() => switchVersion(v.version)}
              className={clsx(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors",
                v.version === project.currentEdit ? "bg-accent-soft text-accent-text" : "hover:bg-surface-3",
              )}
            >
              <span className="w-6 font-semibold">v{v.version}</span>
              <span className="min-w-0 flex-1 truncate">{v.note || v.kind}</span>
              <span className="text-[11.5px] text-muted tabular-nums">{fmtTime(v.duration)}</span>
            </button>
          ))}
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
        {project.chat.length === 0 && (
          <div className="rounded-xl border border-dashed border-line p-4 text-[12.5px] leading-relaxed text-muted">
            Tell the AI what to change in plain words. Each request makes a new version, so you can always go back.
          </div>
        )}
        {project.chat.map((m, i) => (
          <div key={i} className={clsx("flex gap-2.5", m.role === "user" && "flex-row-reverse")}>
            <div
              className={clsx(
                "flex size-7 shrink-0 items-center justify-center rounded-full",
                m.role === "user" ? "bg-surface-3 text-text-2" : "bg-gradient-to-br from-accent-2 to-accent text-white",
              )}
            >
              {m.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
            </div>
            <div className={clsx("max-w-[85%]", m.role === "user" && "text-right")}>
              <div
                className={clsx(
                  "selectable inline-block rounded-2xl px-3 py-2 text-left text-[13px] leading-relaxed",
                  m.role === "user" ? "rounded-tr-md bg-text text-surface" : "rounded-tl-md border border-line bg-surface",
                )}
              >
                {m.text}
              </div>
              <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-faint">
                {m.version && <Badge tone="accent">v{m.version}</Badge>}
                {timeAgo(m.created)}
              </div>
            </div>
          </div>
        ))}
        {working && (
          <div className="flex gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-2 to-accent text-white">
              <Loader2 className="size-3.5 animate-spin" />
            </div>
            <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-line bg-surface px-3 py-2.5">
              <div className="mb-2 truncate text-[12.5px] text-text-2">{job.message || job.stage || "Working…"}</div>
              <Progress value={job.progress} />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        {!working && project.currentEdit && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.slice(0, project.chat.length > 2 ? 2 : 5).map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-text-2 transition-colors hover:border-accent hover:text-accent-text"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="rounded-2xl border border-line bg-surface focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            disabled={!project.currentEdit}
            placeholder={project.currentEdit ? "Ask for changes… (Enter to send)" : "Available after the first edit"}
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] outline-none placeholder:text-faint"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="px-1 text-[11px] text-faint">{project.engine.provider === "codex" ? "Codex" : "Claude"} edits a new version</span>
            <button
              onClick={() => send()}
              disabled={!text.trim() || working || busy}
              className="flex size-8 items-center justify-center rounded-xl bg-text text-surface transition-opacity disabled:opacity-30"
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
