import { useEffect, useMemo, useRef, useState } from 'react';
import { Feather, LoaderCircle, Puzzle, Search, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { LoadMore, useInfinite } from '../components/LoadMore';
import { Sheet } from '../components/Sheet';
import { normalizeText } from '../lib/format';
import { MyFace } from '../people/MyFace';
import { jobCount, setPiecesReview, usePieceJobs } from './analysis';
import { ThreadCard } from './Feed';
import { compactCount, threadsOf, type Thread } from './model';
import { instantsHint, useInstants } from './store';
import './instants.css';

const PAGE = 12;
/** Lo que, abierto encima, se queda con Esc. */
const ABOVE =
  '.sheet-backdrop, .confirm-backdrop, .modal-backdrop, .lightbox, .nx-peek-backdrop, .nx-peek, .nx-pop';

/** Texto en el que se busca un hilo: lo escrito y los nombres de lo que tiene vinculado. */
function useSearchable() {
  const { workspace } = useApp();
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const p of workspace.people) names.set(p.id, p.name);
    for (const p of workspace.places) names.set(p.id, p.name);
    for (const e of workspace.episodes) names.set(e.id, e.title);
    return (t: Thread) =>
      normalizeText(
        t.items
          .map((i) =>
            [i.body, ...[...i.person_ids, ...i.place_ids, ...i.episode_ids].map((id) => names.get(id) ?? '')].join(
              ' ',
            ),
          )
          .join(' '),
      );
  }, [workspace.people, workspace.places, workspace.episodes]);
}

/**
 * Tus instantes, como un feed: el más reciente arriba, hilo por hilo, con lo que nació de cada uno.
 * Se abre a la derecha encima de cualquier sección; se carga por tandas al bajar.
 */
export function InstantsPanel({ focus, onClose }: { focus?: string; onClose: () => void }) {
  const app = useApp();
  const { list, missing, error, complete } = useInstants();
  const { jobs } = usePieceJobs();
  const [query, setQuery] = useState('');
  const [closing, setClosing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const searchable = useSearchable();

  const threads = useMemo(() => threadsOf(list ?? []), [list]);
  const needle = normalizeText(query.trim());
  const shown = useMemo(
    () => (needle ? threads.filter((t) => searchable(t).includes(needle)) : threads),
    [threads, needle, searchable],
  );
  const { visible, rest, loadMore, reach } = useInfinite(shown, PAGE, needle);
  const focusThread = focus ? (list ?? []).find((i) => i.id === focus)?.thread_id : undefined;
  useEffect(() => {
    if (!focusThread) return;
    const at = shown.findIndex((t) => t.id === focusThread);
    if (at >= 0) reach(at + 1);
  }, [focusThread, shown, reach]);

  const ready = jobs.filter((j) => j.status === 'listo');
  const pieces = ready.reduce((s, j) => s + jobCount(j), 0);
  const reading = jobs.some((j) => j.status === 'analizando');

  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 180);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector(ABOVE)) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, []);

  const total = list?.length ?? 0;
  const nav = useMemo(() => ({ onLeave: onClose }), [onClose]);

  return (
    <div
      className={'ipn-layer' + (closing ? ' closing' : '')}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <aside className="ipn" role="dialog" aria-modal="true" aria-label="Instantes">
        <header className="ipn-head">
          <span className="ipn-title">
            <Feather size={17} />
            <h2>Instantes</h2>
            {total > 0 && (
              <small title={`${total.toLocaleString('es-CO')} instantes`}>
                {compactCount(total)}
              </small>
            )}
          </span>
          {(pieces > 0 || reading) && (
            <button
              type="button"
              className={'ipn-pieces' + (reading && !pieces ? ' busy' : '')}
              disabled={!pieces}
              onClick={() => setPiecesReview(true)}
              title={pieces ? 'Revisar las piezas encontradas' : 'Nexo está leyendo tus instantes'}
            >
              {reading && !pieces ? <LoaderCircle size={14} className="spin" /> : <Puzzle size={14} />}
              {pieces ? `${compactCount(pieces)} por revisar` : 'Leyendo…'}
            </button>
          )}
          <button type="button" className="ipn-x" aria-label="Cerrar" onClick={close}>
            <X size={18} />
          </button>
        </header>

        <label className="ipn-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en tus instantes, personas, lugares…"
            aria-label="Buscar en tus instantes"
          />
          {query && (
            <button type="button" aria-label="Borrar búsqueda" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </label>

        <div className="ipn-scroll" ref={scroller}>
          {!needle && (
            <button type="button" className="ipn-compose" onClick={() => app.openCapture()}>
              <span className="ic-face">
                <MyFace size={36} />
              </span>
              <span className="ipn-compose-text">¿Qué está pasando?</span>
              <kbd>P</kbd>
            </button>
          )}
          {missing && <p className="ipn-note warn">{instantsHint}</p>}
          {error && <p className="ipn-note warn">{error}</p>}
          {list === null &&
            [0, 1, 2].map((k) => (
              <div key={k} className="ipn-skel" aria-hidden="true">
                <i />
                <span>
                  <b />
                  <b />
                  <b />
                </span>
              </div>
            ))}
          {visible.map((t) => (
            <ThreadCard key={t.id} thread={t} highlight={t.id === focusThread} nav={nav} />
          ))}
          <LoadMore rest={rest} onMore={loadMore} shown={visible.length} />
          {list !== null && !shown.length && !missing && (
            <div className="ipn-empty">
              <Feather size={22} />
              {needle ? (
                <p>Nada con «{query.trim()}».</p>
              ) : (
                <>
                  <p>Aún no hay instantes.</p>
                  <small>
                    Escribe lo que pasa, tal cual. Nexo lo guarda así y, en segundo plano, arma sus
                    piezas: encuentros, gastos, pendientes, novedades…
                  </small>
                </>
              )}
            </div>
          )}
          {list !== null && !complete && !rest && (
            <p className="ipn-note">
              <LoaderCircle size={13} className="spin" /> Cargando más instantes…
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

/** Un instante (con su hilo) en su propia ventana: se abre desde las fichas que nacieron de él. */
export function InstantSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const app = useApp();
  const { list } = useInstants();
  const target = (list ?? []).find((i) => i.id === id);
  const thread = useMemo(
    () => (target ? threadsOf((list ?? []).filter((i) => i.thread_id === target.thread_id))[0] : undefined),
    [list, target],
  );
  const nav = useMemo(() => ({ onLeave: onClose, onOpen: onClose }), [onClose]);
  return (
    <Sheet
      label="Instante"
      className="ins-sheet"
      yieldTo=".xp-pk-backdrop, .nx-pop"
      onRequestClose={onClose}
    >
      <header className="ins-head">
        <span>
          <Feather size={16} /> {thread && thread.items.length > 1 ? `Hilo · ${thread.items.length}` : 'Instante'}
        </span>
        {thread && (
          <button
            type="button"
            className="ins-feed"
            onClick={() => {
              onClose();
              app.openInstants(id);
            }}
          >
            Ver en tus instantes
          </button>
        )}
        <button type="button" className="ipn-x" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="ins-body">
        {thread ? (
          <ThreadCard thread={thread} highlight={false} nav={nav} compact />
        ) : list === null ? (
          <p className="ipn-note">
            <LoaderCircle size={13} className="spin" /> Cargando…
          </p>
        ) : (
          <div className="ipn-empty">
            <Feather size={22} />
            <p>Ese instante ya no existe.</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
