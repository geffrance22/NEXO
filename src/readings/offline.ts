import { supabase } from "../backend";

/**
 * Lecturas sin conexión (celular).
 *
 * - Copia en el teléfono (IndexedDB) de lo último de «Por leer»: el artículo entero, con sus
 *   imágenes comprimidas (`media`) y sus resaltados. Se renueva sola mientras hay conexión.
 * - Lo que cambias en Lecturas (resaltar, notas, favorito, leído, archivar, dónde ibas…) pasa por
 *   `write`: con conexión va directo a la base; sin ella queda en una cola en el teléfono y se
 *   envía en orden en cuanto vuelve. La copia local se actualiza siempre, así lo que ves offline
 *   es lo último que hiciste.
 *
 * Cada cuenta tiene su propia base en el teléfono, y se borra al cerrar sesión.
 */

type Row = Record<string, unknown> & { id: string };
type Table = "readings" | "reading_marks";
export type Op = {
  table: Table;
  action: "insert" | "update" | "delete";
  /** La fila que cambia. */
  id: string;
  /** El artículo al que pertenece (para la copia local). */
  reading: string;
  values?: Record<string, unknown>;
};
type Stored = { id: string; article: Row; marks: Row[]; card: Row | null; savedAt: number };
type Problem = { message: string; code?: string; status?: number; name?: string };

/** Avisos para la pantalla: la copia cambió (`CHANGED`) o se envió la cola (`SYNCED`, con cuántos). */
export const OFFLINE_CHANGED = "nexo:offline-changed";
export const OFFLINE_SYNCED = "nexo:readings-synced";
/** Cuántos artículos de «Por leer» se guardan (los más recientes, más los fijados). */
export const OFFLINE_LIMIT = 50;

// ─────────────── Errores ───────────────

/** ¿Falló por la conexión (y no porque la base lo rechazara)? */
export function isNetworkError(e: unknown) {
  if (!navigator.onLine) return true;
  const err = e as Partial<Problem> | null | undefined;
  const text = `${err?.name ?? ""} ${err?.message ?? (typeof e === "string" ? e : "")}`;
  return /Failed to fetch|NetworkError|Load failed|network request failed|fetch failed|ERR_INTERNET|ERR_NETWORK|AuthRetryableFetchError|^\s*(TypeError|AbortError)\b/i.test(
    text,
  );
}
/** Sesión vencida o sin renovar todavía: se reintenta después, no se descarta. */
const isAuthError = (e: Problem) =>
  e.status === 401 || e.code === "PGRST301" || e.code === "PGRST303" || /JWT/i.test(e.message);

// ─────────────── Base local ───────────────

let owner = "";
let opened: Promise<IDBDatabase> | null = null;
const dbName = (uid: string) => `nexo-offline-${uid}`;

/** La cuenta con sesión (cada una tiene su copia). */
export function setOfflineOwner(uid: string) {
  if (uid === owner) return;
  owner = uid;
  opened = null;
  queue = null;
}

function db(): Promise<IDBDatabase> {
  if (!owner || typeof indexedDB === "undefined")
    return Promise.reject(Error("Sin almacenamiento local."));
  opened ??= new Promise<IDBDatabase>((done, fail) => {
    const req = indexedDB.open(dbName(owner), 1);
    req.onupgradeneeded = () => {
      const base = req.result;
      if (!base.objectStoreNames.contains("articles"))
        base.createObjectStore("articles", { keyPath: "id" });
      if (!base.objectStoreNames.contains("meta")) base.createObjectStore("meta");
    };
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  }).catch((e) => {
    opened = null;
    throw e;
  });
  return opened;
}

async function inStore<T>(
  store: "articles" | "meta",
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  const base = await db();
  return new Promise<T>((done, fail) => {
    const tx = base.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    let result: T;
    if (req) req.onsuccess = () => (result = req.result);
    tx.oncomplete = () => done(result);
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error);
  });
}

const getStored = (id: string) =>
  inStore<Stored | undefined>("articles", "readonly", (s) => s.get(id));
const allStored = () => inStore<Stored[]>("articles", "readonly", (s) => s.getAll());
const putStored = (rec: Stored) => inStore("articles", "readwrite", (s) => void s.put(rec));
const dropStored = (id: string) => inStore("articles", "readwrite", (s) => void s.delete(id));

const changed = () => window.dispatchEvent(new Event(OFFLINE_CHANGED));

