import { useSyncExternalStore } from "react";
import { SUPABASE_KEY, supabase } from "../backend";
import { saveWebpPref, toWebp, webpPref } from "./compress";
import { MAX_SHOT_BYTES, imageFiles, nameForUpload } from "./model";
import { addShot, CAPTURAS_ENDPOINT, toShot } from "./useCapturas";
import type { Shot } from "./model";

/**
 * Cola de subidas de CAPTURAS. Vive fuera de React: sigue subiendo aunque cierres el formulario o
 * cambies de página, y la ventana flotante (abajo a la derecha) la muestra.
 */
export type UpStatus =
  "queued" | "uploading" | "waiting" | "done" | "error" | "canceled";
export type UpItem = {
  id: string;
  batch: string;
  file: File;
  name: string;
  size: number;
  /** Vista previa local (URL.createObjectURL). */
  preview: string;
  status: UpStatus;
  /** 0–1: lo enviado. Al llegar a 1, YourImageShare aún la está guardando. */
  progress: number;
  error: string;
  shot?: Shot;
  /** Convirtiéndose a WebP (antes de enviar). */
  compressing?: boolean;
  /** Ya se intentó pasar a WebP (no se repite al reintentar). */
  converted?: boolean;
  /** Peso antes de pasar a WebP (si se comprimió). */
  original?: number;
};
export type Batch = {
  id: string;
  folder_id: string | null;
  note: string;
  tags: string[];
  /** Pasar PNG y JPG a WebP antes de subir. */
  webp: boolean;
  /** `inline`: un solo archivo, se ve en el formulario; `tray`: en la ventana flotante. */
  mode: "inline" | "tray";
};
/**
 * «Guardar captura» minimizado abajo a la derecha: lo que se pegue, suelte o elija ahí se sube
 * directo a `folder_id`. `files`: lo que quedó elegido en el formulario sin subir.
 */
export type Draft = {
  files: File[];
  note: string;
  tags: string[];
  folder_id: string | null;
  /** El formulario está abierto en grande (desde la ventanita). */
  open: boolean;
};
export type ZipJob = {
  id: string;
  label: string;
  done: number;
  total: number;
  status: "working" | "packing" | "done" | "error" | "canceled";
  error: string;
  failed: number;
};

type State = {
  items: UpItem[];
  batches: Batch[];
  zips: ZipJob[];
  /** Hasta cuándo pidió esperar YourImageShare (límite de 20 subidas por minuto). */
  waitUntil: number;
  minimized: boolean;
  draft: Draft | null;
  /** Preferencia: comprimir a WebP (se recuerda). */
  webp: boolean;
};

