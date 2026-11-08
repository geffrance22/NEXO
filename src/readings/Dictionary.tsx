import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookA,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe,
  Layers,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { normalizeText, shortDate } from '../lib/format';
import { cleanTerm, wordKey, WORDS_SQL, type Word, type WordsApi } from './words';
import './dictionary.css';

type Filter = 'pending' | 'learned' | 'all';

/** La frase de contexto con el término resaltado. */
function Context({ text, term }: { text: string; term: string }) {
  if (!text) return null;
  const hay = normalizeText(text);
  const needle = normalizeText(term);
  const at = needle ? hay.indexOf(needle) : -1;
  // normalizeText conserva las posiciones en el texto latino habitual.
  const ok = at >= 0 && hay.length === text.length;
  return (
    <q className="dc-context">
      {ok ? (
        <>
          {text.slice(0, at)}
          <mark>{text.slice(at, at + needle.length)}</mark>
          {text.slice(at + needle.length)}
        </>
      ) : (
        text
      )}
    </q>
  );
}

const lookUp = (term: string) =>
  'https://www.google.com/search?q=' + encodeURIComponent(`qué es ${term}`);

/**
 * Diccionario de Lecturas: palabras y conceptos por aprender, guardados desde los artículos.
 * Se consultan en lista o uno a uno, y se tachan o se borran al aprenderlos.
 */