/** ¿Va en «Por leer»? (lo mismo que `reading_list` con `inbox`). */
const inInbox = (a: Row) => !a.archived && !a.folder && !a.read_at;

// ─────────────── Copia de los artículos ───────────────

/** El artículo y sus resaltados tal como quedaron en el teléfono. */
export async function offlineArticle<A, M>(id: string) {
  const rec = await getStored(id).catch(() => undefined);
  return rec ? { article: rec.article as A, marks: rec.marks as M[] } : null;
}

/**
 * Lo que acabas de abrir con conexión: si es de «Por leer» (o ya estaba guardado) se guarda o se
 * renueva su copia. Si la cola tiene cambios suyos sin enviar, sus resaltados de aquí mandan.
 */
export async function rememberArticle(article: Row, marks: Row[]) {
  try {
    const rec = await getStored(article.id);
    if (!rec && !inInbox(article)) return;
    const busy = (await pendingOps()).some((o) => o.reading === article.id);
    await putStored({
      id: article.id,
      article,
      marks: busy && rec ? rec.marks : marks,
      card: rec?.card ?? null,
      savedAt: Date.now(),
    });
  } catch {
    /* sin almacenamiento: se sigue leyendo con conexión */
  }
}

/** Tarjetas de «Por leer» guardadas en el teléfono, como las da `reading_list`. */
export async function offlineCards<C>(): Promise<C[]> {
  const all = await allStored().catch(() => [] as Stored[]);
  return all
    .filter((r) => inInbox(r.article))
    .map((r) => {
      const a = r.article;
      const len = Math.max(1, String(a.content ?? "").length);
      const resume = Number(a.resume_at) || 0;
      const cover = ((r.card?.cover ?? a.cover) as string | null | undefined) ?? null;
      const media = (a.media ?? {}) as Record<string, string>;
      return {
        // Guardado al abrirlo (aún sin tarjeta de la lista): lo calculado por la base va en la fila.
        excerpt: a.excerpt ?? "",
        minutes: a.minutes ?? 1,
        ...r.card,
        id: a.id,
        url: a.url,
        title: a.title,
        folder: a.folder,
        archived: a.archived,
        favorite: a.favorite,
        tags: a.tags ?? [],
        created_at: a.created_at,
        pinned_at: a.pinned_at ?? null,
        read_at: a.read_at ?? null,
        opened_at: a.opened_at ?? null,
        mark_count: r.marks.length,
        // Sin conexión, la portada solo si su copia comprimida va dentro del artículo.
        cover: cover ? (media[cover] ?? null) : null,
        progress:
          !a.last_read || resume <= 0
            ? null
            : Math.min(100, Math.max(1, Math.round((100 * resume) / len))),
      } as C;
    })
    .sort((x, y) => {
      const a = x as Row & { created_at: string };
      const b = y as Row & { created_at: string };
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1;
    });
}

/** Aplica un cambio a la copia del teléfono (con o sin conexión). */
async function applyLocal(op: Op) {
  const rec = await getStored(op.reading);
  if (!rec) return;
  if (op.table === "readings") {
    if (op.action === "delete") {
      await dropStored(op.reading);
      return;
    }
    rec.article = { ...rec.article, ...op.values };
    if (rec.card) {
      const card = { ...rec.card };
      for (const k of Object.keys(op.values ?? {})) if (k in card) card[k] = op.values![k];
      rec.card = card;
    }
  } else if (op.action === "insert") {
    rec.marks = [...rec.marks.filter((m) => m.id !== op.id), { ...op.values, id: op.id } as Row];
  } else if (op.action === "update") {
    rec.marks = rec.marks.map((m) => (m.id === op.id ? { ...m, ...op.values } : m));
  } else {
    rec.marks = rec.marks.filter((m) => m.id !== op.id);
  }
  await putStored(rec);
}

// ─────────────── Cola de cambios ───────────────

let queue: Op[] | null = null;
/** El cambio que se está enviando ahora (no se une con otros). */
let sending: Op | null = null;

async function pendingOps(): Promise<Op[]> {
  if (!queue)
    queue = ((await inStore<Op[] | undefined>("meta", "readonly", (s) => s.get("queue"))) ??
      []) as Op[];
  return queue;
}
async function saveQueue() {
  await inStore("meta", "readwrite", (s) => void s.put(queue ?? [], "queue"));
  window.dispatchEvent(new CustomEvent(OFFLINE_CHANGED, { detail: { pending: queue?.length ?? 0 } }));
}

