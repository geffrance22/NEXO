/**
 * Bloquea el scroll de la página mientras haya una ventana encima. Lleva la cuenta: con varias
 * abiertas, la página se suelta solo al cerrar la última (cerrar la de encima no la desbloquea).
 */
let count = 0;
let saved: string | null = null;

/**
 * Solo toca `<html>` (el que desplaza la página): así no choca con las capas que ya ocultan el
 * scroll de `<body>` por su cuenta (el visor de fotos, el feed de Instantes).
 */
export function lockScroll() {
  const html = document.documentElement.style;
  if (count++ === 0) {
    saved = html.overflow;
    html.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--count > 0 || saved === null) return;
    html.overflow = saved;
    saved = null;
  };
}

/** Campos y controles donde el dedo hace otra cosa (seleccionar texto, mover un deslizador). */
const NATIVE = 'input, textarea, select, [contenteditable="true"], [data-touch-free]';

/** ¿Este elemento puede desplazarse más en esa dirección (dy > 0: el dedo baja)? */
function canScroll(el: HTMLElement, dy: number) {
  const y = getComputedStyle(el).overflowY;
  if (y !== 'auto' && y !== 'scroll') return false;
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  return dy > 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}

/**
 * En el celular, arrastrar el dedo sobre una ventana no mueve la página de atrás: solo se
 * desplaza lo que tiene su propio scroll (y mientras le quede recorrido). Devuelve cómo quitarlo.
 */
export function holdTouchScroll(layer: HTMLElement) {
  let x0 = 0;
  let y0 = 0;
  const start = (e: TouchEvent) => {
    x0 = e.touches[0]?.clientX ?? 0;
    y0 = e.touches[0]?.clientY ?? 0;
  };
  const move = (e: TouchEvent) => {
    if (e.touches.length !== 1 || !e.cancelable) return;
    const dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    // Lo horizontal (fichas que se deslizan, carruseles) no mueve la página: se deja pasar.
    if (Math.abs(dx) > Math.abs(dy)) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest(NATIVE)) return;
    for (let el = target as HTMLElement | null; el && el !== layer; el = el.parentElement)
      if (canScroll(el, dy)) return;
    e.preventDefault();
  };
  layer.addEventListener('touchstart', start, { passive: true });
  layer.addEventListener('touchmove', move, { passive: false });
  return () => {
    layer.removeEventListener('touchstart', start);
    layer.removeEventListener('touchmove', move);
  };
}
