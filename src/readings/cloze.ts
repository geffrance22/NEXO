/**
 * Tarjetas de huecos (cloze): el texto lleva lo que hay que recordar entre llaves dobles,
 * `{{respuesta}}` o `{{respuesta::pista}}`. Al repasar se ve el texto con los huecos y detrás,
 * el texto completo. Se guardan en la misma tabla que las de pregunta y respuesta: lo que las
 * distingue son las llaves del anverso.
 */
const CLOZE = /\{\{(.+?)(?:::(.+?))?\}\}/g;

export const isCloze = (front: string) => /\{\{.+?\}\}/.test(front);

/** Las respuestas de los huecos, en orden. */
export const clozeAnswers = (front: string) =>
  Array.from(front.matchAll(CLOZE), (m) => m[1].trim());

/** El texto con los huecos a la vista: «[…]» o «[pista]». */
export const clozeFront = (front: string) =>
  front.replace(CLOZE, (_, _a: string, hint?: string) =>
    hint ? `[${hint.trim()}]` : "[…]",
  );

/** El texto completo, con las respuestas en **negrita** (se pinta con AiText). */
export const clozeFull = (front: string) =>
  front.replace(CLOZE, (_, a: string) => `**${a.trim()}**`);

/** El texto completo, sin marcas. */
export const clozePlain = (front: string) =>
  front.replace(CLOZE, (_, a: string) => a.trim());

/**
 * El reverso que se guarda: la nota propia o, si no hay, las respuestas (la columna no puede ir
 * vacía). `clozeExtra` lo distingue al mostrarla.
 */
export const clozeBack = (front: string, note: string) =>
  note.trim() || clozeAnswers(front).join(" · ");

/** La nota propia de una tarjeta de huecos ("" si el reverso son solo las respuestas). */
export const clozeExtra = (front: string, back: string) =>
  back.trim() === clozeAnswers(front).join(" · ") ? "" : back.trim();

/**
 * Las caras de una flashcard para estudiarla: las de pregunta y respuesta tal cual; las de
 * huecos, con los huecos delante y el texto completo detrás (más tu nota, si la hay).
 */
export function flashFaces(card: { front: string; back: string }) {
  if (!isCloze(card.front))
    return { front: card.front, back: card.back, cloze: false };
  const extra = clozeExtra(card.front, card.back);
  return {
    front: clozeFront(card.front),
    back: clozeFull(card.front) + (extra ? "\n\n" + extra : ""),
    cloze: true,
  };
}

/**
 * Envuelve en llaves el tramo [start, end) de un texto (lo que seleccionaste en el editor).
 * Si ya estaba dentro de un hueco, lo deja igual.
 */
export function wrapCloze(text: string, start: number, end: number) {
  let a = Math.min(start, end);
  let b = Math.max(start, end);
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  if (a === b) return null;
  const before = text.slice(0, a);
  if (before.lastIndexOf("{{") > before.lastIndexOf("}}")) return null;
  const inner = text.slice(a, b);
  if (/\{\{|\}\}/.test(inner)) return null;
  return {
    text: before + "{{" + inner + "}}" + text.slice(b),
    caret: b + 4,
  };
}
