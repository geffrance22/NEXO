import {
  useCallback,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  ChartGantt,
  Check,
  Columns3,
  Flag,
  Grid2x2,
  List,
  Repeat,
  Table2,
} from "lucide-react";
import { priorityLabels } from "../boardRules";
import type { BoardCard, CardChanges, Column, Priority } from "../boardStore";
import { dueState, toneOf } from "../boardTheme";

/** Cómo se mira un tablero. Las columnas son la vista de siempre. */
export type BoardMode =
  "columnas" | "lista" | "tabla" | "calendario" | "linea" | "matriz";

export const MODES: {
  key: BoardMode;
  label: string;
  icon: ReactNode;
  hint: string;
}[] = [
  {
    key: "columnas",
    label: "Columnas",
    icon: <Columns3 size={15} />,
    hint: "Tablero por columnas",
  },
  {
    key: "lista",
    label: "Lista",
    icon: <List size={15} />,
    hint: "Todo en una lista, agrupado",
  },
  {
    key: "tabla",
    label: "Tabla",
    icon: <Table2 size={15} />,
    hint: "Campos en columnas, editables",
  },
  {
    key: "calendario",
    label: "Calendario",
    icon: <CalendarDays size={15} />,
    hint: "Por fecha límite",
  },
  {
    key: "linea",
    label: "Línea de tiempo",
    icon: <ChartGantt size={15} />,
    hint: "Del inicio a la fecha límite",
  },
  {
    key: "matriz",
    label: "Matriz",
    icon: <Grid2x2 size={15} />,
    hint: "Importante y urgente",
  },
];

const KEY = "nexo-board-mode";
const read = (): Record<string, BoardMode> => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
/** La vista elegida para cada tablero (se recuerda en este equipo). */
export function useBoardMode(boardId: string | null) {
  const [all, setAll] = useState(read);
  const mode: BoardMode =
    (boardId && MODES.some((m) => m.key === all[boardId]) && all[boardId]) ||
    "columnas";
  const setMode = useCallback(
    (m: BoardMode) => {
      if (!boardId) return;
      setAll((prev) => {
        const next = { ...prev, [boardId]: m };
        if (m === "columnas") delete next[boardId];
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* sin almacenamiento */
        }
        return next;
      });
    },
    [boardId],
  );
  return [mode, setMode] as const;
}

/** Lo que una vista necesita del tablero (todo pasa por las mismas acciones que las columnas). */
export type ViewApi = {
  /** Las tarjetas a la vista (sin divisores; con el filtro y «ocultar completadas» aplicados). */
  cards: BoardCard[];
  columns: Column[];
  today: string;
  power: boolean;
  sync: boolean;
  isDone: (c: BoardCard) => boolean;
  linked: (c: BoardCard) => boolean;
  open: (c: BoardCard) => void;
  toggle: (c: BoardCard) => void;
  /** Cambia campos. Con `label`, avisa con «Deshacer». */
  patch: (c: BoardCard, changes: CardChanges, label?: string) => void;
  /** Lleva la tarjeta a otra columna (con sus reglas y límites). */
  move: (c: BoardCard, listId: string) => void;
  /** Crea tarjetas con la escritura rápida de siempre (#, @, !, fechas en el título). */
  add: (listId: string, title: string, due?: string | null) => void;
};

export const colTone = (col?: Column) =>
  toneOf(col?.color)?.c ?? "var(--bd-accent)";

/** El círculo de completar, igual que en la tarjeta. */
export function DoneButton({
  done,
  onToggle,
  title,
}: {
  done: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className="bv-done"
      aria-pressed={done}
      aria-label={done ? `Reabrir «${title}»` : `Completar «${title}»`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Check size={10} strokeWidth={3.4} />
    </button>
  );
}

export function DueChip({ card, done }: { card: BoardCard; done: boolean }) {
  const s = dueState(card.due, done);
  if (!s) return null;
  return (
    <span className={"bv-due " + s.tone}>
      {card.repeat && <Repeat size={10} />}
      {s.label}
    </span>
  );
}

const PRIO_TONE: Record<Priority, string> = {
  alta: "#c8463f",
  media: "#c7871f",
  baja: "#6b8fb3",
  "": "transparent",
};
export function PrioFlag({ p }: { p: Priority }) {
  if (!p) return null;
  return (
    <span
      className="bv-prio"
      title={`Prioridad ${priorityLabels[p].toLowerCase()}`}
      style={{ "--pc": PRIO_TONE[p] } as CSSProperties}
    >
      <Flag size={11} />
    </span>
  );
}

export function ColChip({ col }: { col?: Column }) {
  if (!col) return null;
  return (
    <span className="bv-col" style={{ "--lc": colTone(col) } as CSSProperties}>
      <i />
      {col.name}
    </span>
  );
}

export function ChecksMini({ card }: { card: BoardCard }) {
  if (!card.checks.length) return null;
  const n = card.checks.filter((c) => c.done).length;
  return (
    <span className={"bv-checks" + (n === card.checks.length ? " full" : "")}>
      {n}/{card.checks.length}
    </span>
  );
}

/** Mismo orden que las columnas: por columna y luego por posición. */
export function boardOrder(columns: Column[]) {
  const at = new Map(columns.map((c, i) => [c.id, i]));
  return (a: BoardCard, b: BoardCard) =>
    (at.get(a.list_id) ?? 0) - (at.get(b.list_id) ?? 0) || a.rank - b.rank;
}

/** Selector de vistas para la barra del tablero. */
export function ViewSwitch({
  mode,
  onChange,
}: {
  mode: BoardMode;
  onChange: (m: BoardMode) => void;
}) {
  return (
    <div className="bv-switch" role="tablist" aria-label="Vista del tablero">
      {MODES.map((m) => (
        <button
          key={m.key}
          type="button"
          role="tab"
          aria-selected={mode === m.key}
          className={mode === m.key ? "on" : ""}
          title={`${m.label} · ${m.hint}`}
          onClick={() => onChange(m.key)}
        >
          {m.icon}
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}
