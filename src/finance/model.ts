import type { Direction, Entry, MoneyFlow } from '../data';
import { amountsIn, directionAt } from '../lib/capture';
import { addDays, normalizeText, todayInputValue } from '../lib/format';
import { daysBetween, dayOf, flowOf, monthBounds, monthKey, totals } from './money';

/** Lo que Finanzas guarda aparte de los movimientos (tabla `finance_items`). */
export type FinKind = 'ajustes' | 'deuda' | 'inversion' | 'proyeccion' | 'recurrente' | 'meta' | 'deseo';

export type Account = { name: string; initial: number };

export type Settings = {
  /** Presupuesto mensual por categoría de gasto. */
  budgets: Record<string, number>;
  /** Presupuesto mensual total (0 = sin presupuesto). */
  monthBudget: number;
  accounts: Account[];
  /** Categorías propias de gasto y de ingreso. */
  extraOut: string[];
  extraIn: string[];
};

export type Payment = { id: string; d: string; amount: number; note?: string; entryId?: string };
export type Debt = {
  /** «debo»: te prestaron o pagaron por ti. «meDeben»: prestaste o pagaste por otros. */
  dir: 'debo' | 'meDeben';
  personId?: string;
  /** Nombre tal como se muestra (si la persona se borra, queda). */
  who: string;
  amount: number;
  /** AAAA-MM-DD */
  date: string;
  due?: string;
  note?: string;
  origin?: 'prestamo' | 'division' | 'otro';
  /** El movimiento del que salió. */
  entryId?: string;
  payments: Payment[];
  closedOn?: string;
};

export type InvType =
  | 'acciones'
  | 'cripto'
  | 'cdt'
  | 'fondo'
  | 'negocio'
  | 'inmueble'
  | 'bolsillo'
  | 'otro';
/** Un día de una inversión: su valor total ese día, y lo que aportaste (+) o retiraste (−). */
export type Mark = { d: string; v: number; f?: number; n?: string };
export type Investment = {
  type: InvType;
  platform?: string;
  note?: string;
  log: Mark[];
  closedOn?: string;
};

export type Projection = {
  /** AAAA-MM */
  month: string;
  /** Lo que escribiste: la carta a tu yo del mes. */
  letter: string;
  /** Tus escenarios de ingreso: mínimo, realista e ideal. */
  low?: number;
  mid?: number;
  high?: number;
  /** Lo que piensas gastar. */
  spend?: number;
  /** Líneas detectadas en la carta: cuáles llegaron, cuáles no cuentan y cuáles cambian de signo. */
  hits: string[];
  skip: string[];
  flip: string[];
  reflection?: string;
  closedOn?: string;
  learningId?: string;
  writtenOn?: string;
};

export type Recurring = {
  amount: number;
  dir: Direction;
  flow?: MoneyFlow;
  category?: string;
  method?: string;
  /** Día del mes (1 a 31). */
  day: number;
  every: 'mes' | 'año';
  /** Mes del año (1 a 12) si es anual. */
  month?: number;
  kind: 'fijo' | 'suscripcion';
  /** Periodos ya registrados (AAAA-MM o AAAA). */
  done: string[];
  start: string;
  paused?: boolean;
  personIds?: string[];
  /** El movimiento del que nació. */
  fromEntry?: string;
};

export type Goal = { target: number; due?: string; initial: number; note?: string; episodeId?: string };

export type Wish = {
  price: number;
  /** AAAA-MM-DD: cuándo decidir si lo compras. */
  decideOn: string;
  link?: string;
  note?: string;
  category?: string;
  status: 'esperando' | 'comprado' | 'descartado';
  decidedOn?: string;
  entryId?: string;
};

export type FinData = {
  ajustes: Settings;
  deuda: Debt;
  inversion: Investment;
  proyeccion: Projection;
  recurrente: Recurring;
  meta: Goal;
  deseo: Wish;
};

export type FinItem<K extends FinKind = FinKind> = {
  [P in K]: {
    id: string;
    kind: P;
    title: string;
    data: FinData[P];
    archived: boolean;
    created_at: string;
    updated_at: string;
  };
}[K];

export const finKinds: FinKind[] = [
  'ajustes',
  'deuda',
  'inversion',
  'proyeccion',
  'recurrente',
  'meta',
  'deseo',
];

