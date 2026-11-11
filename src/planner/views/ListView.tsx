import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Link2, Plus } from "lucide-react";
import { addDays } from "../../lib/format";
import { priorityLabels } from "../boardRules";
import type { BoardCard, Priority } from "../boardStore";
import { tagTone } from "../boardTheme";
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

type GroupBy = "columna" | "fecha" | "prioridad";
type Row =
  | {
      kind: "head";
      key: string;
      label: string;
      count: number;
      done: number;
      tone: string;
    }
  | { kind: "card"; card: BoardCard };

const HEAD = 42;
const ROW = 46;

/** Tramos de fecha: lo vencido arriba, lo que no tiene fecha al final. */
function dueBucket(c: BoardCard, today: string): [string, string] {
  if (!c.due) return ["9", "Sin fecha"];
  if (c.due < today) return ["0", "Vencidas"];
  if (c.due === today) return ["1", "Hoy"];
  if (c.due === addDays(today, 1)) return ["2", "Mañana"];
  if (c.due <= addDays(today, 7)) return ["3", "Próximos 7 días"];
  if (c.due <= addDays(today, 31)) return ["4", "Este mes"];
  return ["5", "Más adelante"];
}
const BUCKET_TONE: Record<string, string> = {
  "0": "#c8463f",
  "1": "#c7871f",
  "2": "#c7871f",
  "3": "#2f6b55",
  "4": "#6b8fb3",
  "5": "#7d8a92",
  "9": "#a3aca7",
};
const PRIO_TONE: Record<Priority, string> = {
  alta: "#c8463f",
  media: "#c7871f",
  baja: "#6b8fb3",
  "": "#a3aca7",
};

/**
 * Vista de lista: todas las tarjetas del tablero en filas compactas, agrupadas por columna, por
 * fecha o por prioridad. Solo se dibujan las filas a la vista (virtualizada): aguanta miles.
 */
