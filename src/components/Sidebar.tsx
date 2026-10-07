import {
  ChevronRight,
  Clapperboard,
  Download,
  FolderKanban,
  Layers,
  ListVideo,
  Loader2,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import React, { useState } from "react";
import { timeAgo } from "../lib/format";
import { useStore, writeFlag, type Route } from "../lib/store";
import { installUpdate } from "../lib/updater";
import { Logo, LogoMark } from "./Logo";
import { Kbd, Progress, Segmented, clsx } from "./ui";

function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
  collapsed,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
  collapsed: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={clsx(
        "group relative flex h-9 w-full items-center rounded-xl text-[13.5px] transition-colors",
        collapsed ? "justify-center" : "gap-2.5 px-2.5",
        active ? "bg-surface text-text shadow-card ring-1 ring-line" : "text-text-2 hover:bg-surface-3 hover:text-text",
      )}
    >
      <span className={clsx("flex size-5 items-center justify-center", active ? "text-text" : "text-muted group-hover:text-text-2")}>{icon}</span>
      {!collapsed && <span className="flex-1 text-left font-medium">{label}</span>}
      {!collapsed && badge}
      {!collapsed && trailing}
      {collapsed && badge && <span className="absolute top-1 right-1.5 size-2 rounded-full bg-accent" />}
    </button>
  );
}

function readOpen() {
  try {
    return localStorage.getItem("cutpilot-projects-open") !== "0";
  } catch {
    return true;
  }
}

