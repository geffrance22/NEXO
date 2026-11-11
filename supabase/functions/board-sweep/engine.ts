/**
 * El motor de reglas de Tableros para el servidor. Es el mismo de la app (src/planner/boardRules.ts,
 * boardRepeat.ts y lib/format.ts) sin nada de React ni del navegador: si cambias una regla allí,
 * cámbiala aquí también. Las fechas se calculan siempre en la zona horaria del tablero.
 */

// ───────────────────────── Tipos ─────────────────────────
export type Repeat = '' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export type Priority = '' | 'baja' | 'media' | 'alta';
export type Check = { id: string; text: string; done: boolean; due?: string | null };
export type Completion = { due: string; at: string };

export type Card = {
  id: string;
  owner_id: string;
  list_id: string;
  title: string;
  body: string;
  rank: number;
  tags: string[];
  checks: Check[];
  due: string | null;
  entry_id: string | null;
  person_id: string | null;
  done: boolean;
  done_at: string | null;
  archived_at: string | null;
  color: string;
  priority: Priority;
  highlight: boolean;
  snoozed_until: string | null;
  repeat: Repeat;
  completions: Completion[];
  touched_at: string | null;
  list_since: string | null;
  created_at: string | null;
};

export type TriggerType =
  | 'create'
  | 'enter'
  | 'leave'
  | 'done'
  | 'undone'
  | 'checks'
  | 'overdue'
  | 'due_soon'
  | 'idle'
  | 'schedule'
  | 'emptied'
  | 'person'
  | 'field';
export type Trigger = { type: TriggerType; days?: number; time?: string; weekday?: number };
export type CondType =
  | 'tag'
  | 'no_tag'
  | 'priority'
  | 'has_due'
  | 'no_due'
  | 'has_people'
  | 'no_people'
  | 'has_checks'
  | 'title'
  | 'highlight'
  | 'color'
  | 'person'
  | 'blocked'
  | 'not_blocked';
export type Condition = { type: CondType; value?: string };
export type ActionType =
  | 'move'
  | 'complete'
  | 'reopen'
  | 'archive'
  | 'due'
  | 'add_tag'
  | 'remove_tag'
  | 'priority'
  | 'color'
  | 'highlight'
  | 'checks_reset'
  | 'checks_complete'
  | 'add_checks'
  | 'snooze'
  | 'unsnooze';
export type Action = {
  type: ActionType;
  list?: string;
  where?: 'top' | 'bottom';
  value?: string;
  days?: number;
  items?: string[];
  on?: boolean;
};
export type Rule = {
  id: string;
  on: boolean;
  name?: string;
  trigger: Trigger;
  match: 'all' | 'any';
  when: Condition[];
  then: Action[];
};
export type ColumnRules = {
  limit: number;
  limitMode: 'warn' | 'block';
  autoArchive: number;
  rules: Rule[];
};
export type CardChanges = Partial<
  Pick<
    Card,
    | 'title'
    | 'tags'
    | 'checks'
    | 'due'
    | 'color'
    | 'priority'
    | 'highlight'
    | 'snoozed_until'
    | 'done'
    | 'done_at'
    | 'archived_at'
    | 'list_id'
    | 'rank'
    | 'completions'
  >
>;

export type Ctx = {
  today: string;
  /** Hora de pared en la zona del tablero (sus getHours/getDay son los de esa zona). */
  now: Date;
  isDone: (c: Card) => boolean;
  people: (c: Card) => string[];
  blocked: (c: Card) => boolean;
};

