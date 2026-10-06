export function fmtTime(t: number, withFraction = false): string {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const base = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  if (!withFraction) return base;
  const cs = Math.floor((t % 1) * 10);
  return `${base}.${cs}`;
}

export function fmtDuration(t: number): string {
  if (!isFinite(t) || t <= 0) return "0s";
  if (t < 60) return `${Math.round(t)}s`;
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function timeAgo(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const diff = (Date.now() - d) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function stem(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, "");
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export const VIDEO_EXT = ["mp4", "mov", "mkv", "m4v", "avi", "webm", "mts", "m2ts", "mxf", "wmv", "3gp"];
export const AUDIO_EXT = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"];
export const IMAGE_EXT = ["jpg", "jpeg", "png", "webp"];

export function isVideo(path: string) {
  return VIDEO_EXT.includes(path.split(".").pop()?.toLowerCase() ?? "");
}
