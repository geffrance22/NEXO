import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useMobile } from '../hooks/useMobile';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Cuánto hay que bajar la ventana (o con qué rapidez, en px/ms) para cerrarla con el dedo. */
const DRAG_CLOSE = 110;
const FLICK = 0.55;

/**
 * En el celular la ventana sube desde abajo y se cierra arrastrándola hacia abajo desde su
 * agarradera. Si quien la abrió no la deja cerrar (p. ej. pregunta antes de descartar), vuelve a
 * su sitio.
 */
function useDragToClose(sheet: RefObject<HTMLDivElement | null>, close: () => void) {
  const drag = useRef<{ id: number; y: number; t: number; dy: number } | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const settle = (el: HTMLDivElement, to: string) => {
    el.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.9, 0.25, 1)';
    el.style.transform = to;
  };

  return {
    onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = sheet.current;
      if (!el) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: e.pointerId, y: e.clientY, t: performance.now(), dy: 0 };
      el.style.transition = 'none';
    },
    onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
      const d = drag.current;
      const el = sheet.current;
      if (!d || d.id !== e.pointerId || !el) return;
      d.dy = Math.max(0, e.clientY - d.y);
      el.style.transform = d.dy ? `translateY(${d.dy}px)` : '';
    },
    onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
      const d = drag.current;
      const el = sheet.current;
      drag.current = null;
      if (!d || d.id !== e.pointerId || !el) return;
      const speed = d.dy / Math.max(1, performance.now() - d.t);
      if (d.dy < DRAG_CLOSE && !(d.dy > 36 && speed > FLICK)) {
        settle(el, '');
        return;
      }
      settle(el, 'translateY(100%)');
      timers.current.push(
        window.setTimeout(() => {
          close();
          // Sigue abierta (lo pidió quien la abrió): vuelve a subir.
          timers.current.push(
            window.setTimeout(() => {
              if (sheet.current?.isConnected) settle(sheet.current, '');
            }, 60),
          );
        }, 170),
      );
    },
    onPointerCancel() {
      const el = sheet.current;
      drag.current = null;
      if (el) settle(el, '');
    },
  };
}

/**
 * Ventana moderna: se abre con una animación suave, se cierra con Esc o tocando fuera, mantiene el
 * foco dentro y bloquea el scroll de la página. En pantallas pequeñas ocupa el ancho completo y
 * sube desde abajo, con una agarradera para cerrarla arrastrando.
 */
export function Sheet({
  label,
  size = 'md',
  className = '',
  yieldTo,
  onRequestClose,
  children,
}: {
  label: string;
  size?: 'md' | 'lg';
  /** Clases extra para la ventana (p. ej. la ficha translúcida de un recuerdo). */
  className?: string;
  /** Si existe un elemento con este selector (algo abierto encima), Esc no cierra la ventana. */
  yieldTo?: string;
  onRequestClose: () => void;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const pressedOnBackdrop = useRef(false);
  const close = useRef(onRequestClose);
  close.current = onRequestClose;
  const yieldRef = useRef(yieldTo);
  yieldRef.current = yieldTo;
  const mobile = useMobile();
  const grab = useDragToClose(sheet, () => close.current());

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheet.current?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Si hay un visor de fotos o una confirmación encima, Esc es para ellos.
        if (document.querySelector('.lightbox, .confirm-backdrop')) return;
        if (yieldRef.current && document.querySelector(yieldRef.current)) return;
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !sheet.current) return;
      const items = Array.from(sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === sheet.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Solo cierra si el clic empezó y terminó fuera (no al soltar una selección de texto).
        if (pressedOnBackdrop.current && e.target === e.currentTarget) close.current();
      }}
    >
      <div
        ref={sheet}
        className={['sheet', size, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {mobile && <div className="sheet-grab" aria-hidden="true" {...grab} />}
        {children}
      </div>
    </div>
  );
}
