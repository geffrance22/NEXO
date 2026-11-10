const FOLDER_KEY = "nexo-cap-folder";

/** Carpeta abierta en CAPTURAS (dura mientras siga abierta la pestaña del navegador). */
export function savedFolder(): string | null {
  try {
    return sessionStorage.getItem(FOLDER_KEY) || null;
  } catch {
    return null;
  }
}
export function rememberFolder(id: string | null) {
  try {
    if (id) sessionStorage.setItem(FOLDER_KEY, id);
    else sessionStorage.removeItem(FOLDER_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

/** Abre esa carpeta en CAPTURAS (si la pestaña ya está a la vista, cambia al instante). */
export function openCapturasFolder(id: string | null) {
  rememberFolder(id);
  window.dispatchEvent(new CustomEvent("nexo:capturas-folder", { detail: id }));
}

const SHOT_KEY = "nexo-cap-open";
/** Abre esa captura en el visor de CAPTURAS (en su carpeta, o en «Archivadas»). */
export function openCapturasShot(id: string, folder: string | null) {
  rememberFolder(folder);
  try {
    sessionStorage.setItem(SHOT_KEY, id);
  } catch {
    /* sin almacenamiento: solo se abre la carpeta */
  }
  window.dispatchEvent(new CustomEvent("nexo:capturas-shot", { detail: id }));
}
/** La captura que alguien pidió abrir (se consume al leerla). */
export function takeShotToOpen(): string | null {
  try {
    const id = sessionStorage.getItem(SHOT_KEY);
    sessionStorage.removeItem(SHOT_KEY);
    return id;
  } catch {
    return null;
  }
}

const PEEK_EVENT = "nexo:capturas-peek";
/** Abre esa captura en el visor encima de donde estés, sin ir a CAPTURAS (ver ShotPeek). */
export function peekShot(id: string) {
  window.dispatchEvent(new CustomEvent(PEEK_EVENT, { detail: id }));
}
export function onPeekShot(f: (id: string) => void) {
  const handler = (e: Event) => f(String((e as CustomEvent).detail));
  window.addEventListener(PEEK_EVENT, handler);
  return () => window.removeEventListener(PEEK_EVENT, handler);
}
