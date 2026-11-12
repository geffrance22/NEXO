import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlarmClock,
  Archive,
  ArrowDownAZ,
  ArrowDownToLine,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardPaste,
  Columns3,
  Eye,
  EyeOff,
  Flag,
  FoldHorizontal,
  FolderInput,
  Highlighter,
  History,
  Hourglass,
  LayoutTemplate,
  Link2,
  Menu as MenuIcon,
  MoreHorizontal,
  Palette,
  Pencil,
  Pin,
  PinOff,
  PictureInPicture2,
  Plus,
  RectangleHorizontal,
  RotateCcw,
  Search,
  Sparkles,
  SquareStack,
  Tag,
  TextCursorInput,
  Trash2,
  Trello,
  UnfoldHorizontal,
  X,
  Zap,
} from "lucide-react";
import { useApp } from "../AppContext";
import { supabase } from "../backend";
import type { Person } from "../data";
import {
  addDays,
  friendlyDate,
  nextMonday,
  normalizeText,
  todayInputValue,
} from "../lib/format";
import { daysBetween } from "../lib/people";
import { Avatar } from "../people/Avatar";
import { ArchiveView } from "./ArchiveView";
import { takeTriggers } from "./boardFeed";
import { boardEntryInput, cardPeople, isBoardEntry } from "./boardPeople";
import { hasQuick, parseQuick, tokenAt } from "./boardQuick";
import { nextDue } from "./boardRepeat";
import { loadRuns, saveRuns } from "./boardRuns";
import { logCompletion } from "./boardRoutine";
import {
  actionText,
  conditionsHold,
  fieldChanges,
  hasRules,
  priorityLabels,
  scheduledHit,
  SCHEDULED,
  sortCards,
  sortLabels,
  stampOf,
  triggerText,
  type Rule,
  type RuleCtx,
  type TriggerType,
} from "./boardRules";
import { builtinTemplates } from "./boardTemplates";
import { MoveColumnMenu } from "./MoveColumn";
import { TemplateGallery } from "./TemplateGallery";
import {
  ageOf,
  CardFace,
  CardText,
  CardTile,
  DividerTile,
  type CardInline,
} from "./BoardCard";
import { BoardLinks, type Linking } from "./BoardLinks";
import { useCardLinks, type CardLink } from "./cardLinks";
import { SnoozeMenu } from "./BoardSnooze";
import { useBoardDrag, useFlip } from "./boardDrag";
import { MenuItem, Popover } from "./BoardPopover";
import {
  BOARD_SQL,
  byRank,
  fetchPaged,
  missingSyncText,
  PRIORITIES,
  snapshotBoard,
  snapshotBoardRows,
  snapshotColumns,
  snapshotEntries,
  useArchive,
  useBoard,
  useBoardList,
  type Board,
  type BoardCard,
  type BoardClosing,
  type CanvasLayout,
  type CardChanges,
  type NewCardInput,
  type Priority,
  type Snapshot,
} from "./boardStore";
import {
  backgroundOf,
  backgrounds,
  isDivider,
  tagTone,
  tones,
  toneOf,
} from "./boardTheme";
import { BOARD_GO, BOARD_LAST, useBoardView } from "./boardView";
import { CardEditor } from "./CardEditor";
import { RulesEditor } from "./RulesEditor";
import { BoardViews } from "./views/BoardViews";
import { CanvasView } from "./views/CanvasView";
import { TrelloImport } from "./TrelloImport";
import { dockColumn, DOCK_WROTE, undock, useDock } from "./dockStore";
import {
  BoardClosingDialog,
  closingSummary,
  type ClosingStats,
} from "./views/BoardClosing";
import { OverdueTriage } from "./views/OverdueTriage";
import { useBoardMode, ViewSwitch, type ViewApi } from "./views/shared";
import { cleanDetails } from "../composer/logic";
import { BoardHistory } from "./views/BoardHistory";
import { ShareBoardDialog } from "./views/ShareBoard";
import { ColumnStack } from "./ColumnStack";
import { DoneGroup } from "./DoneGroup";
import { useUndoStack } from "./boardUndo";
import { blocksCard, otherOf, stillBlocks } from "./cardLinks";
import {
  slashAt,
  takeSlash,
  templateChanges,
  useCardTemplates,
  type CardTemplate,
} from "./boardCardTemplates";
import { FIELD_KEYS, type FieldKey } from "./boardRules";
import "./boards.css";
import "./rules.css";
import "./views/views.css";
import "./phases.css";

