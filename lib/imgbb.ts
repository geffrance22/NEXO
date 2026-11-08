import type { StoredImage } from '../data';

const ENDPOINT = 'https://api.imgbb.com/1/upload';
/** ImgBB admite hasta 32 MB por imagen. */
export const MAX_INPUT_BYTES = 32 * 1024 * 1024;
/** Lado máximo tras reducir: suficiente para ver la foto completa en pantalla. */
const MAX_SIDE = 1800;
/** Por debajo de este peso (y del lado máximo) la foto se sube tal cual. */
const KEEP_AS_IS_BYTES = 1.5 * 1024 * 1024;

export const hasImgbbKey = () => Boolean(import.meta.env.VITE_IMGBB_API_KEY);

/** Convierte la respuesta de ImgBB en lo que guardamos de la foto. */
export function parseImgbbResponse(json: unknown): StoredImage {
  const data = (json as { success?: boolean; data?: Record<string, { url?: string } | string> })
    ?.data;
  const asUrl = (v: unknown) =>
    typeof v === 'object' && v ? (v as { url?: string }).url : undefined;
  const url = (typeof data?.url === 'string' ? data.url : undefined) ?? asUrl(data?.image);
  if (!url || !/^https:\/\//.test(url)) throw Error('ImgBB no devolvió la dirección de la foto.');
  const image: StoredImage = { url };
  const medium = asUrl(data?.medium);
  const thumb = asUrl(data?.thumb);
  if (medium && /^https:\/\//.test(medium)) image.medium = medium;
  if (thumb && /^https:\/\//.test(thumb)) image.thumb = thumb;
  return image;
}

/**
 * Reduce fotos grandes antes de subirlas (más rápido y ocupa menos). Respeta la orientación EXIF.
 * Si algo falla o no mejora el peso, devuelve el archivo original.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= KEEP_AS_IS_BYTES) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.86),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

type UploadOptions = { onProgress?: (fraction: number) => void; signal?: AbortSignal };

/** Sube una imagen a ImgBB con progreso real. Se puede cancelar con `signal`. */
export function uploadToImgbb(
  blob: Blob,
  name: string,
  { onProgress, signal }: UploadOptions = {},
): Promise<StoredImage> {
  return new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_IMGBB_API_KEY;
    if (!key) return reject(Error('Falta la clave de ImgBB (VITE_IMGBB_API_KEY).'));
    if (signal?.aborted) return reject(new DOMException('Subida cancelada', 'AbortError'));

    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('key', key);
    form.append('image', blob, name);

    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort);
    const done = () => signal?.removeEventListener('abort', onAbort);

    xhr.open('POST', ENDPOINT);
    xhr.timeout = 90_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      done();
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* respuesta que no es JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          return resolve(parseImgbbResponse(json));
        } catch (e) {
          return reject(e);
        }
      }
      const message = (json as { error?: { message?: string } } | null)?.error?.message;
      reject(Error(message ? `ImgBB: ${message}` : `ImgBB respondió con el error ${xhr.status}.`));
    };
    xhr.onerror = () => {
      done();
      reject(Error('No se pudo conectar con ImgBB. Revisa tu conexión.'));
    };
    xhr.ontimeout = () => {
      done();
      reject(Error('ImgBB tardó demasiado en responder.'));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException('Subida cancelada', 'AbortError'));
    };
    xhr.send(form);
  });
}
