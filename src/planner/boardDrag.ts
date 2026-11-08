import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

/**
 * Arrastre de Tableros: tarjetas entre columnas y columnas desde su encabezado. Con el ratón
 * empieza al mover unos píxeles; en pantallas táctiles, al mantener pulsado. Mientras arrastras
 * se ve un hueco donde caerá, el resto se aparta con una animación y el tablero (o la columna) se
 * desplaza solo al acercarte a los bordes.
 */

export type Drag =
  | { kind: 'card'; id: string; list: string; before: string | null; w: number; h: number }
  | { kind: 'list'; id: string; before: string | null; w: number; h: number };

type Start =
  | { kind: 'card'; id: string; list: string; before: string | null }
  | { kind: 'list'; id: string; before: string | null };

type Pending = Start & {
  x: number;
  y: number;
  pointer: number;
  touch: boolean;
  el: HTMLElement;
  timer: number;
};

const EDGE = 72;
const NO_DRAG = '[data-nodrag], input, textarea, select, a[href]';

export function useBoardDrag(canvas: RefObject<HTMLDivElement | null>, onDrop: (d: Drag) => void) {
  const [drag, setDragState] = useState<Drag | null>(null);
  const current = useRef<Drag | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const grab = useRef({ x: 0, y: 0 });
  const pending = useRef<Pending | null>(null);
  const frame = useRef(0);
  // El clic que llega justo después de soltar no debe abrir nada.
  const justDropped = useRef(false);
  const drop = useRef(onDrop);
  drop.current = onDrop;

  const setDrag = (d: Drag | null) => {
    current.current = d;
    setDragState(d);
  };

  /** Dónde caería ahora lo que arrastras. */
  const target = () => {
    const root = canvas.current;
    const d = current.current;
    if (!root || !d) return;
    const { x, y } = pointer.current;
    const box = root.getBoundingClientRect();
    if (d.kind === 'list') {
      const cols = [...root.querySelectorAll<HTMLElement>('[data-list]')];
      const before =
        cols.find((el) => box.left + el.offsetLeft - root.scrollLeft + el.offsetWidth / 2 > x)
          ?.dataset.list ?? null;
      if (before !== d.before) setDrag({ ...d, before });
      return;
    }
    // La columna más cercana en horizontal (las plegadas no reciben tarjetas).
    let best: HTMLElement | null = null;
    let dist = Infinity;
    for (const el of root.querySelectorAll<HTMLElement>('[data-list]:has([data-stack])')) {
      const r = el.getBoundingClientRect();
      const gap = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (gap < dist) {
        dist = gap;
        best = el;
      }
    }
    const stack = best?.querySelector<HTMLElement>('[data-stack]');
    if (!best || !stack) return;
    const top = stack.getBoundingClientRect().top - stack.scrollTop;
    const before =
      [...stack.querySelectorAll<HTMLElement>('[data-card]')].find(
        (el) => top + el.offsetTop + el.offsetHeight / 2 > y,
      )?.dataset.card ?? null;
    const list = best.dataset.list!;
    if (list !== d.list || before !== d.before) setDrag({ ...d, list, before });
  };

  /** Cada cuadro: mueve la copia, desplaza en los bordes y recalcula el destino. */
  const tick = () => {
    const d = current.current;
    const root = canvas.current;
    if (!d || !root) return;
    const { x, y } = pointer.current;
    if (ghost.current)
      ghost.current.style.transform = `translate3d(${x - grab.current.x}px, ${y - grab.current.y}px, 0)`;
    const box = root.getBoundingClientRect();
    if (x < box.left + EDGE) root.scrollLeft -= Math.ceil((box.left + EDGE - x) / 4);
    else if (x > box.right - EDGE) root.scrollLeft += Math.ceil((x - box.right + EDGE) / 4);
    if (d.kind === 'card') {
      const stack = root.querySelector<HTMLElement>(`[data-list="${d.list}"] [data-stack]`);
      if (stack) {
        const r = stack.getBoundingClientRect();
        if (x >= r.left - 20 && x <= r.right + 20) {
          if (y < r.top + 48) stack.scrollTop -= Math.ceil((r.top + 48 - y) / 3);
          else if (y > r.bottom - 48) stack.scrollTop += Math.ceil((y - r.bottom + 48) / 3);
        }
      }
    }
    target();
    frame.current = requestAnimationFrame(tick);
  };

  const stopTouchScroll = (e: TouchEvent) => {
    if (current.current) e.preventDefault();
  };

  const begin = (p: Pending) => {
    const r = p.el.getBoundingClientRect();
    grab.current = { x: p.x - r.left, y: p.y - r.top };
    pending.current = null;
    document.body.classList.add('bd-dragging');
    if (p.touch) navigator.vibrate?.(8);
    setDrag(
      p.kind === 'card'
        ? { kind: 'card', id: p.id, list: p.list, before: p.before, w: r.width, h: r.height }
        : { kind: 'list', id: p.id, before: p.before, w: r.width, h: r.height },
    );
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
  };

  const finish = (commit: boolean) => {
    const d = current.current;
    cancelAnimationFrame(frame.current);
    document.body.classList.remove('bd-dragging');
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    if (!d) return;
    justDropped.current = true;
    window.setTimeout(() => (justDropped.current = false), 0);
    setDrag(null);
    if (commit) drop.current(d);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p && !current.current) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      if (p && e.pointerId === p.pointer) {
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        // En táctil, moverse antes de tiempo es desplazarse (no arrastrar).
        if (p.touch && moved > 10) {
          window.clearTimeout(p.timer);
          pending.current = null;
        } else if (!p.touch && moved > 5) begin(p);
      }
    };
    const up = (e: PointerEvent) => {
      if (pending.current && e.pointerId === pending.current.pointer) {
        window.clearTimeout(pending.current.timer);
        pending.current = null;
      }
      if (current.current) finish(e.type === 'pointerup');
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && current.current) {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, true);
    document.addEventListener('touchmove', stopTouchScroll, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('touchmove', stopTouchScroll);
      cancelAnimationFrame(frame.current);
      document.body.classList.remove('bd-dragging');
    };
  }, []);

  /** Para el `onPointerDown` de una tarjeta o del encabezado de una columna. */
  const start = (e: ReactPointerEvent<HTMLElement>, what: Start) => {
    if (e.button !== 0 || current.current) return;
    if ((e.target as HTMLElement).closest(NO_DRAG)) return;
    const touch = e.pointerType === 'touch';
    const p: Pending = {
      ...what,
      x: e.clientX,
      y: e.clientY,
      pointer: e.pointerId,
      touch,
      el: e.currentTarget,
      timer: 0,
    };
    pointer.current = { x: e.clientX, y: e.clientY };
    if (touch) p.timer = window.setTimeout(() => pending.current === p && begin(p), 280);
    pending.current = p;
  };

  return {
    drag,
    start,
    ghost,
    /** Posición inicial de la copia (antes del primer cuadro). */
    ghostAt: () =>
      `translate3d(${pointer.current.x - grab.current.x}px, ${pointer.current.y - grab.current.y}px, 0)`,
    wasDrag: () => justDropped.current,
  };
}

