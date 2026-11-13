import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

type Media = 'movie' | 'tv';
type Hit = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path: string | null;
  popularity?: number;
};
type Named = { name: string };
type TmdbEpisode = {
  episode_number: number;
  name?: string;
  air_date?: string | null;
  runtime?: number | null;
};
/** «Episodio 9», «Episode 9»: TMDB lo pone cuando el episodio no tiene título en ese idioma. */
const generic = (s: string) => /^(episodio|episode|cap[ií]tulo|chapter|ep\.?)\s*\d+$/i.test(s.trim());
class Upstream extends Error {
  constructor(public status: number) {
    super('TMDB ' + status);
  }
}

/**
 * Películas y series de TMDB. Sin `id` busca por título (en las dos, o solo en `type`); con `id`
 * devuelve la ficha (duración, dirección o creadores, temporadas, reparto y sinopsis). Con `id`,
 * `type: 'tv'` y `season`, los episodios de esa temporada: título original (y en español si es
 * otro), fecha de emisión y duración. Sin sinopsis: no se adelanta nada de lo que pasa.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Inicia sesión.' }, 401);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) return json({ error: 'Inicia sesión.' }, 401);
    const { query, year, id, type, season } = await req.json().catch(() => ({}));
    const detail = Number.isSafeInteger(id) && id > 0;
    const only: Media | null = type === 'tv' || type === 'movie' ? type : null;
    const seasonNo = Number.isSafeInteger(season) && season >= 0 && season <= 500 ? season : null;
    if (!detail && (typeof query !== 'string' || query.trim().length < 2 || query.length > 180))
      return json({ error: 'Escribe al menos dos caracteres.' }, 400);
    const token = Deno.env.get('TMDB_READ_TOKEN');
    if (!token) return json({ error: 'Falta configurar TMDB_READ_TOKEN en Supabase.' }, 503);

    const tmdb = async (path: string, params: Record<string, string>) => {
      const url = new URL('https://api.themoviedb.org/3/' + path);
      url.search = new URLSearchParams({ language: 'es-ES', ...params }).toString();
      const res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) throw new Upstream(res.status);
      return res.json();
    };

    if (detail && only === 'tv' && seasonNo !== null) {
      // En español y, si la serie es de otro idioma, también en el suyo (el título original).
      const [es, show] = await Promise.all([
        tmdb(`tv/${id}/season/${seasonNo}`, {}),
        tmdb(`tv/${id}`, {}).catch(() => null),
      ]);
      const lang = typeof show?.original_language === 'string' ? show.original_language : 'es';
      const orig =
        lang && lang !== 'es'
          ? await tmdb(`tv/${id}/season/${seasonNo}`, { language: lang }).catch(() => null)
          : null;
      const originals = new Map<number, string>(
        ((orig?.episodes ?? []) as TmdbEpisode[]).map((x) => [x.episode_number, x.name ?? '']),
      );
      const episodes = ((es.episodes ?? []) as TmdbEpisode[])
        .filter((x) => Number.isSafeInteger(x.episode_number) && x.episode_number > 0)
        .map((x) => {
          const esName = (x.name ?? '').trim();
          const original = (originals.get(x.episode_number) ?? '').trim();
          const name =
            original && !generic(original) ? original : esName && !generic(esName) ? esName : '';
          return {
            n: x.episode_number,
            name: name.slice(0, 200),
            // El título en español solo si de verdad lo tiene y no es el mismo.
            es: esName && !generic(esName) && esName !== name ? esName.slice(0, 200) : undefined,
            aired: typeof x.air_date === 'string' ? x.air_date.slice(0, 10) : undefined,
            runtime: x.runtime && x.runtime > 0 ? x.runtime : undefined,
          };
        })
        .slice(0, 400);
      return json({ season: { n: seasonNo, episodes } });
    }

    if (detail) {
      const tv = only === 'tv';
      const m = await tmdb((tv ? 'tv/' : 'movie/') + id, { append_to_response: 'credits' });
      const cast = ((m.credits?.cast ?? []) as Named[]).slice(0, 5).map((c) => c.name);
      const rating = Number(m.vote_average);
      return json({
        info: {
          id: m.id,
          type: tv ? 'tv' : 'movie',
          year: (tv ? m.first_air_date : m.release_date)?.slice(0, 4) || '',
          runtime: tv
            ? m.episode_run_time?.[0] || m.last_episode_to_air?.runtime || null
            : m.runtime || null,
          director: tv
            ? ((m.created_by ?? []) as Named[]).map((c) => c.name).join(', ')
            : ((m.credits?.crew ?? []) as (Named & { job: string })[])
                .filter((c) => c.job === 'Director')
                .map((c) => c.name)
                .join(', '),
          genres: ((m.genres ?? []) as Named[]).map((g) => g.name),
          seasons: tv ? m.number_of_seasons || undefined : undefined,
          episodes: tv ? m.number_of_episodes || undefined : undefined,
          overview: typeof m.overview === 'string' ? m.overview.slice(0, 700) : '',
          cast,
          tmdbRating: rating > 0 ? Math.round(rating * 10) / 10 : undefined,
        },
      });
    }

    const term = query.trim();
    const y = typeof year === 'string' && /^\d{4}$/.test(year) ? year : '';
    const search = (kind: Media) =>
      tmdb('search/' + kind, {
        query: term,
        include_adult: 'false',
        ...(y ? { [kind === 'tv' ? 'first_air_date_year' : 'primary_release_year']: y } : {}),
      }).then(({ results }) =>
        ((results ?? []) as Hit[]).map((m) => ({
          id: m.id,
          type: kind,
          title: (kind === 'tv' ? m.name : m.title) || '',
          original: (kind === 'tv' ? m.original_name : m.original_title) || '',
          year: (kind === 'tv' ? m.first_air_date : m.release_date)?.slice(0, 4) || '',
          path: m.poster_path,
          popularity: m.popularity ?? 0,
        })),
      );
    const kinds: Media[] = only ? [only] : ['movie', 'tv'];
    const lists = await Promise.all(kinds.map(search));
    // Lo más conocido primero, sea película o serie.
    const movies = lists
      .flat()
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 20)
      .map(({ popularity: _, ...m }) => m);
    return json({ movies });
  } catch (e) {
    if (e instanceof Upstream)
      return json(
        {
          error:
            e.status === 429
              ? 'TMDB está ocupado. Inténtalo en un momento.'
              : 'No se pudo consultar TMDB.',
        },
        e.status === 429 ? 429 : 502,
      );
    return json({ error: 'No se pudo conectar con TMDB.' }, 502);
  }
});