export const defaultAccounts: Account[] = [
  { name: 'Efectivo', initial: 0 },
  { name: 'Nequi', initial: 0 },
  { name: 'Débito', initial: 0 },
  { name: 'Crédito', initial: 0 },
];
export const defaultSettings: Settings = {
  budgets: {},
  monthBudget: 0,
  accounts: [],
  extraOut: [],
  extraIn: [],
};

// ───────────────────────── Datos sanos al leer ─────────────────────────

type Raw = Record<string, unknown>;
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Lo que llega de la base, con todo lo que falte rellenado (nunca rompe una vista). */
export function fixData<K extends FinKind>(kind: K, raw: unknown): FinData[K] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  const today = todayInputValue();
  const out: unknown = (() => {
    switch (kind) {
      case 'ajustes': {
        const budgets: Record<string, number> = {};
        if (r.budgets && typeof r.budgets === 'object')
          for (const [k, v] of Object.entries(r.budgets as Raw)) if (num(v) > 0) budgets[k] = num(v);
        return {
          budgets,
          monthBudget: num(r.monthBudget),
          accounts: Array.isArray(r.accounts)
            ? (r.accounts as Raw[])
                .filter((a) => a && typeof a.name === 'string' && a.name.trim())
                .map((a) => ({ name: String(a.name), initial: num(a.initial) }))
            : [],
          extraOut: strs(r.extraOut),
          extraIn: strs(r.extraIn),
        } satisfies Settings;
      }
      case 'deuda':
        return {
          dir: r.dir === 'debo' ? 'debo' : 'meDeben',
          personId: str(r.personId),
          who: str(r.who) ?? '',
          amount: num(r.amount),
          date: isDay(r.date) ? r.date : today,
          due: isDay(r.due) ? r.due : undefined,
          note: str(r.note),
          origin: r.origin === 'prestamo' || r.origin === 'division' ? r.origin : 'otro',
          entryId: str(r.entryId),
          payments: Array.isArray(r.payments)
            ? (r.payments as Raw[])
                .filter((p) => p && num(p.amount) > 0)
                .map((p) => ({
                  id: str(p.id) ?? crypto.randomUUID(),
                  d: isDay(p.d) ? p.d : today,
                  amount: num(p.amount),
                  note: str(p.note),
                  entryId: str(p.entryId),
                }))
            : [],
          closedOn: isDay(r.closedOn) ? r.closedOn : undefined,
        } satisfies Debt;
      case 'inversion':
        return {
          type: (invTypes as readonly string[]).includes(String(r.type)) ? (r.type as InvType) : 'otro',
          platform: str(r.platform),
          note: str(r.note),
          log: Array.isArray(r.log)
            ? (r.log as Raw[])
                .filter((m) => m && isDay(m.d))
                .map((m) => ({
                  d: m.d as string,
                  v: num(m.v),
                  ...(num(m.f) ? { f: num(m.f) } : {}),
                  ...(str(m.n) ? { n: str(m.n) } : {}),
                }))
                .sort((a, b) => a.d.localeCompare(b.d))
            : [],
          closedOn: isDay(r.closedOn) ? r.closedOn : undefined,
        } satisfies Investment;
      case 'proyeccion':
        return {
          month: typeof r.month === 'string' && /^\d{4}-\d{2}$/.test(r.month) ? r.month : monthKey(today),
          letter: str(r.letter) ?? '',
          low: num(r.low) || undefined,
          mid: num(r.mid) || undefined,
          high: num(r.high) || undefined,
          spend: num(r.spend) || undefined,
          hits: strs(r.hits),
          skip: strs(r.skip),
          flip: strs(r.flip),
          reflection: str(r.reflection),
          closedOn: isDay(r.closedOn) ? r.closedOn : undefined,
          learningId: str(r.learningId),
          writtenOn: isDay(r.writtenOn) ? r.writtenOn : undefined,
        } satisfies Projection;
      case 'recurrente':
        return {
          amount: num(r.amount),
          dir: r.dir === 'ingreso' ? 'ingreso' : 'egreso',
          flow: typeof r.flow === 'string' ? (r.flow as MoneyFlow) : undefined,
          category: str(r.category),
          method: str(r.method),
          day: Math.min(31, Math.max(1, Math.round(num(r.day, 1)))),
          every: r.every === 'año' ? 'año' : 'mes',
          month: num(r.month) ? Math.min(12, Math.max(1, num(r.month))) : undefined,
          kind: r.kind === 'suscripcion' ? 'suscripcion' : 'fijo',
          done: strs(r.done),
          start: isDay(r.start) ? r.start : today,
          paused: r.paused === true,
          personIds: strs(r.personIds),
          fromEntry: str(r.fromEntry),
        } satisfies Recurring;
      case 'meta':
        return {
          target: num(r.target),
          due: isDay(r.due) ? r.due : undefined,
          initial: num(r.initial),
          note: str(r.note),
          episodeId: str(r.episodeId),
        } satisfies Goal;
      case 'deseo':
        return {
          price: num(r.price),
          decideOn: isDay(r.decideOn) ? r.decideOn : addDays(today, 2),
          link: str(r.link),
          note: str(r.note),
          category: str(r.category),
          status: r.status === 'comprado' || r.status === 'descartado' ? r.status : 'esperando',
          decidedOn: isDay(r.decidedOn) ? r.decidedOn : undefined,
          entryId: str(r.entryId),
        } satisfies Wish;
    }
  })();
  return out as FinData[K];
}

