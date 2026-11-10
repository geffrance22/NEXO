import type { ReactNode } from 'react';
import { normalizeText } from '../lib/format';

export type MarkKind = 'b' | 'h' | 's';

/** Cómo se guardan: `**negrita**`, `==resaltado==` y `~~tachado~~` (una línea cada uno). */
const STORED: Record<MarkKind, string> = { b: '**', h: '==', s: '~~' };
const MARKS = /\*\*([^\n]+?)\*\*|==([^\n]+?)==|~~([^\n]+?)~~/g;

/**
 * En el editor cada marca es un solo carácter invisible y sin ancho, así el texto se ve limpio
 * (sin asteriscos ni signos) y el textarea y su espejo siguen midiendo lo mismo.
 */
export const HIDDEN: Record<MarkKind, string> = { b: '\u2062', h: '\u2063', s: '\u2064' };
const HIDDEN_MARKS = /\u2062([^\n\u2062]+?)\u2062|\u2063([^\n\u2063]+?)\u2063|\u2064([^\n\u2064]+?)\u2064/g;
const ANY_HIDDEN = /[\u2062\u2063\u2064]/g;

const kindOf = (b?: string, h?: string): MarkKind =>
  b !== undefined ? 'b' : h !== undefined ? 'h' : 's';

/** Del texto guardado al del editor (marcas invisibles). */
export function toHidden(text: string): string {
  return text
    .replace(ANY_HIDDEN, '')
    .replace(MARKS, (_m, b, h, s) => {
      const k = kindOf(b, h);
      const mk = HIDDEN[k];
      return mk + toHidden(b ?? h ?? s) + mk;
    });
}

/** Del texto del editor al guardado. Las marcas que quedaron sueltas (sin pareja) se descartan. */
export function fromHidden(text: string): string {
  return text
    .replace(HIDDEN_MARKS, (_m, b, h, s) => {
      const mk = STORED[kindOf(b, h)];
      return mk + fromHidden(b ?? h ?? s) + mk;
    })
    .replace(ANY_HIDDEN, '');
}

/** Quita las marcas invisibles del editor. */
export const stripHidden = (text: string) => text.replace(ANY_HIDDEN, '');

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

function render(text: string, names: string[], editor: boolean, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const m of text.matchAll(editor ? HIDDEN_MARKS : MARKS)) {
    const start = m.index ?? 0;
    if (start > at) out.push(...withMentions(text.slice(at, start), names, key + 't' + n));
    const k = kindOf(m[1], m[2]);
    const inner = render(m[1] ?? m[2] ?? m[3], names, editor, key + 'i' + n);
    // En el editor la negrita se dibuja con un trazo: la letra en negrita es más ancha y el
    // espejo dejaría de coincidir con el cursor del textarea.
    const content =
      k === 'h' ? (
        <mark className="rt-hl">{inner}</mark>
      ) : k === 's' ? (
        <s className="rt-st">{inner}</s>
      ) : editor ? (
        <span className="rt-b">{inner}</span>
      ) : (
        <strong className="rt-strong">{inner}</strong>
      );
    out.push(
      <span key={key + 'k' + n}>
        {editor && HIDDEN[k]}
        {content}
        {editor && HIDDEN[k]}
      </span>,
    );
    at = start + m[0].length;
    n++;
  }
  if (at < text.length) out.push(...withMentions(text.slice(at), names, key + 'e'));
  return out;
}

/**
 * Convierte el texto con marcas en elementos. Con `editor` el texto viene con las marcas
 * invisibles del editor (ver `toHidden`) y se conservan para que el espejo mida lo mismo.
 */
export function renderRich(
  text: string,
  { names = [], editor = false }: { names?: string[]; editor?: boolean } = {},
) {
  return render(text, names, editor, '');
}

/** Texto de un recuerdo con sus negritas, resaltados y tachados. */
export function RichText({ text, names }: { text: string; names?: string[] }) {
  return <>{renderRich(text, { names })}</>;
}

/** El texto sin marcas (para títulos y búsquedas). */
export function plainText(text: string): string {
  let prev = '';
  let out = stripHidden(text);
  while (out !== prev) {
    prev = out;
    out = out.replace(MARKS, (_m, b, h, s) => b ?? h ?? s);
  }
  return out;
}
