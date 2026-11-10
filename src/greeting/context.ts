import type { Entry, MyRecord, Workspace } from '../data';
import { agendaFor, defaultAgendaPrefs } from '../lib/agenda';
import { isOpenTask } from '../lib/commitments';
import { moodTone } from '../composer/moods';
import { addDays, todayInputValue } from '../lib/format';
import { ageOf, closenessOf, daysBetween, daysToBirthday, relativeDay } from '../lib/people';
import { isActive, progressOf } from '../library/progress';
import type { FeedCard } from '../planner/boardFeed';
import { plainMarks } from '../planner/cardMarks';
import type { LocalFacts } from './greeting';

const clip = (s: string | undefined, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const firstWord = (s: string | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? '';
const short = (list: string[] | undefined, n: number) =>
  (list ?? [])
    .map((x) => clip(x, 60))
    .filter(Boolean)
    .slice(0, n);
const dayOf = (iso: string) => todayInputValue(new Date(iso));

/** Cómo te llama Nexo: tu apodo o tu primer nombre. */
export const nameOf = (me: MyRecord) =>
  me.profile.alias?.trim() || firstWord(me.profile.name) || null;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const on = (y: number, md: string) => (md === '02-29' && !isLeap(y) ? `${y}-02-28` : `${y}-${md}`);

/** Días hasta una fecha MM-DD (0 = hoy), o null si no hay una válida. */
function daysToMonthDay(md: string | undefined, today: string) {
  if (!md || !/^\d{2}-\d{2}$/.test(md)) return null;
  const year = Number(today.slice(0, 4));
  let d = daysBetween(today, on(year, md));
  if (d < 0) d = daysBetween(today, on(year + 1, md));
  return Number.isFinite(d) ? d : null;
}

const pagesWhere = (e: Entry) => {
  const { pagesRead, pagesTotal } = e.details;
  return pagesRead
    ? `vas en la página ${pagesRead}${pagesTotal ? ` de ${pagesTotal}` : ''}`
    : undefined;
};
const episodeWhere = (e: Entry) => {
  const { seasonAt, episodeAt } = e.details;
  const bits = [seasonAt && `la temporada ${seasonAt}`, episodeAt && `el episodio ${episodeAt}`];
  return seasonAt || episodeAt ? `vas en ${bits.filter(Boolean).join(', ')}` : undefined;
};

export type GreetingInput = {
  /** Lo que se envía a la función. */
  digest: Record<string, unknown>;
  /** Lo mismo, en corto, para el saludo de respaldo. */
  facts: LocalFacts;
  name: string | null;
};

/**
 * Resumen de tu momento para el saludo: tu ficha, lo que merece tu atención, los cumpleaños
 * cercanos, el libro y la serie que llevas, tu actividad reciente y los accesos directos que la IA
 * puede ofrecer. Es corto a propósito (unos pocos cientos de palabras): la respuesta debe ser rápida.
 */
export function buildGreetingInput(
  ws: Workspace,
  me: MyRecord,
  skip: ReadonlySet<string>,
  now = new Date(),
  /** Tarjetas de los tableros que activaron «En el saludo de Mi espacio» (no de todos). */
  cards: readonly FeedCard[] = [],
): GreetingInput {
  const today = todayInputValue(now);
  const p = me.profile;
  const name = nameOf(me);
  const weekly = now.getDay() === 0 || now.getDay() === 1;

  const agenda = agendaFor(ws, { ...defaultAgendaPrefs, max: 4 }, skip, today, cards);

  // Tableros elegidos: lo vencido, lo de hoy, lo prioritario y lo resaltado (lo demás no importa aquí).
  const open = cards.filter((c) => !c.done && !(c.snoozed_until && c.snoozed_until > today));
  const dueOf = (c: FeedCard) => (c.due ? daysBetween(today, c.due) : null);
  const weight = (c: FeedCard) => {
    const d = dueOf(c);
    return (
      (d === null ? 0 : d < 0 ? 60 : d === 0 ? 55 : d === 1 ? 40 : d <= 3 ? 25 : 0) +
      (c.priority === 'alta' ? 30 : c.priority === 'media' ? 10 : 0) +
      (c.highlight ? 20 : 0)
    );
  };
  const boardIds = [...new Set(cards.map((c) => c.board_id))];
  const tableros = boardIds.slice(0, 4).map((id) => {
    const mine = open.filter((c) => c.board_id === id);
    const top = mine
      .map((c) => ({ c, w: weight(c) }))
      .filter((x) => x.w > 0)
      .sort((a, b) => b.w - a.w)
      .slice(0, 3);
    return {
      tablero: clip(cards.find((c) => c.board_id === id)?.board_name, 60),
      abiertas: mine.length,
      vencidas: mine.filter((c) => (dueOf(c) ?? 1) < 0).length,
      para_hoy: mine.filter((c) => dueOf(c) === 0).length,
      prioridad_alta: mine.filter((c) => c.priority === 'alta').length,
      destacadas: top.map(({ c }) => {
        const d = dueOf(c);
        return {
          titulo: clip(plainMarks(c.title), 90),
          columna: clip(c.list_name, 40),
          vence:
            d === null
              ? undefined
              : d < 0
                ? `hace ${-d} ${d === -1 ? 'día' : 'días'}`
                : d === 0
                  ? 'hoy'
                  : d === 1
                    ? 'mañana'
                    : `en ${d} días`,
          prioridad: c.priority || undefined,
          resaltada: c.highlight || undefined,
        };
      }),
    };
  });
  const topCards = open
    .map((c) => ({ c, w: weight(c) }))
    .filter((x) => x.w >= 40)
    .sort((a, b) => b.w - a.w)
    .slice(0, 3)
    .map((x) => x.c);

  // Libro y series en curso.
  const lastMove = (e: Entry) => e.details.pageLog?.at(-1)?.d ?? dayOf(e.created_at);
  const active = ws.entries.filter(isActive);
  const books = active
    .filter((e) => e.kind === 'Libro')
    .sort((a, b) => lastMove(b).localeCompare(lastMove(a)))
    .slice(0, 2);
  const shows = active
    .filter((e) => e.kind !== 'Libro')
    .sort((a, b) => Number(Boolean(b.details.follow)) - Number(Boolean(a.details.follow)))
    .slice(0, 2);

  // Cumpleaños de la semana (los de hoy primero) y el tuyo.
  const birthdays = ws.people
    .filter((x) => x.profile.status !== 'distante' && x.profile.status !== 'memoria')
    .flatMap((x) => {
      const d = daysToBirthday(x, today);
      return d !== null && d <= 7 ? [{ x, d }] : [];
    })
    .sort((a, b) => a.d - b.d || closenessOf(b.x) - closenessOf(a.x))
    .slice(0, 3);
  const ownDays = daysToMonthDay(p.birthday, today);

  // Actividad reciente.
  const added = (e: Entry) => e.recorded_at ?? e.created_at;
  const memories = ws.entries
    .filter((e) => e.kind !== 'Movimiento')
    .sort((a, b) => added(b).localeCompare(added(a)));
  const lately = ws.entries.filter((e) => e.created_at.slice(0, 10) >= addDays(today, -16));
  const weekAgo = addDays(today, -6);
  const moods = lately
    .filter((e) => dayOf(e.created_at) >= addDays(today, -14))
    .map((e) => moodTone(e.details.mood))
    .filter((m): m is number => typeof m === 'number');
  const openTasks = ws.entries.filter(isOpenTask);
  const dueIn = (e: Entry) => (e.details.due ? daysBetween(today, e.details.due) : null);

  // Accesos directos que la IA puede elegir (la app solo acepta estos).
  const choices = [
    { id: 'capture', que: 'Escribir un recuerdo o contar qué pasó' },
    { id: 'chat', que: 'Preguntarle algo a Nexo sobre su memoria' },
    ...(weekly ? [{ id: 'weekly', que: 'Abrir su periódico de la semana' }] : []),
    { id: 'go:Libroteca', que: 'Ir a su Libroteca (libros, series y citas)' },
    { id: 'go:Personas', que: 'Ir a su gente' },
    { id: 'go:Lecturas', que: 'Ir a sus lecturas guardadas' },
    { id: 'go:Tableros', que: 'Ir a sus tableros' },
    ...topCards.map((c) => ({
      id: 'card:' + c.id,
      que: `Abrir la tarjeta «${clip(plainMarks(c.title), 40)}» en ${clip(c.board_name, 30)}`,
    })),
    ...[...books, ...shows].map((e) => ({
      id: 'progress:' + e.id,
      que: `Contar cómo va con «${clip(e.title, 40)}»`,
    })),
    ...birthdays.map(({ x }) => ({
      id: 'person:' + x.id,
      que: `Abrir la ficha de ${firstWord(x.name)} para escribirle`,
    })),
    ...agenda.flatMap((i) =>
      i.entry
        ? [{ id: 'entry:' + i.entry.id, que: `Abrir «${clip(i.entry.title, 40)}»` }]
        : i.person
          ? [{ id: 'person:' + i.person.id, que: `Abrir la ficha de ${firstWord(i.person.name)}` }]
          : [],
    ),
  ];
  const seen = new Set<string>();
  const acciones = choices.filter((a) => !seen.has(a.id) && seen.add(a.id)).slice(0, 14);

  const top = agenda[0];
  const celebrating = birthdays.find((b) => b.d === 0);
  const facts: LocalFacts = {
    myBirthday: ownDays === 0,
    birthday: celebrating
      ? { id: celebrating.x.id, name: firstWord(celebrating.x.name) }
      : undefined,
    urgent:
      top && top.score >= 70
        ? {
            text: `${top.title}: ${clip(top.detail, 110)}`.replace(/[.\s]+$/, ''),
            entryId: top.entry?.id,
          }
        : undefined,
    book: books[0] && { id: books[0].id, title: books[0].title, where: pagesWhere(books[0]) },
    series: shows[0] && { id: shows[0].id, title: shows[0].title, where: episodeWhere(shows[0]) },
  };

  const digest = {
    yo: {
      nombre: name ?? undefined,
      genero: p.gender === 'f' ? 'mujer' : p.gender === 'm' ? 'hombre' : undefined,
      ciudad: clip(p.city, 80) || undefined,
      ocupacion: clip(p.occupation, 60) || undefined,
      empresa: clip(p.company, 60) || undefined,
      intereses: short(p.interests, 8),
      me_gusta: short(p.likes, 6),
      no_me_gusta: short(p.dislikes, 4),
      metas: short(p.goals, 5),
      sobre_mi: clip(p.about, 450) || undefined,
      rasgos: short(me.highlights, 6),
      lectura_de_nexo: clip(me.reading, 600) || undefined,
    },
    cumple_propio:
      ownDays !== null && ownDays <= 14 ? { hoy: ownDays === 0, en_dias: ownDays } : undefined,
    agenda: agenda.map((i) => ({
      tipo: i.kind,
      titulo: clip(i.title, 120),
      detalle: clip(i.detail, 140),
      motivos: i.why.slice(0, 3),
    })),
    lectura_actual: books.map((e) => ({
      titulo: clip(e.title, 80),
      autor: clip(e.details.author, 60) || undefined,
      progreso: progressOf(e, today).text,
      dias_sin_avanzar: Math.max(0, daysBetween(lastMove(e), today)),
    })),
    series_actuales: shows.map((e) => ({
      titulo: clip(e.title, 80),
      donde_va: progressOf(e, today).text,
    })),
    cumpleanos: birthdays.map(({ x, d }) => {
      const age = ageOf(x, today);
      return {
        nombre: firstWord(x.name),
        en_dias: d,
        cumple_anos: age === null ? undefined : d === 0 ? age : age + 1,
        cercania: closenessOf(x) >= 4 || x.profile.favorite ? 'cercana' : undefined,
      };
    }),
    actividad: {
      recuerdos_esta_semana: lately.filter(
        (e) => e.kind !== 'Movimiento' && dayOf(e.created_at) >= weekAgo,
      ).length,
      dias_sin_escribir: memories[0]
        ? Math.max(0, daysBetween(dayOf(added(memories[0])), today))
        : undefined,
      ultimos: memories.slice(0, 5).map((e) => ({
        tipo: e.kind,
        titulo: clip(e.title, 70),
        cuando: relativeDay(dayOf(e.created_at), today).toLowerCase(),
      })),
      animo_reciente: moods.length
        ? Math.round((10 * moods.reduce((s, m) => s + m, 0)) / moods.length) / 10
        : undefined,
      pendientes_abiertos: openTasks.length,
      vencen_hoy: openTasks.filter((e) => dueIn(e) === 0).length,
      vencidos: openTasks.filter((e) => (dueIn(e) ?? 0) < 0).length,
    },
    tableros: tableros.length ? tableros : undefined,
    episodios_activos: ws.episodes
      .filter((ep) => ep.status === 'activo')
      .slice(0, 3)
      .map((ep) => clip(ep.title, 60)),
    periodico_semanal_listo: weekly,
    acciones,
  };

  return { digest, facts, name };
}
