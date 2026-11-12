import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

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
  /** Asegura que se muestren al menos `n` (p. ej. para dejar a la vista uno que está más abajo). */
  const reach = useCallback(
    (n: number) =>
      setState((s) => (n > s.limit ? { ...s, limit: Math.ceil(n / page) * page } : s)),
    [page],
  );
  return { visible, rest: Math.max(0, items.length - limit), loadMore, reach };
}

/**
 * Final de una lista por tandas: al acercarse (800px antes) carga la siguiente sola. Es también un
 * botón, por si el navegador no avisa del desplazamiento o se navega con teclado.
 */
export function LoadMore({
  rest,
  onMore,
  shown,
  auto = true,
  placeholder,
}: {
  /** Cuántos faltan por mostrar (0: no se pinta nada). */
  rest: number;
  onMore: () => void;
  /** Cuántos hay ya en pantalla: al cambiar, se vuelve a mirar si el final sigue a la vista. */
  shown: number;
  /** Cargar sola al acercarse (false: solo con el botón, p. ej. si hay algo debajo de la lista). */
  auto?: boolean;
  /**
   * Lo que se ve al final mientras llega la siguiente tanda (p. ej. esqueletos) en lugar del botón.
   * Al acercarse carga sola; el botón sigue ahí, oculto a la vista, para el teclado y los lectores
   * de pantalla. Si el navegador no avisa del desplazamiento, se usa el botón de siempre.
   */
  placeholder?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const more = useRef(onMore);
  more.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (!auto || !el || typeof IntersectionObserver === 'undefined') return;
    // Un observador nuevo por tanda: avisa de inmediato si el final sigue cerca (pantallas altas).
    const io = new IntersectionObserver(
      (seen) => {
        if (seen.some((s) => s.isIntersecting)) more.current();
      },
      { rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rest > 0, auto]);
  if (rest <= 0) return null;
  if (placeholder && auto && typeof IntersectionObserver !== 'undefined')
    return (
      <div ref={ref as RefObject<HTMLDivElement>} className="lt-more-ph">
        {placeholder}
        <button type="button" className="cp-sr" onClick={onMore}>
          Ver más ({rest.toLocaleString('es-CO')})
        </button>
      </div>
    );
  return (
    <button
      type="button"
      ref={ref as RefObject<HTMLButtonElement>}
      className={'lt-more' + (auto ? ' lt-more-auto' : '')}
      onClick={onMore}
    >
      Ver más <span>{rest.toLocaleString('es-CO')}</span>
    </button>
  );
}
