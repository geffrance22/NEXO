import { addDays, todayInputValue } from "../lib/format";

/**
 * FSRS-5 (Free Spaced Repetition Scheduler), el algoritmo de repaso que usa Anki desde 2023.
 * Cada tarjeta guarda dos números de su memoria:
 *
 * - estabilidad (S): días hasta que la probabilidad de recordarla baja al 90 %.
 * - dificultad (D): de 1 a 10, cuánto le cuesta a tu memoria; sube al fallar y baja al acertar.
 *
 * Con ellos y los días que pasaron desde el último repaso se calcula la probabilidad de recordarla
 * hoy (R) y, según cómo te fue, la estabilidad nueva. La tarjeta vuelve justo cuando R cae a la
 * retención deseada. Parámetros por defecto de FSRS-5 (entrenados con millones de repasos).
 */
const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
];
const DECAY = -0.5;
const FACTOR = 19 / 81;
/** Probabilidad de recordar con la que vuelve cada tarjeta. */
export const RETENTION = 0.9;
/** Ninguna tarjeta tarda más de cinco años en volver. */
const MAX_DAYS = 1825;

export type Grade = "otra" | "dificil" | "bien" | "facil" | "nunca";
type Rating = 1 | 2 | 3 | 4;
const RATING: Record<Exclude<Grade, "nunca">, Rating> = {
  otra: 1,
  dificil: 2,
  bien: 3,
  facil: 4,
};

/**
 * Lo que se sabe de la memoria de una tarjeta. `step`: cuántas veces seguidas la recordaste
 * (-1 = no repasar más). `s` y `d` faltan en las tarjetas de antes de FSRS: se estiman.
 * `last`: el día (AAAA-MM-DD o fecha ISO) del último repaso.
 */
export type Memory = {
  step: number;
  s?: number | null;
  d?: number | null;
  last?: string | null;
  due?: string | null;
};

/** El resultado de un repaso: lo que se guarda y en cuántos días vuelve (null: nunca). */
export type Next = {
  step: number;
  days: number | null;
  s: number | null;
  d: number | null;
};

/** Intervalos del sistema anterior (1, 3, 7… días): sirven para estimar la estabilidad. */
const LEGACY = [1, 3, 7, 16, 35, 90, 180];

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));
const initS = (g: Rating) => Math.max(0.1, W[g - 1]);
const initD = (g: Rating) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);

/** Probabilidad de recordar tras `t` días con estabilidad `s`. */
export const retrievability = (t: number, s: number) =>
  Math.pow(1 + (FACTOR * Math.max(0, t)) / s, DECAY);

/** Días hasta que la probabilidad baja a la retención deseada. */
function interval(s: number) {
  const days = (s / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(days), 1, MAX_DAYS);
}

function nextD(d: number, g: Rating) {
  const delta = -W[6] * (g - 3);
  // Amortiguado: cuanto más cerca de 10, menos sube.
  const damped = d + (delta * (10 - d)) / 9;
  // Vuelve un poco hacia la dificultad de una tarjeta «bien» para no quedarse atascada.
  return clamp(W[7] * initD(4) + (1 - W[7]) * damped, 1, 10);
}

function recallS(d: number, s: number, r: number, g: Rating) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return (
    s *
    (1 +
      Math.exp(W[8]) *
        (11 - d) *
        Math.pow(s, -W[9]) *
        (Math.exp((1 - r) * W[10]) - 1) *
        hard *
        easy)
  );
}

function forgetS(d: number, s: number, r: number) {
  const next =
    W[11] *
    Math.pow(d, -W[12]) *
    (Math.pow(s + 1, W[13]) - 1) *
    Math.exp((1 - r) * W[14]);
  return Math.min(s, next);
}

/** Repasada otra vez el mismo día: cambio corto de estabilidad. */
const sameDayS = (s: number, g: Rating) =>
  s * Math.exp(W[17] * (g - 3 + W[18]));

