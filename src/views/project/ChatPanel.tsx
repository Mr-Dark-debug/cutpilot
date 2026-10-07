import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArrowUp, Brain, Check, ChevronRight, Eye, FolderOpen, History, Info, Loader2, MessageSquare, PanelRightClose, User, Wand2, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "../../components/Menu";
import { EffortPicker, ModelPicker, ProviderLogo, modelName } from "../../components/ModelPicker";
import { Badge, clsx } from "../../components/ui";
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

type StepKind = "think" | "tool" | "say" | "info" | "stage";

export function parseStep(line: string): { kind: StepKind; text: string } | null {
  const l = line.replace(/^\d\d:\d\d:\d\d /, "");
  for (const k of ["think", "tool", "say", "info"] as const) if (l.startsWith(`${k}: `)) return { kind: k, text: l.slice(k.length + 2) };
  if (l.startsWith("▸ ")) return { kind: "stage", text: l.slice(2) };
  return null;
}

const STEP_ICON: Record<StepKind, React.ReactNode> = {
  think: <Brain className="size-3.5" />,
  tool: <Wrench className="size-3.5" />,
  say: <MessageSquare className="size-3.5" />,
  info: <Info className="size-3.5" />,
  stage: <ChevronRight className="size-3.5" />,
};

function StepList({ steps }: { steps: { kind: StepKind; text: string }[] }) {
  return (
    <div className="mt-2 space-y-1.5 border-l border-line pl-3">
      {steps.map((s, i) => (
        <div key={i} className={clsx("flex gap-2 text-[12px] leading-relaxed", s.kind === "think" ? "text-muted italic" : "text-text-2")}>
          <span className="mt-0.5 shrink-0 text-faint">{s.kind === "tool" && s.text.startsWith("Looking") ? <Eye className="size-3.5" /> : STEP_ICON[s.kind]}</span>
          <span className="selectable min-w-0 whitespace-pre-wrap">{s.text}</span>
        </div>
      ))}
    </div>
  );
}

