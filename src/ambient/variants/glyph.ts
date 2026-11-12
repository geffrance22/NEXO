import type { Signals } from '../signals';
import {
  INK,
  TAU,
  approach,
  clamp,
  focusRing,
  hashOf,
  lerp,
  mix,
  noise1,
  rgba,
  seeded,
  smooth,
  type Nav,
  type Pointer,
  type Reveal,
  type Scene,
  type SceneInit,
  type Spot,
} from '../scene';
import { buildMessages, type Domain, type Message, type Tense } from './messages';

/**
 * Lenguaje circular de Nexo: una escritura propia (inspirada en los logogramas circulares de la
 * ciencia ficción, sin pretender traducir ningún idioma real). Cada símbolo escribe un mensaje
 * entero a la vez con una gramática fija:
 *
 * - Anillo = la frase. Su apertura dice el tiempo: casi cerrado arriba = ahora; abierto a la
 *   izquierda y trazado al revés = algo que ya pasó; abierto a la derecha con una cola = algo por
 *   venir.
 * - Rasgo principal = de qué trata: ramas hacia fuera (episodio), lazos (personas), gotas de tinta
 *   (ánimo que marcaste), espiral hacia dentro (lo que lees o aprendes), ganchos hacia dentro
 *   (asuntos abiertos), ecos exteriores (tu ritmo), anillo interior (un recuerdo de otro año),
 *   semilla interior (una cápsula sellada). Solo el anillo = calma.
 * - Cuántos rasgos = cuánto (crece con el logaritmo de la cantidad, hasta seis).
 * - Lazos pequeños sobre el anillo = personas implicadas.
 * - Grosor del trazo = el tono del ánimo, solo si lo marcaste: grueso y liso en los tonos
 *   luminosos, fino y ondulado en los difíciles.
 * - Punto central = el mensaje habla de ti.
 *
 * Está siempre escribiendo: cada dos segundos el símbolo se disuelve en el siguiente mientras el
 * nuevo se traza (si solo hay un mensaje, lo vuelve a escribir con otra caligrafía). Respira y se
 * aparta un poco del puntero. Tocarlo detiene la escritura y revela su frase y de dónde nació;
 * al cerrar, sigue. Las flechas pasan al siguiente o al anterior.
 */

type Pt = [number, number, number];
type Stroke = { pts: Pt[]; len: number; start: number };
type Blot = { x: number; y: number; r: number; at: number };
type Glyph = {
  msg: Message;
  strokes: Stroke[];
  blots: Blot[];
  specks: Blot[];
  total: number;
  ink: string;
  legend: string[];
};

/** Cada dos segundos, otro símbolo: se escribe, se sostiene un instante y se disuelve. */
const DRAW = 1.15;
const HOLD = 0.85;
const FADE = 0.9;

const MAIN: Record<Domain, string> = {
  episodio: 'ramas hacia fuera: un episodio',
  persona: 'lazos: personas',
  animo: 'gotas de tinta: un ánimo que marcaste',
  lectura: 'espiral hacia dentro: lo que lees o aprendes',
  asuntos: 'ganchos hacia dentro: asuntos abiertos',
  ritmo: 'ecos exteriores: tu ritmo',
  memoria: 'anillo interior: un recuerdo de otro año',
  capsula: 'semilla interior: una cápsula del tiempo',
  calma: 'solo el anillo: calma',
};
const TENSE: Record<Tense, string> = {
  presente: 'Anillo casi cerrado: ahora',
  pasado: 'Abierto a la izquierda y trazado al revés: ya pasó',
  futuro: 'Abierto a la derecha, con cola: está por venir',
};
const UNIT: Record<Domain, [string, string]> = {
  episodio: ['rama', 'ramas'],
  persona: ['lazo', 'lazos'],
  animo: ['gota', 'gotas'],
  lectura: ['vuelta', 'vueltas'],
  asuntos: ['gancho', 'ganchos'],
  ritmo: ['eco', 'ecos'],
  memoria: ['marca', 'marcas'],
  capsula: ['semilla', 'semillas'],
  calma: ['', ''],
};

