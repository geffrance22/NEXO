import { useCallback, useEffect, useState } from 'react';

const KEY = 'nexo-theme';

/** Tema claro u oscuro. Se guarda en `localStorage` y se aplica como `data-theme` en `<html>`. */
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem(KEY, dark ? 'dark' : 'light');
    } catch {
      /* almacenamiento no disponible: el tema solo dura la sesión */
    }
  }, [dark]);

  const toggle = useCallback(() => setDark((v) => !v), []);

  return { dark, toggle };
}