const LAST = BOARD_LAST;
const ARCHIVE = "archivados";
/** Tableros con las completadas ocultas (cada tablero por su lado). */
const HIDE = "nexo-board-hide-done-by";
/** Columnas con el grupo de completadas desplegado (en este equipo). */
const DONE_OPEN = "nexo-board-done-open";
const readDoneOpen = () => {
  try {
    const v = JSON.parse(localStorage.getItem(DONE_OPEN) ?? "[]");
    return new Set<string>(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set<string>();
  }
};
/** Reglas programadas ya aplicadas (para no repetirlas sobre la misma situación). */
const FIRED = "nexo-board-rule-fired";
/** Cada cuánto se revisan las reglas programadas con el tablero abierto. */
const SWEEP_EVERY = 5 * 60_000;

type BulkWhat = "move" | "due" | "prio" | "tag" | "color" | "snooze";
type Menu =
  | { kind: "list"; id: string; anchor: DOMRect }
  | { kind: "move"; id: string; anchor: DOMRect }
  | { kind: "board"; anchor: DOMRect }
  | { kind: "picker"; anchor: DOMRect }
  | { kind: "snooze"; id: string; anchor: DOMRect }
  | { kind: "bulk"; what: BulkWhat; anchor: DOMRect };

/** Lo que una regla cambió en una tarjeta, para poder deshacerlo. */
type Effect = {
  before: BoardCard;
  wasDone: boolean;
  archived: boolean;
  /** Cómo quedó tras las reglas (para no pisar lo que cambies después). */
  after?: BoardCard;
};
type Fired = {
  type: TriggerType;
  card: string;
  list: string;
  /** person: a quiénes se añadió. */
  people?: string[];
  /** field: qué campos cambiaron. */
  fields?: FieldKey[];
};
/** Los campos que vigila «Cambia un campo» y que de verdad cambiaron. */
const changedFields = (c: BoardCard, ch: CardChanges): FieldKey[] =>
  FIELD_KEYS.filter(
    (k) =>
      k in ch &&
      JSON.stringify((ch as Record<string, unknown>)[k] ?? null) !==
        JSON.stringify((c as Record<string, unknown>)[k] ?? null),
  );

function readHidden(): Record<string, 1> {
  try {
    const v = JSON.parse(localStorage.getItem(HIDE) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
/** Copia en este equipo del lienzo de cada tablero. */
const CANVAS = "nexo-board-canvas";
function readCanvas(): Record<string, CanvasLayout> {
  try {
    const v = JSON.parse(localStorage.getItem(CANVAS) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
const writeCanvas = (all: Record<string, CanvasLayout>) => {
  try {
    localStorage.setItem(CANVAS, JSON.stringify(all));
  } catch {
    /* sin almacenamiento */
  }
};
function readFired(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(FIRED) ?? "[]");
    return new Set(Array.isArray(v) ? (v as string[]) : []);
  } catch {
    return new Set();
  }
}
const writeFired = (s: Set<string>) => {
  try {
    localStorage.setItem(FIRED, JSON.stringify([...s].slice(-3000)));
  } catch {
    /* sin almacenamiento */
  }
};
const ruleLabel = (r: Rule) =>
  (
    r.name ||
    `${triggerText(r.trigger)} → ${actionText(r.then[0], [], () => "")}`
  )
    .replace(/\s+/g, " ")
    .slice(0, 60);
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Tableros al estilo Trello: columnas que se crean con doble clic donde quieras, se renombran
 * con un clic y se mueven arrastrando su encabezado; tarjetas que se añaden escribiendo, se
 * completan con su círculo y se abren en una ficha completa. Archivados guarda lo que sacas.
 */
export function Boards({ toggleMenu }: { toggleMenu?: () => void } = {}) {
  const {
    workspace,
    toggleEntry,
    patchEntry,
    removeEntry,
    createEntry,
    notify: toast,
    confirm,
    saveEpisode,
    updateEpisode,
    linkEntries,
  } = useApp();
  // Cada «Deshacer» queda apilado: Ctrl + Z deshace paso a paso.
  const undo = useUndoStack(toast);
  const notify = undo.notify;
  const cardTemplates = useCardTemplates();
  const [history, setHistory] = useState<{ card?: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  // Importar tableros de Trello.
  const [importing, setImporting] = useState(false);
  // La columna que va en la ventanita de abajo a la derecha (si hay una).
  const docked = useDock();
  const list = useBoardList(notify);
  const [selected, setSelected] = useState(() => {
    const last = localStorage.getItem(LAST) ?? "";
    // Archivados ya no es un tablero más: se abre encima del tablero.
    return last === ARCHIVE ? "" : last;
  });
  // Archivados, encima del tablero (al cerrarlo sigues donde estabas).
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState("");
  const inArchive = archiveOpen;
  // También puede ser una plantilla tuya (se edita como un tablero).
  const board =
    list.all?.find((b) => b.id === selected) ?? list.boards?.[0] ?? null;
  const editingTemplate = Boolean(board?.is_template);
  // Nuevo tablero: la galería de plantillas (con lo que quieras preseleccionar).
  const [gallery, setGallery] = useState<string | null>(null);
  const api = useBoard(board?.id ?? null, notify);
  // Tarjetas vinculadas entre columnas, y la que estás vinculando ahora.
  const links = useCardLinks(board?.id ?? null, notify);
  const [linking, setLinking] = useState<Linking | null>(null);
  useEffect(() => setLinking(null), [board?.id]);
  const archive = useArchive(inArchive, notify);
  // Tarjetas desplegadas y columnas plegadas (se recuerda en este equipo).
  const view = useBoardView();
  // Las columnas plegadas también se guardan con el tablero: así lo encuentras como lo dejaste.
  const savedFold = board?.settings.folded;
  const isFolded = (id: string) =>
    savedFold ? savedFold.includes(id) : view.folded(id);
  const setFolded = (ids: string[], on: boolean) => {
    view.setFolded(ids, on);
    if (!board || !api.power) return;
    const cur = new Set(
      savedFold ??
        api.columns.filter((c) => view.folded(c.id)).map((c) => c.id),
    );
    for (const id of ids) {
      if (on) cur.add(id);
      else cur.delete(id);
    }
    const alive = new Set(api.columns.map((c) => c.id));
    list.update(board.id, {
      settings: {
        ...board.settings,
        folded: [...cur].filter((id) => alive.has(id)),
      },
    });
  };
  // Columnas, lienzo, lista, tabla, calendario, línea de tiempo o matriz (cada tablero la suya).
  const [mode, setMode] = useBoardMode(board?.id ?? null);
  const boardArchived = Boolean(board?.archived_at);
  const [triage, setTriage] = useState(false);
  const [closing, setClosing] = useState(false);

  const [query, setQuery] = useState("");
  // Ocultar completadas: cada tablero lo recuerda por su lado.
  const [hidden, setHidden] = useState<Record<string, 1>>(readHidden);
  // Grupo «Completadas» de cada columna: desplegado o replegado (se recuerda en este equipo).
  const [doneOpen, setDoneOpen] = useState<Set<string>>(readDoneOpen);
  const toggleDoneOpen = (listId: string) =>
    setDoneOpen((s) => {
      const n = new Set(s);
      if (n.has(listId)) n.delete(listId);
      else n.add(listId);
      localStorage.setItem(DONE_OPEN, JSON.stringify([...n]));
      return n;
    });
  const hideDone = Boolean(
    board && (board.settings.hideDone ?? hidden[board.id]),
  );
  const setHideDone = (fn: (v: boolean) => boolean) => {
    if (!board) return;
    const next = fn(hideDone);
    setHidden((h) => {
      const n = { ...h };
      if (next) n[board.id] = 1;
      else delete n[board.id];
      localStorage.setItem(HIDE, JSON.stringify(n));
      return n;
    });
    if (api.power)
      list.update(board.id, {
        settings: { ...board.settings, hideDone: next },
      });
  };
  const [composer, setComposer] = useState<string | null>(null);
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rulesFor, setRulesFor] = useState<string | null>(null);
  // Ctrl + Z (o ⌘ + Z) deshace el último paso apilado, salvo cuando escribes en un campo.
  const undoLast = useRef(undo.undoLast);
  undoLast.current = undo.undoLast;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || e.shiftKey || e.altKey) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      // Con una ventana encima (la ficha, un diálogo), Ctrl + Z es de ella.
      if (document.querySelector(".sheet-backdrop, .confirm-backdrop")) return;
      e.preventDefault();
      undoLast.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // Columnas que muestran sus tarjetas pospuestas.
  const [showSnoozed, setShowSnoozed] = useState<Set<string>>(() => new Set());
  // Selección múltiple (Ctrl o ⌘ + clic; Mayús + clic, un tramo).
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const anchorSel = useRef<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const pan = useRef<{
    x: number;
    left: number;
    id: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    if (board) localStorage.setItem(LAST, board.id);
  }, [board?.id]);

  const pick = (id: string) => {
    // Las que se repiten y estaban por volver, vuelven ya (antes de cambiar de tablero).
    recurTimers.current.forEach((t) => window.clearTimeout(t));
    [...recurRuns.current.values()].forEach((run) => run());
    setSelected(id);
    localStorage.setItem(LAST, id);
    setArchiveOpen(false);
    setMenu(null);
    setComposer(null);
    setDraftAt(null);
    setRenaming(null);
    setOpenId(null);
    setRulesFor(null);
    setQuery("");
    setSelection(new Set());
    setShowSnoozed(new Set());
    setTriage(false);
    setClosing(false);
    setHistory(null);
    setSharing(false);
  };

  /** Archivados se abre encima: el tablero no se mueve ni pierde dónde estabas. */
  const openArchive = () => {
    setMenu(null);
    setOpenId(null);
    setArchiveQuery("");
    setArchiveOpen(true);
  };
  const closeArchive = () => {
    setOpenId(null);
    setArchiveOpen(false);
  };
  useEffect(() => {
    if (!archiveOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Si hay algo encima (la ficha, una confirmación, un menú), Esc es de eso.
      if (document.querySelector(".sheet-backdrop, .confirm-backdrop, .bd-pop"))
        return;
      e.preventDefault();
      setOpenId(null);
      setArchiveOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [archiveOpen]);

  // ── Completadas (también si el pendiente vinculado ya se hizo) ──
  const tasks = useMemo(
    () => new Map(workspace.entries.map((e) => [e.id, e])),
    [workspace.entries],
  );
  const tasksNow = useRef(tasks);
  tasksNow.current = tasks;
  // Tarjetas que se repiten: se ven completadas un momento y vuelven con la fecha siguiente.
  const [recurring, setRecurring] = useState<Set<string>>(() => new Set());
  const recurTimers = useRef(new Map<string, number>());
  /** Lo que hace cada vuelta pendiente (si sales de Tableros antes, se aplica igual). */
  const recurRuns = useRef(new Map<string, () => void>());
  // Las tarjetas a la vista ahora mismo (si la archivas o la borras antes de que vuelva, no vuelve).
  const present = useRef(new Set<string>());
  present.current = new Set([
    ...api.cards.map((c) => c.id),
    ...(archive.cards ?? []).map((c) => c.id),
  ]);
  /** Con un pendiente vinculado, su estado manda (se completa desde la persona o desde aquí). */
  const isDone = (c: BoardCard) => {
    if (isDivider(c.title)) return false;
    if (recurring.has(c.id) || recurTimers.current.has(c.id)) return true;
    const task = tasksNow.current.get(c.entry_id ?? "");
    return task ? task.status === "completado" : c.done;
  };
  const linked = (c: BoardCard) => Boolean(c.entry_id && tasks.has(c.entry_id));
  /** El pendiente que nació con la tarjeta (al añadirle personas): va y viene con ella. */
  const boardTask = (c: BoardCard) => {
    const t = tasks.get(c.entry_id ?? "");
    return t && isBoardEntry(t) ? t : undefined;
  };
  const today = todayInputValue();
  const isSnoozed = (c: BoardCard) =>
    Boolean(c.snoozed_until && c.snoozed_until > today);
  /** La tarjeta que todavía bloquea a esta (vínculo «bloquea» cuya condición no se cumplió). */
  const blockerOf = (c: BoardCard) => {
    for (const l of links.links) {
      if (!blocksCard(l, c.id)) continue;
      const b = api.peek(l.blocker!);
      if (stillBlocks(l, b, (id) => (api.peek(id) ? isDone(api.peek(id)!) : true)))
        return b;
    }
    return undefined;
  };
  const peopleOf = (c: BoardCard) => cardPeople(c, tasks.get(c.entry_id ?? ""));
  const ruleCtx: RuleCtx = {
    today,
    isDone,
    people: (c) => peopleOf(c).length,
    peopleOf,
    blocked: (c) => Boolean(blockerOf(c)),
  };

  /** Deja de esperar la vuelta de una tarjeta que se repite (como si no se hubiera completado). */
  const cancelRecur = (id: string) => {
    const t = recurTimers.current.get(id);
    if (t === undefined) return false;
    window.clearTimeout(t);
    recurTimers.current.delete(id);
    recurRuns.current.delete(id);
    setRecurring((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    return true;
  };

  /**
   * Completa o reabre. Devuelve cómo deshacerlo. Con `rules: false` no dispara las reglas de la
   * columna (cuando ya lo hace una regla o una acción en grupo); con `quiet`, sin aviso.
   */
  function toggleDone(
    c: BoardCard,
    patch: (ch: CardChanges) => void,
    opts: { rules?: boolean; quiet?: boolean; force?: boolean } = {},
  ): () => void {
    // Un segundo toque mientras la que se repite «vuelve»: se cancela, sin más.
    if (cancelRecur(c.id)) return () => {};
    const next = !isDone(c);
    // Bloqueada por otra: se avisa (y se puede completar igual).
    const blocker = next && !opts.force && !opts.quiet ? blockerOf(c) : undefined;
    if (blocker) {
      notify(
        `«${c.title.slice(0, 40)}» depende de «${blocker.title.slice(0, 40)}», que aún no está lista.`,
        {
          label: "Completar igual",
          run: () => void toggleDone(api.peek(c.id) ?? c, patch, { ...opts, force: true }),
        },
      );
      return () => {};
    }
    const task = tasks.get(c.entry_id ?? "");
    if (next && c.repeat) return recur(c, patch, opts.quiet);
    const before = { done: c.done, done_at: c.done_at };
    patch({ done: next, done_at: next ? new Date().toISOString() : null });
    if (task && (task.status === "completado") !== next) toggleEntry(task);
    const undo = () => {
      patch(before);
      const t = tasksNow.current.get(c.entry_id ?? "");
      if (t && (t.status === "completado") === next) toggleEntry(t);
    };
    if (opts.rules !== false) {
      const events: Fired[] = [
        { type: next ? "done" : "undone", card: c.id, list: c.list_id },
      ];
      if (next && emptiedBy(c.list_id, [c.id]))
        events.push({ type: "emptied", card: c.id, list: c.list_id });
      const acted = fire(events, undo);
      if (!acted && next && !opts.quiet) announceUnblocked([c.id], undo, true);
    }
    return undo;
  }
  /** ¿La columna se queda sin tarjetas abiertas si se van (o se completan) estas? */
  function emptiedBy(listId: string, leaving: string[]) {
    const out = new Set(leaving);
    const all = api.peekAll().filter((x) => x.list_id === listId && !isDivider(x.title));
    return (
      all.some((x) => out.has(x.id)) &&
      !all.some((x) => !out.has(x.id) && !isDone(x) && !isSnoozed(x))
    );
  }
  /** Avisa qué tarjetas quedaron libres porque estas se completaron o se movieron. */
  function announceUnblocked(ids: string[], undoIt?: () => void, assumeDone = false) {
    const doneNow = (id: string) =>
      (assumeDone && ids.includes(id)) || (api.peek(id) ? isDone(api.peek(id)!) : true);
    const freed = links.links
      .filter((l) => l.kind === "blocks" && l.blocker && ids.includes(l.blocker))
      .map((l) => ({ l, dep: api.peek(otherOf(l, l.blocker!)) }))
      .filter(
        ({ l, dep }) =>
          dep &&
          !isDone(dep) &&
          !stillBlocks(l, api.peek(l.blocker!), doneNow) &&
          !links.links.some(
            (o) =>
              o !== l &&
              blocksCard(o, dep.id) &&
              stillBlocks(o, api.peek(o.blocker!), doneNow),
          ),
      )
      .map(({ dep }) => dep!);
    if (!freed.length) return false;
    notify(
      freed.length === 1
        ? `«${freed[0].title.slice(0, 50)}» ya no está bloqueada: puedes seguir con ella.`
        : `${freed.length} tarjetas ya no están bloqueadas.`,
      undoIt
        ? { label: "Deshacer", icon: "undo", run: undoIt }
        : { label: "Abrir", icon: "open", run: () => setOpenId(freed[0].id) },
    );
    return true;
  }
  /**
   * Completar una que se repite: se marca un instante y vuelve abierta, con su lista limpia.
   * «Deshacer» funciona igual de rápido que lo pulses: si aún no volvió, se cancela la vuelta.
   */
  function recur(
    c: BoardCard,
    patch: (ch: CardChanges) => void,
    quiet = false,
  ): () => void {
    const due = nextDue(c.repeat, c.due) ?? c.due;
    const before = {
      due: c.due,
      checks: c.checks,
      ...(api.sync && { completions: c.completions }),
    };
    const task = tasks.get(c.entry_id ?? "");
    setRecurring((s) => new Set(s).add(c.id));
    const back = () => {
      recurTimers.current.delete(c.id);
      recurRuns.current.delete(c.id);
      setRecurring((s) => {
        const n = new Set(s);
        n.delete(c.id);
        return n;
      });
      if (!present.current.has(c.id)) return;
      patch({
        due,
        done: false,
        done_at: null,
        checks: c.checks.map((x) => ({ ...x, done: false })),
        // Queda en el registro de la rutina (cuántas veces, racha, calendario de puntos).
        ...(api.sync && { completions: logCompletion(c) }),
      });
      if (task)
        void patchEntry(task, {
          status: "pendiente",
          details: { ...task.details, ...(due && { due }) },
        });
    };
    recurTimers.current.set(c.id, window.setTimeout(back, 850));
    recurRuns.current.set(c.id, back);
    const undo = () => {
      // Aún no volvió: basta con no dejarla volver.
      if (cancelRecur(c.id)) return;
      patch({ ...before, done: false, done_at: null });
      const t = tasksNow.current.get(c.entry_id ?? "");
      if (t)
        void patchEntry(t, {
          status: "pendiente",
          details: { ...t.details, due: before.due ?? undefined },
        });
    };
    if (!quiet)
      notify(
        `Hecho. Se repite: vuelve ${due ? friendlyDate(due).toLowerCase() : "abierta"}.`,
        { label: "Deshacer", icon: "undo", run: undo },
      );
    return undo;
  }
  // Al salir de Tableros, las que estaban por volver vuelven ya (no se pierde la fecha nueva).
  useEffect(
    () => () => {
      recurTimers.current.forEach((t) => window.clearTimeout(t));
      [...recurRuns.current.values()].forEach((run) => run());
    },
    [],
  );

  /** Al editar la tarjeta, su pendiente (el que nació aquí) cambia igual. */
  function syncTask(c: BoardCard, ch: CardChanges) {
    const t = boardTask(c);
    if (!t) return;
    const next: Parameters<typeof patchEntry>[1] = {};
    // El pendiente guarda hasta 180 caracteres de título y 4000 de descripción (como la base).
    const title = ch.title?.slice(0, 180);
    const body = ch.body?.slice(0, 4000);
    if (title !== undefined && title !== t.title) next.title = title;
    if (body !== undefined && body !== t.body) next.body = body;
    if (ch.due !== undefined && (ch.due ?? undefined) !== t.details.due)
      next.details = { ...t.details, due: ch.due ?? undefined };
    if (Object.keys(next).length) void patchEntry(t, next);
  }
  /** Borra los pendientes que nacieron con estas tarjetas (al borrarlas, no al archivarlas). */
  const dropTasks = (ids: (string | null)[]) => {
    for (const id of ids) {
      const t = id ? tasksNow.current.get(id) : undefined;
      if (t && isBoardEntry(t)) removeEntry(t, true);
    }
  };
  /** Igual, pero cuando pasa el tiempo de «Deshacer». Devuelve cómo cancelarlo. */
  const dropTasksLater = (ids: (string | null)[]) => {
    if (!ids.some(Boolean)) return () => {};
    const timer = window.setTimeout(() => dropTasks(ids), 8500);
    return () => window.clearTimeout(timer);
  };
  /** Igual, pero leyendo de la base las tarjetas de una columna o un tablero (incluye archivadas). */
  async function dropTasksOf(filter: { list?: string; board?: string }) {
    const { rows } = await fetchPaged<{ id: string; entry_id: string | null }>(
      (from, to, count) => {
        const opts = count ? { count: "exact" as const } : undefined;
        const q = filter.list
          ? supabase
              .from("board_cards")
              .select("id,entry_id", opts)
              .eq("list_id", filter.list)
          : supabase
              .from("planner_board_cards")
              .select("id,entry_id", opts)
              .eq("board_id", filter.board!);
        return q.not("entry_id", "is", null).order("id").range(from, to);
      },
    );
    dropTasks(rows.map((r) => r.entry_id));
  }

  // ───────────────────────── Reglas ─────────────────────────

  /** Tarjetas reales (sin divisores ni pospuestas) en una columna: lo que cuenta para su límite. */
  const countIn = (listId: string) =>
    api
      .peekAll()
      .filter(
        (c) => c.list_id === listId && !isDivider(c.title) && !isSnoozed(c),
      ).length;
  /** ¿La columna no deja pasar `adding` tarjetas más? Avisa si es así. */
  const blocked = (listId: string, adding: number) => {
    const col = api.peekColumn(listId);
    const r = col?.rules;
    if (!col || !r?.limit || r.limitMode !== "block") return false;
    if (countIn(listId) + adding <= r.limit) return false;
    notify(
      `«${col.name.slice(0, 40)}» tiene un límite de ${plural(r.limit, "tarjeta", "tarjetas")}. Libera espacio o cambia sus reglas.`,
    );
    return true;
  };
  const remember = (effects: Map<string, Effect>, id: string) => {
    if (effects.has(id)) return;
    const card = api.peek(id);
    if (card)
      effects.set(id, { before: card, wasDone: isDone(card), archived: false });
  };

  /** Aplica las acciones de una regla a una tarjeta, en orden. Devuelve si cambió algo. */
  function applyRule(
    rule: Rule,
    id: string,
    depth: number,
    seen: Set<string>,
    effects: Map<string, Effect>,
  ) {
    let did = false;
    remember(effects, id);
    for (const a of rule.then) {
      const card = api.peek(id);
      if (!card) break; // archivada por una acción anterior
      const ch = fieldChanges(card, a, today);
      if (ch) {
        if (
          !api.power &&
          ("priority" in ch || "highlight" in ch || "snoozed_until" in ch)
        )
          continue;
        api.patchCard(id, ch);
        syncTask(card, ch);
        did = true;
        continue;
      }
      const patch = (x: CardChanges) => api.patchCard(id, x);
      if (a.type === "complete" && !isDone(card)) {
        toggleDone(card, patch, { rules: false, quiet: true });
        did = true;
      } else if (a.type === "reopen" && isDone(card)) {
        toggleDone(card, patch, { rules: false, quiet: true });
        did = true;
      } else if (a.type === "archive" && api.extras) {
        effects.get(id)!.after = card;
        if (api.archiveCard(id)) {
          effects.get(id)!.archived = true;
          list.setArchived((n) => n + 1);
          did = true;
        }
      } else if (a.type === "move") {
        const target = a.list;
        if (!target || target === card.list_id || !api.peekColumn(target))
          continue;
        if (blocked(target, 1)) continue;
        const from = card.list_id;
        // Al final de verdad (moveCards lo ajusta a lo que haya ahora).
        api.moveCard(id, target, a.where === "top" ? 0 : Infinity);
        did = true;
        runTrigger("leave", id, from, depth + 1, seen, effects);
        runTrigger("enter", id, target, depth + 1, seen, effects);
      }
    }
    return did;
  }
  /** Las reglas de una columna para algo que acaba de pasar. Devuelve los nombres de las que actuaron. */
  function runTrigger(
    type: TriggerType,
    id: string,
    listId: string,
    depth: number,
    seen: Set<string>,
    effects: Map<string, Effect>,
    ev?: Pick<Fired, "people" | "fields">,
  ): string[] {
    if (depth > 5 || editingTemplate) return [];
    const col = api.peekColumn(listId);
    if (!col) return [];
    const out: string[] = [];
    for (const rule of col.rules.rules) {
      if (!rule.on || rule.trigger.type !== type) continue;
      // «Se le añade una persona»: cualquiera, o esa en concreto.
      if (
        type === "person" &&
        rule.trigger.value &&
        !(ev?.people ?? []).includes(rule.trigger.value)
      )
        continue;
      // «Cambia un campo»: cualquiera de los vigilados, o ese en concreto.
      if (type === "field") {
        const changed = ev?.fields ?? [];
        if (!changed.length) continue;
        if (rule.trigger.field && !changed.includes(rule.trigger.field))
          continue;
      }
      const key = rule.id + "|" + id;
      if (seen.has(key)) continue;
      seen.add(key);
      const card = api.peek(id);
      if (!card || isDivider(card.title)) break;
      if (!conditionsHold(rule, card, ruleCtx)) continue;
      if (applyRule(rule, id, depth, seen, effects)) out.push(ruleLabel(rule));
    }
    return out;
  }
  /**
   * Vuelve las tarjetas a como estaban antes de las reglas: solo los campos que cambió una regla y
   * solo si siguen como la regla los dejó (lo que tocaste después se respeta).
   */
  function revert(effects: Map<string, Effect>) {
    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    const keys: (keyof CardChanges)[] = [
      "list_id",
      "rank",
      "done",
      "done_at",
      "due",
      "tags",
      "color",
      "checks",
      ...(api.power
        ? (["priority", "highlight", "snoozed_until"] as const)
        : []),
    ];
    for (const [id, e] of effects) {
      const b = e.before;
      const after = e.after ?? b;
      cancelRecur(id);
      const archivedNow = !api.peek(id);
      if (e.archived && archivedNow) {
        api.unarchiveCard(after);
        list.setArchived((n) => Math.max(0, n - 1));
      } else if (archivedNow) continue; // la borraste o archivaste tú después
      const cur = api.peek(id)!;
      const fields: CardChanges = {};
      for (const k of keys)
        if (!same(b[k], after[k]) && same(cur[k], after[k]))
          (fields as Record<string, unknown>)[k] = b[k];
      if (Object.keys(fields).length) api.patchCard(id, fields);
      const t = tasksNow.current.get(b.entry_id ?? "");
      if (t && (t.status === "completado") !== e.wasDone) toggleEntry(t);
    }
  }
  /** Avisa qué reglas actuaron. «Deshacer» revierte las reglas y, con `undo`, también lo tuyo. */
  function announce(
    names: string[],
    effects: Map<string, Effect>,
    lead = "",
    undo?: () => void,
  ) {
    if (!names.length || !effects.size) return false;
    for (const [id, e] of effects)
      e.after = api.peek(id) ?? e.after ?? e.before;
    const uniq = [...new Set(names)];
    const what =
      uniq.length === 1 ? `Regla «${uniq[0]}»` : `${uniq.length} reglas`;
    notify(
      `${lead}${what}${effects.size > 1 ? ` en ${plural(effects.size, "tarjeta", "tarjetas")}` : ""}.`,
      {
        label: "Deshacer",
        icon: "undo",
        run: () => {
          revert(effects);
          undo?.();
        },
      },
    );
    return true;
  }
  /**
   * Dispara las reglas por lo que acabas de hacer. Devuelve si alguna actuó. `undo` deshace lo
   * tuyo (completar, mover…): así «Deshacer» del aviso de la regla lo devuelve todo.
   */
  function fire(events: Fired[], undo?: () => void) {
    if (!events.length) return false;
    const effects = new Map<string, Effect>();
    const seen = new Set<string>();
    const names = events.flatMap((e) =>
      runTrigger(e.type, e.card, e.list, 0, seen, effects, e),
    );
    return announce(names, effects, "Se aplicó: ", undo);
  }
  /** «Aplicar ahora»: las acciones de la regla sobre las tarjetas de la columna que la cumplen. */
  function runRuleNow(rule: Rule, listId: string) {
    const effects = new Map<string, Effect>();
    const seen = new Set<string>();
    let n = 0;
    const ids = api
      .peekAll()
      .filter((x) => x.list_id === listId && !isDivider(x.title))
      .map((x) => x.id);
    for (const id of ids) {
      // Se vuelve a mirar: una acción anterior pudo moverla o cambiarla.
      const c = api.peek(id);
      if (!c || c.list_id !== listId || !conditionsHold(rule, c, ruleCtx))
        continue;
      seen.add(rule.id + "|" + c.id);
      if (applyRule(rule, c.id, 0, seen, effects)) n++;
    }
    announce(n ? [ruleLabel(rule)] : [], effects, "Se aplicó: ");
    return n;
  }
  /**
   * Lo que se revisa solo: archivar lo completado hace tiempo y las reglas de fechas y de días
   * quietas. Cada una actúa una vez por situación (la misma fecha, la misma llegada, la misma vez
   * que se completó): si lo deshaces, no vuelve a actuar.
   */
  function sweep() {
    if (
      !board ||
      api.status !== "ready" ||
      editingTemplate ||
      inArchive ||
      boardArchived
    )
      return;
    // Lo aplicado aquí (este equipo) y lo que anotaron la base y el servidor.
    const memo = new Set([...readFired(), ...runs.current]);
    const fresh: string[] = [];
    const effects = new Map<string, Effect>();
    const seen = new Set<string>();
    const names: string[] = [];
    let archived = 0;
    for (const col of api.columns) {
      const cfg = col.rules;
      const here = () =>
        api
          .peekAll()
          .filter((c) => c.list_id === col.id && !isDivider(c.title))
          .map((c) => c.id);
      if (cfg.autoArchive > 0 && api.extras)
        for (const id of here()) {
          const c = api.peek(id);
          // Solo con la fecha real en que se completó.
          if (!c || !isDone(c) || !c.done_at) continue;
          if (
            daysBetween(todayInputValue(new Date(c.done_at)), today) <
            cfg.autoArchive
          )
            continue;
          const key = `auto|${c.id}|${c.done_at}`;
          if (memo.has(key)) continue;
          memo.add(key);
          fresh.push(key);
          remember(effects, c.id);
          effects.get(c.id)!.after = c;
          if (api.archiveCard(c.id)) {
            effects.get(c.id)!.archived = true;
            archived++;
          }
        }
      for (const rule of cfg.rules) {
        if (!rule.on || !SCHEDULED.includes(rule.trigger.type)) continue;
        for (const id of here()) {
          const c = api.peek(id);
          if (!c || c.list_id !== col.id) continue;
          if (!scheduledHit(rule.trigger, c, ruleCtx)) continue;
          if (!conditionsHold(rule, c, ruleCtx)) continue;
          const key = `${rule.id}|${c.id}|${stampOf(rule.trigger, c)}`;
          if (memo.has(key)) continue;
          memo.add(key);
          fresh.push(key);
          if (applyRule(rule, c.id, 0, seen, effects))
            names.push(ruleLabel(rule));
        }
      }
    }
    writeFired(memo);
    if (fresh.length) {
      fresh.forEach((k) => runs.current.add(k));
      void saveRuns(board.id, fresh);
    }
    if (archived) {
      list.setArchived((n) => n + archived);
      names.push(`Archivar completadas`);
    }
    announce(names, effects, "Automático: ");
  }
  // Lo ya aplicado que anotó la base para el tablero abierto (este equipo, otros y el servidor).
  const runs = useRef(new Set<string>());
  const runsFor = useRef("");
  const runsAt = useRef("");
  /** Trae lo anotado: todo al abrir el tablero y, después, solo lo nuevo desde la última vez. */
  async function refreshRuns() {
    if (!board) return;
    const id = board.id;
    const first = runsFor.current !== id;
    const since = first ? undefined : runsAt.current;
    const stamp = new Date(Date.now() - 60_000).toISOString();
    const loaded = await loadRuns(id, since);
    if (board.id !== id) return;
    if (first) runs.current = new Set();
    loaded.forEach((k) => runs.current.add(k));
    runsFor.current = id;
    runsAt.current = stamp;
  }
  const sweepNow = useRef(sweep);
  sweepNow.current = sweep;
  const fireNow = useRef(fire);
  fireNow.current = fire;
  // Al abrir el tablero: lo que quedó pendiente desde fuera (completar en la Agenda) y lo programado.
  useEffect(() => {
    if (api.status !== "ready" || !board) return;
    let live = true;
    const t = window.setTimeout(async () => {
      // Antes de revisar lo programado, lo que ya anotó la base (otros equipos, el servidor).
      await refreshRuns();
      if (!live) return;
      const pend = takeTriggers(new Set(api.columns.map((c) => c.id)));
      // Solo lo que sigue siendo cierto (si lo deshiciste, no cuenta).
      const real = pend.filter((p) => {
        const c = api.peek(p.card);
        return (
          c && c.list_id === p.list && isDone(c) === (p.trigger === "done")
        );
      });
      if (real.length)
        fireNow.current(
          real.map((p) => ({ type: p.trigger, card: p.card, list: p.list })),
        );
      sweepNow.current();
    }, 700);
    // Cada vuelta mira antes lo que el servidor haya aplicado (así no se repite aquí).
    const again = () => void refreshRuns().then(() => live && sweepNow.current());
    const every = window.setInterval(again, SWEEP_EVERY);
    window.addEventListener("focus", again);
    return () => {
      live = false;
      window.removeEventListener("focus", again);
      window.clearTimeout(t);
      window.clearInterval(every);
    };
  }, [api.status, board?.id]);

  /**
   * Mueve tarjetas (con la columna llena, no) y dispara las reglas de salida y de llegada.
   * Devuelve null si la columna no las deja pasar; si no, si alguna regla actuó.
   */
  function moveWithRules(
    ids: string[],
    listId: string,
    index: number,
    undo?: () => void,
  ) {
    const moving = ids
      .map((id) => api.peek(id))
      .filter((c): c is BoardCard => Boolean(c));
    const incoming = moving.filter((c) => c.list_id !== listId);
    if (incoming.length && blocked(listId, incoming.length)) return null;
    const from = new Map(incoming.map((c) => [c.id, c.list_id]));
    // Columnas que tenían tarjetas abiertas y tal vez se queden sin ninguna.
    const sources = [...new Set(incoming.map((c) => c.list_id))].filter(
      (s) => openIn(s) > 0,
    );
    api.moveCards(
      moving.map((c) => c.id),
      listId,
      index,
    );
    const events = incoming.flatMap((c): Fired[] => [
      { type: "leave", card: c.id, list: from.get(c.id)! },
      { type: "enter", card: c.id, list: listId },
    ]);
    for (const s of sources) {
      const last = incoming.find((c) => c.list_id === s);
      if (last && openIn(s) === 0)
        events.push({ type: "emptied", card: last.id, list: s });
    }
    let acted = fire(events, undo);
    // Si una tarjeta bloqueaba a otra «hasta que llegue a esta columna», se avisa que quedó libre.
    if (!acted && incoming.length)
      acted = announceUnblocked(
        incoming.map((c) => c.id),
        undo,
      );
    return acted;
  }
  /** Cuántas tarjetas abiertas (ni completadas ni pospuestas) tiene una columna. */
  function openIn(listId: string) {
    return api
      .peekAll()
      .filter(
        (x) =>
          x.list_id === listId &&
          !isDivider(x.title) &&
          !isDone(x) &&
          !isSnoozed(x),
      ).length;
  }

  /** Lo que se hace desde la tarjeta en la columna, sin abrirla. */
  const inlineFor = (c: BoardCard): CardInline => ({
    toggleChecks: () => view.toggleCard(c.id, "c"),
    toggleBody: () => view.toggleCard(c.id, "d"),
    check: (id) => {
      const checks = c.checks.map((x) =>
        x.id === id ? { ...x, done: !x.done } : x,
      );
      api.patchCard(c.id, { checks });
      // Terminaste la lista: sus reglas o, si no hay, propone completar la tarjeta.
      if (checks.every((x) => x.done) && !c.checks.every((x) => x.done)) {
        if (fire([{ type: "checks", card: c.id, list: c.list_id }])) return;
        if (!isDone(c))
          notify(`Terminaste la lista de «${c.title.slice(0, 40)}».`, {
            label: "Completar tarjeta",
            run: () =>
              toggleDone({ ...c, checks }, (ch) => api.patchCard(c.id, ch)),
          });
      }
    },
    addCheck: (text) =>
      api.patchCard(c.id, {
        checks: [...c.checks, { id: crypto.randomUUID(), text, done: false }],
      }),
  });

  // ── Tarjetas por columna, filtradas ──
  const byList = useMemo(() => {
    const map = new Map<string, BoardCard[]>();
    for (const c of [...api.cards].sort(byRank)) {
      const l = map.get(c.list_id);
      if (l) l.push(c);
      else map.set(c.list_id, [c]);
    }
    return map;
  }, [api.cards]);
  const needle = normalizeText(query.trim());
  const visible = (c: BoardCard) =>
    isDivider(c.title)
      ? !needle
      : (!hideDone || !isDone(c)) &&
        // Las pospuestas no se ven (salvo al buscar o si pides verlas).
        (!isSnoozed(c) || Boolean(needle) || showSnoozed.has(c.list_id)) &&
        (!needle ||
          normalizeText(`${c.title} ${c.body} ${c.tags.join(" ")}`).includes(
            needle,
          ));
  /** Las tarjetas de una columna en el orden en que se ven (manual o automático). */
  const orderedIn = (listId: string) => {
    const every = byList.get(listId) ?? [];
    const key = api.peekColumn(listId)?.rules.sort ?? "";
    return key ? sortCards(every, key, isDivider) : every;
  };

  // ── Selección ──
  const picked = [...selection]
    .map((id) => api.cards.find((c) => c.id === id))
    .filter((c): c is BoardCard => Boolean(c));
  const colOrder = new Map(api.columns.map((c, i) => [c.id, i]));
  /** Lo seleccionado, en el orden del tablero (por columna y luego por posición). */
  const pickedInOrder = () =>
    [...picked].sort(
      (a, b) =>
        (colOrder.get(a.list_id) ?? 0) - (colOrder.get(b.list_id) ?? 0) ||
        a.rank - b.rank,
    );
  const selectCard = (c: BoardCard, mode: "toggle" | "range") => {
    const anchor = anchorSel.current ? api.peek(anchorSel.current) : undefined;
    if (mode === "range" && anchor && anchor.list_id === c.list_id) {
      const order = orderedIn(c.list_id).filter(
        (x) => visible(x) && !isDivider(x.title),
      );
      const i = order.findIndex((x) => x.id === anchor.id);
      const j = order.findIndex((x) => x.id === c.id);
      if (i >= 0 && j >= 0) {
        const [a, b] = i < j ? [i, j] : [j, i];
        setSelection((s) => {
          const n = new Set(s);
          order.slice(a, b + 1).forEach((x) => n.add(x.id));
          return n;
        });
        return;
      }
    }
    anchorSel.current = c.id;
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(c.id)) n.delete(c.id);
      else n.add(c.id);
      return n;
    });
  };
  const clearSelection = () => {
    anchorSel.current = null;
    setSelection((s) => (s.size ? new Set() : s));
  };
  // Esc deselecciona (si no hay una ventana o un menú abierto encima).
  useEffect(() => {
    if (!selection.size) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".sheet, .bd-pop")) return;
      clearSelection();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selection.size]);

  // ── Arrastre ──
  // Arrastrar una seleccionada lleva todas las seleccionadas (en su orden).
  const multi = (id: string) => selection.has(id) && picked.length > 1;
  const dnd = useBoardDrag(canvas, (d) => {
    if (d.kind === "card") {
      const ids = multi(d.id) ? pickedInOrder().map((c) => c.id) : [d.id];
      const others = (byList.get(d.list) ?? []).filter(
        (c) => !ids.includes(c.id),
      );
      const at = d.before ? others.findIndex((c) => c.id === d.before) : -1;
      moveWithRules(ids, d.list, at < 0 ? others.length : at);
    } else {
      const others = api.columns.filter((c) => c.id !== d.id);
      const at = d.before ? others.findIndex((c) => c.id === d.before) : -1;
      api.moveColumn(d.id, at < 0 ? others.length : at);
    }
  });
  const drag = dnd.drag;
  const dragging = (c: BoardCard) =>
    drag?.kind === "card" &&
    (drag.id === c.id || (multi(drag.id) && selection.has(c.id)));
  useFlip(main);

  // Llegaste desde Mi espacio: muestra la columna anclada y, si tocaste una tarjeta, la abre.
  useEffect(() => {
    if (api.status !== "ready") return;
    const raw = sessionStorage.getItem(BOARD_GO);
    if (!raw) return;
    sessionStorage.removeItem(BOARD_GO);
    try {
      const go = JSON.parse(raw) as { list?: string; card?: string };
      if (go.list && api.columns.some((c) => c.id === go.list)) {
        setFolded([go.list], false);
        requestAnimationFrame(() => {
          const el = canvas.current?.querySelector<HTMLElement>(
            `[data-list="${go.list}"]`,
          );
          if (!el) return;
          el.scrollIntoView({
            inline: "center",
            block: "nearest",
            behavior: "smooth",
          });
          el.classList.add("bd-flash");
          window.setTimeout(() => el.classList.remove("bd-flash"), 1600);
        });
      }
      if (go.card && api.cards.some((c) => c.id === go.card))
        setOpenId(go.card);
    } catch {
      /* enlace viejo: se ignora */
    }
  }, [api.status, board?.id]);

  /** Posición entre columnas más cercana a un punto (para crear ahí la nueva). */
  const insertIndex = (x: number) => {
    const root = canvas.current;
    if (!root) return api.columns.length;
    const left = root.getBoundingClientRect().left - root.scrollLeft;
    return [...root.querySelectorAll<HTMLElement>("[data-list]")].filter(
      (el) => left + el.offsetLeft + el.offsetWidth / 2 < x,
    ).length;
  };

  /**
   * Borra el pendiente de la tarjeta cuando pasa el tiempo de «Deshacer» (si lo deshaces, se
   * queda). Devuelve la función para cancelarlo.
   */
  const dropTaskLater = (c: BoardCard) => {
    const t = boardTask(c);
    if (!t) return () => {};
    const timer = window.setTimeout(() => removeEntry(t, true), 8500);
    return () => window.clearTimeout(timer);
  };

  // ── Acciones con «Deshacer» ──
  function deleteCard(c: BoardCard) {
    const tied = links.of([c.id]);
    const removed = api.deleteCard(c.id);
    if (!removed) return;
    const keep = dropTaskLater(c);
    notify(
      boardTask(c)
        ? "Tarjeta eliminada (y su pendiente)."
        : "Tarjeta eliminada.",
      {
        label: "Deshacer",
        icon: "undo",
        run: () => {
          keep();
          api.restoreCard(removed);
          links.restore(tied);
        },
      },
    );
  }
  /** Vincula dos tarjetas de columnas distintas; si ya lo estaban, las desvincula. */
  const pickLink = (from: string, to: string) => {
    setLinking(null);
    if (links.has(from, to)) unlinkCards({ a: from, b: to });
    else links.link(from, to);
  };
  const cancelLink = () => setLinking(null);
  function unlinkCards(l: CardLink) {
    links.unlink(l.a, l.b);
    notify("Vínculo quitado.", {
      label: "Deshacer",
      icon: "undo",
      run: () => links.link(l.a, l.b),
    });
  }
  function archiveCard(c: BoardCard) {
    const done = api.archiveCard(c.id);
    if (!done) return;
    list.setArchived((n) => n + 1);
    notify("Tarjeta archivada. La encuentras en Archivados.", {
      label: "Deshacer",
      icon: "undo",
      run: () => {
        api.unarchiveCard(done);
        list.setArchived((n) => Math.max(0, n - 1));
      },
    });
  }
  function unarchive(c: BoardCard) {
    const card = archive.unarchive(c.id);
    if (!card) return;
    list.setArchived((n) => Math.max(0, n - 1));
    // Si vuelve a este tablero, que aparezca ya en su columna (sin recargar el tablero).
    if (api.columns.some((col) => col.id === card.list_id))
      window.setTimeout(() => void api.refreshList(card.list_id), 900);
    notify(
      `Volvió a «${card.list_name ?? "su columna"}»${card.board_name ? ` en ${card.board_name}` : ""}.`,
      {
        label: "Deshacer",
        icon: "undo",
        run: () => {
          archive.rearchive(card);
          list.setArchived((n) => n + 1);
        },
      },
    );
  }
  function deleteArchived(c: BoardCard) {
    const card = archive.remove(c.id);
    if (!card) return;
    list.setArchived((n) => Math.max(0, n - 1));
    const keep = dropTaskLater(c);
    notify("Tarjeta eliminada.", {
      label: "Deshacer",
      icon: "undo",
      run: () => {
        keep();
        archive.restore(card);
        list.setArchived((n) => n + 1);
      },
    });
  }
  async function deleteColumn(id: string) {
    const col = api.columns.find((c) => c.id === id);
    const n = byList.get(id)?.length ?? 0;
    if (!col) return;
    if (
      n &&
      !(await confirm({
        title: `¿Eliminar la columna «${col.name.slice(0, 60)}»?`,
        message: `También se eliminarán sus ${n} ${n === 1 ? "tarjeta" : "tarjetas"} y los pendientes que nacieron con ellas. Podrás deshacerlo durante unos segundos.`,
        confirmLabel: "Eliminar",
        danger: true,
        icon: "trash",
      }))
    )
      return;
    // Una copia completa (también las archivadas) para poder deshacerlo.
    let snap: Snapshot | null = null;
    try {
      snap = await snapshotColumns([id]);
    } catch {
      snap = null;
    }
    const pinned = list.pinned?.id === id ? list.pinned : null;
    // Sin copia no hay Deshacer: los pendientes se borran ya (después no se sabría cuáles eran).
    if (!snap) await dropTasksOf({ list: id });
    api.deleteColumn(id);
    list.forgetPin(id);
    if (rulesFor === id) setRulesFor(null);
    if (!snap) return notify(`Columna «${col.name.slice(0, 40)}» eliminada.`);
    const copy = snap;
    const keep = dropTasksLater(snapshotEntries(copy));
    notify(`Columna «${col.name.slice(0, 40)}» eliminada.`, {
      label: "Deshacer",
      icon: "undo",
      run: () => {
        keep();
        void api
          .restoreColumns(copy)
          .then(() => pinned && list.notePin(pinned))
          .catch(() => {});
      },
    });
  }
  async function deleteBoard() {
    if (!board) return;
    const template = Boolean(board.is_template);
    const ok = await confirm({
      title: `¿Eliminar ${template ? "la plantilla" : "el tablero"} «${board.name.slice(0, 60)}»?`,
      message: template
        ? "Los tableros que ya creaste con ella no cambian. Podrás deshacerlo durante unos segundos."
        : "Se eliminarán sus columnas y tarjetas (también las archivadas) y los pendientes que nacieron con ellas. Podrás deshacerlo durante unos segundos.",
      confirmLabel: "Eliminar",
      danger: true,
      icon: "trash",
    });
    if (!ok) return;
    const gone = board;
    let snap: Snapshot | null = null;
    try {
      snap = await snapshotBoardRows(gone.id);
    } catch {
      snap = null;
    }
    if (!snap && !template) await dropTasksOf({ board: gone.id });
    const rest = (list.boards ?? []).filter((b) => b.id !== gone.id);
    list.remove(gone.id);
    pick(rest[0]?.id ?? "");
    const label = `${template ? "Plantilla" : "Tablero"} «${gone.name.slice(0, 40)}» eliminado${template ? "a" : ""}.`;
    if (!snap) return notify(label);
    const copy = snap;
    const keep = template ? () => {} : dropTasksLater(snapshotEntries(copy));
    notify(label, {
      label: "Deshacer",
      icon: "undo",
      run: () => {
        keep();
        void list.restore(copy).then((done) => done && pick(gone.id));
      },
    });
  }
  /** Guarda el tablero tal como está (sin fechas, vínculos ni completadas) como plantilla. */
  async function saveAsTemplate() {
    if (!board) return;
    try {
      const spec = await snapshotBoard(board.id);
      const id = await list.createFrom(spec, board.name, {
        template: true,
        description: `Copia de «${board.name}»`,
      });
      if (id)
        notify("Guardado en Mis plantillas.", {
          label: "Editar",
          icon: "open",
          run: () => pick(id),
        });
    } catch (e) {
      notify(
        "No se pudo guardar la plantilla: " + ((e as Error).message ?? "error"),
      );
    }
  }
  /** Lleva la columna a otro tablero, con sus tarjetas. */
  function moveToBoard(colId: string, target: Board, rank: number) {
    const col = api.columns.find((c) => c.id === colId);
    if (!col) return;
    api.moveColumnToBoard(colId, target.id, rank);
    list.repointPin(colId, target.id);
    notify(`«${col.name.slice(0, 40)}» pasó a «${target.name.slice(0, 40)}».`, {
      label: "Ir allí",
      icon: "open",
      run: () => {
        sessionStorage.setItem(BOARD_GO, JSON.stringify({ list: colId }));
        pick(target.id);
      },
    });
  }
  function archiveDone(listId: string) {
    archiveCards((byList.get(listId) ?? []).filter(isDone));
  }
  function archiveCards(cards: BoardCard[]) {
    if (!api.extras)
      return notify(
        `Para archivar ejecuta ${BOARD_SQL} en el SQL Editor de Supabase.`,
      );
    const moved = cards
      .map((c) => api.archiveCard(c.id))
      .filter((c): c is BoardCard => Boolean(c));
    if (!moved.length) return;
    list.setArchived((n) => n + moved.length);
    notify(
      `${moved.length} ${moved.length === 1 ? "tarjeta archivada" : "tarjetas archivadas"}.`,
      {
        label: "Deshacer",
        icon: "undo",
        run: () => {
          moved.forEach((c) => api.unarchiveCard(c));
          list.setArchived((n) => Math.max(0, n - moved.length));
        },
      },
    );
  }
  function sortList(listId: string, by: "due" | "name") {
    const all = [...(byList.get(listId) ?? [])];
    all.sort((a, b) =>
      by === "name"
        ? a.title.localeCompare(b.title, "es", { sensitivity: "base" })
        : (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.rank - b.rank,
    );
    api.reorder(all);
  }
  /** Elimina las completadas del grupo de una columna (con confirmación y «Deshacer»). */
  async function deleteDoneCards(cards: BoardCard[]) {
    if (!cards.length) return;
    if (
      !(await confirm({
        title: `¿Eliminar ${plural(cards.length, "tarjeta completada", "tarjetas completadas")}?`,
        message:
          "También se eliminan los pendientes que nacieron con ellas. Podrás deshacerlo durante unos segundos.",
        confirmLabel: "Eliminar",
        danger: true,
        icon: "trash",
      }))
    )
      return;
    const tied = links.of(cards.map((c) => c.id));
    const removed = cards
      .map((c) => api.deleteCard(c.id))
      .filter((c): c is BoardCard => Boolean(c));
    if (!removed.length) return;
    const keep = dropTasksLater(
      removed.filter((c) => boardTask(c)).map((c) => c.entry_id),
    );
    notify(
      `${plural(removed.length, "tarjeta eliminada", "tarjetas eliminadas")}.`,
      {
        label: "Deshacer",
        icon: "undo",
        run: () => {
          keep();
          removed.forEach((c) => api.restoreCard(c));
          links.restore(tied);
        },
      },
    );
  }

  const openCard = openId
    ? inArchive
      ? archive.cards?.find((c) => c.id === openId)
      : api.cards.find((c) => c.id === openId)
    : undefined;
  const patchOpen = (ch: CardChanges) => {
    if (!openCard) return;
    syncTask(openCard, ch);
    if (inArchive) return archive.patch(openCard.id, ch);
    // Cambiar de columna desde la ficha: va al final de la nueva (y corren sus reglas).
    if (ch.list_id && ch.list_id !== openCard.list_id) {
      const { list_id, ...rest } = ch;
      if (
        moveWithRules(
          [openCard.id],
          list_id,
          byList.get(list_id)?.length ?? 0,
        ) === null
      )
        return;
      if (Object.keys(rest).length) api.patchCard(openCard.id, rest);
      return;
    }
    const was = openCard.checks;
    const fields = changedFields(openCard, ch);
    api.patchCard(openCard.id, ch);
    const events: Fired[] = [];
    if (fields.length)
      events.push({
        type: "field",
        card: openCard.id,
        list: openCard.list_id,
        fields,
      });
    if (
      ch.checks?.length &&
      ch.checks.every((x) => x.done) &&
      !(was.length && was.every((x) => x.done))
    )
      events.push({
        type: "checks",
        card: openCard.id,
        list: openCard.list_id,
      });
    if (events.length) fire(events);
  };

  /**
   * Añade tarjetas con escritura rápida: #etiqueta, @persona, !prioridad y **resaltada**. Las
   * personas van en un pendiente vinculado (como al añadirlas desde la ficha).
   */
  function addFrom(listId: string, items: NewCardInput[], due?: string | null) {
    const parsed = items
      .map((i) => {
        const raw = typeof i === "string" ? i : i.title;
        const q = parseQuick(raw, workspace.people);
        return {
          input: {
            title: q.title,
            body: typeof i === "string" ? "" : (i.body ?? ""),
            tags: q.tags,
            priority: q.priority,
            highlight: q.highlight,
            ...(due && { due }),
          },
          people: q.people,
        };
      })
      .filter((p) => p.input.title.trim());
    if (!parsed.length) return [];
    const real = parsed.filter((p) => !isDivider(p.input.title)).length;
    if (real && blocked(listId, real)) return [];
    if (!api.power && parsed.some((p) => p.input.priority || p.input.highlight))
      notify(
        "La prioridad y el resaltado no se guardaron: falta la migración 202611090002_board_power.sql.",
      );
    const made = api.addCards(
      listId,
      parsed.map((p) =>
        api.power
          ? p.input
          : { ...p.input, priority: "" as const, highlight: false },
      ),
    );
    made.forEach((card, k) => {
      const ids = parsed[k]?.people ?? [];
      if (!ids.length) return;
      void createEntry(boardEntryInput(card, ids, false), true).then(
        (e) => e && api.patchIfPresent(card.id, { entry_id: e.id }),
      );
    });
    const events: Fired[] = made
      .filter((c) => !isDivider(c.title))
      .map((c) => ({ type: "create" as const, card: c.id, list: listId }));
    // Con @personas en el título, también corre «Se le añade una persona».
    made.forEach((card, k) => {
      const ids = parsed[k]?.people ?? [];
      if (ids.length)
        events.push({ type: "person", card: card.id, list: listId, people: ids });
    });
    fire(events);
    return made;
  }

  /** Una tarjeta desde una plantilla de tarjeta (/reunion): trae su lista, etiquetas y fecha. */
  function addFromTemplate(listId: string, title: string, tpl: CardTemplate) {
    const made = addFrom(listId, [title || tpl.title || tpl.name]);
    made.forEach((card) => {
      const ch = templateChanges(tpl, card);
      if (!api.power) delete ch.priority;
      if (Object.keys(ch).length) api.patchCard(card.id, ch);
    });
  }

  /** Pospone (o despierta, con null) estas tarjetas. */
  function snoozeCards(ids: string[], until: string | null) {
    if (!api.power)
      return notify(
        "Para posponer ejecuta supabase/migrations/202611090002_board_power.sql en el SQL Editor de Supabase.",
      );
    const before = ids
      .map((id) => api.peek(id))
      .filter((c): c is BoardCard => Boolean(c))
      .map((c) => ({ id: c.id, snoozed_until: c.snoozed_until }));
    before.forEach((b) => api.patchCard(b.id, { snoozed_until: until }));
    if (until)
      setSelection((s) => new Set([...s].filter((id) => !ids.includes(id))));
    const n = before.length;
    notify(
      until
        ? `${n === 1 ? "Pospuesta" : `${n} pospuestas`} hasta ${friendlyDate(until).toLowerCase()}. Vuelve${n === 1 ? "" : "n"} sola${n === 1 ? "" : "s"} ese día.`
        : n === 1
          ? "Tarjeta despierta: vuelve a su columna."
          : `${n} tarjetas despiertas.`,
      {
        label: "Deshacer",
        icon: "undo",
        run: () =>
          before.forEach((b) =>
            api.patchIfPresent(b.id, { snoozed_until: b.snoozed_until }),
          ),
      },
    );
  }

  // ── Acciones en grupo (selección) ──
  /** Cambia campos de las seleccionadas; «Deshacer» deja cada una como estaba. */
  function bulkPatch(label: string, fn: (c: BoardCard) => CardChanges | null) {
    const undo: { id: string; ch: CardChanges }[] = [];
    const events: Fired[] = [];
    for (const c of picked) {
      const ch = fn(c);
      if (!ch || !Object.keys(ch).length) continue;
      const back = Object.fromEntries(
        Object.keys(ch).map((k) => [k, c[k as keyof CardChanges]]),
      ) as CardChanges;
      undo.push({ id: c.id, ch: back });
      const fields = changedFields(c, ch);
      if (fields.length)
        events.push({ type: "field", card: c.id, list: c.list_id, fields });
      api.patchCard(c.id, ch);
      syncTask(c, ch);
    }
    if (!undo.length) return;
    notify(`${label} · ${plural(undo.length, "tarjeta", "tarjetas")}.`, {
      label: "Deshacer",
      icon: "undo",
      run: () => undo.forEach((u) => api.patchIfPresent(u.id, u.ch)),
    });
    if (events.length) fire(events);
  }
  function bulkDone() {
    const allDone = picked.every(isDone);
    const undos: (() => void)[] = [];
    const events: Fired[] = [];
    for (const c of pickedInOrder()) {
      if (isDone(c) !== allDone) continue;
      undos.push(
        toggleDone(c, (ch) => api.patchCard(c.id, ch), {
          rules: false,
          quiet: true,
        }),
      );
      if (!c.repeat)
        events.push({
          type: allDone ? "undone" : "done",
          card: c.id,
          list: c.list_id,
        });
    }
    const undoAll = () => undos.forEach((u) => u());
    // Si actúan reglas, su aviso trae «Deshacer» para todo (las reglas y el completar).
    if (fire(events, undoAll)) return;
    notify(
      `${plural(undos.length, "tarjeta", "tarjetas")} ${allDone ? "sin completar" : "completada" + (undos.length === 1 ? "" : "s")}.`,
      { label: "Deshacer", icon: "undo", run: undoAll },
    );
  }
  function bulkMove(target: string) {
    const before = picked.map((c) => ({
      id: c.id,
      list_id: c.list_id,
      rank: c.rank,
    }));
    const back = () =>
      before.forEach((b) =>
        api.patchIfPresent(b.id, { list_id: b.list_id, rank: b.rank }),
      );
    const col = api.peekColumn(target);
    const ruled = moveWithRules(
      pickedInOrder().map((c) => c.id),
      target,
      byList.get(target)?.length ?? 0,
      back,
    );
    if (ruled === null) return;
    clearSelection();
    if (ruled) return;
    notify(
      `${plural(before.length, "tarjeta movida", "tarjetas movidas")} a «${col?.name.slice(0, 40) ?? "la columna"}».`,
      { label: "Deshacer", icon: "undo", run: back },
    );
  }
  function bulkArchive() {
    if (!api.extras)
      return notify(
        `Para archivar ejecuta ${BOARD_SQL} en el SQL Editor de Supabase.`,
      );
    const moved = picked
      .map((c) => api.archiveCard(c.id))
      .filter((c): c is BoardCard => Boolean(c));
    clearSelection();
    if (!moved.length) return;
    list.setArchived((n) => n + moved.length);
    notify(
      `${plural(moved.length, "tarjeta archivada", "tarjetas archivadas")}.`,
      {
        label: "Deshacer",
        icon: "undo",
        run: () => {
          moved.forEach((c) => api.unarchiveCard(c));
          list.setArchived((n) => Math.max(0, n - moved.length));
        },
      },
    );
  }
  function bulkDelete() {
    const tied = links.of(picked.map((c) => c.id));
    const removed = picked
      .map((c) => api.deleteCard(c.id))
      .filter((c): c is BoardCard => Boolean(c));
    clearSelection();
    if (!removed.length) return;
    const keep = dropTasksLater(
      removed.filter((c) => boardTask(c)).map((c) => c.entry_id),
    );
    notify(
      `${plural(removed.length, "tarjeta eliminada", "tarjetas eliminadas")}.`,
      {
        label: "Deshacer",
        icon: "undo",
        run: () => {
          keep();
          removed.forEach((c) => api.restoreCard(c));
          links.restore(tied);
        },
      },
    );
  }

  const bg = backgroundOf(board?.background);
  const realCards = api.cards.filter((c) => !isDivider(c.title));
  const activeCount = realCards.length;
  const doneCount = realCards.filter(isDone).length;
  const snoozedCount = realCards.filter(isSnoozed).length;
  const cols = api.columns;
  const aging = board?.settings.aging ?? 0;

  // ── Avance acumulado: lo completado (también lo ya archivado) sobre el total ──
  const progressTotal = activeCount + api.closed;
  const progressPct = progressTotal
    ? Math.round((100 * (doneCount + api.closed)) / progressTotal)
    : 0;

  // ── Vencidas (para el triage) ──
  const overdue = realCards.filter(
    (c) => c.due && c.due < today && !isDone(c) && !isSnoozed(c),
  );
  /** Cuántas abiertas vencen ese día (para repartir la carga sin pasar del tope). */
  const loadOn = (date: string) =>
    api
      .peekAll()
      .filter(
        (c) =>
          c.due === date && !isDivider(c.title) && !isDone(c) && !isSnoozed(c),
      ).length;
  /** Cambia campos de una tarjeta (y de su pendiente) y devuelve cómo deshacerlo. */
  function patchBack(c: BoardCard, ch: CardChanges) {
    const before = Object.fromEntries(
      Object.keys(ch).map((k) => [k, c[k as keyof CardChanges] ?? null]),
    ) as CardChanges;
    api.patchCard(c.id, ch);
    syncTask(c, ch);
    return () => {
      const now = api.peek(c.id);
      if (!now) return;
      api.patchCard(c.id, before);
      syncTask(now, before);
    };
  }
  function triageDrop(c: BoardCard) {
    if (c.repeat) {
      // Una rutina no se suelta: se salta esta vez y vuelve en la fecha siguiente.
      return patchBack(c, { due: nextDue(c.repeat, c.due) ?? c.due });
    }
    const gone = api.archiveCard(c.id);
    if (!gone) return () => {};
    list.setArchived((n) => n + 1);
    return () => {
      api.unarchiveCard(gone);
      list.setArchived((n) => Math.max(0, n - 1));
    };
  }

  // ── Lo que necesitan las otras vistas ──
  // Se recalcula cuando cambia algo que decide qué se ve (no en cada pintado).
  const viewCards = useMemo(
    () => realCards.filter(visible),
    [api.cards, query, hideDone, showSnoozed, recurring, tasks, today], // eslint-disable-line
  );
  const viewApi: ViewApi = {
    cards: viewCards,
    columns: cols,
    today,
    power: api.power,
    sync: api.sync,
    isDone,
    linked,
    open: (c) => setOpenId(c.id),
    toggle: (c) => void toggleDone(c, (ch) => api.patchCard(c.id, ch)),
    patch: (c, ch, label) => {
      const fields = changedFields(c, ch);
      const undo = patchBack(c, ch);
      if (label)
        notify(label + ".", { label: "Deshacer", icon: "undo", run: undo });
      // Editar desde la tabla, el calendario o la matriz también corre «Cambia un campo».
      if (fields.length)
        fire([{ type: "field", card: c.id, list: c.list_id, fields }]);
    },
    move: (c, listId) => {
      if (listId === c.list_id) return;
      const back = { list_id: c.list_id, rank: c.rank };
      const ruled = moveWithRules(
        [c.id],
        listId,
        byList.get(listId)?.length ?? 0,
        () => api.patchIfPresent(c.id, back),
      );
      if (ruled === false)
        notify(
          `Movida a «${api.peekColumn(listId)?.name.slice(0, 40) ?? "la columna"}».`,
          {
            label: "Deshacer",
            icon: "undo",
            run: () => api.patchIfPresent(c.id, back),
          },
        );
    },
    add: (listId, title, due) => void addFrom(listId, [title], due),
  };

  // ── Lienzo: dónde está cada tarjeta y el sentido de cada flecha ──
  // Se guarda con el tablero (y en este equipo, por si falta la migración de ajustes).
  const [localCanvas, setLocalCanvas] = useState<Record<string, CanvasLayout>>(readCanvas);
  const canvasLayout: CanvasLayout = board
    ? (board.settings.canvas ?? localCanvas[board.id] ?? {})
    : {};
  function saveCanvas(next: CanvasLayout, label?: string) {
    if (!board) return;
    const before = canvasLayout;
    // Solo lo que sigue existiendo: tarjetas del tablero y vínculos vigentes.
    const ids = new Set(api.peekAll().map((c) => c.id));
    const clean: CanvasLayout = {
      p: Object.fromEntries(
        Object.entries(next.p ?? {}).filter(([id]) => ids.has(id)),
      ),
      d: Object.fromEntries(
        Object.entries(next.d ?? {}).filter(([key]) => {
          const [a, b] = key.split("|");
          return links.has(a, b);
        }),
      ),
    };
    setLocalCanvas((all) => {
      const n = { ...all, [board.id]: clean };
      writeCanvas(n);
      return n;
    });
    if (api.power)
      list.update(board.id, { settings: { ...board.settings, canvas: clean } });
    if (label)
      notify(label + ".", {
        label: "Deshacer",
        icon: "undo",
        run: () => saveCanvasNow.current(before),
      });
  }
  const saveCanvasNow = useRef(saveCanvas);
  saveCanvasNow.current = saveCanvas;

  // Lo que cambiaste desde la ventanita de abajo a la derecha aparece aquí al momento.
  const apiNow = useRef(api);
  apiNow.current = api;
  useEffect(() => {
    const onDock = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id && apiNow.current.peekColumn(id)) void apiNow.current.refreshList(id);
    };
    window.addEventListener(DOCK_WROTE, onDock);
    return () => window.removeEventListener(DOCK_WROTE, onDock);
  }, []);

  // ── Cerrar y archivar el tablero ──
  const closingStats = (): ClosingStats => {
    const firstCard = realCards
      .map((c) => c.created_at)
      .filter((x): x is string => Boolean(x))
      .sort()[0];
    const start = [board?.created_at, firstCard]
      .filter((x): x is string => Boolean(x))
      .sort()[0];
    return {
      from: start ? todayInputValue(new Date(start)) : today,
      to: today,
      cards: progressTotal,
      done: doneCount + api.closed,
    };
  };
  async function archiveBoard(
    closingData: BoardClosing,
    learn: boolean,
    asEpisode = false,
  ) {
    if (!board) return;
    const gone = board;
    setClosing(false);
    let data = closingData;
    if (learn) {
      const saved = await createEntry(
        {
          title: `Cierre de «${gone.name.slice(0, 120)}»`,
          body: closingSummary(gone.name, closingData),
          kind: "Aprendizaje",
          tags: ["tablero", "cierre"],
          personIds: [],
          date: today,
          amount: 0,
          direction: "egreso",
          status: "pendiente",
          images: [],
          details: cleanDetails("Aprendizaje", {
            source: "Práctica",
            sourceName: gone.name.slice(0, 120),
          }),
          file: null,
          removeFile: false,
        },
        true,
      );
      if (saved) data = { ...data, learningId: saved.id };
    }
    // Un proyecto cerrado: el tablero queda también como episodio, con su gente y su resultado.
    if (asEpisode) {
      const outcome = [
        data.well?.trim() && `Salió bien:\n${data.well.trim()}`,
        data.different?.trim() && `Haría distinto:\n${data.different.trim()}`,
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 4000);
      const summary = `${data.done ?? 0} de ${data.cards ?? 0} tarjetas completadas en el tablero «${gone.name.slice(0, 100)}».`;
      const ends = data.to ?? today;
      const existing = data.episodeId
        ? workspace.episodes.find((e) => e.id === data.episodeId)
        : undefined;
      if (existing) {
        await updateEpisode(
          existing,
          { status: "cerrado", ends_on: ends, summary, outcome },
          true,
        );
      } else {
        const people = [...new Set(realCards.flatMap((c) => peopleOf(c)))];
        const starts = data.from && data.from <= ends ? data.from : null;
        const ep = await saveEpisode(
          {
            title: gone.name.slice(0, 120),
            kind: "proyecto",
            status: "cerrado",
            starts_on: starts,
            ends_on: ends,
            summary,
            source: "",
            person_ids: people.slice(0, 60),
            place_ids: [],
            budget: null,
            outcome,
          },
          true,
        );
        if (ep) {
          data = { ...data, episodeId: ep.id };
          // El aprendizaje del cierre pasa a ser parte del episodio.
          if (data.learningId) await linkEntries([data.learningId], ep.id, true);
        } else notify("No se pudo guardar el episodio; el tablero se archiva igual.");
      }
    }
    const ok = await list.archiveBoard(gone.id, data);
    if (!ok) return;
    const rest = (list.boards ?? []).filter((b) => b.id !== gone.id);
    pick(rest[0]?.id ?? "");
    notify(
      `«${gone.name.slice(0, 40)}» archivado${data.learningId ? " y su cierre quedó como aprendizaje" : ""}${data.episodeId ? (data.learningId ? " y como episodio" : " y quedó como episodio") : ""}.`,
      {
        label: "Deshacer",
        icon: "undo",
        run: () => {
          list.unarchiveBoard(gone.id);
          pick(gone.id);
        },
      },
    );
  }
  const boardTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of api.cards)
      for (const t of c.tags) {
        const k = normalizeText(t);
        if (!seen.has(k)) seen.set(k, t);
      }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "es"));
  }, [api.cards]);

  // ── Una columna ──
  const renderColumn = (col: (typeof cols)[number], i: number) => {
    const every = orderedIn(col.id);
    // Los divisores («---») ordenan la columna, pero no cuentan como tarjetas.
    const all = (byList.get(col.id) ?? []).filter((c) => !isDivider(c.title));
    const shown = every.filter((c) => visible(c) && !dragging(c));
    const tone = toneOf(col.color);
    const done = all.filter(isDone).length;
    const sleeping = all.filter(isSnoozed).length;
    const isPinned = list.pinned?.id === col.id;
    const here = drag?.kind === "card" && drag.list === col.id;
    const nextCol = cols[i + 1]?.id ?? null;
    const cfg = col.rules;
    const ruleCount = cfg.rules.filter((r) => r.on).length;
    const count = all.length - sleeping;
    const over = cfg.limit > 0 && count > cfg.limit;
    const full = cfg.limit > 0 && count >= cfg.limit;

    // Plegada: una franja delgada con su nombre en vertical. Un clic la despliega.
    if (isFolded(col.id))
      return (
        <section
          key={col.id}
          className={"bd-list folded" + (tone ? " toned" : "")}
          data-list={col.id}
          data-flip={"l:" + col.id}
          style={tone ? ({ "--lc": tone.c } as CSSProperties) : undefined}
        >
          <button
            type="button"
            className="bd-fold"
            title={`${col.name} · clic para desplegar, arrastra para mover`}
            aria-label={`Desplegar la columna ${col.name}`}
            onPointerDown={(e) =>
              dnd.start(e, { kind: "list", id: col.id, before: nextCol })
            }
            onClick={() => !dnd.wasDrag() && setFolded([col.id], false)}
          >
            <UnfoldHorizontal size={15} className="bd-fold-icon" />
            <span className="bd-list-count">{all.length}</span>
            <span className="bd-fold-name">
              {tone && <i className="bd-list-dot" />}
              {col.name}
            </span>
            {done > 0 && (
              <span className="bd-fold-done" title={`${done} completadas`}>
                <Check size={11} strokeWidth={3} /> {done}
              </span>
            )}
          </button>
        </section>
      );
    const placeholder = (
      <div
        key="ph"
        className="bd-ph"
        data-flip="c:ph"
        style={{ height: drag?.kind === "card" ? drag.h : 0 }}
      />
    );
    const items: ReactNode[] = [];
    // «Completadas abajo»: las completadas salen de la lista y van al grupo plegable del final.
    const grouped = cfg.doneBelow;
    const inGroup = (c: BoardCard) => grouped && !isDivider(c.title) && isDone(c);
    const groupCards: ReactNode[] = [];
    // Cuenta también la que arrastras: así el grupo no desaparece a mitad del arrastre.
    const groupCount = grouped
      ? every.filter((c) => visible(c) && inGroup(c)).length
      : 0;
    const groupOpen = doneOpen.has(col.id);
    shown.forEach((c, j) => {
      const into = inGroup(c) ? groupCards : items;
      if (here && drag.before === c.id) into.push(placeholder);
      if (isDivider(c.title)) {
        items.push(
          <DividerTile
            key={c.id}
            card={c}
            before={shown[j + 1]?.id ?? null}
            onDelete={() => deleteCard(c)}
            onDragStart={(e, before) =>
              dnd.start(e, { kind: "card", id: c.id, list: col.id, before })
            }
          />,
        );
        return;
      }
      const cardDone = isDone(c);
      into.push(
        <CardTile
          key={c.id}
          card={c}
          done={cardDone}
          linkedTask={linked(c)}
          before={shown[j + 1]?.id ?? null}
          open={view.open(c.id)}
          inline={inlineFor(c)}
          selected={selection.has(c.id)}
          age={ageOf(c, aging, cardDone, today)}
          blocked={cardDone ? undefined : blockerOf(c)?.title}
          onOpen={() => !dnd.wasDrag() && setOpenId(c.id)}
          onSelect={(mode) => !dnd.wasDrag() && selectCard(c, mode)}
          onToggle={() => void toggleDone(c, (ch) => api.patchCard(c.id, ch))}
          onDelete={() => deleteCard(c)}
          onArchive={() => archiveCard(c)}
          onSnooze={(anchor) => setMenu({ kind: "snooze", id: c.id, anchor })}
          onDragStart={(e, before) =>
            dnd.start(e, { kind: "card", id: c.id, list: col.id, before })
          }
          hooks={{ left: i > 0, right: i < cols.length - 1 }}
          linkState={
            linking
              ? linking.id === c.id
                ? "source"
                : links.has(linking.id, c.id)
                  ? "linked"
                  : undefined
              : undefined
          }
          onHook={(side) => setLinking({ id: c.id, list: col.id, side })}
        />,
      );
    });
    if (here && drag.before === null)
      // Una completada que cae al final de una columna agrupada va al final de su grupo.
      (grouped && drag.done && groupCount > 0 && groupOpen
        ? groupCards
        : items
      ).push(placeholder);
    return (
      <section
        key={col.id}
        className={
          "bd-list" +
          (tone ? " toned" : "") +
          (here ? " over" : "") +
          (over ? " over-limit" : "") +
          (linking?.list === col.id ? " link-from" : "")
        }
        data-list={col.id}
        data-flip={"l:" + col.id}
        style={tone ? ({ "--lc": tone.c } as CSSProperties) : undefined}
      >
        <header
          className="bd-list-head"
          onPointerDown={(e) =>
            dnd.start(e, { kind: "list", id: col.id, before: nextCol })
          }
        >
          {renaming === col.id ? (
            <TitleInput
              value={col.name}
              onDone={(name) => {
                if (name && name !== col.name) {
                  api.updateColumn(col.id, { name: name.slice(0, 120) });
                  list.renamePin(col.id, name.slice(0, 120));
                }
                setRenaming(null);
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <button
              type="button"
              className="bd-list-title"
              title="Clic para renombrar · arrastra para mover la columna"
              onClick={() => !dnd.wasDrag() && setRenaming(col.id)}
            >
              {tone && <i className="bd-list-dot" />}
              <span>{col.name}</span>
            </button>
          )}
          {isPinned && renaming !== col.id && (
            <span className="bd-list-pin" title="Anclada a Mi espacio">
              <Pin size={13} />
            </span>
          )}
          {docked?.list === col.id && renaming !== col.id && (
            <span className="bd-list-pin" title="Anclada abajo a la derecha">
              <PictureInPicture2 size={13} />
            </span>
          )}
          {renaming !== col.id &&
            (ruleCount > 0 || cfg.sort || cfg.autoArchive > 0) && (
              <button
                type="button"
                className="bd-list-rules"
                data-nodrag
                title={[
                  ruleCount &&
                    plural(ruleCount, "regla activa", "reglas activas"),
                  cfg.sort && `Orden: ${sortLabels[cfg.sort].toLowerCase()}`,
                  cfg.autoArchive &&
                    `Archiva lo completado a los ${cfg.autoArchive} días`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                aria-label="Reglas de la columna"
                onClick={() => setRulesFor(col.id)}
              >
                {cfg.sort && !ruleCount ? (
                  <ArrowDownWideNarrow size={12} />
                ) : (
                  <Zap size={12} />
                )}
                {ruleCount > 0 && <span>{ruleCount}</span>}
              </button>
            )}
          <span
            className={"bd-list-count" + (over ? " over" : full ? " full" : "")}
            title={
              `${all.length} ${all.length === 1 ? "tarjeta" : "tarjetas"}${done ? ` · ${done} completadas` : ""}${sleeping ? ` · ${sleeping} pospuestas` : ""}` +
              (cfg.limit
                ? ` · límite ${cfg.limit}${cfg.limitMode === "block" ? " (no deja pasar más)" : ""}`
                : "")
            }
          >
            {cfg.limit ? `${count}/${cfg.limit}` : all.length}
          </span>
          <button
            type="button"
            className="bd-icon bd-list-fold"
            data-nodrag
            title="Plegar la columna"
            aria-label="Plegar la columna"
            onClick={() => {
              if (composer === col.id) setComposer(null);
              setFolded([col.id], true);
            }}
          >
            <FoldHorizontal size={15} />
          </button>
          <button
            type="button"
            className="bd-icon bd-list-menu"
            data-nodrag
            aria-label="Opciones de la columna"
            aria-expanded={menu?.kind === "list" && menu.id === col.id}
            onClick={(e) =>
              setMenu({
                kind: "list",
                id: col.id,
                anchor: e.currentTarget.getBoundingClientRect(),
              })
            }
          >
            <MoreHorizontal size={17} />
          </button>
          {all.length > 0 && done > 0 && (
            <i
              className="bd-list-progress"
              aria-hidden="true"
              title={`${Math.round((100 * done) / all.length)} % completado`}
              style={{ "--p": done / all.length } as CSSProperties}
            />
          )}
        </header>
        <ColumnStack
          items={items}
          onDoubleClick={(e) =>
            e.target === e.currentTarget && setComposer(col.id)
          }
        >
          {!shown.length && !here && all.length > 0 && composer !== col.id && (
            <p className="bd-list-none">
              {needle
                ? "Nada coincide"
                : sleeping === all.length
                  ? "Todas pospuestas"
                  : "Todas completadas"}
            </p>
          )}
          {composer === col.id && (
            <Composer
              people={workspace.people}
              tags={boardTags}
              templates={cardTemplates.all}
              onAdd={(titles) => addFrom(col.id, titles)}
              onTemplate={(title, tpl) => addFromTemplate(col.id, title, tpl)}
              onClose={() => setComposer(null)}
            />
          )}
          {groupCount > 0 && (
            <DoneGroup
              count={groupCount}
              open={groupOpen}
              onToggle={() => toggleDoneOpen(col.id)}
              onArchiveAll={
                api.extras
                  ? () => archiveCards(shown.filter(inGroup))
                  : undefined
              }
              onDeleteAll={() => void deleteDoneCards(shown.filter(inGroup))}
              cards={groupCards}
            />
          )}
        </ColumnStack>
        {(composer !== col.id || sleeping > 0) && (
          <footer className="bd-list-foot">
            {composer !== col.id && (
              <button
                type="button"
                className="bd-add"
                disabled={full && cfg.limitMode === "block"}
                title={
                  full && cfg.limitMode === "block"
                    ? "La columna llegó a su límite"
                    : undefined
                }
                onClick={() => setComposer(col.id)}
              >
                <Plus size={16} /> Añade una tarjeta
              </button>
            )}
            {sleeping > 0 && !needle && (
              <button
                type="button"
                className={
                  "bd-snz-toggle" + (showSnoozed.has(col.id) ? " on" : "")
                }
                aria-pressed={showSnoozed.has(col.id)}
                title={
                  showSnoozed.has(col.id)
                    ? "Ocultar las pospuestas"
                    : "Ver las pospuestas"
                }
                onClick={() =>
                  setShowSnoozed((s) => {
                    const n = new Set(s);
                    if (n.has(col.id)) n.delete(col.id);
                    else n.add(col.id);
                    return n;
                  })
                }
              >
                <AlarmClock size={13} />
                {plural(sleeping, "pospuesta", "pospuestas")}
              </button>
            )}
          </footer>
        )}
      </section>
    );
  };

  const newColumn = (at: number) => (
    <NewColumn
      key="new"
      onAdd={(name) => {
        api.addColumn(name, at);
        setDraftAt(at + 1);
      }}
      onClose={() => setDraftAt(null)}
    />
  );
  const columns: ReactNode[] = [];
  cols.forEach((col, i) => {
    if (draftAt === i) columns.push(newColumn(i));
    if (drag?.kind === "list" && drag.before === col.id)
      columns.push(
        <div
          key="lph"
          className="bd-list-ph"
          data-flip="l:ph"
          style={{ width: drag.w, height: drag.h }}
        />,
      );
    if (drag?.kind === "list" && drag.id === col.id) return;
    columns.push(renderColumn(col, i));
  });
  if (drag?.kind === "list" && drag.before === null)
    columns.push(
      <div
        key="lph"
        className="bd-list-ph"
        data-flip="l:ph"
        style={{ width: drag.w, height: drag.h }}
      />,
    );
  if (draftAt !== null && draftAt >= cols.length)
    columns.push(newColumn(cols.length));

  const menuCol =
    menu?.kind === "list" ? cols.find((c) => c.id === menu.id) : undefined;
  const moveCol =
    menu?.kind === "move" ? cols.find((c) => c.id === menu.id) : undefined;
  // A dónde se puede mover una columna: tus otros tableros (o tus otras plantillas, si editas una).
  const otherBoards = (
    (editingTemplate ? list.templates : list.boards) ?? []
  ).filter((b) => b.id !== board?.id);
  const menuIdx = menuCol ? cols.indexOf(menuCol) : -1;
  const menuCards = menuCol ? (byList.get(menuCol.id) ?? []) : [];
  const menuDone = menuCards.filter(isDone).length;
  const close = () => setMenu(null);

  return (
    <section
      className={"bd" + (bg.dark ? " on-dark" : "")}
      style={
        { "--bd-bg": bg.css } as CSSProperties
      }
    >
      <header className="bd-bar">
        {toggleMenu && (
          <button
            type="button"
            className="bd-icon bd-menu"
            aria-label="Abrir menú"
            onClick={toggleMenu}
          >
            <MenuIcon size={18} />
          </button>
        )}
        <button
          type="button"
          className="bd-picker"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "picker"}
          onClick={(e) =>
            setMenu({
              kind: "picker",
              anchor: e.currentTarget.getBoundingClientRect(),
            })
          }
        >
          <span
            className="bd-picker-mark"
            style={{ background: bg.css }}
          >
            <Columns3 size={14} />
          </span>
          <strong>
            {board?.name ?? "Tableros"}
          </strong>
          {editingTemplate && <span className="bd-picker-tag">Plantilla</span>}
          <ChevronDown size={15} />
        </button>
        {board && api.status === "ready" && (
          <span className="bd-stats">
            {activeCount} {activeCount === 1 ? "tarjeta" : "tarjetas"}
            {doneCount > 0 &&
              ` · ${doneCount} ${doneCount === 1 ? "completada" : "completadas"}`}
            {snoozedCount > 0 && ` · ${snoozedCount} pospuestas`}
            {progressTotal > 0 && (
              <b
                className="bd-stats-pct"
                title={`Avance acumulado: ${doneCount + api.closed} de ${progressTotal}${api.closed ? ` (incluye ${api.closed} completadas ya archivadas)` : ""}`}
              >
                {progressPct} %
              </b>
            )}
          </span>
        )}
        {board?.settings.anchor && !editingTemplate && (
          <span
            className="bd-anchor"
            title={`${board.settings.anchor.label}: ${friendlyDate(board.settings.anchor.date).toLowerCase()}`}
          >
            <CalendarClock size={13} />
            {(() => {
              const left = daysBetween(today, board.settings.anchor.date);
              return left > 0
                ? `Faltan ${plural(left, "día", "días")}`
                : left === 0
                  ? "Es hoy"
                  : `Hace ${plural(-left, "día", "días")}`;
            })()}
          </span>
        )}
        {board &&
          api.status === "ready" &&
          overdue.length > 0 &&
          !boardArchived && (
            <button
              type="button"
              className="bd-overdue"
              title="Revisarlas una por una o repartirlas en los próximos días"
              onClick={() => setTriage(true)}
            >
              <AlarmClock size={13} />
              {overdue.length} {overdue.length === 1 ? "vencida" : "vencidas"}
            </button>
          )}
        {board && api.status === "ready" && (
          <ViewSwitch
            mode={mode}
            onChange={(m) => {
              clearSelection();
              setComposer(null);
              setDraftAt(null);
              setMode(m);
            }}
          />
        )}
        {board && api.status === "ready" && progressTotal > 0 && (
          <i
            className="bd-progress"
            aria-hidden="true"
            style={{ "--p": progressPct / 100 } as CSSProperties}
          />
        )}
        <div className="bd-bar-end">
          {board && (
            <label className="bd-search">
              <Search size={15} aria-hidden="true" />
              <input
                value={query}
                placeholder="Filtrar tarjetas…"
                aria-label="Filtrar tarjetas"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.stopPropagation();
                    setQuery("");
                  }
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Borrar el filtro"
                  onClick={() => setQuery("")}
                >
                  <X size={13} />
                </button>
              )}
            </label>
          )}
          {board && (
            <>
              <button
                type="button"
                className={"bd-icon" + (hideDone ? " on" : "")}
                aria-pressed={hideDone}
                title={
                  hideDone
                    ? "Mostrar las completadas"
                    : "Ocultar las completadas"
                }
                aria-label={
                  hideDone
                    ? "Mostrar las completadas"
                    : "Ocultar las completadas"
                }
                onClick={() => setHideDone((v) => !v)}
              >
                {hideDone ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
              <button
                type="button"
                className="bd-btn primary bd-add-col"
                onClick={() => {
                  setMode("columnas");
                  setDraftAt(cols.length);
                }}
              >
                <Plus size={16} /> Columna
              </button>
              <button
                type="button"
                className="bd-icon"
                aria-label="Opciones del tablero"
                aria-expanded={menu?.kind === "board"}
                onClick={(e) =>
                  setMenu({
                    kind: "board",
                    anchor: e.currentTarget.getBoundingClientRect(),
                  })
                }
              >
                <MoreHorizontal size={18} />
              </button>
            </>
          )}
        </div>
      </header>

      {editingTemplate && board && (
        <div className="bd-template-bar" role="status">
          <span className="bd-template-mark" aria-hidden="true">
            <LayoutTemplate size={15} />
          </span>
          <p>
            <b>Editando la plantilla «{board.name}».</b> Los cambios se guardan
            solos y se usan en los tableros nuevos que crees con ella.
          </p>
          <button
            type="button"
            className="bd-btn sm"
            onClick={() => setGallery("m:" + board.id)}
          >
            <Plus size={14} /> Crear tablero con ella
          </button>
          <button
            type="button"
            className="bd-btn primary sm"
            onClick={() => pick(list.boards?.[0]?.id ?? "")}
          >
            <Check size={14} /> Listo
          </button>
        </div>
      )}

      {board && boardArchived && (
        <div className="bd-template-bar bd-archived-bar" role="status">
          <span className="bd-template-mark" aria-hidden="true">
            <Archive size={15} />
          </span>
          <p>
            <b>
              Tablero archivado{" "}
              {friendlyDate(
                todayInputValue(new Date(board.archived_at!)),
                today,
              ).toLowerCase()}
              .
            </b>{" "}
            {board.closing?.well
              ? `Salió bien: ${board.closing.well.slice(0, 120)}${board.closing.well.length > 120 ? "…" : ""}`
              : "No aparece en la Agenda ni en el saludo; sus reglas no corren."}
          </p>
          <button
            type="button"
            className="bd-btn primary sm"
            onClick={() => {
              list.unarchiveBoard(board.id);
              notify(`«${board.name.slice(0, 40)}» volvió a tus tableros.`);
            }}
          >
            <RotateCcw size={14} /> Reabrir
          </button>
        </div>
      )}

      {board && api.progress && (
        <p className="bd-notice bd-loading-note" role="status">
          Cargando {api.progress.loaded.toLocaleString("es")} de{" "}
          {api.progress.total.toLocaleString("es")} tarjetas…
        </p>
      )}

      {board && !api.extras && api.status === "ready" && (
        <p className="bd-notice">
          Para completar, archivar y dar color, ejecuta <code>{BOARD_SQL}</code>{" "}
          en el SQL Editor de Supabase.
        </p>
      )}

      <div className="bd-main" ref={main}>
        {list.error ? (
          <p className="bd-error" role="alert">
            {list.error}
          </p>
        ) : list.boards === null ? (
          <Skeleton />
        ) : !board ? (
          <Welcome
            onCreate={async (name) => {
              const id = await list.create(name);
              if (id) pick(id);
            }}
            onTemplates={(key) => setGallery(key)}
            onImport={() => setImporting(true)}
          />
        ) : api.status === "loading" ? (
          <Skeleton />
        ) : api.status === "error" ? (
          <p className="bd-error" role="alert">
            No se pudo cargar el tablero.{" "}
            <button type="button" onClick={() => void api.reload()}>
              Reintentar
            </button>
          </p>
        ) : mode === "lienzo" ? (
          <CanvasView
            key={board.id}
            api={viewApi}
            boardId={board.id}
            links={links.links}
            layout={canvasLayout}
            onLayout={saveCanvas}
            onLink={(a, b) => links.link(a, b)}
            onUnlink={unlinkCards}
            create={(listId, title) => addFrom(listId, [title])}
          />
        ) : mode !== "columnas" ? (
          <BoardViews mode={mode} api={viewApi} />
        ) : (
          <div
            ref={canvas}
            className={"bd-canvas" + (linking ? " linking" : "")}
            onPointerDown={(e) => {
              if (
                e.button !== 0 ||
                e.pointerType === "touch" ||
                e.target !== e.currentTarget
              )
                return;
              clearSelection();
              pan.current = {
                x: e.clientX,
                left: e.currentTarget.scrollLeft,
                id: e.pointerId,
                moved: false,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const p = pan.current;
              if (!p || p.id !== e.pointerId) return;
              const dx = e.clientX - p.x;
              if (!p.moved && Math.abs(dx) < 4) return;
              p.moved = true;
              e.currentTarget.classList.add("panning");
              e.currentTarget.scrollLeft = p.left - dx;
            }}
            onLostPointerCapture={(e) => {
              pan.current = null;
              e.currentTarget.classList.remove("panning");
            }}
            onDoubleClick={(e) => {
              const t = e.target as HTMLElement;
              if (
                t !== e.currentTarget &&
                !t.classList.contains("bd-canvas-end")
              )
                return;
              setDraftAt(insertIndex(e.clientX));
            }}
            onWheel={(e) => {
              const el = canvas.current;
              if (!el || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX))
                return;
              const stack = (e.target as HTMLElement).closest<HTMLElement>(
                "[data-stack]",
              );
              if (stack && stack.scrollHeight > stack.clientHeight + 1) return;
              el.scrollLeft += e.deltaY;
            }}
          >
            {columns}
            {draftAt === null && !drag && (
              <button
                type="button"
                className="bd-addlist"
                onClick={() => setDraftAt(cols.length)}
              >
                <Plus size={16} /> Añade otra columna
                <small>o haz doble clic en el fondo</small>
              </button>
            )}
            {!cols.length && draftAt === null && (
              <div className="bd-empty-hint">
                <Columns3 size={22} />
                <strong>Este tablero no tiene columnas</strong>
                <span>
                  Haz doble clic en cualquier parte del fondo para crear una,
                  justo ahí.
                </span>
              </div>
            )}
            <div className="bd-canvas-end" aria-hidden="true" />
            <BoardLinks
              canvas={canvas}
              links={links.links}
              order={cols.map((c) => c.id)}
              hidden={Boolean(drag)}
              linking={linking}
              onPick={pickLink}
              onCancel={cancelLink}
              onUnlink={unlinkCards}
            />
          </div>
        )}
      </div>

      {/* Archivados: encima del tablero, que queda tal cual debajo */}
      {archiveOpen && (
        <div
          className="bd-arch-layer"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closeArchive();
          }}
        >
          <div
            className="bd-arch-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Archivados"
          >
            <ArchiveView
              cards={archive.cards}
              missing={archive.missing}
              loading={archive.loading}
              query={archiveQuery}
              isDone={isDone}
              linked={linked}
              onOpen={(c) => setOpenId(c.id)}
              onUnarchive={unarchive}
              onDelete={deleteArchived}
              onQuery={setArchiveQuery}
              onClose={closeArchive}
            />
          </div>
        </div>
      )}

      {/* Lo que arrastras, siguiendo al puntero */}
      {drag &&
        createPortal(
          <div
            className="bd-ghost"
            ref={dnd.ghost}
            style={{ width: drag.w, transform: dnd.ghostAt() }}
            aria-hidden="true"
          >
            {drag.kind === "card"
              ? (() => {
                  const c = api.cards.find((x) => x.id === drag.id);
                  if (!c) return null;
                  if (isDivider(c.title))
                    return (
                      <div className="bd-divider lifted">
                        <i />
                      </div>
                    );
                  const tone = toneOf(c.color);
                  const many = multi(c.id) ? picked.length : 0;
                  return (
                    <div
                      className={
                        "bd-card lifted" +
                        (isDone(c) ? " done" : "") +
                        (tone ? " tinted" : "") +
                        (many ? " stacked" : "")
                      }
                      style={
                        tone ? ({ "--cc": tone.c } as CSSProperties) : undefined
                      }
                    >
                      {many > 0 && (
                        <span className="bd-ghost-count">{many}</span>
                      )}
                      <div className="bd-card-row">
                        <span className="bd-done" aria-pressed={isDone(c)}>
                          <Check size={11} strokeWidth={3.2} />
                        </span>
                        <div className="bd-card-body">
                          <CardFace
                            card={c}
                            done={isDone(c)}
                            linkedTask={linked(c)}
                            open={view.open(c.id)}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()
              : (() => {
                  const col = cols.find((x) => x.id === drag.id);
                  if (!col) return null;
                  const tone = toneOf(col.color);
                  if (isFolded(col.id))
                    return (
                      <section
                        className={
                          "bd-list folded lifted" + (tone ? " toned" : "")
                        }
                        style={
                          tone
                            ? ({ "--lc": tone.c } as CSSProperties)
                            : undefined
                        }
                      >
                        <div className="bd-fold">
                          <UnfoldHorizontal
                            size={15}
                            className="bd-fold-icon"
                          />
                          <span className="bd-list-count">
                            {byList.get(col.id)?.length ?? 0}
                          </span>
                          <span className="bd-fold-name">{col.name}</span>
                        </div>
                      </section>
                    );
                  const some = (byList.get(col.id) ?? []).slice(0, 7);
                  return (
                    <section
                      className={"bd-list lifted" + (tone ? " toned" : "")}
                      style={
                        {
                          maxHeight: Math.min(drag.h, 560),
                          ...(tone && { "--lc": tone.c }),
                        } as CSSProperties
                      }
                    >
                      <header className="bd-list-head">
                        <span className="bd-list-title">
                          {tone && <i className="bd-list-dot" />}
                          <span>{col.name}</span>
                        </span>
                        <span className="bd-list-count">
                          {byList.get(col.id)?.length ?? 0}
                        </span>
                      </header>
                      <div className="bd-stack">
                        {some.map((c) => (
                          <div
                            key={c.id}
                            className={"bd-card" + (isDone(c) ? " done" : "")}
                          >
                            <div className="bd-card-row">
                              <span
                                className="bd-done"
                                aria-pressed={isDone(c)}
                              >
                                <Check size={11} strokeWidth={3.2} />
                              </span>
                              <div className="bd-card-body">
                                <span className="bd-card-title">
                                  <CardText
                                    text={c.title}
                                    whole={c.highlight}
                                  />
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })()}
          </div>,
          document.body,
        )}

      {/* Menús */}
      {menu?.kind === "picker" && (
        <Popover
          anchor={menu.anchor}
          align="start"
          width={290}
          label="Tus tableros"
          onClose={close}
        >
          <p className="bd-pop-label">Tus tableros</p>
          <div className="bd-pick-list">
            {(list.boards ?? []).map((b) => {
              const on = b.id === board?.id;
              return (
                <button
                  type="button"
                  key={b.id}
                  className={"bd-pick-item" + (on ? " on" : "")}
                  onClick={() => pick(b.id)}
                >
                  <i style={{ background: backgroundOf(b.background).css }} />
                  <span>{b.name}</span>
                  {on && <Check size={15} />}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="bd-pick-item"
            onClick={openArchive}
          >
            <i className="arch">
              <Archive size={13} />
            </i>
            <span>Archivados</span>
            {list.archived > 0 && <small>{list.archived}</small>}
            
          </button>
          {list.archivedBoards.length > 0 && (
            <>
              <p className="bd-pop-label">Tableros cerrados</p>
              <div className="bd-pick-list short">
                {list.archivedBoards.map((b) => {
                  const on = b.id === board?.id;
                  const pct = b.closing?.cards
                    ? Math.round(
                        (100 * (b.closing.done ?? 0)) / b.closing.cards,
                      )
                    : null;
                  return (
                    <button
                      type="button"
                      key={b.id}
                      className={"bd-pick-item closed" + (on ? " on" : "")}
                      title={
                        b.closing?.to
                          ? `Cerrado el ${b.closing.to}`
                          : "Archivado"
                      }
                      onClick={() => pick(b.id)}
                    >
                      <i
                        style={{ background: backgroundOf(b.background).css }}
                      />
                      <span>{b.name}</span>
                      {pct !== null && <small>{pct} %</small>}
                      {on && <Check size={15} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {list.templates.length > 0 && (
            <>
              <p className="bd-pop-label">Mis plantillas</p>
              <div className="bd-pick-list short">
                {list.templates.map((t) => {
                  const on = t.id === board?.id;
                  return (
                    <button
                      type="button"
                      key={t.id}
                      className={"bd-pick-item" + (on ? " on" : "")}
                      title="Editar la plantilla"
                      onClick={() => pick(t.id)}
                    >
                      <i
                        className="tpl"
                        style={{ background: backgroundOf(t.background).css }}
                      >
                        <LayoutTemplate size={12} />
                      </i>
                      <span>{t.name}</span>
                      {on ? (
                        <Check size={15} />
                      ) : (
                        <Pencil size={13} className="bd-pick-go" />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="bd-pop-sep" />
          <button
            type="button"
            className="bd-pick-item bd-pick-new"
            onClick={() => {
              close();
              setGallery("blank");
            }}
          >
            <i className="new">
              <Plus size={14} />
            </i>
            <span>Nuevo tablero</span>
            <small>Plantillas</small>
          </button>
          <button
            type="button"
            className="bd-pick-item bd-pick-new"
            onClick={() => {
              close();
              setImporting(true);
            }}
          >
            <i className="new">
              <Trello size={13} />
            </i>
            <span>Importar de Trello</span>
            <small>JSON</small>
          </button>
        </Popover>
      )}

      {menu?.kind === "board" && board && (
        <Popover
          anchor={menu.anchor}
          width={286}
          label="Opciones del tablero"
          onClose={close}
        >
          <p className="bd-pop-label">Nombre</p>
          <form
            className="bd-pop-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(
                new FormData(e.currentTarget).get("name") ?? "",
              ).trim();
              if (name && name !== board.name)
                list.update(board.id, { name: name.slice(0, 120) });
              close();
            }}
          >
            <Pencil size={14} />
            <input
              name="name"
              defaultValue={board.name}
              maxLength={120}
              aria-label="Nombre del tablero"
            />
          </form>
          <p className="bd-pop-label">Fondo</p>
          <div className="bd-bgs">
            {backgrounds.map((b) => (
              <button
                type="button"
                key={b.key || "base"}
                title={b.label}
                aria-label={"Fondo " + b.label}
                aria-pressed={(board.background ?? "") === b.key}
                style={{ background: b.css }}
                onClick={() => list.update(board.id, { background: b.key })}
              >
                {(board.background ?? "") === b.key && <Check size={14} />}
              </button>
            ))}
          </div>
          <div className="bd-pop-sep" />
          {cols.some((c) => isFolded(c.id)) ? (
            <MenuItem
              icon={<UnfoldHorizontal size={15} />}
              onClick={() => {
                setFolded(
                  cols.map((c) => c.id),
                  false,
                );
                close();
              }}
            >
              Desplegar todas las columnas
            </MenuItem>
          ) : (
            <MenuItem
              icon={<FoldHorizontal size={15} />}
              disabled={!cols.length}
              onClick={() => {
                setComposer(null);
                setFolded(
                  cols.map((c) => c.id),
                  true,
                );
                close();
              }}
            >
              Plegar todas las columnas
            </MenuItem>
          )}
          <MenuItem
            icon={hideDone ? <Eye size={15} /> : <EyeOff size={15} />}
            onClick={() => {
              setHideDone((v) => !v);
              close();
            }}
          >
            {hideDone ? "Mostrar las completadas" : "Ocultar las completadas"}
          </MenuItem>
          {!editingTemplate && (
            <>
              <div className="bd-pop-sep" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={Boolean(board.settings.greeting)}
                className="bd-pop-item bd-pop-check"
                title="Nexo tendrá en cuenta lo que vence, lo prioritario y lo resaltado de este tablero al saludarte"
                onClick={() => {
                  const on = !board.settings.greeting;
                  list.update(board.id, {
                    settings: { ...board.settings, greeting: on },
                  });
                  notify(
                    on
                      ? `El saludo de Mi espacio tendrá en cuenta «${board.name.slice(0, 40)}».`
                      : `«${board.name.slice(0, 40)}» ya no aparece en el saludo.`,
                  );
                }}
              >
                <Sparkles size={15} />
                <span>
                  En el saludo de Mi espacio
                  <small className="bd-pop-sub">
                    Solo los tableros que elijas
                  </small>
                </span>
                <i className="bd-mini-switch" aria-hidden="true" />
              </button>
              <p className="bd-pop-label">
                <Hourglass size={11} /> Tarjetas que envejecen
              </p>
              <div className="bd-pop-chips" role="radiogroup">
                {(
                  [
                    [0, "No"],
                    [7, "1 semana"],
                    [14, "2 semanas"],
                    [30, "1 mes"],
                  ] as const
                ).map(([n, label]) => (
                  <button
                    type="button"
                    key={n}
                    role="radio"
                    aria-checked={(board.settings.aging ?? 0) === n}
                    className={(board.settings.aging ?? 0) === n ? "on" : ""}
                    onClick={() =>
                      list.update(board.id, {
                        settings: { ...board.settings, aging: n },
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="bd-pop-note">
                Las que pasan ese tiempo sin cambios se ven más apagadas.
              </p>
            </>
          )}
          {!editingTemplate && (
            <MenuItem
              icon={<Archive size={15} />}
              hint={list.archived ? String(list.archived) : undefined}
              onClick={openArchive}
            >
              Ver archivados
            </MenuItem>
          )}
          <div className="bd-pop-sep" />
          {editingTemplate ? (
            <MenuItem
              icon={<Plus size={15} />}
              onClick={() => (close(), setGallery("m:" + board.id))}
            >
              Crear tablero con esta plantilla
            </MenuItem>
          ) : (
            <MenuItem
              icon={<LayoutTemplate size={15} />}
              onClick={() => (close(), void saveAsTemplate())}
            >
              Guardar como plantilla
            </MenuItem>
          )}
          {!editingTemplate && !boardArchived && (
            <MenuItem
              icon={<Archive size={15} />}
              hint={progressTotal ? `${progressPct} %` : undefined}
              onClick={() => {
                close();
                if (!api.sync) return notify(missingSyncText);
                setClosing(true);
              }}
            >
              Cerrar y archivar tablero…
            </MenuItem>
          )}
          {!editingTemplate && (
            <>
              <MenuItem
                icon={<History size={15} />}
                onClick={() => {
                  close();
                  if (!api.sync) return notify(missingSyncText);
                  setHistory({});
                }}
              >
                Historial y métricas…
              </MenuItem>
              <MenuItem
                icon={<Link2 size={15} />}
                onClick={() => (close(), setSharing(true))}
              >
                Compartir con un cliente…
              </MenuItem>
            </>
          )}
          <MenuItem
            icon={<Trash2 size={15} />}
            danger
            onClick={() => (close(), void deleteBoard())}
          >
            {editingTemplate ? "Eliminar plantilla" : "Eliminar tablero"}
          </MenuItem>
        </Popover>
      )}

      {menu?.kind === "move" && moveCol && (
        <Popover
          anchor={menu.anchor}
          width={286}
          label="Mover a otro tablero"
          onClose={close}
        >
          <MoveColumnMenu
            column={moveCol}
            boards={otherBoards}
            onBack={() =>
              setMenu({ kind: "list", id: moveCol.id, anchor: menu.anchor })
            }
            onMove={(target, rank) => {
              close();
              moveToBoard(moveCol.id, target, rank);
            }}
          />
        </Popover>
      )}

      {menu?.kind === "list" && menuCol && (
        <Popover
          anchor={menu.anchor}
          label="Opciones de la columna"
          onClose={close}
        >
          <p className="bd-pop-title">{menuCol.name}</p>
          <MenuItem
            icon={<Plus size={15} />}
            onClick={() => (close(), setComposer(menuCol.id))}
          >
            Añadir tarjeta
          </MenuItem>
          <MenuItem
            icon={<Zap size={15} />}
            hint={
              menuCol.rules.rules.filter((r) => r.on).length
                ? String(menuCol.rules.rules.filter((r) => r.on).length)
                : hasRules(menuCol.rules)
                  ? "Sí"
                  : undefined
            }
            onClick={() => (close(), setRulesFor(menuCol.id))}
          >
            Reglas y automatizaciones
          </MenuItem>
          <MenuItem
            icon={<Pencil size={15} />}
            onClick={() => (close(), setRenaming(menuCol.id))}
          >
            Renombrar
          </MenuItem>
          <MenuItem
            icon={<FoldHorizontal size={15} />}
            onClick={() => {
              close();
              if (composer === menuCol.id) setComposer(null);
              setFolded([menuCol.id], true);
            }}
          >
            Plegar columna
          </MenuItem>
          <MenuItem
            icon={<FolderInput size={15} />}
            disabled={!otherBoards.length}
            hint={otherBoards.length ? undefined : "No hay otros"}
            onClick={() =>
              setMenu({ kind: "move", id: menuCol.id, anchor: menu.anchor })
            }
          >
            Mover a otro tablero
          </MenuItem>
          {editingTemplate ? null : list.pinned?.id === menuCol.id ? (
            <MenuItem
              icon={<PinOff size={15} />}
              onClick={() => {
                close();
                if (list.pin(null))
                  notify("La columna ya no está en Mi espacio.");
              }}
            >
              Desanclar de Mi espacio
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Pin size={15} />}
              disabled={Boolean(list.pinned)}
              hint={list.pinned ? "Ya hay una" : undefined}
              onClick={() => {
                close();
                if (
                  list.pin({
                    id: menuCol.id,
                    name: menuCol.name,
                    board_id: menuCol.board_id,
                  })
                )
                  notify(
                    `«${menuCol.name.slice(0, 40)}» quedó anclada en Mi espacio.`,
                  );
              }}
            >
              Anclar a Mi espacio
            </MenuItem>
          )}
          {!editingTemplate && list.pinned && list.pinned.id !== menuCol.id && (
            <p className="bd-pop-note">
              Anclada ahora: «{list.pinned.name}». Desánclala para anclar esta.
            </p>
          )}
          {!editingTemplate &&
            (docked?.list === menuCol.id ? (
              <MenuItem
                icon={<PictureInPicture2 size={15} />}
                onClick={() => {
                  close();
                  undock();
                  notify("La columna ya no está abajo a la derecha.");
                }}
              >
                Quitar de abajo a la derecha
              </MenuItem>
            ) : (
              <MenuItem
                icon={<PictureInPicture2 size={15} />}
                hint={docked ? "Reemplaza la actual" : undefined}
                onClick={() => {
                  close();
                  dockColumn({
                    list: menuCol.id,
                    board: menuCol.board_id,
                    name: menuCol.name,
                    color: menuCol.color,
                  });
                  notify(
                    `«${menuCol.name.slice(0, 40)}» queda abajo a la derecha, en todas las secciones.`,
                  );
                }}
              >
                Anclar abajo a la derecha
              </MenuItem>
            ))}
          <p className="bd-pop-label">Color</p>
          <div className="bd-tones">
            <button
              type="button"
              className={"none" + (!menuCol.color ? " on" : "")}
              title="Sin color"
              aria-label="Sin color"
              onClick={() => api.updateColumn(menuCol.id, { color: "" })}
            />
            {tones.map((t) => (
              <button
                type="button"
                key={t.key}
                className={menuCol.color === t.key ? "on" : ""}
                style={{ background: t.c }}
                title={t.label}
                aria-label={t.label}
                onClick={() => api.updateColumn(menuCol.id, { color: t.key })}
              />
            ))}
          </div>
          <div className="bd-pop-sep" />
          <MenuItem
            icon={<CalendarClock size={15} />}
            disabled={menuCards.length < 2}
            onClick={() => (close(), sortList(menuCol.id, "due"))}
          >
            Ordenar por fecha límite
          </MenuItem>
          <MenuItem
            icon={<ArrowDownAZ size={15} />}
            disabled={menuCards.length < 2}
            onClick={() => (close(), sortList(menuCol.id, "name"))}
          >
            Ordenar de la A a la Z
          </MenuItem>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={menuCol.rules.doneBelow}
            className="bd-pop-item bd-pop-check"
            title="Junta las completadas abajo, en un grupo que se despliega y se repliega"
            onClick={() =>
              api.updateColumn(menuCol.id, {
                rules: {
                  ...menuCol.rules,
                  doneBelow: !menuCol.rules.doneBelow,
                },
              })
            }
          >
            <ArrowDownToLine size={15} />
            <span>Completadas abajo</span>
            <i className="bd-pop-switch" aria-hidden="true" />
          </button>
          <MenuItem
            icon={<ArrowLeft size={15} />}
            disabled={menuIdx <= 0}
            onClick={() => (close(), api.moveColumn(menuCol.id, menuIdx - 1))}
          >
            Mover a la izquierda
          </MenuItem>
          <MenuItem
            icon={<ArrowRight size={15} />}
            disabled={menuIdx >= cols.length - 1}
            onClick={() => (close(), api.moveColumn(menuCol.id, menuIdx + 1))}
          >
            Mover a la derecha
          </MenuItem>
          <div className="bd-pop-sep" />
          <MenuItem
            icon={<Archive size={15} />}
            disabled={!menuDone}
            hint={menuDone ? String(menuDone) : undefined}
            onClick={() => (close(), archiveDone(menuCol.id))}
          >
            Archivar las completadas
          </MenuItem>
          <MenuItem
            icon={<Trash2 size={15} />}
            danger
            onClick={() => (close(), void deleteColumn(menuCol.id))}
          >
            Eliminar columna
          </MenuItem>
        </Popover>
      )}

      {menu?.kind === "snooze" && api.peek(menu.id) && (
        <Popover
          anchor={menu.anchor}
          width={260}
          label="Posponer"
          onClose={close}
        >
          <SnoozeMenu
            current={api.peek(menu.id)!.snoozed_until}
            onPick={(until) => {
              const id = menu.id;
              close();
              snoozeCards(
                selection.has(id) && picked.length > 1
                  ? picked.map((c) => c.id)
                  : [id],
                until,
              );
            }}
          />
        </Popover>
      )}

      {menu?.kind === "bulk" && picked.length > 0 && (
        <Popover
          anchor={menu.anchor}
          width={menu.what === "color" ? 236 : 250}
          label="Acción en grupo"
          onClose={close}
        >
          {menu.what === "move" && (
            <>
              <p className="bd-pop-label">Mover a</p>
              {cols.map((c) => {
                const t = toneOf(c.color);
                return (
                  <button
                    type="button"
                    key={c.id}
                    className="bd-pick-item"
                    onClick={() => (close(), bulkMove(c.id))}
                  >
                    <i
                      className="dot"
                      style={{ background: t?.c ?? "#c3cbc5" }}
                    />
                    <span>{c.name}</span>
                    <small>{byList.get(c.id)?.length ?? 0}</small>
                  </button>
                );
              })}
            </>
          )}
          {menu.what === "due" && (
            <>
              <p className="bd-pop-label">Fecha límite</p>
              {(
                [
                  ["Hoy", today],
                  ["Mañana", addDays(today, 1)],
                  ["El lunes", nextMonday(today)],
                  ["En 7 días", addDays(today, 7)],
                ] as const
              ).map(([label, d]) => (
                <button
                  type="button"
                  key={label}
                  className="bd-pick-item"
                  onClick={() => {
                    close();
                    bulkPatch(`Fecha: ${label.toLowerCase()}`, (c) =>
                      c.due === d ? null : { due: d },
                    );
                  }}
                >
                  <CalendarClock size={14} className="bd-pick-lead" />
                  <span>{label}</span>
                  <small>{friendlyDate(d, today)}</small>
                </button>
              ))}
              <label className="bd-snz-date">
                <span>Otra fecha</span>
                <input
                  type="date"
                  onChange={(e) => {
                    const d = e.target.value;
                    if (!d) return;
                    close();
                    bulkPatch(`Fecha: ${friendlyDate(d).toLowerCase()}`, (c) =>
                      c.due === d ? null : { due: d },
                    );
                  }}
                />
              </label>
              <div className="bd-pop-sep" />
              <button
                type="button"
                className="bd-pick-item"
                onClick={() => {
                  close();
                  bulkPatch("Sin fecha", (c) =>
                    c.due
                      ? { due: null, ...(c.repeat && { repeat: "" as const }) }
                      : null,
                  );
                }}
              >
                <X size={14} className="bd-pick-lead" />
                <span>Quitar la fecha</span>
              </button>
            </>
          )}
          {menu.what === "prio" && (
            <>
              <p className="bd-pop-label">Prioridad</p>
              {([...PRIORITIES, ""] as Priority[]).map((p) => (
                <button
                  type="button"
                  key={p || "none"}
                  className="bd-pick-item"
                  onClick={() => {
                    close();
                    bulkPatch(
                      p
                        ? `Prioridad ${priorityLabels[p].toLowerCase()}`
                        : "Sin prioridad",
                      (c) => (c.priority === p ? null : { priority: p }),
                    );
                  }}
                >
                  <Flag
                    size={14}
                    className={"bd-pick-lead bd-prio-ico " + (p || "none")}
                  />
                  <span>{priorityLabels[p]}</span>
                </button>
              ))}
            </>
          )}
          {menu.what === "tag" && (
            <BulkTags
              tags={boardTags}
              picked={picked}
              onAdd={(t) => {
                close();
                bulkPatch(`Etiqueta «${t}»`, (c) =>
                  c.tags.some((x) => normalizeText(x) === normalizeText(t))
                    ? null
                    : { tags: [...c.tags, t] },
                );
              }}
              onRemove={(t) => {
                close();
                bulkPatch(`Sin «${t}»`, (c) =>
                  c.tags.some((x) => normalizeText(x) === normalizeText(t))
                    ? {
                        tags: c.tags.filter(
                          (x) => normalizeText(x) !== normalizeText(t),
                        ),
                      }
                    : null,
                );
              }}
            />
          )}
          {menu.what === "color" && (
            <>
              <p className="bd-pop-label">Color</p>
              <div className="bd-tones">
                <button
                  type="button"
                  className="none"
                  title="Sin color"
                  aria-label="Sin color"
                  onClick={() => {
                    close();
                    bulkPatch("Sin color", (c) =>
                      c.color ? { color: "" } : null,
                    );
                  }}
                />
                {tones.map((t) => (
                  <button
                    type="button"
                    key={t.key}
                    style={{ background: t.c }}
                    title={t.label}
                    aria-label={t.label}
                    onClick={() => {
                      close();
                      bulkPatch(`Color ${t.label.toLowerCase()}`, (c) =>
                        c.color === t.key ? null : { color: t.key },
                      );
                    }}
                  />
                ))}
              </div>
            </>
          )}
          {menu.what === "snooze" && (
            <SnoozeMenu
              onPick={(until) => {
                close();
                snoozeCards(
                  picked.map((c) => c.id),
                  until,
                );
              }}
            />
          )}
        </Popover>
      )}

      {picked.length > 0 &&
        !inArchive &&
        createPortal(
          <div
            className={"bd-bulk" + (bg.dark ? " on-dark" : "")}
            role="toolbar"
            aria-label="Acciones con las seleccionadas"
          >
            <span className="bd-bulk-count">
              <b>{picked.length}</b>{" "}
              {picked.length === 1 ? "seleccionada" : "seleccionadas"}
            </span>
            <i className="bd-bulk-sep" />
            <button type="button" onClick={bulkDone}>
              {picked.every(isDone) ? (
                <RotateCcw size={15} />
              ) : (
                <Check size={15} />
              )}
              <span>{picked.every(isDone) ? "Reabrir" : "Completar"}</span>
            </button>
            {(
              [
                ["move", <FolderInput size={15} key="i" />, "Mover"],
                ["due", <CalendarClock size={15} key="i" />, "Fecha"],
                ["prio", <Flag size={15} key="i" />, "Prioridad"],
                ["tag", <Tag size={15} key="i" />, "Etiqueta"],
                ["color", <Palette size={15} key="i" />, "Color"],
                ["snooze", <AlarmClock size={15} key="i" />, "Posponer"],
              ] as const
            ).map(([what, icon, label]) => (
              <button
                type="button"
                key={what}
                aria-haspopup="menu"
                aria-expanded={menu?.kind === "bulk" && menu.what === what}
                disabled={!api.power && (what === "prio" || what === "snooze")}
                onClick={(e) =>
                  setMenu({
                    kind: "bulk",
                    what,
                    anchor: e.currentTarget.getBoundingClientRect(),
                  })
                }
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
            <button
              type="button"
              disabled={!api.power}
              title={
                picked.every((c) => c.highlight)
                  ? "Quitar el resaltado"
                  : "Resaltar"
              }
              onClick={() => {
                const on = !picked.every((c) => c.highlight);
                bulkPatch(on ? "Resaltadas" : "Sin resaltar", (c) =>
                  c.highlight === on ? null : { highlight: on },
                );
              }}
            >
              <Highlighter size={15} />
              <span>Resaltar</span>
            </button>
            <i className="bd-bulk-sep" />
            <button type="button" title="Archivar" onClick={bulkArchive}>
              <Archive size={15} />
            </button>
            <button
              type="button"
              className="danger"
              title="Eliminar"
              onClick={bulkDelete}
            >
              <Trash2 size={15} />
            </button>
            <button
              type="button"
              className="bd-bulk-x"
              title="Deseleccionar (Esc)"
              aria-label="Deseleccionar"
              onClick={clearSelection}
            >
              <X size={15} />
            </button>
          </div>,
          document.body,
        )}

      {rulesFor &&
        (() => {
          const col = cols.find((c) => c.id === rulesFor);
          if (!col) return null;
          return (
            <RulesEditor
              key={col.id}
              column={col}
              columns={cols}
              cards={(byList.get(col.id) ?? []).filter(
                (c) => !isDivider(c.title),
              )}
              tags={boardTags}
              power={api.power}
              ctx={ruleCtx}
              onSave={(rules) => {
                api.updateColumn(col.id, { rules });
                // El servidor corre las reglas «a una hora» en la zona horaria de quien las crea.
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                if (board && !editingTemplate && tz && board.settings.tz !== tz)
                  list.update(board.id, {
                    settings: { ...board.settings, tz },
                  });
              }}
              onRunNow={(rule) => runRuleNow(rule, col.id)}
              onClose={() => setRulesFor(null)}
            />
          );
        })()}

      {gallery !== null && (
        <TemplateGallery
          list={list}
          initial={gallery}
          onCreated={(id) => pick(id)}
          onEdit={(id) => pick(id)}
          onClose={() => setGallery(null)}
        />
      )}

      {importing && (
        <TrelloImport
          list={list}
          onDone={(id, count) => {
            setImporting(false);
            pick(id);
            notify(
              count === 1
                ? "Tablero importado de Trello."
                : `${count} tableros importados de Trello.`,
            );
          }}
          onClose={() => setImporting(false)}
        />
      )}

      {openCard && (
        <CardEditor
          key={openCard.id}
          card={openCard}
          columns={inArchive ? [] : cols}
          done={isDone(openCard)}
          extras={inArchive || api.extras}
          power={api.power}
          sync={inArchive ? "updated_at" in openCard : api.sync}
          aging={aging}
          links={inArchive ? undefined : links}
          boardCards={inArchive ? undefined : realCards}
          isDoneId={(id) => {
            const c = api.peek(id);
            return c ? isDone(c) : true;
          }}
          onPeopleAdded={(ids) => {
            if (inArchive || !ids.length) return;
            const c = api.peek(openCard.id);
            if (c)
              fire([
                { type: "person", card: c.id, list: c.list_id, people: ids },
              ]);
          }}
          onHistory={
            inArchive || !api.sync
              ? undefined
              : () => setHistory({ card: openCard.id })
          }
          onPatch={patchOpen}
          onToggleDone={() => void toggleDone(openCard, patchOpen)}
          onArchive={() =>
            inArchive ? unarchive(openCard) : archiveCard(openCard)
          }
          onDelete={() => {
            setOpenId(null);
            if (inArchive) deleteArchived(openCard);
            else deleteCard(openCard);
          }}
          onClose={() => setOpenId(null)}
        />
      )}

      {triage && board && (
        <OverdueTriage
          cards={overdue}
          columns={cols}
          today={today}
          load={loadOn}
          canDrop={api.extras}
          onSet={(c, due) => {
            const now = api.peek(c.id);
            return now ? patchBack(now, { due }) : () => {};
          }}
          onDrop={(c) => {
            const now = api.peek(c.id);
            return now ? triageDrop(now) : () => {};
          }}
          onSpread={(plan) => {
            const undos = plan
              .map((p) => {
                const now = api.peek(p.card.id);
                return now ? patchBack(now, { due: p.due }) : null;
              })
              .filter((u): u is () => void => Boolean(u));
            return () => undos.forEach((u) => u());
          }}
          onOpen={(c) => {
            setTriage(false);
            setOpenId(c.id);
          }}
          onClose={() => setTriage(false)}
        />
      )}

      {closing && board && (
        <BoardClosingDialog
          board={board}
          stats={closingStats()}
          onArchive={(data, learn, episode) =>
            void archiveBoard(data, learn, episode)
          }
          onClose={() => setClosing(false)}
        />
      )}

      {history && board && (
        <BoardHistory
          boardId={board.id}
          cardId={history.card}
          cards={api.peekAll()}
          columns={cols}
          steps={undo.steps}
          onUndoTo={undo.undoTo}
          onOpen={(id) => {
            setHistory(null);
            setOpenId(id);
          }}
          onRevert={(id, fields) => {
            const c = api.peek(id);
            if (!c) return;
            // Volver atrás no dispara reglas ni cuenta como completar: solo devuelve los campos.
            const { list_id, ...rest } = fields;
            const backToList =
              list_id && list_id !== c.list_id && api.peekColumn(list_id)
                ? list_id
                : null;
            const undoFields = Object.keys(rest).length
              ? patchBack(c, rest)
              : () => {};
            if (backToList) api.moveCard(id, backToList, Infinity);
            notify("Cambio revertido.", {
              label: "Deshacer",
              icon: "undo",
              run: () => {
                undoFields();
                if (backToList && api.peek(id))
                  api.moveCard(id, c.list_id, Infinity);
              },
            });
          }}
          onClose={() => setHistory(null)}
        />
      )}

      {sharing && board && !editingTemplate && (
        <ShareBoardDialog board={board} onClose={() => setSharing(false)} />
      )}
    </section>
  );
}

/** Etiqueta para las seleccionadas: escribir una nueva, elegir una del tablero o quitar una que tengan. */
function BulkTags({
  tags,
  picked,
  onAdd,
  onRemove,
}: {
  tags: string[];
  picked: BoardCard[];
  onAdd: (t: string) => void;
  onRemove: (t: string) => void;
}) {
  const [text, setText] = useState("");
  const theirs = [
    ...new Map(
      picked.flatMap((c) => c.tags).map((t) => [normalizeText(t), t]),
    ).values(),
  ];
  const q = normalizeText(text.trim());
  const shown = tags
    .filter((t) => !q || normalizeText(t).includes(q))
    .slice(0, 8);
  return (
    <>
      <p className="bd-pop-label">Añadir etiqueta</p>
      <form
        className="bd-pop-form"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.replace(/^#/, "").trim();
          if (t) onAdd(t.slice(0, 40));
        }}
      >
        <Tag size={14} />
        <input
          autoFocus
          value={text}
          maxLength={40}
          placeholder="Nueva o existente…"
          aria-label="Etiqueta"
          onChange={(e) => setText(e.target.value)}
        />
      </form>
      <div className="bd-pop-tags">
        {shown.map((t) => {
          const tone = tagTone(t);
          return (
            <button
              type="button"
              key={t}
              style={{ "--tc": tone.c, "--ts": tone.s } as CSSProperties}
              onClick={() => onAdd(t)}
            >
              {t}
            </button>
          );
        })}
      </div>
      {theirs.length > 0 && (
        <>
          <p className="bd-pop-label">Quitar</p>
          <div className="bd-pop-tags remove">
            {theirs.map((t) => (
              <button type="button" key={t} onClick={() => onRemove(t)}>
                {t} <X size={11} />
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Renombrar en el sitio: Enter o salir guarda, Esc cancela. */
function TitleInput({
  value,
  onDone,
  onCancel,
}: {
  value: string;
  onDone: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const end = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onDone(v.replace(/\s+/g, " ").trim());
    else onCancel();
  };
  return (
    <input
      className="bd-list-input"
      autoFocus
      value={v}
      maxLength={120}
      aria-label="Nombre de la columna"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => end(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          end(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          end(false);
        }
      }}
    />
  );
}

/** Lo pegado con varias líneas, a la espera de que elijas cómo añadirlo. */
type Pending = { text: string; lines: string[] };
/** Viñetas de lista al inicio de una línea («- », «• », «1. », «[ ] »). «---» no cuenta. */
const BULLET =
  /^\s*(?:[-*•·▪◦□■☐✓✔]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?|^\s*\[[ xX]\]\s+/;
const linesOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(BULLET, "").trim())
    .filter(Boolean);

/**
 * Añadir tarjetas escribiendo: Enter añade y deja el campo listo para la siguiente. Si pegas un
 * texto con varias líneas, pregunta si son varias tarjetas (una por línea) o una sola. Escritura
 * rápida: #etiqueta, @persona, !prioridad y **resaltada**, con sugerencias mientras escribes.
 */
function Composer({
  people,
  tags,
  templates,
  onAdd,
  onTemplate,
  onClose,
}: {
  people: Person[];
  tags: string[];
  /** Plantillas de tarjeta que se invocan con /nombre. */
  templates: CardTemplate[];
  onAdd: (items: NewCardInput[]) => void;
  /** Una tarjeta desde una plantilla («/reunion Equipo de diseño»). */
  onTemplate: (title: string, template: CardTemplate) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [caret, setCaret] = useState(0);
  const [pickIdx, setPickIdx] = useState(0);
  const [noSuggest, setNoSuggest] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ text, pending, onClose });
  latest.current = { text, pending, onClose };
  useEffect(() => {
    form.current?.scrollIntoView({ block: "nearest" });
    // Un clic fuera con el campo vacío lo cierra (con texto o algo pegado, lo deja por si vuelves).
    const down = (e: PointerEvent) => {
      const { text, pending, onClose } = latest.current;
      if (!form.current?.contains(e.target as Node) && !text.trim() && !pending)
        onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []);
  useEffect(() => {
    if (pending)
      requestAnimationFrame(() =>
        form.current?.scrollIntoView({ block: "nearest" }),
      );
  }, [pending]);

  const lines = text.split("\n").filter((l) => l.trim()).length;
  // Sugerencias para la @, el # o la /plantilla que estás escribiendo.
  const slash = pending || noSuggest ? null : slashAt(text, caret);
  const token =
    pending || noSuggest
      ? null
      : (tokenAt(text, caret) ??
        (slash
          ? { kind: "/" as const, query: slash.query, start: slash.start }
          : null));
  type Suggest = {
    key: string;
    label: string;
    insert: string;
    person?: Person;
    slash?: boolean;
  };
  const suggestions = useMemo<Suggest[]>(() => {
    if (!token) return [];
    const q = normalizeText(token.query);
    if (token.kind === "/")
      return templates
        .filter((t) => !q || t.slug.startsWith(q) || normalizeText(t.name).startsWith(q))
        .slice(0, 6)
        .map((t) => ({
          key: "/" + t.slug,
          label: t.name,
          insert: "/" + t.slug,
          person: undefined,
          slash: true,
        }));
    if (token.kind === "@") {
      const starts = (p: Person) =>
        normalizeText(p.name)
          .split(/\s+/)
          .some((w) => w.startsWith(q)) ||
        normalizeText(p.profile.alias ?? "").startsWith(q);
      return people
        .filter((p) => !q || starts(p))
        .sort(
          (a, b) =>
            Number(Boolean(b.profile.favorite)) -
              Number(Boolean(a.profile.favorite)) ||
            a.name.localeCompare(b.name, "es"),
        )
        .slice(0, 6)
        .map((p) => ({
          key: p.id,
          label: p.name,
          insert: "@" + p.name,
          person: p,
        }));
    }
    return tags
      .filter((t) => normalizeText(t).startsWith(q) && normalizeText(t) !== q)
      .slice(0, 6)
      .map((t) => ({ key: t, label: t, insert: "#" + t, person: undefined }));
  }, [token?.kind, token?.query, people, tags]);
  const choose = (s: (typeof suggestions)[number]) => {
    if (!token) return;
    const next =
      text.slice(0, token.start) + s.insert + " " + text.slice(caret);
    const at = token.start + s.insert.length + 1;
    setText(next);
    setPickIdx(0);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  };
  // Lo que entenderá de la escritura rápida (con una sola tarjeta).
  const quick =
    !pending && lines === 1 ? parseQuick(text.trim(), people) : null;
  const preview = quick && hasQuick(quick) ? quick : null;

  const done = () => {
    setText("");
    setPending(null);
    setCaret(0);
    requestAnimationFrame(() => {
      area.current?.focus();
      form.current?.scrollIntoView({ block: "nearest" });
    });
  };
  const submit = () => {
    const titles = text
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!titles.length) return;
    // «/reunion Equipo de diseño»: la tarjeta nace con lo que trae la plantilla.
    const plain: string[] = [];
    for (const t of titles) {
      const hit = t.includes("/") ? takeSlash(t, templates) : null;
      if (!hit) {
        plain.push(t);
        continue;
      }
      if (plain.length) onAdd(plain.splice(0));
      onTemplate(hit.rest, hit.template);
    }
    if (plain.length) onAdd(plain);
    done();
  };

  // ── Lo pegado ──
  const asMany = () => {
    if (!pending) return;
    onAdd(pending.lines);
    done();
  };
  /** Una sola: la primera línea es el título y el resto, la descripción. */
  const asOne = () => {
    if (!pending) return;
    const all = pending.text.replace(/\r\n?/g, "\n").trim();
    const [first, ...rest] = all.split("\n");
    const body = rest
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    onAdd([{ title: first, body }]);
    done();
  };
  /** Pegarlo tal cual en el campo, para editarlo antes. */
  const asText = () => {
    if (!pending) return;
    const value = pending.text.replace(/\r\n?/g, "\n");
    setText(value);
    setPending(null);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
    });
  };
  const dismiss = () => {
    setPending(null);
    requestAnimationFrame(() => area.current?.focus());
  };

  const many = pending ? pending.lines.length : 0;
  return (
    <form
      ref={form}
      className={"bd-composer" + (pending ? " asking" : "")}
      data-flip="c:composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={area}
        autoFocus
        rows={2}
        value={text}
        readOnly={Boolean(pending)}
        placeholder="Escribe un título para esta tarjeta…"
        aria-label="Título de la tarjeta nueva"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setPickIdx(0);
          setNoSuggest(false);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onPaste={(e) => {
          const clip = e.clipboardData.getData("text");
          if (!/\r?\n/.test(clip.trim())) return;
          const el = e.currentTarget;
          const merged =
            text.slice(0, el.selectionStart) +
            clip +
            text.slice(el.selectionEnd);
          const found = linesOf(merged);
          if (found.length < 2) return;
          e.preventDefault();
          setPending({ text: merged, lines: found });
        }}
        onKeyDown={(e) => {
          if (suggestions.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setPickIdx(
                (i) => (i + step + suggestions.length) % suggestions.length,
              );
              return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault();
              choose(suggestions[Math.min(pickIdx, suggestions.length - 1)]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setNoSuggest(true);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />

      {suggestions.length > 0 && (
        <ul className="bd-suggest" role="listbox" aria-label="Sugerencias">
          {suggestions.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                role="option"
                aria-selected={i === pickIdx}
                className={i === pickIdx ? "on" : ""}
                onPointerDown={(e) => e.preventDefault()}
                onMouseMove={() => i !== pickIdx && setPickIdx(i)}
                onClick={() => choose(s)}
              >
                {s.person ? (
                  <Avatar person={s.person} size={20} />
                ) : s.slash ? (
                  <i className="bd-suggest-slash" aria-hidden="true">
                    /
                  </i>
                ) : (
                  <i
                    className="bd-suggest-tag"
                    style={{ background: tagTone(s.label).c }}
                  />
                )}
                <span>{s.label}</span>
                {i === pickIdx && <kbd>Tab</kbd>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="bd-quick" aria-live="polite">
          {preview.highlight && (
            <span className="bd-quick-chip hl">
              <Highlighter size={11} /> Resaltada
            </span>
          )}
          {preview.priority && (
            <span className={"bd-quick-chip bd-prio " + preview.priority}>
              <Flag size={11} /> {priorityLabels[preview.priority]}
            </span>
          )}
          {preview.tags.map((t) => {
            const tone = tagTone(t);
            return (
              <span
                key={t}
                className="bd-quick-chip tag"
                style={{ "--tc": tone.c, "--ts": tone.s } as CSSProperties}
              >
                #{t}
              </span>
            );
          })}
          {preview.people.map((id) => {
            const p = people.find((x) => x.id === id);
            return p ? (
              <span key={id} className="bd-quick-chip person">
                <Avatar person={p} size={16} /> {p.name.split(" ")[0]}
              </span>
            ) : null;
          })}
          {preview.unknown.map((u) => (
            <span
              key={u}
              className="bd-quick-chip unknown"
              title="No hay nadie con ese nombre en tu gente"
            >
              @{u}?
            </span>
          ))}
        </div>
      )}

      {pending ? (
        <div
          className="bd-paste"
          role="dialog"
          aria-label="¿Cómo añado lo que pegaste?"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            dismiss();
          }}
        >
          <header className="bd-paste-head">
            <span className="bd-paste-icon" aria-hidden="true">
              <ClipboardPaste size={14} />
            </span>
            <span>
              <b>Pegaste {pending.lines.length} líneas</b>
              <small>¿Cómo las añado?</small>
            </span>
            <button
              type="button"
              className="bd-paste-x"
              aria-label="Cancelar"
              onClick={dismiss}
            >
              <X size={14} />
            </button>
          </header>

          <ol className="bd-paste-preview">
            {pending.lines.slice(0, 3).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
            {pending.lines.length > 3 && (
              <li className="more">y {pending.lines.length - 3} más</li>
            )}
          </ol>

          <button
            type="button"
            className="bd-paste-opt primary"
            autoFocus
            onClick={asMany}
          >
            <SquareStack size={16} />
            <span>
              <b>
                {many} {many === 1 ? "tarjeta" : "tarjetas"}
              </b>
              <small>Una por línea</small>
            </span>
            <kbd>Enter</kbd>
          </button>
          <button type="button" className="bd-paste-opt" onClick={asOne}>
            <RectangleHorizontal size={16} />
            <span>
              <b>Una sola tarjeta</b>
              <small>
                La primera línea es el título; el resto, la descripción
              </small>
            </span>
          </button>
          <button type="button" className="bd-paste-text" onClick={asText}>
            <TextCursorInput size={13} /> Pegar como texto para editarlo
          </button>
        </div>
      ) : (
        <div className="bd-composer-foot">
          <button type="submit" className="bd-btn primary" disabled={!lines}>
            {lines > 1 ? `Añadir ${lines} tarjetas` : "Añadir tarjeta"}
          </button>
          <button
            type="button"
            className="bd-icon"
            aria-label="Cancelar"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      )}
    </form>
  );
}

/** Columna nueva en el sitio (donde hiciste doble clic o al final). */
function NewColumn({
  onAdd,
  onClose,
}: {
  onAdd: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const box = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ name, onClose });
  latest.current = { name, onClose };
  useEffect(() => {
    box.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
    const down = (e: PointerEvent) => {
      if (
        !box.current?.contains(e.target as Node) &&
        !latest.current.name.trim()
      )
        latest.current.onClose();
    };
    // Tras el doble clic que la creó.
    const t = window.setTimeout(
      () => document.addEventListener("pointerdown", down, true),
      50,
    );
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", down, true);
    };
  }, []);
  const submit = () => {
    const n = name.replace(/\s+/g, " ").trim();
    if (!n) return;
    onAdd(n);
    setName("");
    input.current?.focus();
  };
  return (
    <form
      ref={box}
      className="bd-newlist"
      data-flip="l:new"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        ref={input}
        autoFocus
        value={name}
        maxLength={120}
        placeholder="Nombre de la columna…"
        aria-label="Nombre de la columna nueva"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <div className="bd-composer-foot">
        <button
          type="submit"
          className="bd-btn primary"
          disabled={!name.trim()}
        >
          Añadir columna
        </button>
        <button
          type="button"
          className="bd-icon"
          aria-label="Cancelar"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
    </form>
  );
}

/** Sin tableros: el primero, en blanco o desde una plantilla. */
function Welcome({
  onCreate,
  onTemplates,
  onImport,
}: {
  onCreate: (name: string) => Promise<void>;
  /** Abre la galería de plantillas (con una preseleccionada). */
  onTemplates: (key: string) => void;
  /** Abre el importador de Trello. */
  onImport: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = (n: string) => {
    if (!n.trim() || busy) return;
    setBusy(true);
    void onCreate(n.trim().slice(0, 120)).finally(() => setBusy(false));
  };
  return (
    <div className="bd-welcome">
      <span className="bd-welcome-mark" aria-hidden="true">
        <Columns3 size={26} />
      </span>
      <h2>Organiza lo que tienes entre manos</h2>
      <p>
        Un tablero reúne columnas y tarjetas: ideas, proyectos, producciones…
        Empieza en blanco o con una plantilla lista.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create(name);
        }}
      >
        <input
          autoFocus
          value={name}
          maxLength={120}
          placeholder="Nombre del tablero"
          aria-label="Nombre del tablero"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          className="bd-btn primary"
          disabled={busy || !name.trim()}
        >
          <Plus size={16} /> Crear en blanco
        </button>
      </form>
      <div className="bd-welcome-tpl">
        <small>O empieza con una plantilla</small>
        <div>
          {builtinTemplates.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => onTemplates("b:" + t.id)}
            >
              <i style={{ background: backgroundOf(t.spec.background).css }} />
              {t.name}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="bd-welcome-import" onClick={onImport}>
        <Trello size={14} /> ¿Vienes de Trello? Importa tus tableros
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="bd-canvas bd-skel" aria-hidden="true">
      {[5, 3, 4].map((n, i) => (
        <div key={i} className="bd-list">
          <i className="bd-skel-head" />
          {Array.from({ length: n }, (_, j) => (
            <i key={j} className="bd-skel-card" />
          ))}
        </div>
      ))}
    </div>
  );
}
