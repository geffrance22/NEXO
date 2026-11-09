import { addDays, nextMonday, todayInputValue } from '../lib/format';
import { daysBetween } from '../lib/people';
import type { BoardCard, CardChanges, Column, Priority } from './boardStore';

/**
 * Reglas por columna: «Cuando [algo pasa] y [se cumple esto], entonces [haz esto]». Además, cada
 * columna puede tener un límite de tarjetas, un orden automático y archivar sola lo completado.
 * Todo se guarda en `board_lists.rules` (migración 202611090002) y se ejecuta en la app.
 */

// ───────────────────────── Tipos ─────────────────────────

export type TriggerType =
  | 'create'
  | 'enter'
  | 'leave'
  | 'done'
  | 'undone'
  | 'checks'
  | 'overdue'
  | 'due_soon'
  | 'idle';
export type Trigger = { type: TriggerType; days?: number };

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
  | 'color';
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
export type DueMode = 'today' | 'tomorrow' | 'monday' | 'days' | 'clear';
export type Action = {
  type: ActionType;
  /** move: columna destino. */
  list?: string;
  where?: 'top' | 'bottom';
  /** due: today, tomorrow…; tag; priority; color. */
  value?: string;
  /** due (days), snooze. */
  days?: number;
  /** add_checks. */
  items?: string[];
  /** highlight. */
  on?: boolean;
};

export type Rule = {
  id: string;
  on: boolean;
  /** Nombre opcional; si no, se describe sola. */
  name?: string;
  trigger: Trigger;
  match: 'all' | 'any';
  when: Condition[];
  then: Action[];
};

export type SortKey = '' | 'due' | 'priority' | 'newest' | 'oldest' | 'title' | 'stale';
export type ColumnRules = {
  /** 0 = sin límite. */
  limit: number;
  limitMode: 'warn' | 'block';
  sort: SortKey;
  /** Días tras completarlas para archivarlas solas (0 = nunca). */
  autoArchive: number;
  rules: Rule[];
};

export const emptyRules = (): ColumnRules => ({
  limit: 0,
  limitMode: 'warn',
  sort: '',
  autoArchive: 0,
  rules: [],
});

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
const SORTS: SortKey[] = ['', 'due', 'priority', 'newest', 'oldest', 'title', 'stale'];
/** Disparadores que se revisan solos cada tanto (no dependen de lo que hagas). */
export const SCHEDULED: TriggerType[] = ['overdue', 'due_soon', 'idle'];

const num = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;
const str = (v: unknown, n = 120) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Lee lo guardado sin confiar en su forma (datos viejos o editados a mano). */
export function normalizeRules(raw: unknown): ColumnRules {
  const base = emptyRules();
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
    sort: SORTS.includes(raw.sort as SortKey) ? (raw.sort as SortKey) : '',
    autoArchive: num(raw.autoArchive, 0, 365, 0),
    rules: rules.slice(0, 40),
  };
}
export const hasRules = (r: ColumnRules) =>
  r.rules.some((x) => x.on) || r.limit > 0 || Boolean(r.sort) || r.autoArchive > 0;

// ───────────────────────── Evaluación ─────────────────────────

export type RuleCtx = {
  today: string;
  isDone: (c: BoardCard) => boolean;
  /** Cuántas personas tiene la tarjeta. */
  people: (c: BoardCard) => number;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
const hasTag = (c: BoardCard, tag?: string) =>
  Boolean(tag) && c.tags.some((t) => norm(t) === norm(tag!));
const dayOf = (iso?: string | null) => (iso ? todayInputValue(new Date(iso)) : null);
/** Desde cuándo está la tarjeta en su columna (o, sin ese dato, su último cambio). */
export const sinceOf = (c: BoardCard) => c.list_since ?? c.touched_at ?? c.created_at ?? null;

export function condHolds(c: BoardCard, cond: Condition, ctx: RuleCtx) {
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
      return ctx.people(c) > 0;
    case 'no_people':
      return ctx.people(c) === 0;
    case 'has_checks':
      return c.checks.length > 0;
    case 'title':
      return Boolean(cond.value?.trim()) && norm(c.title).includes(norm(cond.value!));
    case 'highlight':
      return c.highlight;
    case 'color':
      return (c.color || '') === (cond.value ?? '');
  }
}
export function conditionsHold(rule: Rule, c: BoardCard, ctx: RuleCtx) {
  if (!rule.when.length) return true;
  return rule.match === 'any'
    ? rule.when.some((x) => condHolds(c, x, ctx))
    : rule.when.every((x) => condHolds(c, x, ctx));
}

