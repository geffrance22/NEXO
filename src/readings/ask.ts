import { supabase } from '../backend';

export type ReadingAnswer = { answer: string; quote: string };

const OUTDATED =
  'Actualiza la función assistant para preguntar sobre lo que lees: npx supabase functions deploy assistant --remote=imdvmlzdbmbvwkfoisgs --use-api --yes';

/**
 * Pregunta a la IA sobre un fragmento (o, sin fragmento, sobre todo el artículo). Sin fragmento,
 * la respuesta trae además la cita del artículo que la respalda.
 */
export async function askReading(
  articleId: string,
  selection: string,
  prompt: string,
): Promise<ReadingAnswer> {
  const { data, error } = await supabase.functions.invoke('assistant', {
    body: {
      mode: 'reading-ask',
      articleId,
      selection: selection.slice(0, 4000),
      prompt: prompt.slice(0, 1500),
    },
  });
  if (error) {
    const res = (error as { context?: Response }).context;
    const detail = (await res?.json?.().catch(() => null)) as { error?: string } | null;
    // Una versión anterior de la función no conoce este modo y pide «una pregunta».
    if (res?.status === 400 && detail?.error !== 'Consulta inválida.') throw Error(OUTDATED);
    throw Error(detail?.error || 'No se pudo consultar la IA.');
  }
  if (typeof data?.answer !== 'string' || !data.answer.trim()) throw Error(OUTDATED);
  return { answer: data.answer.trim(), quote: typeof data.quote === 'string' ? data.quote : '' };
}

/** Marca con la que empiezan las notas que vienen de la IA (así se distinguen al mostrarlas). */
export const AI_MARK = '✦ ';

/** Nota de un resaltado con lo que preguntaste y lo que respondió la IA. */
export const aiNote = (prompt: string, answer: string) =>
  `${AI_MARK}${prompt.trim() || 'Explica este fragmento'}\n${answer.trim()}`;

/** Ubica en el texto la cita que devolvió la IA (exacta o, si cambió el final, por su inicio). */
export function locateQuote(content: string, quote: string) {
  const q = quote
    .trim()
    .replace(/^["“«']+|["”»']+$/g, '')
    .trim();
  if (q.length < 12) return null;
  let i = content.indexOf(q);
  if (i >= 0) return { start: i, end: i + q.length };
  const head = q.slice(0, 60);
  i = content.indexOf(head);
  if (i >= 0) return { start: i, end: Math.min(content.length, i + q.length) };
  return null;
}
