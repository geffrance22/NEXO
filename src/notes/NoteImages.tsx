import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { StoredImage } from '../data';
import { MAX_INPUT_BYTES, prepareImage, uploadToImgbb } from '../lib/imgbb';

/** Fotos por nota (lo mismo que permite la base de datos). */
export const MAX_NOTE_IMAGES = 12;

export type PendingImage = { id: string; preview: string; progress: number };

const isImage = (f: File) => f.type.startsWith('image/');
export const imagesOf = (data: DataTransfer | null) => [...(data?.files ?? [])].filter(isImage);

/**
 * Sube fotos a ImgBB y avisa cada vez que una termina. Mientras suben, muestra su vista previa con
 * el progreso. `room` dice cuántas caben aún en la nota.
 */
export function useNoteUploads(onDone: (image: StoredImage) => void, room: () => number) {
  const { notify } = useApp();
  const [pending, setPending] = useState<PendingImage[]>([]);
  const done = useRef(onDone);
  done.current = onDone;
  const free = useRef(room);
  free.current = room;
  const aborts = useRef(new Set<AbortController>());
  const count = useRef(0);

  useEffect(
    () => () => {
      for (const a of aborts.current) a.abort();
    },
    [],
  );

  const add = useCallback(
    (files: File[]) => {
      const images = files.filter(isImage);
      if (!images.length) return;
      const space = free.current() - count.current;
      if (space <= 0) {
        notify(`Una nota admite hasta ${MAX_NOTE_IMAGES} fotos.`);
        return;
      }
      if (images.length > space)
        notify(`Solo caben ${space} ${space === 1 ? 'foto más' : 'fotos más'} en esta nota.`);
      for (const file of images.slice(0, space)) {
        if (file.size > MAX_INPUT_BYTES) {
          notify(`«${file.name}» pesa más de 32 MB.`);
          continue;
        }
        const id = crypto.randomUUID();
        const preview = URL.createObjectURL(file);
        const ctrl = new AbortController();
        aborts.current.add(ctrl);
        count.current += 1;
        setPending((p) => [...p, { id, preview, progress: 0 }]);
        const finish = () => {
          aborts.current.delete(ctrl);
          count.current -= 1;
          setPending((p) => p.filter((x) => x.id !== id));
          URL.revokeObjectURL(preview);
        };
        void prepareImage(file)
          .then((blob) =>
            uploadToImgbb(blob, file.name || 'nota.jpg', {
              signal: ctrl.signal,
              onProgress: (f) =>
                setPending((p) => p.map((x) => (x.id === id ? { ...x, progress: f } : x))),
            }),
          )
          .then(
            (image) => {
              finish();
              done.current(image);
            },
            (e: Error) => {
              finish();
              if (e.name !== 'AbortError') notify(e.message || 'No se pudo subir la foto.');
            },
          );
      }
    },
    [notify],
  );

  return { pending, add, busy: pending.length > 0 };
}

/**
 * Fotos de una nota al estilo Keep: una sola ocupa todo el ancho; varias, en mosaico. Con
 * `onRemove`, cada una muestra su botón para quitarla.
 */
export function NoteGallery({
  images,
  pending = [],
  max,
  onOpen,
  onRemove,
}: {
  images: StoredImage[];
  pending?: PendingImage[];
  /** Cuántas mostrar como mucho (el resto, «+ N»). */
  max?: number;
  onOpen?: (index: number) => void;
  onRemove?: (index: number) => void;
}) {
  const total = images.length + pending.length;
  if (!total) return null;
  const limit = max ?? total;
  const shown = images.slice(0, limit);
  const hidden = images.length - shown.length;
  const cells = shown.length + (limit > shown.length ? pending.length : 0);
  const layout = cells <= 1 ? 'one' : cells === 2 || cells === 4 ? 'two' : 'three';

  return (
    <div className={'kp-gallery ' + layout}>
      {shown.map((img, i) => (
        <figure key={img.url + i} className="kp-shot">
          <img
            src={cells === 1 ? (img.medium ?? img.url) : (img.thumb ?? img.medium ?? img.url)}
            alt=""
            loading="lazy"
            draggable={false}
            onClick={
              onOpen
                ? (e) => {
                    e.stopPropagation();
                    onOpen(i);
                  }
                : undefined
            }
          />
          {hidden > 0 && i === shown.length - 1 && <span className="kp-shot-more">+{hidden}</span>}
          {onRemove && (
            <button
              type="button"
              className="kp-shot-x"
              aria-label="Quitar foto"
              title="Quitar foto"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(i);
              }}
            >
              <X size={14} />
            </button>
          )}
        </figure>
      ))}
      {limit > shown.length &&
        pending.map((p) => (
          <figure key={p.id} className="kp-shot loading">
            <img src={p.preview} alt="" draggable={false} />
            <span className="kp-shot-load">
              <LoaderCircle size={18} className="spin" />
              <i style={{ width: Math.round(p.progress * 100) + '%' }} />
            </span>
          </figure>
        ))}
    </div>
  );
}
