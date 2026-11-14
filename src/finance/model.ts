import type { Direction, Entry, MoneyFlow } from '../data';
import { amountsIn, directionAt } from '../lib/capture';
import { addDays, normalizeText, todayInputValue } from '../lib/format';
import { costOf, daysBetween, dayOf, flowOf, monthBounds, monthKey, shiftMonth, totals } from './money';

/** Lo que Finanzas guarda aparte de los movimientos (tabla `finance_items`). */
export type FinKind =
  | 'ajustes'
  | 'deuda'
  | 'inversion'
  | 'proyeccion'
  | 'recurrente'
  | 'meta'
  | 'deseo'
  | 'bolsillo'
  | 'apunte'
  | 'cobro'
  | 'tarjeta';
/** Tipos que llegaron con las migraciones 202611130001 y 0002 (sin ellas, la base los rechaza). */
export const newKinds: FinKind[] = ['bolsillo', 'apunte', 'cobro', 'tarjeta'];

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

/** Qué tan seguro es algo de tu plan: cuenta entero en el mínimo, el realista o solo en el ideal. */
export type PlanSure = 'seguro' | 'probable' | 'quizas';

/** Una línea de la carta: lo que piensas que entra o sale, con su monto y de dónde o cómo. */
export type PlanItem = {
  id: string;
  dir: 'in' | 'out';
  amount: number;
  text: string;
  /** De dónde viene o cómo lo pagas: «cliente Andrés», «tarjeta», «prima». */
  source?: string;
  category?: string;
  sure: PlanSure;
  /** AAAA-MM-DD: cuándo esperas que pase. */
  on?: string;
  /** Ya pasó (llegó o lo pagaste). */
  hit?: boolean;
  /** El movimiento con el que se cumplió. */
  entryId?: string;
  /** De dónde salió la línea (un fijo «rec:<id>» o una parte de un cobro «part:<id>»). */
  ref?: string;
};

