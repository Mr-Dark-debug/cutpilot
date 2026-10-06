import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Bot, Captions, Download, ExternalLink, Eye, EyeOff, FolderOpen, Info, Layers, RefreshCw, Sparkles, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { EngineFields } from "../components/EnginePicker";
import { LogoMark } from "../components/Logo";
import { ToolRow, installTool, useInstallJob } from "../components/ToolRow";
import { Badge, Button, Card, Input, Select, Switch, clsx } from "../components/ui";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { Settings as S, WhisperModel } from "../lib/types";
import { checkForUpdate, installUpdate } from "../lib/updater";

const TABS = [
  { id: "engines", label: "AI engines", icon: Bot },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "transcription", label: "Transcription", icon: Captions },
  { id: "broll", label: "B-roll sources", icon: Layers },
  { id: "general", label: "Projects & speed", icon: FolderOpen },
  { id: "updates", label: "Updates & about", icon: Info },
];

const LANGS = [
  ["auto", "Detect automatically"],
  ["en", "English"],
  ["hi", "Hindi"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["pt", "Portuguese"],
  ["ar", "Arabic"],
  ["bn", "Bengali"],
  ["mr", "Marathi"],
  ["gu", "Gujarati"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["ur", "Urdu"],
  ["ja", "Japanese"],
  ["zh", "Chinese"],
];

export function Settings({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab || "engines");
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);
  if (!settings) return null;
  const set = (patch: Partial<S>) => save({ ...settings, ...patch });

  return (
    <div className="flex h-full">
      <div className="w-[230px] shrink-0 border-r border-line bg-sidebar px-3 pt-5">
        <div className="mb-4 px-2 text-[18px] font-semibold tracking-tight">Settings</div>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-[13.5px] font-medium transition-colors",
              tab === t.id ? "bg-surface text-text shadow-card ring-1 ring-line" : "text-text-2 hover:bg-surface-3",
            )}
          >
            <t.icon className={clsx("size-4", tab === t.id ? "text-accent" : "text-muted")} /> {t.label}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[760px] space-y-5 px-8 py-7">
          {tab === "engines" && <Engines settings={settings} set={set} />}
          {tab === "tools" && <Tools />}
          {tab === "transcription" && <Transcription settings={settings} set={set} />}
          {tab === "broll" && <BrollSources settings={settings} set={set} />}
          {tab === "general" && <General settings={settings} set={set} />}
          {tab === "updates" && <Updates settings={settings} set={set} />}
        </div>
      </div>
    </div>
  );
}

