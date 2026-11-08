import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardPaste,
  Columns3,
  Eye,
  EyeOff,
  FoldHorizontal,
  FolderInput,
  LayoutTemplate,
  Menu as MenuIcon,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RectangleHorizontal,
  Search,
  SquareStack,
  TextCursorInput,
  Trash2,
  UnfoldHorizontal,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { friendlyDate, normalizeText } from '../lib/format';
import { ArchiveView } from './ArchiveView';
import { isBoardEntry } from './boardPeople';
import { nextDue } from './boardRepeat';
import { builtinTemplates } from './boardTemplates';
import { MoveColumnMenu } from './MoveColumn';
import { TemplateGallery } from './TemplateGallery';
import { CardFace, CardTile, DividerTile, type CardInline } from './BoardCard';
import { useBoardDrag, useFlip } from './boardDrag';
import { MenuItem, Popover } from './BoardPopover';
import {
  BOARD_SQL,
  byRank,
  snapshotBoard,
  useArchive,
  useBoard,
  useBoardList,
  type Board,
  type BoardCard,
  type CardChanges,
  type NewCardInput,
} from './boardStore';
import { backgroundOf, backgrounds, isDivider, tones, toneOf } from './boardTheme';
import { BOARD_GO, BOARD_LAST, useBoardView } from './boardView';
import { CardEditor } from './CardEditor';
import './boards.css';

const LAST = BOARD_LAST;
const ARCHIVE = 'archivados';
const HIDE = 'nexo-board-hide-done';

type Menu =
  | { kind: 'list'; id: string; anchor: DOMRect }
  | { kind: 'move'; id: string; anchor: DOMRect }
  | { kind: 'board'; anchor: DOMRect }
  | { kind: 'picker'; anchor: DOMRect };

/**
 * Tableros al estilo Trello: columnas que se crean con doble clic donde quieras, se renombran
 * con un clic y se mueven arrastrando su encabezado; tarjetas que se añaden escribiendo, se
 * completan con su círculo y se abren en una ficha completa. Archivados guarda lo que sacas.
 */