const magnitude = (n: number) => clamp(1 + Math.round(Math.log2(1 + Math.max(0, n))), 1, 6);

function measure(pts: Pt[]) {
  let len = 0;
  for (let i = 1; i < pts.length; i++)
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

/**
 * Traduce un mensaje a trazos en un círculo unidad (radio 1, centro 0,0). `variant` cambia la
 * caligrafía (largos, curvas, salpicaduras) sin cambiar lo que dice: el mismo mensaje, escrito
 * otra vez, nunca sale idéntico.
 */
export function compose(msg: Message, variant = 0): Glyph {
  const rand = seeded((hashOf(msg.id + msg.domain + msg.count) + variant * 0x9e3779b1) >>> 0);
  const strokes: Pt[][] = [];
  const blots: { x: number; y: number; r: number; after: number }[] = [];
  const toneW = msg.tone ? lerp(0.72, 1.32, (msg.tone - 1) / 4) : 1;
  const ripple = msg.tone ? (5 - msg.tone) * 0.012 : 0;
  const seed = rand() * 10;

  // El anillo: su apertura y su sentido dicen el tiempo.
  const gap = msg.tense === 'presente' ? 0.34 : 0.62;
  let a0: number;
  let sweep: number;
  if (msg.tense === 'pasado') {
    a0 = Math.PI - gap / 2;
    sweep = -(TAU - gap);
  } else if (msg.tense === 'futuro') {
    a0 = gap / 2;
    sweep = TAU - gap;
  } else {
    a0 = -Math.PI / 2 + gap / 2;
    sweep = TAU - gap;
  }
  const at = (s: number) => a0 + sweep * s;
  const ring: Pt[] = [];
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const a = at(s);
    const r = 1 + 0.022 * noise1(s * 6, seed) + ripple * Math.sin(a * 9 + seed);
    const w = lerp(1.25, 0.45, s) * (1 + 0.12 * noise1(s * 9, seed + 1)) * toneW;
    ring.push([Math.cos(a) * r, Math.sin(a) * r, w]);
  }
  if (msg.tense === 'futuro') {
    // Cola: sigue la tangente y se abre hacia fuera.
    const a = at(1);
    let x = ring[ring.length - 1][0];
    let y = ring[ring.length - 1][1];
    let dir = a + Math.PI / 2;
    for (let i = 1; i <= 12; i++) {
      dir -= 0.07;
      x += Math.cos(dir) * 0.034;
      y += Math.sin(dir) * 0.034;
      ring.push([x, y, lerp(0.45, 0.15, i / 12) * toneW]);
    }
  }
  strokes.push(ring);

  const n =
    msg.domain === 'calma'
      ? 0
      : msg.domain === 'persona'
        ? clamp(Math.max(1, msg.people), 1, 5)
        : magnitude(msg.count);
  const slots = (k: number, off = 0) =>
    Array.from({ length: k }, (_, i) =>
      clamp(0.1 + (0.8 * (i + 0.5 + off)) / k + (rand() - 0.5) * 0.04, 0.05, 0.95),
    );
  const point = (a: number, r: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;

  const loop = (a: number, rr: number) => {
    const [cx, cy] = point(a, 1 + rr * 0.95);
    const pts: Pt[] = [];
    const start = a + Math.PI;
    for (let i = 0; i <= 26; i++) {
      const t = start + (i / 26) * TAU * 0.93;
      pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr, lerp(0.7, 0.35, i / 26)]);
    }
    strokes.push(pts);
  };

  switch (msg.domain) {
    case 'episodio':
      for (const s of slots(n)) {
        const a = at(s);
        let dir = a + (rand() - 0.5) * 0.3;
        const bend = (rand() - 0.5) * 0.06;
        const len = 0.26 + rand() * 0.14;
        let [x, y] = point(a, 1);
        const main: Pt[] = [[x, y, 0.85]];
        let fork: [number, number, number] | null = null;
        for (let i = 1; i <= 11; i++) {
          dir += bend;
          x += (Math.cos(dir) * len) / 11;
          y += (Math.sin(dir) * len) / 11;
          main.push([x, y, lerp(0.85, 0.22, i / 11)]);
          if (i === 6) fork = [x, y, dir];
        }
        strokes.push(main);
        if (fork) {
          let [fx, fy, fd] = fork;
          fd += rand() > 0.5 ? 0.55 : -0.55;
          const sub: Pt[] = [[fx, fy, 0.5]];
          for (let i = 1; i <= 6; i++) {
            fx += (Math.cos(fd) * len * 0.45) / 6;
            fy += (Math.sin(fd) * len * 0.45) / 6;
            sub.push([fx, fy, lerp(0.5, 0.15, i / 6)]);
          }
          strokes.push(sub);
        }
      }
      break;
    case 'persona':
      for (const s of slots(n)) loop(at(s), 0.1 + rand() * 0.025);
      break;
    case 'animo':
      for (const s of slots(n)) {
        const a = at(s);
        const [x0, y0] = point(a, 1);
        const [x1, y1] = point(a, 1.09);
        strokes.push([
          [x0, y0, 0.5],
          [x1, y1, 0.3],
        ]);
        const [bx, by] = point(a, 1.14);
        blots.push({
          x: bx,
          y: by,
          r: (0.045 + rand() * 0.03) * toneW,
          after: strokes.length - 1,
        });
      }
      break;
    case 'lectura': {
      const a = at(0.5 + (rand() - 0.5) * 0.2);
      const [cx, cy] = point(a, 0.56);
      const turns = 1 + Math.min(2, n * 0.35);
      const pts: Pt[] = [];
      const [sx, sy] = point(a, 1);
      pts.push([sx, sy, 0.8]);
      const steps2 = 40;
      for (let i = 0; i <= steps2; i++) {
        const s = i / steps2;
        const t = a + s * turns * TAU;
        const r = lerp(0.36, 0.035, s);
        pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, lerp(0.75, 0.25, s)]);
      }
      strokes.push(pts);
      break;
    }
    case 'asuntos':
      for (const s of slots(n)) {
        const a = at(s);
        const pts: Pt[] = [];
        let [x, y] = point(a, 1);
        let dir = a + Math.PI;
        pts.push([x, y, 0.8]);
        for (let i = 1; i <= 7; i++) {
          x += Math.cos(dir) * 0.04;
          y += Math.sin(dir) * 0.04;
          pts.push([x, y, lerp(0.8, 0.55, i / 7)]);
        }
        const turn = rand() > 0.5 ? 1 : -1;
        for (let i = 1; i <= 10; i++) {
          dir += turn * 0.32;
          x += Math.cos(dir) * 0.022;
          y += Math.sin(dir) * 0.022;
          pts.push([x, y, lerp(0.55, 0.2, i / 10)]);
        }
        strokes.push(pts);
      }
      break;
    case 'ritmo': {
      const mid = at(0.5);
      const arcs = clamp(Math.ceil(msg.count / 2), 1, 4);
      for (let k = 0; k < arcs; k++) {
        const r = 1.16 + k * 0.085;
        const span = 0.5 + 0.18 * k;
        const pts: Pt[] = [];
        for (let i = 0; i <= 20; i++) {
          const t = mid - span / 2 + (span * i) / 20;
          pts.push([Math.cos(t) * r, Math.sin(t) * r, 0.4 * Math.sin((Math.PI * i) / 20) + 0.12]);
        }
        strokes.push(pts);
      }
      break;
    }
    case 'memoria': {
      const inner: Pt[] = [];
      const start = a0 + 0.4;
      for (let i = 0; i <= 60; i++) {
        const t = start + Math.sign(sweep) * (i / 60) * TAU * 0.84;
        const r = 0.6 + 0.015 * noise1(i * 0.2, seed + 3);
        inner.push([Math.cos(t) * r, Math.sin(t) * r, lerp(0.55, 0.25, i / 60)]);
      }
      strokes.push(inner);
      const marks = clamp(msg.count, 1, 5);
      for (let k = 0; k < marks; k++) {
        const t = start + Math.sign(sweep) * (0.12 + (k / Math.max(1, marks)) * TAU * 0.6);
        strokes.push([
          [Math.cos(t) * 0.53, Math.sin(t) * 0.53, 0.45],
          [Math.cos(t) * 0.67, Math.sin(t) * 0.67, 0.25],
        ]);
      }
      break;
    }
    case 'capsula': {
      const seeds = clamp(msg.count, 1, 3);
      for (let k = 0; k < seeds; k++) {
        const r = 0.12 + k * 0.07;
        const pts: Pt[] = [];
        for (let i = 0; i <= 30; i++) {
          const t = -Math.PI / 2 + (i / 30) * TAU * 0.95;
          pts.push([Math.cos(t) * r, Math.sin(t) * r, 0.6 - k * 0.12]);
        }
        strokes.push(pts);
      }
      // Camino punteado desde la semilla hacia la apertura del anillo.
      const g = a0 - (Math.sign(sweep) * gap) / 2;
      for (let k = 0; k < 4; k++) {
        const r0 = 0.3 + k * 0.15;
        strokes.push([
          [Math.cos(g) * r0, Math.sin(g) * r0, 0.35],
          [Math.cos(g) * (r0 + 0.07), Math.sin(g) * (r0 + 0.07), 0.3],
        ]);
      }
      break;
    }
    case 'calma':
      break;
  }

  // Personas implicadas (en los mensajes que no tratan de personas).
  if (msg.domain !== 'persona' && msg.people > 0) {
    const k = Math.min(4, msg.people);
    for (const s of slots(k, 0.5)) loop(at(s), 0.065);
  }

  // Habla de ti: un punto en el centro, lo último que se escribe.
  if (msg.self && msg.domain !== 'capsula')
    blots.push({ x: 0, y: 0, r: 0.05, after: strokes.length - 1 });

  let total = 0;
  const built: Stroke[] = strokes.map((pts) => {
    const len = measure(pts);
    const st = { pts, len, start: total };
    total += len;
    return st;
  });
  const out: Blot[] = blots.map((b) => {
    const s = built[b.after];
    return {
      x: b.x,
      y: b.y,
      r: b.r,
      at: s ? (s.start + s.len) / Math.max(total, 1e-6) : 1,
    };
  });
  // Motas de tinta que salpican al trazar (textura, sin significado propio).
  const specks: Blot[] = Array.from({ length: 4 }, () => {
    const a = rand() * TAU;
    const r = 1.05 + rand() * 0.3;
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      r: 0.008 + rand() * 0.012,
      at: rand(),
    };
  });

  const ink = msg.domain === 'animo' && msg.color ? mix(INK, msg.color, 0.45) : INK;
  const legend = [TENSE[msg.tense]];
  if (msg.domain === 'calma') legend.push('Solo el anillo: calma');
  else {
    const [one, many] = UNIT[msg.domain];
    const main = MAIN[msg.domain];
    legend.push(main.charAt(0).toUpperCase() + main.slice(1));
    if (msg.domain !== 'persona') legend.push(`${n} ${n === 1 ? one : many}: cuánto reúne`);
    else legend.push(`${n} ${n === 1 ? one : many}: cuántas personas`);
  }
  if (msg.domain !== 'persona' && msg.people > 0)
    legend.push(
      `${Math.min(4, msg.people)} ${msg.people === 1 ? 'lazo pequeño' : 'lazos pequeños'}: personas implicadas`,
    );
  if (msg.tone)
    legend.push(
      msg.tone >= 4
        ? 'Trazo grueso y liso: un ánimo luminoso'
        : msg.tone <= 2
          ? 'Trazo fino y ondulado: un ánimo difícil'
          : 'Trazo medio: un ánimo sereno',
    );
  if (msg.self && msg.domain !== 'capsula') legend.push('Punto central: habla de ti');

  return { msg, strokes: built, blots: out, specks, total, ink, legend };
}

