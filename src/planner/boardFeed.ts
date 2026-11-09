import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../backend';
import { todayInputValue } from '../lib/format';
import { nextDue } from './boardRepeat';
import { BOARDS_CHANGED, normalizeCard, type BoardCard, type CardChanges } from './boardStore';
import { isDivider } from './boardTheme';

/**
 * Las tarjetas de tus tableros (sin archivar ni de plantillas) para lo que vive fuera de Tableros:
 * la Agenda, la búsqueda global y el saludo de Mi espacio. Se carga una vez, se comparte y se
 * refresca solo cuando cambias algo en un tablero o vuelves a la pestaña.
 */
export type FeedCard = BoardCard & { board_id: string; board_name: string; list_name: string };
type State = { cards: FeedCard[]; ready: boolean };

let state: State = { cards: [], ready: false };
let loading = false;
let again = false;
let stale = true;
let loadedAt = 0;
let timer: number | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (next: State) => {
  state = next;
  emit();
};

export async function loadFeed() {
  if (loading) {
    again = true;
    return;
  }
  loading = true;
  stale = false;
  try {
    const all: FeedCard[] = [];
    let archivedFilter = true;
    for (let n = 0; n < 20000; n += 1000) {
      let q = supabase.from('planner_board_cards').select('*').order('id').range(n, n + 999);
      if (archivedFilter) q = q.is('archived_at', null);
      const { data, error } = await q;
      if (error && archivedFilter && n === 0) {
        // Sin la migración 014 no hay archivadas: se trae todo.
        archivedFilter = false;
        n -= 1000;
        continue;
      }
      if (error) throw error;
      all.push(
        ...((data ?? []) as FeedCard[])
          .filter((c) => !c.board_is_template && !isDivider(c.title))
          .map((c) => normalizeCard(c) as FeedCard),
      );
      if ((data ?? []).length < 1000) break;
    }
    loadedAt = Date.now();
    set({ cards: all, ready: true });
  } catch {
    // Sin tableros (o sin conexión): se sigue sin tarjetas.
    set({ ...state, ready: true });
  } finally {
    loading = false;
    if (again) {
      again = false;
      void loadFeed();
    }
  }
}

function scheduleReload() {
  stale = true;
  if (!subs.size) return;
  window.clearTimeout(timer);
  // En Tableros no hace falta: se recarga al salir (al abrir la Agenda o al buscar).
  if (document.querySelector('.bd')) return;
  // Muchos cambios seguidos: se espera a que paren.
  timer = window.setTimeout(() => void loadFeed(), 3000);
}
if (typeof window !== 'undefined') window.addEventListener(BOARDS_CHANGED, scheduleReload);
/** Recarga si algo cambió desde la última vez (p. ej., al enfocar la búsqueda). */
export const ensureFresh = () => {
  if (stale) void loadFeed();
};

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** Las tarjetas de tus tableros, compartidas. */
export function useBoardFeed() {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (stale || !state.ready) void loadFeed();
    const onFocus = () => Date.now() - loadedAt > 60_000 && void loadFeed();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  return snap;
}
/** Lo último cargado, sin suscribirse (para resolver un acceso directo). */
export const feedCard = (id: string) => state.cards.find((c) => c.id === id);

/** Las tarjetas de los tableros que elegiste para el saludo de Mi espacio. */
export const greetingCards = (cards: FeedCard[]) =>
  cards.filter((c) => c.board_settings?.greeting === true);

/** Una tarjeta abierta (sin completar ni pospuesta). */
export const isOpenCard = (c: BoardCard, today = todayInputValue()) =>
  !c.done && !(c.snoozed_until && c.snoozed_until > today);

// ───────────────────────── Cambios desde fuera de Tableros ─────────────────────────

/**
 * Cambios hechos fuera de Tableros (completar desde la Agenda o Mi espacio): las reglas de la
 * columna se aplican la próxima vez que abras ese tablero.
 */
const PENDING = 'nexo-board-pending-rules';
export type PendingTrigger = { card: string; list: string; trigger: 'done' | 'undone'; at: number };
export function queueTrigger(t: Omit<PendingTrigger, 'at'>) {
  try {
    // Solo cuenta lo último de cada tarjeta (completar y reabrir se anulan).
    const list = (JSON.parse(localStorage.getItem(PENDING) ?? '[]') as PendingTrigger[]).filter(
      (x) => x.card !== t.card,
    );
    list.push({ ...t, at: Date.now() });
    localStorage.setItem(PENDING, JSON.stringify(list.slice(-200)));
  } catch {
    /* sin almacenamiento: sin reglas pendientes */
  }
}
/** Al deshacer: la tarjeta ya no tiene nada pendiente. */
export function unqueueTrigger(card: string) {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING) ?? '[]') as PendingTrigger[];
    localStorage.setItem(PENDING, JSON.stringify(list.filter((x) => x.card !== card)));
  } catch {
    /* sin almacenamiento */
  }
}
/** Saca las pendientes de estas columnas (las de hace más de 30 días se descartan). */
export function takeTriggers(lists: Set<string>) {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING) ?? '[]') as PendingTrigger[];
    const fresh = list.filter((t) => Date.now() - t.at < 30 * 86_400_000);
    const mine = fresh.filter((t) => lists.has(t.list));
    localStorage.setItem(PENDING, JSON.stringify(fresh.filter((t) => !lists.has(t.list))));
    return mine;
  } catch {
    return [];
  }
}

async function update(id: string, changes: CardChanges) {
  const { error } = await supabase.from('board_cards').update(changes).eq('id', id);
  if (error) throw error;
  window.dispatchEvent(new Event(BOARDS_CHANGED));
}
/** Cambia una tarjeta al instante en todas partes y la guarda. */
export async function patchFeedCard(id: string, changes: CardChanges) {
  const before = state.cards;
  set({ ...state, cards: state.cards.map((c) => (c.id === id ? { ...c, ...changes } : c)) });
  try {
    await update(id, changes);
    return true;
  } catch {
    set({ ...state, cards: before });
    return false;
  }
}

/**
 * Completa una tarjeta desde fuera de Tableros. Si se repite, vuelve abierta con la fecha
 * siguiente. Devuelve cómo deshacerlo (o null si no se pudo).
 */
export async function completeFeedCard(card: FeedCard) {
  const before: CardChanges = {
    done: card.done,
    done_at: card.done_at,
    due: card.due,
    checks: card.checks,
  };
  const changes: CardChanges = card.repeat
    ? {
        due: nextDue(card.repeat, card.due) ?? card.due,
        done: false,
        done_at: null,
        checks: card.checks.map((x) => ({ ...x, done: false })),
      }
    : { done: true, done_at: new Date().toISOString() };
  const ok = await patchFeedCard(card.id, changes);
  if (!ok) return null;
  if (!card.repeat) queueTrigger({ card: card.id, list: card.list_id, trigger: 'done' });
  return {
    repeatsOn: card.repeat ? changes.due : undefined,
    undo: () => {
      unqueueTrigger(card.id);
      void patchFeedCard(card.id, before);
    },
  };
}
