import { useCallback, useState } from 'react';

/** Último tablero abierto. */
export const BOARD_LAST = 'nexo-board';
/** A dónde ir al abrir Tableros desde otra sección (una columna y, si se quiere, una tarjeta). */
export const BOARD_GO = 'nexo-board-go';
/** Deja preparado Tableros para abrir ese tablero, mostrar esa columna y abrir esa tarjeta. */
export function aimBoard(boardId: string, list: string, card?: string) {
  localStorage.setItem(BOARD_LAST, boardId);
  sessionStorage.setItem(BOARD_GO, JSON.stringify({ list, card }));
}

/**
 * Cómo dejaste el tablero a la vista: tarjetas con la lista o la descripción desplegadas y
 * columnas plegadas. Es preferencia de pantalla: se recuerda en este equipo.
 */
type View = {
  /** c: lista de verificación abierta; d: descripción abierta. */
  cards: Record<string, { c?: 1; d?: 1 }>;
  /** Columnas plegadas. */
  cols: Record<string, 1>;
};
const KEY = 'nexo-board-view';
const MAX = 4000;

function read(): View {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<View>;
    return { cards: v.cards ?? {}, cols: v.cols ?? {} };
  } catch {
    return { cards: {}, cols: {} };
  }
}

export function useBoardView() {
  const [view, setView] = useState<View>(read);
  const update = useCallback((fn: (v: View) => View) => {
    setView((prev) => {
      let next = fn(prev);
      // Sin crecer para siempre: se quedan las más recientes.
      const ids = Object.keys(next.cards);
      if (ids.length > MAX)
        next = {
          ...next,
          cards: Object.fromEntries(ids.slice(-MAX / 2).map((k) => [k, next.cards[k]])),
        };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const toggleCard = useCallback(
    (id: string, part: 'c' | 'd') =>
      update((v) => {
        const cur = { ...v.cards[id] };
        if (cur[part]) delete cur[part];
        else cur[part] = 1;
        const cards = { ...v.cards };
        if (cur.c || cur.d) cards[id] = cur;
        else delete cards[id];
        return { ...v, cards };
      }),
    [update],
  );
  const setFolded = useCallback(
    (ids: string[], on: boolean) =>
      update((v) => {
        const cols = { ...v.cols };
        for (const id of ids) {
          if (on) cols[id] = 1;
          else delete cols[id];
        }
        return { ...v, cols };
      }),
    [update],
  );

  return {
    open: (id: string) => ({
      checks: Boolean(view.cards[id]?.c),
      body: Boolean(view.cards[id]?.d),
    }),
    folded: (id: string) => Boolean(view.cols[id]),
    toggleCard,
    setFolded,
  };
}
