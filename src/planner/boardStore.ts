import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../backend";
import type { Notify } from "../hooks/useToast";
import { isRepeat, parseRepeat, type Repeat } from "./boardRepeat";
import { normalizeRules, type ColumnRules } from "./boardRules";
import type { Card, Check } from "./shared";

/**
 * Datos de Tableros. Todo cambia al instante en pantalla y se guarda de fondo. Los ids se crean
 * aquí, así una tarjeta nueva ya tiene su id definitivo; las escrituras de una misma fila (o de
 * una tarjeta en una columna recién creada) se encadenan para llegar en orden.
 */

/** Ajustes de un tablero (migración 202611090002). */
export type BoardSettings = {
  /** Sus tarjetas cuentan para el saludo de Mi espacio. */
  greeting?: boolean;
  /** Las tarjetas sin cambios se ven más apagadas pasados estos días (0 o nada: no). */
  aging?: number;
};
export type Board = {
  id: string;
  name: string;
  background: string;
  created_at: string;
  /** Plantilla tuya (migración 016): se edita como un tablero, pero no sale en la lista. */
  is_template?: boolean;
  description?: string;
  settings: BoardSettings;
};
export type Column = {
  id: string;
  board_id: string;
  name: string;
  rank: number;
  color: string;
  rules: ColumnRules;
};
export type Priority = "" | "baja" | "media" | "alta";
export const PRIORITIES: Priority[] = ["alta", "media", "baja"];
const isPriority = (v: unknown): v is Priority =>
  v === "" || PRIORITIES.includes(v as Priority);

export type BoardCard = Card & {
  done: boolean;
  done_at: string | null;
  archived_at: string | null;
  color: string;
  /** Se repite al completarla (migración 016). */
  repeat: Repeat;
  /** Migración 202611090002. */
  priority: Priority;
  highlight: boolean;
  snoozed_until: string | null;
  /** Último cambio real (lo pone la base). */
  touched_at?: string;
  /** Desde cuándo está en su columna. */
  list_since?: string;
  created_at?: string;
  /** Solo en la vista. */
  board_id?: string;
  list_name?: string;
  board_name?: string;
  board_is_template?: boolean;
  board_settings?: BoardSettings | null;
};
export type CardChanges = Partial<
  Pick<
    BoardCard,
    | "title"
    | "body"
    | "tags"
    | "checks"
    | "due"
    | "list_id"
    | "rank"
    | "done"
    | "done_at"
    | "archived_at"
    | "color"
    | "repeat"
    | "priority"
    | "highlight"
    | "snoozed_until"
    | "entry_id"
    | "person_id"
    | "episode_id"
    | "reading_id"
    | "note_id"
  >
>;

/** Una tarjeta nueva: solo el título o también lo que dijo la escritura rápida. */
export type NewCardInput =
  | string
  | {
      title: string;
      body?: string;
      tags?: string[];
      priority?: Priority;
      highlight?: boolean;
    };

/** Migración que quita el tope de caracteres de títulos y descripciones de tarjetas. */
export const NO_LIMITS_SQL =
  "supabase/migrations/202611090001_card_no_limits.sql";
/** Prioridad, resaltar, posponer, reglas, envejecer y ajustes del tablero. */
export const POWER_SQL = "supabase/migrations/202611090002_board_power.sql";

export const BOARD_SQL = "supabase/migrations/202611070014_board_extras.sql";
export const TEMPLATE_SQL =
  "supabase/migrations/202611070016_board_templates.sql";
/** Campos de la migración 014: sin ella no se guardan. */
const EXTRA = new Set([
  "done",
  "done_at",
  "archived_at",
  "color",
  "background",
  "created_at",
]);
/** Campos de la migración 202611090002. */
const POWER = new Set(["priority", "highlight", "snoozed_until"]);
/** Falta la migración 016 (repetir y plantillas). Se mira antes que la 014. */
const isMissing016 = (e: { message?: string }) =>
  /\brepeat\b|is_template|description|board_is_template/.test(e.message ?? "");
/** Falta la migración 202611090002. */
export const isMissingPower = (e: { message?: string }) =>
  /priority|highlight|snoozed_until|touched_at|list_since|\brules\b|settings/.test(
    e.message ?? "",
  );
const isMissing = (e: { code?: string; message?: string }) =>
  !isMissing016(e) &&
  !isMissingPower(e) &&
  (e.code === "42703" ||
    e.code === "PGRST204" ||
    /archived_at|done_at|\bdone\b|background|\bcolor\b|list_name|board_name/.test(
      e.message ?? "",
    ));
const missing016Text = `Para repetir tarjetas y usar plantillas ejecuta ${TEMPLATE_SQL} en el SQL Editor de Supabase.`;
export const missingPowerText = `Para prioridad, resaltar, posponer, reglas y tarjetas que envejecen ejecuta ${POWER_SQL} en el SQL Editor de Supabase.`;