function Thoughts({ steps, seconds, live }: { steps: { kind: StepKind; text: string }[]; seconds?: number; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length && !live) return null;
  const label = live ? "Thinking" : seconds ? `Thought for ${seconds < 60 ? `${Math.round(seconds)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`}` : "Steps";
  const latest = steps[steps.length - 1];
  return (
    <div className="mb-1.5">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[12px] text-muted hover:text-text">
        {live ? <Loader2 className="size-3.5 animate-spin text-accent" /> : <Brain className="size-3.5" />}
        <span className={clsx(live && "shimmer bg-clip-text")}>{label}</span>
        {steps.length > 0 && <span className="text-faint">· {steps.length} steps</span>}
        <ChevronRight className={clsx("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {live && !open && latest && <div className="mt-1 line-clamp-2 pl-5 text-[12px] text-muted italic">{latest.text}</div>}
      {open && <StepList steps={steps} />}
    </div>
  );
}

export function ChatPanel({ project, versions, onCollapse }: { project: Project; versions: EditMeta[]; onCollapse?: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const refreshProject = useStore((s) => s.refreshProject);
  const models = useStore((s) => s.models);
  const job = useProjectJob(project.id);
  const liveLines = useStore((s) => (job ? s.logs[job.id] : undefined));
  const listRef = useRef<HTMLDivElement>(null);
  const working = !!job;

  // Earlier lines of a job that started before this panel was opened.
  const [history, setHistory] = useState<{ id: string; lines: string[]; offset: number } | null>(null);
  useEffect(() => {
    if (!job?.id) return;
    let alive = true;
    api.jobLogs(job.id).then((lines) => alive && setHistory({ id: job.id, lines, offset: useStore.getState().logs[job.id]?.length ?? 0 }));
    return () => {
      alive = false;
    };
  }, [job?.id]);
  const liveSteps = useMemo(() => {
    const h = history && history.id === job?.id ? history : null;
    const lines = h ? [...h.lines, ...(liveLines ?? []).slice(h.offset)] : (liveLines ?? []);
    return lines.map(parseStep).filter((x): x is NonNullable<typeof x> => !!x);
  }, [liveLines, history, job?.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [project.chat.length, working, liveSteps.length]);

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
      toast(`Switched to v${v}`, "ok");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const setEngine = async (engine: Project["engine"]) => {
    try {
      await api.updateProject(project.id, { engine });
      refreshProject(project.id);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const list = project.engine.provider === "codex" ? models.codex : models.claude;
  const engineName = modelName(project.engine.provider, list.find((m) => m.id === project.engine.model) ?? list[0], project.engine.model);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex size-7 items-center justify-center rounded-lg bg-surface ring-1 ring-line">
          <ProviderLogo provider={project.engine.provider} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-tight font-semibold">AI editor</div>
          <div className="truncate text-[11.5px] leading-tight text-muted">
            {engineName} · v{project.currentEdit ?? "–"} of {versions.length}
          </div>
        </div>
        <Menu
          items={[
            {
              label: "Versions",
              icon: <History className="size-3.5" />,
              hint: `${versions.length}`,
              items: [...versions].reverse().map((v) => ({
                label: (
                  <span className="flex items-center gap-2">
                    <b className="w-6">v{v.version}</b>
                    <span className="max-w-[170px] truncate">{v.note || v.kind}</span>
                  </span>
                ),
                hint: fmtTime(v.duration),
                icon: v.version === project.currentEdit ? <Check className="size-3.5 text-ok" /> : undefined,
                onSelect: () => v.version !== project.currentEdit && switchVersion(v.version),
              })),
            },
            {
              label: "Make a fresh edit",
              icon: <Wand2 className="size-3.5" />,
              disabled: working,
              onSelect: async () => {
                try {
                  await api.startPipeline(project.id);
                  refreshProject(project.id);
                } catch (e) {
                  toast(errorText(e), "error");
                }
              },
            },
            { label: "Open project folder", icon: <FolderOpen className="size-3.5" />, onSelect: () => revealItemInDir(project.dir + "\\project.json") },
            { separator: true, label: "" },
            { label: "Hide chat", icon: <PanelRightClose className="size-3.5" />, onSelect: () => onCollapse?.() },
          ]}
        />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-auto px-3.5 py-4">
        {project.chat.length === 0 && !working && (
          <div className="rounded-xl border border-dashed border-line p-4 text-[12.5px] leading-relaxed text-muted">
            Tell the AI what to change in plain words. Each request makes a new version; switch versions from the ⋯ menu.
          </div>
        )}
        {project.chat.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end gap-2">
              <div className="max-w-[85%]">
                <div className="selectable rounded-2xl rounded-tr-md bg-text px-3 py-2 text-[13px] leading-relaxed text-surface">{m.text}</div>
                <div className="mt-1 px-1 text-right text-[11px] text-faint">{timeAgo(m.created)}</div>
              </div>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-2">
                <User className="size-3.5" />
              </span>
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-line">
                <ProviderLogo provider={m.engine?.toLowerCase().startsWith("codex") ? "codex" : project.engine.provider} size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <Thoughts steps={(m.steps ?? []).map(parseStep).filter((x): x is NonNullable<typeof x> => !!x)} seconds={m.seconds} />
                <div className="selectable text-[13px] leading-relaxed text-text">{m.text}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
                  {m.version && (
                    <>
                      <Badge tone={m.version === project.currentEdit ? "accent" : "neutral"}>v{m.version}</Badge>
                      {m.version !== project.currentEdit && (
                        <button onClick={() => switchVersion(m.version!)} className="font-medium text-accent-text hover:underline">
                          Switch to this version
                        </button>
                      )}
                    </>
                  )}
                  <span>{timeAgo(m.created)}</span>
                  {m.engine && <span>· {m.engine}</span>}
                </div>
              </div>
            </div>
          ),
        )}
        {working && (
          <div className="flex gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-line">
              <ProviderLogo provider={project.engine.provider} size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <Thoughts steps={liveSteps} live />
              <div className="mt-1 text-[12px] text-muted">{job.message || job.stage}</div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width]" style={{ width: `${Math.max(3, job.progress * 100)}%` }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="p-3">
        {!working && project.currentEdit && project.chat.length < 3 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] text-text-2 transition-colors hover:border-line-strong hover:text-text"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="rounded-2xl border border-line bg-surface shadow-card focus-within:border-line-strong">
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
          <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
            <ModelPicker value={project.engine} onChange={setEngine} align="right" />
            <EffortPicker value={project.engine} onChange={setEngine} />
            <div className="flex-1" />
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
