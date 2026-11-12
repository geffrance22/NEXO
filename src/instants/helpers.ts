import type { Workspace } from '../data';
import { normalizeText } from '../lib/format';
import { recognize } from '../lib/recognize';

/** Buscar piezas al publicar (se recuerda en este navegador). */
const SCAN_KEY = 'nexo-instant-scan';

export function scanOn() {
  try {
    return localStorage.getItem(SCAN_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setScan(on: boolean) {
  try {
    localStorage.setItem(SCAN_KEY, on ? '1' : '0');
  } catch {
    /* Sin almacenamiento: vale para esta vez. */
  }
}

/** ¿El texto ya nombra esto? (sin tildes ni mayúsculas, palabra completa). */
export function names(text: string, name: string) {
  const n = normalizeText(name.trim());
  if (n.length < 2) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'u').test(normalizeText(text));
}

/** Las personas de un instante: las que elegiste y las que el texto nombra sin duda. */
export function peopleIn(text: string, picked: string[], ws: Workspace) {
  const known = new Set(ws.people.map((p) => p.id));
  const said = text.trim()
    ? recognize(text, ws.people, ws.ties)
        .mentions.filter((m) => m.ids.length === 1 || m.group)
        .flatMap((m) => m.ids)
    : [];
  return [...new Set([...picked, ...said])].filter((id) => known.has(id));
}

/** Los lugares de un instante: los que elegiste y los tuyos que el texto nombra. */
export function placesIn(text: string, picked: string[], ws: Workspace) {
  const said = ws.places
    .filter((p) => p.name.trim().length >= 4 && names(text, p.name))
    .map((p) => p.id);
  const known = new Set(ws.places.map((p) => p.id));
  return [...new Set([...picked, ...said])].filter((id) => known.has(id));
}
