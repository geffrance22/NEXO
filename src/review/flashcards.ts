import { supabase } from "../backend";
import { todayInputValue } from "../lib/format";
import { schedule, type Grade } from "../readings/review";
import { memoryOf } from "./fsrs";
import { saveMemory, withMemory } from "./memoryStore";

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
  review_due?: string | null;
  review_stability?: number | null;
  review_difficulty?: number | null;
  reviewed_at?: string | null;
};

/** Las flashcards que toca repasar hoy, las más atrasadas primero. null si falta la migración. */
export async function dueFlashcards(limit: number) {
  const today = todayInputValue();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error, count } = await withMemory<DueFlashcard[]>(
    (extra) =>
      supabase
        .from("reading_flashcards")
        .select(
          "id,reading_id,source,front,back,review_step,review_due" + extra,
          { count: "exact" },
        )
        .gte("review_step", 0)
        .or(
          `review_due.lte.${today},and(review_due.is.null,created_at.lte.${dayAgo})`,
        )
        .order("review_due", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(limit),
    ",reviewed_at",
  );
  if (error) return null;
  const items = (data ?? []) as DueFlashcard[];
  return { items, total: count ?? items.length };
}

/** Guarda cómo te fue con una flashcard y cuándo vuelve. */
export async function rateFlashcard(card: DueFlashcard, grade: Grade) {
  await saveMemory(
    "reading_flashcards",
    card.id,
    schedule(memoryOf(card), grade),
  );
}
