import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoredImage } from '../data';
import { errorMessage } from '../lib/format';
import { MAX_INPUT_BYTES, prepareImage, uploadToImgbb } from '../lib/imgbb';

export type UploadItem = {
  id: string;
  /** Imagen para mostrar mientras tanto: la foto local o la miniatura ya subida. */
  preview: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  image?: StoredImage;
  error?: string;
  /** Se conserva para poder reintentar si falla. */
  file?: File;
  /** Si `preview` es una URL local que hay que liberar. */
  local?: boolean;
};

const safeName = (file: File) => file.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'foto.jpg';

/** Si la foto se reconvirtió a JPEG, el nombre debe terminar en .jpg. */
const nameFor = (original: File, sent: Blob) => {
  const name = safeName(original);
  return sent.type === 'image/jpeg' && !/\.jpe?g$/i.test(name)
    ? name.replace(/\.\w+$/, '') + '.jpg'
    : name;
};

/**
 * Fotos de un recuerdo. Cada foto empieza a subirse a ImgBB en cuanto se elige, así que al
 * terminar de escribir ya suele estar lista.
 */
export function useImageUploads(initial: StoredImage[], max = 8) {
  const [items, setItems] = useState<UploadItem[]>(() =>
    initial.map((image) => ({
      id: crypto.randomUUID(),
      preview: image.thumb ?? image.medium ?? image.url,
      status: 'done',
      progress: 1,
      image,
    })),
  );
  const [notice, setNotice] = useState('');
  const [touched, setTouched] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const latest = useRef(items);
  latest.current = items;

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const start = useCallback(
    async (id: string, file: File) => {
      const controller = new AbortController();
      controllers.current.set(id, controller);
      try {
        const blob = await prepareImage(file);
        if (controller.signal.aborted) return;
        const image = await uploadToImgbb(blob, nameFor(file, blob), {
          signal: controller.signal,
          onProgress: (progress) => patch(id, { progress }),
        });
        patch(id, { status: 'done', progress: 1, image, file: undefined });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        patch(id, { status: 'error', error: errorMessage(e) });
      } finally {
        controllers.current.delete(id);
      }
    },
    [patch],
  );

  const discard = useCallback((item: UploadItem) => {
    controllers.current.get(item.id)?.abort();
    controllers.current.delete(item.id);
    if (item.local) URL.revokeObjectURL(item.preview);
  }, []);

  /** Agrega fotos. Con `replace` sustituye a las que había (para portadas y pósters). */
  const add = useCallback(
    (files: File[], replace = false) => {
      setNotice('');
      const images = files.filter((f) => f.type.startsWith('image/'));
      const sized = images.filter((f) => f.size <= MAX_INPUT_BYTES);
      const kept = replace ? [] : latest.current;
      const room = max - kept.length;
      const accepted = sized.slice(0, Math.max(room, 0));
      if (images.length < files.length) setNotice('Solo se pueden subir imágenes.');
      else if (sized.length < images.length) setNotice('Una foto pesa más de 32 MB y no se subió.');
      else if (accepted.length < sized.length) setNotice(`Máximo ${max} fotos.`);
      if (!accepted.length) return;

      if (replace) latest.current.forEach(discard);
      const fresh: UploadItem[] = accepted.map((file) => ({
        id: crypto.randomUUID(),
        preview: URL.createObjectURL(file),
        status: 'uploading',
        progress: 0,
        file,
        local: true,
      }));
      setItems((list) => [...(replace ? [] : list), ...fresh]);
      setTouched(true);
      fresh.forEach((item) => void start(item.id, item.file!));
    },
    [max, start, discard],
  );

  const remove = useCallback(
    (id: string) => {
      const item = latest.current.find((i) => i.id === id);
      if (item) discard(item);
      setItems((list) => list.filter((i) => i.id !== id));
      setNotice('');
      setTouched(true);
    },
    [discard],
  );

  const retry = useCallback(
    (id: string) => {
      const item = latest.current.find((i) => i.id === id);
      if (!item?.file) return;
      patch(id, { status: 'uploading', progress: 0, error: undefined });
      void start(id, item.file);
    },
    [patch, start],
  );

  /** Vacía la lista (p. ej. después de guardar una nota) sin tocar lo ya subido. */
  const reset = useCallback(() => {
    latest.current.forEach(discard);
    setItems([]);
    setNotice('');
    setTouched(false);
  }, [discard]);

  // Al cerrar el formulario se cancelan las subidas pendientes y se liberan las vistas previas.
  useEffect(() => {
    const running = controllers.current;
    return () => {
      running.forEach((c) => c.abort());
      latest.current.forEach((i) => i.local && URL.revokeObjectURL(i.preview));
    };
  }, []);

  return {
    items,
    add,
    remove,
    retry,
    reset,
    notice,
    touched,
    max,
    /** Hay fotos subiéndose: no se puede guardar todavía. */
    busy: items.some((i) => i.status === 'uploading'),
    hasError: items.some((i) => i.status === 'error'),
    /** Las fotos ya subidas, listas para guardar. */
    images: items.flatMap((i) => (i.status === 'done' && i.image ? [i.image] : [])),
  };
}

export type ImageUploads = ReturnType<typeof useImageUploads>;
