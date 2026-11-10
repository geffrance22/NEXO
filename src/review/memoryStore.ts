import { supabase } from "../backend";
import { todayInputValue } from "../lib/format";
import { memoryColumns, missingMemory, type Next } from "./fsrs";

/** Columnas de la memoria de FSRS (migración 202611100004). */
export const MEMORY_COLUMNS = "review_stability,review_difficulty,reviewed_at";

/**
 * Guarda un repaso en una fila. Si aún no se ejecutó la migración de FSRS, se guarda como antes
 * (paso y fecha): el repaso sigue funcionando y la memoria se estima la próxima vez.
 */
export async function saveMemory(
  table: "reading_marks" | "reading_flashcards" | "reading_words",
  id: string,
  next: Next,
  extra: Record<string, unknown> = {},
) {
  const full = { ...memoryColumns(next, todayInputValue()), ...extra };
  const first = await supabase.from(table).update(full).eq("id", id);
  if (!first.error) return;
  if (!missingMemory(first.error)) throw first.error;
  const legacy: Record<string, unknown> = { ...full };
  delete legacy.review_stability;
  delete legacy.review_difficulty;
  // El diccionario no tenía fecha del último repaso.
  if (table === "reading_words") delete legacy.reviewed_at;
  const second = await supabase.from(table).update(legacy).eq("id", id);
  if (second.error) throw second.error;
}

/**
 * Lee con las columnas de la memoria y, si faltan (migración sin ejecutar), sin ellas.
 * `run` recibe las columnas extra que debe pedir.
 */
export async function withMemory<T>(
  run: (extra: string) => PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
    count?: number | null;
  }>,
  legacyExtra = "",
): Promise<{
  data: T | null;
  error: { code?: string; message: string } | null;
  count?: number | null;
}> {
  const first = await run("," + MEMORY_COLUMNS);
  if (!first.error || !missingMemory(first.error))
    return first as { data: T | null; error: null; count?: number | null };
  return (await run(legacyExtra)) as {
    data: T | null;
    error: { code?: string; message: string } | null;
    count?: number | null;
  };
}
