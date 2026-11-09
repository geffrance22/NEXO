import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Distancia (px) que hay que mover el ratón para empezar a arrastrar. */
const MOUSE_SLOP = 6;
/** En pantallas táctiles se arrastra tras mantener pulsado (así no estorba al desplazarse). */
const HOLD_MS = 320;
const TOUCH_SLOP = 9;
const EDGE = 70;

type Drag = { id: string; group: string; order: string[] };

/**
 * Reordenar tarjetas arrastrándolas en una rejilla. La tarjeta original queda como hueco y una
 * copia sigue al puntero; al pasar sobre otra tarjeta del mismo grupo, el hueco se mueve ahí.
 * Al soltar, `onDrop` recibe el orden nuevo del grupo.
 */
export function useDragSort(onDrop: (group: string, order: string[], moved: string) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  live.current = drag;
  const drop = useRef(onDrop);
  drop.current = onDrop;
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const start = (e: ReactPointerEvent<HTMLElement>, id: string, group: string, ids: string[]) => {
    if (e.button !== 0 || cleanup.current) return;
    const target = e.target as HTMLElement;
    // Botones, casillas, enlaces y menús siguen funcionando como siempre.
    if (target.closest('button, input, textarea, a, select, label, .kp-pop')) return;
    const brick = e.currentTarget;
    const touch = e.pointerType !== 'mouse';
    const x0 = e.clientX;
    const y0 = e.clientY;
    let x = x0;
    let y = y0;
    let ghost: HTMLElement | null = null;
    let dx = 0;
    let dy = 0;
    let lastOver = '';
    let hold = 0;
    let raf = 0;
    const from = ids.indexOf(id);
    if (from < 0) return;

    const place = () => {
      if (ghost) ghost.style.transform = `translate(${x - dx}px, ${y - dy}px) rotate(1.2deg)`;
    };
    const scrollLoop = () => {
      const h = window.innerHeight;
      const speed = y < EDGE ? -(EDGE - y) / 4 : y > h - EDGE ? (y - (h - EDGE)) / 4 : 0;
      if (speed) window.scrollBy(0, speed);
      raf = requestAnimationFrame(scrollLoop);
    };
    const begin = () => {
      const r = brick.getBoundingClientRect();
      dx = x - r.left;
      dy = y - r.top;
      ghost = brick.cloneNode(true) as HTMLElement;
      ghost.classList.add('kp-ghost');
      ghost.removeAttribute('data-id');
      ghost.style.width = r.width + 'px';
      ghost.setAttribute('aria-hidden', 'true');
      document.body.appendChild(ghost);
      document.body.classList.add('kp-dragging');
      // Lo que se alcanzó a seleccionar antes de arrastrar.
      window.getSelection()?.removeAllRanges();
      place();
      navigator.vibrate?.(12);
      setDrag({ id, group, order: ids });
      raf = requestAnimationFrame(scrollLoop);
    };
    const over = () => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-id]');
      const other = el?.dataset.id;
      if (!el || !other || other === lastOver || el.dataset.group !== group) return;
      lastOver = other;
      if (other === id) return;
      const cur = live.current;
      if (!cur) return;
      const without = cur.order.filter((x) => x !== id);
      const at = without.indexOf(other);
      const ahead = cur.order.indexOf(id) < cur.order.indexOf(other);
      without.splice(ahead ? at + 1 : at, 0, id);
      setDrag({ ...cur, order: without });
    };

    const move = (ev: PointerEvent) => {
      x = ev.clientX;
      y = ev.clientY;
      if (!ghost) {
        const far = Math.hypot(x - x0, y - y0);
        if (touch) {
          if (far > TOUCH_SLOP) end(false);
        } else if (far > MOUSE_SLOP) begin();
        return;
      }
      place();
      over();
    };
    const blockTouch = (ev: TouchEvent) => {
      if (ghost) ev.preventDefault();
    };
    const swallowClick = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    const end = (commit: boolean) => {
      window.clearTimeout(hold);
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('touchmove', blockTouch);
      cleanup.current = null;
      if (!ghost) return;
      ghost.remove();
      ghost = null;
      document.body.classList.remove('kp-dragging');
      // El clic que sigue a soltar no debe abrir la nota.
      window.addEventListener('click', swallowClick, {
        capture: true,
        once: true,
      });
      window.setTimeout(() => window.removeEventListener('click', swallowClick, true), 0);
      const cur = live.current;
      setDrag(null);
      if (commit && cur && cur.order.join() !== ids.join()) drop.current(group, cur.order, id);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      end(false);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    window.addEventListener('touchmove', blockTouch, { passive: false });
    if (touch) hold = window.setTimeout(begin, HOLD_MS);
    cleanup.current = () => end(false);
  };

  return { drag, start };
}
