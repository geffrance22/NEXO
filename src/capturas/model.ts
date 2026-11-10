/** CAPTURAS: imágenes en YourImageShare ordenadas en carpetas (tablas `screenshots` y `screenshot_folders`). */
export type CapFolder = {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
};

export type Shot = {
  id: string;
  folder_id: string | null;
  name: string;
  note: string;
  tags: string[];
  yis_id: string;
  /** Enlace permanente de YourImageShare. */
  src: string;
  /** El archivo tal cual (admite descargas desde el navegador). */
  url: string;
  thumb: string | null;
  width: number | null;
  height: number | null;
  size: number;
  mime: string;
  /** Con estrella: aparece en «Favoritas». */
  favorite: boolean;
  /** Archivada: sale de su carpeta y queda en «Archivadas» (sin borrarse). */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Qué parte de CAPTURAS se ve: las carpetas, las favoritas o las archivadas. */
export type CapScope = "todo" | "favoritas" | "archivadas";

export type CapView = "cuadricula" | "mosaico" | "lista";
export type CapSort = "reciente" | "antiguo" | "nombre" | "peso";

export const capSortLabels: Record<CapSort, string> = {
  reciente: "Más recientes",
  antiguo: "Más antiguas",
  nombre: "Nombre (A–Z)",
  peso: "Más pesadas",
};

/** Hasta 60 MB por imagen (lo admite la función `screenshots`). */
export const MAX_SHOT_BYTES = 60 * 1024 * 1024;
export const MAX_BATCH = 300;

export function formatBytes(n: number) {
  if (!n) return "0 KB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3)
    return `${(n / 1024 / 1024).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;
  return `${(n / 1024 ** 3).toLocaleString("es-CO", { maximumFractionDigits: 2 })} GB`;
}

export const shotDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Las carpetas hijas de cada carpeta (la raíz es `null`). */
export function childrenMap(folders: CapFolder[]) {
  const map = new Map<string | null, CapFolder[]>();
  for (const f of folders) {
    const list = map.get(f.parent_id) ?? [];
    list.push(f);
    map.set(f.parent_id, list);
  }
  for (const list of map.values())
    list.sort((a, b) =>
      a.name.localeCompare(b.name, "es", {
        sensitivity: "base",
        numeric: true,
      }),
    );
  return map;
}

/** La carpeta y todas las que tiene dentro. */
export function subtree(folders: CapFolder[], ids: Iterable<string>) {
  const kids = childrenMap(folders);
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const k of kids.get(id) ?? []) walk(k.id);
  };
  for (const id of ids) walk(id);
  return out;
}

/** De la raíz a la carpeta: CAPTURAS › Trabajo › Diseño. */
export function pathOf(folders: CapFolder[], id: string | null) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: CapFolder[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && out.length < 50) {
    out.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

/** Todas las carpetas en orden de árbol, con su profundidad (para elegir destino). */
export function flatTree(folders: CapFolder[]) {
  const kids = childrenMap(folders);
  const out: { folder: CapFolder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of kids.get(parent) ?? []) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function sortShots(list: Shot[], sort: CapSort) {
  const out = [...list];
  switch (sort) {
    case "antiguo":
      return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case "nombre":
      return out.sort((a, b) =>
        a.name.localeCompare(b.name, "es", {
          sensitivity: "base",
          numeric: true,
        }),
      );
    case "peso":
      return out.sort((a, b) => b.size - a.size);
    default:
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/svg+xml": "svg",
};

export function extOf(shot: Pick<Shot, "mime" | "url">) {
  const fromUrl = /\.([a-z0-9]{2,5})(?:$|[?#])/i
    .exec(shot.url)?.[1]
    ?.toLowerCase();
  return fromUrl ?? EXT[shot.mime] ?? "png";
}

/** Nombre de archivo seguro (sin barras ni caracteres que Windows no admite) y con extensión. */
export function fileNameOf(shot: Pick<Shot, "name" | "mime" | "url">) {
  const ext = extOf(shot);
  const base =
    shot.name
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.[a-z0-9]{2,5}$/i, "") || "captura";
  return `${base.slice(0, 120)}.${ext}`;
}

export const safeFolderName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .trim()
    .slice(0, 80) || "carpeta";

const pad = (n: number) => String(n).padStart(2, "0");
/** Lo pegado con Ctrl+V llega como «image.png»: se le da un nombre con fecha y hora. */
export function nameForUpload(file: File, index: number, stamp = new Date()) {
  const generic =
    !file.name ||
    /^(image|imagen|blob|screenshot|clipboard)(\.\w+)?$/i.test(file.name);
  if (!generic) return file.name.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 200);
  const d = stamp;
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  return `Captura ${when}${index ? ` (${index + 1})` : ""}`;
}

export const isImageFile = (f: File) =>
  f.type.startsWith("image/") ||
  /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|heic|heif)$/i.test(f.name);

/** Las imágenes de un pegado (Ctrl+V) o de lo que se suelta. */
export function imageFiles(list: FileList | File[] | null | undefined) {
  return Array.from(list ?? []).filter(isImageFile);
}

/** Etiquetas limpias: sin repetir (sin importar mayúsculas), sin «#», máximo 30. */
export function cleanTags(tags: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.replace(/^#+/, "").trim().slice(0, 40);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, 30);
}
