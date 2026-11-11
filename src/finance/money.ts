import type { Direction, Entry, EntryInput, MoneyFlow, Workspace } from '../data';
import { addDays, money, normalizeText, todayInputValue } from '../lib/format';

/**
 * Las cuentas del dinero en un solo lugar: tipo real de cada movimiento, totales, periodos,
 * categorías y las pistas que salen de tu historial. Todo lo que suma plata en Nexo usa esto.
 */

export const flowMeta: Record<MoneyFlow, { label: string; dir: Direction; hint: string }> = {
  gasto: { label: 'Gasto', dir: 'egreso', hint: 'Lo que se fue en algo' },
  ingreso: { label: 'Ingreso', dir: 'ingreso', hint: 'Lo que te entró' },
  ahorro: {
    label: 'Ahorro',
    dir: 'egreso',
    hint: 'A una meta, un bolsillo o una inversión: no cuenta como gasto',
  },
  transferencia: {
    label: 'Transferencia',
    dir: 'egreso',
    hint: 'Entre tus cuentas (un retiro del cajero, pasar a Nequi): no cuenta como gasto',
  },
  prestamo: {
    label: 'Préstamo',
    dir: 'egreso',
    hint: 'Prestaste o te prestaron: queda en Deudas y no cuenta como gasto ni ingreso',
  },
  reembolso: {
    label: 'Reembolso',
    dir: 'ingreso',
    hint: 'Te devolvieron un gasto: se descuenta de lo gastado',
  },
};
export const flowList = Object.keys(flowMeta) as MoneyFlow[];

type Moneyish = Pick<Entry, 'direction' | 'tags' | 'details'>;

export const isMoney = (e: Pick<Entry, 'kind'>) => e.kind === 'Movimiento';

/** El tipo real. Los registros antiguos no lo traen: se deduce de la dirección y la categoría. */
export function flowOf(e: Moneyish): MoneyFlow {
  const f = e.details.flow;
  if (f && f in flowMeta) return f;
  const cat = e.tags[0];
  if (e.direction === 'ingreso') return cat === 'Reembolso' ? 'reembolso' : 'ingreso';
  return cat === 'Ahorro' ? 'ahorro' : 'gasto';
}

export const isPending = (e: Pick<Entry, 'details'>) => e.details.pending === true;

/** Lo que de verdad te costó: si pagaste por todos y se dividió, solo tu parte. */
export const costOf = (e: Pick<Entry, 'amount' | 'details'>) =>
  e.details.split && e.details.split.n > 1 ? e.details.split.mine : Number(e.amount) || 0;
export const dayOf = (e: Pick<Entry, 'created_at'>) => todayInputValue(new Date(e.created_at));

export function categoryOf(e: Moneyish) {
  const f = flowOf(e);
  if (f === 'transferencia') return 'Transferencia';
  if (f === 'prestamo') return 'Préstamo';
  return e.tags[0] || 'Sin categoría';
}

export type Totals = {
  income: number;
  /** Gastado, ya descontados los reembolsos. */
  spent: number;
  /** Gastado sin descontar reembolsos. */
  gross: number;
  refunds: number;
  /** Ahorrado (lo que sacaste de tus ahorros resta). */
  saved: number;
  /** Ingresos menos gastos. */
  balance: number;
  n: number;
};

/** Totales de una lista. Solo cuenta lo ya pagado o cobrado: lo pendiente va aparte. */
export function totals(list: readonly Entry[]): Totals {
  let income = 0;
  let gross = 0;
  let refunds = 0;
  let saved = 0;
  let n = 0;
  for (const e of list) {
    if (e.kind !== 'Movimiento' || e.details.pending) continue;
    const a = Number(e.amount) || 0;
    n++;
    switch (flowOf(e)) {
      case 'ingreso':
        income += a;
        break;
      case 'gasto':
        gross += costOf(e);
        break;
      case 'reembolso':
        refunds += a;
        break;
      case 'ahorro':
        saved += e.direction === 'ingreso' ? -a : a;
        break;
    }
  }
  const spent = gross - refunds;
  return { income, spent, gross, refunds, saved, balance: income - spent, n };
}

// ───────────────────────── Periodos ─────────────────────────

export type PeriodKind = 'semana' | 'mes' | 'año' | 'todo';
export type Period = { kind: PeriodKind; from: string; to: string };

