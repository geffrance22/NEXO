import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Muestra una lista por tandas: `visible` empieza con `page` elementos y crece con `loadMore`.
 * Cuando cambia `reset` (pestaña, filtro, búsqueda, orden…), vuelve a la primera tanda.
 */
export function useInfinite<T>(items: T[], page: number, reset: string) {
  const [state, setState] = useState({ reset, limit: page });
  const stale = state.reset !== reset;
  // Reinicio durante el render (patrón de React para estado derivado): sin un fotograma de más.
  if (stale) setState({ reset, limit: page });
  const limit = stale ? page : Math.max(state.limit, page);
  const visible = useMemo(() => items.slice(0, limit), [items, limit]);
  const loadMore = useCallback(() => setState((s) => ({ ...s, limit: s.limit + page })), [page]);
  return { visible, rest: Math.max(0, items.length - limit), loadMore };
}

/**
 * Final de una lista por tandas: al acercarse (800px antes) carga la siguiente sola. Es también un
 * botón, por si el navegador no avisa del desplazamiento o se navega con teclado.
 */
export function LoadMore({
  rest,
  onMore,
  shown,
}: {
  /** Cuántos faltan por mostrar (0: no se pinta nada). */
  rest: number;
  onMore: () => void;
  /** Cuántos hay ya en pantalla: al cambiar, se vuelve a mirar si el final sigue a la vista. */
  shown: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const more = useRef(onMore);
  more.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // Un observador nuevo por tanda: avisa de inmediato si el final sigue cerca (pantallas altas).
    const io = new IntersectionObserver(
      (seen) => {
        if (seen.some((s) => s.isIntersecting)) more.current();
      },
      { rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rest > 0]);
  if (rest <= 0) return null;
  return (
    <button type="button" ref={ref} className="lt-more lt-more-auto" onClick={onMore}>
      Ver más <span>{rest.toLocaleString('es-CO')}</span>
    </button>
  );
}
