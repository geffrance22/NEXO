import {
  createContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Minus, X } from 'lucide-react';
import { useApp, type OutcomeMode } from '../AppContext';
import type { Entry } from '../data';
import { MISSED_REASONS, MISSED_SHELF, outcomeLabels } from '../lib/commitments';
import './task-outcome.css';

/**
 * Cierre de un pendiente: «Hecho» o «No lo hice» (y por qué, si quieres). En Agenda → Pendientes
 * cada fila muestra los dos botones; en el resto de la app hay uno solo que abre esta elección.
 */

/** Dentro de Agenda → Pendientes: cada pendiente muestra «Hecho» y, discreto, «No lo hice». */
export const PairedTasks = createContext(false);

const MAX_WHY = 280;

/**
 * El botón discreto «No lo hice» de Agenda → Pendientes: va directo a la razón (opcional).
 * `compact` lo deja solo con el ícono (en las tarjetas, donde hay menos sitio).
 */
export function MissButton({
  entry,
  className = '',
  compact = false,
}: {
  entry: Entry;
  className?: string;
  compact?: boolean;
}) {
  const { askOutcome } = useApp();
  const label = outcomeLabels(entry).missed;
  return (
    <button
      type="button"
      className={'to-miss' + (compact ? ' compact' : '') + (className ? ' ' + className : '')}
      title={compact ? label : `${label}: queda en ${MISSED_SHELF}, con su razón`}
      aria-label={label}
      aria-haspopup="dialog"
      onClick={(e) => askOutcome(entry, e.currentTarget, 'reason')}
    >
      <Minus size={12} strokeWidth={2.4} />
      {!compact && <span>{label}</span>}
    </button>
  );
}

/**
 * La ventanita junto al botón: primero la elección («Hecho» / «No lo hice») y, si no lo hiciste,
 * la razón con unas sugerencias. Flota encima de todo (no mueve la página), se recoloca al
 * desplazar y se cierra con Esc o tocando fuera.
 */
export function OutcomePopover({
  entry,
  anchor,
  mode,
  onClose,
}: {
  entry: Entry;
  anchor: HTMLElement;
  mode: OutcomeMode;
  onClose: () => void;
}) {
  const { resolveTask, notify } = useApp();
  const [step, setStep] = useState<OutcomeMode>(mode);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const done = useRef(onClose);
  done.current = onClose;
  const labels = outcomeLabels(entry);
  const width = step === 'reason' ? 320 : 212;

  /** Cierra y, si el botón sigue ahí, le devuelve el foco (para seguir con el teclado). */
  const close = (refocus = true) => {
    done.current();
    if (refocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  };

  // Junto al botón: debajo si cabe; si no, encima. Sigue al botón si la página se desplaza.
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.isConnected) return done.current();
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(width, vw - 16);
      const h = box.current?.offsetHeight ?? 0;
      const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
      const below = r.bottom + 8;
      const up = below + h > vh - 8 && r.top - 8 - h >= 8;
      setPos({ left, top: up ? r.top - 8 - h : Math.max(8, Math.min(below, vh - h - 8)), up });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, width, step]);

  // El foco entra al abrir y al pasar a la razón.
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      (step === 'reason' ? area.current : first.current)?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(id);
  }, [step]);

  // Tocar fuera cierra (el propio botón no: él alterna). Esc cierra antes que la ventana de abajo.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.contains(t)) return;
      done.current();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      done.current();
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [anchor]);

  const markDone = () => {
    close();
    void resolveTask(entry, 'hecho');
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const after = await resolveTask(entry, 'no', why);
    setBusy(false);
    if (!after) return;
    close(false);
    const title = entry.title.trim();
    notify(title ? `«${title.slice(0, 48)}» quedó en ${MISSED_SHELF}.` : `Quedó en ${MISSED_SHELF}.`, {
      label: 'Deshacer',
      icon: 'undo',
      run: () => void resolveTask(after, 'abierto'),
    });
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const style = pos
    ? { left: pos.left, top: pos.top, width: Math.min(width, window.innerWidth - 16) }
    : { left: -9999, top: 0, width, visibility: 'hidden' as const };

  return createPortal(
    step === 'choose' ? (
      <div
        ref={box}
        className={'to-pop' + (pos?.up ? ' up' : '')}
        style={style}
        role="menu"
        aria-label={`Cerrar «${entry.title.slice(0, 60) || 'pendiente'}»`}
        onKeyDown={onMenuKey}
      >
        <button ref={first} type="button" role="menuitem" className="to-item done" onClick={markDone}>
          <span className="to-ic">
            <Check size={12} strokeWidth={3} />
          </span>
          {labels.done}
        </button>
        <button
          type="button"
          role="menuitem"
          className="to-item miss"
          onClick={() => setStep('reason')}
        >
          <span className="to-ic">
            <Minus size={12} strokeWidth={2.4} />
          </span>
          {labels.missed}
          <ChevronRight size={14} className="to-go" />
        </button>
      </div>
    ) : (
      <div
        ref={box}
        className={'to-pop reason' + (pos?.up ? ' up' : '')}
        style={style}
        role="dialog"
        aria-label={labels.missed}
      >
        <header className="to-head">
          <span className="to-ic">
            <Minus size={12} strokeWidth={2.4} />
          </span>
          <div>
            <strong>{labels.missed}</strong>
            {entry.title.trim() && <small title={entry.title}>{entry.title}</small>}
          </div>
          <button type="button" className="to-x" aria-label="Cerrar" onClick={() => close()}>
            <X size={14} />
          </button>
        </header>
        <div className="to-chips" role="group" aria-label="Razones frecuentes">
          {MISSED_REASONS.map((r) => (
            <button
              type="button"
              key={r}
              className={why === r ? 'on' : ''}
              aria-pressed={why === r}
              onClick={() => {
                setWhy((w) => (w === r ? '' : r));
                area.current?.focus({ preventScroll: true });
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          ref={area}
          className="to-why"
          rows={2}
          maxLength={MAX_WHY}
          placeholder="¿Qué pasó? Opcional"
          aria-label="Razón (opcional)"
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
        />
        <footer className="to-foot">
          <small>Se guarda en {MISSED_SHELF}</small>
          <button type="button" className="to-btn" onClick={() => close()}>
            Cancelar
          </button>
          <button type="button" className="to-btn main" disabled={busy} onClick={() => void save()}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </footer>
      </div>
    ),
    document.body,
  );
}
