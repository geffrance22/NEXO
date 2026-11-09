import { supabase } from '../backend';
import {
  askNotebook,
  type AssistantAnswer,
  type AssistantSource,
  type ChatTurn,
} from '../assistant';
import { plainText } from '../components/RichText';
import type { Entry, Workspace } from '../data';
import { entryFacts, kindLabel } from '../lib/entries';
import { todayInputValue } from '../lib/format';
import type { Notebook, NotebookItem } from './model';

/** Lo que el lienzo sabe de una lectura o una nota rápida (no viven en el espacio de trabajo). */
export type ReadingRef = {
  id: string;
  title: string;
  url: string;
  cover: string | null;
  excerpt: string | null;
  created_at: string;
};
export type QuickNoteRef = {
  id: string;
  title: string;
  body: string;
  color: string;
};
export type Extras = {
  readings: Map<string, ReadingRef>;
  notes: Map<string, QuickNoteRef>;
};

/** Cuánto texto como mucho viaja a la IA (el modelo tiene un límite por consulta). */
const BUDGET = 30000;

const day = (iso?: string | null) => (iso ? todayInputValue(new Date(iso)) : undefined);
const clip = (s: string | undefined | null, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
const list = (v: (string | undefined | null)[] | undefined, n = 12) =>
  (v ?? []).filter((x): x is string => Boolean(x && x.trim())).slice(0, n);
const compact = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length),
    ),
  );

function entryDigest(e: Entry, ws: Workspace, max: number) {
  const d = e.details;
  const names = e.person_ids.flatMap((id) => ws.people.find((p) => p.id === id)?.name ?? []);
  return compact({
    tipo: kindLabel(e),
    titulo: e.title,
    fecha: day(e.recorded_at ?? e.created_at),
    texto: clip(plainText(e.body), max),
    datos: entryFacts(e, ws).map((f) => f.text),
    personas: names,
    etiquetas: e.tags,
    autor: d.author,
    calificacion: d.rating,
    estado: e.kind === 'Pendiente' ? e.status : undefined,
    vence: d.due,
    siguiente_paso: d.nextStep,
    aplicar: d.apply,
    sinopsis: clip(d.movieInfo?.overview, Math.min(600, max)),
    citas: list(d.quotes, 10).map((q) => clip(q, 300)),
  });
}

