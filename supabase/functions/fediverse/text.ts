/** Mastodon cuenta cada enlace como 23 caracteres, sea cual sea su largo. */
const URL_WEIGHT = 23;

/** Cuánto pesa un texto para el servidor (los enlaces cuentan 23). */
export const weight = (s: string) => s.replace(/https?:\/\/\S+/gi, 'x'.repeat(URL_WEIGHT)).length;

/** De mayor a menor: párrafos, frases, palabras. */
const LEVELS: [RegExp, string][] = [
  [/\n{2,}/, '\n\n'],
  [/(?<=[.!?…])\s+/, ' '],
  [/\s+/, ' '],
];

/** Parte un texto en trozos que caben en `limit`, cortando donde menos se note. */
export function pieces(text: string, limit: number, level = 0): string[] {
  const t = text.trim();
  if (!t) return [];
  if (weight(t) <= limit) return [t];
  if (level >= LEVELS.length) {
    // Una «palabra» sin espacios más larga que el límite: se corta a la fuerza.
    const out: string[] = [];
    let cur = '';
    // Letra a letra (sin partir un emoji por la mitad) hasta que no quepa más.
    for (const ch of Array.from(t)) {
      if (cur && weight(cur + ch) > limit) {
        out.push(cur);
        cur = '';
      }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  const [split, join] = LEVELS[level];
  const out: string[] = [];
  let cur = '';
  for (const part of t.split(split)) {
    for (const piece of pieces(part, limit, level + 1)) {
      const joined = cur ? cur + join + piece : piece;
      if (weight(joined) <= limit) cur = joined;
      else {
        if (cur) out.push(cur);
        cur = piece;
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Compara dos ids de Mastodon (números largos como texto): negativo si a < b. */
export const cmpId = (a: string, b: string) =>
  a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });

/**
 * El HTML de una publicación de Mastodon como texto plano: párrafos y saltos de línea se
 * conservan, los enlaces quedan con su dirección completa y menciones y etiquetas con su texto.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
      if (/\b(mention|hashtag)\b/i.test(attrs)) return inner;
      // Un enlace largo se muestra recortado en el HTML; el href trae la dirección entera.
      return /href="([^"]+)"/i.exec(attrs)?.[1] ?? inner;
    })
    .replace(/<[^>]+>/g, '');
  return decode(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
