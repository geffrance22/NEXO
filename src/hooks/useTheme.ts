import { useCallback, useEffect, useState } from 'react';

const KEY = 'nexo-theme';

/** Tema claro u oscuro. Se guarda en `localStorage` y se aplica como `data-theme` en `<html>`. */
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    // La barra del sistema (y la de estado de la app instalada) acompaña al tema.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#161612' : '#f5f5f0');
    try {
      localStorage.setItem(KEY, dark ? 'dark' : 'light');
    } catch {
      /* almacenamiento no disponible: el tema solo dura la sesión */
    }
  }, [dark]);

  const toggle = useCallback(() => setDark((v) => !v), []);

  return { dark, toggle };
}
