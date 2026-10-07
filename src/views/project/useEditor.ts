import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { useStore } from "../../lib/store";
import type { Edit, EditBundle, Project, SourceData } from "../../lib/types";

const HISTORY = 100;

/** Loads the current edit, applies local changes immediately, autosaves them and keeps undo history. */
export function useEditor(project: Project | undefined, reloadToken: number) {
  const [bundle, setBundle] = useState<EditBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [sources, setSources] = useState<Record<string, SourceData>>({});
  const [past, setPast] = useState<Edit[]>([]);
  const [future, setFuture] = useState<Edit[]>([]);
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
          setPast([]);
          setFuture([]);
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

  const schedule = useCallback(
    (edit: Edit) => {
      pendingEdit.current = edit;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 250);
    },
    [flush],
  );

  // Refs mirror state so the handlers below stay pure (React may call updaters twice).
  const bundleRef = useRef(bundle);
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  bundleRef.current = bundle;
  pastRef.current = past;
  futureRef.current = future;

  const apply = useCallback(
    (edit: Edit, nextPast: Edit[], nextFuture: Edit[]) => {
      const b = bundleRef.current;
      if (!b) return;
      const nb = { ...b, edit };
      bundleRef.current = nb;
      pastRef.current = nextPast;
      futureRef.current = nextFuture;
      setBundle(nb);
      setPast(nextPast);
      setFuture(nextFuture);
      schedule(edit);
    },
    [schedule],
  );

  const update = useCallback(
    (fn: (e: Edit) => Edit) => {
      const b = bundleRef.current;
      if (!b) return;
      apply(fn(structuredClone(b.edit)), [...pastRef.current.slice(-(HISTORY - 1)), b.edit], []);
    },
    [apply],
  );

  const undo = useCallback(() => {
    const b = bundleRef.current;
    const p = pastRef.current;
    if (!b || p.length === 0) return;
    apply(p[p.length - 1], p.slice(0, -1), [b.edit, ...futureRef.current]);
  }, [apply]);

  const redo = useCallback(() => {
    const b = bundleRef.current;
    const f = futureRef.current;
    if (!b || f.length === 0) return;
    apply(f[0], [...pastRef.current, b.edit], f.slice(1));
  }, [apply]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { bundle, setBundle, error, saving, update, sources, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