export function Boards({ toggleMenu }: { toggleMenu?: () => void } = {}) {
  const { workspace, toggleEntry, patchEntry, removeEntry, notify, confirm } = useApp();
  const list = useBoardList(notify);
  const [selected, setSelected] = useState(() => localStorage.getItem(LAST) ?? '');
  const inArchive = selected === ARCHIVE;
  // También puede ser una plantilla tuya (se edita como un tablero).
  const board = inArchive
    ? null
    : (list.all?.find((b) => b.id === selected) ?? list.boards?.[0] ?? null);
  const editingTemplate = Boolean(board?.is_template);
  // Nuevo tablero: la galería de plantillas (con lo que quieras preseleccionar).
  const [gallery, setGallery] = useState<string | null>(null);
  const api = useBoard(board?.id ?? null, notify);
  const archive = useArchive(inArchive, notify);
  // Tarjetas desplegadas y columnas plegadas (se recuerda en este equipo).
  const view = useBoardView();

  const [query, setQuery] = useState('');
  const [hideDone, setHideDone] = useState(() => localStorage.getItem(HIDE) === '1');
  const [composer, setComposer] = useState<string | null>(null);
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; left: number; id: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (board) localStorage.setItem(LAST, board.id);
  }, [board?.id]);
  useEffect(() => localStorage.setItem(HIDE, hideDone ? '1' : '0'), [hideDone]);

  const pick = (id: string) => {
    setSelected(id);
    localStorage.setItem(LAST, id);
    setMenu(null);
    setComposer(null);
    setDraftAt(null);
    setRenaming(null);
    setOpenId(null);
    setQuery('');
  };

  // ── Completadas (también si el pendiente vinculado ya se hizo) ──
  const tasks = useMemo(
    () => new Map(workspace.entries.map((e) => [e.id, e])),
    [workspace.entries],
  );
  // Tarjetas que se repiten: se ven completadas un momento y vuelven con la fecha siguiente.
  const [recurring, setRecurring] = useState<Set<string>>(() => new Set());
  // Las tarjetas a la vista ahora mismo (si la archivas o la borras antes de que vuelva, no vuelve).
  const present = useRef(new Set<string>());
  present.current = new Set([
    ...api.cards.map((c) => c.id),
    ...(archive.cards ?? []).map((c) => c.id),
  ]);
  /** Con un pendiente vinculado, su estado manda (se completa desde la persona o desde aquí). */
  const isDone = (c: BoardCard) => {
    if (isDivider(c.title)) return false;
    if (recurring.has(c.id)) return true;
    const task = tasks.get(c.entry_id ?? '');
    return task ? task.status === 'completado' : c.done;
  };
  const linked = (c: BoardCard) => Boolean(c.entry_id && tasks.has(c.entry_id));
  /** El pendiente que nació con la tarjeta (al añadirle personas): va y viene con ella. */
  const boardTask = (c: BoardCard) => {
    const t = tasks.get(c.entry_id ?? '');
    return t && isBoardEntry(t) ? t : undefined;
  };
  function toggleDone(c: BoardCard, patch: (ch: CardChanges) => void) {
    const next = !isDone(c);
    const task = tasks.get(c.entry_id ?? '');
    if (next && c.repeat) return recur(c, patch);
    patch({ done: next, done_at: next ? new Date().toISOString() : null });
    if (task && (task.status === 'completado') !== next) toggleEntry(task);
  }
  /** Completar una que se repite: se marca un instante y vuelve abierta, con su lista limpia. */
  function recur(c: BoardCard, patch: (ch: CardChanges) => void) {
    const due = nextDue(c.repeat, c.due) ?? c.due;
    const before = { due: c.due, checks: c.checks };
    const task = tasks.get(c.entry_id ?? '');
    setRecurring((s) => new Set(s).add(c.id));
    window.setTimeout(() => {
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
      });
      if (task)
        void patchEntry(task, {
          status: 'pendiente',
          details: { ...task.details, ...(due && { due }) },
        });
    }, 850);
    notify(`Hecho. Se repite: vuelve ${due ? friendlyDate(due).toLowerCase() : 'abierta'}.`, {
      label: 'Deshacer',
      icon: 'undo',
      run: () => {
        patch({ ...before, done: false, done_at: null });
        if (task)
          void patchEntry(task, { details: { ...task.details, due: before.due ?? undefined } });
      },
    });
  }
  /** Al editar la tarjeta, su pendiente (el que nació aquí) cambia igual. */
  function syncTask(c: BoardCard, ch: CardChanges) {
    const t = boardTask(c);
    if (!t) return;
    const next: Parameters<typeof patchEntry>[1] = {};
    if (ch.title !== undefined && ch.title !== t.title) next.title = ch.title.slice(0, 180);
    if (ch.body !== undefined && ch.body !== t.body) next.body = ch.body.slice(0, 4000);
    if (ch.due !== undefined && (ch.due ?? undefined) !== t.details.due)
      next.details = { ...t.details, due: ch.due ?? undefined };
    if (Object.keys(next).length) void patchEntry(t, next);
  }
  /** Borra los pendientes que nacieron con estas tarjetas (al borrarlas, no al archivarlas). */
  const dropTasks = (ids: (string | null)[]) => {
    for (const id of ids) {
      const t = id ? tasks.get(id) : undefined;
      if (t && isBoardEntry(t)) removeEntry(t, true);
    }
  };
  /** Igual, pero leyendo de la base las tarjetas de una columna o un tablero (incluye archivadas). */
  async function dropTasksOf(filter: { list?: string; board?: string }) {
    const q = filter.list
      ? supabase.from('board_cards').select('entry_id').eq('list_id', filter.list)
      : supabase.from('planner_board_cards').select('entry_id').eq('board_id', filter.board!);
    const { data } = await q.not('entry_id', 'is', null).limit(5000);
    dropTasks(((data ?? []) as { entry_id: string | null }[]).map((r) => r.entry_id));
  }

  /** Lo que se hace desde la tarjeta en la columna, sin abrirla. */
  const inlineFor = (c: BoardCard): CardInline => ({
    toggleChecks: () => view.toggleCard(c.id, 'c'),
    toggleBody: () => view.toggleCard(c.id, 'd'),
    check: (id) => {
      const checks = c.checks.map((x) => (x.id === id ? { ...x, done: !x.done } : x));
      api.patchCard(c.id, { checks });
      // Terminaste la lista: propone completar la tarjeta.
      if (checks.every((x) => x.done) && !c.checks.every((x) => x.done) && !isDone(c))
        notify(`Terminaste la lista de «${c.title.slice(0, 40)}».`, {
          label: 'Completar tarjeta',
          run: () => toggleDone({ ...c, checks }, (ch) => api.patchCard(c.id, ch)),
        });
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
        (!needle || normalizeText(`${c.title} ${c.body} ${c.tags.join(' ')}`).includes(needle));

  // ── Arrastre ──
  const dnd = useBoardDrag(canvas, (d) => {
    if (d.kind === 'card') {
      const others = (byList.get(d.list) ?? []).filter((c) => c.id !== d.id);
      const at = d.before ? others.findIndex((c) => c.id === d.before) : -1;
      api.moveCard(d.id, d.list, at < 0 ? others.length : at);
    } else {
      const others = api.columns.filter((c) => c.id !== d.id);
      const at = d.before ? others.findIndex((c) => c.id === d.before) : -1;
      api.moveColumn(d.id, at < 0 ? others.length : at);
    }
  });
  const drag = dnd.drag;
  useFlip(main);

  // Llegaste desde Mi espacio: muestra la columna anclada y, si tocaste una tarjeta, la abre.
  useEffect(() => {
    if (api.status !== 'ready') return;
    const raw = sessionStorage.getItem(BOARD_GO);
    if (!raw) return;
    sessionStorage.removeItem(BOARD_GO);
    try {
      const go = JSON.parse(raw) as { list?: string; card?: string };
      if (go.list && api.columns.some((c) => c.id === go.list)) {
        view.setFolded([go.list], false);
        requestAnimationFrame(() => {
          const el = canvas.current?.querySelector<HTMLElement>(`[data-list="${go.list}"]`);
          if (!el) return;
          el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
          el.classList.add('bd-flash');
          window.setTimeout(() => el.classList.remove('bd-flash'), 1600);
        });
      }
      if (go.card && api.cards.some((c) => c.id === go.card)) setOpenId(go.card);
    } catch {
      /* enlace viejo: se ignora */
    }
  }, [api.status, board?.id]);

  /** Posición entre columnas más cercana a un punto (para crear ahí la nueva). */
  const insertIndex = (x: number) => {
    const root = canvas.current;
    if (!root) return api.columns.length;
    const left = root.getBoundingClientRect().left - root.scrollLeft;
    return [...root.querySelectorAll<HTMLElement>('[data-list]')].filter(
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
    const removed = api.deleteCard(c.id);
    if (!removed) return;
    const keep = dropTaskLater(c);
    notify(boardTask(c) ? 'Tarjeta eliminada (y su pendiente).' : 'Tarjeta eliminada.', {
      label: 'Deshacer',
      icon: 'undo',
      run: () => {
        keep();
        api.restoreCard(removed);
      },
    });
  }
  function archiveCard(c: BoardCard) {
    const done = api.archiveCard(c.id);
    if (!done) return;
    list.setArchived((n) => n + 1);
    notify('Tarjeta archivada. La encuentras en Archivados.', {
      label: 'Deshacer',
      icon: 'undo',
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
    notify(
      `Volvió a «${card.list_name ?? 'su columna'}»${card.board_name ? ` en ${card.board_name}` : ''}.`,
      {
        label: 'Deshacer',
        icon: 'undo',
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
    notify('Tarjeta eliminada.', {
      label: 'Deshacer',
      icon: 'undo',
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
        message: `También se eliminarán sus ${n} ${n === 1 ? 'tarjeta' : 'tarjetas'} y los pendientes que nacieron con ellas. Las notas y los pendientes que ya tenías se conservan.`,
        confirmLabel: 'Eliminar',
        danger: true,
        icon: 'trash',
      }))
    )
      return;
    // Antes de borrar: después ya no se sabe qué pendientes eran suyos.
    await dropTasksOf({ list: id });
    api.deleteColumn(id);
    list.forgetPin(id);
    notify(`Columna «${col.name.slice(0, 40)}» eliminada.`);
  }
  async function deleteBoard() {
    if (!board) return;
    const template = Boolean(board.is_template);
    const ok = await confirm({
      title: `¿Eliminar ${template ? 'la plantilla' : 'el tablero'} «${board.name.slice(0, 60)}»?`,
      message: template
        ? 'Los tableros que ya creaste con ella no cambian.'
        : 'Se eliminarán sus columnas y tarjetas (también las archivadas) y los pendientes que nacieron con ellas. Las notas y los pendientes que ya tenías se conservan.',
      confirmLabel: 'Eliminar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    if (!template) await dropTasksOf({ board: board.id });
    const rest = (list.boards ?? []).filter((b) => b.id !== board.id);
    list.remove(board.id);
    pick(rest[0]?.id ?? '');
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
        notify('Guardado en Mis plantillas.', {
          label: 'Editar',
          icon: 'open',
          run: () => pick(id),
        });
    } catch (e) {
      notify('No se pudo guardar la plantilla: ' + ((e as Error).message ?? 'error'));
    }
  }
  /** Lleva la columna a otro tablero, con sus tarjetas. */
  function moveToBoard(colId: string, target: Board, rank: number) {
    const col = api.columns.find((c) => c.id === colId);
    if (!col) return;
    api.moveColumnToBoard(colId, target.id, rank);
    list.repointPin(colId, target.id);
    notify(`«${col.name.slice(0, 40)}» pasó a «${target.name.slice(0, 40)}».`, {
      label: 'Ir allí',
      icon: 'open',
      run: () => {
        sessionStorage.setItem(BOARD_GO, JSON.stringify({ list: colId }));
        pick(target.id);
      },
    });
  }
  function archiveDone(listId: string) {
    const done = (byList.get(listId) ?? []).filter(isDone);
    const moved = done.map((c) => api.archiveCard(c.id)).filter((c): c is BoardCard => Boolean(c));
    if (!moved.length) return;
    list.setArchived((n) => n + moved.length);
    notify(`${moved.length} ${moved.length === 1 ? 'tarjeta archivada' : 'tarjetas archivadas'}.`, {
      label: 'Deshacer',
      icon: 'undo',
      run: () => {
        moved.forEach((c) => api.unarchiveCard(c));
        list.setArchived((n) => Math.max(0, n - moved.length));
      },
    });
  }
  function sortList(listId: string, by: 'due' | 'name') {
    const all = [...(byList.get(listId) ?? [])];
    all.sort((a, b) =>
      by === 'name'
        ? a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })
        : (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.rank - b.rank,
    );
    api.reorder(all);
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
    // Cambiar de columna desde la ficha: va al final de la nueva.
    if (ch.list_id && ch.list_id !== openCard.list_id) {
      const { list_id, ...rest } = ch;
      api.moveCard(openCard.id, list_id, byList.get(list_id)?.length ?? 0);
      if (Object.keys(rest).length) api.patchCard(openCard.id, rest);
      return;
    }
    api.patchCard(openCard.id, ch);
  };

  const bg = backgroundOf(board?.background);
  const realCards = api.cards.filter((c) => !isDivider(c.title));
  const activeCount = realCards.length;
  const doneCount = realCards.filter(isDone).length;
  const cols = api.columns;

  // ── Una columna ──
  const renderColumn = (col: (typeof cols)[number], i: number) => {
    const every = byList.get(col.id) ?? [];
    // Los divisores («---») ordenan la columna, pero no cuentan como tarjetas.
    const all = every.filter((c) => !isDivider(c.title));
    const shown = every.filter((c) => visible(c) && !(drag?.kind === 'card' && drag.id === c.id));
    const tone = toneOf(col.color);
    const done = all.filter(isDone).length;
    const isPinned = list.pinned?.id === col.id;
    const here = drag?.kind === 'card' && drag.list === col.id;
    const nextCol = cols[i + 1]?.id ?? null;

    // Plegada: una franja delgada con su nombre en vertical. Un clic la despliega.
    if (view.folded(col.id))
      return (
        <section
          key={col.id}
          className={'bd-list folded' + (tone ? ' toned' : '')}
          data-list={col.id}
          data-flip={'l:' + col.id}
          style={tone ? ({ '--lc': tone.c } as CSSProperties) : undefined}
        >
          <button
            type="button"
            className="bd-fold"
            title={`${col.name} · clic para desplegar, arrastra para mover`}
            aria-label={`Desplegar la columna ${col.name}`}
            onPointerDown={(e) => dnd.start(e, { kind: 'list', id: col.id, before: nextCol })}
            onClick={() => !dnd.wasDrag() && view.setFolded([col.id], false)}
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
        style={{ height: drag?.kind === 'card' ? drag.h : 0 }}
      />
    );
    const items: ReactNode[] = [];
    shown.forEach((c, j) => {
      if (here && drag.before === c.id) items.push(placeholder);
      if (isDivider(c.title)) {
        items.push(
          <DividerTile
            key={c.id}
            card={c}
            before={shown[j + 1]?.id ?? null}
            onDelete={() => deleteCard(c)}
            onDragStart={(e, before) =>
              dnd.start(e, { kind: 'card', id: c.id, list: col.id, before })
            }
          />,
        );
        return;
      }
      items.push(
        <CardTile
          key={c.id}
          card={c}
          done={isDone(c)}
          linkedTask={linked(c)}
          before={shown[j + 1]?.id ?? null}
          open={view.open(c.id)}
          inline={inlineFor(c)}
          onOpen={() => !dnd.wasDrag() && setOpenId(c.id)}
          onToggle={() => toggleDone(c, (ch) => api.patchCard(c.id, ch))}
          onDelete={() => deleteCard(c)}
          onArchive={() => archiveCard(c)}
          onDragStart={(e, before) =>
            dnd.start(e, { kind: 'card', id: c.id, list: col.id, before })
          }
        />,
      );
    });
    if (here && drag.before === null) items.push(placeholder);
    return (
      <section
        key={col.id}
        className={'bd-list' + (tone ? ' toned' : '') + (here ? ' over' : '')}
        data-list={col.id}
        data-flip={'l:' + col.id}
        style={tone ? ({ '--lc': tone.c } as CSSProperties) : undefined}
      >
        <header
          className="bd-list-head"
          onPointerDown={(e) => dnd.start(e, { kind: 'list', id: col.id, before: nextCol })}
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
          <span
            className="bd-list-count"
            title={`${all.length} ${all.length === 1 ? 'tarjeta' : 'tarjetas'}${done ? ` · ${done} completadas` : ''}`}
          >
            {all.length}
          </span>
          <button
            type="button"
            className="bd-icon bd-list-fold"
            data-nodrag
            title="Plegar la columna"
            aria-label="Plegar la columna"
            onClick={() => {
              if (composer === col.id) setComposer(null);
              view.setFolded([col.id], true);
            }}
          >
            <FoldHorizontal size={15} />
          </button>
          <button
            type="button"
            className="bd-icon bd-list-menu"
            data-nodrag
            aria-label="Opciones de la columna"
            aria-expanded={menu?.kind === 'list' && menu.id === col.id}
            onClick={(e) =>
              setMenu({ kind: 'list', id: col.id, anchor: e.currentTarget.getBoundingClientRect() })
            }
          >
            <MoreHorizontal size={17} />
          </button>
        </header>
        <div
          className="bd-stack"
          data-stack
          onDoubleClick={(e) => e.target === e.currentTarget && setComposer(col.id)}
        >
          {items}
          {!shown.length && !here && all.length > 0 && composer !== col.id && (
            <p className="bd-list-none">{needle ? 'Nada coincide' : 'Todas completadas'}</p>
          )}
          {composer === col.id && (
            <Composer
              onAdd={(titles) => api.addCards(col.id, titles)}
              onClose={() => setComposer(null)}
            />
          )}
        </div>
        {composer !== col.id && (
          <footer className="bd-list-foot">
            <button type="button" className="bd-add" onClick={() => setComposer(col.id)}>
              <Plus size={16} /> Añade una tarjeta
            </button>
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
    if (drag?.kind === 'list' && drag.before === col.id)
      columns.push(
        <div
          key="lph"
          className="bd-list-ph"
          data-flip="l:ph"
          style={{ width: drag.w, height: drag.h }}
        />,
      );
    if (drag?.kind === 'list' && drag.id === col.id) return;
    columns.push(renderColumn(col, i));
  });
  if (drag?.kind === 'list' && drag.before === null)
    columns.push(
      <div
        key="lph"
        className="bd-list-ph"
        data-flip="l:ph"
        style={{ width: drag.w, height: drag.h }}
      />,
    );
  if (draftAt !== null && draftAt >= cols.length) columns.push(newColumn(cols.length));

  const menuCol = menu?.kind === 'list' ? cols.find((c) => c.id === menu.id) : undefined;
  const moveCol = menu?.kind === 'move' ? cols.find((c) => c.id === menu.id) : undefined;
  // A dónde se puede mover una columna: tus otros tableros (o tus otras plantillas, si editas una).
  const otherBoards = ((editingTemplate ? list.templates : list.boards) ?? []).filter(
    (b) => b.id !== board?.id,
  );
  const menuIdx = menuCol ? cols.indexOf(menuCol) : -1;
  const menuCards = menuCol ? (byList.get(menuCol.id) ?? []) : [];
  const menuDone = menuCards.filter(isDone).length;
  const close = () => setMenu(null);

  return (
    <section
      className={'bd' + (bg.dark && !inArchive ? ' on-dark' : '')}
      style={{ '--bd-bg': inArchive ? backgrounds[0].css : bg.css } as CSSProperties}
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
          aria-expanded={menu?.kind === 'picker'}
          onClick={(e) =>
            setMenu({ kind: 'picker', anchor: e.currentTarget.getBoundingClientRect() })
          }
        >
          <span className="bd-picker-mark" style={{ background: inArchive ? '#66727f' : bg.css }}>
            {inArchive ? <Archive size={14} /> : <Columns3 size={14} />}
          </span>
          <strong>{inArchive ? 'Archivados' : (board?.name ?? 'Tableros')}</strong>
          {editingTemplate && <span className="bd-picker-tag">Plantilla</span>}
          <ChevronDown size={15} />
        </button>
        {board && !inArchive && api.status === 'ready' && (
          <span className="bd-stats">
            {activeCount} {activeCount === 1 ? 'tarjeta' : 'tarjetas'}
            {doneCount > 0 && ` · ${doneCount} ${doneCount === 1 ? 'completada' : 'completadas'}`}
          </span>
        )}
        <div className="bd-bar-end">
          {(board || inArchive) && (
            <label className="bd-search">
              <Search size={15} aria-hidden="true" />
              <input
                value={query}
                placeholder={inArchive ? 'Buscar en archivados…' : 'Filtrar tarjetas…'}
                aria-label="Filtrar tarjetas"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.stopPropagation();
                    setQuery('');
                  }
                }}
              />
              {query && (
                <button type="button" aria-label="Borrar el filtro" onClick={() => setQuery('')}>
                  <X size={13} />
                </button>
              )}
            </label>
          )}
          {board && !inArchive && (
            <>
              <button
                type="button"
                className={'bd-icon' + (hideDone ? ' on' : '')}
                aria-pressed={hideDone}
                title={hideDone ? 'Mostrar las completadas' : 'Ocultar las completadas'}
                aria-label={hideDone ? 'Mostrar las completadas' : 'Ocultar las completadas'}
                onClick={() => setHideDone((v) => !v)}
              >
                {hideDone ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
              <button
                type="button"
                className="bd-btn primary"
                onClick={() => setDraftAt(cols.length)}
              >
                <Plus size={16} /> Columna
              </button>
              <button
                type="button"
                className="bd-icon"
                aria-label="Opciones del tablero"
                aria-expanded={menu?.kind === 'board'}
                onClick={(e) =>
                  setMenu({ kind: 'board', anchor: e.currentTarget.getBoundingClientRect() })
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
            <b>Editando la plantilla «{board.name}».</b> Los cambios se guardan solos y se usan en
            los tableros nuevos que crees con ella.
          </p>
          <button type="button" className="bd-btn sm" onClick={() => setGallery('m:' + board.id)}>
            <Plus size={14} /> Crear tablero con ella
          </button>
          <button
            type="button"
            className="bd-btn primary sm"
            onClick={() => pick(list.boards?.[0]?.id ?? '')}
          >
            <Check size={14} /> Listo
          </button>
        </div>
      )}

      {board && !inArchive && !api.extras && api.status === 'ready' && (
        <p className="bd-notice">
          Para completar, archivar y dar color, ejecuta <code>{BOARD_SQL}</code> en el SQL Editor de
          Supabase.
        </p>
      )}

      <div className="bd-main" ref={main}>
        {list.error ? (
          <p className="bd-error" role="alert">
            {list.error}
          </p>
        ) : list.boards === null ? (
          <Skeleton />
        ) : inArchive ? (
          <ArchiveView
            cards={archive.cards}
            missing={archive.missing}
            query={query}
            isDone={isDone}
            linked={linked}
            onOpen={(c) => setOpenId(c.id)}
            onUnarchive={unarchive}
            onDelete={deleteArchived}
          />
        ) : !board ? (
          <Welcome
            onCreate={async (name) => {
              const id = await list.create(name);
              if (id) pick(id);
            }}
            onTemplates={(key) => setGallery(key)}
          />
        ) : api.status === 'loading' ? (
          <Skeleton />
        ) : api.status === 'error' ? (
          <p className="bd-error" role="alert">
            No se pudo cargar el tablero.{' '}
            <button type="button" onClick={() => void api.reload()}>
              Reintentar
            </button>
          </p>
        ) : (
          <div
            ref={canvas}
            className="bd-canvas"
            onPointerDown={(e) => {
              if (e.button !== 0 || e.pointerType === 'touch' || e.target !== e.currentTarget)
                return;
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
              e.currentTarget.classList.add('panning');
              e.currentTarget.scrollLeft = p.left - dx;
            }}
            onLostPointerCapture={(e) => {
              pan.current = null;
              e.currentTarget.classList.remove('panning');
            }}
            onDoubleClick={(e) => {
              const t = e.target as HTMLElement;
              if (t !== e.currentTarget && !t.classList.contains('bd-canvas-end')) return;
              setDraftAt(insertIndex(e.clientX));
            }}
            onWheel={(e) => {
              const el = canvas.current;
              if (!el || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
              const stack = (e.target as HTMLElement).closest<HTMLElement>('[data-stack]');
              if (stack && stack.scrollHeight > stack.clientHeight + 1) return;
              el.scrollLeft += e.deltaY;
            }}
          >
            {columns}
            {draftAt === null && !drag && (
              <button type="button" className="bd-addlist" onClick={() => setDraftAt(cols.length)}>
                <Plus size={16} /> Añade otra columna
                <small>o haz doble clic en el fondo</small>
              </button>
            )}
            {!cols.length && draftAt === null && (
              <div className="bd-empty-hint">
                <Columns3 size={22} />
                <strong>Este tablero no tiene columnas</strong>
                <span>Haz doble clic en cualquier parte del fondo para crear una, justo ahí.</span>
              </div>
            )}
            <div className="bd-canvas-end" aria-hidden="true" />
          </div>
        )}
      </div>

      {/* Lo que arrastras, siguiendo al puntero */}
      {drag &&
        createPortal(
          <div
            className="bd-ghost"
            ref={dnd.ghost}
            style={{ width: drag.w, transform: dnd.ghostAt() }}
            aria-hidden="true"
          >
            {drag.kind === 'card'
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
                  return (
                    <div
                      className={
                        'bd-card lifted' + (isDone(c) ? ' done' : '') + (tone ? ' tinted' : '')
                      }
                      style={tone ? ({ '--cc': tone.c } as CSSProperties) : undefined}
                    >
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
                  if (view.folded(col.id))
                    return (
                      <section
                        className={'bd-list folded lifted' + (tone ? ' toned' : '')}
                        style={tone ? ({ '--lc': tone.c } as CSSProperties) : undefined}
                      >
                        <div className="bd-fold">
                          <UnfoldHorizontal size={15} className="bd-fold-icon" />
                          <span className="bd-list-count">{byList.get(col.id)?.length ?? 0}</span>
                          <span className="bd-fold-name">{col.name}</span>
                        </div>
                      </section>
                    );
                  const some = (byList.get(col.id) ?? []).slice(0, 7);
                  return (
                    <section
                      className={'bd-list lifted' + (tone ? ' toned' : '')}
                      style={
                        {
                          maxHeight: Math.min(drag.h, 560),
                          ...(tone && { '--lc': tone.c }),
                        } as CSSProperties
                      }
                    >
                      <header className="bd-list-head">
                        <span className="bd-list-title">
                          {tone && <i className="bd-list-dot" />}
                          <span>{col.name}</span>
                        </span>
                        <span className="bd-list-count">{byList.get(col.id)?.length ?? 0}</span>
                      </header>
                      <div className="bd-stack">
                        {some.map((c) => (
                          <div key={c.id} className={'bd-card' + (isDone(c) ? ' done' : '')}>
                            <div className="bd-card-row">
                              <span className="bd-done" aria-pressed={isDone(c)}>
                                <Check size={11} strokeWidth={3.2} />
                              </span>
                              <div className="bd-card-body">
                                <span className="bd-card-title">{c.title}</span>
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
      {menu?.kind === 'picker' && (
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
              const on = !inArchive && b.id === board?.id;
              return (
                <button
                  type="button"
                  key={b.id}
                  className={'bd-pick-item' + (on ? ' on' : '')}
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
            className={'bd-pick-item' + (inArchive ? ' on' : '')}
            onClick={() => pick(ARCHIVE)}
          >
            <i className="arch">
              <Archive size={13} />
            </i>
            <span>Archivados</span>
            {list.archived > 0 && <small>{list.archived}</small>}
            {inArchive && <Check size={15} />}
          </button>
          {list.templates.length > 0 && (
            <>
              <p className="bd-pop-label">Mis plantillas</p>
              <div className="bd-pick-list short">
                {list.templates.map((t) => {
                  const on = !inArchive && t.id === board?.id;
                  return (
                    <button
                      type="button"
                      key={t.id}
                      className={'bd-pick-item' + (on ? ' on' : '')}
                      title="Editar la plantilla"
                      onClick={() => pick(t.id)}
                    >
                      <i className="tpl" style={{ background: backgroundOf(t.background).css }}>
                        <LayoutTemplate size={12} />
                      </i>
                      <span>{t.name}</span>
                      {on ? <Check size={15} /> : <Pencil size={13} className="bd-pick-go" />}
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
              setGallery('blank');
            }}
          >
            <i className="new">
              <Plus size={14} />
            </i>
            <span>Nuevo tablero</span>
            <small>Plantillas</small>
          </button>
        </Popover>
      )}

      {menu?.kind === 'board' && board && (
        <Popover anchor={menu.anchor} width={286} label="Opciones del tablero" onClose={close}>
          <p className="bd-pop-label">Nombre</p>
          <form
            className="bd-pop-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
              if (name && name !== board.name) list.update(board.id, { name: name.slice(0, 120) });
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
                key={b.key || 'base'}
                title={b.label}
                aria-label={'Fondo ' + b.label}
                aria-pressed={(board.background ?? '') === b.key}
                style={{ background: b.css }}
                onClick={() => list.update(board.id, { background: b.key })}
              >
                {(board.background ?? '') === b.key && <Check size={14} />}
              </button>
            ))}
          </div>
          <div className="bd-pop-sep" />
          {cols.some((c) => view.folded(c.id)) ? (
            <MenuItem
              icon={<UnfoldHorizontal size={15} />}
              onClick={() => {
                view.setFolded(
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
                view.setFolded(
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
            {hideDone ? 'Mostrar las completadas' : 'Ocultar las completadas'}
          </MenuItem>
          {!editingTemplate && (
            <MenuItem
              icon={<Archive size={15} />}
              hint={list.archived ? String(list.archived) : undefined}
              onClick={() => pick(ARCHIVE)}
            >
              Ver archivados
            </MenuItem>
          )}
          <div className="bd-pop-sep" />
          {editingTemplate ? (
            <MenuItem
              icon={<Plus size={15} />}
              onClick={() => (close(), setGallery('m:' + board.id))}
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
          <MenuItem
            icon={<Trash2 size={15} />}
            danger
            onClick={() => (close(), void deleteBoard())}
          >
            {editingTemplate ? 'Eliminar plantilla' : 'Eliminar tablero'}
          </MenuItem>
        </Popover>
      )}

      {menu?.kind === 'move' && moveCol && (
        <Popover anchor={menu.anchor} width={286} label="Mover a otro tablero" onClose={close}>
          <MoveColumnMenu
            column={moveCol}
            boards={otherBoards}
            onBack={() => setMenu({ kind: 'list', id: moveCol.id, anchor: menu.anchor })}
            onMove={(target, rank) => {
              close();
              moveToBoard(moveCol.id, target, rank);
            }}
          />
        </Popover>
      )}

      {menu?.kind === 'list' && menuCol && (
        <Popover anchor={menu.anchor} label="Opciones de la columna" onClose={close}>
          <p className="bd-pop-title">{menuCol.name}</p>
          <MenuItem icon={<Plus size={15} />} onClick={() => (close(), setComposer(menuCol.id))}>
            Añadir tarjeta
          </MenuItem>
          <MenuItem icon={<Pencil size={15} />} onClick={() => (close(), setRenaming(menuCol.id))}>
            Renombrar
          </MenuItem>
          <MenuItem
            icon={<FoldHorizontal size={15} />}
            onClick={() => {
              close();
              if (composer === menuCol.id) setComposer(null);
              view.setFolded([menuCol.id], true);
            }}
          >
            Plegar columna
          </MenuItem>
          <MenuItem
            icon={<FolderInput size={15} />}
            disabled={!otherBoards.length}
            hint={otherBoards.length ? undefined : 'No hay otros'}
            onClick={() => setMenu({ kind: 'move', id: menuCol.id, anchor: menu.anchor })}
          >
            Mover a otro tablero
          </MenuItem>
          {editingTemplate ? null : list.pinned?.id === menuCol.id ? (
            <MenuItem
              icon={<PinOff size={15} />}
              onClick={() => {
                close();
                if (list.pin(null)) notify('La columna ya no está en Mi espacio.');
              }}
            >
              Desanclar de Mi espacio
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Pin size={15} />}
              disabled={Boolean(list.pinned)}
              hint={list.pinned ? 'Ya hay una' : undefined}
              onClick={() => {
                close();
                if (list.pin({ id: menuCol.id, name: menuCol.name, board_id: menuCol.board_id }))
                  notify(`«${menuCol.name.slice(0, 40)}» quedó anclada en Mi espacio.`);
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
          <p className="bd-pop-label">Color</p>
          <div className="bd-tones">
            <button
              type="button"
              className={'none' + (!menuCol.color ? ' on' : '')}
              title="Sin color"
              aria-label="Sin color"
              onClick={() => api.updateColumn(menuCol.id, { color: '' })}
            />
            {tones.map((t) => (
              <button
                type="button"
                key={t.key}
                className={menuCol.color === t.key ? 'on' : ''}
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
            onClick={() => (close(), sortList(menuCol.id, 'due'))}
          >
            Ordenar por fecha límite
          </MenuItem>
          <MenuItem
            icon={<ArrowDownAZ size={15} />}
            disabled={menuCards.length < 2}
            onClick={() => (close(), sortList(menuCol.id, 'name'))}
          >
            Ordenar de la A a la Z
          </MenuItem>
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

      {gallery !== null && (
        <TemplateGallery
          list={list}
          initial={gallery}
          onCreated={(id) => pick(id)}
          onEdit={(id) => pick(id)}
          onClose={() => setGallery(null)}
        />
      )}

      {openCard && (
        <CardEditor
          key={openCard.id}
          card={openCard}
          columns={inArchive ? [] : cols}
          done={isDone(openCard)}
          extras={inArchive || api.extras}
          onPatch={patchOpen}
          onToggleDone={() => toggleDone(openCard, patchOpen)}
          onArchive={() => (inArchive ? unarchive(openCard) : archiveCard(openCard))}
          onDelete={() => {
            setOpenId(null);
            if (inArchive) deleteArchived(openCard);
            else deleteCard(openCard);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
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
    if (save) onDone(v.replace(/\s+/g, ' ').trim());
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
        if (e.key === 'Enter') {
          e.preventDefault();
          end(true);
        } else if (e.key === 'Escape') {
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
/** Máximo de tarjetas de una vez al pegar. */
const PASTE_MAX = 100;
/** Viñetas de lista al inicio de una línea («- », «• », «1. », «[ ] »). «---» no cuenta. */
const BULLET = /^\s*(?:[-*•·▪◦□■☐✓✔]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?|^\s*\[[ xX]\]\s+/;
const linesOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(BULLET, '').trim())
    .filter(Boolean);

/**
 * Añadir tarjetas escribiendo: Enter añade y deja el campo listo para la siguiente. Si pegas un
 * texto con varias líneas, pregunta si son varias tarjetas (una por línea) o una sola.
 */
function Composer({
  onAdd,
  onClose,
}: {
  onAdd: (items: NewCardInput[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ text, pending, onClose });
  latest.current = { text, pending, onClose };
  useEffect(() => {
    form.current?.scrollIntoView({ block: 'nearest' });
    // Un clic fuera con el campo vacío lo cierra (con texto o algo pegado, lo deja por si vuelves).
    const down = (e: PointerEvent) => {
      const { text, pending, onClose } = latest.current;
      if (!form.current?.contains(e.target as Node) && !text.trim() && !pending) onClose();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, []);
  useEffect(() => {
    if (pending) requestAnimationFrame(() => form.current?.scrollIntoView({ block: 'nearest' }));
  }, [pending]);

  const lines = text.split('\n').filter((l) => l.trim()).length;
  const done = () => {
    setText('');
    setPending(null);
    requestAnimationFrame(() => {
      area.current?.focus();
      form.current?.scrollIntoView({ block: 'nearest' });
    });
  };
  const submit = () => {
    const titles = text
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!titles.length) return;
    onAdd(titles);
    done();
  };

  // ── Lo pegado ──
  const asMany = () => {
    if (!pending) return;
    onAdd(pending.lines.slice(0, PASTE_MAX));
    done();
  };
  /** Una sola: la primera línea es el título y el resto, la descripción. */
  const asOne = () => {
    if (!pending) return;
    const all = pending.text.replace(/\r\n?/g, '\n').trim();
    const [first, ...rest] = all.split('\n');
    const title = first.trim();
    const body = rest
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    onAdd([title.length > 240 ? { title: title.slice(0, 240), body: all } : { title, body }]);
    done();
  };
  /** Pegarlo tal cual en el campo, para editarlo antes. */
  const asText = () => {
    if (!pending) return;
    const value = pending.text.replace(/\r\n?/g, '\n').slice(0, 4000);
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

  const many = pending ? Math.min(pending.lines.length, PASTE_MAX) : 0;
  return (
    <form
      ref={form}
      className={'bd-composer' + (pending ? ' asking' : '')}
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
        maxLength={4000}
        value={text}
        readOnly={Boolean(pending)}
        placeholder="Escribe un título para esta tarjeta…"
        aria-label="Título de la tarjeta nueva"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const clip = e.clipboardData.getData('text');
          if (!/\r?\n/.test(clip.trim())) return;
          const el = e.currentTarget;
          const merged = text.slice(0, el.selectionStart) + clip + text.slice(el.selectionEnd);
          const found = linesOf(merged);
          if (found.length < 2) return;
          e.preventDefault();
          setPending({ text: merged, lines: found });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />

      {pending ? (
        <div
          className="bd-paste"
          role="dialog"
          aria-label="¿Cómo añado lo que pegaste?"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
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
            <button type="button" className="bd-paste-x" aria-label="Cancelar" onClick={dismiss}>
              <X size={14} />
            </button>
          </header>

          <ol className="bd-paste-preview">
            {pending.lines.slice(0, 3).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
            {pending.lines.length > 3 && <li className="more">y {pending.lines.length - 3} más</li>}
          </ol>

          <button type="button" className="bd-paste-opt primary" autoFocus onClick={asMany}>
            <SquareStack size={16} />
            <span>
              <b>
                {many} {many === 1 ? 'tarjeta' : 'tarjetas'}
              </b>
              <small>
                {pending.lines.length > PASTE_MAX
                  ? `Una por línea (las primeras ${PASTE_MAX})`
                  : 'Una por línea'}
              </small>
            </span>
            <kbd>Enter</kbd>
          </button>
          <button type="button" className="bd-paste-opt" onClick={asOne}>
            <RectangleHorizontal size={16} />
            <span>
              <b>Una sola tarjeta</b>
              <small>La primera línea es el título; el resto, la descripción</small>
            </span>
          </button>
          <button type="button" className="bd-paste-text" onClick={asText}>
            <TextCursorInput size={13} /> Pegar como texto para editarlo
          </button>
        </div>
      ) : (
        <div className="bd-composer-foot">
          <button type="submit" className="bd-btn primary" disabled={!lines}>
            {lines > 1 ? `Añadir ${lines} tarjetas` : 'Añadir tarjeta'}
          </button>
          <button type="button" className="bd-icon" aria-label="Cancelar" onClick={onClose}>
            <X size={17} />
          </button>
          <small>
            {lines > 1 ? 'Una tarjeta por línea' : 'Enter añade · Shift+Enter, otra línea'}
          </small>
        </div>
      )}
    </form>
  );
}

/** Columna nueva en el sitio (donde hiciste doble clic o al final). */
function NewColumn({ onAdd, onClose }: { onAdd: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const box = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ name, onClose });
  latest.current = { name, onClose };
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !latest.current.name.trim())
        latest.current.onClose();
    };
    // Tras el doble clic que la creó.
    const t = window.setTimeout(() => document.addEventListener('pointerdown', down, true), 50);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', down, true);
    };
  }, []);
  const submit = () => {
    const n = name.replace(/\s+/g, ' ').trim();
    if (!n) return;
    onAdd(n);
    setName('');
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
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <div className="bd-composer-foot">
        <button type="submit" className="bd-btn primary" disabled={!name.trim()}>
          Añadir columna
        </button>
        <button type="button" className="bd-icon" aria-label="Cancelar" onClick={onClose}>
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
}: {
  onCreate: (name: string) => Promise<void>;
  /** Abre la galería de plantillas (con una preseleccionada). */
  onTemplates: (key: string) => void;
}) {
  const [name, setName] = useState('');
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
        Un tablero reúne columnas y tarjetas: ideas, proyectos, producciones… Empieza en blanco o
        con una plantilla lista.
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
        <button type="submit" className="bd-btn primary" disabled={busy || !name.trim()}>
          <Plus size={16} /> Crear en blanco
        </button>
      </form>
      <div className="bd-welcome-tpl">
        <small>O empieza con una plantilla</small>
        <div>
          {builtinTemplates.map((t) => (
            <button type="button" key={t.id} onClick={() => onTemplates('b:' + t.id)}>
              <i style={{ background: backgroundOf(t.spec.background).css }} />
              {t.name}
            </button>
          ))}
        </div>
      </div>
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