/**
 * Animación de reacomodo: lo que cambia de sitio (al abrir un hueco, añadir o mover) se desliza
 * desde donde estaba. Mide por `offsetLeft/Top`, que no cambian al desplazar la columna.
 */
export function useFlip(root: RefObject<HTMLElement | null>) {
  const prev = useRef(new Map<string, { x: number; y: number; parent: Element | null }>());
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const next = new Map<string, { x: number; y: number; parent: Element | null }>();
    const moved: [HTMLElement, number, number][] = [];
    for (const node of el.querySelectorAll<HTMLElement>('[data-flip]')) {
      const key = node.dataset.flip!;
      const pos = { x: node.offsetLeft, y: node.offsetTop, parent: node.parentElement };
      next.set(key, pos);
      const old = prev.current.get(key);
      if (old && old.parent === pos.parent && (old.x !== pos.x || old.y !== pos.y))
        moved.push([node, old.x - pos.x, old.y - pos.y]);
    }
    prev.current = next;
    if (!moved.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [node, dx, dy] of moved) {
      node.style.transition = 'none';
      node.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    // Una lectura de diseño fija la posición de partida antes de animar.
    void el.offsetWidth;
    for (const [node] of moved) {
      node.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      node.style.transform = '';
      node.addEventListener('transitionend', () => (node.style.transition = ''), { once: true });
    }
  });
}
