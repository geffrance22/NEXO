import { Flame } from "lucide-react";
import { friendlyDate, todayInputValue } from "../../lib/format";
import { routineStats } from "../boardRoutine";
import type { BoardCard } from "../boardStore";

/**
 * Rutina de una tarjeta que se repite: cuántas de las últimas veces se cumplió, la racha y un
 * calendario de puntos (lleno: cumplida; vacío: se pasó).
 */
export function RoutineStats({
  card,
  sync,
}: {
  card: BoardCard;
  sync: boolean;
}) {
  if (!card.repeat) return null;
  if (!sync)
    return (
      <small className="bdm-repeat-hint">
        Para llevar la cuenta de la rutina ejecuta
        supabase/migrations/202611100008_board_views_sync.sql.
      </small>
    );
  const s = routineStats(card.repeat, card.due, card.completions);
  if (!s || !s.total || !s.recent.length)
    return (
      <small className="bdm-repeat-hint">
        Cada vez que la completes queda en su registro: veces, racha y
        calendario.
      </small>
    );
  const today = todayInputValue();
  const n = s.recent.length;
  return (
    <div className="bv-routine" aria-label="Rutina">
      <div className="bv-routine-top">
        <strong>
          {s.kept} <span>de {n}</span>
        </strong>
        {s.streak > 1 && (
          <span className="bv-routine-streak" title={`Mejor racha: ${s.best}`}>
            <Flame size={12} /> {s.streak} seguidas
          </span>
        )}
      </div>
      <div className="bv-routine-dots" role="list">
        {s.recent.map((o) => (
          <i
            key={o.date}
            role="listitem"
            className={o.done ? "on" : ""}
            title={`${friendlyDate(o.date, today)} · ${o.done ? "cumplida" : "se pasó"}`}
          />
        ))}
      </div>
      <small>
        {s.total} {s.total === 1 ? "vez" : "veces"} en total
        {s.best > 1 && ` · mejor racha ${s.best}`}
      </small>
    </div>
  );
}
