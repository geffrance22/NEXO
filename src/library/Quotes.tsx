import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BookMarked,
  Check,
  Copy,
  ImageDown,
  ListFilter,
  Quote,
  Search,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { LoadMore, useInfinite } from '../components/LoadMore';
import { MasonryGrid } from '../components/Masonry';
import { Sheet } from '../components/Sheet';
import type { Entry } from '../data';
import { normalizeText } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { Popover } from '../planner/BoardPopover';
import { EmptyState, toneVars } from './Collection';
import { QuoteImageSheet } from './QuoteImageSheet';
import { tones } from './shelf';

export type BookQuote = {
  key: string;
  text: string;
  book: Entry;
  index: number;
};
const quoteKey = (q: BookQuote) => q.key;

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

/** Cuántas citas hay (sin armar la lista entera, para el contador de la pestaña). */
export const countQuotes = (entries: Entry[]) =>
  entries.reduce(
    (n, e) =>
      e.kind === 'Libro' ? n + (e.details.quotes?.filter((q) => q.trim()).length ?? 0) : n,
    0,
  );

const byLine = (b: Entry) => [b.title, b.details.author].filter(Boolean).join(', ');
/** Citas por tanda: el muro crece solo al bajar. */
const PAGE = 36;

type QuoteActions = {
  copy: (q: BookQuote) => void;
  remove: (q: BookQuote) => void;
  image: (q: BookQuote) => void;
};

const coverSrc = (b: Entry) => {
  const img = entryImages(b)[0];
  return img ? (img.thumb ?? img.medium ?? img.url) : undefined;
};

/**
 * Filtro por libro: un botón «Filtro» que abre un buscador con la lista de libros (y cuántas citas
 * tiene cada uno). Se escribe para encontrarlo o se elige de la lista; con flechas y Enter también.
 */