/** Avisa a quien muestra tarjetas fuera de Tableros (Agenda, búsqueda, saludo) que algo cambió. */
export const BOARDS_CHANGED = "nexo-boards-changed";
const changed = () => window.dispatchEvent(new Event(BOARDS_CHANGED));

// ───────────────────────── Cola de escrituras ─────────────────────────

const queue = new Map<string, Promise<unknown>>();
/** Ejecuta `fn` cuando terminen las escrituras anteriores de esas filas. */
function enqueue<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
  const before = Promise.all(
    ids.map((id) => (queue.get(id) ?? Promise.resolve()).catch(() => {})),
  );
  const p = before.then(fn);
  for (const id of ids) queue.set(id, p);
  p.then(
    () => {
      ids.forEach((id) => queue.get(id) === p && queue.delete(id));
      changed();
    },
    () => ids.forEach((id) => queue.get(id) === p && queue.delete(id)),
  );
  return p;
}
/** Espera a que terminen las escrituras pendientes de esa fila (p. ej., al restaurar una tarjeta). */
export const afterWrites = (id: string) =>
  (queue.get(id) ?? Promise.resolve()).then(
    () => undefined,
    () => undefined,
  );
async function check<
  T extends { error: { code?: string; message: string } | null },
>(req: PromiseLike<T>) {
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
const crowded = (ranks: number[]) =>
  ranks.some((r, i) => i > 0 && r - ranks[i - 1] < 1e-6);
export const byRank = <T extends { rank: number; id: string }>(a: T, b: T) =>
  a.rank - b.rank || a.id.localeCompare(b.id);

/** Fila de `board_cards` (sin los campos de la vista). `power`: existe la migración nueva. */
function cardRow(c: BoardCard, extras: boolean, power = true) {
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
  // Solo si tienen algo (y existe la migración): así se restaura igual sin ella.
  if (power) {
    if (c.priority) row.priority = c.priority;
    if (c.highlight) row.highlight = true;
    if (c.snoozed_until) row.snoozed_until = c.snoozed_until;
    if (c.touched_at) row.touched_at = c.touched_at;
    if (c.list_since) row.list_since = c.list_since;
  }
  return row;
}
export const normalizeCard = (c: Partial<BoardCard> & Card): BoardCard => ({
  ...c,
  tags: c.tags ?? [],
  checks: Array.isArray(c.checks) ? (c.checks as Check[]) : [],
  done: Boolean(c.done),
  done_at: c.done_at ?? null,
  archived_at: c.archived_at ?? null,
  color: c.color ?? "",
  repeat: isRepeat(c.repeat) ? c.repeat : "",
  priority: isPriority(c.priority) ? c.priority : "",
  highlight: Boolean(c.highlight),
  snoozed_until: c.snoozed_until ?? null,
});
const normalizeColumn = (x: Partial<Column> & { id: string }): Column => ({
  board_id: "",
  name: "",
  rank: 0,
  ...x,
  color: x.color ?? "",
  rules: normalizeRules(x.rules),
});
const normalizeBoard = (b: Partial<Board> & { id: string }): Board => ({
  name: "",
  created_at: "",
  ...b,
  background: b.background ?? "",
  is_template: Boolean(b.is_template),
  description: b.description ?? "",
  settings:
    b.settings && typeof b.settings === "object" && !Array.isArray(b.settings)
      ? b.settings
      : {},
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
    supabase.from("boards").select("*").eq("id", boardId).single(),
    supabase
      .from("board_lists")
      .select("*")
      .eq("board_id", boardId)
      .order("rank")
      .order("id"),
  ]);
  if (b.error) throw b.error;
  if (l.error) throw l.error;
  let c = await supabase
    .from("planner_board_cards")
    .select("*")
    .eq("board_id", boardId)
    .is("archived_at", null)
    .order("rank")
    .order("id")
    .limit(5000);
  if (c.error)
    c = await supabase
      .from("planner_board_cards")
      .select("*")
      .eq("board_id", boardId)
      .order("rank")
      .limit(5000);
  if (c.error) throw c.error;
  const cards = ((c.data ?? []) as BoardCard[]).map(normalizeCard);
  return {
    background: (b.data as Board).background ?? "",
    columns: ((l.data ?? []) as Column[]).map((col) => ({
      name: col.name,
      color: col.color ?? "",
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
async function insertRows(
  table: string,
  rows: Record<string, unknown>[],
  optional: string[],
) {
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const first = await supabase.from(table).insert(part);
    if (!first.error) continue;
    if (!optional.length) throw first.error;
    const bare = part.map((r) =>
      Object.fromEntries(
        Object.entries(r).filter(([k]) => !optional.includes(k)),
      ),
    );
    const again = await supabase.from(table).insert(bare);
    if (again.error) throw again.error;
  }
}

// ───────────────────────── Copias para «Deshacer» al borrar ─────────────────────────

type Row = Record<string, unknown>;
/**
 * Todo lo de una o varias columnas (o de un tablero) tal como está en la base, para volver a
 * crearlo igual si deshaces el borrado: filas completas, también las tarjetas archivadas.
 */
export type Snapshot = { board?: Row; lists: Row[]; cards: Row[] };
const bare = (r: Row) => {
  const { owner_id: _o, ...rest } = r;
  return rest;
};

async function allRows(
  table: string,
  field: string,
  ids: string[],
): Promise<Row[]> {
  const out: Row[] = [];
  for (let n = 0; ; n += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .in(field, ids)
      .order("id")
      .range(n, n + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Row[]).map(bare));
    if ((data ?? []).length < 1000) return out;
  }
}
export async function snapshotColumns(listIds: string[]): Promise<Snapshot> {
  const [lists, cards] = await Promise.all([
    allRows("board_lists", "id", listIds),
    allRows("board_cards", "list_id", listIds),
  ]);
  return { lists, cards };
}
export async function snapshotBoardRows(boardId: string): Promise<Snapshot> {
  const b = await supabase.from("boards").select("*").eq("id", boardId).single();
  if (b.error) throw b.error;
  const lists = await allRows("board_lists", "board_id", [boardId]);
  const cards = lists.length
    ? await allRows(
        "board_cards",
        "list_id",
        lists.map((l) => l.id as string),
      )
    : [];
  return { board: bare(b.data as Row), lists, cards };
}
/**
 * Vuelve a crear lo copiado (con los mismos ids). Si algo falla a medias, borra lo que alcanzó a
 * crear (así no queda un tablero vacío). Si otra columna se ancló mientras tanto, vuelve sin anclar.
 */
async function restoreRows(s: Snapshot) {
  const made: [string, string[]][] = [];
  try {
    if (s.board) {
      await insertRows("boards", [s.board], []);
      made.push(["boards", [s.board.id as string]]);
    }
    try {
      await insertRows("board_lists", s.lists, []);
    } catch (e) {
      if ((e as { code?: string }).code !== "23505") throw e;
      await insertRows(
        "board_lists",
        s.lists.map((l) => ({ ...l, pinned: false })),
        [],
      );
    }
    made.push(["board_lists", s.lists.map((l) => l.id as string)]);
    await insertRows("board_cards", s.cards, []);
  } catch (e) {
    for (const [table, ids] of made.reverse())
      if (ids.length) await supabase.from(table).delete().in("id", ids);
    throw e;
  }
}
export const snapshotEntries = (s: Snapshot) =>
  s.cards.map((c) => (c.entry_id as string | null) ?? null);

// ───────────────────────── Tableros ─────────────────────────

export const PIN_SQL = "supabase/migrations/202611070015_board_pin.sql";
/** La columna anclada a Mi espacio (solo una, de cualquier tablero). */
export type PinnedColumn = { id: string; name: string; board_id: string };

export function useBoardList(notify: Notify) {
  const [all, setAll] = useState<Board[] | null>(null);
  const [error, setError] = useState("");
  const [archived, setArchived] = useState(0);
  const [pinned, setPinned] = useState<PinnedColumn | null>(null);
  const [pinMissing, setPinMissing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("boards")
      .select("*")
      .order("created_at");
    if (error) return setError(error.message);
    setAll(((data ?? []) as Board[]).map(normalizeBoard));
    const [count, pin] = await Promise.all([
      supabase
        .from("board_cards")
        .select("id", { count: "exact", head: true })
        .not("archived_at", "is", null),
      supabase
        .from("board_lists")
        .select("id,name,board_id")
        .eq("pinned", true)
        .maybeSingle(),
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
        : isMissingPower(e)
          ? missingPowerText
          : isMissing(e)
            ? `Para esta opción ejecuta ${BOARD_SQL} en el SQL Editor de Supabase.`
            : /title_check/.test(e.message ?? "")
              ? `Para títulos sin límite ejecuta ${NO_LIMITS_SQL} en el SQL Editor de Supabase.`
              : "No se pudo guardar: " + (e.message ?? "error"),
    );
    void load();
  };

  /** Crea el tablero con sus tres columnas de inicio y devuelve su id. */
  const create = async (name: string) => {
    const { data, error } = await supabase.rpc("create_planner_board", {
      board_name: name,
    });
    if (error) {
      fail(error);
      return null;
    }
    const board = normalizeBoard({
      id: data as string,
      name,
      created_at: new Date().toISOString(),
    });
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
    const board = normalizeBoard({
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 120) || "Tablero",
      background: spec.background ?? "",
      created_at: new Date().toISOString(),
      is_template: Boolean(opts.template),
      description: (opts.description ?? "").slice(0, 2000),
    });
    try {
      const row: Record<string, unknown> = { id: board.id, name: board.name };
      if (board.background) row.background = board.background;
      if (board.is_template) row.is_template = true;
      if (board.description && board.is_template)
        row.description = board.description;
      const ins = await supabase.from("boards").insert(row);
      if (ins.error) {
        if (board.is_template) throw ins.error;
        // Sin las migraciones nuevas: el tablero igual, sin fondo.
        const plain = await supabase
          .from("boards")
          .insert({ id: board.id, name: board.name });
        if (plain.error) throw plain.error;
        board.background = "";
      }
      const cols = spec.columns.map((c, i) => ({
        id: crypto.randomUUID(),
        board_id: board.id,
        name: c.name.slice(0, 120),
        rank: (i + 1) * 1024,
        color: c.color ?? "",
      }));
      await insertRows("board_lists", cols, ["color"]);
      const cards = spec.columns.flatMap((c, i) =>
        c.cards.map((card, j) => ({
          id: crypto.randomUUID(),
          list_id: cols[i].id,
          title: card.title.slice(0, 240),
          body: card.body ?? "",
          rank: (j + 1) * 1024,
          tags: card.tags ?? [],
          checks: (card.checks ?? []).map((text) => ({
            id: crypto.randomUUID(),
            text,
            done: false,
          })),
          color: card.color ?? "",
          ...(card.repeat && { repeat: card.repeat }),
        })),
      );
      await insertRows("board_cards", cards, ["color", "repeat"]);
      setAll((v) => [...(v ?? []), board]);
      return board.id;
    } catch (e) {
      fail(e as { message?: string });
      return null;
    }
  };

  const update = (
    id: string,
    changes: Partial<
      Pick<Board, "name" | "background" | "description" | "settings">
    >,
  ) => {
    setAll((v) => v?.map((b) => (b.id === id ? { ...b, ...changes } : b)) ?? v);
    enqueue([id], () =>
      check(supabase.from("boards").update(changes).eq("id", id)),
    ).catch(fail);
  };
  const remove = (id: string) => {
    setAll((v) => v?.filter((b) => b.id !== id) ?? v);
    setPinned((p) => (p?.board_id === id ? null : p));
    enqueue([id], () =>
      check(supabase.from("boards").delete().eq("id", id)),
    ).catch(fail);
  };
  /** Deshace el borrado de un tablero: lo vuelve a crear con todo. Devuelve si salió bien. */
  const restore = async (snap: Snapshot) => {
    const id = snap.board?.id as string | undefined;
    if (!id) return false;
    try {
      await enqueue([id], () => restoreRows(snap));
      setAll((v) =>
        v?.some((b) => b.id === id)
          ? v
          : [...(v ?? []), normalizeBoard(snap.board as Board)].sort((a, b) =>
              a.created_at.localeCompare(b.created_at),
            ),
      );
      if (snap.lists.some((l) => l.pinned)) void load();
      return true;
    } catch (e) {
      fail(e as { message?: string });
      return false;
    }
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
          .from("board_lists")
          .update({ pinned: Boolean(col) })
          .eq("id", target),
      ),
    ).catch((e: { code?: string; message?: string }) => {
      setPinned(before);
      if (e.code === "23505")
        notify("Ya hay una columna anclada a Mi espacio. Desánclala primero.");
      else if (isMissing(e) || /pinned/.test(e.message ?? "")) {
        setPinMissing(true);
        notify(
          `Para anclar una columna a Mi espacio ejecuta ${PIN_SQL} en el SQL Editor de Supabase.`,
        );
      } else notify("No se pudo anclar: " + (e.message ?? "error"));
    });
    return true;
  };
  /** La columna anclada se borró, cambió de nombre o pasó a otro tablero. */
  const forgetPin = (id: string) => setPinned((p) => (p?.id === id ? null : p));
  const renamePin = (id: string, name: string) =>
    setPinned((p) => (p?.id === id ? { ...p, name } : p));
  const repointPin = (id: string, board_id: string) =>
    setPinned((p) => (p?.id === id ? { ...p, board_id } : p));
  /** Al deshacer el borrado de la columna anclada. */
  const notePin = (col: PinnedColumn) => setPinned(col);

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
    notePin,
    create,
    createFrom,
    update,
    remove,
    restore,
    reload: load,
  };
}
export type BoardListApi = ReturnType<typeof useBoardList>;

