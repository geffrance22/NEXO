import { useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, FileArchive, LoaderCircle, Star, Upload, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import type { EntryDetails, EntryInput } from '../data';
import { cleanDetails } from '../composer/logic';
import { isSeries } from '../lib/entries';
import { errorMessage, todayInputValue } from '../lib/format';
import { findMediaHit, normal } from '../lib/moviePosters';
import { readLetterboxd, toStars, type LbFilm } from './letterboxd';
import { yearOf } from './shelf';
import './letterboxd.css';

const DONE_KEY = 'nexo-letterboxd-imported';
/** Películas por tanda: se buscan en TMDB de 4 en 4 y se guardan juntas. */
const BATCH = 40;
const PARALLEL = 4;

const titleKey = (title: string, year: string) => normal(title) + '|' + year;

/** El logo de Letterboxd (tres círculos): gris en reposo, con sus colores al pasar el puntero. */
export function LetterboxdMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="lb-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="5" cy="12" r="4.2" className="o" />
      <circle cx="12" cy="12" r="4.2" className="g" />
      <circle cx="19" cy="12" r="4.2" className="b" />
    </svg>
  );
}

/** Botón discreto (solo el ícono) que abre la importación. */
export function LetterboxdButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="lb-btn"
        aria-label="Importar desde Letterboxd"
        title="Importar desde Letterboxd"
        onClick={() => setOpen(true)}
      >
        <LetterboxdMark />
      </button>
      {open && <LetterboxdImport onClose={() => setOpen(false)} />}
    </>
  );
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

type Step =
  | { id: 'pick'; error?: string }
  | { id: 'reading' }
  | { id: 'review'; films: LbFilm[] }
  | { id: 'running'; total: number; done: number }
  | {
      id: 'done';
      saved: number;
      skipped: number;
      noPoster: number;
      stopped: boolean;
    };

/**
 * Importa tu historial de Letterboxd una sola vez: vistas (con fecha, calificación, reseña y
 * etiquetas) y, si quieres, tu lista «por ver». Busca el póster de cada una en TMDB y omite las que
 * ya tienes en Nexo.
 */
