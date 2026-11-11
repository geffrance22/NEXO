import { todayInputValue } from "../lib/format";
import { step, type Repeat } from "./boardRepeat";
import type { BoardCard, Completion } from "./boardStore";

/**
 * Rutinas: las tarjetas que se repiten guardan cada vez que se cumplieron (la fecha que cerraron
 * y cuándo). Con eso se cuentan las veces, la racha y el calendario de puntos («Regar plantas:
 * 12 de 14»). Una vez que pasó sin marcarse cuenta como perdida.
 */

/** Tope del registro guardado en la tarjeta (las más viejas se descartan). */
const KEEP = 500;

/** El registro con una vez más: la fecha que se cerró (`due`) y ahora. */
export function logCompletion(
  c: Pick<BoardCard, "due" | "completions">,
  today = todayInputValue(),
) {
  const entry: Completion = {
    due: c.due ?? today,
    at: new Date().toISOString(),
  };
  return [...c.completions, entry].slice(-KEEP);
}

export type Occurrence = { date: string; done: boolean; at?: string };
export type RoutineStats = {
  /** Las últimas veces que tocaba (de la más vieja a la más nueva), sin la que está abierta. */
  recent: Occurrence[];
  /** De esas, cuántas se cumplieron. */
  kept: number;
  /** Seguidas hasta la última que tocaba. */
  streak: number;
  /** La mejor racha del registro. */
  best: number;
  /** Veces cumplidas en total. */
  total: number;
};

/**
 * El día que cuenta una marca: el que cerró o, si la marcaste tarde, el día en que la hiciste
 * (regar el miércoles lo de un lunes cuenta para el miércoles; el lunes y el martes se perdieron).
 */
function effective(m: Completion, until: string) {
  const done = todayInputValue(new Date(m.at));
  return done > m.due && done < until ? done : m.due;
}

/**
 * Las veces que tocaba, desde la primera registrada hasta la fecha abierta (sin incluirla). Una
 * vez cuenta como cumplida si alguna marca cerró una fecha dentro de su tramo [fecha, siguiente):
 * así aguanta que hayas cambiado el día a mano.
 */
export function routineStats(
  rule: Repeat,
  due: string | null,
  completions: Completion[],
  window = 14,
): RoutineStats | null {
  if (!rule) return null;
  const marks = [...completions].sort((a, b) => a.due.localeCompare(b.due));
  const total = marks.length;
  if (!total) return { recent: [], kept: 0, streak: 0, best: 0, total: 0 };
  const until = due ?? todayInputValue();
  const dates: string[] = [];
  let d = marks[0].due;
  for (let i = 0; d < until && i < 2000; i++) {
    dates.push(d);
    const next = step(rule, d);
    if (next <= d) break;
    d = next;
  }
  const all: Occurrence[] = dates.map((date, i) => {
    const end = dates[i + 1] ?? until;
    const hit = marks.find((m) => {
      const when = effective(m, until);
      return when >= date && when < end;
    });
    return { date, done: Boolean(hit), at: hit?.at };
  });
  let best = 0;
  let run = 0;
  for (const o of all) {
    run = o.done ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let streak = 0;
  for (let i = all.length - 1; i >= 0 && all[i].done; i--) streak++;
  const recent = all.slice(-window);
  return {
    recent,
    kept: recent.filter((o) => o.done).length,
    streak,
    best,
    total,
  };
}
