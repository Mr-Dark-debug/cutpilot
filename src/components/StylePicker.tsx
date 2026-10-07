import {
  Camera,
  Check,
  ChefHat,
  ChevronDown,
  Dumbbell,
  Film,
  Gamepad2,
  GraduationCap,
  ListChecks,
  Megaphone,
  MessageSquareQuote,
  Mic,
  PackageOpen,
  Palette,
  Plane,
  Presentation,
  Search,
  Smartphone,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { Style } from "../lib/types";
import { Floating } from "./Floating";
import { clsx } from "./ui";

const ICONS: Record<string, LucideIcon> = {
  video: Video,
  camera: Camera,
  plane: Plane,
  "list-checks": ListChecks,
  "graduation-cap": GraduationCap,
  mic: Mic,
  smartphone: Smartphone,
  "package-open": PackageOpen,
  "gamepad-2": Gamepad2,
  "chef-hat": ChefHat,
  dumbbell: Dumbbell,
  presentation: Presentation,
  film: Film,
  "message-square-quote": MessageSquareQuote,
  megaphone: Megaphone,
};

const TINT: Record<string, string> = {
  violet: "bg-violet-500/12 text-violet-500",
  amber: "bg-amber-500/12 text-amber-500",
  sky: "bg-sky-500/12 text-sky-500",
  green: "bg-green-500/12 text-green-600",
  blue: "bg-blue-500/12 text-blue-500",
  slate: "bg-slate-500/12 text-slate-500",
  pink: "bg-pink-500/12 text-pink-500",
  orange: "bg-orange-500/12 text-orange-500",
  purple: "bg-purple-500/12 text-purple-500",
  red: "bg-red-500/12 text-red-500",
  emerald: "bg-emerald-500/12 text-emerald-600",
  indigo: "bg-indigo-500/12 text-indigo-500",
  teal: "bg-teal-500/12 text-teal-600",
  rose: "bg-rose-500/12 text-rose-500",
  yellow: "bg-yellow-500/15 text-yellow-600",
};

export function StyleIcon({ style, size = "md" }: { style?: Style; size?: "sm" | "md" }) {
  const Icon = ICONS[style?.icon ?? ""] ?? Palette;
  return (
    <span className={clsx("flex shrink-0 items-center justify-center rounded-lg", size === "sm" ? "size-5" : "size-8", TINT[style?.color ?? ""] ?? "bg-accent-soft text-accent-text")}>
      <Icon className={size === "sm" ? "size-3" : "size-4"} />
    </span>
  );
}

const ORDER = ["YouTube", "Short-form", "Learning", "Lifestyle", "Long-form", "My styles"];

export function StylePicker({ value, onChange, placement = "top" }: { value: string; onChange: (id: string) => void; placement?: "top" | "bottom" }) {
  const styles = useStore((s) => s.styles);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const current = styles.find((s) => s.id === value) ?? styles[0];
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = styles.filter((s) => !q || `${s.name} ${s.description} ${s.category}`.toLowerCase().includes(q));
    const map = new Map<string, Style[]>();
    for (const s of list) {
      const cat = s.builtin ? s.category || "YouTube" : "My styles";
      map.set(cat, [...(map.get(cat) ?? []), s]);
    }
    return [...map.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  }, [styles, query]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Editing style"
        className={clsx(
          "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium whitespace-nowrap text-text-2 transition-colors hover:bg-surface-3 hover:text-text",
          open && "bg-surface-3 text-text",
        )}
      >
        <StyleIcon style={current} size="sm" />
        <span className="max-w-[130px] truncate">{current?.name ?? "Style"}</span>
        <ChevronDown className="size-3 text-muted" />
      </button>
      {open && (
        <Floating anchor={ref} placement={placement} align={"left"} onClose={() => setOpen(false)}>
        <div className="fade-in w-[380px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <Search className="size-4 text-faint" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search styles…"
              className="h-6 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
            />
          </div>
          <div className="max-h-[360px] overflow-auto p-1.5">
            {groups.map(([cat, list]) => (
              <div key={cat} className="mb-1">
                <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{cat}</div>
                {list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      onChange(s.id);
                      setOpen(false);
                    }}
                    className={clsx("flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-surface-3", s.id === value && "bg-surface-2")}
                  >
                    <StyleIcon style={s} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{s.name}</span>
                      <span className="block truncate text-[11.5px] text-muted">{s.description}</span>
                    </span>
                    {s.id === value && <Check className="size-4 shrink-0 text-ok" />}
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-muted">No styles found.</div>}
          </div>
        </div>
        </Floating>
      )}
    </div>
  );
}
