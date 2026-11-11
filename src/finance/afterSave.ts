import type { EntryInput, Person } from '../data';
import { money, normalizeText } from '../lib/format';
import { itemsOf, periodKeyOf, type Debt, type Recurring } from './model';
import { flowOf } from './money';
import { createItem, financeState, loadFinance, updateItem } from './store';

const SUBSCRIPTION =
  /\b(netflix|spotify|disney|hbo|max\b|prime|youtube|apple|icloud|google one|chatgpt|openai|notion|canva|adobe|figma|github|platzi|duolingo|xbox|playstation|steam|crunchyroll|paramount|deezer|suscripci)/;

/** Antes de guardar: el fijo que nace de «se repite» recibe su id para quedar enlazado. */
export function prepareMoney(input: EntryInput) {
  if (input.details.repeat && !input.details.recurringId)
    input.details = { ...input.details, recurringId: crypto.randomUUID() };
}

const firstName = (p?: Person) => p?.name.split(' ')[0] ?? '';

/**
 * Después de guardar un movimiento: crea las deudas del reparto («Laura te debe $12.500») y la del
 * préstamo, y el fijo de «se repite». Devuelve un aviso corto (o null si no pasó nada).
 */
export async function afterMoneySaved(
  input: EntryInput,
  entryId: string,
  people: Person[],
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

  if (!said.length) return null;
  const text = said.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
