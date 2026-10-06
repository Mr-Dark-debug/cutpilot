// Browser-preview backend (design work only; never used inside the desktop app).
import data from "./mock-data.json";
import type { JobInfo, Settings } from "./types";

const settings: Settings = {
  projectsDir: "C:\\Demo\\Projects",
  engine: { provider: "claude", claudeModel: "sonnet", claudeEffort: "medium", codexModel: "gpt-5.6-terra", codexEffort: "medium" },
  whisperModel: "base",
  language: "auto",
  whisperGpu: false,
  pexelsKey: "",
  pixabayKey: "",
  stockProvider: "auto",
  libraryFolders: ["C:\\Demo\\Footage\\broll-library"],
  llmConcurrency: 2,
  mediaConcurrency: 1,
  useFrames: true,
  defaultStyleId: "talking-head",
  theme: (localStorage.getItem("cutpilot-theme") as Settings["theme"]) || "light",
  autoCheckUpdates: true,
  burnCaptions: false,
  engineFallback: true,
  onboarded: true,
};

const now = new Date().toISOString();
const jobs: JobInfo[] = [
  {
    id: "job-demo",
    kind: "pipeline",
    projectId: (data.projects as { id: string }[])[1]?.id ?? null,
    target: null,
    title: "Editing Hawking tribute",
    state: "running",
    stage: "Claude · sonnet is editing (24 utterances)",
    progress: 0.74,
    message: "Looking at sheet_01.jpg",
    error: null,
    created: now,
    finished: null,
    result: null,
  },
];

export async function mockInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 60));
  switch (cmd) {
    case "app_info":
      return { version: "1.0.0", dataDir: "C:\\Demo\\AppData", projectsDir: settings.projectsDir };
    case "get_settings":
      return settings;
    case "save_settings":
      Object.assign(settings, args.settings);
      return settings;
    case "tools_status":
      return data.tools;
    case "engine_models":
      return {
        claude: [
          { id: "sonnet", label: "Sonnet (latest) · balanced", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium" },
          { id: "opus", label: "Opus (latest) · strongest", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium" },
        ],
        codex: [{ id: "gpt-5.6-terra", label: "GPT-5.6-Terra", efforts: ["low", "medium", "high"], defaultEffort: "medium" }],
      };
    case "whisper_models":
      return [
        { id: "base", label: "Base", sizeMb: 142, note: "Fast, good for clear speech (default)" },
        { id: "small", label: "Small", sizeMb: 466, note: "Better accuracy, good for Hindi/Hinglish" },
      ];
    case "list_projects":
      return data.projects;
    case "get_project":
      return (data.projects as { id: string }[]).find((p) => p.id === args.id) ?? data.project;
    case "get_edit":
      return data.bundle;
    case "get_source_data":
      return (data.sources as Record<string, unknown>)[args.sourceId as string];
    case "save_edit":
      return data.bundle.timeline;
    case "list_jobs":
      return jobs;
    case "job_logs":
      return ["21:14:02 ▸ Reading hawking", "21:14:03 hawking: 05:02.96 · 1280x720 · 59.94 fps · audio yes", "21:15:10 ▸ Claude · sonnet is editing", "21:15:12 Looking at sheet_00.jpg"];
    case "list_styles":
      return data.styles;
    case "get_library":
      return data.library;
    default:
      return null;
  }
}
