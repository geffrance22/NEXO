import { useEffect, useSyncExternalStore } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../backend';

const TABLE = 'instant_shares';
const COLUMNS = 'instant_id,status,remote_ids,remote_url,note,shared_at,origin';
export const SHARES_MIGRATION = 'supabase/migrations/202611120005_instant_shares.sql';
/** De a cuántos se borran por llamada (la función admite hasta 20). */
const BATCH = 20;

/** A qué publicación del Fediverso corresponde un instante (si no hay fila, no se compartió). */
export type Share = {
  instant_id: string;
  /** 'posted': está publicado; 'error': no se pudo (`note` dice por qué). */
  status: 'posted' | 'error';
  remote_ids: string[];
  remote_url: string | null;
  note: string;
  shared_at: string | null;
  /** 'nexo': lo publicó Nexo. 'mastodon': nació allí y se trajo a Nexo. */
  origin: 'nexo' | 'mastodon';
};
/** Tu cuenta en el servidor, tal como la reporta la función. */
export type Account = { handle: string; url: string };

type State = {
  shares: ReadonlyMap<string, Share>;
  /** null: compartir no está disponible (sin configurar, otra persona, función sin desplegar). */
  account: Account | null;
  /** Ya se preguntó a la función. */
  checked: boolean;
  /** Falta la tabla (migración sin ejecutar). */
  missing: boolean;
};

const EMPTY: State = { shares: new Map(), account: null, checked: false, missing: false };
let state: State = EMPTY;
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
export const sharesState = () => state;

// Otra sesión, otra cuenta: se vuelve a preguntar.
let owner: string | null = null;
supabase.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id ?? null;
  if (event === 'SIGNED_OUT' || (owner && next && next !== owner)) {
    loading = null;
    set(EMPTY);
    if (next && subs.size) void loadFediverse();
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

const FALLBACK = 'No se pudo conectar con la función fediverse.';

/** Llama a la función; si responde con un error, lanza su mensaje real. */
async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('fediverse', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = (await error.context.json().catch(() => null)) as { error?: unknown } | null;
      if (typeof res?.error === 'string') throw new Error(res.error);
      if (error.context.status === 404)
        throw new Error('La función fediverse no está desplegada en tu proyecto de Supabase.');
    }
    throw new Error(FALLBACK);
  }
  return data as Record<string, unknown> | null;
}

/** Pregunta si compartir está disponible y trae lo ya compartido (una vez por sesión). */
export function loadFediverse(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    let account: Account | null = null;
    try {
      const data = await call({ action: 'status' });
      if (data?.enabled === true)
        account = { handle: String(data.handle ?? ''), url: String(data.url ?? '') };
    } catch {
      // Sin la función o sin configurar: no se ofrece compartir, y ya.
    }
    if (!account) return set({ account: null, checked: true });
    const { data, error } = await supabase
      .from(TABLE)
      .select(COLUMNS)
      .limit(5000);
    if (error) return set({ account, checked: true, missing: isMissingTable(error) });
    const shares = new Map((data as Share[]).map((s) => [s.instant_id, s]));
    set({ account, shares, checked: true, missing: false });
  })();
  return loading;
}

/** Vuelve a leer lo compartido (p. ej. tras traer posts de Mastodon). */
export async function refreshShares() {
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).limit(5000);
  if (!error) set({ shares: new Map((data as Share[]).map((s) => [s.instant_id, s])) });
}

export type Brought = { id: string; body: string };
export type ImportOutcome = {
  /** Instantes nuevos que nacieron en Mastodon. */
  imported: Brought[];
  /** Instantes cuyo texto se actualizó porque lo editaste allí. */
  updated: Brought[];
  error: string;
};

let importing: Promise<ImportOutcome> | null = null;

/**
 * Trae a Nexo lo que publicaste en Mastodon desde la última vez. Una sola revisión a la vez; si
 * otra acababa de correr (otra pestaña), no hace nada.
 */
export function importFromFediverse(): Promise<ImportOutcome> {
  if (importing) return importing;
  importing = (async (): Promise<ImportOutcome> => {
    try {
      const data = await call({ action: 'import' });
      const list = (v: unknown) => (Array.isArray(v) ? (v as Brought[]) : []);
      return {
        imported: list(data?.imported),
        updated: list(data?.updated),
        error: typeof data?.error === 'string' ? data.error : '',
      };
    } catch (e) {
      return { imported: [], updated: [], error: e instanceof Error ? e.message : FALLBACK };
    } finally {
      importing = null;
    }
  })();
  return importing;
}

