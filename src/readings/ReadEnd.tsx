import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, X } from "lucide-react";

const when = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
  });
};

/**
 * Final del artículo: «Completado» con un chulito si ya lo leíste (al pasar el cursor, una X
 * para desmarcarlo) o «Marcar como leído» si no. Si bajas tú mismo hasta aquí en un artículo
 * largo, avisa con `onReachEnd` (el lector sugiere moverlo a Leídos).
 */
export function ReadEnd({
  readAt,
  onToggle,
  onReachEnd,
}: {
  readAt?: string | null;
  onToggle: (done: boolean) => void;
  onReachEnd?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = Boolean(readAt);
  // Animar el chulito solo cuando se completa ahora (no al abrir uno ya leído).
  const [fresh, setFresh] = useState(false);
  const live = useRef({ done, onReachEnd });
  live.current = { done, onReachEnd };

  useEffect(() => {
    const el = ref.current;
    const pane = el?.closest<HTMLElement>(".readings > main");
    if (!el || !pane) return;
    // Solo cuenta si lo desplazas tú (no al retomar la lectura donde ibas).
    let engaged = false;
    let reached = false;
    let frame = 0;
    const engage = () => {
      engaged = true;
    };
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!engaged || reached || live.current.done) return;
        // Artículos que caben en pantalla: lo marcas tú.
        if (pane.scrollHeight <= pane.clientHeight + 160) return;
        if (
          el.getBoundingClientRect().top <
          pane.getBoundingClientRect().bottom - 48
        ) {
          reached = true;
          live.current.onReachEnd?.();
        }
      });
    };
    const intents = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    intents.forEach((e) => pane.addEventListener(e, engage, { passive: true }));
    pane.addEventListener("scroll", check, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      intents.forEach((e) => pane.removeEventListener(e, engage));
      pane.removeEventListener("scroll", check);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={
        "rd-end" + (done ? " done" : "") + (fresh && done ? " fresh" : "")
      }
    >
      <button
        type="button"
        aria-pressed={done}
        title={done ? "Marcar como no leído" : "Marcar como leído"}
        onClick={() => {
          setFresh(!done);
          onToggle(!done);
        }}
      >
        <span className="rd-end-icon" aria-hidden="true">
          <Check className="rd-end-check" size={30} strokeWidth={2.4} />
          {done && <X className="rd-end-x" size={26} strokeWidth={2.2} />}
        </span>
        <span className="rd-end-label">
          {done ? "Completado" : "Marcar como leído"}
        </span>
        {done && readAt && <small>{when(readAt)}</small>}
      </button>
    </div>
  );
}

/**
 * Sugerencia flotante al terminar un artículo: «Mover a leídos» con un chulito o una X. Va fija
 * en la parte inferior del lector (no se desplaza con el texto).
 */
export function FinishPrompt({
  onYes,
  onNo,
}: {
  onYes: () => void;
  onNo: () => void;
}) {
  const live = useRef({ onYes, onNo });
  live.current = { onYes, onNo };
  // Enter acepta y Esc descarta, si no estás escribiendo en otra parte.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest?.(
          "input, textarea, select, button, a, [contenteditable]",
        )
      )
        return;
      if (
        document.querySelector(
          "dialog[open], .sheet-backdrop, .confirm-backdrop",
        )
      )
        return;
      if (window.getSelection()?.isCollapsed === false) return;
      if (e.key === "Escape") live.current.onNo();
      else if (e.key === "Enter") live.current.onYes();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div
      className="rd-finish"
      role="dialog"
      aria-label="Terminaste el artículo"
    >
      <div className="rd-finish-pill">
        <CheckCheck size={15} className="rd-finish-ico" aria-hidden="true" />
        <span>Mover a leídos</span>
        <button
          type="button"
          className="yes"
          title="Mover a leídos (Enter)"
          aria-label="Sí, mover a leídos"
          onClick={onYes}
        >
          <Check size={15} strokeWidth={2.6} />
        </button>
        <button
          type="button"
          className="no"
          title="Ahora no (Esc)"
          aria-label="Ahora no"
          onClick={onNo}
        >
          <X size={15} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
