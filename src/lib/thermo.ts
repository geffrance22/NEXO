import { moodTone } from '../composer/moods';
import type { Entry, Episode, ExchangeKind, Person, ThermoAdjust } from '../data';
import { isOpenDebt, remainingOf, type FinItem } from '../finance/model';
import type { Instant } from '../instants/model';
import { commitmentOf } from './commitments';
import { addDays, money, normalizeText, todayInputValue } from './format';
import { daysBetween, relationMeta, relationOf } from './people';
import { toneOf } from './sentiment';

/**
 * Termómetro de una relación (0 a 100 °C): qué tan viva está hoy, distinto de la cercanía que
 * declaras y del índice de vínculo. Lo calienta lo que pasa entre ustedes (encuentros con buen tono,
 * promesas cumplidas, lo que le das y lo que te da con cariño, deudas saldadas, experiencias
 * juntos, acordarte de sus fechas) y lo enfrían el tiempo sin contacto, los roces, lo que no
 * cumpliste o no te cumplió y las deudas abiertas. Cada hecho pesa más cuando es reciente y se va
 * diluyendo. Si lo ajustas a mano, el cálculo sigue desde tu ajuste.
 */

export type ThermoFactor =
  | 'base'
  | 'encuentros'
  | 'notas'
  | 'instantes'
  | 'cultura'
  | 'episodios'
  | 'compromisos'
  | 'dar'
  | 'recibir'
  | 'balance'
  | 'deudas'
  | 'novedades'
  | 'fechas'
  | 'distancia'
  | 'ajuste';

export const factorLabels: Record<ThermoFactor, string> = {
  base: 'Cercanía que declaraste',
  encuentros: 'Encuentros',
  notas: 'Notas y diario',
  instantes: 'Instantes',
  cultura: 'Libros, películas y aprendizajes',
  episodios: 'Experiencias juntos',
  compromisos: 'Compromisos',
  dar: 'Lo que le das',
  recibir: 'Lo que te da',
  balance: 'Balance de dar y recibir',
  deudas: 'Deudas',
  novedades: 'Novedades de su vida',
  fechas: 'Fechas importantes',
  distancia: 'Tiempo sin contacto',
  ajuste: 'Tu ajuste',
};

/** Un hecho que mueve el termómetro: su día, cuánto pesa y en cuántos días pierde la mitad. */
type Event = { day: string; impact: number; half: number; factor: ThermoFactor; contact: boolean };

type Commit = { day: string; due: string; kind: ReturnType<typeof commitmentOf> };
type DebtLine = {
  dir: 'debo' | 'meDeben';
  from: string;
  closed: string | null;
  due: string | null;
  amount: number;
  payments: { d: string; amount: number }[];
};

export type ThermoInput = {
  person: Person;
  /** Sus recuerdos (los que la nombran). */
  entries: readonly Entry[];
  episodes?: readonly Episode[];
  /** Las deudas de Finanzas (si ya cargaron). */
  debts?: readonly FinItem<'deuda'>[] | null;
  instants?: readonly Instant[] | null;
};

export type ThermoModel = {
  person: Person;
  events: Event[];
  contacts: string[];
  /** Pendientes abiertos (cuentan si ya vencieron). */
  open: Commit[];
  debts: DebtLine[];
  adjusts: ThermoAdjust[];
  base: number;
  expected: number;
  created: string;
};

export type ThermoReading = {
  value: number;
  /** Lo que marca el cálculo sin tu ajuste. */
  auto: number;
  /** Cuánto aporta cada parte, en grados. */
  parts: Partial<Record<ThermoFactor, number>>;
  lastContact: string | null;
};

// ───────────────────────── Escala ─────────────────────────

