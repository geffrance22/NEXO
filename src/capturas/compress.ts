/**
 * Compresión opcional a WebP antes de subir (solo PNG y JPG). Se hace en el navegador con un
 * lienzo; si el WebP no sale más liviano que el original, se sube el original.
 */
const QUALITY = 0.85;
/** WebP no admite lados de más de 16 383 px; y un lienzo enorme puede agotar la memoria. */
const MAX_SIDE = 16_383;
const MAX_PIXELS = 120_000_000;
const PREF_KEY = "nexo-cap-webp";

export const canCompress = (f: File) =>
  /^image\/(png|jpeg)$/.test(f.type) ||
  (!f.type && /\.(png|jpe?g)$/i.test(f.name));

export function webpPref() {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}
export function saveWebpPref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* sin almacenamiento */
  }
}

/** El archivo en WebP, o `null` si no conviene (o el navegador no sabe codificar WebP). */
export async function toWebp(file: File): Promise<File | null> {
  if (!canCompress(file)) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const { width, height } = bitmap;
    if (
      !width ||
      !height ||
      width > MAX_SIDE ||
      height > MAX_SIDE ||
      width * height > MAX_PIXELS
    )
      return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", QUALITY),
    );
    canvas.width = canvas.height = 0;
    // Safari antiguo devuelve PNG cuando no sabe hacer WebP.
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size)
      return null;
    const base = (file.name || "captura").replace(/\.[a-z0-9]{2,5}$/i, "");
    return new File([blob], base + ".webp", {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
