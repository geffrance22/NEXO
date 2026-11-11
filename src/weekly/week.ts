import { supabase } from '../backend';
import { moods, moodTone } from '../composer/controls';
import type {
  Entry,
  Episode,
  EpisodeUpdate,
  Exchange,
  Person,
  PersonUpdate,
  Place,
  StoredImage,
  Workspace,
} from '../data';
import { isOpenTask } from '../lib/commitments';
import { addDays, todayInputValue } from '../lib/format';
import { daysToBirthday } from '../lib/people';
import { placeOf } from '../lib/places';
import { byCategory, costOf, flowOf, totals } from '../finance/money';

export const day = (iso: string) => todayInputValue(new Date(iso));

/** Los 7 días que terminan en `end` (AAAA-MM-DD). */
export function weekRange(end: string) {
  return { start: addDays(end, -6), end };
}

/** Un lugar donde estuviste esta semana (con ficha o solo con el nombre escrito). */
export type PlaceVisit = {
  key: string;
  place: Place | null;
  name: string;
  visits: Entry[];
  people: Person[];
  /** Lo guardaste como lugar esta misma semana. */
  isNew: boolean;
};

/** Puesto de un ánimo de peor (1) a mejor (5), para comparar; 0 si no se reconoce. */
const moodRank = (v: number) => moodTone(v) ?? 0;
export const moodOf = (v: number) => moods.find((m) => m.value === v) ?? null;

