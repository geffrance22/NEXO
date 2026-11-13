import { useState } from 'react';
import { Star } from 'lucide-react';
import type { Entry } from '../data';
import { airLabel, noteKey } from './progress';
import './episodeNotes.css';

/** Episodios a la vista por temporada; el resto, con «Ver más». */
const LIMIT = 4;

const average = (list: number[]) =>
  (list.reduce((s, n) => s + n, 0) / list.length).toLocaleString('es-CO', {
    maximumFractionDigits: 1,
  });

/**
 * En la ficha de una serie: los episodios que calificaste o reseñaste (los demás no salen), por
 * temporada y pocos a la vez. Solo calificación: una línea. Con reseña: dos líneas que se abren
 * al tocarlas.
 */
export function EpisodeNotes({ entry }: { entry: Entry }) {
  const notes = (entry.details.episodeNotes ?? []).filter((n) => n.rating || n.review);
  const seasons = [...new Set(notes.map((n) => n.s))].sort((a, b) => a - b);
  const at = entry.details.seasonAt;
  // De entrada, la temporada en la que vas (si tiene algo) o la última con algo.
  const [picked, setPicked] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (!notes.length) return null;

  const season =
    picked !== null && seasons.includes(picked)
      ? picked
      : at && seasons.includes(at)
        ? at
        : seasons[seasons.length - 1];
  // Lo último que viste, primero.
  const list = notes.filter((n) => n.s === season).sort((a, b) => b.e - a.e);
  const shown = all ? list : list.slice(0, LIMIT);
  const ratings = notes.flatMap((n) => (n.rating ? [n.rating] : []));
  const reviews = notes.filter((n) => n.review).length;
  const sum = [
    ratings.length > 0 && `★ ${average(ratings)} de media`,
    `${notes.length} ${notes.length === 1 ? 'episodio' : 'episodios'}`,
    reviews > 0 && `${reviews} ${reviews === 1 ? 'reseña' : 'reseñas'}`,
  ].filter(Boolean);

  return (
    <section className="ev-eps" aria-label="Tus episodios">
      <header className="ev-eps-head">
        <b>Tus episodios</b>
        <span>{sum.join(' · ')}</span>
      </header>

      {seasons.length > 1 && (
        <div className="ev-eps-seasons" role="tablist" aria-label="Temporada">
          {seasons.map((s) => (
            <button
              type="button"
              role="tab"
              key={s}
              aria-selected={s === season}
              className={s === season ? 'on' : ''}
              onClick={() => {
                setPicked(s);
                setAll(false);
              }}
            >
              T{s} <i>{notes.filter((n) => n.s === s).length}</i>
            </button>
          ))}
        </div>
      )}

      <ul className="ev-eps-list">
        {shown.map((n) => {
          const key = noteKey(n.s, n.e);
          const title = n.name || n.es || `Episodio ${n.e}`;
          const meta = [n.aired && airLabel(n.aired), n.runtime && `${n.runtime} min`].filter(
            Boolean,
          );
          const expanded = open === key;
          return (
            <li key={key}>
              <div className="ev-ep-row">
                <span className="ev-ep-n" title={`Temporada ${n.s}, episodio ${n.e}`}>
                  E{n.e}
                </span>
                <span className="ev-ep-main">
                  <strong title={n.es && n.es !== title ? `En español: ${n.es}` : undefined}>
                    {title}
                  </strong>
                  {meta.length > 0 && <small>{meta.join(' · ')}</small>}
                </span>
                {n.rating ? (
                  <span className="ev-ep-stars" role="img" aria-label={`${n.rating} de 5`}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} size={11} className={i <= n.rating! ? 'on' : ''} />
                    ))}
                  </span>
                ) : null}
              </div>
              {n.review && (
                <button
                  type="button"
                  className={'ev-ep-review' + (expanded ? ' open' : '')}
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : key)}
                >
                  {n.review}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {list.length > LIMIT && (
        <button type="button" className="ev-eps-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Ver menos' : `Ver ${list.length - LIMIT} más de la T${season}`}
        </button>
      )}
    </section>
  );
}
