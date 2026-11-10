import { useEffect, useSyncExternalStore } from "react";
import { SUPABASE_KEY, SUPABASE_URL, supabase } from "../backend";
import { errorMessage } from "../lib/format";
import { cleanTags, subtree, type CapFolder, type Shot } from "./model";

const SHOTS = "screenshots";
const FOLDERS = "screenshot_folders";
const BASE_COLUMNS =
  "id,folder_id,name,note,tags,yis_id,src,url,thumb,width,height,size,mime,created_at,updated_at";
const SHOT_COLUMNS = BASE_COLUMNS + ",favorite,archived_at";
const FOLDER_COLUMNS = "id,parent_id,name,created_at,updated_at";
export const CAPTURAS_MIGRATION =
  "supabase/migrations/202611100006_screenshots.sql";
export const FAVORITES_MIGRATION =
  "supabase/migrations/202611100007_screenshot_favorites.sql";
export const CAPTURAS_ENDPOINT = SUPABASE_URL + "/functions/v1/screenshots";

type State = {
  folders: CapFolder[] | null;
  shots: Shot[] | null;
  missing: boolean;
  error: string;
  /** Capturas que faltan por borrar de YourImageShare (se borran por detrás). */
  purging: number;
  /** Faltan las columnas `favorite` y `archived_at` (migración 0007 sin aplicar). */
  legacy: boolean;
};

/** Una sola copia en memoria: el formulario de subida y la pestaña ven lo mismo. */
let state: State = {
  folders: null,
  shots: null,
  missing: false,
  error: "",
  purging: 0,
  legacy: false,
};
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
export const capturasState = () => state;

let owner: string | null = null;
supabase.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id ?? null;
  if (event === "SIGNED_OUT" || (owner && next && next !== owner)) {
    loading = null;
    set({
      folders: null,
      shots: null,
      missing: false,
      error: "",
      purging: 0,
      legacy: false,
    });
    if (next && subs.size) void loadCapturas();
  }
  owner = next;
});

function isMissingTable(e: unknown) {
  const { code = "", message = "" } = (e ?? {}) as {
    code?: string;
    message?: string;
  };
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (/screenshot/.test(message) &&
      /does not exist|schema cache|find the table/i.test(message))
  );
}

function isMissingColumn(e: unknown) {
  const { code = "", message = "" } = (e ?? {}) as {
    code?: string;
    message?: string;
  };
  return (
    code === "42703" ||
    (/favorite|archived_at/.test(message) &&
      /does not exist|schema cache|find the/i.test(message))
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export const toShot = (r: Record<string, unknown>): Shot => ({
  id: String(r.id),
  folder_id: r.folder_id ? String(r.folder_id) : null,
  name: str(r.name) || "Captura",
  note: str(r.note),
  tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
  yis_id: str(r.yis_id),
  src: str(r.src),
  url: str(r.url) || str(r.src),
  thumb: str(r.thumb) || null,
  width: num(r.width),
  height: num(r.height),
  size: num(r.size) ?? 0,
  mime: str(r.mime),
  favorite: r.favorite === true,
  archived_at: str(r.archived_at) || null,
  created_at: str(r.created_at),
  updated_at: str(r.updated_at) || str(r.created_at),
});

const toFolder = (r: Record<string, unknown>): CapFolder => ({
  id: String(r.id),
  parent_id: r.parent_id ? String(r.parent_id) : null,
  name: str(r.name) || "Carpeta",
  created_at: str(r.created_at),
  updated_at: str(r.updated_at) || str(r.created_at),
});

/** PostgREST devuelve hasta 1000 filas por consulta: se piden por páginas. */
async function allShots(columns = SHOT_COLUMNS) {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabase
      .from(SHOTS)
      .select(columns)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Sin la migración de favoritas todavía funciona todo lo demás. */
async function allShotsOrLegacy() {
  try {
    return { rows: await allShots(), legacy: false };
  } catch (e) {
    if (!isMissingColumn(e)) throw e;
    return { rows: await allShots(BASE_COLUMNS), legacy: true };
  }
}

export function loadCapturas(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const [folders, shots] = await Promise.all([
        supabase.from(FOLDERS).select(FOLDER_COLUMNS).limit(2000),
        allShotsOrLegacy(),
      ]);
      if (folders.error) throw folders.error;
      set({
        folders: (folders.data ?? []).map(toFolder),
        shots: shots.rows.map(toShot),
        missing: false,
        error: "",
        legacy: shots.legacy,
      });
      // Si quedó algo por borrar de YourImageShare (p. ej. cerraste la pestaña), se termina ahora.
      const { count } = await supabase
        .from(SHOTS)
        .select("id", { count: "exact", head: true })
        .not("deleted_at", "is", null);
      if (count) void purgeTrash();
    } catch (e) {
      if (isMissingTable(e))
        set({ folders: [], shots: [], missing: true, error: "" });
      else
        set({
          folders: state.folders ?? [],
          shots: state.shots ?? [],
          error: errorMessage(e),
        });
    }
  })();
  return loading;
}

