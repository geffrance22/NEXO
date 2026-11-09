import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../backend';
import { errorMessage } from '../lib/format';
import {
  cleanItems,
  freeSpots,
  hasRef,
  isNotebookColor,
  refKey,
  type Notebook,
  type NotebookInput,
  type NotebookItem,
  type NotebookItemType,
} from './model';

const TABLE = 'agenda_notebooks';
const COLUMNS = 'id,name,description,color,items,created_at,updated_at';
export const NOTEBOOKS_MIGRATION = 'supabase/migrations/202611090006_agenda_notebooks.sql';

type State = { list: Notebook[] | null; missing: boolean; error: string };

/**
 * Los cuadernos se comparten entre Agenda y «Añadir a un cuaderno» (en la ficha de un recuerdo):
 * una sola copia en memoria, para que lo que añades desde una ficha aparezca ya en el lienzo.
 */
let state: State = { list: null, missing: false, error: '' };
const subs = new Set<() => void>();
let loading: Promise<void> | null = null;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

// Otra sesión, otros cuadernos (y se vuelven a pedir si alguien los está mirando).
let owner: string | null = null;
supabase.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id ?? null;
  if (event === 'SIGNED_OUT' || (owner && next && next !== owner)) {
    loading = null;
    set({ list: null, missing: false, error: '' });
    if (next && subs.size) void loadNotebooks();
  }
  owner = next;
});

function isMissingTable(e: unknown) {
  const { code = '', message = '' } = (e ?? {}) as {
    code?: string;
    message?: string;
  };
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (message.includes(TABLE) && /does not exist|schema cache|find the table/i.test(message))
  );
}

const toNotebook = (r: Record<string, unknown>): Notebook => ({
  id: String(r.id),
  name: String(r.name ?? ''),
  description: String(r.description ?? ''),
  color: isNotebookColor(r.color) ? r.color : 'salvia',
  items: cleanItems(r.items),
  created_at: String(r.created_at ?? ''),
  updated_at: String(r.updated_at ?? r.created_at ?? ''),
});

export function loadNotebooks(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await supabase
      .from(TABLE)
      .select(COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(300);
    if (error) {
      if (isMissingTable(error)) set({ list: [], missing: true, error: '' });
      else set({ list: state.list ?? [], error: errorMessage(error) });
      return;
    }
    set({ list: (data ?? []).map(toNotebook), missing: false, error: '' });
  })();
  return loading;
}

const replace = (nb: Notebook) =>
  set({ list: (state.list ?? []).map((n) => (n.id === nb.id ? nb : n)) });

export async function createNotebook(input: NotebookInput): Promise<Notebook | string> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      name: input.name.trim().slice(0, 100),
      description: input.description.trim().slice(0, 2000),
      color: input.color,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    if (isMissingTable(error)) set({ missing: true });
    return error ? errorMessage(error) : 'No se pudo crear el cuaderno.';
  }
  const nb = toNotebook(data);
  set({ list: [nb, ...(state.list ?? [])] });
  return nb;
}

/**
 * Cambia un cuaderno. Se ve al instante y se guarda detrás; si falla, vuelve a como estaba y
 * devuelve el motivo.
 */
export async function updateNotebook(
  id: string,
  changes: Partial<NotebookInput> & { items?: NotebookItem[] },
): Promise<true | string> {
  const before = state.list?.find((n) => n.id === id);
  if (!before) return 'Ese cuaderno ya no existe.';
  const updated_at = new Date().toISOString();
  replace({ ...before, ...changes, updated_at });
  const { error } = await supabase
    .from(TABLE)
    .update({ ...changes, updated_at })
    .eq('id', id);
  if (error) {
    const now = state.list?.find((n) => n.id === id);
    // Solo se deshace si nadie lo cambió entre tanto.
    if (now?.updated_at === updated_at) replace(before);
    return errorMessage(error);
  }
  return true;
}

export async function removeNotebook(id: string): Promise<true | string> {
  const before = state.list ?? [];
  set({ list: before.filter((n) => n.id !== id) });
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) {
    set({ list: before });
    return errorMessage(error);
  }
  return true;
}

/** Añade accesos directos a un cuaderno (los que ya estaban se omiten). Devuelve cuántos entraron. */
export async function addToNotebook(
  id: string,
  refs: { type: NotebookItemType; id: string }[],
  near?: { x: number; y: number },
  heights?: Map<string, number>,
): Promise<number | string> {
  const nb = state.list?.find((n) => n.id === id);
  if (!nb) return 'Ese cuaderno ya no existe.';
  const fresh = refs.filter(
    (r, i) =>
      !hasRef(nb, r.type, r.id) && refs.findIndex((o) => o.type === r.type && o.id === r.id) === i,
  );
  if (!fresh.length) return 0;
  const spots = freeSpots(nb.items, fresh.length, near, heights);
  const now = new Date().toISOString();
  const items = [
    ...nb.items,
    ...fresh.map((r, i) => ({
      key: refKey(r.type, r.id),
      type: r.type,
      id: r.id,
      x: spots[i]?.x ?? 0,
      y: spots[i]?.y ?? 0,
      added_at: now,
    })),
  ];
  const ok = await updateNotebook(id, { items });
  return ok === true ? fresh.length : ok;
}

/** Los cuadernos (se cargan la primera vez que alguien los pide). */
export function useCuadernos() {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!state.list) void loadNotebooks();
  }, []);
  return snap;
}
