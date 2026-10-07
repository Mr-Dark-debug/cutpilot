import { Command } from "cmdk";
import {
  ArrowRight,
  Bot,
  Captions,
  Clapperboard,
  Download,
  FolderKanban,
  FolderOpen,
  Layers,
  ListVideo,
  Moon,
  Search,
  PanelLeft,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtDuration } from "../lib/format";
import { useStore, type Route } from "../lib/store";
import type { LibraryItem } from "../lib/types";
import { checkForUpdate } from "../lib/updater";
import { StyleIcon } from "./StylePicker";

function Item({ value, keywords, onSelect, icon, children, hint }: { value: string; keywords?: string[]; onSelect: () => void; icon: React.ReactNode; children: React.ReactNode; hint?: string }) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-[13px] text-text-2 data-[selected=true]:bg-surface-3 data-[selected=true]:text-text"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted ring-1 ring-line">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[11.5px] text-faint">{hint}</span>}
    </Command.Item>
  );
}

const Group = ({ heading, children }: { heading: string; children: React.ReactNode }) => (
  <Command.Group
    heading={heading}
    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase"
  >
    {children}
  </Command.Group>
);

export function Spotlight() {
  const open = useStore((s) => s.spotlightOpen);
  const setOpen = useStore((s) => s.setSpotlight);
  const projects = useStore((s) => s.projects);
  const styles = useStore((s) => s.styles);
  const navigate = useStore((s) => s.navigate);
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const [library, setLibrary] = useState<LibraryItem[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useStore.getState().spotlightOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) api.getLibrary().then(setLibrary).catch(() => setLibrary([]));
  }, [open]);

  if (!open) return null;
  const go = (r: Route) => {
    navigate(r);
    setOpen(false);
  };
  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/30 px-6 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div className="fade-in w-full max-w-[620px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
        <Command label="Search CutPilot" loop>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 text-faint" />
            <Command.Input
              autoFocus
              placeholder="Search projects, styles, clips, settings and actions…"
              className="h-13 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-faint"
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            />
          </div>
          <Command.List className="max-h-[56vh] overflow-auto p-1.5">
            <Command.Empty className="px-4 py-10 text-center text-[13px] text-muted">Nothing found.</Command.Empty>

            <Group heading="Go to">
              <Item value="studio new edit" onSelect={() => go({ name: "home" })} icon={<Clapperboard className="size-3.5" />} hint="New edit">
                Studio
              </Item>
              <Item value="projects all" onSelect={() => go({ name: "projects" })} icon={<FolderKanban className="size-3.5" />}>
                All projects
              </Item>
              <Item value="queue jobs batch" onSelect={() => go({ name: "queue" })} icon={<ListVideo className="size-3.5" />}>
                Queue
              </Item>
              <Item value="b-roll library clips" onSelect={() => go({ name: "library" })} icon={<Layers className="size-3.5" />}>
                B-roll library
              </Item>
              <Item value="settings ai engines claude codex models" onSelect={() => go({ name: "settings", tab: "engines" })} icon={<Bot className="size-3.5" />}>
                Settings · AI engines
              </Item>
              <Item value="settings tools ffmpeg whisper resolve davinci" onSelect={() => go({ name: "settings", tab: "tools" })} icon={<Wrench className="size-3.5" />}>
                Settings · Tools & DaVinci Resolve
              </Item>
              <Item value="settings transcription whisper language gpu" onSelect={() => go({ name: "settings", tab: "transcription" })} icon={<Captions className="size-3.5" />}>
                Settings · Transcription
              </Item>
              <Item value="settings b-roll pexels pixabay stock keys" onSelect={() => go({ name: "settings", tab: "broll" })} icon={<Layers className="size-3.5" />}>
                Settings · B-roll sources
              </Item>
              <Item value="settings projects folder speed parallel" onSelect={() => go({ name: "settings", tab: "general" })} icon={<FolderOpen className="size-3.5" />}>
                Settings · Projects & speed
              </Item>
            </Group>

            <Group heading="Actions">
              <Item
                value="toggle dark light theme mode"
                onSelect={() => run(() => settings && saveSettings({ ...settings, theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }))}
                icon={<Moon className="size-3.5" />}
              >
                Switch light / dark theme
              </Item>
              <Item value="toggle collapse sidebar" onSelect={() => run(toggleSidebar)} icon={<PanelLeft className="size-3.5" />} hint="Ctrl B">
                Collapse / expand sidebar
              </Item>
              <Item value="check for updates version" onSelect={() => run(() => checkForUpdate(false))} icon={<Download className="size-3.5" />}>
                Check for updates
              </Item>
            </Group>

            {projects.length > 0 && (
              <Group heading="Projects">
                {projects.map((p) => (
                  <Item
                    key={p.id}
                    value={`project ${p.name} ${p.id}`}
                    keywords={[p.brief, ...p.sources.map((s) => s.name)]}
                    onSelect={() => go({ name: "project", id: p.id })}
                    icon={<Clapperboard className="size-3.5" />}
                    hint={p.currentEdit ? `v${p.currentEdit} · ${fmtDuration(p.edits.find((e) => e.version === p.currentEdit)?.duration ?? 0)}` : p.status.state || "new"}
                  >
                    {p.name}
                  </Item>
                ))}
              </Group>
            )}

            <Group heading="Styles">
              {styles.map((s) => (
                <Item key={s.id} value={`style ${s.name} ${s.id}`} keywords={[s.category, s.description]} onSelect={() => go({ name: "styles", id: s.id })} icon={<StyleIcon style={s} size="sm" />} hint={s.category}>
                  {s.name}
                </Item>
              ))}
            </Group>

            {library.length > 0 && (
              <Group heading="B-roll clips">
                {library.slice(0, 200).map((l) => (
                  <Item key={l.id} value={`clip ${l.name} ${l.id}`} keywords={[l.description, ...l.tags]} onSelect={() => go({ name: "library" })} icon={<Layers className="size-3.5" />} hint={`${l.duration.toFixed(1)}s`}>
                    {l.name}
                  </Item>
                ))}
              </Group>
            )}
          </Command.List>
          <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11.5px] text-faint">
            <span>↑↓ to move</span>
            <span>↵ to open</span>
            <span>Esc to close</span>
            <span className="flex-1" />
            <ArrowRight className="size-3" /> Ctrl K anywhere
          </div>
        </Command>
      </div>
    </div>
  );
}

