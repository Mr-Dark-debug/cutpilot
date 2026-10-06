import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { clsx } from "./ui";

/** Live log of a job: history from the backend, then lines streamed after it. */
export function JobLog({ jobId, className }: { jobId: string; className?: string }) {
  const live = useStore((s) => s.logs[jobId]);
  const [history, setHistory] = useState<string[] | null>(null);
  const [offset, setOffset] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api.jobLogs(jobId).then((l) => {
      if (!alive) return;
      setHistory(l);
      // Lines already streamed are part of the history snapshot.
      setOffset(useStore.getState().logs[jobId]?.length ?? 0);
    });
    return () => {
      alive = false;
    };
  }, [jobId]);

  const lines = history ? [...history, ...(live ?? []).slice(offset)] : (live ?? []);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div ref={ref} className={clsx("selectable overflow-auto bg-surface-2 px-4 py-3 font-mono text-[11.5px] leading-[1.7] text-text-2", className)}>
      {lines.length === 0 && <div className="text-faint">No output yet.</div>}
      {lines.map((l, i) => (
        <div key={i} className={clsx(l.includes("ERROR") && "text-bad", l.includes("▸") && "font-semibold text-text")}>
          {l}
        </div>
      ))}
    </div>
  );
}