// ───────────────────────── Columnas y tarjetas de un tablero ─────────────────────────

export function useBoard(boardId: string | null, notify: Notify) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [extras, setExtras] = useState(true);
  const [power, setPower] = useState(true);
  const live = useRef({ columns, cards, extras, power });
  live.current = { columns, cards, extras, power };
  const current = useRef(boardId);
  current.current = boardId;

  /**
   * Cambia las tarjetas (o columnas) y deja el valor nuevo listo al momento: así varias acciones
   * seguidas (mover varias, reglas encadenadas) parten de lo último y no de lo que había al pintar.
   */
  const putCards = (fn: (v: BoardCard[]) => BoardCard[]) => {
    const next = fn(live.current.cards);
    live.current = { ...live.current, cards: next };
    setCards(next);
  };
  const putColumns = (fn: (v: Column[]) => Column[]) => {
    const next = fn(live.current.columns);
    live.current = { ...live.current, columns: next };
    setColumns(next);
  };

  const load = useCallback(async () => {
    const id = current.current;
    if (!id) return;
    const [l, c] = await Promise.all([
      supabase
        .from("board_lists")
        .select("*")
        .eq("board_id", id)
        .order("rank")
        .order("id"),
      supabase
        .from("planner_board_cards")
        .select("*")
        .eq("board_id", id)
        .is("archived_at", null)
        .order("rank")
        .order("id")
        .limit(5000),
    ]);
    let rows = c.data as BoardCard[] | null;
    let hasExtras = true;
    if (c.error && isMissing(c.error)) {
      // Sin la migración 014: todo menos completar, archivar y colores.
      hasExtras = false;
      const plain = await supabase
        .from("planner_board_cards")
        .select("*")
        .eq("board_id", id)
        .order("rank")
        .limit(5000);
      rows = plain.data as BoardCard[] | null;
    } else if (c.error) {
      if (current.current === id) setStatus("error");
      return;
    }
    if (current.current !== id) return;
    if (l.error) return setStatus("error");
    const cols = ((l.data ?? []) as Column[]).map(normalizeColumn);
    const raw = (l.data ?? []) as Record<string, unknown>[];
    const next = (rows ?? []).map(normalizeCard);
    live.current = { ...live.current, columns: cols, cards: next };
    setColumns(cols);
    setCards(next);
    setExtras(hasExtras);
    setPower(!raw.length || "rules" in raw[0]);
    setStatus("ready");
  }, []);

  useEffect(() => {
    live.current = { ...live.current, columns: [], cards: [] };
    setColumns([]);
    setCards([]);
    setStatus("loading");
    if (boardId) void load();
  }, [boardId, load]);

  const fail = useCallback(
    (e: { code?: string; message?: string }) => {
      if (isMissing016(e)) notify(missing016Text);
      else if (isMissingPower(e)) {
        setPower(false);
        notify(missingPowerText);
      } else if (/title_check/.test(e.message ?? ""))
        notify(
          `Para títulos sin límite ejecuta ${NO_LIMITS_SQL} en el SQL Editor de Supabase.`,
        );
      else if (isMissing(e)) {
        setExtras(false);
        notify(
          `Para completar, archivar y dar color ejecuta ${BOARD_SQL} en el SQL Editor de Supabase.`,
        );
      } else notify("No se pudo guardar: " + (e.message ?? "error"));
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
  const needPower = () => {
    if (live.current.power) return true;
    notify(missingPowerText);
    return false;
  };

  const sortedCards = (list: string, except?: (id: string) => boolean) =>
    live.current.cards
      .filter((c) => c.list_id === list && !except?.(c.id))
      .sort(byRank);
  const peek = (id: string) => live.current.cards.find((c) => c.id === id);
  const peekColumn = (id: string) =>
    live.current.columns.find((c) => c.id === id);

  // ── Columnas ──
  const addColumn = (name: string, index: number) => {
    if (!boardId) return null;
    const others = [...live.current.columns].sort(byRank);
    const col = normalizeColumn({
      id: crypto.randomUUID(),
      board_id: boardId,
      name: name.trim().slice(0, 120),
      rank: rankAt(
        others.map((c) => c.rank),
        index,
      ),
    });
    putColumns((v) => [...v, col]);
    const { color: _c, rules: _r, ...row } = col;
    enqueue([col.id], () =>
      check(supabase.from("board_lists").insert(row)),
    ).catch(fail);
    return col;
  };
  const updateColumn = (
    id: string,
    changes: Partial<Pick<Column, "name" | "color" | "rank" | "rules">>,
  ) => {
    if ("color" in changes && !needExtras()) return;
    if ("rules" in changes && !needPower()) return;
    putColumns((v) => v.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    enqueue([id], () =>
      check(supabase.from("board_lists").update(changes).eq("id", id)),
    ).catch(fail);
  };
  const moveColumn = (id: string, index: number) => {
    const others = live.current.columns.filter((c) => c.id !== id).sort(byRank);
    let ranks = others.map((c) => c.rank);
    if (crowded(ranks)) {
      // Renumera todas para que quepa la nueva posición.
      others.forEach(
        (c, i) =>
          c.rank !== (i + 1) * 1024 &&
          updateColumn(c.id, { rank: (i + 1) * 1024 }),
      );
      ranks = others.map((_, i) => (i + 1) * 1024);
    }
    updateColumn(id, { rank: rankAt(ranks, index) });
  };
  /** Lleva una columna (con todas sus tarjetas, también las archivadas) a otro tablero. */
  const moveColumnToBoard = (id: string, board: string, rank: number) => {
    putColumns((v) => v.filter((c) => c.id !== id));
    putCards((v) => v.filter((c) => c.list_id !== id));
    enqueue([id], () =>
      check(
        supabase
          .from("board_lists")
          .update({ board_id: board, rank })
          .eq("id", id),
      ),
    ).catch(fail);
  };
  const deleteColumn = (id: string) => {
    const gone = live.current.cards
      .filter((c) => c.list_id === id)
      .map((c) => c.id);
    putColumns((v) => v.filter((c) => c.id !== id));
    putCards((v) => v.filter((c) => c.list_id !== id));
    enqueue([id, ...gone], () =>
      check(supabase.from("board_lists").delete().eq("id", id)),
    ).catch(fail);
  };
  /** Deshace el borrado de columnas: vuelven con sus tarjetas (también las archivadas). */
  const restoreColumns = (snap: Snapshot) => {
    const ids = snap.lists.map((l) => l.id as string);
    const cols = snap.lists
      .filter((l) => l.board_id === current.current)
      .map((l) => normalizeColumn(l as Column));
    const back = snap.cards
      .filter((c) => !c.archived_at && ids.includes(c.list_id as string))
      .map((c) => normalizeCard(c as BoardCard));
    putColumns((v) => [...v.filter((c) => !ids.includes(c.id)), ...cols]);
    putCards((v) => [
      ...v.filter((c) => !back.some((b) => b.id === c.id)),
      ...back,
    ]);
    return enqueue(ids, () => restoreRows(snap)).catch((e) => {
      fail(e);
      throw e;
    });
  };

  // ── Tarjetas ──
  /**
   * Añade tarjetas al final de una columna (una por título). «Regar las plantas cada lunes»
   * nace con su fecha y repitiéndose cada lunes.
   */
  const addCards = (list: string, items: NewCardInput[]) => {
    const clean = items
      .map((i) => (typeof i === "string" ? { title: i } : i))
      .map((i) => ({
        ...i,
        title: i.title.trim(),
        body: (i.body ?? "").trim(),
      }))
      .filter((i) => i.title);
    if (!clean.length) return [];
    let last = sortedCards(list).at(-1)?.rank ?? 0;
    const now = new Date().toISOString();
    const made = clean.map((item) => {
      last += 1024;
      const rep = parseRepeat(item.title);
      return normalizeCard({
        id: crypto.randomUUID(),
        list_id: list,
        title: rep?.title ?? item.title,
        body: item.body,
        tags: item.tags ?? [],
        checks: [],
        rank: last,
        due: rep?.due ?? null,
        entry_id: null,
        episode_id: null,
        person_id: null,
        reading_id: null,
        note_id: null,
        repeat: rep?.rule ?? "",
        priority: item.priority ?? "",
        highlight: Boolean(item.highlight),
        created_at: now,
        touched_at: now,
        list_since: now,
      });
    });
    putCards((v) => [...v, ...made]);
    for (const c of made) {
      enqueue([list, c.id], () =>
        check(
          supabase.from("board_cards").insert({
            id: c.id,
            list_id: list,
            title: c.title,
            rank: c.rank,
            ...(c.body && { body: c.body }),
            ...(c.due && { due: c.due }),
            ...(c.tags.length && { tags: c.tags }),
          }),
        ),
      ).catch(fail);
      // Aparte: sin la migración 016 la tarjeta igual se guarda (sin repetirse).
      if (c.repeat)
        enqueue([c.id], () =>
          check(
            supabase
              .from("board_cards")
              .update({ repeat: c.repeat })
              .eq("id", c.id),
          ),
        ).catch(fail);
      // Y sin la migración nueva, igual (sin prioridad ni resaltado).
      if (c.priority || c.highlight)
        enqueue([c.id], () =>
          check(
            supabase
              .from("board_cards")
              .update({
                ...(c.priority && { priority: c.priority }),
                ...(c.highlight && { highlight: true }),
              })
              .eq("id", c.id),
          ),
        ).catch(fail);
    }
    return made;
  };
  const patchCard = (id: string, changes: CardChanges) => {
    const keys = Object.keys(changes);
    if (keys.some((k) => EXTRA.has(k)) && !needExtras()) return;
    if (keys.some((k) => POWER.has(k)) && !needPower()) return;
    const now = new Date().toISOString();
    const before = peek(id);
    const local: Partial<BoardCard> = { ...changes };
    if (keys.some((k) => k !== "rank")) local.touched_at = now;
    if (changes.list_id && before && before.list_id !== changes.list_id)
      local.list_since = now;
    putCards((v) => v.map((c) => (c.id === id ? { ...c, ...local } : c)));
    const ids = changes.list_id ? [id, changes.list_id] : [id];
    enqueue(ids, () =>
      check(supabase.from("board_cards").update(changes).eq("id", id)),
    ).catch(fail);
  };
  /** Como `patchCard`, pero solo si la tarjeta sigue en el tablero (no se archivó ni se borró). */
  const patchIfPresent = (id: string, changes: CardChanges) => {
    if (!peek(id)) return false;
    patchCard(id, changes);
    return true;
  };
  /**
   * Lleva varias tarjetas (en ese orden) a `list`, a partir de la posición `index` de las que ya
   * están ahí. Una sola tarjeta es lo mismo con una.
   */
  const moveCards = (ids: string[], list: string, index: number) => {
    const moving = ids
      .map((id) => peek(id))
      .filter((c): c is BoardCard => Boolean(c));
    if (!moving.length) return;
    const set = new Set(moving.map((c) => c.id));
    const others = sortedCards(list, (id) => set.has(id));
    const at = Math.max(0, Math.min(index, others.length));
    const n = moving.length;
    let ranks = others.map((c) => c.rank);
    const lo = at > 0 ? ranks[at - 1] : null;
    const hi = at < ranks.length ? ranks[at] : null;
    let next: number[];
    if (lo === null && hi === null) next = moving.map((_, i) => (i + 1) * 1024);
    else if (lo === null) next = moving.map((_, i) => hi! - (n - i) * 1024);
    else if (hi === null) next = moving.map((_, i) => lo + (i + 1) * 1024);
    else {
      const step = (hi - lo) / (n + 1);
      next = moving.map((_, i) => lo + step * (i + 1));
      if (step < 1e-6 || crowded(ranks)) {
        // Sin sitio: se renumera la columna entera.
        const order = [...others.slice(0, at), ...moving, ...others.slice(at)];
        order.forEach((c, i) => {
          const r = (i + 1) * 1024;
          if (set.has(c.id)) return;
          if (c.rank !== r) patchCard(c.id, { rank: r });
        });
        ranks = order.map((_, i) => (i + 1) * 1024);
        next = moving.map((_, i) => ranks[at + i]);
      }
    }
    moving.forEach((c, i) => {
      const rank = next[i];
      if (c.list_id === list && c.rank === rank) return;
      patchCard(c.id, c.list_id === list ? { rank } : { list_id: list, rank });
    });
  };
  const moveCard = (id: string, list: string, index: number) =>
    moveCards([id], list, index);
  /** Reordena una columna (por fecha o por nombre): un solo cambio de rango por tarjeta. */
  const reorder = (ordered: BoardCard[]) =>
    ordered.forEach(
      (c, i) =>
        c.rank !== (i + 1) * 1024 && patchCard(c.id, { rank: (i + 1) * 1024 }),
    );

  /** La quita del tablero y la borra; devuelve la tarjeta para poder deshacerlo. */
  const deleteCard = (id: string) => {
    const card = peek(id) ?? null;
    putCards((v) => v.filter((c) => c.id !== id));
    enqueue([id], () =>
      check(supabase.from("board_cards").delete().eq("id", id)),
    ).catch(fail);
    return card;
  };
  /** Vuelve a crear una tarjeta borrada (Deshacer), con el mismo id. */
  const restoreCard = (card: BoardCard) => {
    if (!peekColumn(card.list_id)) return;
    putCards((v) => (v.some((c) => c.id === card.id) ? v : [...v, card]));
    enqueue([card.list_id, card.id], () =>
      check(
        supabase
          .from("board_cards")
          .insert(cardRow(card, live.current.extras, live.current.power)),
      ),
    ).catch(fail);
  };
  /** Archiva: sale de la columna y pasa a Archivados. */
  const archiveCard = (id: string) => {
    if (!needExtras()) return null;
    const card = peek(id) ?? null;
    const at = new Date().toISOString();
    putCards((v) => v.filter((c) => c.id !== id));
    enqueue([id], () =>
      check(
        supabase.from("board_cards").update({ archived_at: at }).eq("id", id),
      ),
    ).catch(fail);
    return card ? ({ ...card, archived_at: at } as BoardCard) : null;
  };
  /** Deshace el archivado (la tarjeta vuelve a su sitio). */
  const unarchiveCard = (card: BoardCard) => {
    putCards((v) =>
      v.some((c) => c.id === card.id)
        ? v
        : [...v, { ...card, archived_at: null }],
    );
    enqueue([card.id], () =>
      check(
        supabase
          .from("board_cards")
          .update({ archived_at: null })
          .eq("id", card.id),
      ),
    ).catch(fail);
  };

  return {
    columns: [...columns].sort(byRank),
    cards,
    status,
    extras,
    power,
    reload: load,
    peek,
    peekColumn,
    /** Las tarjetas tal como están ahora (no las del último pintado). */
    peekAll: () => live.current.cards,
    addColumn,
    updateColumn,
    moveColumn,
    moveColumnToBoard,
    deleteColumn,
    restoreColumns,
    addCards,
    patchCard,
    patchIfPresent,
    moveCard,
    moveCards,
    reorder,
    deleteCard,
    restoreCard,
    archiveCard,
    unarchiveCard,
  };
}
export type BoardApi = ReturnType<typeof useBoard>;

// ───────────────────────── Archivados ─────────────────────────

/** Se traen de a tantas: sin tope total. */
const ARCHIVE_PAGE = 1000;

export function useArchive(on: boolean, notify: Notify) {
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const run = useRef(0);
  const load = useCallback(async () => {
    const me = ++run.current;
    setLoading(true);
    const all: BoardCard[] = [];
    for (let n = 0; ; n += ARCHIVE_PAGE) {
      const { data, error } = await supabase
        .from("planner_board_cards")
        .select("*")
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false })
        .order("id")
        .range(n, n + ARCHIVE_PAGE - 1);
      if (me !== run.current) return;
      if (error) {
        setMissing(isMissing(error));
        setCards(all.length ? all : []);
        setLoading(false);
        return;
      }
      // Lo archivado dentro de una plantilla no cuenta.
      all.push(
        ...((data ?? []) as BoardCard[])
          .filter((c) => !c.board_is_template)
          .map(normalizeCard),
      );
      // Se muestra lo que ya llegó mientras viene el resto.
      setCards([...all]);
      if ((data ?? []).length < ARCHIVE_PAGE) break;
    }
    setMissing(false);
    setLoading(false);
  }, []);
  useEffect(() => {
    if (on) void load();
  }, [on, load]);
  const fail = (e: { message?: string }) => {
    notify(
      isMissing016(e)
        ? missing016Text
        : isMissingPower(e)
          ? missingPowerText
          : "No se pudo guardar: " + (e.message ?? "error"),
    );
    void load();
  };

  const patch = (id: string, changes: CardChanges) => {
    setCards(
      (v) => v?.map((c) => (c.id === id ? { ...c, ...changes } : c)) ?? v,
    );
    enqueue([id], () =>
      check(supabase.from("board_cards").update(changes).eq("id", id)),
    ).catch(fail);
  };
  const unarchive = (id: string) => {
    const card = cards?.find((c) => c.id === id) ?? null;
    setCards((v) => v?.filter((c) => c.id !== id) ?? v);
    enqueue([id], () =>
      check(
        supabase.from("board_cards").update({ archived_at: null }).eq("id", id),
      ),
    ).catch(fail);
    return card;
  };
  const rearchive = (card: BoardCard) => {
    setCards((v) =>
      v?.some((c) => c.id === card.id)
        ? v
        : [card, ...(v ?? [])].sort((a, b) =>
            (b.archived_at ?? "").localeCompare(a.archived_at ?? ""),
          ),
    );
    enqueue([card.id], () =>
      check(
        supabase
          .from("board_cards")
          .update({ archived_at: card.archived_at })
          .eq("id", card.id),
      ),
    ).catch(fail);
  };
  const remove = (id: string) => {
    const card = cards?.find((c) => c.id === id) ?? null;
    setCards((v) => v?.filter((c) => c.id !== id) ?? v);
    enqueue([id], () =>
      check(supabase.from("board_cards").delete().eq("id", id)),
    ).catch(fail);
    return card;
  };
  const restore = (card: BoardCard) => {
    setCards((v) =>
      v?.some((c) => c.id === card.id) ? v : [card, ...(v ?? [])],
    );
    enqueue([card.id], () =>
      // Viene de la base: trae los campos nuevos solo si existe la migración.
      check(
        supabase
          .from("board_cards")
          .insert(cardRow(card, true, "touched_at" in card)),
      ),
    ).catch(fail);
  };
  return {
    cards,
    missing,
    loading,
    reload: load,
    patch,
    unarchive,
    rearchive,
    remove,
    restore,
  };
}
export type ArchiveApi = ReturnType<typeof useArchive>;
