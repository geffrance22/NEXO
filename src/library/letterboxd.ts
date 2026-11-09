/**
 * Importación de Letterboxd: lee el .zip que exporta Letterboxd (o sus .csv sueltos) y reúne cada
 * película con su fecha, calificación, reseña y etiquetas.
 *
 * Archivos que se usan (los de la raíz del .zip):
 * - watched.csv   Date, Name, Year, Letterboxd URI
 * - diary.csv     Date, Name, Year, Letterboxd URI, Rating, Rewatch, Tags, Watched Date
 * - ratings.csv   Date, Name, Year, Letterboxd URI, Rating
 * - reviews.csv   Date, Name, Year, Letterboxd URI, Rating, Rewatch, Review, Tags, Watched Date
 * - watchlist.csv Date, Name, Year, Letterboxd URI
 */

export type LbFilm = {
  name: string;
  year: string;
  watched: boolean;
  /** En la lista «por ver» (y aún sin ver). */
  watchlist: boolean;
  /** AAAA-MM-DD: la última vez que la viste (o cuando la añadiste a «por ver»). */
  date: string;
  /** De 0,5 a 5 (medias estrellas). */
  rating?: number;
  review?: string;
  tags: string[];
};

const FILES = ['watched.csv', 'diary.csv', 'ratings.csv', 'reviews.csv', 'watchlist.csv'];
/** Carpetas del .zip que no son tu historial (listas, me gusta, borrados). */
const SKIP_DIRS = new Set(['deleted', 'likes', 'lists', 'orphaned']);

function wantedName(path: string) {
  const parts = path.toLowerCase().split('/').filter(Boolean);
  const base = parts.at(-1) ?? '';
  if (!FILES.includes(base)) return null;
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) return null;
  return base;
}

async function inflate(data: Uint8Array) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lee los .csv que interesan de un .zip (sin librerías: directorio central + deflate). */
async function unzip(file: Blob): Promise<Map<string, string>> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw Error('El archivo no parece un .zip válido.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder();
  const out = new Map<string, string>();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = utf8.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const base = wantedName(name);
    if (!base || out.has(base)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(base, utf8.decode(data));
    else if (method === 8) out.set(base, utf8.decode(await inflate(data)));
  }
  return out;
}

/** CSV con comillas, comas y saltos de línea dentro de los campos. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Las reseñas de Letterboxd traen algo de HTML: se deja texto con sus párrafos. */
function plainReview(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, code: string) => {
      if (code[0] === '#')
        return String.fromCodePoint(
          code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)),
        );
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const isDay = (s: string | undefined): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const keyOf = (name: string, year: string) =>
  name.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim() + '|' + year;

/** Reúne los archivos de la exportación en una película por título y año. */
export function mergeLetterboxd(files: Map<string, string>): LbFilm[] {
  const films = new Map<string, LbFilm>();
  const get = (r: Record<string, string>) => {
    const name = r.Name?.trim();
    if (!name) return null;
    const year = /^\d{4}$/.test(r.Year ?? '') ? r.Year : '';
    const key = keyOf(name, year);
    let f = films.get(key);
    if (!f) {
      f = { name, year, watched: false, watchlist: false, date: '', tags: [] };
      films.set(key, f);
    }
    return f;
  };
  /** La viste: la fecha del diario manda; si no hay, la de cuando la registraste. */
  const seen = (f: LbFilm, day: string | undefined, fromDiary: boolean) => {
    f.watched = true;
    if (isDay(day) && (!f.date || (fromDiary && day > f.date))) f.date = day;
  };
  const rows = (name: string) => parseCsv(files.get(name) ?? '');
  /** La calificación más reciente gana (ratings.csv va al final: es la actual). */
  const rate = (f: LbFilm, raw: string | undefined) => {
    const n = Number(raw);
    if (n > 0) f.rating = n;
  };
  const tag = (f: LbFilm, raw: string | undefined) => {
    for (const t of (raw ?? '').split(',').map((s) => s.trim().toLowerCase()))
      if (t && !f.tags.includes(t)) f.tags.push(t);
  };

  // Diario y reseñas, en orden: la última vez que la viste (y su reseña) manda.
  const logs = [...rows('diary.csv'), ...rows('reviews.csv')].sort((a, b) =>
    (a['Watched Date'] || a.Date || '').localeCompare(b['Watched Date'] || b.Date || ''),
  );
  for (const r of logs) {
    const f = get(r);
    if (!f) continue;
    seen(f, r['Watched Date'] || r.Date, true);
    rate(f, r.Rating);
    tag(f, r.Tags);
    if (r.Review?.trim()) f.review = plainReview(r.Review);
  }
  for (const r of rows('watched.csv')) {
    const f = get(r);
    if (f) seen(f, r.Date, false);
  }
  for (const r of rows('ratings.csv')) {
    const f = get(r);
    if (!f) continue;
    seen(f, r.Date, false);
    rate(f, r.Rating);
  }
  for (const r of rows('watchlist.csv')) {
    const f = get(r);
    if (!f || f.watched) continue;
    f.watchlist = true;
    if (isDay(r.Date)) f.date = r.Date;
  }
  return [...films.values()].filter((f) => f.watched || f.watchlist);
}

/** Lee lo que soltaste: el .zip de Letterboxd o sus .csv. */
export async function readLetterboxd(list: File[]): Promise<LbFilm[]> {
  const files = new Map<string, string>();
  for (const file of list) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.zip')) for (const [k, v] of await unzip(file)) files.set(k, v);
    else if (name.endsWith('.csv') && FILES.includes(name)) files.set(name, await file.text());
  }
  if (!files.size)
    throw Error(
      'No encontré archivos de Letterboxd. Usa el .zip de la exportación (o watched.csv, diary.csv…).',
    );
  return mergeLetterboxd(files);
}

/** Medias estrellas a la escala de Nexo (1 a 5). */
export const toStars = (r?: number) => (r ? Math.min(5, Math.max(1, Math.round(r))) : undefined);
