/** Saludo de Mi espacio: tipos, momento del día y validación de lo que llega de la IA. */

export type Part = 'madrugada' | 'mañana' | 'tarde' | 'noche';
export const PARTS: readonly Part[] = ['madrugada', 'mañana', 'tarde', 'noche'];

/** Madrugada hasta las 5, mañana hasta el mediodía, tarde hasta las 6 y noche el resto. */
export function partOf(now = new Date()): Part {
  const h = now.getHours();
  return h < 5 ? 'madrugada' : h < 12 ? 'mañana' : h < 18 ? 'tarde' : 'noche';
}

/** Qué clase de mensaje es (la IA elige uno; sirve para variar y no repetirse). */
export const KINDS = [
  'tip',
  'consejo',
  'recordatorio',
  'recomendacion',
  'noticia',
  'curiosidad',
  'cumple',
  'serie',
  'libro',
  'clima',
  'animo',
  'plan',
  'humor',
] as const;
export type GreetingKind = (typeof KINDS)[number];

/** Un acceso directo: `id` es uno de los que la app ofreció (ver `actions.ts`). */
export type GreetingAction = { id: string; label: string };
export type Greeting = {
  kind: GreetingKind;
  title: string;
  text: string;
  actions: GreetingAction[];
};

export const WEATHER_ICONS = [
  'sun',
  'moon',
  'partly',
  'cloud',
  'fog',
  'drizzle',
  'rain',
  'storm',
  'snow',
] as const;
export type WeatherIcon = (typeof WEATHER_ICONS)[number];
export type Weather = {
  temp: number;
  feels: number;
  label: string;
  icon: WeatherIcon;
  city: string;
  isDay: boolean;
  min: number | null;
  max: number | null;
  rain: number | null;
};

/** Lo que Nexo sabe de tu momento sin necesitar a la IA (para el saludo de respaldo). */
export type LocalFacts = {
  myBirthday: boolean;
  birthday?: { id: string; name: string };
  /** Lo más urgente de la agenda, ya redactado. */
  urgent?: { text: string; entryId?: string };
  book?: { id: string; title: string; where?: string };
  series?: { id: string; title: string; where?: string };
};

const oneLine = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Lo que llega de la función puede venir incompleto: solo se acepta un saludo con título y texto. */
export function parseGreeting(raw: unknown): Greeting | null {
  if (!isRecord(raw)) return null;
  const title = oneLine(raw.title, 100);
  const text = oneLine(raw.text, 300);
  if (!title || !text) return null;
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .flatMap((a: unknown) => {
      if (!isRecord(a)) return [];
      const id = oneLine(a.id, 80);
      const label = oneLine(a.label, 40);
      return id && label ? [{ id, label }] : [];
    })
    .slice(0, 2);
  return { kind: KINDS.find((k) => k === raw.kind) ?? 'tip', title, text, actions };
}

export function parseWeather(raw: unknown): Weather | null {
  if (!isRecord(raw)) return null;
  const temp = finite(raw.temp);
  const city = oneLine(raw.city, 60);
  const icon = WEATHER_ICONS.find((i) => i === raw.icon);
  if (temp === null || !city || !icon) return null;
  return {
    temp: Math.round(temp),
    feels: Math.round(finite(raw.feels) ?? temp),
    label: oneLine(raw.label, 40),
    icon,
    city,
    isDay: raw.isDay !== false,
    min: finite(raw.min),
    max: finite(raw.max),
    rain: finite(raw.rain),
  };
}
