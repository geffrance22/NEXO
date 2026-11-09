import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Archive,
  FolderPlus,
  Hash,
  KeyRound,
  LayoutGrid,
  Lightbulb,
  Lock,
  Pencil,
  Rows3,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { LoadMore, useInfinite } from '../components/LoadMore';
import { normalizeText } from '../lib/format';
import { NamePanel, useConfirmDelete } from '../planner/shared';
import { useNoteCommands } from './commands';
import { NoteCard, type CardActions } from './NoteCard';
import { NoteComposer } from './NoteComposer';
import { NoteSheet } from './NoteSheet';
import { ToBoardSheet } from './ToBoardSheet';
import { useDragSort } from './useDragSort';
import { noteText, type KeepNote, type NotesStore } from './useNotes';
import { touchVault, useVault, useVaultStore } from './vault';
import { ChangePinSheet, VaultGate, VaultGateSheet } from './VaultGate';
import './notes.css';

type Scope = 'all' | 'loose' | 'archive' | 'vault' | `book:${string}`;
type Layout = 'grid' | 'list';
const LAYOUT_KEY = 'nexo-notes-layout';
/** Alto de cada fila de la rejilla: cada tarjeta ocupa las filas que mide. */
const ROW = 4;
/** Notas por tanda en «Otras». */
const NOTES_PAGE = 48;

function Brick({
  id,
  group,
  dragging,
  onPointerDown,
  children,
}: {
  id: string;
  group: string;
  dragging: boolean;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState(0);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setSpan(Math.ceil(el.getBoundingClientRect().height / ROW));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      className={'kp-brick' + (dragging ? ' dragging' : '') + (onPointerDown ? ' movable' : '')}
      data-id={id}
      data-group={group}
      style={span ? { gridRowEnd: `span ${span}` } : undefined}
      onPointerDown={onPointerDown}
    >
      <div className="kp-brick-in" ref={inner}>
        {children}
      </div>
    </div>
  );
}

/**
 * Pestaña «Notas» de Libroteca: un lienzo libre al estilo Google Keep. Arriba, «Escribe una
 * nota…»; debajo, las fijadas y las demás en columnas que se acomodan solas y se ordenan
 * arrastrándolas. Filtros por cuaderno, etiqueta, archivo y la bóveda (protegida con PIN).
 */
