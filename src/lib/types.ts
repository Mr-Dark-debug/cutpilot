// Mirrors the Rust types (serde camelCase).

export interface EngineSettings {
  provider: "claude" | "codex";
  claudeModel: string;
  claudeEffort: string;
  codexModel: string;
  codexEffort: string;
}

export interface Settings {
  projectsDir: string;
  engine: EngineSettings;
  whisperModel: string;
  language: string;
  whisperGpu: boolean;
  pexelsKey: string;
  pixabayKey: string;
  stockProvider: string;
  libraryFolders: string[];
  llmConcurrency: number;
  mediaConcurrency: number;
  useFrames: boolean;
  defaultStyleId: string;
  theme: "system" | "light" | "dark";
  autoCheckUpdates: boolean;
  burnCaptions: boolean;
  engineFallback: boolean;
  resolvePath: string;
  favoriteModels: string[];
  onboarded: boolean;
}

export interface ToolStatus {
  id: string;
  name: string;
  installed: boolean;
  version: string;
  path: string;
  detail: string;
  loggedIn: boolean | null;
  account: string;
  required: boolean;
  canInstall: boolean;
}

export interface EngineModel {
  id: string;
  label: string;
  efforts: string[];
  defaultEffort: string;
}

export interface WhisperModel {
  id: string;
  label: string;
  sizeMb: number;
  note: string;
}

export interface MediaInfo {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  fpsNum: number;
  fpsDen: number;
  vcodec: string;
  acodec: string;
}

export interface Source {
  id: string;
  path: string;
  name: string;
  info: MediaInfo | null;
  proxy: string | null;
  thumb: string | null;
  analyzed: boolean;
  language: string;
}

export interface RefMetrics {
  duration: number;
  analyzedSeconds: number;
  cuts: number;
  cutsPerMin: number;
  avgShot: number;
  medianShot: number;
  wordsPerMin: number;
  speechRatio: number;
  avgPause: number;
  longPausesPerMin: number;
}

export interface StyleSummary {
  summary: string;
  pacing: string;
  hook: string;
  broll: string;
  onScreenText: string;
  rules: string[];
  pauseKeep: number;
}

export interface RefAnalysis {
  name: string;
  input: string;
  analyzed: string;
  metrics: RefMetrics;
  style: StyleSummary;
  thumb: string | null;
}

export interface Reference {
  id: string;
  input: string;
  name: string;
  analysis: RefAnalysis | null;
  error: string | null;
}

export interface EngineChoice {
  provider: string;
  model: string;
  effort: string;
}

export interface ProjectStatus {
  state: "new" | "queued" | "running" | "ready" | "error" | "cancelled" | "";
  stage: string;
  progress: number;
  message: string;
  jobId: string | null;
}

export interface EditMeta {
  version: number;
  created: string;
  kind: string;
  note: string;
  engine: string;
  duration: number;
}

export interface ExportItem {
  kind: string;
  path: string;
  created: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  created: string;
  version: number | null;
  steps?: string[];
  seconds?: number;
  engine?: string;
}

export interface Project {
  id: string;
  name: string;
  created: string;
  updated: string;
  dir: string;
  sources: Source[];
  references: Reference[];
  brief: string;
  styleId: string;
  engine: EngineChoice;
  music: string | null;
  aspect: string;
  status: ProjectStatus;
  currentEdit: number | null;
  edits: EditMeta[];
  exports: ExportItem[];
  chat: ChatMessage[];
  batchId: string | null;
}

export interface Segment {
  label: string;
  reason: string;
}

export interface Clip {
  id: string;
  source: string;
  start: number;
  end: number;
  segment: number;
  enabled: boolean;
  text: string;
}

export interface Asset {
  kind: string;
  id: string;
  path: string;
  thumb: string;
  duration: number;
  width: number;
  height: number;
  credit: string;
  url: string;
  isImage: boolean;
}

export interface Broll {
  id: string;
  source: string;
  anchor: number;
  duration: number;
  query: string;
  reason: string;
  library: string | null;
  asset: Asset | null;
  enabled: boolean;
}

export interface TitleItem {
  id: string;
  source: string;
  anchor: number;
  duration: number;
  text: string;
  kind: string;
  enabled: boolean;
}

export interface Chapter {
  source: string;
  anchor: number;
  title: string;
}

export interface Youtube {
  titles: string[];
  description: string;
  tags: string[];
  thumbnail_text: string;
}

export interface Edit {
  version: number;
  created: string;
  kind: string;
  engine: string;
  request: string;
  title: string;
  summary: string;
  notes: string;
  segments: Segment[];
  clips: Clip[];
  broll: Broll[];
  titles: TitleItem[];
  chapters: Chapter[];
  youtube: Youtube;
  warnings: string[];
}

export interface TlClip {
  clipId: string;
  source: string;
  segment: number;
  srcIn: number;
  srcOut: number;
  start: number;
  end: number;
}

export interface TlBroll {
  id: string;
  start: number;
  end: number;
  query: string;
  asset: Asset | null;
}

export interface TlTitle {
  id: string;
  start: number;
  end: number;
  text: string;
  kind: string;
}

export interface Caption {
  start: number;
  end: number;
  text: string;
}

export interface Timeline {
  duration: number;
  fpsNum: number;
  fpsDen: number;
  width: number;
  height: number;
  clips: TlClip[];
  broll: TlBroll[];
  titles: TlTitle[];
  chapters: { start: number; title: string }[];
  captions: Caption[];
  warnings: string[];
  sourceDuration: number;
}

export interface EditBundle {
  edit: Edit;
  timeline: Timeline;
  versions: EditMeta[];
  current: number;
}

export interface Word {
  text: string;
  start: number;
  end: number;
  p: number;
}

export interface Utterance {
  id: string;
  source: string;
  start: number;
  end: number;
  text: string;
  kind: string;
}

export interface SourceData {
  words: Word[];
  utterances: Utterance[];
  peaks: number[];
  duration: number;
}

export interface JobInfo {
  id: string;
  kind: string;
  projectId: string | null;
  target: string | null;
  title: string;
  state: "queued" | "running" | "done" | "error" | "cancelled";
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  created: string;
  finished: string | null;
  result: unknown;
}

export interface Style {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  instructions: string;
  pauseKeep: number;
  brollEvery: number;
  titles: boolean;
  captions: boolean;
  targetLength: number;
  aspect: string;
  color: string;
  icon: string;
  category: string;
  references: RefAnalysis[];
  updated: string;
}

export interface LibraryItem {
  id: string;
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  thumb: string;
  description: string;
  tags: string[];
  isImage: boolean;
}

export interface StockClip {
  provider: string;
  id: string;
  download: string;
  thumb: string;
  duration: number;
  width: number;
  height: number;
  credit: string;
  page: string;
}

export interface RenderOpts {
  quality: "preview" | "final";
  captions: boolean;
  aspect: "16:9" | "9:16";
  broll: boolean;
  titles: boolean;
  music: boolean;
}

export interface SendResult {
  resolveFound: boolean;
  launched: boolean;
  scriptPath: string;
  timeline: string;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  projectsDir: string;
}
