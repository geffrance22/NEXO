import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Calendar, Check, CheckSquare, ChevronUp, Minus, Plus, Repeat, X } from "lucide-react";
import { useApp } from "../AppContext";
import { supabase } from "../backend";
import { friendlyDate } from "../lib/format";
import { queueTrigger } from "./boardFeed";
import { dateInTitle } from "./boardDates";
import { isRepeat, nextDue } from "./boardRepeat";
import { BOARDS_CHANGED } from "./boardStore";
import { dueState, isDivider, toneOf } from "./boardTheme";
import { aimBoard } from "./boardView";
import { plainMarks } from "./cardMarks";
import {
  dockColumn,
  DOCK_WROTE,
  setDockOpen,
  touchDock,
  undock,
  useDock,
  type DockedColumn,
} from "./dockStore";
import type { Check as CheckItem } from "./shared";
import "./dock.css";

type Row = {
  id: string;
  title: string;
  rank: number;
  done?: boolean;
  due: string | null;
  checks: CheckItem[];
  entry_id: string | null;
  repeat?: string;
};

/** La columna en su ventanita, en todas las secciones. */
export function ColumnDock() {
  const dock = useDock();
  if (!dock) return null;
  return <DockWindow key={dock.list} dock={dock} />;
}

function DockWindow({ dock }: { dock: DockedColumn }) {
  const { workspace, toggleEntry, patchEntry, notify, go } = useApp();
  const [cards, setCards] = useState<Row[] | null>(null);
  const [boardName, setBoardName] = useState("");
  const [extras, setExtras] = useState(true);
  const [draft, setDraft] = useState("");
  const [shift, setShift] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  const load = useCallback(async () => {
    const me = ++run.current;
    const c = await supabase
      .from("board_lists")
      .select("*, boards(name)")
      .eq("id", dock.list)
      .maybeSingle();
    if (me !== run.current) return;
    if (c.error) return;
    if (!c.data) {
      // La columna se borró: la ventanita se va con ella.
      undock();
      notify(`La columna «${dock.name.slice(0, 40)}» ya no existe: se cerró su ventana.`);
      return;
    }
    const col = c.data as {
      name: string;
      board_id: string;
      color?: string;
      boards?: { name: string } | null;
    };
    setBoardName(col.boards?.name ?? "");
    touchDock(dock.list, { name: col.name, color: col.color ?? "", board: col.board_id });
    const query = (cols: string, archived = true) => {
      let q = supabase.from("board_cards").select(cols).eq("list_id", dock.list);
      if (archived) q = q.is("archived_at", null);
      return q.order("rank").order("id").limit(500);
    };
    let rows = await query("id,title,rank,done,due,checks,entry_id,repeat");
    // Sin la migración 016: sin repetir.
    if (rows.error) rows = await query("id,title,rank,done,due,checks,entry_id");
    let full = true;
    if (rows.error) {
      // Sin la migración 014: sin completadas ni archivadas.
      full = false;
      rows = await query("id,title,rank,due,checks,entry_id", false);
    }
    if (me !== run.current || rows.error) return;
    setExtras(full);
    setCards(
      ((rows.data ?? []) as unknown as Row[])
        .filter((r) => !isDivider(r.title))
        .map((r) => ({ ...r, checks: Array.isArray(r.checks) ? r.checks : [] })),
    );
  }, [dock.list]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al abrir, al volver a la pestaña, cuando cambias algo en Tableros y en tiempo real.
  useEffect(() => {
    void load();
    let soon = 0;
    const later = () => {
      window.clearTimeout(soon);
      soon = window.setTimeout(() => void load(), 700);
    };
    const onBack = () => document.visibilityState === "visible" && later();
    window.addEventListener(BOARDS_CHANGED, later);
    window.addEventListener("focus", later);
    document.addEventListener("visibilitychange", onBack);
    const channel = supabase
      .channel(`dock-${dock.list}-${crypto.randomUUID().slice(0, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "board_cards", filter: `list_id=eq.${dock.list}` },
        later,
      )
      .subscribe();
    return () => {
      window.clearTimeout(soon);
      window.removeEventListener(BOARDS_CHANGED, later);
      window.removeEventListener("focus", later);
      document.removeEventListener("visibilitychange", onBack);
      void supabase.removeChannel(channel);
    };
  }, [load, dock.list]);

  // Junto a la esquina de capturas (subidas, «Guardar captura»), nunca encima.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".cap-corner");
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setShift(w > 1 && window.innerWidth > 720 ? Math.round(w) + 12 : 0);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const tasks = useMemo(() => new Map(workspace.entries.map((e) => [e.id, e])), [workspace.entries]);
  /** Con un pendiente vinculado, su estado manda (como en Tableros). */
  const isDone = (c: Row) => {
    const task = tasks.get(c.entry_id ?? "");
    return task ? task.status === "completado" : Boolean(c.done);
  };
  const wrote = () => {
    window.dispatchEvent(new CustomEvent(DOCK_WROTE, { detail: dock.list }));
    window.dispatchEvent(new Event(BOARDS_CHANGED));
  };
  const save = (id: string, changes: Record<string, unknown>, undo?: () => void) =>
    void supabase
      .from("board_cards")
      .update(changes)
      .eq("id", id)
      .then(({ error }) => {
        if (!error) return wrote();
        undo?.();
        notify("No se pudo guardar: " + error.message);
      });

  const toggle = (c: Row) => {
    const next = !isDone(c);
    const task = tasks.get(c.entry_id ?? "");
    // Se repite: vuelve abierta con la fecha siguiente y la lista limpia.
    if (next && c.repeat && isRepeat(c.repeat)) {
      const due = nextDue(c.repeat, c.due) ?? c.due;
      const checks = c.checks.map((x) => ({ ...x, done: false }));
      setCards((v) => v?.map((x) => (x.id === c.id ? { ...x, due, checks } : x)) ?? v);
      if (task)
        void patchEntry(task, { status: "pendiente", details: { ...task.details, ...(due && { due }) } });
      save(c.id, { due, checks, done: false, done_at: null });
      notify(`Hecho. Se repite: vuelve ${due ? friendlyDate(due).toLowerCase() : "abierta"}.`);
      return;
    }
    if (task && (task.status === "completado") !== next) toggleEntry(task);
    if (!extras) return;
    queueTrigger({ card: c.id, list: dock.list, trigger: next ? "done" : "undone" });
    setCards((v) => v?.map((x) => (x.id === c.id ? { ...x, done: next } : x)) ?? v);
    save(c.id, { done: next, done_at: next ? new Date().toISOString() : null }, () =>
      setCards((v) => v?.map((x) => (x.id === c.id ? { ...x, done: !next } : x)) ?? v),
    );
  };

  const add = () => {
    const raw = draft.trim();
    if (!raw || !cards) return;
    // «Llamar al banco el viernes»: la fecha sale sola del título, como en Tableros.
    const when = dateInTitle(raw);
    const row: Row = {
      id: crypto.randomUUID(),
      title: (when?.title ?? raw).slice(0, 2000),
      rank: (cards.reduce((m, c) => Math.max(m, c.rank), 0) || 0) + 1024,
      due: when?.due ?? null,
      checks: [],
      entry_id: null,
      done: false,
    };
    setDraft("");
    setCards((v) => [...(v ?? []), row]);
    requestAnimationFrame(() =>
      list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }),
    );
    void supabase
      .from("board_cards")
      .insert({ id: row.id, list_id: dock.list, title: row.title, rank: row.rank, ...(row.due && { due: row.due }) })
      .then(({ error }) => {
        if (!error) return wrote();
        setCards((v) => v?.filter((x) => x.id !== row.id) ?? v);
        setDraft(raw);
        notify("No se pudo añadir: " + error.message);
      });
  };

  const toBoard = (card?: string) => {
    aimBoard(dock.board, dock.list, card);
    go("Tableros");
  };
  const close = () => {
    const before = dock;
    undock();
    notify("Ventana cerrada.", { label: "Deshacer", icon: "undo", run: () => dockColumn(before) });
  };
  const toggleOpen = () => {
    setDockOpen(!dock.open);
    if (!dock.open) requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
  };

  const all = cards ?? [];
  const open = all.filter((c) => !isDone(c));
  const done = all.filter((c) => isDone(c));
  const tone = toneOf(dock.color);

  return (
    <aside
      className={"cdock" + (dock.open ? " open" : "")}
      style={{ "--dc": tone?.c ?? "#2f6b55", "--shift": shift + "px" } as CSSProperties}
      aria-label={`Columna ${dock.name}`}
    >
      <header className="cdock-head">
        <button
          type="button"
          className="cdock-toggle"
          aria-expanded={dock.open}
          title={dock.open ? "Minimizar" : "Abrir"}
          onClick={toggleOpen}
        >
          <i className="cdock-dot" aria-hidden="true" />
          <span className="cdock-title">
            <strong>{dock.name || "Columna"}</strong>
            {boardName && <small>{boardName}</small>}
          </span>
          {open.length > 0 && <span className="cdock-count">{open.length}</span>}
        </button>
        <button
          type="button"
          className="cdock-tool"
          title="Abrir en Tableros"
          aria-label="Abrir en Tableros"
          onClick={() => toBoard()}
        >
          <ArrowUpRight size={15} />
        </button>
        <button
          type="button"
          className="cdock-tool"
          title={dock.open ? "Minimizar" : "Abrir"}
          aria-label={dock.open ? "Minimizar" : "Abrir"}
          onClick={toggleOpen}
        >
          {dock.open ? <Minus size={15} /> : <ChevronUp size={15} />}
        </button>
        <button type="button" className="cdock-tool" title="Cerrar" aria-label="Cerrar la ventana" onClick={close}>
          <X size={15} />
        </button>
      </header>

      <div className="cdock-body" aria-hidden={!dock.open}>
        <div className="cdock-inner">
          <ul className="cdock-list" ref={list}>
            {cards === null &&
              [0, 1, 2].map((i) => (
                <li key={i} className="cdock-skel" aria-hidden="true">
                  <i />
                </li>
              ))}
            {cards !== null && !all.length && <li className="cdock-empty">Sin tarjetas. Escribe abajo para añadir una.</li>}
            {[...open, ...done].map((c) => {
              const isOn = isDone(c);
              const due = dueState(c.due, isOn);
              const ticked = c.checks.filter((x) => x.done).length;
              return (
                <li key={c.id} className={isOn ? "done" : ""}>
                  <button
                    type="button"
                    className="cdock-check"
                    aria-pressed={isOn}
                    tabIndex={dock.open ? 0 : -1}
                    title={isOn ? "Marcar como no completada" : "Completar"}
                    aria-label={isOn ? "Marcar como no completada" : "Completar"}
                    onClick={() => toggle(c)}
                  >
                    <Check size={10} strokeWidth={3.4} />
                  </button>
                  <button
                    type="button"
                    className="cdock-main"
                    tabIndex={dock.open ? 0 : -1}
                    title="Abrir la tarjeta en Tableros"
                    onClick={() => toBoard(c.id)}
                  >
                    <span className="cdock-name">{plainMarks(c.title)}</span>
                    {(due || c.checks.length > 0) && (
                      <small>
                        {due && (
                          <span className={"cdock-due " + due.tone}>
                            {c.repeat ? <Repeat size={10} /> : <Calendar size={10} />} {due.label}
                          </span>
                        )}
                        {c.checks.length > 0 && (
                          <span className={ticked === c.checks.length ? "full" : ""}>
                            <CheckSquare size={10} /> {ticked}/{c.checks.length}
                          </span>
                        )}
                      </small>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <form
            className="cdock-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Plus size={14} aria-hidden="true" />
            <input
              ref={field}
              value={draft}
              tabIndex={dock.open ? 0 : -1}
              placeholder="Añade una tarjeta…"
              aria-label={`Añadir una tarjeta a ${dock.name}`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  if (draft) setDraft("");
                  else setDockOpen(false);
                }
              }}
            />
          </form>
        </div>
      </div>
    </aside>
  );
}
