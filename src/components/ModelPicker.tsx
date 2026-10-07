import { Brain, Check, ChevronDown, Search, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { EngineChoice, EngineModel } from "../lib/types";
import { ClaudeLogo, OpenAILogo } from "./BrandIcons";
import { Floating } from "./Floating";
import { clsx } from "./ui";

type Provider = "claude" | "codex";
type Rail = "fav" | Provider;

interface Row {
  key: string;
  provider: Provider;
  model: EngineModel;
  name: string;
  sub: string;
}

export function ProviderLogo({ provider, size = 16, className }: { provider: string; size?: number; className?: string }) {
  return provider === "codex" ? <OpenAILogo size={size} className={className} /> : <ClaudeLogo size={size} className={className} />;
}

/** "Sonnet (latest) · balanced" → "Claude Sonnet", "GPT-6-Astra" stays. */
export function modelName(provider: string, m?: EngineModel, fallback = "") {
  if (!m) return fallback || (provider === "codex" ? "Codex default" : "Claude");
  if (provider === "claude") return `Claude ${m.label.split(" ")[0]}`;
  return m.label;
}

function modelSub(provider: string, m: EngineModel) {
  if (provider === "claude") {
    const hint = m.label.split("·")[1]?.trim();
    return hint ? `Claude Code · ${hint}` : "Claude Code";
  }
  return "Codex";
}

const EFFORT_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

const EFFORT_HINT: Record<string, string> = {
  low: "Fastest, lightest thinking",
  medium: "Balanced – right for most edits",
  high: "Thinks longer on messy footage",
  xhigh: "Deep reasoning, slower",
  max: "Maximum reasoning, slowest",
  ultra: "Maximum reasoning with delegation",
};

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return { open, setOpen, ref };
}

