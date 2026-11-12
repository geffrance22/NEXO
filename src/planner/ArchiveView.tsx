import { useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Check, ChevronDown, Search, Trash2, X } from 'lucide-react';
import { normalizeText, shortDate } from '../lib/format';
import { CardFace } from './BoardCard';
import { BOARD_SQL, type BoardCard } from './boardStore';

/** Se pintan de a tantas (con «Ver más»): así miles de archivadas no traban la pantalla. */
const PAGE = 300;

/**
 * Archivados: las tarjetas que archivaste, de todos tus tableros, en una lista (la más reciente
 * arriba), sin tope. Al pasar el cursor: desarchivar o eliminar. Un clic abre su ficha.
 */
export function ArchiveView({
  cards,
  missing,
  loading = false,
  query,
  isDone,
  linked,
  onOpen,
  onUnarchive,
  onDelete,
  onQuery,
  onClose,
}: {
  cards: BoardCard[] | null;
  missing: boolean;
  /** Aún llegan más. */
  loading?: boolean;
  query: string;
  isDone: (c: BoardCard) => boolean;
  linked: (c: BoardCard) => boolean;
  onOpen: (c: BoardCard) => void;
  onUnarchive: (c: BoardCard) => void;
  onDelete: (c: BoardCard) => void;
  /** Con buscador propio (cuando se abre encima del tablero). */
  onQuery?: (q: string) => void;
  /** Con X para cerrar y volver al tablero. */
  onClose?: () => void;
}) {
  const needle = normalizeText(query.trim());
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [needle]);
  const shown = useMemo(
    () =>
      (cards ?? []).filter(
        (c) =>
          !needle ||
          normalizeText(
            `${c.title} ${c.body} ${c.tags.join(' ')} ${c.board_name ?? ''} ${c.list_name ?? ''}`,
          ).includes(needle),
      ),
    [cards, needle],
  );
  const page = shown.slice(0, limit);

  return (
    <div className="bd-archive">
      <div className="bd-archive-in">
        <header className="bd-archive-head">
          <span className="bd-archive-mark" aria-hidden="true">
            <Archive size={18} />
          </span>
          <div>
            <h2>Archivados</h2>
            <small>
              {cards === null
                ? 'Cargando…'
                : cards.length
                  ? `${cards.length.toLocaleString('es-CO')}${loading ? '+' : ''} ${cards.length === 1 ? 'tarjeta' : 'tarjetas'} de todos tus tableros${loading ? ' · cargando el resto…' : ''}`
                  : 'Lo que archives aparece aquí'}
            </small>
          </div>
          {(onQuery || onClose) && (
            <div className="bd-archive-tools">
              {onQuery && (
                <label className="bd-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    value={query}
                    placeholder="Buscar en archivados…"
                    aria-label="Buscar en archivados"
                    onChange={(e) => onQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && query) {
                        e.stopPropagation();
                        onQuery('');
                      }
                    }}
                  />
                  {query && (
                    <button type="button" aria-label="Borrar la búsqueda" onClick={() => onQuery('')}>
                      <X size={13} />
                    </button>
                  )}
                </label>
              )}
              {onClose && (
                <button
                  type="button"
                  className="bd-icon bd-archive-close"
                  aria-label="Cerrar archivados"
                  title="Cerrar (Esc)"
                  onClick={onClose}
                >
                  <X size={18} />
                </button>
              )}
            </div>
          )}
        </header>

        {missing ? (
          <div className="bd-archive-empty">
            <Archive size={24} />
            <strong>Falta preparar Archivados</strong>
            <p>
              Ejecuta <code>{BOARD_SQL}</code> en el SQL Editor de Supabase.
            </p>
          </div>
        ) : cards === null ? (
          <div className="bd-archive-skel" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        ) : !cards.length ? (
          <div className="bd-archive-empty">
            <Archive size={24} />
            <strong>Nada archivado todavía</strong>
            <p>
              Completa una tarjeta y, al pasar el cursor, toca <Archive size={13} /> para sacarla de
              la columna sin perderla.
            </p>
          </div>
        ) : !shown.length ? (
          <p className="bd-archive-none">Nada coincide con «{query.trim()}».</p>
        ) : (
          <>
          <ul className="bd-archive-list">
            {page.map((c) => {
              const done = isDone(c);
              return (
                <li key={c.id} data-flip={'a:' + c.id}>
                  <div
                    className={'bd-arow' + (done ? ' done' : '')}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(c)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(c);
                    }}
                  >
                    <span className={'bd-arow-check' + (done ? ' on' : '')} aria-hidden="true">
                      <Check size={11} strokeWidth={3.2} />
                    </span>
                    <div className="bd-arow-main">
                      <CardFace card={c} done={done} linkedTask={linked(c)} />
                      <small className="bd-arow-meta">
                        {c.board_name && <span>{c.board_name}</span>}
                        {c.list_name && <span>{c.list_name}</span>}
                        {c.archived_at && <span>Archivada el {shortDate(c.archived_at)}</span>}
                      </small>
                    </div>
                    <div className="bd-arow-acts">
                      <button
                        type="button"
                        title="Desarchivar: vuelve a su columna"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUnarchive(c);
                        }}
                      >
                        <ArchiveRestore size={15} /> <span>Desarchivar</span>
                      </button>
                      <button
                        type="button"
                        className="danger"
                        title="Eliminar"
                        aria-label="Eliminar la tarjeta"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(c);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {shown.length > page.length && (
            <button
              type="button"
              className="bd-archive-more"
              onClick={() => setLimit((n) => n + PAGE)}
            >
              <ChevronDown size={15} /> Ver {Math.min(PAGE, shown.length - page.length)} más
              <small>
                {page.length.toLocaleString('es-CO')} de {shown.length.toLocaleString('es-CO')}
              </small>
            </button>
          )}
          </>
        )}
      </div>
    </div>
  );
}
