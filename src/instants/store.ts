import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../backend';
import type { StoredImage } from '../data';
import { errorMessage } from '../lib/format';
import { LINK_KEYS, type Instant, type InstantLinks, type LinkKey } from './model';

const TABLE = 'instants';
const COLUMNS =
  'id,thread_id,pos,body,images,mood,happened_on,person_ids,entry_ids,episode_ids,place_ids,edited_at,created_at,updated_at';
export const INSTANTS_MIGRATION = 'supabase/migrations/202611120003_instants.sql';
export const instantsHint = `Para guardar tus instantes ejecuta ${INSTANTS_MIGRATION} en el SQL Editor de Supabase.`;
/** Lo que la base acepta en cada lista de vínculos. */
const CAPS: Record<LinkKey, number> = {
  entry_ids: 300,
  episode_ids: 40,
  person_ids: 80,
  place_ids: 40,
};
const PAGE = 500;
const MAX_LOADED = 6000;

type State = {
  /** null mientras no ha cargado la primera tanda. */
  list: Instant[] | null;
  /** Ya cargó todo (no solo la primera tanda). */
  complete: boolean;
  missing: boolean;
  error: string;
};

/**
 * Tus instantes: una sola copia en memoria para el panel, el bloque de Mi espacio, las fichas que
 * nacieron de ellos, la búsqueda y el saludo.
 */
let state: State = { list: null, complete: false, missing: false, error: '' };
const subs = new Set<() => void>();
let loading: Promise<void> | null = null;
/** Creados o borrados en esta sesión: una carga que ya iba en camino no los pierde ni los revive. */
const made = new Map<string, Instant>();
const gone = new Set<string>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const instantsState = () => state;

let owner: string | null = null;
supabase.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id ?? null;
  if (event === 'SIGNED_OUT' || (owner && next && next !== owner)) {
    loading = null;
    made.clear();
    gone.clear();
    set({ list: null, complete: false, missing: false, error: '' });
    if (next && subs.size) void loadInstants();
  }
  owner = next;
});

function isMissingTable(e: unknown) {
  const { code = '', message = '' } = (e ?? {}) as { code?: string; message?: string };
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (message.includes(TABLE) && /does not exist|schema cache|find the table/i.test(message))
  );
}

const ids = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const images = (v: unknown): StoredImage[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is StoredImage =>
          typeof x === 'object' && x !== null && typeof (x as StoredImage).url === 'string',
      )
    : [];

function toInstant(r: Record<string, unknown>): Instant {
  const created = String(r.created_at ?? '');
  return {
    id: String(r.id),
    thread_id: String(r.thread_id ?? r.id),
    pos: Number(r.pos) || 0,
    body: String(r.body ?? ''),
    images: images(r.images),
    mood: typeof r.mood === 'number' ? r.mood : null,
    happened_on: typeof r.happened_on === 'string' ? r.happened_on.slice(0, 10) : null,
    person_ids: ids(r.person_ids),
    entry_ids: ids(r.entry_ids),
    episode_ids: ids(r.episode_ids),
    place_ids: ids(r.place_ids),
    edited_at: typeof r.edited_at === 'string' ? r.edited_at : null,
    created_at: created,
    updated_at: String(r.updated_at ?? created),
  };
}

const byNewest = (a: Instant, b: Instant) => b.created_at.localeCompare(a.created_at);

/** Lo cargado más lo creado en esta sesión que la carga aún no traía, sin lo ya borrado. */
function merged(loaded: Instant[]) {
  const seen = new Set(loaded.map((i) => i.id));
  const extra = [...made.values()].filter((i) => !seen.has(i.id));
  return [...extra, ...loaded].filter((i) => !gone.has(i.id)).sort(byNewest);
}

