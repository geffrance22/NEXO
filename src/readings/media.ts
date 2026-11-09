import { readableSlice } from "./formatting";
export function pictures(content: string) {
  return Array.from(content.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g));
}
export function preview(content: string) {
  return readableSlice(content)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
/** Palabras por minuto de una lectura atenta. */
export const WORDS_PER_MINUTE = 230;
/** Palabras del texto que se lee (sin formato, imágenes ni destinos de enlaces). */
export const wordCount = (content: string) =>
  (preview(content).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [])
    .length;
/**
 * Minutos de lectura por palabras (230 por minuto) y unos segundos por imagen, como los calcula
 * la base de datos (migración 202611090003).
 */
export function minutesOf(content: string) {
  const images = Math.min(12, pictures(content).length);
  return Math.max(
    1,
    Math.ceil(wordCount(content) / WORDS_PER_MINUTE + (images * 10) / 60),
  );
}
async function snapshot(url: string) {
  const res = await fetch(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(3500),
  });
  if (
    !res.ok ||
    !/^image\/(jpeg|png|webp|gif|avif)/i.test(
      res.headers.get("content-type") || "",
    ) ||
    Number(res.headers.get("content-length")) > 6000000
  )
    return;
  const reader = res.body?.getReader();
  if (!reader) return;
  const parts: ArrayBuffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 6000000) {
      await reader.cancel();
      return;
    }
    parts.push(new Uint8Array(value).buffer);
  }
  const img = await createImageBitmap(new Blob(parts));
  try {
    const scale = Math.min(1, 850 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/webp", 0.72);
    return result.length < 220000 ? result : undefined;
  } finally {
    img.close();
  }
}
export async function savePictures(content: string) {
  const urls = [...new Set(pictures(content).map((m) => m[2]))].slice(0, 5);
  const media: Record<string, string> = {};
  await Promise.all(
    urls.map(async (url) => {
      try {
        const data = await snapshot(url);
        if (data) media[url] = data;
      } catch {
        /* Keep the original URL when the publisher prevents copying. */
      }
    }),
  );
  return media;
}
