import type { Entry } from '../data';
import { faces, rateReview, type Grade, type ReviewItem } from '../readings/review';
import { rateQuote, type DueQuote } from './quotes';

/**
 * Una tarjeta del repaso: un resaltado de un artículo (viene de Lecturas) o una cita de un libro.
 * Las dos se programan igual (1, 3, 7, 16… días), pero se guardan en sitios distintos.
 */
type Base = {
  id: string;
  /** Cuántas veces seguidas la recordaste. */
  step: number;
  quote: string;
  /** De dónde viene: el artículo o el libro. */
  from: { id: string; title: string; author?: string };
};
export type ReviewCard =
  | (Base & { source: 'resaltado'; item: ReviewItem })
  | (Base & { source: 'cita'; book: Entry; key: string });

export const fromHighlight = (item: ReviewItem): ReviewCard => ({
  id: 'h:' + item.id,
  source: 'resaltado',
  step: item.review_step,
  quote: item.quote,
  from: { id: item.reading_id, title: item.title },
  item,
});

export const fromQuote = (q: DueQuote): ReviewCard => ({
  id: 'q:' + q.id,
  source: 'cita',
  step: q.step,
  quote: q.text,
  from: { id: q.book.id, title: q.book.title, author: q.book.details.author },
  book: q.book,
  key: q.key,
});

/** Intercala dos listas (una de cada una, por turnos) para que ninguna acapare el repaso. */
export function interleave<T>(a: T[], b: T[]) {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/**
 * Anverso y reverso. Un resaltado con pregunta o con nota se ve como siempre; una cita de un libro
 * no esconde nada: se lee, se recuerda y, a veces, se usa.
 */
export function cardFaces(card: ReviewCard) {
  if (card.source === 'resaltado') return faces(card.item);
  return { front: card.quote, kind: 'cita' as const, back: '', quote: '' };
}

type Patch = (entry: Entry, changes: { details: Entry['details'] }) => Promise<boolean>;

/** Guarda cómo te fue; las citas se anotan en su libro (la versión más reciente que haya). */
export async function rateCard(
  card: ReviewCard,
  grade: Grade,
  deps: { entries: Entry[]; patch: Patch },
) {
  if (card.source === 'resaltado') return rateReview(card.item, grade);
  const book = deps.entries.find((e) => e.id === card.book.id) ?? card.book;
  return rateQuote(card, grade, book, deps.patch);
}
