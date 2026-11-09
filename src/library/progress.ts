import type { Entry, EntryDetails } from '../data';
import { cleanDetails } from '../composer/logic';
import { bookPace, etaLabel, isSeries } from '../lib/entries';
import { todayInputValue } from '../lib/format';

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
  const where = [
    s ? `Temporada ${s}${total ? ` de ${total}` : ''}` : '',
    ep ? `episodio ${ep}` : '',
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

/** Detalles de la serie en la temporada y el episodio indicados. */
export function withEpisode(e: Entry, season?: number, episode?: number): EntryDetails {
  return cleanDetails('Película', {
    ...e.details,
    // Fija que es serie (si solo lo decía una etiqueta, «viendo» se perdería).
    series: true,
    watch: 'viendo',
    seasonAt: season && season > 0 ? season : undefined,
    episodeAt: episode && episode > 0 ? episode : undefined,
  });
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
