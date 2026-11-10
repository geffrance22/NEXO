import type { Entry, EntryDetails, EntryInput, Ritual, RitualAnswer } from '../data';
import { cleanDetails } from '../composer/logic';
import { addDays, todayInputValue } from '../lib/format';
import { schedule } from '../readings/review';
import { mediumOf, topicLabel } from './questions';

/**
 * Del ritual de cierre a un aprendizaje: la idea que te llevas es el corazón (título y primer
 * párrafo), lo que cambia en ti es «Lo aplicaré» y el resto queda en el texto con su etiqueta.
 * El aprendizaje enlaza a la obra (`sourceId`) y arranca su repaso espaciado mañana.
 */

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

/** Primera frase de un texto (o el texto recortado). */
function firstSentence(s: string, max = 110) {
  const t = s.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{12,}?[.!?…])(\s|$)/);
  return clip(m ? m[1] : t, max);
}

/** Qué tan bien lo dominas (1 a 5) según el test, si lo hiciste. */
export function quizConfidence(quiz?: Ritual['quiz']) {
  if (!quiz?.total) return undefined;
  return Math.max(1, Math.round((quiz.score / quiz.total) * 5));
}

/** Respuestas con texto (lo vacío no se guarda). */
export const answered = (answers: RitualAnswer[]) => answers.filter((a) => a.a.trim());

const titleOf = (entry: Entry) => entry.title || entry.kind;

/** Título, texto y detalles del aprendizaje (sirve para crearlo o para rehacerlo). */
export function learningParts(
  entry: Entry,
  ritual: Ritual,
  names: string[],
  opts: { review: boolean; previous?: EntryDetails['review'] },
) {
  const list = answered(ritual.answers);
  const key = list.find((a) => a.topic === 'llevar') ?? list[0];
  const change = list.find((a) => a.topic === 'cambio');
  const work = titleOf(entry);
  const title = key ? firstSentence(key.a) : `Lo que me llevo de «${work}»`;

  const lines: string[] = [];
  if (key) lines.push(key.a.trim());
  for (const a of list) {
    if (a === key || a === change) continue;
    const who = a.topic === 'recomendar' && names.length ? ` (${names.join(', ')})` : '';
    lines.push(`${topicLabel[a.topic]}${who}: ${a.a.trim()}`);
  }
  if (!list.some((a) => a.topic === 'recomendar') && names.length)
    lines.push(`${topicLabel.recomendar}: ${names.join(', ')}`);
  if (ritual.quiz) {
    lines.push(
      `Test de cierre: ${ritual.quiz.score} de ${ritual.quiz.total} respuestas correctas.`,
    );
    // Lo que fallaste es justo lo que conviene repasar.
    for (const x of ritual.quiz.items.filter((i) => i.chosen !== i.answer).slice(0, 3))
      lines.push(`Para repasar: ${x.q} → ${x.options[x.answer]}`);
  }

  const medium = mediumOf(entry);
  const details = cleanDetails('Aprendizaje', {
    source: medium === 'libro' ? 'Libro' : 'Video',
    sourceName: work + (entry.details.author ? ` · ${entry.details.author}` : ''),
    sourceId: entry.id,
    apply: change ? clip(change.a, 400) : undefined,
    confidence: quizConfidence(ritual.quiz),
    // Si ya se venía repasando, se conserva su ritmo; si no, el primer repaso es mañana.
    review: opts.review
      ? opts.previous && opts.previous.step >= 0
        ? opts.previous
        : { step: 0, due: firstReview() }
      : undefined,
  });
  return { title, body: lines.join('\n\n'), details };
}

/** El primer repaso: el primer intervalo del repaso espaciado (mañana). */
export const firstReview = () => addDays(todayInputValue(), schedule({ step: 0 }, 'otra').days ?? 1);

/** El aprendizaje nuevo, listo para `createEntry`. */
export function learningInput(
  entry: Entry,
  ritual: Ritual,
  names: string[],
  review: boolean,
): EntryInput {
  const parts = learningParts(entry, ritual, names, { review });
  return {
    ...parts,
    kind: 'Aprendizaje',
    tags: [],
    personIds: [],
    date: todayInputValue(),
    amount: 0,
    direction: 'egreso',
    status: 'pendiente',
    images: [],
    file: null,
    removeFile: false,
  };
}

/** El libro o la película terminados. */
export const isFinished = (e: Pick<Entry, 'kind' | 'details'>) =>
  (e.kind === 'Libro' && e.details.read === 'terminado') ||
  (e.kind === 'Película' && (e.details.watch ?? 'vista') === 'vista');
