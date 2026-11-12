/**
 * Piezas comunes de la escena ambiental de Mi espacio: el contrato que cumple cada variante,
 * el puntero que reciben y utilidades pequeñas (azar con semilla, colores, suavizados).
 */
import type { Signals } from './signals';

/** Lo que recibe cada variante al nacer: datos, accesos, preferencia de movimiento y su memoria. */
export type SceneInit = {
  sig: Signals;
  nav: Nav;
  reduced: boolean;
  /** Estado de esta vuelta de la variante (sobrevive a recargas mientras no cambie). */
  mem: Record<string, unknown>;
  remember: (key: string, value: unknown) => void;
};

/** El puntero en coordenadas de la escena (px CSS), con su velocidad suavizada (px/s). */
export type Pointer = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  inside: boolean;
  down: boolean;
  touch: boolean;
};

/** Un punto que se puede explorar: con el puntero, el dedo o el teclado. */
export type Spot = {
  id: string;
  x: number;
  y: number;
  r: number;
  hint: string;
};

/** Lo que se cuenta al tocar algo: breve, con su contexto y, si aplica, el acceso al original. */
export type Reveal = {
  title: string;
  text: string;
  context?: string;
  /** Solo el lenguaje circular: cómo se lee cada rasgo del símbolo. */
  legend?: string[];
  action?: { label: string; run: () => void };
};

/** Lo que una variante puede abrir de Nexo (viene de `useApp`). */
export type Nav = {
  viewEntry: (id: string) => void;
  /** Sin id, la lista de episodios. */
  episode: (id?: string) => void;
  person: (id: string) => void;
  /** Los pendientes, en Agenda. */
  agenda: () => void;
};

export interface Scene {
  /** Datos nuevos (un recuerdo más, otro ánimo…): la escena evoluciona sin reiniciarse. */
  setData(sig: Signals): void;
  resize(w: number, h: number): void;
  /** `t` es el tiempo de escena en segundos (se detiene mientras no se ve). */
  update(dt: number, t: number, p: Pointer): void;
  draw(g: CanvasRenderingContext2D, t: number): void;
  /** Los puntos navegables con teclado (y, si no hay `hit`, también los que se tocan). */
  spots(): Spot[];
  /** Qué hay bajo el puntero; por defecto, el punto más cercano de `spots`. */
  hit?(x: number, y: number, touch: boolean): Spot | null;
  /** Empieza a arrastrar; devuelve true si la escena se queda con el gesto. */
  grab?(id: string | null, p: Pointer): boolean;
  drag?(p: Pointer, dx: number, dy: number): void;
  release?(p: Pointer): void;
  /** Teclas propias (p. ej. subir o bajar un sonido); true si la usó. */
  key?(key: string, focus: string | null): boolean;
  explain(id: string): Reveal | null;
  /**
   * Se mueve sola todo el tiempo (el universo gira sin parar): el escenario la anima con fluidez
   * aunque se prefiera menos movimiento, en vez de bajar a un cuadro cada 250 ms en reposo.
   */
  live?: boolean;
  /** Punto con foco de teclado (la escena dibuja su anillo) y el que está abierto. */
  focus: string | null;
  selected: string | null;
  hover: string | null;
}

export const INK = '#2f3a28';
export const MOSS = '#6f8a56';
export const SAGE = '#8fa07c';
export const MIST = '#b9c4ab';

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Acercamiento exponencial independiente de los fps: `rate` por segundo. */
export const approach = (a: number, b: number, rate: number, dt: number) =>
  b + (a - b) * Math.exp(-rate * dt);
export const smooth = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
export const TAU = Math.PI * 2;

/** Azar reproducible (mulberry32). */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Ruido suave de una dimensión (valor interpolado), entre -1 y 1. */
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const r = (n: number) => {
    const s = Math.sin((n + seed * 57.3) * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return lerp(r(i), r(i + 1), u);
}

type Rgb = [number, number, number];
const cache = new Map<string, Rgb>();
export function rgbOf(hex: string): Rgb {
  const hit = cache.get(hex);
  if (hit) return hit;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  const rgb: Rgb = Number.isNaN(n) ? [111, 138, 86] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  cache.set(hex, rgb);
  return rgb;
}
/** Mezcla dos colores (`t` = cuánto de `b`) y devuelve un hex. */
export function mix(a: string, b: string, t: number) {
  const x = rgbOf(a);
  const y = rgbOf(b);
  const c = x.map((v, i) => Math.round(lerp(v, y[i], clamp(t))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function rgba(hex: string, alpha: number) {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${clamp(alpha).toFixed(3)})`;
}

/** El punto más cercano dentro de su radio (con margen extra para el dedo). */
export function nearest(spots: Spot[], x: number, y: number, touch: boolean) {
  const pad = touch ? 14 : 6;
  let best: Spot | null = null;
  let bestD = Infinity;
  for (const s of spots) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= s.r + pad && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** Anillo discreto de foco de teclado, igual en todas las variantes. */
export function focusRing(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.save();
  g.strokeStyle = rgba(MOSS, 0.75);
  g.lineWidth = 1.25;
  g.setLineDash([3, 3]);
  g.beginPath();
  g.arc(x, y, r + 5, 0, TAU);
  g.stroke();
  g.restore();
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
