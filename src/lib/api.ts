import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  Edit,
  EditBundle,
  EngineChoice,
  EngineModel,
  ExportItem,
  JobInfo,
  LibraryItem,
  Project,
  RenderOpts,
  SendResult,
  Settings,
  SourceData,
  StockClip,
  Style,
  Timeline,
  ToolStatus,
  WhisperModel,
} from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    // Browser preview during development: served by a mock backend (stripped from builds).
    if (import.meta.env.DEV) {
      const m = await import("./mock");
      return m.mockInvoke(cmd, args) as T;
    }
    throw new Error("CutPilot must run as the desktop app");
  }
  return invoke<T>(cmd, args);
}

/** URL a <video>/<img> can load for a local file. */
export function fileSrc(path: string | null | undefined): string | undefined {
  if (!path || !isTauri) return undefined;
  return convertFileSrc(path);
}

export interface NewProjectArgs {
  name?: string;
  sources: string[];
  references?: string[];
  brief?: string;
  styleId?: string;
  engine?: EngineChoice | null;
  aspect?: string;
  music?: string | null;
}

export interface ProjectPatch {
  name?: string;
  brief?: string;
  styleId?: string;
  engine?: EngineChoice;
  aspect?: string;
  music?: string;
}

export const api = {
  appInfo: () => call<AppInfo>("app_info"),
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
  toolsStatus: () => call<ToolStatus[]>("tools_status"),
  installTool: (id: string, model?: string) => call<string>("install_tool", { id, model }),
  openLogin: (engine: string) => call<void>("open_login", { engine }),
  engineModels: () => call<{ claude: EngineModel[]; codex: EngineModel[] }>("engine_models"),
  whisperModels: () => call<WhisperModel[]>("whisper_models"),

  listProjects: () => call<Project[]>("list_projects"),
  getProject: (id: string) => call<Project>("get_project", { id }),
  createProject: (args: NewProjectArgs, start: boolean) => call<Project>("create_project", { args: normalize(args), start }),
  createBatch: (args: NewProjectArgs) => call<Project[]>("create_batch", { args: normalize(args) }),
  updateProject: (id: string, patch: ProjectPatch) => call<Project>("update_project", { id, patch }),
  deleteProject: (id: string) => call<void>("delete_project", { id }),
  addSources: (id: string, paths: string[]) => call<Project>("add_sources", { id, paths }),
  removeSource: (id: string, sourceId: string) => call<Project>("remove_source", { id, sourceId }),
  addReference: (id: string, input: string) => call<Project>("add_reference", { id, input }),
  removeReference: (id: string, refId: string) => call<Project>("remove_reference", { id, refId }),
  startPipeline: (id: string, opts?: { reanalyze?: boolean; analyzeOnly?: boolean }) =>
    call<string>("start_pipeline", { id, opts: opts ?? null }),
  reviseEdit: (id: string, request: string) => call<string>("revise_edit", { id, request }),

  cancelJob: (jobId: string) => call<boolean>("cancel_job", { jobId }),
  listJobs: () => call<JobInfo[]>("list_jobs"),
  jobLogs: (jobId: string) => call<string[]>("job_logs", { jobId }),
  clearJobs: () => call<void>("clear_jobs"),

  getEdit: (id: string, version?: number) => call<EditBundle>("get_edit", { id, version: version ?? null }),
  getSourceData: (id: string, sourceId: string) => call<SourceData>("get_source_data", { id, sourceId }),
  saveEdit: (id: string, edit: Edit) => call<Timeline>("save_edit", { id, edit }),
  setCurrentEdit: (id: string, version: number) => call<Project>("set_current_edit", { id, version }),
  fillBroll: (id: string) => call<string>("fill_broll", { id }),
  searchStock: (query: string, vertical: boolean, provider?: string) =>
    call<StockClip[]>("search_stock", { query, vertical, provider: provider ?? null }),
  setBrollAsset: (
    id: string,
    brollId: string,
    choice: { stock?: StockClip; library?: string; file?: string; clear?: boolean },
  ) => call<EditBundle>("set_broll_asset", { id, brollId, choice }),
  exportProject: (id: string) => call<ExportItem[]>("export_project", { id }),
  renderVideo: (id: string, opts: RenderOpts) => call<string>("render_video", { id, opts }),
  sendToResolve: (id: string) => call<SendResult>("send_to_resolve", { id }),

  listStyles: () => call<Style[]>("list_styles"),
  saveStyle: (style: Style) => call<Style>("save_style", { style }),
  deleteStyle: (id: string) => call<void>("delete_style", { id }),
  analyzeStyleReference: (styleId: string, input: string) => call<string>("analyze_style_reference", { styleId, input }),

  getLibrary: () => call<LibraryItem[]>("get_library"),
  scanLibrary: () => call<string>("scan_library"),
  describeLibrary: () => call<string>("describe_library"),
  pathExists: (path: string) => call<boolean>("path_exists", { path }),
};

function normalize(a: NewProjectArgs) {
  return {
    name: a.name ?? "",
    sources: a.sources,
    references: a.references ?? [],
    brief: a.brief ?? "",
    styleId: a.styleId ?? "",
    engine: a.engine ?? null,
    aspect: a.aspect ?? "",
    music: a.music ?? null,
  };
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
