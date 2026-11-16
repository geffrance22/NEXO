import { useEffect, useRef } from "react";
import { READER_SIZES } from "./ReaderSettings";

const MIN = READER_SIZES[0];
const MAX = READER_SIZES[READER_SIZES.length - 1];
/** Cuánto hay que abrir o cerrar los dedos antes de que cambie la letra (evita cambios sin querer). */
const DEAD_ZONE = 0.04;
/** Más allá del mínimo o del máximo la letra se resiste un poco y vuelve al soltar. */
const STRETCH = 0.18;
const OVERSHOOT = 1.6;

const nearest = (px: number) =>
  READER_SIZES.reduce((best, s) => (Math.abs(s - px) < Math.abs(best - px) ? s : best));

type Caret = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** Un carácter del texto bajo el punto: lo que tienes bajo los dedos sigue ahí al cambiar la letra. */
function charAt(x: number, y: number, inside: HTMLElement) {
  const d = document as Caret;
  let node: Node | null = null;
  let offset = 0;
  const pos = d.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const r = d.caretRangeFromPoint?.(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!(node instanceof Text) || !inside.contains(node) || !node.length) return null;
  const range = document.createRange();
  const at = Math.min(offset, node.length - 1);
  range.setStart(node, at);
  range.setEnd(node, at + 1);
  return range;
}

/** Lo primero visible del artículo, si los dedos no caen sobre texto. */
function firstVisible(article: HTMLElement, top: number) {
  for (const el of article.querySelectorAll<HTMLElement>("[data-offset], img")) {
    if (el.getBoundingClientRect().bottom > top) return el;
  }
  return null;
}

/** Indicador del tamaño mientras pellizcas: «A ━━●── A  20». */
function makeBadge(top: number) {
  const el = document.createElement("div");
  el.className = "rd-pinch";
  el.setAttribute("aria-hidden", "true");
  el.style.top = `${top}px`;
  el.innerHTML =
    '<span class="rd-pinch-a">A</span><span class="rd-pinch-track"><i></i></span>' +
    '<span class="rd-pinch-a big">A</span><b></b>';
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("on"));
  return el;
}

/**
 * Pellizcar el artículo cambia el tamaño de la letra (celular). Mientras se abren o cierran los
 * dedos la letra crece o se achica sin saltos y el texto bajo los dedos no se mueve; al soltar se
 * ajusta al tamaño más cercano de «Aa» y se guarda.
 */