/** Carga tus instantes por tandas (la primera se muestra en cuanto llega). */
export function loadInstants(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    const all: Instant[] = [];
    for (let from = 0; from < MAX_LOADED; from += PAGE) {
      const { data, error } = await supabase
        .from(TABLE)
        .select(COLUMNS)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) {
        if (isMissingTable(error)) set({ list: [], complete: true, missing: true, error: '' });
        else set({ list: state.list ?? merged(all), complete: true, error: errorMessage(error) });
        return;
      }
      const rows = (data ?? []).map((r) => toInstant(r as Record<string, unknown>));
      all.push(...rows);
      const done = rows.length < PAGE;
      set({ list: merged(all), complete: done, missing: false, error: '' });
      if (done) break;
    }
  })();
  return loading;
}

export type InstantDraft = {
  body: string;
  images: StoredImage[];
  mood: number | null;
  happened_on: string | null;
  person_ids: string[];
  place_ids: string[];
  episode_ids: string[];
};

const clip = (list: string[], key: LinkKey) => [...new Set(list)].slice(0, CAPS[key]);

/**
 * Publica uno o varios instantes (un hilo). Sin `threadId`, el primero abre un hilo nuevo; con él,
 * se suman al final de ese hilo. Devuelve los instantes creados o el error.
 */
export async function createInstants(
  drafts: InstantDraft[],
  threadId?: string,
): Promise<Instant[] | string> {
  if (state.missing) return instantsHint;
  if (!drafts.length) return 'No hay nada que publicar.';
  const now = Date.now();
  const thread = threadId ?? null;
  const startPos = thread
    ? Math.max(-1, ...(state.list ?? []).filter((i) => i.thread_id === thread).map((i) => i.pos)) + 1
    : 0;
  const rows: Instant[] = drafts.map((d, i) => {
    const id = crypto.randomUUID();
    // Unos milisegundos de diferencia: el orden del hilo se mantiene aunque se ordene por fecha.
    const at = new Date(now + i).toISOString();
    return {
      id,
      thread_id: '',
      pos: Math.min(200, startPos + i),
      body: d.body.slice(0, 8000),
      images: d.images.slice(0, 8),
      mood: d.mood,
      happened_on: d.happened_on,
      person_ids: clip(d.person_ids, 'person_ids'),
      entry_ids: [],
      episode_ids: clip(d.episode_ids, 'episode_ids'),
      place_ids: clip(d.place_ids, 'place_ids'),
      edited_at: null,
      created_at: at,
      updated_at: at,
    };
  });
  const root = thread ?? rows[0].id;
  for (const r of rows) r.thread_id = root;
  for (const r of rows) made.set(r.id, r);
  set({ list: [...rows, ...(state.list ?? [])].sort(byNewest) });
  const { error } = await supabase.from(TABLE).insert(
    rows.map((r) => ({
      id: r.id,
      thread_id: r.thread_id,
      pos: r.pos,
      body: r.body,
      images: r.images,
      mood: r.mood,
      happened_on: r.happened_on,
      person_ids: r.person_ids,
      episode_ids: r.episode_ids,
      place_ids: r.place_ids,
      created_at: r.created_at,
    })),
  );
  if (error) {
    const drop = new Set(rows.map((r) => r.id));
    for (const id of drop) made.delete(id);
    set({ list: (state.list ?? []).filter((i) => !drop.has(i.id)) });
    if (isMissingTable(error)) {
      set({ missing: true });
      return instantsHint;
    }
    return errorMessage(error);
  }
  return rows;
}

export type InstantChanges = Partial<
  Pick<Instant, 'body' | 'images' | 'mood' | 'happened_on'> & InstantLinks
>;

/**
 * Cambia un instante al momento y lo guarda detrás. `edited` marca que cambiaste lo que escribiste
 * (vincular algo no cuenta como editarlo).
 */
