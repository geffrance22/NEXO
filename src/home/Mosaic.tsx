import { useState, type CSSProperties } from 'react';
import { Star } from 'lucide-react';
import type { Zone } from './types';

/** Una imagen del mosaico. Sin `ratio`, se mide al cargar (y se recuerda). */
export type MosaicItem = {
  key: string;
  src: string;
  srcSet?: string;
  ratio?: number;
  title?: string;
  sub?: string;
  star?: boolean;
  onOpen: () => void;
};

export type MosaicSize = 'sm' | 'md' | 'lg' | 'xl';
export const mosaicSizes = [
  { value: 'sm', label: 'Pequeñas' },
  { value: 'md', label: 'Medianas' },
  { value: 'lg', label: 'Grandes' },
  { value: 'xl', label: 'Muy grandes' },
];
/** Alto de cada fila: el panel es angosto, así que ahí todo va más chico. */
const ROWS: Record<Zone, Record<MosaicSize, number>> = {
  main: { sm: 84, md: 112, lg: 150, xl: 210 },
  side: { sm: 52, md: 66, lg: 90, xl: 130 },
};
export const rowHeight = (size: unknown, zone: Zone) =>
  ROWS[zone][(size as MosaicSize) in ROWS[zone] ? (size as MosaicSize) : 'md'];

const clamp = (r: number) => Math.min(3, Math.max(0.45, r));
/** Proporciones ya medidas: al volver a Mi espacio nada salta de tamaño. */
const known = new Map<string, number>();

/**
 * Mosaico de filas justificadas, como el de CAPTURAS: cada imagen conserva su forma (vertical,
 * horizontal o cuadrada), las filas se completan solas y la última queda a su tamaño natural.
 */
export function Mosaic({ items, row }: { items: MosaicItem[]; row: number }) {
  return (
    <div className="hk-justify" style={{ '--row': row + 'px' } as CSSProperties}>
      {items.map((it) => (
        <Tile key={it.key} item={it} row={row} />
      ))}
    </div>
  );
}

function Tile({ item, row }: { item: MosaicItem; row: number }) {
  const [measured, setMeasured] = useState(() => known.get(item.src));
  const [loaded, setLoaded] = useState(false);
  const r = clamp(item.ratio ?? measured ?? 1.5);
  return (
    <button
      type="button"
      className={'hk-jt' + (loaded ? ' loaded' : '')}
      style={{ flexGrow: r, flexBasis: r * row + 'px' }}
      title={item.title}
      onClick={item.onOpen}
    >
      <i style={{ paddingBottom: 100 / r + '%' }} />
      <img
        src={item.src}
        srcSet={item.srcSet}
        sizes={item.srcSet ? `${Math.round(r * row * 1.4)}px` : undefined}
        alt={item.title ?? ''}
        loading="lazy"
        onLoad={(e) => {
          const im = e.currentTarget;
          if (!item.ratio && im.naturalWidth && im.naturalHeight) {
            const nr = clamp(im.naturalWidth / im.naturalHeight);
            known.set(item.src, nr);
            setMeasured(nr);
          }
          setLoaded(true);
        }}
      />
      {item.star && <Star size={11} className="hk-jt-star" />}
      {(item.title || item.sub) && (
        <span className="hk-jt-cap">
          {item.title && <strong>{item.title}</strong>}
          {item.sub && <small>{item.sub}</small>}
        </span>
      )}
    </button>
  );
}