export class Logogram implements Scene {
  focus: string | null = null;
  selected: string | null = null;
  hover: string | null = null;
  /** Escribe sin parar: el escenario lo anima con fluidez siempre. */
  live = true;
  private msgs: Message[];
  private index: number;
  /** Cuántos símbolos lleva escritos (cambia la caligrafía de cada uno). */
  private turn = 0;
  private cur: Glyph;
  private prev: Glyph | null = null;
  private phase: 'draw' | 'hold' | 'fade' = 'draw';
  private clock = 0;
  private fadeClock = 0;
  private cx = 0;
  private cy = 0;
  private R = 50;
  private pull = 0;
  private px = 0;
  private py = 0;
  private nav: Nav;
  private reduced: boolean;
  private remember: SceneInit['remember'];

  constructor({ sig, nav, reduced, mem, remember }: SceneInit) {
    this.nav = nav;
    this.reduced = reduced;
    this.remember = remember;
    this.msgs = buildMessages(sig);
    const saved = typeof mem.msg === 'string' ? this.msgs.findIndex((m) => m.id === mem.msg) : -1;
    this.index = saved >= 0 ? saved : 0;
    this.cur = compose(this.msgs[this.index]);
    if (reduced) this.phase = 'hold';
  }

  /** Nuevos datos: el símbolo actual sigue igual; los cambios llegan con el siguiente. */
  setData(sig: Signals) {
    const id = this.cur.msg.id;
    this.msgs = buildMessages(sig);
    const at = this.msgs.findIndex((m) => m.id === id);
    if (at >= 0) this.index = at;
    else this.index = Math.min(this.index, this.msgs.length - 1);
  }

