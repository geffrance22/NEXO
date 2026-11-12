import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Columnas reales de una rejilla `repeat(auto-fill, …)`: cambian con el ancho. `ready` vuelve a
 * medir cuando la rejilla aparece (antes de eso no hay nada que medir).
 */
export function useGridCols(ref: RefObject<HTMLElement | null>, ready: boolean) {
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean);
      setCols(Math.max(1, tracks.length));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, ready]);
  return cols;
}
