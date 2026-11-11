import {
  isValidElement,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** Desde cuántas tarjetas a la vista una columna solo pinta las que se ven. */
export const VIRTUAL_AT = 60;
/** Lo mismo que `.bd-stack` en boards.css (gap y padding superior). */
const GAP = 8;
const PAD_TOP = 4;

/**
 * Las tarjetas de una columna. Con muchas (más de VIRTUAL_AT), solo se pintan las que se ven y un
 * margen: arriba y abajo quedan dos rellenos con la altura de las demás, así el desplazamiento,
 * el arrastre (que mide las tarjetas pintadas) y los vínculos siguen igual.
 */
export function ColumnStack({
  items,
  children,
  onDoubleClick,
}: {
  /** Tarjetas, divisores y el hueco del arrastre, cada uno con su key. */
  items: ReactNode[];
  /** Lo que va después de las tarjetas (el aviso de vacía, el campo para añadir). */
  children?: ReactNode;
  onDoubleClick: (e: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const virtual = items.length > VIRTUAL_AT;
  const keyOf = (i: number) => {
    const el = items[i];
    return isValidElement(el) && el.key != null ? String(el.key) : i;
  };
  const v = useVirtualizer({
    count: virtual ? items.length : 0,
    getScrollElement: () => ref.current,
    estimateSize: () => 78,
    overscan: 12,
    gap: GAP,
    paddingStart: PAD_TOP,
    getItemKey: keyOf,
  });

  if (!virtual)
    return (
      <div className="bd-stack" data-stack ref={ref} onDoubleClick={onDoubleClick}>
        {items}
        {children}
      </div>
    );

  const rows = v.getVirtualItems();
  const first = rows[0];
  const last = rows.at(-1);
  // El relleno ocupa el espacio de las tarjetas sin pintar (menos el gap que ya pone el CSS).
  const top = first && first.index > 0 ? Math.max(0, first.start - PAD_TOP - GAP) : 0;
  const bottom =
    last && last.index < items.length - 1 ? Math.max(0, v.getTotalSize() - last.end - GAP) : 0;
  return (
    <div className="bd-stack virtual" data-stack ref={ref} onDoubleClick={onDoubleClick}>
      {top > 0 && <div className="bd-vpad" style={{ height: top }} aria-hidden="true" />}
      {rows.map((r) => (
        <div key={r.key} className="bd-vrow" data-index={r.index} ref={v.measureElement}>
          {items[r.index]}
        </div>
      ))}
      {bottom > 0 && <div className="bd-vpad" style={{ height: bottom }} aria-hidden="true" />}
      {children}
    </div>
  );
}