export function ListView({ api }: { api: ViewApi }) {
  const [group, setGroup] = useState<GroupBy>("columna");
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const colById = useMemo(
    () => new Map(api.columns.map((c) => [c.id, c])),
    [api.columns],
  );

  const rows = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; tone: string; cards: BoardCard[] }
    >();
    const put = (key: string, label: string, tone: string, c: BoardCard) => {
      const g = groups.get(key);
      if (g) g.cards.push(c);
      else groups.set(key, { label, tone, cards: [c] });
    };
    const sorted = [...api.cards].sort(boardOrder(api.columns));
    if (group === "columna") {
      for (const col of api.columns)
        groups.set(col.id, { label: col.name, tone: colTone(col), cards: [] });
      for (const c of sorted) groups.get(c.list_id)?.cards.push(c);
    } else if (group === "fecha") {
      for (const c of [...sorted].sort((a, b) =>
        (a.due ?? "9999").localeCompare(b.due ?? "9999"),
      )) {
        const [k, label] = dueBucket(c, api.today);
        put(k, label, BUCKET_TONE[k], c);
      }
    } else {
      for (const p of ["alta", "media", "baja", ""] as Priority[])
        groups.set(p || "none", {
          label: priorityLabels[p],
          tone: PRIO_TONE[p],
          cards: [],
        });
      for (const c of [...sorted].sort((a, b) =>
        (a.due ?? "9999").localeCompare(b.due ?? "9999"),
      ))
        groups.get(c.priority || "none")!.cards.push(c);
    }
    const keys = [...groups.keys()].sort((a, b) =>
      group === "fecha" ? a.localeCompare(b) : 0,
    );
    const out: Row[] = [];
    for (const key of keys) {
      const g = groups.get(key)!;
      if (!g.cards.length && group !== "columna") continue;
      out.push({
        kind: "head",
        key,
        label: g.label,
        count: g.cards.length,
        done: g.cards.filter(api.isDone).length,
        tone: g.tone,
      });
      if (!folded.has(key))
        for (const c of g.cards) out.push({ kind: "card", card: c });
    }
    return out;
  }, [api.cards, api.columns, api.today, api.isDone, group, folded]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i].kind === "head" ? HEAD : ROW),
    overscan: 14,
  });

  return (
    <div className="bv bv-listview">
      <div className="bv-toolbar">
        <QuickAdd api={api} />
        <div className="bv-seg" role="radiogroup" aria-label="Agrupar por">
          {(["columna", "fecha", "prioridad"] as GroupBy[]).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={group === g}
              className={group === g ? "on" : ""}
              onClick={() => setGroup(g)}
            >
              {g === "columna"
                ? "Columna"
                : g === "fecha"
                  ? "Fecha"
                  : "Prioridad"}
            </button>
          ))}
        </div>
      </div>
      <div className="bv-scroll" ref={scroller}>
        {!api.cards.length && (
          <p className="bv-empty">No hay tarjetas a la vista.</p>
        )}
        <div className="bv-space" style={{ height: v.getTotalSize() }}>
          {v.getVirtualItems().map((it) => {
            const row = rows[it.index];
            const style: CSSProperties = {
              transform: `translateY(${it.start}px)`,
              height: it.size,
            };
            if (row.kind === "head") {
              const shut = folded.has(row.key);
              const pct = row.count
                ? Math.round((100 * row.done) / row.count)
                : 0;
              return (
                <button
                  key={"h" + row.key}
                  type="button"
                  className={"bv-ghead" + (shut ? " shut" : "")}
                  style={{ ...style, "--lc": row.tone } as CSSProperties}
                  aria-expanded={!shut}
                  onClick={() =>
                    setFolded((s) => {
                      const n = new Set(s);
                      if (n.has(row.key)) n.delete(row.key);
                      else n.add(row.key);
                      return n;
                    })
                  }
                >
                  <ChevronRight size={14} className="bv-ghead-chev" />
                  <i className="bv-ghead-dot" />
                  <strong>{row.label}</strong>
                  <span className="bv-ghead-n">{row.count}</span>
                  {row.count > 0 && (
                    <span
                      className="bv-ghead-pct"
                      title={`${row.done} de ${row.count} completadas`}
                    >
                      <span className="bv-meter">
                        <i style={{ width: pct + "%" }} />
                      </span>
                      {pct} %
                    </span>
                  )}
                </button>
              );
            }
            const c = row.card;
            const done = api.isDone(c);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                className={
                  "bv-row" + (done ? " done" : "") + (c.highlight ? " hl" : "")
                }
                style={style}
                onClick={() => api.open(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") api.open(c);
                  if (e.key === " ") {
                    e.preventDefault();
                    api.toggle(c);
                  }
                }}
              >
                <DoneButton
                  done={done}
                  title={c.title}
                  onToggle={() => api.toggle(c)}
                />
                <span className="bv-row-title">{c.title}</span>
                <span className="bv-row-meta">
                  {c.tags.slice(0, 2).map((t) => (
                    <span
                      key={t}
                      className="bv-tag"
                      style={{ "--tg": tagTone(t).c } as CSSProperties}
                    >
                      {t}
                    </span>
                  ))}
                  {api.linked(c) && <Link2 size={12} className="bv-faint" />}
                  <ChecksMini card={c} />
                  <PrioFlag p={c.priority} />
                  <DueChip card={c} done={done} />
                  {group !== "columna" && (
                    <ColChip col={colById.get(c.list_id)} />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Añadir sin salir de la vista: con la escritura rápida y las fechas del título. */
export function QuickAdd({ api, due }: { api: ViewApi; due?: string | null }) {
  const [text, setText] = useState("");
  const [list, setList] = useState(api.columns[0]?.id ?? "");
  const target = api.columns.some((c) => c.id === list)
    ? list
    : (api.columns[0]?.id ?? "");
  if (!api.columns.length) return null;
  return (
    <form
      className="bv-quick"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t || !target) return;
        api.add(target, t, due);
        setText("");
      }}
    >
      <Plus size={15} aria-hidden="true" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Añade una tarjeta… «Llamar al banco el viernes»"
        aria-label="Nueva tarjeta"
      />
      <select
        value={target}
        aria-label="Columna"
        onChange={(e) => setList(e.target.value)}
      >
        {api.columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </form>
  );
}
