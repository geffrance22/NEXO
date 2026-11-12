import { moodOf } from '../../composer/moods';
import type { Entry, Person } from '../../data';
import { addDays, friendlyDate, todayInputValue } from '../../lib/format';
import { daysBetween, exchangeKinds } from '../../lib/people';
import { rhythmText, titleOf, type OpenGroup, type Signals } from '../signals';
import {
  INK,
  SAGE,
  TAU,
  approach,
  clamp,
  focusRing,
  hashOf,
  lerp,
  mix,
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
 * Acuario.
 *
 * Dato → significado → comportamiento → interacción:
 * - Personas con las que tuviste un buen momento en las últimas 4 semanas (un ánimo luminoso en
 *   un recuerdo con ellas, o algo que se dieron) → quién te hace bien ahora → un pez propio, de
 *   una especie distinta para cada una; su tamaño crece con esos momentos.
 * - Encuentros próximos (los próximos 30 días) → a quién vas a ver → peces payaso.
 * - Asuntos abiertos (pendientes por tipo de compromiso y episodios en curso) → bancos de peces
 *   pequeños, uno por tipo; su tamaño sigue la cantidad. Los bancos no se tocan.
 * - Tu ritmo de registros → velocidad de los bancos; días con actividad → su cohesión.
 * Los peces propios viven a su aire: deambulan, se persiguen, a veces se pelean un momento, el
 * payaso vuelve a su anémona y todos nadan siempre (también sin el puntero). Tocar el agua echa
 * comida: van a por ella, comen y crecen un poco (hasta un límite). Tocar un pez dice quién es y
 * abre su ficha o el encuentro. Ninguna señal de actividad se lee como ánimo.
 */

type Species = 'payaso' | 'cirujano' | 'angel' | 'mariposa' | 'dorado';
const SPECIES: Record<Species, { name: string; speed: number; agg: number }> = {
  payaso: { name: 'Pez payaso', speed: 1, agg: 0.9 },
  cirujano: { name: 'Pez cirujano', speed: 1.25, agg: 0.65 },
  angel: { name: 'Pez ángel', speed: 0.72, agg: 0.25 },
  mariposa: { name: 'Pez mariposa', speed: 0.95, agg: 0.4 },
  dorado: { name: 'Pez dorado', speed: 0.8, agg: 0.2 },
};
/** Las especies de las personas, en el orden en que se reparten (una distinta para cada una). */
const PERSON_SPECIES: Species[] = ['cirujano', 'mariposa', 'angel', 'dorado', 'payaso'];
/** Cuánto puede crecer un pez comiendo (40 % sobre su tamaño). */
const MAX_GROW = 0.4;
const BITE = 0.05;

type Moment = { day: string; what: string };
type Swimmer = {
  id: string;
  kind: 'person' | 'encounter' | 'resident';
  ref: string;
  title: string;
  species: Species;
  /** 0–1: cuánto pesa frente a los demás (da el tamaño). */
  weight: number;
  person?: Person;
  moments?: Moment[];
  entry?: Entry;
  who?: Person[];
  day?: string;
};

type State = 'wander' | 'chase' | 'flee' | 'fight' | 'eat' | 'home';
type Agent = Swimmer & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** -1 mira a la izquierda, 1 a la derecha (pasa por 0 al girar). */
  face: number;
  ph: number;
  state: State;
  until: number;
  think: number;
  tx: number;
  ty: number;
  other: Agent | null;
  pellet: Pellet | null;
  /** Velocidad propia (cada pez tiene su carácter). */
  cruise: number;
  burst: number;
  grow: number;
  gulp: number;
  alpha: number;
  gone: boolean;
  seed: number;
};

type Fish = { x: number; y: number; vx: number; vy: number; g: number; ph: number; len: number };
type Group = {
  key: string;
  data: OpenGroup | null;
  color: string;
  cx: number;
  cy: number;
  seed: number;
};
type Pellet = { x: number; y: number; vx: number; vy: number; age: number; landed: number; eaten: boolean };
type Bubble = { x: number; y: number; r: number; vy: number; ph: number };

const CALM: OpenGroup = { key: 'calm', label: 'Mar en calma', color: SAGE, items: [] };

const dayOf = (iso: string) => todayInputValue(new Date(iso));
const toneOf = (e: Entry) =>
  Math.max(
    moodOf(e.details.mood)?.tone ?? 0,
    ...(e.details.feelings ?? []).map((f) => moodOf(f.mood)?.tone ?? 0),
  );

/** Quién nada en el acuario: personas con buenos momentos recientes y encuentros próximos. */
function swimmersOf(sig: Signals): Swimmer[] {
  const { ws, today } = sig;
  const from = addDays(today, -27);
  const byId = new Map(ws.people.map((p) => [p.id, p]));
  const moments = new Map<string, Moment[]>();
  const add = (id: string, m: Moment) => {
    if (!byId.has(id)) return;
    moments.set(id, [...(moments.get(id) ?? []), m]);
  };
  for (const e of ws.entries) {
    if (!e.person_ids.length || e.kind === 'Pendiente') continue;
    const day = dayOf(e.created_at);
    if (day < from || day > today || toneOf(e) < 4) continue;
    for (const id of e.person_ids) add(id, { day, what: `«${titleOf(e)}»` });
  }
  for (const p of ws.people)
    for (const x of p.profile.exchanges ?? []) {
      if (x.date < from || x.date > today) continue;
      const kind = exchangeKinds[x.kind].toLowerCase();
      add(p.id, { day: x.date, what: x.dir === 'dar' ? `le diste ${kind}` : `te dio ${kind}` });
    }

  const people = [...moments.entries()]
    .map(([id, list]) => ({ p: byId.get(id)!, list: list.sort((a, b) => b.day.localeCompare(a.day)) }))
    .filter((x) => !x.p.profile.status)
    .sort((a, b) => b.list.length - a.list.length || b.list[0].day.localeCompare(a.list[0].day))
    .slice(0, 4);
  const maxN = Math.max(1, ...people.map((x) => x.list.length));
  // Cada persona, una especie distinta (la suya, si está libre).
  const taken = new Set<Species>();
  const out: Swimmer[] = people.map(({ p, list }) => {
    let at = hashOf(p.id) % PERSON_SPECIES.length;
    while (taken.has(PERSON_SPECIES[at]) && taken.size < PERSON_SPECIES.length)
      at = (at + 1) % PERSON_SPECIES.length;
    taken.add(PERSON_SPECIES[at]);
    return {
      id: 'p:' + p.id,
      kind: 'person',
      ref: p.id,
      title: p.name,
      species: PERSON_SPECIES[at],
      weight: Math.sqrt(list.length / maxN),
      person: p,
      moments: list,
    };
  });

  // Encuentros próximos: peces payaso.
  const until = addDays(today, 30);
  const meets = ws.entries
    .filter((e) => e.kind === 'Encuentro')
    .map((e) => ({ e, day: dayOf(e.created_at) }))
    .filter((x) => x.day >= today && x.day <= until)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(0, 2);
  for (const { e, day } of meets) {
    const who = e.person_ids.flatMap((id) => byId.get(id) ?? []);
    out.push({
      id: 'm:' + e.id,
      kind: 'encounter',
      ref: e.id,
      title: e.title.trim() || (who.length ? `Encuentro con ${who[0].name.split(' ')[0]}` : 'Encuentro'),
      species: 'payaso',
      weight: clamp(1 - daysBetween(today, day) / 30, 0.2, 1),
      entry: e,
      who,
      day,
    });
  }

  // Sin datos propios, dos residentes para que el acuario no esté vacío.
  if (!out.length)
    out.push(
      { id: 'r:payaso', kind: 'resident', ref: '', title: 'Pez payaso', species: 'payaso', weight: 0.5 },
      { id: 'r:cirujano', kind: 'resident', ref: '', title: 'Pez cirujano', species: 'cirujano', weight: 0.4 },
    );
  return out;
}