export function NotesBoard({
  store,
  query,
  openId,
  onOpened,
  composeTick,
  onComposeHandled,
}: {
  store: NotesStore;
  query: string;
  /** Nota que hay que abrir al llegar (enlace `#/libroteca/<id>`). */
  openId: string | null;
  onOpened: () => void;
  /** Distinto de 0: abrir «Escribe una nota…» (botón «Nueva nota»). */
  composeTick: number;
  onComposeHandled: () => void;
}) {
  const { workspace, notify, confirm, openImages } = useApp();
  const ask = useConfirmDelete();
  const { notes, books } = store;
  const vault = useVault();
  const vaultStore = useVaultStore(store, vault.key);
  const [scope, setScope] = useState<Scope>('all');
  const inVault = scope === 'vault';
  const active: NotesStore = inVault ? vaultStore : store;
  const cmd = useNoteCommands(active);
  const extras = !store.outdated;
  const [tag, setTag] = useState<string | null>(null);
  const [layout, setLayoutRaw] = useState<Layout>(() =>
    localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid',
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [toBoard, setToBoard] = useState<KeepNote | null>(null);
  const [bookForm, setBookForm] = useState<'new' | 'edit' | null>(null);
  const [bookBusy, setBookBusy] = useState(false);
  // Nota por mover a la bóveda en cuanto se abra (estaba cerrada o sin crear).
  const [toVault, setToVault] = useState<KeepNote | null>(null);
  const [changingPin, setChangingPin] = useState(false);

  const setLayout = (l: Layout) => {
    setLayoutRaw(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* Sin almacenamiento: dura mientras sigas aquí. */
    }
  };

  const episodes = useMemo(
    () => workspace.episodes.map((e) => ({ id: e.id, title: e.title })),
    [workspace.episodes],
  );
  const episodeTitle = useMemo(() => new Map(episodes.map((e) => [e.id, e.title])), [episodes]);
  const bookName = useMemo(() => new Map(books.map((b) => [b.id, b.name])), [books]);
  /** Las notas en claro (las de la bóveda solo se ven dentro de ella). */
  const plain = useMemo(() => (notes ?? []).filter((n) => !n.vaulted), [notes]);
  const sealedCount = (notes ?? []).length - plain.length;
  const all = inVault ? (vaultStore.notes ?? []) : plain;
  const live = plain.filter((n) => !n.archived);
  const allTags = useMemo(() => {
    const count = new Map<string, number>();
    for (const n of inVault ? (vaultStore.notes ?? []) : plain)
      if (!n.archived) for (const t of n.tags) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
  }, [plain, vaultStore.notes, inVault]);
  const tagNames = allTags.map(([t]) => t);

  useEffect(() => {
    // «Nueva nota» desde el archivo: vuelve a las notas para mostrar el cuadro.
    if (composeTick && scope === 'archive') setScope('all');
  }, [composeTick]);
  // Abrir una nota pedida por enlace (asistente, cuadernos, tableros, recordatorios).
  useEffect(() => {
    if (!openId || !notes) return;
    const n = notes.find((x) => x.id === openId);
    if (n) {
      if (n.vaulted) setScope('vault');
      else if (n.archived) setScope('archive');
      setEditing(n.id);
    } else notify('No encontramos esa nota. Puede que la hayas eliminado.');
    onOpened();
  }, [openId, notes]);
  // La bóveda acaba de abrirse con una nota esperando entrar.
  useEffect(() => {
    if (!toVault || vault.status !== 'open') return;
    const n = toVault;
    setToVault(null);
    void vaultStore.adopt(n).then((ok) => ok && notify('Nota guardada en la bóveda.'));
  }, [toVault, vault.status]);
  // Cambiar de filtro descarta la etiqueta si ya no existe ahí.
  useEffect(() => setTag(null), [inVault]);

  const bookId = scope.startsWith('book:') ? scope.slice(5) : null;
  const book = books.find((b) => b.id === bookId);
  const needle = normalizeText(query.trim());
  const shown = all.filter(
    (n) =>
      (inVault
        ? true
        : scope === 'archive'
          ? n.archived
          : !n.archived &&
            (scope === 'all' || (scope === 'loose' ? !n.book_id : n.book_id === bookId))) &&
      (!tag || n.tags.includes(tag)) &&
      (!needle || normalizeText(noteText(n)).includes(needle)),
  );
  const pinned = scope === 'archive' ? [] : shown.filter((n) => n.pinned);
  const others = scope === 'archive' ? shown : shown.filter((n) => !n.pinned);
  // «Otras» por tandas: con cientos de notas, cada tarjeta mide su alto y pesa.
  const pager = useInfinite(others, NOTES_PAGE, [scope, tag, needle, layout].join('|'));
  const editingNote = editing ? all.find((n) => n.id === editing) : undefined;

  // Ordenar arrastrando: el rango nuevo queda entre el de sus vecinas. Las que aún no se pintan
  // (siguientes tandas) cuentan como vecinas, para no saltar por encima de ellas.
  const byId = useMemo(() => new Map(all.map((n) => [n.id, n])), [all]);
  const groups = useRef<Record<string, string[]>>({});
  groups.current = { pinned: pinned.map((n) => n.id), others: others.map((n) => n.id) };
  const { drag, start } = useDragSort((group, dropped, moved) => {
    const inView = new Set(dropped);
    const order = [...dropped, ...(groups.current[group] ?? []).filter((id) => !inView.has(id))];
    const i = order.indexOf(moved);
    const prev = byId.get(order[i - 1]);
    const next = byId.get(order[i + 1]);
    const rank =
      prev && next
        ? (prev.rank + next.rank) / 2
        : prev
          ? prev.rank + 1024
          : next
            ? next.rank - 1024
            : byId.get(moved)?.rank;
    if (rank !== undefined) void active.patch(moved, { rank });
  });
  const canDrag = extras && scope !== 'archive';

  const closeEditor = () => {
    setEditing(null);
    // Que recargar la página no vuelva a abrir la nota.
    if (/^#\/(libroteca|notas)\/.+/.test(window.location.hash))
      history.replaceState(null, '', '#/libroteca');
  };

  const moveVault = (n: KeepNote) => {
    if (n.vaulted) {
      void vaultStore.release(n).then((ok) => ok && notify('Nota fuera de la bóveda.'));
      return;
    }
    if (vault.status === 'open')
      void vaultStore.adopt(n).then((ok) => ok && notify('Nota guardada en la bóveda.'));
    else if (vault.status === 'missing')
      notify('Para usar la bóveda, ejecuta la migración 202611090007_notes_extras.sql.');
    else setToVault(n);
  };

  const resetVault = () => {
    void confirm({
      title: '¿Restablecer la bóveda?',
      message: `Sin el PIN no se pueden abrir sus notas. Se eliminarán ${
        sealedCount === 1 ? 'la nota' : `las ${sealedCount} notas`
      } de la bóveda y podrás crear un PIN nuevo. Esta acción es permanente.`,
      confirmLabel: 'Eliminar y restablecer',
      danger: true,
      icon: 'warning',
    }).then(async (yes) => {
      if (!yes) return;
      setToVault(null);
      if (await vaultStore.reset()) notify('Bóveda restablecida.');
      else notify('No se pudo restablecer la bóveda.');
    });
  };

  const actions: CardActions = {
    open: (n) => setEditing(n.id),
    pin: cmd.pin,
    color: (n, color) => void active.patch(n.id, { color }),
    toggleCheck: cmd.toggleCheck,
    archive: cmd.archive,
    duplicate: cmd.duplicate,
    remove: (n) => cmd.remove(n, () => editing === n.id && closeEditor()),
    toBoard: (n) => setToBoard(n),
    filterTag: (t) => setTag((cur) => (cur === t ? null : t)),
    attach: cmd.attach,
    openImage: (n, i) => openImages(n.images, i),
    remind: cmd.remind,
    vault: moveVault,
  };

  const grid = (list: KeepNote[], group: string) => {
    const ids = list.map((n) => n.id);
    const order = drag && drag.group === group ? drag.order : ids;
    const map = new Map(list.map((n) => [n.id, n]));
    return (
      <div className={'kp-grid' + (layout === 'list' ? ' list' : '')}>
        {order.map((id) => {
          const n = map.get(id);
          if (!n) return null;
          return (
            <Brick
              key={n.id}
              id={n.id}
              group={group}
              dragging={drag?.id === n.id}
              onPointerDown={canDrag ? (e) => start(e, n.id, group, ids) : undefined}
            >
              <NoteCard
                note={n}
                actions={actions}
                inVault={inVault}
                extras={extras}
                bookName={
                  scope.startsWith('book:')
                    ? undefined
                    : n.book_id
                      ? bookName.get(n.book_id)
                      : undefined
                }
                episodeTitle={n.episode_id ? episodeTitle.get(n.episode_id) : undefined}
              />
            </Brick>
          );
        })}
      </div>
    );
  };

  const chip = (id: Scope, label: ReactNode, count: number) => (
    <button
      type="button"
      key={id}
      className={'kp-chip' + (scope === id ? ' on' : '') + (id === 'vault' ? ' vault' : '')}
      aria-pressed={scope === id}
      onClick={() => setScope(id)}
    >
      {label}
      <i>{count.toLocaleString('es-CO')}</i>
    </button>
  );

  const vaultOpen = inVault && vault.status === 'open';
  let body: ReactNode;
  if (inVault && !vaultOpen) {
    body = (
      <VaultGate
        status={vault.status}
        onCreate={vault.create}
        onUnlock={vault.unlock}
        onReset={resetVault}
      />
    );
  } else if (notes === null || (inVault && vaultStore.opening && !all.length)) {
    body = (
      <div className="kp-grid">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="kp-skel" style={{ height: 90 + ((i * 37) % 90) }} />
        ))}
      </div>
    );
  } else if (!shown.length) {
    const filtered = Boolean(needle || tag);
    body = (
      <div className="kp-empty">
        <span>
          {inVault ? (
            <ShieldCheck size={26} />
          ) : scope === 'archive' ? (
            <Archive size={26} />
          ) : (
            <Lightbulb size={26} />
          )}
        </span>
        <strong>
          {filtered
            ? 'Ninguna nota coincide con lo que buscas.'
            : inVault
              ? 'Tu bóveda está vacía. Escribe aquí o mueve una nota desde «Más opciones».'
              : scope === 'archive'
                ? 'Las notas que archives aparecerán aquí.'
                : book
                  ? `«${book.name}» aún no tiene notas.`
                  : 'Las notas que escribas aparecerán aquí.'}
        </strong>
        {filtered && tag && (
          <button type="button" className="kp-link" onClick={() => setTag(null)}>
            Quitar el filtro #{tag}
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <>
        {pinned.length > 0 && (
          <section className="kp-section">
            <h2 className="kp-h2">
              Fijadas <i>{pinned.length}</i>
            </h2>
            {grid(pinned, 'pinned')}
          </section>
        )}
        {others.length > 0 && (
          <section className="kp-section">
            {pinned.length > 0 && (
              <h2 className="kp-h2">
                Otras <i>{others.length}</i>
              </h2>
            )}
            {grid(pager.visible, 'others')}
            <LoadMore rest={pager.rest} onMore={pager.loadMore} shown={pager.visible.length} />
          </section>
        )}
      </>
    );
  }

  return (
    <div
      className={'kp' + (inVault ? ' in-vault' : '')}
      onPointerDown={inVault ? touchVault : undefined}
      onKeyDown={inVault ? touchVault : undefined}
    >
      <div className="kp-bar">
        <div className="kp-chips" role="group" aria-label="Ver notas">
          {chip('all', 'Todas', live.length)}
          {books.length > 0 && chip('loose', 'Sin cuaderno', live.filter((n) => !n.book_id).length)}
          {books.map((b) =>
            chip(`book:${b.id}`, b.name, live.filter((n) => n.book_id === b.id).length),
          )}
          {chip(
            'archive',
            <>
              <Archive size={13} /> Archivo
            </>,
            plain.length - live.length,
          )}
          {extras &&
            chip(
              'vault',
              <>
                <Lock size={13} /> Bóveda
              </>,
              sealedCount,
            )}
          {!inVault && (
            <button
              type="button"
              className="kp-chip ghost"
              title="Nuevo cuaderno de notas"
              onClick={() => setBookForm('new')}
            >
              <FolderPlus size={14} /> Cuaderno
            </button>
          )}
          {book && (
            <>
              <button
                type="button"
                className="kp-ic"
                title="Renombrar cuaderno"
                aria-label="Renombrar cuaderno"
                onClick={() => setBookForm('edit')}
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                className="kp-ic"
                title="Eliminar cuaderno"
                aria-label="Eliminar cuaderno"
                onClick={() =>
                  void ask(
                    `¿Eliminar «${book.name}»?`,
                    'Sus notas se conservan, solo quedan sin cuaderno.',
                  ).then(async (yes) => {
                    if (yes && (await store.removeBook(book.id))) setScope('all');
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
        <div className="kp-layout" role="group" aria-label="Vista">
          <button
            type="button"
            className={layout === 'grid' ? 'on' : ''}
            aria-pressed={layout === 'grid'}
            title="Cuadrícula"
            aria-label="Cuadrícula"
            onClick={() => setLayout('grid')}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className={layout === 'list' ? 'on' : ''}
            aria-pressed={layout === 'list'}
            title="Lista"
            aria-label="Lista"
            onClick={() => setLayout('list')}
          >
            <Rows3 size={15} />
          </button>
        </div>
      </div>

      {vaultOpen && (
        <div className="kp-vault-bar">
          <span>
            <ShieldCheck size={15} />
            <strong>Bóveda abierta</strong>
            <small>Cifrada con tu PIN · se bloquea sola tras 5 minutos sin uso</small>
          </span>
          <span className="kp-vault-actions">
            <button type="button" onClick={() => setChangingPin(true)}>
              <KeyRound size={14} /> Cambiar PIN
            </button>
            <button type="button" className="lock" onClick={vault.lock}>
              <Lock size={14} /> Bloquear
            </button>
          </span>
        </div>
      )}

      {allTags.length > 0 && (!inVault || vaultOpen) && (
        <div className="kp-tagbar" role="group" aria-label="Etiquetas">
          <Hash size={13} />
          {allTags.slice(0, 24).map(([t, n]) => (
            <button
              type="button"
              key={t}
              className={'kp-tagchip' + (tag === t ? ' on' : '')}
              aria-pressed={tag === t}
              onClick={() => setTag((cur) => (cur === t ? null : t))}
            >
              {t}
              <i>{n}</i>
            </button>
          ))}
          {tag && (
            <button
              type="button"
              className="kp-tagchip clear"
              onClick={() => setTag(null)}
              aria-label="Quitar filtro de etiqueta"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {store.error && (
        <p className="kp-error" role="alert">
          {store.error}
        </p>
      )}
      {store.outdated && (
        <p className="kp-notice" role="status">
          Para ordenar las notas arrastrándolas, añadirles fotos, recordatorios y usar la bóveda,
          ejecuta <code>supabase/migrations/202611090007_notes_extras.sql</code> en el SQL Editor de
          Supabase.
        </p>
      )}

      {scope !== 'archive' && (!inVault || vaultOpen) && (
        <NoteComposer
          key={inVault ? 'vault' : 'plain'}
          store={active}
          bookId={bookId}
          books={inVault ? [] : books}
          episodes={episodes}
          tagSuggestions={tagNames}
          tick={composeTick}
          onTickHandled={onComposeHandled}
          vault={inVault}
          extras={extras}
        />
      )}

      {body}

      {editingNote && (!inVault || vaultOpen) && (
        <NoteSheet
          key={editingNote.id}
          note={editingNote}
          store={active}
          books={inVault ? [] : books}
          episodes={episodes}
          tagSuggestions={tagNames}
          onClose={closeEditor}
          onArchive={inVault ? undefined : actions.archive}
          onDuplicate={actions.duplicate}
          onDelete={actions.remove}
          onToBoard={inVault ? undefined : actions.toBoard}
          onVault={extras ? moveVault : undefined}
          vault={inVault}
          extras={extras}
        />
      )}
      {toBoard && <ToBoardSheet note={toBoard} onClose={() => setToBoard(null)} />}
      {toVault && vault.status !== 'open' && (
        <VaultGateSheet
          status={vault.status}
          onCreate={vault.create}
          onUnlock={vault.unlock}
          onReset={resetVault}
          onClose={() => setToVault(null)}
        />
      )}
      {changingPin && (
        <ChangePinSheet onSave={vaultStore.changePin} onClose={() => setChangingPin(false)} />
      )}
      {bookForm && (
        <NamePanel
          title={bookForm === 'new' ? 'Nuevo cuaderno de notas' : 'Renombrar cuaderno'}
          initial={bookForm === 'edit' ? book?.name : ''}
          busy={bookBusy}
          close={() => setBookForm(null)}
          save={(name) => {
            setBookBusy(true);
            void store.saveBook(name, bookForm === 'edit' ? book?.id : undefined).then((id) => {
              setBookBusy(false);
              if (!id) return;
              setBookForm(null);
              setScope(`book:${id}`);
            });
          }}
        />
      )}
    </div>
  );
}
