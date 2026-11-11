import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  CalendarArrowUp,
  CircleSlash,
  Shuffle,
  Sunrise,
  Undo2,
  X,
} from "lucide-react";
import { addDays, friendlyDate, nextMonday } from "../../lib/format";
import { dayDiff } from "../boardDates";
import { nextDue, weekdayOf } from "../boardRepeat";
import { priorityWeight } from "../boardRules";
import type { BoardCard, Column } from "../boardStore";
import { ChecksMini, ColChip, PrioFlag } from "./shared";

type Undo = () => void;

/** Reparte tarjetas en los próximos días sin pasar de `max` por día (contando lo que ya hay). */
export function spreadPlan(
  cards: BoardCard[],
  load: (date: string) => number,
  today: string,
  max: number,
  weekends: boolean,
) {
  const order = [...cards].sort(
    (a, b) =>
      priorityWeight[b.priority] - priorityWeight[a.priority] ||
      (a.due ?? "").localeCompare(b.due ?? ""),
  );
  const plan: { card: BoardCard; due: string }[] = [];
  let d = today;
  let used = load(d);
  for (const card of order) {
    for (let i = 0; i < 400; i++) {
      const off = !weekends && (weekdayOf(d) === 0 || weekdayOf(d) === 6);
      if (!off && used < max) break;
      d = addDays(d, 1);
      used = load(d);
    }
    plan.push({ card, due: d });
    used++;
  }
  return plan;
}

/**
 * Triage de vencidas: una por una, con cuatro salidas (hoy, mañana, lunes, soltar). O todas de
 * una vez: repartir la carga en los próximos días sin pasar de un tope por día.
 */
