import type { AppContextValue } from '../AppContext';
import type { Entry } from '../data';
import { friendlyDate, money, todayInputValue } from '../lib/format';
import { chargeStats, isOpenCharge, itemsOf, type ChargePart, type FinItem } from './model';
import { daysBetween } from './money';
import { updateItem } from './store';
import { moneyInput } from './ui';

/**
 * Lo que se hace con un cobro por partes: recibir una parte (o un abono suelto), aplazarla, darla
 * por perdida y mantener al día su pendiente «espero» (fecha y cierre).
 */

type App = Pick<AppContextValue, 'workspace' | 'createEntry' | 'patchEntry' | 'resolveTask' | 'notify'>;

const first = (s?: string) => (s ?? '').split(' ')[0];

const taskOf = (app: App, item: FinItem<'cobro'>): Entry | undefined =>
  item.data.taskId ? app.workspace.entries.find((e) => e.id === item.data.taskId) : undefined;

/** El pendiente sigue la próxima parte: su fecha se mueve o se cierra cuando el cobro termina. */
async function syncTask(app: App, item: FinItem<'cobro'>, parts: ChargePart[], closed: 'hecho' | 'no' | null) {
  const task = taskOf(app, item);
  if (!task || task.status !== 'pendiente') return;
  if (closed) {
    await app.resolveTask(task, closed, closed === 'no' ? 'El pago no se dio' : undefined);
    return;
  }
  const next = parts.filter((p) => p.status === 'esperando').sort((a, b) => a.due.localeCompare(b.due))[0];
  if (next && next.due !== task.details.due) await app.patchEntry(task, { details: { ...task.details, due: next.due } });
}

/** Crea el pendiente «espero» que te recuerda cobrar lo que falta. */
export async function ensureChargeTask(app: App, item: FinItem<'cobro'>, leftNow?: number) {
  if (taskOf(app, item)) return true;
  const s = chargeStats(item, app.workspace.entries);
  if (leftNow !== undefined) s.left = leftNow;
  const due = s.next?.due;
  const e = await app.createEntry(
    moneyInput({
      kind: 'Pendiente',
      title: (item.data.who ? `Cobrarle a ${first(item.data.who)}: ${item.title}` : `Cobrar lo que falta de «${item.title}»`).slice(0, 180),
      body: `Faltan ${money(s.left)} de ${money(item.data.total)}.`,
      amount: 0,
      direction: 'ingreso',
      personIds: item.data.personId ? [item.data.personId] : [],
      details: {
        priority: 'media',
        commitment: 'espero',
        ...(item.data.personId && { owner: item.data.personId }),
        ...(due && { due }),
        waitingSince: item.data.start,
      },
      episodeId: item.data.episodeId,
    }),
    true,
  );
  if (!e) return false;
  const r = await updateItem(item, { data: { taskId: e.id } });
  return r === true;
}

/**
 * Llegó plata del cobro: registra el ingreso (enlazado al cobro, su persona y su episodio) y, si
 * era una parte esperada, guarda cuándo llegó y cuánto. Cierra el cobro si ya está completo.
 */
