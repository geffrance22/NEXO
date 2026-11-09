import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Check, ChevronLeft, ImagePlus, Layers, LoaderCircle, Tv, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import type { Entry, EntryDetails, EntryInput, Kind } from '../data';
import { KindPicker } from './KindPicker';
import { incomeColors, kindMeta, seriesColors } from './kinds';
import { useComposer } from './useComposer';
import { BookView } from './views/BookView';
import { LearningView } from './views/LearningView';
import { MeetingView } from './views/MeetingView';
import { MoneyView } from './views/MoneyView';
import { MovieView } from './views/MovieView';
import { NoteView } from './views/NoteView';
import { TaskView } from './views/TaskView';
import type { ViewProps } from './views/shared';
import { WorkView } from './views/WorkView';
import { NoteEditor, fresh } from '../planner/NoteEditor';
import { SaveLink } from '../readings/SaveLink';
import { movieInfo, exactMovie, lookup, normal } from '../lib/moviePosters';
import { isSeries } from '../lib/entries';
import './composer.css';

const views: Record<Kind, (props: ViewProps) => React.JSX.Element> = {
  Nota: NoteView,
  Encuentro: MeetingView,
  Película: MovieView,
  Libro: BookView,
  Trabajo: WorkView,
  Aprendizaje: LearningView,
  Movimiento: MoneyView,
  Pendiente: TaskView,
};

export type ComposeInit = {
  /** Si se indica, se edita ese recuerdo. */
  entry?: Entry;
  /** Si se indica, se salta el selector y se abre directo ese tipo. */
  kind?: Kind;
  /** Personas que arrancan vinculadas. */
  links: string[];
  /** Detalles con los que arranca (p. ej. el lugar, si se abre desde su ficha). */
  details?: EntryDetails;
  /** Episodio en el que arranca (p. ej. si se abre desde su ficha). */
  episodeId?: string;
};

type ComposeModalProps = {
  init: ComposeInit;
  onSave: (input: EntryInput) => Promise<boolean>;
  onClose: () => void;
};

