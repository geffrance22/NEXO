import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SCHEDULED,
  conditionsHold,
  daysBetween,
  dayIn,
  fieldChanges,
  isDivider,
  nextDue,
  normalizeRules,
  scheduledHit,
  stampOf,
  wallClock,
  type Action,
  type Card,
  type CardChanges,
  type ColumnRules,
  type Ctx,
  type Rule,
  type TriggerType,
} from './engine.ts';

/**
 * Tableros en el servidor, cada 5 minutos (pg_cron → esta función, migración 202611100010):
 * 1. Recordatorios: las tarjetas cuya hora (remind_at) ya llegó dejan un aviso en board_inbox.
 * 2. Reglas programadas: «se le pasa la fecha», «se acerca su fecha», «lleva días quieta», «a una
 *    hora fija» y archivar solas las completadas. Lo ya aplicado queda en board_rule_runs (con la
 *    misma clave que usa la app), así ni el servidor ni la app lo repiten.
 * Se despliega sin JWT: la protege la cabecera x-sweep-secret (BOARD_SWEEP_SECRET).
 */
const headers = { 'Content-Type': 'application/json' };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });

/** Zona horaria cuando el tablero no dice cuál (la de quien lo usa: Colombia). */
const DEFAULT_TZ = 'America/Bogota';
/** Tope de tiempo de una pasada (el cron espera hasta 55 s). */
const BUDGET_MS = 45_000;
const PAGE = 1000;

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Comparación que no revela en cuánto coinciden las cadenas. */
function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function all(
  query: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
  cap = 20_000,
) {
  const out: Row[] = [];
  for (let n = 0; n < cap; n += PAGE) {
    const { data, error } = await query(n, n + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}
const chunks = <T>(list: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

// ───────────────────────── Recordatorios ─────────────────────────

async function remind(db: Db) {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from('planner_board_cards')
    .select(
      'id,owner_id,title,board_id,board_name,list_name,done,board_is_template,board_archived_at',
    )
    .lte('remind_at', nowIso)
    .is('reminded_at', null)
    .is('archived_at', null)
    .limit(500);
  if (error) throw error;
  const due = ((data ?? []) as Row[]).filter((c) => !c.board_is_template && !c.board_archived_at);
  let sent = 0;
  for (const part of chunks(due, 100)) {
    // Se «reclama» cada una (reminded_at solo si seguía vacío): si la app ya avisó, no se repite.
    const { data: won, error: claimError } = await db
      .from('board_cards')
      .update({ reminded_at: nowIso })
      .in(
        'id',
        part.map((c) => c.id),
      )
      .is('reminded_at', null)
      .select('id');
    if (claimError) throw claimError;
    const claimed = new Set(((won ?? []) as Row[]).map((r) => r.id));
    const rows = part
      .filter((c) => claimed.has(c.id) && !c.done)
      .map((c) => ({
        owner_id: c.owner_id,
        board_id: c.board_id,
        card_id: c.id,
        kind: 'reminder',
        title: String(c.title).slice(0, 300),
        body: `${c.board_name} · ${c.list_name}`.slice(0, 2000),
      }));
    if (rows.length) {
      const { error: inboxError } = await db.from('board_inbox').insert(rows);
      if (inboxError) throw inboxError;
      sent += rows.length;
    }
  }
  return sent;
}

// ───────────────────────── Reglas programadas ─────────────────────────

const usesRules = (r: ColumnRules) =>
  r.autoArchive > 0 || r.rules.some((x) => x.on && SCHEDULED.includes(x.trigger.type));

const ruleLabel = (r: Rule) =>
  (r.name || `Regla de ${r.trigger.type}`).replace(/\s+/g, ' ').slice(0, 60);

type Totals = { boards: number; reminders: number; actions: number; archived: number };

async function sweepBoard(db: Db, board: Row, lists: Row[], totals: Totals) {
  const tz = typeof board.settings?.tz === 'string' ? board.settings.tz : DEFAULT_TZ;
  const { today, now } = wallClock(new Date(), tz);
  const nowIso = new Date().toISOString();
  const rulesOf = new Map<string, ColumnRules>(
    lists.map((l) => [l.id as string, normalizeRules(l.rules)]),
  );

  // Tarjetas del tablero (sin archivar).
  const listIds = lists.map((l) => l.id as string);
  const rows = await all((from, to) =>
    db
      .from('board_cards')
      .select('*')
      .in('list_id', listIds)
      .is('archived_at', null)
      .order('id')
      .range(from, to),
  );
  const cards: Card[] = rows.map((r) => ({
    ...(r as Card),
    tags: Array.isArray(r.tags) ? r.tags : [],
    checks: Array.isArray(r.checks) ? r.checks : [],
    completions: Array.isArray(r.completions) ? r.completions : [],
    priority: r.priority ?? '',
    highlight: Boolean(r.highlight),
    color: r.color ?? '',
    repeat: r.repeat ?? '',
    done: Boolean(r.done),
  }));
  if (!cards.length) return;
  const byId = new Map(cards.map((c) => [c.id, c]));

  // Pendientes vinculados (su estado y sus personas) y vínculos que bloquean.
  const entries = new Map<string, { status: string; person_ids: string[] }>();
  const entryIds = [...new Set(cards.flatMap((c) => (c.entry_id ? [c.entry_id] : [])))];
  for (const part of chunks(entryIds, 150)) {
    const { data, error } = await db.from('entries').select('id,status,person_ids').in('id', part);
    if (error) throw error;
    for (const e of (data ?? []) as Row[])
      entries.set(e.id, { status: e.status, person_ids: e.person_ids ?? [] });
  }
  const needsLinks = [...rulesOf.values()].some((r) =>
    r.rules.some((x) => x.when.some((w) => w.type === 'blocked' || w.type === 'not_blocked')),
  );
  const links: Row[] = needsLinks
    ? (
        await all((from, to) =>
          db
            .from('board_card_links')
            .select('a,b,kind,blocker,cond')
            .eq('owner_id', board.owner_id)
            .order('a')
            .order('b')
            .range(from, to),
        ).catch(() => [])
      ).filter((l) => byId.has(l.a) || byId.has(l.b))
    : [];

  // Lo que la app o el servidor ya aplicaron en este tablero.
  const runs = new Set(
    (
      await all((from, to) =>
        db
          .from('board_rule_runs')
          .select('key')
          .eq('board_id', board.id)
          .order('created_at')
          .order('key')
          .range(from, to),
      )
    ).map((r) => r.key as string),
  );

  const isDone = (c: Card) => {
    const e = c.entry_id ? entries.get(c.entry_id) : undefined;
    return e ? e.status === 'completado' : c.done;
  };
  const peopleOf = (c: Card) => {
    const ids = [...(c.entry_id ? (entries.get(c.entry_id)?.person_ids ?? []) : [])];
    if (c.person_id && !ids.includes(c.person_id)) ids.push(c.person_id);
    return ids;
  };
  const blocked = (c: Card) =>
    links.some((l) => {
      if (l.kind !== 'blocks' || !l.blocker || l.blocker === c.id) return false;
      if (l.a !== c.id && l.b !== c.id) return false;
      const b = byId.get(l.blocker);
      if (!b) return false;
      const cond: string = l.cond ?? 'done';
      return cond === 'done' ? !isDone(b) : b.list_id !== cond.slice(5);
    });
  const ctx: Ctx = { today, now, isDone, people: peopleOf, blocked };

  // ── Cambios: se aplican en memoria y se guardan una vez por tarjeta al final ──
  const pending = new Map<string, CardChanges>();
  const apply = (c: Card, ch: CardChanges) => {
    Object.assign(c, ch);
    pending.set(c.id, { ...pending.get(c.id), ...ch });
  };
  const live = (listId: string) =>
    cards.filter((c) => c.list_id === listId && !c.archived_at && !isDivider(c.title));
  const names = new Set<string>();
  const touched = new Map<string, string>();
  const fresh: { key: string; card: string }[] = [];

  function recur(c: Card) {
    apply(c, {
      completions: [...c.completions, { due: c.due ?? today, at: nowIso }].slice(-500),
      due: nextDue(c.repeat, c.due, today),
      done: false,
      done_at: null,
      checks: c.checks.map((x) => ({ ...x, done: false })),
    });
  }

  function runActions(rule: Rule, c: Card, depth: number, seen: Set<string>) {
    let did = false;
    for (const a of rule.then as Action[]) {
      if (c.archived_at) break;
      const ch = fieldChanges(c, a, today);
      if (ch) {
        apply(c, ch);
        did = true;
        continue;
      }
      if (a.type === 'complete' && !isDone(c)) {
        if (c.repeat) recur(c);
        else {
          apply(c, { done: true, done_at: nowIso });
          const e = c.entry_id ? entries.get(c.entry_id) : undefined;
          if (e) e.status = 'completado';
        }
        did = true;
      } else if (a.type === 'reopen' && isDone(c)) {
        apply(c, { done: false, done_at: null });
        const e = c.entry_id ? entries.get(c.entry_id) : undefined;
        if (e) e.status = 'pendiente';
        did = true;
      } else if (a.type === 'archive') {
        apply(c, { archived_at: nowIso });
        did = true;
      } else if (a.type === 'move') {
        const target = a.list;
        if (!target || target === c.list_id || !rulesOf.has(target)) continue;
        const cfg = rulesOf.get(target)!;
        const there = live(target);
        const full = there.filter((x) => !(x.snoozed_until && x.snoozed_until > today)).length;
        if (cfg.limit > 0 && cfg.limitMode === 'block' && full + 1 > cfg.limit) continue;
        const ranks = there.map((x) => x.rank);
        const from = c.list_id;
        apply(c, {
          list_id: target,
          rank: !ranks.length
            ? 1024
            : a.where === 'top'
              ? Math.min(...ranks) - 1024
              : Math.max(...ranks) + 1024,
        });
        did = true;
        runEvent('leave', c, from, depth + 1, seen);
        runEvent('enter', c, target, depth + 1, seen);
      }
    }
    return did;
  }
  /** Las reglas de una columna para algo que pasó por una regla (salir y llegar). */
  function runEvent(type: TriggerType, c: Card, listId: string, depth: number, seen: Set<string>) {
    if (depth > 5) return;
    for (const rule of rulesOf.get(listId)?.rules ?? []) {
      if (!rule.on || rule.trigger.type !== type) continue;
      const key = rule.id + '|' + c.id;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!conditionsHold(rule, c, ctx)) continue;
      if (runActions(rule, c, depth, seen)) {
        names.add(ruleLabel(rule));
        touched.set(c.id, c.title);
      }
    }
  }

  for (const list of lists) {
    const cfg = rulesOf.get(list.id)!;
    // Archivar solas las completadas hace tiempo (con la fecha real en que se completaron).
    if (cfg.autoArchive > 0)
      for (const c of live(list.id)) {
        if (!isDone(c) || !c.done_at) continue;
        if (daysBetween(dayIn(c.done_at, tz), today) < cfg.autoArchive) continue;
        const key = `auto|${c.id}|${c.done_at}`;
        if (runs.has(key)) continue;
        runs.add(key);
        apply(c, { archived_at: nowIso });
        fresh.push({ key, card: c.id });
        totals.archived++;
      }
    for (const rule of cfg.rules) {
      if (!rule.on || !SCHEDULED.includes(rule.trigger.type)) continue;
      const seen = new Set<string>();
      for (const c of live(list.id)) {
        if (c.list_id !== list.id) continue;
        if (!scheduledHit(rule.trigger, c, ctx, tz)) continue;
        if (!conditionsHold(rule, c, ctx)) continue;
        const key = `${rule.id}|${c.id}|${stampOf(rule.trigger, c, today)}`;
        if (runs.has(key)) continue;
        runs.add(key);
        fresh.push({ key, card: c.id });
        seen.add(rule.id + '|' + c.id);
        if (runActions(rule, c, 0, seen)) {
          names.add(ruleLabel(rule));
          touched.set(c.id, c.title);
        }
      }
    }
  }

  // ── Guardar ──
  const failed = new Set<string>();
  for (const [id, ch] of pending) {
    const { error } = await db.from('board_cards').update(ch).eq('id', id);
    if (error) {
      failed.add(id);
      console.error('board-sweep: no se pudo guardar la tarjeta', id, error.message ?? error);
    }
  }
  const keys = fresh.filter((f) => !failed.has(f.card));
  for (const part of chunks(keys, 200)) {
    const { error } = await db.from('board_rule_runs').upsert(
      part.map((f) => ({ owner_id: board.owner_id, board_id: board.id, key: f.key.slice(0, 300), source: 'server' })),
      { onConflict: 'owner_id,key', ignoreDuplicates: true },
    );
    if (error) console.error('board-sweep: no se pudo anotar lo aplicado', error.message ?? error);
  }
  const done = [...touched].filter(([id]) => !failed.has(id));
  totals.actions += done.length;
  if (names.size && done.length) {
    const label = names.size === 1 ? `Regla «${[...names][0]}»` : `${names.size} reglas`;
    await db.from('board_inbox').insert({
      owner_id: board.owner_id,
      board_id: board.id,
      card_id: done[0][0],
      kind: 'rule',
      title: `${label} en «${String(board.name).slice(0, 80)}»`.slice(0, 300),
      body: done
        .slice(0, 6)
        .map(([, title]) => `· ${String(title).slice(0, 120)}`)
        .join('\n')
        .concat(done.length > 6 ? `\n… y ${done.length - 6} más` : '')
        .slice(0, 2000),
    });
  }
}

async function sweepRules(db: Db, deadline: number, totals: Totals) {
  const boards = await all((from, to) =>
    db
      .from('boards')
      .select('id,owner_id,name,settings')
      .eq('is_template', false)
      .is('archived_at', null)
      .order('id')
      .range(from, to),
  );
  for (const group of chunks(boards, 100)) {
    const lists = await all((from, to) =>
      db
        .from('board_lists')
        .select('id,board_id,name,rank,rules')
        .in(
          'board_id',
          group.map((b) => b.id),
        )
        .order('rank')
        .order('id')
        .range(from, to),
    );
    for (const board of group) {
      if (Date.now() > deadline) return;
      const mine = lists.filter((l) => l.board_id === board.id);
      if (!mine.some((l) => usesRules(normalizeRules(l.rules)))) continue;
      try {
        await sweepBoard(db, board, mine, totals);
        totals.boards++;
      } catch (e) {
        console.error('board-sweep: falló el tablero', board.id, (e as Error)?.message ?? e);
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const secret = Deno.env.get('BOARD_SWEEP_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-sweep-secret') ?? '', secret))
    return json({ error: 'No autorizado.' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Falta la configuración del proyecto.' }, 500);
  const db = createClient(url, key, { auth: { persistSession: false } });

  const totals: Totals = { boards: 0, reminders: 0, actions: 0, archived: 0 };
  const deadline = Date.now() + BUDGET_MS;
  const problems: string[] = [];
  try {
    totals.reminders = await remind(db);
  } catch (e) {
    problems.push('recordatorios: ' + ((e as Error)?.message ?? JSON.stringify(e)));
    console.error('board-sweep: recordatorios', e);
  }
  try {
    await sweepRules(db, deadline, totals);
  } catch (e) {
    problems.push('reglas: ' + ((e as Error)?.message ?? JSON.stringify(e)));
    console.error('board-sweep: reglas', e);
  }
  return json({ ...totals, ...(problems.length && { problems }) }, problems.length ? 207 : 200);
});
