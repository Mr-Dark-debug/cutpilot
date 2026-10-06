import {
  Download,
  FolderKanban,
  Layers,
  ListVideo,
  Moon,
  Palette,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
} from "lucide-react";
import React from "react";
import { useStore, type Route } from "../lib/store";
import { installUpdate } from "../lib/updater";
import { Logo } from "./Logo";
import { Kbd, Progress, Segmented, clsx } from "./ui";

function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "group flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-[13.5px] transition-colors",
        active ? "bg-surface text-text shadow-card ring-1 ring-line" : "text-text-2 hover:bg-surface-3 hover:text-text",
      )}
    >
      <span className={clsx("flex size-5 items-center justify-center", active ? "text-accent" : "text-muted group-hover:text-text-2")}>{icon}</span>
      <span className="flex-1 text-left font-medium">{label}</span>
      {badge}
    </button>
  );
}

export function Sidebar() {
  const route = useStore((s) => s.route);
  const navigate = useStore((s) => s.navigate);
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const tools = useStore((s) => s.tools);
  const jobs = useStore((s) => s.jobs);
  const update = useStore((s) => s.update);
  const info = useStore((s) => s.info);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const running = Object.values(jobs).filter((j) => j.state === "running" || j.state === "queued").length;

  const is = (name: Route["name"]) => route.name === name || (name === "projects" && route.name === "project");
  const dark = settings?.theme === "dark" || (settings?.theme === "system" && document.documentElement.dataset.theme === "dark");

  const engines = tools.filter((t) => t.id === "claude" || t.id === "codex");

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-sidebar px-3 pt-4 pb-3">
      <div className="px-1.5 pb-4">
        <Logo />
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (route.name !== "projects") navigate({ name: "projects" });
          }}
          placeholder="Search projects"
          className="h-9 w-full rounded-xl border border-line bg-surface pr-10 pl-9 text-[13px] outline-none placeholder:text-faint focus:border-accent"
        />
        <span className="absolute top-1/2 right-2 -translate-y-1/2">
          <Kbd>/</Kbd>
        </span>
      </div>

      <nav className="space-y-0.5">
        <NavItem icon={<Sparkles className="size-[17px]" />} label="Studio" active={is("home")} onClick={() => navigate({ name: "home" })} />
        <NavItem icon={<FolderKanban className="size-[17px]" />} label="Projects" active={is("projects")} onClick={() => navigate({ name: "projects" })} />
        <NavItem
          icon={<ListVideo className="size-[17px]" />}
          label="Queue"
          active={is("queue")}
          onClick={() => navigate({ name: "queue" })}
          badge={
            running > 0 ? (
              <span className="rounded-full bg-accent px-1.5 py-px text-[11px] font-semibold text-white">{running}</span>
            ) : undefined
          }
        />
      </nav>

      <div className="mt-6 mb-1.5 px-2.5 text-[11.5px] font-semibold tracking-wide text-faint uppercase">Library</div>
      <nav className="space-y-0.5">
        <NavItem icon={<Palette className="size-[17px]" />} label="Styles" active={is("styles")} onClick={() => navigate({ name: "styles" })} />
        <NavItem icon={<Layers className="size-[17px]" />} label="B-roll library" active={is("library")} onClick={() => navigate({ name: "library" })} />
        <NavItem icon={<SettingsIcon className="size-[17px]" />} label="Settings" active={is("settings") || is("setup")} onClick={() => navigate({ name: "settings" })} />
      </nav>

      <div className="flex-1" />

      {update && (
        <div className="glow-card fade-in mb-3 rounded-2xl border border-line p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Download className="size-4 text-accent" /> Update {update.version}
          </div>
          {update.state === "downloading" ? (
            <>
              <div className="mt-1 mb-2 text-[12px] text-muted">Downloading… CutPilot restarts when done.</div>
              <Progress value={update.progress} />
            </>
          ) : update.state === "error" ? (
            <div className="mt-1 text-[12px] text-bad">{update.error}</div>
          ) : (
            <>
              <div className="mt-1 mb-2.5 line-clamp-2 text-[12px] text-muted">{update.notes || "A new version is ready to install."}</div>
              <button
                onClick={installUpdate}
                className="h-8 w-full rounded-lg bg-text text-[12.5px] font-medium text-surface hover:opacity-90"
              >
                Install & restart
              </button>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => navigate({ name: "settings", tab: "engines" })}
        className="mb-3 rounded-2xl border border-line bg-surface p-2.5 text-left shadow-card transition-colors hover:border-line-strong"
      >
        <div className="mb-1.5 px-0.5 text-[11.5px] font-semibold tracking-wide text-faint uppercase">AI engines</div>
        {engines.length === 0 && <div className="px-0.5 text-[12.5px] text-muted">Checking…</div>}
        {engines.map((t) => (
          <div key={t.id} className="flex items-center gap-2 px-0.5 py-0.5 text-[12.5px]">
            <span
              className={clsx(
                "size-2 rounded-full",
                t.installed && t.loggedIn ? "bg-ok" : t.installed ? "bg-warn" : "bg-line-strong",
              )}
            />
            <span className="flex-1 text-text-2">{t.name}</span>
            <span className="text-muted">{t.installed ? (t.loggedIn ? "Ready" : "Sign in") : "Not installed"}</span>
          </div>
        ))}
      </button>

      <Segmented
        size="sm"
        className="w-full"
        value={dark ? "dark" : "light"}
        onChange={(v) => settings && saveSettings({ ...settings, theme: v })}
        options={[
          { value: "light", label: (<><Sun className="size-3.5" /> Light</>) },
          { value: "dark", label: (<><Moon className="size-3.5" /> Dark</>) },
        ]}
      />
      <div className="mt-2.5 text-center text-[11px] text-faint">CutPilot {info?.version ?? ""}</div>
    </aside>
  );
}
