import { useSyncExternalStore } from "react";

/**
 * La columna que llevas contigo: una ventanita abajo a la derecha (como un chat) que sigue ahí al
 * cambiar de sección y al recargar. Se recuerda en este equipo, abierta o minimizada.
 */
export type DockedColumn = {
  list: string;
  board: string;
  name: string;
  color: string;
  /** Desplegada (true) o minimizada a su barra. */
  open: boolean;
};

const KEY = "nexo-column-dock";
/** Algo escribió una tarjeta desde la ventanita: Tableros la vuelve a leer. */
export const DOCK_WROTE = "nexo-dock-wrote";

function read(): DockedColumn | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<DockedColumn> | null;
    return v && typeof v.list === "string" && typeof v.board === "string"
      ? {
          list: v.list,
          board: v.board,
          name: typeof v.name === "string" ? v.name : "",
          color: typeof v.color === "string" ? v.color : "",
          open: v.open !== false,
        }
      : null;
  } catch {
    return null;
  }
}

let state = read();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
function write(next: DockedColumn | null) {
  state = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento: dura lo que dure la pestaña */
  }
  emit();
}
// Otra pestaña la cambió.
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  state = read();
  emit();
});

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const useDock = () => useSyncExternalStore(subscribe, () => state);
export const dockedColumn = () => state;

/** Lleva la columna a la ventanita (reemplaza la que hubiera) y la deja abierta. */
export const dockColumn = (col: Omit<DockedColumn, "open">) => write({ ...col, open: true });
export const undock = () => write(null);
export const setDockOpen = (open: boolean) => state && write({ ...state, open });
/** Cambió el nombre o el color de la columna. */
export const touchDock = (list: string, changes: Partial<Pick<DockedColumn, "name" | "color" | "board">>) => {
  if (!state || state.list !== list) return;
  const next = { ...state, ...changes };
  if (next.name === state.name && next.color === state.color && next.board === state.board) return;
  write(next);
};
