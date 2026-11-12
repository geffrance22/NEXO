import type { StoredImage } from '../data';
import { normalizeText } from '../lib/format';

/**
 * Un instante: lo que escribiste tal cual, como una publicación breve. Varios forman un hilo
 * (`thread_id` es el primero; `pos`, su orden). De él nacen piezas en Nexo (encuentros, gastos,
 * pendientes…) que quedan vinculadas aquí, y también puedes vincularle otras a mano.
 */
export type Instant = {
  id: string;
  thread_id: string;
  pos: number;
  body: string;
  images: StoredImage[];
  /** Ánimo (valor de `moods`), si lo marcaste. */
  mood: number | null;
  /** AAAA-MM-DD: cuándo pasó (si no, cuándo lo escribiste). */
  happened_on: string | null;
  person_ids: string[];
  entry_ids: string[];
  episode_ids: string[];
  /** Cuadernos de Agenda a los que lo vinculaste (columna de la migración 202611120004). */
  notebook_ids: string[];
  place_ids: string[];
  edited_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LinkKey = 'entry_ids' | 'episode_ids' | 'notebook_ids' | 'person_ids' | 'place_ids';
export const LINK_KEYS: LinkKey[] = [
  'entry_ids',
  'episode_ids',
  'notebook_ids',
  'person_ids',
  'place_ids',
];
export type InstantLinks = Record<LinkKey, string[]>;
export const noLinks = (): InstantLinks => ({
  entry_ids: [],
  episode_ids: [],
  notebook_ids: [],
  person_ids: [],
  place_ids: [],
});

/** Largo máximo de un instante (la base acepta hasta 8000). */
export const INSTANT_MAX = 4000;
/** Fotos por instante. */
export const INSTANT_PHOTOS = 8;

/** Un hilo: el primero y los que lo siguen, en orden. */
export type Thread = { id: string; items: Instant[]; root: Instant; last: string };

/** Agrupa en hilos (el más reciente primero, por su última publicación). */
export function threadsOf(list: readonly Instant[]): Thread[] {
  const by = new Map<string, Instant[]>();
  for (const i of list) {
    const t = by.get(i.thread_id);
    if (t) t.push(i);
    else by.set(i.thread_id, [i]);
  }
  const out: Thread[] = [];
  for (const [id, items] of by) {
    items.sort((a, b) => a.pos - b.pos || a.created_at.localeCompare(b.created_at));
    const last = items.reduce((m, i) => (i.created_at > m ? i.created_at : m), '');
    out.push({ id, items, root: items[0], last });
  }
  return out.sort((a, b) => b.last.localeCompare(a.last));
}

export const linkCount = (i: Instant) =>
  i.entry_ids.length +
  i.episode_ids.length +
  i.notebook_ids.length +
  i.person_ids.length +
  i.place_ids.length;

/** El día en que pasó (o en que lo escribiste). */
export const dayOfInstant = (i: Instant) => {
  if (i.happened_on) return i.happened_on;
  const d = new Date(i.created_at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

/** «ahora», «hace 5 min», «hace 3 h», «ayer» o la fecha corta. */
export function agoLabel(iso: string, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 50) return 'ahora';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = new Date(t);
  const today = new Date(now);
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate())
    return 'ayer';
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  });
}

/** Contador corto: 950, 1k, 1.5k, 12k, 1.2M (sin redondear hacia arriba: 999 999 es 999k). */
export function compactCount(n: number) {
  if (n < 1000) return String(n);
  const short = (v: number, unit: string) =>
    (v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v)).toString() + unit;
  return n < 1_000_000 ? short(n / 1000, 'k') : short(n / 1_000_000, 'M');
}

/** Un trozo corto del texto (para chips, la búsqueda y el bloque de Mi espacio). */
export const excerpt = (text: string, n = 90) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

/** Instantes que dicen todas las palabras buscadas (sin tildes ni mayúsculas), los más recientes. */
export function searchInstants(list: readonly Instant[] | null, query: string, limit = 5) {
  const terms = normalizeText(query.trim())
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (!terms.length || !list) return [];
  const out: Instant[] = [];
  for (const i of list) {
    const hay = normalizeText(i.body);
    if (terms.every((t) => hay.includes(t))) {
      out.push(i);
      if (out.length >= limit) break;
    }
  }
  return out;
}
