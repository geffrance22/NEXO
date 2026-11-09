import { normalizeText } from './format';

/**
 * Lo que la captura aprende de tus correcciones, guardado solo en este navegador (localStorage)
 * y con tope de tamaño: nunca pasa de unos 25 KB y no escribe nada en Supabase.
 *
 * - names: a quién te refieres con un nombre ambiguo («Laura» → Laura Gómez).
 * - cats: palabras de un gasto → categoría («rappi» → Comida, «platzi» → Educación).
 * - kinds: qué tipos de pieza sueles guardar o descartar.
 *
 * Cada recuerdo lleva su última fecha de uso; al pasar el tope se olvida lo más viejo.
 */

const KEY = 'nexo-capture-memory';
const MAX_NAMES = 150;
const MAX_CATS = 400;

type Learned = { v: string; n: number; t: number };
export type CaptureMemory = {
  v: 1;
  names: Record<string, Learned>;
  cats: Record<string, Learned>;
  kinds: Record<string, { k: number; d: number }>;
};

const empty = (): CaptureMemory => ({ v: 1, names: {}, cats: {}, kinds: {} });
let cache: CaptureMemory | null = null;

export function readMemory(): CaptureMemory {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as CaptureMemory | null;
    cache = raw && raw.v === 1 ? { ...empty(), ...raw } : empty();
  } catch {
    cache = empty();
  }
  return cache;
}

function write(mem: CaptureMemory) {
  cache = mem;
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
  } catch {
    // Sin almacenamiento (o lleno): se aprende solo mientras la página siga abierta.
  }
}

/** Se queda con los `max` más usados recientemente. */
function prune(map: Record<string, Learned>, max: number) {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const keep = keys.sort((a, b) => map[b].t - map[a].t).slice(0, max);
  return Object.fromEntries(keep.map((k) => [k, map[k]]));
}

/** Refuerza un valor; si la clave tenía otro, primero lo debilita (y lo reemplaza al llegar a 0). */
function teach(map: Record<string, Learned>, key: string, value: string, weight: number) {
  const now = Date.now();
  const cur = map[key];
  if (!cur || cur.v === value) {
    map[key] = { v: value, n: Math.min(9, (cur?.n ?? 0) + weight), t: now };
    return;
  }
  const n = cur.n - weight;
  map[key] = n > 0 ? { ...cur, n, t: now } : { v: value, n: Math.min(9, -n || 1), t: now };
}

const STOP = new Set(
  (
    'que con por para del las los una uno unos unas este esta eso esa ese como pero mas muy hoy ayer ' +
    'manana tarde noche pague pagamos gaste gastamos compre compramos costo salio mil pesos lucas ' +
    'millon millones cop fue fui fuimos estuvo nos les mis sus tus todo toda algo cada donde cuando ' +
    'tambien entonces luego despues ahora alla aqui aca'
  ).split(' '),
);

/** Palabras con contenido de un trozo de texto («el domicilio de Rappi» → domicilio, rappi). */
export function contentWords(text: string, max = 6) {
  const out: string[] = [];
  for (const w of normalizeText(text).split(/[^a-z0-9ñ]+/)) {
    if (w.length < 3 || /^\d+$/.test(w) || STOP.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** A quién te refieres con ese nombre, si lo aclaraste antes y sigue entre las opciones. */
export function learnedPerson(name: string, ids: string[], mem = readMemory()) {
  const hit = mem.names[normalizeText(name.trim())];
  return hit && ids.includes(hit.v) ? hit.v : null;
}

/** Categoría aprendida para las palabras de un gasto: la de más peso, con la palabra que la dio. */
export function learnedCategory(words: string[], allowed: string[], mem = readMemory()) {
  let best: { category: string; weight: number; word: string } | null = null;
  for (const w of words) {
    const hit = mem.cats[w];
    if (!hit || !allowed.includes(hit.v)) continue;
    if (!best || hit.n > best.weight) best = { category: hit.v, weight: hit.n, word: w };
  }
  return best;
}

/** ¿Sueles descartar este tipo de pieza? (al menos 5 veces y casi siempre). */
export function usuallyDropped(kind: string, mem = readMemory()) {
  const k = mem.kinds[kind];
  return Boolean(k && k.d >= 5 && k.d / (k.k + k.d) >= 0.8);
}

type LearnInput = {
  /** Nombres ambiguos con la persona elegida. */
  names: { name: string; chosen: string }[];
  /** Gastos guardados: sus palabras, la categoría final y si la corregiste. */
  cats: { words: string[]; category: string; corrected: boolean }[];
  /** Piezas propuestas: su tipo y si la guardaste. */
  kinds: { kind: string; kept: boolean }[];
};

/** Aprende de una experiencia guardada (una sola escritura en localStorage). */
export function learnFromCapture(input: LearnInput) {
  const mem = readMemory();
  const next: CaptureMemory = {
    v: 1,
    names: { ...mem.names },
    cats: { ...mem.cats },
    kinds: { ...mem.kinds },
  };
  for (const { name, chosen } of input.names) {
    if (!chosen || chosen.startsWith('new:') || chosen.startsWith('kin:')) continue;
    teach(next.names, normalizeText(name.trim()), chosen, 2);
  }
  for (const c of input.cats) {
    if (!c.category || c.category === 'Otro') continue;
    for (const w of c.words.slice(0, 4)) teach(next.cats, w, c.category, c.corrected ? 3 : 1);
  }
  for (const { kind, kept } of input.kinds) {
    const cur = next.kinds[kind] ?? { k: 0, d: 0 };
    let k = cur.k + (kept ? 1 : 0);
    let d = cur.d + (kept ? 0 : 1);
    // Pesa más lo reciente: al pasar de 20 se reduce a la mitad.
    if (k + d > 20) {
      k = Math.round(k / 2);
      d = Math.round(d / 2);
    }
    next.kinds[kind] = { k, d };
  }
  next.names = prune(next.names, MAX_NAMES);
  next.cats = prune(next.cats, MAX_CATS);
  write(next);
}

/** Olvida todo lo aprendido. */
export function forgetCaptureMemory() {
  write(empty());
}
