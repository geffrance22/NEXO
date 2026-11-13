import type { Entry, EntryDetails, EpisodeNote, EpisodeState } from '../data';
import { cleanDetails } from '../composer/logic';
import { bookPace, etaLabel, isSeries } from '../lib/entries';
import { todayInputValue } from '../lib/format';
import type { TvEpisode } from '../lib/moviePosters';

/** Un libro que estás leyendo o una serie que estás viendo. */
export const isActive = (e: Entry) =>
  (e.kind === 'Libro' && (e.details.read ?? 'leyendo') === 'leyendo') ||
  (e.kind === 'Película' && e.details.watch === 'viendo' && isSeries(e));

/** Temporadas de la serie según TMDB (si se conocen). */
export const seasonsOf = (e: Entry) =>
  e.details.movieInfo?.type === 'tv' ? e.details.movieInfo.seasons : undefined;

/** Barra y texto corto del progreso: «45 % · lo terminas el jue 12 nov», «T2 · E5 de 8 temporadas». */
export function progressOf(e: Entry, today = todayInputValue()) {
  if (e.kind === 'Libro') {
    const pace = bookPace(e, today);
    const d = e.details;
    if (!pace)
      return {
        percent: null,
        text: d.pagesRead ? `Página ${d.pagesRead}` : 'Sin página aún',
      };
    return {
      percent: pace.percent,
      text:
        `Pág. ${d.pagesRead ?? 0} de ${d.pagesTotal}` +
        (pace.eta ? ` · ${etaLabel(pace.eta, today).toLowerCase()}` : ''),
    };
  }
  const total = seasonsOf(e);
  const s = e.details.seasonAt;
  const ep = e.details.episodeAt;
  const state = e.details.episodeState;
  const where = [
    s ? `Temporada ${s}${total ? ` de ${total}` : ''}` : '',
    ep ? `episodio ${ep}${state ? (state === 'por-ver' ? ' por ver' : ', viéndolo') : ''}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    // A mitad de la temporada en la que vas (no se sabe cuántos episodios tiene cada una).
    percent: s && total ? Math.min(100, Math.round(((s - 0.5) / total) * 100)) : null,
    text: where ? where.charAt(0).toUpperCase() + where.slice(1) : 'Viéndola',
  };
}

/** Detalles del libro con la página nueva (y su historial del día). */
export function withPage(e: Entry, page: number, total?: number): EntryDetails {
  const d = e.details;
  const today = todayInputValue();
  const p = Math.max(0, Math.round(page));
  // El historial arranca con donde ibas antes de esta actualización.
  const log = d.pageLog?.length
    ? [...d.pageLog]
    : [{ d: todayInputValue(new Date(e.created_at)), p: d.pagesRead ?? 0 }];
  const last = log[log.length - 1];
  if (log.length > 1 && last.d === today) log[log.length - 1] = { d: today, p };
  else log.push({ d: today, p });
  return cleanDetails('Libro', {
    ...d,
    read: 'leyendo',
    pagesRead: p,
    pagesTotal: total ?? d.pagesTotal,
    pageLog: log.slice(-60),
  });
}

/**
 * Detalles de la serie en la temporada y el episodio indicados. `state`: si ese episodio está por
 * ver o lo estás viendo (sin valor, no se dice). «+1 episodio» lo deja «por ver»: el anterior ya
 * lo viste.
 */
export function withEpisode(
  e: Entry,
  season?: number,
  episode?: number,
  state?: EpisodeState,
): EntryDetails {
  return cleanDetails('Película', {
    ...e.details,
    // Fija que es serie (si solo lo decía una etiqueta, «viendo» se perdería).
    series: true,
    watch: 'viendo',
    seasonAt: season && season > 0 ? season : undefined,
    episodeAt: episode && episode > 0 ? episode : undefined,
    episodeState: state,
  });
}

/** El id de TMDB de la serie (para pedir sus episodios), si se conoce. */
export function tvIdOf(e: Entry) {
  const d = e.details;
  if (d.movieInfo?.type === 'tv') return d.movieInfo.id;
  if (d.tmdbPoster?.type === 'tv' && d.tmdbPoster.id) return d.tmdbPoster.id;
  return undefined;
}

export const noteKey = (s: number, e: number) => `${s}:${e}`;
/** «12 jun 2025» de un AAAA-MM-DD (a mediodía: así no cambia de día por la zona horaria). */
export const airLabel = (d: string, year = true) =>
  new Date(d + 'T12:00').toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    ...(year && { year: 'numeric' }),
  });
/** Lo que escribes de un episodio en «Actualizar progreso». */
export type EpisodeDraft = { rating: number; review: string };

/**
 * Las calificaciones y reseñas con lo que cambiaste (`edits`, por `noteKey`). Un episodio sin
 * calificación ni reseña sale de la lista; lo de TMDB (`meta`) se copia en cada uno. En orden.
 */
export function mergeEpisodeNotes(
  current: EpisodeNote[] | undefined,
  edits: Record<string, EpisodeDraft>,
  meta: (s: number, e: number) => TvEpisode | undefined,
): EpisodeNote[] {
  const today = todayInputValue();
  const byKey = new Map((current ?? []).map((n) => [noteKey(n.s, n.e), n]));
  for (const [key, draft] of Object.entries(edits)) {
    const [s, e] = key.split(':').map(Number);
    const before = byKey.get(key);
    const rating = Math.max(0, Math.min(5, Math.round(draft.rating)));
    const review = draft.review.trim().slice(0, 2000);
    if (!rating && !review) {
      byKey.delete(key);
      continue;
    }
    if (before && (before.rating ?? 0) === rating && (before.review ?? '') === review) continue;
    const info = meta(s, e);
    byKey.set(key, {
      s,
      e,
      rating: rating || undefined,
      review: review || undefined,
      name: info?.name || before?.name || undefined,
      es: info?.es || before?.es || undefined,
      aired: info?.aired || before?.aired || undefined,
      runtime: info?.runtime || before?.runtime || undefined,
      at: today,
    });
  }
  return [...byKey.values()].sort((a, b) => a.s - b.s || a.e - b.e);
}

/** Terminado: el libro leído o la serie vista, con su calificación. Deja de seguirse. */
export function finishedDetails(e: Entry, rating?: number): EntryDetails {
  const d = e.details;
  if (e.kind === 'Libro')
    return cleanDetails('Libro', {
      ...d,
      read: 'terminado',
      finishedAt: d.finishedAt ?? todayInputValue(),
      pageLog:
        d.pagesTotal && d.pageLog
          ? [...d.pageLog, { d: todayInputValue(), p: d.pagesTotal }].slice(-60)
          : d.pageLog,
      rating: rating || d.rating,
      follow: false,
    });
  return cleanDetails('Película', {
    ...d,
    series: d.series ?? (isSeries(e) || undefined),
    watch: 'vista',
    rating: rating || d.rating,
    follow: false,
  });
}
