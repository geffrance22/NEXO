import { rhythmText, type OpenGroup, type Signals } from '../signals';
import {
  INK,
  SAGE,
  TAU,
  approach,
  clamp,
  focusRing,
  hashOf,
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
 * Banco de peces abstractos.
 *
 * Dato → significado → comportamiento → interacción:
 * - Asuntos abiertos en Nexo (pendientes por tipo de compromiso y episodios en curso) → dónde se
 *   concentra lo que sigue abierto → un cardumen por tipo; su tamaño crece con la cantidad.
 *   Sin asuntos abiertos, un solo banco tranquilo.
 * - Tu ritmo de registros (7 días frente a tu semana habitual) → velocidad de nado.
 * - Días con actividad en la última semana → regularidad → cohesión de cada cardumen.
 * El puntero genera una corriente que arrastra a los peces cercanos; un toque en el agua abre
 * una onda. Tocar un pez revela qué representa su grupo y lleva a Agenda o al episodio.
 * Ninguna señal de actividad se lee como ánimo, y no se habla de retrasos ni urgencias.
 */

type Fish = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  ph: number;
  len: number;
};
type Group = {
  key: string;
  data: OpenGroup | null;
  color: string;
  /** Punto de reunión, su deriva y el centro real del cardumen. */
  ax: number;
  ay: number;
  cx: number;
  cy: number;
  mx?: number;
  my?: number;
  spread: number;
  seed: number;
};

const CALM: OpenGroup = {
  key: 'calm',
  label: 'Mar en calma',
  color: SAGE,
  items: [],
};

export class School implements Scene {
  focus: string | null = null;
  selected: string | null = null;
  hover: string | null = null;
  private fish: Fish[] = [];
  private groups: Group[] = [];
  private w = 0;
  private h = 0;
  private sig: Signals;
  private nav: Nav;
  private reduced: boolean;
  private speed = 20;
  private cohesion = 0.6;
  private rand = seeded(42);
  private ripple: { x: number; y: number; r: number; a: number } | null = null;

  constructor({ sig, nav, reduced }: SceneInit) {
    this.sig = sig;
    this.nav = nav;
    this.reduced = reduced;
    this.setData(sig);
  }

  /** Reparte peces por grupo; los que ya nadan se conservan (nada se reinicia de golpe). */
  setData(sig: Signals) {
    this.sig = sig;
    const data = sig.open.groups.length ? sig.open.groups : [CALM];
    const old = this.groups;
    this.groups = data.map((d) => {
      const prev = old.find((g) => g.key === d.key);
      return prev
        ? { ...prev, data: d === CALM ? null : d, color: d.color }
        : {
            key: d.key,
            data: d === CALM ? null : d,
            color: d.color,
            ax: 0,
            ay: 0,
            cx: 0,
            cy: 0,
            spread: 20,
            seed: hashOf(d.key) % 1000,
          };
    });
    const want = data.map((d) =>
      d === CALM ? 14 : clamp(Math.round(2 + 2.2 * Math.sqrt(d.items.length)), 3, 10),
    );
    const next: Fish[] = [];
    this.groups.forEach((g, gi) => {
      const oldIndex = old.findIndex((o) => o.key === g.key);
      const mine = oldIndex >= 0 ? this.fish.filter((f) => f.g === oldIndex) : [];
      for (let i = 0; i < want[gi]; i++) {
        const f = mine[i];
        if (f) next.push({ ...f, g: gi });
        else next.push(this.spawn(gi));
      }
    });
    this.fish = next.slice(0, 48);
    this.layout();
  }

  private spawn(g: number): Fish {
    const a = this.rand() * TAU;
    const grp = this.groups[g];
    return {
      x: (grp?.ax || this.w / 2) + Math.cos(a) * 20,
      y: (grp?.ay || this.h / 2) + Math.sin(a) * 12,
      vx: Math.cos(a) * 10,
      vy: Math.sin(a) * 6,
      g,
      ph: this.rand() * TAU,
      len: 6 + this.rand() * 3,
    };
  }

  resize(w: number, h: number) {
    const first = !this.w;
    this.w = w;
    this.h = h;
    this.layout();
    if (first)
      for (const f of this.fish) {
        const g = this.groups[f.g];
        f.x = g.ax + (this.rand() - 0.5) * 40;
        f.y = g.ay + (this.rand() - 0.5) * 24;
      }
  }

  private layout() {
    const G = this.groups.length;
    this.groups.forEach((g, i) => {
      g.ax = this.w * (0.18 + (0.66 * (i + 0.5)) / G);
      g.ay = this.h * (0.5 + 0.16 * Math.sin(i * 2.1 + 0.6));
    });
  }

