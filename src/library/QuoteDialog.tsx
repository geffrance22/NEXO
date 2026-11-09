import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";

const FOCUSABLE = "button:not([disabled]),textarea";

/**
 * Escribir o pegar citas desde «Actualizar progreso». Solo los campos: al aceptar devuelve las
 * citas (sin las vacías) y la ventana de progreso las guarda junto con lo demás.
 */
export function QuoteDialog({
  initial,
  style,
  onDone,
  onCancel,
}: {
  initial: string[];
  /** Colores del libro (la ventana se pinta fuera de la de progreso). */
  style?: CSSProperties;
  onDone: (quotes: string[]) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState(() => [...initial, ""]);
  const box = useRef<HTMLDivElement>(null);
  const focusNext = useRef<number | null>(initial.length);

  const accept = () => onDone(items.map((q) => q.trim()).filter(Boolean));
  const doneRef = useRef(accept);
  doneRef.current = accept;

  // Esc cierra conservando lo escrito, sin cerrar también la ventana de progreso.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      doneRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (focusNext.current === null) return;
    const field = box.current?.querySelectorAll("textarea")[focusNext.current];
    focusNext.current = null;
    field?.focus();
  });

  const add = () => {
    focusNext.current = items.length;
    setItems((list) => [...list, ""]);
  };
  const remove = (i: number) => {
    focusNext.current = Math.max(0, i - 1);
    setItems((list) =>
      list.length > 1 ? list.filter((_, j) => j !== i) : [""],
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Que la ventana de progreso no reciba las teclas (su atajo de Tab, por ejemplo).
    e.stopPropagation();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      accept();
      return;
    }
    if (e.key !== "Tab" || !box.current) return;
    const all = Array.from(
      box.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    const first = all[0];
    const last = all[all.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const any = items.some((q) => q.trim());

  return createPortal(
    <div
      className="confirm-backdrop pq-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && accept()}
      onKeyDown={onKeyDown}
      onPaste={(e) => e.stopPropagation()}
    >
      <div
        ref={box}
        className="pq"
        role="dialog"
        aria-modal="true"
        aria-label="Añadir cita"
        style={style}
      >
        <div className="pq-list">
          {items.map((q, i) => (
            <div className="pq-item" key={i}>
              <textarea
                rows={3}
                maxLength={2000}
                placeholder={i ? "Otra cita…" : "Escribe o pega la cita…"}
                aria-label={`Cita ${i + 1}`}
                value={q}
                onChange={(e) =>
                  setItems((list) =>
                    list.map((x, j) => (j === i ? e.target.value : x)),
                  )
                }
              />
              {(items.length > 1 || q) && (
                <button
                  type="button"
                  className="pq-x"
                  aria-label="Quitar cita"
                  onClick={() => remove(i)}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <footer className="pq-foot">
          <button type="button" className="pq-more" onClick={add}>
            <Plus size={14} /> Otra cita
          </button>
          <span className="pg-sp" />
          <button type="button" className="pg-btn" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="pg-btn main"
            disabled={!any && !initial.length}
            onClick={accept}
          >
            Listo
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
