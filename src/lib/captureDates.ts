import { addDays, normalizeText, todayInputValue } from './format';

/**
 * Fechas en lenguaje natural para la captura: «ayer», «el viernes pasado», «hace 2 semanas»,
 * «dentro de 2 meses», «en un año», «el 15 de marzo del próximo año», «15/03», «2026-03-15»,
 * «a mediados de diciembre», «el próximo mes»… Todo se busca sobre el texto normalizado (sin
 * tildes, en minúsculas), que conserva las posiciones del original.
 */

export type DateHit = {
  date: string;
  /** Posición y largo de la expresión en el texto (para mostrarla o quitarla). */
  index: number;
  length: number;
  phrase: string;
};
type Mode = 'past' | 'future';

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};
const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  sept: 9,
  set: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};
const NUMBERS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  'un par de': 2,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  quince: 15,
  veinte: 20,
  treinta: 30,
  medio: 0.5,
  media: 0.5,
};

const W = '(lunes|martes|miercoles|jueves|viernes|sabado|domingo)';
const M =
  '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
const MA =
  '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept|sep|set|oct|nov|dic)';
const N =
  '(\\d{1,3}|un par de|una|un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|medio|media)';
const U = '(dias?|semanas?|quincenas?|meses|mes|anos?)';
/** «de 2027», «del próximo año», «del año pasado». */
const YEAR = '(?:\\s+(?:de|del)\\s+(\\d{4}|proximo ano|ano que viene|siguiente ano|ano pasado|este ano))?';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const weekdayOf = (date: string) => {
  const [y, m, d] = parts(date);
  return new Date(y, m - 1, d).getDay();
};
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
const valid = (y: number, m: number, d: number) =>
  y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m);

/** Suma meses sin desbordar: 31 de enero + 1 mes = 28 (o 29) de febrero. */
export function addMonths(date: string, n: number) {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(d, lastDay(ny, nm)));
}

const count = (word: string) => NUMBERS[word] ?? Number(word);

/** Desplaza `n` unidades («2 semanas», «medio año», «un año y medio»). */
function shift(today: string, n: number, unit: string, sign: 1 | -1) {
  if (unit.startsWith('dia')) return addDays(today, sign * Math.round(n));
  if (unit.startsWith('semana')) return addDays(today, sign * Math.round(n * 7));
  if (unit.startsWith('quincena')) return addDays(today, sign * Math.round(n * 15));
  if (unit.startsWith('mes')) {
    const whole = Math.trunc(n);
    const moved = addMonths(today, sign * whole);
    return n % 1 ? addDays(moved, sign * 15) : moved;
  }
  return addMonths(today, sign * Math.round(n * 12));
}

/** Año de «de 2027», «del próximo año»…; null si no se dijo. */
function yearOf(word: string | undefined, today: string): number | null {
  if (!word) return null;
  const y = Number(today.slice(0, 4));
  if (/^\d{4}$/.test(word)) return Number(word);
  if (/proximo|que viene|siguiente/.test(word)) return y + 1;
  if (/pasado/.test(word)) return y - 1;
  return y;
}

/** Día y mes sin año: el más cercano hacia el pasado o hacia el futuro según el caso. */
function nearest(m: number, d: number, year: number | null, mode: Mode, today: string) {
  if (year !== null) return valid(year, m, d) ? iso(year, m, d) : null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const y = Number(today.slice(0, 4));
  const at = (yy: number) => (valid(yy, m, d) ? iso(yy, m, d) : null);
  const here = at(y);
  if (mode === 'future' && (!here || here < today)) return at(y + 1) ?? at(y + 4);
  if (mode === 'past' && (!here || here > today)) return at(y - 1) ?? at(y - 4);
  return here;
}

/** «El 15»: este mes, o el anterior / el siguiente si ya pasó o aún no llega. */
function dayOfMonth(d: number, mode: Mode, today: string, monthShift: number | null) {
  const [y, m] = parts(today);
  const base = iso(y, m, 1);
  const pick = (k: number) => {
    const [yy, mm] = parts(addMonths(base, k));
    return d <= lastDay(yy, mm) ? iso(yy, mm, d) : null;
  };
  if (monthShift !== null) return pick(monthShift);
  const here = pick(0);
  if (!here) return pick(mode === 'future' ? 1 : -1);
  if (mode === 'future' && here < today) return pick(1);
  if (mode === 'past' && here > today) return pick(-1);
  return here;
}

/** Lunes de la semana de una fecha. */
const mondayOf = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));
/** Ese día de la semana dentro de la semana que empieza en `monday`. */
const inWeek = (monday: string, wd: number) => addDays(monday, (wd + 6) % 7);

