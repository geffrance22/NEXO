import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowUpRight, BookMarked, Check, Minus, Pin, PinOff, Plus, Tv, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import type { Entry, EntryDetails } from '../data';
import { Stars } from '../composer/controls';
import { cleanDetails } from '../composer/logic';
import { bookPace, etaLabel } from '../lib/entries';
import { entryImages } from '../lib/moviePosters';
import { finishedDetails, seasonsOf, withEpisode, withPage } from './progress';
import { captionOf, toneOf } from './shelf';
import './progress.css';

const toCount = (v: string) => Math.min(Number(v.replace(/\D/g, '')) || 0, 99999);
const perDayLabel = (n: number) =>
  (n < 10 ? n.toFixed(1).replace('.', ',') : String(Math.round(n))) + ' págs. al día';

function Stepper({
  label,
  value,
  min = 1,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  hint?: string;
}) {
  const clamp = (n: number) => Math.max(min, max ? Math.min(max, n) : n);
  return (
    <div className="pg-step">
      <span>{label}</span>
      <div>
        <button
          type="button"
          aria-label={`${label} anterior`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - 1))}
        >
          <Minus size={15} />
        </button>
        <input
          inputMode="numeric"
          aria-label={label}
          value={value || ''}
          onChange={(e) => onChange(clamp(toCount(e.target.value) || min))}
        />
        <button
          type="button"
          aria-label={`${label} siguiente`}
          disabled={Boolean(max && value >= max)}
          onClick={() => onChange(clamp(value + 1))}
        >
          <Plus size={15} />
        </button>
      </div>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * Actualizar cómo vas: la página de un libro o el episodio de una serie, con tu ritmo y cuándo lo
 * terminarías. Desde aquí también se marca como terminado y se ancla en «Mi espacio».
 */