/** Todo lo de la semana que sale de tu espacio (las lecturas se piden aparte). */
export function weekOf(ws: Workspace, start: string, end: string) {
  const within = (d?: string | null) => Boolean(d) && d! >= start && d! <= end;
  const inWeek = (iso: string) => within(day(iso));
  const byId = new Map(ws.people.map((p) => [p.id, p]));
  const entries = ws.entries.filter((e) => inWeek(e.created_at));

  const meetings = entries.filter((e) => e.kind === 'Encuentro');
  const seen = new Map<string, number>();
  for (const e of meetings) for (const id of e.person_ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  const people = [...seen.entries()]
    .flatMap(([id, n]) => (byId.has(id) ? [{ person: byId.get(id)!, n }] : []))
    .sort((a, b) => b.n - a.n);

  // Lugares: solo los vinculados (con ficha en Nexo).
  const placeMap = new Map<string, PlaceVisit>();
  for (const e of entries) {
    const place = placeOf(e, ws.places);
    if (!place) continue;
    const key = place.id;
    const item = placeMap.get(key) ?? {
      key,
      place,
      name: place.name,
      visits: [],
      people: [],
      isNew: inWeek(place.created_at),
    };
    item.visits.push(e);
    for (const id of e.person_ids) {
      const p = byId.get(id);
      if (p && !item.people.includes(p)) item.people.push(p);
    }
    placeMap.set(key, item);
  }
  const places = [...placeMap.values()].sort((a, b) => b.visits.length - a.visits.length);

  // Ánimo por día (el más frecuente; si empatan, el último que anotaste).
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const moodDays = days.map((d) => {
    const list = entries
      .filter((e) => day(e.created_at) === d && typeof e.details.mood === 'number')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((e) => e.details.mood!);
    const count = new Map<number, number>();
    for (const m of list) count.set(m, (count.get(m) ?? 0) + 1);
    let best: number | null = null;
    for (const m of list) if (best === null || count.get(m)! >= count.get(best)!) best = m;
    return { date: d, mood: best, n: list.length };
  });
  const allMoods = entries
    .map((e) => e.details.mood)
    .filter((m): m is number => typeof m === 'number');
  const moodCount = new Map<number, number>();
  for (const m of allMoods) moodCount.set(m, (moodCount.get(m) ?? 0) + 1);
  const topMood = moodCount.size
    ? [...moodCount.entries()].sort((a, b) => b[1] - a[1] || moodRank(b[0]) - moodRank(a[0]))[0][0]
    : null;
  const bestDay = moodDays
    .filter((d) => d.mood !== null)
    .sort((a, b) => moodRank(b.mood!) - moodRank(a.mood!))[0];

  // Dinero
  // Dinero: solo gastos e ingresos reales (sin transferencias, préstamos, ahorro ni pendientes).
  const money = entries.filter((e) => e.kind === 'Movimiento' && !e.details.pending);
  const expenses = money.filter((e) => flowOf(e) === 'gasto');
  const { spent, income: earned } = totals(money);
  const categories = byCategory(money)
    .slice(0, 4)
    .map((c) => [c.name, c.total] as [string, number]);
  const biggest = [...expenses].sort((a, b) => costOf(b) - costOf(a))[0] ?? null;

  // Tu gente
  const news = ws.people
    .flatMap((p) =>
      (p.profile.updates ?? [])
        .filter((u) => within(u.date))
        .map((u) => ({ person: p, update: u })),
    )
    .sort((a, b) => b.update.date.localeCompare(a.update.date));
  const exchanges = ws.people
    .flatMap((p) =>
      (p.profile.exchanges ?? []).filter((x) => within(x.date)).map((x) => ({ person: p, x })),
    )
    .sort((a, b) => b.x.date.localeCompare(a.x.date)) as { person: Person; x: Exchange }[];
  const met = ws.people.filter((p) => inWeek(p.created_at) || within(p.profile.metOn));

  // Episodios con algo esta semana (recuerdos o bitácora)
  const episodes = ws.episodes
    .map((ep) => ({
      episode: ep,
      updates: (ep.updates ?? []).filter((u) => within(u.date)) as EpisodeUpdate[],
      items: entries.filter((e) => e.episode_id === ep.id),
    }))
    .filter((x) => x.updates.length || x.items.length)
    .sort((a, b) => b.items.length + b.updates.length - (a.items.length + a.updates.length)) as {
    episode: Episode;
    updates: EpisodeUpdate[];
    items: Entry[];
  }[];

  // Fotos de la semana: recuerdos, bitácoras y novedades (sin repetir).
  const urls = new Set<string>();
  const photos: StoredImage[] = [
    ...entries.flatMap((e) => (e.kind === 'Movimiento' ? [] : e.images)),
    ...episodes.flatMap((x) => x.updates.flatMap((u) => u.images ?? [])),
    ...news.flatMap((x) => x.update.images ?? []),
  ].filter((i) => !urls.has(i.url) && urls.add(i.url));

  // Lo que viene
  const nextEnd = addDays(end, 7);
  const ahead = ws.entries
    .filter(isOpenTask)
    .filter((e) => !e.details.due || e.details.due <= nextEnd)
    .sort((a, b) => (a.details.due ?? '9999').localeCompare(b.details.due ?? '9999'))
    .slice(0, 6);
  const birthdays = ws.people
    .filter((p) => !p.profile.status)
    .map((p) => ({ person: p, inDays: daysToBirthday(p, end) }))
    .filter((x) => x.inDays !== null && x.inDays >= 1 && x.inDays <= 7)
    .sort((a, b) => a.inDays! - b.inDays!) as { person: Person; inDays: number }[];
  const followUps = ws.people
    .filter((p) => !p.profile.status)
    .flatMap((p) =>
      (p.profile.updates ?? [])
        .filter((u) => u.followUp && !u.done && u.followUp > end && u.followUp <= nextEnd)
        .map((u) => ({ person: p, update: u })),
    )
    .sort((a, b) => a.update.followUp!.localeCompare(b.update.followUp!)) as {
    person: Person;
    update: PersonUpdate;
  }[];

  const closed = ws.entries.filter(
    (e) =>
      e.kind === 'Pendiente' &&
      e.status === 'completado' &&
      (inWeek(e.created_at) || within(e.details.due)),
  );

  return {
    days,
    entries,
    meetings,
    people,
    places,
    moodDays,
    topMood,
    bestDay: bestDay ?? null,
    learnings: entries.filter((e) => e.kind === 'Aprendizaje'),
    notes: entries.filter((e) => e.kind === 'Nota'),
    media: entries.filter((e) => e.kind === 'Libro' || e.kind === 'Película'),
    work: entries.filter((e) => e.kind === 'Trabajo'),
    closed,
    spent,
    earned,
    categories,
    topCategory: categories[0],
    biggest,
    news,
    exchanges,
    met,
    episodes,
    photos,
    ahead,
    birthdays,
    followUps,
  };
}
export type Week = ReturnType<typeof weekOf>;

export type ReadRow = {
  id: string;
  title: string;
  url: string;
  cover: string | null;
  minutes: number | null;
  read_at: string;
  marks: number;
};
export type WeekReading = {
  /** Solo las que terminaste esta semana (marcadas «Completado»). */
  articles: ReadRow[];
  /** Resaltados que hiciste esta semana (en cualquier artículo). */
  marks: number;
  quote: { text: string; title: string } | null;
  /** Falta la migración 012: no se sabe qué terminaste. */
  missing: boolean;
};

export async function readingsOf(start: string, end: string): Promise<WeekReading> {
  const from = new Date(start + 'T00:00:00').toISOString();
  const to = new Date(addDays(end, 1) + 'T00:00:00').toISOString();
  const [reads, marks] = await Promise.all([
    supabase
      .from('reading_cards')
      .select('id,title,url,cover,minutes,read_at,mark_count')
      .gte('read_at', from)
      .lt('read_at', to)
      .order('read_at', { ascending: false })
      .limit(30),
    supabase
      .from('reading_annotations')
      .select('reading_id,title,quote,note')
      .gte('edited_at', from)
      .lt('edited_at', to)
      .limit(1000),
  ]);
  const rows = (marks.data ?? []) as {
    reading_id: string;
    title: string;
    quote: string | null;
    note: string;
  }[];
  const articles = ((reads.data ?? []) as (Omit<ReadRow, 'marks'> & { mark_count: number })[]).map(
    ({ mark_count, ...r }) => ({ ...r, marks: mark_count ?? 0 }),
  );
  // Cita de la semana: una al azar, mejor si tiene nota tuya (no de la IA).
  const good = rows.filter((m) => m.quote && m.quote.length > 30 && m.quote.length < 320);
  const mine = good.filter((m) => m.note.trim() && !m.note.startsWith('✦ '));
  const pool = mine.length ? mine : good;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return {
    articles,
    marks: rows.length,
    quote: pick ? { text: pick.quote!.trim(), title: pick.title } : null,
    missing: Boolean(reads.error),
  };
}

const first = (p: Person) => p.name.split(' ')[0];
const and = (list: string[]) =>
  list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** Titular y entradilla de la portada, sin IA: salen directo de los datos. */
export function frontPage(w: Week, r: WeekReading | null) {
  const done = r?.articles.length ?? 0;
  const headline = w.people.length
    ? `Una semana con ${and(w.people.slice(0, 2).map((x) => first(x.person)))}`
    : w.episodes[0]
      ? `«${w.episodes[0].episode.title}» marcó la semana`
      : w.places.length
        ? `Una semana entre ${and(w.places.slice(0, 2).map((p) => p.name))}`
        : done
          ? 'Una semana de lecturas'
          : w.learnings.length
            ? 'Una semana para aprender'
            : w.news.length
              ? 'Lo que pasó en la vida de tu gente'
              : 'Tu semana';
  const bits = [
    w.meetings.length &&
      `viste a ${n(w.people.length, 'persona', 'personas')} en ${n(w.meetings.length, 'encuentro', 'encuentros')}`,
    w.places.length && `estuviste en ${n(w.places.length, 'lugar', 'lugares')}`,
    done && `terminaste ${n(done, 'lectura', 'lecturas')}`,
    w.learnings.length && `aprendiste ${n(w.learnings.length, 'cosa nueva', 'cosas nuevas')}`,
    w.notes.length && `escribiste ${n(w.notes.length, 'nota', 'notas')}`,
    w.met.length && `conociste a ${n(w.met.length, 'persona nueva', 'personas nuevas')}`,
    w.closed.length && `cerraste ${n(w.closed.length, 'pendiente', 'pendientes')}`,
  ].filter(Boolean) as string[];
  const deck = bits.length ? and(bits).replace(/^./, (c) => c.toUpperCase()) + '.' : '';
  return { headline, deck };
}
