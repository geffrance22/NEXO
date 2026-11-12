const copFormat = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export const money = (n: number) => copFormat.format(n);

/** Contador corto: 950, 1k, 1.5k, 12k, 1.2M (sin redondear hacia arriba: 999 999 es 999k). */
export function compactCount(n: number) {
  if (n < 1000) return String(n);
  const short = (v: number, unit: string) =>
    (v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v)).toString() + unit;
  return n < 1_000_000 ? short(n / 1000, 'k') : short(n / 1_000_000, 'M');
}

export const initials = (s: string) =>
  s
    .split(' ')
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join('');

export const shortDate = (s: string) =>
  new Date(s).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

/** Fecha de hoy en la zona horaria del usuario (AAAA-MM-DD), apta para <input type="date">. */
export function todayInputValue(now = new Date()) {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/**
 * Minúsculas y sin tildes ni diéresis para comparar textos. La «ñ» también se pliega a «n»:
 * así «Munoz» encuentra a «Muñoz», a costa de que «ano» también encuentre «año».
 */
export const normalizeText = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Divide una lista separada por comas, recorta espacios y descarta vacíos. */
export const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const { message } = e as { message: unknown };
    if (typeof message === 'string') return message;
  }
  return 'Ocurrió un error inesperado.';
}

/** Suma días a una fecha AAAA-MM-DD (sin problemas de zona horaria ni de horario de verano). */
export function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  return todayInputValue(new Date(y, m - 1, d + days));
}

/** Próximo sábado (o hoy, si ya es sábado). */
export function nextSaturday(from = todayInputValue()) {
  const [y, m, d] = from.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).getDay(); // 0 domingo … 6 sábado
  return addDays(from, (6 - weekday + 7) % 7);
}

/** Próximo lunes (siempre posterior a hoy). */
export function nextMonday(from = todayInputValue()) {
  const [y, m, d] = from.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  return addDays(from, (1 - weekday + 7) % 7 || 7);
}

/** «Hoy», «Ayer», «Mañana» o «jue 5 nov» para una fecha AAAA-MM-DD. */
export function friendlyDate(date: string, today = todayInputValue()) {
  if (date === today) return 'Hoy';
  if (date === addDays(today, -1)) return 'Ayer';
  if (date === addDays(today, 1)) return 'Mañana';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d)
    .toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace('.', '');
}

/** Agrega separadores de miles al estilo colombiano: 1250000 → «1.250.000». */
export const thousands = (n: number) => (n ? Math.round(n).toLocaleString('es-CO') : '');