export function OverdueTriage({
  cards,
  columns,
  today,
  load,
  canDrop,
  onSet,
  onDrop,
  onSpread,
  onOpen,
  onClose,
}: {
  /** Vencidas y abiertas, al abrir el triage. */
  cards: BoardCard[];
  columns: Column[];
  today: string;
  /** Cuántas tarjetas abiertas vencen ese día (sin contar las vencidas). */
  load: (date: string) => number;
  canDrop: boolean;
  onSet: (c: BoardCard, due: string) => Undo;
  /** Soltar: archivar (o, si se repite, saltar esta vez). */
  onDrop: (c: BoardCard) => Undo;
  onSpread: (plan: { card: BoardCard; due: string }[]) => Undo;
  onOpen: (c: BoardCard) => void;
  onClose: () => void;
}) {
  // La cola se fija al abrir: lo que resuelves sale, aunque el tablero cambie mientras tanto.
  const [queue] = useState(() =>
    [...cards].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")),
  );
  const [done, setDone] = useState<
    { ids: string[]; undo: Undo; what: string }[]
  >([]);
  const [spread, setSpread] = useState(false);
  const [max, setMax] = useState(4);
  const [weekends, setWeekends] = useState(false);
  const gone = new Set(done.flatMap((d) => d.ids));
  const left = queue.filter((c) => !gone.has(c.id));
  const card = left[0];
  const colById = useMemo(
    () => new Map(columns.map((c) => [c.id, c])),
    [columns],
  );
  const tomorrow = addDays(today, 1);
  const monday = nextMonday(today);

  const act = (what: string, fn: () => Undo) => {
    if (!card) return;
    const undo = fn();
    setDone((d) => [...d, { ids: [card.id], undo, what }]);
  };
  const undoLast = () => {
    const last = done.at(-1);
    if (!last) return;
    last.undo();
    setDone((d) => d.slice(0, -1));
  };
  const drop = () =>
    act(card?.repeat ? "saltada" : "soltada", () => onDrop(card!));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") return onClose();
      if (spread || !card) return;
      const k = e.key.toLowerCase();
      if (k === "h" || k === "1") act("hoy", () => onSet(card, today));
      else if (k === "m" || k === "2")
        act("mañana", () => onSet(card, tomorrow));
      else if (k === "l" || k === "3") act("lunes", () => onSet(card, monday));
      else if ((k === "s" || k === "4") && (canDrop || card.repeat)) drop();
      else if ((e.ctrlKey || e.metaKey) && k === "z") undoLast();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const plan = useMemo(
    () => (spread ? spreadPlan(left, load, today, max, weekends) : []),
    // La cola se recalcula solo cuando cambia lo que queda o las opciones.
    [spread, left.length, max, weekends, today], // eslint-disable-line
  );
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plan) m.set(p.due, (m.get(p.due) ?? 0) + 1);
    return [...m.entries()];
  }, [plan]);

  const total = queue.length;
  const n = gone.size;
  const late = card?.due ? dayDiff(card.due, today) : 0;
  return createPortal(
    <div
      className="bv-modal-back"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bv-modal bv-triage"
        role="dialog"
        aria-modal="true"
        aria-label="Vencidas"
      >
        <header className="bv-modal-head">
          <div>
            <strong>Vencidas</strong>
            <span>
              {card ? `${n + 1} de ${total}` : `${total} de ${total}`}
            </span>
          </div>
          <div className="bv-triage-bar" aria-hidden="true">
            <i style={{ width: `${(100 * n) / Math.max(1, total)}%` }} />
          </div>
          <button
            type="button"
            className="bv-icon"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        {!spread && card && (
          <>
            <article className="bv-triage-card" key={card.id}>
              <div className="bv-triage-meta">
                <ColChip col={colById.get(card.list_id)} />
                <PrioFlag p={card.priority} />
                <ChecksMini card={card} />
              </div>
              <button
                type="button"
                className="bv-triage-title"
                onClick={() => onOpen(card)}
              >
                {card.title}
              </button>
              <p className="bv-triage-late">
                Venció {late === 1 ? "ayer" : `hace ${late} días`}
                {card.due &&
                  ` · ${friendlyDate(card.due, today).toLowerCase()}`}
                {card.repeat && " · se repite"}
              </p>
            </article>
            <div className="bv-triage-actions">
              <button
                type="button"
                onClick={() => act("hoy", () => onSet(card, today))}
              >
                <Sunrise size={17} />
                <strong>Hoy</strong>
                <kbd>H</kbd>
              </button>
              <button
                type="button"
                onClick={() => act("mañana", () => onSet(card, tomorrow))}
              >
                <ArrowRight size={17} />
                <strong>Mañana</strong>
                <kbd>M</kbd>
              </button>
              <button
                type="button"
                onClick={() => act("lunes", () => onSet(card, monday))}
              >
                <CalendarArrowUp size={17} />
                <strong>Lunes</strong>
                <small>{friendlyDate(monday, today).toLowerCase()}</small>
                <kbd>L</kbd>
              </button>
              <button
                type="button"
                className="drop"
                disabled={!canDrop && !card.repeat}
                title={
                  card.repeat
                    ? `Saltar esta vez: vuelve ${friendlyDate(nextDue(card.repeat, card.due, today) ?? today, today).toLowerCase()}`
                    : "Archivarla: deja de pedirte atención (la encuentras en Archivados)"
                }
                onClick={drop}
              >
                <CircleSlash size={17} />
                <strong>{card.repeat ? "Saltar" : "Soltar"}</strong>
                <kbd>S</kbd>
              </button>
            </div>
          </>
        )}

        {!spread && !card && (
          <div className="bv-triage-end">
            <strong>Al día.</strong>
            <span>
              {total} {total === 1 ? "vencida resuelta" : "vencidas resueltas"}.
            </span>
            <button type="button" className="bv-pill strong" onClick={onClose}>
              Listo
            </button>
          </div>
        )}

        {spread && (
          <div className="bv-spread">
            <p>
              Repartir {left.length}{" "}
              {left.length === 1 ? "tarjeta" : "tarjetas"} desde hoy, sin pasar
              de
              <span className="bv-stepper">
                <button
                  type="button"
                  aria-label="Menos"
                  onClick={() => setMax((m) => Math.max(1, m - 1))}
                >
                  −
                </button>
                <b>{max}</b>
                <button
                  type="button"
                  aria-label="Más"
                  onClick={() => setMax((m) => Math.min(20, m + 1))}
                >
                  +
                </button>
              </span>
              por día (contando lo que ya vence ese día). Lo prioritario va
              primero.
            </p>
            <label className="bv-check">
              <input
                type="checkbox"
                checked={weekends}
                onChange={(e) => setWeekends(e.target.checked)}
              />
              Usar también sábados y domingos
            </label>
            <div className="bv-spread-days">
              {perDay.map(([d, k]) => (
                <span
                  key={d}
                  style={
                    {
                      "--fill": `${(100 * (k + load(d))) / max}%`,
                    } as CSSProperties
                  }
                >
                  <b>{friendlyDate(d, today)}</b>
                  <i>
                    +{k}
                    {load(d) > 0 && <em> ({load(d)} ya)</em>}
                  </i>
                </span>
              ))}
            </div>
            <div className="bv-spread-go">
              <button
                type="button"
                className="bv-pill"
                onClick={() => setSpread(false)}
              >
                Una por una
              </button>
              <button
                type="button"
                className="bv-pill strong"
                disabled={!plan.length}
                onClick={() => {
                  const undo = onSpread(plan);
                  setDone((d) => [
                    ...d,
                    {
                      ids: plan.map((p) => p.card.id),
                      undo,
                      what: `${plan.length} repartidas`,
                    },
                  ]);
                  setSpread(false);
                }}
              >
                Repartir
              </button>
            </div>
          </div>
        )}

        <footer className="bv-modal-foot">
          <button
            type="button"
            className="bv-link"
            disabled={!done.length}
            onClick={undoLast}
          >
            <Undo2 size={13} /> Deshacer
            {done.at(-1) && <small> ({done.at(-1)!.what})</small>}
          </button>
          {!spread && left.length > 1 && (
            <button
              type="button"
              className="bv-link"
              onClick={() => setSpread(true)}
            >
              <Shuffle size={13} /> Repartir carga ({left.length})
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
