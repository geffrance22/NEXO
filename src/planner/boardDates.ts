import { findDate } from "../lib/captureDates";
import { normalizeText, todayInputValue } from "../lib/format";

/**
 * Fechas en lenguaje natural en el título de una tarjeta: «Llamar al banco el viernes» queda
 * «Llamar al banco» con fecha el viernes. Usa el mismo lector de fechas que la captura de
 * recuerdos (en futuro). null si el título no trae una fecha.
 */
export function dateInTitle(title: string, today = todayInputValue()) {
  const hit = findDate(title, "future", today);
  if (!hit) return null;
  // El lector trabaja sobre el texto normalizado, que conserva las posiciones.
  if (normalizeText(title).length !== title.length) return null;
  const clean = (
    title.slice(0, hit.index) +
    " " +
    title.slice(hit.index + hit.length)
  )
    .replace(
      /\s+(?:para|antes de|hasta|a más tardar|a mas tardar|el|la|los|las)\s*$/i,
      "",
    )
    .replace(/^\s*(?:el|la)\s+(?=\S)/i, (m) => (hit.index === 0 ? "" : m))
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[\s,;·-]+$/, "")
    .replace(/^[\s,;·:-]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Si solo era la fecha («mañana»), el título se queda como estaba.
  if (!clean) return null;
  const title2 =
    hit.index === 0 ? clean[0].toUpperCase() + clean.slice(1) : clean;
  return { title: title2, due: hit.date, phrase: hit.phrase };
}

/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function dayDiff(a: string, b: string) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000,
  );
}
