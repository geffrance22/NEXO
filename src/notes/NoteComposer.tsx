import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ListChecks, Pencil } from 'lucide-react';
import type { Named } from '../planner/shared';
import { colorOf } from './palette';
import { blankDraft, cleanDraft, draftSetter, NoteForm, type Draft } from './NoteForm';
import { isBlank, type NotesStore } from './useNotes';

/**
 * «Escribe una nota…»: una línea que se abre al tocarla. Se guarda sola al tocar fuera, con
 * «Cerrar» o con Ctrl + Enter; si no escribiste nada, no queda nada.
 */
export function NoteComposer({
  store,
  bookId,
  books,
  episodes,
  tagSuggestions,
  tick,
  onTickHandled,
  vault,
  extras = true,
}: {
  store: NotesStore;
  /** Cuaderno que estás viendo: la nota nueva queda en él. */
  bookId: string | null;
  books: Named[];
  episodes: { id: string; title: string }[];
  tagSuggestions: string[];
  /** Cambia cuando piden abrirlo desde fuera («Nueva nota»); 0 = nada pendiente. */
  tick: number;
  onTickHandled: () => void;
  /** Escribe en la bóveda. */
  vault?: boolean;
  extras?: boolean;
}) {
  const [open, setOpen] = useState<null | 'text' | 'list'>(null);
  const [draft, setDraft] = useState<Draft>(() => blankDraft(bookId));
  const [session, setSession] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const busy = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;

  const start = (mode: 'text' | 'list') => {
    setDraft(blankDraft(bookId));
    setSession((s) => s + 1);
    setOpen(mode);
  };

  const close = async () => {
    // Con fotos a medio subir, espera (si no, se perderían).
    if (saving.current || busy.current) return;
    const d = cleanDraft(latest.current);
    setOpen(null);
    if (isBlank(d)) return;
    saving.current = true;
    await store.create(d);
    saving.current = false;
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!tick) return;
    if (open) root.current?.querySelector<HTMLElement>('.kp-title')?.focus();
    else start('text');
    root.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    onTickHandled();
    // Solo cuando llega un aviso nuevo.
  }, [tick]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (root.current?.contains(t)) return;
      // Lo que se abre encima (confirmaciones, avisos) no cuenta como «fuera».
      if (t.closest('.confirm-backdrop, .toast, .sheet-backdrop, .lightbox')) return;
      void closeRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.sheet-backdrop')) void closeRef.current();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  if (!open)
    return (
      <div className="kp-composer closed" ref={root}>
        <button type="button" className="kp-composer-hit" onClick={() => start('text')}>
          <Pencil size={16} />
          {vault ? 'Escribe una nota privada…' : 'Escribe una nota…'}
        </button>
        <button
          type="button"
          className="kp-ic"
          title="Nueva lista"
          aria-label="Nueva lista"
          onClick={() => start('list')}
        >
          <ListChecks size={18} />
        </button>
      </div>
    );

  const c = colorOf(draft.color);
  return (
    <div
      className="kp-composer"
      ref={root}
      style={{ '--kp-bg': c.bg, '--kp-ink': c.ink } as CSSProperties}
    >
      <NoteForm
        key={session}
        draft={draft}
        set={draftSetter(setDraft)}
        books={books}
        episodes={episodes}
        tagSuggestions={tagSuggestions}
        initialList={open === 'list'}
        autoFocus={open === 'list' ? 'list' : 'body'}
        onSubmit={() => void close()}
        vault={vault}
        extras={extras}
        onBusyChange={(b) => (busy.current = b)}
        end={
          <button type="button" className="kp-close" onClick={() => void close()}>
            Cerrar
          </button>
        }
      />
    </div>
  );
}
