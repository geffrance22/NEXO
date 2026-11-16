/**
 * Pantalla de inicio animada (vive en app.html, antes de que cargue la app). Se retira cuando la
 * sesión está lista, pero siempre deja terminar la entrada (~1,9 s desde que apareció): el
 * estallido, el ícono y «Nexo». Si la app tarda más, sigue la animación de carga hasta entonces.
 */
const INTRO_MS = 1900;

export function hideSplash() {
  const el = document.getElementById('nexo-splash');
  if (!el || el.dataset.leaving) return;
  el.dataset.leaving = '1';
  const born = Number(el.dataset.born) || 0;
  const wait = Math.max(0, born + INTRO_MS - performance.now());
  window.setTimeout(() => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 900);
  }, wait);
}

/**
 * Los estilos de la app ya aplicados. En la versión publicada se piden sin bloquear (así la
 * pantalla de inicio se pinta al instante, ver vite.config.ts); la app espera a tenerlos para
 * montarse con su diseño desde el primer cuadro. En desarrollo no hay nada que esperar.
 */
export function stylesReady(): Promise<void> {
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[data-app-css]')];
  const pending = links.filter((l) => !l.sheet);
  if (!pending.length) return Promise.resolve();
  return new Promise((done) => {
    let left = pending.length;
    const one = () => {
      left -= 1;
      if (left <= 0) done();
    };
    for (const link of pending) {
      link.addEventListener('load', one, { once: true });
      link.addEventListener('error', one, { once: true });
    }
    // Sin red o con un error raro: la app arranca igual.
    window.setTimeout(done, 10_000);
  });
}