function Header({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[20px] font-semibold tracking-tight">{title}</h2>
      {children && <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{children}</p>}
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line px-5 py-3.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Engines({ settings, set }: { settings: S; set: (p: Partial<S>) => void }) {
  const tools = useStore((s) => s.tools);
  const loadTools = useStore((s) => s.loadTools);
  const loading = useStore((s) => s.toolsLoading);
  const engines = tools.filter((t) => t.id === "claude" || t.id === "codex");
  const e = settings.engine;
  const value =
    e.provider === "codex"
      ? { provider: "codex", model: e.codexModel, effort: e.codexEffort }
      : { provider: "claude", model: e.claudeModel, effort: e.claudeEffort };
  return (
    <>
      <Header title="AI engines">
        CutPilot drives the Claude Code and Codex command-line tools you're already signed in to, so editing uses your existing subscription.
        It never sees or stores your login.
      </Header>
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[13px] font-semibold">Installed engines</span>
          <Button size="sm" variant="ghost" icon={<RefreshCw className={clsx("size-3.5", loading && "animate-spin")} />} onClick={loadTools}>
            Refresh
          </Button>
        </div>
        {engines.map((t) => (
          <ToolRow key={t.id} tool={t} />
        ))}
      </Card>
      <Card className="p-5">
        <div className="mb-3 text-[13.5px] font-semibold">Default for new projects</div>
        <EngineFields
          value={value}
          onChange={(v) =>
            set({
              engine:
                v.provider === "codex"
                  ? { ...e, provider: "codex", codexModel: v.model, codexEffort: v.effort }
                  : { ...e, provider: "claude", claudeModel: v.model, claudeEffort: v.effort },
            })
          }
        />
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Medium effort is plenty for most edits. Higher effort thinks longer on tricky footage (many retakes, interviews) and uses more of your
          plan.
        </p>
      </Card>
      <Card>
        <Row title="Switch engines when one runs out" hint="If Claude or Codex hits its usage limit mid-batch, finish the job with the other one.">
          <Switch checked={settings.engineFallback} onChange={(engineFallback) => set({ engineFallback })} />
        </Row>
        <Row title="Let the AI see frames" hint="Sends a few small contact-sheet images per video so it knows what's on screen. Turn off to save usage.">
          <Switch checked={settings.useFrames} onChange={(useFrames) => set({ useFrames })} />
        </Row>
      </Card>
    </>
  );
}

function Tools() {
  const tools = useStore((s) => s.tools);
  const loadTools = useStore((s) => s.loadTools);
  const loading = useStore((s) => s.toolsLoading);
  const list = tools.filter((t) => t.id !== "claude" && t.id !== "codex");
  const missing = list.filter((t) => t.required && !t.installed);
  return (
    <>
      <Header title="Tools">
        Free, open-source helpers CutPilot runs on your computer. Downloaded from their official release pages into your user folder.
      </Header>
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[13px] font-semibold">Status</span>
          <div className="flex gap-2">
            {missing.length > 0 && (
              <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} onClick={() => missing.forEach((t) => installTool(t.id))}>
                Install all required
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<RefreshCw className={clsx("size-3.5", loading && "animate-spin")} />} onClick={loadTools}>
              Refresh
            </Button>
          </div>
        </div>
        {list.map((t) => (
          <ToolRow key={t.id} tool={t} />
        ))}
      </Card>
    </>
  );
}

function Transcription({ settings, set }: { settings: S; set: (p: Partial<S>) => void }) {
  const [models, setModels] = useState<WhisperModel[]>([]);
  const tools = useStore((s) => s.tools);
  const loadTools = useStore((s) => s.loadTools);
  const gpu = tools.find((t) => t.id === "whisper-gpu");
  const model = tools.find((t) => t.id === "model");
  const job = useInstallJob("model");
  useEffect(() => {
    api.whisperModels().then(setModels);
  }, []);
  return (
    <>
      <Header title="Transcription">
        whisper.cpp turns speech into words with timing. Cut points come from the actual audio waveform, so cuts stay clean whatever the model.
      </Header>
      <Card>
        <Row title="Model" hint={models.find((m) => m.id === settings.whisperModel)?.note}>
          <Select
            className="w-64"
            align="right"
            value={settings.whisperModel}
            onChange={async (whisperModel) => {
              await set({ whisperModel });
              setTimeout(loadTools, 200);
            }}
            options={models.map((m) => ({ value: m.id, label: `${m.label} · ${m.sizeMb >= 1000 ? (m.sizeMb / 1000).toFixed(1) + " GB" : m.sizeMb + " MB"}`, hint: m.note }))}
          />
        </Row>
        {model && !model.installed && (
          <Row title="Model not downloaded yet" hint={job ? job.message : model.detail}>
            <Button size="sm" variant="primary" loading={!!job} icon={<Download className="size-3.5" />} onClick={() => installTool("model")}>
              Download
            </Button>
          </Row>
        )}
        <Row title="Spoken language" hint="Pick it if detection gets it wrong (e.g. Hinglish detected as English).">
          <Select className="w-64" align="right" value={settings.language} onChange={(language) => set({ language })} options={LANGS.map(([value, label]) => ({ value, label }))} />
        </Row>
        <Row
          title="Use NVIDIA GPU"
          hint={gpu?.installed ? "Several times faster transcription on NVIDIA graphics cards." : "Install the GPU build of whisper.cpp first (Tools)."}
        >
          <Switch checked={settings.whisperGpu && !!gpu?.installed} onChange={(whisperGpu) => (gpu?.installed ? set({ whisperGpu }) : installTool("whisper-gpu"))} />
        </Row>
      </Card>
    </>
  );
}

function SecretInput({ value, onSave, placeholder }: { value: string; onSave: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState(value);
  const [show, setShow] = useState(false);
  useEffect(() => setV(value), [value]);
  return (
    <div className="relative w-72">
      <Input type={show ? "text" : "password"} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v.trim())} className="pr-9" />
      <button onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted hover:text-text" aria-label={show ? "Hide" : "Show"}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function BrollSources({ settings, set }: { settings: S; set: (p: Partial<S>) => void }) {
  const navigate = useStore((s) => s.navigate);
  return (
    <>
      <Header title="B-roll sources">
        The AI suggests B-roll for each moment. CutPilot fills slots from your own library first, then from free stock sites with your API key.
        Empty slots export as markers in Resolve.
      </Header>
      <Card>
        <Row
          title="Pexels API key"
          hint={
            <button className="inline-flex items-center gap-1 text-accent-text hover:underline" onClick={() => openUrl("https://www.pexels.com/api/")}>
              Get a free key <ExternalLink className="size-3" />
            </button>
          }
        >
          <SecretInput value={settings.pexelsKey} onSave={(pexelsKey) => set({ pexelsKey })} placeholder="Paste key" />
        </Row>
        <Row
          title="Pixabay API key"
          hint={
            <button className="inline-flex items-center gap-1 text-accent-text hover:underline" onClick={() => openUrl("https://pixabay.com/api/docs/")}>
              Get a free key <ExternalLink className="size-3" />
            </button>
          }
        >
          <SecretInput value={settings.pixabayKey} onSave={(pixabayKey) => set({ pixabayKey })} placeholder="Paste key" />
        </Row>
        <Row title="Preferred stock site">
          <Select
            className="w-48"
            align="right"
            value={settings.stockProvider}
            onChange={(stockProvider) => set({ stockProvider })}
            options={[
              { value: "auto", label: "Automatic" },
              { value: "pexels", label: "Pexels" },
              { value: "pixabay", label: "Pixabay" },
              { value: "none", label: "Don't use stock" },
            ]}
          />
        </Row>
        <Row title="Your own library" hint={`${settings.libraryFolders.length} folder${settings.libraryFolders.length === 1 ? "" : "s"} indexed`}>
          <Button size="sm" onClick={() => navigate({ name: "library" })}>
            Manage
          </Button>
        </Row>
      </Card>
      <div className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Keys are stored in your user profile on this computer only. Stock clips are downloaded into each project's broll folder, and credits go into
        the YouTube notes.
      </div>
    </>
  );
}

function General({ settings, set }: { settings: S; set: (p: Partial<S>) => void }) {
  return (
    <>
      <Header title="Projects & speed" />
      <Card>
        <Row title="Projects folder" hint={settings.projectsDir}>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => openPath(settings.projectsDir)}>
              Open
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                const d = await open({ directory: true });
                if (typeof d === "string") {
                  await set({ projectsDir: d });
                  useStore.getState().loadProjects();
                }
              }}
            >
              Change
            </Button>
          </div>
        </Row>
        <Row title="AI edits in parallel" hint="How many videos the AI plans at once. Higher uses your subscription faster.">
          <Select
            className="w-24"
            align="right"
            value={String(settings.llmConcurrency)}
            onChange={(v) => set({ llmConcurrency: Number(v) })}
            options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </Row>
        <Row title="Transcriptions in parallel" hint="Transcription is heavy on the CPU/GPU. 1 is best on most laptops.">
          <Select
            className="w-24"
            align="right"
            value={String(settings.mediaConcurrency)}
            onChange={(v) => set({ mediaConcurrency: Number(v) })}
            options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </Row>
        <Row title="Burn captions into renders by default">
          <Switch checked={settings.burnCaptions} onChange={(burnCaptions) => set({ burnCaptions })} />
        </Row>
      </Card>
    </>
  );
}

