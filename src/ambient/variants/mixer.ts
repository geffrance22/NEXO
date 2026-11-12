import type { Signals } from '../signals';
import type { Layer, Levels } from '../sound';
import {
  INK,
  TAU,
  approach,
  clamp,
  focusRing,
  hashOf,
  mix,
  noise1,
  rgba,
  seeded,
  type Pointer,
  type Reveal,
  type Scene,
  type SceneInit,
  type Spot,
} from '../scene';

/**
 * Mezclador de ambientes.
 *
 * Dato → significado → comportamiento → interacción:
 * - La hora local → el momento del día → la mezcla inicial (más bosque de mañana, más lluvia de
 *   noche…).
 * - El último ánimo que marcaste (máximo 3 días), si lo hay → ajusta esa mezcla (más lluvia para
 *   lo reflexivo, menos viento si marcaste inquietud o cansancio). Sin ánimo, solo cuenta la hora.
 * - El nivel de cada ambiente → su densidad y su movimiento (gotas, hojas, cintas) y su volumen.
 *   El viento además inclina la lluvia y mece el bosque.
 * Arrastrar un elemento (arriba o a la derecha) lo sube; con teclado, flechas arriba y abajo.
 * El sonido solo empieza con el botón de sonido, que también lo silencia; el volumen general
 * tiene su propio control.
 */

export const layers: {
  id: Layer;
  label: string;
  color: string;
  desc: string;
}[] = [
  {
    id: 'lluvia',
    label: 'Lluvia',
    color: '#6d8aa3',
    desc: 'Más lluvia: más gotas y un siseo más denso.',
  },
  {
    id: 'bosque',
    label: 'Bosque',
    color: '#6f8a56',
    desc: 'Más bosque: más hojas en movimiento y algún trino lejano.',
  },
  {
    id: 'viento',
    label: 'Viento',
    color: '#9d967c',
    desc: 'Más viento: cintas más amplias; también inclina la lluvia y mece el bosque.',
  },
];

const PART: Record<Signals['part'], Levels> = {
  madrugada: { lluvia: 0.5, bosque: 0.15, viento: 0.3 },
  mañana: { lluvia: 0.2, bosque: 0.6, viento: 0.3 },
  tarde: { lluvia: 0.25, bosque: 0.42, viento: 0.45 },
  noche: { lluvia: 0.55, bosque: 0.2, viento: 0.3 },
};
const MOOD: Record<string, Partial<Levels>> = {
  alegre: { bosque: 0.15, viento: 0.1 },
  poderoso: { bosque: 0.12, viento: 0.15 },
  inspirado: { bosque: 0.1, viento: 0.15 },
  reflexivo: { lluvia: 0.2, viento: -0.05 },
  nostalgico: { lluvia: 0.2, viento: -0.05 },
  cansado: { lluvia: 0.15, viento: -0.15, bosque: -0.05 },
  triste: { lluvia: 0.15, viento: -0.15 },
  inquieto: { lluvia: 0.15, bosque: 0.1, viento: -0.15 },
  enojado: { lluvia: 0.15, bosque: 0.1, viento: -0.15 },
};

/** La mezcla con la que arranca (solo con lo que hay: hora y ánimo marcado). */
export function initialMix(sig: Signals): Levels {
  const m = sig.mood;
  const adj = (m && MOOD[m.mood.key]) || {};
  const levels = { ...PART[sig.part] };
  for (const k of Object.keys(levels) as Layer[]) levels[k] = clamp(levels[k] + (adj[k] ?? 0));
  return levels;
}

type Drop = { x: number; y: number; vx: number; vy: number; end: number };
type Ring = { x: number; y: number; r: number; a: number };
type Spore = { x: number; y: number; ph: number };
type El = {
  id: Layer;
  label: string;
  color: string;
  x: number;
  y: number;
  R: number;
  shown: number;
};

const isLevels = (v: unknown): v is Levels =>
  !!v && typeof v === 'object' && layers.every((l) => typeof (v as Levels)[l.id] === 'number');

export class Mixer implements Scene {
  focus: string | null = null;
  selected: string | null = null;
  hover: string | null = null;
  levels: Levels;
  sound = false;
  onChange: ((l: Levels) => void) | null = null;
  private touched: boolean;
  private els: El[];
  private drops: Drop[] = [];
  private rings: Ring[] = [];
  private spores: Spore[] = [];
  private grabbed: El | null = null;
  private spawn = 0;
  private reduced: boolean;
  private remember: SceneInit['remember'];
  private rand = seeded(7);

  constructor({ sig, reduced, mem, remember }: SceneInit) {
    this.touched = isLevels(mem.levels);
    this.levels = isLevels(mem.levels) ? { ...mem.levels } : initialMix(sig);
    this.reduced = reduced;
    this.remember = remember;
    this.els = layers.map((l) => ({
      ...l,
      x: 0,
      y: 0,
      R: 30,
      shown: this.levels[l.id],
    }));
  }