export type Projection = {
  /** AAAA-MM */
  month: string;
  /** Lo que escribiste: la carta a tu yo del mes. */
  letter: string;
  /** Tu plan en líneas: ingresos y gastos con su descripción. */
  items: PlanItem[];
  /** Presupuesto de este mes (manda sobre el general de Ajustes). */
  budget?: number;
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

/** Bolsillo de ahorro o cartera para gastar: su saldo sale de los movimientos que lo nombran. */
export type PocketUse = 'ahorro' | 'gasto';
export type Pocket = {
  use: PocketUse;
  color: string;
  emoji?: string;
  /** La cuenta en la que vive (Nequi, Bancolombia…). */
  account?: string;
  /** Con cuánto arrancó (antes de registrar movimientos). */
  initial: number;
  /** Bolsillos de ahorro: a cuánto quieres llegar. */
  target?: number;
  /** Carteras para gastar: lo que piensas poner cada mes. */
  monthly?: number;
  note?: string;
  episodeId?: string;
  /**
   * Recargas y retiros de una cartera para gastar (apartar plata no es ahorrar: no crea un
   * movimiento). En los bolsillos de ahorro, guardar y sacar sí son movimientos de ahorro.
   */
  log: PocketLog[];
};
export type PocketLog = { id: string; d: string; v: number; n?: string };

export type NoteTint = 'papel' | 'menta' | 'cielo' | 'rosa' | 'arena' | 'lila';
/** Apunte financiero: texto libre con montos ($5k, -$12.000) que se suman solos. */
export type FinNote = {
  text: string;
  tint: NoteTint;
  pinned?: boolean;
  episodeId?: string;
  pocketId?: string;
  /** Montos que ya pasaste a movimientos: clave del monto → id del movimiento. */
  done: Record<string, string>;
};

/** Una parte que esperas recibir de un cobro por partes. */
export type PartStatus = 'esperando' | 'llego' | 'no';
export type ChargePart = {
  id: string;
  /** AAAA-MM-DD: cuándo debería llegar. */
  due: string;
  amount: number;
  status: PartStatus;
  /** Fechas que tenía antes (cada vez que se aplazó). La primera es la que se acordó. */
  moved?: string[];
  /** Cuándo llegó de verdad y cuánto. */
  gotOn?: string;
  got?: number;
  entryId?: string;
  note?: string;
};
/** Un ingreso que llega en abonos: el total acordado, lo que llegó y lo que esperas. */
export type Charge = {
  total: number;
  personId?: string;
  who?: string;
  episodeId?: string;
  /** El pendiente «espero» que te recuerda cobrarlo. */
  taskId?: string;
  /** AAAA-MM-DD: desde cuándo. */
  start: string;
  category?: string;
  method?: string;
  note?: string;
  parts: ChargePart[];
  /** Lo que se dio por perdido (no llegará). */
  lost?: number;
  closedOn?: string;
};

export type CardType = 'credito' | 'debito' | 'prepago';
export type CardNet = 'visa' | 'mastercard' | 'amex' | 'diners' | 'otra';
/**
 * Una tarjeta. Lo que se ve en claro sirve para reconocerla y llevar sus cuentas; el número
 * completo y el CVV van solo en `secret`, cifrados con el PIN de la bóveda.
 */
export type Card = {
  type: CardType;
  network: CardNet;
  bank?: string;
  holder?: string;
  last4?: string;
  /** AAAA-MM: hasta cuándo sirve. */
  expiry?: string;
  /** Diseño de la tarjeta (uno de `cardSkins`). */
  skin: string;
  /** Medio de pago de Nexo con el que se registran sus movimientos (sin valor: el nombre). */
  method?: string;
  /** Crédito: cupo total, lo que ya debías al registrarla, días de corte y de pago, tasa y cuota. */
  limit?: number;
  owed?: number;
  cutDay?: number;
  payDay?: number;
  /** Tasa efectiva anual, en %. */
  rate?: number;
  /** Cuota de manejo al mes. */
  fee?: number;
  benefits?: string;
  note?: string;
  /** Número completo y CVV cifrados (formato de la bóveda: v1.iv.datos). */
  secret?: string;
};
export type CardSecret = { number?: string; cvv?: string };

export type FinData = {
  ajustes: Settings;
  deuda: Debt;
  inversion: Investment;
  proyeccion: Projection;
  recurrente: Recurring;
  meta: Goal;
  deseo: Wish;
  bolsillo: Pocket;
  apunte: FinNote;
  cobro: Charge;
  tarjeta: Card;
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
  'bolsillo',
  'apunte',
  'cobro',
  'tarjeta',
];

/** Diseños de tarjeta: fondo y color de la letra. */
export const cardSkins: Record<string, { bg: string; ink: string }> = {
  noche: { bg: 'linear-gradient(135deg, #1f2a2e 0%, #33454b 100%)', ink: '#f3f6f4' },
  bosque: { bg: 'linear-gradient(135deg, #24432f 0%, #3f6b4f 100%)', ink: '#f1f7f2' },
  oceano: { bg: 'linear-gradient(135deg, #1e3a5f 0%, #3e6ea3 100%)', ink: '#f1f5fb' },
  vino: { bg: 'linear-gradient(135deg, #5a1f33 0%, #93405c 100%)', ink: '#fbf1f4' },
  oro: { bg: 'linear-gradient(135deg, #8a6414 0%, #c9a24a 100%)', ink: '#fffaf0' },
  lila: { bg: 'linear-gradient(135deg, #3f2d6b 0%, #7a63b5 100%)', ink: '#f6f3fd' },
  coral: { bg: 'linear-gradient(135deg, #a1452f 0%, #e07a5f 100%)', ink: '#fff6f2' },
  plata: { bg: 'linear-gradient(135deg, #c9cfd3 0%, #eef1f3 100%)', ink: '#26302f' },
};
export const cardNets: CardNet[] = ['visa', 'mastercard', 'amex', 'diners', 'otra'];
export const cardNetLabel: Record<CardNet, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  diners: 'Diners',
  otra: 'Otra',
};

