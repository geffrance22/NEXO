import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import {
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
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Named } from '../planner/shared';
import { hostOf, htmlToNoteText, linksIn } from './links';
import { imagesOf, MAX_NOTE_IMAGES, NoteGallery, useNoteUploads } from './NoteImages';
import { AutoText, CheckEditor, IconButton, Pop, Swatches, TagEditor } from './parts';
import { ReminderChip, ReminderMenu } from './reminders';
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
  const { openImages } = useApp();
  const [list, setList] = useState(initialList || draft.checks.length > 0);
  const [tagging, setTagging] = useState(false);
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

  /** Pegar: fotos del portapapeles se suben; texto con hipervínculos los conserva. */
  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    const files = imagesOf(e.clipboardData);
    if (files.length && extras) {
      e.preventDefault();
      uploads.add(files);
      return;
    }
    const target = e.target as HTMLTextAreaElement;
    if (!target.classList.contains('kp-body')) return;
    const text = htmlToNoteText(e.clipboardData.getData('text/html'));
    if (text === null) return;
    e.preventDefault();
    const { selectionStart: a, selectionEnd: b, value } = target;
    const next = value.slice(0, a) + text + value.slice(b);
    set({ body: next });
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = a + text.length;
    });
  };

  const focusBody = () =>
    root.current?.querySelector<HTMLElement>('.kp-body, .kp-ci.add .kp-ci-text')?.focus();
  useEffect(() => {
    if (autoFocus === 'list') focusBody();
    // Solo al abrir.
  }, []);

  const toList = () => {
    const lines = draft.body
      .split('\n')
      .map((l) => l.replace(BULLET, '').trim())
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
    setList(true);
  };
  const toText = () => {
    const lines = draft.checks.map((c) => c.text.trim()).filter(Boolean);
    set({
      body: [draft.body.trim(), ...lines].filter(Boolean).join('\n'),
      checks: [],
    });
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
          <AutoText
            className="kp-body"
            placeholder={list ? 'Texto' : 'Escribe una nota…'}
            aria-label="Nota"
            autoFocus={autoFocus === 'body'}
            value={draft.body}
            onChange={(e) => set({ body: e.target.value })}
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

      <div className="kp-toolbar">
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
        <span className="kp-toolbar-gap" />
        {end}
      </div>
    </div>
  );
}
