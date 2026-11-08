import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

class Upstream extends Error {
  constructor(status) {
    super('TMDB ' + status);
    this.status = status;
  }
}

/** Versión local de la función `movie-search`: películas y series de TMDB mientras usas Vite. */
export function localMovies(env) {
  const path = join(process.env.LOCALAPPDATA || homedir(), 'Nexo', 'tmdb.key');
  let apiKey = env.TMDB_API_KEY;
  if (!apiKey)
    try {
      apiKey = readFileSync(path, 'utf8').trim();
    } catch {}
  return function middleware(req, res, next) {
    if (req.url?.split('?')[0] !== '/api/nexo/movie-search') return next();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const reply = (status, body) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    const host = new URL('http://' + req.headers.host).hostname;
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(host) ||
      req.headers.origin !== 'http://' + req.headers.host
    )
      return reply(403, { error: 'Abre Nexo en localhost.' });
    if (req.method !== 'POST') return reply(405, { error: 'Método no permitido.' });
    (async () => {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) return reply(413, { error: 'Consulta demasiado larga.' });
      }
      let fields;
      try {
        fields = JSON.parse(raw);
      } catch {
        return reply(400, { error: 'Consulta inválida.' });
      }
      const { query, year, id, type } = fields || {};
      const detail = Number.isSafeInteger(id) && id > 0;
      const only = type === 'tv' || type === 'movie' ? type : null;
      if (!detail && (typeof query !== 'string' || query.trim().length < 2 || query.length > 180))
        return reply(400, { error: 'Título inválido.' });
      if (!env.TMDB_READ_TOKEN && !apiKey)
        return reply(503, { error: 'Configura la credencial local de TMDB y reinicia Vite.' });

      const tmdb = async (route, params) => {
        const url = new URL('https://api.themoviedb.org/3/' + route);
        url.search = new URLSearchParams({ language: 'es-ES', ...params }).toString();
        const headers = { Accept: 'application/json' };
        if (env.TMDB_READ_TOKEN) headers.Authorization = 'Bearer ' + env.TMDB_READ_TOKEN;
        else url.searchParams.set('api_key', apiKey);
        const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(7000) });
        if (!upstream.ok) throw new Upstream(upstream.status);
        return upstream.json();
      };

      try {
        if (detail) {
          const tv = only === 'tv';
          const m = await tmdb((tv ? 'tv/' : 'movie/') + id, { append_to_response: 'credits' });
          const rating = Number(m.vote_average);
          return reply(200, {
            info: {
              id: m.id,
              type: tv ? 'tv' : 'movie',
              year: (tv ? m.first_air_date : m.release_date)?.slice(0, 4) || '',
              runtime: tv
                ? m.episode_run_time?.[0] || m.last_episode_to_air?.runtime || null
                : m.runtime || null,
              director: tv
                ? (m.created_by || []).map((c) => c.name).join(', ')
                : (m.credits?.crew || [])
                    .filter((c) => c.job === 'Director')
                    .map((c) => c.name)
                    .join(', '),
              genres: (m.genres || []).map((g) => g.name),
              seasons: tv ? m.number_of_seasons || undefined : undefined,
              episodes: tv ? m.number_of_episodes || undefined : undefined,
              overview: typeof m.overview === 'string' ? m.overview.slice(0, 700) : '',
              cast: (m.credits?.cast || []).slice(0, 5).map((c) => c.name),
              tmdbRating: rating > 0 ? Math.round(rating * 10) / 10 : undefined,
            },
          });
        }
        const term = query.trim();
        const y = typeof year === 'string' && /^\d{4}$/.test(year) ? year : '';
        const search = (kind) =>
          tmdb('search/' + kind, {
            query: term,
            include_adult: 'false',
            ...(y ? { [kind === 'tv' ? 'first_air_date_year' : 'primary_release_year']: y } : {}),
          }).then(({ results }) =>
            (results || []).map((m) => ({
              id: m.id,
              type: kind,
              title: (kind === 'tv' ? m.name : m.title) || '',
              original: (kind === 'tv' ? m.original_name : m.original_title) || '',
              year: (kind === 'tv' ? m.first_air_date : m.release_date)?.slice(0, 4) || '',
              path: m.poster_path,
              popularity: m.popularity || 0,
            })),
          );
        const lists = await Promise.all((only ? [only] : ['movie', 'tv']).map(search));
        reply(200, {
          movies: lists
            .flat()
            .sort((a, b) => b.popularity - a.popularity)
            .slice(0, 20)
            .map(({ popularity, ...m }) => m),
        });
      } catch (e) {
        if (!(e instanceof Upstream)) throw e;
        reply(e.status === 429 ? 429 : 502, {
          error:
            e.status === 401
              ? 'TMDB rechazó la credencial local.'
              : 'TMDB no pudo completar la búsqueda.',
        });
      }
    })().catch(() => reply(502, { error: 'No se pudo conectar con TMDB.' }));
  };
}
