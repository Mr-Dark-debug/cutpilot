import { useStore } from "../lib/store";
import type { EngineChoice } from "../lib/types";

/** The engine new projects start with (Settings ▸ AI engines). */
export function defaultEngine(): EngineChoice {
  const s = useStore.getState().settings;
  if (!s) return { provider: "claude", model: "sonnet", effort: "medium" };
  return s.engine.provider === "codex"
    ? { provider: "codex", model: s.engine.codexModel, effort: s.engine.codexEffort }
    : { provider: "claude", model: s.engine.claudeModel, effort: s.engine.claudeEffort };
}
