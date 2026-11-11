import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { priorityLabels, priorityWeight } from "../boardRules";
import { PRIORITIES, type BoardCard, type Priority } from "../boardStore";
import { dueState, tagTone } from "../boardTheme";
import {
  boardOrder,
  ChecksMini,
  colTone,
  DoneButton,
  type ViewApi,
} from "./shared";
import { QuickAdd } from "./ListView";

type SortKey =
  "" | "title" | "list" | "starts" | "due" | "priority" | "checks" | "updated";
const ROW = 44;
const THEAD = 36;

/**
 * Vista de tabla: una fila por tarjeta y sus campos en columnas, editables ahí mismo (columna,
 * inicio, fecha límite y prioridad). Se ordena tocando el encabezado. Virtualizada.
 */
export function TableView({ api }: { api: ViewApi }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "",
    desc: false,
  });
  const scroller = useRef<HTMLDivElement>(null);
  const colById = useMemo(
    () => new Map(api.columns.map((c) => [c.id, c])),
    [api.columns],
  );
  const colAt = useMemo(
    () => new Map(api.columns.map((c, i) => [c.id, i])),
    [api.columns],
  );

  const rows = useMemo(() => {
    const base = [...api.cards].sort(boardOrder(api.columns));
    if (!sort.key) return base;
    const far = sort.desc ? "0000" : "9999";
    const by: Record<
      Exclude<SortKey, "">,
      (a: BoardCard, b: BoardCard) => number
    > = {
      title: (a, b) =>
        a.title.localeCompare(b.title, "es", { sensitivity: "base" }),
      list: (a, b) => (colAt.get(a.list_id) ?? 0) - (colAt.get(b.list_id) ?? 0),
      starts: (a, b) => (a.starts ?? far).localeCompare(b.starts ?? far),
      due: (a, b) => (a.due ?? far).localeCompare(b.due ?? far),
      priority: (a, b) =>
        priorityWeight[a.priority] - priorityWeight[b.priority],
      checks: (a, b) => ratio(a) - ratio(b),
      updated: (a, b) =>
        (a.updated_at ?? a.touched_at ?? "").localeCompare(
          b.updated_at ?? b.touched_at ?? "",
        ),
    };
    const f = by[sort.key];
    return base.sort((a, b) => (sort.desc ? -f(a, b) : f(a, b)));
  }, [api.cards, api.columns, colAt, sort]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 16,
    // El encabezado fijo va antes de las filas, dentro del mismo desplazamiento.
    scrollMargin: THEAD,
  });

  const head = (key: SortKey, label: string) => (
    <button
      type="button"
      className={"bv-th" + (sort.key === key ? " on" : "")}
      aria-sort={
        sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"
      }
      onClick={() =>
        setSort((s) =>
          s.key !== key
            ? { key, desc: false }
            : s.desc
              ? { key: "", desc: false }
              : { key, desc: true },
        )
      }
    >
      {label}
      {sort.key === key &&
        (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
    </button>
  );

  return (
    <div className={"bv bv-tableview" + (api.sync ? " with-start" : "")}>
      <div className="bv-toolbar">
        <QuickAdd api={api} />
        <span className="bv-count">
          {rows.length.toLocaleString("es")}{" "}
          {rows.length === 1 ? "tarjeta" : "tarjetas"}
        </span>
      </div>
      <div
        className="bv-scroll bv-table"
        ref={scroller}
        role="table"
        aria-rowcount={rows.length}
      >
        <div className="bv-tr bv-thead" role="row">
          <span />
          {head("title", "Tarjeta")}
          {head("list", "Columna")}
          {api.sync && head("starts", "Inicio")}
          {head("due", "Fecha límite")}
          {head("priority", "Prioridad")}
          <span className="bv-th plain">Etiquetas</span>
          {head("checks", "Lista")}
          {head("updated", "Cambió")}
        </div>
        {!rows.length && (
          <p className="bv-empty">No hay tarjetas a la vista.</p>
        )}
        <div className="bv-space" style={{ height: v.getTotalSize() }}>
          {v.getVirtualItems().map((it) => {
            const c = rows[it.index];
            const done = api.isDone(c);
            const col = colById.get(c.list_id);
            const due = dueState(c.due, done);
            return (
              <div
                key={c.id}
                role="row"
                className={"bv-tr" + (done ? " done" : "")}
                style={{
                  transform: `translateY(${it.start - THEAD}px)`,
                  height: ROW,
                }}
              >
                <span className="bv-td">
                  <DoneButton
                    done={done}
                    title={c.title}
                    onToggle={() => api.toggle(c)}
                  />
                </span>
                <button
                  type="button"
                  className="bv-td bv-td-title"
                  onClick={() => api.open(c)}
                >
                  {c.title}
                </button>
                <span className="bv-td">
                  <select
                    className="bv-cell-select bv-cell-col"
                    style={{ "--lc": colTone(col) } as CSSProperties}
                    value={c.list_id}
                    aria-label="Columna"
                    onChange={(e) => api.move(c, e.target.value)}
                  >
                    {api.columns.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </span>
                {api.sync && (
                  <span className="bv-td">
                    <input
                      type="date"
                      className="bv-cell-date"
                      value={c.starts ?? ""}
                      max={c.due ?? undefined}
                      aria-label="Inicio"
                      onChange={(e) =>
                        api.patch(c, { starts: e.target.value || null })
                      }
                    />
                  </span>
                )}
                <span className={"bv-td" + (due ? " due-" + due.tone : "")}>
                  <input
                    type="date"
                    className="bv-cell-date"
                    value={c.due ?? ""}
                    min={c.starts ?? undefined}
                    aria-label="Fecha límite"
                    onChange={(e) =>
                      api.patch(c, { due: e.target.value || null })
                    }
                  />
                </span>
                <span className="bv-td">
                  <select
                    className={"bv-cell-select prio-" + (c.priority || "none")}
                    value={c.priority}
                    disabled={!api.power}
                    aria-label="Prioridad"
                    onChange={(e) =>
                      api.patch(c, { priority: e.target.value as Priority })
                    }
                  >
                    <option value="">—</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {priorityLabels[p]}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="bv-td bv-td-tags">
                  {c.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="bv-tag"
                      style={{ "--tg": tagTone(t).c } as CSSProperties}
                    >
                      {t}
                    </span>
                  ))}
                </span>
                <span className="bv-td">
                  <ChecksMini card={c} />
                </span>
                <span className="bv-td bv-faint">
                  {ago(c.updated_at ?? c.touched_at, api.today)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const ratio = (c: BoardCard) =>
  c.checks.length
    ? c.checks.filter((x) => x.done).length / c.checks.length
    : -1;

function ago(iso: string | undefined, today: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (day === today)
    return d.toLocaleTimeString("es", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("es", { day: "numeric", month: "short" });
}
