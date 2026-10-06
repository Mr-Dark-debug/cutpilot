import { Bot, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { EngineChoice } from "../lib/types";
import { Segmented, Select, clsx } from "./ui";

export function defaultEngine(): EngineChoice {
  const s = useStore.getState().settings;
  if (!s) return { provider: "claude", model: "sonnet", effort: "medium" };
  return s.engine.provider === "codex"
    ? { provider: "codex", model: s.engine.codexModel, effort: s.engine.codexEffort }
    : { provider: "claude", model: s.engine.claudeModel, effort: s.engine.claudeEffort };
}

export function engineLabel(e: EngineChoice, models: ReturnType<typeof useStore.getState>["models"]) {
  const list = e.provider === "codex" ? models.codex : models.claude;
  const m = list.find((x) => x.id === e.model);
  const name = e.provider === "codex" ? "Codex" : "Claude";
  const model = m ? m.label.split(" ·")[0].replace(" (latest)", "") : e.model || (e.provider === "codex" ? "default model" : "");
  return model ? `${name} · ${model}` : name;
}

export function EngineFields({ value, onChange }: { value: EngineChoice; onChange: (e: EngineChoice) => void }) {
  const models = useStore((s) => s.models);
  const tools = useStore((s) => s.tools);
  const list = value.provider === "codex" ? models.codex : models.claude;
  const model = list.find((m) => m.id === value.model) ?? list[0];
  const efforts = model?.efforts.length ? model.efforts : ["low", "medium", "high"];
  const status = (id: string) => tools.find((t) => t.id === id);
  const switchTo = (provider: "claude" | "codex") => {
    const l = provider === "codex" ? models.codex : models.claude;
    const s = useStore.getState().settings?.engine;
    const preferred = provider === "codex" ? s?.codexModel : s?.claudeModel;
    const m = l.find((x) => x.id === preferred) ?? l[0];
    onChange({ provider, model: m?.id ?? "", effort: m?.defaultEffort ?? "medium" });
  };
  return (
    <div className="space-y-3">
      <Segmented
        className="w-full"
        value={value.provider === "codex" ? "codex" : "claude"}
        onChange={(v) => switchTo(v)}
        options={(["claude", "codex"] as const).map((id) => {
          const st = status(id);
          return {
            value: id,
            label: (
              <>
                <span className={clsx("size-1.5 rounded-full", st?.installed && st.loggedIn ? "bg-ok" : "bg-warn")} />
                {id === "claude" ? "Claude Code" : "Codex"}
              </>
            ),
          };
        })}
      />
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <Select
          value={model?.id ?? ""}
          onChange={(id) => {
            const m = list.find((x) => x.id === id);
            onChange({ ...value, model: id, effort: m?.efforts.includes(value.effort) ? value.effort : (m?.defaultEffort ?? "medium") });
          }}
          options={list.map((m) => ({ value: m.id, label: m.label }))}
          placeholder={value.provider === "codex" ? "No Codex models found" : "Model"}
        />
        <Select
          value={value.effort}
          onChange={(effort) => onChange({ ...value, effort })}
          options={efforts.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) }))}
        />
      </div>
    </div>
  );
}

/** Compact chip that opens the engine fields in a popover. */
export function EngineChip({ value, onChange }: { value: EngineChoice; onChange: (e: EngineChoice) => void }) {
  const [open, setOpen] = useState(false);
  const models = useStore((s) => s.models);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium whitespace-nowrap text-text-2 transition-colors hover:bg-surface-3 hover:text-text"
      >
        <Bot className="size-3.5" />
        {engineLabel(value, models)}
        <ChevronDown className="size-3 text-muted" />
      </button>
      {open && (
        <div className="fade-in absolute bottom-full left-0 z-50 mb-2 w-[340px] rounded-2xl border border-line bg-surface p-3.5 shadow-pop">
          <div className="mb-2.5 text-[12.5px] font-semibold">AI editor for this project</div>
          <EngineFields value={value} onChange={onChange} />
          <div className="mt-3 text-[11.5px] leading-relaxed text-muted">
            Runs through your own signed-in CLI and uses your subscription. If one engine runs out of usage, CutPilot can switch to
            the other (Settings ▸ Engines).
          </div>
        </div>
      )}
    </div>
  );
}
