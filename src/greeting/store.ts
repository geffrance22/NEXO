import {
  KINDS,
  PARTS,
  parseGreeting,
  parseWeather,
  type Greeting,
  type GreetingKind,
  type Part,
  type Weather,
} from './greeting';

export const KEY = 'nexo-greeting';
const HISTORY = 'nexo-greeting-history';
const PAUSE = 'nexo-greeting-pause';
const MINUTE = 60_000;

/** El último saludo de la IA, guardado en este navegador para no pedirlo en cada visita. */
export type Stored = {
  /** Cuenta a la que pertenece: otra cuenta en el mismo navegador no ve el saludo de la anterior. */
  uid: string;
  /** Cuándo se creó y hasta cuándo vale. */
  at: number;
  exp: number;
  /** AAAA-MM-DD y momento del día en que se creó (un saludo de la mañana no sirve en la noche). */
  day: string;
  part: Part;
  name: string | null;
  greeting: Greeting;
  weather: Weather | null;
};

export function readStored(uid: string): Stored | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    if (!raw || raw.uid !== uid) return null;
    const greeting = parseGreeting(raw.greeting);
    const part = PARTS.find((p) => p === raw.part);
    if (
      !greeting ||
      !part ||
      typeof raw.at !== 'number' ||
      typeof raw.exp !== 'number' ||
      typeof raw.day !== 'string'
    )
      return null;
    return {
      uid,
      at: raw.at,
      exp: raw.exp,
      day: raw.day,
      part,
      name: typeof raw.name === 'string' ? raw.name : null,
      greeting,
      weather: parseWeather(raw.weather),
    };
  } catch {
    return null;
  }
}

export function writeStored(value: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Sin almacenamiento, el saludo dura mientras la página siga abierta.
  }
}

/** Cada saludo de la IA vale 15 minutos. */
export const LIFETIME = 15 * MINUTE;

/** Vigente: del mismo día y momento del día, y dentro de su tiempo. */
export const isFresh = (s: Stored, day: string, part: Part, now = Date.now()) =>
  s.day === day && s.part === part && s.exp > now;

/** Sirve de respaldo mientras llega el nuevo: mismo día y momento, de hace menos de 3 horas. */
export const isUsable = (s: Stored, day: string, part: Part, now = Date.now()) =>
  s.day === day && s.part === part && now - s.at < 180 * MINUTE;

// ───────────────────────── Lo dicho hace poco (para no repetirse) ─────────────────────────

export type Past = { kind: GreetingKind; title: string };

export function readHistory(): Past[] {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY) ?? '[]') as
      | { kind?: unknown; title?: unknown }[]
      | null;
    return (Array.isArray(list) ? list : [])
      .flatMap((x) => {
        const kind = KINDS.find((k) => k === x?.kind);
        const title = typeof x?.title === 'string' ? x.title.slice(0, 90) : '';
        return kind && title ? [{ kind, title }] : [];
      })
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function pushHistory(g: Greeting) {
  try {
    const next = [{ kind: g.kind, title: g.title }, ...readHistory()].slice(0, 8);
    localStorage.setItem(HISTORY, JSON.stringify(next));
  } catch {
    // Solo sirve para variar: si no se guarda, no pasa nada.
  }
}

// ───────────────────────── Pausa tras un fallo ─────────────────────────

/**
 * Hasta cuándo no insistir con la función (no desplegada, sin conexión, límite…). Se comparte entre
 * pestañas: si una falla, las demás tampoco insisten.
 */
export const pausedUntil = () => {
  try {
    return Number(localStorage.getItem(PAUSE)) || 0;
  } catch {
    return 0;
  }
};

export function pause(ms: number) {
  try {
    localStorage.setItem(PAUSE, String(Date.now() + ms));
  } catch {
    // Sin almacenamiento solo se reintenta en la próxima visita.
  }
}
