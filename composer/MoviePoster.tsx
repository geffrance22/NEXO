import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard, Search, ImagePlus, Trash2, Tv, X } from 'lucide-react';
import type { ComposerApi } from './useComposer';
import {
  movieInfo,
  lookup,
  normal,
  exactMovie,
  posterUrl,
  type MediaType,
  type MovieHit,
} from '../lib/moviePosters';
import './moviePoster.css';

type Only = 'all' | MediaType;
const onlyOptions: { value: Only; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'movie', label: 'Películas' },
  { value: 'tv', label: 'Series' },
];

function Picker({
  initial,
  prefer,
  choose,
  close,
}: {
  initial: string;
  /** Lo que ya elegiste en el formulario (película o serie), para filtrar desde el inicio. */
  prefer?: MediaType;
  choose: (hit: MovieHit) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, set] = useState(initial),
    [only, setOnly] = useState<Only>(prefer ?? 'all'),
    [hits, list] = useState<MovieHit[]>([]),
    [status, report] = useState('');
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    el.querySelector('input')?.focus();
    return () => el.close();
  }, []);
  useEffect(() => {
    let live = true;
    list([]);
    const term = query.trim();
    report(term.length < 2 ? 'Escribe al menos dos caracteres.' : 'Buscando…');
    const timer = setTimeout(async () => {
      if (term.length < 2) return;
      try {
        const found = await lookup(term, '', only === 'all' ? undefined : only);
        if (live) {
          list(found);
          report(found.length ? '' : 'Sin resultados. Prueba el título original.');
        }
      } catch (e) {
        if (live) report((e as Error).message);
      }
    }, 320);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, only]);
  return createPortal(
    <dialog
      ref={dialog}
      className="mp-picker"
      aria-label="Elegir portada"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div>
        <header>
          <h3>Buscar en TMDB</h3>
          <button type="button" aria-label="Cerrar" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <label>
          <Search size={16} />
          <input
            aria-label="Buscar película o serie en TMDB"
            placeholder="Título de la película o serie"
            maxLength={180}
            value={query}
            onChange={(e) => set(e.target.value)}
          />
        </label>
        <div className="mp-only" role="radiogroup" aria-label="Buscar en">
          {onlyOptions.map((o) => (
            <button
              type="button"
              role="radio"
              key={o.value}
              aria-checked={only === o.value}
              className={only === o.value ? 'on' : ''}
              onClick={() => setOnly(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <small role="status">{status}</small>
        <section>
          {hits.map((m) => (
            <button type="button" key={m.type + ':' + m.id} onClick={() => choose(m)}>
              {posterUrl(m.path, 'w92') ? (
                <img src={posterUrl(m.path, 'w92')} alt="" loading="lazy" />
              ) : (
                <span className="mp-noart">
                  {m.type === 'tv' ? <Tv size={20} /> : <Clapperboard size={20} />}
                </span>
              )}
              <span>
                <strong>{m.title}</strong>
                <small>
                  <em className={'mp-type ' + (m.type ?? 'movie')}>
                    {m.type === 'tv' ? 'Serie' : 'Película'}
                  </em>
                  {m.year || 'Año desconocido'}
                  {m.original && m.original !== m.title ? ' · ' + m.original : ''}
                  {!m.path ? ' · Sin portada' : ''}
                </small>
              </span>
            </button>
          ))}
        </section>
        <footer>Portadas y fichas de TMDB</footer>
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * Portada y ficha de TMDB. Busca sola por el título (en películas y series, o solo en lo que
 * elegiste) y se puede cambiar a mano. Elegir un resultado también fija si es película o serie.
 */
export function MoviePoster({ c }: { c: ComposerApi }) {
  const [picker, show] = useState(false),
    [hint, report] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const ref = c.details.tmdbPoster,
    title = c.title.trim(),
    year = c.details.year || '',
    custom = c.uploads.items[0],
    key = normal(title) + '|' + year,
    setDetail = c.setDetail;
  const choice = c.details.series;
  const want: MediaType | undefined = choice === undefined ? undefined : choice ? 'tv' : 'movie';
  // Una coincidencia automática del otro tipo se vuelve a buscar al cambiar película ↔ serie.
  const otherType = Boolean(want && ref?.id && !ref.manual && (ref.type ?? 'movie') !== want);
  useEffect(() => {
    let live = true;
    report('');
    if (
      (custom && c.details.movieInfo) ||
      ref?.manual ||
      (ref?.key === key && !otherType) ||
      title.length < 2
    )
      return;
    const timer = setTimeout(async () => {
      try {
        const hit = exactMovie(await lookup(title, year, want), title, year);
        if (!live) return;
        if (hit) {
          setDetail('tmdbPoster', { id: hit.id, type: hit.type, path: hit.path || undefined, key });
        } else {
          if (otherType) setDetail('tmdbPoster', undefined);
          report('Sin coincidencia exacta. Puedes elegir la portada.');
        }
      } catch (e) {
        if (live) report((e as Error).message);
      }
    }, 480);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [title, year, key, custom, ref, setDetail, c.details.movieInfo, want, otherType]);
  const info = c.details.movieInfo;
  const refType = ref?.type ?? 'movie';
  const infoType = info?.type ?? 'movie';
  useEffect(() => {
    let live = true;
    if (!ref?.id || (ref.id === info?.id && refType === infoType)) return;
    movieInfo(ref.id, refType)
      .then((value) => {
        if (live) setDetail('movieInfo', value);
      })
      .catch((e) => {
        if (live) report((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [ref?.id, refType, info?.id, infoType, setDetail]);
  const src =
    custom?.preview ||
    ((ref?.manual || ref?.key === key) && posterUrl(ref?.path, 'w342')) ||
    undefined;
  function choose(m: MovieHit) {
    c.uploads.items.forEach((i) => c.uploads.remove(i.id));
    setDetail('tmdbPoster', { id: m.id, type: m.type, path: m.path || undefined, manual: true });
    c.setTitle(m.title);
    setDetail('movieInfo', undefined);
    setDetail('year', m.year);
    setDetail('series', m.type === 'tv');
    show(false);
  }
  const tv = info?.type === 'tv';
  const facts: [string, string][] = info
    ? tv
      ? [
          [
            'Temporadas',
            info.seasons
              ? info.seasons + (info.episodes ? ` · ${info.episodes} episodios` : '')
              : '',
          ],
          ['Episodio', info.runtime ? info.runtime + ' min' : ''],
          ['Estreno', info.year],
          ['Creada por', info.director],
          ['Género', info.genres.join(' · ')],
        ]
      : [
          ['Duración', info.runtime ? info.runtime + ' min' : ''],
          ['Año', info.year],
          ['Dirección', info.director],
          ['Género', info.genres.join(' · ')],
        ]
    : [];
  return (
    <div className="mp">
      <div className="mp-art">
        {src ? (
          <img src={src} alt={tv ? 'Póster de la serie' : 'Carátula de la película'} />
        ) : choice || tv ? (
          <Tv size={32} />
        ) : (
          <Clapperboard size={32} />
        )}
        <div className="mp-actions">
          <button
            type="button"
            title="Cambiar portada · TMDB"
            aria-label="Buscar otra portada"
            onClick={() => show(true)}
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            title="Subir a ImgBB"
            aria-label="Subir portada propia"
            onClick={() => file.current?.click()}
          >
            <ImagePlus size={15} />
          </button>
          {(src || custom) && (
            <button
              type="button"
              title="Eliminar portada"
              aria-label="Eliminar portada"
              onClick={() => {
                c.uploads.items.forEach((i) => c.uploads.remove(i.id));
                setDetail('tmdbPoster', { id: ref?.id, type: ref?.type, manual: true });
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      <input
        hidden
        ref={file}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) c.uploads.add([f], true);
          e.target.value = '';
        }}
      />
      {custom?.status === 'uploading' && (
        <small>Subiendo… {Math.round(custom.progress * 100)} %</small>
      )}
      {custom?.status === 'error' && (
        <button type="button" onClick={() => c.uploads.retry(custom.id)}>
          Reintentar subida
        </button>
      )}
      {c.uploads.notice && <small>{c.uploads.notice}</small>}
      {hint && !custom && <small role="status">{hint}</small>}
      {facts.some(([, v]) => v) && (
        <dl className="mp-facts">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      )}
      {picker && <Picker initial={title} prefer={want} choose={choose} close={() => show(false)} />}
    </div>
  );
}
