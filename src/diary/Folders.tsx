import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Check,
  FilePen,
  Folder,
  FolderPlus,
  GripVertical,
  KeyRound,
  LoaderCircle,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Sheet } from "../components/Sheet";
import type { DiaryFolder, Entry } from "../data";
import { PIN_RE, type VaultStatus } from "../notes/vault";
import {
  cleanFolderName,
  FOLDER_COLORS,
  type FolderTarget,
  type FolderView,
} from "./folderStore";
import { isVaulted } from "./vault";
import "./folders.css";

const count = (n: number) => n.toLocaleString("es-CO");

/* ───────── Barra de carpetas ───────── */

export type FolderCounts = {
  todas: number;
  drafts: number;
  archive: number;
  vault: number;
  byFolder: Map<string, number>;
};

/** Una ficha de la barra (el diario, una carpeta propia o una del sistema). */
type BarItem = {
  id: FolderView;
  label: string;
  icon: ReactNode;
  n: number;
  color?: string;
  /** Se puede soltar una entrada en ella. */
  drop?: boolean;
  system?: boolean;
  folder?: DiaryFolder;
};

const itemCount = (item: BarItem, vaultOpen: boolean) =>
  item.id === "drafts"
    ? item.n === 1
      ? "1 borrador"
      : `${count(item.n)} borradores`
    : item.id === "vault" && !vaultOpen
      ? `${count(item.n)} · con PIN`
      : item.n === 1
        ? "1 entrada"
        : `${count(item.n)} entradas`;

const sameIds = (a: string[] | null, b: string[] | null) =>
  a === b || (a !== null && b !== null && a.join("|") === b.join("|"));

const POP_W = 268;

/**
 * Las carpetas del diario como fichas, en una sola fila. Las que no caben se recogen en un
 * botón «+N» al final, que abre la lista del resto (la carpeta que miras siempre queda a la
 * vista). Borradores y Archivados solo aparecen si tienen algo (Archivados también mientras
 * arrastras una entrada); la Bóveda siempre está, en solo icono hasta que arrastras algo.
 * Las carpetas propias se reordenan manteniéndolas pulsadas y arrastrando.
 */
