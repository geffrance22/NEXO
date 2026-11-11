import { addDays, normalizeText, todayInputValue } from '../lib/format';

/** Cada cuánto vuelve una tarjeta al completarla. El día sale de su fecha límite. */
export type Repeat = '' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export const REPEATS: Repeat[] = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly'];
export const isRepeat = (v: unknown): v is Repeat => REPEATS.includes(v as Repeat) || v === '';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
export const weekdayOf = (d: string) => {
  const [y, m, day] = parts(d);
  return new Date(y, m - 1, day).getDay();
};
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

/** «Cada lunes», «Cada mes, el 15», «Días hábiles»… */
export function repeatLabel(rule: Repeat, due: string | null) {
  const base = due ?? todayInputValue();
  const [, m, d] = parts(base);
  switch (rule) {
    case 'daily':
      return 'Cada día';
    case 'weekdays':
      return 'Días hábiles';
    case 'weekly':
      return `Cada ${WEEKDAYS[weekdayOf(base)]}`;
    case 'biweekly':
      return `Cada 2 semanas, el ${WEEKDAYS[weekdayOf(base)]}`;
    case 'monthly':
      return `Cada mes, el ${d}`;
    case 'yearly':
      return `Cada año, el ${d} de ${MONTHS[m - 1]}`;
    default:
      return 'No se repite';
  }
}
export const repeatHint: Record<Repeat, string> = {
  '': '',
  daily: 'Vuelve al día siguiente',
  weekdays: 'De lunes a viernes',
  weekly: 'El mismo día cada semana',
  biweekly: 'Una semana sí, una no',
  monthly: 'El mismo día de cada mes',
  yearly: 'La misma fecha cada año',
};

/** Una vez la regla, desde una fecha. */
export function step(rule: Repeat, d: string): string {
  switch (rule) {
    case 'daily':
      return addDays(d, 1);
    case 'weekdays': {
      let n = addDays(d, 1);
      while (weekdayOf(n) === 0 || weekdayOf(n) === 6) n = addDays(n, 1);
      return n;
    }
    case 'weekly':
      return addDays(d, 7);
    case 'biweekly':
      return addDays(d, 14);
    case 'monthly': {
      const [y, m, day] = parts(d);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      return `${ny}-${pad(nm)}-${pad(Math.min(day, lastDay(ny, nm)))}`;
    }
    case 'yearly': {
      const [y, m, day] = parts(d);
      return `${y + 1}-${pad(m)}-${pad(Math.min(day, lastDay(y + 1, m)))}`;
    }
    default:
      return d;
  }
}

/**
 * Próxima fecha al completar: un paso desde la fecha límite y, si aún queda en el pasado (la
 * completaste tarde), los que hagan falta hasta llegar después de hoy.
 */
export function nextDue(rule: Repeat, due: string | null, today = todayInputValue()) {
  if (!rule) return due;
  let d = step(rule, due ?? today);
  for (let i = 0; d <= today && i < 800; i++) d = step(rule, d);
  return d;
}

/** Siguiente fecha con ese día de la semana (hoy cuenta). */
export function nextWeekday(day: number, today = todayInputValue()) {
  return addDays(today, (day - weekdayOf(today) + 7) % 7);
}

const DAY_RE = '(lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)';
const DAY_INDEX: Record<string, number> = {
  domingo: 0,
  domingos: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sabados: 6,
};
/** AAAA-MM-DD de verdad (sin NaN ni días que no existen). */
const isDate = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return Boolean(m && +m[3] >= 1 && +m[3] <= lastDay(+m[1], +m[2]));
};

/**
 * «Reunión de equipo cada lunes», «Regar las plantas todos los días»: la regla, la próxima
 * fecha y el título sin esa frase. null si el texto no dice que se repite.
 */
export function parseRepeat(title: string, today = todayInputValue()) {
  const n = normalizeText(title);
  const rules: [RegExp, (m: RegExpMatchArray) => { rule: Repeat; due: string }][] = [
    [
      new RegExp(`\\b(?:cada|todos los|todas las) (?:2|dos) semanas?(?: (?:el|los) ${DAY_RE})?`),
      (m) => ({
        rule: 'biweekly',
        due: m[1] ? nextWeekday(DAY_INDEX[m[1]], today) : today,
      }),
    ],
    [/\b(?:cada|todos los) (?:15|quince) dias\b/, () => ({ rule: 'biweekly', due: today })],
    [
      new RegExp(`\\b(?:cada|todos los|los) ${DAY_RE}\\b`),
      (m) => ({ rule: 'weekly', due: nextWeekday(DAY_INDEX[m[1]], today) }),
    ],
    [
      /\b(?:de lunes a viernes|entre semana|dias habiles|cada dia habil)\b/,
      () => {
        let d = today;
        while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDays(d, 1);
        return { rule: 'weekdays', due: d };
      },
    ],
    [/\b(?:cada dia|todos los dias|diariamente|a diario)\b/, () => ({ rule: 'daily', due: today })],
    [/\b(?:cada semana|semanalmente|todas las semanas)\b/, () => ({ rule: 'weekly', due: today })],
    [/\b(?:cada mes|mensualmente|todos los meses)\b/, () => ({ rule: 'monthly', due: today })],
    [/\b(?:cada ano|anualmente|todos los anos)\b/, () => ({ rule: 'yearly', due: today })],
  ];
  for (const [re, make] of rules) {
    const m = n.match(re);
    if (!m || m.index === undefined) continue;
    const { rule, due } = make(m);
    // Si no sale una fecha válida, no es una repetición: el texto se queda como está.
    if (!isDate(due)) continue;
    // normalizeText conserva las posiciones: se quita la frase del título original.
    const clean =
      n.length === title.length
        ? (title.slice(0, m.index) + title.slice(m.index + m[0].length))
            .replace(/\s{2,}/g, ' ')
            .replace(/[\s,;·-]+$/, '')
            .trim()
        : title.trim();
    return { title: clean || title.trim(), rule, due };
  }
  return null;
}
