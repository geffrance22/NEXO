import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Clock, Hourglass, LoaderCircle } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { capsuleDay, daysUntil, isReady } from '../diary/capsule';
import { CapsuleReader } from '../diary/Capsules';
import { dayOf } from '../diary/model';
import { todayInputValue } from '../lib/format';

const SNOOZE = 'nexo-capsule-snooze';
const MAX = 3;
const look = { color: '#a0613a', soft: '#f8ebe1' };

/** Cuánto tiempo viajó: «una semana», «3 meses», «2 años». */
function travelled(days: number) {
  if (days < 2) return 'un día';
  if (days < 14) return `${days} días`;
  if (days < 45) {
    const w = Math.round(days / 7);
    return w === 1 ? 'una semana' : `${w} semanas`;
  }
  if (days < 548) {
    const m = Math.round(days / 30.44);
    return m === 1 ? 'un mes' : `${m} meses`;
  }
  const y = Math.round(days / 365.25);
  return y === 1 ? 'un año' : `${y} años`;
}

const headlines = [
  () => 'Tu nota ha llegado desde el más allá',
  () => 'Llegó una carta de tu pasado',
  (t: string) => `Tu yo de hace ${t} te dejó algo`,
  () => 'Se abrió una cápsula del tiempo',
  (t: string) => `Una nota viajó ${t} para llegar hoy`,
];

/** Siempre el mismo mensaje para la misma cápsula (no cambia en cada render). */
function headlineFor(e: Entry, t: string) {
  let h = 0;
  for (const ch of e.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return headlines[h % headlines.length](t);
}

/**
 * Tarjeta de «Hoy»: las cápsulas del tiempo que ya llegaron y aún no abres. No revela nada de lo
 * que dicen, solo cuándo las escribiste; se abren aquí mismo.
 */
export function CapsuleAgendaCard() {
  const { capsules, openCapsule } = useApp();
  const today = todayInputValue();
  const [snoozed, setSnoozed] = useState(() => localStorage.getItem(SNOOZE) === today);
  const [busy, setBusy] = useState<string | null>(null);
  const [reading, setReading] = useState<Entry | null>(null);

  const ready = capsules
    .filter((e) => isReady(e, today))
    .sort((a, b) => b.details.capsule!.opensOn.localeCompare(a.details.capsule!.opensOn));
  const show = ready.length > 0 && !snoozed;
  if (!show && !reading) return null;

  const open = async (e: Entry) => {
    if (busy) return;
    setBusy(e.id);
    const opened = await openCapsule(e);
    setBusy(null);
    if (opened) setReading(opened);
  };

  return (
    <>
      {show &&
        ready.slice(0, MAX).map((e, i) => {
          const c = e.details.capsule!;
          const written = dayOf(e);
          const trip = travelled(Math.max(1, daysUntil(c.opensOn, written)));
          const late = -daysUntil(c.opensOn, today);
          const more = i === MAX - 1 ? ready.length - MAX : 0;
          return (
            <div
              key={e.id}
              className="ag-card"
              style={{ '--c': look.color, '--s': look.soft } as CSSProperties}
            >
              <span className="ag-icon">
                <Hourglass size={17} />
              </span>
              <div className="ag-main">
                <strong>{headlineFor(e, trip)}</strong>
                <p>
                  La escribiste el {capsuleDay(written)} y la sellaste hasta hoy. Lo que dice sigue
                  guardado hasta que la abras.
                </p>
                <div className="ag-why" title="Por qué aparece">
                  <i>
                    {late <= 0
                      ? 'Llegó hoy'
                      : late === 1
                        ? 'Llegó ayer'
                        : `Llegó hace ${late} días`}
                  </i>
                  <i>Cápsula del tiempo</i>
                  {c.once && <i>Se ve una sola vez</i>}
                  {more > 0 && <i>{more === 1 ? 'Hay 1 más' : `Hay ${more} más`} en tu diario</i>}
                </div>
              </div>
              <div className="ag-actions">
                <button
                  type="button"
                  className="ag-primary"
                  disabled={busy === e.id}
                  onClick={() => void open(e)}
                >
                  {busy === e.id ? (
                    <LoaderCircle className="spin" size={13} />
                  ) : (
                    <>
                      Abrirla <ArrowRight size={13} />
                    </>
                  )}
                </button>
                <div className="ag-minor">
                  <button
                    type="button"
                    aria-label="Hoy no"
                    title="Hoy no (sigue en tu diario)"
                    onClick={() => {
                      localStorage.setItem(SNOOZE, today);
                      setSnoozed(true);
                    }}
                  >
                    <Clock size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      {reading &&
        createPortal(
          <CapsuleReader entry={reading} onDone={() => setReading(null)} />,
          document.body,
        )}
    </>
  );
}
