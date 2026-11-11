import { useMemo, useState, type CSSProperties, type DragEvent } from "react";
import { addDays } from "../../lib/format";
import type { BoardCard, CardChanges, Priority } from "../boardStore";
import { colTone, DoneButton, DueChip, PrioFlag, type ViewApi } from "./shared";

type Q = "do" | "plan" | "quick" | "later";
type Prefs = { soon: number; from: "alta" | "media" };
const KEY = "nexo-board-matrix";
const readPrefs = (): Prefs => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return {
      soon: [1, 2, 3, 7].includes(v.soon ?? 0) ? v.soon! : 2,
      from: v.from === "media" ? "media" : "alta",
    };
  } catch {
    return { soon: 2, from: "alta" };
  }
};

const QUADS: { key: Q; title: string; hint: string; tone: string }[] = [
  {
    key: "do",
    title: "Hacer ya",
    hint: "Importante y urgente",
    tone: "#c8463f",
  },
  {
    key: "plan",
    title: "Planificar",
    hint: "Importante, sin prisa",
    tone: "#2f6b55",
  },
  {
    key: "quick",
    title: "Despachar",
    hint: "Urgente, poco importante",
    tone: "#c7871f",
  },
  {
    key: "later",
    title: "Después o soltar",
    hint: "Ni urgente ni importante",
    tone: "#7d8a92",
  },
];

/**
 * Matriz importante / urgente (Eisenhower) con lo que ya existe: la prioridad dice qué tan
 * importante es y la fecha límite qué tan urgente. Arrastrar entre cuadrantes cambia esos dos
 * campos (y nada más).
 */
export function MatrixView({ api }: { api: ViewApi }) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [over, setOver] = useState<Q | null>(null);
  const colById = useMemo(
    () => new Map(api.columns.map((c) => [c.id, c])),
    [api.columns],
  );
  const save = (p: Prefs) => {
    setPrefs(p);
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* sin almacenamiento */
    }
  };
  const limit = addDays(api.today, prefs.soon);
  const important = (p: Priority) =>
    p === "alta" || (prefs.from === "media" && p === "media");
  const urgent = (c: BoardCard) => Boolean(c.due && c.due <= limit);
  const quadOf = (c: BoardCard): Q =>
    important(c.priority)
      ? urgent(c)
        ? "do"
        : "plan"
      : urgent(c)
        ? "quick"
        : "later";

  const open = api.cards.filter((c) => !api.isDone(c));
  const hidden = api.cards.length - open.length;
  const by: Record<Q, BoardCard[]> = { do: [], plan: [], quick: [], later: [] };
  for (const c of open) by[quadOf(c)].push(c);
  for (const k of Object.keys(by) as Q[])
    by[k].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));

  /** Qué cambia al soltarla en otro cuadrante: solo prioridad y fecha, lo justo. */
  const changesFor = (c: BoardCard, q: Q): CardChanges => {
    const ch: CardChanges = {};
    const wantImp = q === "do" || q === "plan";
    const wantUrg = q === "do" || q === "quick";
    if (wantImp && !important(c.priority)) ch.priority = "alta";
    if (!wantImp && important(c.priority))
      ch.priority = prefs.from === "media" ? "baja" : "media";
    if (wantUrg && !urgent(c)) ch.due = api.today;
    if (!wantUrg && urgent(c)) ch.due = addDays(api.today, prefs.soon + 1);
    if (!api.power) delete ch.priority;
    return ch;
  };
  const drop = (e: DragEvent, q: Q) => {
    e.preventDefault();
    setOver(null);
    const c = api.cards.find(
      (x) => x.id === e.dataTransfer.getData("text/nexo-card"),
    );
    if (!c || quadOf(c) === q) return;
    const ch = changesFor(c, q);
    if (Object.keys(ch).length)
      api.patch(
        c,
        ch,
        `«${c.title.slice(0, 30)}» a ${QUADS.find((x) => x.key === q)!.title.toLowerCase()}`,
      );
  };

  return (
    <div className="bv bv-matrix">
      <div className="bv-toolbar">
        <span className="bv-tool-label">Urgente: vence en</span>
        <div
          className="bv-seg"
          role="radiogroup"
          aria-label="Urgente si vence en"
        >
          {[1, 2, 3, 7].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={prefs.soon === n}
              className={prefs.soon === n ? "on" : ""}
              onClick={() => save({ ...prefs, soon: n })}
            >
              {n === 7 ? "1 sem" : `${n} d`}
            </button>
          ))}
        </div>
        <span className="bv-tool-label">Importante:</span>
        <div className="bv-seg" role="radiogroup" aria-label="Importante desde">
          {(["alta", "media"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={prefs.from === p}
              className={prefs.from === p ? "on" : ""}
              onClick={() => save({ ...prefs, from: p })}
            >
              {p === "alta" ? "Prioridad alta" : "Alta y media"}
            </button>
          ))}
        </div>
        {hidden > 0 && (
          <span className="bv-count">{hidden} completadas no se muestran</span>
        )}
      </div>
      <div className="bv-mx-grid">
        <span className="bv-mx-axis x1">Urgente</span>
        <span className="bv-mx-axis x2">No urgente</span>
        <span className="bv-mx-axis y1">Importante</span>
        <span className="bv-mx-axis y2">Poco importante</span>
        {(["do", "plan", "quick", "later"] as Q[]).map((q) => {
          const info = QUADS.find((x) => x.key === q)!;
          const list = by[q];
          return (
            <section
              key={q}
              className={"bv-mx-q q-" + q + (over === q ? " over" : "")}
              style={{ "--qc": info.tone } as CSSProperties}
              onDragOver={(e) => {
                e.preventDefault();
                if (over !== q) setOver(q);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setOver(null);
              }}
              onDrop={(e) => drop(e, q)}
            >
              <header>
                <strong>{info.title}</strong>
                <span>{info.hint}</span>
                <b>{list.length}</b>
              </header>
              <div className="bv-mx-list">
                {!list.length && <p className="bv-empty sm">Nada aquí.</p>}
                {list.map((c) => (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    className="bv-side-card"
                    style={
                      {
                        "--lc": colTone(colById.get(c.list_id)),
                      } as CSSProperties
                    }
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/nexo-card", c.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => api.open(c)}
                    onKeyDown={(e) => e.key === "Enter" && api.open(c)}
                  >
                    <DoneButton
                      done={false}
                      title={c.title}
                      onToggle={() => api.toggle(c)}
                    />
                    <span className="bv-side-title">{c.title}</span>
                    <PrioFlag p={c.priority} />
                    <DueChip card={c} done={false} />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
