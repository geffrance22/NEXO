import { useEffect, useRef, type RefObject } from "react";

/**
 * Barra fina de progreso bajo la barra del artículo (celular). Se mide en cada cuadro sin volver
 * a pintar Lecturas.
 */
export function ReadProgress({
  article,
  pane,
}: {
  article: RefObject<HTMLElement | null>;
  pane: () => HTMLElement | null;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLElement>(null);

  useEffect(() => {
    const scroller = pane();
    const text = article.current;
    if (!scroller || !text) return;
    let frame = 0;

    function measure() {
      frame = 0;
      const host = bar.current?.parentElement;
      if (!text!.isConnected || !fill.current) return;
      const head = host?.getBoundingClientRect().height ?? 0;
      const view = scroller!.getBoundingClientRect();
      const box = text!.getBoundingClientRect();
      const span = box.height - (scroller!.clientHeight - head);
      const done = span <= 0 ? 1 : Math.min(1, Math.max(0, (view.top + head - box.top) / span));
      fill.current.style.transform = `scaleX(${done})`;
      bar.current?.setAttribute("aria-valuenow", String(Math.round(done * 100)));
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // El texto cambia de alto al cargar imágenes o al cambiar la letra: la barra se recalcula.
    const resize = new ResizeObserver(schedule);
    resize.observe(text);
    scroller.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      scroller.removeEventListener("scroll", schedule);
    };
  }, []);

  return (
    <div
      ref={bar}
      className="rd-prog"
      role="progressbar"
      aria-label="Progreso de lectura"
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i ref={fill} />
    </div>
  );
}
