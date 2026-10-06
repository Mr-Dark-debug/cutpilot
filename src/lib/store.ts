import { create } from "zustand";
import { api, errorText, isTauri } from "./api";
import type { AppInfo, EngineModel, JobInfo, Project, Settings, Style, ToolStatus } from "./types";

export type Route =
  | { name: "home" }
  | { name: "projects" }
  | { name: "project"; id: string; tab?: string }
  | { name: "queue" }
  | { name: "styles"; id?: string }
  | { name: "library" }
  | { name: "settings"; tab?: string }
  | { name: "setup" };

export interface Toast {
  id: number;
  kind: "info" | "ok" | "error";
  text: string;
}

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string | null;
  state: "available" | "downloading" | "ready" | "error";
  progress: number;
  error?: string;
}

interface Store {
  route: Route;
  navigate: (r: Route) => void;
  info: AppInfo | null;
  settings: Settings | null;
  tools: ToolStatus[];
  toolsLoading: boolean;
  models: { claude: EngineModel[]; codex: EngineModel[] };
  projects: Project[];
  styles: Style[];
  jobs: Record<string, JobInfo>;
  logs: Record<string, string[]>;
  toasts: Toast[];
  update: UpdateInfo | null;
  search: string;
  /** Files dropped on the window, picked up by the Studio composer. */
  dropped: string[];

  init: () => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  loadTools: () => Promise<void>;
  loadProjects: () => Promise<void>;
  refreshProject: (id: string) => Promise<void>;
  loadStyles: () => Promise<void>;
  loadJobs: () => Promise<void>;
  onJob: (j: JobInfo) => void;
  onLog: (jobId: string, line: string) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  setUpdate: (u: UpdateInfo | null) => void;
  setSearch: (s: string) => void;
  setDropped: (paths: string[]) => void;
}

let toastId = 1;

export const useStore = create<Store>((set, get) => ({
  route: { name: "home" },
  navigate: (route) => set({ route }),
  info: null,
  settings: null,
  tools: [],
  toolsLoading: false,
  models: { claude: [], codex: [] },
  projects: [],
  styles: [],
  jobs: {},
  logs: {},
  toasts: [],
  update: null,
  search: "",
  dropped: [],

  init: async () => {
    const [info] = await Promise.all([api.appInfo(), get().loadSettings(), get().loadProjects(), get().loadStyles(), get().loadJobs()]);
    set({ info });
    try {
      const last = localStorage.getItem("cutpilot-last-version");
      if (last && last !== info.version) get().toast(`Updated to CutPilot ${info.version}`, "ok");
      localStorage.setItem("cutpilot-last-version", info.version);
    } catch {
      /* storage unavailable */
    }
    api.engineModels().then((models) => set({ models }));
    await get().loadTools();
    const s = get().settings;
    const tools = get().tools;
    const missing = tools.some((t) => t.required && !t.installed);
    const noEngine = !tools.some((t) => (t.id === "claude" || t.id === "codex") && t.installed && t.loggedIn);
    if (s && (!s.onboarded || missing || noEngine)) set({ route: { name: "setup" } });
  },

  loadSettings: async () => {
    const settings = await api.getSettings();
    set({ settings });
    applyTheme(settings.theme);
  },

  saveSettings: async (s) => {
    try {
      const settings = await api.saveSettings(s);
      set({ settings });
      applyTheme(settings.theme);
    } catch (e) {
      get().toast(errorText(e), "error");
    }
  },

  loadTools: async () => {
    set({ toolsLoading: true });
    try {
      const tools = await api.toolsStatus();
      set({ tools });
    } finally {
      set({ toolsLoading: false });
    }
  },

  loadProjects: async () => {
    const projects = await api.listProjects();
    set({ projects });
  },

  refreshProject: async (id) => {
    try {
      const p = await api.getProject(id);
      set((st) => {
        const exists = st.projects.some((x) => x.id === id);
        const projects = exists ? st.projects.map((x) => (x.id === id ? p : x)) : [p, ...st.projects];
        return { projects };
      });
    } catch {
      // Deleted.
      set((st) => ({ projects: st.projects.filter((x) => x.id !== id) }));
    }
  },

  loadStyles: async () => {
    const styles = await api.listStyles();
    set({ styles });
  },

  loadJobs: async () => {
    const list = await api.listJobs();
    const jobs: Record<string, JobInfo> = {};
    for (const j of list) jobs[j.id] = j;
    set({ jobs });
  },

  onJob: (j) => {
    const prev = get().jobs[j.id];
    set((st) => ({ jobs: { ...st.jobs, [j.id]: j } }));
    const finished = prev && prev.state !== j.state && (j.state === "done" || j.state === "error");
    if (finished) {
      if (j.state === "error") get().toast(`${j.title}: ${j.message}`, "error");
      else if (j.kind === "install") {
        get().toast(`${j.title.replace("Installing", "Installed").replace("Downloading", "Downloaded")}`, "ok");
        get().loadTools();
      } else if (j.kind === "render") get().toast("Render finished", "ok");
      else if (j.kind === "pipeline") get().toast(`${j.title.replace("Editing ", "")} is ready to review`, "ok");
      if (j.kind === "reference") get().loadStyles();
      notify(j);
    }
  },

  onLog: (jobId, line) => {
    set((st) => {
      const prev = st.logs[jobId] ?? [];
      const d = new Date();
      const time = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
      const next = [...prev, `${time} ${line}`];
      return { logs: { ...st.logs, [jobId]: next.length > 1500 ? next.slice(-1200) : next } };
    });
  },

  toast: (text, kind = "info") => {
    const id = toastId++;
    set((st) => ({ toasts: [...st.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 9000 : 4500);
  },
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),
  setUpdate: (update) => set({ update }),
  setSearch: (search) => set({ search }),
  setDropped: (dropped) => set({ dropped }),
}));

export function applyTheme(theme: string) {
  try {
    localStorage.setItem("cutpilot-theme", theme);
  } catch {
    /* storage unavailable */
  }
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function notify(j: JobInfo) {
  // Desktop notification when the window isn't focused (long batch runs).
  if (!isTauri || document.hasFocus() || typeof Notification === "undefined") return;
  if (j.kind !== "pipeline" && j.kind !== "render" && j.kind !== "revise") return;
  try {
    if (Notification.permission === "granted") {
      new Notification("CutPilot", { body: j.state === "done" ? `${j.title} – done` : `${j.title} – failed` });
    }
  } catch {
    /* ignore */
  }
}

/** The active job for a project (running or queued), if any. */
export function useProjectJob(projectId: string | undefined): JobInfo | undefined {
  return useStore((st) =>
    projectId
      ? Object.values(st.jobs)
          .filter((j) => j.projectId === projectId && (j.state === "running" || j.state === "queued"))
          .sort((a, b) => b.created.localeCompare(a.created))[0]
      : undefined,
  );
}
