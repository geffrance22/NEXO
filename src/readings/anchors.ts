import { hiddenOf, readableSlice } from "./formatting";

/**
 * Anclaje de los subrayados. Cada resaltado guarda su posición en el texto (`start_offset`,
 * `end_offset`) y el texto que se lee (`quote`). Cuando el texto del artículo cambia (al volver a
 * descargarlo, al editarlo o por cualquier otro motivo), la posición deja de valer y se vuelve a
 * buscar el fragmento, de lo más exacto a lo más aproximado:
 *
 * 1. El mismo texto exacto; si aparece varias veces, el que tiene alrededor lo mismo que antes y,
 *    a igualdad, el más cercano a donde estaba.
 * 2. El mismo texto que se lee (sin formato y con los espacios normalizados): sobrevive a cambios
 *    de negritas, enlaces, saltos de línea o espacios.
 * 3. Aproximado: el principio y el final del fragmento a una distancia parecida, si lo que queda
 *    entre ellos se parece al menos un 75 % (sobrevive a erratas corregidas o palabras cambiadas).
 */
export type Offsets = { start_offset: number; end_offset: number };
type Anchorable = Offsets & { quote?: string | null };

const CONTEXT = 32;
/** Parecido mínimo para aceptar una coincidencia aproximada. */
const FUZZY = 0.75;

/** Texto para comparar: sin mayúsculas y con los espacios reducidos a uno. */
export const normalize = (s: string) =>
  s.replace(/\s+/g, " ").trim().toLowerCase();

type View = { text: string; raw: Int32Array };
const views = new Map<string, View>();
/**
 * Lo que se lee del texto (sin formato ni imágenes), en minúsculas y con los espacios reducidos,
 * y para cada carácter su posición en el texto guardado.
 */
function viewOf(source: string): View {
  const hit = views.get(source);
  if (hit) return hit;
  const hidden = hiddenOf(source);
  const raw: number[] = [];
  let text = "";
  let space = true;
  let h = 0;
  for (let i = 0; i < source.length; i++) {
    while (h < hidden.length && hidden[h].end <= i) h++;
    if (h < hidden.length && hidden[h].start <= i) {
      i = hidden[h].end - 1;
      continue;
    }
    const c = source[i];
    if (/\s/.test(c)) {
      if (space) continue;
      space = true;
      text += " ";
    } else {
      space = false;
      const low = c.toLowerCase();
      text += low.length === 1 ? low : c;
    }
    raw.push(i);
  }
  const view = { text, raw: Int32Array.from(raw) };
  views.set(source, view);
  if (views.size > 4) views.delete(views.keys().next().value!);
  return view;
}