export function ProgressSheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const { patchEntry, notify, viewEntry } = useApp();
  const d = entry.details;
  const book = entry.kind === 'Libro';
  const [page, setPage] = useState(d.pagesRead ?? 0);
  const [total, setTotal] = useState(d.pagesTotal ?? 0);
  const [season, setSeason] = useState(d.seasonAt ?? 1);
  const [episode, setEpisode] = useState(d.episodeAt ?? 1);
  const [finishing, setFinishing] = useState(false);
  const [rating, setRating] = useState(d.rating ?? 0);
  const [busy, setBusy] = useState(false);
  const pageInput = useRef<HTMLInputElement>(null);
  // La ventana toma el foco al abrirse; justo después, el cursor va a la página.
  useEffect(() => {
    const t = window.setTimeout(() => pageInput.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(t);
  }, []);

  const tone = toneOf(entry);
  const img = entryImages(entry)[0];
  const seasons = seasonsOf(entry);
  const follow = d.follow === true;
  const shownPage = total ? Math.min(page, total) : page;
  const percent = total ? Math.round((shownPage / total) * 100) : 0;
  // Ritmo y fecha estimada con lo que estás escribiendo (antes de guardar).
  const pace = book
    ? bookPace({ ...entry, details: withPage(entry, shownPage, total || undefined) })
    : null;
  const dirty = book
    ? shownPage !== (d.pagesRead ?? 0) || total !== (d.pagesTotal ?? 0)
    : season !== (d.seasonAt ?? 1) || episode !== (d.episodeAt ?? 1) || !d.seasonAt;

  async function save(details: EntryDetails, message: string) {
    if (busy) return;
    setBusy(true);
    const ok = await patchEntry(entry, { details });
    setBusy(false);
    if (!ok) return;
    notify(message);
    onClose();
  }
  const saveProgress = (e?: FormEvent) => {
    e?.preventDefault();
    if (finishing) return void finish();
    if (!dirty) return;
    if (book) {
      if (total && shownPage >= total) return setFinishing(true);
      void save(withPage(entry, shownPage, total || undefined), `Vas en la página ${shownPage}.`);
    } else {
      void save(withEpisode(entry, season, episode), `Vas en la T${season} · E${episode}.`);
    }
  };
  const finish = () =>
    void save(
      finishedDetails(
        book && total ? { ...entry, details: { ...d, pagesTotal: total } } : entry,
        rating,
      ),
      book ? 'Libro terminado. ¡Bien!' : 'Serie terminada.',
    );
  const toggleFollow = async () => {
    const ok = await patchEntry(entry, {
      details: cleanDetails(entry.kind, { ...d, follow: !follow }),
    });
    if (ok) notify(follow ? 'Ya no está en Mi espacio.' : 'Anclado en Mi espacio.');
  };

  const Icon = book ? BookMarked : Tv;
  const sub = captionOf(entry);

  return (
    <Sheet label={`Actualizar ${entry.title}`} className="pg" onRequestClose={onClose}>
      <form
        className="pg-wrap"
        onSubmit={saveProgress}
        style={{ '--c': tone.accent, '--s': tone.soft, '--k': tone.ink } as CSSProperties}
      >
        <header className="pg-head">
          <span className="pg-art">
            {img ? <img src={img.thumb ?? img.medium ?? img.url} alt="" /> : <Icon size={20} />}
          </span>
          <div className="pg-title">
            <small>{book ? 'Leyendo' : 'Viendo'}</small>
            <h2>{entry.title}</h2>
            <button
              type="button"
              className="pg-link"
              onClick={() => {
                onClose();
                viewEntry(entry);
              }}
            >
              {sub ? sub + ' · ' : ''}Ver ficha <ArrowUpRight size={12} />
            </button>
          </div>
          <button type="button" className="pg-x" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {finishing ? (
          <div className="pg-done">
            <span className="pg-done-icon">
              <Check size={22} />
            </span>
            <strong>{book ? '¿Qué tal el libro?' : '¿Qué tal la serie?'}</strong>
            <Stars label="Calificación" value={rating} onChange={setRating} size={28} />
            <small>Puedes dejarlo sin calificar.</small>
          </div>
        ) : book ? (
          <div className="pg-body">
            <div className="pg-pages">
              <label>
                <span>Página</span>
                <input
                  ref={pageInput}
                  inputMode="numeric"
                  placeholder="0"
                  value={page || ''}
                  onChange={(e) => setPage(toCount(e.target.value))}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <span className="pg-of">de</span>
              <label>
                <span>Total</span>
                <input
                  inputMode="numeric"
                  placeholder="—"
                  value={total || ''}
                  onChange={(e) => setTotal(toCount(e.target.value))}
                />
              </label>
              <strong>{total ? `${percent}%` : ''}</strong>
            </div>
            {total > 0 && (
              <input
                type="range"
                className="pg-range"
                aria-label="Página"
                min={0}
                max={total}
                value={shownPage}
                style={{ '--p': percent + '%' } as CSSProperties}
                onChange={(e) => setPage(Number(e.target.value))}
              />
            )}
            <div className="pg-quick">
              {[5, 10, 25, 50].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setPage((p) => (total ? Math.min(total, p + n) : p + n))}
                >
                  +{n}
                </button>
              ))}
            </div>
            {(pace || total > 0) && (
              <dl className="pg-stats">
                {pace && pace.todayPages > 0 && (
                  <div>
                    <dt>Hoy</dt>
                    <dd>+{pace.todayPages} págs.</dd>
                  </div>
                )}
                {pace && pace.perDay > 0 && (
                  <div>
                    <dt>Tu ritmo</dt>
                    <dd>{perDayLabel(pace.perDay)}</dd>
                  </div>
                )}
                {total > 0 && (
                  <div>
                    <dt>Te faltan</dt>
                    <dd>{Math.max(0, total - shownPage)} págs.</dd>
                  </div>
                )}
                {pace?.eta && (
                  <div>
                    <dt>A este ritmo</dt>
                    <dd>{etaLabel(pace.eta)}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        ) : (
          <div className="pg-body">
            <div className="pg-steps">
              <Stepper
                label="Temporada"
                value={season}
                max={seasons}
                hint={seasons ? `de ${seasons}` : undefined}
                onChange={(n) => {
                  if (n !== season) setEpisode(1);
                  setSeason(n);
                }}
              />
              <Stepper label="Episodio" value={episode} onChange={setEpisode} />
            </div>
            <div className="pg-quick">
              <button type="button" onClick={() => setEpisode((n) => n + 1)}>
                +1 episodio
              </button>
              <button
                type="button"
                disabled={Boolean(seasons && season >= seasons)}
                onClick={() => {
                  setSeason((s) => s + 1);
                  setEpisode(1);
                }}
              >
                Siguiente temporada
              </button>
            </div>
          </div>
        )}

        <footer className="pg-foot">
          {finishing ? (
            <>
              <button type="button" className="pg-btn" onClick={() => setFinishing(false)}>
                Volver
              </button>
              <span className="pg-sp" />
              <button type="submit" className="pg-btn main" disabled={busy}>
                <Check size={15} /> Marcar como terminado
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={'pg-pin' + (follow ? ' on' : '')}
                aria-pressed={follow}
                title={follow ? 'Quitar de Mi espacio' : 'Seguir su progreso desde Mi espacio'}
                onClick={() => void toggleFollow()}
              >
                {follow ? <PinOff size={14} /> : <Pin size={14} />}
                {follow ? 'En Mi espacio' : 'Anclar en Mi espacio'}
              </button>
              <span className="pg-sp" />
              <button type="button" className="pg-btn" onClick={() => setFinishing(true)}>
                {book ? 'Lo terminé' : 'La terminé'}
              </button>
              <button type="submit" className="pg-btn main" disabled={!dirty || busy}>
                Guardar
              </button>
            </>
          )}
        </footer>
      </form>
    </Sheet>
  );
}
