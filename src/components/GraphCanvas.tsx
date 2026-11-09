import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Maximize2, Minus, Plus, type LucideIcon } from 'lucide-react';

export type GraphNode = {
  id: string;
  x: number;
  y: number;
  r: number;
  label: string;
  initials: string;
  fill: string;
  stroke: string;
  ink: string;
  photo?: string;
  center?: boolean;
  /** Los lugares se dibujan como cuadrados redondeados con su icono. */
  shape?: 'circle' | 'place';
  icon?: LucideIcon;
};
export type GraphEdge = {
  a: string;
  b: string;
  w: number;
  tone?: 'soft' | 'strong' | 'place';
  color?: string;
  dashed?: boolean;
  /** Se muestra en la mitad de la línea al pasar el cursor por uno de sus extremos. */
  label?: string;
};
/** Fila horizontal con nombre (generaciones del árbol familiar). */
export type GraphBand = { y: number; label: string };
export type GraphRing = { r: number; label: string };

type View = { x: number; y: number; k: number };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Lienzo SVG navegable: arrastra para moverte, rueda (o los botones) para acercar, clic en un
 * nodo para seleccionarlo. Al pasar el cursor por un nodo se resaltan sus conexiones.
 */
export function GraphCanvas({
  nodes,
  edges,
  rings = [],
  bands = [],
  selected,
  onSelect,
  overlay,
  height = 560,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rings?: GraphRing[];
  bands?: GraphBand[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  overlay?: ReactNode;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: height });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    moved: boolean;
    node: string | null;
  } | null>(null);
  const fitted = useRef(false);
  // El tamaño real llega con la primera medida; antes de eso no se ajusta el zoom.
  const measured = useRef(false);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.a)) m.set(e.a, new Set());
      if (!m.has(e.b)) m.set(e.b, new Set());
      m.get(e.a)!.add(e.b);
      m.get(e.b)!.add(e.a);
    }
    return m;
  }, [edges]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      measured.current = true;
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!nodes.length) return setView({ x: 0, y: 0, k: 1 });
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.r - 30);
      maxX = Math.max(maxX, n.x + n.r + 30);
      minY = Math.min(minY, n.y - n.r - 30);
      maxY = Math.max(maxY, n.y + n.r + 46);
    }
    for (const r of rings) {
      minX = Math.min(minX, -r.r);
      maxX = Math.max(maxX, r.r);
      minY = Math.min(minY, -r.r);
      maxY = Math.max(maxY, r.r);
    }
    const k = clamp(Math.min(size.w / (maxX - minX), size.h / (maxY - minY)) * 0.92, 0.25, 1.6);
    setView({ x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k, k });
  }, [nodes, rings, size]);

  // Ajusta la vista al cargar y cada vez que cambian los datos (p. ej. al elegir otro año).
  useEffect(() => {
    fitted.current = false;
  }, [nodes]);
  useEffect(() => {
    if (fitted.current || !measured.current || size.w < 50) return;
    fitted.current = true;
    fit();
  }, [fit, size.w]);

  // La rueda acerca y aleja alrededor del cursor (sin mover la página).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - size.w / 2;
      const cy = e.clientY - rect.top - size.h / 2;
      setView((v) => {
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.0015), 0.2, 3.5);
        const f = k / v.k;
        return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size]);

  const zoom = (factor: number) =>
    setView((v) => {
      const k = clamp(v.k * factor, 0.2, 3.5);
      const f = k / v.k;
      return { k, x: v.x * f, y: v.y * f };
    });

  const focus = hover ?? selected;
  const lit = focus ? new Set([focus, ...(neighbors.get(focus) ?? [])]) : null;
  const maxW = Math.max(1, ...edges.map((e) => e.w));

  return (
    <div className="gc" ref={box} style={{ '--gc-h': `${height}px` } as CSSProperties}>
      <svg
        ref={svg}
        width={size.w}
        height={size.h}
        role="img"
        aria-label="Mapa de personas"
        onPointerDown={(e) => {
          const node =
            (e.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? null;
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, node };
          try {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
          } catch {
            /* sin puntero activo (p. ej. eventos sintéticos) */
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) setPanning(true);
          d.moved = true;
          setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          setPanning(false);
          if (d && !d.moved) onSelect(d.node && !byId.get(d.node)?.center ? d.node : null);
        }}
        className={panning ? 'grabbing' : ''}
      >
        <defs>
          {nodes
            .filter((n) => n.photo)
            .map((n) => (
              <clipPath id={'gc-clip-' + n.id} key={n.id}>
                {n.shape === 'place' ? (
                  <rect
                    x={n.x - n.r}
                    y={n.y - n.r}
                    width={n.r * 2}
                    height={n.r * 2}
                    rx={n.r * 0.35}
                  />
                ) : (
                  <circle cx={n.x} cy={n.y} r={n.r} />
                )}
              </clipPath>
            ))}
        </defs>
        <g transform={`translate(${size.w / 2 + view.x} ${size.h / 2 + view.y}) scale(${view.k})`}>
          {rings.map((r) => (
            <g key={r.label} className="gc-ring">
              <circle r={r.r} />
              <text x={0} y={-r.r - 8} textAnchor="middle">
                {r.label}
              </text>
            </g>
          ))}
          {bands.length > 0 &&
            (() => {
              const xs = nodes.map((n) => n.x);
              const x1 = Math.min(...xs) - 140;
              const x2 = Math.max(...xs) + 140;
              return bands.map((b) => (
                <g key={b.label + b.y} className="gc-band">
                  <line x1={x1} x2={x2} y1={b.y} y2={b.y} />
                  <text x={x1} y={b.y - 8}>
                    {b.label}
                  </text>
                </g>
              ));
            })()}
          {edges.map((e, i) => {
            const a = byId.get(e.a);
            const b = byId.get(e.b);
            if (!a || !b) return null;
            const on = lit && lit.has(e.a) && lit.has(e.b) && (e.a === focus || e.b === focus);
            return (
              <g key={e.a + '-' + e.b + '-' + i}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={'gc-edge ' + (e.tone ?? 'strong') + (on ? ' lit' : lit ? ' dim' : '')}
                  style={e.color ? { stroke: e.color } : undefined}
                  strokeDasharray={e.dashed ? '5 6' : undefined}
                  strokeWidth={(1 + (e.w / maxW) * 5) / Math.sqrt(view.k)}
                />
                {on && e.label && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 6}
                    textAnchor="middle"
                    className="gc-edge-label"
                    fontSize={11 / Math.max(0.7, Math.min(1.2, view.k))}
                  >
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((n) => {
            const dim = lit && !lit.has(n.id);
            const showLabel = n.center || view.k > 0.75 || n.r > 22 || n.id === focus;
            return (
              <g
                key={n.id}
                data-node={n.id}
                className={
                  'gc-node' +
                  (n.id === selected ? ' sel' : '') +
                  (dim ? ' dim' : '') +
                  (n.center ? ' center' : '')
                }
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
              >
                {n.shape === 'place' ? (
                  <>
                    <rect
                      x={n.x - n.r - 5}
                      y={n.y - n.r - 5}
                      width={(n.r + 5) * 2}
                      height={(n.r + 5) * 2}
                      rx={(n.r + 5) * 0.35}
                      className="gc-halo"
                      style={{ stroke: n.stroke }}
                    />
                    <rect
                      x={n.x - n.r}
                      y={n.y - n.r}
                      width={n.r * 2}
                      height={n.r * 2}
                      rx={n.r * 0.35}
                      fill={n.fill}
                      stroke={n.stroke}
                      strokeWidth={2}
                    />
                  </>
                ) : (
                  <>
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.r + 5}
                      className="gc-halo"
                      style={{ stroke: n.stroke }}
                    />
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.r}
                      fill={n.fill}
                      stroke={n.stroke}
                      strokeWidth={n.center ? 0 : 2}
                    />
                  </>
                )}
                {n.photo ? (
                  <image
                    href={n.photo}
                    x={n.x - n.r}
                    y={n.y - n.r}
                    width={n.r * 2}
                    height={n.r * 2}
                    clipPath={`url(#gc-clip-${n.id})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                ) : n.icon ? (
                  <n.icon
                    x={n.x - n.r * 0.5}
                    y={n.y - n.r * 0.5}
                    size={n.r}
                    color={n.stroke}
                    className="gc-icon"
                  />
                ) : (
                  <text
                    x={n.x}
                    y={n.y + n.r * 0.32}
                    textAnchor="middle"
                    fontSize={n.r * 0.8}
                    fill={n.ink}
                    className="gc-initials"
                  >
                    {n.initials}
                  </text>
                )}
                {showLabel && !n.center && (
                  <text
                    x={n.x}
                    y={n.y + n.r + 16}
                    textAnchor="middle"
                    className="gc-label"
                    fontSize={12 / Math.max(0.7, Math.min(1.2, view.k))}
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="gc-controls">
        <button type="button" aria-label="Acercar" onClick={() => zoom(1.25)}>
          <Plus size={16} />
        </button>
        <button type="button" aria-label="Alejar" onClick={() => zoom(0.8)}>
          <Minus size={16} />
        </button>
        <button type="button" aria-label="Ajustar a la vista" onClick={fit}>
          <Maximize2 size={14} />
        </button>
      </div>
      <span className="gc-hint">
        Arrastra para moverte · rueda para acercar · clic en una persona
      </span>
      {overlay}
    </div>
  );
}