export function Sidebar() {
  const route = useStore((s) => s.route);
  const navigate = useStore((s) => s.navigate);
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const projects = useStore((s) => s.projects);
  const jobs = useStore((s) => s.jobs);
  const update = useStore((s) => s.update);
  const info = useStore((s) => s.info);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const toggle = useStore((s) => s.toggleSidebar);
  const setSpotlight = useStore((s) => s.setSpotlight);
  const [projectsOpen, setProjectsOpen] = useState(readOpen);
  const activeJobs = Object.values(jobs).filter((j) => j.state === "running" || j.state === "queued");
  const busy = new Set(activeJobs.map((j) => j.projectId));

  const is = (name: Route["name"]) => route.name === name;
  const dark = document.documentElement.dataset.theme === "dark";
  const currentProject = route.name === "project" ? route.id : null;

  const toggleProjects = () => {
    setProjectsOpen((o) => {
      writeFlag("cutpilot-projects-open", !o);
      return !o;
    });
  };

  return (
    <aside
      className={clsx(
        "flex h-full shrink-0 flex-col border-r border-line bg-sidebar pt-3.5 pb-3 transition-[width] duration-200",
        collapsed ? "w-[64px] px-2" : "w-[252px] px-3",
      )}
    >
      <div className={clsx("flex items-center pb-3", collapsed ? "flex-col gap-2" : "justify-between px-1")}>
        {collapsed ? <LogoMark size={28} /> : <Logo />}
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
          className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-text"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <button
        onClick={() => setSpotlight(true)}
        title="Search everything (Ctrl+K)"
        className={clsx(
          "mb-3 flex h-9 items-center rounded-xl border border-line bg-surface text-[13px] text-faint transition-colors hover:border-line-strong hover:text-muted",
          collapsed ? "justify-center" : "gap-2 px-3",
        )}
      >
        <Search className="size-4" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Search</span>
            <Kbd>Ctrl K</Kbd>
          </>
        )}
      </button>

      <nav className="space-y-0.5">
        <NavItem collapsed={collapsed} icon={<Clapperboard className="size-[17px]" />} label="Studio" active={is("home")} onClick={() => navigate({ name: "home" })} />
        <NavItem
          collapsed={collapsed}
          icon={<FolderKanban className="size-[17px]" />}
          label="Projects"
          active={is("projects")}
          onClick={() => (collapsed ? navigate({ name: "projects" }) : toggleProjects())}
          trailing={
            <span
              role="button"
              title="All projects"
              onClick={(e) => {
                e.stopPropagation();
                navigate({ name: "projects" });
              }}
              className="flex items-center gap-1 text-muted"
            >
              <span className="text-[11.5px] tabular-nums">{projects.length}</span>
              <ChevronRight className={clsx("size-3.5 transition-transform", projectsOpen && "rotate-90")} />
            </span>
          }
        />
        {!collapsed && projectsOpen && (
          <div className="relative ml-[21px] space-y-px border-l border-line py-0.5 pl-2">
            {projects.slice(0, 14).map((p) => {
              const active = currentProject === p.id;
              const running = busy.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => navigate({ name: "project", id: p.id })}
                  title={p.name}
                  className={clsx(
                    "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] transition-colors",
                    active ? "bg-surface-3 font-medium text-text" : "text-text-2 hover:bg-surface-3 hover:text-text",
                  )}
                >
                  {running ? (
                    <Loader2 className="size-3 shrink-0 animate-spin text-accent" />
                  ) : (
                    <span className={clsx("size-1.5 shrink-0 rounded-full", p.status.state === "error" ? "bg-bad" : p.currentEdit ? "bg-ok" : "bg-line-strong")} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {!active && <span className="shrink-0 text-[10.5px] text-faint">{timeAgo(p.updated).replace(" ago", "")}</span>}
                </button>
              );
            })}
            <button
              onClick={() => navigate({ name: "home" })}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-muted hover:bg-surface-3 hover:text-text"
            >
              <Plus className="size-3.5" /> New edit
            </button>
            {projects.length > 14 && (
              <button
                onClick={() => navigate({ name: "projects" })}
                className="flex h-7 w-full items-center px-2 text-left text-[12px] text-muted hover:text-text"
              >
                View all {projects.length} projects
              </button>
            )}
          </div>
        )}
        <NavItem
          collapsed={collapsed}
          icon={<ListVideo className="size-[17px]" />}
          label="Queue"
          active={is("queue")}
          onClick={() => navigate({ name: "queue" })}
          badge={activeJobs.length > 0 ? <span className="rounded-full bg-accent px-1.5 py-px text-[11px] font-semibold text-white">{activeJobs.length}</span> : undefined}
        />
      </nav>

      {!collapsed ? (
        <div className="mt-5 mb-1.5 px-2.5 text-[11.5px] font-semibold tracking-wide text-faint uppercase">Library</div>
      ) : (
        <div className="mx-auto my-3 h-px w-6 bg-line" />
      )}
      <nav className="space-y-0.5">
        <NavItem collapsed={collapsed} icon={<Palette className="size-[17px]" />} label="Styles" active={is("styles")} onClick={() => navigate({ name: "styles" })} />
        <NavItem collapsed={collapsed} icon={<Layers className="size-[17px]" />} label="B-roll library" active={is("library")} onClick={() => navigate({ name: "library" })} />
        <NavItem collapsed={collapsed} icon={<SettingsIcon className="size-[17px]" />} label="Settings" active={is("settings") || is("setup")} onClick={() => navigate({ name: "settings" })} />
      </nav>

      <div className="min-h-4 flex-1" />

      {update &&
        (collapsed ? (
          <button onClick={installUpdate} title={`Install update ${update.version}`} className="mx-auto mb-3 flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
            <Download className="size-4" />
          </button>
        ) : (
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
                <button onClick={installUpdate} className="h-8 w-full rounded-lg bg-text text-[12.5px] font-medium text-surface hover:opacity-90">
                  Install & restart
                </button>
              </>
            )}
          </div>
        ))}

      {collapsed ? (
        <button
          onClick={() => settings && saveSettings({ ...settings, theme: dark ? "light" : "dark" })}
          title={dark ? "Light mode" : "Dark mode"}
          className="mx-auto flex size-9 items-center justify-center rounded-xl text-muted hover:bg-surface-3 hover:text-text"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      ) : (
        <>
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
        </>
      )}
    </aside>
  );
}
