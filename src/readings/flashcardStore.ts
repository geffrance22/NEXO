import { supabase } from "../backend";

/** Una flashcard de un artículo leído (tabla `reading_flashcards`). */
export type Flashcard = {
  id: string;
  reading_id: string | null;
  /** Título del artículo (se conserva aunque el artículo se borre). */
  source: string;
  front: string;
  back: string;
  /** -1: «No repasar más». */
  review_step: number;
  review_due: string | null;
  created_at: string;
};
/** Un artículo ya leído, candidato a flashcards. */
export type ReadArticle = {
  id: string;
  title: string;
  url: string;
  read_at: string;
};

export const FLASHCARDS_SQL =
  "supabase/migrations/202611100003_reading_flashcards.sql";
const OUTDATED =
  "Actualiza la función assistant para crear flashcards: npx supabase functions deploy assistant --remote=imdvmlzdbmbvwkfoisgs --use-api --yes";
const NOT_READ = "Solo se crean flashcards de artículos ya leídos.";

export const isMissing = (e: { code?: string; message?: string }) =>
  e.code === "42P01" ||
  e.code === "PGRST205" ||
  /reading_flashcards/.test(e.message ?? "");

/** Los artículos marcados como leídos, estén en la colección que estén. */
export async function readArticles() {
  const { data, error } = await supabase
    .from("readings")
    .select("id,title,url,read_at")
    .not("read_at", "is", null)
    .order("read_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as ReadArticle[];
}

/** Todas tus flashcards; null si falta la migración. */
export async function loadFlashcards() {
  const { data, error } = await supabase
    .from("reading_flashcards")
    .select("id,reading_id,source,front,back,review_step,review_due,created_at")
    .order("created_at", { ascending: false })
    .limit(3000);
  if (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return (data ?? []) as Flashcard[];
}

/** Pide a la IA lo esencial de un artículo leído, en tarjetas de pregunta y respuesta. */
async function ask(articleId: string, avoid: string[]) {
  const { data, error } = await supabase.functions.invoke("assistant", {
    body: { mode: "reading-flashcards", articleId, avoid: avoid.slice(0, 40) },
  });
  if (error) {
    const res = (error as { context?: Response }).context;
    const detail = (await res?.json?.().catch(() => null)) as {
      error?: string;
    } | null;
    // Una versión anterior de la función no conoce este modo.
    if (res?.status === 400 && detail?.error !== NOT_READ) throw Error(OUTDATED);
    throw Error(detail?.error || "No se pudo consultar la IA.");
  }
  const cards = (Array.isArray(data?.cards) ? data.cards : []) as {
    front?: unknown;
    back?: unknown;
  }[];
  const ok = cards
    .map((c) => ({
      front: typeof c.front === "string" ? c.front.trim().slice(0, 400) : "",
      back: typeof c.back === "string" ? c.back.trim().slice(0, 1200) : "",
    }))
    .filter((c) => c.front && c.back);
  if (!ok.length) throw Error(OUTDATED);
  return ok;
}

/**
 * Crea las flashcards de un artículo y las guarda: desde mañana entran en el repaso.
 * `avoid`: las preguntas que ya tiene, para no repetirlas.
 */
export async function generateFlashcards(
  article: Pick<ReadArticle, "id" | "title">,
  avoid: string[] = [],
) {
  const cards = await ask(article.id, avoid);
  const { data, error } = await supabase
    .from("reading_flashcards")
    .insert(
      cards.map((c) => ({
        reading_id: article.id,
        source: article.title.slice(0, 300),
        front: c.front,
        back: c.back,
      })),
    )
    .select("id,reading_id,source,front,back,review_step,review_due,created_at");
  if (error) {
    if (isMissing(error))
      throw Error(
        `Para usar las flashcards ejecuta ${FLASHCARDS_SQL} en el SQL Editor de Supabase.`,
      );
    throw error;
  }
  return (data ?? []) as Flashcard[];
}

export async function deleteFlashcard(id: string) {
  const { error } = await supabase
    .from("reading_flashcards")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