/** Cuántos cambios esperan conexión. */
export async function pendingCount() {
  return (await pendingOps().catch(() => [])).length;
}

/**
 * A la cola. Si el último cambio de esa misma fila aún no salió, se une con él (cinco cambios de
 * «dónde ibas» son uno; crear y borrar un resaltado sin conexión no envía nada).
 */
async function enqueue(op: Op) {
  const ops = await pendingOps();
  let at = -1;
  for (let i = ops.length - 1; i >= 0; i--)
    if (ops[i].table === op.table && ops[i].id === op.id) {
      at = i;
      break;
    }
  const last = at >= 0 && ops[at] !== sending ? ops[at] : null;
  if (last && op.action === "update" && last.action !== "delete")
    ops[at] = { ...last, values: { ...last.values, ...op.values } };
  else if (last && op.action === "delete" && last.action === "insert")
    queue = ops.filter((o) => !(o.table === op.table && o.id === op.id));
  else ops.push(op);
  await saveQueue();
}

async function send(op: Op): Promise<Problem | null> {
  const t = supabase.from(op.table);
  const { error, status } =
    op.action === "insert"
      ? await t.insert({ ...op.values, id: op.id })
      : op.action === "update"
        ? await t.update(op.values ?? {}).eq("id", op.id)
        : await t.delete().eq("id", op.id);
  if (!error) return null;
  // Ya había llegado (se perdió la respuesta): está bien así.
  if (op.action === "insert" && error.code === "23505") return null;
  return { ...error, status };
}

export type Written = { error: Problem | null; queued: boolean };

/**
 * Guarda un cambio de Lecturas: directo con conexión, a la cola sin ella (o si ya hay cambios en
 * cola, para que lleguen en orden). La copia del teléfono se actualiza en los dos casos.
 */
export async function write(op: Op): Promise<Written> {
  const ops = await pendingOps().catch(() => null);
  // Sin almacenamiento local no hay cola: solo con conexión.
  if (!ops) {
    const error = await send(op).catch((e: Problem) => e);
    return { error, queued: false };
  }
  if (!navigator.onLine || ops.length) {
    await enqueue(op);
    void applyLocal(op).then(changed, () => {});
    if (navigator.onLine) void flush();
    return { error: null, queued: true };
  }
  const error = await send(op).catch((e: Problem) => e);
  if (error && isNetworkError(error)) {
    await enqueue(op);
    void applyLocal(op).then(changed, () => {});
    retryLater();
    return { error: null, queued: true };
  }
  if (!error) void applyLocal(op).then(changed, () => {});
  return { error, queued: false };
}

let retry = 0;
function retryLater() {
  window.clearTimeout(retry);
  retry = window.setTimeout(() => void flush(), 20_000);
}

let flushing: Promise<number> | null = null;

/** Envía la cola en orden. Devuelve cuántos cambios salieron. */
export function flush(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!owner || !navigator.onLine) return 0;
    const ops = await pendingOps().catch(() => [] as Op[]);
    if (!ops.length) return 0;
    // La sesión pudo vencer sin conexión: se renueva antes de enviar nada.
    const { data } = await supabase.auth.getSession();
    if (!data.session) return 0;
    let sent = 0;
    let dropped = 0;
    while (queue?.length) {
      const op = queue[0];
      sending = op;
      const error = await send(op).catch((e: Problem) => e);
      sending = null;
      if (error && (isNetworkError(error) || isAuthError(error))) {
        retryLater();
        break;
      }
      // La base lo rechazó (p. ej. el artículo se borró en otro dispositivo): se descarta.
      if (error) dropped++;
      else sent++;
      queue = queue.filter((o) => o !== op);
      await saveQueue();
    }
    if (sent || dropped)
      window.dispatchEvent(new CustomEvent(OFFLINE_SYNCED, { detail: { sent, dropped } }));
    return sent;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// ─────────────── Renovar la copia de «Por leer» ───────────────

let refreshed = 0;
let refreshing: Promise<void> | null = null;
const signature = (c: Row) => [c.title, c.excerpt, c.minutes, c.cover].join("|");

