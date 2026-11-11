import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowRight,
  BarChart3,
  CalendarClock,
  Check,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  X,
  AlarmClock,
} from "lucide-react";
import { supabase } from "../../backend";
import { Sheet } from "../../components/Sheet";
import { friendlyDate, todayInputValue } from "../../lib/format";
import type { BoardCard, CardChanges, Column } from "../boardStore";
import type { UndoStep } from "../boardUndo";
import { missingSyncText } from "../boardStore";

/** Una fila de board_activity (migración 202611100008). */
export type Activity = {
  id: number;
  card_id: string | null;
  list_id: string | null;
  action: string;
  changes: Record<string, [unknown, unknown]>;
  created_at: string;
};

const PAGE = 150;
/** Campos que se pueden devolver a como estaban desde el historial. */
const REVERTIBLE: (keyof CardChanges)[] = [
  "title",
  "body",
  "tags",
  "checks",
  "due",
  "starts",
  "done",
  "done_at",
  "color",
  "priority",
  "highlight",
  "snoozed_until",
  "repeat",
  "list_id",
];
const FIELD: Record<string, string> = {
  title: "título",
  body: "descripción",
  tags: "etiquetas",
  checks: "lista",
  due: "fecha límite",
  starts: "inicio",
  color: "color",
  priority: "prioridad",
  highlight: "resaltado",
  snoozed_until: "pospuesta",
  repeat: "repetir",
  list_id: "columna",
  entry_id: "pendiente",
  episode_id: "episodio",
  person_id: "persona",
  reading_id: "lectura",
  remind_at: "recordatorio",
  archived_at: "archivada",
  done: "completada",
  done_at: "completada",
};
const ACTION: Record<string, { label: string; icon: typeof Plus }> = {
  create: { label: "Se creó", icon: Plus },
  delete: { label: "Se eliminó", icon: Trash2 },
  archive: { label: "Se archivó", icon: Archive },
  unarchive: { label: "Se desarchivó", icon: ArchiveRestore },
  done: { label: "Se completó", icon: Check },
  undone: { label: "Se reabrió", icon: RotateCcw },
  move: { label: "Se movió", icon: ArrowRight },
  postpone: { label: "Se pospuso la fecha", icon: CalendarClock },
  snooze: { label: "Se pospuso", icon: AlarmClock },
  update: { label: "Se editó", icon: Pencil },
};