export const pocketColors = ['#3f8f5a', '#4f6bb5', '#c58a1c', '#a0527f', '#3c9186', '#c0674a', '#6b62b5', '#8a6d4a'];
export const noteTints: NoteTint[] = ['papel', 'menta', 'cielo', 'rosa', 'arena', 'lila'];
const sureList: PlanSure[] = ['seguro', 'probable', 'quizas'];

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
          items: Array.isArray(r.items)
            ? (r.items as Raw[])
                .filter((i) => i && num(i.amount) > 0)
                .map((i) => ({
                  id: str(i.id) ?? crypto.randomUUID(),
                  dir: i.dir === 'out' ? ('out' as const) : ('in' as const),
                  amount: num(i.amount),
                  text: (str(i.text) ?? '').slice(0, 200),
                  source: str(i.source),
                  category: str(i.category),
                  sure: (sureList as unknown[]).includes(i.sure) ? (i.sure as PlanSure) : 'seguro',
                  on: isDay(i.on) ? i.on : undefined,
                  hit: i.hit === true || undefined,
                  entryId: str(i.entryId),
                  ref: str(i.ref),
                }))
            : [],
          budget: num(r.budget) || undefined,
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
      case 'bolsillo':
        return {
          use: r.use === 'gasto' ? 'gasto' : 'ahorro',
          color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : pocketColors[0],
          emoji: str(r.emoji)?.slice(0, 8) || undefined,
          account: str(r.account),
          initial: num(r.initial),
          target: num(r.target) || undefined,
          monthly: num(r.monthly) || undefined,
          note: str(r.note),
          episodeId: str(r.episodeId),
          log: Array.isArray(r.log)
            ? (r.log as Raw[])
                .filter((x) => x && isDay(x.d) && num(x.v) !== 0)
                .map((x) => ({ id: str(x.id) ?? crypto.randomUUID(), d: x.d as string, v: num(x.v), ...(str(x.n) && { n: str(x.n) }) }))
            : [],
        } satisfies Pocket;
      case 'apunte': {
        const done: Record<string, string> = {};
        if (r.done && typeof r.done === 'object')
          for (const [k, v] of Object.entries(r.done as Raw)) if (typeof v === 'string') done[k] = v;
        return {
          text: str(r.text) ?? '',
          tint: (noteTints as unknown[]).includes(r.tint) ? (r.tint as NoteTint) : 'papel',
          pinned: r.pinned === true || undefined,
          episodeId: str(r.episodeId),
          pocketId: str(r.pocketId),
          done,
        } satisfies FinNote;
      }
      case 'cobro':
        return {
          total: num(r.total),
          personId: str(r.personId),
          who: str(r.who),
          episodeId: str(r.episodeId),
          taskId: str(r.taskId),
          start: isDay(r.start) ? r.start : today,
          category: str(r.category),
          method: str(r.method),
          note: str(r.note),
          parts: Array.isArray(r.parts)
            ? (r.parts as Raw[])
                .filter((p) => p && isDay(p.due) && num(p.amount) > 0)
                .map((p) => ({
                  id: str(p.id) ?? crypto.randomUUID(),
                  due: p.due as string,
                  amount: num(p.amount),
                  status: p.status === 'llego' || p.status === 'no' ? p.status : ('esperando' as PartStatus),
                  moved: strs(p.moved).filter(isDay),
                  gotOn: isDay(p.gotOn) ? p.gotOn : undefined,
                  got: num(p.got) || undefined,
                  entryId: str(p.entryId),
                  note: str(p.note),
                }))
                .sort((a, b) => a.due.localeCompare(b.due))
            : [],
          lost: num(r.lost) || undefined,
          closedOn: isDay(r.closedOn) ? r.closedOn : undefined,
        } satisfies Charge;
      case 'tarjeta': {
        const day = (v: unknown) => (num(v) >= 1 && num(v) <= 31 ? Math.round(num(v)) : undefined);
        return {
          type: r.type === 'debito' || r.type === 'prepago' ? r.type : 'credito',
          network: (cardNets as unknown[]).includes(r.network) ? (r.network as CardNet) : 'otra',
          bank: str(r.bank),
          holder: str(r.holder),
          last4: typeof r.last4 === 'string' && /^\d{4}$/.test(r.last4) ? r.last4 : undefined,
          expiry: typeof r.expiry === 'string' && /^\d{4}-\d{2}$/.test(r.expiry) ? r.expiry : undefined,
          skin: typeof r.skin === 'string' && r.skin in cardSkins ? r.skin : 'noche',
          method: str(r.method),
          limit: num(r.limit) || undefined,
          owed: num(r.owed) || undefined,
          cutDay: day(r.cutDay),
          payDay: day(r.payDay),
          rate: num(r.rate) || undefined,
          fee: num(r.fee) || undefined,
          benefits: str(r.benefits),
          note: str(r.note),
          secret: typeof r.secret === 'string' && r.secret.startsWith('v1.') ? r.secret : undefined,
        } satisfies Card;
      }
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

export const sureMeta: Record<PlanSure, { label: string; hint: string }> = {
  seguro: { label: 'Seguro', hint: 'Cuenta en tu mínimo' },
  probable: { label: 'Probable', hint: 'Cuenta en tu realista' },
  quizas: { label: 'Quizás', hint: 'Solo en tu ideal' },
};

/**
 * ¿Ya pasó esa línea del plan? La marcaste, o viene de un fijo ya registrado ese mes o de una
 * parte de un cobro que ya llegó.
 */
