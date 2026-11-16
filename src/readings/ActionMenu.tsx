import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, type LucideIcon } from 'lucide-react';

export type MenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  /** Una línea debajo del nombre. */
  hint?: string;
  danger?: boolean;
  /** Opción activa (favorito, fijado…): lleva un chulito. */
  on?: boolean;
  disabled?: boolean;
};

const EDGE = 8;
const WIDTH = 252;

/**
 * Menú de «Más opciones» (los tres puntos) junto al botón que lo abrió: filas grandes, fáciles de
 * tocar. Va en un portal; se cierra al elegir, al tocar fuera, al desplazar o con Esc.
 */
export function ActionMenu({
  anchor,
  label,
  items,
  onClose,
}: {
  anchor: HTMLElement;
  label: string;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean; max: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Alineado al borde derecho del botón; arriba si abajo no cabe.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const w = Math.min(WIDTH, vw - EDGE * 2);
      const h = el.scrollHeight;
      const x = Math.min(Math.max(EDGE, r.right - w), vw - w - EDGE);
      const room = vh - r.bottom - EDGE - 6;
      const up = h > room && r.top - EDGE - 6 > room;
      const max = Math.max(160, up ? r.top - EDGE - 6 : room);
      const y = up ? Math.max(EDGE, r.top - 6 - Math.min(h, max)) : r.bottom + 6;
      setPos((p) =>
        p && p.x === x && p.y === y && p.up === up && p.max === max ? p : { x, y, up, max },
      );
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      // El mismo botón lo cierra (lo maneja él): aquí solo lo de fuera.
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
      anchor.focus({ preventScroll: true });
    };
    const scroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      close.current();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      className={'rd-menu' + (pos?.up ? ' up' : '')}
      role="menu"
      aria-label={label}
      style={
        pos
          ? { left: pos.x, top: pos.y, width: Math.min(WIDTH, window.innerWidth - EDGE * 2), maxHeight: pos.max }
          : { left: 0, top: 0, visibility: 'hidden' }
      }
    >
      {items.map((it) => (
        <button
          type="button"
          role="menuitem"
          key={it.key}
          className={(it.danger ? 'danger' : '') + (it.on ? ' on' : '')}
          disabled={it.disabled}
          onClick={() => {
            close.current();
            it.run();
          }}
        >
          <span className="rd-menu-ico">
            <it.icon size={18} fill={it.on && it.key === 'fav' ? 'currentColor' : 'none'} />
          </span>
          <span className="rd-menu-text">
            <b>{it.label}</b>
            {it.hint && <small>{it.hint}</small>}
          </span>
          {it.on && <Check size={16} className="rd-menu-check" />}
        </button>
      ))}
    </div>,
    document.body,
  );
}
