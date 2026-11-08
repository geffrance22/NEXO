import type { CSSProperties } from 'react';
import { Check, Layers, Paperclip, Pencil, Tv } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { incomeColors, kindMeta, seriesColors } from '../composer/kinds';
import { entryFacts, entrySummary, isSeries, signedAmount } from '../lib/entries';
import { entryImages } from '../lib/moviePosters';
import { friendlyDate, todayInputValue } from '../lib/format';
import { Avatar } from '../people/Avatar';

const MAX_FACES = 3;

/**
 * Tarjeta compacta de la libreta: tipo, fecha, título, un resumen corto y con quién. Al tocarla
 * se abre la ficha completa del recuerdo.
 */
export function NoteTile({ entry }: { entry: Entry }) {
  const { workspace, viewEntry, editEntry, toggleEntry } = useApp();
  const meta = kindMeta[entry.kind];
  const series = isSeries(entry);
  const colors =
    entry.kind === 'Movimiento' && entry.direction === 'ingreso'
      ? incomeColors
      : series
        ? seriesColors
        : meta;
  const Icon = series ? Tv : meta.icon;
  const people = workspace.people.filter((p) => entry.person_ids.includes(p.id));
  const summary = entrySummary(entry);
  const facts = entryFacts(entry, workspace).slice(0, 3);
  // Películas y libros: póster pequeño al lado (el de TMDB o la portada de la edición). El resto:
  // la primera foto arriba.
  const images = entryImages(entry);
  const poster = entry.kind === 'Película' || entry.kind === 'Libro' ? images[0] : undefined;
  const photo = !poster && entry.kind !== 'Movimiento' ? images[0] : undefined;
  const { read, pagesRead = 0, pagesTotal = 0 } = entry.details;
  const progress =
    entry.kind === 'Libro' && read === 'leyendo' && pagesTotal > 0
      ? Math.min(100, Math.round((pagesRead / pagesTotal) * 100))
      : null;
  const done = entry.kind === 'Pendiente' && entry.status === 'completado';
  const inEpisode = Boolean(
    entry.episode_id && workspace.episodes.some((ep) => ep.id === entry.episode_id),
  );
  const hasFoot = people.length > 0 || inEpisode || entry.file_path || entry.kind === 'Pendiente';

  return (
    <article
      className={'nt' + (done ? ' done' : '') + (photo ? ' has-photo' : '')}
      style={{ '--c': colors.accent, '--s': colors.soft, '--k': colors.ink } as CSSProperties}
    >
      {photo && (
        <div className="nt-photo">
          <img src={photo.medium ?? photo.url} alt="" loading="lazy" />
          {images.length > 1 && <span>+{images.length - 1}</span>}
        </div>
      )}
      <div className="nt-top">
        <span className="nt-kind">
          <Icon size={12} /> {series ? 'Serie' : entry.kind}
        </span>
        <time dateTime={entry.created_at}>
          {friendlyDate(todayInputValue(new Date(entry.created_at)))}
        </time>
      </div>

      <div className={'nt-main' + (poster ? ' with-poster' : '')}>
        {poster && (
          <img
            className="nt-poster"
            src={poster.thumb ?? poster.medium ?? poster.url}
            alt=""
            loading="lazy"
          />
        )}
        <div>
          <h3>
            <button type="button" className="nt-open" onClick={() => viewEntry(entry)}>
              <span>{entry.title || entry.kind}</span>
            </button>
          </h3>
          {entry.kind === 'Movimiento' && (
            <strong className={'nt-amount ' + entry.direction}>{signedAmount(entry)}</strong>
          )}
          {summary && <p>{summary}</p>}
        </div>
      </div>

      {progress !== null && (
        <div className="nt-progress" title={`Página ${pagesRead} de ${pagesTotal}`}>
          <b>
            <i style={{ width: progress + '%' }} />
          </b>
          <span>{progress}%</span>
        </div>
      )}

      {facts.length > 0 && (
        <div className="nt-facts">
          {facts.map((f) => (
            <span key={f.text} className={f.tone}>
              {f.text}
            </span>
          ))}
        </div>
      )}

      {hasFoot && (
        <footer className="nt-foot">
          {people.length > 0 && (
            <span className="nt-faces" title={people.map((p) => p.name).join(', ')}>
              {people.slice(0, MAX_FACES).map((p) => (
                <Avatar key={p.id} person={p} size={22} />
              ))}
              {people.length > MAX_FACES && <i>+{people.length - MAX_FACES}</i>}
              {people.length === 1 && <em>{people[0].name.split(' ')[0]}</em>}
            </span>
          )}
          <span className="nt-icons">
            {inEpisode && (
              <span title="Parte de un episodio">
                <Layers size={13} />
              </span>
            )}
            {entry.file_path && (
              <span title="Tiene un adjunto">
                <Paperclip size={13} />
              </span>
            )}
          </span>
          {entry.kind === 'Pendiente' && (
            <button
              type="button"
              className={'nt-check' + (done ? ' on' : '')}
              aria-label={done ? 'Reabrir pendiente' : 'Marcar como hecho'}
              title={done ? 'Reabrir' : 'Marcar como hecho'}
              onClick={() => toggleEntry(entry)}
            >
              <Check size={13} />
            </button>
          )}
        </footer>
      )}

      <button
        type="button"
        className="nt-edit"
        aria-label="Editar recuerdo"
        title="Editar"
        onClick={() => editEntry(entry)}
      >
        <Pencil size={13} />
      </button>
    </article>
  );
}