  update(dt: number, t: number, p: Pointer) {
    const r = this.sig.rhythm;
    this.speed = approach(this.speed, this.reduced ? 5 : 12 + 26 * r.level, 0.5, dt);
    this.cohesion = approach(this.cohesion, 0.25 + 0.75 * (r.activeDays / 7), 0.5, dt);
    const sp = this.speed;
    const W = this.w;
    const H = this.h;

    // Los puntos de reunión derivan despacio: el banco nunca está quieto del todo.
    for (const g of this.groups) {
      const drift = this.reduced ? 0 : 1;
      g.cx = g.ax + noise1(t * 0.05 + g.seed, 1) * W * 0.08 * drift;
      g.cy = g.ay + noise1(t * 0.06 + g.seed, 2) * H * 0.12 * drift;
    }

    const sums = this.groups.map(() => ({ x: 0, y: 0, n: 0 }));
    for (const f of this.fish) {
      const s = sums[f.g];
      s.x += f.x;
      s.y += f.y;
      s.n++;
    }

    for (const f of this.fish) {
      let ax = 0;
      let ay = 0;
      let alx = 0;
      let aly = 0;
      let an = 0;
      for (const o of this.fish) {
        if (o === f) continue;
        const dx = f.x - o.x;
        const dy = f.y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 3600) continue;
        const d = Math.sqrt(d2) || 1;
        const same = o.g === f.g;
        const keep = same ? 9 : 20;
        if (d < keep) {
          ax += (dx / d) * (keep - d) * 5;
          ay += (dy / d) * (keep - d) * 5;
        }
        if (same && d < 40) {
          alx += o.vx;
          aly += o.vy;
          an++;
        }
      }
      if (an) {
        ax += (alx / an - f.vx) * 0.9;
        ay += (aly / an - f.vy) * 0.9;
      }
      const g = this.groups[f.g];
      const s = sums[f.g];
      if (s.n > 1) {
        ax += (s.x / s.n - f.x) * 0.5 * this.cohesion;
        ay += (s.y / s.n - f.y) * 0.5 * this.cohesion;
      }
      ax += (g.cx - f.x) * 0.22 * (0.4 + this.cohesion);
      ay += (g.cy - f.y) * 0.22 * (0.4 + this.cohesion);

      // Bordes blandos: nadie sale de su sitio.
      const m = 14;
      if (f.x < m) ax += (m - f.x) * 6;
      if (f.x > W - m) ax -= (f.x - (W - m)) * 6;
      if (f.y < m) ay += (m - f.y) * 6;
      if (f.y > H - m) ay -= (f.y - (H - m)) * 6;

      // La corriente del puntero.
      if (p.inside) {
        const dx = f.x - p.x;
        const dy = f.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 100) {
          const k = (1 - d / 100) ** 2;
          ax += p.vx * k * 1.6 - (dy / d) * k * 14;
          ay += p.vy * k * 1.6 + (dx / d) * k * 14;
        }
      }
      if (this.ripple && this.ripple.a > 0.5) {
        const dx = f.x - this.ripple.x;
        const dy = f.y - this.ripple.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 70) {
          ax += (dx / d) * (1 - d / 70) * 260;
          ay += (dy / d) * (1 - d / 70) * 260;
        }
      }

      f.vx += ax * dt;
      f.vy += ay * dt;
      const v = Math.hypot(f.vx, f.vy) || 1;
      const target = clamp(v, sp * 0.45, sp * 3);
      const relaxed = approach(target, sp, 0.8, dt);
      f.vx = (f.vx / v) * relaxed;
      f.vy = (f.vy / v) * relaxed * Math.exp(-dt * 1.2);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.ph += dt * (3 + relaxed * 0.18);
    }

    for (let i = 0; i < this.groups.length; i++) {
      const s = sums[i];
      const g = this.groups[i];
      if (!s.n) continue;
      const mx = s.x / s.n;
      const my = s.y / s.n;
      let spread = 0;
      for (const f of this.fish)
        if (f.g === i) spread = Math.max(spread, Math.hypot(f.x - mx, f.y - my));
      g.spread = clamp(spread, 10, 40);
      g.mx = mx;
      g.my = my;
    }

    if (this.ripple) {
      this.ripple.r += dt * 60;
      this.ripple.a -= dt * 1.1;
      if (this.ripple.a <= 0) this.ripple = null;
    }
  }

  private centre(i: number) {
    const g = this.groups[i];
    return { x: g.mx ?? g.ax, y: g.my ?? g.ay };
  }

  draw(g: CanvasRenderingContext2D) {
    const lit = this.selected ?? this.hover;
    if (this.ripple) {
      g.strokeStyle = rgba(INK, 0.12 * this.ripple.a);
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(this.ripple.x, this.ripple.y, this.ripple.r, this.ripple.r * 0.6, 0, 0, TAU);
      g.stroke();
    }
    for (const f of this.fish) {
      const grp = this.groups[f.g];
      const id = 'g:' + grp.key;
      const on = lit === id;
      const a = lit ? (on ? 0.85 : 0.22) : 0.5;
      const ang = Math.atan2(f.vy, f.vx);
      const L = f.len;
      const wig = Math.sin(f.ph) * 0.35;
      g.save();
      g.translate(f.x, f.y);
      g.rotate(ang);
      g.fillStyle = rgba(grp.color, a);
      g.beginPath();
      g.ellipse(0, 0, L * 0.5, L * 0.18, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(-L * 0.42, 0);
      g.lineTo(-L * 0.78, Math.sin(wig + 0.5) * L * 0.2 + L * 0.12);
      g.lineTo(-L * 0.78, Math.sin(wig - 0.5) * L * 0.2 - L * 0.12);
      g.closePath();
      g.fill();
      g.restore();
    }
    this.groups.forEach((grp, i) => {
      if (this.focus !== 'g:' + grp.key) return;
      const m = this.centre(i);
      focusRing(g, m.x, m.y, grp.spread);
    });
  }

  private hintOf(grp: Group) {
    if (!grp.data) return 'Mar en calma';
    return `${grp.data.label} · ${grp.data.items.length}`;
  }

  spots(): Spot[] {
    return this.groups.map((grp, i) => {
      const m = this.centre(i);
      return {
        id: 'g:' + grp.key,
        x: m.x,
        y: m.y,
        r: grp.spread,
        hint: this.hintOf(grp),
      };
    });
  }

  hit(x: number, y: number, touch: boolean): Spot | null {
    const pad = touch ? 14 : 8;
    let best: Fish | null = null;
    let bd = Infinity;
    for (const f of this.fish) {
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < f.len * 0.6 + pad && d < bd) {
        best = f;
        bd = d;
      }
    }
    if (!best) return null;
    const grp = this.groups[best.g];
    return {
      id: 'g:' + grp.key,
      x: best.x,
      y: best.y,
      r: 6,
      hint: this.hintOf(grp),
    };
  }

  /** Un toque en el agua (sin pez debajo) abre una onda suave. */
  grab(id: string | null, p: Pointer) {
    if (!id) this.ripple = { x: p.x, y: p.y, r: 2, a: 1 };
    return false;
  }

  explain(id: string): Reveal | null {
    const grp = this.groups.find((g) => 'g:' + g.key === id);
    if (!grp) return null;
    const r = this.sig.rhythm;
    const motion = `Velocidad: ${rhythmText(r)} Cohesión: ${plural(r.activeDays, 'día', 'días')} con actividad de los últimos 7.`;
    const d = grp.data;
    if (!d)
      return {
        title: 'Mar en calma',
        text: 'No hay pendientes ni episodios abiertos: el banco nada como un solo grupo.',
        context: motion,
      };
    const names = d.items.slice(0, 3).map((x) => `«${x.title}»`);
    const more = d.items.length > 3 ? ` y ${d.items.length - 3} más` : '';
    const among = `${d.items.length === 1 ? 'Es' : 'Entre ellos'}: ${names.join(', ')}${more}.`;
    if (d.key === 'episodios') {
      const one = d.items.length === 1 ? d.items[0] : null;
      return {
        title: d.label,
        text: `${plural(d.items.length, 'episodio sigue abierto', 'episodios siguen abiertos')}; nadan juntos.`,
        context: `${among} ${motion}`,
        action: one
          ? { label: 'Abrir episodio', run: () => this.nav.episode(one.id) }
          : { label: 'Ver episodios', run: () => this.nav.episode() },
      };
    }
    const one = d.items.length === 1 ? d.items[0] : null;
    return {
      title: d.label,
      text: `${plural(d.items.length, 'asunto abierto', 'asuntos abiertos')} de este tipo; el tamaño del grupo sigue la cantidad.`,
      context: `${among} ${motion}`,
      action: one
        ? { label: 'Ver el pendiente', run: () => this.nav.viewEntry(one.id) }
        : { label: 'Ver en Agenda', run: () => this.nav.agenda() },
    };
  }
}
