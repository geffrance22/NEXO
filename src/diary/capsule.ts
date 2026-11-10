import type { Entry } from "../data";
import { addDays, todayInputValue } from "../lib/format";

/**
 * Cápsulas del tiempo: entradas del diario que se sellan hasta una fecha. Mientras no las abras
 * no aparecen en ningún lado (diario, búsqueda, IA, estadísticas): solo en «Cápsulas del
 * tiempo», con su cuenta regresiva. Las de una sola vez se borran al cerrarlas.
 */

/** Sellada: aún no llega su fecha. */
export const isSealed = (e: Entry, today = todayInputValue()) =>
  Boolean(e.details.capsule && e.details.capsule.opensOn > today);

/** Ya se puede abrir y todavía no la abres. */
export const isReady = (e: Entry, today = todayInputValue()) => {
  const c = e.details.capsule;
  return Boolean(c && c.opensOn <= today && !c.seenAt);
};

/**
 * Fuera del resto de Nexo: sellada, lista sin abrir, o de una sola vez (esa nunca pasa a ser una
 * entrada normal).
 */
export const isHiddenCapsule = (e: Entry, today = todayInputValue()) => {
  const c = e.details.capsule;
  return Boolean(c && (c.once || !c.seenAt || c.opensOn > today));
};

/** Una de una sola vez que ya abriste (p. ej. cerraste la pestaña mientras la leías): se borra. */
export const isSpent = (e: Entry) =>
  Boolean(e.details.capsule?.once && e.details.capsule.seenAt);

const DAY = 86400000;
const parse = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
};
export const daysUntil = (date: string, today = todayInputValue()) =>
  Math.round((parse(date).getTime() - parse(today).getTime()) / DAY);

/** «mañana», «en 12 días», «en 3 meses», «en 2 años». */
export function countdown(date: string, today = todayInputValue()) {
  const n = daysUntil(date, today);
  if (n <= 0) return "hoy";
  if (n === 1) return "mañana";
  if (n < 45) return `en ${n} días`;
  const months = Math.round(n / 30.44);
  if (months < 18) return `en ${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.round((n / 365.25) * 10) / 10;
  return `en ${years.toLocaleString("es-CO")} ${years === 1 ? "año" : "años"}`;
}

/** Fecha larga: «9 de noviembre de 2027». */
export const capsuleDay = (date: string) =>
  new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parse(date));

/** Atajos para elegir cuándo se abre. */
export function capsulePresets(today = todayInputValue()) {
  const months = (n: number) => {
    const d = parse(today);
    d.setMonth(d.getMonth() + n);
    return todayInputValue(d);
  };
  return [
    { label: "1 semana", date: addDays(today, 7) },
    { label: "1 mes", date: months(1) },
    { label: "6 meses", date: months(6) },
    { label: "1 año", date: months(12) },
    { label: "5 años", date: months(60) },
  ];
}
