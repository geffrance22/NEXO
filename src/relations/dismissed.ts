import { useSyncExternalStore } from 'react';

/**
 * Lo que descartaste: deducciones («No es así»), sugerencias y tarjetas de la agenda. Se guarda en
 * este navegador y, con la migración 008, también en tu cuenta (igual en todos tus dispositivos).
 */
const STORAGE = 'nexo-tie-dismissed';
const listeners = new Set<() => void>();
let current: ReadonlySet<string> = read();

function read(): ReadonlySet<string> {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(next: Set<string>) {
  current = next;
  localStorage.setItem(STORAGE, JSON.stringify([...next].slice(-2000)));
  listeners.forEach((l) => l());
}

/** Sincronización con la base (migración 008): la configura el espacio de trabajo al cargar. */
type Sync = { add: (keys: string[]) => void; remove: (keys: string[]) => void };
let sync: Sync | null = null;
export const setDismissalSync = (s: Sync | null) => {
  sync = s;
};

/** Une los descartes guardados en la base con los de este navegador (y sube los que falten). */
export function hydrateDismissed(remote: string[]) {
  const local = [...current].filter((k) => !remote.includes(k));
  write(new Set([...remote, ...current]));
  if (local.length) queueMicrotask(() => sync?.add(local));
}

export function dismiss(...keys: string[]) {
  const fresh = keys.filter((k) => !current.has(k));
  write(new Set([...current, ...keys]));
  if (fresh.length) sync?.add(fresh);
}

/** Olvida en este navegador los descartes que mencionan algo (la base ya los borró). */
export function forgetDismissed(fragment: string) {
  if (![...current].some((k) => k.includes(fragment))) return;
  write(new Set([...current].filter((k) => !k.includes(fragment))));
}

export function undismiss(...keys: string[]) {
  const next = new Set(current);
  keys.forEach((k) => next.delete(k));
  write(next);
  sync?.remove(keys);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useDismissed = () => useSyncExternalStore(subscribe, () => current);

// Sugerencias que ya viste (para marcar las nuevas).
const SEEN = 'nexo-sug-seen';
let seen: ReadonlySet<string> = (() => {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN) ?? '[]');
    return new Set<string>(Array.isArray(list) ? list : []);
  } catch {
    return new Set<string>();
  }
})();
export function markSeen(keys: string[]) {
  if (keys.every((k) => seen.has(k))) return;
  seen = new Set([...seen, ...keys]);
  localStorage.setItem(SEEN, JSON.stringify([...seen].slice(-2000)));
  listeners.forEach((l) => l());
}
export const useSeen = () => useSyncExternalStore(subscribe, () => seen);
