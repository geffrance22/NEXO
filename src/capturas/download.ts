import {
  fileNameOf,
  safeFolderName,
  subtree,
  type CapFolder,
  type Shot,
} from "./model";
import { startZip, updateZip } from "./uploads";
import { buildZip, type ZipEntry } from "./zip";

function save(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

async function fetchBytes(shot: Shot, signal?: AbortSignal) {
  const res = await fetch(shot.url, {
    signal,
    mode: "cors",
    credentials: "omit",
  });
  if (!res.ok) throw Error(`Error ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Descarga una captura con su nombre (un enlace de otro dominio no respeta `download`). */
export async function downloadShot(shot: Shot) {
  try {
    const bytes = await fetchBytes(shot);
    save(
      new Blob([bytes], { type: shot.mime || "image/png" }),
      fileNameOf(shot),
    );
  } catch {
    // Sin permiso para leerla desde aquí: se abre el original en otra pestaña.
    window.open(shot.src, "_blank", "noopener");
  }
}

/**
 * Arma y descarga un ZIP. `folders`: carpetas a incluir con todo su contenido (`'root'`: CAPTURAS
 * entera); `shots`: capturas sueltas. El progreso se ve en la ventana flotante.
 */
export async function downloadZip({
  name,
  folders,
  shots: loose = [],
  allFolders,
  allShots,
}: {
  name: string;
  folders: string[] | "root";
  shots?: string[];
  allFolders: CapFolder[];
  allShots: Shot[];
}) {
  const byId = new Map(allFolders.map((f) => [f.id, f]));
  const isRoot = folders === "root";
  const tops = isRoot
    ? allFolders.filter((f) => !f.parent_id).map((f) => f.id)
    : folders;
  const included = subtree(allFolders, tops);
  const prefix = isRoot ? safeFolderName(name) + "/" : "";

  // Ruta de una carpeta desde la de arriba que se eligió.
  const dirOf = (id: string): string => {
    const names: string[] = [];
    let cur = byId.get(id);
    while (cur) {
      names.unshift(safeFolderName(cur.name));
      if (tops.includes(cur.id)) break;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return prefix + names.join("/") + "/";
  };

  const taken = new Map<string, Set<string>>();
  const unique = (dir: string, file: string) => {
    const set = taken.get(dir) ?? new Set<string>();
    taken.set(dir, set);
    const dot = file.lastIndexOf(".");
    const base = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : "";
    let candidate = file;
    for (let n = 2; set.has(candidate.toLowerCase()); n++)
      candidate = `${base} (${n})${ext}`;
    set.add(candidate.toLowerCase());
    return dir + candidate;
  };

  const dirs = [...included].map(dirOf).sort();
  const looseSet = new Set(loose);
  const picked = allShots.filter(
    (s) =>
      looseSet.has(s.id) || (s.folder_id ? included.has(s.folder_id) : isRoot),
  );
  const jobs = picked.map((s) => ({
    shot: s,
    path: unique(
      s.folder_id && included.has(s.folder_id) ? dirOf(s.folder_id) : prefix,
      fileNameOf(s),
    ),
  }));

  const fileName = safeFolderName(name) + ".zip";
  const { id, signal } = startZip(fileName, jobs.length);
  const entries: ZipEntry[] = dirs.map((path) => ({ path }));
  let done = 0;
  let failed = 0;
  try {
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        if (signal.aborted) return;
        try {
          entries.push({
            path: job.path,
            data: await fetchBytes(job.shot, signal),
            date: new Date(job.shot.created_at),
          });
        } catch (e) {
          if (signal.aborted) return;
          failed++;
          void e;
        }
        done++;
        updateZip(id, { done, failed });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, jobs.length || 1) }, worker),
    );
    if (signal.aborted) return updateZip(id, { status: "canceled" });
    if (jobs.length && failed === jobs.length)
      return updateZip(id, {
        status: "error",
        error: "No se pudo descargar ninguna imagen.",
      });
    updateZip(id, { status: "packing" });
    // Un respiro para que se pinte «Empaquetando…» antes del trabajo pesado.
    await new Promise((r) => setTimeout(r, 30));
    const files = entries.filter((e) => e.data);
    const folderEntries = entries.filter((e) => !e.data);
    save(
      buildZip([
        ...folderEntries,
        ...files.sort((a, b) => a.path.localeCompare(b.path)),
      ]),
      fileName,
    );
    updateZip(id, { status: "done" });
  } catch (e) {
    updateZip(id, {
      status: signal.aborted ? "canceled" : "error",
      error: e instanceof Error ? e.message : "No se pudo armar el ZIP.",
    });
  }
}
