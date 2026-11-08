import { useEffect, useRef, useState } from 'react';
import { Plus, NotebookPen, Pin, Archive, Kanban, Trash2, Pencil } from 'lucide-react';
import { useApp } from '../AppContext';
import {
  NamePanel,
  Panel,
  put,
  remove,
  useActions,
  useConfirmDelete,
  useRows,
  type Note,
  type Named,
  type List,
} from './shared';
import { NoteEditor, fresh } from './NoteEditor';
export function Notes({ create = false, openId }: { create?: boolean; openId?: string }) {
  const { busy, rev, act } = useActions(),
    ask = useConfirmDelete(),
    { notify } = useApp();
  const [noteRevision, refreshNotes] = useState(0);
  useEffect(() => {
    const refresh = () => refreshNotes((v) => v + 1);
    window.addEventListener('nexo:idea-saved', refresh);
    return () => window.removeEventListener('nexo:idea-saved', refresh);
  }, []);
  const notes = useRows<Note>(
      'quick_notes',
      rev + noteRevision,
      undefined,
      undefined,
      'created_at',
    ),
    books = useRows<Named>('note_books', rev),
    boards = useRows<Named & { is_template?: boolean }>('boards', rev);
  // Las plantillas no reciben tarjetas desde Notas.
  const realBoards = boards.rows.filter((b) => !b.is_template);
  const [scope, setScope] = useState('all'),
    [query, search] = useState(''),
    [editor, edit] = useState<Note | null>(() => (create ? fresh(null) : null));
  const [bookForm, manage] = useState<'new' | 'edit' | null>(null),
    [source, convert] = useState<Note | null>(null),
    [board, pickBoard] = useState(''),
    [list, pickList] = useState('');
  const lists = useRows<List>('board_lists', rev, 'board_id', board, 'rank');
  useEffect(() => {
    if (create && window.location.hash === '#/notas/nueva')
      history.replaceState(null, '', '#/notas');
  }, [create]);
  const opened = useRef('');
  useEffect(() => {
    if (!openId || opened.current === openId) return;
    const n = notes.rows.find((row) => row.id === openId);
    if (n) {
      opened.current = openId;
      start(n);
    }
  }, [openId, notes.rows]);
  const current = books.rows.find((b) => b.id === scope);
  function start(n: Note) {
    edit({ ...n });
  }
  const shown = notes.rows
    .filter(
      (n) =>
        (scope === 'archive'
          ? n.archived
          : !n.archived &&
            (scope === 'all' || (scope === 'loose' ? !n.book_id : n.book_id === scope))) &&
        (
          n.title +
          ' ' +
          n.body +
          ' ' +
          n.tags.join(' ') +
          ' ' +
          n.checks.map((c) => c.text).join(' ')
        )
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .reverse()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const error = notes.error || books.error || boards.error || lists.error;
  return (
    <div className="pl-notes">
      <header className="pl-bar">
        <NotebookPen />
        <h1>Notas</h1>
        <button className="pl-primary" onClick={() => start(fresh(current?.id || null))}>
          <Plus size={16} /> Nueva nota
        </button>
      </header>
      <div className="pl-bar">
        <select aria-label="Ver cuaderno" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Todas</option>
          <option value="loose">Sin cuaderno</option>
          <option value="archive">Archivadas</option>
          {books.rows.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button onClick={() => manage('new')}>+ Cuaderno</button>
        {current && (
          <>
            <button title="Renombrar cuaderno" onClick={() => manage('edit')}>
              <Pencil size={15} />
            </button>
            <button
              title="Eliminar cuaderno"
              onClick={() =>
                void act(async () => {
                  if (
                    await ask('¿Eliminar el cuaderno?', 'Las notas se conservarán sin cuaderno.')
                  ) {
                    await remove('note_books', current.id);
                    setScope('all');
                  }
                })
              }
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
        <input
          type="search"
          placeholder="Buscar notas o etiquetas…"
          value={query}
          onChange={(e) => search(e.target.value)}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="pl-grid">
        {shown.map((n) => (
          <section key={n.id} className={'pl-note tone-' + n.color}>
            <button className="pl-note-body" onClick={() => start(n)}>
              <strong>{n.title || 'Nota'}</strong>
              {n.body && <p>{n.body}</p>}
              {n.checks.slice(0, 4).map((c) => (
                <small key={c.id}>
                  {c.done ? '☑' : '☐'} {c.text}
                </small>
              ))}
              <small>{n.tags.map((t) => '#' + t).join(' ')}</small>
            </button>
            <footer>
              <button
                aria-label="Fijar nota"
                aria-pressed={n.pinned}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await put('quick_notes', { pinned: !n.pinned }, n.id);
                  })
                }
              >
                <Pin size={15} />
              </button>
              <button
                title={n.archived ? 'Restaurar' : 'Archivar'}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await put('quick_notes', { archived: !n.archived }, n.id);
                  })
                }
              >
                <Archive size={15} />
              </button>
              <button
                title="Crear tarjeta desde la nota"
                onClick={() => {
                  convert(n);
                  pickBoard('');
                  pickList('');
                }}
              >
                <Kanban size={15} />
              </button>
            </footer>
          </section>
        ))}
      </div>
      {!shown.length && !error && <p className="pl-empty">Sin notas en esta vista.</p>}
      {editor && (
        <NoteEditor
          initial={editor}
          close={() => edit(null)}
          saved={() => {
            edit(null);
            refreshNotes((v) => v + 1);
          }}
        />
      )}
      {bookForm && (
        <NamePanel
          title={bookForm === 'new' ? 'Nuevo cuaderno' : 'Renombrar cuaderno'}
          initial={bookForm === 'edit' ? current?.name : ''}
          close={() => manage(null)}
          busy={busy}
          save={(name) =>
            void act(async () => {
              const id = await put('note_books', { name }, bookForm === 'edit' ? scope : undefined);
              manage(null);
              setScope(id);
            })
          }
        />
      )}
      {source && (
        <Panel title="Crear tarjeta desde la nota" close={() => convert(null)}>
          <label>
            Tablero
            <select
              value={board}
              onChange={(e) => {
                pickBoard(e.target.value);
                pickList('');
              }}
            >
              <option value="">Elige un tablero</option>
              {realBoards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {!realBoards.length && <p>Crea primero un tablero en Tableros.</p>}
          <label>
            Columna
            <select value={list} onChange={(e) => pickList(e.target.value)}>
              <option value="">Elige una columna</option>
              {lists.rows.map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="pl-primary"
            disabled={busy || !list}
            onClick={() =>
              void act(async () => {
                await put('board_cards', {
                  list_id: list,
                  title: (source.title || source.body || 'Nota').slice(0, 240),
                  body: source.body,
                  tags: source.tags,
                  checks: source.checks,
                  note_id: source.id,
                  episode_id: source.episode_id,
                  rank: Date.now(),
                });
                convert(null);
                notify('Tarjeta creada.');
              })
            }
          >
            Crear tarjeta
          </button>
        </Panel>
      )}
    </div>
  );
}