const pad = (n: number) => String(n).padStart(2, '0');
export const monthKey = (d: string) => d.slice(0, 7);

export function monthBounds(key: string) {
  const [y, m] = key.split('-').map(Number);
  return { from: `${key}-01`, to: `${key}-${pad(new Date(y, m, 0).getDate())}` };
}
export function shiftMonth(key: string, n: number) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function periodAt(kind: PeriodKind, anchor = todayInputValue()): Period {
  switch (kind) {
    case 'semana': {
      const [y, m, d] = anchor.split('-').map(Number);
      const from = addDays(anchor, -((new Date(y, m - 1, d).getDay() + 6) % 7));
      return { kind, from, to: addDays(from, 6) };
    }
    case 'mes':
      return { kind, ...monthBounds(monthKey(anchor)) };
    case 'año':
      return { kind, from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
    default:
      return { kind, from: '0000-01-01', to: '9999-12-31' };
  }
}

export function shiftPeriod(p: Period, n: number): Period {
  switch (p.kind) {
    case 'semana':
      return periodAt('semana', addDays(p.from, 7 * n));
    case 'mes':
      return periodAt('mes', shiftMonth(monthKey(p.from), n) + '-01');
    case 'año':
      return periodAt('año', `${Number(p.from.slice(0, 4)) + n}-01-01`);
    default:
      return p;
  }
}

const monthNames = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
export const monthName = (key: string) => monthNames[Number(key.slice(5, 7)) - 1] ?? '';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Noviembre 2026», «Noviembre» (este año), «9 – 15 nov», «2026» o «Todo». */
export function periodLabel(p: Period, today = todayInputValue()) {
  switch (p.kind) {
    case 'semana': {
      if (today >= p.from && today <= p.to) return 'Esta semana';
      const short = (d: string) => `${Number(d.slice(8))} ${monthName(d).slice(0, 3)}`;
      return `${short(p.from)} – ${short(p.to)}`;
    }
    case 'mes': {
      const name = cap(monthName(p.from));
      return p.from.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${p.from.slice(0, 4)}`;
    }
    case 'año':
      return p.from.slice(0, 4);
    default:
      return 'Todo';
  }
}
/** «el mes pasado», «la semana pasada», «2025». */
export function previousLabel(p: Period) {
  if (p.kind === 'mes') return monthName(shiftMonth(monthKey(p.from), -1));
  if (p.kind === 'semana') return 'la semana anterior';
  if (p.kind === 'año') return String(Number(p.from.slice(0, 4)) - 1);
  return '';
}

export const inPeriod = (e: Pick<Entry, 'created_at'>, p: Period) => {
  const d = dayOf(e);
  return d >= p.from && d <= p.to;
};

/** Días de `a` a `b` (b − a). */
export function daysBetween(a: string, b: string) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}

// ───────────────────────── Desgloses ─────────────────────────

export type Slice = { name: string; total: number; n: number };

export function byCategory(list: readonly Entry[], flow: MoneyFlow = 'gasto'): Slice[] {
  const m = new Map<string, Slice>();
  for (const e of list) {
    if (e.kind !== 'Movimiento' || e.details.pending || flowOf(e) !== flow) continue;
    const name = categoryOf(e);
    const s = m.get(name) ?? { name, total: 0, n: 0 };
    s.total += flow === 'gasto' ? costOf(e) : e.amount;
    s.n++;
    m.set(name, s);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/** Gasto e ingreso de cada día del rango (los días sin nada también, en cero). */
export function daily(list: readonly Entry[], from: string, to: string) {
  const days = new Map<string, { d: string; spent: number; income: number }>();
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++)
    days.set(d, { d, spent: 0, income: 0 });
  for (const e of list) {
    if (e.kind !== 'Movimiento' || e.details.pending) continue;
    const row = days.get(dayOf(e));
    if (!row) continue;
    const f = flowOf(e);
    if (f === 'gasto') row.spent += costOf(e);
    else if (f === 'reembolso') row.spent -= e.amount;
    else if (f === 'ingreso') row.income += e.amount;
  }
  return [...days.values()];
}

/** Totales de cada mes (AAAA-MM) de la lista. */
export function monthly(list: readonly Entry[], months: string[]) {
  const by = new Map(months.map((m) => [m, [] as Entry[]]));
  for (const e of list) by.get(monthKey(dayOf(e)))?.push(e);
  return months.map((m) => ({ m, ...totals(by.get(m) ?? []) }));
}

export const lastMonths = (n: number, today = todayInputValue()) =>
  Array.from({ length: n }, (_, i) => shiftMonth(monthKey(today), i - n + 1));

/** Cambio relativo (null si no hay con qué comparar). */
export const delta = (now: number, before: number) => (before ? (now - before) / before : null);

// ───────────────────────── Formato ─────────────────────────

/** «$1,2 M», «$350 mil» o «$48.000»: para cifras que no necesitan cada peso. */
export function moneyShort(n: number) {
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  const one = (x: number) => x.toLocaleString('es-CO', { maximumFractionDigits: 1 });
  if (a >= 1e9) return `${s}$${one(a / 1e9)} mil M`;
  if (a >= 1e6) return `${s}$${one(a / 1e6)} M`;
  if (a >= 1e5) return `${s}$${Math.round(a / 1e3).toLocaleString('es-CO')} mil`;
  return s + money(a);
}
export const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));
export const percent = (x: number) => `${Math.round(x * 100).toLocaleString('es-CO')} %`;

// ───────────────────────── Lo que se aprende de tu historial ─────────────────────────

const genericTitles = new Set(['gasto', 'ingreso', 'egreso', 'movimiento', 'transferencia', 'prestamo']);
const titleKey = (t: string) => normalizeText(t).replace(/\s+/g, ' ').trim();

export type MoneyTemplate = {
  key: string;
  title: string;
  category?: string;
  method?: string;
  amount: number;
  flow: MoneyFlow;
  direction: Direction;
  n: number;
};

/** Lo que más registras (café, taxi, mercado): para llenarlo con un toque. */
export function frequentTemplates(entries: readonly Entry[], today = todayInputValue(), max = 6) {
  const since = addDays(today, -180);
  const m = new Map<string, MoneyTemplate & { last: string }>();
  for (const e of entries) {
    if (e.kind !== 'Movimiento') continue;
    const d = dayOf(e);
    if (d < since) continue;
    const key = titleKey(e.title);
    if (key.length < 3 || genericTitles.has(key) || titleKey(e.tags[0] ?? '') === key) continue;
    const cur = m.get(key);
    if (cur) {
      cur.n++;
      if (d > cur.last) Object.assign(cur, { last: d, amount: e.amount, method: e.details.method });
      continue;
    }
    m.set(key, {
      key,
      title: e.title,
      category: e.tags[0],
      method: e.details.method,
      amount: e.amount,
      flow: flowOf(e),
      direction: e.direction,
      n: 1,
      last: d,
    });
  }
  return [...m.values()]
    .filter((t) => t.n >= 2)
    .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
    .slice(0, max);
}

/** Categoría y medio que usaste la última vez con ese mismo concepto. */
export function learnedFor(entries: readonly Entry[], title: string) {
  const key = titleKey(title);
  if (key.length < 3) return null;
  const hit = entries.find((e) => e.kind === 'Movimiento' && titleKey(e.title) === key);
  return hit ? { category: hit.tags[0], method: hit.details.method, amount: hit.amount } : null;
}

/** Promedio de los gastos de una categoría en los últimos 6 meses (null con menos de 5). */
export function categoryAverage(entries: readonly Entry[], category: string, skipId?: string) {
  const since = addDays(todayInputValue(), -180);
  const list = entries.filter(
    (e) =>
      e.kind === 'Movimiento' &&
      e.id !== skipId &&
      flowOf(e) === 'gasto' &&
      e.tags[0] === category &&
      dayOf(e) >= since,
  );
  if (list.length < 5) return null;
  return list.reduce((s, e) => s + e.amount, 0) / list.length;
}

/** Gasto hormiga: lo pequeño que se acumula, y en qué se va más. */
export function antSpending(list: readonly Entry[], limit = 15000) {
  const small = list.filter(
    (e) =>
      e.kind === 'Movimiento' && !e.details.pending && flowOf(e) === 'gasto' && e.amount < limit,
  );
  const by = new Map<string, { title: string; total: number; n: number }>();
  for (const e of small) {
    const key = titleKey(e.title) || titleKey(e.tags[0] ?? '');
    const cur = by.get(key) ?? { title: e.title || e.tags[0] || 'Varios', total: 0, n: 0 };
    cur.total += costOf(e);
    cur.n++;
    by.set(key, cur);
  }
  const top = [...by.values()].sort((a, b) => b.total - a.total)[0] ?? null;
  return { total: small.reduce((s, e) => s + costOf(e), 0), n: small.length, top };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Inflación personal: lo que compras seguido y cuánto subió (tus propios precios). */
export function priceChanges(entries: readonly Entry[], today = todayInputValue()) {
  const recent = addDays(today, -90);
  const old = addDays(today, -365);
  const by = new Map<string, { title: string; now: number[]; before: number[] }>();
  for (const e of entries) {
    if (e.kind !== 'Movimiento' || flowOf(e) !== 'gasto' || e.details.split) continue;
    const d = dayOf(e);
    if (d < old) continue;
    const key = titleKey(e.title);
    if (key.length < 3 || genericTitles.has(key) || titleKey(e.tags[0] ?? '') === key) continue;
    const g = by.get(key) ?? { title: e.title, now: [], before: [] };
    (d >= recent ? g.now : g.before).push(e.amount);
    by.set(key, g);
  }
  return [...by.values()]
    .filter((g) => g.now.length >= 2 && g.before.length >= 2)
    .map((g) => {
      const before = median(g.before);
      const now = median(g.now);
      return { title: g.title, before, now, change: before ? now / before - 1 : 0 };
    })
    .filter((x) => Math.abs(x.change) >= 0.08)
    .sort((a, b) => b.change - a.change)
    .slice(0, 3);
}

const spendy = new Set(['Café', 'Comida', 'Fiesta', 'Paseo', 'Viaje', 'Deporte']);
const spendyPlaces = new Set(['cafe', 'comida', 'bar', 'cultura', 'viaje', 'deporte']);

/**
 * «¿Se te quedó algún gasto?»: encuentros de los últimos días en sitios o actividades donde
 * suele haber gasto y que no tienen ningún movimiento ese día con esas personas o en ese lugar.
 */
export function forgottenSpends(ws: Workspace, today = todayInputValue(), days = 2) {
  const since = addDays(today, -days);
  const moves = ws.entries.filter((e) => e.kind === 'Movimiento' && dayOf(e) >= since);
  return ws.entries
    .filter((e) => {
      if (e.kind !== 'Encuentro') return false;
      const d = dayOf(e);
      if (d < since || d > today) return false;
      const place = ws.places.find((p) => p.id === e.details.placeId);
      const likely =
        spendy.has(e.details.activity ?? '') || (place ? spendyPlaces.has(place.kind) : false);
      if (!likely) return false;
      return !moves.some(
        (m) =>
          dayOf(m) === d &&
          ((e.details.placeId && m.details.placeId === e.details.placeId) ||
            m.person_ids.some((id) => e.person_ids.includes(id)) ||
            (e.episode_id && m.episode_id === e.episode_id)),
      );
    })
    .slice(0, 3);
}

/** Saldos de tus cuentas: el inicial más lo que entró y menos lo que salió por cada una. */
export function accountBalances(
  entries: readonly Entry[],
  accounts: readonly { name: string; initial: number }[],
) {
  const rows = new Map(
    accounts.map((a) => [titleKey(a.name), { name: a.name, initial: a.initial, moved: 0, n: 0 }]),
  );
  const at = (name?: string) => (name ? rows.get(titleKey(name)) : undefined);
  for (const e of entries) {
    if (e.kind !== 'Movimiento' || e.details.pending) continue;
    const from = at(e.details.method);
    if (flowOf(e) === 'transferencia') {
      if (from) {
        from.moved -= e.amount;
        from.n++;
      }
      const to = at(e.details.toMethod);
      if (to) {
        to.moved += e.amount;
        to.n++;
      }
      continue;
    }
    if (!from) continue;
    from.moved += e.direction === 'ingreso' ? e.amount : -e.amount;
    from.n++;
  }
  return [...rows.values()].map((r) => ({ ...r, balance: r.initial + r.moved }));
}

/** El movimiento como datos de formulario (para recrearlo al deshacer un borrado). */
export function entryAsInput(e: Entry): EntryInput {
  return {
    title: e.title,
    body: e.body,
    kind: e.kind,
    tags: e.tags,
    personIds: e.person_ids,
    date: dayOf(e),
    amount: e.amount,
    direction: e.direction,
    status: e.status,
    images: e.images,
    details: e.details,
    file: null,
    removeFile: false,
    episodeId: e.episode_id ?? undefined,
  };
}
