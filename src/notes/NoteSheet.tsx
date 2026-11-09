import { useRef, useState, type CSSProperties } from 'react';
import {
  Archive,
  ArchiveRestore,
  Copy,
  Kanban,
  Lock,
  LockOpen,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { friendlyDate, todayInputValue } from '../lib/format';
import type { Named } from '../planner/shared';
import { colorOf } from './palette';
import { blankDraft, cleanDraft, draftOf, draftSetter, NoteForm, type Draft } from './NoteForm';
import { IconButton, Pop } from './parts';
import { isBlank, type KeepNote, type NotesStore } from './useNotes';

const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Una nota abierta en grande, del color de la nota. Se guarda al cerrarla (Esc, tocar fuera,
 * «Listo» o Ctrl + Enter). Si la vacías, se descarta. Sin `note`, es una nota nueva: se crea al
 * cerrar si escribiste algo.
 */
export function NoteSheet({
  note,
  store,
  books,
  episodes,
  tagSuggestions,
  onClose,
  onArchive,
  onDuplicate,
  onDelete,
  onToBoard,
  onVault,
  vault,
  extras = true,
}: {
  note: KeepNote | null;
  store: NotesStore;
  books: Named[];
  episodes: { id: string; title: string }[];
  tagSuggestions: string[];
  onClose: () => void;
  onArchive?: (note: KeepNote) => void;
  onDuplicate?: (note: KeepNote) => void;
  onDelete?: (note: KeepNote) => void;
  onToBoard?: (note: KeepNote) => void;
  /** Meter la nota en la bóveda (o sacarla, si ya está en ella). */
  onVault?: (note: KeepNote) => void;
  /** Nota de la bóveda. */
  vault?: boolean;
  extras?: boolean;
}) {
  const { notify } = useApp();
  const original = useRef(note ? draftOf(note) : blankDraft());
  const [draft, setDraft] = useState<Draft>(original.current);
  const latest = useRef(draft);
  latest.current = draft;
  const closing = useRef(false);
  const busy = useRef(false);

  /** Guarda lo que cambió y cierra. Devuelve la nota tal como quedó. */
  const commit = async (): Promise<KeepNote | null> => {
    const d = cleanDraft(latest.current);
    if (!note) return isBlank(d) ? null : store.create(d);
    if (isBlank(d)) {
      await store.remove(note.id);
      return null;
    }
    if (!same(d, cleanDraft(original.current))) await store.patch(note.id, d);
    return { ...note, ...d };
  };
  /** No se cierra con fotos a medio subir (se perderían). */
  const blocked = () => {
    if (!busy.current) return false;
    notify('Espera un momento: aún se están subiendo las fotos.');
    return true;
  };
  const close = async () => {
    if (closing.current || blocked()) return;
    closing.current = true;
    onClose();
    await commit();
  };
  /** Acciones que necesitan la nota guardada primero. */
  const then = (fn?: (n: KeepNote) => void) => async () => {
    if (!fn || closing.current || blocked()) return;
    closing.current = true;
    onClose();
    const n = await commit();
    if (n) fn(n);
  };

  const c = colorOf(draft.color);
  const created = note ? todayInputValue(new Date(note.created_at)) : null;
  return (
    <Sheet
      label={draft.title || 'Nota'}
      className={'kp-sheet' + (vault ? ' vault' : '')}
      onRequestClose={() => void close()}
    >
      <div className="kp-sheet-in" style={{ '--kp-bg': c.bg, '--kp-ink': c.ink } as CSSProperties}>
        <NoteForm
          draft={draft}
          set={draftSetter(setDraft)}
          books={books}
          episodes={episodes}
          tagSuggestions={tagSuggestions}
          autoFocus={draft.title || draft.body || draft.checks.length ? undefined : 'body'}
          onSubmit={() => void close()}
          vault={vault}
          extras={extras}
          onBusyChange={(b) => (busy.current = b)}
          start={
            note && (
              <>
                {!vault && onArchive && (
                  <IconButton
                    icon={note.archived ? ArchiveRestore : Archive}
                    label={note.archived ? 'Desarchivar' : 'Archivar'}
                    onClick={() => void then(onArchive)()}
                  />
                )}
                <Pop icon={MoreVertical} label="Más opciones">
                  {(closeMenu) => (
                    <div className="kp-menu">
                      {onDuplicate && (
                        <button
                          type="button"
                          onClick={() => {
                            closeMenu();
                            void then(onDuplicate)();
                          }}
                        >
                          <Copy size={14} /> Hacer una copia
                        </button>
                      )}
                      {!vault && onToBoard && (
                        <button
                          type="button"
                          onClick={() => {
                            closeMenu();
                            void then(onToBoard)();
                          }}
                        >
                          <Kanban size={14} /> Crear tarjeta en un tablero
                        </button>
                      )}
                      {onVault && (
                        <button
                          type="button"
                          onClick={() => {
                            closeMenu();
                            void then(onVault)();
                          }}
                        >
                          {vault ? <LockOpen size={14} /> : <Lock size={14} />}
                          {vault ? 'Sacar de la bóveda' : 'Mover a la bóveda'}
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            closeMenu();
                            onDelete(note);
                          }}
                        >
                          <Trash2 size={14} /> Eliminar nota
                        </button>
                      )}
                    </div>
                  )}
                </Pop>
              </>
            )
          }
          end={
            <>
              <small className="kp-stamp">
                {vault && <Lock size={11} />}
                {created ? `Creada ${friendlyDate(created).toLowerCase()}` : 'Nota nueva'}
              </small>
              <button type="button" className="kp-close" onClick={() => void close()}>
                Listo
              </button>
            </>
          }
        />
      </div>
    </Sheet>
  );
}
