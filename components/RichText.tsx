import type { ReactNode } from 'react';
import { normalizeText } from '../lib/format';

/** `==resaltado==` y `~~tachado~~` (una línea cada uno). */
const MARKS = /==([^\n]+?)==|~~([^\n]+?)~~/g;

/** Resalta en el texto los nombres de las personas vinculadas (sin tildes ni mayúsculas). */
function withMentions(text: string, names: string[], key: string): ReactNode[] {
  const clean = names.map((n) => normalizeText(n.trim())).filter((n) => n.length > 1);
  const hay = normalizeText(text);
  // Solo si normalizar no cambió la longitud: así los índices coinciden con el texto original.
  if (!clean.length || hay.length !== text.length) return [text];
  const hits: [number, number][] = [];
  for (const name of clean) {
    let i = hay.indexOf(name);
    while (i !== -1) {
      const before = hay[i - 1];
      const after = hay[i + name.length];
      const word = (ch?: string) => Boolean(ch && /[\p{L}\p{N}]/u.test(ch));
      if (!word(before) && !word(after) && !hits.some(([a, b]) => i < b && i + name.length > a)) {
        hits.push([i, i + name.length]);
      }
      i = hay.indexOf(name, i + name.length);
    }
  }
  if (!hits.length) return [text];
  hits.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let at = 0;
  hits.forEach(([a, b], n) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(
      <span className="rt-mention" key={key + 'm' + n}>
        {text.slice(a, b)}
      </span>,
    );
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/**
 * Convierte el texto con marcas en elementos. `showMarkers` deja ver (tenues) los `==` y `~~`:
 * lo usa el editor, que necesita que el texto mida exactamente lo mismo que lo escrito.
 */
export function renderRich(
  text: string,
  { names = [], showMarkers = false }: { names?: string[]; showMarkers?: boolean } = {},
) {
  const out: ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const m of text.matchAll(MARKS)) {
    const start = m.index ?? 0;
    if (start > at) out.push(...withMentions(text.slice(at, start), names, 't' + n));
    const marker = m[1] !== undefined ? '==' : '~~';
    const inner = m[1] ?? m[2];
    const content =
      marker === '==' ? <mark className="rt-hl">{inner}</mark> : <s className="rt-st">{inner}</s>;
    out.push(
      showMarkers ? (
        <span key={'k' + n}>
          <span className="rt-mk">{marker}</span>
          {content}
          <span className="rt-mk">{marker}</span>
        </span>
      ) : (
        <span key={'k' + n}>{content}</span>
      ),
    );
    at = start + m[0].length;
    n++;
  }
  if (at < text.length) out.push(...withMentions(text.slice(at), names, 'e'));
  return out;
}

/** Texto de un recuerdo con sus resaltados y tachados. */
export function RichText({ text, names }: { text: string; names?: string[] }) {
  return <>{renderRich(text, { names })}</>;
}

/** El texto sin marcas (para títulos y búsquedas). */
export const plainText = (text: string) => text.replace(MARKS, (_m, a, b) => a ?? b);
