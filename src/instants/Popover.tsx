import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const GAP = 6;
const EDGE = 8;

/**
 * Ventanita flotante junto a un botón. Va fuera de cualquier contenedor con scroll (así no se
 * recorta), se abre debajo o, si no cabe, encima, y sigue al botón si la página se mueve. Se
 * cierra con un clic fuera o con Esc (sin cerrar la ventana de debajo).
 */
export function Popover({
  anchor,
  onClose,
  align = 'start',
  className = '',
  label,
  role = 'dialog',
  children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  /** start: alineada al borde izquierdo del botón; end: al derecho. */
  align?: 'start' | 'end';
  className?: string;
  label: string;
  role?: 'dialog' | 'menu';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  /** Hacia dónde abre: se decide una vez (si cambia de alto al filtrar, no salta de lado). */
  const up = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = '';
    const place = () => {
      if (!anchor.isConnected) return close.current();
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const below = vh - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      if (up.current === null) up.current = el.offsetHeight > below && above > below;
      const w = el.offsetWidth;
      const left = Math.round(
        Math.max(EDGE, Math.min(align === 'end' ? r.right - w : r.left, vw - w - EDGE)),
      );
      const next: CSSProperties = up.current
        ? { left, bottom: Math.round(vh - r.top + GAP), maxHeight: Math.max(160, above) }
        : { left, top: Math.round(r.bottom + GAP), maxHeight: Math.max(160, below) };
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setPos(next);
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      close.current();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
      anchor.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor]);

  // Tab da la vuelta dentro de la ventanita (la ventana de debajo no le roba el foco).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length;
    items[next].focus();
  };

  return createPortal(
    <div
      ref={ref}
      className={'nx-pop' + (up.current ? ' up' : '') + (className ? ' ' + className : '')}
      role={role}
      aria-label={label}
      style={pos ?? { top: 0, left: 0, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}
