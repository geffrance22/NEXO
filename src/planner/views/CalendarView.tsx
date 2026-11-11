import { useMemo, useState, type CSSProperties, type DragEvent } from "react";
import { ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import { addDays, friendlyDate } from "../../lib/format";
import { step, weekdayOf } from "../boardRepeat";
import type { BoardCard } from "../boardStore";
import { colTone, DoneButton, PrioFlag, type ViewApi } from "./shared";
import { QuickAdd } from "./ListView";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const SHOW = 3;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Vista de calendario: las tarjetas en el día de su fecha límite. Se arrastran de un día a otro
 * (o desde «Sin fecha»), y las que se repiten muestran sus próximas vueltas en tenue.
 */
export function CalendarView({ api }: { api: ViewApi }) {
  const [month, setMonth] = useState(() => api.today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const colById = useMemo(
    () => new Map(api.columns.map((c) => [c.id, c])),
    [api.columns],
  );

  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  // La cuadrícula empieza el lunes de la semana del día 1 y dura seis semanas.
  const start = addDays(first, -((weekdayOf(first) + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const end = days[41];

  const { byDay, ghosts, undated } = useMemo(() => {
    const byDay = new Map<string, BoardCard[]>();
    const ghosts = new Map<string, BoardCard[]>();
    const undated: BoardCard[] = [];
    for (const c of api.cards) {
      if (!c.due) {
        undated.push(c);
        continue;
      }
      const l = byDay.get(c.due);
      if (l) l.push(c);
      else byDay.set(c.due, [c]);
      // Las próximas vueltas de una rutina, dentro de lo que se ve.
      if (c.repeat && c.due <= end) {
        let d = step(c.repeat, c.due);
        for (let i = 0; d <= end && i < 60; i++) {
          if (d >= start) ghosts.set(d, [...(ghosts.get(d) ?? []), c]);
          d = step(c.repeat, d);
        }
      }
    }
    return { byDay, ghosts, undated };
  }, [api.cards, start, end]);

  const shift = (n: number) => {
    const t = y * 12 + (m - 1) + n;
    setMonth(`${Math.floor(t / 12)}-${pad((t % 12) + 1)}`);
  };
  const drop = (e: DragEvent, date: string | null) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/nexo-card");
    const c = api.cards.find((x) => x.id === id);
    if (!c || c.due === date) return;
    api.patch(
      c,
      { due: date },
      date
        ? `«${c.title.slice(0, 30)}» pasó al ${friendlyDate(date, api.today).toLowerCase()}`
        : "Sin fecha",
    );
  };
  const chip = (c: BoardCard, ghost = false) => {
    const done = api.isDone(c);
    return (
      <button
        key={(ghost ? "g" : "") + c.id}
        type="button"
        draggable={!ghost}
        className={
          "bv-cal-chip" + (done ? " done" : "") + (ghost ? " ghost" : "")
        }
        style={{ "--lc": colTone(colById.get(c.list_id)) } as CSSProperties}
        title={ghost ? `${c.title} · vuelve este día` : c.title}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/nexo-card", c.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={(e) => {
          e.stopPropagation();
          api.open(c);
        }}
      >
        {ghost && <Repeat size={9} />}
        <span>{c.title}</span>
      </button>
    );
  };

  const selected = day ? (byDay.get(day) ?? []) : undated;
  return (
    <div className="bv bv-calendar">
      <div className="bv-cal-main">
        <div className="bv-cal-head">
          <h3>
            {MONTHS[m - 1]} <span>{y}</span>
          </h3>
          <div className="bv-cal-nav">
            <button
              type="button"
              className="bv-icon"
              aria-label="Mes anterior"
              onClick={() => shift(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="bv-pill"
              onClick={() => {
                setMonth(api.today.slice(0, 7));
                setDay(api.today);
              }}
            >
              Hoy
            </button>
            <button
              type="button"
              className="bv-icon"
              aria-label="Mes siguiente"
              onClick={() => shift(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="bv-cal-grid" role="grid">
          {DAYS.map((d) => (
            <span key={d} className="bv-cal-dow" role="columnheader">
              {d}
            </span>
          ))}
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const ghost = (ghosts.get(d) ?? []).filter(
              (g) => !list.some((x) => x.id === g.id),
            );
            const outside = !d.startsWith(month);
            const shown = list.slice(0, SHOW);
            const more = list.length - shown.length;
            const late = list.some((c) => !api.isDone(c)) && d < api.today;
            return (
              <div
                key={d}
                role="gridcell"
                tabIndex={0}
                aria-selected={day === d}
                className={
                  "bv-cal-day" +
                  (outside ? " out" : "") +
                  (d === api.today ? " today" : "") +
                  (day === d ? " on" : "") +
                  (over === d ? " over" : "") +
                  (late ? " late" : "") +
                  (weekdayOf(d) % 6 === 0 ? " weekend" : "")
                }
                onClick={() => setDay((x) => (x === d ? null : d))}
                onKeyDown={(e) => e.key === "Enter" && setDay(d)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (over !== d) setOver(d);
                }}
                onDragLeave={() => over === d && setOver(null)}
                onDrop={(e) => drop(e, d)}
              >
                <span className="bv-cal-num">{Number(d.slice(8))}</span>
                <div className="bv-cal-items">
                  {shown.map((c) => chip(c))}
                  {more > 0 && <span className="bv-cal-more">+{more} más</span>}
                  {!more &&
                    shown.length < SHOW &&
                    ghost
                      .slice(0, SHOW - shown.length)
                      .map((c) => chip(c, true))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <aside
        className={"bv-cal-side" + (over === "none" ? " over" : "")}
        onDragOver={(e) => {
          if (day) return;
          e.preventDefault();
          setOver("none");
        }}
        onDragLeave={() => over === "none" && setOver(null)}
        onDrop={(e) => !day && drop(e, null)}
      >
        <header>
          <strong>{day ? friendlyDate(day, api.today) : "Sin fecha"}</strong>
          <span>
            {day
              ? `${selected.length} ${selected.length === 1 ? "tarjeta" : "tarjetas"}`
              : "Arrástralas a un día"}
          </span>
          {day && (
            <button
              type="button"
              className="bv-link"
              onClick={() => setDay(null)}
            >
              Ver sin fecha
            </button>
          )}
        </header>
        {day && <QuickAdd api={api} due={day} />}
        <div className="bv-cal-list">
          {!selected.length && (
            <p className="bv-empty sm">
              {day ? "Nada para este día." : "Todas tienen fecha."}
            </p>
          )}
          {selected.map((c) => {
            const done = api.isDone(c);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                draggable
                className={"bv-side-card" + (done ? " done" : "")}
                style={
                  { "--lc": colTone(colById.get(c.list_id)) } as CSSProperties
                }
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/nexo-card", c.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => api.open(c)}
                onKeyDown={(e) => e.key === "Enter" && api.open(c)}
              >
                <DoneButton
                  done={done}
                  title={c.title}
                  onToggle={() => api.toggle(c)}
                />
                <span className="bv-side-title">{c.title}</span>
                <PrioFlag p={c.priority} />
                <i className="bv-side-col">{colById.get(c.list_id)?.name}</i>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
