import { friendlyDate } from '../../lib/format';
import { rhythmText, titleOf, type Day, type Signals } from '../signals';
import {
  INK,
  MOSS,
  TAU,
  approach,
  clamp,
  focusRing,
  lerp,
  mix,
  noise1,
  plural,
  rgba,
  type Nav,
  type Pointer,
  type Reveal,
  type Scene,
  type SceneInit,
  type Spot,
} from '../scene';

/**
 * Planta sensible.
 *
 * Dato → significado → comportamiento → interacción:
 * - El último ánimo que marcaste (máximo 3 días) → cómo te sentiste → postura: erguida y abierta
 *   en los tonos luminosos, inclinada y con las hojas recogidas (en reposo, nunca marchita) en
 *   los difíciles. Sin ánimo marcado, postura neutra. Algunos ánimos cambian el pulso del vaivén.
 * - Los últimos 7 días → una hoja por día (abajo el más antiguo). Si ese día marcaste ánimo, la
 *   hoja toma un poco de su color; si no, queda en su verde de reposo, del mismo tamaño.
 * - Tu ritmo de registros → el vaivén: más lento en semanas quietas, algo más vivo en las activas.
 * - La hora → de noche recoge un poco las hojas, como lo hacen muchas plantas.
 * Las hojas giran hacia el puntero y tiemblan al rozarlas; arrastrar el tallo cambia su forma
 * (y se queda así). Tocar una hoja cuenta su día; tocar el brote, cómo se lee la planta.
 * No pide cuidados, no cuenta rachas y no se castiga la inactividad.
 */

const GREEN = '#7f9c64';
const N = 28;

type Leaf = {
  i: number;
  side: 1 | -1;
  s: number;
  f: number;
  fv: number;
  turn: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  L: number;
  mid: [number, number];
};

const fold = (tone: number) => [0, 0.55, 0.68, 0.86, 1.0, 1.14][tone] ?? 0.86;
const bow = (tone: number) => [0, 0.42, 0.28, 0.12, 0.05, 0][tone] ?? 0.12;
const tempoOf = (key?: string) =>
  key === 'inquieto' || key === 'enojado'
    ? 1.25
    : key === 'cansado' || key === 'triste'
      ? 0.8
      : key === 'alegre' || key === 'poderoso'
        ? 1.1
        : 1;

export class Plant implements Scene {
  focus: string | null = null;
  selected: string | null = null;
  hover: string | null = null;
  private w = 0;
  private h = 0;
  private sig: Signals;
  private nav: Nav;
  private reduced: boolean;
  private remember: SceneInit['remember'];
  private bend: number;
  private lean = 0;
  private curl = 0.12;
  private open = 0.86;
  private tempo = 1;
  private bloom = 0;
  private stem: [number, number][] = [];
  private leaves: Leaf[];
  private bending = false;

  constructor({ sig, nav, reduced, mem, remember }: SceneInit) {
    this.sig = sig;
    this.nav = nav;
    this.reduced = reduced;
    this.remember = remember;
    this.bend = typeof mem.bend === 'number' ? clamp(mem.bend, -0.55, 0.55) : 0;
    this.leaves = Array.from({ length: 7 }, (_, i) => ({
      i,
      side: i % 2 ? 1 : -1,
      s: 0.22 + i * 0.1,
      f: 0,
      fv: 0,
      turn: 0,
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      L: 20,
      mid: [0, 0],
    }));
    const t = this.target();
    this.curl = t.curl;
    this.open = t.open;
    this.tempo = t.tempo;
    this.bloom = t.bloom;
  }

  setData(sig: Signals) {
    this.sig = sig;
  }

