import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as RMouseEvent,
  type PointerEvent as RPointerEvent,
} from "react";
import {
  ArrowLeftRight,
  LayoutGrid,
  Maximize,
  Minus,
  MoveRight,
  Plus,
  Trash2,
} from "lucide-react";
import { useApp } from "../../AppContext";
import type { BoardCard, CanvasLayout, Column } from "../boardStore";
import { linkColor } from "../BoardLinks";
import { linkKey, type CardLink } from "../cardLinks";
import { plainMarks } from "../cardMarks";
import {
  boardOrder,
  ChecksMini,
  ColChip,
  colTone,
  DoneButton,
  DueChip,
  PrioFlag,
  type ViewApi,
} from "./shared";
import "./canvas.css";

/** Ancho de una tarjeta en el lienzo y separación del orden inicial (por columnas). */
const W = 232;
const GAP_X = 72;
const GAP_Y = 14;
const PAD = 48;
const H0 = 74;
const MIN_Z = 0.25;
const MAX_Z = 2;
const GRID = 24;
const SNAP = 8;

type View = { x: number; y: number; z: number };
type Box = { x: number; y: number; w: number; h: number };
const VIEW_KEY = "nexo-board-canvas-view";
const LIST_KEY = "nexo-board-canvas-list";
const readMap = <T,>(key: string): Record<string, T> => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
const writeMap = (key: string, id: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify({ ...readMap(key), [id]: value }));
  } catch {
    /* sin almacenamiento */
  }
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/**
 * La curva de un vínculo: sale del borde de una tarjeta que mira hacia la otra y llega al borde
 * opuesto de la otra. `end` es el sentido con el que llega (para dibujar la punta).
 */
function connector(a: Box, b: Box) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  let s: { x: number; y: number };
  let e: { x: number; y: number };
  let d: { x: number; y: number };
  if (gapX >= gapY) {
    const r = bc.x >= ac.x ? 1 : -1;
    s = { x: r > 0 ? a.x + a.w : a.x, y: ac.y };
    e = { x: r > 0 ? b.x : b.x + b.w, y: bc.y };
    d = { x: r, y: 0 };
  } else {
    const r = bc.y >= ac.y ? 1 : -1;
    s = { x: ac.x, y: r > 0 ? a.y + a.h : a.y };
    e = { x: bc.x, y: r > 0 ? b.y : b.y + b.h };
    d = { x: 0, y: r };
  }
  const k = clamp(Math.hypot(e.x - s.x, e.y - s.y) * 0.45, 24, 160);
  const c1 = { x: s.x + d.x * k, y: s.y + d.y * k };
  const c2 = { x: e.x - d.x * k, y: e.y - d.y * k };
  const mid = {
    x: (s.x + 3 * c1.x + 3 * c2.x + e.x) / 8,
    y: (s.y + 3 * c1.y + 3 * c2.y + e.y) / 8,
  };
  return {
    d: `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${e.x},${e.y}`,
    s,
    e,
    end: d,
    mid,
  };
}
/** Punta de flecha en `e`, llegando en el sentido `u`. */
const arrowHead = (e: { x: number; y: number }, u: { x: number; y: number }) => {
  const bx = e.x - u.x * 9;
  const by = e.y - u.y * 9;
  const px = -u.y * 4.5;
  const py = u.x * 4.5;
  return `M${e.x},${e.y} L${bx + px},${by + py} L${bx - px},${by - py} Z`;
};

/**
 * Lienzo libre: las tarjetas del tablero sueltas en un espacio sin columnas. Se mueven
 * arrastrándolas, se unen con flechas tirando del punto de su borde hasta otra tarjeta y se crean
 * con doble clic donde quieras. El fondo se desplaza arrastrando y con la rueda; Ctrl + rueda (o
 * pellizcar) acerca y aleja. Cada tarjeta sigue perteneciendo a su columna.
 */