let state: State = {
  items: [],
  batches: [],
  zips: [],
  waitUntil: 0,
  minimized: false,
  draft: null,
  webp: webpPref(),
};
const subs = new Set<() => void>();
function set(next: Partial<State>) {
  state = { ...state, ...next };
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
const patch = (id: string, changes: Partial<UpItem>) =>
  set({
    items: state.items.map((i) => (i.id === id ? { ...i, ...changes } : i)),
  });

export const useUploads = () => useSyncExternalStore(subscribe, () => state);
export const uploadsState = () => state;

const CONCURRENCY = 3;
/** YourImageShare deja 20 por minuto: se reparten antes de que tenga que frenar. */
const PER_MINUTE = 19;
const starts: number[] = [];
const controllers = new Map<string, AbortController>();
let timer: number | undefined;

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function enqueue(
  files: File[],
  opts: {
    folder_id: string | null;
    note: string;
    tags: string[];
    mode: "inline" | "tray";
    webp?: boolean;
  },
) {
  const batch: Batch = { id: uid(), ...opts, webp: opts.webp ?? state.webp };
  const stamp = new Date();
  const items: UpItem[] = files.map((file, i) => ({
    id: uid(),
    batch: batch.id,
    file,
    name: nameForUpload(file, files.length > 1 ? i : 0, stamp),
    size: file.size,
    preview: URL.createObjectURL(file),
    status: "queued",
    progress: 0,
    error: "",
  }));
  set({
    batches: [...state.batches, batch],
    items: [...state.items, ...items],
    minimized: opts.mode === "tray" ? false : state.minimized,
  });
  pump();
  return batch.id;
}

/** El formulario se cerró a mitad de una subida: sigue en la ventana flotante. */
export const toTray = (batch: string) =>
  set({
    batches: state.batches.map((b) =>
      b.id === batch ? { ...b, mode: "tray" } : b,
    ),
  });
export const setMinimized = (minimized: boolean) => set({ minimized });

export function setWebp(webp: boolean) {
  saveWebpPref(webp);
  set({ webp });
}

/** Lleva «Guardar captura» a la esquina (si ya había una ventanita, suma lo que tenía). */
export function minimizeDraft(next: Omit<Draft, "open">) {
  const files = [...(state.draft?.open ? [] : (state.draft?.files ?? []))];
  for (const f of next.files) if (!files.includes(f)) files.push(f);
  set({ draft: { ...next, files, open: false } });
}
export const expandDraft = () =>
  state.draft && set({ draft: { ...state.draft, open: true } });
export const closeDraft = () => set({ draft: null });
export const setDraftFolder = (folder_id: string | null) =>
  state.draft && set({ draft: { ...state.draft, folder_id } });

/**
 * Sube de una vez (sin formulario) lo pegado o soltado en la ventanita. Devuelve un aviso si se
 * omitió algo, o cadena vacía.
 */
export function quickUpload(list: File[], folder_id?: string | null) {
  const images = imageFiles(list);
  const ok = images.filter((f) => f.size <= MAX_SHOT_BYTES);
  const skipped = list.length - ok.length;
  if (ok.length)
    enqueue(ok, {
      folder_id:
        folder_id === undefined ? (state.draft?.folder_id ?? null) : folder_id,
      note: "",
      tags: state.draft?.tags ?? [],
      mode: "tray",
    });
  return skipped
    ? `Se omitieron ${skipped} ${skipped === 1 ? "archivo" : "archivos"} (no son imágenes o pasan de 60 MB).`
    : "";
}

export function cancelItem(id: string) {
  controllers.get(id)?.abort();
  const item = state.items.find((i) => i.id === id);
  if (item && (item.status === "queued" || item.status === "waiting"))
    patch(id, { status: "canceled", progress: 0 });
}
export function cancelAll() {
  for (const i of state.items)
    if (
      i.status === "queued" ||
      i.status === "waiting" ||
      i.status === "uploading"
    )
      cancelItem(i.id);
}
export function retryItem(id: string) {
  patch(id, { status: "queued", progress: 0, error: "" });
  pump();
}
export function retryFailed() {
  set({
    items: state.items.map((i) =>
      i.status === "error" || i.status === "canceled"
        ? { ...i, status: "queued", progress: 0, error: "" }
        : i,
    ),
  });
  pump();
}

/** Quita de la ventana lo que ya terminó (y libera sus vistas previas). */
export function clearFinished(batch?: string) {
  const keep: UpItem[] = [];
  for (const i of state.items) {
    const finished =
      i.status === "done" || i.status === "error" || i.status === "canceled";
    if (finished && (!batch || i.batch === batch))
      URL.revokeObjectURL(i.preview);
    else keep.push(i);
  }
  const used = new Set(keep.map((i) => i.batch));
  set({
    items: keep,
    batches: state.batches.filter((b) => used.has(b.id)),
    zips: batch
      ? state.zips
      : state.zips.filter(
          (z) => z.status === "working" || z.status === "packing",
        ),
  });
}

const active = (s: UpStatus) =>
  s === "queued" || s === "waiting" || s === "uploading";
export const isBusy = (items: UpItem[]) => items.some((i) => active(i.status));

function pump() {
  window.clearTimeout(timer);
  const now = Date.now();
  while (starts.length && now - starts[0] > 60_000) starts.shift();
  const pending = state.items.some(
    (i) => i.status === "queued" || i.status === "waiting",
  );
  if (!pending) return;
  // Hay que esperar: por el límite que pidió YourImageShare o por el propio reparto por minuto.
  const gate = Math.max(
    state.waitUntil,
    starts.length >= PER_MINUTE ? starts[0] + 60_250 : 0,
  );
  if (gate > now) {
    set({
      waitUntil: gate,
      items: state.items.map((i) =>
        i.status === "queued" ? { ...i, status: "waiting" } : i,
      ),
    });
    timer = window.setTimeout(pump, gate - now);
    return;
  }
  set({
    items: state.items.map((i) =>
      i.status === "waiting" ? { ...i, status: "queued" } : i,
    ),
  });
  let running = state.items.filter((i) => i.status === "uploading").length;
  for (const item of state.items.filter((i) => i.status === "queued")) {
    if (running >= CONCURRENCY) break;
    if (starts.length >= PER_MINUTE) {
      timer = window.setTimeout(pump, starts[0] + 60_250 - Date.now());
      break;
    }
    running++;
    starts.push(Date.now());
    void run(item);
  }
}

class UploadError extends Error {
  constructor(
    message: string,
    public status = 0,
    public retryAfter = 0,
  ) {
    super(message);
  }
}

async function run(item: UpItem) {
  const batch = state.batches.find((b) => b.id === item.batch);
  if (!batch) return;
  const ctrl = new AbortController();
  controllers.set(item.id, ctrl);
  patch(item.id, { status: "uploading", progress: 0, error: "" });
  try {
    if (batch.webp && !item.converted) {
      patch(item.id, { compressing: true });
      const webp = await toWebp(item.file);
      if (ctrl.signal.aborted) throw new DOMException("Cancelada", "AbortError");
      patch(item.id, {
        compressing: false,
        converted: true,
        ...(webp && { file: webp, size: webp.size, original: item.size }),
      });
      if (webp) item = { ...item, file: webp, size: webp.size };
    }
    const row = await send(item, batch, ctrl.signal, (p) =>
      patch(item.id, { progress: p }),
    );
    const shot = toShot(row);
    addShot(shot);
    patch(item.id, { status: "done", progress: 1, shot });
    window.dispatchEvent(
      new CustomEvent("nexo:capture-saved", { detail: shot }),
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      patch(item.id, { status: "canceled", progress: 0, compressing: false });
    } else if (e instanceof UploadError && e.status === 429) {
      // Vuelve a la cola: se sube sola cuando YourImageShare lo permita.
      set({
        waitUntil: Math.max(
          state.waitUntil,
          Date.now() + e.retryAfter * 1000 + 300,
        ),
      });
      patch(item.id, { status: "waiting", progress: 0 });
    } else {
      patch(item.id, {
        status: "error",
        progress: 0,
        error: e instanceof Error ? e.message : "No se pudo subir.",
      });
    }
  } finally {
    controllers.delete(item.id);
    pump();
  }
}

async function send(
  item: UpItem,
  batch: Batch,
  signal: AbortSignal,
  onProgress: (p: number) => void,
): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new UploadError("Inicia sesión para subir capturas.");
  return new Promise((resolve, reject) => {
    if (signal.aborted)
      return reject(new DOMException("Cancelada", "AbortError"));
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", item.file, item.file.name || item.name + ".png");
    form.append("name", item.name);
    form.append("note", batch.note);
    form.append("tags", JSON.stringify(batch.tags));
    if (batch.folder_id) form.append("folder_id", batch.folder_id);
    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort);
    const done = () => signal.removeEventListener("abort", onAbort);
    xhr.open("POST", CAPTURAS_ENDPOINT);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.setRequestHeader("apikey", SUPABASE_KEY);
    xhr.timeout = 180_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      done();
      let json: {
        data?: Record<string, unknown>;
        error?: string;
        retryAfter?: number;
      } | null = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* no es JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && json?.data)
        return resolve(json.data);
      if (xhr.status === 429)
        return reject(
          new UploadError(
            "Límite de YourImageShare",
            429,
            json?.retryAfter ??
              (Number(xhr.getResponseHeader("retry-after")) || 20),
          ),
        );
      if (xhr.status === 404 && !json?.error)
        return reject(
          new UploadError(
            "Falta desplegar la función «screenshots» en Supabase.",
          ),
        );
      reject(
        new UploadError(
          json?.error || `La subida falló (error ${xhr.status}).`,
          xhr.status,
        ),
      );
    };
    xhr.onerror = () => {
      done();
      reject(new UploadError("Sin conexión con el servidor. Revisa tu red."));
    };
    xhr.ontimeout = () => {
      done();
      reject(new UploadError("YourImageShare tardó demasiado en responder."));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException("Cancelada", "AbortError"));
    };
    xhr.send(form);
  });
}

// ───────── Descargas en ZIP (se ven en la misma ventana flotante) ─────────
const zipControllers = new Map<string, AbortController>();
export function startZip(label: string, total: number) {
  const job: ZipJob = {
    id: uid(),
    label,
    done: 0,
    total,
    status: "working",
    error: "",
    failed: 0,
  };
  const ctrl = new AbortController();
  zipControllers.set(job.id, ctrl);
  set({ zips: [...state.zips, job], minimized: false });
  return { id: job.id, signal: ctrl.signal };
}
export function updateZip(id: string, changes: Partial<ZipJob>) {
  set({
    zips: state.zips.map((z) => (z.id === id ? { ...z, ...changes } : z)),
  });
  if (
    changes.status &&
    changes.status !== "working" &&
    changes.status !== "packing"
  )
    zipControllers.delete(id);
}
export const cancelZip = (id: string) => zipControllers.get(id)?.abort();
export const dismissZip = (id: string) =>
  set({ zips: state.zips.filter((z) => z.id !== id) });
