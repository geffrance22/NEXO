import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  LayoutGrid,
  Maximize,
  Minus,
  Pencil,
  Plus,
  Sparkles,
  StickyNote,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { ChatPanel } from '../components/ChatPanel';
import { useAssistant } from '../hooks/useAssistant';
import { toneVars } from '../library/Collection';
import { Avatar } from '../people/Avatar';
import { NotebooksMissing, notebookVars } from './Cuadernos';
import { askAboutNotebook, fetchExtras, type Extras } from './digest';
import { ItemPicker } from './ItemPicker';
import {
  arrange,
  CARD_H,
  CARD_W,
  freeSpots,
  stickyColors,
  type Notebook,
  type NotebookItem,
  type StickyColor,
} from './model';
import { NotebookForm } from './NotebookForm';
import { resolveItem, type CardModel } from './resolve';
import { addToNotebook, updateNotebook, useCuadernos } from './useCuadernos';
import './cuadernos.css';

type View = { x: number; y: number; k: number };
const MIN_K = 0.2;
const MAX_K = 2.5;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
const viewKey = (id: string) => 'nexo-nb-view-' + id;
const EMPTY: Extras = { readings: new Map(), notes: new Map() };

const PROMPTS = [
  '¿Qué ideas me da este cuaderno?',
  'Resume lo más importante de lo que reuní',
  '¿Qué conexiones ves entre estos elementos?',
  'Sugiéreme un siguiente paso concreto',
];

function savedView(id: string): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(viewKey(id)) ?? 'null');
    return v && [v.x, v.y, v.k].every(Number.isFinite) ? { x: v.x, y: v.y, k: clampK(v.k) } : null;
  } catch {
    return null;
  }
}

/** Un cuaderno abierto: lienzo libre con sus elementos y una IA que solo ve lo que hay en él. */
export function NotebookView({ id }: { id: string }) {
  const { workspace, go } = useApp();
  const { list, missing } = useCuadernos();
  const nb = list?.find((n) => n.id === id) ?? null;
  const [extras, setExtras] = useState<Extras | null>(null);

  // Lecturas y notas rápidas se piden aparte (solo las que están en el cuaderno).
  const remoteKey = nb
    ? nb.items
        .filter((i) => i.type === 'reading' || i.type === 'note')
        .map((i) => i.key)
        .sort()
        .join()
    : null;
  const itemsRef = useRef<NotebookItem[]>([]);
  itemsRef.current = nb?.items ?? [];
  useEffect(() => {
    if (remoteKey === null) return;
    let live = true;
    void fetchExtras(itemsRef.current).then((x) => live && setExtras(x));
    return () => {
      live = false;
    };
  }, [remoteKey]);

  const latest = useRef({ nb, workspace, extras });
  latest.current = { nb, workspace, extras };
  const assistant = useAssistant({
    store: 'nexo-chat-nb-' + id,
    ask: (q, history) => {
      const cur = latest.current;
      if (!cur.nb) return Promise.reject(new Error('Este cuaderno ya no existe.'));
      if (!cur.nb.items.length)
        return Promise.reject(
          new Error('El cuaderno está vacío: añade algo para que la IA tenga de dónde sacar.'),
        );
      return askAboutNotebook(cur.nb, cur.workspace, cur.extras ?? EMPTY, q, history);
    },
  });

  const back = (
    <button type="button" className="cz-back" onClick={() => go('Agenda')}>
      <ArrowLeft size={16} /> Cuadernos
    </button>
  );
  if (missing)
    return (
      <div className="cz-page">
        {back}
        <NotebooksMissing />
      </div>
    );
  if (!list)
    return (
      <div className="cz-page">
        {back}
        <div className="cz-stage skeleton" />
      </div>
    );
  if (!nb)
    return (
      <div className="cz-page">
        {back}
        <p className="lt-none">Este cuaderno no existe o se eliminó.</p>
      </div>
    );
  return <Board key={nb.id} nb={nb} extras={extras} back={back} assistant={assistant} />;
}