function Updates({ settings, set }: { settings: S; set: (p: Partial<S>) => void }) {
  const info = useStore((s) => s.info);
  const update = useStore((s) => s.update);
  const [checking, setChecking] = useState(false);
  return (
    <>
      <Header title="Updates & about" />
      <Card className="glow-card p-5">
        <div className="flex items-center gap-4">
          <LogoMark size={48} />
          <div className="flex-1">
            <div className="text-[16px] font-semibold">CutPilot {info?.version}</div>
            <div className="text-[12.5px] text-muted">AI video editor that writes the edit, you review it.</div>
          </div>
          {update ? (
            <Button variant="primary" icon={<Download className="size-4" />} onClick={installUpdate} loading={update.state === "downloading"}>
              Install {update.version}
            </Button>
          ) : (
            <Button
              loading={checking}
              icon={<RefreshCw className="size-4" />}
              onClick={async () => {
                setChecking(true);
                await checkForUpdate(false);
                setChecking(false);
              }}
            >
              Check for updates
            </Button>
          )}
        </div>
        {update && (
          <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3.5">
            <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
              <Sparkles className="size-3.5 text-accent" /> What's new in {update.version}
              {update.date && <Badge>{new Date(update.date).toLocaleDateString()}</Badge>}
            </div>
            <div className="selectable text-[12.5px] leading-relaxed whitespace-pre-wrap text-text-2">{update.notes || "Bug fixes and improvements."}</div>
          </div>
        )}
      </Card>
      <Card>
        <Row title="Check for updates automatically" hint="On start-up. Updates are signed and installed only when you click Install.">
          <Switch checked={settings.autoCheckUpdates} onChange={(autoCheckUpdates) => set({ autoCheckUpdates })} />
        </Row>
        <Row title="App data folder" hint={info?.dataDir}>
          <Button size="sm" variant="ghost" onClick={() => info && openPath(info.dataDir)}>
            Open
          </Button>
        </Row>
        <Row title="Source code & releases">
          <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => openUrl("https://github.com/Mr-Dark-debug/cutpilot")}>
            GitHub
          </Button>
        </Row>
      </Card>
    </>
  );
}
