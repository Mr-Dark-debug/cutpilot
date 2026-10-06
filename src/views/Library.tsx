import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { FolderPlus, Layers, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Empty, Input } from "../components/ui";
import { api, errorText, fileSrc } from "../lib/api";
import { useStore } from "../lib/store";
import type { LibraryItem } from "../lib/types";

export function Library() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const jobs = useStore((s) => s.jobs);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [filter, setFilter] = useState("");
  const running = Object.values(jobs).find((j) => j.kind === "library" && (j.state === "running" || j.state === "queued"));
  const doneKey = Object.values(jobs)
    .filter((j) => j.kind === "library" && j.state === "done")
    .map((j) => j.id)
    .join();

  useEffect(() => {
    api.getLibrary().then(setItems);
  }, [doneKey]);

  const scan = async () => {
    try {
      await api.scanLibrary();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const addFolder = async () => {
    const f = await open({ directory: true, multiple: false });
    if (typeof f !== "string" || !settings) return;
    if (!settings.libraryFolders.includes(f)) {
      await saveSettings({ ...settings, libraryFolders: [...settings.libraryFolders, f] });
      scan();
    }
  };

  const undescribed = items.filter((i) => !i.description).length;
  const list = items.filter((l) => !filter || `${l.name} ${l.description} ${l.tags.join(" ")}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1180px] px-8 py-7">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">B-roll library</h1>
            <p className="mt-1 max-w-[620px] text-[13.5px] text-muted">
              Your own cut-aways: clinic shots, product close-ups, location clips. The AI sees short descriptions and picks from here before
              going to stock.
            </p>
          </div>
          <div className="flex gap-2">
            <Button icon={<RefreshCw className="size-4" />} onClick={scan} disabled={!!running || !settings?.libraryFolders.length}>
              Rescan
            </Button>
            <Button
              variant="soft"
              icon={<Sparkles className="size-4" />}
              disabled={!!running || undescribed === 0}
              onClick={async () => {
                try {
                  await api.describeLibrary();
                } catch (e) {
                  toast(errorText(e), "error");
                }
              }}
            >
              Describe {undescribed > 0 ? `${undescribed} clips` : "clips"} with AI
            </Button>
            <Button variant="primary" icon={<FolderPlus className="size-4" />} onClick={addFolder}>
              Add folder
            </Button>
          </div>
        </div>

        {settings && settings.libraryFolders.length > 0 && (
          <Card className="mb-5 flex flex-wrap items-center gap-2 p-3">
            <span className="px-1 text-[12px] font-medium text-muted">Folders</span>
            {settings.libraryFolders.map((f) => (
              <span key={f} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 py-1 pr-1 pl-2.5 text-[12.5px]">
                <button onClick={() => openPath(f)} className="max-w-[360px] truncate hover:underline">
                  {f}
                </button>
                <button
                  onClick={async () => {
                    await saveSettings({ ...settings, libraryFolders: settings.libraryFolders.filter((x) => x !== f) });
                    scan();
                  }}
                  className="rounded p-0.5 text-muted hover:bg-surface-3 hover:text-text"
                  aria-label="Remove folder"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <div className="flex-1" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter clips" className="h-8 w-56" />
          </Card>
        )}

        {running && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[12.5px] text-accent-text">
            <Loader2 className="size-3.5 animate-spin" /> {running.message || running.title}
          </div>
        )}

        {items.length === 0 ? (
          <Empty
            icon={<Layers className="size-5" />}
            title="No clips yet"
            action={
              <Button variant="primary" icon={<FolderPlus className="size-4" />} onClick={addFolder}>
                Add a folder of clips
              </Button>
            }
          >
            Point CutPilot at folders of your own footage. Videos and photos are indexed (nothing is copied), then the AI can describe them.
          </Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
            {list.map((l) => (
              <Card key={l.id} className="overflow-hidden">
                <button onClick={() => openPath(l.path)} className="relative block aspect-video w-full bg-surface-3">
                  <img src={fileSrc(l.thumb)} className="h-full w-full object-cover" draggable={false} />
                  <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10.5px] text-white">
                    {l.isImage ? "photo" : `${l.duration.toFixed(1)}s`}
                  </span>
                  <span className="absolute top-1.5 left-1.5 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white/80">{l.id}</span>
                </button>
                <div className="p-3">
                  <div className="truncate text-[12.5px] font-semibold">{l.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{l.description || "Not described yet"}</div>
                  {l.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {l.tags.slice(0, 4).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