  resize(w: number, h: number) {
    this.cx = w * 0.55;
    this.cy = h * 0.5;
    this.R = Math.max(22, Math.min(h * 0.32, w * 0.2, 70));
  }

  /**
   * El siguiente símbolo (o el anterior). Con un solo mensaje, el mismo con otra caligrafía. Solo
   * se recuerda cuál era si lo elegiste tú con las flechas (no en cada cambio automático).
   */
  private advance(step: number, manual = false) {
    const len = this.msgs.length;
    if (!len) return;
    this.index = (this.index + step + len) % len;
    this.turn++;
    this.prev = this.cur;
    this.fadeClock = 0;
    this.cur = compose(this.msgs[this.index], this.turn);
    this.clock = 0;
    this.phase = this.reduced ? 'hold' : 'draw';
    if (manual) this.remember('msg', this.cur.msg.id);
  }

  update(dt: number, _t: number, p: Pointer) {
    // Se detiene mientras lees su mensaje (o lo recorres con el teclado); pasar el puntero no.
    const reading = !!(this.selected || this.focus);
    this.clock += dt;
    if (this.phase === 'draw' && this.clock >= DRAW) {
      this.phase = 'hold';
      this.clock = 0;
    } else if (this.phase === 'hold') {
      // Sin trazado (movimiento reducido), el símbolo se sostiene los dos segundos enteros.
      const stay = this.reduced ? DRAW + HOLD : HOLD;
      if (reading) this.clock = Math.min(this.clock, stay * 0.5);
      else if (this.clock >= stay) this.advance(1);
    }
    if (this.prev) {
      this.fadeClock += dt;
      if (this.fadeClock >= (this.reduced ? 0.6 : FADE)) this.prev = null;
    }
    this.pull = approach(this.pull, p.inside && !this.reduced ? 1 : 0, p.inside ? 3 : 0.8, dt);
    if (p.inside) {
      this.px = p.x;
      this.py = p.y;
    }
  }