export async function receiveCharge(
  app: App,
  item: FinItem<'cobro'>,
  part: ChargePart | null,
  opts: { amount: number; date: string; method?: string; note?: string },
) {
  const before = chargeStats(item, app.workspace.entries);
  const e = await app.createEntry(
    moneyInput({
      title: `Abono · ${item.title}`.slice(0, 180),
      body: opts.note ?? '',
      amount: opts.amount,
      direction: 'ingreso',
      date: opts.date,
      tags: item.data.category ? [item.data.category] : [],
      personIds: item.data.personId ? [item.data.personId] : [],
      details: {
        flow: 'ingreso',
        chargeId: item.id,
        ...((opts.method || item.data.method) && { method: opts.method || item.data.method }),
      },
      episodeId: item.data.episodeId,
    }),
    true,
  );
  if (!e) return false;
  const parts = item.data.parts.map((p) =>
    p.id === part?.id ? { ...p, status: 'llego' as const, gotOn: opts.date, got: opts.amount, entryId: e.id } : p,
  );
  const left = Math.max(0, item.data.total - before.received - opts.amount - (item.data.lost ?? 0));
  const done = left <= 0;
  // Si ya está completo, lo que se esperaba y no hizo falta deja de esperarse.
  const finalParts = done ? parts.map((p) => (p.status === 'esperando' ? { ...p, status: 'no' as const, note: p.note ?? 'No hizo falta' } : p)) : parts;
  await updateItem(item, { data: { parts: finalParts, ...(done && { closedOn: todayInputValue() }) } });
  await syncTask(app, item, finalParts, done ? 'hecho' : null);
  let msg = done ? `¡Completo! Recibiste ${money(item.data.total)} de «${item.title}».` : `Abono de ${money(opts.amount)} registrado. Faltan ${money(left)}.`;
  if (part) {
    const delay = daysBetween(part.moved?.[0] ?? part.due, opts.date);
    msg += delay > 0 ? ` Llegó con ${delay} ${delay === 1 ? 'día' : 'días'} de retraso.` : ' Llegó a tiempo.';
    if (opts.amount < part.amount) msg += ` Faltaron ${money(part.amount - opts.amount)} de esa parte.`;
  }
  app.notify(msg);
  return true;
}

/** Se movió la fecha: queda la nueva y se recuerda la anterior (para medir los retrasos). */
export async function postponePart(app: App, item: FinItem<'cobro'>, part: ChargePart, due: string, note?: string) {
  const parts = item.data.parts.map((p) =>
    p.id === part.id ? { ...p, due, moved: [...(p.moved ?? []), p.due], ...(note && { note }) } : p,
  );
  const r = await updateItem(item, { data: { parts } });
  if (r !== true) return app.notify(r);
  await syncTask(app, item, parts, null);
  app.notify(`Aplazada para el ${friendlyDate(due).toLowerCase()}.`);
}

/** No se dio: la parte se cierra; si se pierde, deja de contar en lo que falta. */
export async function dropPart(app: App, item: FinItem<'cobro'>, part: ChargePart, lost: boolean, note?: string) {
  const s = chargeStats(item, app.workspace.entries);
  const parts = item.data.parts.map((p) => (p.id === part.id ? { ...p, status: 'no' as const, ...(note && { note }) } : p));
  const lostNow = (item.data.lost ?? 0) + (lost ? Math.min(part.amount, s.left) : 0);
  const left = Math.max(0, item.data.total - s.received - lostNow);
  const closed = left <= 0;
  const r = await updateItem(item, {
    data: { parts, lost: lostNow || undefined, ...(closed && { closedOn: todayInputValue() }) },
  });
  if (r !== true) return app.notify(r);
  await syncTask(app, item, parts, closed ? (s.received > 0 ? 'hecho' : 'no') : null);
  app.notify(lost ? `Se dio por perdida: ${money(part.amount)}.` : 'Quedó sin fecha: lo que falta sigue pendiente.');
}

/** Cerrar a mano: lo que falta se da por perdido (o ya llegó todo). */
export async function closeCharge(app: App, item: FinItem<'cobro'>) {
  const s = chargeStats(item, app.workspace.entries);
  const parts = item.data.parts.map((p) => (p.status === 'esperando' ? { ...p, status: 'no' as const } : p));
  const r = await updateItem(item, {
    data: { parts, lost: (item.data.lost ?? 0) + s.left || undefined, closedOn: todayInputValue() },
  });
  if (r !== true) return app.notify(r);
  await syncTask(app, item, parts, s.received > 0 ? 'hecho' : 'no');
  app.notify(s.left > 0 ? `Cobro cerrado: ${money(s.left)} no llegaron.` : 'Cobro cerrado.');
}

/** Las partes que esperas recibir de todos tus cobros abiertos, por fecha. */
export function waitingParts(items: readonly FinItem[] | null) {
  return itemsOf(items, 'cobro')
    .filter(isOpenCharge)
    .flatMap((c) => c.data.parts.filter((p) => p.status === 'esperando').map((part) => ({ charge: c, part })))
    .sort((a, b) => a.part.due.localeCompare(b.part.due));
}
