import { memo, useMemo, useState, type CSSProperties } from 'react';
import { Check, Highlighter, Pin, RefreshCw } from 'lucide-react';
import type { Card } from './library';
import { preview } from './media';

/** Lo que se puede hacer con una tarjeta. Debe ser estable (no cambiar entre renders). */
export type RowActions = {
  open: (card: Card) => void;
  pin: (card: Card) => void;
  refetch: (card: Card) => void;
};

const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/**
 * Una tarjeta de la lista de Lecturas. Solo se vuelve a pintar si cambia algo suyo: escribir,
 * seleccionar texto o desplazarte en el lector no toca la lista.
 */
export const ReadingRow = memo(function ReadingRow({
  card: a,
  current,
  pct,
  lastPinned,
  reloading,
  actions,
}: {
  card: Card;
  current: boolean;
  /** Porcentaje leído (0 si no lo has empezado). */
  pct: number;
  /** El último de los fijados: lo separa del resto. */
  lastPinned: boolean;
  reloading: boolean;
  actions: RowActions;
}) {
  // Portada que no cargó: se oculta (y vuelve a intentarse si cambia, p. ej. al volver a descargar).
  const [broken, setBroken] = useState('');
  const thumb = Boolean(a.cover) && a.cover !== broken;
  const excerpt = useMemo(() => preview(a.excerpt || '').slice(0, 160), [a.excerpt]);
  const domain = useMemo(() => host(a.url), [a.url]);
  const done = Boolean(a.read_at);
  const full = done || pct >= 95;
  return (
    <div
      className={
        'rd-row' +
        (a.pinned_at ? ' pinned' : '') +
        (lastPinned ? ' last-pinned' : '') +
        (thumb ? ' has-thumb' : '') +
        (reloading ? ' refetching' : '')
      }
      aria-busy={reloading || undefined}
    >
      <button
        className={'read-row' + (current ? ' current' : '') + (done ? ' read' : '')}
        onClick={() => actions.open(a)}
      >
        {pct > 0 && (
          <i
            className={'rd-progress' + (full ? ' done' : '')}
            style={{ '--p': Math.max(4, pct) } as CSSProperties}
            title={done ? 'Completado' : full ? 'Leído' : `Llevas el ${pct}%`}
            aria-label={done ? 'Completado' : full ? 'Leído' : `Leído al ${pct}%`}
          />
        )}
        {thumb && (
          <img
            className="rd-thumb"
            alt=""
            width={66}
            height={72}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setBroken(a.cover ?? '')}
            src={a.cover!}
          />
        )}
        <strong>{a.title}</strong>
        <small className="rd-cardmeta">
          <span className="rd-domain">{domain}</span>
          <span className="rd-minutes" title="Tiempo estimado de lectura">
            {a.minutes} min
          </span>
          {a.mark_count > 0 && (
            <span className="rd-count" title="Resaltados">
              <Highlighter size={12} /> {a.mark_count}
            </span>
          )}
          {done && (
            <span className="rd-readmark" title="Completado">
              <Check size={12} strokeWidth={2.6} />
            </span>
          )}
        </small>
        <span className="rd-preview">{excerpt}</span>
      </button>
      <button
        type="button"
        className="rd-pin"
        aria-pressed={Boolean(a.pinned_at)}
        title={a.pinned_at ? 'Desfijar' : 'Fijar arriba'}
        aria-label={a.pinned_at ? `Desfijar «${a.title}»` : `Fijar «${a.title}» arriba`}
        onClick={() => actions.pin(a)}
      >
        <Pin size={14} fill={a.pinned_at ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        className="rd-refetch"
        disabled={reloading}
        title={reloading ? 'Descargando de nuevo…' : 'Volver a descargar'}
        aria-label={
          reloading ? `Descargando de nuevo «${a.title}»` : `Volver a descargar «${a.title}»`
        }
        onClick={() => actions.refetch(a)}
      >
        <RefreshCw size={13} className={reloading ? 'spin' : undefined} />
      </button>
    </div>
  );
});