export function FolderBar({
  view,
  onView,
  folders,
  counts,
  vaultOpen,
  dragging,
  over,
  overMore,
  onNew,
  onEdit,
  onReorder,
}: {
  view: FolderView;
  onView: (v: FolderView) => void;
  folders: DiaryFolder[];
  counts: FolderCounts;
  vaultOpen: boolean;
  /** Hay una entrada en el aire. */
  dragging: boolean;
  /** La carpeta bajo el puntero mientras arrastras. */
  over: FolderTarget | null;
  /** La entrada que arrastras está sobre el botón «+N». */
  overMore: boolean;
  onNew: () => void;
  onEdit: (f: DiaryFolder) => void;
  onReorder: (ids: string[]) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  // Los ids que caben en la fila (null: caben todas).
  const [fit, setFit] = useState<string[] | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [, setTick] = useState(0);
  const reorder = useFolderReorder(
    folders.map((f) => f.id),
    onReorder,
  );

  const showArchive = counts.archive > 0 || view === "archive" || dragging;
  const showDrafts = (counts.drafts > 0 || view === "drafts") && !dragging;

  const diario: BarItem = {
    id: "todas",
    label: "Diario",
    icon: <BookOpen size={16} />,
    n: counts.todas,
    drop: true,
  };
  const own: BarItem[] = folders.map((f) => ({
    id: `f:${f.id}`,
    label: f.name,
    icon: <Folder size={16} fill="currentColor" fillOpacity={0.18} />,
    n: counts.byFolder.get(f.id) ?? 0,
    color: f.color,
    drop: true,
    folder: f,
  }));
  const system: BarItem[] = [];
  if (showDrafts)
    system.push({
      id: "drafts",
      label: "Borradores",
      icon: <FilePen size={16} />,
      n: counts.drafts,
      system: true,
    });
  if (showArchive)
    system.push({
      id: "archive",
      label: "Archivados",
      icon: <Archive size={16} />,
      n: counts.archive,
      system: true,
      drop: true,
    });
  // La bóveda siempre está a mano: solo su icono, y su nombre cuando arrastras algo.
  system.push({
      id: "vault",
      label: "Bóveda",
      icon: vaultOpen ? <LockOpen size={16} /> : <Lock size={16} />,
      n: counts.vault,
      system: true,
      drop: true,
    });
  const all = [...own, ...system];
  const hidden = fit ? all.filter((i) => !fit.includes(i.id)) : [];
  const shown = (list: BarItem[]) =>
    fit ? list.filter((i) => fit.includes(i.id)) : list;

  // Medir qué cabe: cada ficha se pinta también, invisible, en una capa de medida.
  useLayoutEffect(() => {
    const r = row.current;
    const m = measure.current;
    if (!r || !m) return;
    const cs = getComputedStyle(r);
    const gap = parseFloat(cs.columnGap) || 0;
    const room =
      r.clientWidth -
      (parseFloat(cs.paddingLeft) || 0) -
      (parseFloat(cs.paddingRight) || 0);
    const w = (key: string) =>
      m.querySelector<HTMLElement>(`[data-m="${CSS.escape(key)}"]`)
        ?.offsetWidth ?? 0;
    const systemIds = new Set(system.map((s) => s.id as string));
    const width = (ids: string[], more: boolean) => {
      const parts = [w("todas"), w("new"), ...ids.map(w)];
      if (more) parts.push(w("more"));
      if (ids.some((id) => systemIds.has(id))) parts.push(w("div"));
      const real = parts.filter((p) => p > 0);
      return real.reduce((a, b) => a + b, 0) + gap * (real.length - 1);
    };
    const ids = all.map((i) => i.id as string);
    let next: string[] | null = null;
    if (width(ids, false) > room + 0.5) {
      const chosen = new Set<string>();
      if (ids.includes(view)) chosen.add(view);
      const tryAdd = (id: string) => {
        if (chosen.has(id)) return true;
        const test = ids.filter((x) => chosen.has(x) || x === id);
        if (width(test, true) > room + 0.5) return false;
        chosen.add(id);
        return true;
      };
      // Primero las del sistema (son pocas), luego tus carpetas en su orden.
      for (const s of system) if (!tryAdd(s.id)) break;
      for (const f of own) if (!tryAdd(f.id)) break;
      next = ids.filter((id) => chosen.has(id));
    }
    setFit((prev) => (sameIds(prev, next) ? prev : next));
  });
  useEffect(() => {
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    if (row.current) ro.observe(row.current);
    if (measure.current) ro.observe(measure.current);
    return () => ro.disconnect();
  }, []);

  // Al arrastrar algo sobre «+N», se abre la lista; al soltar, se cierra.
  const openedByDrag = useRef(false);
  useEffect(() => {
    if ((dragging && overMore) || reorder.overMore) {
      openedByDrag.current = true;
      setMoreOpen(true);
    }
  }, [dragging, overMore, reorder.overMore]);
  useEffect(() => {
    if (!dragging && !reorder.active && openedByDrag.current) {
      openedByDrag.current = false;
      setMoreOpen(false);
    }
  }, [dragging, reorder.active]);
  useEffect(() => {
    if (!hidden.length) setMoreOpen(false);
  }, [hidden.length]);

  const classes = (item: BarItem, base: string) => {
    const on = view === item.id;
    const target = item.drop ? (item.id as FolderTarget) : undefined;
    const fid = item.folder?.id;
    return (
      base +
      (on ? " on" : "") +
      (item.system ? " system" : "") +
      (item.id === "vault" ? " vault" : "") +
      (dragging && target && !on ? " target" : "") +
      (over && over === target && !on ? " over" : "") +
      (fid && reorder.active === fid ? " lifted" : "") +
      (fid && reorder.at?.id === fid
        ? reorder.at.after
          ? " ins-after"
          : " ins-before"
        : "")
    );
  };

  const tile = (item: BarItem, measuring = false) => {
    const on = view === item.id;
    const f = item.folder;
    // La bóveda va en solo icono; al arrastrar una entrada enseña su nombre para soltarla ahí.
    const compact = item.id === "vault" && !dragging;
    return (
      <div
        key={item.id}
        className={classes(item, "dy-folder") + (compact ? " compact" : "")}
        data-m={measuring ? item.id : undefined}
        data-folder={!measuring && item.drop ? item.id : undefined}
        data-folder-id={!measuring && f ? f.id : undefined}
        style={
          item.color ? ({ "--f": item.color } as CSSProperties) : undefined
        }
        onPointerDown={
          !measuring && f && !dragging ? (e) => reorder.start(e, f) : undefined
        }
      >
        <button
          type="button"
          className="dy-folder-btn"
          aria-pressed={measuring ? undefined : on}
          tabIndex={measuring ? -1 : undefined}
          title={
            f && !measuring
              ? "Mantén pulsado y arrastra para reordenar"
              : compact
                ? `${item.label} · ${itemCount(item, vaultOpen)}`
                : undefined
          }
          aria-label={
            compact
              ? `${item.label}, ${itemCount(item, vaultOpen)}`
              : undefined
          }
          onClick={measuring ? undefined : () => onView(item.id)}
        >
          <span className="dy-folder-ic" aria-hidden="true">
            {item.icon}
          </span>
          {!compact && (
            <span className="dy-folder-txt">
              <strong>{item.label}</strong>
              <small>{itemCount(item, vaultOpen)}</small>
            </span>
          )}
        </button>
        {f && on && (
          <button
            type="button"
            className="dy-folder-edit"
            aria-label={`Editar la carpeta «${f.name}»`}
            title="Renombrar, color o eliminar"
            tabIndex={measuring ? -1 : undefined}
            onClick={measuring ? undefined : () => onEdit(f)}
          >
            <Pencil size={13} />
          </button>
        )}
      </div>
    );
  };

  const newBtn = (measuring = false) => (
    <button
      type="button"
      className="dy-folder-new"
      data-m={measuring ? "new" : undefined}
      tabIndex={measuring ? -1 : undefined}
      onClick={measuring ? undefined : onNew}
      title="Crear una carpeta"
      aria-label="Nueva carpeta"
    >
      <FolderPlus size={16} />
    </button>
  );

  const hiddenOn = hidden.some((i) => over === i.id);
  const visibleSystem = shown(system);

  return (
    <nav
      className={
        "dy-folders" +
        (dragging ? " dragging" : "") +
        (reorder.active ? " sorting" : "")
      }
      aria-label="Carpetas del diario"
    >
      <div className="dy-folders-row" ref={row}>
        {tile(diario)}
        {shown(own).map((i) => tile(i))}
        {hidden.length > 0 && (
          <button
            ref={moreBtn}
            type="button"
            className={
              "dy-folder-more" +
              (moreOpen ? " open" : "") +
              ((dragging && overMore) || reorder.overMore || hiddenOn
                ? " over"
                : "")
            }
            data-drop-more=""
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label={
              hidden.length === 1
                ? "Ver 1 carpeta más"
                : `Ver ${hidden.length} carpetas más`
            }
            title="Ver las demás carpetas"
            onClick={() => setMoreOpen((o) => !o)}
          >
            +{hidden.length}
          </button>
        )}
        {!dragging && newBtn()}
        {visibleSystem.length > 0 && (
          <span className="dy-folders-div" aria-hidden="true" />
        )}
        {visibleSystem.map((i) => tile(i))}
      </div>
      <div className="dy-folders-measure" ref={measure} aria-hidden="true">
        {tile(diario, true)}
        {all.map((i) => tile(i, true))}
        <button
          type="button"
          className="dy-folder-more"
          data-m="more"
          tabIndex={-1}
        >
          +{Math.max(10, all.length)}
        </button>
        {!dragging && newBtn(true)}
        <span className="dy-folders-div" data-m="div" />
      </div>
      {moreOpen && hidden.length > 0 && (
        <FolderPop
          anchor={moreBtn}
          items={hidden}
          busy={dragging || Boolean(reorder.active)}
          className={classes}
          vaultOpen={vaultOpen}
          onPick={(id) => {
            setMoreOpen(false);
            onView(id);
          }}
          onClose={() => setMoreOpen(false)}
          onSortStart={dragging ? undefined : reorder.start}
        />
      )}
      {dragging && (
        <p className="dy-folders-hint" aria-live="polite">
          Suelta la entrada en una carpeta · Esc para cancelar
        </p>
      )}
      {reorder.active && (
        <p className="dy-folders-hint" aria-live="polite">
          Suelta la carpeta donde quieras dejarla · Esc para cancelar
        </p>
      )}
    </nav>
  );
}

/** La lista de las carpetas que no caben en la fila. */
function FolderPop({
  anchor,
  items,
  busy,
  className,
  vaultOpen,
  onPick,
  onClose,
  onSortStart,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  items: BarItem[];
  /** Hay algo en el aire: no se cierra al tocar fuera. */
  busy: boolean;
  className: (item: BarItem, base: string) => string;
  vaultOpen: boolean;
  onPick: (id: FolderView) => void;
  onClose: () => void;
  onSortStart?: (e: ReactPointerEvent<HTMLElement>, f: DiaryFolder) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const onClose = () => closeRef.current();
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      setPos({
        top: r.bottom + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8)),
      });
    };
    place();
    const onDown = (e: PointerEvent) => {
      if (busyRef.current) return;
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busyRef.current) return;
      e.stopPropagation();
      onClose();
      anchor.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={box}
      className="dy-folder-pop"
      role="menu"
      data-axis="y"
      style={{ top: pos.top, left: pos.left, width: POP_W }}
    >
      <small>Más carpetas</small>
      {items.map((item) => {
        const f = item.folder;
        return (
          <div
            key={item.id}
            className={className(item, "dy-pop-item")}
            data-folder={item.drop ? item.id : undefined}
            data-folder-id={f?.id}
            style={
              item.color ? ({ "--f": item.color } as CSSProperties) : undefined
            }
            onPointerDown={
              f && onSortStart ? (e) => onSortStart(e, f) : undefined
            }
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => onPick(item.id)}
            >
              <span className="dy-folder-ic" aria-hidden="true">
                {item.icon}
              </span>
              <span className="dy-folder-txt">
                <strong>{item.label}</strong>
                <small>{itemCount(item, vaultOpen)}</small>
              </span>
              {f && (
                <GripVertical size={14} className="grip" aria-hidden="true" />
              )}
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * Reordenar tus carpetas: mantén pulsada una (o, con ratón, arrástrala) y suéltala junto a
 * otra, en la fila o en la lista «+N». Una línea marca dónde quedará. Esc cancela.
 */
function useFolderReorder(order: string[], onCommit: (ids: string[]) => void) {
  const [state, setState] = useState<{
    id: string;
    at: { id: string; after: boolean } | null;
  } | null>(null);
  const [overMore, setOverMore] = useState(false);
  const orderRef = useRef(order);
  orderRef.current = order;
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback(
    (e: ReactPointerEvent<HTMLElement>, f: DiaryFolder) => {
      if (e.button !== 0 || cleanup.current) return;
      if ((e.target as HTMLElement).closest(".dy-folder-edit")) return;
      const touch = e.pointerType !== "mouse";
      const x0 = e.clientX;
      const y0 = e.clientY;
      let x = x0;
      let y = y0;
      let ghost: HTMLElement | null = null;
      let at: { id: string; after: boolean } | null = null;
      let hold = 0;

      const place = () => {
        if (ghost)
          ghost.style.transform = `translate(${x + 14}px, ${y + 12}px)`;
      };
      const begin = () => {
        window.clearTimeout(hold);
        ghost = document.createElement("div");
        ghost.className = "dy-drag-ghost";
        ghost.setAttribute("aria-hidden", "true");
        ghost.style.setProperty("--g", f.color);
        const dot = document.createElement("i");
        const text = document.createElement("span");
        text.textContent = f.name;
        ghost.append(dot, text);
        document.body.appendChild(ghost);
        document.body.classList.add("dy-dragging");
        window.getSelection()?.removeAllRanges();
        place();
        navigator.vibrate?.(12);
        setState({ id: f.id, at: null });
      };
      const hover = () => {
        const under = document.elementFromPoint(x, y);
        setOverMore(Boolean(under?.closest("[data-drop-more]")));
        const el = under?.closest<HTMLElement>("[data-folder-id]");
        let next: typeof at = null;
        if (el && el.dataset.folderId && el.dataset.folderId !== f.id) {
          const r = el.getBoundingClientRect();
          const vertical = Boolean(el.closest("[data-axis='y']"));
          next = {
            id: el.dataset.folderId,
            after: vertical
              ? y > r.top + r.height / 2
              : x > r.left + r.width / 2,
          };
        }
        if (next?.id === at?.id && next?.after === at?.after) return;
        at = next;
        setState({ id: f.id, at: next });
        ghost?.classList.toggle("ready", Boolean(next));
      };
      const move = (ev: PointerEvent) => {
        x = ev.clientX;
        y = ev.clientY;
        if (!ghost) {
          const far = Math.hypot(x - x0, y - y0);
          if (touch) {
            if (far > TOUCH_SLOP) end(false);
          } else if (far > MOUSE_SLOP) begin();
          return;
        }
        place();
        hover();
      };
      const blockTouch = (ev: TouchEvent) => {
        if (ghost) ev.preventDefault();
      };
      const blockMenu = (ev: Event) => {
        if (ghost || touch) ev.preventDefault();
      };
      const swallowClick = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      const end = (ok: boolean) => {
        window.clearTimeout(hold);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        window.removeEventListener("touchmove", blockTouch);
        window.removeEventListener("contextmenu", blockMenu, true);
        cleanup.current = null;
        if (!ghost) return;
        ghost.remove();
        ghost = null;
        document.body.classList.remove("dy-dragging");
        window.addEventListener("click", swallowClick, {
          capture: true,
          once: true,
        });
        window.setTimeout(
          () => window.removeEventListener("click", swallowClick, true),
          0,
        );
        setState(null);
        setOverMore(false);
        if (!ok || !at) return;
        const ids = orderRef.current.filter((id) => id !== f.id);
        const i = ids.indexOf(at.id);
        if (i < 0) return;
        ids.splice(at.after ? i + 1 : i, 0, f.id);
        commit.current(ids);
      };
      const up = () => end(true);
      const cancel = () => end(false);
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.stopPropagation();
        end(false);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
      window.addEventListener("touchmove", blockTouch, { passive: false });
      window.addEventListener("contextmenu", blockMenu, true);
      hold = window.setTimeout(begin, HOLD_MS);
      cleanup.current = () => end(false);
    },
    [],
  );

  return {
    active: state?.id ?? null,
    at: state?.at ?? null,
    overMore,
    start,
  };
}

/* ───────── Crear o editar una carpeta ───────── */

export function FolderSheet({
  folder,
  onSave,
  onDelete,
  onClose,
}: {
  /** Sin carpeta: es nueva. */
  folder?: DiaryFolder;
  onSave: (name: string, color: string) => Promise<boolean>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState(
    folder?.color ??
      FOLDER_COLORS[1 + Math.floor(Math.random() * (FOLDER_COLORS.length - 1))],
  );
  const [busy, setBusy] = useState(false);
  const clean = cleanFolderName(name);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clean || busy) return;
    setBusy(true);
    const ok = await onSave(clean, color);
    setBusy(false);
    if (ok) onClose();
  };
  return createPortal(
    <Sheet
      label={folder ? "Editar carpeta" : "Nueva carpeta"}
      className="dyy dy-folder-sheet"
      onRequestClose={() => !busy && onClose()}
    >
      <form onSubmit={(e) => void submit(e)}>
        <header>
          <span
            className="dy-folder-ic"
            style={{ "--f": color } as CSSProperties}
          >
            <Folder size={18} fill="currentColor" fillOpacity={0.18} />
          </span>
          <h2>{folder ? "Editar carpeta" : "Nueva carpeta"}</h2>
        </header>
        <label className="dy-field">
          <span>Nombre</span>
          <input
            autoFocus
            value={name}
            maxLength={40}
            placeholder="Ej.: Viajes"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="dy-field">
          <span>Color</span>
          <div
            className="dy-swatches"
            role="radiogroup"
            aria-label="Color de la carpeta"
          >
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Color ${c}`}
                className={color === c ? "on" : ""}
                style={{ "--f": c } as CSSProperties}
                onClick={() => setColor(c)}
              >
                {color === c && <Check size={13} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
        <footer>
          {onDelete && (
            <button
              type="button"
              className="dy-folder-del"
              onClick={onDelete}
              disabled={busy}
            >
              <Trash2 size={14} /> Eliminar carpeta
            </button>
          )}
          <button
            type="button"
            className="dy-btn ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button type="submit" className="dy-btn" disabled={!clean || busy}>
            {busy && <LoaderCircle size={14} className="spin" />}
            {folder ? "Guardar" : "Crear carpeta"}
          </button>
        </footer>
      </form>
    </Sheet>,
    document.body,
  );
}

/* ───────── Menú de opciones de una entrada ───────── */

const MENU_W = 248;

/** El botón «Más opciones» de una entrada: moverla a una carpeta, archivarla o a la bóveda. */
export function EntryMenu({
  entry,
  folders,
  onMove,
  onNewFolder,
}: {
  entry: Entry;
  folders: DiaryFolder[];
  onMove: (e: Entry, to: FolderTarget) => void;
  onNewFolder: (e: Entry) => void;
}) {
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    up: boolean;
  } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPos(null), []);
  const vaulted = isVaulted(entry);
  const archived = Boolean(entry.details.archived);
  const current = vaulted ? null : (entry.details.folder ?? null);

  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(
      8,
      Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8),
    );
    const up = r.bottom + 320 > window.innerHeight && r.top > 320;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left, up });
  };

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      btn.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos, close]);
  useLayoutEffect(() => {
    if (pos)
      menu.current
        ?.querySelector<HTMLElement>("button")
        ?.focus({ preventScroll: true });
  }, [pos]);

  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="Más opciones"
        title="Mover, archivar o guardar en la bóveda"
        aria-haspopup="menu"
        aria-expanded={Boolean(pos)}
        className={pos ? "on" : ""}
        onClick={() => (pos ? close() : open())}
      >
        <MoreHorizontal size={15} />
      </button>
      {pos &&
        createPortal(
          <div
            ref={menu}
            className={"dy-entry-menu" + (pos.up ? " up" : "")}
            role="menu"
            style={{ top: pos.top, left: pos.left, width: MENU_W }}
          >
            <small>Mover a</small>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!vaulted && !archived && !current}
              onClick={run(() => onMove(entry, "todas"))}
            >
              <BookOpen size={15} />
              <span>Diario (sin carpeta)</span>
              {!vaulted && !archived && !current && (
                <Check size={14} className="ok" />
              )}
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitemradio"
                aria-checked={current === f.id && !archived}
                style={{ "--f": f.color } as CSSProperties}
                onClick={run(() => onMove(entry, `f:${f.id}`))}
              >
                <Folder
                  size={15}
                  className="tint"
                  fill="currentColor"
                  fillOpacity={0.2}
                />
                <span>{f.name}</span>
                {current === f.id && !archived && (
                  <Check size={14} className="ok" />
                )}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              onClick={run(() => onNewFolder(entry))}
            >
              <FolderPlus size={15} />
              <span>Nueva carpeta…</span>
            </button>
            <hr />
            <button
              type="button"
              role="menuitem"
              onClick={run(() => onMove(entry, archived ? "todas" : "archive"))}
            >
              {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              <span>{archived ? "Sacar del archivo" : "Archivar"}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="vault"
              onClick={run(() => onMove(entry, vaulted ? "todas" : "vault"))}
            >
              {vaulted ? <LockOpen size={15} /> : <Lock size={15} />}
              <span>
                {vaulted ? "Sacar de la bóveda" : "Guardar en la bóveda"}
              </span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ───────── Arrastrar entradas a una carpeta ───────── */

const MOUSE_SLOP = 6;
const HOLD_MS = 320;
const TOUCH_SLOP = 9;
const EDGE = 70;
/** Lo que no empieza un arrastre: botones de la tarjeta, fotos, enlaces y campos. */
const NO_DRAG =
  ".dy-card-acts, .dy-card-photos, a, input, textarea, select, label";

/**
 * Arrastrar una entrada hasta una carpeta (cualquier elemento con `data-folder`). Con ratón,
 * basta moverla unos píxeles; en pantallas táctiles, mantenerla pulsada. Una pastilla con el
 * título sigue al puntero y la carpeta de debajo se resalta. Esc cancela.
 */
export function useEntryDrag(onDrop: (entry: Entry, to: FolderTarget) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<FolderTarget | null>(null);
  /** El puntero está sobre el botón «+N» de las carpetas que no caben. */
  const [overMore, setOverMore] = useState(false);
  const drop = useRef(onDrop);
  drop.current = onDrop;
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback(
    (e: ReactPointerEvent<HTMLElement>, entry: Entry, label: string) => {
      if (e.button !== 0 || cleanup.current) return;
      if ((e.target as HTMLElement).closest(NO_DRAG)) return;
      const card = e.currentTarget;
      const touch = e.pointerType !== "mouse";
      const x0 = e.clientX;
      const y0 = e.clientY;
      let x = x0;
      let y = y0;
      let ghost: HTMLElement | null = null;
      let target: FolderTarget | null = null;
      let hold = 0;
      let raf = 0;

      const place = () => {
        if (ghost)
          ghost.style.transform = `translate(${x + 14}px, ${y + 12}px)`;
      };
      const scrollLoop = () => {
        const h = window.innerHeight;
        const speed =
          y < EDGE ? -(EDGE - y) / 4 : y > h - EDGE ? (y - (h - EDGE)) / 4 : 0;
        if (speed) window.scrollBy(0, speed);
        raf = requestAnimationFrame(scrollLoop);
      };
      const begin = () => {
        ghost = document.createElement("div");
        ghost.className = "dy-drag-ghost";
        ghost.setAttribute("aria-hidden", "true");
        const dot = document.createElement("i");
        const text = document.createElement("span");
        text.textContent = label;
        ghost.append(dot, text);
        document.body.appendChild(ghost);
        document.body.classList.add("dy-dragging");
        card.classList.add("lifted");
        window.getSelection()?.removeAllRanges();
        place();
        navigator.vibrate?.(12);
        setDragging(entry.id);
        raf = requestAnimationFrame(scrollLoop);
      };
      const hover = () => {
        const under = document.elementFromPoint(x, y);
        setOverMore(Boolean(under?.closest("[data-drop-more]")));
        const el = under?.closest<HTMLElement>("[data-folder]");
        const next = (el?.dataset.folder as FolderTarget | undefined) ?? null;
        if (next === target) return;
        target = next;
        setOver(next);
        ghost?.classList.toggle("ready", Boolean(next));
      };

      const move = (ev: PointerEvent) => {
        x = ev.clientX;
        y = ev.clientY;
        if (!ghost) {
          const far = Math.hypot(x - x0, y - y0);
          if (touch) {
            if (far > TOUCH_SLOP) end(false);
          } else if (far > MOUSE_SLOP) begin();
          return;
        }
        place();
        hover();
      };
      const blockTouch = (ev: TouchEvent) => {
        if (ghost) ev.preventDefault();
      };
      const blockMenu = (ev: Event) => {
        if (ghost || touch) ev.preventDefault();
      };
      const swallowClick = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      const end = (commit: boolean) => {
        window.clearTimeout(hold);
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        window.removeEventListener("touchmove", blockTouch);
        window.removeEventListener("contextmenu", blockMenu, true);
        cleanup.current = null;
        if (!ghost) return;
        ghost.remove();
        ghost = null;
        document.body.classList.remove("dy-dragging");
        card.classList.remove("lifted");
        // El clic que sigue a soltar no debe abrir la entrada.
        window.addEventListener("click", swallowClick, {
          capture: true,
          once: true,
        });
        window.setTimeout(
          () => window.removeEventListener("click", swallowClick, true),
          0,
        );
        setDragging(null);
        setOver(null);
        setOverMore(false);
        if (commit && target) drop.current(entry, target);
      };
      const up = () => end(true);
      const cancel = () => end(false);
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.stopPropagation();
        end(false);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
      window.addEventListener("touchmove", blockTouch, { passive: false });
      window.addEventListener("contextmenu", blockMenu, true);
      if (touch) hold = window.setTimeout(begin, HOLD_MS);
      cleanup.current = () => end(false);
    },
    [],
  );

  return { dragging, over, overMore, start };
}

/* ───────── La puerta de la bóveda ───────── */

/** Campo de PIN: solo números. */
function PinInput({
  value,
  onChange,
  label,
  autoFocus,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  return (
    <input
      className={"dy-pin" + (invalid ? " invalid" : "")}
      type="password"
      inputMode="numeric"
      autoComplete="off"
      pattern="\d*"
      maxLength={8}
      aria-label={label}
      placeholder={label}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
    />
  );
}

/** Crear el PIN la primera vez o pedirlo para abrir la bóveda del diario. */
export function DiaryVaultGate({
  status,
  count: n,
  onCreate,
  onUnlock,
  onReset,
}: {
  status: VaultStatus;
  count: number;
  onCreate: (pin: string) => Promise<string | null>;
  onUnlock: (pin: string) => Promise<string | null>;
  onReset: () => void;
}) {
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setPin("");
    setAgain("");
    setError("");
  }, [status]);

  if (status === "loading")
    return (
      <div className="dy-vault-gate">
        <LoaderCircle size={22} className="spin" />
      </div>
    );
  if (status === "missing")
    return (
      <div className="dy-vault-gate">
        <span className="dy-vault-ico">
          <Lock size={22} />
        </span>
        <h3>La bóveda aún no está lista</h3>
        <p>
          Ejecuta <code>supabase/migrations/202611090007_notes_extras.sql</code>{" "}
          en el SQL Editor de Supabase para activarla.
        </p>
      </div>
    );

  const setup = status === "none";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!PIN_RE.test(pin)) return setError("Usa de 4 a 8 números.");
    if (setup && pin !== again) return setError("Los dos PIN no coinciden.");
    setBusy(true);
    setError("");
    const problem = await (setup ? onCreate(pin) : onUnlock(pin));
    setBusy(false);
    if (problem) {
      setError(problem);
      setShake((s) => s + 1);
      setPin("");
      form.current?.querySelector("input")?.focus();
    }
  };

  return (
    <form className="dy-vault-gate" ref={form} onSubmit={(e) => void submit(e)}>
      <span className="dy-vault-ico">
        {setup ? <ShieldCheck size={24} /> : <Lock size={24} />}
      </span>
      <h3>{setup ? "Crea tu bóveda" : "Bóveda bloqueada"}</h3>
      <p>
        {setup
          ? "Guarda aquí tus entradas privadas. Se cifran en este dispositivo con tu PIN antes de guardarse; ni siquiera Nexo puede leerlas."
          : n
            ? `${n === 1 ? "Hay 1 entrada privada" : `Hay ${count(n)} entradas privadas`}. Escribe tu PIN para verlas.`
            : "Escribe tu PIN para abrirla."}
      </p>
      <div key={shake} className={"dy-pin-row" + (shake ? " shake" : "")}>
        <PinInput
          value={pin}
          onChange={(v) => {
            setPin(v);
            setError("");
          }}
          label={setup ? "Nuevo PIN" : "PIN"}
          autoFocus
          invalid={Boolean(error)}
        />
        {setup && (
          <PinInput
            value={again}
            onChange={(v) => {
              setAgain(v);
              setError("");
            }}
            label="Repite el PIN"
            invalid={Boolean(error)}
          />
        )}
      </div>
      {error && (
        <small className="dy-vault-error" role="alert">
          {error}
        </small>
      )}
      <button
        type="submit"
        className="dy-btn dark"
        disabled={busy || pin.length < 4}
      >
        {busy ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <KeyRound size={15} />
        )}
        {setup ? "Crear bóveda" : "Desbloquear"}
      </button>
      {setup ? (
        <small className="dy-vault-note">
          Es el mismo PIN de la bóveda de Notas. Si lo olvidas, no hay forma de
          recuperar lo que guardes: nadie más lo conoce.
        </small>
      ) : (
        <>
          <small className="dy-vault-note">
            Es el mismo PIN de la bóveda de Notas.
          </small>
          <button type="button" className="dy-vault-forgot" onClick={onReset}>
            ¿Olvidaste el PIN?
          </button>
        </>
      )}
    </form>
  );
}

/** La puerta en una ventana: al guardar una entrada con la bóveda cerrada. */
export function DiaryVaultSheet(
  props: Parameters<typeof DiaryVaultGate>[0] & { onClose: () => void },
) {
  const { onClose, ...gate } = props;
  return createPortal(
    <Sheet
      label="Bóveda"
      className="dyy dy-vault-sheet"
      onRequestClose={onClose}
    >
      <DiaryVaultGate {...gate} />
    </Sheet>,
    document.body,
  );
}
