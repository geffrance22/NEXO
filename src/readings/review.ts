import { supabase } from '../backend';
import { todayInputValue } from '../lib/format';
import { memoryOf, schedule, type Grade, type Memory } from '../review/fsrs';
import { saveMemory, withMemory } from '../review/memoryStore';
import { AI_MARK } from './ask';

export { schedule, type Grade, type Memory } from '../review/fsrs';

/** Un resaltado listo para repasar. */
export type ReviewItem = {
  id: string;
  reading_id: string;
  title: string;
  quote: string;
  note: string;
  review_step: number;
  review_stability?: number | null;
  review_difficulty?: number | null;
  reviewed_at?: string | null;
  review_due?: string | null;
};

/** Tarjetas por día: pocas, para que sea un hábito y no una carga. */
export const DAILY_REVIEWS = 5;

/**
 * Lo que toca repasar hoy: lo que ya venció y lo resaltado hace más de un día que nunca se
 * repasó. Devuelve null si falta la migración 202611070009_reading_review.sql.
 */
export async function dueReviews(limit = DAILY_REVIEWS) {
  const today = todayInputValue();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error, count } = await withMemory<ReviewItem[]>((extra) =>
    supabase
      .from('reading_annotations')
      .select('id,reading_id,title,quote,note,review_step,review_due' + extra, {
        count: 'exact',
      })
      .gte('review_step', 0)
      .or(`review_due.lte.${today},and(review_due.is.null,edited_at.lte.${dayAgo})`)
      .order('review_due', { ascending: true, nullsFirst: false })
      .order('edited_at', { ascending: true })
      .limit(limit),
  );
  if (error) return null;
  const items = (data ?? []).filter((r) => r.quote?.trim());
  return { items, total: count ?? items.length };
}

/** La memoria de un resaltado (para calcular el siguiente repaso). */
export const reviewMemory = (item: ReviewItem): Memory => memoryOf(item);

export async function rateReview(item: ReviewItem, grade: Grade) {
  await saveMemory('reading_marks', item.id, schedule(reviewMemory(item), grade));
}

/** «mañana», «en 3 días», «en 2 semanas»… */
export const inDays = (days: number | null) =>
  days === null
    ? 'nunca'
    : days === 1
      ? 'mañana'
      : days < 14
        ? `en ${days} días`
        : days < 60
          ? `en ${Math.round(days / 7)} semanas`
          : days < 365
            ? `en ${Math.round(days / 30)} meses`
            : `en ${Math.round(days / 36.5) / 10} años`.replace('.', ',');

/**
 * Anverso y reverso de la tarjeta: si la nota es una pregunta a la IA, se pregunta y la
 * respuesta va detrás; si es una nota propia, la cita va delante y tu nota detrás.
 */
export function faces(item: ReviewItem) {
  const note = item.note.trim();
  if (note.startsWith(AI_MARK)) {
    const [first, ...rest] = note.slice(AI_MARK.length).split('\n');
    const label = first.replace(/^Pregunta guía:\s*/, '').trim();
    const prompt = /^Contraargumentos/i.test(label)
      ? '¿Qué se le puede objetar y cuál es su punto más débil?'
      : label;
    const answer = rest
      .join('\n')
      .split(/\n{2,}(?=✦ )/)[0]
      .trim();
    return { front: prompt, kind: 'pregunta' as const, back: answer, quote: item.quote };
  }
  return { front: item.quote, kind: 'cita' as const, back: note, quote: '' };
}