export async function updateInstant(
  id: string,
  changes: InstantChanges,
  edited = false,
): Promise<true | string> {
  const before = (state.list ?? []).find((i) => i.id === id);
  if (!before) return 'Ese instante ya no existe. Recarga la página.';
  const updated_at = new Date().toISOString();
  const fixed: InstantChanges = { ...changes };
  for (const k of LINK_KEYS) if (fixed[k]) fixed[k] = clip(fixed[k]!, k);
  if (fixed.body !== undefined) fixed.body = fixed.body.slice(0, 8000);
  if (fixed.images) fixed.images = fixed.images.slice(0, 8);
  const next: Instant = {
    ...before,
    ...fixed,
    ...(edited && { edited_at: updated_at }),
    updated_at,
  };
  const swap = (to: Instant) =>
    set({ list: (state.list ?? []).map((i) => (i.id === id ? to : i)) });
  swap(next);
  if (made.has(id)) made.set(id, next);
  const { error } = await supabase
    .from(TABLE)
    .update({ ...fixed, ...(edited && { edited_at: updated_at }), updated_at })
    .eq('id', id);
  if (error) {
    if ((state.list ?? []).find((i) => i.id === id)?.updated_at === updated_at) swap(before);
    return errorMessage(error);
  }
  return true;
}

/** Suma (y quita) vínculos a un instante sin tocar los demás. */
export function linkInstant(
  id: string,
  add: Partial<InstantLinks>,
  remove: Partial<InstantLinks> = {},
): Promise<true | string> {
  const cur = (state.list ?? []).find((i) => i.id === id);
  if (!cur) return Promise.resolve('Ese instante ya no existe.');
  const changes: InstantChanges = {};
  for (const k of LINK_KEYS) {
    const plus = (add[k] ?? []).filter(Boolean);
    const minus = new Set(remove[k] ?? []);
    if (!plus.length && !minus.size) continue;
    const next = [...new Set([...cur[k], ...plus])].filter((x) => !minus.has(x));
    if (next.length !== cur[k].length || next.some((x, i) => x !== cur[k][i])) changes[k] = next;
  }
  return Object.keys(changes).length ? updateInstant(id, changes) : Promise.resolve(true);
}

/** Borra instantes (devuelve los borrados, para «Deshacer»). */
export async function removeInstants(list: string[]): Promise<Instant[] | string> {
  const drop = new Set(list);
  const removed = (state.list ?? []).filter((i) => drop.has(i.id));
  if (!removed.length) return [];
  for (const id of drop) gone.add(id);
  set({ list: (state.list ?? []).filter((i) => !drop.has(i.id)) });
  const { error } = await supabase.from(TABLE).delete().in('id', [...drop]);
  if (error) {
    for (const id of drop) gone.delete(id);
    set({ list: [...removed, ...(state.list ?? [])].sort(byNewest) });
    return errorMessage(error);
  }
  return removed;
}

/** Vuelve a poner instantes borrados, con sus mismos ids. */
export async function restoreInstants(list: Instant[]): Promise<true | string> {
  if (!list.length) return true;
  for (const i of list) {
    gone.delete(i.id);
    made.set(i.id, i);
  }
  const keep = new Set(list.map((i) => i.id));
  set({ list: [...list, ...(state.list ?? []).filter((i) => !keep.has(i.id))].sort(byNewest) });
  const { error } = await supabase.from(TABLE).insert(
    list.map((i) => ({
      id: i.id,
      thread_id: i.thread_id,
      pos: i.pos,
      body: i.body,
      images: i.images,
      mood: i.mood,
      happened_on: i.happened_on,
      person_ids: i.person_ids,
      entry_ids: i.entry_ids,
      episode_ids: i.episode_ids,
      place_ids: i.place_ids,
      edited_at: i.edited_at,
      created_at: i.created_at,
    })),
  );
  if (error) {
    for (const i of list) made.delete(i.id);
    set({ list: (state.list ?? []).filter((i) => !keep.has(i.id)) });
    return errorMessage(error);
  }
  return true;
}

/** Tus instantes (se cargan la primera vez que alguien los pide). */
export function useInstants() {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!state.list && !loading) void loadInstants();
  }, []);
  return snap;
}

/** Los instantes de los que nació (o a los que se vinculó) algo: un recuerdo, un episodio… */
export function instantsWith(list: readonly Instant[] | null, key: LinkKey, id: string) {
  return (list ?? []).filter((i) => i[key].includes(id));
}
