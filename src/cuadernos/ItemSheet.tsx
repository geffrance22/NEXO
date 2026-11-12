import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ExternalLink, Highlighter, Newspaper } from 'lucide-react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { EmbedBar } from '../components/EmbedBar';
import { Sheet } from '../components/Sheet';
import { EpisodeDetail } from '../episodes/EpisodesPage';
import { NoteSheet } from '../notes/NoteSheet';
import { useNoteCommands } from '../notes/commands';
import { useNotes, type KeepNote } from '../notes/useNotes';
import { PlaceDetail } from '../pages/PlacesPage';
import { hostOf, type ReadingRef } from './digest';

/** Lo que se abre aquí mismo desde el lienzo (recuerdos y personas tienen su propia ficha). */
export type Peek =
  | { type: 'place'; id: string }
  | { type: 'episode'; id: string }
  | { type: 'reading'; id: string }
  | { type: 'note'; id: string };

/**
 * La ficha de un elemento del cuaderno, encima del lienzo: no hace falta salir a su sección. Lo que
 * se abra desde ella (un recuerdo, una persona, editar) queda encima; si navegas, se cierra.
 */
export function ItemSheet({
  peek,
  reading,
  onClose,
}: {
  peek: Peek;
  /** Lo que el lienzo ya sabe de la lectura. */
  reading?: ReadingRef;
  onClose: () => void;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onNavigate = () => close.current();
    window.addEventListener('hashchange', onNavigate);
    return () => window.removeEventListener('hashchange', onNavigate);
  }, []);

  if (peek.type === 'note') return <NoteHost id={peek.id} onClose={onClose} />;
  return (
    <Sheet
      label="Ficha"
      className={'cz-peek' + (peek.type === 'reading' ? ' narrow' : '')}
      // Lo que se abra encima (otra ventana, la ficha de una persona) recibe el Esc primero.
      yieldTo=".sheet-backdrop:not(:has(> .sheet.cz-peek)), .nx-peek, .modal-backdrop"
      onRequestClose={onClose}
    >
      <div className="cz-peek-scroll">
        {peek.type === 'place' && <PlacePeek id={peek.id} onClose={onClose} />}
        {peek.type === 'episode' && <EpisodePeek id={peek.id} onClose={onClose} />}
        {peek.type === 'reading' && reading && (
          <ReadingPeek reading={reading} onClose={onClose} />
        )}
      </div>
    </Sheet>
  );
}

/** Si el original se borra con la ficha abierta, la ficha se cierra. */
function useGone(gone: boolean, onClose: () => void) {
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
}

function PlacePeek({ id, onClose }: { id: string; onClose: () => void }) {
  const { workspace } = useApp();
  const place = workspace.places.find((p) => p.id === id);
  useGone(!place, onClose);
  return place ? <PlaceDetail place={place} onClose={onClose} /> : null;
}

function EpisodePeek({ id, onClose }: { id: string; onClose: () => void }) {
  const { workspace } = useApp();
  const episode = workspace.episodes.find((e) => e.id === id);
  useGone(!episode, onClose);
  return episode ? <EpisodeDetail episode={episode} onClose={onClose} /> : null;
}

type Mark = { id: string; quote: string | null; note: string | null };

/** Una lectura en breve: de dónde es, su extracto y lo que resaltaste. Se lee entera en Lecturas. */
function ReadingPeek({ reading: r, onClose }: { reading: ReadingRef; onClose: () => void }) {
  const { go } = useApp();
  const [marks, setMarks] = useState<Mark[] | null>(null);
  useEffect(() => {
    let live = true;
    void supabase
      .from('reading_annotations')
      .select('id,quote,note')
      .eq('reading_id', r.id)
      .limit(40)
      .then(({ data }) => live && setMarks((data ?? []) as Mark[]));
    return () => {
      live = false;
    };
  }, [r.id]);
  const host = hostOf(r.url);
  const shown = (marks ?? []).filter((m) => m.quote?.trim() || m.note?.trim());

  return (
    <div className="cz-rd">
      <EmbedBar label="Abrir en Lecturas" onOpen={() => go('Lecturas', { id: r.id })} onClose={onClose} />
      {r.cover && (
        <span className="cz-rd-cover">
          <img src={r.cover} alt="" referrerPolicy="no-referrer" />
        </span>
      )}
      <span className="cz-rd-kind">
        <Newspaper size={13} /> Lectura{host && ` · ${host}`}
      </span>
      <h2>{r.title || 'Sin título'}</h2>
      {r.excerpt && <p className="cz-rd-excerpt">{r.excerpt}</p>}
      <div className="cz-rd-actions">
        <button type="button" className="lt-add" onClick={() => go('Lecturas', { id: r.id })}>
          <BookOpen size={15} /> Leer
        </button>
        {r.url && (
          <a className="lt-add soft" href={r.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={15} /> Original
          </a>
        )}
      </div>
      {shown.length > 0 && (
        <section className="cz-rd-marks">
          <h3>
            <Highlighter size={14} /> Lo que resaltaste
          </h3>
          <ul>
            {shown.map((m) => (
              <li key={m.id}>
                {m.quote?.trim() && <blockquote>{m.quote}</blockquote>}
                {m.note?.trim() && <p>{m.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Una nota rápida se abre en su propio editor (como en Mi espacio) y se guarda al cerrar. */
function NoteHost({ id, onClose }: { id: string; onClose: () => void }) {
  const { workspace, go } = useApp();
  const store = useNotes(true);
  const cmd = useNoteCommands(store);
  const live = useMemo(
    () => (store.notes ?? []).filter((n) => !n.archived && !n.vaulted),
    [store.notes],
  );
  const tags = useMemo(() => [...new Set(live.flatMap((n) => n.tags))], [live]);
  const episodes = useMemo(
    () => workspace.episodes.map((e) => ({ id: e.id, title: e.title })),
    [workspace.episodes],
  );
  // Se fija al cargar: si la nota se archiva o se borra desde el editor, este no se desmonta solo.
  const [note, setNote] = useState<KeepNote | null | undefined>(undefined);
  useEffect(() => {
    if (store.notes === null || note !== undefined) return;
    const n = store.notes.find((x) => x.id === id);
    // En la bóveda (o ya no está): solo se abre desde Libroteca.
    if (!n || n.vaulted) {
      setNote(null);
      onClose();
      if (n) go('Libroteca', { id });
      return;
    }
    setNote(n);
  }, [store.notes, note, id, onClose, go]);

  if (!note) return null;
  return (
    <NoteSheet
      note={note}
      store={store}
      books={store.books}
      episodes={episodes}
      tagSuggestions={tags}
      extras={!store.outdated}
      onClose={onClose}
      onArchive={cmd.archive}
      onDuplicate={cmd.duplicate}
      onDelete={(n) => cmd.remove(n, onClose)}
    />
  );
}
