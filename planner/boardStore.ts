import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../backend';
import type { Notify } from '../hooks/useToast';
import { isRepeat, parseRepeat, type Repeat } from './boardRepeat';
import type { Card, Check } from './shared';

/**
 * Datos de Tableros. Todo cambia al instante en pantalla y se guarda de fondo. Los ids se crean
 * aquí, así una tarjeta nueva ya tiene su id definitivo; las escrituras de una misma fila (o de
 * una tarjeta en una columna recién creada) se encadenan para llegar en orden.
 */

export type Board = {
  id: string;
  name: string;
  background: string;
  created_at: string;
  /** Plantilla tuya (migración 016): se edita como un tablero, pero no sale en la lista. */
  is_template?: boolean;
  description?: string;
};
export type Column = { id: string; board_id: string; name: string; rank: number; color: string };
export type BoardCard = Card & {
  done: boolean;
  done_at: string | null;
  archived_at: string | null;
  color: string;
  /** Se repite al completarla (migración 016). */
  repeat: Repeat;
  created_at?: string;
  /** Solo en la vista (Archivados). */
  board_id?: string;
  list_name?: string;
  board_name?: string;
  board_is_template?: boolean;
};
export type CardChanges = Partial<
  Pick<
    BoardCard,
    | 'title'
    | 'body'
    | 'tags'
    | 'checks'
    | 'due'
    | 'list_id'
    | 'rank'
    | 'done'
    | 'done_at'
    | 'archived_at'
    | 'color'
    | 'repeat'
    | 'entry_id'
    | 'person_id'
    | 'episode_id'
    | 'reading_id'
    | 'note_id'
  >
>;

/** Una tarjeta nueva: solo el título o también su descripción. */
export type NewCardInput = string | { title: string; body?: string };

export const BOARD_SQL = 'supabase/migrations/202611070014_board_extras.sql';
export const TEMPLATE_SQL = 'supabase/migrations/202611070016_board_templates.sql';
/** Campos de la migración 014: sin ella no se guardan. */
const EXTRA = new Set(['done', 'done_at', 'archived_at', 'color', 'background', 'created_at']);
/** Falta la migración 016 (repetir y plantillas). Se mira antes que la 014. */
const isMissing016 = (e: { message?: string }) =>
  /\brepeat\b|is_template|description|board_is_template/.test(e.message ?? '');
const isMissing = (e: { code?: string; message?: string }) =>
  !isMissing016(e) &&
  (e.code === '42703' ||
    e.code === 'PGRST204' ||
    /archived_at|done_at|\bdone\b|background|\bcolor\b|list_name|board_name/.test(e.message ?? ''));
const missing016Text = `Para repetir tarjetas y usar plantillas ejecuta ${TEMPLATE_SQL} en el SQL Editor de Supabase.`;

// ───────────────────────── Cola de escrituras ─────────────────────────

const queue = new Map<string, Promise<unknown>>();
/** Ejecuta `fn` cuando terminen las escrituras anteriores de esas filas. */
function enqueue<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
  const before = Promise.all(ids.map((id) => (queue.get(id) ?? Promise.resolve()).catch(() => {})));
  const p = before.then(fn);
  for (const id of ids) queue.set(id, p);
  p.then(
    () => ids.forEach((id) => queue.get(id) === p && queue.delete(id)),
    () => ids.forEach((id) => queue.get(id) === p && queue.delete(id)),
  );
  return p;
}
async function check<T extends { error: { code?: string; message: string } | null }>(
  req: PromiseLike<T>,
) {
  const res = await req;
  if (res.error) throw res.error;
  return res;
}

// ───────────────────────── Orden ─────────────────────────

/** Rango para quedar en la posición `index` de una lista ya ordenada (sin el elemento). */
export function rankAt(ranks: number[], index: number) {
  if (!ranks.length) return 1024;
  if (index <= 0) return ranks[0] - 1024;
  if (index >= ranks.length) return ranks[ranks.length - 1] + 1024;
  return (ranks[index - 1] + ranks[index]) / 2;
}
/** ¿Hay rangos repetidos o demasiado juntos? Entonces hay que renumerar. */
const crowded = (ranks: number[]) => ranks.some((r, i) => i > 0 && r - ranks[i - 1] < 1e-6);
export const byRank = <T extends { rank: number; id: string }>(a: T, b: T) =>
  a.rank - b.rank || a.id.localeCompare(b.id);

