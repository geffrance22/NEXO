import { supabase } from "../backend";
import { todayInputValue } from "../lib/format";
import { asDefinition, defineWord, type Definition } from "../readings/define";
import { schedule, type Grade } from "../readings/review";
import { memoryOf } from "./fsrs";
import { saveMemory, withMemory } from "./memoryStore";

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
  /** Ficha generada con IA (migración 202611090005; sin ella no llega). */
  definition?: Definition | null;
  review_step: number;
  review_due?: string | null;
  review_stability?: number | null;
  review_difficulty?: number | null;
  reviewed_at?: string | null;
};

const BASE_COLUMNS = "id,term,context,note,reading_id,source,review_step,review_due";

/** Las palabras que toca repasar hoy, las más atrasadas primero. null si falta la migración. */
export async function dueWords(limit: number) {
  const today = todayInputValue();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const query = (columns: string) =>
    withMemory<DueWord[]>((extra) =>
      supabase
        .from("reading_words")
        .select(columns + extra, { count: "exact" })
        .is("learned_at", null)
        .gte("review_step", 0)
        .or(
          `review_due.lte.${today},and(review_due.is.null,created_at.lte.${dayAgo})`,
        )
        .order("review_due", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(limit),
    );
  // Con la ficha de IA; si aún no existe la columna, sin ella.
  let res = await query(BASE_COLUMNS + ",definition");
  if (res.error) res = await query(BASE_COLUMNS);
  const { data, error, count } = res;
  if (error) return null;
  const items = ((data ?? []) as DueWord[]).map((w) => ({
    ...w,
    definition: asDefinition(w.definition),
  }));
  return { items, total: count ?? items.length };
}

/**
 * Genera con IA la ficha de una palabra que aún no la tiene y la guarda en el diccionario
 * (si falta la columna, se ve igual en este repaso).
 */
export async function defineDueWord(word: DueWord) {
  const definition = await defineWord(word.term, word.context);
  await supabase.from("reading_words").update({ definition }).eq("id", word.id);
  return definition;
}

/** Guarda cómo te fue con una palabra y cuándo vuelve. «nunca»: queda como aprendida. */
export async function rateWord(word: DueWord, grade: Grade) {
  const next = schedule(memoryOf(word), grade);
  await saveMemory(
    "reading_words",
    word.id,
    next,
    next.days === null ? { learned_at: new Date().toISOString() } : {},
  );
}

/** Lo que significa, con tus palabras (se escribe desde el repaso). */
export async function saveWordNote(word: DueWord, note: string) {
  const { error } = await supabase
    .from("reading_words")
    .update({ note: note.trim().slice(0, 4000) })
    .eq("id", word.id);
  if (error) throw error;
}