  private progress() {
    if (this.reduced || this.phase !== 'draw') return 1;
    return smooth(this.clock / DRAW);
  }

  private paint(
    g: CanvasRenderingContext2D,
    gl: Glyph,
    upto: number,
    alpha: number,
    spread: number,
    t: number,
  ) {
    const R = this.R * (1 + (this.reduced ? 0 : 0.008 * Math.sin(t * 0.5)) + spread * 0.04);
    const cx = this.cx;
    const cy = this.cy;
    const unit = Math.max(1.1, R * 0.046);
    const limit = upto * gl.total;
    const pull = this.pull;
    const px = this.px;
    const py = this.py;
    const reach = R * 0.7;
    const map = (x: number, y: number): [number, number] => {
      let X = cx + x * R;
      let Y = cy + y * R;
      if (pull > 0.01) {
        const dx = X - px;
        const dy = Y - py;
        const d = Math.hypot(dx, dy);
        if (d < reach && d > 0.001) {
          const k = (1 - d / reach) ** 2 * 6 * pull;
          X += (dx / d) * k;
          Y += (dy / d) * k;
        }
      }
      return [X, Y];
    };
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const pass of [0, 1]) {
      const halo = pass === 0;
      g.strokeStyle = rgba(gl.ink, (halo ? 0.05 + spread * 0.03 : 0.78) * alpha);
      for (const s of gl.strokes) {
        if (s.start >= limit) break;
        let walked = s.start;
        let [ax, ay] = map(s.pts[0][0], s.pts[0][1]);
        for (let i = 1; i < s.pts.length; i++) {
          const a = s.pts[i - 1];
          const b = s.pts[i];
          const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
          let f = 1;
          if (walked + seg > limit) f = clamp((limit - walked) / (seg || 1));
          const [bx, by] = map(lerp(a[0], b[0], f), lerp(a[1], b[1], f));
          g.lineWidth = unit * lerp(a[2], b[2], f) * (halo ? 2.6 + spread * 2 : 1);
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(bx, by);
          g.stroke();
          walked += seg;
          ax = bx;
          ay = by;
          if (f < 1) break;
        }
      }
    }
    g.fillStyle = rgba(gl.ink, 0.8 * alpha);
    for (const b of gl.blots) {
      if (b.at > upto + 1e-6) continue;
      const grow = clamp((upto - b.at) * 12 + (upto >= 1 ? 1 : 0));
      const [x, y] = map(b.x, b.y);
      g.beginPath();
      g.arc(x, y, Math.max(0.8, b.r * R * grow), 0, TAU);
      g.fill();
    }
    g.fillStyle = rgba(gl.ink, 0.35 * alpha);
    for (const b of gl.specks) {
      if (b.at > upto) continue;
      const [x, y] = map(b.x, b.y);
      g.beginPath();
      g.arc(x, y, Math.max(0.5, b.r * R), 0, TAU);
      g.fill();
    }
  }

  draw(g: CanvasRenderingContext2D, t: number) {
    if (this.prev) {
      const f = clamp(this.fadeClock / (this.reduced ? 0.6 : FADE));
      this.paint(g, this.prev, 1, 1 - smooth(f), this.reduced ? 0 : f, t);
    }
    const lit = this.hover || this.selected;
    this.paint(g, this.cur, this.progress(), lit ? 1 : 0.88, 0, t);
    if (this.focus === 'glyph') focusRing(g, this.cx, this.cy, this.R * 1.25);
  }

  spots(): Spot[] {
    return [
      {
        id: 'glyph',
        x: this.cx,
        y: this.cy,
        r: this.R * 1.2,
        hint: 'Un mensaje · tócalo para leerlo',
      },
    ];
  }

  key(key: string) {
    if (key !== 'ArrowRight' && key !== 'ArrowLeft') return false;
    this.selected = null;
    this.advance(key === 'ArrowRight' ? 1 : -1, true);
    return true;
  }

  explain(): Reveal {
    const m = this.cur.msg;
    const target = m.target;
    const nav = this.nav;
    const run = target
      ? () => {
          if (target.kind === 'entry' && target.id) nav.viewEntry(target.id);
          else if (target.kind === 'episode') nav.episode(target.id);
          else if (target.kind === 'person' && target.id) nav.person(target.id);
          else nav.agenda();
        }
      : null;
    return {
      title: m.phrase,
      text: m.context,
      legend: this.cur.legend,
      action: target && run ? { label: target.label, run } : undefined,
    };
  }
}
