import { supabase } from "../backend";
import { addDays, todayInputValue } from "../lib/format";
import { schedule, type Grade } from "../readings/review";

/**
 * Palabras del diccionario de Lecturas dentro del repaso espaciado. Entran las que aún no tachaste
 * como aprendidas, a partir del día siguiente a guardarlas. «No repasar más» las tacha.
 * Necesita la migración 202611090003_reading_refinements.sql (sin ella no aparecen).
 */
export type DueWord = {
  id: string;
  term: string;
  context: string;
  note: string;
  reading_id: string | null;
  source: string;
  review_step: number;
};

/** Las palabras que toca repasar hoy, las más atrasadas primero. null si falta la migración. */
export async function dueWords(limit: number) {
  const today = todayInputValue();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error, count } = await supabase
    .from("reading_words")
    .select("id,term,context,note,reading_id,source,review_step", {
      count: "exact",
    })
    .is("learned_at", null)
    .gte("review_step", 0)
    .or(
      `review_due.lte.${today},and(review_due.is.null,created_at.lte.${dayAgo})`,
    )
    .order("review_due", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return null;
  const items = (data ?? []) as DueWord[];
  return { items, total: count ?? items.length };
}

/** Guarda cómo te fue con una palabra y cuándo vuelve. «nunca»: queda como aprendida. */
export async function rateWord(word: DueWord, grade: Grade) {
  const { step, days } = schedule(word.review_step, grade);
  const changes =
    days === null
      ? {
          review_step: -1,
          review_due: null,
          learned_at: new Date().toISOString(),
        }
      : { review_step: step, review_due: addDays(todayInputValue(), days) };
  const { error } = await supabase
    .from("reading_words")
    .update(changes)
    .eq("id", word.id);
  if (error) throw error;
}

/** Lo que significa, con tus palabras (se escribe desde el repaso). */
export async function saveWordNote(word: DueWord, note: string) {
  const { error } = await supabase
    .from("reading_words")
    .update({ note: note.trim().slice(0, 4000) })
    .eq("id", word.id);
  if (error) throw error;
}
