import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FileVideo, ImageOff, Layers, Library, Search, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Empty, Input, Modal, Segmented, Spinner, Switch, clsx } from "../../components/ui";
import { api, errorText, fileSrc } from "../../lib/api";
import { IMAGE_EXT, VIDEO_EXT, fmtTime } from "../../lib/format";
import { useStore } from "../../lib/store";
import type { Broll, Edit, EditBundle, LibraryItem, Project, StockClip, Timeline } from "../../lib/types";

interface Props {
  project: Project;
  edit: Edit;
  timeline: Timeline;
  update: (fn: (e: Edit) => Edit) => void;
  onSeek: (t: number) => void;
  setBundle: (b: EditBundle) => void;
  selected: string | null;
}

export function BrollPanel({ project, edit, timeline, update, onSeek, setBundle, selected }: Props) {
  const [picking, setPicking] = useState<Broll | null>(null);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const navigate = useStore((s) => s.navigate);
  const empty = edit.broll.filter((b) => b.enabled && !b.asset).length;
  const stockReady = !!(settings?.pexelsKey || settings?.pixabayKey);
  const setItem = (id: string, patch: Partial<Broll>) => update((e) => ({ ...e, broll: e.broll.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));

  if (edit.broll.length === 0)
    return (
      <Empty icon={<Layers className="size-5" />} title="No B-roll in this edit">
        Ask in the chat, e.g. “add B-roll over the explanation parts”.
      </Empty>
    );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1 text-[12px] text-muted">
          {empty > 0
            ? `${empty} slot${empty > 1 ? "s are" : " is"} still empty – they export as timeline markers until filled.`
            : "All B-roll slots are filled."}
        </div>
        {!stockReady && empty > 0 && (
          <Button size="sm" variant="ghost" onClick={() => navigate({ name: "settings", tab: "broll" })}>
            Connect Pexels / Pixabay
          </Button>
        )}
        <Button
          size="sm"
          variant="soft"
          icon={<Wand2 className="size-3.5" />}
          disabled={empty === 0}
          onClick={async () => {
            try {
              await api.fillBroll(project.id);
              toast("Finding B-roll…");
            } catch (e) {
              toast(errorText(e), "error");
            }
          }}
        >
          Fill empty slots
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5">
        {edit.broll.map((b) => {
          const tl = timeline.broll.find((x) => x.id === b.id);
          return (
            <div
              key={b.id}
              className={clsx(
                "overflow-hidden rounded-xl border bg-surface transition-colors",
                selected === b.id ? "border-accent ring-3 ring-accent/12" : "border-line",
                !b.enabled && "opacity-55",
              )}
            >
              <button className="relative block aspect-video w-full bg-surface-3" onClick={() => tl && onSeek(tl.start)}>
                {b.asset ? (
                  <img src={fileSrc(b.asset.thumb)} className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 border-b border-dashed border-line text-faint">
                    <ImageOff className="size-5" />
                    <span className="text-[11.5px]">Empty slot</span>
                  </div>
                )}
                <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10.5px] font-medium text-white tabular-nums">
                  {tl ? `${fmtTime(tl.start)} · ${(tl.end - tl.start).toFixed(1)}s` : "not placed"}
                </span>
                {b.asset?.kind && (
                  <span className="absolute top-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10.5px] text-white capitalize">{b.asset.kind}</span>
                )}
              </button>
              <div className="p-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold">{b.query}</div>
                    <div className="line-clamp-2 text-[11.5px] leading-snug text-muted">{b.reason}</div>
                  </div>
                  <Switch checked={b.enabled} onChange={(v) => setItem(b.id, { enabled: v })} label="Use this B-roll" />
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <Button size="sm" className="flex-1" onClick={() => setPicking(b)}>
                    {b.asset ? "Change" : "Choose clip"}
                  </Button>
                  <select
                    value={b.duration}
                    onChange={(e) => setItem(b.id, { duration: Number(e.target.value) })}
                    className="h-8 rounded-xl border border-line bg-surface px-1.5 text-[12px] text-text-2"
                    title="Length"
                  >
                    {[1.5, 2, 2.5, 3, 4, 5, 6, 8].map((d) => (
                      <option key={d} value={d}>
                        {d}s
                      </option>
                    ))}
                  </select>
                </div>
                {b.asset?.credit && (
                  <button onClick={() => b.asset?.url && openUrl(b.asset.url)} className="mt-1.5 truncate text-[11px] text-faint hover:text-muted">
                    {b.asset.credit}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {picking && <BrollPicker project={project} broll={picking} onClose={() => setPicking(null)} onDone={setBundle} />}
    </div>
  );
}

function BrollPicker({ project, broll, onClose, onDone }: { project: Project; broll: Broll; onClose: () => void; onDone: (b: EditBundle) => void }) {
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);
  const stockReady = !!(settings?.pexelsKey || settings?.pixabayKey);
  const [tab, setTab] = useState<"stock" | "library">(stockReady ? "stock" : "library");
  const [query, setQuery] = useState(broll.query);
  const [results, setResults] = useState<StockClip[] | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const search = async () => {
    setBusy("search");
    try {
      setResults(await api.searchStock(query, project.aspect === "9:16"));
    } catch (e) {
      toast(errorText(e), "error");
      setResults([]);
    }
    setBusy(null);
  };

  useEffect(() => {
    api.getLibrary().then(setLibrary);
    if (stockReady) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (key: string, choice: Parameters<typeof api.setBrollAsset>[2]) => {
    setBusy(key);
    try {
      onDone(await api.setBrollAsset(project.id, broll.id, choice));
      onClose();
    } catch (e) {
      toast(errorText(e), "error");
    }
    setBusy(null);
  };

  const lib = library.filter((l) => !filter || `${l.name} ${l.description} ${l.tags.join(" ")}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Modal
      open
      onClose={onClose}
      width={860}
      title={<span>B-roll for “{broll.query}”</span>}
      footer={
        <>
          {broll.asset && (
            <Button variant="danger" icon={<Trash2 className="size-3.5" />} loading={busy === "clear"} onClick={() => choose("clear", { clear: true })}>
              Remove clip
            </Button>
          )}
          <div className="flex-1" />
          <Button
            icon={<FileVideo className="size-4" />}
            loading={busy === "file"}
            onClick={async () => {
              const f = await open({ multiple: false, filters: [{ name: "Video or image", extensions: [...VIDEO_EXT, ...IMAGE_EXT] }] });
              if (typeof f === "string") choose("file", { file: f });
            }}
          >
            Use a file…
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-3">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "stock", label: (<><Sparkles className="size-3.5" /> Stock</>) },
            { value: "library", label: (<><Library className="size-3.5" /> My library · {library.length}</>) },
          ]}
        />
        {tab === "stock" ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stock footage" />
            <Button type="submit" icon={<Search className="size-4" />} loading={busy === "search"} disabled={!stockReady}>
              Search
            </Button>
          </form>
        ) : (
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter your clips" className="flex-1" />
        )}
      </div>
      {broll.reason && <div className="mb-3 text-[12.5px] text-muted">Why here: {broll.reason}</div>}

      {tab === "stock" &&
        (!stockReady ? (
          <Empty icon={<Sparkles className="size-5" />} title="Connect a stock library">
            Add a free Pexels or Pixabay API key in Settings ▸ B-roll to search millions of clips from here.
          </Empty>
        ) : results === null ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : results.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-muted">No clips found. Try simpler words.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {results.map((r) => (
              <button
                key={`${r.provider}-${r.id}`}
                onClick={() => choose(r.id, { stock: r })}
                disabled={!!busy}
                className="group relative aspect-video overflow-hidden rounded-xl bg-surface-3 text-left ring-accent transition-shadow hover:ring-2"
              >
                {r.thumb && <img src={r.thumb} className="h-full w-full object-cover" draggable={false} />}
                <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10.5px] text-white">
                  {r.duration.toFixed(0)}s · {r.width}×{r.height}
                </span>
                {busy === r.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[12px] text-white">Downloading…</span>
                )}
              </button>
            ))}
          </div>
        ))}

      {tab === "library" &&
        (library.length === 0 ? (
          <Empty icon={<Library className="size-5" />} title="Your library is empty">
            Add folders of your own clips in B-roll library. Your own footage beats stock for credibility.
          </Empty>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {lib.map((l) => (
              <button
                key={l.id}
                onClick={() => choose(l.id, { library: l.id })}
                disabled={!!busy}
                className="overflow-hidden rounded-xl border border-line bg-surface text-left transition-shadow hover:ring-2 hover:ring-accent"
              >
                <img src={fileSrc(l.thumb)} className="aspect-video w-full object-cover" draggable={false} />
                <div className="p-2">
                  <div className="truncate text-[12px] font-medium">{l.name}</div>
                  <div className="line-clamp-2 text-[11px] text-muted">{l.description || `${l.duration.toFixed(1)} s`}</div>
                </div>
              </button>
            ))}
          </div>
        ))}
    </Modal>
  );
}
