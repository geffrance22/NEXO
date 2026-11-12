import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import {
  ALargeSmall,
  AlignLeft,
  Bell,
  Check,
  ExternalLink,
  Hash,
  ImagePlus,
  Layers,
  ListChecks,
  NotebookTabs,
  Palette,
  Pin,
  PinOff,
  Redo2,
  Undo2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { askNote } from '../assistant';
import { AskSelection } from '../composer/AskSelection';
import { historyKeys, useTextHistory } from '../composer/useTextHistory';
import type { Named } from '../planner/shared';
import { anchorOf, appendToNote, insertBelow, NOTE_QUICK, type NoteAnchor } from './askNote';
import { hostOf, linksIn } from './links';
import { parseLines, stripMarks } from './marks';
import { imagesOf, MAX_NOTE_IMAGES, NoteGallery, useNoteUploads } from './NoteImages';
import { AutoText, CheckEditor, IconButton, Pop, Swatches, TagEditor } from './parts';
import { ReminderChip, ReminderMenu } from './reminders';
import { FormatBar, RichNote, useRichEditor, type AskTarget } from './RichNote';
import type { KeepNote } from './useNotes';

export type Draft = Omit<KeepNote, 'id' | 'created_at' | 'rank' | 'vaulted' | 'secret'>;
export type SetDraft = (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => void;
/** `setDraft` de React convertido en el `set` que espera el formulario. */
export const draftSetter =
  (setDraft: (fn: (d: Draft) => Draft) => void): SetDraft =>
  (p) =>
    setDraft((d) => ({ ...d, ...(typeof p === 'function' ? p(d) : p) }));

export const blankDraft = (book_id: string | null = null): Draft => ({
  title: '',
  body: '',
  color: 'linen',
  tags: [],
  checks: [],
  book_id,
  episode_id: null,
  pinned: false,
  archived: false,
  images: [],
  remind_at: null,
});

export const draftOf = (n: KeepNote): Draft => ({
  title: n.title,
  body: n.body,
  color: n.color,
  tags: [...n.tags],
  checks: n.checks.map((c) => ({ ...c })),
  book_id: n.book_id,
  episode_id: n.episode_id,
  pinned: n.pinned,
  archived: n.archived,
  images: [...n.images],
  remind_at: n.remind_at,
});

/** Lo que se guarda: sin espacios sobrantes ni puntos vacíos. */
export const cleanDraft = (d: Draft): Draft => ({
  ...d,
  title: d.title.trim().slice(0, 240),
  body: d.body.replace(/\s+$/, ''),
  checks: d.checks.filter((c) => c.text.trim()).map((c) => ({ ...c, text: c.text.trim() })),
});

const BULLET = /^\s*(?:[-*•]|\[\s?[xX]?\])\s*/;

/**
 * El cuerpo de una nota (título, texto o lista, etiquetas) con su barra de herramientas. Lo usan el
 * cuadro «Escribe una nota…» y la ventana de edición.
 */
export function NoteForm({
  draft,
  set,
  books,
  episodes,
  tagSuggestions,
  initialList,
  autoFocus,
  start,
  end,
  onSubmit,
  vault,
  extras = true,
  onBusyChange,
}: {
  draft: Draft;
  set: SetDraft;
  books: Named[];
  episodes: { id: string; title: string }[];
  tagSuggestions: string[];
  /** Abre en modo lista aunque aún no tenga puntos. */
  initialList?: boolean;
  autoFocus?: 'title' | 'body' | 'list';
  /** Botones extra en la barra, junto a los de siempre. */
  start?: ReactNode;
  /** Botones al final de la barra (Cerrar, Listo…). */
  end?: ReactNode;
  /** Ctrl + Enter. */
  onSubmit: () => void;
  /** Nota de la bóveda: sin cuaderno ni episodio (no se guardan en claro). */
  vault?: boolean;
  /** Fotos y recordatorios (necesitan la migración nueva). */
  extras?: boolean;
  /** Avisa mientras hay fotos subiendo (para no cerrar antes de tiempo). */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { openImages, notify } = useApp();
  const [list, setList] = useState(initialList || draft.checks.length > 0);
  const [tagging, setTagging] = useState(false);
  const [fmt, setFmt] = useState(false);
  const editor = useRichEditor();
  const history = useTextHistory(draft.body, (body) => set({ body }));
  // Preguntar a la IA sobre lo seleccionado. La respuesta llega segundos después: se añade sobre
  // el texto de ese momento (por si seguiste escribiendo), nunca sobre el de cuando preguntaste.
  const [asking, setAsking] = useState<(AskTarget & { anchor: NoteAnchor | null }) | null>(
    null,
  );
  const bodyRef = useRef(draft.body);
  bodyRef.current = draft.body;
  const titleRef = useRef(draft.title);
  titleRef.current = draft.title;
  const openAsk = (t: AskTarget) =>
    setAsking({ ...t, anchor: anchorOf(draft.body, t.quote, t.found) });
  /** Deja `next` como texto de la nota (un paso de deshacer) y lleva el cursor a lo añadido. */
  const addToNote = (next: string, said: string) => {
    setAsking(null);
    if (next === bodyRef.current) return;
    editor.follow.current = true;
    history.change(next);
    notify(said);
  };
  const hasText = !list || Boolean(draft.body);
  const root = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const book = vault ? undefined : books.find((b) => b.id === draft.book_id);
  const episode = vault ? undefined : episodes.find((e) => e.id === draft.episode_id);
  const roomRef = useRef(0);
  roomRef.current = MAX_NOTE_IMAGES - draft.images.length;
  const uploads = useNoteUploads(
    (image) => set((d) => ({ images: [...d.images, image].slice(0, MAX_NOTE_IMAGES) })),
    () => roomRef.current,
  );
  // Con llaves: el efecto no debe devolver nada (React llamaría al valor como limpieza).
  useEffect(() => {
    onBusyChange?.(uploads.busy);
  }, [uploads.busy]);
  const links = linksIn(draft.body);

  /** Pegar: fotos del portapapeles se suben (el texto lo pega el propio editor). */
  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    const files = imagesOf(e.clipboardData);
    if (files.length && extras) {
      e.preventDefault();
      uploads.add(files);
    }
  };

  const focusBody = () =>
    root.current?.querySelector<HTMLElement>('.kp-body, .kp-ci.add .kp-ci-text')?.focus();
  useEffect(() => {
    if (autoFocus === 'list') focusBody();
    // Solo al abrir.
  }, []);

  const toList = () => {
    // Cada línea, sin viñetas ni marcas de formato (los enlaces se conservan).
    const lines = parseLines(draft.body)
      .map((l) => stripMarks(l.text).replace(BULLET, '').trim())
      .filter(Boolean);
    set({
      body: '',
      checks: [
        ...draft.checks,
        ...lines.map((text) => ({
          id: crypto.randomUUID(),
          text,
          done: false,
        })),
      ],
    });
    history.reset('');
    setList(true);
  };
  const toText = () => {
    const lines = draft.checks.map((c) => c.text.trim()).filter(Boolean);
    const body = [draft.body.trim(), ...lines].filter(Boolean).join('\n');
    set({ body, checks: [] });
    history.reset(body);
    setList(false);
  };

  return (
    <div
      className={'kp-form' + (dropping ? ' dropping' : '')}
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onSubmit();
        }
      }}
      onPaste={onPaste}
      onDragOver={(e) => {
        if (!extras || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!extras) return;
        const files = imagesOf(e.dataTransfer);
        setDropping(false);
        if (!files.length) return;
        e.preventDefault();
        uploads.add(files);
      }}
    >
      {(draft.images.length > 0 || uploads.pending.length > 0) && (
        <NoteGallery
          images={draft.images}
          pending={uploads.pending}
          onOpen={(i) => openImages(draft.images, i)}
          onRemove={(i) => set((d) => ({ images: d.images.filter((_, j) => j !== i) }))}
        />
      )}
      <div className="kp-form-head">
        <AutoText
          className="kp-title"
          placeholder="Título"
          aria-label="Título"
          maxLength={240}
          autoFocus={autoFocus === 'title'}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value.replace(/\n/g, ' ') })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              focusBody();
            }
          }}
        />
        <IconButton
          icon={draft.pinned ? PinOff : Pin}
          className={'kp-pin-btn' + (draft.pinned ? ' on' : '')}
          label={draft.pinned ? 'No fijar' : 'Fijar nota'}
          pressed={draft.pinned}
          size={17}
          onClick={() => set({ pinned: !draft.pinned })}
        />
      </div>

      <div className="kp-form-scroll">
        {(!list || draft.body) && (
          <RichNote
            editor={editor}
            className="kp-body"
            placeholder={list ? 'Texto' : 'Escribe una nota…'}
            label="Nota"
            autoFocus={autoFocus === 'body'}
            value={draft.body}
            onChange={(body) => set({ body })}
            history={history}
            // Las notas de la bóveda se guardan cifradas: no se le mandan a la IA.
            onAsk={vault ? undefined : openAsk}
          />
        )}
        {asking && (
          <AskSelection
            quote={asking.quote}
            point={asking.point}
            quick={NOTE_QUICK}
            placeholder="Pregunta algo o pide que lo añada a la nota…"
            onAsk={(prompt) =>
              askNote({
                selection: asking.quote,
                prompt,
                text: bodyRef.current,
                title: titleRef.current,
              })
            }
            onInsert={(text) => {
              const r = insertBelow(bodyRef.current, text, asking.anchor, asking.quote);
              addToNote(
                r.body,
                r.where === 'below'
                  ? 'Añadido debajo de la selección.'
                  : 'No encontré la selección: lo añadí al final de la nota.',
              );
            }}
            onAppend={(text) =>
              addToNote(appendToNote(bodyRef.current, text), 'Añadido al final de la nota.')
            }
            onClose={() => setAsking(null)}
          />
        )}
        {list && <CheckEditor checks={draft.checks} onChange={(checks) => set({ checks })} />}

        {links.length > 0 && (
          <div className="kp-links" aria-label="Enlaces de la nota">
            {links.slice(0, 8).map((l) => (
              <a
                key={l.href}
                className="kp-link-chip"
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                title={l.href}
              >
                <ExternalLink size={12} />
                <span>
                  {l.label === l.href || /^(https?:|www\.)/i.test(l.label)
                    ? hostOf(l.href)
                    : l.label}
                </span>
              </a>
            ))}
          </div>
        )}

        {(draft.tags.length > 0 || tagging) && (
          <TagEditor
            tags={draft.tags}
            onChange={(tags) => set({ tags })}
            suggestions={tagSuggestions}
            autoFocus={tagging && !draft.tags.length}
          />
        )}

        {(book || episode || draft.remind_at) && (
          <div className="kp-form-meta">
            {draft.remind_at && (
              <ReminderChip iso={draft.remind_at} onClear={() => set({ remind_at: null })} />
            )}
            {book && (
              <span className="kp-meta-chip">
                <NotebookTabs size={12} /> {book.name}
                <button
                  type="button"
                  aria-label="Quitar del cuaderno"
                  onClick={() => set({ book_id: null })}
                >
                  <X size={11} />
                </button>
              </span>
            )}
            {episode && (
              <span className="kp-meta-chip">
                <Layers size={12} /> {episode.title}
                <button
                  type="button"
                  aria-label="Desvincular episodio"
                  onClick={() => set({ episode_id: null })}
                >
                  <X size={11} />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {fmt && hasText && <FormatBar editor={editor} onClose={() => setFmt(false)} />}
      <div className="kp-toolbar">
        {hasText && (
          <IconButton
            icon={ALargeSmall}
            label="Opciones de formato"
            pressed={fmt}
            size={18}
            onClick={() => setFmt((f) => !f)}
          />
        )}
        <Pop icon={Palette} label="Color">
          {() => <Swatches value={draft.color} onPick={(color) => set({ color })} />}
        </Pop>
        <IconButton
          icon={list ? AlignLeft : ListChecks}
          label={list ? 'Ocultar casillas' : 'Mostrar casillas'}
          onClick={list ? toText : toList}
        />
        <IconButton
          icon={Hash}
          label="Etiquetas"
          pressed={tagging}
          onClick={() => setTagging((t) => !t)}
        />
        {extras && (
          <>
            <IconButton
              icon={ImagePlus}
              label="Añadir imagen"
              onClick={() => file.current?.click()}
            />
            <input
              ref={file}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                uploads.add([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <Pop icon={Bell} label="Recordármelo">
              {(close) => (
                <ReminderMenu
                  value={draft.remind_at}
                  onPick={(remind_at) => set({ remind_at })}
                  close={close}
                />
              )}
            </Pop>
          </>
        )}
        {!vault && (
          <Pop icon={NotebookTabs} label="Cuaderno">
            {(close) => (
              <div className="kp-menu">
                <p>Cuaderno</p>
                {[{ id: '', name: 'Sin cuaderno' }, ...books].map((b) => (
                  <button
                    type="button"
                    key={b.id || 'none'}
                    className={(draft.book_id ?? '') === b.id ? 'on' : ''}
                    onClick={() => {
                      set({ book_id: b.id || null });
                      close();
                    }}
                  >
                    {b.name}
                    {(draft.book_id ?? '') === b.id && <Check size={14} />}
                  </button>
                ))}
                {!books.length && <small>Crea cuadernos desde la barra de filtros.</small>}
              </div>
            )}
          </Pop>
        )}
        {!vault && episodes.length > 0 && (
          <Pop icon={Layers} label="Vincular episodio">
            {(close) => (
              <div className="kp-menu scroll">
                <p>Episodio</p>
                {[{ id: '', title: 'Sin episodio' }, ...episodes].map((ep) => (
                  <button
                    type="button"
                    key={ep.id || 'none'}
                    className={(draft.episode_id ?? '') === ep.id ? 'on' : ''}
                    onClick={() => {
                      set({ episode_id: ep.id || null });
                      close();
                    }}
                  >
                    {ep.title}
                    {(draft.episode_id ?? '') === ep.id && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </Pop>
        )}
        {start}
        {hasText && (
          <span className="kp-history" role="group" aria-label="Historial de la nota">
            <button
              type="button"
              className="kp-ic"
              aria-label="Deshacer"
              title={`Deshacer (${historyKeys.undo})`}
              disabled={!history.canUndo}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.step(history, 'undo')}
            >
              <Undo2 size={17} />
            </button>
            <button
              type="button"
              className="kp-ic"
              aria-label="Rehacer"
              title={`Rehacer (${historyKeys.redo})`}
              disabled={!history.canRedo}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.step(history, 'redo')}
            >
              <Redo2 size={17} />
            </button>
          </span>
        )}
        <span className="kp-toolbar-gap" />
        {end}
      </div>
    </div>
  );
}
