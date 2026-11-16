import { useCallback, useSyncExternalStore } from 'react';

/** El mismo corte que usa el CSS para el diseño de celular (barra inferior, menú lateral oculto). */
export const MOBILE_QUERY = '(max-width: 720px)';

/** ¿Se cumple esta media query? Se actualiza al girar el teléfono o cambiar el tamaño de la ventana. */
export function useMedia(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', onChange);
      return () => m.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** ¿La pantalla es de celular? */
export function useMobile() {
  return useMedia(MOBILE_QUERY);
}

/**
 * ¿Se usa con el dedo (celular o tableta)? Entonces una ventana no pone el cursor en un campo al
 * abrirse: el teclado solo sale cuando tocas donde quieres escribir.
 */
export const touchFirst = () => window.matchMedia('(hover: none), (pointer: coarse)').matches;
