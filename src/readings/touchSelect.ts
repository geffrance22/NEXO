import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { touchFirst } from "../hooks/useMobile";

/**
 * Selección de texto propia para el artículo en Android.
 *
 * Chrome en Android abre su barra de Google («Tocar para buscar») cada vez que mantienes pulsado
 * un texto seleccionable, y no hay forma de pedirle que no lo haga: solo se calla con texto que
 * no se puede seleccionar (`user-select: none`). Así que el artículo deja de ser seleccionable
 * para el sistema y Nexo selecciona por su cuenta:
 *
 * - Mantener pulsado una palabra la selecciona (con una vibración corta); sin soltar, al mover
 *   el dedo la selección crece.
 * - Dos asas, como las del sistema, ajustan el principio y el final. Cerca de los bordes, el
 *   artículo se desplaza solo.
 * - Se pinta con la API de resaltados de CSS: no toca el texto ni el DOM del artículo.
 * - Al soltar, avisa con el tramo elegido; lo demás (la barra de resaltar) sigue igual.
 */

const HOLD_MS = 420;
/** Si el dedo se mueve más que esto antes de tiempo, es un desplazamiento. */
const SLOP = 9;
const NAME = "rd-touch-sel";

export type TouchSelection = {
  /** El tramo seleccionado como `Range` del DOM (para colocar la barra), o null. */
  range: () => Range | null;
  active: () => boolean;
  clear: () => void;
};

/** Solo donde está la barra de Google (Chrome en Android) y el navegador sabe pintar resaltados. */
export const touchSelectSupported = () =>
  typeof window !== "undefined" &&
  /Android/i.test(navigator.userAgent) &&
  touchFirst() &&
  typeof CSS !== "undefined" &&
  "highlights" in CSS &&
  typeof Highlight !== "undefined";

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

type Piece = { start: number; node: Text; el: HTMLElement };
type Span = { start: number; end: number };