/** Fila de `board_cards` (sin los campos de la vista). */
function cardRow(c: BoardCard, extras: boolean) {
  const row: Record<string, unknown> = {
    id: c.id,
    list_id: c.list_id,
    title: c.title,
    body: c.body,
    rank: c.rank,
    tags: c.tags,
    checks: c.checks,
    due: c.due,
    entry_id: c.entry_id,
    note_id: c.note_id,
    episode_id: c.episode_id,
    person_id: c.person_id,
    reading_id: c.reading_id,
  };
  if (extras)
    Object.assign(row, {
      done: c.done,
      done_at: c.done_at,
      archived_at: c.archived_at,
      color: c.color,
      ...(c.created_at && { created_at: c.created_at }),
    });
  if (c.repeat) row.repeat = c.repeat;
  return row;
}
const normalizeCard = (c: Partial<BoardCard> & Card): BoardCard => ({
  ...c,
  tags: c.tags ?? [],
  checks: Array.isArray(c.checks) ? (c.checks as Check[]) : [],
  done: Boolean(c.done),
  done_at: c.done_at ?? null,
  archived_at: c.archived_at ?? null,
  color: c.color ?? '',
  repeat: isRepeat(c.repeat) ? c.repeat : '',
});

// ───────────────────────── Copiar tableros (plantillas) ─────────────────────────

/** Un tablero descrito por su contenido: lo que se copia de una plantilla. */
export type SpecCard = {
  title: string;
  body?: string;
  tags?: string[];
  checks?: string[];
  color?: string;
  repeat?: Repeat;
};
export type SpecColumn = { name: string; color?: string; cards: SpecCard[] };
export type BoardSpec = { background?: string; columns: SpecColumn[] };

/** El contenido de un tablero (columnas y tarjetas sin archivar), sin fechas ni vínculos. */
export async function snapshotBoard(boardId: string): Promise<BoardSpec> {
  const [b, l] = await Promise.all([
    supabase.from('boards').select('*').eq('id', boardId).single(),
    supabase.from('board_lists').select('*').eq('board_id', boardId).order('rank').order('id'),
  ]);
  if (b.error) throw b.error;
  if (l.error) throw l.error;
  let c = await supabase
    .from('planner_board_cards')
    .select('*')
    .eq('board_id', boardId)
    .is('archived_at', null)
    .order('rank')
    .order('id')
    .limit(5000);
  if (c.error)
    c = await supabase
      .from('planner_board_cards')
      .select('*')
      .eq('board_id', boardId)
      .order('rank')
      .limit(5000);
  if (c.error) throw c.error;
  const cards = ((c.data ?? []) as BoardCard[]).map(normalizeCard);
  return {
    background: (b.data as Board).background ?? '',
    columns: ((l.data ?? []) as Column[]).map((col) => ({
      name: col.name,
      color: col.color ?? '',
      cards: cards
        .filter((x) => x.list_id === col.id)
        .map((x) => ({
          title: x.title,
          body: x.body,
          tags: x.tags,
          checks: x.checks.map((k) => k.text),
          color: x.color,
          repeat: x.repeat,
        })),
    })),
  };
}

/** Inserta filas de a 200; si la base no tiene alguna columna nueva, reintenta sin ellas. */
async function insertRows(table: string, rows: Record<string, unknown>[], optional: string[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const first = await supabase.from(table).insert(part);
    if (!first.error) continue;
    const bare = part.map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k]) => !optional.includes(k))),
    );
    const again = await supabase.from(table).insert(bare);
    if (again.error) throw again.error;
  }
}

// ───────────────────────── Tableros ─────────────────────────

