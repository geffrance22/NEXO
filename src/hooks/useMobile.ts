import { useSyncExternalStore } from 'react';

/** El mismo corte que usa el CSS para el diseño de celular (barra inferior, menú lateral oculto). */
export const MOBILE_QUERY = '(max-width: 720px)';

const subscribe = (onChange: () => void) => {
  const m = window.matchMedia(MOBILE_QUERY);
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
};
const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;

/** ¿La pantalla es de celular? Se actualiza al girar el teléfono o cambiar el tamaño de la ventana. */
export function useMobile() {
  return useSyncExternalStore(subscribe, isMobile, () => false);
}