export class School implements Scene {
  focus: string | null = null;
  selected: string | null = null;
  hover: string | null = null;
  /** Nadan siempre: el escenario lo anima con fluidez también en reposo. */
  live = true;
  private agents: Agent[] = [];
  private fish: Fish[] = [];
  private groups: Group[] = [];
  private pellets: Pellet[] = [];
  private bubbles: Bubble[] = [];
  private nextBubble = 0;
  private w = 0;
  private h = 0;
  private unit = 30;
  private top = 6;
  private sand = 100;
  private T = 0;
  private sig: Signals;
  private nav: Nav;
  private reduced: boolean;
  private remember: SceneInit['remember'];
  private grown: Record<string, number>;
  private speed = 20;
  private cohesion = 0.6;
  private rand = seeded(42);

  constructor({ sig, nav, reduced, mem, remember }: SceneInit) {
    this.sig = sig;
    this.nav = nav;
    this.reduced = reduced;
    this.remember = remember;
    const g = mem.grow;
    this.grown =
      g && typeof g === 'object'
        ? Object.fromEntries(
            Object.entries(g as Record<string, unknown>).filter(
              (x): x is [string, number] => typeof x[1] === 'number',
            ),
          )
        : {};
    this.setData(sig);
  }

  /** Datos nuevos: los peces que siguen se conservan; los nuevos llegan nadando; los demás se van. */
  setData(sig: Signals) {
    this.sig = sig;
    const next = swimmersOf(sig);
    const ids = new Set(next.map((s) => s.id));
    for (const a of this.agents) if (!ids.has(a.id)) a.gone = true;
    for (const s of next) {
      const a = this.agents.find((x) => x.id === s.id);
      if (a) {
        Object.assign(a, s, { gone: false });
        continue;
      }
      const seed = hashOf(s.id);
      const r = seeded(seed);
      this.agents.push({
        ...s,
        x: this.w ? this.w * (0.15 + 0.7 * r()) : 0,
        y: this.w ? lerp(this.top + 20, this.sand - 20, r()) : 0,
        vx: (r() - 0.5) * 30,
        vy: 0,
        face: r() < 0.5 ? -1 : 1,
        ph: r() * TAU,
        state: 'wander',
        until: 0,
        think: r(),
        tx: 0,
        ty: 0,
        other: null,
        pellet: null,
        cruise: 0.85 + 0.3 * r(),
        burst: 0,
        grow: clamp(this.grown[s.id] ?? 0, 0, MAX_GROW),
        gulp: 0,
        alpha: 0,
        gone: false,
        seed: seed % 1000,
      });
    }

    // Bancos: uno por tipo de asunto abierto (o uno tranquilo).
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
            cx: this.w / 2,
            cy: this.h / 2,
            seed: hashOf(d.key) % 1000,
          };
    });
    const want = data.map((d) =>
      d === CALM ? 12 : clamp(Math.round(3 + 2.2 * Math.sqrt(d.items.length)), 4, 10),
    );
    const fish: Fish[] = [];
    this.groups.forEach((g, gi) => {
      const oldIndex = old.findIndex((o) => o.key === g.key);
      const mine = oldIndex >= 0 ? this.fish.filter((f) => f.g === oldIndex) : [];
      for (let i = 0; i < want[gi]; i++) {
        const f = mine[i];
        fish.push(f ? { ...f, g: gi } : this.spawnFish(gi));
      }
    });
    this.fish = fish.slice(0, 40);
  }

  private spawnFish(g: number): Fish {
    const a = this.rand() * TAU;
    const grp = this.groups[g];
    return {
      x: (grp?.cx || this.w / 2) + Math.cos(a) * 20,
      y: (grp?.cy || this.h / 2) + Math.sin(a) * 12,
      vx: Math.cos(a) * 10,
      vy: Math.sin(a) * 6,
      g,
      ph: this.rand() * TAU,
      len: 0.85 + this.rand() * 0.35,
    };
  }

  resize(w: number, h: number) {
    const first = !this.w;
    this.w = w;
    this.h = h;
    this.unit = clamp(Math.min(w / 9, h / 4.2), 18, 40);
    this.top = 6;
    this.sand = h - Math.max(10, h * 0.1);
    if (!first) return;
    for (const a of this.agents) {
      const r = seeded(a.seed + 7);
      a.x = w * (0.12 + 0.76 * r());
      a.y = lerp(this.top + 24, this.sand - 24, r());
      this.target(a);
    }
    this.groups.forEach((g, i) => {
      g.cx = w * (0.25 + (0.5 * (i + 0.5)) / this.groups.length);
      g.cy = h * 0.45;
    });
    for (const f of this.fish) {
      const g = this.groups[f.g];
      f.x = g.cx + (this.rand() - 0.5) * 40;
      f.y = g.cy + (this.rand() - 0.5) * 24;
    }
  }

  /** Largo actual de un pez propio (con lo que ha crecido y el bocado de este momento). */
  private lenOf(a: Agent) {
    const base = this.unit * (a.kind === 'encounter' ? 0.92 : 0.78 + 0.5 * a.weight);
    return base * (1 + a.grow) * (1 + 0.06 * a.gulp);
  }

  /** Un sitio nuevo al que ir, dentro del agua y lejos de los bordes. */
  private target(a: Agent, far = false) {
    const L = this.lenOf(a);
    const m = L * 0.7 + 6;
    let x = lerp(m, this.w - m, Math.random());
    if (far) x = a.x < this.w / 2 ? lerp(this.w * 0.6, this.w - m, Math.random()) : lerp(m, this.w * 0.4, Math.random());
    a.tx = x;
    a.ty = lerp(this.top + m, this.sand - m * 0.8, Math.random());
    a.until = this.T + 3 + Math.random() * 5;
  }

  private get anemone() {
    return { x: this.w * 0.7, y: this.sand - this.unit * 0.35 };
  }

  /** Cada medio segundo, más o menos, cada pez decide qué hacer (nunca igual dos veces). */
  private decide(a: Agent) {
    const T = this.T;
    if (a.state === 'fight' || ((a.state === 'flee' || a.state === 'chase') && T < a.until)) return;
    // Comida a la vista: casi siempre gana.
    const food = this.nearestPellet(a.x, a.y, 260);
    if (food && Math.random() < 0.9) {
      a.state = 'eat';
      a.pellet = food;
      return;
    }
    if (a.state === 'eat' || a.state === 'flee' || a.state === 'chase') {
      a.state = 'wander';
      a.other = null;
      this.target(a);
    }
    if (a.state === 'home' && T < a.until) return;
    const sp = SPECIES[a.species];
    const r = Math.random();
    const rivals = this.agents.filter(
      (o) => o !== a && !o.gone && o.state !== 'fight' && Math.hypot(o.x - a.x, o.y - a.y) < this.w * 0.45,
    );
    if (rivals.length && r < 0.07 * sp.agg) {
      // Persigue a otro: el otro huye.
      const o = rivals[Math.floor(Math.random() * rivals.length)];
      a.state = 'chase';
      a.other = o;
      a.until = T + 1.4 + Math.random() * 1.8;
      o.state = 'flee';
      o.other = a;
      o.until = a.until + 0.4;
      return;
    }
    if (a.species === 'payaso' && r > 0.9) {
      // El payaso vuelve un rato a su anémona.
      a.state = 'home';
      a.until = T + 3 + Math.random() * 4;
      return;
    }
    if (r > 0.82 && r <= 0.9) {
      // Un arranque: se va lejos, rápido.
      a.burst = T + 0.5 + Math.random() * 0.5;
      this.target(a, true);
      return;
    }
    if (a.state !== 'wander') {
      a.state = 'wander';
      this.target(a);
    } else if (T > a.until || Math.hypot(a.tx - a.x, a.ty - a.y) < this.lenOf(a)) this.target(a);
  }

  private nearestPellet(x: number, y: number, reach: number) {
    let best: Pellet | null = null;
    let bd = reach;
    for (const p of this.pellets) {
      if (p.eaten) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private bubble(x: number, y: number, r = 1 + Math.random() * 1.6) {
    if (this.bubbles.length < 60)
      this.bubbles.push({ x, y, r, vy: -(18 + Math.random() * 16), ph: Math.random() * TAU });
  }

  update(dt: number, t: number, p: Pointer) {
    if (!this.w) return;
    const slow = this.reduced ? 0.55 : 1;
    this.T += dt;
    const T = this.T;
    const W = this.w;

    this.updateAgents(dt * slow, T, p);
    this.updateSchools(dt * slow, t, p);

    // Comida: se hunde despacio, se mece y, si nadie la come, se deshace en el fondo.
    for (const f of this.pellets) {
      f.age += dt;
      if (f.landed) {
        f.landed += dt;
        continue;
      }
      f.vy = approach(f.vy, 15, 1.2, dt);
      f.vx = approach(f.vx, noise1(f.age * 0.8 + f.x, 3) * 6, 2, dt);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.y >= this.sand - 2) {
        f.y = this.sand - 2;
        f.landed = 0.001;
      }
    }
    this.pellets = this.pellets.filter((f) => !f.eaten && f.age < 22 && f.landed < 8);

    // Burbujas: el aireador del fondo y las que sueltan los peces.
    this.nextBubble -= dt;
    if (this.nextBubble <= 0) {
      this.nextBubble = 0.3 + Math.random() * 0.6;
      this.bubble(W * 0.88 + (Math.random() - 0.5) * 4, this.sand - 2);
    }
    for (const b of this.bubbles) {
      b.ph += dt * 3;
      b.y += b.vy * dt * slow;
      b.x += Math.sin(b.ph) * 8 * dt;
      b.r = Math.min(3.2, b.r + dt * 0.25);
    }
    this.bubbles = this.bubbles.filter((b) => b.y > this.top + 2);
    this.agents = this.agents.filter((a) => !(a.gone && a.alpha < 0.01));
  }

  private updateAgents(dt: number, T: number, p: Pointer) {
    const W = this.w;
    const live = this.agents;
    for (const a of live) {
      a.alpha = approach(a.alpha, a.gone ? 0 : 1, 1.5, dt);
      a.gulp = Math.max(0, a.gulp - dt * 3);
      a.think -= dt;
      if (a.think <= 0) {
        a.think = 0.35 + Math.random() * 0.55;
        this.decide(a);
      }
      const L = this.lenOf(a);
      const cruise = this.unit * 0.95 * SPECIES[a.species].speed * a.cruise;
      let spd = cruise * (T < a.burst ? 2.6 : 1);
      let tx = a.tx;
      let ty = a.ty;

      // Los estados se acaban solos.
      if ((a.state === 'chase' || a.state === 'flee') && T > a.until) {
        a.state = 'wander';
        a.other = null;
        this.target(a);
      }
      if (a.state === 'fight' && T > a.until && a.other) {
        // Se separan: el más pequeño (o uno al azar) huye un rato.
        const o = a.other;
        const loser = this.lenOf(a) < this.lenOf(o) || (Math.abs(this.lenOf(a) - this.lenOf(o)) < 2 && Math.random() < 0.5) ? a : o;
        const winner = loser === a ? o : a;
        loser.state = 'flee';
        loser.other = winner;
        loser.until = T + 1.4 + Math.random();
        winner.state = 'wander';
        winner.other = null;
        this.target(winner);
      }
      if (a.state === 'eat' && (!a.pellet || a.pellet.eaten)) {
        a.pellet = this.nearestPellet(a.x, a.y, 260);
        if (!a.pellet) {
          a.state = 'wander';
          this.target(a);
        }
      }

      let dvx = 0;
      let dvy = 0;
      switch (a.state) {
        case 'chase': {
          const o = a.other!;
          tx = o.x + o.vx * 0.3;
          ty = o.y + o.vy * 0.3;
          spd = cruise * 2.1;
          if (Math.hypot(o.x - a.x, o.y - a.y) < (L + this.lenOf(o)) * 0.42) {
            // Lo alcanza: un forcejeo breve.
            const until = T + 0.8 + Math.random() * 0.7;
            a.state = 'fight';
            o.state = 'fight';
            a.other = o;
            o.other = a;
            a.until = until;
            o.until = until;
          }
          break;
        }
        case 'flee': {
          const o = a.other;
          if (o) {
            const dx = a.x - o.x;
            const dy = a.y - o.y;
            const d = Math.hypot(dx, dy) || 1;
            tx = a.x + (dx / d) * 80;
            ty = a.y + (dy / d) * 50;
          }
          spd = cruise * 2.3;
          break;
        }
        case 'fight': {
          const o = a.other!;
          const mx = (a.x + o.x) / 2;
          const my = (a.y + o.y) / 2;
          const rx = a.x - mx;
          const ry = a.y - my;
          const d = Math.hypot(rx, ry) || 1;
          const want = (L + this.lenOf(o)) * 0.28;
          // Giran uno alrededor del otro, con sacudidas.
          dvx = (-ry / d) * cruise * 1.7 + (rx / d) * (want - d) * 4 + (Math.random() - 0.5) * cruise * 2;
          dvy = (rx / d) * cruise * 1.7 + (ry / d) * (want - d) * 4 + (Math.random() - 0.5) * cruise * 2;
          if (Math.random() < dt * 5) this.bubble(mx + (Math.random() - 0.5) * 8, my - 4);
          break;
        }
        case 'eat': {
          const f = a.pellet!;
          tx = f.x;
          ty = f.y;
          spd = cruise * 1.8;
          if (Math.hypot(f.x - (a.x + a.face * L * 0.4), f.y - a.y) < L * 0.32 + 3) {
            f.eaten = true;
            a.gulp = 1;
            a.grow = Math.min(MAX_GROW, a.grow + BITE);
            this.grown[a.id] = a.grow;
            this.remember('grow', { ...this.grown });
            this.bubble(a.x + a.face * L * 0.5, a.y - 2, 1);
          }
          break;
        }
        case 'home': {
          const an = this.anemone;
          tx = an.x + Math.cos(T * 1.2 + a.seed) * this.unit * 0.6;
          ty = an.y - this.unit * 0.25 + Math.sin(T * 1.7 + a.seed) * this.unit * 0.18;
          spd = cruise * 0.8;
          break;
        }
        default:
          // Deambula con un serpenteo propio.
          ty += Math.sin(T * 0.9 + a.seed) * L * 0.4;
      }
      if (a.state !== 'fight') {
        const dx = tx - a.x;
        const dy = ty - a.y;
        const d = Math.hypot(dx, dy) || 1;
        dvx = (dx / d) * spd;
        dvy = (dy / d) * spd * 0.7;
      }

      // No se montan unos sobre otros (salvo al pelear).
      for (const o of live) {
        if (o === a || (a.state === 'fight' && a.other === o)) continue;
        const dx = a.x - o.x;
        const dy = a.y - o.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = (L + this.lenOf(o)) * 0.4;
        if (d < min) {
          dvx += (dx / d) * (min - d) * 3;
          dvy += (dy / d) * (min - d) * 3;
        }
      }
      // Paredes, superficie y fondo, blandos.
      const m = L * 0.6;
      if (a.x < m) dvx += (m - a.x) * 4;
      if (a.x > W - m) dvx -= (a.x - (W - m)) * 4;
      if (a.y < this.top + m * 0.6) dvy += (this.top + m * 0.6 - a.y) * 4;
      if (a.y > this.sand - m * 0.5) dvy -= (a.y - (this.sand - m * 0.5)) * 4;
      // Un movimiento brusco del puntero cerca los asusta.
      if (p.inside) {
        const dx = a.x - p.x;
        const dy = a.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const fast = Math.hypot(p.vx, p.vy);
        if (d < L * 1.6 && fast > 220) {
          dvx += (dx / d) * cruise * 2.5;
          dvy += (dy / d) * cruise * 1.5;
        }
      }

      const steer = a.state === 'chase' || a.state === 'flee' || a.state === 'fight' ? 4 : 2.2;
      const k = Math.min(1, steer * dt);
      a.vx += (dvx - a.vx) * k;
      a.vy += (dvy - a.vy) * k;
      // Nunca se quedan quietos.
      const v = Math.hypot(a.vx, a.vy);
      const min = cruise * 0.35;
      if (v < min) {
        const dir = v > 0.01 ? a.vx / v : a.face;
        a.vx = (dir || 1) * min;
      }
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      if (Math.abs(a.vx) > 3) a.face = approach(a.face, Math.sign(a.vx), 5, dt);
      a.ph += dt * (6 + Math.hypot(a.vx, a.vy) * 0.12) * (a.species === 'payaso' ? 1.35 : 1);
    }
  }

  private updateSchools(dt: number, t: number, p: Pointer) {
    const r = this.sig.rhythm;
    this.speed = approach(this.speed, 14 + 26 * r.level, 0.5, dt);
    this.cohesion = approach(this.cohesion, 0.25 + 0.75 * (r.activeDays / 7), 0.5, dt);
    const sp = this.speed;
    const W = this.w;
    const top = this.top;
    const bottom = this.sand;

    // Cada banco recorre el acuario sin rumbo fijo.
    for (const g of this.groups) {
      g.cx = W * (0.5 + 0.38 * noise1(t * 0.035 + g.seed, 1));
      g.cy = lerp(top + 20, bottom - 20, 0.5 + 0.42 * noise1(t * 0.045 + g.seed, 2));
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
        const keep = same ? 9 : 18;
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
      ax += (g.cx - f.x) * 0.2 * (0.4 + this.cohesion);
      ay += (g.cy - f.y) * 0.2 * (0.4 + this.cohesion);

      // Los peces grandes los dispersan.
      for (const a of this.agents) {
        const dx = f.x - a.x;
        const dy = f.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const reach = this.lenOf(a) * 0.9 + 18;
        if (d < reach) {
          const k = (1 - d / reach) * 220;
          ax += (dx / d) * k;
          ay += (dy / d) * k;
        }
      }
      // La comida cercana también les interesa.
      const food = this.nearestPellet(f.x, f.y, 70);
      if (food) {
        ax += (food.x - f.x) * 2.2;
        ay += (food.y - f.y) * 2.2;
        if (Math.hypot(food.x - f.x, food.y - f.y) < 4) food.eaten = true;
      }

      const m = 12;
      if (f.x < m) ax += (m - f.x) * 6;
      if (f.x > W - m) ax -= (f.x - (W - m)) * 6;
      if (f.y < top + m) ay += (top + m - f.y) * 6;
      if (f.y > bottom - m) ay -= (f.y - (bottom - m)) * 6;

      if (p.inside) {
        const dx = f.x - p.x;
        const dy = f.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 90) {
          const k = (1 - d / 90) ** 2;
          ax += p.vx * k * 1.4 - (dy / d) * k * 14;
          ay += p.vy * k * 1.4 + (dx / d) * k * 14;
        }
      }

      f.vx += ax * dt;
      f.vy += ay * dt;
      const v = Math.hypot(f.vx, f.vy) || 1;
      const target = clamp(v, sp * 0.5, sp * 3);
      const relaxed = approach(target, sp, 0.8, dt);
      f.vx = (f.vx / v) * relaxed;
      f.vy = (f.vy / v) * relaxed * Math.exp(-dt * 1.2);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.ph += dt * (4 + relaxed * 0.2);
    }
  }

  // ───────── Dibujo ─────────

  draw(g: CanvasRenderingContext2D, t: number) {
    if (!this.w) return;
    const tt = this.reduced ? t * 0.5 : t;
    const lit = this.selected ?? this.hover;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    this.drawWater(g, tt);
    this.drawBed(g, tt, false);
    this.drawSchools(g);
    this.drawPellets(g);
    const order = [...this.agents].sort((a, b) => this.lenOf(a) - this.lenOf(b));
    for (const a of order) this.drawAgent(g, a, lit);
    this.drawBubbles(g);
    this.drawBed(g, tt, true);
  }

  /** Agua apenas teñida, rayos de luz que se mueven y el brillo de la superficie. */
  private drawWater(g: CanvasRenderingContext2D, tt: number) {
    const { w, h, top } = this;
    const water = g.createLinearGradient(0, 0, 0, h);
    water.addColorStop(0, rgba('#bfe0ea', 0.22));
    water.addColorStop(0.75, rgba('#cfe6ea', 0.08));
    water.addColorStop(1, rgba('#e8e0cc', 0.02));
    g.fillStyle = water;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const x0 = w * (0.18 + 0.32 * i) + Math.sin(tt * 0.12 + i * 1.7) * w * 0.05;
      const spread = w * 0.06 + Math.sin(tt * 0.2 + i) * w * 0.015;
      const ray = g.createLinearGradient(0, 0, 0, h * 0.9);
      ray.addColorStop(0, rgba('#ffffff', 0.32));
      ray.addColorStop(1, rgba('#ffffff', 0));
      g.fillStyle = ray;
      g.beginPath();
      g.moveTo(x0 - 7, 0);
      g.lineTo(x0 + 7, 0);
      g.lineTo(x0 + spread + w * 0.04, h * 0.9);
      g.lineTo(x0 + spread - w * 0.03, h * 0.9);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = rgba('#7fb3c4', 0.22);
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = top + Math.sin(x * 0.05 + tt * 1.4) * 1.2 + Math.sin(x * 0.11 - tt) * 0.6;
      if (x) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  }

  /** El fondo: arena, piedras, algas que se mecen y la anémona. `front`: el alga de adelante. */
  private drawBed(g: CanvasRenderingContext2D, tt: number, front: boolean) {
    const { w, h, sand, unit } = this;
    // El alga se mece entera: más arriba, más amplio; la onda sube despacio por ella.
    const sway = (f: number, i: number) =>
      Math.sin(tt * 0.7 + i * 1.9 - f * 2.4) * f * f * unit * 0.55;
    const kelp = (x: number, hgt: number, width: number, i: number, color: string, a: number) => {
      const N = 14;
      const pts: [number, number][] = [];
      for (let k = 0; k <= N; k++) {
        const f = k / N;
        pts.push([x + sway(f, i), sand + 2 - f * hgt]);
      }
      g.fillStyle = rgba(color, a);
      g.beginPath();
      pts.forEach(([px, py], k) => {
        const half = width * (1 - (k / N) * 0.85);
        if (k) g.lineTo(px - half, py);
        else g.moveTo(px - half, py);
      });
      for (let k = N; k >= 0; k--) {
        const [px, py] = pts[k];
        g.lineTo(px + width * (1 - (k / N) * 0.85), py);
      }
      g.closePath();
      g.fill();
    };
    if (front) {
      kelp(w * 0.08, h * 0.5, unit * 0.13, 4, '#5f8a55', 0.42);
      return;
    }
    kelp(w * 0.16, h * 0.42, unit * 0.12, 0, '#7fa36a', 0.38);
    kelp(w * 0.2, h * 0.3, unit * 0.1, 1, '#8fb478', 0.32);
    kelp(w * 0.92, h * 0.45, unit * 0.12, 2, '#6f9a5e', 0.36);

    // Piedras.
    for (const [x, rx, ry] of [
      [w * 0.33, unit * 0.75, unit * 0.32],
      [w * 0.86, unit * 0.55, unit * 0.26],
    ]) {
      const st = g.createRadialGradient(x - rx * 0.3, sand - ry * 0.6, 1, x, sand, rx);
      st.addColorStop(0, rgba('#d8d2c4', 0.75));
      st.addColorStop(1, rgba('#a9a191', 0.55));
      g.fillStyle = st;
      g.beginPath();
      g.ellipse(x, sand + 1, rx, ry, 0, Math.PI, TAU);
      g.fill();
    }

    // Arena.
    g.fillStyle = rgba('#e3d6b6', 0.5);
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 12) g.lineTo(x, sand + Math.sin(x * 0.03) * 1.5);
    g.lineTo(w, h);
    g.closePath();
    g.fill();

    // La anémona del payaso: tentáculos que se mecen.
    const an = this.anemone;
    g.fillStyle = rgba('#c87aa2', 0.7);
    g.beginPath();
    g.ellipse(an.x, sand, unit * 0.42, unit * 0.16, 0, Math.PI, TAU);
    g.fill();
    for (let i = 0; i < 16; i++) {
      const f = i / 15 - 0.5;
      const bx = an.x + f * unit * 0.75;
      const len = unit * (0.55 + 0.25 * Math.cos(f * 3));
      const s = Math.sin(tt * 1.3 + i * 0.7) * unit * 0.12;
      const ex = bx + f * unit * 0.5 + s;
      const ey = sand - len;
      g.strokeStyle = rgba(i % 2 ? '#e7a0c4' : '#dc8fb8', 0.85);
      g.lineWidth = Math.max(2, unit * 0.07);
      g.beginPath();
      g.moveTo(bx, sand - unit * 0.1);
      g.quadraticCurveTo(bx + f * unit * 0.2 - s * 0.5, sand - len * 0.6, ex, ey);
      g.stroke();
      g.fillStyle = rgba('#f7d0e2', 0.95);
      g.beginPath();
      g.arc(ex, ey, Math.max(1.2, unit * 0.045), 0, TAU);
      g.fill();
    }
  }

  /** Los bancos: peces pequeños (tetras) con una franja del color de su grupo. */
  private drawSchools(g: CanvasRenderingContext2D) {
    const L0 = Math.max(7, this.unit * 0.26);
    for (const f of this.fish) {
      const grp = this.groups[f.g];
      const L = L0 * f.len;
      const face = f.vx >= 0 ? 1 : -1;
      const pitch = clamp(Math.atan2(f.vy, Math.abs(f.vx)), -0.5, 0.5);
      const wag = Math.sin(f.ph) * 0.4;
      g.save();
      g.translate(f.x, f.y);
      g.rotate(pitch * face);
      g.scale(face, 1);
      g.fillStyle = rgba('#b9c9cf', 0.82);
      g.beginPath();
      g.ellipse(0, 0, L * 0.5, L * 0.17, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(-L * 0.4, 0);
      g.lineTo(-L * 0.72, wag * L * 0.18 + L * 0.13);
      g.lineTo(-L * 0.72, wag * L * 0.18 - L * 0.13);
      g.closePath();
      g.fill();
      g.strokeStyle = rgba(mix(grp.color, '#3aa0d0', 0.2), 0.95);
      g.lineWidth = Math.max(1, L * 0.09);
      g.beginPath();
      g.moveTo(L * 0.3, -L * 0.02);
      g.lineTo(-L * 0.36, -L * 0.02);
      g.stroke();
      g.fillStyle = rgba(INK, 0.7);
      g.beginPath();
      g.arc(L * 0.3, -L * 0.04, Math.max(0.6, L * 0.05), 0, TAU);
      g.fill();
      g.restore();
    }
  }

  private drawPellets(g: CanvasRenderingContext2D) {
    for (const f of this.pellets) {
      const a = f.landed ? Math.max(0, 1 - f.landed / 8) : 1;
      g.fillStyle = rgba('#9a6a3a', 0.85 * a);
      g.beginPath();
      g.arc(f.x, f.y, 1.7, 0, TAU);
      g.fill();
    }
  }

  private drawBubbles(g: CanvasRenderingContext2D) {
    g.lineWidth = 0.8;
    for (const b of this.bubbles) {
      g.strokeStyle = rgba('#7fb3c4', 0.55);
      g.fillStyle = rgba('#ffffff', 0.35);
      g.beginPath();
      g.arc(b.x, b.y, b.r, 0, TAU);
      g.fill();
      g.stroke();
    }
  }

  /** Un pez propio: su especie, girando de verdad al cambiar de rumbo, y su realce al pasar. */
  private drawAgent(g: CanvasRenderingContext2D, a: Agent, lit: string | null) {
    const L = this.lenOf(a);
    const on = lit === a.id;
    const alpha = a.alpha * (lit && !on ? 0.55 : 1);
    if (alpha < 0.01) return;
    const pitch = clamp(Math.atan2(a.vy, Math.abs(a.vx) + 1), -0.45, 0.45);
    const face = Math.abs(a.face) < 0.14 ? Math.sign(a.face || 1) * 0.14 : a.face;
    if (on) {
      const halo = g.createRadialGradient(a.x, a.y, L * 0.1, a.x, a.y, L * 0.85);
      halo.addColorStop(0, rgba('#ffffff', 0.55));
      halo.addColorStop(1, rgba('#ffffff', 0));
      g.fillStyle = halo;
      g.beginPath();
      g.arc(a.x, a.y, L * 0.85, 0, TAU);
      g.fill();
    }
    g.save();
    g.globalAlpha = alpha;
    g.translate(a.x, a.y);
    g.rotate(pitch * Math.sign(face));
    g.scale(face, 1);
    const wag = Math.sin(a.ph);
    switch (a.species) {
      case 'payaso':
        drawClown(g, L, wag, a.ph);
        break;
      case 'cirujano':
        drawTang(g, L, wag, a.ph);
        break;
      case 'angel':
        drawAngel(g, L, wag, a.ph);
        break;
      case 'mariposa':
        drawButterfly(g, L, wag, a.ph);
        break;
      case 'dorado':
        drawGoldfish(g, L, wag, a.ph);
        break;
    }
    g.restore();
    if (this.focus === a.id) focusRing(g, a.x, a.y, L * 0.55);
  }

  // ───────── Explorar ─────────

  private hintOf(a: Agent) {
    if (a.kind === 'person') {
      const n = a.moments?.length ?? 0;
      return `${a.title} · ${n === 1 ? 'un buen momento' : `${n} buenos momentos`}`;
    }
    if (a.kind === 'encounter')
      return `${a.title} · ${a.day ? friendlyDate(a.day, this.sig.today).toLowerCase() : 'pronto'}`;
    return SPECIES[a.species].name;
  }

  spots(): Spot[] {
    return this.agents
      .filter((a) => !a.gone)
      .map((a) => ({
        id: a.id,
        x: a.x,
        y: a.y,
        r: this.lenOf(a) * 0.5,
        hint: this.hintOf(a),
      }));
  }

  /** Solo los peces propios se tocan; los bancos y el agua no (el agua recibe la comida). */
  hit(x: number, y: number, touch: boolean): Spot | null {
    const pad = touch ? 12 : 4;
    let best: Agent | null = null;
    let bd = Infinity;
    for (const a of this.agents) {
      if (a.gone) continue;
      const L = this.lenOf(a);
      // Un óvalo a lo largo del pez.
      const dx = (x - a.x) / (L * 0.55 + pad);
      const dy = (y - a.y) / (L * 0.32 + pad);
      const d = dx * dx + dy * dy;
      if (d <= 1 && d < bd) {
        bd = d;
        best = a;
      }
    }
    return best
      ? { id: best.id, x: best.x, y: best.y, r: this.lenOf(best) * 0.45, hint: this.hintOf(best) }
      : null;
  }

  /** Un toque en el agua (sin pez debajo) echa un puñado de comida. */
  grab(id: string | null, p: Pointer) {
    if (id || p.y > this.sand - 4) return false;
    const n = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n && this.pellets.length < 36; i++)
      this.pellets.push({
        x: p.x + (Math.random() - 0.5) * 18,
        y: Math.max(this.top + 2, p.y + (Math.random() - 0.5) * 8),
        vx: (Math.random() - 0.5) * 10,
        vy: Math.random() * 6,
        age: 0,
        landed: 0,
        eaten: false,
      });
    // Los peces cercanos se enteran enseguida.
    for (const a of this.agents) if (a.state !== 'fight') a.think = Math.random() * 0.3;
    return false;
  }

  explain(id: string): Reveal | null {
    const a = this.agents.find((x) => x.id === id);
    if (!a) return null;
    const today = this.sig.today;
    const fed = a.grow > 0.001 ? ` Ha crecido un ${Math.round(a.grow * 100)} % comiendo.` : '';
    const schools = this.schoolsText();
    if (a.kind === 'person') {
      const list = a.moments ?? [];
      const last = list[0];
      const when = last ? friendlyDate(last.day, today).toLowerCase() : '';
      return {
        title: a.title,
        text:
          list.length === 1
            ? `Un buen momento contigo ${when}: ${last.what}.`
            : `${plural(list.length, 'buen momento', 'buenos momentos')} en las últimas 4 semanas; el último, ${when}: ${last.what}.`,
        context: `${SPECIES[a.species].name}: su tamaño sigue esos momentos.${fed} ${schools}`,
        action: { label: 'Ver su ficha', run: () => this.nav.person(a.ref) },
      };
    }
    if (a.kind === 'encounter') {
      const names = (a.who ?? []).map((p) => p.name.split(' ')[0]);
      const when = a.day ? friendlyDate(a.day, today).toLowerCase() : 'pronto';
      return {
        title: a.title,
        text: names.length
          ? `Encuentro ${when} con ${names.join(', ')}.`
          : `Encuentro ${when}.`,
        context: `Los peces payaso son tus encuentros próximos; más grande cuanto más cerca está.${fed} ${schools}`,
        action: { label: 'Ver el encuentro', run: () => this.nav.viewEntry(a.ref) },
      };
    }
    return {
      title: SPECIES[a.species].name,
      text: 'Vive aquí mientras llegan los peces de tus personas y tus encuentros.',
      context: `Las personas con las que tuviste un buen momento hace poco nadan aquí, cada una con su especie; tus encuentros próximos son peces payaso.${fed} ${schools}`,
    };
  }

  /** Lo que dicen los bancos (no se tocan, pero se cuentan en cada explicación). */
  private schoolsText() {
    const open = this.groups.filter((g) => g.data);
    const r = this.sig.rhythm;
    const motion = `Nadan según tu ritmo: ${rhythmText(r).charAt(0).toLowerCase()}${rhythmText(r).slice(1)}`;
    if (!open.length) return `Los bancos pequeños son tus asuntos abiertos; ahora hay uno solo, en calma. ${motion}`;
    const parts = open.map((g) => `${g.data!.label.toLowerCase()} (${g.data!.items.length})`);
    return `Los bancos pequeños son tus asuntos abiertos: ${parts.join(', ')}. ${motion}`;
  }
}