/** Ventana para crear o editar un recuerdo: primero eliges el tipo, luego escribes. */
export function ComposeModal({ init, onSave, onClose }: ComposeModalProps) {
  const { workspace, confirm, experiencesMissing, openPerson, notify } = useApp();
  const c = useComposer(
    {
      entry: init.entry,
      kind: init.kind ?? 'Nota',
      links: init.links,
      details: init.details,
      episodeId: init.episodeId,
    },
    workspace.people,
    workspace.ties,
  );
  // Episodios activos primero y luego los más recientes; el actual siempre aparece.
  const episodes = [...(workspace.episodes ?? [])]
    .sort(
      (a, b) =>
        Number(b.status === 'activo') - Number(a.status === 'activo') ||
        (b.starts_on ?? b.created_at).localeCompare(a.starts_on ?? a.created_at),
    )
    .filter((ep, i) => i < 30 || ep.id === c.episodeId);
  const [stage, setStage] = useState<'pick' | 'write'>(init.kind || init.entry ? 'write' : 'pick');
  const [shortcut, setShortcut] = useState<'idea' | 'link' | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Al volver al selector desde un formulario, se marca el tipo que estabas usando.
  const [hasChosen, setHasChosen] = useState(Boolean(init.kind || init.entry));
  const form = useRef<HTMLFormElement>(null);

  const meta = kindMeta[c.kind];
  const series = isSeries({ kind: c.kind, tags: c.tags, details: c.details });
  const colors =
    c.kind === 'Movimiento' && c.direction === 'ingreso'
      ? incomeColors
      : series
        ? seriesColors
        : meta;
  const Icon = series ? Tv : meta.icon;
  const View = views[c.kind];
  // «Parte de» (episodio): en Película y Libro no se muestra.
  const showEpisode =
    !experiencesMissing && episodes.length > 0 && c.kind !== 'Película' && c.kind !== 'Libro';

  // Al pasar a escribir, el cursor va al campo principal.
  useEffect(() => {
    if (stage !== 'write') return;
    const timer = window.setTimeout(() => {
      form.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [stage, c.kind]);

  const requestClose = async () => {
    if (c.dirty) {
      const discard = await confirm({
        title: '¿Descartar lo que escribiste?',
        message: 'Los cambios que no hayas guardado se perderán.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir editando',
        danger: true,
        icon: 'warning',
      });
      if (!discard) return;
    }
    onClose();
  };

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (c.problem || busy) return;
    setBusy(true);
    const input = c.toInput();
    if (input.kind === 'Película') {
      const poster = input.details.tmdbPoster,
        year = input.details.year || '',
        key = normal(input.title) + '|' + year;
      // Si elegiste película o serie, se busca solo en eso; si no, en las dos.
      const want =
        input.details.series === undefined ? undefined : input.details.series ? 'tv' : 'movie';
      const otherType = Boolean(want && poster?.id && (poster.type ?? 'movie') !== want);
      if (!poster?.manual && (poster?.key !== key || otherType)) {
        delete input.details.tmdbPoster;
        if (input.title.trim().length >= 2)
          try {
            const movie = exactMovie(await lookup(input.title, year, want), input.title, year);
            if (movie)
              input.details.tmdbPoster = {
                id: movie.id,
                type: movie.type,
                path: movie.path || undefined,
                key,
              };
          } catch {
            /* The movie can still be saved without a poster. */
          }
      }
      const selected = input.details.tmdbPoster;
      const info = input.details.movieInfo;
      if (
        selected?.id &&
        (info?.id !== selected.id || (info.type ?? 'movie') !== (selected.type ?? 'movie'))
      )
        try {
          input.details.movieInfo = await movieInfo(selected.id, selected.type);
        } catch {
          delete input.details.movieInfo;
        }
      if (input.details.movieInfo?.year) input.details.year = input.details.movieInfo.year;
      if (selected && !selected.manual)
        selected.key = normal(input.title) + '|' + (input.details.year || '');
    }
    const saved = await onSave(input);
    setBusy(false);
    if (saved) onClose();
  }

  const addFiles = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return false;
    if (meta.cover) c.uploads.add(images.slice(0, 1), true);
    else c.uploads.add(images);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      void submit();
      return;
    }
    // Enter en un campo de una línea no debe guardar a medias. Solo guarda en los campos
    // marcados (el pendiente y el monto); en nota y aprendizaje salta al texto.
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.closest('[data-enter-saves]')) return;
    e.preventDefault();
    if (
      target.classList.contains('cp-title-input') &&
      (c.kind === 'Nota' || c.kind === 'Aprendizaje')
    ) {
      form.current?.querySelector<HTMLElement>('textarea.cp-writing, .cp-idea textarea')?.focus();
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    if (addFiles(Array.from(e.clipboardData.files))) e.preventDefault();
  };
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  function saved(type: 'idea' | 'link') {
    window.dispatchEvent(new Event('nexo:' + type + '-saved'));
    notify(type === 'idea' ? 'Idea guardada en Notas.' : 'Enlace disponible en Lecturas.');
    onClose();
  }
  if (shortcut === 'idea')
    return <NoteEditor initial={fresh(null)} close={onClose} saved={() => saved('idea')} />;
  if (shortcut === 'link')
    return (
      <SaveLink
        close={onClose}
        saved={() => saved('link')}
        savedMany={(n) => {
          window.dispatchEvent(new Event('nexo:link-saved'));
          notify(
            n === 1 ? 'Enlace disponible en Lecturas.' : `${n} enlaces disponibles en Lecturas.`,
          );
          onClose();
        }}
      />
    );
  return (
    <Sheet
      yieldTo=".mp-picker[open],.reader-dialog[open]"
      label={c.editing ? 'Editar recuerdo' : 'Nuevo recuerdo'}
      size={stage === 'pick' ? 'md' : 'lg'}
      onRequestClose={requestClose}
    >
      {stage === 'pick' ? (
        <KindPicker
          onShortcut={(key) => {
            if (key === 'person') openPerson();
            else setShortcut(key);
          }}
          current={hasChosen ? c.kind : undefined}
          onClose={requestClose}
          onPick={(kind) => {
            c.setKind(kind);
            setHasChosen(true);
            setStage('write');
          }}
        />
      ) : (
        <form
          ref={form}
          className="cp-composer"
          data-kind={c.kind}
          style={
            {
              '--accent': colors.accent,
              '--soft': colors.soft,
              '--ink': colors.ink,
            } as CSSProperties
          }
          onSubmit={submit}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <header className="cp-head">
            <button
              type="button"
              className="cp-kind-chip"
              title="Cambiar el tipo"
              onClick={() => setStage('pick')}
            >
              <ChevronLeft size={16} />
              <Icon size={17} />
              <strong>{series ? 'Serie' : c.kind}</strong>
            </button>
            {c.editing && <span className="cp-editing">Editando</span>}
            <button type="button" className="cp-close" aria-label="Cerrar" onClick={requestClose}>
              <X size={20} />
            </button>
          </header>

          <div className="cp-scroll">
            <View key={c.kind} c={c} />
            {showEpisode && (
              <label className="cp-episode">
                <Layers size={15} aria-hidden="true" />
                <span>Parte de</span>
                <select
                  value={c.episodeId ?? ''}
                  onChange={(e) => c.setEpisodeId(e.target.value || null)}
                >
                  <option value="">Ningún episodio</option>
                  {episodes.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.title}
                      {ep.status === 'cerrado' ? ' (cerrado)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <footer className="cp-foot">
            <span className={'cp-status' + (c.problem ? ' problem' : '')} role="status">
              {c.problem ?? 'Ctrl + Enter para guardar'}
            </span>
            <button type="button" className="cp-btn ghost" onClick={requestClose}>
              Cancelar
            </button>
            <button className="cp-btn cta" disabled={Boolean(c.problem) || busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
              {c.editing ? 'Guardar cambios' : series ? 'Guardar serie' : meta.saveLabel}
            </button>
          </footer>

          {dragging && (
            <div className="cp-drop" aria-hidden="true">
              <ImagePlus size={34} />
              <strong>Suelta tu foto aquí</strong>
              <span>Se sube a ImgBB y queda en este recuerdo</span>
            </div>
          )}
        </form>
      )}
    </Sheet>
  );
}
