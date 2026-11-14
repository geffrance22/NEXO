import type { AppContextValue } from '../AppContext';
import type { ChargeDraft, Entry, EntryInput, Person } from '../data';
import { money, normalizeText } from '../lib/format';
import { itemsOf, periodKeyOf, type ChargePart, type Debt, type Recurring } from './model';
import { flowOf } from './money';
import { createItem, financeState, loadFinance, updateItem } from './store';
import { moneyInput } from './ui';

const SUBSCRIPTION =
  /\b(netflix|spotify|disney|hbo|max\b|prime|youtube|apple|icloud|google one|chatgpt|openai|notion|canva|adobe|figma|github|platzi|duolingo|xbox|playstation|steam|crunchyroll|paramount|deezer|suscripci)/;

/** Cobros por partes que nacen con el movimiento que se está guardando (no van a la base). */
const chargeDrafts = new Map<string, ChargeDraft>();

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
  if (!financeState().items) await loadFinance();
  if (financeState().missing) return null;
  const items = financeState().items ?? [];
  const debts = itemsOf(items, 'deuda');
  const said: string[] = [];
  const flow = flowOf({ direction: input.direction, tags: input.tags, details: input.details });
  const person = (id: string) => people.find((p) => p.id === id);

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
        draft.title || input.title || input.tags[0] || 'Cobro por partes',
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
        said.push(`quedó como abono: faltan ${money(rest)} de ${money(draft.total)}`);
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
      said.push(left > 0 ? `abono a «${charge.title}»: faltan ${money(left)}` : `«${charge.title}» quedó completo`);
      const task = charge.data.taskId ? extra.entries?.find((e) => e.id === charge.data.taskId) : undefined;
      if (task && task.status === 'pendiente') {
        const next = parts.filter((pt) => pt.status === 'esperando').sort((a, b) => a.due.localeCompare(b.due))[0];
        if (left <= 0) await extra.resolveTask?.(task, 'hecho');
        else if (next && next.due !== task.details.due) await extra.patchEntry?.(task, { details: { ...task.details, due: next.due } });
      }
    }
  }

  if (!said.length) return null;
  const text = said.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
