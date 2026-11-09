import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Menú flotante de Tableros: se abre junto al botón que lo abrió, nunca se sale de la pantalla y
 * se cierra al tocar fuera, con Esc o al desplazar el tablero.
 */
export function Popover({
  anchor,
  onClose,
  width = 252,
  align = "end",
  label,
  children,
}: {
  anchor: DOMRect;
  onClose: () => void;
  width?: number;
  align?: "start" | "end";
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.min(
        Math.max(8, align === "end" ? anchor.right - width : anchor.left),
        vw - width - 8,
      );
      const below = anchor.bottom + 6;
      const y = below + h > vh - 8 ? Math.max(8, anchor.top - h - 6) : below;
      setPos((p) => (p && p.x === x && p.y === y ? p : { x, y }));
    };
    place();
    // Si el contenido cambia de alto (p. ej. al filtrar), se recoloca sin despegarse del botón.
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, width, align]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    const scroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const resize = () => close.current();
    const t = window.setTimeout(() =>
      document.addEventListener("pointerdown", down, true),
    );
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", resize);
    document.addEventListener("scroll", scroll, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", resize);
      document.removeEventListener("scroll", scroll, true);
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      className="bd-pop"
      role="menu"
      aria-label={label}
      style={{
        width,
        left: pos?.x ?? -9999,
        top: pos?.y ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Fila de un menú. */
export function MenuItem({
  icon,
  children,
  danger,
  disabled,
  hint,
  onClick,
}: {
  icon?: ReactNode;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={"bd-pop-item" + (danger ? " danger" : "")}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}
