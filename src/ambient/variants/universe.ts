import { isMedia, thumbOf, type Body, type Signals } from '../signals';
import {
  INK,
  MIST,
  MOSS,
  TAU,
  approach,
  clamp,
  focusRing,
  hashOf,
  lerp,
  mix,
  nearest,
  noise1,
  plural,
  rgba,
  seeded,
  type Nav,
  type Pointer,
  type Reveal,
  type Scene,
  type SceneInit,
  type Spot,
} from '../scene';

/**
 * Pequeño universo.
 *
 * Dato → significado → comportamiento → interacción:
 * - Episodios activos y personas presentes en tus recuerdos de los últimos 60 días → lo que
 *   gravita en tu vida ahora → planetas alrededor de un centro (tú, con tu foto).
 * - Cada planeta es su foto (la de la persona o la portada del episodio) o, si no hay, sus
 *   iniciales sobre su color. Los episodios llevan anillos; sus personas, lunas diminutas.
 * - Días desde su último movimiento → cercanía → radio de la órbita (más reciente, más cerca).
 * - Movimiento en las últimas dos semanas → actividad → velocidad de giro.
 * - Recuerdos y novedades que reúne → peso → tamaño.
 * - Personas compartidas o episodios enlazados → relación → un hilo tenue con una luz que viaja.
 * El sistema gira siempre. Detrás hay solo decoración (estrellas, polvo, nebulosas y alguna
 * estrella fugaz): no se toca ni explica nada. El puntero curva las trayectorias; arrastrar un
 * planeta lo impulsa (y al soltarlo gira más rápido un rato); arrastrar el vacío acelera el giro
 * de todo el sistema. Tocar revela qué es y abre el episodio o la ficha de la persona.
 */

const TILT = 0.4;
const GOLD = '#d9b56a';
/** Los tonos de las estrellas: casi todas tinta; algunas lavanda, azul, oro o musgo. */
const STAR_TINTS = [INK, INK, INK, INK, '#8a7aa0', '#6d8aa3', '#c4a052', MOSS];
/** Nebulosas por defecto (sin colores propios todavía). */
const NEBULA = ['#8a7aa0', '#6d8aa3', '#c4a052'];
const NEBULA_AT = [
  { x: 0.26, y: 0.34 },
  { x: 0.8, y: 0.64 },
  { x: 0.56, y: 0.16 },
];
const LAYER_DEPTH = [0.25, 0.55, 1];

// ── Fotos: se cargan una vez y se dibujan recortadas en círculo ──

type Pic = { img: HTMLImageElement; ok: boolean; at: number };
const pics = new Map<string, Pic>();

function picOf(url: string | undefined): Pic | null {
  if (!url) return null;
  let pic = pics.get(url);
  if (!pic) {
    const img = new Image();
    img.decoding = 'async';
    const entry: Pic = { img, ok: false, at: 0 };
    img.onload = () => {
      entry.ok = img.naturalWidth > 0;
      entry.at = performance.now();
    };
    img.src = url;
    pic = entry;
    pics.set(url, pic);
    // Un tope para no acumular fotos de personas que ya no orbitan.
    if (pics.size > 80) pics.delete(pics.keys().next().value!);
  }
  return pic;
}

/** La foto, centrada y recortada al cuadrado, ocupando el círculo (ya recortado por el clip). */
function drawCover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, r: number) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const s = Math.min(iw, ih);
  // En los retratos, un poco hacia arriba: ahí suele estar la cara.
  const sx = (iw - s) / 2;
  const sy = (ih - s) * (ih > iw ? 0.3 : 0.5);
  g.drawImage(img, sx, sy, s, s, x - r, y - r, r * 2, r * 2);
}

type Moon = { id: string; a: number; v: number; image?: string; color: string };

type Planet = {
  b: Body;
  calm: boolean;
  angle: number;
  spin: number;
  R: number;
  Rt: number;
  size: number;
  sizeT: number;
  /** Cada órbita, un poco distinta: inclinación y giro propios. */
  tilt: number;
  rot: number;
  /** Inclinación de los anillos de los episodios. */
  ringTilt: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  alpha: number;
  gone: boolean;
  x: number;
  y: number;
  /** -1 al fondo, 1 al frente. */
  depth: number;
  /** Radio dibujado (con la profundidad y el realce al pasar el puntero). */
  r: number;
  lift: number;
  moons: Moon[];
};

type Star = {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
  ph: number;
  layer: number;
  tint: string;
  sparkle: boolean;
};
type Mote = { f: number; a: number; v: number; size: number; alpha: number };
type Meteor = { x: number; y: number; vx: number; vy: number; life: number; age: number };

const calmBodies: Body[] = [5, 16, 34].map((ago, i) => ({
  id: 'calm:' + i,
  type: 'episode',
  ref: '',
  title: 'Órbita libre',
  color: MIST,
  weight: 1,
  ago,
  recent: 0,
  moons: [],
  people: 0,
  ties: [],
  mark: '',
}));

export class Universe implements Scene {
  focus: string | null = null;
  selected: string | null = null;
  hover: string | null = null;
  /** Gira siempre, también si se prefiere menos movimiento (entonces más despacio). */
  live = true;
  private planets: Planet[] = [];
  private w = 0;
  private h = 0;
  private cx = 0;
  private cy = 0;
  private unit = 12;
  private sunR = 14;
  private rMin = 20;
  private rMax = 100;
  private sys = 0;
  private grabbed: Planet | 'system' | null = null;
  private stars: Star[] = [];
  private motes: Mote[] = [];
  private meteors: Meteor[] = [];
  private nextMeteor = 4;
  private par = { x: 0, y: 0 };
  private nebula = NEBULA;
  private sig: Signals;
  private nav: Nav;
  private reduced: boolean;

