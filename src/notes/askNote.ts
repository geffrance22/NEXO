import type { AskQuick } from '../composer/AskSelection';
import { stripMarks } from './marks';

/*
 * Preguntar a la IA sobre lo seleccionado en una nota y dejar la respuesta en ella. Todo aquí
 * solo AÑADE líneas al texto de la nota: nunca quita ni cambia las que ya tiene.
 */

/** Atajos del panel (el de `prompt` vacío es la pregunta por defecto: explicar). */
export const NOTE_QUICK: AskQuick[] = [
  { label: 'Explícame', prompt: '' },
  { label: 'Resume', prompt: 'Resume esto en una o dos frases.' },
  { label: 'Un ejemplo', prompt: 'Dame un ejemplo concreto de esto.' },
  { label: 'Amplía', prompt: 'Amplía esto con lo más importante que falte, en pocas líneas.' },
];

/** Dónde termina la selección: la línea del texto de la nota y el texto que tenía al abrir. */
export type NoteAnchor = { line: number; text: string };

const LEAD = /^\s*(?:#{1,6}|[-*•]|\d{1,4}[.)])\s+/;
const norm = (s: string) =>
  stripMarks(s).replace(LEAD, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Línea de la nota donde aparece la última línea de lo seleccionado, o -1. */
export function findLine(lines: string[], quote: string): number {
  const last = quote
    .split('\n')
    .map(norm)
    .filter(Boolean)
    .pop();
  if (!last) return -1;
  return lines.findIndex((l) => norm(l).includes(last));
}

/**
 * La línea donde termina la selección. `found` es lo que midió el editor (`line` de `lines`
 * líneas); si el texto no cuadra con eso, se busca por lo seleccionado.
 */
export function anchorOf(
  body: string,
  quote: string,
  found: { line: number; lines: number } | null,
): NoteAnchor | null {
  const lines = body.split('\n');
  const line =
    found && found.lines === lines.length && lines[found.line]?.trim()
      ? found.line
      : findLine(lines, quote);
  return line >= 0 ? { line, text: lines[line] } : null;
}

/** La respuesta de la IA con el formato de las notas (ver marks.ts). */
export function toNoteMd(answer: string): string {
  return answer
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```.*$/gm, '')
    .replace(/__(?=\S)([^\n]*?\S)__/g, '**$1**')
    .replace(/(?<![*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, '_$1_')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** `text` al final de la nota, separado por una línea en blanco. */
export function appendToNote(body: string, text: string): string {
  const block = toNoteMd(text);
  if (!block) return body;
  if (!body.trim()) return body + block;
  const sep = body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  return body + sep + block;
}

/**
 * `text` como párrafo propio justo después de la línea donde termina la selección. Si esa línea ya
 * no está (cambiaste la nota mientras tanto), se busca por lo seleccionado; si tampoco, va al
 * final. `where` dice dónde quedó.
 */
export function insertBelow(
  body: string,
  text: string,
  anchor: NoteAnchor | null,
  quote: string,
): { body: string; where: 'below' | 'end' } {
  const block = toNoteMd(text);
  if (!block) return { body, where: 'below' };
  const lines = body.split('\n');
  let at = -1;
  if (anchor) {
    if (lines[anchor.line] === anchor.text) at = anchor.line;
    else {
      // La misma línea más cerca de donde estaba (si se movió por algo escrito arriba).
      let best = Infinity;
      lines.forEach((l, i) => {
        const d = Math.abs(i - anchor.line);
        if (l === anchor.text && d < best) {
          best = d;
          at = i;
        }
      });
    }
  }
  if (at < 0) at = findLine(lines, quote);
  if (at < 0) return { body: appendToNote(body, text), where: 'end' };
  const before = lines.slice(0, at + 1);
  const after = lines.slice(at + 1);
  const out = [...before];
  if (out[out.length - 1].trim()) out.push('');
  out.push(...block.split('\n'));
  if (after.length && after[0].trim()) out.push('');
  out.push(...after);
  return { body: out.join('\n'), where: 'below' };
}
