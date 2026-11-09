import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { linkKey, type CardLink } from "./cardLinks";
import "./links.css";

/** Vinculando: la tarjeta de origen, su columna y el gancho que tocaste. */
export type Linking = { id: string; list: string; side: "left" | "right" };

/** Colores suaves para distinguir un vínculo de otro (siempre el mismo para el mismo par). */
const PALETTE = [
  "#5b7cfa",
  "#e07a5f",
  "#2f9e74",
  "#a35fd6",
  "#d39a1c",
  "#2399b3",
  "#d9578c",
];
export function linkColor(l: CardLink) {
  let h = 0;
  for (const ch of linkKey(l)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

type Seg = {
  key: string;
  link: CardLink;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Columnas una al lado de la otra: se dibuja el lazo. Si no, solo un punto en cada tarjeta. */
  near: boolean;
  /** Alguna de las dos queda fuera de la vista de su columna (el lazo llega al borde). */
  clipped: boolean;
};
type Geometry = {
  segs: Seg[];
  rubber: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    dir: 1 | -1;
  } | null;
};

/** Curva suave entre dos bordes: sale y llega en horizontal. */
function curve(x1: number, y1: number, x2: number, y2: number) {
  const k = Math.max(6, Math.abs(x2 - x1) * 0.55);
  return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`;
}

/**
 * Los vínculos entre tarjetas, encima del lienzo del tablero. Entre columnas vecinas se ve un lazo
 * que une las dos tarjetas (estén donde estén en su columna); entre columnas lejanas, un punto del
 * mismo color en cada una. Al pasar el cursor por una tarjeta se marcan las suyas. Mientras
 * vinculas, una línea sigue al puntero hasta que eliges la otra tarjeta.
 */
export function BoardLinks({
  canvas,
  links,
  order,
  hidden,
  linking,
  onPick,
  onCancel,
  onUnlink,
}: {
  canvas: RefObject<HTMLDivElement | null>;
  links: CardLink[];
  /** Ids de las columnas, en orden. */
  order: string[];
  /** Mientras arrastras: no se dibujan (se recalculan al soltar). */
  hidden: boolean;
  linking: Linking | null;
  onPick: (from: string, to: string) => void;
  onCancel: () => void;
  onUnlink: (link: CardLink) => void;
}) {
  const layer = useRef<SVGSVGElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [geo, setGeo] = useState<Geometry>({ segs: [], rubber: null });
  const [hot, setHot] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const props = useRef({ links, order, linking });
  props.current = { links, order, linking };
  const last = useRef("");

  const measure = useCallback(() => {
    const root = canvas.current;
    if (!root) return;
    const { links, order, linking } = props.current;
    const base = root.getBoundingClientRect();
    const ox = root.scrollLeft - base.left;
    const oy = root.scrollTop - base.top;
    const colAt = new Map(order.map((id, i) => [id, i]));
    const boxes = new Map<string, ReturnType<typeof box>>();
    function box(id: string) {
      const el = root!.querySelector<HTMLElement>(
        `.bd-card[data-card="${CSS.escape(id)}"]`,
      );
      if (!el) return null;
      const list = el.closest<HTMLElement>("[data-list]")?.dataset.list;
      const col = list ? colAt.get(list) : undefined;
      if (col === undefined) return null;
      const r = el.getBoundingClientRect();
      const s = el
        .closest<HTMLElement>("[data-stack]")
        ?.getBoundingClientRect();
      let y = r.top + r.height / 2;
      let clipped = false;
      if (s) {
        const top = s.top + 6;
        const bottom = s.bottom - 6;
        if (y < top) [y, clipped] = [top, true];
        else if (y > bottom) [y, clipped] = [bottom, true];
      }
      return {
        col,
        left: r.left + ox,
        right: r.right + ox,
        y: y + oy,
        clipped,
      };
    }
    const get = (id: string) => {
      if (!boxes.has(id)) boxes.set(id, box(id));
      return boxes.get(id)!;
    };
    const segs: Seg[] = [];
    for (const l of links) {
      const A = get(l.a);
      const B = get(l.b);
      if (!A || !B || A.col === B.col) continue;
      const [L, R] = A.col < B.col ? [A, B] : [B, A];
      segs.push({
        key: linkKey(l),
        link: l,
        color: linkColor(l),
        x1: Math.round(L.right),
        y1: Math.round(L.y),
        x2: Math.round(R.left),
        y2: Math.round(R.y),
        near: R.col - L.col === 1,
        clipped: L.clipped || R.clipped,
      });
    }
    let rubber: Geometry["rubber"] = null;
    if (linking && pointer.current) {
      const S = get(linking.id);
      if (S) {
        const dir = linking.side === "right" ? 1 : -1;
        rubber = {
          x1: Math.round(dir === 1 ? S.right : S.left),
          y1: Math.round(S.y),
          x2: Math.round(pointer.current.x + ox),
          y2: Math.round(pointer.current.y + oy),
          dir,
        };
      }
    }
    const next = { segs, rubber };
    const sig = JSON.stringify(next);
    if (sig === last.current) return;
    last.current = sig;
    setGeo(next);
  }, [canvas]);

  const frame = useRef(0);
  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  }, [measure]);

  // Se recalcula al desplazar (el lienzo o una columna), al cambiar de tamaño, al cambiar las
  // tarjetas y al terminar las animaciones de reordenar.
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    let late = 0;
    const soon = () => {
      schedule();
      window.clearTimeout(late);
      late = window.setTimeout(schedule, 260);
    };
    const mo = new MutationObserver((records) => {
      if (records.every((r) => layer.current?.contains(r.target))) return;
      soon();
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    root.addEventListener("scroll", schedule, true);
    root.addEventListener("transitionend", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      mo.disconnect();
      ro.disconnect();
      root.removeEventListener("scroll", schedule, true);
      root.removeEventListener("transitionend", schedule);
      window.removeEventListener("resize", schedule);
      window.clearTimeout(late);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [canvas, schedule]);
  // Las columnas llegan como lista nueva en cada pintado: cuenta solo si cambian de verdad.
  const orderKey = order.join(",");
  useLayoutEffect(() => {
    measure();
  }, [measure, links, orderKey, linking, hidden]);

  // La tarjeta bajo el cursor: se marcan sus vínculos (y las tarjetas con las que está unida).
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    const move = (e: PointerEvent) => {
      const id =
        (e.target as Element | null)?.closest<HTMLElement>(
          ".bd-card[data-card]",
        )?.dataset.card ?? null;
      setHot((h) => (h === id ? h : id));
    };
    const leave = () => setHot(null);
    root.addEventListener("pointerover", move);
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointerover", move);
      root.removeEventListener("pointerleave", leave);
    };
  }, [canvas]);
  useEffect(() => {
    const root = canvas.current;
    if (!root || !hot || linking) return;
    const marked: HTMLElement[] = [];
    for (const l of links) {
      if (l.a !== hot && l.b !== hot) continue;
      const other = l.a === hot ? l.b : l.a;
      const el = root.querySelector<HTMLElement>(
        `.bd-card[data-card="${CSS.escape(other)}"]`,
      );
      if (!el) continue;
      el.dataset.linkHot = "";
      el.style.setProperty("--lk", linkColor(l));
      marked.push(el);
    }
    return () =>
      marked.forEach((el) => {
        delete el.dataset.linkHot;
        el.style.removeProperty("--lk");
      });
  }, [canvas, hot, links, linking]);

  // Vinculando: el siguiente clic elige la otra tarjeta (o cancela). Nada más reacciona a él.
  const handlers = useRef({ onPick, onCancel });
  handlers.current = { onPick, onCancel };
  useEffect(() => {
    if (!linking) return;
    const root = canvas.current;
    const { onPick, onCancel } = {
      onPick: (a: string, b: string) => handlers.current.onPick(a, b),
      onCancel: () => handlers.current.onCancel(),
    };
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      schedule();
    };
    const down = (e: PointerEvent) => {
      // Ni arrastrar tarjetas ni desplazar el lienzo mientras eliges.
      e.stopPropagation();
      if (root?.contains(e.target as Node)) e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const el = (e.target as Element | null)?.closest<HTMLElement>(
        ".bd-card[data-card]",
      );
      const list = el?.closest<HTMLElement>("[data-list]")?.dataset.list;
      const id = el?.dataset.card;
      if (el && id && list && list !== linking.list && root?.contains(el))
        onPick(linking.id, id);
      else onCancel();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onCancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    return () => {
      pointer.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [canvas, linking, schedule]);

  const segs = hidden ? [] : geo.segs;
  const r = !hidden && geo.rubber;
  return (
    <>
      <svg ref={layer} className="bd-links" aria-hidden="true">
        {segs.map((s) => {
          const hotHere =
            hot === s.link.a || hot === s.link.b || over === s.key;
          const cls =
            "bd-link" +
            (s.near ? "" : " far") +
            (s.clipped ? " clipped" : "") +
            (hotHere ? " hot" : "");
          const d = curve(s.x1, s.y1, s.x2, s.y2);
          const mx = (s.x1 + s.x2) / 2;
          const my = (s.y1 + s.y2) / 2;
          return (
            <g
              key={s.key}
              className={cls}
              style={{ "--lk": s.color } as CSSProperties}
              onPointerEnter={() => setOver(s.key)}
              onPointerLeave={() => setOver((o) => (o === s.key ? null : o))}
            >
              {s.near && (
                <>
                  <path className="line" d={d} />
                  <path className="hit" d={d} />
                </>
              )}
              <circle className="end" cx={s.x1} cy={s.y1} r={3.5} />
              <circle className="end" cx={s.x2} cy={s.y2} r={3.5} />
              {s.near && over === s.key && !linking && (
                <g
                  className="bd-link-x"
                  transform={`translate(${mx} ${my})`}
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOver(null);
                    onUnlink(s.link);
                  }}
                >
                  <title>Quitar el vínculo</title>
                  <circle r={8} />
                  <path d="M-2.6,-2.6 L2.6,2.6 M2.6,-2.6 L-2.6,2.6" />
                </g>
              )}
            </g>
          );
        })}
        {r && (
          <path
            className="bd-rubber"
            d={`M${r.x1},${r.y1} C${r.x1 + r.dir * 40},${r.y1} ${r.x2 - r.dir * 20},${r.y2} ${r.x2},${r.y2}`}
          />
        )}
        {r && <circle className="bd-rubber-end" cx={r.x1} cy={r.y1} r={4} />}
      </svg>
      {linking &&
        createPortal(
          <div className="bd-link-hint" role="status">
            Elige una tarjeta de otra columna para vincularla
            <small>
              Si ya están vinculadas, se desvinculan · Esc para cancelar
            </small>
          </div>,
          document.body,
        )}
    </>
  );
}