const TRIGGERS: TriggerType[] = [
  'create',
  'enter',
  'leave',
  'done',
  'undone',
  'checks',
  'overdue',
  'due_soon',
  'idle',
  'schedule',
  'emptied',
  'person',
  'field',
];
const CONDS: CondType[] = [
  'tag',
  'no_tag',
  'priority',
  'has_due',
  'no_due',
  'has_people',
  'no_people',
  'has_checks',
  'title',
  'highlight',
  'color',
  'person',
  'blocked',
  'not_blocked',
];
const ACTIONS: ActionType[] = [
  'move',
  'complete',
  'reopen',
  'archive',
  'due',
  'add_tag',
  'remove_tag',
  'priority',
  'color',
  'highlight',
  'checks_reset',
  'checks_complete',
  'add_checks',
  'snooze',
  'unsnooze',
];
/** Los que se revisan solos. */
export const SCHEDULED: TriggerType[] = ['overdue', 'due_soon', 'idle', 'schedule'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const num = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;
const str = (v: unknown, n = 120) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Lee lo guardado en board_lists.rules sin confiar en su forma. */
export function normalizeRules(raw: unknown): ColumnRules {
  const base: ColumnRules = { limit: 0, limitMode: 'warn', autoArchive: 0, rules: [] };
  if (!isObj(raw)) return base;
  const rules = (Array.isArray(raw.rules) ? raw.rules : []).filter(isObj).flatMap((r): Rule[] => {
    const t = isObj(r.trigger) ? r.trigger : {};
    if (!TRIGGERS.includes(t.type as TriggerType)) return [];
    const when = (Array.isArray(r.when) ? r.when : [])
      .filter(isObj)
      .filter((c) => CONDS.includes(c.type as CondType))
      .map((c) => ({ type: c.type as CondType, value: str(c.value) }));
    const then = (Array.isArray(r.then) ? r.then : [])
      .filter(isObj)
      .filter((a) => ACTIONS.includes(a.type as ActionType))
      .map(
        (a): Action => ({
          type: a.type as ActionType,
          list: str(a.list, 60),
          where: a.where === 'top' ? 'top' : 'bottom',
          value: str(a.value),
          days: typeof a.days === 'number' ? num(a.days, 0, 365, 1) : undefined,
          items: Array.isArray(a.items)
            ? a.items.filter((x): x is string => typeof x === 'string').slice(0, 40)
            : undefined,
          on: typeof a.on === 'boolean' ? a.on : undefined,
        }),
      );
    if (!then.length) return [];
    return [
      {
        id: str(r.id, 60) || crypto.randomUUID(),
        on: r.on !== false,
        name: str(r.name, 80) || undefined,
        trigger: {
          type: t.type as TriggerType,
          days: typeof t.days === 'number' ? num(t.days, 0, 365, 1) : undefined,
          ...(t.type === 'schedule' && {
            time: typeof t.time === 'string' && TIME_RE.test(t.time) ? t.time : '08:00',
            weekday:
              typeof t.weekday === 'number' && t.weekday >= 0 && t.weekday <= 6
                ? Math.round(t.weekday)
                : undefined,
          }),
        },
        match: r.match === 'any' ? 'any' : 'all',
        when,
        then,
      },
    ];
  });
  return {
    limit: num(raw.limit, 0, 999, 0),
    limitMode: raw.limitMode === 'block' ? 'block' : 'warn',
    autoArchive: num(raw.autoArchive, 0, 365, 0),
    rules: rules.slice(0, 40),
  };
}

// ───────────────────────── Fechas (AAAA-MM-DD) ─────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
export const addDays = (date: string, days: number) => {
  const [y, m, d] = parts(date);
  return ymd(new Date(y, m - 1, d + days));
};
const weekdayOf = (date: string) => {
  const [y, m, d] = parts(date);
  return new Date(y, m - 1, d).getDay();
};
export const nextMonday = (from: string) => addDays(from, (1 - weekdayOf(from) + 7) % 7 || 7);
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86_400_000);

/** Día y hora de pared de un instante en una zona horaria. */
export function wallClock(at: Date, tz: string) {
  let parts_: Record<string, string>;
  try {
    parts_ = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
  } catch {
    return wallClock(at, 'America/Bogota');
  }
  const today = `${parts_.year}-${parts_.month}-${parts_.day}`;
  const now = new Date(
    Number(parts_.year),
    Number(parts_.month) - 1,
    Number(parts_.day),
    Number(parts_.hour) % 24,
    Number(parts_.minute),
  );
  return { today, now };
}
/** El día (en esa zona) de un instante guardado. */
export const dayIn = (iso: string, tz: string) => wallClock(new Date(iso), tz).today;

// ───────────────────────── Repetición ─────────────────────────
function step(rule: Repeat, d: string): string {
  switch (rule) {
    case 'daily':
      return addDays(d, 1);
    case 'weekdays': {
      let n = addDays(d, 1);
      while (weekdayOf(n) === 0 || weekdayOf(n) === 6) n = addDays(n, 1);
      return n;
    }
    case 'weekly':
      return addDays(d, 7);
    case 'biweekly':
      return addDays(d, 14);
    case 'monthly': {
      const [y, m, day] = parts(d);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      return `${ny}-${pad(nm)}-${pad(Math.min(day, lastDay(ny, nm)))}`;
    }
    case 'yearly': {
      const [y, m, day] = parts(d);
      return `${y + 1}-${pad(m)}-${pad(Math.min(day, lastDay(y + 1, m)))}`;
    }
    default:
      return d;
  }
}
export function nextDue(rule: Repeat, due: string | null, today: string) {
  if (!rule) return due;
  let d = step(rule, due ?? today);
  for (let i = 0; d <= today && i < 800; i++) d = step(rule, d);
  return d;
}

// ───────────────────────── Evaluación ─────────────────────────
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
const hasTag = (c: Card, tag?: string) =>
  Boolean(tag) && c.tags.some((t) => norm(t) === norm(tag!));

export const isDivider = (title: string) => /^[-—–_]{3,}$/.test(title.trim());
/** Desde cuándo está la tarjeta en su columna (o, sin ese dato, su último cambio). */
export const sinceOf = (c: Card) => c.list_since ?? c.touched_at ?? c.created_at ?? null;

