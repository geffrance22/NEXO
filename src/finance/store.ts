import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../backend';
import { setCustomMoneyCategories } from '../composer/logic';
import { errorMessage } from '../lib/format';
import {
  defaultSettings,
  finKinds,
  fixData,
  itemsOf,
  type FinData,
  type FinItem,
  type FinKind,
  type Settings,
} from './model';

const TABLE = 'finance_items';
const COLUMNS = 'id,kind,title,data,archived,created_at,updated_at';
export const FINANCE_MIGRATION = 'supabase/migrations/202611110001_finance.sql';

type State = { items: FinItem[] | null; missing: boolean; error: string };

/**
 * Lo propio de Finanzas (deudas, inversiones, cartas del mes, fijos, metas, deseos y ajustes):
 * una sola copia en memoria para la página, el formulario y la agenda.
 */
let state: State = { items: null, missing: false, error: '' };
const subs = new Set<() => void>();
let loading: Promise<void> | null = null;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  if (next.items) syncCategories(next.items);
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const financeState = () => state;

function syncCategories(items: FinItem[]) {
  const s = settingsOf(items);
  setCustomMoneyCategories([...s.extraOut, ...s.extraIn]);
}

let owner: string | null = null;
supabase.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id ?? null;
  if (event === 'SIGNED_OUT' || (owner && next && next !== owner)) {
    loading = null;
    set({ items: null, missing: false, error: '' });
    if (next && subs.size) void loadFinance();
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

function toItem(r: Record<string, unknown>): FinItem | null {
  const kind = r.kind as FinKind;
  if (!finKinds.includes(kind)) return null;
  return {
    id: String(r.id),
    kind,
    title: String(r.title ?? ''),
    data: fixData(kind, r.data),
    archived: r.archived === true,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? r.created_at ?? ''),
  } as FinItem;
}

export function loadFinance(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await supabase
      .from(TABLE)
      .select(COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(3000);
    if (error) {
      if (isMissingTable(error)) set({ items: [], missing: true, error: '' });
      else set({ items: state.items ?? [], error: errorMessage(error) });
      return;
    }
    set({
      items: (data ?? []).map(toItem).filter((x): x is FinItem => x !== null),
      missing: false,
      error: '',
    });
  })();
  return loading;
}

const missingText = `Falta preparar Finanzas: ejecuta ${FINANCE_MIGRATION} en el SQL Editor de Supabase.`;

export async function createItem<K extends FinKind>(
  kind: K,
  title: string,
  data: FinData[K],
  id: string = crypto.randomUUID(),
): Promise<FinItem<K> | string> {
  if (state.missing) return missingText;
  const now = new Date().toISOString();
  const item = {
    id,
    kind,
    title: title.trim().slice(0, 200),
    data,
    archived: false,
    created_at: now,
    updated_at: now,
  } as FinItem<K>;
  set({ items: [item as unknown as FinItem, ...(state.items ?? [])] });
  const { error } = await supabase
    .from(TABLE)
    .insert({ id, kind, title: item.title, data, archived: false });
  if (error) {
    set({ items: (state.items ?? []).filter((x) => x.id !== id) });
    if (isMissingTable(error)) {
      set({ missing: true });
      return missingText;
    }
    return errorMessage(error);
  }
  return item;
}

/** Cambia un elemento al instante y lo guarda detrás. Los datos se mezclan con los que había. */
export async function updateItem<K extends FinKind>(
  item: FinItem<K>,
  changes: { title?: string; data?: Partial<FinData[K]>; archived?: boolean },
): Promise<true | string> {
  const before = (state.items ?? []).find((x) => x.id === item.id) as FinItem<K> | undefined;
  if (!before) return 'Ya no existe. Recarga la página.';
  const updated_at = new Date().toISOString();
  const next = {
    ...before,
    ...(changes.title !== undefined && { title: changes.title.trim().slice(0, 200) }),
    ...(changes.archived !== undefined && { archived: changes.archived }),
    data: changes.data ? { ...before.data, ...changes.data } : before.data,
    updated_at,
  } as FinItem<K>;
  set({ items: (state.items ?? []).map((x) => (x.id === item.id ? (next as unknown as FinItem) : x)) });
  const { error } = await supabase
    .from(TABLE)
    .update({ title: next.title, data: next.data, archived: next.archived, updated_at })
    .eq('id', item.id);
  if (error) {
    const now = state.items?.find((x) => x.id === item.id);
    if (now?.updated_at === updated_at)
      set({
        items: (state.items ?? []).map((x) => (x.id === item.id ? (before as unknown as FinItem) : x)),
      });
    return errorMessage(error);
  }
  return true;
}

export async function removeItem(item: FinItem): Promise<true | string> {
  const before = state.items ?? [];
  set({ items: before.filter((x) => x.id !== item.id) });
  const { error } = await supabase.from(TABLE).delete().eq('id', item.id);
  if (error) {
    set({ items: before });
    return errorMessage(error);
  }
  return true;
}

/** Vuelve a poner un elemento borrado (Deshacer), con su mismo id. */
export async function restoreItem(item: FinItem): Promise<true | string> {
  set({ items: [item, ...(state.items ?? []).filter((x) => x.id !== item.id)] });
  const { error } = await supabase.from(TABLE).insert({
    id: item.id,
    kind: item.kind,
    title: item.title,
    data: item.data,
    archived: item.archived,
    created_at: item.created_at,
  });
  if (error) {
    set({ items: (state.items ?? []).filter((x) => x.id !== item.id) });
    return errorMessage(error);
  }
  return true;
}

export function settingsOf(items: readonly FinItem[] | null): Settings {
  return itemsOf(items, 'ajustes')[0]?.data ?? defaultSettings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<true | string> {
  const current = itemsOf(state.items, 'ajustes')[0];
  if (current) return updateItem(current, { data: patch });
  const made = await createItem('ajustes', 'Ajustes', { ...defaultSettings, ...patch });
  return typeof made === 'string' ? made : true;
}

/** Lo de Finanzas (se carga la primera vez que alguien lo pide). */
export function useFinance() {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!state.items) void loadFinance();
  }, []);
  return snap;
}