  /** Postura deseada según el ánimo que marcaste y la hora (todo cambia despacio). */
  private target() {
    const m = this.sig.mood?.mood;
    const tone = m?.tone ?? 3;
    const night = this.sig.part === 'noche' || this.sig.part === 'madrugada';
    return {
      curl: m ? bow(tone) : 0.1,
      open: (m ? fold(tone) : 0.86) - (night ? 0.14 : 0),
      tempo: tempoOf(m?.key),
      bloom: m ? 0.45 + tone * 0.11 : 0,
    };
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  private dayOf(i: number): Day | undefined {
    return this.sig.week[i];
  }

  update(dt: number, t: number, p: Pointer) {
    const want = this.target();
    this.curl = approach(this.curl, want.curl, 0.5, dt);
    this.open = approach(this.open, want.open, 0.5, dt);
    this.tempo = approach(this.tempo, want.tempo, 0.5, dt);
    this.bloom = approach(this.bloom, want.bloom, 0.6, dt);

    const H = Math.max(50, this.h * 0.84);
    const bx = this.w * 0.6;
    const by = this.h - 4;
    const level = this.sig.rhythm.level;
    const period = lerp(7.5, 4.2, level) / this.tempo;
    const amp = this.reduced ? 0 : lerp(0.022, 0.055, level);
    const sway = amp * (Math.sin((TAU * t) / period) + 0.4 * noise1(t * 0.35, 3));
    const toward =
      p.inside && !this.bending ? clamp((p.x - bx) / Math.max(1, this.w), -0.5, 0.5) * 0.28 : 0;
    this.lean = approach(this.lean, toward, p.inside ? 2.2 : 0.7, dt);

    // Tallo: se integra el ángulo por tramos (curva natural, sin quiebres).
    const seg = H / N;
    let x = bx;
    let y = by;
    const pts: [number, number][] = [[x, y]];
    for (let i = 1; i <= N; i++) {
      const s = i / N;
      const a = this.bend * s + this.curl * s ** 1.8 + (sway + this.lean) * s * s;
      x += Math.sin(a) * seg;
      y -= Math.cos(a) * seg;
      pts.push([x, y]);
    }
    this.stem = pts;

    for (const l of this.leaves) {
      const k = Math.min(N - 1, Math.round(l.s * N));
      const [ax, ay] = pts[k];
      const [cx, cy] = pts[k + 1];
      const dir = Math.atan2(cy - ay, cx - ax);
      const day = this.dayOf(l.i);
      const own = day?.mark ? (fold(day.mark.mood.tone) - 0.86) * 0.35 : 0;
      l.L = clamp((0.2 + 0.07 * (1 - l.i / 6)) * H, 13, 30);
      const base = dir + l.side * (this.open + own);

      // Giran hacia el puntero, con un límite y solo si está cerca.
      let turn = 0;
      if (p.inside && !this.bending) {
        const d = Math.hypot(p.x - ax, p.y - ay);
        if (d < 170) {
          const to = Math.atan2(p.y - ay, p.x - ax);
          let diff = to - base;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          turn = clamp(diff, -0.32, 0.32) * (1 - d / 170);
        }
      }
      l.turn = approach(l.turn, turn, 3, dt);

      // Roce: el movimiento del puntero sobre la hoja la hace temblar.
      const mx = ax + Math.cos(base) * l.L * 0.55;
      const my = ay + Math.sin(base) * l.L * 0.55;
      if (p.inside) {
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < l.L * 0.7) {
          const sp = Math.hypot(p.vx, p.vy);
          const push = (p.vx * -Math.sin(base) + p.vy * Math.cos(base)) / (sp || 1);
          l.fv += push * Math.min(sp, 900) * 0.0045 * (1 - d / (l.L * 0.7));
        }
      }
      const stiff = this.reduced ? 30 : 18;
      const damp = this.reduced ? 9 : 3.2;
      l.fv += (-stiff * l.f - damp * l.fv) * dt;
      l.f = clamp(l.f + l.fv * dt, -0.6, 0.6);
      const ang = base + l.turn + l.f;
      l.x = ax;
      l.y = ay;
      l.tx = ax + Math.cos(ang) * l.L;
      l.ty = ay + Math.sin(ang) * l.L;
      l.mid = [ax + Math.cos(ang) * l.L * 0.55, ay + Math.sin(ang) * l.L * 0.55];
    }
  }

  draw(g: CanvasRenderingContext2D) {
    const pts = this.stem;
    if (!pts.length) return;
    const lit = this.selected ?? this.hover;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // Una sombra mínima en la base, para que se apoye en el fondo.
    const [bx, by] = pts[0];
    g.fillStyle = rgba(INK, 0.05);
    g.beginPath();
    g.ellipse(bx, by, 22, 2.6, 0, 0, TAU);
    g.fill();

    // Tallo afinándose hacia arriba.
    const stemCol = mix(MOSS, INK, 0.22);
    for (let i = 1; i < pts.length; i++) {
      g.strokeStyle = rgba(stemCol, lit === 'bud' || this.bending ? 0.85 : 0.68);
      g.lineWidth = lerp(2.5, 0.9, i / pts.length);
      g.beginPath();
      g.moveTo(pts[i - 1][0], pts[i - 1][1]);
      g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    }

    for (const l of this.leaves) {
      const day = this.dayOf(l.i);
      const mark = day?.mark;
      const col = mark ? mix(GREEN, mark.mood.color, 0.4) : GREEN;
      const id = 'leaf:' + l.i;
      const on = lit === id;
      const a = (mark ? 0.74 : 0.46) * (lit && !on ? 0.7 : 1);
      const dx = l.tx - l.x;
      const dy = l.ty - l.y;
      const nx = -dy * 0.3;
      const ny = dx * 0.3;
      g.fillStyle = rgba(col, on ? Math.min(1, a + 0.18) : a);
      g.beginPath();
      g.moveTo(l.x, l.y);
      g.quadraticCurveTo(l.x + dx * 0.45 + nx, l.y + dy * 0.45 + ny, l.tx, l.ty);
      g.quadraticCurveTo(l.x + dx * 0.45 - nx, l.y + dy * 0.45 - ny, l.x, l.y);
      g.fill();
      g.strokeStyle = rgba(mix(col, INK, 0.35), 0.35);
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(l.x, l.y);
      g.lineTo(l.x + dx * 0.85, l.y + dy * 0.85);
      g.stroke();
      if (this.focus === id) focusRing(g, l.mid[0], l.mid[1], l.L * 0.32);
    }

    // Brote: flor entreabierta con el color del ánimo marcado; cerrado y verde si no hay.
    const [tx, ty] = pts[pts.length - 1];
    const [px, py] = pts[pts.length - 3];
    const up = Math.atan2(ty - py, tx - px);
    const mood = this.sig.mood?.mood;
    if (mood && this.bloom > 0.05) {
      const c = mix(mood.color, '#ffffff', 0.18);
      for (let k = 0; k < 5; k++) {
        const a = up + (k - 2) * 0.42 * this.bloom;
        g.fillStyle = rgba(c, 0.5 + 0.2 * this.bloom);
        g.beginPath();
        g.ellipse(
          tx + Math.cos(a) * 3.4,
          ty + Math.sin(a) * 3.4,
          3.6 * this.bloom + 1.2,
          1.8,
          a,
          0,
          TAU,
        );
        g.fill();
      }
    }
    g.fillStyle = rgba(mix(GREEN, INK, 0.15), 0.8);
    g.beginPath();
    g.ellipse(tx, ty, 2.2, 3.6, up + Math.PI / 2, 0, TAU);
    g.fill();
    if (this.focus === 'bud') focusRing(g, tx, ty, 5);
  }

