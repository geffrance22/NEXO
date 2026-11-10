import { linesOf } from "./trim";

/**
 * Lectura en capas: el mismo artículo leído tres veces, cada vez más hondo.
 *
 * 1. Mapa: los títulos y la primera frase de cada párrafo (la estructura, en un minuto).
 * 2. Ideas clave: las frases que más concentran los temas del artículo, elegidas por frecuencia de
 *    sus palabras importantes, su posición y tus resaltados (sin IA: al instante y sin cuota).
 * 3. Lectura guiada: párrafo a párrafo, con las ideas clave marcadas y una pausa para recordar al
 *    terminar cada sección.
 */
export type Sentence = { text: string; key: boolean };
export type Paragraph = {
  /** Posición en el texto guardado (para volver a ese punto del artículo). */
  start: number;
  kind: "text" | "list" | "quote";
  sentences: Sentence[];
};
export type Section = { title: string; start: number; paragraphs: Paragraph[] };

const STOP = new Set(
  (
    "a al algo algunas algunos ante antes aquel aquella aquello aqui así aun aunque cada casi como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era eran es esa esas ese eso esos esta estaba estado estan estar este esto estos fue fueron ha habia han hasta hay la las le les lo los mas me mi mientras mismo mucho muy nada ni no nos nosotros o otra otras otro otros para pero poco por porque que quien se sea ser si sido siempre sin sino sobre solo son su sus tambien tan tanto te tiene tienen todo todos tras tu un una uno unos usted ya yo " +
    "about after all also an and any are as at be because been before being but by can could did do does each for from had has have he her his how if in into is it its just like may more most my no not now of on one only or other our out over said she so some such than that the their them then there these they this those through to up us very was we were what when where which while who will with would you your"
  ).split(" "),
);

const words = (s: string) =>
  (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .match(/[\p{L}\p{N}]{3,}/gu) ?? []
  ).filter((w) => !STOP.has(w));

/** Frases de un párrafo (sin partir abreviaturas cortas como «p. ej.» ni números). */
export function sentencesOf(text: string) {
  return text
    .split(/(?<=[.!?…»"”])\s+(?=[«"“¿¡(\p{Lu}\d])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Las secciones del artículo con sus párrafos y frases. `marks`: tramos resaltados (en el texto
 * guardado), que suben la importancia de las frases que tocan.
 */
export function layersOf(
  content: string,
  marks: { start_offset: number; end_offset: number }[] = [],
) {
  const sections: Section[] = [];
  let current: Section = { title: "", start: 0, paragraphs: [] };
  const all: {
    s: Sentence;
    words: string[];
    first: boolean;
    marked: boolean;
    order: number;
  }[] = [];
  for (const line of linesOf(content)) {
    if (line.kind === "image") continue;
    if (line.kind === "heading") {
      if (current.paragraphs.length || current.title) sections.push(current);
      current = { title: line.text.trim(), start: line.start, paragraphs: [] };
      continue;
    }
    const text = line.text.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!text) continue;
    const marked = marks.some(
      (m) => m.start_offset < line.textEnd && m.end_offset > line.start,
    );
    const sentences = sentencesOf(text).map((t) => ({ text: t, key: false }));
    sentences.forEach((s, i) =>
      all.push({
        s,
        words: words(s.text),
        first: i === 0,
        marked,
        order: all.length,
      }),
    );
    current.paragraphs.push({
      start: line.start,
      kind:
        line.kind === "quote"
          ? "quote"
          : line.kind === "list"
            ? "list"
            : "text",
      sentences,
    });
  }
  if (current.paragraphs.length || current.title) sections.push(current);

  // Frecuencia de las palabras importantes en todo el artículo (las de los títulos cuentan más).
  const freq = new Map<string, number>();
  for (const x of all)
    for (const w of new Set(x.words)) freq.set(w, (freq.get(w) ?? 0) + 1);
  for (const sec of sections)
    for (const w of words(sec.title)) freq.set(w, (freq.get(w) ?? 0) + 3);
  const scored = all
    .filter((x) => x.words.length >= 4)
    .map((x) => {
      const weight = x.words.reduce(
        (n, w) => n + Math.log(1 + (freq.get(w) ?? 0)),
        0,
      );
      // Normalizado por largo (sin premiar las frases larguísimas) y con bonus por posición.
      const score =
        weight / Math.pow(x.words.length, 0.7) +
        (x.first ? 0.6 : 0) +
        (x.marked ? 1.2 : 0) +
        (x.order < 3 ? 0.4 : 0);
      return { x, score };
    })
    .sort((a, b) => b.score - a.score);
  const quota = Math.min(24, Math.max(5, Math.round(all.length * 0.15)));
  for (const { x } of scored.slice(0, quota)) x.s.key = true;
  return sections;
}

/** Palabras que se leen en un conjunto de frases (para estimar minutos por capa). */
export const wordsIn = (sentences: Sentence[]) =>
  sentences.reduce((n, s) => n + (s.text.match(/\S+/g)?.length ?? 0), 0);
