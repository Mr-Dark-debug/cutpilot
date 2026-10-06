import clsx from "clsx";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

export { clsx };

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  loading,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-all duration-150 select-none",
        "disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-9 px-3.5 text-[13.5px]",
        size === "lg" && "h-11 px-5 text-[14.5px]",
        variant === "primary" &&
          "bg-text text-surface hover:opacity-90 active:scale-[0.98] shadow-card",
        variant === "secondary" &&
          "bg-surface border border-line text-text hover:bg-surface-2 hover:border-line-strong active:scale-[0.98] shadow-card",
        variant === "ghost" && "text-text-2 hover:bg-surface-3 hover:text-text",
        variant === "soft" && "bg-accent-soft text-accent-text hover:brightness-95 dark:hover:brightness-110",
        variant === "danger" && "bg-bad-soft text-bad hover:brightness-95",
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  className,
  label,
  children,
  active,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={clsx(
        "inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-40",
        active && "bg-surface-3 text-text",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={clsx("rounded-2xl border border-line bg-surface shadow-card", className)}>
      {children}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "accent" | "ok" | "warn" | "bad";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-surface-3 text-text-2",
        tone === "accent" && "bg-accent-soft text-accent-text",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "bad" && "bg-bad-soft text-bad",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={clsx(
        "h-9 w-full rounded-xl border border-line bg-surface px-3 text-[13.5px] text-text placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-3 focus:ring-accent/15",
        className,
      )}
    />
  );
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={clsx(
        "w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-text placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-3 focus:ring-accent/15",
        className,
      )}
    />
  );
}

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

/** Lightweight dropdown (native select is unstyleable in WebView2 dark mode). */
export function Select({
  value,
  options,
  onChange,
  className,
  icon,
  placeholder,
  compact,
  align = "left",
}: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  className?: string;
  icon?: React.ReactNode;
  placeholder?: string;
  compact?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className={clsx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "flex w-full items-center gap-2 rounded-xl border border-line bg-surface text-left text-[13.5px] text-text transition-colors hover:border-line-strong",
          compact ? "h-8 px-2.5 text-[13px]" : "h-9 px-3",
          open && "border-accent ring-3 ring-accent/15",
        )}
      >
        {icon && <span className="text-muted">{icon}</span>}
        <span className={clsx("flex-1 truncate", !current && "text-faint")}>{current?.label ?? placeholder ?? "Select…"}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
      </button>
      {open && (
        <div
          className={clsx(
            "fade-in absolute z-50 mt-1.5 max-h-80 min-w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-pop",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={clsx(
                "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-3",
                o.value === value && "bg-surface-2",
              )}
            >
              <span className="mt-0.5 size-3.5 shrink-0 text-accent">{o.value === value && <Check className="size-3.5" />}</span>
              <span className="min-w-0">
                <span className="block whitespace-nowrap text-text">{o.label}</span>
                {o.hint && <span className="block text-[12px] text-muted">{o.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span className={clsx("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = "md",
}: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={clsx("inline-flex rounded-xl bg-surface-3 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] font-medium whitespace-nowrap transition-all",
            size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3 text-[13px]",
            value === o.value ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, className, indeterminate }: { value: number; className?: string; indeterminate?: boolean }) {
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      {indeterminate ? (
        <div className="shimmer h-full w-full" />
      ) : (
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-300"
          style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
        />
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-4 animate-spin text-muted", className)} />;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-6 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className="fade-in flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold">{title}</div>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">{icon}</div>
      <div className="text-[15px] font-semibold">{title}</div>
      {children && <div className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <div className="mb-1.5 text-[12.5px] font-medium text-text-2">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-[12px] leading-relaxed text-muted">{hint}</div>}
    </label>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="text-[12px] font-semibold tracking-wide text-muted uppercase">{children}</div>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] text-muted">{children}</kbd>;
}

export const SEGMENT_COLORS = ["#6c5cf5", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#64748b"];

export function segColor(i: number) {
  return SEGMENT_COLORS[i % SEGMENT_COLORS.length];
}