/** Una captura recién subida (la fila ya la guardó la función). */
export function addShot(shot: Shot) {
  if (!state.shots) return;
  if (state.shots.some((s) => s.id === shot.id)) return;
  set({ shots: [shot, ...state.shots] });
}

const now = () => new Date().toISOString();

export async function createFolder(
  name: string,
  parent_id: string | null,
): Promise<CapFolder | string> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return "Ponle un nombre a la carpeta.";
  const { data, error } = await supabase
    .from(FOLDERS)
    .insert({ name: clean, parent_id })
    .select(FOLDER_COLUMNS)
    .single();
  if (error || !data) {
    if (isMissingTable(error)) set({ missing: true });
    return error ? errorMessage(error) : "No se pudo crear la carpeta.";
  }
  const folder = toFolder(data);
  set({ folders: [...(state.folders ?? []), folder] });
  return folder;
}

export async function renameFolder(
  id: string,
  name: string,
): Promise<true | string> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return "Ponle un nombre a la carpeta.";
  const before = state.folders ?? [];
  const updated_at = now();
  set({
    folders: before.map((f) =>
      f.id === id ? { ...f, name: clean, updated_at } : f,
    ),
  });
  const { error } = await supabase
    .from(FOLDERS)
    .update({ name: clean, updated_at })
    .eq("id", id);
  if (error) {
    set({ folders: before });
    return errorMessage(error);
  }
  return true;
}

/**
 * Mueve carpetas y capturas a `target` (null: la raíz). Una carpeta no puede entrar en sí misma ni
 * en una de las suyas: esas se omiten. Devuelve cuántas se movieron o el motivo del fallo.
 */
export async function moveItems(
  { folders = [], shots = [] }: { folders?: string[]; shots?: string[] },
  target: string | null,
): Promise<number | string> {
  const allFolders = state.folders ?? [];
  const blocked = target ? subtree(allFolders, folders) : new Set<string>();
  const movingFolders = folders.filter(
    (id) =>
      !(target && blocked.has(target)) &&
      allFolders.find((f) => f.id === id)?.parent_id !== target &&
      id !== target,
  );
  const movingShots = shots.filter(
    (id) => (state.shots ?? []).find((s) => s.id === id)?.folder_id !== target,
  );
  if (!movingFolders.length && !movingShots.length) return 0;
  const beforeF = allFolders;
  const beforeS = state.shots ?? [];
  const updated_at = now();
  const fset = new Set(movingFolders);
  const sset = new Set(movingShots);
  set({
    folders: beforeF.map((f) =>
      fset.has(f.id) ? { ...f, parent_id: target, updated_at } : f,
    ),
    shots: beforeS.map((s) =>
      sset.has(s.id) ? { ...s, folder_id: target, updated_at } : s,
    ),
  });
  const jobs = [];
  if (movingFolders.length)
    jobs.push(
      supabase
        .from(FOLDERS)
        .update({ parent_id: target, updated_at })
        .in("id", movingFolders),
    );
  for (let i = 0; i < movingShots.length; i += 200)
    jobs.push(
      supabase
        .from(SHOTS)
        .update({ folder_id: target, updated_at })
        .in("id", movingShots.slice(i, i + 200)),
    );
  const results = await Promise.all(jobs);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    set({ folders: beforeF, shots: beforeS });
    return errorMessage(failed.error);
  }
  return movingFolders.length + movingShots.length;
}

