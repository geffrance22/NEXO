import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { revealCaret } from "./caret";

type EditKind = "insert" | "delete" | "replace";

/** Pasos que se guardan como máximo. */
const LIMIT = 300;
/** Una pausa más larga que esta empieza un paso nuevo. */
const PAUSE = 1000;

/** Tramo que cambia entre dos textos: empieza en `start` y termina en `endA` (en a) y `endB` (en b). */
export function diff(a: string, b: string) {
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { start, endA, endB };
}

export type TextHistory = {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Cambio hecho por quien escribe: se agrupa con los anteriores si forma parte del mismo gesto. */
  change: (next: string) => void;
  /**
   * Textarea donde se recoloca el cursor al deshacer o rehacer. `toView` traduce una posición
   * del texto a la del textarea, si este no muestra el texto tal cual (p. ej. marcas invisibles).
   */
  attach: (
    el: HTMLTextAreaElement | null,
    toView?: (text: string, at: number) => number,
  ) => void;
  /** Olvida el historial y toma `text` como punto de partida (p. ej. al convertir en lista). */
  reset: (text: string) => void;
};

/**
 * Historial de deshacer y rehacer para un texto. Agrupa lo que se escribe por palabras, saltos de
 * línea y pausas; pegar, borrar una selección o aplicar una marca cuentan como un paso propio.
 * Si el texto cambia desde fuera (otra parte de la app), también queda como un paso.
 */
export function useTextHistory(
  value: string,
  onChange: (value: string) => void,
): TextHistory {
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const known = useRef(value);
  const last = useRef<{ kind: EditKind | null; at: number }>({
    kind: null,
    at: 0,
  });
  const el = useRef<HTMLTextAreaElement | null>(null);
  const toView = useRef<((text: string, at: number) => number) | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const emit = useRef(onChange);
  emit.current = onChange;
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });

  const sync = useCallback(() => {
    const canUndo = past.current.length > 0;
    const canRedo = future.current.length > 0;
    setFlags((f) =>
      f.canUndo === canUndo && f.canRedo === canRedo ? f : { canUndo, canRedo },
    );
  }, []);

  const push = (stack: string[], text: string) => {
    stack.push(text);
    if (stack.length > LIMIT) stack.shift();
  };

  // Cambios que no pasaron por aquí (p. ej. un borrador que se carga): también se pueden deshacer.
  useEffect(() => {
    if (value === known.current) return;
    push(past.current, known.current);
    future.current = [];
    known.current = value;
    last.current = { kind: null, at: 0 };
    sync();
  }, [value, sync]);

  // Tras deshacer o rehacer, el cursor vuelve a donde ocurrió el cambio y queda a la vista.
  useLayoutEffect(() => {
    const node = el.current;
    const at = pendingCaret.current;
    if (at === null) return;
    pendingCaret.current = null;
    if (!node) return;
    const pos = toView.current ? toView.current(known.current, at) : at;
    node.focus({ preventScroll: true });
    node.setSelectionRange(pos, pos);
    revealCaret(node, pos);
  }, [value]);

  const change = useCallback(
    (next: string) => {
      const prev = known.current;
      if (next === prev) return;
      const d = diff(prev, next);
      const inserted = next.slice(d.start, d.endB);
      const removed = d.endA - d.start;
      const kind: EditKind =
        removed === 0 ? "insert" : inserted ? "replace" : "delete";
      const now = Date.now();
      const single = inserted.length <= 1 && removed <= 1;
      // Empieza una palabra nueva después de un espacio.
      const newWord =
        kind === "insert" &&
        /^\S/.test(inserted) &&
        /\s$/.test(prev.slice(0, d.start));
      const fresh =
        kind !== last.current.kind ||
        now - last.current.at > PAUSE ||
        !single ||
        kind === "replace" ||
        inserted.includes("\n") ||
        newWord;
      if (fresh) push(past.current, prev);
      future.current = [];
      known.current = next;
      // Lo que se pega o se reemplaza no se mezcla con lo que venga después.
      last.current = {
        kind: single && kind !== "replace" ? kind : null,
        at: now,
      };
      sync();
      emit.current(next);
    },
    [sync],
  );

  const travel = useCallback(
    (from: string[], to: string[]) => {
      const target = from.pop();
      if (target === undefined) return;
      const current = known.current;
      push(to, current);
      known.current = target;
      last.current = { kind: null, at: 0 };
      pendingCaret.current = diff(current, target).endB;
      sync();
      emit.current(target);
    },
    [sync],
  );

  const undo = useCallback(
    () => travel(past.current, future.current),
    [travel],
  );
  const redo = useCallback(
    () => travel(future.current, past.current),
    [travel],
  );
  const attach = useCallback(
    (
      node: HTMLTextAreaElement | null,
      map?: (text: string, at: number) => number,
    ) => {
      el.current = node;
      toView.current = node ? (map ?? null) : null;
    },
    [],
  );
  const reset = useCallback(
    (text: string) => {
      past.current = [];
      future.current = [];
      known.current = text;
      last.current = { kind: null, at: 0 };
      sync();
    },
    [sync],
  );

  return useMemo(
    () => ({ ...flags, undo, redo, change, attach, reset }),
    [flags, undo, redo, change, attach, reset],
  );
}

/** Atajos según el sistema, para los títulos de los botones. */
export const historyKeys = /Mac|iPhone|iPad/.test(
  globalThis.navigator?.userAgent ?? "",
)
  ? { undo: "⌘Z", redo: "⇧⌘Z" }
  : { undo: "Ctrl+Z", redo: "Ctrl+Y" };
