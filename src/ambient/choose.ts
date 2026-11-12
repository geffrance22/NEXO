import type { Signals } from './signals';

/** Las cinco variantes de la escena ambiental; solo se muestra una a la vez. */
export type Variant = 'universo' | 'planta' | 'mezclador' | 'peces' | 'glifo';
export const variants: Variant[] = ['universo', 'planta', 'mezclador', 'peces', 'glifo'];

/** Tiempo mínimo que se queda una variante (también tras recargar o volver a Mi espacio). */
export const MIN_STAY = 10 * 60_000;

/**
 * Lo que se guarda en este navegador: la variante, desde cuándo se ve, las últimas que salieron
 * (para no repetir) y el estado propio de esta vuelta (la mezcla de sonidos, la forma de la
 * planta, el mensaje en curso…). Al cambiar de variante, `mem` empieza de cero.
 */
export type Pick = {
  v: Variant;
  since: number;
  hist: Variant[];
  mem: Record<string, unknown>;
};

const keyOf = (uid: string) => 'nexo-ambient:' + uid;

export function readPick(uid: string): Pick | null {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(uid)) ?? 'null') as Partial<Pick> | null;
    if (!raw || !variants.includes(raw.v as Variant) || typeof raw.since !== 'number') return null;
    return {
      v: raw.v as Variant,
      since: raw.since,
      hist: Array.isArray(raw.hist) ? raw.hist.filter((v) => variants.includes(v)).slice(0, 4) : [],
      mem: raw.mem && typeof raw.mem === 'object' ? raw.mem : {},
    };
  } catch {
    return null;
  }
}

export function savePick(uid: string, pick: Pick) {
  try {
    localStorage.setItem(keyOf(uid), JSON.stringify(pick));
  } catch {
    /* sin almacenamiento */
  }
}

/** Cuánto encaja cada variante con lo que hay en tus datos y el momento del día. */
export function weightsOf(s: Signals): Record<Variant, number> {
  const marked = s.week.filter((d) => d.mark).length;
  const late = s.part === 'noche' || s.part === 'madrugada';
  return {
    universo: 0.8 + Math.min(2, s.bodies.length / 3),
    planta: 0.8 + (s.mood ? 1.2 : 0) + marked / 7,
    mezclador: 0.9 + (late ? 0.8 : 0.3),
    peces: 0.8 + Math.min(1.6, s.open.total / 5) + s.rhythm.level * 0.6,
    glifo: 1 + (s.ws.entries.length ? 0.8 : 0) + (marked || s.bodies.length ? 0.4 : 0),
  };
}

/** Azar ponderado que castiga la variante actual y las recientes, para no repetir siempre. */
export function choose(s: Signals, prev: Pick | null, rand = Math.random): Variant {
  const w = weightsOf(s);
  const recent = prev ? [prev.v, ...prev.hist] : [];
  const scored = variants.map((v) => {
    const at = recent.indexOf(v);
    const penalty = at === 0 ? 0.08 : at === 1 ? 0.45 : at === 2 ? 0.75 : 1;
    return [v, w[v] * penalty] as const;
  });
  const sum = scored.reduce((a, [, x]) => a + x, 0);
  let r = rand() * sum;
  for (const [v, x] of scored) {
    r -= x;
    if (r <= 0) return v;
  }
  return scored[scored.length - 1][0];
}

export function nextPick(s: Signals, prev: Pick | null, now = Date.now()): Pick {
  const v = choose(s, prev);
  const hist = prev
    ? [prev.v, ...prev.hist].filter((x, i, a) => a.indexOf(x) === i).slice(0, 4)
    : [];
  return { v, since: now, hist, mem: {} };
}