export const PIN_SQL = 'supabase/migrations/202611070015_board_pin.sql';
/** La columna anclada a Mi espacio (solo una, de cualquier tablero). */
export type PinnedColumn = { id: string; name: string; board_id: string };

export function useBoardList(notify: Notify) {
  const [all, setAll] = useState<Board[] | null>(null);
  const [error, setError] = useState('');
  const [archived, setArchived] = useState(0);
  const [pinned, setPinned] = useState<PinnedColumn | null>(null);
  const [pinMissing, setPinMissing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('boards').select('*').order('created_at');
    if (error) return setError(error.message);
    setAll(
      ((data ?? []) as Board[]).map((b) => ({
        ...b,
        background: b.background ?? '',
        is_template: Boolean(b.is_template),
        description: b.description ?? '',
      })),
    );
    const [count, pin] = await Promise.all([
      supabase
        .from('board_cards')
        .select('id', { count: 'exact', head: true })
        .not('archived_at', 'is', null),
      supabase.from('board_lists').select('id,name,board_id').eq('pinned', true).maybeSingle(),
    ]);
    setArchived(count.error ? 0 : (count.count ?? 0));
    setPinMissing(Boolean(pin.error));
    setPinned(pin.error ? null : ((pin.data as PinnedColumn | null) ?? null));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const fail = (e: { code?: string; message?: string }) => {
    notify(
      isMissing016(e)
        ? missing016Text
        : isMissing(e)
          ? `Para esta opción ejecuta ${BOARD_SQL} en el SQL Editor de Supabase.`
          : 'No se pudo guardar: ' + (e.message ?? 'error'),
    );
    void load();
  };

  /** Crea el tablero con sus tres columnas de inicio y devuelve su id. */
  const create = async (name: string) => {
    const { data, error } = await supabase.rpc('create_planner_board', { board_name: name });
    if (error) {
      fail(error);
      return null;
    }
    const board: Board = {
      id: data as string,
      name,
      background: '',
      created_at: new Date().toISOString(),
      is_template: false,
      description: '',
    };
    setAll((v) => [...(v ?? []), board]);
    return board.id;
  };

  /**
   * Crea un tablero (o una plantilla tuya) con el contenido de `spec`: columnas, tarjetas,
   * listas de verificación, etiquetas y colores. Devuelve su id.
   */
  const createFrom = async (
    spec: BoardSpec,
    name: string,
    opts: { template?: boolean; description?: string } = {},
  ) => {
    const board: Board = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 120) || 'Tablero',
      background: spec.background ?? '',
      created_at: new Date().toISOString(),
      is_template: Boolean(opts.template),
      description: (opts.description ?? '').slice(0, 2000),
    };
    try {
      const row: Record<string, unknown> = { id: board.id, name: board.name };
      if (board.background) row.background = board.background;
      if (board.is_template) row.is_template = true;
      if (board.description && board.is_template) row.description = board.description;
      const ins = await supabase.from('boards').insert(row);
      if (ins.error) {
        if (board.is_template) throw ins.error;
        // Sin las migraciones nuevas: el tablero igual, sin fondo.
        const bare = await supabase.from('boards').insert({ id: board.id, name: board.name });
        if (bare.error) throw bare.error;
        board.background = '';
      }
      const cols = spec.columns.map((c, i) => ({
        id: crypto.randomUUID(),
        board_id: board.id,
        name: c.name.slice(0, 120),
        rank: (i + 1) * 1024,
        color: c.color ?? '',
      }));
      await insertRows('board_lists', cols, ['color']);
      const cards = spec.columns.flatMap((c, i) =>
        c.cards.map((card, j) => ({
          id: crypto.randomUUID(),
          list_id: cols[i].id,
          title: card.title.slice(0, 240),
          body: card.body ?? '',
          rank: (j + 1) * 1024,
          tags: card.tags ?? [],
          checks: (card.checks ?? []).map((text) => ({
            id: crypto.randomUUID(),
            text: text.slice(0, 300),
            done: false,
          })),
          color: card.color ?? '',
          ...(card.repeat && { repeat: card.repeat }),
        })),
      );
      await insertRows('board_cards', cards, ['color', 'repeat']);
      setAll((v) => [...(v ?? []), board]);
      return board.id;
    } catch (e) {
      fail(e as { message?: string });
      return null;
    }
  };

  const update = (
    id: string,
    changes: Partial<Pick<Board, 'name' | 'background' | 'description'>>,
  ) => {
    setAll((v) => v?.map((b) => (b.id === id ? { ...b, ...changes } : b)) ?? v);
    enqueue([id], () => check(supabase.from('boards').update(changes).eq('id', id))).catch(fail);
  };
  const remove = (id: string) => {
    setAll((v) => v?.filter((b) => b.id !== id) ?? v);
    setPinned((p) => (p?.board_id === id ? null : p));
    enqueue([id], () => check(supabase.from('boards').delete().eq('id', id))).catch(fail);
  };

  /** Ancla una columna a Mi espacio (o la desancla con null). Solo puede haber una. */
  const pin = (col: PinnedColumn | null) => {
    if (pinMissing) {
      notify(
        `Para anclar una columna a Mi espacio ejecuta ${PIN_SQL} en el SQL Editor de Supabase.`,
      );
      return false;
    }
    const before = pinned;
    setPinned(col);
    const target = col?.id ?? before?.id;
    if (!target) return true;
    enqueue([target], () =>
      check(
        supabase
          .from('board_lists')
          .update({ pinned: Boolean(col) })
          .eq('id', target),
      ),
    ).catch((e: { code?: string; message?: string }) => {
      setPinned(before);
      if (e.code === '23505')
        notify('Ya hay una columna anclada a Mi espacio. Desánclala primero.');
      else if (isMissing(e) || /pinned/.test(e.message ?? '')) {
        setPinMissing(true);
        notify(
          `Para anclar una columna a Mi espacio ejecuta ${PIN_SQL} en el SQL Editor de Supabase.`,
        );
      } else notify('No se pudo anclar: ' + (e.message ?? 'error'));
    });
    return true;
  };
  /** La columna anclada se borró, cambió de nombre o pasó a otro tablero. */
  const forgetPin = (id: string) => setPinned((p) => (p?.id === id ? null : p));
  const renamePin = (id: string, name: string) =>
    setPinned((p) => (p?.id === id ? { ...p, name } : p));
  const repointPin = (id: string, board_id: string) =>
    setPinned((p) => (p?.id === id ? { ...p, board_id } : p));

  return {
    /** Todos: tableros y plantillas tuyas. */
    all,
    boards: all?.filter((b) => !b.is_template) ?? null,
    templates: all?.filter((b) => b.is_template) ?? [],
    error,
    archived,
    setArchived,
    pinned,
    pin,
    forgetPin,
    renamePin,
    repointPin,
    create,
    createFrom,
    update,
    remove,
    reload: load,
  };
}
export type BoardListApi = ReturnType<typeof useBoardList>;