  constructor({ sig, nav, reduced }: SceneInit) {
    this.sig = sig;
    this.nav = nav;
    this.reduced = reduced;
    const rand = seeded(0x5eed);
    for (let i = 0; i < 170; i++) {
      const layer = rand() < 0.45 ? 0 : rand() < 0.7 ? 1 : 2;
      const sparkle = rand() < 0.07;
      this.stars.push({
        x: rand(),
        y: rand(),
        r: sparkle ? 2.2 + rand() * 1.8 : 0.35 + 0.3 * layer + rand() * 0.4,
        a: (sparkle ? 0.2 : 0.1) + 0.1 * layer + rand() * 0.14,
        tw: 0.4 + rand() * 1.4,
        ph: rand() * TAU,
        layer,
        tint: STAR_TINTS[Math.floor(rand() * STAR_TINTS.length)],
        sparkle,
      });
    }
    for (let i = 0; i < 44; i++)
      this.motes.push({
        f: rand(),
        a: rand() * TAU,
        v: 0.05 + rand() * 0.12,
        size: 0.5 + rand() * 0.8,
        alpha: 0.08 + rand() * 0.16,
      });
    this.setData(sig);
  }

  setData(sig: Signals) {
    this.sig = sig;
    const bodies = sig.bodies.length ? sig.bodies : calmBodies;
    const ids = new Set(bodies.map((b) => b.id));
    for (const p of this.planets) if (!ids.has(p.b.id)) p.gone = true;
    for (const b of bodies) {
      const p = this.planets.find((x) => x.b.id === b.id);
      if (p) {
        p.b = b;
        p.gone = false;
        continue;
      }
      const seed = hashOf(b.id);
      const rnd = seeded(seed);
      this.planets.push({
        b,
        calm: b.id.startsWith('calm:'),
        angle: rnd() * TAU,
        spin: 0,
        R: 0,
        Rt: 0,
        size: 0,
        sizeT: 0,
        tilt: TILT + (rnd() - 0.5) * 0.08,
        rot: (rnd() - 0.5) * 0.16,
        ringTilt: (rnd() - 0.5) * 0.7,
        ox: 0,
        oy: 0,
        vx: 0,
        vy: 0,
        alpha: 0,
        gone: false,
        x: 0,
        y: 0,
        depth: 0,
        r: 0,
        lift: 0,
        moons: [],
      });
    }
    // Las lunas: las personas del episodio que no orbitan solas (con su foto, si la tienen).
    const people = new Map(sig.ws.people.map((x) => [x.id, x]));
    for (const p of this.planets) {
      const prev = new Map(p.moons.map((m) => [m.id, m]));
      p.moons = p.b.moons.slice(0, 3).map((id, i) => {
        const who = people.get(id);
        const old = prev.get(id);
        return {
          id,
          a: old?.a ?? ((hashOf(p.b.id + id) % 1000) / 1000) * TAU,
          v: 0.55 + i * 0.22,
          image: thumbOf(who?.profile.photo),
          color: who?.color || MIST,
        };
      });
    }
    // Las nebulosas toman los colores de lo que orbita (sin datos, unos neutros).
    const own = [...new Set(sig.bodies.map((b) => b.color))].slice(0, 3);
    this.nebula = NEBULA.map((c, i) => (own[i] ? mix(own[i], '#ffffff', 0.2) : c));
    this.layout();
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cx = w * 0.54;
    this.cy = h * 0.52;
    this.unit = clamp(Math.min(w, h * 2.4) / 34, 7, 14);
    this.sunR = this.unit * 1.2;
    const pad = this.unit * 1.4;
    // A lo ancho, las órbitas no entran en el degradado de los lados (el centro no está al medio).
    const side = Math.min(this.cx, w - this.cx) - w * 0.08;
    this.rMax = Math.max(40, Math.min(side - pad, (h * 0.5 - pad) / TILT));
    this.rMin = Math.min(this.rMax * 0.5, this.sunR + this.unit * 1.9);
    this.layout();
    for (const p of this.planets) {
      if (!p.R) p.R = p.Rt;
      if (!p.size) p.size = p.sizeT;
    }
  }

  /** Radio por cercanía en el tiempo (sin que dos órbitas se pisen) y tamaño por peso. */
  private layout() {
    if (!this.w) return;
    const live = this.planets.filter((p) => !p.gone);
    // Libros y series no se comparan en peso con episodios y personas: tienen un tamaño medio.
    const maxW = Math.max(1, ...live.filter((p) => !isMedia(p.b)).map((p) => p.b.weight));
    const sorted = [...live].sort((a, b) => a.b.ago - b.b.ago || b.b.weight - a.b.weight);
    const span = this.rMax - this.rMin;
    const gap = Math.min(this.unit * 2.2, span / (sorted.length + 0.5));
    let prev = this.rMin - gap;
    for (const p of sorted) {
      const f = clamp(Math.log1p(p.b.ago) / Math.log1p(45));
      const r = Math.max(this.rMin + f * span, prev + gap);
      p.Rt = Math.min(this.rMax, r);
      prev = p.Rt;
      const share = isMedia(p.b) ? 0.45 : Math.sqrt(Math.min(1, p.b.weight / maxW));
      p.sizeT = p.calm ? this.unit * 0.55 : this.unit * (0.72 + 0.48 * share);
    }
  }

