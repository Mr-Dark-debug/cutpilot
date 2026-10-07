// Client-side copy of the backend's timeline layout (src-tauri/src/edit.rs::timeline),
// so trims and drags render instantly; the backend recomputes after each save.
import type { Asset, Edit } from "./types";

export interface LClip {
  id: string;
  index: number;
  source: string;
  segment: number;
  srcIn: number;
  srcOut: number;
  start: number;
  end: number;
}

export interface LItem {
  id: string;
  start: number;
  end: number;
  label: string;
  asset?: Asset | null;
  kind?: string;
}

export interface Layout {
  fps: number;
  duration: number;
  clips: LClip[];
  broll: LItem[];
  titles: LItem[];
}

export function computeLayout(edit: Edit, fps: number): Layout {
  const f = (t: number) => Math.round(t * fps);
  const s = (fr: number) => fr / fps;
  const clips: LClip[] = [];
  let cursor = 0;
  edit.clips.forEach((c, index) => {
    if (!c.enabled) return;
    const fin = f(c.start);
    const len = f(c.end) - fin;
    if (len < 2) return;
    clips.push({ id: c.id, index, source: c.source, segment: c.segment, srcIn: s(fin), srcOut: s(fin + len), start: s(cursor), end: s(cursor + len) });
    cursor += len;
  });
  const duration = s(cursor);
  const place = (source: string, t: number): number | null => {
    const inside = clips.find((c) => c.source === source && t >= c.srcIn - 1e-6 && t < c.srcOut);
    if (inside) return inside.start + (t - inside.srcIn);
    const next = clips.find((c) => c.source === source && c.srcIn > t && c.srcIn - t < 3);
    return next ? next.start : null;
  };
  const broll: LItem[] = [];
  for (const b of edit.broll) {
    if (!b.enabled) continue;
    const p = place(b.source, b.anchor);
    if (p === null) continue;
    const st = s(f(p));
    broll.push({ id: b.id, start: st, end: s(f(Math.min(st + b.duration, duration))), label: b.query, asset: b.asset });
  }
  broll.sort((a, b) => a.start - b.start);
  let last = 0;
  for (const b of broll) {
    if (b.start < last) b.start = last;
    if (b.end > last) last = b.end;
  }
  const titles: LItem[] = [];
  for (const t of edit.titles) {
    if (!t.enabled) continue;
    const p = place(t.source, t.anchor);
    if (p === null) continue;
    const st = s(f(p));
    titles.push({ id: t.id, start: st, end: s(f(Math.min(st + t.duration, duration))), label: t.text, kind: t.kind });
  }
  return { fps, duration, clips, broll: broll.filter((b) => b.end - b.start >= 0.75), titles };
}

/** Timeline time → the source moment shown there. */
export function toSource(layout: Layout, t: number): { source: string; time: number } | null {
  const c = layout.clips.find((x) => t >= x.start && t < x.end) ?? (t >= layout.duration ? layout.clips[layout.clips.length - 1] : undefined);
  if (!c) return null;
  return { source: c.source, time: c.srcIn + Math.min(t, c.end) - c.start };
}

export function timecode(t: number, fps: number): string {
  const total = Math.max(0, Math.round(t * fps));
  const fr = Math.round(fps);
  const ff = total % fr;
  const secs = Math.floor(total / fr);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const sec = secs % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(sec)}:${p(ff)}`;
}

export function nextId(prefix: string, ids: string[]) {
  return `${prefix}${Math.max(0, ...ids.map((i) => Number(i.replace(/\D/g, "")) || 0)) + 1}`;
}
