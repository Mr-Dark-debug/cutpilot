import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AlertCircle, CheckCircle2, Info, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { clsx } from "./components/ui";
import { isTauri } from "./lib/api";
import { useStore } from "./lib/store";
import type { JobInfo } from "./lib/types";
import { checkForUpdate } from "./lib/updater";
import { Home } from "./views/Home";
import { Library } from "./views/Library";
import { ProjectView } from "./views/project/ProjectView";
import { Projects } from "./views/Projects";
import { Queue } from "./views/Queue";
import { Settings } from "./views/Settings";
import { Setup } from "./views/Setup";
import { Styles } from "./views/Styles";

export default function App() {
  const route = useStore((s) => s.route);
  const init = useStore((s) => s.init);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    init()
      .catch((e) => console.error(e))
      .finally(() => setReady(true));
  }, [init]);

  useEffect(() => {
    if (!isTauri) return;
    const unsubs: Promise<() => void>[] = [
      listen<JobInfo>("job", (e) => useStore.getState().onJob(e.payload)),
      listen<{ jobId: string; line: string }>("job-log", (e) => useStore.getState().onLog(e.payload.jobId, e.payload.line)),
      listen<string>("project", (e) => useStore.getState().refreshProject(e.payload)),
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") setDragging(true);
        else if (e.payload.type === "leave") setDragging(false);
        else if (e.payload.type === "drop") {
          setDragging(false);
          const st = useStore.getState();
          st.setDropped(e.payload.paths);
          if (st.route.name !== "home") st.navigate({ name: "home" });
        }
      }),
    ];
    return () => {
      unsubs.forEach((p) => p.then((f) => f()));
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const s = useStore.getState().settings;
    if (s?.autoCheckUpdates) {
      checkForUpdate(true);
      const id = setInterval(() => checkForUpdate(true), 1000 * 60 * 60 * 6);
      return () => clearInterval(id);
    }
  }, [ready]);

  // "/" focuses project search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
        e.preventDefault();
        (document.querySelector('input[placeholder="Search projects"]') as HTMLInputElement | null)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const t = useStore.getState().settings?.theme;
      if (t === "system") document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (!ready) return <div className="h-full bg-bg" />;

  return (
    <div className="flex h-full bg-bg text-text">
      {route.name !== "setup" && <Sidebar />}
      <main className="min-w-0 flex-1">
        {route.name === "home" && <Home />}
        {route.name === "projects" && <Projects />}
        {route.name === "project" && <ProjectView key={route.id} id={route.id} initialTab={route.tab} />}
        {route.name === "queue" && <Queue />}
        {route.name === "styles" && <Styles initialId={route.id} />}
        {route.name === "library" && <Library />}
        {route.name === "settings" && <Settings key={route.tab} initialTab={route.tab} />}
        {route.name === "setup" && <Setup />}
      </main>
      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-[200] flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface px-8 py-6 shadow-pop">
            <Upload className="size-6 text-accent" />
            <div className="text-[15px] font-semibold">Drop videos to start an edit</div>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="fixed right-5 bottom-5 z-[300] flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="fade-in flex items-start gap-2.5 rounded-2xl border border-line bg-surface p-3.5 shadow-pop">
          {t.kind === "ok" ? (
            <CheckCircle2 className="mt-px size-4 shrink-0 text-ok" />
          ) : t.kind === "error" ? (
            <AlertCircle className="mt-px size-4 shrink-0 text-bad" />
          ) : (
            <Info className="mt-px size-4 shrink-0 text-accent" />
          )}
          <div className={clsx("selectable min-w-0 flex-1 text-[13px] leading-relaxed", t.kind === "error" && "text-text")}>{t.text}</div>
          <button onClick={() => dismiss(t.id)} className="text-muted hover:text-text" aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