export function planHit(i: PlanItem, fin: readonly FinItem[] | null | undefined, month: string) {
  if (i.hit) return true;
  if (!i.ref || !fin) return false;
  const [kind, id, part] = i.ref.split(':');
  const it = fin.find((x) => x.id === id);
  if (kind === 'rec' && it?.kind === 'recurrente') return it.data.done.includes(periodKeyOf(it.data, month + '-01'));
  if (kind === 'part' && it?.kind === 'cobro') return it.data.parts.some((p) => p.id === part && p.status === 'llego');
  return false;
}

export function projectionTotals(p: Projection, fin?: readonly FinItem[] | null) {
  const lines = letterLines(p.letter).map((l) => ({
    ...l,
    dir: (p.flip.includes(l.key) ? (l.dir === 'in' ? 'out' : 'in') : l.dir) as 'in' | 'out',
    off: p.skip.includes(l.key),
    hit: p.hits.includes(l.key),
  }));
  const on = lines.filter((l) => !l.off);
  const lineIn = on.filter((l) => l.dir === 'in').reduce((s, l) => s + l.amount, 0);
  const lineOut = on.filter((l) => l.dir === 'out').reduce((s, l) => s + l.amount, 0);
  const sum = (dir: 'in' | 'out', sure?: PlanSure) =>
    p.items.filter((i) => i.dir === dir && (!sure || i.sure === sure)).reduce((s, i) => s + i.amount, 0);
  // Lo que escribiste en la carta cuenta como seguro.
  const inSure = lineIn + sum('in', 'seguro');
  const inProb = sum('in', 'probable');
  const inMaybe = sum('in', 'quizas');
  const income = inSure + inProb + inMaybe;
  const spend = lineOut + sum('out');
  const autoMid = inSure + inProb || income;
  const planned = on.length + p.items.length;
  const done = on.filter((l) => l.hit).length + p.items.filter((i) => planHit(i, fin, p.month)).length;
  return {
    lines,
    income,
    spend,
    inSure,
    inProb,
    inMaybe,
    planned,
    done,
    /** Tus escenarios: los que escribiste o los que salen de qué tan seguro es cada ingreso. */
    low: p.low || (inProb || inMaybe ? inSure : 0) || undefined,
    high: p.high || (inMaybe ? income : 0) || undefined,
    /** El realista que cuenta: el que escribiste, o lo seguro más lo probable. */
    target: p.mid || autoMid,
    spendTarget: p.spend || spend,
  };
}
export type ProjectionTotals = ReturnType<typeof projectionTotals>;

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
export function scenarioOf(actual: number, p: { low?: number; mid?: number; high?: number }) {
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

/** Hasta qué día del mes se puede ajustar su carta. */
export const PLAN_LOCK_DAY = 7;

export type LetterWindow = {
  /** planear: el mes que viene · ajustar: primeros días del mes · cerrada · lejos: aún no se puede. */
  state: 'planear' | 'ajustar' | 'cerrada' | 'lejos';
  editable: boolean;
  /** AAAA-MM-DD: el último día en que se puede cambiar. */
  until: string;
};

/**
 * La carta se escribe con tiempo: la del mes que viene desde ya, y la del mes en curso solo hasta
 * el día 7. Después queda fija para poder compararla con lo real.
 */
export function letterWindow(month: string, today = todayInputValue()): LetterWindow {
  const now = monthKey(today);
  const until = `${month}-0${PLAN_LOCK_DAY}`;
  if (month > shiftMonth(now, 1)) return { state: 'lejos', editable: false, until };
  if (month > now) return { state: 'planear', editable: true, until };
  if (month === now && Number(today.slice(8)) <= PLAN_LOCK_DAY) return { state: 'ajustar', editable: true, until };
  return { state: 'cerrada', editable: false, until };
}

/** El presupuesto de un mes: el de su carta, o el general de Ajustes. */
export function budgetFor(items: readonly FinItem[] | null, month: string): { total: number; from: 'mes' | 'general' | null } {
  const own = itemsOf(items, 'proyeccion').find((l) => l.data.month === month)?.data.budget;
  if (own) return { total: own, from: 'mes' };
  const general = itemsOf(items, 'ajustes')[0]?.data.monthBudget ?? 0;
  return general ? { total: general, from: 'general' } : { total: 0, from: null };
}

export type LetterScore = {
  score: number;
  label: string;
  tone: 'top' | 'good' | 'mid' | 'low';
  parts: { key: string; label: string; value: number }[];
};

/**
 * Índice de puntería del mes (0 a 100): qué tan cerca entró lo que proyectaste, si gastaste lo
 * que pensabas, si respetaste el presupuesto y cuánto de tu plan se cumplió.
 */
export function letterScore(x: {
  target: number;
  income: number;
  spendTarget: number;
  spent: number;
  budget: number;
  planned: number;
  done: number;
}): LetterScore | null {
  const parts: (LetterScore['parts'][number] & { w: number })[] = [];
  const control = (q: number) => (q <= 1 ? 1 : Math.max(0, 1 - (q - 1) * 2));
  if (x.target > 0) {
    const r = x.income / x.target;
    parts.push({ key: 'in', label: 'Ingresos', value: r >= 1 ? Math.max(0, 1 - (r - 1) * 0.5) : r, w: 0.4 });
  }
  if (x.spendTarget > 0) parts.push({ key: 'out', label: 'Gastos', value: control(x.spent / x.spendTarget), w: 0.3 });
  if (x.budget > 0) parts.push({ key: 'budget', label: 'Presupuesto', value: control(x.spent / x.budget), w: 0.15 });
  if (x.planned > 0) parts.push({ key: 'plan', label: 'Plan cumplido', value: x.done / x.planned, w: 0.15 });
  if (!parts.length) return null;
  const w = parts.reduce((s, p) => s + p.w, 0);
  const score = Math.round((100 * parts.reduce((s, p) => s + p.w * Math.min(1, Math.max(0, p.value)), 0)) / w);
  const [label, tone]: [string, LetterScore['tone']] =
    score >= 85 ? ['Clavado', 'top'] : score >= 70 ? ['Muy bien', 'good'] : score >= 50 ? ['A medias', 'mid'] : ['Desviado', 'low'];
  return { score, label, tone, parts: parts.map(({ w: _w, ...p }) => p) };
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

// ───────────────────────── Bolsillos y carteras ─────────────────────────

/** Cuánto mueve un movimiento el saldo de su bolsillo: guardar y recibir suman; sacar y gastar restan. */
export function pocketDelta(e: Entry) {
  if (e.kind !== 'Movimiento' || e.details.pending) return 0;
  switch (flowOf(e)) {
    case 'ahorro':
      return e.direction === 'egreso' ? e.amount : -e.amount;
    case 'gasto':
      return -costOf(e);
    case 'ingreso':
    case 'reembolso':
      return e.amount;
    default:
      return 0;
  }
}

export type PocketLine = { key: string; d: string; title: string; v: number; entry?: Entry; log?: PocketLog };

/** Saldo de un bolsillo, lo que entró y salió este mes, y su historia (lo más reciente primero). */
export function pocketStats(p: FinItem<'bolsillo'>, entries: readonly Entry[], month = monthKey(todayInputValue())) {
  let balance = p.data.initial;
  let added = 0;
  let spent = 0;
  let taken = 0;
  const lines: PocketLine[] = [];
  const count = (d: string, v: number) => {
    balance += v;
    if (monthKey(d) !== month) return;
    if (v > 0) added += v;
    else taken -= v;
  };
  for (const e of entries) {
    if (e.kind !== 'Movimiento' || e.details.pocketId !== p.id) continue;
    const v = pocketDelta(e);
    const d = dayOf(e);
    count(d, v);
    if (v < 0 && flowOf(e) === 'gasto' && monthKey(d) === month) spent -= v;
    lines.push({ key: e.id, d, title: e.title || (v >= 0 ? 'Entrada' : 'Salida'), v, entry: e });
  }
  for (const l of p.data.log) {
    count(l.d, l.v);
    lines.push({ key: l.id, d: l.d, title: l.n || (l.v > 0 ? 'Recarga' : 'Retiro'), v: l.v, log: l });
  }
  lines.sort((a, b) => b.d.localeCompare(a.d));
  return { balance, added, taken, spent, lines };
}

// ───────────────────────── Cobros por partes ─────────────────────────

/** Días de retraso de una parte que ya llegó (frente a la fecha que se acordó primero). */
export const partDelay = (p: ChargePart) => (p.gotOn ? daysBetween(p.moved?.[0] ?? p.due, p.gotOn) : null);

/** Lo recibido, lo que falta, lo programado y qué tan puntual ha sido. */
export function chargeStats(c: FinItem<'cobro'>, entries: readonly Entry[], today = todayInputValue()) {
  const abonos = entries
    .filter((e) => e.kind === 'Movimiento' && e.details.chargeId === c.id && !e.details.pending)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const received = abonos.reduce((s, e) => s + e.amount, 0);
  const lost = c.data.lost ?? 0;
  const left = Math.max(0, c.data.total - received - lost);
  const waiting = c.data.parts.filter((p) => p.status === 'esperando').sort((a, b) => a.due.localeCompare(b.due));
  const scheduled = Math.min(left, waiting.reduce((s, p) => s + p.amount, 0));
  const delays = c.data.parts
    .filter((p) => p.status === 'llego')
    .map(partDelay)
    .filter((d): d is number => d !== null);
  const onTime = delays.filter((d) => d <= 0).length;
  return {
    abonos,
    received,
    lost,
    left,
    pct: c.data.total ? received / c.data.total : 0,
    waiting,
    next: waiting[0] ?? null,
    late: waiting.filter((p) => p.due < today),
    scheduled,
    unscheduled: Math.max(0, left - scheduled),
    punctuality: delays.length ? onTime / delays.length : null,
    avgDelay: delays.length ? delays.reduce((s, d) => s + Math.max(0, d), 0) / delays.length : null,
    missed: c.data.parts.filter((p) => p.status === 'no').length,
    done: c.data.total > 0 && left <= 0,
  };
}
export type ChargeStats = ReturnType<typeof chargeStats>;

export const isOpenCharge = (c: FinItem<'cobro'>) => !c.archived && !c.data.closedOn;

// ───────────────────────── Tarjetas ─────────────────────────

/** El medio de pago con el que se registran los movimientos de la tarjeta. */
export const cardMethod = (c: FinItem<'tarjeta'>) => c.data.method?.trim() || c.title;

const sameMethod = (a?: string, b?: string) => Boolean(a && b) && normalizeText(a!.trim()) === normalizeText(b!.trim());

/**
 * Lo que va de una tarjeta de crédito: lo que debes (lo que ya debías + compras − pagos y
 * devoluciones), lo disponible del cupo y cuándo tocan el corte y el pago.
 */
export function cardStats(c: FinItem<'tarjeta'>, entries: readonly Entry[], today = todayInputValue()) {
  const m = cardMethod(c);
  let owed = c.data.owed ?? 0;
  let spentMonth = 0;
  let n = 0;
  const month = monthKey(today);
  for (const e of entries) {
    if (e.kind !== 'Movimiento' || e.details.pending) continue;
    const f = flowOf(e);
    if (f === 'transferencia') {
      if (sameMethod(e.details.toMethod, m)) {
        owed -= e.amount;
        n++;
      } else if (sameMethod(e.details.method, m)) {
        owed += e.amount;
        n++;
      }
      continue;
    }
    if (!sameMethod(e.details.method, m)) continue;
    n++;
    if (e.direction === 'egreso') {
      owed += e.amount;
      if (f === 'gasto' && monthKey(dayOf(e)) === month) spentMonth += e.amount;
    } else owed -= e.amount;
  }
  const next = (d?: number) => {
    if (!d) return null;
    const [y, mo] = today.split('-').map(Number);
    const at = (yy: number, mm: number) => {
      const last = new Date(yy, mm, 0).getDate();
      return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
    };
    const here = at(y, mo);
    return here >= today ? here : mo === 12 ? at(y + 1, 1) : at(y, mo + 1);
  };
  const expiresIn = c.data.expiry ? daysBetween(today, monthBounds(c.data.expiry).to) : null;
  return {
    owed,
    available: c.data.limit ? c.data.limit - Math.max(0, owed) : null,
    used: c.data.limit ? Math.max(0, owed) / c.data.limit : null,
    spentMonth,
    n,
    nextCut: next(c.data.cutDay),
    nextPay: next(c.data.payDay),
    expiresIn,
  };
}

/** Franquicia por los primeros dígitos. */
export function netOf(number: string): CardNet | null {
  const d = number.replace(/\D/g, '');
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^3(0[0-5]|[68])/.test(d)) return 'diners';
  return null;
}

/** ¿El número pasa la verificación de Luhn? (detecta errores al escribirlo). */
export function luhnOk(number: string) {
  const d = number.replace(/\D/g, '');
  if (d.length < 12) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
  }
  return sum % 10 === 0;
}

/** «4111 1111 1111 1111» (Amex: «3782 822463 10005»). */
export function formatCardNumber(number: string) {
  const d = number.replace(/\D/g, '').slice(0, 19);
  if (/^3[47]/.test(d)) return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
  return d.replace(/(\d{4})(?=\d)/g, '$1 ');
}