/**
 * Los nueve estados de una relación, de la más cálida a la más fría, con desde qué temperatura
 * empieza cada uno. Una persona nueva, sin nada registrado, arranca en «Neutral». El tiempo sin
 * contacto, por sí solo, deja la relación como mucho en «Desconectada»: a «Fracturada» solo se
 * llega con daño (roces, promesas incumplidas, deudas vencidas), o si tú la pones ahí.
 */
export const THERMO_LEVELS: { min: number; label: string }[] = [
  { min: 85, label: 'Vibrante' },
  { min: 72, label: 'Activa' },
  { min: 60, label: 'Estable' },
  { min: 42, label: 'Neutral' },
  { min: 34, label: 'Tranquila' },
  { min: 25, label: 'Distante' },
  { min: 14, label: 'Lejana' },
  { min: 8, label: 'Desconectada' },
  { min: 0, label: 'Fracturada' },
];
/** Bajo esta temperatura la relación está fracturada (solo se llega con daño, no con distancia). */
export const FRACTURE = 8;

export function thermoLabel(v: number) {
  return (THERMO_LEVELS.find((l) => v >= l.min) ?? THERMO_LEVELS[THERMO_LEVELS.length - 1]).label;
}

/** «73 °C» (con espacio fijo, como se escriben los grados Celsius). */
export const celsius = (v: number) => `${Math.round(v)}\u00A0°C`;
/** «+3 °C», «−5 °C», «0 °C». */
export const signedCelsius = (v: number) => {
  const n = Math.round(v);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}\u00A0°C`;
};

const STOPS: [number, [number, number, number]][] = [
  // Fracturada: un violeta oscuro, más allá del azul del frío.
  [0, [96, 58, 148]],
  [FRACTURE, [47, 99, 214]],
  [25, [62, 150, 226]],
  [45, [138, 165, 186]],
  [60, [238, 178, 60]],
  [80, [242, 128, 36]],
  [100, [222, 70, 42]],
];
/**
 * El color de una temperatura: violeta si está fracturada, azul si está desconectada, gris si
 * está neutral, naranja si vibra.
 */
export function thermoColor(v: number) {
  const x = Math.max(0, Math.min(100, v));
  for (let i = 1; i < STOPS.length; i++) {
    const [b, cb] = STOPS[i];
    const [a, ca] = STOPS[i - 1];
    if (x <= b) {
      const t = (x - a) / (b - a);
      const c = ca.map((n, k) => Math.round(n + (cb[k] - n) * t));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return 'rgb(222, 70, 42)';
}

// ───────────────────────── Modelo ─────────────────────────

const localDay = (iso: string) => todayInputValue(new Date(iso));
const decay = (age: number, half: number) => Math.pow(0.5, Math.max(0, age) / half);
const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));

/** Cada cuántos días suele tener sentido hablar con esta persona (tu meta, o según la relación). */
export function expectedDays(p: Person) {
  const c = p.profile.cadence ?? 0;
  if (c > 0) return c;
  if (relationOf(p) === 'pareja') return 7;
  const byCloseness = [45, 120, 75, 45, 25, 14];
  return byCloseness[p.profile.closeness ?? 3] ?? 45;
}

/** Ánimo de un recuerdo (−1 a 1): el que marcaste, o el de sus sentimientos del diario. */
function moodOfEntry(e: Entry) {
  const tones = [
    moodTone(e.details.mood),
    ...(e.details.feelings ?? []).map((f) => moodTone(f.mood)),
  ].filter((t): t is number => typeof t === 'number');
  if (!tones.length) return 0;
  return (tones.reduce((s, t) => s + t, 0) / tones.length - 3) / 2;
}

const textOf = (e: Entry) => `${e.title}. ${e.body}`.slice(0, 6000);

/** Una razón de «no lo hice» que no es de nadie («ya no hacía falta») pesa poco. */
function missedWeight(why: string) {
  const w = normalizeText(why);
  if (!w) return 1;
  if (/ya no hac|no hacia falta|ya no hace falta|cambio el plan|lo resolvio|se resolvio|ya no aplica|cancelad/.test(w))
    return 0.3;
  if (/no alcance|no pude|no tuve tiempo|se me paso|se me olvido|olvide/.test(w)) return 0.9;
  const t = toneOf(why).score;
  // Una razón con roces («no quiso», «me ignoró») pesa más; una amable, menos.
  return clamp(1 - t * 0.5, 0.4, 1.6);
}

const GIVE: Record<ExchangeKind, number> = {
  regalo: 1.2,
  apoyo: 1.25,
  favor: 1,
  tiempo: 1.1,
  consejo: 0.95,
  oportunidad: 1.15,
  dinero: 0.75,
  iniciativa: 0.9,
};
/** Recibir también abriga (le importas), salvo el dinero, que pesa poco. */
const RECEIVE: Record<ExchangeKind, number> = {
  apoyo: 1.1,
  regalo: 1,
  favor: 0.9,
  tiempo: 1,
  consejo: 0.95,
  oportunidad: 1.1,
  iniciativa: 1.15,
  dinero: 0.25,
};

export function thermoModel(input: ThermoInput, today = todayInputValue()): ThermoModel {
  const { person: p } = input;
  const events: Event[] = [];
  const contacts: string[] = [];
  const open: Commit[] = [];
  const add = (day: string, impact: number, half: number, factor: ThermoFactor, contact = false) => {
    if (!day || day > today || !Number.isFinite(impact) || !impact) return;
    events.push({ day, impact, half, factor, contact });
    if (contact) contacts.push(day);
  };

  for (const e of input.entries) {
    if (!e.person_ids.includes(p.id) && e.details.owner !== p.id && e.details.beneficiary !== p.id)
      continue;
    if (e.tags.includes('conexión')) continue;
    const day = localDay(e.created_at);
    // Solo, cara a cara, pesa más que en grupo.
    const crowd = e.person_ids.length <= 1 ? 1.15 : e.person_ids.length > 4 ? 0.6 : 1;
    switch (e.kind) {
      case 'Encuentro': {
        const tone = toneOf(textOf(e)).score;
        const mood = moodOfEntry(e);
        // Un encuentro neutro abriga; uno con roces («discutimos», «me dejó plantado») enfría.
        add(day, (4 + 7 * tone + 3 * mood) * crowd, 60, 'encuentros', true);
        break;
      }
      case 'Nota': {
        const tone = toneOf(textOf(e)).score;
        const mood = moodOfEntry(e);
        add(day, (1.4 + 4 * tone + 2 * mood) * crowd, 60, 'notas', true);
        break;
      }
      case 'Película':
      case 'Libro': {
        let w = 2;
        // Te prestó su libro: hay confianza.
        if (e.details.lentById === p.id) w += 2;
        if (e.details.ritual?.recommendTo?.some((n) => normalizeText(n).includes(normalizeText(p.name.split(' ')[0]))))
          w += 1;
        add(day, w, 120, 'cultura', true);
        break;
      }
      case 'Aprendizaje':
        add(day, 2.2, 120, 'cultura', true);
        break;
      case 'Trabajo':
        add(day, (1.2 + 2 * toneOf(textOf(e)).score) * crowd, 90, 'cultura', true);
        break;
      case 'Pendiente': {
        const k = commitmentOf(e);
        const theirs = k === 'espero' || k === 'depende';
        const due = e.details.due ?? '';
        if (e.status === 'completado') {
          const when = due && due <= today ? due : day;
          add(when, k === 'prometi' ? 4.5 : theirs ? 4 : 1.5, 120, 'compromisos');
        } else if (e.status === 'no_realizado') {
          const when = e.details.missed?.at ?? day;
          const w = missedWeight(e.details.missed?.why ?? '');
          add(when, -(k === 'prometi' ? 6 : theirs ? 5 : 1) * w, 150, 'compromisos');
        } else if (due) open.push({ day, due, kind: k });
        break;
      }
      default:
        break;
    }
  }

  // Lo que se dan: dar abriga mucho; recibir con cariño, también.
  for (const x of p.profile.exchanges ?? []) {
    const w = x.weight ?? 1;
    if (x.dir === 'dar') add(x.date, 2.6 * w * (GIVE[x.kind] ?? 1), 120, 'dar', true);
    else add(x.date, 2.2 * w * (RECEIVE[x.kind] ?? 1), 120, 'recibir', true);
  }

  // Estar al tanto de su vida (y preguntarle cómo le fue).
  for (const u of p.profile.updates ?? []) {
    add(u.date, 1 + (u.done ? 1.2 : 0), 120, 'novedades');
  }

  // Experiencias juntos: un viaje, una celebración, un proyecto.
  for (const ep of input.episodes ?? []) {
    if (!ep.person_ids.includes(p.id)) continue;
    const day = ep.starts_on ?? localDay(ep.created_at);
    const small = ep.person_ids.length > 5 ? 0.6 : 1;
    add(day, 3 * small, 150, 'episodios', true);
  }

  // Lo que escribiste de ella, tal cual.
  for (const i of input.instants ?? []) {
    if (!i.person_ids.includes(p.id)) continue;
    const day = i.happened_on ?? localDay(i.created_at);
    add(day, 1 + 3 * toneOf(i.body).score, 60, 'instantes', true);
  }

  // Acordarte de su cumpleaños: un contacto en los días alrededor.
  const b = p.profile.birthday;
  if (b && /^\d{2}-\d{2}$/.test(b)) {
    const year = Number(today.slice(0, 4));
    for (let y = year - 2; y <= year; y++) {
      const day = `${y}-${b === '02-29' ? '02-28' : b}`;
      if (day > today) continue;
      if (contacts.some((c) => Math.abs(daysBetween(day, c)) <= 3)) add(day, 3, 180, 'fechas');
    }
  }

  // Deudas de Finanzas con esta persona.
  const name = normalizeText(p.name);
  const debts: DebtLine[] = [];
  for (const it of input.debts ?? []) {
    const d = it.data;
    if (it.archived) continue;
    if (d.personId ? d.personId !== p.id : normalizeText(d.who) !== name) continue;
    const lastPay = d.payments.length ? d.payments[d.payments.length - 1].d : undefined;
    // Cerrada a mano o pagada completa: desde ese día ya no pesa como abierta.
    const closed = d.closedOn ?? (remainingOf(d) <= 0 ? (lastPay ?? d.date) : undefined);
    debts.push({
      dir: d.dir,
      from: d.date,
      closed: closed ?? null,
      due: d.due ?? null,
      amount: d.amount,
      payments: d.payments.map((x) => ({ d: x.d, amount: x.amount })),
    });
    // Saldar una deuda (la tuya o la suya) deja confianza (si de verdad se pagó, no si se archivó).
    if (closed && remainingOf(d) <= 0) add(closed, 2.5, 150, 'deudas');
  }

  events.sort((a, b) => a.day.localeCompare(b.day));
  contacts.sort();
  const closeness = p.profile.closeness;
  return {
    person: p,
    events,
    contacts,
    open,
    debts,
    adjusts: [...(p.profile.thermo ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
    base: 46 + (closeness === undefined ? 0 : (closeness - 3) * 4),
    expected: expectedDays(p),
    created: p.created_at ? localDay(p.created_at) : today,
  };
}

/** La temperatura ese día (con lo que había pasado hasta entonces). */
export function thermoAt(m: ThermoModel, day: string): ThermoReading {
  const raw: Partial<Record<ThermoFactor, number>> = {};
  let warm = 0;
  for (const e of m.events) {
    if (e.day > day) break;
    const v = e.impact * decay(daysBetween(e.day, day), e.half);
    warm += v;
    raw[e.factor] = (raw[e.factor] ?? 0) + v;
  }
  // Los hechos se comprimen (muchos no lo llevan a 100), repartidos según lo que aportó cada uno.
  // Si en total pesa más el daño, enfría más rápido de lo que lo bueno calienta: unos cuantos
  // roces y promesas rotas, sin nada bueno que los compense, pueden fracturarla.
  const core = warm >= 0 ? 44 * Math.tanh(warm / 40) : -54 * Math.tanh(-warm / 30);
  const k = warm ? core / warm : 0;
  const parts: Partial<Record<ThermoFactor, number>> = {};
  for (const [f, v] of Object.entries(raw)) parts[f as ThermoFactor] = v * k;
  parts.base = m.base - 46;
  /** Lo que depende del estado de ese día (no de un hecho): distancia, balance, vencidos, deudas. */
  let state = 0;
  const addState = (f: ThermoFactor, v: number) => {
    if (!v) return;
    parts[f] = (parts[f] ?? 0) + v;
    state += v;
  };

  // Tiempo sin contacto según su ritmo: enfría (y lo reciente abriga un poco).
  let lastContact: string | null = null;
  for (const c of m.contacts) {
    if (c > day) break;
    lastContact = c;
  }
  const since = daysBetween(lastContact ?? m.created, day);
  let distance = 0;
  if (since >= 0) {
    const gap = since - m.expected;
    distance =
      gap > 0
        ? -Math.min(30, 10 * Math.log2(1 + gap / m.expected))
        : lastContact
          ? 2 * (1 - since / m.expected)
          : -3;
  }
  addState('distancia', distance);

  // Balance del último año: recibir mucho más de lo que das enfría; dar más, abriga un poco.
  const yearAgo = addDays(day, -365);
  let give = 0;
  let receive = 0;
  for (const x of m.person.profile.exchanges ?? []) {
    if (x.date > day || x.date < yearAgo) continue;
    if (x.dir === 'dar') give += x.weight ?? 1;
    else receive += x.weight ?? 1;
  }
  const total = give + receive;
  if (total >= 4) {
    const score = ((give - receive) / total) * 100;
    const tol = { familia: 40, pareja: 30, amistad: 25, trabajo: 15, conocido: 20, otro: 20 }[
      relationOf(m.person)
    ];
    const excess = Math.max(0, Math.abs(score) - tol) / (100 - tol);
    if (excess) addState('balance', score < 0 ? -4 * excess : 1.5 * excess);
  }

  // Promesas vencidas y abiertas.
  let overdue = 0;
  for (const c of m.open) {
    if (c.day > day || c.due >= day) continue;
    const late = Math.min(2, 1 + daysBetween(c.due, day) / 30);
    overdue += (c.kind === 'prometi' ? 2.5 : c.kind === 'quiero' ? 0.4 : 1.2) * late;
  }
  addState('compromisos', -Math.min(12, overdue));

  // Deudas abiertas ese día: deberle enfría más que que te deba.
  let owe = 0;
  for (const d of m.debts) {
    if (d.from > day || (d.closed && d.closed <= day)) continue;
    const paid = d.payments.filter((x) => x.d <= day).reduce((s, x) => s + x.amount, 0);
    const left = d.amount - paid;
    if (left <= 0) continue;
    const size = Math.min(1.6, Math.log10(1 + left / 20000));
    const late = d.due && d.due < day;
    owe += d.dir === 'debo' ? 2 + 3 * size + (late ? 3 : 0) : 1 + 2 * size + (late ? 2.5 : 0);
  }
  addState('deudas', -Math.min(14, owe));

  let auto = m.base + core + state;
  // La distancia sola no fractura: sin roces ni incumplimientos, no baja de «Desconectada».
  if (distance < 0 && auto < FRACTURE && auto - distance >= FRACTURE) auto = FRACTURE;
  auto = clamp(auto);
  // Ya no están en contacto: como mucho, «Distante».
  if (m.person.profile.status === 'distante') auto = Math.min(auto, 32);

  // Tu ajuste: la diferencia con el cálculo de ese día, que se diluye en el año.
  const adj = m.adjusts.find((a) => a.at <= day);
  let value = auto;
  if (adj) {
    const offset = (adj.value - adj.computed) * decay(daysBetween(adj.at, day), 365);
    parts.ajuste = offset;
    value = clamp(auto + offset);
  }
  return { value: Math.round(value), auto: Math.round(auto), parts, lastContact };
}

export type ThermoSummary = ThermoReading & {
  label: string;
  color: string;
  /** Diferencia con hace 30 días. */
  trend: number;
};

/** La temperatura de hoy (y cómo venía hace un mes). null para quien está en memoria. */
export function thermoOf(input: ThermoInput, today = todayInputValue()): ThermoSummary | null {
  if (input.person.profile.status === 'memoria') return null;
  const m = thermoModel(input, today);
  const now = thermoAt(m, today);
  const monthAgo = addDays(today, -30);
  // Si la añadiste hace menos de un mes, aún no hay con qué comparar.
  const trend = m.created > monthAgo ? 0 : now.value - thermoAt(m, monthAgo).value;
  return { ...now, label: thermoLabel(now.value), color: thermoColor(now.value), trend };
}

/** Un punto por semana del último año (y el de hoy), desde que la añadiste, para el gráfico. */
export function thermoHistory(m: ThermoModel, today = todayInputValue()) {
  const points: { day: string; value: number; auto: number }[] = [];
  const yearAgo = addDays(today, -364);
  const start = m.created > yearAgo && m.created < today ? m.created : yearAgo;
  for (let d = start; d < today; d = addDays(d, 7)) {
    const r = thermoAt(m, d);
    points.push({ day: d, value: r.value, auto: r.auto });
  }
  const r = thermoAt(m, today);
  points.push({ day: today, value: r.value, auto: r.auto });
  return points;
}

// ───────────────────────── Explicación ─────────────────────────

export type ThermoReason = { factor: ThermoFactor; degrees: number; text: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Por qué marca lo que marca: cada parte con sus grados y una frase concreta («3 encuentros en
 * los últimos 3 meses, con buen tono», «le debes $50.000», «hace 60 días sin contacto»).
 */
export function thermoReasons(input: ThermoInput, reading: ThermoReading, today = todayInputValue()) {
  const p = input.person;
  const first = p.name.split(' ')[0];
  const since = addDays(today, -90);
  const yearAgo = addDays(today, -365);
  const mine = input.entries.filter((e) => e.person_ids.includes(p.id));
  const out: ThermoReason[] = [];
  const push = (factor: ThermoFactor, text: string) => {
    const degrees = reading.parts[factor] ?? 0;
    if (Math.abs(degrees) >= 0.5) out.push({ factor, degrees, text });
  };
  const toneWord = (list: Entry[]) => {
    if (!list.length) return '';
    const t = list.reduce((s, e) => s + toneOf(textOf(e)).score + moodOfEntry(e) * 0.5, 0) / list.length;
    return t > 0.2 ? ', con buen tono' : t < -0.2 ? ', con roces' : '';
  };

  const meetings = mine.filter((e) => e.kind === 'Encuentro' && localDay(e.created_at) >= since);
  push(
    'encuentros',
    meetings.length
      ? `${plural(meetings.length, 'encuentro', 'encuentros')} en los últimos 3 meses${toneWord(meetings)}`
      : 'Los encuentros de antes ya pesan poco',
  );
  const notes = mine.filter((e) => e.kind === 'Nota' && localDay(e.created_at) >= since);
  push('notas', notes.length ? `${plural(notes.length, 'nota', 'notas')} sobre ${first}${toneWord(notes)}` : 'Notas de hace tiempo');
  const instants = (input.instants ?? []).filter((i) => i.person_ids.includes(p.id));
  push('instantes', `${plural(instants.length, 'instante', 'instantes')} donde la nombras`);
  push('cultura', 'Libros, películas, aprendizajes o trabajo que comparten');
  const eps = (input.episodes ?? []).filter((e) => e.person_ids.includes(p.id));
  push('episodios', eps.length ? `${plural(eps.length, 'experiencia', 'experiencias')} juntos` : 'Experiencias juntos');

  const tasks = mine.filter((e) => e.kind === 'Pendiente');
  const done = tasks.filter((e) => e.status === 'completado' && localDay(e.created_at) >= yearAgo).length;
  const missed = tasks.filter((e) => e.status === 'no_realizado' && (e.details.missed?.at ?? '') >= yearAgo).length;
  const late = tasks.filter((e) => e.status === 'pendiente' && e.details.due && e.details.due < today).length;
  push(
    'compromisos',
    [
      done && `${plural(done, 'cumplido', 'cumplidos')}`,
      missed && `${plural(missed, 'soltado', 'soltados')}`,
      late && `${plural(late, 'vencido', 'vencidos')}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Compromisos de antes',
  );

  const ex = (p.profile.exchanges ?? []).filter((x) => x.date >= yearAgo);
  const gave = ex.filter((x) => x.dir === 'dar').length;
  const got = ex.length - gave;
  push('dar', gave ? `Le diste algo ${plural(gave, 'vez', 'veces')} este año` : 'Lo que le diste antes');
  push('recibir', got ? `Te dio algo ${plural(got, 'vez', 'veces')} este año` : 'Lo que te dio antes');
  push('balance', (reading.parts.balance ?? 0) < 0 ? `Recibes bastante más de lo que das a ${first}` : `Das más de lo que recibes`);

  let owe = 0;
  let owed = 0;
  let overdue = false;
  for (const it of input.debts ?? []) {
    const d = it.data;
    if (it.archived || !isOpenDebt(d)) continue;
    if (d.personId ? d.personId !== p.id : normalizeText(d.who) !== normalizeText(p.name)) continue;
    if (d.dir === 'debo') owe += remainingOf(d);
    else owed += remainingOf(d);
    if (d.due && d.due < today) overdue = true;
  }
  push(
    'deudas',
    [owe && `Le debes ${money(owe)}`, owed && `te debe ${money(owed)}`, overdue && 'con plazo vencido']
      .filter(Boolean)
      .join(' · ') || 'Saldaron una deuda',
  );
  const updates = (p.profile.updates ?? []).filter((u) => u.date >= yearAgo).length;
  push('novedades', `${plural(updates, 'novedad', 'novedades')} de su vida este año`);
  push('fechas', 'Te acordaste de su cumpleaños');

  const last = reading.lastContact;
  const gap = last ? daysBetween(last, today) : null;
  const every = expectedDays(p);
  push(
    'distancia',
    gap === null
      ? 'Aún no hay contacto registrado'
      : gap <= every
        ? `Hablaron hace ${gap === 0 ? 'nada' : plural(gap, 'día', 'días')}`
        : `${plural(gap, 'día', 'días')} sin contacto (con ${first} lo natural es cada ${every})`,
  );
  push('base', `La marcaste como ${['', 'lejana', 'conocida', 'amiga', 'cercana', 'íntima'][p.profile.closeness ?? 3]}`);
  const adj = [...(p.profile.thermo ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0];
  if (adj) push('ajuste', adj.why ? `«${adj.why}»` : 'Lo ajustaste a mano');
  return out.sort((a, b) => Math.abs(b.degrees) - Math.abs(a.degrees));
}

/** El tipo de relación en palabras, para el subtítulo («Amistad · cada 25 días»). */
export const rhythmLabel = (p: Person) =>
  `${relationMeta[relationOf(p)].label} · lo natural, cada ${expectedDays(p)} días`;