export const itemsOf = <K extends FinKind>(items: readonly FinItem[] | null, kind: K): FinItem<K>[] =>
  (items ?? []).filter((i) => i.kind === kind) as FinItem<K>[];

// ───────────────────────── Deudas ─────────────────────────

export const paidOf = (d: Debt) => d.payments.reduce((s, p) => s + p.amount, 0);
export const remainingOf = (d: Debt) => Math.max(0, d.amount - paidOf(d));
export const isOpenDebt = (d: Debt) => !d.closedOn && remainingOf(d) > 0;

/** Neto con cada persona: positivo, te debe; negativo, le debes. */
export function debtBalances(debts: readonly FinItem<'deuda'>[]) {
  const by = new Map<string, { key: string; personId?: string; who: string; net: number; open: FinItem<'deuda'>[] }>();
  for (const it of debts) {
    const d = it.data;
    if (!isOpenDebt(d) || it.archived) continue;
    const key = d.personId ?? 'n:' + normalizeText(d.who);
    const row = by.get(key) ?? { key, personId: d.personId, who: d.who, net: 0, open: [] };
    row.net += (d.dir === 'meDeben' ? 1 : -1) * remainingOf(d);
    row.open.push(it);
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

// ───────────────────────── Inversiones ─────────────────────────

export const invTypes = [
  'acciones',
  'cripto',
  'cdt',
  'fondo',
  'negocio',
  'inmueble',
  'bolsillo',
  'otro',
] as const;
export const invTypeMeta: Record<InvType, { label: string; color: string }> = {
  acciones: { label: 'Acciones', color: '#4f6bb5' },
  cripto: { label: 'Cripto', color: '#c58a1c' },
  cdt: { label: 'CDT', color: '#3c9186' },
  fondo: { label: 'Fondo', color: '#6b62b5' },
  negocio: { label: 'Negocio', color: '#c0674a' },
  inmueble: { label: 'Inmueble', color: '#8a6d4a' },
  bolsillo: { label: 'Bolsillo / ahorro', color: '#5f8247' },
  otro: { label: 'Otro', color: '#7b8573' },
};

/** Un registro por día: si ya había uno ese día, el valor se reemplaza y los aportes se suman. */
export function addMark(log: readonly Mark[], m: Mark): Mark[] {
  const rest = log.filter((x) => x.d !== m.d);
  const same = log.find((x) => x.d === m.d);
  const f = (same?.f ?? 0) + (m.f ?? 0);
  const merged: Mark = { d: m.d, v: m.v, ...(f ? { f } : {}), ...(m.n || same?.n ? { n: m.n || same?.n } : {}) };
  return [...rest, merged].sort((a, b) => a.d.localeCompare(b.d));
}

export type DayResult = { d: string; change: number; pct: number; v: number; f: number };

/** Cuánto vale, cuánto pusiste, cuánto ganaste o perdiste y cómo le fue cada día. */
export function invStats(inv: Investment) {
  const log = inv.log;
  let contributed = 0;
  let withdrawn = 0;
  const days: DayResult[] = [];
  let prev: Mark | null = null;
  for (const m of log) {
    const f = m.f ?? 0;
    if (f > 0) contributed += f;
    else withdrawn -= f;
    if (prev) {
      const change = m.v - prev.v - f;
      days.push({ d: m.d, change, pct: prev.v ? change / prev.v : 0, v: m.v, f });
    }
    prev = m;
  }
  const last = log[log.length - 1] ?? null;
  const value = last?.v ?? 0;
  const invested = contributed - withdrawn;
  const pnl = value - invested;
  const base = contributed || 1;
  const today = todayInputValue();
  const lastDay = days[days.length - 1] ?? null;
  return {
    value,
    contributed,
    withdrawn,
    invested,
    pnl,
    pct: contributed ? pnl / base : 0,
    last,
    lastDay,
    days,
    updatedToday: last?.d === today,
    staleDays: last ? daysBetween(last.d, today) : null,
    wins: days.filter((x) => x.change > 0).length,
    losses: days.filter((x) => x.change < 0).length,
  };
}

/** Ganancia, pérdida o neutral: con un margen para no llamar «ganancia» a un peso. */
export function tone(change: number, base = 0): 'up' | 'down' | 'flat' {
  const eps = Math.max(1, Math.abs(base) * 0.0005);
  return change > eps ? 'up' : change < -eps ? 'down' : 'flat';
}

// ───────────────────────── Carta del mes (proyección) ─────────────────────────

const IN_WORDS =
  /\b(cobr|me pagan|me paga|pago de|entra|entran|recib|ingres|sueldo|salario|quincena|honorario|factur|vend|cliente|me deben|me devuelv|prima|bono|arriendo que me|dividend|intereses)/;
const OUT_WORDS =
  /\b(pagar|pago el|pago la|pago los|gastar|gasto|gastos|arriendo|alquiler|cuota|tarjeta|deuda|compr|servicios|mercado|comprar|suscrip|matricula|seguro|impuesto|ahorrar|ahorro|invertir)/;

export type LetterLine = { key: string; text: string; amount: number; dir: 'in' | 'out' };

/** Las líneas de la carta que hablan de plata, con su monto y si es entrada o salida. */
export function letterLines(letter: string): LetterLine[] {
  const out: LetterLine[] = [];
  const seen = new Map<string, number>();
  const parts = letter
    .split(/\n+|(?<=[.;!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const text of parts) {
    const hits = amountsIn(text);
    if (!hits.length) continue;
    const n = normalizeText(text);
    hits.slice(0, 3).forEach((h) => {
      const verb = directionAt(n, h.start);
      const near = n.slice(Math.max(0, h.start - 50), h.end + 40);
      const dir: 'in' | 'out' =
        verb === 'ingreso'
          ? 'in'
          : verb === 'egreso'
            ? 'out'
            : IN_WORDS.test(near)
              ? 'in'
              : OUT_WORDS.test(near)
                ? 'out'
                : 'in';
      const base = normalizeText(text).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60) + '|' + h.value;
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      out.push({ key: k > 1 ? `${base}#${k}` : base, text, amount: h.value, dir });
    });
  }
  return out;
}

export function projectionTotals(p: Projection) {
  const lines = letterLines(p.letter).map((l) => ({
    ...l,
    dir: (p.flip.includes(l.key) ? (l.dir === 'in' ? 'out' : 'in') : l.dir) as 'in' | 'out',
    off: p.skip.includes(l.key),
    hit: p.hits.includes(l.key),
  }));
  const on = lines.filter((l) => !l.off);
  const income = on.filter((l) => l.dir === 'in').reduce((s, l) => s + l.amount, 0);
  const spend = on.filter((l) => l.dir === 'out').reduce((s, l) => s + l.amount, 0);
  return {
    lines,
    income,
    spend,
    /** El realista que cuenta: el que escribiste, o lo que suman las líneas. */
    target: p.mid || income,
    spendTarget: p.spend || spend,
  };
}

export type Verdict = {
  key: 'muy-ambicioso' | 'ambicioso' | 'realista' | 'ideal' | 'corto';
  label: string;
  text: string;
  ratio: number;
};

/** Qué tan cerca estuviste: ideal, realista, ambicioso o corto. */
export function verdictOf(actual: number, target: number): Verdict | null {
  if (!(target > 0)) return null;
  const r = actual / target;
  const p = Math.round(Math.abs(r - 1) * 100);
  if (r >= 1.15)
    return { key: 'corto', label: 'Te quedaste corto', text: `Entró un ${p} % más de lo que proyectaste: puedes apuntar más alto.`, ratio: r };
  if (r >= 0.97 && r <= 1.03)
    return { key: 'ideal', label: 'Ideal', text: 'Le atinaste casi exacto.', ratio: r };
  if (r >= 0.85)
    return {
      key: 'realista',
      label: 'Realista',
      text: r > 1 ? `Un ${p} % por encima: bien calculado.` : `A un ${p} % de lo proyectado: bien calculado.`,
      ratio: r,
    };
  if (r >= 0.6)
    return { key: 'ambicioso', label: 'Ambicioso', text: `Llegó el ${Math.round(r * 100)} % de lo que proyectaste.`, ratio: r };
  return { key: 'muy-ambicioso', label: 'Muy ambicioso', text: `Llegó apenas el ${Math.round(r * 100)} % de lo proyectado.`, ratio: r };
}

/** Dónde cayó lo real frente a tus tres escenarios. */
export function scenarioOf(actual: number, p: Projection) {
  const { low, mid, high } = p;
  if (high && actual >= high) return 'Superaste tu escenario ideal.';
  if (mid && actual >= mid) return high ? 'Entre tu realista y tu ideal.' : 'Alcanzaste tu escenario realista.';
  if (low && actual >= low) return 'Entre tu mínimo y tu realista.';
  if (low) return 'No alcanzaste tu mínimo.';
  return '';
}

/** Lo que pasó de verdad en el mes de la carta. */
export function monthActual(entries: readonly Entry[], month: string) {
  const { from, to } = monthBounds(month);
  const list = entries.filter((e) => {
    if (e.kind !== 'Movimiento') return false;
    const d = dayOf(e);
    return d >= from && d <= to;
  });
  return totals(list);
}

// ───────────────────────── Fijos ─────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

export const periodKeyOf = (r: Recurring, date: string) =>
  r.every === 'año' ? date.slice(0, 4) : date.slice(0, 7);

/** La fecha en que toca en un periodo (el día se ajusta al largo del mes). */
export function dueOn(r: Recurring, period: string) {
  const y = Number(period.slice(0, 4));
  const m = r.every === 'año' ? (r.month ?? 1) : Number(period.slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  return `${y}-${pad(m)}-${pad(Math.min(r.day, last))}`;
}

export type RecurringStatus = {
  period: string;
  due: string;
  done: boolean;
  /** Días que faltan (negativo: vencido). */
  inDays: number;
};

/** Cómo va en el periodo actual; si ya está registrado, mira el siguiente. */
export function recurringStatus(r: Recurring, today = todayInputValue()): RecurringStatus {
  const period = periodKeyOf(r, today);
  const due = dueOn(r, period);
  const done = r.done.includes(period);
  if (done) {
    const next = r.every === 'año' ? String(Number(period) + 1) : nextMonth(period);
    const nextDue = dueOn(r, next);
    return { period: next, due: nextDue, done: false, inDays: daysBetween(today, nextDue) };
  }
  return { period, due, done, inDays: daysBetween(today, due) };
}
const nextMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};
/** ¿Ya se registró el periodo actual? */
export const doneNow = (r: Recurring, today = todayInputValue()) =>
  r.done.includes(periodKeyOf(r, today));

export const monthlyCost = (r: Recurring) => (r.every === 'año' ? r.amount / 12 : r.amount);

/** Las fechas en que toca un fijo entre dos días (para el flujo de los próximos días). */
export function occurrences(r: Recurring, from: string, to: string) {
  const out: { d: string; period: string }[] = [];
  if (r.paused) return out;
  if (r.every === 'año') {
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      const period = String(y);
      const d = dueOn(r, period);
      if (d >= from && d <= to && !r.done.includes(period)) out.push({ d, period });
    }
    return out;
  }
  for (let key = from.slice(0, 7), i = 0; key <= to.slice(0, 7) && i < 36; key = nextMonth(key), i++) {
    const d = dueOn(r, key);
    if (d >= from && d <= to && !r.done.includes(key) && d >= r.start.slice(0, 8) + '01') out.push({ d, period: key });
  }
  return out;
}

// ───────────────────────── Metas ─────────────────────────

/** Lo ahorrado para una meta: lo inicial más cada ahorro que la nombra (sacar resta). */
export function goalSaved(goal: FinItem<'meta'>, entries: readonly Entry[]) {
  let s = goal.data.initial;
  for (const e of entries)
    if (e.kind === 'Movimiento' && e.details.goalId === goal.id && !e.details.pending && flowOf(e) === 'ahorro')
      s += e.direction === 'ingreso' ? -e.amount : e.amount;
  return s;
}