export function LetterboxdImport({ onClose }: { onClose: () => void }) {
  const { workspace, createEntries, notify } = useApp();
  const [step, setStep] = useState<Step>({ id: 'pick' });
  const [watchlist, setWatchlist] = useState(true);
  const [posters, setPosters] = useState(true);
  const [dragging, setDragging] = useState(false);
  const stop = useRef(false);
  const [stopping, setStopping] = useState(false);
  const lastImport = useMemo(() => localStorage.getItem(DONE_KEY), []);

  // Lo que ya está en Nexo: por título y año, y por película de TMDB.
  const existing = useMemo(() => {
    const keys = new Set<string>();
    const ids = new Set<number>();
    for (const e of workspace.entries) {
      if (e.kind !== 'Película' || isSeries(e)) continue;
      keys.add(titleKey(e.title, yearOf(e)));
      keys.add(titleKey(e.title, ''));
      const id = e.details.tmdbPoster?.id;
      if (id) ids.add(id);
    }
    return { keys, ids };
  }, [workspace.entries]);
  const isKnown = (f: LbFilm) =>
    existing.keys.has(titleKey(f.name, f.year)) || existing.keys.has(titleKey(f.name, ''));

  async function read(files: File[]) {
    if (!files.length) return;
    setStep({ id: 'reading' });
    try {
      const films = await readLetterboxd(files);
      if (!films.length) setStep({ id: 'pick', error: 'La exportación no trae películas.' });
      else setStep({ id: 'review', films });
    } catch (e) {
      setStep({ id: 'pick', error: errorMessage(e) });
    }
  }

  async function toInput(f: LbFilm): Promise<{ input: EntryInput; tmdb?: number }> {
    const watched = f.watched;
    let title = f.name;
    let details: EntryDetails = {
      watch: watched ? 'vista' : 'quiero',
      rating: watched ? toStars(f.rating) : undefined,
      year: f.year || undefined,
    };
    let tmdb: number | undefined;
    if (posters)
      try {
        const found = await findMediaHit(f.name, f.year, 'movie');
        if (found) {
          // El título de TMDB en español, como cuando añades una película a mano.
          title = found.hit.title || f.name;
          const year = found.details.year ?? f.year;
          tmdb = found.hit.id;
          details = {
            ...details,
            ...found.details,
            year: year || undefined,
            tmdbPoster: {
              ...found.details.tmdbPoster,
              key: titleKey(title, year ?? ''),
            },
          };
        }
      } catch {
        /* Sin TMDB: se guarda sin póster y se buscará más tarde. */
      }
    return {
      tmdb,
      input: {
        title,
        body: f.review ?? '',
        kind: 'Película',
        tags: f.tags.slice(0, 12),
        personIds: [],
        date: f.date || todayInputValue(),
        amount: 0,
        direction: 'egreso',
        status: 'pendiente',
        images: [],
        details: cleanDetails('Película', details),
        file: null,
        removeFile: false,
      },
    };
  }

  async function run(films: LbFilm[]) {
    stop.current = false;
    setStopping(false);
    const ids = new Set(existing.ids);
    let saved = 0;
    let skipped = 0;
    let noPoster = 0;
    let done = 0;
    setStep({ id: 'running', total: films.length, done: 0 });
    for (let i = 0; i < films.length && !stop.current; i += BATCH) {
      const built = await mapLimit(films.slice(i, i + BATCH), PARALLEL, toInput);
      const inputs: EntryInput[] = [];
      for (const b of built) {
        // La misma película con otro título (p. ej. ya la tenías en español).
        if (b.tmdb && ids.has(b.tmdb)) {
          skipped++;
          continue;
        }
        if (b.tmdb) ids.add(b.tmdb);
        else noPoster++;
        inputs.push(b.input);
      }
      const ok = inputs.length ? await createEntries(inputs) : [];
      if (!ok) {
        setStep({ id: 'done', saved, skipped, noPoster, stopped: true });
        return;
      }
      saved += ok.length;
      done += built.length;
      setStep({ id: 'running', total: films.length, done });
    }
    try {
      localStorage.setItem(DONE_KEY, todayInputValue());
    } catch {
      /* Sin almacenamiento: no pasa nada. */
    }
    setStep({ id: 'done', saved, skipped, noPoster, stopped: stop.current });
    notify(
      saved === 1
        ? '1 película importada de Letterboxd.'
        : `${saved.toLocaleString('es-CO')} películas importadas de Letterboxd.`,
    );
  }

  const running = step.id === 'running';
  const close = () => {
    if (!running) onClose();
  };

  let body;
  if (step.id === 'pick' || step.id === 'reading') {
    body = (
      <div className="lb-body">
        <ol className="lb-steps">
          <li>
            En Letterboxd, abre{' '}
            <a href="https://letterboxd.com/settings/data/" target="_blank" rel="noreferrer">
              Settings → Data <ExternalLink size={12} />
            </a>{' '}
            y pulsa <b>Export your data</b>.
          </li>
          <li>Suelta aquí el .zip que descargaste (no hace falta descomprimirlo).</li>
        </ol>
        <label
          className={'lb-drop' + (dragging ? ' over' : '') + (step.id === 'reading' ? ' busy' : '')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void read([...e.dataTransfer.files]);
          }}
        >
          <input
            type="file"
            accept=".zip,.csv,application/zip"
            multiple
            disabled={step.id === 'reading'}
            onChange={(e) => {
              void read([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          {step.id === 'reading' ? (
            <>
              <LoaderCircle size={22} className="lb-spin" />
              <strong>Leyendo tu exportación…</strong>
            </>
          ) : (
            <>
              <span className="lb-drop-icon">
                <FileArchive size={22} />
              </span>
              <strong>Suelta el .zip de Letterboxd</strong>
              <small>
                o <u>elígelo</u> · también sirven watched.csv, diary.csv, ratings.csv…
              </small>
            </>
          )}
        </label>
        {step.id === 'pick' && step.error && <p className="lb-error">{step.error}</p>}
        {lastImport && (
          <p className="lb-note">
            Ya importaste el {lastImport.split('-').reverse().join('/')}. Lo que ya tengas se omite.
          </p>
        )}
      </div>
    );
  } else if (step.id === 'review') {
    const fresh = step.films.filter((f) => !isKnown(f));
    const seen = fresh.filter((f) => f.watched);
    const want = fresh.filter((f) => f.watchlist);
    const chosen = watchlist ? fresh : seen;
    const rated = chosen.filter((f) => f.watched && f.rating).length;
    const reviewed = chosen.filter((f) => f.review).length;
    const known = step.films.length - fresh.length;
    body = (
      <>
        <div className="lb-body">
          <div className="lb-stats">
            <span>
              <b>{seen.length.toLocaleString('es-CO')}</b> vistas
            </span>
            <span className={watchlist ? '' : 'off'}>
              <b>{want.length.toLocaleString('es-CO')}</b> por ver
            </span>
            <span>
              <b>{rated.toLocaleString('es-CO')}</b> <Star size={11} /> calificadas
            </span>
            <span>
              <b>{reviewed.toLocaleString('es-CO')}</b> con reseña
            </span>
          </div>
          {known > 0 && (
            <p className="lb-note">
              {known === 1 ? '1 ya está' : `${known.toLocaleString('es-CO')} ya están`} en tu
              Libroteca y no se repite{known === 1 ? '' : 'n'}.
            </p>
          )}
          {want.length > 0 && (
            <label className="lb-check">
              <input
                type="checkbox"
                checked={watchlist}
                onChange={(e) => setWatchlist(e.target.checked)}
              />
              <span>
                Incluir tu watchlist <small>como «Por ver»</small>
              </span>
            </label>
          )}
          <label className="lb-check">
            <input
              type="checkbox"
              checked={posters}
              onChange={(e) => setPosters(e.target.checked)}
            />
            <span>
              Buscar póster y ficha en TMDB <small>tarda un poco más, pero quedan completas</small>
            </span>
          </label>
        </div>
        <footer className="lb-foot">
          <button type="button" className="lt-tool" onClick={() => setStep({ id: 'pick' })}>
            Otro archivo
          </button>
          <button
            type="button"
            className="lt-add"
            disabled={!chosen.length}
            onClick={() => void run(chosen)}
          >
            <Upload size={15} /> Importar {chosen.length.toLocaleString('es-CO')}{' '}
            {chosen.length === 1 ? 'película' : 'películas'}
          </button>
        </footer>
      </>
    );
  } else if (step.id === 'running') {
    const pct = step.total ? Math.round((step.done / step.total) * 100) : 0;
    body = (
      <>
        <div className="lb-body">
          <div className="lb-progress">
            <p>
              <strong>Importando…</strong>
              <span>
                {step.done.toLocaleString('es-CO')} de {step.total.toLocaleString('es-CO')}
              </span>
            </p>
            <span className="lb-bar">
              <i style={{ width: Math.max(3, pct) + '%' }} />
            </span>
            <small>
              {posters ? 'Buscando pósters en TMDB y guardando. ' : ''}Deja esta ventana abierta.
            </small>
          </div>
        </div>
        <footer className="lb-foot">
          <button
            type="button"
            className="lt-tool"
            disabled={stopping}
            onClick={() => {
              stop.current = true;
              setStopping(true);
            }}
          >
            {stopping ? 'Deteniendo…' : 'Detener'}
          </button>
        </footer>
      </>
    );
  } else {
    body = (
      <>
        <div className="lb-body lb-done">
          <span className="lb-done-icon">
            <Check size={22} />
          </span>
          <strong>
            {step.saved === 1
              ? '1 película en tu Libroteca'
              : `${step.saved.toLocaleString('es-CO')} películas en tu Libroteca`}
          </strong>
          <small>
            {[
              step.stopped ? 'Importación detenida' : '',
              step.skipped ? `${step.skipped} ya las tenías` : '',
              posters && step.noPoster ? `${step.noPoster} sin póster por ahora` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </div>
        <footer className="lb-foot">
          <button type="button" className="lt-add" onClick={onClose}>
            Listo
          </button>
        </footer>
      </>
    );
  }

  return (
    <Sheet label="Importar desde Letterboxd" className="lb" onRequestClose={close}>
      <header className="lb-head">
        <h2>
          <LetterboxdMark size={20} /> Importar desde Letterboxd
        </h2>
        {!running && (
          <button type="button" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        )}
      </header>
      {body}
    </Sheet>
  );
}