/** Lo que se sabe de cada elemento del cuaderno, recortado para que todo quepa en una consulta. */
async function buildDigest(nb: Notebook, ws: Workspace, extras: Extras) {
  const items = nb.items;
  const max = Math.max(250, Math.min(2500, Math.floor(BUDGET / Math.max(1, items.length))));
  const readingIds = items.filter((i) => i.type === 'reading').map((i) => i.id);
  // Resaltados y notas de las lecturas: lo más valioso de un artículo.
  const marks = new Map<string, { cita: string; nota?: string }[]>();
  if (readingIds.length) {
    const { data } = await supabase
      .from('reading_annotations')
      .select('reading_id,quote,note')
      .in('reading_id', readingIds)
      .limit(200);
    for (const m of (data ?? []) as {
      reading_id: string;
      quote: string | null;
      note: string | null;
    }[]) {
      const arr = marks.get(m.reading_id) ?? [];
      if (arr.length < 8)
        arr.push(
          compact({ cita: clip(m.quote, 280), nota: clip(m.note, 200) }) as {
            cita: string;
          },
        );
      marks.set(m.reading_id, arr);
    }
  }

  const sources: AssistantSource[] = [];
  const elementos: Record<string, unknown>[] = [];
  items.forEach((it, i) => {
    const ref = 'c' + (i + 1);
    const push = (source: Omit<AssistantSource, 'ref'> | null, data: Record<string, unknown>) => {
      if (source) sources.push({ ref, ...source });
      elementos.push({ ref, ...data });
    };
    switch (it.type) {
      case 'entry': {
        const e = ws.entries.find((x) => x.id === it.id);
        if (!e) return;
        push(
          {
            type: 'entry',
            id: e.id,
            title: e.title || kindLabel(e),
            date: day(e.created_at),
          },
          entryDigest(e, ws, max),
        );
        return;
      }
      case 'person': {
        const p = ws.people.find((x) => x.id === it.id);
        if (!p) return;
        const pr = p.profile;
        const recent = ws.entries
          .filter((e) => e.person_ids.includes(p.id))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 6)
          .map(
            (e) => `${day(e.recorded_at ?? e.created_at)} · ${kindLabel(e)}: ${clip(e.title, 90)}`,
          );
        push(
          { type: 'person', id: p.id, title: p.name },
          compact({
            tipo: 'Persona',
            nombre: p.name,
            alias: pr.alias,
            relacion: pr.relation,
            rol: p.role,
            ocupacion: pr.occupation,
            ciudad: pr.city,
            cumpleanos: pr.birthday,
            intereses: clip(p.interests, 400),
            le_gusta: list(pr.likes),
            no_le_gusta: list(pr.dislikes),
            sobre: clip(p.bio, max),
            novedades: (pr.updates ?? []).slice(0, 5).map((u) => `${u.date}: ${clip(u.text, 160)}`),
            preguntarle: list(pr.askNext, 6),
            recuerdos_recientes: recent,
          }),
        );
        return;
      }
      case 'place': {
        const pl = ws.places.find((x) => x.id === it.id);
        if (!pl) return;
        const visits = ws.entries.filter((e) => e.details.placeId === pl.id);
        push(
          { type: 'place', id: pl.id, title: pl.name },
          compact({
            tipo: 'Lugar',
            nombre: pl.name,
            clase: pl.kind,
            ciudad: pl.city,
            historia: clip(pl.story, max),
            visitas: visits.length || undefined,
            ultimas_visitas: visits
              .slice(0, 4)
              .map((e) => `${day(e.created_at)}: ${clip(e.title, 80)}`),
          }),
        );
        return;
      }
      case 'episode': {
        const ep = ws.episodes.find((x) => x.id === it.id);
        if (!ep) return;
        push(
          {
            type: 'episode',
            id: ep.id,
            title: ep.title,
            date: ep.starts_on ?? undefined,
          },
          compact({
            tipo: 'Episodio',
            titulo: ep.title,
            clase: ep.kind,
            estado: ep.status,
            desde: ep.starts_on ?? undefined,
            hasta: ep.ends_on ?? undefined,
            resumen: clip(ep.summary, max),
            resultado: clip(ep.outcome, 500),
            personas: ep.person_ids.flatMap((id) => ws.people.find((p) => p.id === id)?.name ?? []),
            bitacora: (ep.updates ?? []).slice(0, 5).map((u) => `${u.date}: ${clip(u.text, 160)}`),
          }),
        );
        return;
      }
      case 'reading': {
        const r = extras.readings.get(it.id);
        if (!r) return;
        push(
          {
            type: 'reading',
            id: r.id,
            title: r.title,
            date: day(r.created_at),
          },
          compact({
            tipo: 'Lectura',
            titulo: r.title,
            fuente: hostOf(r.url),
            extracto: clip(r.excerpt, Math.min(400, max)),
            resaltados: marks.get(r.id) ?? [],
          }),
        );
        return;
      }
      case 'note': {
        const n = extras.notes.get(it.id);
        if (!n) return;
        push(
          { type: 'note', id: n.id, title: n.title || 'Nota' },
          compact({
            tipo: 'Nota rápida',
            titulo: n.title,
            texto: clip(plainText(n.body), max),
          }),
        );
        return;
      }
      case 'text':
        if (it.text?.trim())
          push(null, {
            tipo: 'Ficha del cuaderno',
            texto: clip(it.text, Math.min(1200, max)),
          });
        return;
    }
  });
  return {
    digest: compact({
      nombre: nb.name,
      descripcion: clip(nb.description, 600),
      elementos,
    }),
    sources,
  };
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Pregunta a la IA solo sobre este cuaderno. Las citas [c3] de la respuesta se vuelven enlaces a
 * sus fuentes (solo las que de verdad se citaron).
 */
export async function askAboutNotebook(
  nb: Notebook,
  ws: Workspace,
  extras: Extras,
  question: string,
  history: ChatTurn[],
): Promise<AssistantAnswer> {
  const { digest, sources } = await buildDigest(nb, ws, extras);
  const answer = await askNotebook(digest, question, history);
  const cited = new Set(answer.match(/\bc\d+\b/g) ?? []);
  return {
    answer,
    sources: sources.filter((s) => cited.has(s.ref)),
    coverage: null,
  };
}

/** Lo que falta para dibujar lecturas y notas rápidas: se pide solo lo que está en el cuaderno. */
export async function fetchExtras(items: NotebookItem[]): Promise<Extras> {
  const readingIds = items.filter((i) => i.type === 'reading').map((i) => i.id);
  const noteIds = items.filter((i) => i.type === 'note').map((i) => i.id);
  const [r, n] = await Promise.all([
    readingIds.length
      ? supabase
          .from('reading_cards')
          .select('id,title,url,cover,excerpt,created_at')
          .in('id', readingIds)
      : Promise.resolve({ data: [] }),
    noteIds.length
      ? supabase.from('quick_notes').select('id,title,body,color').in('id', noteIds)
      : Promise.resolve({ data: [] }),
  ]);
  return {
    readings: new Map(((r.data ?? []) as ReadingRef[]).map((x) => [x.id, x])),
    notes: new Map(((n.data ?? []) as QuickNoteRef[]).map((x) => [x.id, x])),
  };
}
