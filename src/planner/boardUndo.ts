import { useCallback, useEffect, useRef, useState } from "react";
import type { Notify } from "../hooks/useToast";

/**
 * «Deshacer» de varios pasos en Tableros. Cada aviso con «Deshacer» queda apilado: Ctrl + Z (o
 * ⌘ + Z) deshace el último, y otra vez el anterior; desde el historial se puede volver varios
 * pasos atrás de una vez. Lo que depende de un plazo (borrar con sus pendientes) caduca con él.
 */
export type UndoStep = { id: number; label: string; at: number; run: () => void; until: number };

const MAX = 40;
/** Un paso común se puede deshacer durante 30 minutos. */
const LIFE = 30 * 60_000;
/** Borrar: mientras el pendiente que nació con la tarjeta no se haya eliminado (8,5 s). */
const SHORT = 8_000;
let seq = 0;

export function useUndoStack(base: Notify) {
  const [steps, setSteps] = useState<UndoStep[]>([]);
  const live = useRef(steps);
  live.current = steps;
  const put = (next: UndoStep[]) => {
    live.current = next;
    setSteps(next);
  };
  const alive = () => live.current.filter((s) => s.until > Date.now());
  const drop = (id: number) => put(live.current.filter((s) => s.id !== id));

  const notify = useCallback<Notify>(
    (text, action) => {
      if (!action || action.icon !== "undo") return base(text, action);
      const step: UndoStep = {
        id: ++seq,
        label: text.replace(/\s+/g, " ").slice(0, 140),
        at: Date.now(),
        run: action.run,
        until: Date.now() + (/eliminad/i.test(text) ? SHORT : LIFE),
      };
      put([...alive(), step].slice(-MAX));
      base(text, {
        ...action,
        run: () => {
          drop(step.id);
          action.run();
        },
      });
    },
    [base],
  );

  /** Deshace el último paso. */
  const undoLast = useCallback(() => {
    const list = alive();
    const step = list.at(-1);
    if (!step) {
      put(list);
      base("No hay nada más que deshacer.");
      return;
    }
    put(list.slice(0, -1));
    step.run();
    base(`Deshecho: ${step.label.replace(/\.$/, "")}.`);
  }, [base]);

  /** Deshace ese paso y todos los posteriores (del más nuevo al más viejo). */
  const undoTo = useCallback(
    (id: number) => {
      const list = alive();
      const at = list.findIndex((s) => s.id === id);
      if (at < 0) return;
      const undo = list.slice(at).reverse();
      put(list.slice(0, at));
      undo.forEach((s) => s.run());
      base(undo.length === 1 ? `Deshecho: ${undo[0].label}` : `${undo.length} pasos deshechos.`);
    },
    [base],
  );

  // Los que caducan se van solos.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (live.current.some((s) => s.until <= Date.now())) put(alive());
    }, 5_000);
    return () => window.clearInterval(t);
  }, []);

  return { notify, steps, undoLast, undoTo, clear: () => put([]) };
}
export type UndoApi = ReturnType<typeof useUndoStack>;
