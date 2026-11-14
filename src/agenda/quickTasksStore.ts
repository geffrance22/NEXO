import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../backend';
import { addDays, errorMessage, todayInputValue } from '../lib/format';

/*
 * Pendientes rápidos (Agenda → Pendientes → Abiertos): una lista corta para apuntar y tachar.
 * · Lo tachado se queda tachado el resto del día y se borra al siguiente.
 * · Lo que no tachaste sigue al día siguiente, al final de la lista y con la etiqueta de su día.
 * Se guardan en tu cuenta (tabla `quick_tasks`); sin esa migración, solo en este equipo, y suben
 * a tu cuenta en cuanto la ejecutes.
 */

export type QuickTask = {
  id: string;
  body: string;
  /** Cuándo lo tachaste (ISO); null: sin tachar. */
  done_at: string | null;
  created_at: string;
};

export const QUICK_MIGRATION = 'supabase/migrations/202611140001_quick_tasks.sql';
/** Caracteres por pendiente y pendientes en la lista. */
export const QUICK_MAX = 300;
export const QUICK_LIMIT = 200;
const TABLE = 'quick_tasks';
const COLUMNS = 'id,body,done_at,created_at';

type State = {
  list: QuickTask[] | null;
  /** Falta la migración: la lista vive en este equipo. */
  local: boolean;
  error: string;
};

let state: State = { list: null, local: false, error: '' };
const subs = new Set<() => void>();
let loading: Promise<void> | null = null;
let owner: string | null = null;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

supabase.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id ?? null;
  if (event === 'SIGNED_OUT' || (owner && next && next !== owner)) {
    loading = null;
    set({ list: null, local: false, error: '' });
    if (next && subs.size) void loadQuickTasks();
  }
  owner = next;
});

const isMissing = (e: { code?: string; message?: string }) =>
  e.code === '42P01' ||
  e.code === 'PGRST205' ||
  (/quick_tasks/.test(e.message ?? '') &&
    /does not exist|schema cache|find the table/i.test(e.message ?? ''));

/** El día (AAAA-MM-DD, en tu zona horaria) de una fecha ISO. */
export const dayOf = (iso: string) => todayInputValue(new Date(iso));
const time = (iso: string) => Date.parse(iso) || 0;
/** Por cuándo los apuntaste (las fechas del navegador y las de la base no se escriben igual). */
const sorted = (list: QuickTask[]) =>
  [...list].sort((a, b) => time(a.created_at) - time(b.created_at));
const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, QUICK_MAX);
const rowOf = (t: QuickTask) => ({
  id: t.id,
  body: t.body,
  done_at: t.done_at,
  created_at: t.created_at,
});
const toTask = (r: Record<string, unknown>): QuickTask => ({
  id: String(r.id),
  body: String(r.body ?? ''),
  done_at: typeof r.done_at === 'string' ? r.done_at : null,
  created_at: String(r.created_at ?? new Date().toISOString()),
});

/* ───────── En este equipo (mientras falte la migración) ───────── */
const localKey = () => `nexo-quick-tasks:${owner ?? 'anon'}`;
function readLocal(): QuickTask[] {
  try {
    const raw = JSON.parse(localStorage.getItem(localKey()) ?? '[]');
    return Array.isArray(raw)
      ? raw
          .filter((r) => r && typeof r.id === 'string' && typeof r.body === 'string')
          .map(toTask)
      : [];
  } catch {
    return [];
  }
}
function writeLocal(list: QuickTask[]) {
  try {
    if (list.length) localStorage.setItem(localKey(), JSON.stringify(list));
    else localStorage.removeItem(localKey());
  } catch {
    /* Sin almacenamiento: dura mientras sigas en la página. */
  }
}

/** Guarda en tu cuenta (o en este equipo). Devuelve el error o ''. */
async function persist(run: () => PromiseLike<{ error: unknown }>) {
  if (state.local) {
    writeLocal(state.list ?? []);
    return '';
  }
  const { error } = await run();
  return error ? errorMessage(error) : '';
}
const update = (id: string, fields: Partial<QuickTask>) =>
  set({ list: (state.list ?? []).map((t) => (t.id === id ? { ...t, ...fields } : t)) });

export function loadQuickTasks(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    const { data: auth } = await supabase.auth.getSession();
    owner = auth.session?.user.id ?? owner;
    const { data, error } = await supabase
      .from(TABLE)
      .select(COLUMNS)
      .order('created_at')
      .limit(500);
    if (error) {
      if (isMissing(error)) {
        set({ list: sorted(readLocal()), local: true, error: '' });
        void sweepQuickTasks();
      } else {
        loading = null;
        set({ list: state.list ?? [], error: errorMessage(error) });
      }
      return;
    }
    let list = sorted((data ?? []).map(toTask));
    // Lo que apuntaste antes de la migración, en este equipo, sube a tu cuenta.
    const before = readLocal().filter((t) => !list.some((x) => x.id === t.id));
    if (before.length) {
      const { error: up } = await supabase.from(TABLE).insert(before.map(rowOf));
      if (!up) {
        list = sorted([...list, ...before]);
        writeLocal([]);
      }
    } else writeLocal([]);
    set({ list, local: false, error: '' });
    void sweepQuickTasks();
  })();
  return loading;
}

