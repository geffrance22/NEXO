import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, BookOpen, Brain, Check, Clock, Eye, LoaderCircle, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { todayInputValue } from '../lib/format';
import { AiText } from '../readings/AiText';
import {
  dueReviews,
  faces,
  inDays,
  rateReview,
  schedule,
  type Grade,
  type ReviewItem,
} from '../readings/review';

const SNOOZE = 'nexo-review-snooze';
const look = { color: '#5a49b8', soft: '#eeebfa' };

/**
 * Tarjeta de la agenda: «Repasa N ideas de tus lecturas». Aparece cuando hay resaltados que
 * toca repasar hoy (repaso espaciado) y abre el repaso.
 */
export function ReviewAgendaCard() {
  const [due, setDue] = useState<{ items: ReviewItem[]; total: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [snoozed, setSnoozed] = useState(() => localStorage.getItem(SNOOZE) === todayInputValue());

  const load = useCallback(() => {
    void dueReviews().then(setDue);
  }, []);
  useEffect(load, [load]);

  if (!due?.items.length || (snoozed && !open)) return null;
  const n = due.items.length;
  const titles = [...new Set(due.items.map((i) => i.title))];

  return (
    <>
      <div className="ag-card" style={{ '--c': look.color, '--s': look.soft } as CSSProperties}>
        <span className="ag-icon">
          <Brain size={17} />
        </span>
        <div className="ag-main">
          <strong>
            Repasa {n} {n === 1 ? 'idea' : 'ideas'} de tus lecturas
          </strong>
          <p>
            De «{titles[0]}»
            {titles.length > 1
              ? ` y ${titles.length - 1} ${titles.length === 2 ? 'artículo' : 'artículos'} más`
              : ''}
            . Dos minutos para que no se te olviden.
          </p>
          <div className="ag-why" title="Por qué aparece">
            <i>Repaso espaciado</i>
            {due.total > n && <i>{due.total} pendientes en total</i>}
          </div>
        </div>
        <div className="ag-actions">
          <button type="button" className="ag-primary" onClick={() => setOpen(true)}>
            Repasar <ArrowRight size={13} />
          </button>
          <div className="ag-minor">
            <button
              type="button"
              aria-label="Hoy no"
              title="Hoy no"
              onClick={() => {
                localStorage.setItem(SNOOZE, todayInputValue());
                setSnoozed(true);
              }}
            >
              <Clock size={14} />
            </button>
          </div>
        </div>
      </div>
      {open &&
        createPortal(
          <ReviewDialog
            items={due.items}
            onClose={() => {
              setOpen(false);
              load();
            }}
          />,
          document.body,
        )}
    </>
  );
}

const grades: { id: Grade; label: string; key: string }[] = [
  { id: 'otra', label: 'Otra vez', key: '1' },
  { id: 'bien', label: 'Lo recordaba', key: '2' },
  { id: 'facil', label: 'Fácil', key: '3' },
];

/** Tarjetas de repaso: piensas la respuesta, la ves y dices cómo te fue. */
function ReviewDialog({ items, onClose }: { items: ReviewItem[]; onClose: () => void }) {
  const { go, notify } = useApp();
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const item = items[index];
  const f = item ? faces(item) : null;
  const hasBack = Boolean(f?.back);
  const revealed = shown || !hasBack;

  const grade = async (g: Grade) => {
    if (!item || busy) return;
    setBusy(true);
    try {
      await rateReview(item, g);
      setDone((d) => d + 1);
      setIndex((i) => i + 1);
      setShown(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar el repaso.');
    } finally {
      setBusy(false);
    }
  };

  // Atajos: espacio para ver la respuesta; 1, 2, 3 para calificar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!item || (e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === ' ' && !revealed) {
        e.preventDefault();
        setShown(true);
      } else if (revealed) {
        const g = grades.find((x) => x.key === e.key);
        if (g) void grade(g.id);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <Sheet label="Repaso de tus lecturas" size="md" className="rv" onRequestClose={onClose}>
      <div className="rv-wrap">
        <header className="rv-head">
          <span className="rv-chip">
            <Brain size={14} /> Repaso
          </span>
          {item && (
            <span className="rv-progress" aria-label={`Tarjeta ${index + 1} de ${items.length}`}>
              {items.map((_, i) => (
                <i key={i} className={i < index ? 'done' : i === index ? 'now' : ''} />
              ))}
            </span>
          )}
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        {item && f ? (
          <div className="rv-body" key={item.id}>
            <button
              type="button"
              className="rv-source"
              title="Abrir el artículo"
              onClick={() => {
                onClose();
                go('Lecturas', { id: item.reading_id });
              }}
            >
              <BookOpen size={13} /> {item.title}
            </button>
            <div className={'rv-card ' + f.kind}>
              {f.kind === 'pregunta' ? (
                <>
                  <h3>{f.front}</h3>
                  {f.quote && <blockquote>«{f.quote}»</blockquote>}
                </>
              ) : (
                <blockquote className="big">«{f.front}»</blockquote>
              )}
              {hasBack &&
                (shown ? (
                  <div className="rv-back">
                    <small>{f.kind === 'pregunta' ? 'Respuesta' : 'Tu nota'}</small>
                    <AiText text={f.back} />
                  </div>
                ) : (
                  <button type="button" className="rv-reveal" onClick={() => setShown(true)}>
                    <Eye size={15} />{' '}
                    {f.kind === 'pregunta' ? 'Piénsalo y mira la respuesta' : 'Ver tu nota'}
                    <kbd>Espacio</kbd>
                  </button>
                ))}
            </div>
            <footer className={'rv-grades' + (revealed ? '' : ' wait')}>
              {grades.map((g) => (
                <button
                  type="button"
                  key={g.id}
                  className={g.id}
                  disabled={!revealed || busy}
                  onClick={() => void grade(g.id)}
                >
                  <strong>{g.label}</strong>
                  <small>{inDays(schedule(item.review_step, g.id).days)}</small>
                </button>
              ))}
              <button
                type="button"
                className="rv-never"
                disabled={busy}
                onClick={() => void grade('nunca')}
              >
                {busy ? <LoaderCircle className="spin" size={13} /> : 'No repasar más'}
              </button>
            </footer>
          </div>
        ) : (
          <div className="rv-end">
            <span>
              <Check size={26} />
            </span>
            <h3>Listo por hoy</h3>
            <p>
              Repasaste {done} {done === 1 ? 'idea' : 'ideas'}. Volverán justo cuando estén por
              olvidarse.
            </p>
            <button type="button" className="pp-btn dark" onClick={onClose}>
              Volver
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
