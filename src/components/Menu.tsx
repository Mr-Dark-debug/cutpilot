import { ChevronRight, MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { Floating } from "./Floating";
import { clsx } from "./ui";

export interface MenuItem {
  label: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Nested items open in a side panel. */
  items?: MenuItem[];
  separator?: boolean;
}

function List({ items, close, depth }: { items: MenuItem[]; close: () => void; depth: number }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div className="min-w-[220px] rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <div key={i} className="relative" onMouseEnter={() => setSub(it.items ? i : null)}>
            <button
              type="button"
              disabled={it.disabled}
              onClick={() => {
                if (it.items) {
                  setSub(sub === i ? null : i);
                  return;
                }
                it.onSelect?.();
                close();
              }}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors disabled:opacity-40",
                it.danger ? "text-bad hover:bg-bad-soft" : "text-text-2 hover:bg-surface-3 hover:text-text",
                sub === i && "bg-surface-3 text-text",
              )}
            >
              {it.icon && <span className="flex size-4 items-center justify-center text-muted">{it.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint && <span className="text-[11.5px] text-faint">{it.hint}</span>}
              {it.items && <ChevronRight className="size-3.5 text-muted" />}
            </button>
            {it.items && sub === i && (
              <div className={clsx("absolute top-0 z-10", depth === 0 ? "right-full mr-1.5" : "right-full mr-1.5")}>
                <List items={it.items} close={close} depth={depth + 1} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

/** "⋯" button with a dropdown (submenus open to the left). */
export function Menu({ items, label = "More", align = "right", trigger }: { items: MenuItem[]; label?: string; align?: "left" | "right"; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={clsx("inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-text", open && "bg-surface-3 text-text")}
      >
        {trigger ?? <MoreHorizontal className="size-4" />}
      </button>
      {open && (
        <Floating anchor={ref} placement="bottom" align={align} onClose={() => setOpen(false)} className="fade-in">
          <List items={items} close={() => setOpen(false)} depth={0} />
        </Floating>
      )}
    </div>
  );
}
