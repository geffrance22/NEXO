import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Ventana moderna: se abre con una animación suave, se cierra con Esc o tocando fuera, mantiene el
 * foco dentro y bloquea el scroll de la página. En pantallas pequeñas ocupa el ancho completo.
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
        {children}
      </div>
    </div>
  );
}