const time = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const short = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? `${v.length}` : "—";
  if (typeof v === "boolean") return v ? "sí" : "no";
  return String(v).slice(0, 40);
};
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const days = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
const fmtDays = (d: number | null) =>
  d === null ? "—" : d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d.toFixed(d < 10 ? 1 : 0)} d`;
/** Lunes de la semana de una fecha (AAAA-MM-DD). */
const weekOf = (iso: string) => {
  const d = new Date(iso);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return todayInputValue(d);
};

/**
 * Historial del tablero (o de una tarjeta), sus métricas y los pasos que puedes deshacer. Todo sale
 * de board_activity, que la base llena sola con cada cambio.
 */
export function BoardHistory({
  boardId,
  cardId,
  cards,
  columns,
  steps,
  onUndoTo,
  onRevert,
  onOpen,
  onClose,
}: {
  boardId: string;
  /** Solo el historial de esta tarjeta. */
  cardId?: string;
  cards: BoardCard[];
  columns: Column[];
  steps: UndoStep[];
  onUndoTo: (id: number) => void;
  /** Devuelve esos campos de la tarjeta a como estaban. */
  onRevert: (cardId: string, fields: CardChanges) => void;
  onOpen: (cardId: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"log" | "stats" | "undo">(cardId ? "log" : "log");
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const colName = (id: unknown) =>
    columns.find((c) => c.id === id)?.name ?? "otra columna";

  const page = async (from: number) => {
    setBusy(true);
    let q = supabase
      .from("board_activity")
      .select("id,card_id,list_id,action,changes,created_at")
      .eq("board_id", boardId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (cardId) q = q.eq("card_id", cardId);
    const { data, error } = await q;
    setBusy(false);
    if (error) {
      setError(/board_activity/.test(error.message) ? missingSyncText : error.message);
      setRows((r) => r ?? []);
      return;
    }
    const got = (data ?? []) as Activity[];
    setRows((r) => (from ? [...(r ?? []), ...got] : got));
    setMore(got.length === PAGE);
  };
  useEffect(() => {
    void page(0);
  }, [boardId, cardId]);

  // Títulos: el de ahora o el último que quedó escrito en el historial.
  const titles = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of [...(rows ?? [])].reverse()) {
      const t = r.changes?.title;
      if (r.card_id && t) m.set(r.card_id, String(t[1] ?? t[0] ?? ""));
    }
    return m;
  }, [rows]);
  const titleOf = (id: string | null) =>
    (id && (byId.get(id)?.title ?? titles.get(id))) || "Tarjeta";

  const describe = (r: Activity) => {
    const keys = Object.keys(r.changes ?? {}).filter((k) => FIELD[k] && k !== "done_at");
    if (r.action === "move" && r.changes.list_id)
      return `de «${colName(r.changes.list_id[0])}» a «${colName(r.changes.list_id[1])}»`;
    if (r.action === "postpone" && r.changes.due)
      return `${friendlyDate(String(r.changes.due[0]))} → ${friendlyDate(String(r.changes.due[1]))}`;
    if (r.action === "create" || r.action === "delete") return "";
    return keys
      .slice(0, 3)
      .map((k) => {
        const [a, b] = r.changes[k];
        return k === "title" || k === "body" || k === "checks" || k === "tags"
          ? FIELD[k]
          : `${FIELD[k]}: ${short(a)} → ${short(b)}`;
      })
      .join(" · ");
  };
  const revertible = (r: Activity) => {
    if (!r.card_id || !byId.has(r.card_id)) return null;
    const fields: Record<string, unknown> = {};
    for (const k of REVERTIBLE) if (r.changes?.[k]) fields[k] = r.changes[k][0];
    return Object.keys(fields).length ? (fields as CardChanges) : null;
  };

  return (
    <Sheet label="Historial y métricas" size="lg" className="bvh" onRequestClose={onClose}>
      <header className="bvh-head">
        <span className="bvh-mark" aria-hidden="true">
          <History size={18} />
        </span>
        <div>
          <h2>{cardId ? `Historial de «${titleOf(cardId).slice(0, 60)}»` : "Historial y métricas"}</h2>
          <small>Cada cambio queda registrado en la base, también los de otros equipos.</small>
        </div>
        <button type="button" className="bvh-x" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <nav className="bvh-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "log"} onClick={() => setTab("log")}>
          <Activity size={14} /> Historial
        </button>
        {!cardId && (
          <button type="button" role="tab" aria-selected={tab === "stats"} onClick={() => setTab("stats")}>
            <BarChart3 size={14} /> Métricas
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === "undo"} onClick={() => setTab("undo")}>
          <Undo2 size={14} /> Deshacer {steps.length > 0 && <b>{steps.length}</b>}
        </button>
      </nav>

      <div className="bvh-body">
        {tab === "log" &&
          (rows === null ? (
            <p className="bvh-empty">
              <LoaderCircle className="spin" size={16} />
            </p>
          ) : error ? (
            <p className="bvh-empty">{error}</p>
          ) : !rows.length ? (
            <p className="bvh-empty">Aún no hay cambios registrados.</p>
          ) : (
            <ol className="bvh-log">
              {rows.map((r) => {
                const a = ACTION[r.action] ?? ACTION.update;
                const back = revertible(r);
                return (
                  <li key={r.id} className={"bvh-row " + r.action}>
                    <span className="bvh-ico">
                      <a.icon size={13} />
                    </span>
                    <div className="bvh-text">
                      <p>
                        <b>{a.label}</b>{" "}
                        {!cardId && (
                          <button
                            type="button"
                            className="bvh-card"
                            disabled={!r.card_id || !byId.has(r.card_id)}
                            onClick={() => r.card_id && onOpen(r.card_id)}
                          >
                            «{titleOf(r.card_id).slice(0, 60)}»
                          </button>
                        )}
                      </p>
                      <small>
                        {time(r.created_at)}
                        {describe(r) && ` · ${describe(r)}`}
                      </small>
                    </div>
                    {back && (
                      <button
                        type="button"
                        className="bvh-revert"
                        title="Volver a como estaba antes de este cambio"
                        onClick={() => onRevert(r.card_id!, back)}
                      >
                        <RotateCcw size={12} /> Revertir
                      </button>
                    )}
                  </li>
                );
              })}
              {more && (
                <li className="bvh-more">
                  <button type="button" disabled={busy} onClick={() => void page(rows.length)}>
                    {busy ? <LoaderCircle className="spin" size={14} /> : "Ver más"}
                  </button>
                </li>
              )}
            </ol>
          ))}

        {tab === "stats" && <Metrics boardId={boardId} cards={cards} columns={columns} />}

        {tab === "undo" &&
          (steps.length ? (
            <ol className="bvh-log">
              {[...steps].reverse().map((s, i) => (
                <li key={s.id} className="bvh-row">
                  <span className="bvh-ico">
                    <Undo2 size={13} />
                  </span>
                  <div className="bvh-text">
                    <p>{s.label}</p>
                    <small>{time(new Date(s.at).toISOString())}</small>
                  </div>
                  <button type="button" className="bvh-revert" onClick={() => onUndoTo(s.id)}>
                    {i === 0 ? "Deshacer" : `Deshacer ${i + 1} pasos`}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="bvh-empty">
              Lo que hagas en esta sesión se puede deshacer aquí o con Ctrl + Z, paso a paso.
            </p>
          ))}
      </div>
    </Sheet>
  );
}

/** Métricas de los últimos 90 días: ritmo, tiempo de ciclo, lo que más se pospone, y por columna. */
function Metrics({ boardId, cards, columns }: { boardId: string; cards: BoardCard[]; columns: Column[] }) {
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    void (async () => {
      const all: Activity[] = [];
      for (let n = 0; n < 20_000; n += 1000) {
        const { data, error } = await supabase
          .from("board_activity")
          .select("id,card_id,list_id,action,changes,created_at")
          .eq("board_id", boardId)
          .gte("created_at", since)
          .order("created_at")
          .order("id")
          .range(n, n + 999);
        if (!live) return;
        if (error) return setError(error.message);
        all.push(...((data ?? []) as Activity[]));
        if ((data ?? []).length < 1000) break;
      }
      setRows(all);
    })();
    return () => {
      live = false;
    };
  }, [boardId]);

  const stats = useMemo(() => {
    if (!rows) return null;
    const today = todayInputValue();
    const weeks: string[] = [];
    for (let i = 7; i >= 0; i--) weeks.push(weekOf(new Date(Date.now() - i * 7 * 86_400_000).toISOString()));
    const done = new Map(weeks.map((w) => [w, 0]));
    const made = new Map(weeks.map((w) => [w, 0]));
    const postponed = new Map<string, number>();
    let reopened = 0;
    let moves = 0;
    for (const r of rows) {
      const w = weekOf(r.created_at);
      if (r.action === "done" && done.has(w)) done.set(w, done.get(w)! + 1);
      if (r.action === "create" && made.has(w)) made.set(w, made.get(w)! + 1);
      if (r.action === "postpone" && r.card_id)
        postponed.set(r.card_id, (postponed.get(r.card_id) ?? 0) + 1);
      if (r.action === "undone") reopened++;
      if (r.action === "move") moves++;
    }
    // Tiempo de ciclo: de creada a completada (las completadas que siguen en el tablero).
    const cycle = cards
      .filter((c) => c.done && c.done_at && c.created_at)
      .map((c) => days(c.created_at!, c.done_at!))
      .filter((d) => d >= 0);
    // Tiempo en cada columna: entre llegar y salir (según los movimientos registrados).
    const stay = new Map<string, number[]>();
    const where = new Map<string, { list: string; since: string }>();
    for (const r of rows) {
      if (!r.card_id) continue;
      if (r.action === "create" && r.list_id) where.set(r.card_id, { list: r.list_id, since: r.created_at });
      if (r.action === "move" && r.changes.list_id) {
        const prev = where.get(r.card_id);
        if (prev && prev.list === r.changes.list_id[0]) {
          const l = stay.get(prev.list) ?? [];
          l.push(days(prev.since, r.created_at));
          stay.set(prev.list, l);
        }
        where.set(r.card_id, { list: String(r.changes.list_id[1]), since: r.created_at });
      }
    }
    const open = cards.filter((c) => !c.done && !c.archived_at);
    return {
      weeks,
      done,
      made,
      top: [...postponed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      postponedTotal: [...postponed.values()].reduce((a, b) => a + b, 0),
      reopened,
      moves,
      cycle: { median: median(cycle), p85: pct(cycle, 0.85), n: cycle.length },
      stay: columns.map((c) => ({ col: c, med: median(stay.get(c.id) ?? []), n: stay.get(c.id)?.length ?? 0 })),
      open: open.length,
      late: open.filter((c) => c.due && c.due < today).length,
    };
  }, [rows, cards, columns]);

  if (error) return <p className="bvh-empty">{error}</p>;
  if (!stats)
    return (
      <p className="bvh-empty">
        <LoaderCircle className="spin" size={16} />
      </p>
    );
  const peak = Math.max(1, ...stats.weeks.map((w) => Math.max(stats.done.get(w)!, stats.made.get(w)!)));
  const title = (id: string) => cards.find((c) => c.id === id)?.title ?? "Tarjeta archivada o eliminada";
  return (
    <div className="bvh-stats">
      <div className="bvh-kpis">
        <div>
          <b>{stats.open}</b>
          <span>abiertas</span>
          <small>{stats.late ? `${stats.late} vencidas` : "ninguna vencida"}</small>
        </div>
        <div>
          <b>{fmtDays(stats.cycle.median)}</b>
          <span>tiempo de ciclo</span>
          <small>
            mediana de creada a completada · 85 %: {fmtDays(stats.cycle.p85)} ({stats.cycle.n})
          </small>
        </div>
        <div>
          <b>{stats.postponedTotal}</b>
          <span>fechas pospuestas</span>
          <small>{stats.reopened} reabiertas · {stats.moves} movimientos</small>
        </div>
      </div>

      <section>
        <h4>Por semana (8 semanas)</h4>
        <div className="bvh-bars" role="img" aria-label="Creadas y completadas por semana">
          {stats.weeks.map((w) => (
            <div key={w} className="bvh-bar">
              <i className="made" style={{ height: `${(100 * stats.made.get(w)!) / peak}%` }} title={`${stats.made.get(w)} creadas`} />
              <i className="done" style={{ height: `${(100 * stats.done.get(w)!) / peak}%` }} title={`${stats.done.get(w)} completadas`} />
              <small>{friendlyDate(w).replace(/^\w+\.?\s/, "")}</small>
            </div>
          ))}
        </div>
        <p className="bvh-legend">
          <i className="made" /> creadas <i className="done" /> completadas
        </p>
      </section>

      <section>
        <h4>Tiempo en cada columna</h4>
        <ul className="bvh-stay">
          {stats.stay.map(({ col, med, n }) => (
            <li key={col.id}>
              <span>{col.name}</span>
              <b>{fmtDays(med)}</b>
              <small>{n ? `${n} salidas` : "sin datos"}</small>
            </li>
          ))}
        </ul>
      </section>

      {stats.top.length > 0 && (
        <section>
          <h4>Lo que más se pospone</h4>
          <ul className="bvh-stay">
            {stats.top.map(([id, n]) => (
              <li key={id}>
                <span>{title(id)}</span>
                <b>{n}×</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