/** Compartir: si está disponible y lo ya compartido. Se consulta la primera vez que alguien lo usa. */
export function useFediverse() {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!state.checked && !loading) void loadFediverse();
  }, []);
  return { ...snap, ready: Boolean(snap.account) && !snap.missing };
}

/**
 * Lo compartido de un instante. A diferencia de `useFediverse`, solo vuelve a pintar cuando eso
 * cambia: con cientos de instantes en el feed, un cambio en uno no repinta a los demás.
 */
export function useShare(id: string): Share | undefined {
  return useSyncExternalStore(subscribe, () => state.shares.get(id));
}

/** ¿Se puede compartir? Un solo booleano: tampoco repinta nada por lo demás. */
export function useCanShare(): boolean {
  const ok = useSyncExternalStore(subscribe, () => Boolean(state.account) && !state.missing);
  useEffect(() => {
    if (!state.checked && !loading) void loadFediverse();
  }, []);
  return ok;
}

type Item = {
  id: string;
  status: 'posted' | 'error' | 'removed';
  url: string | null;
  ids: string[];
  note: string;
};

/** Lo que la función ya guardó en la base, reflejado aquí al momento. */
function apply(items: Item[]) {
  const shares = new Map(state.shares);
  for (const r of items) {
    if (r.status === 'removed') shares.delete(r.id);
    else
      shares.set(r.id, {
        instant_id: r.id,
        status: r.status,
        remote_ids: r.ids,
        remote_url: r.url,
        note: r.note,
        shared_at: shares.get(r.id)?.shared_at ?? (r.status === 'posted' ? new Date().toISOString() : null),
        origin: shares.get(r.id)?.origin ?? 'nexo',
      });
  }
  set({ shares });
}

async function run(action: 'publish' | 'sync' | 'unpublish', ids: string[]): Promise<Item[]> {
  const data = await call({ action, ids });
  const items = Array.isArray(data?.results) ? (data.results as Item[]) : [];
  apply(items);
  return items;
}

export type ShareOutcome = {
  /** Cuántos quedaron publicados. */
  ok: number;
  /** La primera publicación, para abrirla. */
  url: string | null;
  /** Avisos que no impiden publicar (p. ej. una foto que no subió). */
  note: string;
  /** Vacío si todo salió bien. */
  error: string;
};

/**
 * Publica instantes en tu cuenta, de uno en uno y en orden (cada parte de un hilo responde a la
 * anterior). Se detiene en el primero que falla: lo que siga respondería a algo que no existe.
 */
export async function shareInstants(ids: string[]): Promise<ShareOutcome> {
  const out: ShareOutcome = { ok: 0, url: null, note: '', error: '' };
  for (const id of ids) {
    try {
      const [r] = await run('publish', [id]);
      if (r?.status !== 'posted') {
        out.error = r?.note || 'No se pudo compartir.';
        break;
      }
      out.ok++;
      out.url ??= r.url;
      out.note ||= r.note;
    } catch (e) {
      out.error = e instanceof Error ? e.message : FALLBACK;
      break;
    }
  }
  return out;
}

/** Pone la publicación al día con lo que editaste. Devuelve el motivo si falla ('' si salió bien). */
export async function resyncInstant(id: string): Promise<string> {
  try {
    const [r] = await run('sync', [id]);
    return r?.status === 'posted' ? '' : r?.note || 'No se pudo actualizar la publicación.';
  } catch (e) {
    return e instanceof Error ? e.message : FALLBACK;
  }
}

/** Quita estos instantes del Fediverso. Devuelve el motivo si falla ('' si salió bien). */
export async function unshareInstants(ids: string[]): Promise<string> {
  const todo = ids.filter((id) => state.shares.has(id));
  try {
    for (let i = 0; i < todo.length; i += BATCH) {
      const items = await run('unpublish', todo.slice(i, i + BATCH));
      const bad = items.find((r) => r.status === 'error');
      if (bad) return bad.note || 'No se pudo borrar la publicación.';
    }
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : FALLBACK;
  }
}

/** Abre la publicación en el servidor, en otra pestaña. */
export const openRemote = (url: string | null) => {
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
};