  /** Siempre gira: más rápido lo que tuvo movimiento y lo que está más cerca del centro. */
  private omega(p: Planet) {
    const lively = clamp(p.b.recent / 6);
    const w = (0.1 + 0.2 * lively) * Math.sqrt((this.rMin * 2) / Math.max(this.rMin, p.R));
    return this.reduced ? w * 0.45 : w;
  }

  /** Posición sobre su órbita (inclinada y girada a su manera). */
  private onOrbit(p: Planet, angle: number) {
    const ex = Math.cos(angle) * p.R;
    const ey = Math.sin(angle) * p.R * p.tilt;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    return { x: this.cx + ex * c - ey * s, y: this.cy + ex * s + ey * c };
  }

  update(dt: number, _t: number, ptr: Pointer) {
    const speed = this.reduced ? 0.45 : 1;
    const damp = this.reduced ? 6 : 2.6;
    const lit = this.selected ?? this.hover;
    this.sys = approach(this.sys, 0, 0.45, dt);

    // Paralaje: el cielo se corre apenas hacia el lado contrario del puntero.
    const px = ptr.inside ? (ptr.x - this.cx) / Math.max(1, this.w) : 0;
    const py = ptr.inside ? (ptr.y - this.cy) / Math.max(1, this.h) : 0;
    this.par.x = approach(this.par.x, px, 1.6, dt);
    this.par.y = approach(this.par.y, py, 1.6, dt);

    if (!this.reduced)
      for (const s of this.stars) s.x = (s.x + dt * (0.0015 + 0.004 * s.layer)) % 1;
    for (const m of this.motes) m.a = (m.a + m.v * speed * dt) % TAU;

    // Alguna estrella fugaz, muy de vez en cuando.
    if (!this.reduced && this.w) {
      this.nextMeteor -= dt;
      if (this.nextMeteor <= 0) {
        this.nextMeteor = 8 + Math.random() * 14;
        const dir = Math.random() < 0.5 ? -1 : 1;
        const ang = 0.32 + Math.random() * 0.3;
        const v = 230 + Math.random() * 120;
        // Nacen hacia el centro del cielo: en los bordes ya se disuelve.
        this.meteors.push({
          x: this.w * (dir > 0 ? 0.18 + Math.random() * 0.4 : 0.42 + Math.random() * 0.4),
          y: this.h * (0.12 + Math.random() * 0.26),
          vx: Math.cos(ang) * v * dir,
          vy: Math.sin(ang) * v,
          life: 0.8 + Math.random() * 0.4,
          age: 0,
        });
      }
      for (const m of this.meteors) {
        m.age += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
      }
      this.meteors = this.meteors.filter((m) => m.age < m.life);
    }

    const reach = this.unit * 7;
    for (const p of this.planets) {
      p.alpha = approach(p.alpha, p.gone ? 0 : 1, 1.6, dt);
      p.R = approach(p.R, p.Rt, 0.8, dt);
      p.size = approach(p.size, p.sizeT, 1.2, dt);
      p.spin = approach(p.spin, 0, 0.35, dt);
      p.angle = (p.angle + (this.omega(p) + p.spin + this.sys) * dt) % TAU;
      const { x: bx, y: by } = this.onOrbit(p, p.angle);

      if (this.grabbed === p) {
        p.ox = approach(p.ox, ptr.x - bx, 16, dt);
        p.oy = approach(p.oy, ptr.y - by, 16, dt);
        p.vx = 0;
        p.vy = 0;
      } else {
        let ax = -3.2 * p.ox - damp * p.vx;
        let ay = -3.2 * p.oy - damp * p.vy;
        if (ptr.inside && !this.grabbed) {
          const dx = ptr.x - (bx + p.ox);
          const dy = ptr.y - (by + p.oy);
          const d = Math.hypot(dx, dy) || 1;
          if (d < reach) {
            const f = (1 - d / reach) ** 2;
            // Un pozo de gravedad suave más la corriente del propio movimiento del puntero.
            ax += (dx / d) * f * 46 + ptr.vx * f * 0.9;
            ay += (dy / d) * f * 46 + ptr.vy * f * 0.9;
          }
        }
        p.vx += ax * dt;
        p.vy += ay * dt;
        p.ox += p.vx * dt;
        p.oy += p.vy * dt;
        const lim = 46;
        p.ox = clamp(p.ox, -lim, lim);
        p.oy = clamp(p.oy, -lim * 0.8, lim * 0.8);
      }
      p.depth = Math.sin(p.angle);
      p.lift = approach(p.lift, lit === p.b.id ? 1 : 0, 9, dt);
      // Al fondo, más pequeño; al frente, un poco más grande.
      p.r = p.size * lerp(0.74, 1.06, (p.depth + 1) / 2) * (1 + 0.14 * p.lift);
      const pad = p.r + 2;
      p.x = clamp(bx + p.ox, pad, Math.max(pad, this.w - pad));
      p.y = clamp(by + p.oy, pad, Math.max(pad, this.h - pad));
      for (const m of p.moons) m.a = (m.a + m.v * speed * dt) % TAU;
    }
    this.planets = this.planets.filter((p) => !(p.gone && p.alpha < 0.01));
  }

  draw(g: CanvasRenderingContext2D, t: number) {
    const tt = this.reduced ? 0 : t;
    const lit = this.selected ?? this.hover;
    // En modo oscuro la página entera se invierte: las fotos se dibujan ya invertidas para que,
    // tras el filtro de la página, se vean con sus colores (como las <img>).
    const dark = document.documentElement.dataset.theme === 'dark';
    g.lineCap = 'round';

    this.drawSky(g, tt);
    this.drawStars(g, tt);
    this.drawMeteors(g);
    this.fadeSky(g);
    for (const p of this.planets) this.drawOrbit(g, p, lit, 'back');
    this.drawMotes(g, 'back');
    this.drawTies(g, lit, tt);
    const order = [...this.planets].sort((a, b) => a.depth - b.depth);
    for (const p of order) if (p.depth < 0) this.drawPlanet(g, p, lit, dark, tt);
    this.drawSun(g, lit, dark, tt);
    for (const p of this.planets) this.drawOrbit(g, p, lit, 'front');
    this.drawMotes(g, 'front');
    for (const p of order) if (p.depth >= 0) this.drawPlanet(g, p, lit, dark, tt);
  }