// ───────────────────────── Columnas y tarjetas de un tablero ─────────────────────────

export function useBoard(boardId: string | null, notify: Notify) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [extras, setExtras] = useState(true);
  const live = useRef({ columns, cards, extras });
  live.current = { columns, cards, extras };
  const current = useRef(boardId);
  current.current = boardId;

  const load = useCallback(async () => {
    const id = current.current;
    if (!id) return;
    const [l, c] = await Promise.all([
      supabase.from('board_lists').select('*').eq('board_id', id).order('rank').order('id'),
      supabase
        .from('planner_board_cards')
        .select('*')
        .eq('board_id', id)
        .is('archived_at', null)
        .order('rank')
        .order('id')
        .limit(5000),
    ]);
    let rows = c.data as BoardCard[] | null;
    let hasExtras = true;
    if (c.error && isMissing(c.error)) {
      // Sin la migración 014: todo menos completar, archivar y colores.
      hasExtras = false;
      const plain = await supabase
        .from('planner_board_cards')
        .select('*')
        .eq('board_id', id)
        .order('rank')
        .limit(5000);
      rows = plain.data as BoardCard[] | null;
    } else if (c.error) {
      if (current.current === id) setStatus('error');
      return;
    }
    if (current.current !== id) return;
    if (l.error) return setStatus('error');
    setColumns(((l.data ?? []) as Column[]).map((x) => ({ ...x, color: x.color ?? '' })));
    setCards((rows ?? []).map(normalizeCard));
    setExtras(hasExtras);
    setStatus('ready');
  }, []);

  useEffect(() => {
    setColumns([]);
    setCards([]);
    setStatus('loading');
    if (boardId) void load();
  }, [boardId, load]);

  const fail = useCallback(
    (e: { code?: string; message?: string }) => {
      if (isMissing016(e)) notify(missing016Text);
      else if (isMissing(e)) {
        setExtras(false);
        notify(
          `Para completar, archivar y dar color ejecuta ${BOARD_SQL} en el SQL Editor de Supabase.`,
        );
      } else notify('No se pudo guardar: ' + (e.message ?? 'error'));
      void load();
    },
    [load, notify],
  );
  const needExtras = () => {
    if (live.current.extras) return true;
    notify(
      `Para completar, archivar y dar color ejecuta ${BOARD_SQL} en el SQL Editor de Supabase.`,
    );
    return false;
  };

  const sortedCards = (list: string, except?: string) =>
    live.current.cards.filter((c) => c.list_id === list && c.id !== except).sort(byRank);

  // ── Columnas ──
  const addColumn = (name: string, index: number) => {
    if (!boardId) return null;
    const others = [...live.current.columns].sort(byRank);
    const col: Column = {
      id: crypto.randomUUID(),
      board_id: boardId,
      name: name.trim().slice(0, 120),
      rank: rankAt(
        others.map((c) => c.rank),
        index,
      ),
      color: '',
    };
    setColumns((v) => [...v, col]);
    const { color: _c, ...row } = col;
    enqueue([col.id], () => check(supabase.from('board_lists').insert(row))).catch(fail);
    return col;
  };
  const updateColumn = (id: string, changes: Partial<Pick<Column, 'name' | 'color' | 'rank'>>) => {
    if ('color' in changes && !needExtras()) return;
    setColumns((v) => v.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    enqueue([id], () => check(supabase.from('board_lists').update(changes).eq('id', id))).catch(
      fail,
    );
  };
  const moveColumn = (id: string, index: number) => {
    const others = live.current.columns.filter((c) => c.id !== id).sort(byRank);
    let ranks = others.map((c) => c.rank);
    if (crowded(ranks)) {
      // Renumera todas para que quepa la nueva posición.
      others.forEach(
        (c, i) => c.rank !== (i + 1) * 1024 && updateColumn(c.id, { rank: (i + 1) * 1024 }),
      );
      ranks = others.map((_, i) => (i + 1) * 1024);
    }
    updateColumn(id, { rank: rankAt(ranks, index) });
  };
  /** Lleva una columna (con todas sus tarjetas, también las archivadas) a otro tablero. */
  const moveColumnToBoard = (id: string, board: string, rank: number) => {
    setColumns((v) => v.filter((c) => c.id !== id));
    setCards((v) => v.filter((c) => c.list_id !== id));
    enqueue([id], () =>
      check(supabase.from('board_lists').update({ board_id: board, rank }).eq('id', id)),
    ).catch(fail);
  };
  const deleteColumn = (id: string) => {
    const gone = live.current.cards.filter((c) => c.list_id === id).map((c) => c.id);
    setColumns((v) => v.filter((c) => c.id !== id));
    setCards((v) => v.filter((c) => c.list_id !== id));
    enqueue([id, ...gone], () => check(supabase.from('board_lists').delete().eq('id', id))).catch(
      fail,
    );
  };

  // ── Tarjetas ──
  /**
   * Añade tarjetas al final de una columna (una por título). «Regar las plantas cada lunes»
   * nace con su fecha y repitiéndose cada lunes.
   */
  const addCards = (list: string, items: NewCardInput[]) => {
    const clean = items
      .map((i) => (typeof i === 'string' ? { title: i, body: '' } : { body: '', ...i }))
      .map((i) => ({ title: i.title.trim().slice(0, 240), body: i.body.trim().slice(0, 20000) }))
      .filter((i) => i.title);
    if (!clean.length) return [];
    let last = sortedCards(list).at(-1)?.rank ?? 0;
    const made = clean.map(({ title: text, body }) => {
      last += 1024;
      const rep = parseRepeat(text);
      return normalizeCard({
        id: crypto.randomUUID(),
        list_id: list,
        title: rep?.title ?? text,
        body,
        tags: [],
        checks: [],
        rank: last,
        due: rep?.due ?? null,
        entry_id: null,
        episode_id: null,
        person_id: null,
        reading_id: null,
        note_id: null,
        repeat: rep?.rule ?? '',
        created_at: new Date().toISOString(),
      });
    });
    setCards((v) => [...v, ...made]);
    for (const c of made) {
      enqueue([list, c.id], () =>
        check(
          supabase.from('board_cards').insert({
            id: c.id,
            list_id: list,
            title: c.title,
            rank: c.rank,
            ...(c.body && { body: c.body }),
            ...(c.due && { due: c.due }),
          }),
        ),
      ).catch(fail);
      // Aparte: sin la migración 016 la tarjeta igual se guarda (sin repetirse).
      if (c.repeat)
        enqueue([c.id], () =>
          check(supabase.from('board_cards').update({ repeat: c.repeat }).eq('id', c.id)),
        ).catch(fail);
    }
    return made;
  };
  const patchCard = (id: string, changes: CardChanges) => {
    const keys = Object.keys(changes);
    if (keys.some((k) => EXTRA.has(k)) && !needExtras()) return;
    setCards((v) => v.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    const ids = changes.list_id ? [id, changes.list_id] : [id];
    enqueue(ids, () => check(supabase.from('board_cards').update(changes).eq('id', id))).catch(
      fail,
    );
  };
  /** Como `patchCard`, pero solo si la tarjeta sigue en el tablero (no se archivó ni se borró). */
  const patchIfPresent = (id: string, changes: CardChanges) => {
    if (!live.current.cards.some((c) => c.id === id)) return false;
    patchCard(id, changes);
    return true;
  };
  const moveCard = (id: string, list: string, index: number) => {
    const card = live.current.cards.find((c) => c.id === id);
    if (!card) return;
    const others = sortedCards(list, id);
    let ranks = others.map((c) => c.rank);
    if (crowded(ranks)) {
      others.forEach(
        (c, i) => c.rank !== (i + 1) * 1024 && patchCard(c.id, { rank: (i + 1) * 1024 }),
      );
      ranks = others.map((_, i) => (i + 1) * 1024);
    }
    const rank = rankAt(ranks, index);
    if (card.list_id === list && card.rank === rank) return;
    patchCard(id, card.list_id === list ? { rank } : { list_id: list, rank });
  };
  /** Reordena una columna (por fecha o por nombre): un solo cambio de rango por tarjeta. */
  const reorder = (ordered: BoardCard[]) =>
    ordered.forEach(
      (c, i) => c.rank !== (i + 1) * 1024 && patchCard(c.id, { rank: (i + 1) * 1024 }),
    );

  /** La quita del tablero y la borra; devuelve la tarjeta para poder deshacerlo. */
  const deleteCard = (id: string) => {
    const card = live.current.cards.find((c) => c.id === id) ?? null;
    setCards((v) => v.filter((c) => c.id !== id));
    enqueue([id], () => check(supabase.from('board_cards').delete().eq('id', id))).catch(fail);
    return card;
  };
  /** Vuelve a crear una tarjeta borrada (Deshacer), con el mismo id. */
  const restoreCard = (card: BoardCard) => {
    if (!live.current.columns.some((c) => c.id === card.list_id)) return;
    setCards((v) => (v.some((c) => c.id === card.id) ? v : [...v, card]));
    enqueue([card.list_id, card.id], () =>
      check(supabase.from('board_cards').insert(cardRow(card, live.current.extras))),
    ).catch(fail);
  };
  /** Archiva: sale de la columna y pasa a Archivados. */
  const archiveCard = (id: string) => {
    if (!needExtras()) return null;
    const card = live.current.cards.find((c) => c.id === id) ?? null;
    const at = new Date().toISOString();
    setCards((v) => v.filter((c) => c.id !== id));
    enqueue([id], () =>
      check(supabase.from('board_cards').update({ archived_at: at }).eq('id', id)),
    ).catch(fail);
    return card ? ({ ...card, archived_at: at } as BoardCard) : null;
  };
  /** Deshace el archivado (la tarjeta vuelve a su sitio). */
  const unarchiveCard = (card: BoardCard) => {
    setCards((v) => (v.some((c) => c.id === card.id) ? v : [...v, { ...card, archived_at: null }]));
    enqueue([card.id], () =>
      check(supabase.from('board_cards').update({ archived_at: null }).eq('id', card.id)),
    ).catch(fail);
  };

  return {
    columns: [...columns].sort(byRank),
    cards,
    status,
    extras,
    reload: load,
    addColumn,
    updateColumn,
    moveColumn,
    moveColumnToBoard,
    deleteColumn,
    addCards,
    patchCard,
    patchIfPresent,
    moveCard,
    reorder,
    deleteCard,
    restoreCard,
    archiveCard,
    unarchiveCard,
  };
}
export type BoardApi = ReturnType<typeof useBoard>;

// ───────────────────────── Archivados ─────────────────────────

export function useArchive(on: boolean, notify: Notify) {
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('planner_board_cards')
      .select('*')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(1000);
    if (error) {
      setMissing(isMissing(error));
      setCards([]);
      return;
    }
    setMissing(false);
    // Lo archivado dentro de una plantilla no cuenta.
    setCards(((data ?? []) as BoardCard[]).filter((c) => !c.board_is_template).map(normalizeCard));
  }, []);
  useEffect(() => {
    if (on) void load();
  }, [on, load]);
  const fail = (e: { message?: string }) => {
    notify(isMissing016(e) ? missing016Text : 'No se pudo guardar: ' + (e.message ?? 'error'));
    void load();
  };

  const patch = (id: string, changes: CardChanges) => {
    setCards((v) => v?.map((c) => (c.id === id ? { ...c, ...changes } : c)) ?? v);
    enqueue([id], () => check(supabase.from('board_cards').update(changes).eq('id', id))).catch(
      fail,
    );
  };
  const unarchive = (id: string) => {
    const card = cards?.find((c) => c.id === id) ?? null;
    setCards((v) => v?.filter((c) => c.id !== id) ?? v);
    enqueue([id], () =>
      check(supabase.from('board_cards').update({ archived_at: null }).eq('id', id)),
    ).catch(fail);
    return card;
  };
  const rearchive = (card: BoardCard) => {
    setCards((v) =>
      v?.some((c) => c.id === card.id)
        ? v
        : [card, ...(v ?? [])].sort((a, b) =>
            (b.archived_at ?? '').localeCompare(a.archived_at ?? ''),
          ),
    );
    enqueue([card.id], () =>
      check(
        supabase.from('board_cards').update({ archived_at: card.archived_at }).eq('id', card.id),
      ),
    ).catch(fail);
  };
  const remove = (id: string) => {
    const card = cards?.find((c) => c.id === id) ?? null;
    setCards((v) => v?.filter((c) => c.id !== id) ?? v);
    enqueue([id], () => check(supabase.from('board_cards').delete().eq('id', id))).catch(fail);
    return card;
  };
  const restore = (card: BoardCard) => {
    setCards((v) => (v?.some((c) => c.id === card.id) ? v : [card, ...(v ?? [])]));
    enqueue([card.id], () => check(supabase.from('board_cards').insert(cardRow(card, true)))).catch(
      fail,
    );
  };
  return { cards, missing, reload: load, patch, unarchive, rearchive, remove, restore };
}
export type ArchiveApi = ReturnType<typeof useArchive>;