  /** La mezcla solo se adapta sola mientras no la hayas tocado. */
  setData(sig: Signals) {
    if (!this.touched) {
      this.levels = initialMix(sig);
      this.onChange?.(this.levels);
    }
  }

  resize(w: number, h: number) {
    const R = Math.max(18, Math.min(w * 0.12, h * 0.28, 54));
    const xs = [0.24, 0.51, 0.78];
    this.els.forEach((e, i) => {
      e.x = w * xs[i];
      e.y = h * 0.44;
      e.R = R;
    });
  }

  private el(id: Layer) {
    return this.els.find((e) => e.id === id)!;
  }

  private set(id: Layer, v: number) {
    this.levels = { ...this.levels, [id]: clamp(v) };
    this.touched = true;
    this.onChange?.(this.levels);
  }

  update(dt: number, _t: number, p: Pointer) {
    this.pointerCache = p;
    for (const e of this.els) e.shown = approach(e.shown, this.levels[e.id], 4, dt);
    if (this.reduced) return;
    const rain = this.el('lluvia');
    const wind = this.el('viento').shown;

    // Gotas: nacen según la intensidad, se inclinan con el viento y se apartan del puntero.
    this.spawn += dt * 28 * rain.shown;
    while (this.spawn >= 1 && this.drops.length < 40) {
      this.spawn--;
      const R = rain.R;
      this.drops.push({
        x: rain.x + (this.rand() - 0.5) * R * 1.1,
        y: rain.y - R * (0.7 + this.rand() * 0.2),
        vx: wind * 30,
        vy: 70 + 80 * rain.shown,
        end: rain.y + R * (0.4 + this.rand() * 0.35),
      });
    }
    if (this.spawn > 1) this.spawn = 1;
    for (const d of this.drops) {
      if (p.inside) {
        const dx = d.x - p.x;
        const dy = d.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 30) d.vx += (dx / (dist || 1)) * 260 * dt * (1 - dist / 30);
      }
      d.vx = approach(d.vx, wind * 30, 2, dt);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y >= d.end) {
        if (this.rings.length < 14) this.rings.push({ x: d.x, y: d.end, r: 0.5, a: 1 });
        d.y = Infinity;
      }
    }
    this.drops = this.drops.filter((d) => d.y !== Infinity);
    for (const r of this.rings) {
      r.r += dt * 9;
      r.a -= dt * 1.6;
    }
    this.rings = this.rings.filter((r) => r.a > 0);

    // Esporas del bosque, subiendo despacio.
    const forest = this.el('bosque');
    const want = Math.round(10 * forest.shown);
    while (this.spores.length < want)
      this.spores.push({
        x: forest.x + (this.rand() - 0.5) * forest.R * 1.3,
        y: forest.y + forest.R * (0.2 + this.rand() * 0.5),
        ph: this.rand() * TAU,
      });
    if (this.spores.length > want) this.spores.length = want;
    for (const s of this.spores) {
      s.y -= dt * (5 + 6 * forest.shown);
      s.x += Math.sin(s.ph + s.y * 0.05) * dt * (3 + wind * 10);
      if (s.y < forest.y - forest.R * 0.9) {
        s.y = forest.y + forest.R * 0.65;
        s.x = forest.x + (this.rand() - 0.5) * forest.R * 1.3;
      }
    }
  }

  draw(g: CanvasRenderingContext2D, t: number) {
    const lit = this.selected ?? this.hover ?? this.grabbed?.id ?? null;
    const wind = this.el('viento').shown;
    const p = this.pointerCache;
    g.lineCap = 'round';
    for (const e of this.els) {
      const on = lit === e.id || this.focus === e.id;
      const v = e.shown;
      const { x, y, R } = e;
      const tt = this.reduced ? 0 : t;

      // Medidor: un arco discreto alrededor (la única «cifra», sin texto).
      g.strokeStyle = rgba(INK, on ? 0.08 : 0.035);
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, R + 10, 0, TAU);
      g.stroke();
      g.strokeStyle = rgba(e.color, on ? 0.55 : 0.2);
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(x, y, R + 10, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, v) * TAU);
      g.stroke();
      if (on) {
        const a = -Math.PI / 2 + v * TAU;
        g.fillStyle = rgba(e.color, 0.8);
        g.beginPath();
        g.arc(x + Math.cos(a) * (R + 10), y + Math.sin(a) * (R + 10), 2.6, 0, TAU);
        g.fill();
      }

      if (e.id === 'lluvia') {
        if (this.reduced) {
          const r = seeded(11);
          const n = Math.round(4 + 10 * v);
          for (let i = 0; i < n; i++) {
            const dx = (r() - 0.5) * R * 1.1;
            const dy = (r() - 0.5) * R * 1.2;
            g.strokeStyle = rgba(e.color, 0.2 + 0.35 * v);
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(x + dx, y + dy);
            g.lineTo(x + dx - wind * 2, y + dy - 6);
            g.stroke();
          }
        }
        for (const d of this.drops) {
          const fade = 1 - Math.min(1, Math.hypot(d.x - x, d.y - y) / (R * 1.05)) ** 2;
          g.strokeStyle = rgba(e.color, (0.18 + 0.42 * v) * Math.max(0, fade));
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(d.x, d.y);
          g.lineTo(d.x - d.vx * 0.05, d.y - (5 + 5 * v));
          g.stroke();
        }
        for (const r of this.rings) {
          g.strokeStyle = rgba(e.color, 0.22 * r.a);
          g.lineWidth = 0.8;
          g.beginPath();
          g.ellipse(r.x, r.y, r.r, r.r * 0.35, 0, 0, TAU);
          g.stroke();
        }
      } else if (e.id === 'bosque') {
        const base = y + R * 0.72;
        for (let i = 0; i < 7; i++) {
          const s = (hashOf('b' + i) % 100) / 100;
          const rx = x + (i - 3) * R * 0.21;
          const hgt = R * (0.55 + 0.6 * v) * (0.7 + 0.35 * s);
          let a =
            (0.05 + wind * 0.22) * Math.sin(tt * (0.6 + 0.5 * s) + i * 1.3) +
            noise1(tt * 0.3 + i, 2) * 0.04;
          if (p.inside) {
            const dx = rx - p.x;
            const dy = base - hgt / 2 - p.y;
            const d = Math.hypot(dx, dy);
            if (d < R * 1.4) a += (dx / (R * 1.4)) * 0.5 * (1 - d / (R * 1.4));
          }
          const tx = rx + Math.sin(a) * hgt;
          const ty = base - Math.cos(a) * hgt;
          g.strokeStyle = rgba(e.color, 0.22 + 0.45 * v);
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(rx, base);
          g.quadraticCurveTo(rx + Math.sin(a * 0.4) * hgt * 0.5, base - hgt * 0.55, tx, ty);
          g.stroke();
          g.fillStyle = rgba(mix(e.color, '#ffffff', 0.1), 0.25 + 0.4 * v);
          g.beginPath();
          g.ellipse(tx, ty, 1.6 + 1.6 * v, 3 + 2 * v, a, 0, TAU);
          g.fill();
        }
        for (const sp of this.spores) {
          g.fillStyle = rgba(e.color, 0.3);
          g.beginPath();
          g.arc(sp.x, sp.y, 1.1, 0, TAU);
          g.fill();
        }
      } else {
        const speed = 0.6 + 1.6 * v;
        const amp = 1.5 + 6 * v;
        for (let k = 0; k < 5; k++) {
          const yk = y + (k - 2) * R * 0.27;
          let px = 0;
          let py = 0;
          for (let i = 0; i <= 24; i++) {
            const s = i / 24;
            const xx = x - R * 1.05 + s * R * 2.1;
            let yy = yk + Math.sin(xx * 0.045 + tt * speed + k * 1.7) * amp * Math.sin(Math.PI * s);
            if (p.inside) {
              const d = Math.hypot(xx - p.x, yy - p.y);
              if (d < 46) yy += Math.sign(yy - p.y || 1) * (1 - d / 46) * 9;
            }
            if (i) {
              g.strokeStyle = rgba(e.color, (0.08 + 0.42 * v) * Math.sin(Math.PI * s));
              g.lineWidth = 1.1;
              g.beginPath();
              g.moveTo(px, py);
              g.lineTo(xx, yy);
              g.stroke();
            }
            px = xx;
            py = yy;
          }
        }
      }
      if (this.focus === e.id) focusRing(g, x, y, R + 12);
    }
  }

  /** El dibujo necesita el puntero para doblar hojas y cintas (se guarda en `update`). */
  private pointerCache: Pointer = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    inside: false,
    down: false,
    touch: false,
  };

  spots(): Spot[] {
    return this.els.map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      r: e.R + 8,
      hint: `${e.label} · ${Math.round(this.levels[e.id] * 100)} %`,
    }));
  }

  grab(id: string | null) {
    const e = this.els.find((x) => x.id === id);
    if (!e) return false;
    this.grabbed = e;
    return true;
  }

  drag(_p: Pointer, dx: number, dy: number) {
    if (this.grabbed) this.set(this.grabbed.id, this.levels[this.grabbed.id] + (dx - dy) / 140);
  }

  release() {
    if (this.grabbed) this.remember('levels', this.levels);
    this.grabbed = null;
  }

  key(key: string, focus: string | null) {
    const e = this.els.find((x) => x.id === focus);
    if (!e) return false;
    const step =
      key === 'ArrowUp' || key === 'PageUp'
        ? 0.1
        : key === 'ArrowDown' || key === 'PageDown'
          ? -0.1
          : 0;
    if (!step) return false;
    this.set(e.id, Math.round((this.levels[e.id] + step) * 10) / 10);
    this.remember('levels', this.levels);
    return true;
  }

  /** Tocar un ambiente no abre ninguna explicación: se ajusta arrastrándolo (la pista dice su nivel). */
  explain(): Reveal | null {
    return null;
  }
}
