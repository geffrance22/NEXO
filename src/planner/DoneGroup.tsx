import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, Check, ChevronRight, Trash2 } from "lucide-react";

/** Cuánto dura el pliegue (igual que en boards.css). */
const FOLD_MS = 220;
/** Cuántas se pintan de entrada (y cuántas más con cada «Ver más»). */
const STEP = 30;

/**
 * Las completadas de una columna, juntas abajo en un grupo que se despliega y se repliega. Desde
 * la cabecera se archivan o se eliminan todas. Las tarjetas solo se montan mientras está abierto,
 * así el arrastre y los vínculos no ven las que están plegadas.
 *
 * Ojo: las clases van con el prefijo `bd-dg`; `bd-done` es el círculo de cada tarjeta.
 */
export function DoneGroup({
  count,
  open,
  onToggle,
  onArchiveAll,
  onDeleteAll,
  cards,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  /** Sin la migración de archivar: no se ofrece. */
  onArchiveAll?: () => void;
  onDeleteAll: () => void;
  /** Las tarjetas ya pintadas, en orden (puede incluir el hueco del arrastre). */
  cards: ReactNode[];
}) {
  // Al plegar, el cuerpo sigue montado lo que dura la animación.
  const [mounted, setMounted] = useState(open);
  // Ya desplegado del todo: deja de recortar (sombras, foco y ganchos de las tarjetas).
  const [settled, setSettled] = useState(open);
  const [limit, setLimit] = useState(STEP);
  const timer = useRef(0);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      timer.current = window.setTimeout(() => setSettled(true), FOLD_MS);
    } else {
      setSettled(false);
      setLimit(STEP);
      timer.current = window.setTimeout(() => setMounted(false), FOLD_MS);
    }
    return () => window.clearTimeout(timer.current);
  }, [open]);

  const rest = cards.length - limit;
  return (
    <div
      className={"bd-dg" + (open ? " open" : "") + (settled ? " settled" : "")}
      data-done-group
    >
      <div className="bd-dg-head" data-nodrag>
        <button
          type="button"
          className="bd-dg-toggle"
          aria-expanded={open}
          title={open ? "Replegar las completadas" : "Ver las completadas"}
          onClick={onToggle}
        >
          <ChevronRight size={14} className="bd-dg-chev" />
          <span className="bd-dg-mark">
            <Check size={10} strokeWidth={3.2} />
          </span>
          <span className="bd-dg-label">Completadas</span>
          <span className="bd-dg-count">{count}</span>
        </button>
        <span className="bd-dg-actions">
          {onArchiveAll && (
            <button
              type="button"
              className="bd-dg-act"
              title="Archivar todas las completadas"
              aria-label="Archivar todas las completadas"
              onClick={onArchiveAll}
            >
              <Archive size={13} />
            </button>
          )}
          <button
            type="button"
            className="bd-dg-act danger"
            title="Eliminar todas las completadas"
            aria-label="Eliminar todas las completadas"
            onClick={onDeleteAll}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      <div className="bd-dg-body" aria-hidden={!open}>
        <div className="bd-dg-inner">
          {(open || mounted) && (
            <>
              {cards.slice(0, limit)}
              {rest > 0 && (
                <button
                  type="button"
                  className="bd-dg-more"
                  data-nodrag
                  onClick={() => setLimit((n) => n + STEP)}
                >
                  Ver {Math.min(rest, STEP)} más
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