/** Cuántos caracteres coinciden al final de `a` y `b` (o al principio, con `fromStart`). */
function common(a: string, b: string, fromStart: boolean) {
  const n = Math.min(a.length, b.length);
  let k = 0;
  if (fromStart) while (k < n && a[k] === b[k]) k++;
  else while (k < n && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  return k;
}

/** Todas las apariciones de `piece` en `text`. */
function occurrences(text: string, piece: string, limit = 200) {
  const out: number[] = [];
  let i = text.indexOf(piece);
  while (i >= 0 && out.length < limit) {
    out.push(i);
    i = text.indexOf(piece, i + 1);
  }
  return out;
}

/** Parecido entre dos textos (1 = iguales), por distancia de edición. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  // Textos largos: se comparan muestras para no tardar.
  if (a.length * b.length > 4_000_000) {
    const k = 600;
    return (
      (similarity(a.slice(0, k), b.slice(0, k)) +
        similarity(a.slice(-k), b.slice(-k))) /
      2
    );
  }
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** De posiciones en la vista legible a posiciones en el texto guardado. */
function toRaw(view: View, from: number, to: number): Offsets | null {
  if (to <= from || from < 0 || to > view.raw.length) return null;
  return {
    start_offset: view.raw[from],
    end_offset: view.raw[to - 1] + 1,
  };
}

/**
 * Busca un fragmento (`quote`, lo que se lee) en el texto. `expected`: dónde se espera (0 a 1 del
 * largo), para elegir entre varias apariciones. `before`/`after`: lo que lo rodeaba.
 */
export function findQuote(
  content: string,
  quote: string,
  expected = 0.5,
  around: { before?: string; after?: string } = {},
): Offsets | null {
  const q = normalize(quote);
  if (!q) return null;
  const view = viewOf(content);
  const text = view.text;
  const target = expected * text.length;
  const before = normalize(around.before ?? "");
  const after = normalize(around.after ?? "");
  const score = (i: number, len: number) =>
    (before
      ? common(text.slice(Math.max(0, i - CONTEXT), i), before, false)
      : 0) +
    (after ? common(text.slice(i + len, i + len + CONTEXT), after, true) : 0) -
    Math.abs(i - target) / Math.max(1, text.length);

  // Texto legible exacto.
  const exact = occurrences(text, q);
  if (exact.length) {
    const best = exact.reduce((a, b) =>
      score(b, q.length) > score(a, q.length) ? b : a,
    );
    return toRaw(view, best, best + q.length);
  }

  // Aproximado: principio y final del fragmento.
  if (q.length < 12) return null;
  const k = Math.min(24, Math.floor(q.length / 3));
  const head = q.slice(0, k);
  const tail = q.slice(-k);
  const candidates: [number, number][] = [];
  const heads = occurrences(text, head, 60);
  for (const h of heads) {
    const lo = h + Math.floor(q.length * 0.6);
    const hi = h + Math.ceil(q.length * 1.4) + k;
    let t = text.indexOf(tail, lo - k);
    while (t >= 0 && t + k <= hi) {
      candidates.push([h, t + k]);
      t = text.indexOf(tail, t + 1);
    }
    candidates.push([h, Math.min(text.length, h + q.length)]);
  }
  for (const t of occurrences(text, tail, 60))
    candidates.push([Math.max(0, t + k - q.length), t + k]);
  let best: { at: [number, number]; sim: number; score: number } | null = null;
  for (const at of candidates) {
    const sim = similarity(text.slice(at[0], at[1]), q);
    if (sim < FUZZY) continue;
    const s = sim * 100 + score(at[0], at[1] - at[0]);
    if (!best || s > best.score) best = { at, sim, score: s };
  }
  return best ? toRaw(view, best.at[0], best.at[1]) : null;
}

/**
 * Dónde queda un resaltado al pasar de un texto (`before`) a otro (`after`). null si ya no está.
 */
export function relocate(
  before: string,
  after: string,
  m: Anchorable,
): Offsets | null {
  const piece = before.slice(m.start_offset, m.end_offset);
  if (!piece.trim()) return null;
  const expected = m.start_offset / Math.max(1, before.length);
  const prefix = before.slice(
    Math.max(0, m.start_offset - CONTEXT),
    m.start_offset,
  );
  const suffix = before.slice(m.end_offset, m.end_offset + CONTEXT);

  // El mismo texto exacto, eligiendo por contexto y cercanía.
  const spots = occurrences(after, piece);
  if (spots.length) {
    const near = expected * after.length;
    const rank = (i: number) =>
      common(after.slice(Math.max(0, i - CONTEXT), i), prefix, false) +
      common(
        after.slice(i + piece.length, i + piece.length + CONTEXT),
        suffix,
        true,
      ) -
      Math.abs(i - near) / Math.max(1, after.length);
    const best = spots.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    return { start_offset: best, end_offset: best + piece.length };
  }
  return findQuote(
    after,
    m.quote || readableSlice(before, m.start_offset, m.end_offset),
    expected,
    {
      before: readableSlice(
        before,
        Math.max(0, m.start_offset - CONTEXT * 2),
        m.start_offset,
      ),
      after: readableSlice(before, m.end_offset, m.end_offset + CONTEXT * 2),
    },
  );
}

/**
 * Revisa los resaltados de un artículo contra su texto actual. Los que ya no coinciden con lo que
 * guardaron (`quote`) se vuelven a buscar: `moved` son los que hay que recolocar y `lost` los que
 * no aparecen (se dejan donde estaban para no perder la nota).
 */
export function heal<T extends Anchorable & { id: string }>(
  content: string,
  marks: T[],
) {
  const moved: { id: string; to: Offsets }[] = [];
  const lost: string[] = [];
  for (const m of marks) {
    const quote = normalize(m.quote ?? "");
    if (!quote) continue;
    const fits =
      m.end_offset <= content.length && m.start_offset < m.end_offset;
    const now = fits
      ? normalize(readableSlice(content, m.start_offset, m.end_offset))
      : "";
    if (now === quote) continue;
    // Diferencias mínimas (p. ej. citas guardadas con otro formato): se deja donde está.
    if (fits && now && similarity(now, quote) >= 0.92) continue;
    const to = findQuote(
      content,
      m.quote!,
      m.start_offset / Math.max(1, content.length),
    );
    if (
      to &&
      (to.start_offset !== m.start_offset || to.end_offset !== m.end_offset)
    )
      moved.push({ id: m.id, to });
    else if (!to) lost.push(m.id);
  }
  return { moved, lost };
}

/** Tramos que se quitan de un texto (en sus posiciones de antes), ordenados y sin solaparse. */
export type Cut = { start: number; end: number };

/** El texto sin los tramos quitados. */
export const applyCuts = (content: string, cuts: Cut[]) => {
  let out = "";
  let pos = 0;
  for (const c of cuts) {
    out += content.slice(pos, c.start);
    pos = c.end;
  }
  return out + content.slice(pos);
};

/** Dónde queda una posición tras quitar los tramos (dentro de uno, va a su comienzo). */
export function mapThroughCuts(pos: number, cuts: Cut[]) {
  let shift = 0;
  for (const c of cuts) {
    if (pos <= c.start) break;
    if (pos < c.end) return c.start - shift;
    shift += c.end - c.start;
  }
  return pos - shift;
}
