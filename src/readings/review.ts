import { supabase } from '../backend';
import { addDays, todayInputValue } from '../lib/format';
import { AI_MARK } from './ask';

/** Un resaltado listo para repasar. */
export type ReviewItem = {
  id: string;
  reading_id: string;
  title: string;
  quote: string;
  note: string;
  review_step: number;
};

/** Días hasta el siguiente repaso según cuántas veces seguidas lo recordaste. */
const INTERVALS = [1, 3, 7, 16, 35, 90, 180];
/** Tarjetas por día: pocas, para que sea un hábito y no una carga. */
export const DAILY_REVIEWS = 5;

export type Grade = 'otra' | 'bien' | 'facil' | 'nunca';

/**
 * Lo que toca repasar hoy: lo que ya venció y lo resaltado hace más de un día que nunca se
 * repasó. Devuelve null si falta la migración 202611070009_reading_review.sql.
 */
export async function dueReviews(limit = DAILY_REVIEWS) {
  const today = todayInputValue();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error, count } = await supabase
    .from('reading_annotations')
    .select('id,reading_id,title,quote,note,review_step', { count: 'exact' })
    .gte('review_step', 0)
    .or(`review_due.lte.${today},and(review_due.is.null,edited_at.lte.${dayAgo})`)
    .order('review_due', { ascending: true, nullsFirst: false })
    .order('edited_at', { ascending: true })
    .limit(limit);
  if (error) return null;
  const items = ((data ?? []) as ReviewItem[]).filter((r) => r.quote?.trim());
  return { items, total: count ?? items.length };
}

/** Siguiente paso y fecha según cómo te fue. */
export function schedule(step: number, grade: Grade) {
  if (grade === 'nunca') return { step: -1, days: null };
  if (grade === 'otra') return { step: 0, days: 1 };
  const next = Math.min(INTERVALS.length - 1, Math.max(0, step) + (grade === 'facil' ? 2 : 1));
  return { step: next, days: INTERVALS[next] };
}

export async function rateReview(item: ReviewItem, grade: Grade) {
  const { step, days } = schedule(item.review_step, grade);
  const { error } = await supabase
    .from('reading_marks')
    .update({
      review_step: step,
      review_due: days === null ? null : addDays(todayInputValue(), days),
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', item.id);
  if (error) throw error;
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
          : `en ${Math.round(days / 30)} meses`;

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
