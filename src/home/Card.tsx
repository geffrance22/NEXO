import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import type { Opts, Zone } from './types';

/**
 * Armazón de los bloques nuevos: encabezado (ícono, título, cuántos y un enlace) y su contenido.
 * Sin nada que mostrar enseña un texto suave, o desaparece si así lo pediste en sus ajustes.
 */
export function Card({
  zone,
  opts,
  icon: Icon,
  title,
  count,
  link,
  onLink,
  action,
  empty = false,
  emptyText,
  tone,
  className = '',
  children,
}: {
  zone: Zone;
  opts: Opts;
  icon: LucideIcon;
  title: ReactNode;
  count?: number;
  link?: string;
  onLink?: () => void;
  action?: ReactNode;
  empty?: boolean;
  emptyText?: ReactNode;
  /** Color del ícono del encabezado. */
  tone?: string;
  className?: string;
  children?: ReactNode;
}) {
  if (empty && opts._hide === true) return null;
  // El título que le pusiste manda (salvo en la ruta de subcarpetas de Capturas).
  const custom = typeof opts._title === 'string' ? opts._title.trim() : '';
  if (custom && typeof title === 'string') title = custom;
  return (
    <section
      className={'hc hk' + (zone === 'main' ? ' hk-main' : '') + (className ? ' ' + className : '')}
      style={tone ? ({ '--hk-tone': tone } as CSSProperties) : undefined}
    >
      <header className="hc-head">
        <h3>
          <Icon size={15} /> <span className="hk-title">{title}</span>
          {count ? <i>{count.toLocaleString('es-CO')}</i> : null}
        </h3>
        {action}
        {link && onLink && (
          <button type="button" className="hc-link" onClick={onLink}>
            {link} <ArrowUpRight size={13} />
          </button>
        )}
      </header>
      {empty ? <p className="hc-empty">{emptyText}</p> : children}
    </section>
  );
}

/** Si un bloque falla, solo ese bloque desaparece: el resto de Mi espacio sigue en pie. */
export class BlockBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Bloque de Mi espacio', error, info.componentStack);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Un número del día que no cambia en todo el día (para elegir «al azar» sin saltar en cada render). */
export function daySeed(salt: string, day: string) {
  let h = 2166136261;
  for (const ch of salt + day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
