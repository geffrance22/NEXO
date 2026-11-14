import type { Entry, Person } from '../data';
import { categoryOf, costOf, dayOf, flowOf, inPeriod, type Period } from '../finance/money';
import { normalizeText } from './format';

/**
 * El dinero con una persona, en tres sentidos que no se mezclan:
 * - «pago»: la plata fue para ella (un pago, un regalo, un trabajo o un servicio que le pagaste).
 * - «cobro»: la plata vino de ella (te pagó o te devolvió algo).
 * - «juntos»: gastaron juntos (una salida, un almuerzo): cuenta solo tu parte.
 * Los préstamos van aparte, en Cobros y deudas; ahorros y transferencias no cuentan.
 */
export type MoneyRole = 'pago' | 'cobro' | 'juntos';

export const moneyRoles: Record<
  MoneyRole,
  { label: string; many: string; hint: string; color: string; soft: string }
> = {
  pago: {
    label: 'Le pagaste',
    many: 'Les pagaste',
    hint: 'Pagos, regalos, trabajos y servicios',
    color: '#b0553d',
    soft: '#fbefe9',
  },
  cobro: {
    label: 'Te pagó',
    many: 'Te pagaron',
    hint: 'Pagos que te hizo y lo que te devolvió',
    color: '#3f7d4a',
    soft: '#eaf4ec',
  },
  juntos: {
    label: 'Gastaron juntos',
    many: 'Gastaron juntos',
    hint: 'Tu parte de salidas y planes compartidos',
    color: '#5b6fb0',
    soft: '#eceffa',
  },
};
export const moneyRoleList = Object.keys(moneyRoles) as MoneyRole[];

/**
 * Categorías de gasto que, con alguien vinculado, casi siempre son un pago a esa persona. Solo
 * sirven para los movimientos que no lo dicen (los anteriores a la opción «Se lo pagué a…»).
 */
const PAID_CATEGORIES = new Set(['regalos', 'trabajo', 'salud', 'educacion']);
const PAID_WORDS = /\b(servicio|honorario|pago|regalo|clase|tutor|consulta|arreglo|domicilio)/;

/** ¿La plata de este gasto fue para las personas vinculadas? Lo que elegiste manda. */
export function paidToPeople(e: Pick<Entry, 'details' | 'tags'>) {
  if (typeof e.details.paidTo === 'boolean') return e.details.paidTo;
  if (e.details.split && e.details.split.n > 1) return false;
  const cat = normalizeText(e.tags[0] ?? '');
  return PAID_CATEGORIES.has(cat) || PAID_WORDS.test(cat);
}

/** Qué es este movimiento para las personas vinculadas (null: no cuenta). */
export function moneyRoleOf(e: Entry): MoneyRole | null {
  if (e.kind !== 'Movimiento' || e.details.pending || !e.person_ids.length) return null;
  const f = flowOf(e);
  if (f === 'ingreso' || f === 'reembolso') return 'cobro';
  if (f === 'gasto') return paidToPeople(e) ? 'pago' : 'juntos';
  return null;
}

/** Cuánto le toca a una persona: si el pago fue a varias, se reparte; juntos, tu parte. */
export function moneyShare(e: Entry, role: MoneyRole) {
  const people = Math.max(1, new Set(e.person_ids).size);
  if (role === 'juntos') return costOf(e);
  return (Number(e.amount) || 0) / people;
}

export type MoneyLine = { entry: Entry; role: MoneyRole; amount: number };
export type MoneySide = { total: number; n: number };
export type PersonMoney = Record<MoneyRole, MoneySide> & {
  lines: MoneyLine[];
  /** AAAA-MM-DD del último movimiento. */
  last: string | null;
  /** En qué se le pagó (categorías de «pago», de mayor a menor). */
  categories: { name: string; total: number; n: number }[];
};

const empty = (): PersonMoney => ({
  pago: { total: 0, n: 0 },
  cobro: { total: 0, n: 0 },
  juntos: { total: 0, n: 0 },
  lines: [],
  last: null,
  categories: [],
});

/** El dinero con cada persona (en un periodo, si se indica), en una sola pasada. */
export function moneyByPerson(entries: readonly Entry[], period?: Period) {
  const out = new Map<string, PersonMoney>();
  const cats = new Map<string, Map<string, { total: number; n: number }>>();
  for (const e of entries) {
    const role = moneyRoleOf(e);
    if (!role || (period && !inPeriod(e, period))) continue;
    const amount = moneyShare(e, role);
    for (const id of new Set(e.person_ids)) {
      const m = out.get(id) ?? empty();
      m[role].total += amount;
      m[role].n++;
      m.lines.push({ entry: e, role, amount });
      const day = dayOf(e);
      if (!m.last || day > m.last) m.last = day;
      out.set(id, m);
      if (role === 'pago') {
        const c = cats.get(id) ?? new Map();
        const name = categoryOf(e);
        const row = c.get(name) ?? { total: 0, n: 0 };
        row.total += amount;
        row.n++;
        c.set(name, row);
        cats.set(id, c);
      }
    }
  }
  for (const [id, m] of out) {
    m.lines.sort((a, b) => b.entry.created_at.localeCompare(a.entry.created_at));
    m.categories = [...(cats.get(id) ?? new Map<string, { total: number; n: number }>())]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total);
  }
  return out;
}

/** El dinero con una persona. */
export function moneyWith(person: Person, entries: readonly Entry[], period?: Period) {
  return (
    moneyByPerson(
      entries.filter((e) => e.person_ids.includes(person.id)),
      period,
    ).get(person.id) ?? empty()
  );
}

/** Quiénes tienen algún movimiento de dinero contigo (también los pendientes). */
export function peopleWithMoney(entries: readonly Entry[]) {
  const ids = new Set<string>();
  for (const e of entries) if (e.kind === 'Movimiento') e.person_ids.forEach((id) => ids.add(id));
  return ids;
}