/** ¿Toca ahora un disparador programado para esta tarjeta? */
export function scheduledHit(t: Trigger, c: BoardCard, ctx: RuleCtx) {
  if (ctx.isDone(c)) return false;
  if (t.type === 'overdue') return Boolean(c.due && c.due < ctx.today);
  if (t.type === 'due_soon') {
    if (!c.due) return false;
    const d = daysBetween(ctx.today, c.due);
    return d >= 0 && d <= (t.days ?? 1);
  }
  if (t.type === 'idle') {
    const since = dayOf(sinceOf(c));
    return Boolean(since) && daysBetween(since!, ctx.today) >= Math.max(1, t.days ?? 7);
  }
  return false;
}
/** Para no repetir una regla programada sobre la misma situación (la misma fecha, la misma llegada). */
export const stampOf = (t: Trigger, c: BoardCard) =>
  t.type === 'idle' ? (sinceOf(c) ?? '') : (c.due ?? '');

/** Fecha que pone una acción «fecha límite». */
export function dueFor(a: Action, today = todayInputValue()) {
  switch ((a.value ?? 'today') as DueMode) {
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
  }
}

/** Cambios de campos de una acción (null si no cambia nada o no es de campos). */
export function fieldChanges(c: BoardCard, a: Action, today: string): CardChanges | null {
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

// ───────────────────────── Orden automático ─────────────────────────

export const priorityWeight: Record<Priority, number> = { alta: 3, media: 2, baja: 1, '': 0 };

/** Ordena para mostrar (no cambia el orden guardado). Los divisores pierden sentido y van al final. */
export function sortCards(cards: BoardCard[], key: SortKey, isDivider: (t: string) => boolean) {
  if (!key) return cards;
  const real = cards.filter((c) => !isDivider(c.title));
  const by: Record<Exclude<SortKey, ''>, (a: BoardCard, b: BoardCard) => number> = {
    due: (a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'),
    priority: (a, b) =>
      priorityWeight[b.priority] - priorityWeight[a.priority] ||
      (a.due ?? '9999').localeCompare(b.due ?? '9999'),
    newest: (a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    oldest: (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    title: (a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }),
    stale: (a, b) => (a.touched_at ?? '').localeCompare(b.touched_at ?? ''),
  };
  return [...real].sort((a, b) => by[key](a, b) || a.rank - b.rank);
}

// ───────────────────────── Textos ─────────────────────────

export const triggerInfo: Record<TriggerType, { label: string; hint: string; days?: string }> = {
  create: { label: 'Se crea una tarjeta aquí', hint: 'Al añadirla en esta columna' },
  enter: { label: 'Una tarjeta llega aquí', hint: 'Al moverla desde otra columna' },
  leave: { label: 'Una tarjeta sale de aquí', hint: 'Al moverla a otra columna' },
  done: { label: 'Se completa una tarjeta', hint: 'Al marcarla como completada aquí' },
  undone: { label: 'Se reabre una tarjeta', hint: 'Al desmarcarla aquí' },
  checks: { label: 'Se termina su lista', hint: 'Al tachar el último punto' },
  overdue: { label: 'Se le pasa la fecha', hint: 'Se revisa sola, una vez por fecha' },
  due_soon: {
    label: 'Se acerca su fecha',
    hint: 'Se revisa sola, una vez por fecha',
    days: 'Días antes',
  },
  idle: {
    label: 'Lleva días quieta aquí',
    hint: 'Se revisa sola, una vez por llegada',
    days: 'Días sin moverse',
  },
};
export const triggerOrder = TRIGGERS;

export const condInfo: Record<CondType, { label: string; value?: 'tag' | 'priority' | 'text' | 'color' }> =
  {
    tag: { label: 'Tiene la etiqueta', value: 'tag' },
    no_tag: { label: 'No tiene la etiqueta', value: 'tag' },
    priority: { label: 'Su prioridad es', value: 'priority' },
    has_due: { label: 'Tiene fecha límite' },
    no_due: { label: 'No tiene fecha límite' },
    has_people: { label: 'Tiene personas' },
    no_people: { label: 'No tiene personas' },
    has_checks: { label: 'Tiene lista de verificación' },
    title: { label: 'El título contiene', value: 'text' },
    highlight: { label: 'Está resaltada' },
    color: { label: 'Su color es', value: 'color' },
  };
export const condOrder = CONDS;

export const actionInfo: Record<ActionType, { label: string; group: 'mover' | 'estado' | 'datos' }> =
  {
    move: { label: 'Mover a otra columna', group: 'mover' },
    archive: { label: 'Archivar', group: 'mover' },
    complete: { label: 'Marcar completada', group: 'estado' },
    reopen: { label: 'Marcar sin completar', group: 'estado' },
    snooze: { label: 'Posponer', group: 'estado' },
    unsnooze: { label: 'Despertar (quitar pospuesta)', group: 'estado' },
    highlight: { label: 'Resaltar o quitar resaltado', group: 'estado' },
    due: { label: 'Poner fecha límite', group: 'datos' },
    priority: { label: 'Poner prioridad', group: 'datos' },
    add_tag: { label: 'Añadir etiqueta', group: 'datos' },
    remove_tag: { label: 'Quitar etiqueta', group: 'datos' },
    color: { label: 'Cambiar color', group: 'datos' },
    checks_reset: { label: 'Desmarcar la lista', group: 'datos' },
    checks_complete: { label: 'Marcar toda la lista', group: 'datos' },
    add_checks: { label: 'Añadir puntos a la lista', group: 'datos' },
  };
export const actionOrder = ACTIONS;

export const priorityLabels: Record<Priority, string> = {
  '': 'Sin prioridad',
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
};
export const dueLabels: Record<DueMode, string> = {
  today: 'Hoy',
  tomorrow: 'Mañana',
  monday: 'El lunes',
  days: 'En N días',
  clear: 'Quitar la fecha',
};
export const sortLabels: Record<SortKey, string> = {
  '': 'Manual',
  due: 'Fecha límite',
  priority: 'Prioridad',
  newest: 'Más nuevas',
  oldest: 'Más antiguas',
  title: 'A–Z',
  stale: 'Más quietas',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const q = (s?: string) => `«${(s ?? '').slice(0, 40)}»`;

export function triggerText(t: Trigger) {
  if (t.type === 'due_soon')
    return t.days ? `Faltan ${plural(t.days, 'día', 'días')} para su fecha` : 'Vence hoy';
  if (t.type === 'idle') return `Lleva ${plural(t.days ?? 7, 'día', 'días')} quieta aquí`;
  return triggerInfo[t.type].label;
}
export function condText(c: Condition, colorName: (k: string) => string) {
  const info = condInfo[c.type];
  if (info.value === 'priority')
    return `${info.label.toLowerCase()} ${priorityLabels[(c.value ?? '') as Priority].toLowerCase()}`;
  if (info.value === 'color') return `${info.label.toLowerCase()} ${colorName(c.value ?? '')}`;
  if (info.value) return `${info.label.toLowerCase()} ${q(c.value)}`;
  return info.label.toLowerCase();
}
export function actionText(a: Action, cols: Pick<Column, 'id' | 'name'>[], colorName: (k: string) => string) {
  switch (a.type) {
    case 'move': {
      const col = cols.find((c) => c.id === a.list);
      return `Mover a ${col ? q(col.name) : 'una columna que ya no existe'}${a.where === 'top' ? ' (arriba)' : ''}`;
    }
    case 'due':
      return a.value === 'clear'
        ? 'Quitar la fecha'
        : a.value === 'days'
          ? `Fecha en ${plural(a.days ?? 1, 'día', 'días')}`
          : `Fecha: ${dueLabels[(a.value ?? 'today') as DueMode].toLowerCase()}`;
    case 'add_tag':
      return `Añadir ${q(a.value)}`;
    case 'remove_tag':
      return `Quitar ${q(a.value)}`;
    case 'priority':
      return a.value
        ? `Prioridad ${priorityLabels[a.value as Priority].toLowerCase()}`
        : 'Quitar prioridad';
    case 'color':
      return a.value ? `Color ${colorName(a.value)}` : 'Quitar el color';
    case 'highlight':
      return a.on === false ? 'Quitar resaltado' : 'Resaltar';
    case 'add_checks':
      return `Añadir ${plural(a.items?.length ?? 0, 'punto', 'puntos')} a la lista`;
    case 'snooze':
      return `Posponer ${plural(a.days ?? 1, 'día', 'días')}`;
    default:
      return actionInfo[a.type].label;
  }
}

// ───────────────────────── Recetas ─────────────────────────

export type Recipe = { key: string; title: string; hint: string; make: () => Omit<Rule, 'id' | 'on'> };

/** Reglas listas para empezar, adaptadas a la columna y a las demás del tablero. */
export function recipes(col: Column, cols: Column[]): Recipe[] {
  const others = cols.filter((c) => c.id !== col.id);
  const doneCol =
    others.find((c) => /hecho|listo|terminad|complet|done/i.test(c.name)) ?? others.at(-1);
  const r = (
    key: string,
    title: string,
    hint: string,
    trigger: Trigger,
    then: Action[],
    when: Condition[] = [],
  ): Recipe => ({ key, title, hint, make: () => ({ trigger, match: 'all', when, then }) });
  return [
    r('done-on-enter', 'Completar al llegar', 'Para columnas como «Hecho»', { type: 'enter' }, [
      { type: 'complete' },
    ]),
    r('reopen-on-leave', 'Reabrir al salir', 'Si la sacas de aquí, vuelve a estar pendiente', { type: 'leave' }, [
      { type: 'reopen' },
    ]),
    ...(doneCol
      ? [
          r(
            'move-on-done',
            `Al completar, mover a «${doneCol.name.slice(0, 24)}»`,
            'Lo terminado se va solo',
            { type: 'done' },
            [{ type: 'move', list: doneCol.id, where: 'top' }],
          ),
        ]
      : []),
    r('today-on-enter', 'Fecha de hoy al llegar', 'Para columnas como «Hoy» o «En curso»', { type: 'enter' }, [
      { type: 'due', value: 'today' },
    ]),
    r(
      'late-urgent',
      'Si se pasa la fecha, prioridad alta',
      'Y la resalta para que no se te escape',
      { type: 'overdue' },
      [
        { type: 'priority', value: 'alta' },
        { type: 'highlight', on: true },
      ],
    ),
    r('archive-on-done', 'Archivar al completar', 'La columna queda limpia', { type: 'done' }, [
      { type: 'archive' },
    ]),
    r('idle-flag', 'Resaltar lo olvidado', 'Si lleva 14 días quieta aquí', { type: 'idle', days: 14 }, [
      { type: 'highlight', on: true },
      { type: 'add_tag', value: 'revisar' },
    ]),
    r('reset-on-enter', 'Lista limpia al llegar', 'Para procesos que se repiten', { type: 'enter' }, [
      { type: 'checks_reset' },
    ]),
    r(
      'steps-on-create',
      'Pasos al crear',
      'Cada tarjeta nueva trae su lista',
      { type: 'create' },
      [{ type: 'add_checks', items: ['Preparar', 'Hacer', 'Revisar'] }],
    ),
    r('done-on-checks', 'Completar al terminar la lista', 'Cuando tachas el último punto', { type: 'checks' }, [
      { type: 'complete' },
    ]),
  ];
}
