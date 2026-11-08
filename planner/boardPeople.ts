import type { Entry, EntryInput } from '../data';
import { todayInputValue } from '../lib/format';
import type { BoardCard } from './boardStore';

/**
 * Personas de una tarjeta. Viven en un pendiente de Nexo vinculado a la tarjeta: así la tarjeta
 * aparece en los Pendientes de cada persona, se completa con ella y se elimina con ella (no al
 * archivarla). Ese pendiente lleva la etiqueta «tablero» para saber que nació aquí.
 */
export const BOARD_TAG = 'tablero';

/** ¿Este pendiente lo creó el tablero (y por eso va y viene con la tarjeta)? */
export const isBoardEntry = (e?: Entry | null): boolean =>
  Boolean(e && e.kind === 'Pendiente' && e.tags.includes(BOARD_TAG));

/** Las personas de la tarjeta: las de su pendiente y la que tenía antes (una sola). */
export function cardPeople(card: Pick<BoardCard, 'entry_id' | 'person_id'>, entry?: Entry) {
  const ids = [...(entry?.person_ids ?? [])];
  if (card.person_id && !ids.includes(card.person_id)) ids.push(card.person_id);
  return ids;
}

/** El pendiente que se crea al añadir personas a una tarjeta. */
export function boardEntryInput(
  card: Pick<BoardCard, 'title' | 'body' | 'due'>,
  personIds: string[],
  done: boolean,
): EntryInput {
  return {
    title: card.title.slice(0, 180),
    body: card.body.slice(0, 4000),
    kind: 'Pendiente',
    tags: [BOARD_TAG],
    personIds,
    date: todayInputValue(),
    amount: 0,
    direction: 'egreso',
    status: done ? 'completado' : 'pendiente',
    images: [],
    details: { priority: 'media', ...(card.due && { due: card.due }) },
    file: null,
    removeFile: false,
  };
}
