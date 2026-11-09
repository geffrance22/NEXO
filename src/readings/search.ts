import { useEffect, useState } from "react";
import { supabase } from "../backend";

/** Resaltado que hay que mostrar al abrir un artículo (lo deja el buscador global). */
export const JUMP_KEY = "nexo-reading-jump";

export type ReadingHit =
  | {
      type: "reading";
      id: string;
      title: string;
      url: string;
      inTitle: boolean;
    }
  | {
      type: "mark";
      id: string;
      reading_id: string;
      /** Título del artículo. */
      title: string;
      quote: string;
      note: string;
      start: number;
    };

/** Cuántos de cada clase. */
const LIMIT = 5;
/** Con menos letras casi todo coincide (y se recorre el texto entero de cada artículo). */
const MIN = 2;

/** Patrón seguro para un filtro `or` de PostgREST: sin comas, paréntesis ni comodines propios. */
const pattern = (q: string) =>
  '"%' + q.replace(/["\\%_*(),]/g, " ").trim() + '%"';

/**
 * Busca en Lecturas para el buscador global: artículos (por título o texto) y resaltados (por la
 * cita o la nota). Espera un instante a que termines de escribir; sin conexión no devuelve nada.
 */
export function useReadingSearch(query: string) {
  const [hits, setHits] = useState<{
    q: string;
    readings: ReadingHit[];
    marks: ReadingHit[];
  }>({
    q: "",
    readings: [],
    marks: [],
  });
  const [loading, setLoading] = useState(false);
  const q = query.trim();
  useEffect(() => {
    if (q.length < MIN) {
      setHits({ q: "", readings: [], marks: [] });
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const like = pattern(q);
      const [articles, marks] = await Promise.all([
        supabase
          .from("readings")
          .select("id,title,url")
          .or(`title.ilike.${like},content.ilike.${like}`)
          .order("created_at", { ascending: false })
          .limit(LIMIT * 3),
        supabase
          .from("reading_marks")
          .select("id,reading_id,quote,note,start_offset")
          .or(`quote.ilike.${like},note.ilike.${like}`)
          .order("edited_at", { ascending: false })
          .limit(LIMIT),
      ]);
      if (!live) return;
      const needle = q.toLocaleLowerCase("es");
      const readings: ReadingHit[] = (
        (articles.data ?? []) as { id: string; title: string; url: string }[]
      )
        .map((r) => ({
          type: "reading" as const,
          ...r,
          inTitle: r.title.toLocaleLowerCase("es").includes(needle),
        }))
        // Los que lo dicen en el título, primero.
        .sort((a, b) => Number(b.inTitle) - Number(a.inTitle))
        .slice(0, LIMIT);
      const rows = (marks.data ?? []) as {
        id: string;
        reading_id: string;
        quote: string | null;
        note: string;
        start_offset: number;
      }[];
      // Títulos de los artículos de esos resaltados (los que no vinieron ya).
      const titles = new Map(
        readings.map((r) => [r.id, r.type === "reading" ? r.title : ""]),
      );
      const missing = [...new Set(rows.map((r) => r.reading_id))].filter(
        (id) => !titles.has(id),
      );
      if (missing.length) {
        const { data } = await supabase
          .from("readings")
          .select("id,title")
          .in("id", missing);
        if (!live) return;
        for (const r of (data ?? []) as { id: string; title: string }[])
          titles.set(r.id, r.title);
      }
      setHits({
        q,
        readings,
        marks: rows.map((m) => ({
          type: "mark" as const,
          id: m.id,
          reading_id: m.reading_id,
          title: titles.get(m.reading_id) ?? "",
          quote: (m.quote ?? "").replace(/\s+/g, " ").trim(),
          note: m.note.replace(/\s+/g, " ").trim(),
          start: m.start_offset,
        })),
      });
      setLoading(false);
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  // Mientras llega lo nuevo no se muestra lo de otra búsqueda.
  const fresh = hits.q === q;
  return {
    readings: fresh ? hits.readings : [],
    marks: fresh ? hits.marks : [],
    loading: loading && q.length >= MIN,
  };
}