export function useTouchSelect({
  on,
  articleId,
  article,
  pane,
  content,
  api,
  onSelect,
  onDismiss,
}: {
  on: boolean;
  /** El artículo abierto (cada uno monta su propio lector). */
  articleId: string;
  article: RefObject<HTMLElement | null>;
  pane: () => HTMLElement | null;
  /** El texto del artículo (las posiciones son las de `content`). */
  content: string;
  /** Donde queda el control (lo usa Readings para leerla o quitarla). */
  api: MutableRefObject<TouchSelection | null>;
  onSelect: (range: Range) => void;
  /** Un toque fuera de la selección: Readings decide si cierra la barra. */
  onDismiss: () => void;
}) {
  // Lo último de cada render, para los escuchas (sin volver a crearlos).
  const latest = useRef({ content, onSelect, onDismiss });
  latest.current = { content, onSelect, onDismiss };

  useEffect(() => {
    const root = article.current;
    const pane0 = pane();
    if (!on || !root || !pane0) {
      api.current = null;
      return;
    }
    const scroller: HTMLElement = pane0;
    const now = () => latest.current;

    // ── El texto pintado y dónde vive cada trozo ──
    let pieces: Piece[] = [];
    let stale = true;
    const read = () => {
      if (!stale) return pieces;
      stale = false;
      pieces = [];
      for (const el of root.querySelectorAll<HTMLElement>("[data-offset]")) {
        const node = el.firstChild;
        if (node instanceof Text && node.length)
          pieces.push({ start: Number(el.dataset.offset), node, el });
      }
      return pieces;
    };
    const watch = new MutationObserver(() => {
      stale = true;
      frame(paint);
    });
    watch.observe(root, { childList: true, subtree: true, characterData: true });

    /** Nodo y desplazamiento del DOM para una posición del texto. */
    const domAt = (offset: number, preferEnd: boolean) => {
      const list = read();
      if (!list.length) return null;
      let lo = 0;
      let hi = list.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (list[mid].start < offset || (!preferEnd && list[mid].start === offset)) lo = mid;
        else hi = mid - 1;
      }
      const p = list[lo];
      return { node: p.node, offset: Math.min(Math.max(0, offset - p.start), p.node.length) };
    };
    const rangeOf = (s: Span) => {
      const a = domAt(s.start, false);
      const b = domAt(s.end, true);
      if (!a || !b) return null;
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      return r.collapsed ? null : r;
    };

    // ── Qué letra hay bajo un punto (sin depender de la selección del sistema) ──
    const probe = document.createRange();
    const charBox = (node: Text, i: number) => {
      probe.setStart(node, i);
      probe.setEnd(node, i + 1);
      const rects = probe.getClientRects();
      return rects.length ? rects[rects.length - 1] : probe.getBoundingClientRect();
    };
    /** Posición del texto (entre letras) más cercana al punto. */
    const hit = (x: number, y: number): number | null => {
      const list = read();
      if (!list.length) return null;
      // El primer trozo que termina debajo del punto.
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const rects = list[mid].el.getClientRects();
        const bottom = rects.length ? rects[rects.length - 1].bottom : 0;
        if (bottom <= y) lo = mid + 1;
        else hi = mid;
      }
      if (lo >= list.length) {
        const last = list[list.length - 1];
        return last.start + last.node.length;
      }
      // En una misma línea puede haber varios trozos (negritas, enlaces): el que está bajo el dedo.
      let pick = lo;
      for (let i = lo; i < Math.min(list.length, lo + 40); i++) {
        const rects = list[i].el.getClientRects();
        if (!rects.length) continue;
        if (rects[0].top > y) break;
        if ([...rects].some((r) => r.top <= y && r.bottom > y && r.left <= x)) pick = i;
      }
      const { node, start } = list[pick];
      // Búsqueda binaria: la primera letra que no queda antes del punto.
      let a = 0;
      let b = node.length;
      while (a < b) {
        const mid = (a + b) >> 1;
        const r = charBox(node, mid);
        const before = y >= r.bottom || (y >= r.top && x >= r.right);
        if (before) a = mid + 1;
        else b = mid;
      }
      if (a < node.length) {
        const r = charBox(node, a);
        if (y >= r.top && y < r.bottom && x > (r.left + r.right) / 2) a += 1;
      }
      return start + a;
    };

    const wordAt = (offset: number): Span | null => {
      const text = now().content;
      let i = offset;
      if (!isWordChar(text[i]) && isWordChar(text[i - 1])) i -= 1;
      if (!isWordChar(text[i])) return null;
      let s = i;
      let e = i + 1;
      for (let n = 0; n < 60 && s > 0 && isWordChar(text[s - 1]); n++) s--;
      for (let n = 0; n < 60 && e < text.length && isWordChar(text[e]); n++) e++;
      return { start: s, end: e };
    };
    /** Al soltar, a palabras completas (como quedan los resaltados). */
    const snap = (s: Span): Span => {
      const text = now().content;
      let { start, end } = s;
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      if (isWordChar(text[start]))
        for (let n = 0; n < 60 && start > 0 && isWordChar(text[start - 1]); n++) start--;
      if (isWordChar(text[end - 1]))
        for (let n = 0; n < 60 && end < text.length && isWordChar(text[end]); n++) end++;
      return end > start ? { start, end } : s;
    };

    // ── Pintar: el resaltado y las dos asas ──
    let sel: Span | null = null;
    const handle = (side: "start" | "end") => {
      const el = document.createElement("div");
      el.className = `rd-th ${side}`;
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = "<i></i>";
      document.body.append(el);
      return el;
    };
    const handles = { start: handle("start"), end: handle("end") };
    const visibleTop = () =>
      scroller.getBoundingClientRect().top +
      (scroller.querySelector(".read-tools")?.getBoundingClientRect().height ?? 0);
    let raf = 0;
    function frame(fn: () => void) {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        fn();
      });
    }
    function place(el: HTMLElement, x: number, y: number, show: boolean) {
      el.classList.toggle("on", show);
      if (show) el.style.transform = `translate(${x}px, ${y}px)`;
    }
    function paint() {
      const r = sel && rangeOf(sel);
      if (!r) {
        CSS.highlights.delete(NAME);
        place(handles.start, 0, 0, false);
        place(handles.end, 0, 0, false);
        return;
      }
      CSS.highlights.set(NAME, new Highlight(r));
      const rects = [...r.getClientRects()].filter((b) => b.width || b.height);
      const first = rects[0];
      const last = rects[rects.length - 1];
      const top = visibleTop();
      const bottom = scroller.getBoundingClientRect().bottom;
      const inView = (y: number) => y > top && y < bottom;
      if (first) place(handles.start, first.left, first.bottom, inView(first.bottom));
      if (last) place(handles.end, last.right, last.bottom, inView(last.bottom));
    }
    const set = (next: Span | null) => {
      sel = next;
      paint();
    };
    const announce = () => {
      const r = sel && rangeOf(sel);
      if (r) now().onSelect(r);
    };

    // ── Desplazar solo cerca de los bordes mientras arrastras ──
    let drag: "extend" | "start" | "end" | null = null;
    let anchor: Span | null = null;
    let point = { x: 0, y: 0 };
    let lift = 0; // de la punta del asa a la línea de texto
    let scrolling = 0;
    function follow() {
      if (!drag) return;
      const p = point;
      const off = hit(p.x, p.y - lift);
      if (off !== null && sel) {
        if (drag === "extend" && anchor)
          set({ start: Math.min(anchor.start, off), end: Math.max(anchor.end, off) });
        else if (drag === "start")
          set({ start: Math.min(off, sel.end - 1), end: sel.end });
        else if (drag === "end")
          set({ start: sel.start, end: Math.max(off, sel.start + 1) });
      }
    }
    function autoscroll() {
      cancelAnimationFrame(scrolling);
      if (!drag) return;
      const top = visibleTop();
      const bottom = scroller.getBoundingClientRect().bottom;
      const edge = 56;
      const y = point.y;
      const speed =
        y > bottom - edge ? (y - (bottom - edge)) / 4 : y < top + edge ? -(top + edge - y) / 4 : 0;
      if (speed) {
        scroller.scrollTop += Math.max(-18, Math.min(18, speed));
        follow();
      }
      scrolling = requestAnimationFrame(autoscroll);
    }
    const stopDrag = () => {
      cancelAnimationFrame(scrolling);
      const was = drag;
      drag = null;
      anchor = null;
      if (was && sel) {
        set(snap(sel));
        announce();
      }
    };

    // ── Mantener pulsado ──
    let timer = 0;
    let start = { x: 0, y: 0 };
    // Este toque fue una pulsación larga: al soltar no abre el enlace que hubiera debajo.
    let held = false;
    let moved = false;
    const onStart = (e: TouchEvent) => {
      window.clearTimeout(timer);
      held = false;
      if (e.touches.length !== 1) {
        if (drag === "extend") stopDrag();
        return;
      }
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      moved = false;
      timer = window.setTimeout(() => {
        timer = 0;
        const off = hit(start.x, start.y);
        const word = off === null ? null : wordAt(off);
        if (!word) return;
        held = true;
        navigator.vibrate?.(8);
        anchor = word;
        drag = "extend";
        point = { ...start };
        lift = 0;
        set(word);
        autoscroll();
      }, HOLD_MS);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (timer && Math.hypot(t.clientX - start.x, t.clientY - start.y) > SLOP) {
        window.clearTimeout(timer);
        timer = 0;
        moved = true;
      }
      if (drag === "extend") {
        // El dedo ahora estira la selección: la página no se desplaza.
        if (e.cancelable) e.preventDefault();
        point = { x: t.clientX, y: t.clientY };
        frame(follow);
      }
    };
    const onEnd = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
        // Un toque (sin mantener): fuera de la selección, la quita.
        if (!moved && sel) now().onDismiss();
        return;
      }
      if (drag === "extend") stopDrag();
    };
    // Ni el menú del sistema ni abrir un enlace justo después de mantener pulsado.
    const onMenu = (e: Event) => e.preventDefault();
    const onClick = (e: Event) => {
      if (!held) return;
      held = false;
      e.preventDefault();
      e.stopPropagation();
    };

    // ── Asas ──
    const grab = (side: "start" | "end") => (e: TouchEvent) => {
      if (!sel || e.touches.length !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      const t = e.touches[0];
      const r = rangeOf(sel);
      const rects = r ? [...r.getClientRects()] : [];
      const box = side === "start" ? rects[0] : rects[rects.length - 1];
      // Se apunta a la mitad de la línea, no a la punta del asa (que queda bajo el texto).
      lift = box ? t.clientY - box.bottom + box.height / 2 : 12;
      drag = side;
      point = { x: t.clientX, y: t.clientY };
      handles[side].classList.add("drag");
      autoscroll();
    };
    const pull = (e: TouchEvent) => {
      if (!drag || drag === "extend") return;
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      point = { x: t.clientX, y: t.clientY };
      frame(follow);
    };
    const drop = () => {
      handles.start.classList.remove("drag");
      handles.end.classList.remove("drag");
      if (drag && drag !== "extend") stopDrag();
    };
    const grabStart = grab("start");
    const grabEnd = grab("end");
    for (const [el, fn] of [
      [handles.start, grabStart],
      [handles.end, grabEnd],
    ] as const) {
      el.addEventListener("touchstart", fn, { passive: false });
      el.addEventListener("touchmove", pull, { passive: false });
      el.addEventListener("touchend", drop);
      el.addEventListener("touchcancel", drop);
    }

    // Un toque fuera del artículo (y fuera de la barra de resaltar): Readings decide.
    const outside = (e: TouchEvent) => {
      if (!sel) return;
      const target = e.target as Element | null;
      if (
        !target ||
        root.contains(target) ||
        target.closest?.(".rd-th, .rd-marktools, dialog, [role='dialog']")
      )
        return;
      now().onDismiss();
    };
    const onScroll = () => frame(paint);

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", onEnd);
    root.addEventListener("contextmenu", onMenu);
    root.addEventListener("click", onClick, true);
    document.addEventListener("touchstart", outside, { capture: true, passive: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    api.current = {
      range: () => (sel ? rangeOf(sel) : null),
      active: () => sel !== null,
      clear: () => {
        drag = null;
        anchor = null;
        set(null);
      },
    };

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(scrolling);
      watch.disconnect();
      CSS.highlights.delete(NAME);
      handles.start.remove();
      handles.end.remove();
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
      root.removeEventListener("contextmenu", onMenu);
      root.removeEventListener("click", onClick, true);
      document.removeEventListener("touchstart", outside, true);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      api.current = null;
    };
  }, [on, articleId]);
}
