import type { EntryInput, Exchange, ExchangeKind } from '../data';
import { flowOf } from '../finance/money';
import { money, normalizeText } from '../lib/format';

/** Palabras de regalo o de invitar («le compré», «la invité», «detalle», «cumpleaños»). */
const GIFT =
  /\b(regal|obsequi|detalle|sorpresa|cumple|flores|ramo|le compre|les compre|le di|le pague|les pague|pague (?:su|sus|el|la|lo) |invit|tarjeta de regalo|torta)/;

/** Monto aproximado: $48.000, $120.000, $1.200.000. */
function approx(n: number) {
  const step = n < 100_000 ? 1_000 : n < 1_000_000 ? 10_000 : 100_000;
  return money(Math.max(step, Math.round(n / step) * step));
}

/** Lo clave del gasto: su título (o la categoría), sin el monto si ya venía escrito. */
function keyOf(input: EntryInput) {
  const title = input.title
    .replace(/\$?\s?\d[\d.,]*\s*(?:mil|k|lucas|pesos|cop)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (title || input.tags[0] || 'Gasto').slice(0, 70);
}

/** Cuánto pesa en «Dar y recibir»: un detalle, algo importante o algo grande. */
const weightOf = (amount: number): Exchange['weight'] =>
  amount < 40_000 ? 1 : amount < 200_000 ? 2 : 3;

/**
 * Lo que un movimiento con personas significa en «Dar y recibir», o null si no es un dar ni un
 * recibir. Un gasto (que no se dividió) es algo que le diste: un regalo o una invitación si lo dice,
 * si no, dinero. Un préstamo que hiciste también. Un ingreso que es un regalo, o un préstamo que te
 * hicieron, es algo que recibiste. Transferencias, ahorros, reembolsos y gastos divididos no cuentan.
 */
export function givingOf(
  input: EntryInput,
): Pick<Exchange, 'dir' | 'kind' | 'weight' | 'note'> | null {
  if (input.kind !== 'Movimiento' || !input.personIds.length || !(input.amount > 0)) return null;
  // Lo que aún no pasa (un pago programado) no es algo que ya diste.
  if (input.details.pending) return null;
  const flow = flowOf({ direction: input.direction, tags: input.tags, details: input.details });
  const text = normalizeText(`${input.title} ${input.body} ${input.tags.join(' ')}`);
  const gift = GIFT.test(text) || input.tags.some((t) => /^regalos?$/i.test(t));
  const note = (prefix: string) => `${prefix}${keyOf(input)} · ≈ ${approx(input.amount)}`.slice(0, 200);
  const weight = weightOf(input.amount);

  if (input.direction === 'egreso') {
    if (flow === 'prestamo') return { dir: 'dar', kind: 'dinero', weight, note: note('Préstamo · ') };
    if (flow !== 'gasto') return null;
    // Dividido: cada uno pone su parte (eso queda en Deudas, no es un regalo).
    if ((input.details.split?.n ?? 1) > 1) return null;
    const kind: ExchangeKind = gift ? 'regalo' : 'dinero';
    return { dir: 'dar', kind, weight, note: note('') };
  }
  if (flow === 'prestamo') return { dir: 'recibir', kind: 'dinero', weight, note: note('Te prestó · ') };
  if (flow === 'ingreso' && gift) return { dir: 'recibir', kind: 'regalo', weight, note: note('') };
  return null;
}
