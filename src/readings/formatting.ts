/** Formatting uses positions in the saved source, the same coordinate system as highlights. */
export type Format = {
  start: number;
  end: number;
  kind: "hidden" | "strong" | "em" | "heading" | "quote" | "code" | "link";
  /** Destino de un hipervínculo (`kind: 'link'`). */
  href?: string;
};

/** Hipervínculo guardado: `[texto](https://…)` (los paréntesis del destino van escapados). */
const LINK =
  /(?<!!)\[((?:[^[\]\n]|\[[^[\]\n]*\])+)\]\((https?:\/\/[^\s()]+)\)/g;
const IMAGE = /!\[[^\]]*\]\([^)]+\)/g;

function compute(source: string): Format[] {
  const result: Format[] = [];
  const hide = (start: number, end: number) =>
    result.push({ start, end, kind: "hidden" });
  for (const m of source.matchAll(/^(#{1,6}[ \t]+|>[ \t]+)(.+)$/gm)) {
    const start = m.index!,
      body = start + m[1].length;
    hide(start, body);
    result.push({
      start: body,
      end: start + m[0].length,
      kind: m[1][0] === ">" ? "quote" : "heading",
    });
  }
  // Hipervínculos: se ve solo su texto. Sus destinos no cuentan para negritas ni cursivas.
  const links: [number, number][] = [];
  for (const m of source.matchAll(LINK)) {
    const start = m.index!,
      text = start + 1 + m[1].length,
      end = start + m[0].length;
    links.push([text, end]);
    hide(start, start + 1);
    hide(text, end);
    result.push({ start: start + 1, end: text, kind: "link", href: m[2] });
  }
  const inTarget = (a: number, b: number) =>
    links.some(([s, e]) => a < e && b > s);
  for (const m of source.matchAll(
    /(!\[[^\]]*\]\([^)]+\))|(\*\*|__|\x60|\*|(?<!\w)_)(?=\S)([^\n]+?)(?<=\S)\2(?!\w)/g,
  )) {
    if (m[1]) continue;
    const width = m[2].length,
      start = m.index!,
      end = start + m[0].length;
    if (links.length && inTarget(start, end)) continue;
    hide(start, start + width);
    hide(end - width, end);
    result.push({
      start: start + width,
      end: end - width,
      kind: width === 2 ? "strong" : m[2] === "\x60" ? "code" : "em",
    });
  }
  return result;
}

/*
 * El mismo texto se consulta muchas veces seguidas (cada cita, la barra de resaltado, el
 * diccionario…): se recuerdan los últimos resultados en lugar de volver a recorrerlo entero.
 */
const cache = new Map<string, { rules: Format[]; hidden?: Format[] }>();
function entry(source: string) {
  let hit = cache.get(source);
  if (hit) {
    // Lo más reciente va al final (se descarta lo más viejo).
    cache.delete(source);
    cache.set(source, hit);
    return hit;
  }
  hit = { rules: compute(source) };
  cache.set(source, hit);
  if (cache.size > 6) cache.delete(cache.keys().next().value!);
  return hit;
}

export function formats(source: string): Format[] {
  return entry(source).rules;
}

/** Tramos que no se leen (marcas de formato e imágenes), ordenados. */
function hiddenOf(source: string) {
  const e = entry(source);
  if (!e.hidden) {
    const hidden = e.rules.filter((f) => f.kind === "hidden");
    for (const m of source.matchAll(IMAGE))
      hidden.push({
        start: m.index!,
        end: m.index! + m[0].length,
        kind: "hidden",
      });
    e.hidden = hidden.sort((a, b) => a.start - b.start);
  }
  return e.hidden;
}

export function readableSlice(source: string, start = 0, end = source.length) {
  let pos = start,
    text = "";
  for (const range of hiddenOf(source)) {
    if (range.end <= pos) continue;
    if (range.start >= end) break;
    text += source.slice(pos, Math.max(pos, range.start));
    pos = Math.max(pos, range.end);
  }
  return text + source.slice(pos, Math.max(pos, end));
}
