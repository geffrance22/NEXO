import { useState } from 'react';
import { useApp } from '../AppContext';
import {
  Panel,
  Checklist,
  useActions,
  useRows,
  useConfirmDelete,
  put,
  remove,
  tags,
  type Named,
  type Note,
} from './shared';
const colors = ['linen', 'sage', 'peach', 'sky', 'lilac', 'lemon'];
const colorNames = ['Marfil', 'Salvia', 'Durazno', 'Cielo', 'Lila', 'Limón'];
export function fresh(book_id: string | null): Note {
  return {
    id: '',
    book_id,
    title: '',
    body: '',
    tags: [],
    checks: [],
    color: 'linen',
    pinned: false,
    archived: false,
    episode_id: null,
  };
}
export function NoteEditor({
  initial,
  close,
  saved,
}: {
  initial: Note;
  close: () => void;
  saved: () => void;
}) {
  const [editor, edit] = useState(initial),
    [labels, setLabels] = useState(initial.tags.join(', '));
  const { busy, rev, act } = useActions(),
    ask = useConfirmDelete(),
    books = useRows<Named>('note_books', rev),
    { workspace } = useApp();
  return (
    <Panel title={editor.id ? 'Editar nota' : 'Nueva idea'} close={close}>
      {books.error && <p role="alert">{books.error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            const { id, ...fields } = editor;
            await put(
              'quick_notes',
              { ...fields, title: fields.title.trim(), tags: tags(labels) },
              id,
            );
            saved();
          });
        }}
      >
        <label>
          Título
          <input
            autoFocus
            maxLength={240}
            value={editor.title}
            onChange={(e) => edit({ ...editor, title: e.target.value })}
          />
        </label>
        <label>
          Nota
          <textarea
            rows={5}
            value={editor.body}
            onChange={(e) => edit({ ...editor, body: e.target.value })}
          />
        </label>
        <Checklist value={editor.checks} set={(checks) => edit({ ...editor, checks })} />
        <label>
          Etiquetas
          <input
            value={labels}
            placeholder="Separadas por comas"
            onChange={(e) => setLabels(e.target.value)}
          />
        </label>
        <div className="pl-colors">
          {colors.map((c, i) => (
            <button
              key={c}
              type="button"
              aria-label={colorNames[i]}
              title={colorNames[i]}
              aria-pressed={editor.color === c}
              className={'tone-' + c}
              onClick={() => edit({ ...editor, color: c })}
            />
          ))}
        </div>
        <details>
          <summary>Vincular episodio</summary>
          <select
            value={editor.episode_id || ''}
            onChange={(e) => edit({ ...editor, episode_id: e.target.value || null })}
          >
            <option value="">Sin episodio</option>
            {workspace.episodes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        </details>
        <label className="pl-bookpick">
          Cuaderno
          <select
            value={editor.book_id || ''}
            onChange={(e) => edit({ ...editor, book_id: e.target.value || null })}
          >
            <option value="">Sin cuaderno</option>
            {books.rows.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <footer>
          {editor.id && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  if (await ask('¿Eliminar la nota?', 'Esta acción es permanente.')) {
                    await remove('quick_notes', editor.id);
                    saved();
                  }
                })
              }
            >
              Eliminar
            </button>
          )}
          <button
            className="pl-primary"
            disabled={busy || !(editor.title.trim() || editor.body.trim() || editor.checks.length)}
          >
            Guardar nota
          </button>
        </footer>
      </form>
    </Panel>
  );
}
