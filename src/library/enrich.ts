import { useEffect, useRef } from 'react';
import { useApp, type AppContextValue } from '../AppContext';
import type { Entry } from '../data';
import { cleanDetails } from '../composer/logic';
import { findMedia, movieInfo } from '../lib/moviePosters';

/** Ya se intentó en esta sesión (para no repetir consultas a TMDB). */
const tried = new Set<string>();
const MISS_KEY = 'nexo-tmdb-miss';
const MISS_DAYS = 7;

function misses(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(MISS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
const missedRecently = (id: string) => (misses()[id] ?? 0) > Date.now() - MISS_DAYS * 864e5;
function markMiss(id: string) {
  const all = misses();
  all[id] = Date.now();
  // Solo los más recientes.
  const kept = Object.fromEntries(
    Object.entries(all)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 300),
  );
  try {
    localStorage.setItem(MISS_KEY, JSON.stringify(kept));
  } catch {
    /* Sin almacenamiento: se volverá a intentar. */
  }
}

/**
 * Lo que le falta a una película o serie: buscar su póster y ficha (se guardó sin ellos, p. ej. al
 * capturarla) o completar una ficha antigua que no traía sinopsis.
 */
export function needsMedia(e: Entry): 'find' | 'info' | null {
  if (e.kind !== 'Película') return null;
  const d = e.details;
  const poster = d.tmdbPoster;
  if (!poster?.id) return !poster?.manual && !e.images.length ? 'find' : null;
  if (!d.movieInfo || d.movieInfo.overview === undefined) return 'info';
  return null;
}

/** Completa una película o serie con TMDB y la guarda (en silencio). */
export async function enrichMedia(
  id: string,
  current: () => Entry | undefined,
  patchEntry: AppContextValue['patchEntry'],
) {
  if (tried.has(id)) return;
  tried.add(id);
  const e = current();
  const need = e && needsMedia(e);
  if (!e || !need || (need === 'find' && missedRecently(id))) return;
  try {
    if (need === 'find') {
      const want = e.details.series === undefined ? undefined : e.details.series ? 'tv' : 'movie';
      const found = await findMedia(e.title, e.details.year ?? '', want);
      if (!found) return markMiss(id);
      const now = current();
      if (!now || now.details.tmdbPoster?.id) return;
      await patchEntry(now, {
        details: cleanDetails('Película', {
          ...now.details,
          ...found,
          year: found.year ?? now.details.year,
        }),
      });
      return;
    }
    const ref = e.details.tmdbPoster!;
    const info = await movieInfo(ref.id!, ref.type ?? 'movie');
    // Si la función de TMDB aún no está actualizada, la ficha no trae sinopsis: no se toca.
    if (info.overview === undefined) return;
    const now = current();
    if (!now || now.details.tmdbPoster?.id !== ref.id) return;
    await patchEntry(now, { details: { ...now.details, movieInfo: info } });
  } catch {
    /* Sin conexión con TMDB: se intentará en otra sesión. */
  }
}

/** Una por una, busca póster y ficha para las películas y series que no los tienen. */
export function useMediaBackfill(entries: Entry[], max = 24) {
  const { workspace, patchEntry } = useApp();
  const latest = useRef(workspace.entries);
  latest.current = workspace.entries;
  useEffect(() => {
    const queue = entries
      .filter((e) => needsMedia(e) === 'find' && !tried.has(e.id) && !missedRecently(e.id))
      .slice(0, max);
    if (!queue.length) return;
    let live = true;
    void (async () => {
      for (const e of queue) {
        if (!live) return;
        await enrichMedia(e.id, () => latest.current.find((x) => x.id === e.id), patchEntry);
        await new Promise((r) => setTimeout(r, 250));
      }
    })();
    return () => {
      live = false;
    };
  }, [entries, max, patchEntry]);
}

/** Al abrir la ficha: si le falta el póster o la sinopsis, se completa. */
export function useMediaEnrich(entry: Entry) {
  const { workspace, patchEntry } = useApp();
  const latest = useRef(workspace.entries);
  latest.current = workspace.entries;
  useEffect(() => {
    if (!needsMedia(entry)) return;
    void enrichMedia(entry.id, () => latest.current.find((x) => x.id === entry.id), patchEntry);
    // Solo al abrir la ficha de ese recuerdo.
  }, [entry.id]);
}