// ───────── Especies (dibujadas mirando a la derecha, centro en 0,0, largo L) ─────────

/** Cuerpo fusiforme: nariz en +L·nose, base de la cola en L·tail. */
function bodyPath(g: CanvasRenderingContext2D, L: number, H: number, nose = 0.48, tail = -0.3) {
  g.beginPath();
  g.moveTo(L * nose, H * 0.04);
  g.bezierCurveTo(L * nose * 0.95, -H * 0.62, L * -0.02, -H * 0.66, L * tail, -H * 0.16);
  g.lineTo(L * tail, H * 0.16);
  g.bezierCurveTo(L * -0.02, H * 0.66, L * nose * 0.95, H * 0.6, L * nose, H * 0.04);
  g.closePath();
}

/**
 * Aleta caudal en abanico que se mece. `edge` da la forma del borde de atrás: positivo, en
 * horquilla (cuánto entra la muesca); negativo, redondeado.
 */
function tailPath(
  g: CanvasRenderingContext2D,
  L: number,
  H: number,
  wag: number,
  { at = -0.28, len = 0.24, spread = 0.46, edge = 0 } = {},
) {
  const bx = L * at;
  const tx = bx - L * len;
  const s = wag * H * 0.22;
  g.beginPath();
  g.moveTo(bx + L * 0.04, -H * 0.12);
  g.quadraticCurveTo(bx - L * len * 0.45, -H * spread * 0.45 + s * 0.6, tx, -H * spread + s);
  g.quadraticCurveTo(tx + L * len * edge * 1.6, s, tx, H * spread + s);
  g.quadraticCurveTo(bx - L * len * 0.45, H * spread * 0.45 + s * 0.6, bx + L * 0.04, H * 0.12);
  g.closePath();
}

