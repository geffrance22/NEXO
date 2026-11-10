import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { StoredImage } from '../data';
import {
  Archive,
  ArchiveRestore,
  Bell,
  Copy,
  ImagePlus,
  Kanban,
  Layers,
  Lock,
  LockOpen,
  MoreVertical,
  NotebookTabs,
  Palette,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { NoteText } from './NoteText';
import { imagesOf, MAX_NOTE_IMAGES, NoteGallery, useNoteUploads } from './NoteImages';
import { colorOf } from './palette';
import { IconButton, Pop, Swatches } from './parts';
import { ReminderChip, ReminderMenu } from './reminders';
import type { KeepNote } from './useNotes';

/** Puntos visibles en la tarjeta antes de «+ N más». */
const CHECKS_SHOWN = 8;
/** Fotos visibles en la tarjeta antes de «+ N». */
const IMAGES_SHOWN = 6;

export type CardActions = {
  open: (n: KeepNote) => void;
  pin: (n: KeepNote) => void;
  color: (n: KeepNote, color: string) => void;
  toggleCheck: (n: KeepNote, checkId: string) => void;
  archive: (n: KeepNote) => void;
  duplicate: (n: KeepNote) => void;
  remove: (n: KeepNote) => void;
  toBoard: (n: KeepNote) => void;
  filterTag: (tag: string) => void;
  /** Añade una foto ya subida a la nota (con su contenido más reciente). */
  attach: (noteId: string, image: StoredImage) => void;
  openImage: (n: KeepNote, index: number) => void;
  remind: (n: KeepNote, iso: string | null) => void;
  /** Meter en la bóveda o sacar de ella. */
  vault: (n: KeepNote) => void;
};

/** Una nota en el tablero, al estilo Keep: se abre al tocarla; sus herramientas, al pasar encima. */
export function NoteCard({
  note,
  actions,
  bookName,
  episodeTitle,
  inVault,
  extras = true,
}: {
  note: KeepNote;
  actions: CardActions;
  bookName?: string;
  episodeTitle?: string;
  /** Tarjeta dentro de la bóveda. */
  inVault?: boolean;
  /** Fotos, recordatorios y bóveda (necesitan la migración nueva). */
  extras?: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const uploads = useNoteUploads(
    (image) => actions.attach(note.id, image),
    () => MAX_NOTE_IMAGES - note.images.length,
  );
  const pending = uploads.pending;
  const c = colorOf(note.color);
  const open = note.checks.filter((x) => !x.done);
  const done = note.checks.filter((x) => x.done);
  const visible = open.slice(0, CHECKS_SHOWN);
  const hiddenOpen = open.length - visible.length;
  const hasImages = note.images.length > 0 || pending.length > 0;
  const empty = !note.title && !note.body && !note.checks.length && !hasImages;
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      actions.open(note);
    }
  };

  return (
    <article
      className={
        'kp-card' + (note.color === 'linen' ? ' plain' : '') + (hasImages ? ' has-media' : '')
      }
      style={{ '--kp-bg': c.bg, '--kp-ink': c.ink } as CSSProperties}
      onDragOver={(e) => {
        if (extras && e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = extras ? imagesOf(e.dataTransfer) : [];
        if (!files.length) return;
        e.preventDefault();
        uploads.add(files);
      }}
    >
      <IconButton
        icon={note.pinned ? PinOff : Pin}
        className={'kp-card-pin' + (note.pinned ? ' on' : '')}
        label={note.pinned ? 'No fijar' : 'Fijar nota'}
        pressed={note.pinned}
        onClick={() => actions.pin(note)}
      />
      <div
        className="kp-card-body"
        role="button"
        tabIndex={0}
        aria-label={`Abrir nota ${note.title || ''}`.trim()}
        onClick={() => actions.open(note)}
        onKeyDown={onKey}
      >
        {hasImages && (
          <NoteGallery
            images={note.images}
            pending={pending}
            max={IMAGES_SHOWN}
            onOpen={(i) => actions.openImage(note, i)}
          />
        )}
        {note.title && <h3>{note.title}</h3>}
        {note.body && (
          <div className="kp-card-text kp-md">
            <NoteText text={note.body} />
          </div>
        )}
        {note.checks.length > 0 && (
          <ul className="kp-card-checks">
            {visible.map((x) => (
              <li key={x.id}>
                <input
                  type="checkbox"
                  checked={false}
                  aria-label={`Marcar ${x.text}`}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => actions.toggleCheck(note, x.id)}
                />
                <span>{x.text}</span>
              </li>
            ))}
            {hiddenOpen > 0 && <li className="kp-card-more">+ {hiddenOpen} más</li>}
            {done.length > 0 && (
              <li className="kp-card-more">
                {done.length === 1 ? '+ 1 elemento marcado' : `+ ${done.length} elementos marcados`}
              </li>
            )}
          </ul>
        )}
        {empty && <p className="kp-card-text faint">Nota vacía</p>}
        {(note.tags.length > 0 || bookName || episodeTitle || note.remind_at) && (
          <div className="kp-card-chips">
            {note.remind_at && <ReminderChip iso={note.remind_at} />}
            {bookName && (
              <span className="kp-meta-chip">
                <NotebookTabs size={11} /> {bookName}
              </span>
            )}
            {episodeTitle && (
              <span className="kp-meta-chip">
                <Layers size={11} /> {episodeTitle}
              </span>
            )}
            {note.tags.map((t) => (
              <button
                type="button"
                key={t}
                className="kp-tag"
                title={`Ver las notas con #${t}`}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.filterTag(t);
                }}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>
      <footer className="kp-card-tools">
        <Pop icon={Palette} label="Color">
          {() => <Swatches value={note.color} onPick={(color) => actions.color(note, color)} />}
        </Pop>
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
                  value={note.remind_at}
                  onPick={(iso) => actions.remind(note, iso)}
                  close={close}
                />
              )}
            </Pop>
          </>
        )}
        {!inVault && (
          <IconButton
            icon={note.archived ? ArchiveRestore : Archive}
            label={note.archived ? 'Desarchivar' : 'Archivar'}
            onClick={() => actions.archive(note)}
          />
        )}
        {!inVault && (
          <IconButton
            icon={Kanban}
            label="Crear tarjeta en un tablero"
            onClick={() => actions.toBoard(note)}
          />
        )}
        <Pop icon={MoreVertical} label="Más opciones" align="end">
          {(close) => (
            <div className="kp-menu">
              <button
                type="button"
                onClick={() => {
                  close();
                  actions.duplicate(note);
                }}
              >
                <Copy size={14} /> Hacer una copia
              </button>
              {extras && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    actions.vault(note);
                  }}
                >
                  {inVault ? <LockOpen size={14} /> : <Lock size={14} />}
                  {inVault ? 'Sacar de la bóveda' : 'Mover a la bóveda'}
                </button>
              )}
              <button
                type="button"
                className="danger"
                onClick={() => {
                  close();
                  actions.remove(note);
                }}
              >
                <Trash2 size={14} /> Eliminar nota
              </button>
            </div>
          )}
        </Pop>
      </footer>
    </article>
  );
}