/** Lo que tachaste antes de hoy ya cumplió: se borra. */
export async function sweepQuickTasks(today = todayInputValue()) {
  const list = state.list;
  if (!list) return;
  const old = list.filter((t) => t.done_at && dayOf(t.done_at) < today);
  if (!old.length) return;
  const ids = new Set(old.map((t) => t.id));
  set({ list: list.filter((t) => !ids.has(t.id)) });
  // Si falla, se vuelve a intentar la próxima vez que se cargue la lista.
  await persist(() => supabase.from(TABLE).delete().in('id', [...ids]));
}

export async function addQuickTask(body: string) {
  const text = clean(body);
  if (!text) return '';
  const list = state.list ?? [];
  if (list.length >= QUICK_LIMIT) return 'La lista está llena: tacha o borra algunos.';
  const task: QuickTask = {
    id: crypto.randomUUID(),
    body: text,
    done_at: null,
    created_at: new Date().toISOString(),
  };
  set({ list: [...list, task] });
  const err = await persist(() => supabase.from(TABLE).insert(rowOf(task)));
  if (err) set({ list: (state.list ?? []).filter((t) => t.id !== task.id) });
  return err;
}

async function patch(task: QuickTask, fields: Pick<Partial<QuickTask>, 'body' | 'done_at'>) {
  const before = state.list?.find((t) => t.id === task.id);
  if (!before) return '';
  update(task.id, fields);
  const err = await persist(() => supabase.from(TABLE).update(fields).eq('id', task.id));
  if (err) update(task.id, { body: before.body, done_at: before.done_at });
  return err;
}

/** Tacharlo (o quitarle la tachadura). */
export const toggleQuickTask = (task: QuickTask) =>
  patch(task, { done_at: task.done_at ? null : new Date().toISOString() });

export const editQuickTask = (task: QuickTask, body: string) => {
  const text = clean(body);
  return text && text !== task.body ? patch(task, { body: text }) : Promise.resolve('');
};

export async function removeQuickTask(task: QuickTask) {
  set({ list: (state.list ?? []).filter((t) => t.id !== task.id) });
  const err = await persist(() => supabase.from(TABLE).delete().eq('id', task.id));
  if (err) set({ list: sorted([...(state.list ?? []), task]) });
  return err;
}

/** Deshace un borrado: vuelve a su lugar, con su día y su tachadura. */
export async function restoreQuickTask(task: QuickTask) {
  if (state.list?.some((t) => t.id === task.id)) return '';
  set({ list: sorted([...(state.list ?? []), task]) });
  const err = await persist(() => supabase.from(TABLE).insert(rowOf(task)));
  if (err) set({ list: (state.list ?? []).filter((t) => t.id !== task.id) });
  return err;
}

/**
 * Cómo se ve la lista hoy: primero lo de hoy (en el orden en que lo apuntaste) y, al final, lo
 * que viene de días anteriores (de ayer hacia atrás). Lo tachado antes de hoy ya no sale.
 */
export function arrangeQuickTasks(list: QuickTask[], today: string) {
  const live = list.filter((t) => !(t.done_at && dayOf(t.done_at) < today));
  const fresh = live.filter((t) => dayOf(t.created_at) >= today);
  const carried = live
    .filter((t) => dayOf(t.created_at) < today)
    .sort(
      (a, b) =>
        dayOf(b.created_at).localeCompare(dayOf(a.created_at)) ||
        time(a.created_at) - time(b.created_at),
    );
  return { fresh, carried };
}

const dateOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};
/** Desde cuántos días lo arrastras (0: es de hoy). */
export const ageOf = (day: string, today: string) =>
  Math.max(0, Math.round((dateOf(today).getTime() - dateOf(day).getTime()) / 864e5));
/** Desde aquí, un pendiente rápido sin tachar «se arrastra»: se avisa y se ofrece pasarlo. */
export const STALE_DAYS = 3;
/** La etiqueta de un pendiente de otro día: «ayer», «jue» (esta semana) o «12 nov». */
export function dayTag(day: string, today: string) {
  const date = dateOf(day);
  const long =
    'Del ' + date.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  if (day === addDays(today, -1)) return { short: 'ayer', long: 'De ayer' };
  const days = ageOf(day, today);
  const short =
    days <= 6
      ? date.toLocaleDateString('es-CO', { weekday: 'short' })
      : date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  return { short: short.replace('.', '').replace(' de ', ' '), long };
}

/** La lista (se carga la primera vez que alguien la pide). */
export function useQuickTasks() {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!state.list) void loadQuickTasks();
  }, []);
  return snap;
}