function eye(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.fillStyle = '#1b1d1a';
  g.beginPath();
  g.arc(x + r * 0.15, y, r * 0.62, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(x + r * 0.35, y - r * 0.3, r * 0.22, 0, TAU);
  g.fill();
}

/** Aleta pectoral que aletea. */
function pectoral(g: CanvasRenderingContext2D, L: number, H: number, ph: number, fill: string, edge?: string) {
  const flap = 0.35 + 0.3 * Math.sin(ph * 1.6);
  g.save();
  g.translate(L * 0.12, H * 0.14);
  g.rotate(0.7 + flap);
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(-H * 0.14, 0, H * 0.2, H * 0.09, 0, 0, TAU);
  g.fill();
  if (edge) {
    g.strokeStyle = edge;
    g.lineWidth = Math.max(0.6, H * 0.03);
    g.stroke();
  }
  g.restore();
}

/** Pez payaso: naranja, tres franjas blancas con borde negro y aletas redondas. */
function drawClown(g: CanvasRenderingContext2D, L: number, wag: number, ph: number) {
  const H = L * 0.46;
  const edge = '#1d1b19';
  const lw = Math.max(0.8, L * 0.025);
  g.fillStyle = '#f07a24';
  g.strokeStyle = edge;
  g.lineWidth = lw;
  // Aleta dorsal en dos lóbulos y anal, por detrás del cuerpo.
  g.beginPath();
  g.moveTo(L * 0.16, -H * 0.4);
  g.quadraticCurveTo(L * 0.1, -H * 0.78, L * -0.02, -H * 0.5);
  g.quadraticCurveTo(L * -0.14, -H * 0.8, L * -0.27, -H * 0.2);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(L * 0.02, H * 0.4);
  g.quadraticCurveTo(L * -0.12, H * 0.78, L * -0.25, H * 0.22);
  g.closePath();
  g.fill();
  g.stroke();
  tailPath(g, L, H, wag, { len: 0.2, spread: 0.42, edge: -0.4 });
  g.fill();
  g.stroke();
  // Cuerpo con su brillo.
  bodyPath(g, L, H, 0.48, -0.28);
  const grad = g.createLinearGradient(0, -H * 0.5, 0, H * 0.5);
  grad.addColorStop(0, '#ffa04a');
  grad.addColorStop(1, '#e8661a');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  const band = (x: number, w: number) => {
    g.fillStyle = '#ffffff';
    g.strokeStyle = edge;
    g.lineWidth = lw * 1.3;
    g.beginPath();
    g.ellipse(x, 0, w, H * 0.75, 0, 0, TAU);
    g.fill();
    g.stroke();
  };
  band(L * 0.24, L * 0.05);
  band(L * 0.0, L * 0.065);
  band(L * -0.24, L * 0.035);
  g.restore();
  bodyPath(g, L, H, 0.48, -0.28);
  g.strokeStyle = 'rgba(29,27,25,0.55)';
  g.lineWidth = lw * 0.8;
  g.stroke();
  pectoral(g, L, H, ph, '#f58a33', edge);
  eye(g, L * 0.33, -H * 0.1, H * 0.12);
}

/** Pez cirujano azul: cuerpo azul, la «paleta» oscura y la cola amarilla. */
function drawTang(g: CanvasRenderingContext2D, L: number, wag: number, ph: number) {
  const H = L * 0.52;
  tailPath(g, L, H, wag, { len: 0.22, spread: 0.46, edge: 0.45 });
  g.fillStyle = '#f5c21b';
  g.fill();
  g.strokeStyle = 'rgba(19, 37, 77, 0.55)';
  g.lineWidth = Math.max(0.6, L * 0.014);
  g.stroke();
  g.strokeStyle = '#13254d';
  g.lineWidth = Math.max(0.8, L * 0.02);
  // Aletas dorsal y anal largas, azules con borde oscuro.
  g.fillStyle = '#2a63c8';
  g.beginPath();
  g.moveTo(L * 0.22, -H * 0.38);
  g.quadraticCurveTo(L * 0.0, -H * 0.66, L * -0.28, -H * 0.24);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(L * 0.12, H * 0.4);
  g.quadraticCurveTo(L * -0.06, H * 0.64, L * -0.28, H * 0.24);
  g.closePath();
  g.fill();
  g.stroke();
  bodyPath(g, L, H, 0.46, -0.28);
  const grad = g.createLinearGradient(0, -H * 0.5, 0, H * 0.5);
  grad.addColorStop(0, '#5a9af2');
  grad.addColorStop(1, '#2a5fc4');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  // La paleta: una franja oscura que va del ojo a la cola y vuelve.
  g.fillStyle = '#13254d';
  g.beginPath();
  g.moveTo(L * 0.3, -H * 0.18);
  g.bezierCurveTo(L * 0.1, -H * 0.42, L * -0.2, -H * 0.4, L * -0.32, -H * 0.05);
  g.bezierCurveTo(L * -0.18, -H * 0.2, L * -0.05, -H * 0.04, L * -0.12, H * 0.16);
  g.bezierCurveTo(L * 0.02, H * 0.0, L * 0.12, -H * 0.12, L * 0.3, -H * 0.06);
  g.closePath();
  g.fill();
  g.restore();
  pectoral(g, L, H, ph, '#f5c21b');
  eye(g, L * 0.31, -H * 0.1, H * 0.1);
}

/** Pez ángel: cuerpo alto plateado con franjas, aletas largas que ondean y filamentos. */
function drawAngel(g: CanvasRenderingContext2D, L: number, wag: number, ph: number) {
  const H = L * 0.62;
  const fin = 'rgba(214, 205, 182, 0.8)';
  const s = wag * H * 0.06;
  g.fillStyle = fin;
  // Dorsal y anal larguísimas, hacia atrás.
  g.beginPath();
  g.moveTo(L * 0.05, -H * 0.42);
  g.quadraticCurveTo(L * -0.12, -H * 1.05, L * -0.42 + s, -H * 1.18);
  g.quadraticCurveTo(L * -0.28, -H * 0.6, L * -0.24, -H * 0.18);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(L * 0.05, H * 0.42);
  g.quadraticCurveTo(L * -0.12, H * 1.05, L * -0.42 - s, H * 1.18);
  g.quadraticCurveTo(L * -0.28, H * 0.6, L * -0.24, H * 0.18);
  g.closePath();
  g.fill();
  tailPath(g, L, H, wag, { at: -0.24, len: 0.2, spread: 0.42, edge: -0.15 });
  g.fill();
  // Filamentos ventrales.
  g.strokeStyle = 'rgba(190, 178, 150, 0.85)';
  g.lineWidth = Math.max(0.6, L * 0.015);
  g.beginPath();
  g.moveTo(L * 0.14, H * 0.3);
  g.quadraticCurveTo(L * 0.05, H * 0.9, L * -0.08 + Math.sin(ph * 0.7) * L * 0.05, H * 1.25);
  g.stroke();
  // Cuerpo: un rombo redondeado.
  g.beginPath();
  g.moveTo(L * 0.44, 0);
  g.quadraticCurveTo(L * 0.22, -H * 0.5, L * -0.02, -H * 0.5);
  g.quadraticCurveTo(L * -0.24, -H * 0.3, L * -0.26, 0);
  g.quadraticCurveTo(L * -0.24, H * 0.3, L * -0.02, H * 0.5);
  g.quadraticCurveTo(L * 0.22, H * 0.5, L * 0.44, 0);
  g.closePath();
  const grad = g.createLinearGradient(0, -H * 0.5, 0, H * 0.5);
  grad.addColorStop(0, '#f7f3e8');
  grad.addColorStop(1, '#d9d2bf');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = 'rgba(40, 38, 34, 0.72)';
  for (const [x, w] of [
    [L * 0.26, L * 0.035],
    [L * 0.04, L * 0.05],
    [L * -0.17, L * 0.04],
  ])
    g.fillRect(x - w, -H, w * 2, H * 2);
  g.restore();
  eye(g, L * 0.3, -H * 0.06, H * 0.08);
}

/** Pez mariposa: disco amarillo, banda negra en el ojo y una mancha oscura atrás. */
function drawButterfly(g: CanvasRenderingContext2D, L: number, wag: number, ph: number) {
  const H = L * 0.66;
  g.fillStyle = 'rgba(247, 205, 70, 0.9)';
  g.strokeStyle = 'rgba(120, 90, 20, 0.6)';
  g.lineWidth = Math.max(0.6, L * 0.015);
  // Aleta dorsal continua y anal.
  g.beginPath();
  g.moveTo(L * 0.2, -H * 0.36);
  g.quadraticCurveTo(L * -0.05, -H * 0.7, L * -0.3, -H * 0.2);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(L * 0.12, H * 0.38);
  g.quadraticCurveTo(L * -0.08, H * 0.66, L * -0.3, H * 0.2);
  g.closePath();
  g.fill();
  g.stroke();
  tailPath(g, L, H, wag, { at: -0.28, len: 0.16, spread: 0.32, edge: -0.3 });
  g.fillStyle = 'rgba(250, 238, 190, 0.85)';
  g.fill();
  // Cuerpo en disco con hocico.
  g.beginPath();
  g.moveTo(L * 0.5, -H * 0.02);
  g.quadraticCurveTo(L * 0.42, -H * 0.12, L * 0.3, -H * 0.24);
  g.bezierCurveTo(L * 0.18, -H * 0.56, L * -0.22, -H * 0.56, L * -0.3, -H * 0.08);
  g.lineTo(L * -0.3, H * 0.08);
  g.bezierCurveTo(L * -0.22, H * 0.56, L * 0.18, H * 0.56, L * 0.3, H * 0.22);
  g.quadraticCurveTo(L * 0.42, H * 0.1, L * 0.5, H * 0.02);
  g.closePath();
  const grad = g.createLinearGradient(L * 0.4, 0, L * -0.3, 0);
  grad.addColorStop(0, '#fff3c4');
  grad.addColorStop(0.35, '#f8cf4a');
  grad.addColorStop(1, '#f0b62e');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = 'rgba(28, 26, 22, 0.85)';
  g.fillRect(L * 0.22, -H, L * 0.07, H * 2);
  g.fillStyle = 'rgba(28, 26, 22, 0.8)';
  g.beginPath();
  g.arc(L * -0.16, -H * 0.2, H * 0.1, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = Math.max(0.6, H * 0.03);
  g.stroke();
  g.restore();
  pectoral(g, L, H, ph, 'rgba(255, 236, 170, 0.9)');
  eye(g, L * 0.255, -H * 0.06, H * 0.075);
}

/** Pez dorado: dorado, con una cola doble enorme que ondea con retraso. */
function drawGoldfish(g: CanvasRenderingContext2D, L: number, wag: number, ph: number) {
  const H = L * 0.48;
  const fin = 'rgba(255, 170, 70, 0.55)';
  // Cola doble que ondea.
  for (const [lag, side] of [
    [0, -1],
    [0.8, 1],
  ]) {
    const w2 = Math.sin(ph - lag);
    const bx = L * -0.26;
    const tx = bx - L * 0.42;
    g.fillStyle = fin;
    g.beginPath();
    g.moveTo(bx, 0);
    g.bezierCurveTo(
      bx - L * 0.15,
      side * H * 0.5 + w2 * H * 0.15,
      tx + L * 0.05,
      side * H * 0.9 + w2 * H * 0.3,
      tx,
      side * H * 0.75 + w2 * H * 0.35,
    );
    g.quadraticCurveTo(tx + L * 0.12, side * H * 0.2 + w2 * H * 0.2, bx, side * H * 0.05);
    g.closePath();
    g.fill();
  }
  // Dorsal alta y translúcida.
  g.beginPath();
  g.moveTo(L * 0.12, -H * 0.4);
  g.quadraticCurveTo(L * -0.02, -H * 1.0 + wag * H * 0.05, L * -0.22, -H * 0.3);
  g.closePath();
  g.fill();
  bodyPath(g, L, H, 0.46, -0.26);
  const grad = g.createLinearGradient(0, -H * 0.5, 0, H * 0.5);
  grad.addColorStop(0, '#ffd166');
  grad.addColorStop(0.6, '#f6a234');
  grad.addColorStop(1, '#e98a24');
  g.fillStyle = grad;
  g.fill();
  // Escamas apenas marcadas.
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(200, 110, 20, 0.28)';
  g.lineWidth = Math.max(0.5, L * 0.012);
  for (let row = -1; row <= 1; row++)
    for (let c = 0; c < 4; c++) {
      const x = L * (0.12 - c * 0.1);
      const y = row * H * 0.22;
      g.beginPath();
      g.arc(x, y, H * 0.12, -1.2, 1.2);
      g.stroke();
    }
  g.restore();
  pectoral(g, L, H, ph, fin);
  eye(g, L * 0.3, -H * 0.1, H * 0.13);
}
