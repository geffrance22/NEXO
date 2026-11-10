import { supabase } from "../backend";
import { applyCuts, mapThroughCuts, type Cut } from "./anchors";
import { readableSlice } from "./formatting";
import { pictures } from "./media";

/**
 * Limpiar un artículo: quitar líneas enteras (avisos, menús, pies de página…) sin tocar el resto.
 * Como solo se quitan tramos, cada resaltado se recoloca de forma exacta: se resta lo quitado
 * antes de él. Los que quedaban dentro de lo quitado se borran; los que lo tocaban en parte se
 * recortan. La posición de lectura se recoloca igual.
 */

/** Una línea del artículo: su texto [start, textEnd) y los saltos que la siguen hasta `end`. */
export type Line = {
  start: number;
  textEnd: number;
  end: number;
  kind: "heading" | "quote" | "image" | "list" | "text";
  /** Lo que se lee (sin formato). */
  text: string;
  /** Imagen de la línea (si es solo una imagen). */
  image?: { url: string; alt: string };
};

const IMAGE_LINE = /^\s*!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\s*$/;

/** Las líneas con texto del artículo (las vacías van con la anterior). */
export function linesOf(content: string): Line[] {
  const out: Line[] = [];
  const re = /[^\n]*\S[^\n]*/g;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    const start = m.index;
    const textEnd = start + m[0].length;
    const raw = m[0];
    const img = raw.match(IMAGE_LINE);
    out.push({
      start,
      textEnd,
      end: textEnd,
      kind: img
        ? "image"
        : /^#{1,6}\s/.test(raw)
          ? "heading"
          : /^>\s/.test(raw)
            ? "quote"
            : /^\s*(?:[-*•]|\d+[.)])\s/.test(raw)
              ? "list"
              : "text",
      text: img ? img[1] : readableSlice(content, start, textEnd),
      ...(img && { image: { url: img[2], alt: img[1] } }),
    });
  }
  for (let i = 0; i < out.length; i++)
    out[i].end = i + 1 < out.length ? out[i + 1].start : content.length;
  return out;
}

/**
 * Los tramos que se quitan al borrar esas líneas. Si se borra el final, también se van los saltos
 * que quedarían colgando después de la última línea.
 */
export function cutsFor(lines: Line[], removed: ReadonlySet<number>): Cut[] {
  const raw: Cut[] = [];
  let lastKept = -1;
  lines.forEach((l, i) => {
    if (removed.has(i)) raw.push({ start: l.start, end: l.end });
    else lastKept = i;
  });
  if (lastKept >= 0 && lastKept < lines.length - 1) {
    const l = lines[lastKept];
    if (l.end > l.textEnd) raw.push({ start: l.textEnd, end: l.end });
  }
  // Ordenados y unidos los que se tocan.
  const cuts: Cut[] = [];
  for (const c of raw.sort((a, b) => a.start - b.start)) {
    const last = cuts[cuts.length - 1];
    if (last && last.end >= c.start) last.end = Math.max(last.end, c.end);
    else cuts.push({ ...c });
  }
  return cuts;
}

type MarkRow = {
  id: string;
  start_offset: number;
  end_offset: number;
} & Record<string, unknown>;

/** Lo que había antes de limpiar: para deshacerlo. */
export type TrimSnapshot = {
  id: string;
  content: string;
  media: Record<string, string> | null;
  resume_at: number;
  /** Resaltados recolocados (con su posición y cita de antes). */
  moved: {
    id: string;
    start_offset: number;
    end_offset: number;
    quote: unknown;
  }[];
  /** Resaltados borrados, enteros (se vuelven a crear con el mismo id). */
  deleted: MarkRow[];
};

/** Qué pasará con los resaltados al quitar esos tramos. */
export function planMarks(before: string, cuts: Cut[], marks: MarkRow[]) {
  const after = applyCuts(before, cuts);
  const moved: { m: MarkRow; start: number; end: number }[] = [];
  const deleted: MarkRow[] = [];
  for (const m of marks) {
    let start = mapThroughCuts(m.start_offset, cuts);
    let end = mapThroughCuts(m.end_offset, cuts);
    while (start < end && /\s/.test(after[start])) start++;
    while (end > start && /\s/.test(after[end - 1])) end--;
    if (end <= start || !readableSlice(after, start, end).trim())
      deleted.push(m);
    else if (start !== m.start_offset || end !== m.end_offset)
      moved.push({ m, start, end });
  }
  return { after, moved, deleted };
}

/**
 * Guarda el artículo sin esos tramos y recoloca sus resaltados. Devuelve la fila nueva y lo
 * necesario para deshacerlo.
 */
export async function saveTrim<Row>(
  article: {
    id: string;
    content: string;
    media?: Record<string, string> | null;
    resume_at: number;
  },
  cuts: Cut[],
  marks: MarkRow[],
) {
  const { after, moved, deleted } = planMarks(article.content, cuts, marks);
  if (!after.trim())
    throw Error("No puedes quitar todo el texto del artículo.");
  // Las copias de imágenes que ya no aparecen en el texto se quitan.
  const urls = new Set(pictures(after).map((m) => m[2]));
  const media = Object.fromEntries(
    Object.entries(article.media ?? {}).filter(([url]) => urls.has(url)),
  );
  const resume = Math.min(
    after.length,
    mapThroughCuts(article.resume_at || 0, cuts),
  );
  const { data, error } = await supabase
    .from("readings")
    .update({ content: after, media, resume_at: resume })
    .eq("id", article.id)
    .select("*")
    .single();
  if (error) throw error;

  const results = await Promise.all([
    ...moved.map((x) =>
      supabase
        .from("reading_marks")
        .update({
          start_offset: x.start,
          end_offset: x.end,
          quote: readableSlice(after, x.start, x.end),
        })
        .eq("id", x.m.id),
    ),
    ...(deleted.length
      ? [
          supabase
            .from("reading_marks")
            .delete()
            .in(
              "id",
              deleted.map((m) => m.id),
            ),
        ]
      : []),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;

  const snapshot: TrimSnapshot = {
    id: article.id,
    content: article.content,
    media: article.media ?? null,
    resume_at: article.resume_at || 0,
    moved: moved.map((x) => ({
      id: x.m.id,
      start_offset: x.m.start_offset,
      end_offset: x.m.end_offset,
      quote: x.m.quote,
    })),
    deleted,
  };
  return { row: data as Row, removed: deleted.length, snapshot };
}

/** Deshace una limpieza: el texto, las imágenes, la posición y los resaltados de antes. */
export async function undoTrim<Row>(s: TrimSnapshot) {
  const { data, error } = await supabase
    .from("readings")
    .update({
      content: s.content,
      media: s.media ?? {},
      resume_at: s.resume_at,
    })
    .eq("id", s.id)
    .select("*")
    .single();
  if (error) throw error;
  const results = await Promise.all([
    ...s.moved.map(({ id, ...back }) =>
      supabase.from("reading_marks").update(back).eq("id", id),
    ),
    ...(s.deleted.length
      ? [supabase.from("reading_marks").insert(s.deleted)]
      : []),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  return data as Row;
}
