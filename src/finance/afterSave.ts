import type { AppContextValue } from '../AppContext';
import { allotAmount } from '../composer/logic';
import type { AllotDraft, ChargeDraft, Entry, EntryInput, Person, SpendDraft } from '../data';
import { money, normalizeText } from '../lib/format';
import {
  addMark,
  invStats,
  itemsOf,
  periodKeyOf,
  pocketColors,
  type ChargePart,
  type Debt,
  type Recurring,
} from './model';
import { flowOf, moneyShort } from './money';
import { createItem, financeState, loadFinance, updateItem } from './store';
import { moneyInput } from './ui';

const SUBSCRIPTION =
  /\b(netflix|spotify|disney|hbo|max\b|prime|youtube|apple|icloud|google one|chatgpt|openai|notion|canva|adobe|figma|github|platzi|duolingo|xbox|playstation|steam|crunchyroll|paramount|deezer|suscripci)/;

/** Cobros por partes que nacen con el movimiento que se está guardando (no van a la base). */
const chargeDrafts = new Map<string, ChargeDraft>();
/** Lo que se destina y se gasta de un ingreso que se está guardando (tampoco va a la base). */
const incomeDrafts = new WeakMap<EntryInput, { allot: AllotDraft[]; spends: SpendDraft[] }>();

/**
 * Antes de guardar: el fijo que nace de «se repite» y el cobro por partes que nace de un abono
 * reciben su id para quedar enlazados. El borrador del cobro no se guarda en el movimiento.
 */
export function prepareMoney(input: EntryInput) {
  if (input.details.repeat && !input.details.recurringId)
    input.details = { ...input.details, recurringId: crypto.randomUUID() };
  const draft = input.details.chargeNew;
  if (draft) {
    const { chargeNew: _draft, ...rest } = input.details;
    const id = rest.chargeId ?? crypto.randomUUID();
    chargeDrafts.set(id, draft);
    input.details = { ...rest, chargeId: id };
  }
  const { allotNew, spendsNew, ...clean } = input.details;
  if (allotNew || spendsNew) {
    incomeDrafts.set(input, { allot: allotNew ?? [], spends: spendsNew ?? [] });
    input.details = clean;
  }
}

type Extra = Partial<Pick<AppContextValue, 'createEntry' | 'patchEntry' | 'resolveTask'>> & {
  entries?: readonly Entry[];
};

const firstName = (p?: Person) => p?.name.split(' ')[0] ?? '';

/**
 * Después de guardar un movimiento: crea las deudas del reparto («Laura te debe $12.500») y la del
 * préstamo, y el fijo de «se repite». Devuelve un aviso corto (o null si no pasó nada).
 */