/** Días enteros entre dos fechas (AAAA-MM-DD o ISO), en el calendario local. */
export function daysBetween(from: string, to: string) {
  const day = (v: string) =>
    v.length > 10 ? todayInputValue(new Date(v)) : v.slice(0, 10);
  const [a, b] = [day(from), day(to)].map((v) => {
    const [y, m, d] = v.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000);
}

/**
 * La memoria que se usa para calcular: la guardada o, en tarjetas de antes de FSRS, una
 * estimación a partir del paso en que iban (su último intervalo hace de estabilidad).
 */
function state(mem: Memory, today: string) {
  const s = Number(mem.s);
  const d = Number(mem.d);
  if (s > 0 && d >= 1) {
    const last = mem.last ?? (mem.due ? addDays(mem.due, -interval(s)) : null);
    return { s, d, elapsed: last ? Math.max(0, daysBetween(last, today)) : 0 };
  }
  if (mem.step <= 0) return null;
  const legacy = LEGACY[Math.min(mem.step, LEGACY.length) - 1];
  const last = mem.last ?? (mem.due ? addDays(mem.due, -legacy) : null);
  return {
    s: legacy,
    d: initD(3),
    elapsed: last ? Math.max(0, daysBetween(last, today)) : legacy,
  };
}

/** Un repaso con FSRS, sin ajustar el orden entre botones. */
function raw(mem: Memory, g: Rating, today: string) {
  const step = g === 1 ? 0 : Math.max(0, mem.step) + 1;
  const now = state(mem, today);
  if (!now) {
    const s = initS(g);
    return { step, s, d: initD(g), days: interval(s) };
  }
  const r = retrievability(now.elapsed, now.s);
  const d = nextD(now.d, g);
  const s =
    now.elapsed === 0
      ? sameDayS(now.s, g)
      : g === 1
        ? forgetS(now.d, now.s, r)
        : recallS(now.d, now.s, r, g);
  return { step, s: clamp(s, 0.1, 36500), d, days: interval(s) };
}

/**
 * Siguiente repaso según cómo te fue. Los intervalos nunca se cruzan: «Difícil» ≤ «Bien» <
 * «Fácil», y «Otra vez» vuelve mañana.
 */
export function schedule(
  mem: Memory,
  grade: Grade,
  today = todayInputValue(),
): Next {
  if (grade === "nunca") return { step: -1, days: null, s: null, d: null };
  const g = RATING[grade];
  const out = raw(mem, g, today);
  if (g === 1) return { ...out, days: 1 };
  const good = raw(mem, 3, today).days;
  const hard = Math.min(raw(mem, 2, today).days, good);
  if (g === 2) return { ...out, days: hard };
  const okGood = Math.max(good, hard + 1);
  if (g === 3) return { ...out, days: okGood };
  return { ...out, days: Math.max(out.days, okGood + 1) };
}

/** Probabilidad de recordarla hoy (0 a 1); null si es nueva. */
export function recallToday(mem: Memory, today = todayInputValue()) {
  const now = state(mem, today);
  return now ? retrievability(now.elapsed, now.s) : null;
}

/** La fecha del siguiente repaso, o null si ya no se repasa. */
export const dueDate = (next: Next, today = todayInputValue()) =>
  next.days === null ? null : addDays(today, next.days);

/** ¿El error dice que faltan las columnas de FSRS (migración sin ejecutar)? */
export const missingMemory = (e: { code?: string; message?: string }) =>
  e.code === "PGRST204" ||
  e.code === "42703" ||
  /review_stability|review_difficulty|reviewed_at/.test(e.message ?? "");

/** Migración que guarda la memoria de FSRS en Lecturas. */
export const FSRS_SQL = "supabase/migrations/202611100004_reading_fsrs.sql";

/** Columnas de la memoria para una fila de Supabase. */
export const memoryColumns = (next: Next, today = todayInputValue()) => ({
  review_step: next.step,
  review_due: dueDate(next, today),
  reviewed_at: new Date().toISOString(),
  review_stability: next.s,
  review_difficulty: next.d,
});

/** La memoria de una fila de Supabase. */
export const memoryOf = (row: {
  review_step: number;
  review_stability?: number | null;
  review_difficulty?: number | null;
  reviewed_at?: string | null;
  review_due?: string | null;
}): Memory => ({
  step: row.review_step,
  s: row.review_stability ?? null,
  d: row.review_difficulty ?? null,
  last: row.reviewed_at ?? null,
  due: row.review_due ?? null,
});
