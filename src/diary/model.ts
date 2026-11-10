import { plainText } from "../components/RichText";
import type { Entry } from "../data";
import { addDays, todayInputValue } from "../lib/format";

/** El día (AAAA-MM-DD, hora local) al que pertenece una entrada. */
export const dayOf = (e: Entry) => todayInputValue(new Date(e.created_at));

export const wordsOf = (e: Entry) => {
  const text = plainText(`${e.title} ${e.body}`).trim();
  return text ? text.split(/\s+/).length : 0;
};

/**
 * Los ocho ánimos guardados (ver `moods`) en cinco tonos, de lo más bajo a lo mejor. Los valores
 * guardados no van en orden: 6 «Tenso» queda por debajo de 3 «Normal», 8 «Divertido» arriba.
 */
const valenceOf: Record<number, number> = {
  1: 1,
  6: 2,
  2: 2,
  3: 3,
  7: 4,
  4: 4,
  8: 5,
  5: 5,
};
export const valence = (mood?: number) =>
  mood ? (valenceOf[mood] ?? null) : null;

export type DayStat = {
  date: string;
  entries: Entry[];
  words: number;
  /** Tono del día (1–5) según el ánimo de sus entradas, o null si no lo marcaste. */
  tone: number | null;
  /** El ánimo más reciente del día (para mostrar su carita). */
  mood: number | null;
};

/** Las entradas agrupadas por día. */
export function buildDays(entries: Entry[]) {
  const days = new Map<string, DayStat>();
  for (const e of entries) {
    const date = dayOf(e);
    let d = days.get(date);
    if (!d) {
      d = { date, entries: [], words: 0, tone: null, mood: null };
      days.set(date, d);
    }
    d.entries.push(e);
    d.words += wordsOf(e);
  }
  for (const d of days.values()) {
    d.entries.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const tones = d.entries
      .map((e) => valence(e.details.mood))
      .filter((t): t is number => t !== null);
    d.tone = tones.length
      ? Math.round(tones.reduce((a, b) => a + b, 0) / tones.length)
      : null;
    d.mood = d.entries.find((e) => e.details.mood)?.details.mood ?? null;
  }
  return days;
}

/**
 * Racha actual y mejor racha, en días seguidos. Si hoy aún no escribes, la racha de ayer sigue
 * viva (se pierde mañana).
 */
export function streaks(days: Map<string, DayStat>, today = todayInputValue()) {
  let current = 0;
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  let best = 0;
  let run = 0;
  let prev = "";
  for (const date of [...days.keys()].sort()) {
    run = prev && addDays(prev, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    prev = date;
  }
  return { current, best, alive: days.has(today) };
}

/** Intensidad de un día en el mapa (0 vacío … 4 mucho escrito). */
export function levelOf(d?: DayStat) {
  if (!d) return 0;
  const w = d.words;
  return w >= 450 ? 4 : w >= 200 ? 3 : w >= 60 ? 2 : 1;
}

const parse = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};
/** 0 lunes … 6 domingo. */
export const weekdayIndex = (date: string) => (parse(date).getDay() + 6) % 7;

export type Cell = { date: string; inRange: boolean };

/**
 * Semanas (de lunes a domingo) entre `from` y `to`, ambas incluidas. Los días fuera del rango
 * completan la primera y la última semana y se pintan vacíos.
 */
export function weeksBetween(from: string, to: string) {
  const weeks: Cell[][] = [];
  let cursor = addDays(from, -weekdayIndex(from));
  while (cursor <= to) {
    const week: Cell[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: cursor, inRange: cursor >= from && cursor <= to });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

const longFormat = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const monthFormat = new Intl.DateTimeFormat("es-CO", {
  month: "long",
  year: "numeric",
});
const shortMonth = new Intl.DateTimeFormat("es-CO", { month: "short" });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** «Lunes, 9 de noviembre». */
export const longDay = (date: string) => cap(longFormat.format(parse(date)));
/** «Noviembre de 2026». */
export const monthTitle = (month: string) =>
  cap(monthFormat.format(parse(month + "-01")));
/** «nov». */
export const monthShort = (date: string) =>
  shortMonth.format(parse(date)).replace(".", "");
export const weekdayShort = (date: string) =>
  parse(date)
    .toLocaleDateString("es-CO", { weekday: "short" })
    .replace(".", "");

/** Cuántos días van del año hasta `today`, incluido. */
export function dayOfYear(today: string) {
  const start = parse(today.slice(0, 4) + "-01-01");
  return (
    Math.round((parse(today).getTime() - start.getTime()) / 86_400_000) + 1
  );
}

/** «hace 1 año», «hace 3 años», «hace 1 mes». */
export function agoLabel(date: string, today: string) {
  const years = Number(today.slice(0, 4)) - Number(date.slice(0, 4));
  if (years > 0 && date.slice(5) === today.slice(5))
    return years === 1 ? "Hace un año" : `Hace ${years} años`;
  const months =
    (Number(today.slice(0, 4)) - Number(date.slice(0, 4))) * 12 +
    Number(today.slice(5, 7)) -
    Number(date.slice(5, 7));
  return months === 1 ? "Hace un mes" : `Hace ${months} meses`;
}

/**
 * Lo que escribiste un día como hoy: el mismo día en años anteriores o, si no hay, hace uno,
 * tres o seis meses.
 */
export function onThisDay(days: Map<string, DayStat>, today: string) {
  const years = [...days.values()]
    .filter((d) => d.date < today && d.date.slice(5) === today.slice(5))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (years.length) return years;
  const out: DayStat[] = [];
  for (const back of [1, 3, 6]) {
    const [y, m, d] = today.split("-").map(Number);
    const then = new Date(y, m - 1 - back, d);
    // 31 de marzo menos un mes no es «3 de marzo»: si el día no existe, no hay recuerdo.
    if (then.getDate() !== d) continue;
    const hit = days.get(todayInputValue(then));
    if (hit) out.push(hit);
  }
  return out;
}

/** El ánimo que más se repite en una lista de entradas. */
export function commonMood(entries: Entry[]) {
  const count = new Map<number, number>();
  for (const e of entries)
    if (e.details.mood)
      count.set(e.details.mood, (count.get(e.details.mood) ?? 0) + 1);
  let best: number | null = null;
  let n = 0;
  for (const [m, c] of count) if (c > n) [best, n] = [m, c];
  return best;
}
