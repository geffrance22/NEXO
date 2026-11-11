import { useEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';

const INTERACTIVE =
  'button, a, input, textarea, select, label, summary, [role="button"], [role="radio"], [contenteditable="true"]';

type Options = {
  /** Sus hijos directos con `data-drag-key` se pueden reordenar. */
  container: RefObject<HTMLElement | null>;
  /** ¿Se puede agarrar el bloque desde este punto? */
  handle: (target: HTMLElement, item: HTMLElement, e: PointerEvent) => boolean;
  /** Ponerlo antes (o después) de otro. */
  onMove: (key: string, target: string, after: boolean) => void;
  enabled?: boolean;
  /** Con el dedo también (solo si el agarre es un ícono propio; si no, impediría desplazarse). */
  touch?: boolean;
  /** Lo que se desplaza mientras arrastras cerca del borde (por defecto, la ventana). */
  scroller?: () => HTMLElement | null;
};

/**
 * Reordenar una lista vertical arrastrando: el bloque sigue al puntero y los demás se apartan con
 * una transición suave. Al soltar, se acomoda en su hueco y solo entonces cambia el orden.
 */
export function useDragList(o: Options) {
  const opts = useRef(o);
  opts.current = o;

  useEffect(() => {
    const root = o.container.current;
    if (!root) return;

    const onDown = (e: PointerEvent) => {
      const cfg = opts.current;
      if (cfg.enabled === false || e.button !== 0) return;
      if (e.pointerType === 'touch' && !cfg.touch) return;
      const target = e.target as HTMLElement;
      const item = target.closest<HTMLElement>('[data-drag-key]');
      if (!item || item.parentElement !== root) return;
      const interactive = target.closest(INTERACTIVE);
      if (interactive && item.contains(interactive) && !interactive.matches('[data-drag-grip]'))
        return;
      if (!cfg.handle(target, item, e)) return;
      start(e, item);
    };

    function start(down: PointerEvent, item: HTMLElement) {
      const items = [...root!.children].filter(
        (el): el is HTMLElement => el instanceof HTMLElement && Boolean(el.dataset.dragKey) && el.offsetHeight > 0,
      );
      const from = items.indexOf(item);
      if (from < 0) return;
      const box0 = root!.getBoundingClientRect().top;
      const tops = items.map((el) => el.getBoundingClientRect().top - box0);
      const heights = items.map((el) => el.offsetHeight);
      const gap =
        items.length > 1 ? Math.max(0, tops[1] - tops[0] - heights[0]) : parseFloat(getComputedStyle(root!).rowGap) || 0;
      const step = heights[from] + gap;
      const startAt = down.clientY - box0;
      let lastY = down.clientY;
      let dragging = false;
      let to = from;
      let raf = 0;
      const stop = (ev: Event) => ev.stopPropagation();

      const offsetFor = (dy: number) => {
        const center = tops[from] + dy + heights[from] / 2;
        let n = 0;
        items.forEach((_, i) => {
          if (i !== from && tops[i] + heights[i] / 2 < center) n++;
        });
        return n;
      };

      const paint = () => {
        const box = root!.getBoundingClientRect().top;
        const dy = lastY - box - startAt;
        item.style.transform = `translate3d(0, ${dy}px, 0)`;
        to = offsetFor(dy);
        items.forEach((el, i) => {
          if (i === from) return;
          let shift = 0;
          if (from < to && i > from && i <= to) shift = -step;
          if (from > to && i >= to && i < from) shift = step;
          el.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
        });
      };

      const scrollLoop = () => {
        raf = 0;
        if (!dragging) return;
        const edge = 70;
        const h = window.innerHeight;
        const speed =
          lastY < edge ? -Math.ceil((edge - lastY) / 5) : lastY > h - edge ? Math.ceil((lastY - (h - edge)) / 5) : 0;
        if (speed) {
          const sc = opts.current.scroller?.();
          if (sc) sc.scrollTop += speed;
          else window.scrollBy(0, speed);
          paint();
          raf = requestAnimationFrame(scrollLoop);
        }
      };

      const onMove = (e: PointerEvent) => {
        lastY = e.clientY;
        if (!dragging) {
          if (Math.abs(e.clientY - down.clientY) < 5 && Math.abs(e.clientX - down.clientX) < 5) return;
          dragging = true;
          root!.classList.add('dl-sorting');
          item.classList.add('dl-dragging');
          document.body.classList.add('dl-grabbing');
        }
        e.preventDefault();
        paint();
        if (!raf) raf = requestAnimationFrame(scrollLoop);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        cancelAnimationFrame(raf);
        document.body.classList.remove('dl-grabbing');
      };
      const reset = () => {
        root!.classList.add('dl-settling');
        items.forEach((el) => (el.style.transform = ''));
        item.classList.remove('dl-dragging');
        root!.classList.remove('dl-sorting');
        requestAnimationFrame(() => root!.classList.remove('dl-settling'));
      };

      const onUp = () => {
        cleanup();
        if (!dragging) return;
        // Que el clic que sigue a soltar no abra nada.
        window.addEventListener('click', stop, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', stop, true), 0);
        // Se acomoda en su hueco y luego cambia el orden de verdad.
        let landing = 0;
        if (to > from) for (let i = from + 1; i <= to; i++) landing += heights[i] + gap;
        else for (let i = to; i < from; i++) landing -= heights[i] + gap;
        item.classList.add('dl-landing');
        item.style.transform = `translate3d(0, ${landing}px, 0)`;
        window.setTimeout(() => {
          item.classList.remove('dl-landing');
          if (to !== from) {
            const key = item.dataset.dragKey!;
            const target = items[to].dataset.dragKey!;
            flushSync(() => opts.current.onMove(key, target, to > from));
          }
          reset();
        }, 170);
      };
      const onCancel = () => {
        cleanup();
        if (dragging) reset();
      };

      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    }

    root.addEventListener('pointerdown', onDown);
    return () => root.removeEventListener('pointerdown', onDown);
  }, [o.container]);
}

/** El agarre de un bloque del panel: su encabezado (o la franja de arriba si no tiene). */
export function headerHandle(target: HTMLElement, item: HTMLElement, e: PointerEvent) {
  if (target.closest('[data-drag-grip]')) return true;
  const top = item.getBoundingClientRect().top;
  const head = target.closest('header, .hc-head, h2, h3');
  if (head && item.contains(head) && head.getBoundingClientRect().top - top < 48) return true;
  return e.clientY - top < 16;
}
