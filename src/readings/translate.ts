import { supabase } from '../backend';

type Snap = { title: string; content: string };

/** Palabras muy frecuentes de cada idioma, para adivinar en cuál está un texto. */
const EN = new Set(
  'the and of to is in that it for was on are with as be this have from by not but at or which you they his her their has were been would will can there what about more when who an its'.split(
    ' ',
  ),
);
const ES = new Set(
  'el la los las de del que y en es por para con una un se no su sus lo como pero más al ha son era fue este esta también muy sobre entre cuando ya hay donde porque'.split(
    ' ',
  ),
);

/** Tope que acepta la función: más largo se guarda sin traducir. */
const MAX = 60000;

/** ¿El artículo está en inglés? Mira una muestra del texto (sin imágenes). */
export function isEnglish({ title, content }: Snap) {
  const sample = (title + '\n' + content.replace(/!\[[^\]]*\]\([^)]+\)/g, ''))
    .slice(0, 6000)
    .toLowerCase();
  const words = sample.match(/[a-záéíóúñü']+/g) ?? [];
  let en = 0,
    es = 0;
  for (const w of words) {
    if (EN.has(w)) en++;
    if (ES.has(w)) es++;
  }
  return words.length >= 30 && en >= 10 && en > es * 2;
}

/**
 * Si el artículo está en inglés, lo devuelve traducido al español con la IA. Si no está en inglés,
 * es demasiado largo o la traducción falla (sin cuota, sin red…), lo devuelve tal cual.
 */
export async function toSpanish(snap: Snap): Promise<Snap & { translated: boolean }> {
  if (snap.content.length > MAX || !isEnglish(snap)) return { ...snap, translated: false };
  try {
    const { data, error } = await supabase.functions.invoke('assistant', {
      body: { mode: 'reading-translate', title: snap.title.slice(0, 500), content: snap.content },
    });
    if (error || typeof data?.content !== 'string' || !data.content.trim()) throw error;
    return {
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : snap.title,
      content: data.content,
      translated: true,
    };
  } catch {
    return { ...snap, translated: false };
  }
}
