import { supabase } from "../backend";
import { FSRS_SQL } from "../review/fsrs";
import { MEMORY_COLUMNS, withMemory } from "../review/memoryStore";

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
  review_stability?: number | null;
  review_difficulty?: number | null;
  reviewed_at?: string | null;
};
/** Lo que escribes al crear o editar una tarjeta a mano. */
export type CardDraft = {
  front: string;
  back: string;
  reading_id: string | null;
  source: string;
};
/** Un subrayado tuyo, candidato a tarjeta. */
export type Highlight = {
  id: string;
  reading_id: string;
  title: string;
  quote: string;
  note: string;
  color?: string | null;
};
/** Largo máximo del anverso (con la migración de FSRS; antes, 400). */
export const FRONT_MAX = 1000;
export const BACK_MAX = 1200;
const COLUMNS = "id,reading_id,source,front,back,review_step,review_due,created_at";
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
  const { data, error } = await withMemory<Flashcard[]>(
    (extra) =>
      supabase
        .from("reading_flashcards")
        .select(COLUMNS + extra)
        .order("created_at", { ascending: false })
        .limit(3000),
    ",reviewed_at",
  );
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
    .select(COLUMNS);
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

/** Error de guardado con un mensaje claro (migración que falta o tarjeta demasiado larga). */
function saveError(e: { code?: string; message?: string }) {
  if (isMissing(e))
    return Error(
      `Para usar las flashcards ejecuta ${FLASHCARDS_SQL} en el SQL Editor de Supabase.`,
    );
  if (e.code === "23514" || /front_check/.test(e.message ?? ""))
    return Error(
      `La tarjeta es demasiado larga. Para tarjetas de hasta ${FRONT_MAX} caracteres ejecuta ${FSRS_SQL} en el SQL Editor de Supabase.`,
    );
  return Error(e.message || "No se pudo guardar la flashcard.");
}

const clean = (d: CardDraft) => ({
  front: d.front.trim().slice(0, FRONT_MAX),
  back: d.back.trim().slice(0, BACK_MAX),
  reading_id: d.reading_id,
  source: d.source.slice(0, 300),
});

/** Guarda tarjetas escritas a mano (o sacadas de tus subrayados). Entran al repaso mañana. */
export async function createFlashcards(drafts: CardDraft[]) {
  const rows = drafts.map(clean).filter((d) => d.front && d.back);
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from("reading_flashcards")
    .insert(rows)
    .select(COLUMNS);
  if (error) throw saveError(error);
  return (data ?? []) as Flashcard[];
}

/**
 * Cambia el texto de una tarjeta. Su memoria se conserva: si cambias lo que pregunta, puedes
 * pedir que vuelva a empezar (`restart`).
 */
export async function updateFlashcard(
  id: string,
  draft: Pick<CardDraft, "front" | "back">,
  restart = false,
) {
  const changes: Record<string, unknown> = {
    front: draft.front.trim().slice(0, FRONT_MAX),
    back: draft.back.trim().slice(0, BACK_MAX),
  };
  if (restart)
    Object.assign(changes, {
      review_step: 0,
      review_due: null,
      reviewed_at: null,
      review_stability: null,
      review_difficulty: null,
    });
  let res = await supabase
    .from("reading_flashcards")
    .update(changes)
    .eq("id", id)
    .select(COLUMNS + "," + MEMORY_COLUMNS)
    .single();
  // Sin la migración de FSRS: sin las columnas de la memoria.
  if (res.error && /review_stability|review_difficulty/.test(res.error.message)) {
    delete changes.review_stability;
    delete changes.review_difficulty;
    res = await supabase
      .from("reading_flashcards")
      .update(changes)
      .eq("id", id)
      .select(COLUMNS + ",reviewed_at")
      .single();
  }
  if (res.error) throw saveError(res.error);
  return res.data as unknown as Flashcard;
}

/** Tus subrayados (de todos los artículos), los más recientes primero. */
export async function loadHighlights() {
  const { data, error } = await supabase
    .from("reading_annotations")
    .select("id,reading_id,title,quote,note,color")
    .order("edited_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return ((data ?? []) as Highlight[]).filter((h) => h.quote?.trim());
}