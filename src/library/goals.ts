import { useCallback, useState } from 'react';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { todayInputValue } from '../lib/format';

const GOALS_KEY = 'nexo-reading-goals';

const day = (iso: string) => todayInputValue(new Date(iso));

/**
 * Cuándo terminaste un libro (AAAA-MM-DD): el día que lo marcaste como terminado, el de su cierre
 * o, en los antiguos, la última página anotada o la fecha del recuerdo (la que sea más tarde).
 */
export function finishedOn(e: Entry): string {
  const d = e.details;
  if (d.finishedAt) return d.finishedAt;
  if (d.ritual?.at) return d.ritual.at;
  const created = day(e.created_at);
  const logged = d.pageLog?.at(-1)?.d;
  return logged && logged > created ? logged : created;
}

/** Libros terminados en ese año, del más reciente al más antiguo. */
export function booksFinishedIn(entries: Entry[], year: string): Entry[] {
  return entries
    .filter(
      (e) => e.kind === 'Libro' && e.details.read === 'terminado' && finishedOn(e).startsWith(year),
    )
    .sort((a, b) => finishedOn(b).localeCompare(finishedOn(a)));
}

function localGoals(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(GOALS_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

const validGoal = (n: unknown) => (typeof n === 'number' && n > 0 ? Math.round(n) : 0);

/**
 * Meta de lectura de cada año. Se guarda en tu ficha (así la ves en todos tus dispositivos) y en
 * este navegador por si la ficha aún no se puede guardar.
 */
export function useReadingGoals() {
  const { me, meMissing, patchMe } = useApp();
  const [local, setLocal] = useState(localGoals);
  const goals = { ...local, ...me.profile.readingGoals };

  const goalOf = (year: string) => validGoal(goals[year]);

  const setGoal = useCallback(
    async (year: string, n: number) => {
      const next = { ...localGoals(), ...me.profile.readingGoals };
      if (n > 0) next[year] = Math.min(999, Math.round(n));
      else delete next[year];
      setLocal(next);
      try {
        localStorage.setItem(GOALS_KEY, JSON.stringify(next));
      } catch {
        /* Sin almacenamiento: queda en tu ficha. */
      }
      if (meMissing) return true;
      return patchMe({ readingGoals: next });
    },
    [me.profile, meMissing, patchMe],
  );

  return { goalOf, setGoal };
}

/** Día del año (1–366) y cuántos días tiene. */
export function yearProgress(today: string) {
  const [y, m, d] = today.split('-').map(Number);
  const start = Date.UTC(y, 0, 1);
  const now = Date.UTC(y, m - 1, d);
  const days = (Date.UTC(y + 1, 0, 1) - start) / 864e5;
  return { day: Math.round((now - start) / 864e5) + 1, days };
}
