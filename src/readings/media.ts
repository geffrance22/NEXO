import { readableSlice } from './formatting';
export function pictures(content: string) {
  return Array.from(content.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g));
}
export function preview(content: string) {
  return readableSlice(content)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
async function snapshot(url: string) {
  const res = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(3500),
  });
  if (
    !res.ok ||
    !/^image\/(jpeg|png|webp|gif|avif)/i.test(res.headers.get('content-type') || '') ||
    Number(res.headers.get('content-length')) > 6000000
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
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.72);
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
