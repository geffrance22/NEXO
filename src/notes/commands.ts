import { useRef } from 'react';
import { useApp } from '../AppContext';
import type { StoredImage } from '../data';
import { useConfirmDelete } from '../planner/shared';
import { MAX_NOTE_IMAGES } from './NoteImages';
import type { KeepNote, NotesStore } from './useNotes';

/**
 * Lo que se hace con una nota desde fuera del editor (archivar, copiar, borrar, fotos,
 * recordatorio). Lo comparten el lienzo de Libroteca y el bloque «Notas» de Mi espacio.
 */
export function useNoteCommands(store: NotesStore) {
  const { notify } = useApp();
  const ask = useConfirmDelete();
  const latest = useRef(store);
  latest.current = store;
  const find = (id: string) => latest.current.notes?.find((n) => n.id === id);

  const archive = (n: KeepNote) => {
    const archived = !n.archived;
    void store.patch(n.id, { archived, pinned: archived ? false : n.pinned }).then((ok) => {
      if (ok)
        notify(archived ? 'Nota archivada.' : 'Nota desarchivada.', {
          label: 'Deshacer',
          icon: 'undo',
          run: () =>
            void latest.current.patch(n.id, {
              archived: n.archived,
              pinned: n.pinned,
            }),
        });
    });
  };

  const duplicate = (n: KeepNote) => {
    void store
      .create({
        title: n.title,
        body: n.body,
        color: n.color,
        tags: n.tags,
        checks: n.checks.map((c) => ({ ...c, id: crypto.randomUUID() })),
        book_id: n.book_id,
        episode_id: n.episode_id,
        images: n.images,
        pinned: false,
        archived: false,
      })
      .then((copy) => copy && notify('Copia creada.'));
  };

  /** Pregunta antes; `before` corre justo antes de borrar (p. ej. cerrar el editor). */
  const remove = (n: KeepNote, before?: () => void) => {
    void ask('¿Eliminar la nota?', 'Esta acción es permanente.').then(async (yes) => {
      if (!yes) return;
      before?.();
      if (await latest.current.remove(n.id)) notify('Nota eliminada.');
    });
  };

  const attach = (id: string, image: StoredImage) => {
    const n = find(id);
    if (!n) return;
    void latest.current.patch(id, {
      images: [...n.images, image].slice(0, MAX_NOTE_IMAGES),
    });
  };

  const remind = (n: KeepNote, iso: string | null) => {
    void store.patch(n.id, { remind_at: iso }).then((ok) => {
      if (ok && iso) notify('Te lo recordaremos.');
    });
  };

  const toggleCheck = (n: KeepNote, checkId: string) =>
    void store.patch(n.id, {
      checks: n.checks.map((c) => (c.id === checkId ? { ...c, done: !c.done } : c)),
    });

  const pin = (n: KeepNote) =>
    void store.patch(n.id, {
      pinned: !n.pinned,
      archived: n.pinned ? n.archived : false,
    });

  return { archive, duplicate, remove, attach, remind, toggleCheck, pin };
}