/**
 * Trae lo último de «Por leer» al teléfono: los artículos nuevos o cambiados enteros (con sus
 * imágenes comprimidas) y los resaltados de todos. Lo que salió de «Por leer» se borra del
 * teléfono. Con conexión y como mucho cada 20 s.
 */
export function refreshInbox(): Promise<void> {
  if (!owner || !navigator.onLine) return Promise.resolve();
  if (refreshing) return refreshing;
  if (Date.now() - refreshed < 20_000) return Promise.resolve();
  refreshing = (async () => {
    // Primero lo que hiciste sin conexión, para no pisarlo con lo de la base.
    await flush();
    const [pins, ...pages] = await Promise.all([
      supabase.rpc("reading_pinned", { scope: "inbox", needle: "" }),
      supabase.rpc("reading_list", { scope: "inbox", needle: "", before_date: null, before_id: null }),
    ]);
    if (pages[0].error) throw pages[0].error;
    let rows = (pages[0].data ?? []) as Row[];
    // La segunda página, si hace falta para llegar al tope.
    if (rows.length === 32 && rows.length < OFFLINE_LIMIT) {
      const last = rows[rows.length - 1] as Row & { created_at: string };
      const next = await supabase.rpc("reading_list", {
        scope: "inbox",
        needle: "",
        before_date: last.created_at,
        before_id: last.id,
      });
      if (!next.error) rows = [...rows, ...((next.data ?? []) as Row[])];
    }
    const cards = new Map<string, Row>();
    for (const c of [...((pins.data ?? []) as Row[]), ...rows.slice(0, OFFLINE_LIMIT)])
      cards.set(c.id, c);

    const stored = new Map((await allStored()).map((r) => [r.id, r]));
    const busy = new Set((await pendingOps()).map((o) => o.reading));
    for (const id of stored.keys())
      if (!cards.has(id) && !busy.has(id)) await dropStored(id);

    // Enteros solo los nuevos o los que cambiaron (título, extracto, minutos o portada).
    const need = [...cards.values()]
      .filter((c) => {
        const rec = stored.get(c.id);
        return !rec || !rec.card || signature(rec.card) !== signature(c);
      })
      .map((c) => c.id);
    const fresh = new Map<string, Row>();
    for (let i = 0; i < need.length; i += 8) {
      const { data, error } = await supabase
        .from("readings")
        .select("*")
        .in("id", need.slice(i, i + 8));
      if (error) throw error;
      for (const a of (data ?? []) as Row[]) fresh.set(a.id, a);
    }

    // Los resaltados de todos (son pocos datos). Los que tienen cambios en cola se quedan como están.
    const ids = [...cards.keys()].filter((id) => !busy.has(id));
    const marks = new Map<string, Row[]>(ids.map((id) => [id, []]));
    for (let i = 0; i < ids.length; i += 40) {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("reading_marks")
          .select("*")
          .in("reading_id", ids.slice(i, i + 40))
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        for (const m of (data ?? []) as Row[]) marks.get(String(m.reading_id))?.push(m);
        if ((data ?? []).length < 1000) break;
      }
    }

    for (const [id, card] of cards) {
      const rec = stored.get(id);
      const base = fresh.get(id) ?? rec?.article;
      if (!base) continue;
      // Lo que cambia sin tocar el texto (favorito, fijado, etiquetas…) viene en la tarjeta.
      const article = busy.has(id)
        ? base
        : {
            ...base,
            title: card.title,
            favorite: card.favorite,
            tags: card.tags,
            pinned_at: card.pinned_at ?? null,
            opened_at: card.opened_at ?? base.opened_at ?? null,
          };
      await putStored({
        id,
        article: article as Row,
        marks: busy.has(id) ? (rec?.marks ?? []) : (marks.get(id) ?? rec?.marks ?? []),
        card,
        savedAt: Date.now(),
      });
    }
    refreshed = Date.now();
    changed();
    // Que el navegador no borre la copia para hacer espacio.
    void navigator.storage?.persist?.().catch(() => false);
  })()
    .catch(() => {
      /* sin conexión a mitad de camino: queda lo que había */
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Al cerrar sesión: se envía lo pendiente (si se puede) y se borra la copia del teléfono. */
export async function forgetOffline() {
  if (!owner) return;
  await flush().catch(() => 0);
  const name = dbName(owner);
  const base = await opened?.catch(() => null);
  base?.close();
  opened = null;
  queue = null;
  owner = "";
  await new Promise<void>((done) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => done();
  });
}
