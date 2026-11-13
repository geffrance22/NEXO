import { supabase } from '../backend';
import type { Entry, EntryDetails, StoredImage } from '../data';

export type MediaType = 'movie' | 'tv';
export type MovieHit = {
  id: number;
  /** Película o serie (las respuestas antiguas no lo traen: son películas). */
  type?: MediaType;
  title: string;
  original: string;
  year: string;
  path: string | null;
};
export const normal = (s: string) =>
  s
    .trim()
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
export function posterUrl(path: string | null | undefined, size: 'w92' | 'w342' | 'w780') {
  return path && /^\/[\w.-]+$/.test(path) ? 'https://image.tmdb.org/t/p/' + size + path : undefined;
}
export function entryImages(e: Entry): StoredImage[] {
  const book = e.details.bookEdition?.image;
  if (e.kind === 'Libro' && !e.images.length && book?.startsWith('https://'))
    return [{ url: book }];
  const path = e.details.tmdbPoster?.path;
  const url = posterUrl(path, 'w780');
  return e.kind === 'Película' && !e.images.length && url
    ? [{ url, medium: posterUrl(path, 'w342'), thumb: posterUrl(path, 'w92') }]
    : e.images;
}
const cache = new Map<string, { until: number; result: Promise<MovieHit[]> }>();
/** Busca por título en películas y series (o solo en `type`). */
export function lookup(query: string, year = '', type?: MediaType) {
  const key = normal(query) + '|' + year + '|' + (type ?? '');
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  const result = (async () => {
    const hits = ((await request({ query, year, type })).movies || []) as MovieHit[];
    return hits.map((h) => ({ ...h, type: h.type ?? 'movie' }));
  })();
  if (cache.size >= 60) cache.delete(cache.keys().next().value!);
  cache.set(key, { until: Date.now() + 600000, result });
  result.catch(() => {
    if (cache.get(key)?.result === result) cache.delete(key);
  });
  return result;
}
export function exactMovie(hits: MovieHit[], title: string, year: string) {
  return hits.find(
    (m) =>
      (!year || m.year === year) && [m.title, m.original].some((t) => normal(t) === normal(title)),
  );
}
/** Sin signos ni espacios dobles: «Spider-Man: Un nuevo universo» ≈ «Spider Man un nuevo universo». */
const loose = (s: string) =>
  normal(s)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Póster y ficha de TMDB para un título (al capturar, o para lo que se guardó sin portada). Busca
 * en lo que se pidió (película o serie) o en las dos; solo acepta coincidencias del título.
 */
export async function findMedia(
  title: string,
  year = '',
  type?: MediaType,
): Promise<Pick<EntryDetails, 'tmdbPoster' | 'movieInfo' | 'year'> | null> {
  return (await findMediaHit(title, year, type))?.details ?? null;
}

/** Como `findMedia`, pero también devuelve el resultado de TMDB (con su título en español). */
export async function findMediaHit(
  title: string,
  year = '',
  type?: MediaType,
): Promise<{
  hit: MovieHit;
  details: Pick<EntryDetails, 'tmdbPoster' | 'movieInfo' | 'year'>;
} | null> {
  const clean = title.trim();
  if (clean.length < 2) return null;
  const hits = await lookup(clean, year, type);
  const hit =
    exactMovie(hits, clean, year) ??
    (year ? exactMovie(hits, clean, '') : undefined) ??
    hits.find((m) => [m.title, m.original].some((t) => loose(t) === loose(clean)));
  if (!hit) return null;
  const info = await movieInfo(hit.id, hit.type).catch(() => undefined);
  const finalYear = info?.year || hit.year || year;
  return {
    hit,
    details: {
      tmdbPoster: {
        id: hit.id,
        type: hit.type,
        path: hit.path || undefined,
        key: normal(clean) + '|' + finalYear,
      },
      movieInfo: info,
      year: finalYear || undefined,
    },
  };
}

async function request(
  body:
    | { id: number; type?: MediaType; season?: number }
    | { query: string; year: string; type?: MediaType },
) {
  if (import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    const res = await fetch('/api/nexo/movie-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.error || 'No se pudo consultar TMDB.');
    return data;
  }
  const { data, error } = await supabase.functions.invoke('movie-search', {
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (error) {
    let message = 'No se pudo buscar en TMDB.';
    try {
      message = (await error.context.json()).error || message;
    } catch {
      /* Network failure */
    }
    throw Error(message);
  }
  return data;
}
/** Un episodio de TMDB: título original (y en español si es otro), emisión y duración. */
export type TvEpisode = {
  n: number;
  /** Vacío si TMDB no le conoce título. */
  name: string;
  es?: string;
  /** AAAA-MM-DD */
  aired?: string;
  /** Minutos. */
  runtime?: number;
};
const seasonCache = new Map<string, Promise<TvEpisode[] | null>>();
/**
 * Los episodios de una temporada de una serie de TMDB. null: la función desplegada aún no los
 * da (o TMDB no conoce esa temporada).
 */
export function seasonEpisodes(id: number, season: number) {
  const key = id + ':' + season;
  const found = seasonCache.get(key);
  if (found) return found;
  const promise = request({ id, type: 'tv', season }).then((data) => {
    const list = data?.season?.episodes;
    return Array.isArray(list) ? (list as TvEpisode[]) : null;
  });
  if (seasonCache.size >= 40) seasonCache.delete(seasonCache.keys().next().value!);
  seasonCache.set(key, promise);
  promise.catch(() => seasonCache.delete(key));
  return promise;
}

type MovieInfo = NonNullable<Entry['details']['movieInfo']>;
const infoCache = new Map<string, Promise<MovieInfo>>();
/** Ficha de TMDB de una película o una serie. */
export function movieInfo(id: number, type: MediaType = 'movie') {
  const key = type + ':' + id;
  const found = infoCache.get(key);
  if (found) return found;
  const promise = request({ id, type }).then((data) => {
    if (data?.info?.id !== id) throw Error('No se pudo cargar la ficha de TMDB.');
    // Una función sin actualizar no devuelve el tipo: se respeta el que se pidió.
    return { ...data.info, type: data.info.type ?? type } as MovieInfo;
  });
  if (infoCache.size >= 60) infoCache.delete(infoCache.keys().next().value!);
  infoCache.set(key, promise);
  promise.catch(() => infoCache.delete(key));
  return promise;
}