export async function afterMoneySaved(
  input: EntryInput,
  entryId: string,
  people: Person[],
  extra: Extra = {},
): Promise<string | null> {
  const said: string[] = [];
  const flow = flowOf({ direction: input.direction, tags: input.tags, details: input.details });
  const fromIncome = incomeDrafts.get(input);
  incomeDrafts.delete(input);
  const method = input.details.method;

  // Gastos que ya hiciste con este ingreso: cada uno queda anexado a él (no necesitan Finanzas).
  if (fromIncome?.spends.length && flow === 'ingreso' && extra.createEntry) {
    let n = 0;
    let sum = 0;
    for (const s of fromIncome.spends) {
      const made = await extra.createEntry(
        moneyInput({
          title: (s.title.trim() || s.category || 'Gasto').slice(0, 180),
          amount: s.amount,
          direction: 'egreso',
          date: input.date,
          tags: s.category ? [s.category] : [],
          details: { flow: 'gasto', fromIncome: entryId, ...(method && { method }) },
        }),
        true,
      );
      if (made) {
        n++;
        sum += s.amount;
      }
    }
    if (n) said.push(`${n === 1 ? 'un gasto anexado' : `${n} gastos anexados`} (${money(sum)})`);
  }

  if (!financeState().items) await loadFinance();
  if (financeState().missing) return finish(said);
  const items = financeState().items ?? [];
  const debts = itemsOf(items, 'deuda');
  const person = (id: string) => people.find((p) => p.id === id);

  // Destinar una parte: un ahorro anexado al ingreso, en la meta, el bolsillo o la inversión.
  if (fromIncome?.allot.length && flow === 'ingreso' && !input.details.pending && extra.createEntry) {
    const went: string[] = [];
    for (const a of fromIncome.allot) {
      const amount = allotAmount(a, input.amount);
      if (!(amount > 0)) continue;
      const base = { amount, date: input.date, direction: 'egreso' as const };
      const how = { flow: 'ahorro' as const, fromIncome: entryId, ...(method && { method }) };
      let made: Entry | null = null;
      let name = '';
      if (a.to === 'meta') {
        const g = itemsOf(items, 'meta').find((x) => x.id === a.id);
        if (!g) continue;
        name = g.title;
        made = await extra.createEntry(
          moneyInput({
            ...base,
            title: `Ahorro para ${g.title}`,
            tags: ['Meta'],
            details: { ...how, goalId: g.id },
            episodeId: g.data.episodeId,
          }),
          true,
        );
      } else if (a.to === 'bolsillo') {
        let p = itemsOf(items, 'bolsillo').find((x) => x.id === a.id);
        if (!p && a.id === 'new') {
          const r = await createItem('bolsillo', 'Ahorro', {
            use: 'ahorro',
            color: pocketColors[0],
            emoji: '🐷',
            account: method,
            initial: 0,
            log: [],
          });
          if (typeof r !== 'string') p = r;
        }
        if (!p) continue;
        name = p.title;
        made = await extra.createEntry(
          moneyInput({
            ...base,
            title: `Guardé en ${p.title}`,
            tags: ['Ahorro'],
            details: { ...how, pocketId: p.id },
            episodeId: p.data.episodeId,
          }),
          true,
        );
      } else {
        const inv = itemsOf(items, 'inversion').find((x) => x.id === a.id);
        if (!inv) continue;
        // El aporte suma al último valor (nunca antes de la última actualización).
        const s = invStats(inv.data);
        const d = s.last && s.last.d > input.date ? s.last.d : input.date;
        const r = await updateItem(inv, { data: { log: addMark(inv.data.log, { d, v: s.value + amount, f: amount }) } });
        if (r !== true) continue;
        name = inv.title;
        made = await extra.createEntry(
          moneyInput({ ...base, title: `Aporte a ${inv.title}`, tags: ['Inversión'], details: how }),
          true,
        );
      }
      if (made) went.push(`${moneyShort(amount)} a ${name}`);
    }
    if (went.length) said.unshift(`destinaste ${went.join(', ')}`);
  }

  // Reparto: cada persona te debe su parte (una sola vez por movimiento y persona).
  const split = input.details.split;
  if (flow === 'gasto' && split && split.n > 1) {
    const share = Math.round(input.amount / split.n);
    for (const id of input.personIds) {
      if (debts.some((d) => d.data.entryId === entryId && d.data.personId === id)) continue;
      const p = person(id);
      const data: Debt = {
        dir: 'meDeben',
        personId: id,
        who: p?.name ?? 'Alguien',
        amount: share,
        date: input.date,
        note: input.title,
        origin: 'division',
        entryId,
        payments: [],
      };
      const made = await createItem('deuda', input.title || 'Gasto dividido', data);
      if (typeof made !== 'string') said.push(`${firstName(p)} te debe ${money(share)}`);
    }
  }

  // Préstamo: una deuda que se actualiza si editas el movimiento.
  if (flow === 'prestamo' && input.personIds.length) {
    const id = input.personIds[0];
    const p = person(id);
    const dir: Debt['dir'] = input.direction === 'egreso' ? 'meDeben' : 'debo';
    const existing = debts.find((d) => d.data.entryId === entryId && d.data.origin === 'prestamo');
    if (existing)
      await updateItem(existing, {
        data: { amount: input.amount, due: input.details.due, personId: id, who: p?.name ?? existing.data.who, dir },
      });
    else {
      const made = await createItem('deuda', input.title || 'Préstamo', {
        dir,
        personId: id,
        who: p?.name ?? 'Alguien',
        amount: input.amount,
        date: input.date,
        due: input.details.due,
        note: input.title,
        origin: 'prestamo',
        entryId,
        payments: [],
      });
      if (typeof made !== 'string')
        said.push(dir === 'meDeben' ? `${firstName(p)} te debe el préstamo` : `le debes a ${firstName(p)}`);
    }
  }

  // Se repite: nace el fijo (o la suscripción), con este periodo ya registrado.
  const repeat = input.details.repeat;
  const rid = input.details.recurringId;
  if (repeat && rid && !items.some((i) => i.id === rid)) {
    const title = input.title || input.tags[0] || 'Fijo';
    const data: Recurring = {
      amount: input.amount,
      dir: input.direction,
      flow,
      category: input.tags[0],
      method: input.details.method,
      day: Math.min(31, Math.max(1, repeat.day)),
      every: repeat.every,
      month: repeat.every === 'año' ? Number(input.date.slice(5, 7)) : undefined,
      kind: SUBSCRIPTION.test(normalizeText(title)) ? 'suscripcion' : 'fijo',
      done: [],
      start: input.date,
      personIds: input.personIds,
      fromEntry: entryId,
    };
    if (!input.details.pending) data.done = [periodKeyOf(data, input.date)];
    const made = await createItem('recurrente', title, data, rid);
    if (typeof made !== 'string') said.push(`quedó en Fijos (${repeat.every === 'año' ? 'cada año' : 'cada mes'})`);
  }

  // Abono: nace el cobro por partes, o se suma al que ya existe (y cumple la parte que esperabas).
  const cid = input.details.chargeId;
  if (cid && flow === 'ingreso') {
    const draft = chargeDrafts.get(cid);
    chargeDrafts.delete(cid);
    const charge = itemsOf(items, 'cobro').find((c) => c.id === cid);
    const got = input.details.pending ? 0 : input.amount;
    if (!charge && draft) {
      const rest = Math.max(0, draft.total - got);
      const parts: ChargePart[] =
        draft.nextOn && rest > 0
          ? [{ id: crypto.randomUUID(), due: draft.nextOn, amount: Math.min(rest, draft.nextAmount || rest), status: 'esperando' }]
          : [];
      const p = input.personIds[0] ? person(input.personIds[0]) : undefined;
      const made = await createItem(
        'cobro',
        draft.title || input.title || input.tags[0] || 'Trabajo',
        {
          total: draft.total,
          personId: p?.id,
          who: p?.name,
          episodeId: input.episodeId ?? undefined,
          start: input.date,
          category: input.tags[0],
          method: input.details.method,
          parts,
        },
        cid,
      );
      if (typeof made !== 'string') {
        said.push(`quedó como abono del trabajo: pendiente ${money(rest)} de ${money(draft.total)}`);
        if (draft.task !== false && draft.nextOn && extra.createEntry && rest > 0) {
          const task = await extra.createEntry(
            moneyInput({
              kind: 'Pendiente',
              title: (p ? `Cobrarle a ${firstName(p)}: ${made.title}` : `Cobrar lo que falta de «${made.title}»`).slice(0, 180),
              body: `Faltan ${money(rest)} de ${money(draft.total)}.`,
              amount: 0,
              direction: 'ingreso',
              personIds: p ? [p.id] : [],
              details: {
                priority: 'media',
                commitment: 'espero',
                ...(p && { owner: p.id }),
                ...(draft.nextOn && { due: draft.nextOn }),
                waitingSince: input.date,
              },
              episodeId: input.episodeId ?? undefined,
            }),
            true,
          );
          if (task) {
            await updateItem(made, { data: { taskId: task.id } });
            said.push('y un pendiente para cobrarlo');
          }
        }
      }
    } else if (charge && got > 0 && !charge.data.parts.some((pt) => pt.entryId === entryId)) {
      const received =
        (extra.entries ?? [])
          .filter((e) => e.kind === 'Movimiento' && e.id !== entryId && e.details.chargeId === cid && !e.details.pending)
          .reduce((s, e) => s + e.amount, 0) + got;
      const left = Math.max(0, charge.data.total - received - (charge.data.lost ?? 0));
      const match = charge.data.parts
        .filter((pt) => pt.status === 'esperando')
        .find((pt) => Math.abs(pt.amount - got) <= pt.amount * 0.15);
      const parts = charge.data.parts.map((pt) =>
        pt.id === match?.id
          ? { ...pt, status: 'llego' as const, gotOn: input.date, got, entryId }
          : left <= 0 && pt.status === 'esperando'
            ? { ...pt, status: 'no' as const, note: pt.note ?? 'No hizo falta' }
            : pt,
      );
      await updateItem(charge, { data: { parts, ...(left <= 0 && { closedOn: input.date }) } });
      said.push(left > 0 ? `abono a «${charge.title}»: pendiente ${money(left)}` : `«${charge.title}» quedó pagado`);
      const task = charge.data.taskId ? extra.entries?.find((e) => e.id === charge.data.taskId) : undefined;
      if (task && task.status === 'pendiente') {
        const next = parts.filter((pt) => pt.status === 'esperando').sort((a, b) => a.due.localeCompare(b.due))[0];
        if (left <= 0) await extra.resolveTask?.(task, 'hecho');
        else if (next && next.due !== task.details.due) await extra.patchEntry?.(task, { details: { ...task.details, due: next.due } });
      }
    }
  }

  return finish(said);
}

/** Un aviso corto con todo lo que pasó (o null si no pasó nada). */
function finish(said: string[]) {
  if (!said.length) return null;
  const text = said.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
