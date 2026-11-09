import { moods } from '../composer/controls';
import type { Entry, Episode, Place, Workspace } from '../data';
import { episodesSeen, isSeries, PACE, screenMinutes } from '../lib/entries';
import { addDays, todayInputValue } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { isInteraction, wrappedFor } from '../lib/people';
import { day, weekOf } from '../weekly/week';

export type Year = number | 'todo';

/** Del 1 de enero al 31 de diciembre, o de tu primer recuerdo al último («todo»). */
export function yearRange(entries: Entry[], year: Year) {
  if (year !== 'todo') return { start: `${year}-01-01`, end: `${year}-12-31` };
  const today = todayInputValue();
  let start = today;
  let end = today;
  for (const e of entries) {
    const d = day(e.created_at);
    if (d < start) start = d;
    if (d > end) end = d;
  }
  return { start, end };
}

/** Racha más larga de días seguidos con algo registrado. */
function longestStreak(days: string[]) {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev = '';
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Cuándo terminaste un libro: el cierre, la última página anotada o la fecha del recuerdo. */
const finishedOn = (e: Entry) =>
  e.details.ritual?.at ?? e.details.pageLog?.at(-1)?.d ?? day(e.created_at);

/**
 * Todo lo del año (o de toda tu historia) que sale de Nexo: tu gente, tus momentos con foto, los
 * lugares, el ánimo, libros, películas y series, aprendizajes, episodios, dinero y pendientes.
 * Las lecturas (artículos) se piden aparte porque viven en otra tabla.
 */
export function yearReview(ws: Workspace, year: Year) {
  const { start, end } = yearRange(ws.entries, year);
  const within = (d?: string | null) => Boolean(d) && d! >= start && d! <= end;
  const social = wrappedFor(ws.people, ws.entries, year);
  const k = weekOf(ws, start, end);

  // Momentos con foto: los que reunieron a más gente primero; luego en orden cronológico.
  const moments = k.entries
    .filter(
      (e) =>
        isInteraction(e) && e.kind !== 'Libro' && e.kind !== 'Película' && e.images.length > 0,
    )
    .sort((a, b) => b.person_ids.length - a.person_ids.length || b.images.length - a.images.length)
    .slice(0, 4)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Ánimo
  const moodCount = new Map<number, number>();
  for (const e of k.entries)
    if (typeof e.details.mood === 'number')
      moodCount.set(e.details.mood, (moodCount.get(e.details.mood) ?? 0) + 1);
  const moodTotal = [...moodCount.values()].reduce((s, n) => s + n, 0);
  const moodList = [...moodCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .flatMap(([v, n]) => {
      const m = moods.find((x) => x.value === v);
      return m ? [{ ...m, n }] : [];
    });

  // Libros: terminados en el periodo y páginas leídas (según el historial de páginas). Para el
  // tiempo de lectura, un libro terminado sin páginas anotadas cuenta su total (o el promedio).
  const allBooks = ws.entries.filter((e) => e.kind === 'Libro');
  const books = allBooks
    .filter((e) => e.details.read === 'terminado' && within(finishedOn(e)))
    .sort((a, b) => (b.details.rating ?? 0) - (a.details.rating ?? 0));
  let pages = 0;
  let guessedPages = 0;
  for (const b of allBooks) {
    const d = b.details;
    const log = [...(d.pageLog ?? [])].sort((x, y) => x.d.localeCompare(y.d));
    let prev = 0;
    let read = 0;
    for (const p of log) {
      if (within(p.d)) read += Math.max(0, p.p - prev);
      prev = p.p;
    }
    if (!read && d.read === 'terminado' && within(finishedOn(b))) {
      if (d.pagesTotal) read = d.pagesTotal;
      else guessedPages += PACE.bookPages;
    } else if (!log.length && d.read !== 'terminado' && within(day(b.created_at)))
      read = d.pagesRead ?? 0;
    pages += read;
  }
  const readMinutes = (pages + guessedPages) * PACE.minutesPerPage;

  // Películas y series vistas (de las series, los episodios que llevas o todos si la terminaste).
  const screen = k.entries
    .filter((e) => e.kind === 'Película' && e.details.watch !== 'quiero')
    .sort((a, b) => (b.details.rating ?? 0) - (a.details.rating ?? 0));
  const movies = screen.filter((e) => !isSeries(e));
  const series = screen.filter((e) => isSeries(e));
  const screenTime = screen.reduce((s, e) => s + screenMinutes(e), 0);
  const episodesWatched = series.reduce((s, e) => s + episodesSeen(e), 0);
  const favorite =
    [...books, ...screen]
      .filter((e) => (e.details.rating ?? 0) >= 4)
      .sort((a, b) => (b.details.rating ?? 0) - (a.details.rating ?? 0))[0] ?? null;

  // Episodios con movimiento en el periodo o que empezaron en él.
  const seen = new Set(k.episodes.map((x) => x.episode.id));
  const episodes: { episode: Episode; n: number }[] = [
    ...k.episodes.map((x) => ({ episode: x.episode, n: x.items.length + x.updates.length })),
    ...ws.episodes
      .filter((ep) => !seen.has(ep.id) && within(ep.starts_on))
      .map((ep) => ({ episode: ep, n: 0 })),
  ];

  // Fotos de tus momentos (sin portadas de libros ni pósters).
  const covers = new Set(
    k.entries
      .filter((e) => e.kind === 'Libro' || e.kind === 'Película')
      .flatMap((e) => e.images.map((i) => i.url)),
  );
  const photos = k.photos.filter((i) => !covers.has(i.url));

  const newPlaces: Place[] = ws.places.filter((p) => within(day(p.created_at)));
  const activeDays = new Set(k.entries.map((e) => day(e.created_at)));

  return {
    start,
    end,
    social,
    entries: k.entries,
    activeDays: activeDays.size,
    streak: longestStreak([...activeDays]),
    moments,
    photos,
    places: k.places,
    newPlaces,
    moodList,
    moodTotal,
    books,
    pages,
    movies,
    series,
    movieHours: Math.round(screenTime / 60),
    episodesWatched,
    /** Minutos aproximados leyendo y frente a la pantalla. */
    time: { read: readMinutes, screen: screenTime, total: readMinutes + screenTime },
    favorite,
    cover: (e: Entry) => entryImages(e)[0] ?? null,
    learnings: k.learnings,
    notes: k.notes,
    work: k.work,
    closed: k.closed,
    news: k.news,
    episodes,
    spent: k.spent,
    earned: k.earned,
    topCategory: k.topCategory ?? null,
  };
}
export type YearReview = ReturnType<typeof yearReview>;