function BookFilter({
  books,
  value,
  onChange,
}: {
  books: { book: Entry; count: number }[];
  value: Entry | null;
  onChange: (id: string | null) => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [find, setFind] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const needle = normalizeText(find.trim());
  const list = needle
    ? books.filter(({ book }) => normalizeText(byLine(book)).includes(needle))
    : books;
  const open = (el: HTMLElement) => {
    setFind('');
    setCursor(0);
    setAnchor(el.getBoundingClientRect());
  };
  const pick = (id: string | null) => {
    onChange(id);
    setAnchor(null);
  };
  const move = (d: number) => {
    if (!list.length) return;
    const next = (cursor + d + list.length) % list.length;
    setCursor(next);
    listRef.current
      ?.querySelectorAll<HTMLElement>('[role="option"]')
      [next]?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <>
      {value ? (
        <span className="lt-qf-on">
          <button
            type="button"
            className="lt-qf-chip"
            aria-haspopup="listbox"
            aria-expanded={Boolean(anchor)}
            title="Cambiar de libro"
            onClick={(e) => (anchor ? setAnchor(null) : open(e.currentTarget))}
          >
            {coverSrc(value) ? <img src={coverSrc(value)} alt="" /> : <BookMarked size={13} />}
            <span>{value.title}</span>
          </button>
          <button
            type="button"
            className="lt-qf-x"
            aria-label="Quitar filtro"
            title="Ver todas"
            onClick={() => onChange(null)}
          >
            <X size={13} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="lt-tool"
          aria-haspopup="listbox"
          aria-expanded={Boolean(anchor)}
          onClick={(e) => (anchor ? setAnchor(null) : open(e.currentTarget))}
        >
          <ListFilter size={14} /> <span>Filtro</span>
        </button>
      )}
      {anchor && (
        <Popover
          anchor={anchor}
          label="Filtrar por libro"
          width={300}
          onClose={() => setAnchor(null)}
        >
          <div className="lt-qf">
            <label className="lt-qf-find">
              <Search size={14} />
              <input
                autoFocus
                placeholder="Escribe el libro o el autor…"
                aria-label="Buscar libro"
                role="combobox"
                aria-expanded="true"
                aria-controls="lt-qf-list"
                value={find}
                onChange={(e) => {
                  setFind(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
                  else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
                  else if (e.key === 'Enter' && list[cursor]) {
                    e.preventDefault();
                    pick(list[cursor].book.id);
                  }
                }}
              />
            </label>
            <div className="lt-qf-list" id="lt-qf-list" role="listbox" ref={listRef}>
              {!needle && (
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  className="lt-qf-all"
                  onClick={() => pick(null)}
                >
                  <span>Todos los libros</span>
                  {!value && <Check size={14} />}
                </button>
              )}
              {list.map(({ book, count }, i) => (
                <button
                  type="button"
                  role="option"
                  key={book.id}
                  aria-selected={value?.id === book.id}
                  className={i === cursor && needle ? 'hot' : ''}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(book.id)}
                >
                  {coverSrc(book) ? (
                    <img src={coverSrc(book)} alt="" loading="lazy" />
                  ) : (
                    <span className="lt-qf-ph">
                      <BookMarked size={12} />
                    </span>
                  )}
                  <span className="lt-qf-text">
                    <strong>{book.title}</strong>
                    {book.details.author && <small>{book.details.author}</small>}
                  </span>
                  <i>{count}</i>
                </button>
              ))}
              {!list.length && <p className="lt-qf-none">Ningún libro coincide.</p>}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

/** Una cita del muro. Memorizada: cargar otra tanda no vuelve a pintar las que ya están. */
const QuoteCard = memo(function QuoteCard({ q, act }: { q: BookQuote; act: QuoteActions }) {
  const { viewEntry } = useApp();
  const cover = entryImages(q.book)[0];
  return (
    <figure className="lt-quote">
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
            aria-label="Convertir en imagen"
            title="Convertir en imagen"
            onClick={() => act.image(q)}
          >
            <ImageDown size={13} />
          </button>
          <button type="button" aria-label="Copiar" title="Copiar" onClick={() => act.copy(q)}>
            <Copy size={13} />
          </button>
          <button
            type="button"
            aria-label="Eliminar cita"
            title="Eliminar"
            onClick={() => act.remove(q)}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </figcaption>
    </figure>
  );
});

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
  // Texto de búsqueda de cada cita, calculado una vez por lista y no en cada tecla.
  const haystack = useMemo(
    () => new Map(all.map((q) => [q.key, normalizeText(q.text + ' ' + byLine(q.book))])),
    [all],
  );
  const [spot, setSpot] = useState<string | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [imaging, setImaging] = useState<BookQuote | null>(null);
  const latest = useRef(workspace.entries);
  latest.current = workspace.entries;

  // Libros con citas (para el filtro): los de más citas primero.
  const bookList = useMemo(() => {
    const by = new Map<string, { book: Entry; count: number }>();
    for (const q of all) {
      const it = by.get(q.book.id);
      if (it) it.count++;
      else by.set(q.book.id, { book: q.book, count: 1 });
    }
    return [...by.values()].sort(
      (a, b) =>
        b.count - a.count ||
        a.book.title.localeCompare(b.book.title, 'es', { sensitivity: 'base' }),
    );
  }, [all]);
  const filterBook = bookId ? (bookList.find((b) => b.book.id === bookId)?.book ?? null) : null;
  const base = useMemo(
    () => (filterBook ? all.filter((q) => q.book.id === filterBook.id) : all),
    [all, filterBook],
  );

  const needle = normalizeText(query.trim());
  const shown = useMemo(
    () => (needle ? base.filter((q) => haystack.get(q.key)?.includes(needle)) : base),
    [base, haystack, needle],
  );
  const pager = useInfinite(shown, PAGE, needle + '|' + (filterBook?.id ?? ''));
  const featured = spot ? all.find((q) => q.key === spot) : undefined;

  const shuffle = () => {
    const pool = base.filter((q) => q.key !== spot);
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
      details: {
        ...q.book.details,
        quotes: quotes.filter((_, i) => i !== q.index),
      },
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

  // Acciones estables para que las tarjetas memorizadas no se repinten en cada render.
  const handlers = useRef<QuoteActions>({
    copy,
    remove: (q) => void remove(q),
    image: setImaging,
  });
  handlers.current = { copy, remove: (q) => void remove(q), image: setImaging };
  const act = useMemo<QuoteActions>(
    () => ({
      copy: (q) => handlers.current.copy(q),
      remove: (q) => handlers.current.remove(q),
      image: (q) => handlers.current.image(q),
    }),
    [],
  );

  const books = bookList.length;

  return (
    <div style={toneVars(tones.citas)}>
      <div className="lt-toolbar">
        {lead ?? (
          <p className="lt-summary">
            {filterBook ? (
              <>
                {base.length} {base.length === 1 ? 'cita' : 'citas'} de «{filterBook.title}»
              </>
            ) : (
              <>
                {all.length} {all.length === 1 ? 'cita' : 'citas'} de {books}{' '}
                {books === 1 ? 'libro' : 'libros'}
              </>
            )}
          </p>
        )}
        {all.length > 1 && (
          <div className="lt-toolbar-end">
            {books > 1 && <BookFilter books={bookList} value={filterBook} onChange={setBookId} />}
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
          <button
            type="button"
            className="lt-spot-x lt-spot-img"
            aria-label="Convertir en imagen"
            title="Convertir en imagen"
            onClick={() => setImaging(featured)}
          >
            <ImageDown size={15} />
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
        <>
          <MasonryGrid
            className="lt-quotes"
            items={pager.visible}
            itemKey={quoteKey}
            render={(q) => <QuoteCard q={q} act={act} />}
            min={260}
            max={3}
            gap={14}
          />
          <LoadMore rest={pager.rest} onMore={pager.loadMore} shown={pager.visible.length} />
        </>
      ) : all.length ? (
        <p className="lt-none">
          {needle
            ? `Ninguna cita dice «${query.trim()}»${filterBook ? ` en «${filterBook.title}»` : ''}.`
            : 'Ninguna cita en este libro.'}
        </p>
      ) : null}
      {imaging && <QuoteImageSheet quote={imaging} onClose={() => setImaging(null)} />}
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
      details: {
        ...book.details,
        quotes: [...(book.details.quotes ?? []), text.trim()],
      },
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
