import { entryImages } from '../lib/moviePosters';
import { useEffect, useRef, type CSSProperties } from 'react';
import {
  Check,
  ClipboardCheck,
  Layers,
  MapPin,
  Paperclip,
  Pencil,
  RotateCcw,
  Trash2,
  TrendingUp,
  Tv,
  X,
} from 'lucide-react';
import { useMediaEnrich } from '../library/enrich';
import { isActive } from '../library/progress';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { incomeColors, kindMeta, seriesColors } from '../composer/kinds';
import { entryFacts, isSeries, longDate, mediaSpecs, signedAmount } from '../lib/entries';
import { shortDate, todayInputValue } from '../lib/format';
import { daysBetween } from '../lib/people';
import { placeOf } from '../lib/places';
import { Avatar } from '../people/Avatar';
import { RichText } from './RichText';
import { Sheet } from './Sheet';
import './entry-viewer.css';

/**
 * Ficha de un recuerdo: se lee cómodo, con sus fotos, personas, lugar y episodio. Desde aquí se
 * edita, se completa o se borra. Si navegas a otra sección (una persona, un lugar), se cierra.
 */
export function EntryViewer({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const app = useApp();
  const { workspace } = app;
  // Películas y series sin póster o sin sinopsis: se completan con TMDB al abrir la ficha.
  useMediaEnrich(entry);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onNavigate = () => close.current();
    window.addEventListener('hashchange', onNavigate);
    return () => window.removeEventListener('hashchange', onNavigate);
  }, []);
  /** Cierra la ficha y luego navega (también si ya estabas en esa sección). */
  const navigate = (to: () => void) => {
    onClose();
    to();
  };

  const meta = kindMeta[entry.kind];
  const series = isSeries(entry);
  const colors =
    entry.kind === 'Movimiento' && entry.direction === 'ingreso'
      ? incomeColors
      : series
        ? seriesColors
        : meta;
  const Icon = series ? Tv : meta.icon;
  const d = entry.details;
  const specs = mediaSpecs(entry);
  const people = workspace.people.filter((p) => entry.person_ids.includes(p.id));
  const episode = entry.episode_id
    ? workspace.episodes.find((ep) => ep.id === entry.episode_id)
    : undefined;
  const place = d.place ? placeOf(entry, workspace.places) : null;
  const facts = entryFacts(entry, workspace).filter(
    (f) => f.text !== (place?.name ?? d.place) && f.text !== d.activity,
  );

  const images = entryImages(entry);
  const cover = (entry.kind === 'Película' || entry.kind === 'Libro') && images[0];
  const photos = cover ? images.slice(1) : images;
  const firstPhoto = cover ? 1 : 0;
  const quotes = entry.kind === 'Libro' ? (d.quotes ?? []).filter(Boolean) : [];
  const names = people.flatMap((p) => [p.name, p.name.split(' ')[0]]);
  const done = entry.status === 'completado';

  // Si lo anotaste días después de que pasó, se indica.
  const happened = todayInputValue(new Date(entry.created_at));
  const noted = entry.recorded_at ? todayInputValue(new Date(entry.recorded_at)) : null;
  const notedLater = noted && daysBetween(happened, noted) >= 2;

  const wide = photos.length >= 2 || Boolean(cover);

  return (
    <Sheet
      label={entry.title || entry.kind}
      className={'ev' + (wide ? ' wide' : '')}
      yieldTo=".nx-peek, .sheet.pg"
      onRequestClose={onClose}
    >
      <div
        className="ev-wrap"
        style={{ '--c': colors.accent, '--s': colors.soft, '--k': colors.ink } as CSSProperties}
      >
        <header className="ev-head">
          <span className="ev-kind">
            <Icon size={14} /> {series ? 'Serie' : entry.kind}
          </span>
          <span className="ev-date">{longDate(entry.created_at)}</span>
          <button type="button" className="ev-x" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="ev-scroll">
          <div className={'ev-hero' + (cover ? ' with-cover' : '')}>
            {cover && (
              <button
                type="button"
                className="ev-cover"
                aria-label="Ver la imagen"
                onClick={() => app.openImages(images, 0)}
              >
                <img src={cover.medium ?? cover.url} alt="" />
              </button>
            )}
            <div className="ev-title">
              <h2 className={entry.kind === 'Pendiente' && done ? 'done' : ''}>
                {entry.title || entry.kind}
              </h2>
              {entry.kind === 'Movimiento' && (
                <strong className={'ev-amount ' + entry.direction}>{signedAmount(entry)}</strong>
              )}
              {(d.activity || d.place) && (
                <div className="ev-where">
                  {d.activity && <span>{d.activity}</span>}
                  {d.place &&
                    (place ? (
                      <button
                        type="button"
                        onClick={() => navigate(() => app.go('Lugares', place))}
                      >
                        <MapPin size={13} /> {place.name}
                      </button>
                    ) : (
                      <span>
                        <MapPin size={13} /> {d.place}
                      </span>
                    ))}
                </div>
              )}
              {facts.length > 0 && (
                <div className="ev-facts">
                  {facts.map((f) => (
                    <span key={f.text} className={f.tone}>
                      {f.text}
                    </span>
                  ))}
                </div>
              )}
              {specs.progress !== null && (
                <div className="ev-progress">
                  <b>
                    <i style={{ width: specs.progress + '%' }} />
                  </b>
                  <span>
                    Página {d.pagesRead ?? 0} de {d.pagesTotal} · {specs.progress}%
                  </span>
                </div>
              )}
              {specs.rows.length > 0 && (
                <dl className="ev-specs">
                  {specs.rows.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>

          {specs.overview && (
            <p className="ev-synopsis">
              <b>Sinopsis</b> {specs.overview}
            </p>
          )}
          {entry.body && (
            <div className="ev-body">
              <RichText text={entry.body} names={names} />
            </div>
          )}
          {entry.kind === 'Trabajo' && d.nextStep && (
            <p className="ev-note">
              <b>Siguiente paso</b> {d.nextStep}
            </p>
          )}
          {entry.kind === 'Aprendizaje' && d.apply && (
            <p className="ev-note">
              <b>Lo aplicaré</b> {d.apply}
            </p>
          )}
          {quotes.map((q, i) => (
            <blockquote className="ev-quote" key={i}>
              “{q}”
            </blockquote>
          ))}

          {photos.length > 0 && (
            <div className={'ev-photos n' + Math.min(photos.length, 3)}>
              {photos.slice(0, 6).map((img, i) => (
                <button
                  type="button"
                  key={img.url}
                  aria-label={`Ver foto ${i + 1}`}
                  onClick={() => app.openImages(images, firstPhoto + i)}
                >
                  <img src={img.medium ?? img.url} alt="" loading="lazy" />
                  {i === 5 && photos.length > 6 && <span>+{photos.length - 6}</span>}
                </button>
              ))}
            </div>
          )}

          {(people.length > 0 || episode || entry.tags.length > 0 || entry.file_path) && (
            <div className="ev-links">
              {people.length > 0 && (
                <div className="ev-row">
                  <span className="ev-label">Con</span>
                  <div className="ev-people">
                    {people.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        title={`Ver la ficha de ${p.name}`}
                        onClick={() => app.peekPerson(p)}
                      >
                        <Avatar person={p} size={24} /> {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {episode && (
                <div className="ev-row">
                  <span className="ev-label">Parte de</span>
                  <button
                    type="button"
                    className="ev-episode"
                    onClick={() => navigate(() => app.go('Episodios', episode))}
                  >
                    <Layers size={13} /> {episode.title}
                  </button>
                </div>
              )}
              {entry.tags.length > 0 && (
                <div className="ev-row">
                  <span className="ev-label">Etiquetas</span>
                  <div className="ev-tags">
                    {entry.tags.map((t) => (
                      <span key={t}>#{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {entry.file_path && (
                <div className="ev-row">
                  <span className="ev-label">Adjunto</span>
                  <button
                    type="button"
                    className="ev-episode"
                    onClick={() => app.openAttachment(entry)}
                  >
                    <Paperclip size={13} /> Abrir documento
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="ev-foot">
          <button
            type="button"
            className="ev-btn danger"
            aria-label="Eliminar recuerdo"
            title="Eliminar"
            onClick={() => app.removeEntry(entry)}
          >
            <Trash2 size={15} />
          </button>
          <span className="ev-noted">
            {notedLater && `Anotado el ${shortDate(entry.recorded_at!)}`}
          </span>
          {entry.kind === 'Encuentro' && people.length > 0 && (
            <button
              type="button"
              className="ev-btn"
              onClick={() => app.openBrief(people[0], 'despues', entry)}
            >
              <ClipboardCheck size={15} /> Cierre rápido
            </button>
          )}
          {isActive(entry) && (
            <button type="button" className="ev-btn" onClick={() => app.openProgress(entry)}>
              <TrendingUp size={15} /> Actualizar progreso
            </button>
          )}
          {entry.kind === 'Pendiente' && (
            <button type="button" className="ev-btn" onClick={() => app.toggleEntry(entry)}>
              {done ? <RotateCcw size={15} /> : <Check size={15} />}
              {done ? 'Reabrir' : 'Marcar como hecho'}
            </button>
          )}
          <button type="button" className="ev-btn main" onClick={() => app.editEntry(entry)}>
            <Pencil size={15} /> Editar
          </button>
        </footer>
      </div>
    </Sheet>
  );
}