/** Model chip + popover in the style of the ChatGPT/Codex desktop picker. */
export function ModelPicker({
  value,
  onChange,
  placement = "top",
  compact,
  align = "left",
}: {
  value: EngineChoice;
  onChange: (e: EngineChoice) => void;
  placement?: "top" | "bottom";
  compact?: boolean;
  align?: "left" | "right";
}) {
  const models = useStore((s) => s.models);
  const tools = useStore((s) => s.tools);
  const favorites = useStore((s) => s.settings?.favoriteModels ?? []);
  const toggleFavorite = useStore((s) => s.toggleFavoriteModel);
  const { open, setOpen, ref } = usePopover();
  const [rail, setRail] = useState<Rail>((value.provider as Provider) || "claude");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows: Row[] = useMemo(() => {
    const all: Row[] = [
      ...models.codex.map((m) => ({ key: `codex:${m.id}`, provider: "codex" as Provider, model: m, name: modelName("codex", m), sub: modelSub("codex", m) })),
      ...models.claude.map((m) => ({ key: `claude:${m.id}`, provider: "claude" as Provider, model: m, name: modelName("claude", m), sub: modelSub("claude", m) })),
    ];
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (q) return `${r.name} ${r.sub} ${r.model.id}`.toLowerCase().includes(q);
      if (rail === "fav") return favorites.includes(r.key);
      return r.provider === rail;
    });
  }, [models, rail, query, favorites]);

  useEffect(() => {
    if (open) {
      setRail(favorites.length && !query ? (value.provider as Provider) : ((value.provider as Provider) || "claude"));
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => setCursor(0), [rail, query]);

  const pick = (r: Row) => {
    const effort = r.model.efforts.includes(value.effort) ? value.effort : r.model.defaultEffort || "medium";
    onChange({ provider: r.provider, model: r.model.id, effort });
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(rows.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && rows[cursor]) {
      e.preventDefault();
      pick(rows[cursor]);
    } else if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const r = rows[Number(e.key) - 1];
      if (r) pick(r);
    }
  };

  const ready = (p: string) => tools.some((t) => t.id === p && t.installed && t.loggedIn);
  const list = value.provider === "codex" ? models.codex : models.claude;
  const current = list.find((m) => m.id === value.model) ?? list[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium whitespace-nowrap text-text-2 transition-colors hover:bg-surface-3 hover:text-text",
          open && "bg-surface-3 text-text",
        )}
        title="Choose the AI model"
      >
        <ProviderLogo provider={value.provider} size={14} className={value.provider === "codex" ? "text-text" : ""} />
        {!compact && <span className="max-w-[150px] truncate">{modelName(value.provider, current, value.model)}</span>}
        <ChevronDown className="size-3 text-muted" />
      </button>
      {open && (
        <Floating anchor={ref} placement={placement} align={align} onClose={() => setOpen(false)}>
        <div className="fade-in flex w-[400px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop" onKeyDown={onKey}>
          <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-2 py-2">
            {(
              [
                ["fav", <Star key="s" className="size-4" />, "Favourites"],
                ["codex", <OpenAILogo key="o" size={17} />, "Codex (OpenAI)"],
                ["claude", <ClaudeLogo key="c" size={17} />, "Claude"],
              ] as const
            ).map(([id, icon, label]) => (
              <button
                key={id}
                type="button"
                title={label}
                onClick={() => {
                  setRail(id);
                  setQuery("");
                }}
                className={clsx(
                  "relative flex size-9 items-center justify-center rounded-xl transition-colors",
                  rail === id && !query ? "bg-surface text-text shadow-card" : "text-muted hover:bg-surface-3 hover:text-text",
                )}
              >
                {rail === id && !query && <span className="absolute top-2 -left-[7px] h-5 w-[3px] rounded-full bg-text" />}
                {icon}
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <Search className="size-4 text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="h-6 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
              />
            </div>
            <div className="max-h-[300px] overflow-auto p-1.5">
              {rows.length === 0 && (
                <div className="px-3 py-6 text-center text-[12.5px] text-muted">
                  {rail === "fav" && !query ? "Star models to keep them here." : "No models found."}
                </div>
              )}
              {rows.map((r, i) => {
                const selected = r.provider === value.provider && r.model.id === (current?.id ?? value.model);
                const fav = favorites.includes(r.key);
                const disabled = !ready(r.provider);
                return (
                  <div
                    key={r.key}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => pick(r)}
                    className={clsx(
                      "group flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2",
                      i === cursor ? "bg-surface-3" : "",
                      disabled && "opacity-55",
                    )}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-line">
                      <ProviderLogo provider={r.provider} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                        {r.name}
                        {selected && <Check className="size-3.5 text-ok" />}
                      </span>
                      <span className="flex items-center gap-1 text-[11.5px] text-muted">
                        <ProviderLogo provider={r.provider} size={10} />
                        {disabled ? `${r.sub} · not signed in` : r.sub}
                      </span>
                    </span>
                    {i < 9 && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-faint ring-1 ring-line">Ctrl+{i + 1}</span>}
                    <button
                      type="button"
                      title={fav ? "Remove from favourites" : "Add to favourites"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(r.key);
                      }}
                      className={clsx("rounded-md p-1 transition-colors", fav ? "text-amber-400" : "text-faint opacity-0 group-hover:opacity-100 hover:text-text")}
                    >
                      <Star className={clsx("size-3.5", fav && "fill-current")} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </Floating>
      )}
    </div>
  );
}

/** Reasoning effort chip ("Medium", "Extra High"…). */
export function EffortPicker({ value, onChange, placement = "top" }: { value: EngineChoice; onChange: (e: EngineChoice) => void; placement?: "top" | "bottom" }) {
  const models = useStore((s) => s.models);
  const { open, setOpen, ref } = usePopover();
  const list = value.provider === "codex" ? models.codex : models.claude;
  const model = list.find((m) => m.id === value.model) ?? list[0];
  const efforts = model?.efforts.length ? model.efforts : ["low", "medium", "high"];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="How hard the AI thinks"
        className={clsx(
          "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium whitespace-nowrap text-text-2 transition-colors hover:bg-surface-3 hover:text-text",
          open && "bg-surface-3 text-text",
        )}
      >
        <Brain className="size-3.5" />
        {EFFORT_LABEL[value.effort] ?? value.effort}
        <ChevronDown className="size-3 text-muted" />
      </button>
      {open && (
        <Floating anchor={ref} placement={placement} align={"left"} onClose={() => setOpen(false)}>
        <div className="fade-in w-[250px] rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Reasoning</div>
          {efforts.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onChange({ ...value, effort: e });
                setOpen(false);
              }}
              className={clsx("flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-surface-3", e === value.effort && "bg-surface-2")}
            >
              <span className="mt-0.5 size-3.5 shrink-0 text-ok">{e === value.effort && <Check className="size-3.5" />}</span>
              <span>
                <span className="block text-[13px] font-medium">{EFFORT_LABEL[e] ?? e}</span>
                <span className="block text-[11.5px] text-muted">{EFFORT_HINT[e] ?? ""}</span>
              </span>
            </button>
          ))}
        </div>
        </Floating>
      )}
    </div>
  );
}
