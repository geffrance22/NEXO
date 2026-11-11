import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as RPointerEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { addDays, friendlyDate } from "../../lib/format";
import { dayDiff } from "../boardDates";
import { weekdayOf } from "../boardRepeat";
import type { BoardCard } from "../boardStore";
import { INTERACTIVE, usePan } from "../usePan";
import { boardOrder, colTone, DoneButton, type ViewApi } from "./shared";

type Zoom = "dias" | "semanas" | "meses";
const DAY_W: Record<Zoom, number> = { dias: 38, semanas: 16, meses: 5 };
const LABEL = 260;
const ROW = 36;
const HEAD = 34;
const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
const DOW = ["D", "L", "M", "X", "J", "V", "S"];

type Row =
  | { kind: "head"; id: string; name: string; tone: string; count: number }
  | { kind: "card"; card: BoardCard; tone: string };
type Drag = {
  id: string;
  part: "move" | "start" | "end";
  x: number;
  starts: string | null;
  due: string | null;
  delta: number;
};

/**
 * Línea de tiempo: cada tarjeta es una barra del inicio a la fecha límite (o un punto si solo
 * tiene una). Se arrastra para moverla y por sus bordes para cambiar el inicio o la fecha.
 */
export function TimelineView({ api }: { api: ViewApi }) {
  const [zoom, setZoom] = useState<Zoom>("semanas");
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Agarrar el fondo y arrastrar desplaza la línea de tiempo (las barras y los nombres no).
  const pan = usePan({
    ignore: `${INTERACTIVE}, .bv-tl-bar, .bv-tl-point, .bv-tl-grip, .bv-tl-label`,
  });
  const dw = DAY_W[zoom];

  const dated = useMemo(
    () => api.cards.filter((c) => c.due || c.starts),
    [api.cards],
  );
  const undated = api.cards.length - dated.length;

  // El tramo visible: de lo más temprano a lo más tardío, con aire, y siempre con hoy dentro.
  const [from, days] = useMemo(() => {
    let lo = addDays(api.today, -14);
    let hi = addDays(api.today, 60);
    for (const c of dated) {
      const a = c.starts ?? c.due!;
      const b = c.due ?? c.starts!;
      if (a < lo) lo = a;
      if (b > hi) hi = b;
    }
    lo = maxDate(addDays(lo, -7), addDays(api.today, -400));
    hi = minDate(addDays(hi, 21), addDays(api.today, 800));
    // Empieza en lunes: las semanas quedan alineadas.
    lo = addDays(lo, -((weekdayOf(lo) + 6) % 7));
    return [lo, dayDiff(lo, hi) + 1] as const;
  }, [dated, api.today]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const sorted = [...dated].sort(
      (a, b) =>
        boardOrder(api.columns)(a, b) ||
        (a.starts ?? a.due ?? "").localeCompare(b.starts ?? b.due ?? ""),
    );
    for (const col of api.columns) {
      const mine = sorted
        .filter((c) => c.list_id === col.id)
        .sort((a, b) =>
          (a.starts ?? a.due ?? "").localeCompare(b.starts ?? b.due ?? ""),
        );
      if (!mine.length) continue;
      const tone = colTone(col);
      out.push({
        kind: "head",
        id: col.id,
        name: col.name,
        tone,
        count: mine.length,
      });
      if (!folded.has(col.id))
        for (const c of mine) out.push({ kind: "card", card: c, tone });
    }
    return out;
  }, [dated, api.columns, folded]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i].kind === "head" ? 32 : ROW),
    overscan: 12,
    scrollMargin: HEAD,
  });

  // Al abrir y al cambiar el zoom: hoy, cerca del borde izquierdo.
  useEffect(() => {
    const el = scroller.current;
    if (el)
      el.scrollLeft = Math.max(
        0,
        dayDiff(from, api.today) * dw - 3 * dw * (zoom === "dias" ? 2 : 4),
      );
  }, [zoom, from]);

  const x = (date: string) => LABEL + dayDiff(from, date) * dw;
  const shifted = (c: BoardCard) => {
    if (!drag || drag.id !== c.id || !drag.delta)
      return { a: c.starts, b: c.due };
    const add = (d: string | null) => (d ? addDays(d, drag.delta) : d);
    if (drag.part === "move") return { a: add(c.starts), b: add(c.due) };
    if (drag.part === "start") {
      const a = add(c.starts ?? c.due);
      return { a: c.due && a! > c.due ? c.due : a, b: c.due };
    }
    const b = add(c.due ?? c.starts);
    return { a: c.starts, b: c.starts && b! < c.starts ? c.starts : b };
  };

  const begin = (e: RPointerEvent, c: BoardCard, part: Drag["part"]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      id: c.id,
      part,
      x: e.clientX,
      starts: c.starts,
      due: c.due,
      delta: 0,
    });
  };
  const moveTo = (e: RPointerEvent) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.x) / dw);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  };
  const end = (c: BoardCard) => {
    if (!drag) return;
    const moved = drag.delta;
    const { a, b } = shifted(c);
    setDrag(null);
    if (!moved) return api.open(c);
    const ch: { starts?: string | null; due?: string | null } = {};
    if (a !== c.starts && api.sync) ch.starts = a;
    if (b !== c.due) ch.due = b;
    if (!Object.keys(ch).length) return;
    api.patch(
      c,
      ch,
      drag.part === "move"
        ? `«${c.title.slice(0, 30)}» ${moved > 0 ? "+" : ""}${moved} ${Math.abs(moved) === 1 ? "día" : "días"}`
        : "Fechas cambiadas",
    );
  };

  // Marcas del encabezado.
  const ticks = useMemo(() => {
    const out: { at: number; label: string; major: boolean }[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      const dom = Number(d.slice(8));
      const month = MONTHS[Number(d.slice(5, 7)) - 1];
      if (zoom === "dias")
        out.push({
          at: i,
          label: dom === 1 ? `${dom} ${month}` : `${DOW[weekdayOf(d)]} ${dom}`,
          major: dom === 1,
        });
      else if (zoom === "semanas" && weekdayOf(d) === 1)
        out.push({
          at: i,
          label: dom <= 7 ? `${dom} ${month}` : String(dom),
          major: dom <= 7,
        });
      else if (zoom === "meses" && dom === 1)
        out.push({
          at: i,
          label: `${month} ${d.slice(2, 4)}`,
          major: d.slice(5, 7) === "01",
        });
    }
    return out;
  }, [from, days, zoom]);

  const width = LABEL + days * dw;
  const todayX = x(api.today);
  return (
    <div className="bv bv-timeline">
      <div className="bv-toolbar">
        <div className="bv-seg" role="radiogroup" aria-label="Escala">
          {(["dias", "semanas", "meses"] as Zoom[]).map((z) => (
            <button
              key={z}
              type="button"
              role="radio"
              aria-checked={zoom === z}
              className={zoom === z ? "on" : ""}
              onClick={() => setZoom(z)}
            >
              {z === "dias" ? "Días" : z === "semanas" ? "Semanas" : "Meses"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="bv-pill"
          onClick={() => {
            const el = scroller.current;
            if (el)
              el.scrollTo({
                left: Math.max(0, todayX - LABEL - 4 * dw),
                behavior: "smooth",
              });
          }}
        >
          Hoy
        </button>
        <span className="bv-count">
          {undated > 0 && `${undated} sin fechas no salen aquí · `}
          {!api.sync &&
            "Para fechas de inicio falta la migración 202611100008 · "}
          Arrastra la barra para moverla y sus bordes para estirarla; el fondo,
          para desplazarte
        </span>
      </div>
      <div className="bv-scroll bv-tl" ref={scroller} {...pan}>
        <div className="bv-tl-inner" style={{ width }}>
          <div className="bv-tl-head" style={{ height: HEAD }}>
            <span className="bv-tl-corner" style={{ width: LABEL }}>
              Tarjeta
            </span>
            {ticks.map((t) => (
              <span
                key={t.at}
                className={"bv-tl-tick" + (t.major ? " major" : "")}
                style={{ left: LABEL + t.at * dw }}
              >
                {t.label}
              </span>
            ))}
            <i className="bv-tl-now-dot" style={{ left: todayX + dw / 2 }} />
          </div>
          <div className="bv-space" style={{ height: v.getTotalSize() }}>
            <i
              className="bv-tl-now"
              style={{ left: todayX + dw / 2 }}
              aria-hidden="true"
            />
            {v.getVirtualItems().map((it) => {
              const row = rows[it.index];
              const top = it.start - HEAD;
              if (row.kind === "head") {
                const shut = folded.has(row.id);
                return (
                  <div
                    key={"h" + row.id}
                    className="bv-tl-group"
                    style={
                      {
                        transform: `translateY(${top}px)`,
                        height: it.size,
                        "--lc": row.tone,
                      } as CSSProperties
                    }
                  >
                    <button
                      type="button"
                      className={"bv-tl-glabel" + (shut ? " shut" : "")}
                      style={{ width: LABEL }}
                      aria-expanded={!shut}
                      onClick={() =>
                        setFolded((s) => {
                          const n = new Set(s);
                          if (n.has(row.id)) n.delete(row.id);
                          else n.add(row.id);
                          return n;
                        })
                      }
                    >
                      <ChevronRight size={13} />
                      <i />
                      <strong>{row.name}</strong>
                      <span>{row.count}</span>
                    </button>
                  </div>
                );
              }
              const c = row.card;
              const done = api.isDone(c);
              const { a, b } = shifted(c);
              const s = a ?? b!;
              const e = b ?? a!;
              const point = !a || !b || a === b;
              const left = x(s);
              const w = point ? dw : (dayDiff(s, e) + 1) * dw;
              const late = !done && Boolean(c.due) && c.due! < api.today;
              const live = drag?.id === c.id;
              return (
                <div
                  key={c.id}
                  className={"bv-tl-row" + (done ? " done" : "")}
                  style={
                    {
                      transform: `translateY(${top}px)`,
                      height: ROW,
                      "--lc": row.tone,
                    } as CSSProperties
                  }
                >
                  <div className="bv-tl-label" style={{ width: LABEL }}>
                    <DoneButton
                      done={done}
                      title={c.title}
                      onToggle={() => api.toggle(c)}
                    />
                    <button type="button" onClick={() => api.open(c)}>
                      {c.title}
                    </button>
                  </div>
                  <div
                    className={
                      (point ? "bv-tl-point" : "bv-tl-bar") +
                      (late ? " late" : "") +
                      (live ? " live" : "") +
                      (c.highlight ? " hl" : "")
                    }
                    style={point ? { left: left + dw / 2 } : { left, width: w }}
                    title={`${c.title}\n${a ? friendlyDate(a, api.today) : ""}${a && b && a !== b ? " → " : ""}${b && b !== a ? friendlyDate(b, api.today) : ""}`}
                    onPointerDown={(ev) => begin(ev, c, "move")}
                    onPointerMove={moveTo}
                    onPointerUp={() => end(c)}
                    onPointerCancel={() => setDrag(null)}
                  >
                    {!point && (
                      <>
                        {api.sync && (
                          <i
                            className="bv-tl-grip start"
                            onPointerDown={(ev) => begin(ev, c, "start")}
                            onPointerMove={moveTo}
                            onPointerUp={(ev) => {
                              ev.stopPropagation();
                              end(c);
                            }}
                          />
                        )}
                        {w > 70 && (
                          <span className="bv-tl-bar-text">{c.title}</span>
                        )}
                        <i
                          className="bv-tl-grip end"
                          onPointerDown={(ev) => begin(ev, c, "end")}
                          onPointerMove={moveTo}
                          onPointerUp={(ev) => {
                            ev.stopPropagation();
                            end(c);
                          }}
                        />
                      </>
                    )}
                    {live && drag!.delta !== 0 && (
                      <span className="bv-tl-delta">
                        {drag!.delta > 0 ? "+" : ""}
                        {drag!.delta} d
                      </span>
                    )}
                  </div>
                  {point && api.sync && !live && (
                    // Un punto se estira hacia atrás para darle inicio.
                    <i
                      className="bv-tl-grip stretch"
                      style={{ left: left - 2 }}
                      title="Arrastra para darle fecha de inicio"
                      onPointerDown={(ev) => begin(ev, c, "start")}
                      onPointerMove={moveTo}
                      onPointerUp={() => end(c)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {!rows.length && (
          <p className="bv-empty">
            Ninguna tarjeta tiene fechas todavía. Ponles fecha límite (y de
            inicio) para verlas aquí.
          </p>
        )}
      </div>
    </div>
  );
}

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);