function condHolds(c: Card, cond: Condition, ctx: Ctx) {
  switch (cond.type) {
    case 'tag':
      return hasTag(c, cond.value);
    case 'no_tag':
      return !hasTag(c, cond.value);
    case 'priority':
      return (c.priority || '') === (cond.value ?? '');
    case 'has_due':
      return Boolean(c.due);
    case 'no_due':
      return !c.due;
    case 'has_people':
      return ctx.people(c).length > 0;
    case 'no_people':
      return ctx.people(c).length === 0;
    case 'has_checks':
      return c.checks.length > 0;
    case 'title':
      return Boolean(cond.value?.trim()) && norm(c.title).includes(norm(cond.value!));
    case 'highlight':
      return c.highlight;
    case 'color':
      return (c.color || '') === (cond.value ?? '');
    case 'person':
      return Boolean(cond.value) && ctx.people(c).includes(cond.value!);
    case 'blocked':
      return ctx.blocked(c);
    case 'not_blocked':
      return !ctx.blocked(c);
  }
}
export function conditionsHold(rule: Rule, c: Card, ctx: Ctx) {
  if (!rule.when.length) return true;
  return rule.match === 'any'
    ? rule.when.some((x) => condHolds(c, x, ctx))
    : rule.when.every((x) => condHolds(c, x, ctx));
}

function scheduleDue(t: Trigger, now: Date) {
  if (t.weekday !== undefined && now.getDay() !== t.weekday) return false;
  const [h, m] = (t.time ?? '08:00').split(':').map(Number);
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}
export function scheduledHit(t: Trigger, c: Card, ctx: Ctx, tz: string) {
  if (t.type === 'schedule') return scheduleDue(t, ctx.now);
  if (ctx.isDone(c)) return false;
  if (t.type === 'overdue') return Boolean(c.due && c.due < ctx.today);
  if (t.type === 'due_soon') {
    if (!c.due) return false;
    const d = daysBetween(ctx.today, c.due);
    return d >= 0 && d <= (t.days ?? 1);
  }
  if (t.type === 'idle') {
    const since = sinceOf(c) ? dayIn(sinceOf(c)!, tz) : null;
    return Boolean(since) && daysBetween(since!, ctx.today) >= Math.max(1, t.days ?? 7);
  }
  return false;
}
/** La misma clave que usa la app: así lo que aplica uno no lo repite el otro. */
export const stampOf = (t: Trigger, c: Card, today: string) =>
  t.type === 'idle' ? (sinceOf(c) ?? '') : t.type === 'schedule' ? today : (c.due ?? '');

function dueFor(a: Action, today: string) {
  switch (a.value ?? 'today') {
    case 'today':
      return today;
    case 'tomorrow':
      return addDays(today, 1);
    case 'monday':
      return nextMonday(today);
    case 'days':
      return addDays(today, a.days ?? 1);
    case 'clear':
      return null;
    default:
      return today;
  }
}

/** Cambios de campos de una acción (null si no cambia nada o no es de campos). */
export function fieldChanges(c: Card, a: Action, today: string): CardChanges | null {
  switch (a.type) {
    case 'due': {
      const due = dueFor(a, today);
      return due === c.due ? null : { due };
    }
    case 'add_tag': {
      const tag = a.value?.trim();
      return !tag || hasTag(c, tag) ? null : { tags: [...c.tags, tag] };
    }
    case 'remove_tag':
      return hasTag(c, a.value) ? { tags: c.tags.filter((t) => norm(t) !== norm(a.value!)) } : null;
    case 'priority': {
      const p = (a.value ?? '') as Priority;
      return c.priority === p ? null : { priority: p };
    }
    case 'color':
      return (c.color || '') === (a.value ?? '') ? null : { color: a.value ?? '' };
    case 'highlight': {
      const on = a.on !== false;
      return c.highlight === on ? null : { highlight: on };
    }
    case 'checks_reset':
      return c.checks.some((x) => x.done)
        ? { checks: c.checks.map((x) => ({ ...x, done: false })) }
        : null;
    case 'checks_complete':
      return c.checks.some((x) => !x.done)
        ? { checks: c.checks.map((x) => ({ ...x, done: true })) }
        : null;
    case 'add_checks': {
      const have = new Set(c.checks.map((x) => norm(x.text)));
      const add = (a.items ?? []).map((t) => t.trim()).filter((t) => t && !have.has(norm(t)));
      return add.length
        ? {
            checks: [
              ...c.checks,
              ...add.map((text) => ({ id: crypto.randomUUID(), text, done: false })),
            ],
          }
        : null;
    }
    case 'snooze': {
      const until = addDays(today, Math.max(1, a.days ?? 1));
      return c.snoozed_until === until ? null : { snoozed_until: until };
    }
    case 'unsnooze':
      return c.snoozed_until ? { snoozed_until: null } : null;
    default:
      return null;
  }
}