  spots(): Spot[] {
    const out: Spot[] = this.leaves.map((l) => {
      const day = this.dayOf(l.i);
      const when = day ? friendlyDate(day.day, this.sig.today) : '';
      return {
        id: 'leaf:' + l.i,
        x: l.mid[0],
        y: l.mid[1],
        r: Math.max(7, l.L * 0.36),
        hint: `${when} · ${day?.mark ? day.mark.mood.label.toLowerCase() : 'sin ánimo marcado'}`,
      };
    });
    const tip = this.stem[this.stem.length - 1];
    if (tip) out.push({ id: 'bud', x: tip[0], y: tip[1], r: 7, hint: 'La planta' });
    return out;
  }

  private nearStem(x: number, y: number) {
    return this.stem.some(([sx, sy], i) => i > N * 0.3 && Math.hypot(sx - x, sy - y) < 22);
  }

  grab(id: string | null, p: Pointer) {
    if (id === 'bud' || (!id && this.nearStem(p.x, p.y))) {
      this.bending = true;
      return true;
    }
    return false;
  }

  drag(_p: Pointer, dx: number) {
    if (!this.bending) return;
    const H = Math.max(50, this.h * 0.84);
    this.bend = clamp(this.bend + dx / (H * 0.9), -0.55, 0.55);
  }

  release() {
    if (!this.bending) return;
    this.bending = false;
    this.remember('bend', Number(this.bend.toFixed(3)));
  }

  key(key: string) {
    if (key !== 'Shift+ArrowLeft' && key !== 'Shift+ArrowRight') return false;
    this.bend = clamp(this.bend + (key === 'Shift+ArrowLeft' ? -0.06 : 0.06), -0.55, 0.55);
    this.remember('bend', Number(this.bend.toFixed(3)));
    return true;
  }

  explain(id: string): Reveal | null {
    const s = this.sig;
    if (id === 'bud') {
      const m = s.mood;
      const night = s.part === 'noche' || s.part === 'madrugada';
      return {
        title: 'La planta',
        text: m
          ? `Su postura sigue el último ánimo que marcaste: ${m.mood.label.toLowerCase()}, ${friendlyDate(m.day, s.today).toLowerCase()}.`
          : 'No marcaste ánimo en los últimos tres días, así que reposa en una postura neutra.',
        context: `Cada hoja es uno de tus últimos 7 días y toma el color del ánimo que marcaste ese día. Se mece al ritmo de tu actividad: ${rhythmText(s.rhythm).toLowerCase()}${night ? ' De noche recoge un poco las hojas.' : ''} Arrastra el tallo para darle otra forma.`,
        action: m
          ? {
              label: 'Ver la entrada',
              run: () => this.nav.viewEntry(m.entry.id),
            }
          : undefined,
      };
    }
    const i = Number(id.split(':')[1]);
    const day = this.dayOf(i);
    if (!day) return null;
    const when = friendlyDate(day.day, s.today);
    const mark = day.mark;
    return {
      title: when,
      text: mark
        ? `Marcaste ${mark.mood.label.toLowerCase()}${mark.entry.title.trim() ? ` en «${titleOf(mark.entry)}»` : ''}.`
        : 'Sin ánimo marcado ese día: la hoja queda en su verde de reposo.',
      context: day.count
        ? `${plural(day.count, 'registro', 'registros')} ese día.`
        : 'Sin registros ese día.',
      action: mark
        ? {
            label: 'Ver la entrada',
            run: () => this.nav.viewEntry(mark.entry.id),
          }
        : undefined,
    };
  }
}