export async function updateShot(
  id: string,
  changes: Partial<Pick<Shot, "name" | "note" | "tags">>,
): Promise<true | string> {
  const before = state.shots?.find((s) => s.id === id);
  if (!before) return "Esa captura ya no existe.";
  const clean = {
    ...(changes.name !== undefined && {
      name: changes.name.trim().slice(0, 200) || before.name,
    }),
    ...(changes.note !== undefined && { note: changes.note.slice(0, 4000) }),
    ...(changes.tags !== undefined && { tags: cleanTags(changes.tags) }),
  };
  const updated_at = now();
  set({
    shots: (state.shots ?? []).map((s) =>
      s.id === id ? { ...s, ...clean, updated_at } : s,
    ),
  });
  const { error } = await supabase
    .from(SHOTS)
    .update({ ...clean, updated_at })
    .eq("id", id);
  if (error) {
    const cur = state.shots?.find((s) => s.id === id);
    if (cur?.updated_at === updated_at)
      set({
        shots: (state.shots ?? []).map((s) => (s.id === id ? before : s)),
      });
    return errorMessage(error);
  }
  return true;
}

/**
 * Marca o desmarca capturas como favoritas o archivadas (al instante; si falla, vuelve atrás).
 * Devuelve las que cambiaron (para «Deshacer») o el motivo del fallo.
 */
async function flagShots(
  ids: string[],
  changes: { favorite: boolean } | { archived_at: string | null },
): Promise<string[] | string> {
  if (state.legacy)
    return `Falta aplicar ${FAVORITES_MIGRATION} en Supabase.`;
  const wanted = new Set(ids);
  const before = state.shots ?? [];
  const key = "favorite" in changes ? "favorite" : "archived_at";
  const changing = before.filter(
    (s) =>
      wanted.has(s.id) &&
      (key === "favorite"
        ? s.favorite !== (changes as { favorite: boolean }).favorite
        : Boolean(s.archived_at) !==
          Boolean((changes as { archived_at: string | null }).archived_at)),
  );
  if (!changing.length) return [];
  const touched = new Set(changing.map((s) => s.id));
  const updated_at = now();
  set({
    shots: before.map((s) =>
      touched.has(s.id) ? { ...s, ...changes, updated_at } : s,
    ),
  });
  const list = [...touched];
  for (let i = 0; i < list.length; i += 200) {
    const { error } = await supabase
      .from(SHOTS)
      .update({ ...changes, updated_at })
      .in("id", list.slice(i, i + 200));
    if (error) {
      const back = new Map(changing.map((s) => [s.id, s]));
      set({
        shots: (state.shots ?? []).map((s) => back.get(s.id) ?? s),
        ...(isMissingColumn(error) && { legacy: true }),
      });
      return isMissingColumn(error)
        ? `Falta aplicar ${FAVORITES_MIGRATION} en Supabase.`
        : errorMessage(error);
    }
  }
  return list;
}

export const setFavorite = (ids: string[], favorite: boolean) =>
  flagShots(ids, { favorite });
export const setArchived = (ids: string[], archived: boolean) =>
  flagShots(ids, { archived_at: archived ? now() : null });