type Rule = {
  re: RegExp;
  modes: Mode[];
  run: (m: RegExpExecArray, today: string, mode: Mode) => string | null;
};

/** De lo más específico a lo más vago: la primera regla que encaja decide. */
const RULES: Rule[] = [
  // 2026-03-15 · 2026/03/15
  {
    re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
    modes: ['past', 'future'],
    run: (m) => (valid(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null),
  },
  // 15/03/2026 · 15-03-26 · 15.03.2026
  {
    re: /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b/,
    modes: ['past', 'future'],
    run: (m) => {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return valid(y, +m[2], +m[1]) ? iso(y, +m[2], +m[1]) : null;
    },
  },
  // 15 de marzo (de 2027 / del próximo año) · 15 mar · primero de mayo
  {
    re: new RegExp(`\\b(\\d{1,2}|primero)(?:\\s+de)?\\s+${MA}\\b\\.?${YEAR}`),
    modes: ['past', 'future'],
    run: (m, today, mode) =>
      nearest(MONTHS[m[2]], m[1] === 'primero' ? 1 : +m[1], yearOf(m[3], today), mode, today),
  },
  // marzo 15 (de 2027)
  {
    re: new RegExp(`\\b${M}\\s+(\\d{1,2})\\b(?!\\s*(?:mil|personas|%))${YEAR}`),
    modes: ['past', 'future'],
    run: (m, today, mode) => nearest(MONTHS[m[1]], +m[2], yearOf(m[3], today), mode, today),
  },
  // 15/03 · 15-03
  {
    re: /\b(\d{1,2})[/-](\d{1,2})\b(?![/\-.]\d)/,
    modes: ['past', 'future'],
    run: (m, today, mode) => nearest(+m[2], +m[1], null, mode, today),
  },
  // el viernes 13 → el 13
  {
    re: new RegExp(`\\b${W}\\s+(\\d{1,2})\\b(?!\\s*(?:de|/|:|mil|personas|%))`),
    modes: ['past', 'future'],
    run: (m, today, mode) => dayOfMonth(+m[2], mode, today, null),
  },
  // hace 3 días · hace un mes · hace un año y medio · 2 semanas atrás
  {
    re: new RegExp(
      `\\bhace\\s+(?:unos\\s+|unas\\s+|como\\s+|mas de\\s+|casi\\s+)?${N}\\s+${U}(\\s+y medio)?\\b`,
    ),
    modes: ['past'],
    run: (m, today) => shift(today, count(m[1]) + (m[3] ? 0.5 : 0), m[2], -1),
  },
  {
    re: new RegExp(`\\b${N}\\s+${U}\\s+atras\\b`),
    modes: ['past'],
    run: (m, today) => shift(today, count(m[1]), m[2], -1),
  },
  // en 3 días · dentro de 2 meses · en un año · de aquí a 2 semanas · en medio año
  {
    re: new RegExp(
      `\\b(?:en|dentro de|de aqui a)\\s+(?:unos\\s+|unas\\s+|como\\s+)?${N}\\s+${U}(\\s+y medio)?\\b`,
    ),
    modes: ['future'],
    run: (m, today) => shift(today, count(m[1]) + (m[3] ? 0.5 : 0), m[2], 1),
  },
  // Días con nombre
  {
    re: /\b(?:anteayer|antier|antes de ayer|antes de anoche)\b/,
    modes: ['past'],
    run: (_, t) => addDays(t, -2),
  },
  { re: /\b(?:ayer|anoche)\b/, modes: ['past'], run: (_, t) => addDays(t, -1) },
  { re: /\bpasado manana\b/, modes: ['future'], run: (_, t) => addDays(t, 2) },
  // «mañana» (no «esta mañana» ni «por la mañana»)
  {
    re: /(?<!\b(?:esta|la|una|cada|toda la|de la|en la|por la)\s)\bmanana\b/,
    modes: ['future'],
    run: (_, t) => addDays(t, 1),
  },
  {
    re: /\b(?:hoy(?: mismo)?|esta manana|esta tarde|esta noche|hace un rato|hace rato|hace poco)\b/,
    modes: ['past'],
    run: (_, t) => t,
  },
  {
    re: /\b(?:hoy(?: mismo)?|esta tarde|esta noche|ahorita|en un rato|mas tarde|en la tarde|en la noche)\b/,
    modes: ['future'],
    run: (_, t) => t,
  },
  // el lunes de la próxima semana · el lunes de la semana pasada
  {
    re: new RegExp(
      `\\b${W}\\s+de\\s+la\\s+(?:proxima\\s+semana|otra\\s+semana|semana\\s+que\\s+viene|semana\\s+entrante)\\b`,
    ),
    modes: ['future'],
    run: (m, t) => inWeek(addDays(mondayOf(t), 7), WEEKDAYS[m[1]]),
  },
  {
    re: new RegExp(`\\b${W}\\s+de\\s+la\\s+semana\\s+pasada\\b`),
    modes: ['past'],
    run: (m, t) => inWeek(addDays(mondayOf(t), -7), WEEKDAYS[m[1]]),
  },
  // el viernes · el viernes pasado · el pasado viernes
  {
    re: new RegExp(`\\b(?:el|este|el pasado|este pasado)\\s+${W}(\\s+pasado)?\\b`),
    modes: ['past'],
    run: (m, t) => addDays(t, -((weekdayOf(t) - WEEKDAYS[m[1]] + 7) % 7 || 7)),
  },
  // el viernes · el próximo viernes · el viernes que viene
  {
    re: new RegExp(
      `\\b(?:el|este|el proximo|este proximo|para el|antes del|hasta el|a mas tardar el)\\s+${W}\\b`,
    ),
    modes: ['future'],
    run: (m, t) => addDays(t, (WEEKDAYS[m[1]] - weekdayOf(t) + 7) % 7 || 7),
  },
  {
    re: new RegExp(`\\b${W}\\s+(?:que viene|entrante|proximo)\\b`),
    modes: ['future'],
    run: (m, t) => addDays(t, (WEEKDAYS[m[1]] - weekdayOf(t) + 7) % 7 || 7),
  },
  // Semanas, quincenas, meses y años
  { re: /\bla semana pasada\b/, modes: ['past'], run: (_, t) => addDays(t, -7) },
  { re: /\bla quincena pasada\b/, modes: ['past'], run: (_, t) => addDays(t, -15) },
  {
    re: /\b(?:el )?(?:fin de semana|finde) pasado\b/,
    modes: ['past'],
    run: (_, t) => {
      const wd = weekdayOf(t);
      const back = (wd - 6 + 7) % 7;
      return addDays(t, -(wd === 0 || wd === 6 ? back + 7 : back));
    },
  },
  {
    re: /\b(?:este|el) (?:fin de semana|finde)\b/,
    modes: ['past'],
    run: (_, t) => addDays(t, -((weekdayOf(t) - 6 + 7) % 7)),
  },
  {
    re: /\b(?:la proxima semana|la otra semana|la semana que viene|la semana entrante)\b/,
    modes: ['future'],
    run: (_, t) => addDays(t, (1 - weekdayOf(t) + 7) % 7 || 7),
  },
  {
    re: /\b(?:este|el|el proximo|para el) (?:fin de semana|finde)\b/,
    modes: ['future'],
    run: (_, t) => addDays(t, (6 - weekdayOf(t) + 7) % 7),
  },
  {
    re: /\besta semana\b/,
    modes: ['future'],
    run: (_, t) => addDays(t, Math.max(0, 5 - weekdayOf(t))),
  },
  { re: /\bel mes pasado\b/, modes: ['past'], run: (_, t) => addMonths(t, -1) },
  { re: /\bel ano pasado\b/, modes: ['past'], run: (_, t) => addMonths(t, -12) },
  {
    re: /\b(?:a )?(?:principios|comienzos|inicios) de(?:l)? mes\b/,
    modes: ['past', 'future'],
    run: (_, t, mode) => {
      const first = t.slice(0, 8) + '01';
      return mode === 'future' && first < t ? addMonths(first, 1) : first;
    },
  },
  {
    re: /\b(?:a )?mediados de(?:l)? mes\b/,
    modes: ['past', 'future'],
    run: (_, t, mode) => dayOfMonth(15, mode, t, null),
  },
  {
    re: /\b(?:a )?(?:fin|final|finales|fines) de(?:l)? mes\b/,
    modes: ['future'],
    run: (_, t) => {
      const [y, m] = parts(t);
      return iso(y, m, lastDay(y, m));
    },
  },
  {
    re: /\b(?:el proximo mes|el siguiente mes|el mes que viene|el mes entrante)\b/,
    modes: ['future'],
    run: (_, t) => addMonths(t.slice(0, 8) + '01', 1),
  },
  {
    re: /\b(?:a )?(?:fin|final|finales|fines) de(?:l)? ano\b/,
    modes: ['future', 'past'],
    run: (_, t, mode) => {
      const y = Number(t.slice(0, 4));
      return mode === 'past' && `${y}-12-31` > t ? `${y - 1}-12-31` : `${y}-12-31`;
    },
  },
  {
    re: /\b(?:el proximo ano|el siguiente ano|el ano que viene|el ano entrante)\b/,
    modes: ['future'],
    run: (_, t) => `${Number(t.slice(0, 4)) + 1}-01-01`,
  },
  // en marzo · para diciembre · a mediados de junio · a finales de marzo del próximo año
  {
    re: new RegExp(
      `\\b(?:(?:en|para|hasta|desde|el mes de|en el mes de)\\s+|(?:a\\s+)?(principios|comienzos|inicios|mediados|finales|fines|fin|final)\\s+de\\s+)${M}${YEAR}\\b`,
    ),
    modes: ['past', 'future'],
    run: (m, t, mode) => {
      const month = MONTHS[m[2]];
      const y0 = yearOf(m[3], t);
      const [ty, tm] = parts(t);
      let y = y0 ?? ty;
      if (y0 === null) {
        if (mode === 'future' && month < tm) y = ty + 1;
        if (mode === 'past' && month > tm) y = ty - 1;
      }
      const q = m[1] ?? '';
      const d = /mediados/.test(q) ? 15 : /fin|final/.test(q) ? lastDay(y, month) : 1;
      const date = iso(y, month, d);
      // «En noviembre» dicho en noviembre: desde hoy.
      return y0 === null && mode === 'future' && date < t ? t : date;
    },
  },
  // el 15 · para el 15 · el próximo 15 · el 15 del próximo mes
  {
    re: /\b(?:el|este|el proximo|para el|antes del|hasta el|desde el|el dia|a mas tardar el)\s+(\d{1,2})\b(?!\s*(?:de\b|mil|%|\/|:|personas|anos|horas|dias|veces|minutos|libros|paginas|pesos|k\b))(?:\s+(del proximo mes|del mes que viene|del siguiente mes|de este mes|del mes pasado))?/,
    modes: ['past', 'future'],
    run: (m, t, mode) => {
      const d = +m[1];
      if (d < 1 || d > 31) return null;
      const which = m[2] ?? '';
      const k = /pasado/.test(which) ? -1 : /este/.test(which) ? 0 : which ? 1 : null;
      return dayOfMonth(d, mode, t, k);
    },
  },
];

/** Lo que se cuenta en futuro dentro de un relato en pasado: no dice cuándo pasó. */
const FUTURE_SPAN =
  /\b(?:le prometi|les prometi|prometi|quede en|quedamos en|me comprometi|tengo que|tenemos que|debo|necesito|voy a|vamos a|me toca|hay que|me va a|me van a|quedo en|quedaron en|nos vemos|para el|antes del|hasta el|dentro de|el proximo|la proxima|que viene)\b[^.;!?\n]*/g;

/** La primera expresión de fecha del texto, con su posición. */
export function findDate(text: string, mode: Mode, today = todayInputValue()): DateHit | null {
  let t = normalizeText(text);
  // En pasado, los planes («le prometí llamarla el viernes») no cuentan.
  if (mode === 'past') t = t.replace(FUTURE_SPAN, (s) => ' '.repeat(s.length));
  for (const rule of RULES) {
    if (!rule.modes.includes(mode)) continue;
    const m = rule.re.exec(t);
    if (!m) continue;
    const date = rule.run(m, today, mode);
    if (date)
      return {
        date,
        index: m.index,
        length: m[0].length,
        phrase: text.slice(m.index, m.index + m[0].length),
      };
  }
  return null;
}

/** Cuándo pasó algo contado en pasado: «ayer», «el viernes», «hace 3 días», «el 15 de mayo». */
export function pastDate(text: string, today = todayInputValue()): string | null {
  return findDate(text, 'past', today)?.date ?? null;
}

/** Para cuándo es algo contado en futuro: «mañana», «dentro de 2 meses», «en un año». */
export function futureDate(text: string, today = todayInputValue()): string | null {
  return findDate(text, 'future', today)?.date ?? null;
}

/** Quita las expresiones de fecha («el viernes», «dentro de 2 meses») para dejar solo la acción. */
export function stripDates(text: string, today = todayInputValue()) {
  let out = text;
  for (let i = 0; i < 3; i++) {
    const hit = findDate(out, 'future', today);
    if (!hit) break;
    out = out.slice(0, hit.index) + ' ' + out.slice(hit.index + hit.length);
  }
  return out
    .replace(/\s+(?:para|antes de|hasta|a más tardar|a mas tardar)\s*(?=[,.;]|$)/i, '')
    .replace(/\s*,\s*(?=[,.;]|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** ¿El párrafo arranca con una fecha? («Ayer…», «El lunes…», «15/11: …»). */
export function startsWithDate(text: string, today = todayInputValue()) {
  const head = text.slice(0, 60);
  if (/^\s*(?:el\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(normalizeText(head)))
    return true;
  const hit = findDate(head, 'past', today) ?? findDate(head, 'future', today);
  return Boolean(hit && hit.index <= 4);
}
