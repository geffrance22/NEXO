import { useRef, type PointerEvent as RPointerEvent } from "react";

/** Lo que no inicia el arrastre: botones, campos y cualquier cosa que se pueda tocar. */
export const INTERACTIVE =
  "button, a, input, select, textarea, summary, label, [data-nopan]";

type Pan = {
  id: number;
  x: number;
  y: number;
  left: number;
  top: number;
  /** El contenedor que se desplaza en vertical (si lo hay). */
  v: HTMLElement | null;
  moved: boolean;
};

/**
 * Desplazarse con clic sostenido, como en las columnas de un tablero: agarras el fondo y arrastras.
 * El contenedor se mueve en horizontal; en vertical se mueve él mismo (`"self"`), el ancestro más
 * cercano que coincida con un selector (la lista de una columna) o nada (`false`). En pantallas
 * táctiles no hace nada: ahí el dedo ya desplaza. Se reparte en el elemento con scroll:
 * `<div {...usePan()}>`.
 */
export function usePan({
  ignore = INTERACTIVE,
  vertical = "self",
}: { ignore?: string; vertical?: "self" | string | false } = {}) {
  const pan = useRef<Pan | null>(null);
  return {
    onPointerDown(e: RPointerEvent<HTMLElement>) {
      if (e.button !== 0 || e.pointerType === "touch") return;
      const target = e.target as HTMLElement;
      if (target.closest(ignore)) return;
      const el = e.currentTarget;
      const v =
        vertical === "self"
          ? el
          : vertical
            ? target.closest<HTMLElement>(vertical)
            : null;
      pan.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: el.scrollLeft,
        top: v?.scrollTop ?? 0,
        v,
        moved: false,
      };
      // Sin esto, arrastrar empieza a seleccionar texto en vez de desplazar.
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: RPointerEvent<HTMLElement>) {
      const p = pan.current;
      if (!p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.moved && Math.hypot(dx, dy) < 4) return;
      p.moved = true;
      e.currentTarget.classList.add("panning");
      e.currentTarget.scrollLeft = p.left - dx;
      if (p.v) p.v.scrollTop = p.top - dy;
    },
    onLostPointerCapture(e: RPointerEvent<HTMLElement>) {
      pan.current = null;
      e.currentTarget.classList.remove("panning");
    },
  };
}
