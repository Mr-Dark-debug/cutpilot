import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { useStore } from "../../lib/store";
import type { Edit, EditBundle, Project, SourceData } from "../../lib/types";

/** Loads the current edit, applies local changes immediately and autosaves them. */
export function useEditor(project: Project | undefined, reloadToken: number) {
  const [bundle, setBundle] = useState<EditBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [sources, setSources] = useState<Record<string, SourceData>>({});
  const timer = useRef<number | undefined>(undefined);
  const pendingEdit = useRef<Edit | null>(null);
  const toast = useStore((s) => s.toast);

  const id = project?.id;
  const version = project?.currentEdit ?? null;
  const editsCount = project?.edits.length ?? 0;

  useEffect(() => {
    if (!id || !version) {
      setBundle(null);
      return;
    }
    let alive = true;
    api
      .getEdit(id)
      .then((b) => {
        if (alive) {
          setBundle(b);
          setError(null);
        }
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [id, version, editsCount, reloadToken]);

  const analyzedKey = project?.sources.map((s) => `${s.id}:${s.analyzed}`).join(",") ?? "";
  useEffect(() => {
    if (!id || !project) return;
    let alive = true;
    for (const s of project.sources.filter((x) => x.analyzed)) {
      api.getSourceData(id, s.id).then((d) => alive && setSources((prev) => ({ ...prev, [s.id]: d })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, analyzedKey]);

  const flush = useCallback(async () => {
    if (!id || !pendingEdit.current) return;
    const edit = pendingEdit.current;
    pendingEdit.current = null;
    setSaving("saving");
    try {
      const timeline = await api.saveEdit(id, edit);
      setBundle((b) => (b && b.edit.version === edit.version ? { ...b, timeline } : b));
      setSaving("saved");
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`, "error");
      setSaving("idle");
    }
  }, [id, toast]);

  const update = useCallback(
    (fn: (e: Edit) => Edit) => {
      setBundle((b) => {
        if (!b) return b;
        const edit = fn(structuredClone(b.edit));
        pendingEdit.current = edit;
        return { ...b, edit };
      });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 250);
    },
    [flush],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { bundle, setBundle, error, saving, update, sources };
}
