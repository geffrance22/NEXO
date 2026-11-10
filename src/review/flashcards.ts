import { supabase } from "../backend";
import { addDays, todayInputValue } from "../lib/format";
import { schedule, type Grade } from "../readings/review";

/**
 * Flashcards de Lecturas dentro del repaso espaciado. Entran a partir del día siguiente a
 * crearlas. Necesita la migración 202611100003_reading_flashcards.sql (sin ella no aparecen).
 */
export type DueFlashcard = {
  id: string;
  reading_id: string | null;
  source: string;
  front: string;
  back: string;
  review_step: number;
};

/** Las flashcards que toca repasar hoy, las más atrasadas primero. null si falta la migración. */
export async function dueFlashcards(limit: number) {
  const today = todayInputValue();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error, count } = await supabase
    .from("reading_flashcards")
    .select("id,reading_id,source,front,back,review_step", { count: "exact" })
    .gte("review_step", 0)
    .or(
      `review_due.lte.${today},and(review_due.is.null,created_at.lte.${dayAgo})`,
    )
    .order("review_due", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return null;
  const items = (data ?? []) as DueFlashcard[];
  return { items, total: count ?? items.length };
}

/** Guarda cómo te fue con una flashcard y cuándo vuelve. */
export async function rateFlashcard(card: DueFlashcard, grade: Grade) {
  const { step, days } = schedule(card.review_step, grade);
  const { error } = await supabase
    .from("reading_flashcards")
    .update({
      review_step: step,
      review_due: days === null ? null : addDays(todayInputValue(), days),
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", card.id);
  if (error) throw error;
}