  // ── Decoración (no se toca) ──

  /**
   * Disuelve el cielo (banda, nebulosas, estrellas y estrellas fugaces) en un óvalo que llega a
   * cero antes de los bordes del lienzo: así no se nota el recuadro. Se aplica justo después de
   * dibujarlo, de modo que solo afecta a la decoración y no a lo que se explora.
   */
  private fadeSky(g: CanvasRenderingContext2D) {
    const { w, h, cx, cy } = this;
    if (!w || !h) return;
    const rx = Math.max(1, Math.min(cx, w - cx));
    const ry = Math.max(1, Math.min(cy, h - cy));
    const k = ry / rx;
    g.save();
    g.globalCompositeOperation = 'destination-in';
    g.translate(cx, cy);
    g.scale(1, k);
    // Caída suave (casi una curva), sin escalones que dibujen un contorno.
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(0.4, 'rgba(0,0,0,1)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0.88)');
    gr.addColorStop(0.7, 'rgba(0,0,0,0.6)');
    gr.addColorStop(0.84, 'rgba(0,0,0,0.26)');
    gr.addColorStop(0.94, 'rgba(0,0,0,0.06)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    // Todo el lienzo: fuera del óvalo, el cielo queda transparente.
    g.fillRect(-cx, -cy / k, w, h / k);
    g.restore();
  }

  /** Una banda de luz sobre el plano del sistema y nebulosas muy suaves que respiran. */
  private drawSky(g: CanvasRenderingContext2D, tt: number) {
    const { w, h, cx, cy } = this;
    g.save();
    g.translate(cx, cy);
    g.rotate(-0.1);
    g.scale(1, 0.3);
    const R = this.rMax * 1.45;
    const band = g.createRadialGradient(0, 0, 0, 0, 0, R);
    band.addColorStop(0, rgba(MIST, 0.17));
    band.addColorStop(0.5, rgba(MIST, 0.06));
    band.addColorStop(1, rgba(MIST, 0));
    g.fillStyle = band;
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.fill();
    g.restore();

    this.nebula.forEach((c, i) => {
      const at = NEBULA_AT[i];
      const bx = w * (at.x + noise1(tt * 0.04 + i * 7, i + 1) * 0.05);
      const by = h * (at.y + noise1(tt * 0.035 + i * 3, i + 4) * 0.06);
      const br = Math.max(w, h) * (0.3 + 0.04 * Math.sin(tt * 0.12 + i * 2));
      const gr = g.createRadialGradient(bx, by, 0, bx, by, br);
      gr.addColorStop(0, rgba(c, 0.085));
      gr.addColorStop(0.6, rgba(c, 0.03));
      gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr;
      g.fillRect(bx - br, by - br, br * 2, br * 2);
    });
  }

  /** Estrellas en tres capas de profundidad: titilan, derivan despacio y se corren con el puntero. */
  private drawStars(g: CanvasRenderingContext2D, tt: number) {
    const { w, h } = this;
    const n = Math.min(this.stars.length, Math.max(36, Math.round((w * h) / 650)));
    for (let i = 0; i < n; i++) {
      const s = this.stars[i];
      const d = LAYER_DEPTH[s.layer];
      const x = (((s.x * w - this.par.x * 16 * d) % w) + w) % w;
      const y = s.y * h - this.par.y * 10 * d;
      const al = s.a * (this.reduced ? 0.85 : 0.55 + 0.45 * Math.sin(tt * s.tw + s.ph));
      if (s.sparkle) {
        // Un destello de cuatro puntas, con un halo diminuto.
        const L = s.r * (0.9 + 0.2 * Math.sin(tt * s.tw * 0.7 + s.ph));
        g.strokeStyle = rgba(s.tint, al);
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(x - L, y);
        g.lineTo(x + L, y);
        g.moveTo(x, y - L);
        g.lineTo(x, y + L);
        g.stroke();
        g.fillStyle = rgba(s.tint, al * 0.35);
        g.beginPath();
        g.arc(x, y, L * 0.45, 0, TAU);
        g.fill();
      } else {
        g.fillStyle = rgba(s.tint, al);
        g.beginPath();
        g.arc(x, y, s.r, 0, TAU);
        g.fill();
      }
    }
  }

  private drawMeteors(g: CanvasRenderingContext2D) {
    for (const m of this.meteors) {
      const fade = Math.sin(Math.PI * (m.age / m.life));
      const v = Math.hypot(m.vx, m.vy) || 1;
      const len = 46 + 20 * fade;
      const tx = m.x - (m.vx / v) * len;
      const ty = m.y - (m.vy / v) * len;
      const gr = g.createLinearGradient(m.x, m.y, tx, ty);
      gr.addColorStop(0, rgba(INK, 0.32 * fade));
      gr.addColorStop(1, rgba(INK, 0));
      g.strokeStyle = gr;
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(m.x, m.y);
      g.lineTo(tx, ty);
      g.stroke();
    }
  }

  /** Polvo que orbita en el plano del sistema (la mitad de atrás pasa detrás del centro). */
  private drawMotes(g: CanvasRenderingContext2D, half: 'back' | 'front') {
    const col = mix(MIST, INK, 0.35);
    for (const m of this.motes) {
      const front = Math.sin(m.a) >= 0;
      if ((half === 'front') !== front) continue;
      const R = lerp(this.rMin * 0.75, this.rMax * 1.06, m.f);
      g.fillStyle = rgba(col, m.alpha * (front ? 1 : 0.5));
      g.beginPath();
      g.arc(
        this.cx + Math.cos(m.a) * R,
        this.cy + Math.sin(m.a) * R * TILT,
        m.size * (front ? 1 : 0.8),
        0,
        TAU,
      );
      g.fill();
    }
  }

  // ── Lo que se explora ──

  /** Media órbita: la de atrás, más tenue y detrás del centro; la de adelante, por encima. */
  private drawOrbit(g: CanvasRenderingContext2D, p: Planet, lit: string | null, half: 'back' | 'front') {
    const on = lit === p.b.id;
    const back = half === 'back';
    g.strokeStyle = rgba(INK, (on ? 0.16 : back ? 0.035 : 0.065) * p.alpha);
    g.lineWidth = on ? 1.1 : 0.8;
    if (p.calm) g.setLineDash([2, 4]);
    g.beginPath();
    g.ellipse(this.cx, this.cy, p.R, p.R * p.tilt, p.rot, back ? Math.PI : 0, back ? TAU : Math.PI);
    g.stroke();
    if (p.calm) g.setLineDash([]);
  }

  /** Hilos curvos entre lo que comparte personas, con una luz que los recorre. */
  private drawTies(g: CanvasRenderingContext2D, lit: string | null, tt: number) {
    const live = this.planets;
    const drawn = new Set<string>();
    for (const p of live)
      for (const id of p.b.ties) {
        const q = live.find((x) => x.b.id === id);
        if (!q) continue;
        const k = [p.b.id, id].sort().join('|');
        if (drawn.has(k)) continue;
        drawn.add(k);
        const on = lit === p.b.id || lit === id;
        const al = Math.min(p.alpha, q.alpha);
        const qx = lerp((p.x + q.x) / 2, this.cx, 0.35);
        const qy = lerp((p.y + q.y) / 2, this.cy, 0.35);
        g.strokeStyle = rgba(INK, (on ? 0.26 : 0.08) * al);
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.quadraticCurveTo(qx, qy, q.x, q.y);
        g.stroke();
        if (this.reduced) continue;
        const s = (tt * 0.2 + (hashOf(k) % 100) / 100) % 1;
        const u = 1 - s;
        const x = u * u * p.x + 2 * u * s * qx + s * s * q.x;
        const y = u * u * p.y + 2 * u * s * qy + s * s * q.y;
        g.fillStyle = rgba(mix(p.b.color, q.b.color, s), (on ? 0.6 : 0.35) * al);
        g.beginPath();
        g.arc(x, y, 1.5, 0, TAU);
        g.fill();
      }
  }

  /** El centro: tú, con tu foto (o tus iniciales), una corona dorada y rayos que giran despacio. */
  private drawSun(g: CanvasRenderingContext2D, lit: string | null, dark: boolean, tt: number) {
    const { cx, cy, sunR: R } = this;
    const on = lit === 'me';
    const pulse = 1 + 0.06 * Math.sin(tt * 0.9);
    const out = R * 3.4 * pulse;
    const co = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, out);
    co.addColorStop(0, rgba(GOLD, on ? 0.38 : 0.3));
    co.addColorStop(0.45, rgba(GOLD, 0.1));
    co.addColorStop(1, rgba(GOLD, 0));
    g.fillStyle = co;
    g.beginPath();
    g.arc(cx, cy, out, 0, TAU);
    g.fill();

    g.strokeStyle = rgba(GOLD, 0.16);
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + tt * 0.06;
      const len = R * (1.5 + 0.45 * ((hashOf('ray' + i) % 100) / 100) + 0.15 * Math.sin(tt * 1.3 + i));
      g.moveTo(cx + Math.cos(a) * R * 1.25, cy + Math.sin(a) * R * 1.25);
      g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    }
    g.stroke();

