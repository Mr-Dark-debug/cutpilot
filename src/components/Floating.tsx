import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders a popover in a portal, positioned against its anchor with fixed
 * coordinates, so panels with overflow:hidden can't clip it. Closes on outside
 * click and Escape, and keeps itself inside the window.
 */
export function Floating({
  anchor,
  placement = "bottom",
  align = "left",
  onClose,
  children,
  className,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  placement?: "top" | "bottom";
  align?: "left" | "right";
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", visibility: "hidden", top: 0, left: 0 });

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === "left" ? a.left : a.right - w;
      left = Math.max(8, Math.min(left, vw - w - 8));
      let top = placement === "bottom" ? a.bottom + 8 : a.top - h - 8;
      // Flip when there's no room.
      if (placement === "bottom" && top + h > vh - 8 && a.top - h - 8 > 8) top = a.top - h - 8;
      if (placement === "top" && top < 8 && a.bottom + 8 + h < vh) top = a.bottom + 8;
      setStyle({ position: "fixed", top: Math.max(8, top), left, visibility: "visible" });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, placement, align]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", esc);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={ref} style={{ ...style, zIndex: 200 }} className={className}>
      {children}
    </div>,
    document.body,
  );
}