function Board({
  nb,
  extras,
  back,
  assistant,
}: {
  nb: Notebook;
  extras: Extras | null;
  back: ReactNode;
  assistant: ReturnType<typeof useAssistant>;
}) {
  const { workspace, go, notify, viewEntry, peekPerson } = useApp();
  const stage = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const initial = useMemo(() => savedView(nb.id), [nb.id]);
  const [view, setView] = useState<View>(initial ?? { x: 80, y: 80, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [drag, setDrag] = useState<{
    key: string;
    x: number;
    y: number;
  } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [form, setForm] = useState(false);
  const [chat, setChat] = useState(false);
  const fitNext = useRef(!initial);
  const items = nb.items;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const models = useMemo(
    () => new Map(items.map((it) => [it.key, resolveItem(it, workspace, extras)])),
    [items, workspace, extras],
  );

  const save = useCallback(
    async (next: NotebookItem[]) => {
      const ok = await updateNotebook(nb.id, { items: next });
      if (ok !== true) notify(ok);
    },
    [nb.id, notify],
  );

  // ───── Vista: guardar, ajustar y hacer zoom ─────
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(viewKey(nb.id), JSON.stringify(view));
      } catch {
        /* sin almacenamiento: la vista dura mientras sigas aquí */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [view, nb.id]);

  const fit = useCallback(() => {
    const el = stage.current;
    const list = itemsRef.current;
    if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (!list.length) {
      setView({ x: W / 2 - CARD_W / 2, y: H / 3 - CARD_H / 2, k: 1 });
      return;
    }
    const minX = Math.min(...list.map((i) => i.x));
    const minY = Math.min(...list.map((i) => i.y));
    const maxX = Math.max(...list.map((i) => i.x + CARD_W));
    const maxY = Math.max(...list.map((i) => i.y + (heights.current.get(i.key) ?? CARD_H)));
    const pad = 64;
    const k = clampK(Math.min(1, (W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY)));
    setView({
      x: (W - (maxX - minX) * k) / 2 - minX * k,
      y: (H - (maxY - minY) * k) / 2 - minY * k,
      k,
    });
  }, []);

  // Alto real de cada tarjeta (para ordenar, ajustar y buscar huecos).
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>('[data-key]').forEach((card) => {
      heights.current.set(card.dataset.key!, card.offsetHeight);
    });
    if (fitNext.current) {
      fitNext.current = false;
      fit();
    }
  });

  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const el = stage.current;
    if (!el) return;
    const v = viewRef.current;
    const cx = px ?? el.clientWidth / 2;
    const cy = py ?? el.clientHeight / 2;
    const k = clampK(v.k * factor);
    setView({
      x: cx - ((cx - v.x) * k) / v.k,
      y: cy - ((cy - v.y) * k) / v.k,
      k,
    });
  }, []);

  // Rueda: con Ctrl (o pellizco en el trackpad) acerca; sin él, se desplaza.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.cz-chat, textarea')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  /** Centro de lo que ves, en coordenadas del lienzo: ahí entra lo nuevo. */
  const center = () => {
    const el = stage.current;
    const v = viewRef.current;
    const W = el?.clientWidth ?? 800;
    const H = el?.clientHeight ?? 600;
    return { x: (W / 2 - v.x) / v.k, y: (H / 2 - v.y) / v.k };
  };

  // ───── Gestos: arrastrar el fondo mueve el lienzo; arrastrar una tarjeta la mueve ─────
  type Gesture =
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | {
        kind: 'drag';
        key: string;
        sx: number;
        sy: number;
        ix: number;
        iy: number;
        moved: boolean;
      }
    | {
        kind: 'pinch';
        d0: number;
        k0: number;
        mx: number;
        my: number;
        vx: number;
        vy: number;
      };
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const pinchInfo = () => {
    const [a, b] = [...pointers.current.values()];
    const rect = stage.current!.getBoundingClientRect();
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mx: (a.x + b.x) / 2 - rect.left,
      my: (a.y + b.y) / 2 - rect.top,
    };
  };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, textarea, input, [data-nodrag], .cz-chat')) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = viewRef.current;
    if (pointers.current.size === 2) {
      const p = pinchInfo();
      setDrag(null);
      gesture.current = {
        kind: 'pinch',
        d0: p.d,
        k0: v.k,
        mx: p.mx,
        my: p.my,
        vx: v.x,
        vy: v.y,
      };
      return;
    }
    const card = target.closest<HTMLElement>('[data-key]');
    const it = card ? itemsRef.current.find((i) => i.key === card.dataset.key) : undefined;
    gesture.current = it
      ? {
          kind: 'drag',
          key: it.key,
          sx: e.clientX,
          sy: e.clientY,
          ix: it.x,
          iy: it.y,
          moved: false,
        }
      : { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const p = pinchInfo();
      const k = clampK((g.k0 * p.d) / g.d0);
      // El punto entre los dedos se queda donde estaba (y sigue a los dedos si se mueven).
      setView({
        x: p.mx - ((g.mx - g.vx) * k) / g.k0,
        y: p.my - ((g.my - g.vy) * k) / g.k0,
        k,
      });
      return;
    }
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (g.kind === 'pan') {
      setView((v) => ({ ...v, x: g.vx + dx, y: g.vy + dy }));
      return;
    }
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    const k = viewRef.current.k;
    setDrag({
      key: g.key,
      x: Math.round(g.ix + dx / k),
      y: Math.round(g.iy + dy / k),
    });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g?.kind === 'pinch') {
      // Al levantar un dedo, el otro sigue moviendo el lienzo.
      const rest = [...pointers.current.values()][0];
      const v = viewRef.current;
      gesture.current = rest ? { kind: 'pan', sx: rest.x, sy: rest.y, vx: v.x, vy: v.y } : null;
      return;
    }
    gesture.current = null;
    if (g?.kind !== 'drag') return;
    if (!g.moved) {
      if (e.type === 'pointerup') open(g.key);
      return;
    }
    const k = viewRef.current.k;
    const x = Math.round(g.ix + (e.clientX - g.sx) / k);
    const y = Math.round(g.iy + (e.clientY - g.sy) / k);
    setDrag(null);
    // Lo que se suelta queda encima de lo demás.
    const moved = itemsRef.current.find((i) => i.key === g.key);
    if (!moved) return;
    void save([...itemsRef.current.filter((i) => i.key !== g.key), { ...moved, x, y }]);
  }

  // ───── Acciones ─────
  function open(key: string) {
    const it = itemsRef.current.find((i) => i.key === key);
    if (!it) return;
    switch (it.type) {
      case 'entry': {
        const e = workspace.entries.find((x) => x.id === it.id);
        if (e) viewEntry(e);
        return;
      }
      case 'person': {
        const p = workspace.people.find((x) => x.id === it.id);
        if (p) peekPerson(p);
        return;
      }
      case 'place': {
        const p = workspace.places.find((x) => x.id === it.id);
        if (p) go('Lugares', p);
        return;
      }
      case 'episode': {
        const ep = workspace.episodes.find((x) => x.id === it.id);
        if (ep) go('Episodios', ep);
        return;
      }
      case 'reading':
        if (extras?.readings.has(it.id)) go('Lecturas', { id: it.id });
        return;
      case 'note':
        if (extras?.notes.has(it.id)) go('Libroteca', { id: it.id });
        return;
      case 'text':
        setEditing(it.key);
        return;
    }
  }

  function remove(key: string) {
    const gone = itemsRef.current.find((i) => i.key === key);
    if (!gone) return;
    void save(itemsRef.current.filter((i) => i.key !== key));
    if (editing === key) setEditing(null);
    notify(
      gone.type === 'text'
        ? 'Ficha eliminada.'
        : 'Quitado del cuaderno (el original sigue en su sitio).',
      {
        label: 'Deshacer',
        icon: 'undo',
        run: () => void save([...itemsRef.current.filter((i) => i.key !== key), gone]),
      },
    );
  }

  function patchItem(key: string, changes: Partial<NotebookItem>) {
    const it = itemsRef.current.find((i) => i.key === key);
    if (!it) return;
    void save(itemsRef.current.map((i) => (i.key === key ? { ...i, ...changes } : i)));
  }

  function addSticky() {
    const key = crypto.randomUUID();
    const [spot] = freeSpots(itemsRef.current, 1, center(), heights.current);
    void save([
      ...itemsRef.current,
      {
        key,
        type: 'text',
        id: key,
        x: spot?.x ?? 0,
        y: spot?.y ?? 0,
        added_at: new Date().toISOString(),
        text: '',
        color: 'amarillo',
      },
    ]);
    setEditing(key);
  }

  async function addRefs(refs: { type: NotebookItem['type']; id: string }[]) {
    setPicker(false);
    const n = await addToNotebook(nb.id, refs, center(), heights.current);
    if (typeof n === 'string') notify(n);
    else if (n) notify(n === 1 ? 'Añadido al cuaderno.' : `${n} elementos añadidos.`);
  }

  function tidy() {
    const kindOf = (it: NotebookItem) =>
      it.type === 'entry' ? (models.get(it.key)?.label ?? '') : '';
    fitNext.current = true;
    void save(arrange(itemsRef.current, heights.current, kindOf));
  }

  const counts = items.filter((i) => i.type !== 'text').length;
  const stickies = items.length - counts;
  const grid = 24 * view.k;

  return (
    <div className="cz-page" style={notebookVars(nb)}>
      <header className="cz-bar">
        <div className="cz-bar-start">
          {back}
          <span className="cz-bar-title">
            <i aria-hidden="true" />
            <span>
              <strong>{nb.name}</strong>
              <small>
                {counts} {counts === 1 ? 'acceso directo' : 'accesos directos'}
                {stickies > 0 && ` · ${stickies} ${stickies === 1 ? 'ficha' : 'fichas'}`}
                {nb.description && ` · ${nb.description}`}
              </small>
            </span>
            <button
              type="button"
              className="cz-icon"
              aria-label="Editar cuaderno"
              title="Editar cuaderno"
              onClick={() => setForm(true)}
            >
              <Pencil size={14} />
            </button>
          </span>
        </div>
        <div className="cz-bar-end">
          <button
            type="button"
            className="lt-add soft"
            onClick={addSticky}
            title="Escribir una ficha"
          >
            <StickyNote size={15} /> Ficha
          </button>
          <button
            type="button"
            className="lt-add soft"
            onClick={tidy}
            disabled={items.length < 2}
            title="Ordenar el lienzo por tipo"
          >
            <LayoutGrid size={15} /> Ordenar
          </button>
          <button
            type="button"
            className={'lt-add soft cz-ai' + (chat ? ' on' : '')}
            aria-pressed={chat}
            onClick={() => setChat((v) => !v)}
          >
            <Sparkles size={15} /> Preguntar a la IA
          </button>
          <button type="button" className="lt-add" onClick={() => setPicker(true)}>
            <Plus size={16} /> Añadir
          </button>
        </div>
      </header>

      <div
        ref={stage}
        className={'cz-stage' + (drag ? ' dragging' : '') + (chat ? ' with-chat' : '')}
        style={
          {
            backgroundSize: `${grid}px ${grid}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          } as CSSProperties
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="cz-world"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          }}
        >
          {items.map((it) => {
            const at = drag?.key === it.key ? drag : it;
            return (
              <Card
                key={it.key}
                it={it}
                model={models.get(it.key)!}
                x={at.x}
                y={at.y}
                dragging={drag?.key === it.key}
                editing={editing === it.key}
                onOpen={() => open(it.key)}
                onRemove={() => remove(it.key)}
                onText={(text) => {
                  setEditing(null);
                  if (text !== (it.text ?? '')) patchItem(it.key, { text });
                }}
                onColor={(color) => patchItem(it.key, { color })}
              />
            );
          })}
        </div>

        {!items.length && (
          <div className="cz-empty">
            <strong>Un lienzo en blanco.</strong>
            <p>
              Reúne aquí encuentros, libros, personas, lecturas o pendientes. Muévelos como quieras
              y pregúntale a la IA solo sobre ellos.
            </p>
            <div>
              <button type="button" className="lt-add" onClick={() => setPicker(true)}>
                <Plus size={16} /> Añadir elementos
              </button>
              <button type="button" className="lt-add soft" onClick={addSticky}>
                <StickyNote size={15} /> Escribir una ficha
              </button>
            </div>
          </div>
        )}

        <div className="cz-zoom" data-nodrag>
          <button type="button" aria-label="Alejar" title="Alejar" onClick={() => zoomAt(1 / 1.2)}>
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="cz-zoom-n"
            title="Tamaño real"
            onClick={() => zoomAt(1 / view.k)}
          >
            {Math.round(view.k * 100)}%
          </button>
          <button type="button" aria-label="Acercar" title="Acercar" onClick={() => zoomAt(1.2)}>
            <Plus size={15} />
          </button>
          <button type="button" aria-label="Ver todo" title="Ver todo" onClick={fit}>
            <Maximize size={14} />
          </button>
        </div>

        {chat && (
          <ChatPanel
            assistant={assistant}
            onClose={() => setChat(false)}
            className="cz-chat"
            title={nb.name}
            intro={{
              heading: 'Pregúntale a este cuaderno.',
              text: `Solo uso lo que reuniste aquí (${counts + stickies} ${counts + stickies === 1 ? 'elemento' : 'elementos'}): ideas, recuerdos, conexiones o sugerencias.`,
            }}
            prompts={PROMPTS}
            placeholder="¿Qué quieres saber de este cuaderno?"
          />
        )}
      </div>

      {picker && <ItemPicker notebook={nb} onAdd={addRefs} onClose={() => setPicker(false)} />}
      {form && <NotebookForm notebook={nb} onClose={() => setForm(false)} />}
    </div>
  );
}

function Card({
  it,
  model,
  x,
  y,
  dragging,
  editing,
  onOpen,
  onRemove,
  onText,
  onColor,
}: {
  it: NotebookItem;
  model: CardModel;
  x: number;
  y: number;
  dragging: boolean;
  editing: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onText: (text: string) => void;
  onColor: (c: StickyColor) => void;
}) {
  const sticky = it.type === 'text';
  const area = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(it.text ?? '');
  useEffect(() => {
    if (!editing) return;
    setDraft(it.text ?? '');
    const el = area.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // Solo al empezar a editar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onRemove();
    }
  };

  const stickyTone = stickyColors[it.color ?? 'amarillo'];
  const style = {
    left: x,
    top: y,
    width: CARD_W,
    ...(sticky
      ? ({
          '--sb': stickyTone.bg,
          '--sl': stickyTone.line,
          '--sk': stickyTone.ink,
        } as CSSProperties)
      : toneVars(model.tone)),
  } as CSSProperties;
  const Icon = model.icon;

  return (
    <div
      className={
        'cz-card' +
        (sticky ? ' sticky' : '') +
        (model.missing ? ' missing' : '') +
        (model.done ? ' done' : '') +
        (dragging ? ' lifted' : '') +
        (editing ? ' editing' : '')
      }
      data-key={it.key}
      style={style}
      tabIndex={0}
      role="group"
      aria-label={sticky ? 'Ficha de texto' : `${model.label}: ${model.title}`}
      onKeyDown={onKey}
    >
      <button
        type="button"
        className="cz-card-x"
        aria-label={sticky ? 'Eliminar ficha' : 'Quitar del cuaderno'}
        title={sticky ? 'Eliminar ficha' : 'Quitar del cuaderno'}
        onClick={onRemove}
      >
        <X size={13} />
      </button>

      {sticky ? (
        editing ? (
          <>
            <textarea
              ref={area}
              value={draft}
              maxLength={4000}
              placeholder="Una idea, un recuerdo, una pregunta…"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => onText(draft.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="cz-sticky-colors" data-nodrag>
              {(Object.keys(stickyColors) as StickyColor[]).map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-label={`Color ${c}`}
                  className={c === (it.color ?? 'amarillo') ? 'on' : ''}
                  style={{
                    background: stickyColors[c].bg,
                    borderColor: stickyColors[c].line,
                  }}
                  // Sin perder el foco del texto (si no, se cerraría la edición).
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => onColor(c)}
                />
              ))}
            </span>
          </>
        ) : (
          <p className={it.text ? '' : 'placeholder'}>{it.text || 'Toca para escribir…'}</p>
        )
      ) : (
        <>
          <span className="cz-card-kind">
            <Icon size={12} /> {model.label}
          </span>
          {model.cover && !model.poster && !model.person && (
            <span className="cz-card-photo">
              <img
                src={model.cover}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                draggable={false}
              />
            </span>
          )}
          <span className="cz-card-row">
            {model.person ? (
              <Avatar person={model.person} size={42} />
            ) : model.cover && model.poster ? (
              <span className="cz-card-poster">
                <img
                  src={model.cover}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  draggable={false}
                />
              </span>
            ) : null}
            <span className="cz-card-main">
              <strong>{model.title}</strong>
              {model.sub && <small>{model.sub}</small>}
            </span>
          </span>
          {model.text && <p>{model.text}</p>}
        </>
      )}
    </div>
  );
}
