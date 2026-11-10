import type { Entry, ReviewMemory } from '../data';
import { todayInputValue } from '../lib/format';
import { schedule, type Grade } from '../readings/review';
import { dueDate, type Memory } from './fsrs';

/**
 * Aprendizajes dentro del repaso espaciado. Solo los que lo tienen activado (`details.review`,
 * p. ej. los que nacen del ritual de cierre de un libro o una película). El estado viaja con el
 * propio aprendizaje: no hace falta ninguna migración.
 */

export type DueLearning = { entry: Entry; step: number; memory: Memory; source?: Entry };

/** Los aprendizajes que toca repasar hoy, los más atrasados primero. */
export function dueLearnings(entries: Entry[], today = todayInputValue()): DueLearning[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return entries
    .filter((e) => {
      const r = e.kind === 'Aprendizaje' ? e.details.review : undefined;
      return Boolean(r && r.step >= 0 && r.due && r.due <= today && e.body.trim());
    })
    .sort((a, b) => a.details.review!.due!.localeCompare(b.details.review!.due!))
    .map((entry) => ({
      entry,
      step: entry.details.review!.step,
      memory: { ...entry.details.review! },
      source: entry.details.sourceId ? byId.get(entry.details.sourceId) : undefined,
    }));
}

type Patch = (entry: Entry, changes: { details: Entry['details'] }) => Promise<boolean>;

/** La memoria nueva tras un repaso, lista para guardarse dentro de una entrada. */
export function nextMemory(memory: Memory, grade: Grade): ReviewMemory {
  const today = todayInputValue();
  const next = schedule(memory, grade, today);
  return { step: next.step, due: dueDate(next, today), s: next.s, d: next.d, last: today };
}

/** Guarda cómo te fue con un aprendizaje y cuándo toca de nuevo. */
export async function rateLearning(memory: Memory, grade: Grade, entry: Entry, patch: Patch) {
  const review = nextMemory(memory, grade);
  const saved = await patch(entry, { details: { ...entry.details, review } });
  if (!saved) throw new Error('No se pudo guardar el repaso.');
}