export function CanvasView({
  api,
  boardId,
  links,
  layout,
  onLayout,
  onLink,
  onUnlink,
  create,
}: {
  api: ViewApi;
  boardId: string;
  links: CardLink[];
  layout: CanvasLayout;
  onLayout: (next: CanvasLayout, label?: string) => void;
  /** Une dos tarjetas (si ya lo estaban, no hace nada). */
  onLink: (from: string, to: string) => void;
  onUnlink: (l: CardLink) => void;
  /** Crea una tarjeta en esa columna (con la escritura rápida de siempre). */
  create: (listId: string, title: string) => BoardCard[];
}) {
  const { notify } = useApp();
  const vp = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const saved = useMemo(() => readMap<[number, number, number]>(VIEW_KEY)[boardId], [boardId]);
  const view = useRef<View>(saved ? { x: saved[0], y: saved[1], z: saved[2] } : { x: 0, y: 0, z: 1 });
  const [zoom, setZoom] = useState(view.current.z);
  const fitted = useRef(Boolean(saved));

  const [sizes, setSizes] = useState<Map<string, { w: number; h: number }>>(() => new Map());
  const sizesNow = useRef(sizes);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [wire, setWire] = useState<{ from: string; x: number; y: number; over: string | null } | null>(
    null,
  );
  const [hot, setHot] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ x: number; y: number } | null>(null);
  const [listId, setListId] = useState(() => readMap<string>(LIST_KEY)[boardId] ?? "");
  const target =
    api.columns.find((c) => c.id === listId)?.id ?? api.columns[0]?.id ?? "";

  // ── Tamaño real de cada tarjeta (para las flechas y el orden inicial) ──
  const ro = useMemo(
    () =>
      new ResizeObserver((entries) => {
        let next: Map<string, { w: number; h: number }> | null = null;
        for (const en of entries) {
          const el = en.target as HTMLElement;
          const id = el.dataset.cvCard;
          if (!id) continue;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          const prev = (next ?? sizesNow.current).get(id);
          if (prev && prev.w === w && prev.h === h) continue;
          next ??= new Map(sizesNow.current);
          next.set(id, { w, h });
        }
        if (!next) return;
        sizesNow.current = next;
        setSizes(next);
      }),
    [],
  );
  // (Cada tarjeta deja de observarse al desmontarse; así no hace falta desconectarlo.)

  // ── Dónde va cada tarjeta: donde la dejaste o, si nunca la moviste, en su columna ──
  const auto = useMemo(() => {
    const out = new Map<string, [number, number]>();
    const at = new Map(api.columns.map((c, i) => [c.id, i]));
    const ys = new Map<number, number>();
    for (const c of [...api.cards].sort(boardOrder(api.columns))) {
      const i = at.get(c.list_id) ?? 0;
      const y = ys.get(i) ?? PAD;
      out.set(c.id, [PAD + i * (W + GAP_X), y]);
      ys.set(i, y + (sizes.get(c.id)?.h ?? H0) + GAP_Y);
    }
    return out;
  }, [api.cards, api.columns, sizes]);
  const posOf = (id: string): [number, number] => {
    if (drag?.id === id) return [drag.x, drag.y];
    const p = layout.p?.[id];
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) return [p[0], p[1]];
    return auto.get(id) ?? [PAD, PAD];
  };
  const boxOf = (id: string): Box => {
    const [x, y] = posOf(id);
    const s = sizes.get(id);
    return { x, y, w: s?.w ?? W, h: s?.h ?? H0 };
  };
  const shown = useMemo(() => new Set(api.cards.map((c) => c.id)), [api.cards]);
  const colById = useMemo(() => new Map(api.columns.map((c) => [c.id, c])), [api.columns]);

  // ── Vista: desplazar y acercar (se aplica directo, sin volver a pintar las tarjetas) ──
  const apply = useCallback(() => {
    const { x, y, z } = view.current;
    if (world.current) world.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    if (vp.current) {
      vp.current.style.backgroundSize = `${GRID * z}px ${GRID * z}px`;
      vp.current.style.backgroundPosition = `${x}px ${y}px`;
      vp.current.style.setProperty("--z", String(z));
    }
  }, []);
  const persist = useRef(0);
  const remember = useCallback(() => {
    window.clearTimeout(persist.current);
    persist.current = window.setTimeout(() => {
      const { x, y, z } = view.current;
      writeMap(VIEW_KEY, boardId, [Math.round(x), Math.round(y), +z.toFixed(3)]);
    }, 300);
  }, [boardId]);
  useLayoutEffect(apply, [apply]);
  useEffect(() => () => window.clearTimeout(persist.current), []);

  const zoomAt = useCallback(
    (z: number, cx?: number, cy?: number) => {
      const el = vp.current;
      if (!el) return;
      const v = view.current;
      const nz = clamp(z, MIN_Z, MAX_Z);
      const px = cx ?? el.clientWidth / 2;
      const py = cy ?? el.clientHeight / 2;
      const wx = (px - v.x) / v.z;
      const wy = (py - v.y) / v.z;
      view.current = { x: px - wx * nz, y: py - wy * nz, z: nz };
      apply();
      setZoom(nz);
      remember();
    },
    [apply, remember],
  );

  /** Encuadra todas las tarjetas a la vista. */
  const fit = () => {
    const el = vp.current;
    if (!el) return;
    const ids = api.cards.map((c) => c.id);
    if (!ids.length) {
      view.current = { x: 0, y: 0, z: 1 };
    } else {
      const bs = ids.map(boxOf);
      const x1 = Math.min(...bs.map((b) => b.x));
      const y1 = Math.min(...bs.map((b) => b.y));
      const x2 = Math.max(...bs.map((b) => b.x + b.w));
      const y2 = Math.max(...bs.map((b) => b.y + b.h));
      const z = clamp(
        Math.min((el.clientWidth - 80) / (x2 - x1 || 1), (el.clientHeight - 80) / (y2 - y1 || 1)),
        MIN_Z,
        1,
      );
      view.current = {
        x: (el.clientWidth - (x2 - x1) * z) / 2 - x1 * z,
        y: Math.max(24, (el.clientHeight - (y2 - y1) * z) / 2) - y1 * z,
        z,
      };
    }
    apply();
    setZoom(view.current.z);
    remember();
  };

  // La primera vez en este tablero: se encuadra en cuanto se conocen los tamaños.
  useEffect(() => {
    if (fitted.current) return;
    if (!api.cards.every((c) => sizes.has(c.id))) return;
    fitted.current = true;
    requestAnimationFrame(() => fitNow.current());
  }, [sizes, api.cards]);
  const fitNow = useRef(fit);
  fitNow.current = fit;

  const toWorld = (cx: number, cy: number) => {
    const r = vp.current!.getBoundingClientRect();
    const v = view.current;
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  };

  // Rueda: desplaza; con Ctrl (o al pellizcar en el panel táctil), acerca y aleja.
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".cv-composer textarea, .cv-composer input")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
        zoomAt(view.current.z * f, e.clientX - r.left, e.clientY - r.top);
        return;
      }
      const k = e.deltaMode === 1 ? 16 : 1;
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      view.current = { ...view.current, x: view.current.x - dx, y: view.current.y - dy };
      apply();
      remember();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [apply, remember, zoomAt]);

  // ── Arrastrar el fondo ──
  const pan = useRef<{ id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  );
  const onBackDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as Element).closest("[data-cv-card], .cv-hit, .cv-linkbar, .cv-composer, .cv-zoom"))
      return;
    setPicked(null);
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onBackMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 3) return;
    if (!p.moved) e.currentTarget.classList.add("panning");
    p.moved = true;
    view.current = { ...view.current, x: p.vx + dx, y: p.vy + dy };
    apply();
  };
  const onBackUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pan.current || pan.current.id !== e.pointerId) return;
    if (pan.current.moved) remember();
    pan.current = null;
    e.currentTarget.classList.remove("panning");
  };

  // ── Lo que hacen las tarjetas (con referencias estables para no repintarlas todas) ──
  const live = useRef({ api, layout, onLayout, onLink, posOf, links });
  live.current = { api, layout, onLayout, onLink, posOf, links };
  const frame = useRef(0);
  const moving = useRef<{
    id: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
    x: number;
    y: number;
  } | null>(null);
  const wiring = useRef<{ from: string } | null>(null);

  const acts = useMemo(
    () => ({
      down(e: RPointerEvent<HTMLElement>, id: string) {
        if (e.button !== 0) return;
        if ((e.target as Element).closest("button, a, input")) return;
        e.stopPropagation();
        const [ox, oy] = live.current.posOf(id);
        moving.current = { id, sx: e.clientX, sy: e.clientY, ox, oy, moved: false, x: ox, y: oy };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      move(e: RPointerEvent<HTMLElement>) {
        const m = moving.current;
        if (!m) return;
        const dx = (e.clientX - m.sx) / view.current.z;
        const dy = (e.clientY - m.sy) / view.current.z;
        if (!m.moved && Math.hypot(dx, dy) * view.current.z < 4) return;
        m.moved = true;
        m.x = m.ox + dx;
        m.y = m.oy + dy;
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          const n = moving.current;
          if (n?.moved) setDrag({ id: n.id, x: n.x, y: n.y });
        });
      },
      up(e: RPointerEvent<HTMLElement>, card: BoardCard) {
        const m = moving.current;
        moving.current = null;
        if (!m) return;
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (!m.moved) {
          live.current.api.open(card);
          return;
        }
        const { layout, onLayout } = live.current;
        onLayout({ ...layout, p: { ...layout.p, [m.id]: [snap(m.x), snap(m.y)] } });
        setDrag(null);
      },
      wireDown(e: RPointerEvent<HTMLElement>, id: string) {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        wiring.current = { from: id };
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toWorldRef.current(e.clientX, e.clientY);
        setWire({ from: id, x: p.x, y: p.y, over: null });
      },
      wireMove(e: RPointerEvent<HTMLElement>) {
        if (!wiring.current) return;
        const p = toWorldRef.current(e.clientX, e.clientY);
        const over =
          document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest<HTMLElement>("[data-cv-card]")?.dataset.cvCard ?? null;
        setWire((w) => (w ? { ...w, x: p.x, y: p.y, over: over === w.from ? null : over } : w));
      },
      wireUp(e: RPointerEvent<HTMLElement>) {
        const w = wiring.current;
        wiring.current = null;
        setWire(null);
        if (!w) return;
        const to = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>("[data-cv-card]")?.dataset.cvCard;
        if (!to || to === w.from) return;
        const { layout, onLayout, onLink, links } = live.current;
        const key = linkKey(w.from < to ? { a: w.from, b: to } : { a: to, b: w.from });
        const had = links.find((l) => linkKey(l) === key);
        // Si ya estaban unidas, la flecha pasa a salir de esta.
        if (had?.kind === "blocks") return;
        if (!had) onLink(w.from, to);
        onLayout({ ...layout, d: { ...layout.d, [key]: w.from } });
      },
      enter: (id: string) => setHot(id),
      leave: (id: string) => setHot((h) => (h === id ? null : h)),
      toggle: (c: BoardCard) => live.current.api.toggle(c),
      open: (c: BoardCard) => live.current.api.open(c),
      observe: (el: HTMLElement) => {
        ro.observe(el);
        return () => ro.unobserve(el);
      },
    }),
    [ro],
  );
  const toWorldRef = useRef(toWorld);
  toWorldRef.current = toWorld;

  // ── Teclado: Esc suelta lo elegido; Supr quita el vínculo elegido ──
  const pickedLink = picked ? links.find((l) => linkKey(l) === picked) : undefined;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector(".sheet-backdrop, .confirm-backdrop, .bv-modal-back")) return;
      if (e.key === "Escape") setPicked(null);
      if ((e.key === "Delete" || e.key === "Backspace") && pickedLink) {
        e.preventDefault();
        setPicked(null);
        onUnlink(pickedLink);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [pickedLink, onUnlink]);

  // ── Vínculos ──
  const segs = links.flatMap((l) => {
    if (!shown.has(l.a) || !shown.has(l.b)) return [];
    const key = linkKey(l);
    const blocks = l.kind === "blocks" && Boolean(l.blocker);
    const dir = blocks ? l.blocker! : layout.d?.[key];
    const from = dir === l.a || dir === l.b ? dir : null;
    const src = from ?? l.a;
    const dst = src === l.a ? l.b : l.a;
    const g = connector(boxOf(src), boxOf(dst));
    return [{ key, link: l, g, arrow: Boolean(from), blocks, color: linkColor(l) }];
  });
  const rubber = (() => {
    if (!wire) return null;
    const a = boxOf(wire.from);
    const b: Box = wire.over ? boxOf(wire.over) : { x: wire.x, y: wire.y, w: 0, h: 0 };
    return connector(a, b);
  })();
  const pickedSeg = segs.find((s) => s.key === picked);

  // ── Crear con doble clic ──
  const onBackDouble = (e: RMouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("[data-cv-card], .cv-hit, .cv-linkbar, .cv-composer, .cv-zoom"))
      return;
    if (!target) {
      notify("Este tablero no tiene columnas: crea una para añadir tarjetas.");
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    setComposer({ x: snap(p.x - W / 2), y: snap(p.y - 18) });
  };
  const addAt = (title: string) => {
    if (!composer || !target) return;
    const made = create(target, title);
    if (!made.length) return;
    const p = { ...layout.p };
    made.forEach((c, i) => (p[c.id] = [composer.x, composer.y + i * (H0 + GAP_Y)]));
    onLayout({ ...layout, p });
    // La siguiente, justo debajo (como al escribir en una columna).
    setComposer({ x: composer.x, y: composer.y + made.length * (H0 + GAP_Y) });
  };

  const placed = Object.keys(layout.p ?? {}).some((id) => shown.has(id));
  const reset = () => onLayout({ ...layout, p: {} }, "Tarjetas ordenadas por columna");

  return (
    <div className="bv bv-canvas">
      <div className="bv-toolbar">
        <span className="bv-tool-label">Doble clic en el lienzo para crear en</span>
        <select
          className="cv-select"
          value={target}
          disabled={!api.columns.length}
          aria-label="Columna de las tarjetas nuevas"
          onChange={(e) => {
            setListId(e.target.value);
            writeMap(LIST_KEY, boardId, e.target.value);
          }}
        >
          {api.columns.map((c: Column) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="cv-tip">
          <MoveRight size={13} /> Tira del punto de una tarjeta hasta otra para unirlas
        </span>
        <div className="cv-tools">
          {placed && (
            <button type="button" className="bv-pill" title="Volver a ponerlas en el orden de sus columnas" onClick={reset}>
              <LayoutGrid size={14} /> Ordenar
            </button>
          )}
          <div className="cv-zoom" role="group" aria-label="Zoom">
            <button type="button" aria-label="Alejar" title="Alejar" onClick={() => zoomAt(view.current.z / 1.2)}>
              <Minus size={14} />
            </button>
            <button type="button" className="cv-zoom-pct" title="Volver al 100 %" onClick={() => zoomAt(1)}>
              {Math.round(zoom * 100)} %
            </button>
            <button type="button" aria-label="Acercar" title="Acercar" onClick={() => zoomAt(view.current.z * 1.2)}>
              <Plus size={14} />
            </button>
            <i />
            <button type="button" aria-label="Ver todo" title="Ver todas las tarjetas" onClick={() => fit()}>
              <Maximize size={14} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={vp}
        className={"cv-viewport" + (wire ? " wiring" : "")}
        onPointerDown={onBackDown}
        onPointerMove={onBackMove}
        onPointerUp={onBackUp}
        onPointerCancel={onBackUp}
        onDoubleClick={onBackDouble}
      >
        <div ref={world} className="cv-world">
          <svg className="cv-links" aria-hidden="true">
            {segs.map((s) => {
              const on = hot === s.link.a || hot === s.link.b || picked === s.key;
              return (
                <g
                  key={s.key}
                  className={"cv-link" + (on ? " hot" : "") + (s.blocks ? " blocks" : "") + (picked === s.key ? " picked" : "")}
                  style={{ "--lk": s.color } as CSSProperties}
                >
                  <path className="line" d={s.g.d} />
                  {s.arrow ? (
                    <path className="head" d={arrowHead(s.g.e, s.g.end)} />
                  ) : (
                    <circle className="end" cx={s.g.e.x} cy={s.g.e.y} r={3} />
                  )}
                  <circle className="end" cx={s.g.s.x} cy={s.g.s.y} r={3} />
                  <path
                    className="cv-hit"
                    d={s.g.d}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setPicked((p) => (p === s.key ? null : s.key))}
                  >
                    <title>
                      {s.blocks
                        ? (s.link.cond ?? "done") === "done"
                          ? "Bloquea hasta que se complete"
                          : "Bloquea hasta que llegue a su columna"
                        : "Clic para cambiar la flecha o quitar el vínculo"}
                    </title>
                  </path>
                </g>
              );
            })}
            {rubber && (
              <g className="cv-rubber">
                <path className="line" d={rubber.d} />
                <path className="head" d={arrowHead(rubber.e, rubber.end)} />
              </g>
            )}
          </svg>

          {api.cards.map((c) => {
            const [x, y] = posOf(c.id);
            return (
              <CanvasCard
                key={c.id}
                card={c}
                x={x}
                y={y}
                done={api.isDone(c)}
                col={colById.get(c.list_id)}
                lifted={drag?.id === c.id}
                target={wire?.over === c.id}
                source={wire?.from === c.id}
                acts={acts}
              />
            );
          })}

          {pickedSeg && pickedLink && (
            <div
              className="cv-linkbar"
              style={{ left: pickedSeg.g.mid.x, top: pickedSeg.g.mid.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {!pickedSeg.blocks && (
                <>
                  <button
                    type="button"
                    title={pickedSeg.arrow ? "Cambiar el sentido de la flecha" : "Poner flecha"}
                    onClick={() => {
                      const cur = layout.d?.[picked!];
                      const l = pickedLink;
                      // Sin punta → de a hacia b → de b hacia a → sin punta.
                      const next = !cur ? l.a : cur === l.a ? l.b : null;
                      const d = { ...layout.d };
                      if (next) d[picked!] = next;
                      else delete d[picked!];
                      onLayout({ ...layout, d });
                    }}
                  >
                    {pickedSeg.arrow ? <ArrowLeftRight size={14} /> : <MoveRight size={14} />}
                    <span>{pickedSeg.arrow ? (layout.d?.[picked!] === pickedLink.a ? "Invertir" : "Sin flecha") : "Flecha"}</span>
                  </button>
                  <i />
                </>
              )}
              <button
                type="button"
                className="danger"
                title="Quitar el vínculo"
                onClick={() => {
                  setPicked(null);
                  onUnlink(pickedLink);
                }}
              >
                <Trash2 size={14} />
                <span>Quitar</span>
              </button>
            </div>
          )}

          {composer && (
            <Composer
              x={composer.x}
              y={composer.y}
              column={colById.get(target)}
              onAdd={addAt}
              onClose={() => setComposer(null)}
            />
          )}
        </div>

        {!api.cards.length && !composer && (
          <div className="cv-empty">
            <strong>Un lienzo en blanco</strong>
            <span>
              {api.columns.length
                ? "Haz doble clic donde quieras para crear una tarjeta."
                : "Crea una columna para empezar a añadir tarjetas."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

type Acts = {
  down: (e: RPointerEvent<HTMLElement>, id: string) => void;
  move: (e: RPointerEvent<HTMLElement>) => void;
  up: (e: RPointerEvent<HTMLElement>, card: BoardCard) => void;
  wireDown: (e: RPointerEvent<HTMLElement>, id: string) => void;
  wireMove: (e: RPointerEvent<HTMLElement>) => void;
  wireUp: (e: RPointerEvent<HTMLElement>) => void;
  enter: (id: string) => void;
  leave: (id: string) => void;
  toggle: (c: BoardCard) => void;
  open: (c: BoardCard) => void;
  observe: (el: HTMLElement) => () => void;
};

/** Una tarjeta en el lienzo (solo se vuelve a pintar si cambia ella). */
const CanvasCard = memo(function CanvasCard({
  card,
  x,
  y,
  done,
  col,
  lifted,
  target,
  source,
  acts,
}: {
  card: BoardCard;
  x: number;
  y: number;
  done: boolean;
  col?: Column;
  lifted: boolean;
  target: boolean;
  source: boolean;
  acts: Acts;
}) {
  const title = plainMarks(card.title);
  const ref = useCallback((el: HTMLDivElement | null) => (el ? acts.observe(el) : undefined), [acts]);
  return (
    <div
      ref={ref}
      data-cv-card={card.id}
      role="button"
      tabIndex={0}
      aria-label={title}
      className={
        "cv-card" +
        (done ? " done" : "") +
        (lifted ? " lifted" : "") +
        (target ? " target" : "") +
        (source ? " source" : "") +
        (card.highlight ? " hl" : "")
      }
      style={{ transform: `translate(${x}px, ${y}px)`, "--lc": colTone(col) } as CSSProperties}
      onPointerDown={(e) => acts.down(e, card.id)}
      onPointerMove={acts.move}
      onPointerUp={(e) => acts.up(e, card)}
      onPointerEnter={() => acts.enter(card.id)}
      onPointerLeave={() => acts.leave(card.id)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && acts.open(card)}
    >
      <div className="cv-card-top">
        <DoneButton done={done} title={card.title} onToggle={() => acts.toggle(card)} />
        <span className="cv-title">{title}</span>
      </div>
      {(card.due || card.priority || card.checks.length > 0 || card.tags.length > 0 || col) && (
        <div className="cv-meta">
          <PrioFlag p={card.priority} />
          <DueChip card={card} done={done} />
          <ChecksMini card={card} />
          {card.tags.slice(0, 2).map((t) => (
            <span key={t} className="cv-tag">
              #{t}
            </span>
          ))}
          <span className="cv-col">
            <ColChip col={col} />
          </span>
        </div>
      )}
      <span
        className="cv-port"
        role="presentation"
        title="Arrastra hasta otra tarjeta para unirlas"
        onPointerDown={(e) => acts.wireDown(e, card.id)}
        onPointerMove={acts.wireMove}
        onPointerUp={acts.wireUp}
        onPointerCancel={acts.wireUp}
      />
    </div>
  );
});

/** Escribir una tarjeta nueva justo donde hiciste doble clic. */
function Composer({
  x,
  y,
  column,
  onAdd,
  onClose,
}: {
  x: number;
  y: number;
  column?: Column;
  onAdd: (title: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="cv-composer"
      style={{ transform: `translate(${x}px, ${y}px)`, "--lc": colTone(column) } as CSSProperties}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return onClose();
        onAdd(t);
        setText("");
      }}
    >
      <input
        autoFocus
        value={text}
        placeholder="Escribe y pulsa Intro…"
        aria-label="Título de la tarjeta"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => !text.trim() && onClose()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      />
      {column && <small>en {column.name}</small>}
    </form>
  );
}