export function Dictionary({
  api,
  open,
  back,
}: {
  api: WordsApi;
  /** Abre el artículo de donde salió una palabra. */
  open: (readingId: string) => void;
  back: () => void;
}) {
  const { words, state, add, toggleLearned, remove } = api;
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  // Repaso uno a uno: la baraja (por término, que es único) se fija al empezar; tachar no la
  // reordena.
  const [deck, setDeck] = useState<string[] | null>(null);
  const [at, setAt] = useState(0);

  const pending = words.filter((w) => !w.learned_at).length;
  const learned = words.length - pending;
  const needle = normalizeText(query.trim());
  const shown = useMemo(
    () =>
      words.filter(
        (w) =>
          (filter === 'all' || (filter === 'learned' ? w.learned_at : !w.learned_at)) &&
          (!needle ||
            normalizeText(`${w.term} ${w.note} ${w.context} ${w.source}`).includes(needle)),
      ),
    [words, filter, needle],
  );

  const study = (list: Word[], start = 0) => {
    if (!list.length) return;
    setDeck(list.map((w) => wordKey(w.term)));
    setAt(Math.min(Math.max(0, start), list.length - 1));
  };
  // Las que se borran durante el repaso salen de la baraja.
  const byKey = useMemo(() => new Map(words.map((w) => [wordKey(w.term), w])), [words]);
  const cards = (deck ?? []).map((k) => byKey.get(k)).filter((w): w is Word => Boolean(w));
  useEffect(() => {
    if (deck && !cards.length) setDeck(null);
    else if (deck && at > cards.length - 1) setAt(cards.length - 1);
  }, [deck, cards.length, at]);

  const submit = () => {
    const term = cleanTerm(draft);
    if (!term) return;
    const exists = words.find((w) => wordKey(w.term) === wordKey(term));
    if (exists) {
      setQuery(exists.term);
      setFilter(exists.learned_at ? 'learned' : 'pending');
    } else add({ term });
    setDraft('');
  };

  if (deck && cards.length) {
    return (
      <Study cards={cards} at={at} setAt={setAt} exit={() => setDeck(null)} api={api} open={open} />
    );
  }

  return (
    <section className="dc" aria-label="Diccionario">
      <header className="dc-head">
        <span className="dc-mark" aria-hidden="true">
          <BookA size={19} />
        </span>
        <div className="dc-title">
          <h2>Diccionario</h2>
          <small>
            {state === 'ready'
              ? words.length
                ? `${pending} por aprender · ${learned} ${learned === 1 ? 'aprendida' : 'aprendidas'}`
                : 'Palabras y conceptos por aprender'
              : state === 'loading'
                ? 'Cargando…'
                : 'Palabras y conceptos por aprender'}
          </small>
        </div>
        {pending > 0 && (
          <button
            type="button"
            className="dc-btn primary"
            onClick={() =>
              study(
                filter === 'pending' && shown.length ? shown : words.filter((w) => !w.learned_at),
              )
            }
          >
            <Layers size={15} /> Repasar uno a uno
          </button>
        )}
        <button
          type="button"
          className="dc-icon"
          title="Volver a Lecturas"
          aria-label="Cerrar el diccionario"
          onClick={back}
        >
          <X size={18} />
        </button>
      </header>

      {state === 'missing' ? (
        <div className="dc-empty">
          <BookA size={26} />
          <strong>Falta preparar el diccionario</strong>
          <p>
            Ejecuta <code>{WORDS_SQL}</code> en el SQL Editor de Supabase y vuelve a abrir Lecturas.
          </p>
        </div>
      ) : state === 'error' ? (
        <div className="dc-empty">
          <BookA size={26} />
          <strong>No se pudo cargar el diccionario</strong>
          <p>Revisa tu conexión y vuelve a abrir Lecturas.</p>
        </div>
      ) : (
        <>
          <form
            className="dc-add"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Plus size={16} aria-hidden="true" />
            <input
              value={draft}
              maxLength={200}
              placeholder="Añadir una palabra o un concepto…"
              aria-label="Nueva palabra o concepto"
              onChange={(e) => setDraft(e.target.value)}
            />
            {draft.trim() && (
              <button type="submit" className="dc-btn sm primary">
                Añadir
              </button>
            )}
          </form>

          {words.length > 0 && (
            <div className="dc-tools">
              <div className="dc-tabs" role="tablist" aria-label="Filtrar">
                {(
                  [
                    ['pending', 'Por aprender', pending],
                    ['learned', 'Aprendidas', learned],
                    ['all', 'Todas', words.length],
                  ] as const
                ).map(([key, label, n]) => (
                  <button
                    type="button"
                    role="tab"
                    key={key}
                    aria-selected={filter === key}
                    className={filter === key ? 'on' : ''}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                    <b>{n}</b>
                  </button>
                ))}
              </div>
              {words.length > 6 && (
                <label className="dc-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    value={query}
                    placeholder="Buscar…"
                    aria-label="Buscar en el diccionario"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="Borrar la búsqueda"
                      onClick={() => setQuery('')}
                    >
                      <X size={13} />
                    </button>
                  )}
                </label>
              )}
            </div>
          )}

          {state === 'loading' ? (
            <div className="dc-skel" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          ) : !words.length ? (
            <div className="dc-empty">
              <BookA size={26} />
              <strong>Tu diccionario está vacío</strong>
              <p>
                Selecciona una palabra o un concepto en un artículo y toca{' '}
                <span className="dc-chip">
                  <BookA size={13} /> Diccionario
                </span>{' '}
                en la barra. Se guarda con la frase donde apareció.
              </p>
            </div>
          ) : !shown.length ? (
            <p className="dc-none">
              {needle
                ? `Nada coincide con «${query.trim()}».`
                : filter === 'pending'
                  ? '¡Aprendiste todo! No queda nada por aprender.'
                  : 'Aún no tachas ninguna.'}
            </p>
          ) : (
            <ul className="dc-list">
              {shown.map((w) => (
                <li key={w.id} className={'dc-item' + (w.learned_at ? ' learned' : '')}>
                  <button
                    type="button"
                    className="dc-check"
                    role="checkbox"
                    aria-checked={Boolean(w.learned_at)}
                    title={w.learned_at ? 'Volver a «por aprender»' : 'Tachar: ya la aprendí'}
                    onClick={() => toggleLearned(w)}
                  >
                    <Check size={13} strokeWidth={3} />
                  </button>
                  <button
                    type="button"
                    className="dc-main"
                    title="Ver una a una"
                    onClick={() => study(shown, shown.indexOf(w))}
                  >
                    <span className="dc-term">{w.term}</span>
                    <Context text={w.context} term={w.term} />
                    {w.note && <span className="dc-note">{w.note}</span>}
                    <small className="dc-meta">
                      {w.source && <span>{w.source}</span>}
                      <span>{shortDate(w.created_at)}</span>
                    </small>
                  </button>
                  <div className="dc-acts">
                    {w.reading_id && (
                      <button
                        type="button"
                        className="dc-icon sm"
                        title="Abrir el artículo"
                        aria-label="Abrir el artículo"
                        onClick={() => open(w.reading_id!)}
                      >
                        <ArrowUpRight size={15} />
                      </button>
                    )}
                    <a
                      className="dc-icon sm"
                      href={lookUp(w.term)}
                      target="_blank"
                      rel="noreferrer"
                      title="Buscar en la web"
                      aria-label="Buscar en la web"
                    >
                      <Globe size={15} />
                    </a>
                    <button
                      type="button"
                      className="dc-icon sm danger"
                      title="Eliminar"
                      aria-label={`Eliminar «${w.term}»`}
                      onClick={() => remove(w)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Repaso uno a uno: el término, su frase, tu nota, y tacharlo o borrarlo. */
function Study({
  cards,
  at,
  setAt,
  exit,
  api,
  open,
}: {
  cards: Word[];
  at: number;
  setAt: (fn: (n: number) => number) => void;
  exit: () => void;
  api: WordsApi;
  open: (readingId: string) => void;
}) {
  const w = cards[Math.max(0, Math.min(at, cards.length - 1))];
  const [note, setNote] = useState(w.note);
  const editing = useRef(false);
  const advance = useRef<number | undefined>(undefined);
  useEffect(() => {
    setNote(w.note);
  }, [w.id, w.note]);
  useEffect(() => () => window.clearTimeout(advance.current), []);

  const saveNote = () => {
    editing.current = false;
    const next = note.trim().slice(0, 4000);
    if (next !== w.note) api.update(w, { note: next });
  };
  const go = (d: number) => setAt((n) => Math.max(0, Math.min(cards.length - 1, n + d)));
  const learnedCount = cards.filter((c) => c.learned_at).length;
  const live = useRef({ go, exit });
  live.current = { go, exit };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || editing.current) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      if (document.querySelector('.confirm-backdrop, .sheet-backdrop, .nx-peek')) return;
      if (e.key === 'ArrowRight') live.current.go(1);
      else if (e.key === 'ArrowLeft') live.current.go(-1);
      else if (e.key === 'Escape') live.current.exit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const learn = () => {
    const was = Boolean(w.learned_at);
    api.toggleLearned(w);
    // Al tacharla pasa sola a la siguiente.
    window.clearTimeout(advance.current);
    if (!was && at < cards.length - 1) advance.current = window.setTimeout(() => go(1), 450);
  };

  return (
    <section className="dc dc-study" aria-label="Repaso del diccionario">
      <header className="dc-study-head">
        <button type="button" className="dc-btn ghost" onClick={exit}>
          <ArrowLeft size={15} /> Lista
        </button>
        <span className="dc-count">
          {at + 1} de {cards.length}
        </span>
        <span className="dc-progress" title={`${learnedCount} de ${cards.length} aprendidas`}>
          <i style={{ width: `${(100 * learnedCount) / cards.length}%` }} />
        </span>
      </header>

      <div key={w.id} className={'dc-card' + (w.learned_at ? ' learned' : '')}>
        {w.learned_at && (
          <span className="dc-stamp">
            <Check size={13} strokeWidth={3} /> Aprendida
          </span>
        )}
        <h3 className="dc-big">{w.term}</h3>
        <Context text={w.context} term={w.term} />
        {(w.source || w.reading_id) && (
          <p className="dc-from">
            De{' '}
            {w.reading_id ? (
              <button type="button" onClick={() => open(w.reading_id!)}>
                «{w.source || 'el artículo'}» <ArrowUpRight size={13} />
              </button>
            ) : (
              <span>«{w.source}»</span>
            )}{' '}
            · {shortDate(w.created_at)}
          </p>
        )}
        <label className="dc-notebox">
          <span>Qué significa para ti</span>
          <textarea
            value={note}
            rows={3}
            maxLength={4000}
            placeholder="Escríbelo con tus palabras para fijarlo…"
            onFocus={() => (editing.current = true)}
            onBlur={saveNote}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
          />
        </label>
        <div className="dc-card-links">
          <a href={lookUp(w.term)} target="_blank" rel="noreferrer">
            <Globe size={13} /> Buscar en la web
          </a>
          <button type="button" className="danger" onClick={() => api.remove(w)}>
            <Trash2 size={13} /> Eliminar
          </button>
        </div>
      </div>

      <footer className="dc-study-foot">
        <button
          type="button"
          className="dc-icon lg"
          aria-label="Anterior"
          title="Anterior (←)"
          disabled={at === 0}
          onClick={() => go(-1)}
        >
          <ChevronLeft size={20} />
        </button>
        <button
          type="button"
          className={'dc-btn learn' + (w.learned_at ? ' undo' : '')}
          onClick={learn}
        >
          {w.learned_at ? (
            <>
              <RotateCcw size={15} /> Volver a «por aprender»
            </>
          ) : (
            <>
              <Check size={16} strokeWidth={2.6} /> Ya la aprendí
            </>
          )}
        </button>
        <button
          type="button"
          className="dc-icon lg"
          aria-label="Siguiente"
          title="Siguiente (→)"
          disabled={at >= cards.length - 1}
          onClick={() => go(1)}
        >
          <ChevronRight size={20} />
        </button>
      </footer>
      {at === cards.length - 1 && learnedCount === cards.length && (
        <p className="dc-done">Terminaste el repaso: las tachaste todas.</p>
      )}
    </section>
  );
}
