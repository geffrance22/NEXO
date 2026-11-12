import { useEffect, useMemo, useRef, useState } from 'react';
import { Feather, Images, LoaderCircle, Puzzle, Search, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { LoadMore, useInfinite } from '../components/LoadMore';
import { Sheet } from '../components/Sheet';
import { useCuadernos } from '../cuadernos/useCuadernos';
import { normalizeText } from '../lib/format';
import { MyFace } from '../people/MyFace';
import { jobCount, setPiecesReview, usePieceJobs } from './analysis';
import { ThreadCard } from './Feed';
import { compactCount, threadsOf, type Instant, type Thread } from './model';
import { FeedSkeleton } from './Skeleton';
import { instantsHint, useInstants } from './store';
import './instants.css';

const PAGE = 12;
/** Lo que, abierto encima, se queda con Esc. */
const ABOVE =
  '.sheet-backdrop, .confirm-backdrop, .modal-backdrop, .lightbox, .nx-peek-backdrop, .nx-peek, .nx-pop';

/** El texto de cada instante ya sin tildes ni mayúsculas (se calcula una vez, no en cada tecla). */
const plain = new WeakMap<Instant, string>();
const plainBody = (i: Instant) => {
  let s = plain.get(i);
  if (s === undefined) {
    s = normalizeText(i.body);
    plain.set(i, s);
  }
  return s;
};

/** Hilos con al menos una foto (en cualquiera de sus instantes). */
const hasPhotos = (t: Thread) => t.items.some((i) => i.images.length > 0);

/** Texto en el que se busca un hilo: lo escrito y los nombres de lo que tiene vinculado. */
function useSearchable() {
  const { workspace } = useApp();
  const { list: notebooks } = useCuadernos();
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const p of workspace.people) names.set(p.id, p.name);
    for (const p of workspace.places) names.set(p.id, p.name);
    for (const e of workspace.episodes) names.set(e.id, e.title);
    for (const nb of notebooks ?? []) names.set(nb.id, nb.name);
    return (t: Thread) =>
      t.items
        .map((i) => {
          const linked = [...i.person_ids, ...i.place_ids, ...i.episode_ids, ...i.notebook_ids]
            .map((id) => names.get(id) ?? '')
            .join(' ');
          return plainBody(i) + ' ' + normalizeText(linked);
        })
        .join(' ');
  }, [workspace.people, workspace.places, workspace.episodes, notebooks]);
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
  /** Solo los hilos con fotos. */
  const [photos, setPhotos] = useState(false);
  const [closing, setClosing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const searchable = useSearchable();

  const threads = useMemo(() => threadsOf(list ?? []), [list]);
  const needle = normalizeText(query.trim());
  const shown = useMemo(() => {
    const base = photos ? threads.filter(hasPhotos) : threads;
    return needle ? base.filter((t) => searchable(t).includes(needle)) : base;
  }, [threads, needle, searchable, photos]);
  const { visible, rest, loadMore, reach } = useInfinite(
    shown,
    PAGE,
    (photos ? 'fotos:' : '') + needle,
  );
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
      if (e.key === 'Escape') {
        if (document.querySelector(ABOVE)) return;
        e.preventDefault();
        closeRef.current();
        return;
      }
      // «F» abre el feed desde cualquier sección (ver Topbar) y, con él abierto, lo cierra. No
      // actúa si estás escribiendo ni si hay algo encima.
      if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))
        return;
      if (document.querySelector(`${ABOVE}, [aria-modal="true"]:not(.ipn), .chat-panel`)) return;
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
          <button
            type="button"
            className="ipn-x"
            aria-label="Cerrar"
            aria-keyshortcuts="F"
            title="Cerrar (F)"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>

        <label className="ipn-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              photos ? 'Buscar en los que tienen fotos…' : 'Buscar en tus instantes, personas, lugares…'
            }
            aria-label="Buscar en tus instantes"
          />
          {query && (
            <button type="button" aria-label="Borrar búsqueda" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
          {/* Filtro dentro de la barra de búsqueda: no ocupa una fila propia. */}
          <button
            type="button"
            className={'ipn-media' + (photos ? ' on' : '')}
            aria-pressed={photos}
            aria-label="Solo instantes con fotos"
            title={photos ? 'Ver todos los instantes' : 'Solo instantes con fotos'}
            onClick={() => setPhotos((p) => !p)}
          >
            <Images size={15} />
          </button>
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
          {list === null && <FeedSkeleton rows={4} />}
          {visible.map((t) => (
            <ThreadCard key={t.id} thread={t} highlight={t.id === focusThread} nav={nav} />
          ))}
          {/* Al acercarse al final, esqueletos en lugar de un botón: la siguiente tanda entra sola. */}
          <LoadMore
            rest={rest}
            onMore={loadMore}
            shown={visible.length}
            placeholder={<FeedSkeleton rows={2} label="Cargando más instantes" />}
          />
          {list !== null && complete && !shown.length && !missing && (
            <div className="ipn-empty">
              <Feather size={22} />
              {needle ? (
                <p>
                  Nada con «{query.trim()}»{photos ? ' entre los que tienen fotos' : ''}.
                </p>
              ) : photos ? (
                <p>Aún no hay instantes con fotos.</p>
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
          {/* Aún llegan instantes del servidor (de 500 en 500): mientras, esqueletos al final. */}
          {list !== null && !complete && !rest && !missing && !error && (
            <FeedSkeleton rows={2} label="Cargando más instantes" />
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
