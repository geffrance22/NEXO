import { useSyncExternalStore } from 'react';

function subscribe(change: () => void) {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
}

/** ¿Hay conexión? (lo que dice el sistema: con señal pero sin internet puede decir que sí). */
export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}
