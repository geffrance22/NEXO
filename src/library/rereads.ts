import type { Entry } from "../data";
import { normalizeText, todayInputValue } from "../lib/format";

/**
 * Libros leídos varias veces. Cada lectura es su propia ficha (con su fecha, su calificación y
 * sus frases); las del mismo libro se reconocen por el título y, si las dos lo traen, el autor.
 * `readNo` dice qué lectura es (2 = la segunda) y cubre lo que leíste antes de usar Nexo.
 */

const key = (s?: string) =>
  normalizeText(s ?? "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const readOf = (e: Entry) => e.details.read ?? "leyendo";

/** El mismo libro: igual título y, si ambos dicen el autor, el mismo autor. */
export function sameBook(
  a: { title: string; author?: string },
  b: { title: string; author?: string },
) {
  const ta = key(a.title);
  if (!ta || ta !== key(b.title)) return false;
  const aa = key(a.author);
  const ab = key(b.author);
  return !aa || !ab || aa === ab;
}

/** Cuántas veces está leído el libro según unas lecturas suyas. */
function countReads(readings: Entry[]) {
  let done = 0;
  let known = 0;
  for (const e of readings) {
    const r = readOf(e);
    const no = e.details.readNo ?? 1;
    // Terminar la n.ª lectura es haberlo leído n veces; ir en la n.ª, n - 1 (aunque las
    // anteriores no estén en Nexo).
    if (r === "terminado") {
      done++;
      known = Math.max(known, no);
    } else if (r === "leyendo") known = Math.max(known, no - 1);
  }
  return Math.max(done, known);
}

const cache = new WeakMap<Entry[], Map<string, number>>();

/** Veces leído de cada libro (por id de cada una de sus fichas). Se calcula una vez por lista. */
function index(entries: Entry[]) {
  let map = cache.get(entries);
  if (map) return map;
  map = new Map();
  const groups = new Map<string, Entry[][]>();
  for (const e of entries) {
    if (e.kind !== "Libro") continue;
    const k = key(e.title);
    if (!k) continue;
    const list = groups.get(k) ?? [];
    const me = { title: e.title, author: e.details.author };
    // Entra al grupo si es compatible con todas sus fichas (mismo autor cuando lo dicen).
    const group = list.find((g) =>
      g.every((x) => sameBook({ title: x.title, author: x.details.author }, me)),
    );
    if (group) group.push(e);
    else list.push([e]);
    groups.set(k, list);
  }
  for (const list of groups.values())
    for (const group of list) {
      const n = countReads(group);
      for (const e of group) map.set(e.id, n);
    }
  cache.set(entries, map);
  return map;
}

/** Cuántas veces has terminado este libro, contando todas sus lecturas (0 si ninguna). */
export const timesRead = (entry: Entry, entries: Entry[]) =>
  entry.kind === "Libro" ? (index(entries).get(entry.id) ?? 0) : 0;

const finishedDay = (e: Entry) =>
  e.details.finishedAt ?? todayInputValue(new Date(e.created_at));

/**
 * Lecturas que ya terminaste de este libro antes de `before` (AAAA-MM-DD), sin contar la ficha
 * `except` (la que estás escribiendo). Sirve para decir «es tu 2.ª lectura» al registrarlo.
 */
export function readsBefore(
  book: { title: string; author?: string },
  entries: Entry[],
  before: string,
  except?: string,
) {
  const done = entries.filter(
    (e) =>
      e.kind === "Libro" &&
      e.id !== except &&
      readOf(e) === "terminado" &&
      finishedDay(e) <= before &&
      sameBook(book, { title: e.title, author: e.details.author }),
  );
  return countReads(done);
}

/** «2.ª», «3.ª»… */
export const ordinal = (n: number) => `${n}.ª`;