/** Dónde estaba cada cosa antes de moverla (para «Deshacer»). */
export type Locations = {
  folders: [string, string | null][];
  shots: [string, string | null][];
};
export function locationsOf(folderIds: string[], shotIds: string[]): Locations {
  const f = new Map((state.folders ?? []).map((x) => [x.id, x.parent_id]));
  const s = new Map((state.shots ?? []).map((x) => [x.id, x.folder_id]));
  return {
    folders: folderIds.filter((id) => f.has(id)).map((id) => [id, f.get(id)!]),
    shots: shotIds.filter((id) => s.has(id)).map((id) => [id, s.get(id)!]),
  };
}
/** Devuelve cada cosa a donde estaba. */
export async function restoreLocations(
  loc: Locations,
): Promise<number | string> {
  const groups = new Map<string, { folders: string[]; shots: string[] }>();
  const at = (target: string | null) => {
    const k = target ?? "";
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { folders: [], shots: [] }));
    return g;
  };
  for (const [id, parent] of loc.folders) at(parent).folders.push(id);
  for (const [id, folder] of loc.shots) at(folder).shots.push(id);
  let moved = 0;
  for (const [k, g] of groups) {
    const res = await moveItems(g, k || null);
    if (typeof res === "string") return res;
    moved += res;
  }
  return moved;
}

/**
 * Borra carpetas (con todo lo que tienen dentro) y capturas. Desaparecen al instante; las imágenes
 * se borran de YourImageShare por detrás. Devuelve cuántas capturas se van a borrar.
 */
export async function removeItems({
  folders = [],
  shots = [],
}: {
  folders?: string[];
  shots?: string[];
}): Promise<number | string> {
  const beforeF = state.folders ?? [];
  const beforeS = state.shots ?? [];
  const goneFolders = subtree(beforeF, folders);
  const goneShots = new Set(shots);
  for (const s of beforeS)
    if (s.folder_id && goneFolders.has(s.folder_id)) goneShots.add(s.id);
  set({
    folders: beforeF.filter((f) => !goneFolders.has(f.id)),
    shots: beforeS.filter((s) => !goneShots.has(s.id)),
  });
  const ids = [...goneShots];
  const deleted_at = now();
  // Primero se marcan las capturas (así, al borrar la carpeta, no quedan huérfanas a la vista).
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase
      .from(SHOTS)
      .update({ deleted_at })
      .in("id", ids.slice(i, i + 200));
    if (error) {
      set({ folders: beforeF, shots: beforeS });
      return errorMessage(error);
    }
  }
  // Solo las de arriba: las de dentro caen en cascada.
  const tops = folders.filter((id) => {
    const parent = beforeF.find((f) => f.id === id)?.parent_id;
    return !parent || !goneFolders.has(parent);
  });
  if (tops.length) {
    const { error } = await supabase.from(FOLDERS).delete().in("id", tops);
    if (error) {
      set({ folders: beforeF });
      return errorMessage(error);
    }
  }
  if (ids.length) {
    set({ purging: state.purging + ids.length });
    void purgeTrash();
  }
  return ids.length;
}

let purgingNow: Promise<void> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pide a la función que borre de YourImageShare lo marcado, en tandas, hasta terminar. */
export function purgeTrash() {
  if (purgingNow) return purgingNow;
  purgingNow = (async () => {
    try {
      for (let round = 0; round < 200; round++) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch(CAPTURAS_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            apikey: SUPABASE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "purge" }),
        }).catch(() => null);
        if (!res?.ok) return;
        const body = (await res.json().catch(() => null)) as {
          purged?: number;
          remaining?: number;
          retryAfter?: number;
        } | null;
        const remaining = body?.remaining ?? 0;
        set({ purging: remaining });
        if (!remaining) return;
        if (body?.retryAfter) await sleep(body.retryAfter * 1000 + 300);
        // Nada borrado y sin espera: YourImageShare falla con esas. Se reintenta en la próxima carga.
        else if (!body?.purged) return;
      }
    } finally {
      purgingNow = null;
      // Lo que falte se termina en la próxima carga.
      set({ purging: 0 });
    }
  })();
  return purgingNow;
}

/** Carpetas y capturas (se cargan la primera vez que alguien las pide). */
export function useCapturas() {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!state.shots) void loadCapturas();
  }, []);
  return snap;
}

/** Igual, pero solo carga cuando `active` (p. ej. el buscador global al escribir). */
export function useCapturasWhen(active: boolean) {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (active && !state.shots) void loadCapturas();
  }, [active]);
  return snap;
}
