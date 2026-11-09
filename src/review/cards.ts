import type { Entry } from "../data";
import {
  faces,
  rateReview,
  type Grade,
  type ReviewItem,
} from "../readings/review";
import { rateLearning, type DueLearning } from "./learnings";
import { rateQuote, type DueQuote } from "./quotes";
import { rateWord, type DueWord } from "./words";

/**
 * Una tarjeta del repaso: un resaltado de un artículo (viene de Lecturas), una cita de un libro,
 * un aprendizaje (p. ej. el que dejó el cierre de un libro o una película) o una palabra del
 * diccionario. Todas se programan igual (1, 3, 7, 16… días), pero se guardan en sitios distintos.
 */
type Base = {
  id: string;
  /** Cuántas veces seguidas la recordaste. */
  step: number;
  quote: string;
  /** De dónde viene: el artículo, el libro o la obra del aprendizaje. */
  from: { id: string; title: string; author?: string };
};
export type ReviewCard =
  | (Base & { source: "resaltado"; item: ReviewItem })
  | (Base & { source: "cita"; book: Entry; key: string })
  | (Base & { source: "aprendizaje"; entry: Entry; origin?: Entry })
  | (Base & { source: "palabra"; word: DueWord });

export const fromWord = (w: DueWord): ReviewCard => ({
  id: "w:" + w.id,
  source: "palabra",
  step: w.review_step,
  quote: w.context || w.term,
  from: { id: w.reading_id ?? "", title: w.source || "Tu diccionario" },
  word: w,
});

export const fromHighlight = (item: ReviewItem): ReviewCard => ({
  id: "h:" + item.id,
  source: "resaltado",
  step: item.review_step,
  quote: item.quote,
  from: { id: item.reading_id, title: item.title },
  item,
});

export const fromQuote = (q: DueQuote): ReviewCard => ({
  id: "q:" + q.id,
  source: "cita",
  step: q.step,
  quote: q.text,
  from: { id: q.book.id, title: q.book.title, author: q.book.details.author },
  book: q.book,
  key: q.key,
});

export const fromLearning = (l: DueLearning): ReviewCard => ({
  id: "a:" + l.entry.id,
  source: "aprendizaje",
  step: l.step,
  quote: l.entry.body,
  from: l.source
    ? {
        id: l.source.id,
        title: l.source.title,
        author: l.source.details.author,
      }
    : { id: l.entry.id, title: l.entry.details.sourceName || l.entry.title },
  entry: l.entry,
  origin: l.source,
});

/** Intercala varias listas (una de cada una, por turnos) para que ninguna acapare el repaso. */
export function interleave<T>(...lists: T[][]) {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++)
    for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/**
 * Anverso y reverso. Un resaltado con pregunta o con nota se ve como siempre; una cita de un libro
 * no esconde nada: se lee, se recuerda y, a veces, se usa. Un aprendizaje se pregunta: ¿qué te
 * llevaste de esa obra? y detrás está lo que escribiste.
 */
export function cardFaces(card: ReviewCard) {
  if (card.source === "resaltado") return faces(card.item);
  if (card.source === "palabra")
    return {
      front: `¿Qué significa «${card.word.term}»?`,
      kind: "pregunta" as const,
      back: card.word.note.trim(),
      quote: card.word.context.trim(),
    };
  if (card.source === "aprendizaje") {
    const apply = card.entry.details.apply?.trim();
    return {
      front: `¿Qué te llevaste de «${card.from.title}»?`,
      kind: "pregunta" as const,
      back: card.entry.body.trim() + (apply ? `\n\nLo aplicaré: ${apply}` : ""),
      quote: "",
    };
  }
  return { front: card.quote, kind: "cita" as const, back: "", quote: "" };
}

type Patch = (
  entry: Entry,
  changes: { details: Entry["details"] },
) => Promise<boolean>;

/** Guarda cómo te fue; citas y aprendizajes se anotan en su recuerdo (la versión más reciente). */
export async function rateCard(
  card: ReviewCard,
  grade: Grade,
  deps: { entries: Entry[]; patch: Patch },
) {
  if (card.source === "resaltado") return rateReview(card.item, grade);
  if (card.source === "palabra") return rateWord(card.word, grade);
  if (card.source === "aprendizaje") {
    const entry =
      deps.entries.find((e) => e.id === card.entry.id) ?? card.entry;
    return rateLearning(card.step, grade, entry, deps.patch);
  }
  const book = deps.entries.find((e) => e.id === card.book.id) ?? card.book;
  return rateQuote(card, grade, book, deps.patch);
}
