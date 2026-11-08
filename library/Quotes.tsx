import { useMemo, useRef, useState, type ReactNode } from 'react';
import { BookMarked, Copy, Quote, Search, Shuffle, Trash2, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import type { Entry } from '../data';
import { normalizeText } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { EmptyState, toneVars } from './Collection';
import { tones } from './shelf';

export type BookQuote = { key: string; text: string; book: Entry; index: number };

/** Todas las frases guardadas en tus libros, de la más reciente a la más antigua. */
export function quotesOf(entries: Entry[]): BookQuote[] {
  return entries
    .filter((e) => e.kind === 'Libro')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .flatMap((book) =>
      (book.details.quotes ?? [])
        .map((q, index) => ({
          key: book.id + ':' + index,
          text: q.trim(),
          book,
          index,
        }))
        .reverse(),
    )
    .filter((q) => q.text);
}

const byLine = (b: Entry) => [b.title, b.details.author].filter(Boolean).join(', ');

/** Muro de citas: todas las frases de tus libros, con buscador y una al azar. */
export function QuoteWall({
  query,
  onAdd,
  lead,
}: {
  query: string;
  onAdd: () => void;
  /** Lo que va a la izquierda de la barra (los estantes de Libros). */
  lead?: ReactNode;
}) {
  const { workspace, viewEntry, patchEntry, notify } = useApp();
  const all = useMemo(() => quotesOf(workspace.entries), [workspace.entries]);
  const [spot, setSpot] = useState<string | null>(null);
  const latest = useRef(workspace.entries);
  latest.current = workspace.entries;

  const needle = normalizeText(query.trim());
  const shown = needle
    ? all.filter((q) => normalizeText(q.text + ' ' + byLine(q.book)).includes(needle))
    : all;
  const featured = spot ? all.find((q) => q.key === spot) : undefined;

  const shuffle = () => {
    const pool = all.filter((q) => q.key !== spot);
    if (pool.length) setSpot(pool[Math.floor(Math.random() * pool.length)].key);
  };
  const copy = (q: BookQuote) =>
    void navigator.clipboard
      .writeText(`“${q.text}” — ${byLine(q.book)}`)
      .then(() => notify('Cita copiada.'))
      .catch(() => notify('No se pudo copiar.'));
  // Sin preguntar: el aviso trae «Deshacer».
  const remove = async (q: BookQuote) => {
    const quotes = q.book.details.quotes ?? [];
    const saved = await patchEntry(q.book, {
      details: { ...q.book.details, quotes: quotes.filter((_, i) => i !== q.index) },
    });
    if (spot === q.key) setSpot(null);
    if (saved)
      notify('Cita eliminada.', {
        label: 'Deshacer',
        icon: 'undo',
        run: () => {
          const book = latest.current.find((e) => e.id === q.book.id);
          if (!book) return;
          const now = [...(book.details.quotes ?? [])];
          now.splice(Math.min(q.index, now.length), 0, q.text);
          void patchEntry(book, { details: { ...book.details, quotes: now } });
        },
      });
  };

  const books = new Set(all.map((q) => q.book.id)).size;

  return (
    <div style={toneVars(tones.citas)}>
      <div className="lt-toolbar">
        {lead ?? (
          <p className="lt-summary">
            {all.length} {all.length === 1 ? 'cita' : 'citas'} de {books}{' '}
            {books === 1 ? 'libro' : 'libros'}
          </p>
        )}
        {all.length > 1 && (
          <div className="lt-toolbar-end">
            <button type="button" className="lt-tool" onClick={shuffle}>
              <Shuffle size={14} /> <span>{featured ? 'Otra al azar' : 'Una al azar'}</span>
            </button>
          </div>
        )}
      </div>

      {!all.length && (
        <EmptyState
          icon={Quote}
          title="Las frases que guardes en tus libros se reúnen aquí."
          action={{ label: 'Añadir una cita', run: onAdd }}
        />
      )}

      {featured && (
        <figure className="lt-spot">
          <button
            type="button"
            className="lt-spot-x"
            aria-label="Cerrar"
            onClick={() => setSpot(null)}
          >
            <X size={15} />
          </button>
          <Quote size={22} />
          <blockquote>{featured.text}</blockquote>
          <figcaption>
            <button type="button" onClick={() => viewEntry(featured.book)}>
              — {byLine(featured.book)}
            </button>
          </figcaption>
        </figure>
      )}

      {shown.length ? (
        <div className="lt-quotes">
          {shown.map((q) => {
            const cover = entryImages(q.book)[0];
            return (
              <figure key={q.key} className="lt-quote">
                <blockquote>{q.text}</blockquote>
                <figcaption>
                  <button type="button" className="lt-quote-book" onClick={() => viewEntry(q.book)}>
                    {cover ? (
                      <img src={cover.thumb ?? cover.medium ?? cover.url} alt="" loading="lazy" />
                    ) : (
                      <span>
                        <BookMarked size={12} />
                      </span>
                    )}
                    <span>
                      <strong>{q.book.title}</strong>
                      {q.book.details.author && <small>{q.book.details.author}</small>}
                    </span>
                  </button>
                  <span className="lt-quote-tools">
                    <button
                      type="button"
                      aria-label="Copiar"
                      title="Copiar"
                      onClick={() => copy(q)}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label="Eliminar cita"
                      title="Eliminar"
                      onClick={() => void remove(q)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : all.length ? (
        <p className="lt-none">Ninguna cita dice «{query.trim()}».</p>
      ) : null}
    </div>
  );
}

/** Ventana para guardar una cita en uno de tus libros. */
export function QuoteSheet({ onClose }: { onClose: () => void }) {
  const { workspace, patchEntry, notify, openEntry } = useApp();
  const books = useMemo(
    () =>
      workspace.entries
        .filter((e) => e.kind === 'Libro')
        // Primero lo que estás leyendo, luego lo más reciente.
        .sort(
          (a, b) =>
            Number(b.details.read === 'leyendo') - Number(a.details.read === 'leyendo') ||
            b.created_at.localeCompare(a.created_at),
        ),
    [workspace.entries],
  );
  const [text, setText] = useState('');
  const [bookId, setBookId] = useState(books[0]?.id ?? '');
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const needle = normalizeText(find.trim());
  const list = needle
    ? books.filter((b) => normalizeText(byLine(b)).includes(needle))
    : books.slice(0, 30);
  const book = books.find((b) => b.id === bookId);

  async function save() {
    if (!book || !text.trim() || busy) return;
    setBusy(true);
    const ok = await patchEntry(book, {
      details: { ...book.details, quotes: [...(book.details.quotes ?? []), text.trim()] },
    });
    setBusy(false);
    if (!ok) return;
    notify(`Cita guardada en «${book.title}».`);
    onClose();
  }

  return (
    <Sheet label="Nueva cita" className="lt-qs" onRequestClose={onClose}>
      <header className="lt-qs-head">
        <h2>
          <Quote size={17} /> Nueva cita
        </h2>
        <button type="button" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {!books.length ? (
        <div className="lt-qs-body">
          <p className="lt-qs-hint">Las citas se guardan en un libro. Primero añade uno.</p>
          <button
            type="button"
            className="lt-add"
            onClick={() => {
              onClose();
              openEntry('Libro');
            }}
          >
            Añadir un libro
          </button>
        </div>
      ) : (
        <>
          <div className="lt-qs-body">
            <textarea
              autoFocus
              className="lt-qs-text"
              rows={4}
              maxLength={2000}
              placeholder="Escribe la frase…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
              }}
            />
            <span className="lt-qs-label">De qué libro</span>
            {books.length > 6 && (
              <label className="lt-qs-find">
                <Search size={14} />
                <input
                  placeholder="Buscar libro…"
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                />
              </label>
            )}
            <div className="lt-qs-books" role="radiogroup" aria-label="Libro">
              {list.map((b) => {
                const cover = entryImages(b)[0];
                return (
                  <button
                    type="button"
                    role="radio"
                    key={b.id}
                    aria-checked={b.id === bookId}
                    className={b.id === bookId ? 'on' : ''}
                    onClick={() => setBookId(b.id)}
                  >
                    {cover ? (
                      <img src={cover.thumb ?? cover.medium ?? cover.url} alt="" />
                    ) : (
                      <span>
                        <BookMarked size={13} />
                      </span>
                    )}
                    <span>
                      <strong>{b.title}</strong>
                      {b.details.author && <small>{b.details.author}</small>}
                    </span>
                  </button>
                );
              })}
              {!list.length && <p className="lt-qs-hint">Ningún libro coincide.</p>}
            </div>
          </div>
          <footer className="lt-qs-foot">
            <button type="button" className="lt-tool" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="lt-add"
              disabled={!book || !text.trim() || busy}
              onClick={() => void save()}
            >
              Guardar cita
            </button>
          </footer>
        </>
      )}
    </Sheet>
  );
}