export function usePinchSize({
  on,
  id,
  size,
  commit,
}: {
  on: boolean;
  /** El artículo abierto (cada uno monta su propio lector). */
  id: string;
  size: number;
  commit: (size: number) => void;
}) {
  const latest = useRef({ size, commit });
  latest.current = { size, commit };

  useEffect(() => {
    if (!on) return;
    const pane = document.querySelector<HTMLElement>(".readings > main");
    const root = pane?.closest<HTMLElement>(".readings");
    if (!pane || !root) return;

    let pinch: {
      dist: number;
      midY: number;
      size: number;
      live: boolean;
      anchor: () => DOMRect | null;
      anchorTop: number;
      badge: HTMLElement | null;
      step: number;
    } | null = null;
    let frame = 0;
    let next = 0;
    let midY = 0;

    const spread = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const middle = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    });
    const allowed = (target: EventTarget | null) =>
      target instanceof Element &&
      pane.contains(target) &&
      !target.closest('dialog, [role="dialog"], .read-tools, .rd-marktools, input, textarea');

    /** Pone el tamaño y desplaza para que el texto bajo los dedos siga bajo los dedos. */
    function apply(px: number) {
      if (!pinch) return;
      root!.style.setProperty("--rd-size", `${px.toFixed(2)}px`);
      const box = pinch.anchor();
      if (box) pane!.scrollTop += box.top - (pinch.anchorTop + (midY - pinch.midY));
      const badge = pinch.badge;
      if (badge) {
        const shown = nearest(Math.min(MAX, Math.max(MIN, px)));
        badge.querySelector("b")!.textContent = String(shown);
        badge.style.setProperty("--p", String((Math.min(MAX, Math.max(MIN, px)) - MIN) / (MAX - MIN)));
        badge.classList.toggle("edge", px < MIN - 0.3 || px > MAX + 0.3);
        // Un toque suave en cada tamaño (Android), como las ruedas de los ajustes del sistema.
        if (shown !== pinch.step) {
          pinch.step = shown;
          navigator.vibrate?.(6);
        }
      }
    }

    function start(e: TouchEvent) {
      if (e.touches.length !== 2 || pinch) return;
      if (!allowed(e.touches[0].target) || !allowed(e.touches[1].target)) return;
      const article = pane!.querySelector<HTMLElement>("article");
      if (!article) return;
      const { x, y } = middle(e.touches);
      const char = charAt(x, y, article);
      const el = char ? null : firstVisible(article, pane!.getBoundingClientRect().top + 60);
      const anchor = () => {
        if (char) return char.getClientRects()[0] ?? char.getBoundingClientRect();
        return el?.getBoundingClientRect() ?? null;
      };
      const size = latest.current.size;
      midY = y;
      pinch = {
        dist: spread(e.touches),
        midY: y,
        size,
        live: false,
        anchor,
        anchorTop: anchor()?.top ?? 0,
        badge: null,
        step: size,
      };
    }

    function move(e: TouchEvent) {
      if (!pinch || e.touches.length !== 2) return;
      // Ni el zoom de la página ni el desplazamiento con dos dedos: el gesto es de la letra.
      if (e.cancelable) e.preventDefault();
      const ratio = spread(e.touches) / pinch.dist;
      midY = middle(e.touches).y;
      if (!pinch.live) {
        if (Math.abs(ratio - 1) < DEAD_ZONE) return;
        pinch.live = true;
        root!.dataset.pinching = "";
        window.getSelection()?.removeAllRanges();
        const top = pane!.getBoundingClientRect().top;
        pinch.badge = makeBadge(top + 70);
      }
      let px = pinch.size * ratio;
      if (px > MAX) px = Math.min(MAX + OVERSHOOT, MAX + (px - MAX) * STRETCH);
      else if (px < MIN) px = Math.max(MIN - OVERSHOOT, MIN - (MIN - px) * STRETCH);
      next = px;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          apply(next);
        });
    }

    function end(e: TouchEvent) {
      if (!pinch || e.touches.length >= 2) return;
      const done = pinch;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (!done.live) {
        pinch = null;
        return;
      }
      const snapped = nearest(Math.min(MAX, Math.max(MIN, next || done.size)));
      apply(snapped);
      root!.style.setProperty("--rd-size", `${snapped}px`);
      pinch = null;
      // Sin la transición del tamaño hasta el siguiente cuadro: el ajuste final no se arrastra.
      requestAnimationFrame(() => delete root!.dataset.pinching);
      const badge = done.badge;
      if (badge) {
        window.setTimeout(() => badge.classList.remove("on"), 420);
        window.setTimeout(() => badge.remove(), 760);
      }
      if (snapped !== latest.current.size) latest.current.commit(snapped);
    }

    // Safari (iPhone) tiene su propio gesto de zoom: se cancela dentro del lector.
    const gesture = (e: Event) => {
      if (allowed(e.target)) e.preventDefault();
    };

    pane.addEventListener("touchstart", start, { passive: true });
    pane.addEventListener("touchmove", move, { passive: false });
    pane.addEventListener("touchend", end, { passive: true });
    pane.addEventListener("touchcancel", end, { passive: true });
    pane.addEventListener("gesturestart", gesture, { passive: false });
    pane.addEventListener("gesturechange", gesture, { passive: false });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      pinch?.badge?.remove();
      delete root.dataset.pinching;
      pane.removeEventListener("touchstart", start);
      pane.removeEventListener("touchmove", move);
      pane.removeEventListener("touchend", end);
      pane.removeEventListener("touchcancel", end);
      pane.removeEventListener("gesturestart", gesture);
      pane.removeEventListener("gesturechange", gesture);
    };
  }, [on, id]);
}
