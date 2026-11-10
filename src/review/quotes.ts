import type { Entry } from '../data';
import { todayInputValue } from '../lib/format';
import { sample } from '../lib/random';
import type { Grade } from '../readings/review';
import type { Memory } from './fsrs';
import { nextMemory } from './learnings';

/**
 * Citas de tus libros dentro del repaso espaciado. Cada libro guarda, junto a sus citas, cuándo toca
 * volver a ver cada una (`details.quoteReview`), así viaja con el libro a todos tus dispositivos
 * y no hace falta ninguna migración.
 */

/** Clave estable de una cita dentro de su libro: no depende de su posición en la lista. */
export function quoteKey(text: string) {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  // FNV-1a de 32 bits: corto y suficiente para distinguir las frases de un mismo libro.
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Una cita de un libro que toca repasar. */
export type DueQuote = {
  /** Libro y cita: único entre todos tus libros. */
  id: string;
  book: Entry;
  text: string;
  key: string;
  step: number;
  memory: Memory;
};

/** Citas que nunca has repasado y que se presentan por día: así no te cae un libro entero. */
export const NEW_QUOTES_PER_DAY = 2;
const NEW_KEY = 'nexo-review-new';

/** Lo de hoy: cuáles se eligieron y cuántas nuevas ya repasaste. */
type NewToday = { day: string; picks: string[]; graded: number };

function readNew(today: string): NewToday {
  try {
    const raw = JSON.parse(localStorage.getItem(NEW_KEY) ?? 'null') as Partial<NewToday> | null;
    if (raw?.day === today && Array.isArray(raw.picks) && typeof raw.graded === 'number') {
      return {
        day: today,
        picks: raw.picks.filter((p): p is string => typeof p === 'string'),
        graded: raw.graded,
      };
    }
  } catch {
    // Se empieza de cero.
  }
  return { day: today, picks: [], graded: 0 };
}

function writeNew(value: NewToday) {
  try {
    localStorage.setItem(NEW_KEY, JSON.stringify(value));
  } catch {
    // Sin almacenamiento, el ritmo se calcula de nuevo en cada visita.
  }
}

/**
 * Las citas nuevas de hoy. Se eligen entre TODAS las que nunca has repasado, cada una con la misma
 * probabilidad (sin favorecer las recientes), y se quedan fijas durante el día aunque abras el
 * repaso varias veces.
 */
function pickNew(unseen: DueQuote[], today: string): DueQuote[] {
  // Mientras tus libros no han cargado no se toca lo guardado.
  if (!unseen.length) return [];
  const state = readNew(today);
  const slots = Math.max(0, NEW_QUOTES_PER_DAY - state.graded);
  const byId = new Map(unseen.map((q) => [q.id, q]));
  const kept = state.picks.filter((id) => byId.has(id)).slice(0, slots);
  const extra =
    kept.length < slots
      ? sample(
          unseen.filter((q) => !kept.includes(q.id)),
          slots - kept.length,
        ).map((q) => q.id)
      : [];
  const picks = [...kept, ...extra];
  if (picks.join() !== state.picks.join()) writeNew({ ...state, picks });
  return picks.flatMap((id) => {
    const q = byId.get(id);
    return q ? [q] : [];
  });
}

/**
 * Lo que toca hoy de tus libros: las citas cuyo repaso venció (las más atrasadas primero) y unas
 * pocas nuevas.
 */
export function dueQuotes(entries: Entry[], today = todayInputValue()) {
  const seen = new Set<string>();
  const dated: { quote: DueQuote; due: string }[] = [];
  const unseen: DueQuote[] = [];
  for (const book of entries) {
    if (book.kind !== 'Libro') continue;
    const records = book.details.quoteReview ?? {};
    for (const raw of book.details.quotes ?? []) {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) continue;
      const key = quoteKey(text);
      const id = book.id + ':' + key;
      // La misma frase repetida en un libro cuenta una vez.
      if (seen.has(id)) continue;
      seen.add(id);
      const record = records[key];
      if (!record) unseen.push({ id, book, text, key, step: 0, memory: { step: 0 } });
      else if (record.step >= 0 && record.due && record.due <= today)
        dated.push({
          quote: { id, book, text, key, step: record.step, memory: { ...record } },
          due: record.due,
        });
    }
  }
  dated.sort((a, b) => a.due.localeCompare(b.due));
  return { due: dated.map((d) => d.quote), fresh: pickNew(unseen, today) };
}

type Patch = (entry: Entry, changes: { details: Entry['details'] }) => Promise<boolean>;

/** Guarda cómo te fue con una cita y cuándo toca de nuevo (en el propio libro). */
export async function rateQuote(
  quote: { key: string; memory: Memory },
  grade: Grade,
  book: Entry,
  patch: Patch,
) {
  const today = todayInputValue();
  const records = { ...book.details.quoteReview };
  const wasNew = !records[quote.key];
  records[quote.key] = nextMemory(quote.memory, grade);
  // Sin huérfanas: solo se conserva lo de las citas que siguen en el libro.
  const alive = new Set((book.details.quotes ?? []).map((q) => quoteKey(String(q))));
  for (const key of Object.keys(records)) if (!alive.has(key)) delete records[key];
  const saved = await patch(book, { details: { ...book.details, quoteReview: records } });
  if (!saved) throw new Error('No se pudo guardar el repaso.');
  if (wasNew) {
    const state = readNew(today);
    writeNew({ ...state, graded: state.graded + 1 });
  }
}
