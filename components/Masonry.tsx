import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Entry } from '../data';
import { NoteTile } from './NoteTile';

/** Alto de cada fila de la cuadrícula: cada tarjeta ocupa las filas que mide. */
const ROW = 4;

/** Una tarjeta que mide su alto real y ocupa exactamente esas filas. */
function Brick({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState(0);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setSpan(Math.ceil(el.getBoundingClientRect().height / ROW));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="msn-brick" style={span ? { gridRowEnd: `span ${span}` } : undefined}>
      <div className="msn-in" ref={inner}>
        {children}
      </div>
    </div>
  );
}

/**
 * Tarjetas al estilo Pinterest: cada una mide lo que contiene (con reseña o sin ella, con foto o
 * sin ella) y se acomoda en la columna que quede más arriba, sin huecos. El orden se lee de
 * izquierda a derecha.
 */
export function Masonry({
  entries,
  render = (e) => <NoteTile entry={e} />,
  min = 230,
  max = 4,
  gap = 12,
}: {
  entries: Entry[];
  render?: (e: Entry) => ReactNode;
  /** Ancho mínimo de una columna y cuántas columnas como mucho. */
  min?: number;
  max?: number;
  gap?: number;
}) {
  return (
    <div
      className="msn"
      style={
        { '--msn-min': min + 'px', '--msn-max': max, '--msn-gap': gap + 'px' } as CSSProperties
      }
    >
      {entries.map((e) => (
        <Brick key={e.id}>{render(e)}</Brick>
      ))}
    </div>
  );
}
