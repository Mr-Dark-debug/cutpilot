import { AlertTriangle, Check, Copy, Lightbulb, SquarePlay } from "lucide-react";
import { useState } from "react";
import { Card } from "../../components/ui";
import { fmtTime } from "../../lib/format";
import type { Edit, Timeline } from "../../lib/types";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-surface-3 hover:text-text"
    >
      {done ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />} {done ? "Copied" : "Copy"}
    </button>
  );
}

export function chaptersText(timeline: Timeline) {
  return timeline.chapters.map((c) => `${fmtTime(c.start)} ${c.title}`).join("\n");
}

export function NotesPanel({ edit, timeline }: { edit: Edit; timeline: Timeline }) {
  const y = edit.youtube;
  const chapters = timeline.chapters.length >= 3 ? chaptersText(timeline) : "";
  const description = chapters ? `${y.description.trim()}\n\n${chapters}` : y.description.trim();
  const warnings = [...edit.warnings, ...timeline.warnings];
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-3">
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
            <Lightbulb className="size-4 text-accent" /> What the AI did
          </div>
          <p className="selectable text-[13px] leading-relaxed text-text-2">{edit.summary || "–"}</p>
          <div className="mt-2 text-[11.5px] text-faint">
            {edit.engine} · v{edit.version} · {edit.kind === "revision" ? `revision: “${edit.request}”` : edit.kind}
          </div>
        </Card>
        {edit.notes && (
          <Card className="border-warn/30 p-4">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <AlertTriangle className="size-4 text-warn" /> Check before publishing
            </div>
            <p className="selectable text-[13px] leading-relaxed whitespace-pre-wrap text-text-2">{edit.notes}</p>
          </Card>
        )}
        {warnings.length > 0 && (
          <Card className="p-4">
            <div className="mb-2 text-[13px] font-semibold">Adjustments CutPilot made</div>
            <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-muted">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
          <SquarePlay className="size-4 text-red-500" /> YouTube
        </div>
        <div className="space-y-4 text-[13px]">
          <div>
            <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-muted uppercase">Title options</div>
            {y.titles.map((t) => (
              <div key={t} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
                <span className="selectable">{t}</span>
                <CopyButton text={t} />
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">Description</span>
              <CopyButton text={description} />
            </div>
            <div className="selectable rounded-lg bg-surface-2 p-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-text-2">{description}</div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">Tags</span>
              <CopyButton text={y.tags.join(", ")} />
            </div>
            <div className="flex flex-wrap gap-1">
              {y.tags.map((t) => (
                <span key={t} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11.5px] text-text-2">
                  {t}
                </span>
              ))}
            </div>
          </div>
          {y.thumbnail_text && (
            <div>
              <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-muted uppercase">Thumbnail text</div>
              <div className="text-[15px] font-bold">{y.thumbnail_text}</div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