    const me = this.sig.me;
    this.disk(g, cx, cy, R, 1, MOSS, me.image, me.mark, -0.6, -0.7, dark, false);
    g.strokeStyle = rgba(GOLD, 0.75);
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(cx, cy, R + 1.8, 0, TAU);
    g.stroke();
    if (on) {
      g.strokeStyle = rgba(GOLD, 0.5);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, R + 5.5 + Math.sin(tt * 3), 0, TAU);
      g.stroke();
    }
    if (this.focus === 'me') focusRing(g, cx, cy, R + 2);
  }

  private drawPlanet(
    g: CanvasRenderingContext2D,
    p: Planet,
    lit: string | null,
    dark: boolean,
    tt: number,
  ) {
    const on = lit === p.b.id;
    const tied = !!lit && p.b.ties.includes(lit);
    const dim = lit && lit !== 'me' && !on && !tied ? 0.5 : 1;
    const a = p.alpha * dim * lerp(0.55, 1, (p.depth + 1) / 2);
    if (a < 0.01) return;
    const { x, y, r } = p;
    const col = p.calm ? MIST : p.b.color;

    if (p.calm) {
      g.strokeStyle = rgba(MIST, 0.6 * a);
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      if (this.focus === p.b.id) focusRing(g, x, y, r);
      return;
    }

    // La luz viene del centro (tú): ilumina el lado que mira hacia allá.
    let lx = this.cx - x;
    let ly = this.cy - y;
    const ll = Math.hypot(lx, ly) || 1;
    lx /= ll;
    ly /= ll;

    this.trail(g, p, col, a, r);
    const glow = g.createRadialGradient(x, y, r * 0.6, x, y, r * 2.3);
    glow.addColorStop(0, rgba(col, (on ? 0.3 : 0.2) * a));
    glow.addColorStop(1, rgba(col, 0));
    g.fillStyle = glow;
    g.beginPath();
    g.arc(x, y, r * 2.3, 0, TAU);
    g.fill();

    const ringed = p.b.type === 'episode';
    if (ringed) this.ring(g, p, col, a, 'back');
    this.drawMoons(g, p, a, dark, 'back');
    this.disk(g, x, y, r, a, col, p.b.image, p.b.mark, lx, ly, dark, true);
    g.strokeStyle = rgba(col, (on ? 0.9 : 0.62) * a);
    g.lineWidth = ringed ? 1.1 : 1.5;
    g.beginPath();
    g.arc(x, y, r + 1.6, 0, TAU);
    g.stroke();
    if (ringed) this.ring(g, p, col, a, 'front');
    this.drawMoons(g, p, a, dark, 'front');
    if (isMedia(p.b)) this.drawProgress(g, p, col, a, tt);

    if (on) {
      g.strokeStyle = rgba(col, 0.45 * p.alpha);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, r + 4.5 + Math.sin(tt * 3) * 0.8, 0, TAU);
      g.stroke();
    }
    if (this.focus === p.b.id) focusRing(g, x, y, r + 1.6);
  }

  /**
   * Un disco con borde claro: la foto recortada en círculo (con un sombreado que le da volumen) o,
   * sin foto, una esfera de su color con una o dos iniciales.
   */
  private disk(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    a: number,
    col: string,
    image: string | undefined,
    mark: string,
    lx: number,
    ly: number,
    dark: boolean,
    shaded: boolean,
  ) {
    g.fillStyle = rgba('#ffffff', 0.9 * a);
    g.beginPath();
    g.arc(x, y, r + 1.6, 0, TAU);
    g.fill();

    const pic = picOf(image);
    const fade = pic?.ok ? (this.reduced ? 1 : clamp((performance.now() - pic.at) / 450)) : 0;
    if (fade < 1) {
      this.sphere(g, x, y, r, col, a, lx, ly);
      this.initials(g, mark, x, y, r, a * (1 - fade));
    }
    if (pic?.ok && fade > 0) {
      g.save();
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.clip();
      g.globalAlpha = a * fade;
      if (dark && 'filter' in g) g.filter = 'invert(1) hue-rotate(180deg)';
      drawCover(g, pic.img, x, y, r);
      g.restore();
      if (shaded) this.shade(g, x, y, r, lx, ly, a * fade, dark);
    }
  }

  /** Esfera con luz desde (lx, ly): clara hacia el centro, más oscura en el lado de atrás. */
  private sphere(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    col: string,
    a: number,
    lx: number,
    ly: number,
  ) {
    const gr = g.createRadialGradient(x + lx * r * 0.45, y + ly * r * 0.45, r * 0.1, x, y, r * 1.05);
    gr.addColorStop(0, rgba(mix(col, '#ffffff', 0.45), a));
    gr.addColorStop(0.55, rgba(col, a));
    gr.addColorStop(1, rgba(mix(col, INK, 0.38), a));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  /** Sombreado sutil sobre una foto, para que parezca un planeta y no una calcomanía. */
  private shade(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    lx: number,
    ly: number,
    a: number,
    dark: boolean,
  ) {
    // Tras la inversión del modo oscuro, el claro se ve oscuro y viceversa.
    const shadow = dark ? '#e4dfe8' : '#1c2417';
    const light = dark ? '#000000' : '#ffffff';
    const gr = g.createRadialGradient(
      x + lx * r * 0.55,
      y + ly * r * 0.55,
      r * 0.05,
      x + lx * r * 0.25,
      y + ly * r * 0.25,
      r * 1.5,
    );
    gr.addColorStop(0, rgba(light, 0.2 * a));
    gr.addColorStop(0.4, rgba(light, 0));
    gr.addColorStop(0.62, rgba(shadow, 0));
    gr.addColorStop(1, rgba(shadow, 0.34 * a));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  /** Una o dos iniciales: dos solo si caben. */
  private initials(g: CanvasRenderingContext2D, mark: string, x: number, y: number, r: number, a: number) {
    const chars = Array.from(mark);
    if (!chars.length || a < 0.02) return;
    const two = chars.length > 1 && r >= 9.5;
    const text = two ? chars.slice(0, 2).join('') : chars[0];
    const fs = r * (two ? 0.74 : 0.92);
    g.font = `700 ${fs.toFixed(1)}px Manrope, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = rgba('#ffffff', 0.95 * a);
    g.fillText(text, x, y + fs * 0.05);
  }

  /** Anillos de los episodios: la mitad de atrás pasa detrás del planeta. */
  private ring(g: CanvasRenderingContext2D, p: Planet, col: string, a: number, half: 'back' | 'front') {
    const back = half === 'back';
    const from = back ? Math.PI : 0;
    const to = back ? TAU : Math.PI;
    const rx = p.r * 1.75;
    const ry = p.r * 0.5;
    g.strokeStyle = rgba(col, (back ? 0.28 : 0.55) * a);
    g.lineWidth = Math.max(1, p.r * 0.13);
    g.beginPath();
    g.ellipse(p.x, p.y, rx, ry, p.ringTilt, from, to);
    g.stroke();
    g.strokeStyle = rgba(col, (back ? 0.12 : 0.22) * a);
    g.lineWidth = 0.8;
    g.beginPath();
    g.ellipse(p.x, p.y, rx * 1.2, ry * 1.2, p.ringTilt, from, to);
    g.stroke();
  }

  /**
   * Libros y series: un arco dorado alrededor dice cuánto llevas (si se sabe); si no, un halo
   * punteado que gira despacio. Las series, además, llevan un destello que les da la vuelta.
   */
  private drawProgress(g: CanvasRenderingContext2D, p: Planet, col: string, a: number, tt: number) {
    const R = p.r + 3.8;
    const ink = mix(GOLD, col, 0.25);
    const k = p.b.progress;
    g.lineWidth = 1.6;
    if (k !== undefined) {
      g.strokeStyle = rgba(INK, 0.08 * a);
      g.beginPath();
      g.arc(p.x, p.y, R, 0, TAU);
      g.stroke();
      g.strokeStyle = rgba(ink, 0.85 * a);
      g.beginPath();
      g.arc(p.x, p.y, R, -Math.PI / 2, -Math.PI / 2 + Math.max(0.04, k) * TAU);
      g.stroke();
    } else {
      g.strokeStyle = rgba(ink, 0.5 * a);
      g.lineWidth = 1.1;
      g.setLineDash([1.5, 3.5]);
      g.lineDashOffset = -tt * 4;
      g.beginPath();
      g.arc(p.x, p.y, R, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }
    if (p.b.type === 'series') {
      const t = tt * 1.4 + (hashOf(p.b.id) % 100) / 16;
      const sx = p.x + Math.cos(t) * (R + 2.5);
      const sy = p.y + Math.sin(t) * (R + 2.5);
      const glow = g.createRadialGradient(sx, sy, 0, sx, sy, 4.5);
      glow.addColorStop(0, rgba(ink, 0.7 * a));
      glow.addColorStop(1, rgba(ink, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(sx, sy, 4.5, 0, TAU);
      g.fill();
    }
  }

  /** Lunas: fotos diminutas (o puntos de su color) que pasan por delante y por detrás. */
  private drawMoons(
    g: CanvasRenderingContext2D,
    p: Planet,
    a: number,
    dark: boolean,
    half: 'back' | 'front',
  ) {
    p.moons.forEach((m, i) => {
      const front = Math.sin(m.a) >= 0;
      if ((half === 'front') !== front) return;
      const orbit = p.r + 5 + i * 4.2;
      const mx = p.x + Math.cos(m.a) * orbit;
      const my = p.y + Math.sin(m.a) * orbit * 0.42;
      const mr = Math.max(2.4, p.r * 0.28) * (front ? 1 : 0.85);
      const ma = a * (front ? 1 : 0.6);
      const pic = picOf(m.image);
      g.fillStyle = rgba('#ffffff', 0.9 * ma);
      g.beginPath();
      g.arc(mx, my, mr + 0.9, 0, TAU);
      g.fill();
      if (pic?.ok && mr >= 3) {
        g.save();
        g.beginPath();
        g.arc(mx, my, mr, 0, TAU);
        g.clip();
        g.globalAlpha = ma;
        if (dark && 'filter' in g) g.filter = 'invert(1) hue-rotate(180deg)';
        drawCover(g, pic.img, mx, my, mr);
        g.restore();
      } else {
        g.fillStyle = rgba(mix(m.color, INK, 0.15), 0.85 * ma);
        g.beginPath();
        g.arc(mx, my, mr, 0, TAU);
        g.fill();
      }
    });
  }

  /** Estela breve sobre su órbita, que se desvanece hacia atrás. */
  private trail(g: CanvasRenderingContext2D, p: Planet, col: string, a: number, r: number) {
    const w = this.omega(p) + p.spin + this.sys;
    if (Math.abs(w) < 0.01 || p.R < 1) return;
    const dir = w > 0 ? 1 : -1;
    const len = Math.min(0.9, 0.22 + Math.abs(w) * 1.1);
    const N = 9;
    const cx = this.cx + p.ox;
    const cy = this.cy + p.oy;
    g.lineCap = 'butt';
    for (let i = 0; i < N; i++) {
      const a0 = p.angle - dir * len * (i / N);
      const a1 = p.angle - dir * len * ((i + 1) / N);
      g.strokeStyle = rgba(col, 0.13 * a * (1 - i / N));
      g.lineWidth = Math.max(0.8, r * 0.62 * (1 - (i / N) * 0.75));
      g.beginPath();
      g.ellipse(cx, cy, p.R, p.R * p.tilt, p.rot, Math.min(a0, a1), Math.max(a0, a1));
      g.stroke();
    }
    g.lineCap = 'round';
  }

  spots(): Spot[] {
    const out: Spot[] = [{ id: 'me', x: this.cx, y: this.cy, r: this.sunR + 2, hint: 'Tú' }];
    for (const p of this.planets) {
      if (p.gone) continue;
      out.push({
        id: p.b.id,
        x: p.x,
        y: p.y,
        r: Math.max(7, p.r + 2),
        hint: p.calm
          ? 'Órbita libre'
          : p.b.type === 'episode'
            ? `${p.b.title} · episodio`
            : p.b.type === 'book'
              ? `${p.b.title} · libro`
              : p.b.type === 'series'
                ? `${p.b.title} · serie`
                : p.b.title,
      });
    }
    return out;
  }

  hit(x: number, y: number, touch: boolean) {
    // Los planetas tienen prioridad sobre el centro; entre dos que se cruzan, el de adelante.
    const s = this.spots();
    const front = new Map(this.planets.map((p) => [p.b.id, p.depth]));
    const near = s
      .slice(1)
      .filter((sp) => Math.hypot(sp.x - x, sp.y - y) <= sp.r + (touch ? 14 : 6))
      .sort((a, b) => (front.get(b.id) ?? 0) - (front.get(a.id) ?? 0));
    return near[0] ?? nearest(s.slice(0, 1), x, y, touch);
  }

  grab(id: string | null, p: Pointer) {
    const planet = this.planets.find((x) => x.b.id === id);
    if (planet) {
      this.grabbed = planet;
      return true;
    }
    // Arrastrar el vacío cerca del sistema acelera el giro de todo.
    const d = Math.hypot((p.x - this.cx) / this.rMax, (p.y - this.cy) / (this.rMax * TILT));
    if (d < 1.15) {
      this.grabbed = 'system';
      return true;
    }
    return false;
  }

  drag(p: Pointer, dx: number) {
    if (this.grabbed === 'system') {
      const side = p.y < this.cy ? -1 : 1;
      this.sys = clamp(this.sys + ((dx * side) / this.rMax) * 0.9, -1.4, 1.4);
    }
  }

  release(ptr: Pointer) {
    const p = this.grabbed;
    this.grabbed = null;
    if (!p || p === 'system') return;
    // Impulso: la velocidad del gesto se queda en el planeta y su parte tangencial lo hace girar.
    p.vx = clamp(ptr.vx * 0.6, -500, 500);
    p.vy = clamp(ptr.vy * 0.6, -500, 500);
    const ex = -Math.sin(p.angle) * p.R;
    const ey = Math.cos(p.angle) * p.R * p.tilt;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const tx = ex * c - ey * s;
    const ty = ex * s + ey * c;
    const tl = Math.hypot(tx, ty) || 1;
    const vt = (ptr.vx * tx + ptr.vy * ty) / tl;
    p.spin = clamp(p.spin + (vt / Math.max(20, p.R)) * 0.5, -2.2, 2.2);
  }

  explain(id: string): Reveal | null {
    const s = this.sig;
    if (id === 'me') {
      const count = (type: Body['type']) => s.bodies.filter((b) => b.type === type).length;
      const parts = [
        count('episode') && plural(count('episode'), 'episodio activo', 'episodios activos'),
        count('person') && plural(count('person'), 'persona', 'personas'),
        count('book') && plural(count('book'), 'libro que lees', 'libros que lees'),
        count('series') && plural(count('series'), 'serie que ves', 'series que ves'),
      ].filter(Boolean) as string[];
      const list =
        parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0];
      return {
        title: 'Tú, en el centro',
        text: parts.length
          ? `A tu alrededor orbitan ${list}.`
          : 'Aún no hay episodios activos, personas en tus recuerdos recientes ni lecturas o series en curso: las órbitas esperan en calma.',
        context:
          'La distancia es el tiempo desde su último movimiento; la velocidad, lo que se movió en dos semanas; el tamaño, lo que reúne. Los episodios llevan anillos y sus personas, lunas; los libros y las series, un arco con lo que llevas. Los hilos unen lo que comparte personas.',
      };
    }
    const p = this.planets.find((x) => x.b.id === id);
    if (!p) return null;
    const b = p.b;
    if (p.calm)
      return {
        title: 'Una órbita libre',
        text: 'Aquí orbitarán tus episodios activos y las personas que aparezcan en tus recuerdos recientes.',
      };
    const near =
      b.ago === 0
        ? 'Orbita muy cerca: tuvo movimiento hoy'
        : b.ago <= 3
          ? `Orbita cerca: su último movimiento fue hace ${plural(b.ago, 'día', 'días')}`
          : b.ago <= 14
            ? `Orbita a media distancia: su último movimiento fue hace ${b.ago} días`
            : `Orbita lejos: su último movimiento fue hace ${b.ago} días`;
    const speed = b.recent
      ? `gira más rápido por ${plural(b.recent, 'movimiento', 'movimientos')} en las últimas dos semanas`
      : 'gira despacio, sin movimiento en las últimas dos semanas';
    const tied = b.ties
      .map((t) => this.planets.find((x) => x.b.id === t)?.b.title)
      .filter(Boolean) as string[];
    const tie = tied.length ? ` Unido a ${tied.map((t) => `«${t}»`).join(', ')}.` : '';
    if (isMedia(b)) {
      const book = b.type === 'book';
      const where = b.note ? ` · ${b.note.charAt(0).toLowerCase()}${b.note.slice(1)}` : '';
      return {
        title: b.title,
        text: `${book ? 'Libro que estás leyendo' : 'Serie que estás viendo'}${where}.`,
        context: `${near}; ${speed}.${tie}`,
        action: {
          label: book ? 'Ver el libro' : 'Ver la serie',
          run: () => this.nav.viewEntry(b.ref),
        },
      };
    }
    if (b.type === 'episode') {
      const items = b.weight - 1;
      return {
        title: b.title,
        text: `Episodio en curso${items ? ' · ' + plural(items, 'recuerdo o novedad', 'recuerdos y novedades') : ''}${b.people ? ' · ' + plural(b.people, 'persona', 'personas') : ''}.`,
        context: `${near}; ${speed}.${tie}`,
        action: { label: 'Abrir episodio', run: () => this.nav.episode(b.ref) },
      };
    }
    return {
      title: b.title,
      text: `Aparece en ${plural(b.weight, 'recuerdo', 'recuerdos')} de los últimos 60 días.`,
      context: `${near}; ${speed}.${tie}`,
      action: { label: 'Ver su ficha', run: () => this.nav.person(b.ref) },
    };
  }
}
