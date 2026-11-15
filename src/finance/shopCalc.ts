import type { Entry } from '../data';
import { amountsIn } from '../lib/capture';
import { normalizeText } from '../lib/format';
import type { ShopEntry, ShopItem, ShopList, ShopWhen } from './model';
import { flowOf, monthKey, monthName, shiftMonth } from './money';

/**
 * Compras: las listas generales (con un «para cuándo» aproximado) y la lista de cada carta del
 * mes, que al final compara qué se compró y qué no.
 */

export const shopWhenMeta: Record<ShopWhen, { label: string; months: number | null }> = {
  mes: { label: 'Este mes', months: 0 },
  proximo: { label: 'El próximo mes', months: 1 },
  trimestre: { label: 'En unos 3 meses', months: 3 },
  semestre: { label: 'En unos 6 meses', months: 6 },
  año: { label: 'En un año', months: 12 },
  algun: { label: 'Algún día', months: null },
};

/** El mes (AAAA-MM) al que apunta «para cuándo», contado desde hoy. */
export function dueOfWhen(when: ShopWhen, today: string) {
  const m = shopWhenMeta[when].months;
  return m === null ? undefined : shiftMonth(monthKey(today), m);
}

const monthsBetween = (a: string, b: string) =>
  Number(b.slice(0, 4)) * 12 +
  Number(b.slice(5, 7)) -
  (Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7)));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Este mes», «El próximo mes», «En 4 meses · marzo», «Era para octubre» o «Algún día». */
export function whenLabel(list: Pick<ShopList, 'due'>, today: string) {
  if (!list.due) return { text: 'Algún día', tone: 'muted' };
  const n = monthsBetween(monthKey(today), list.due);
  if (n < 0) return { text: `Era para ${monthName(list.due)}`, tone: 'late' };
  if (n === 0) return { text: 'Este mes', tone: 'now' };
  if (n === 1) return { text: 'El próximo mes', tone: 'soon' };
  return {
    text: n <= 11 ? `En ${n} meses · ${cap(monthName(list.due))}` : `En ${n} meses`,
    tone: 'later',
  };
}

/**
 * Agregar rápido: «Sartén $80k x2», «2 toallas 35.000», «Audífonos 250 mil». Separa la cantidad
 * y el precio aproximado del nombre.
 */
export function parseShopLine(raw: string) {
  let text = raw.trim().replace(/\s+/g, ' ');
  let qty: number | undefined;
  const q =
    /(?:^|\s)(?:[x×]\s?(\d{1,3})|(\d{1,3})\s?[x×]|(\d{1,3})\s?(?:unidades|unds?|uds?)\.?)(?=\s|$)/i.exec(
      text,
    );
  if (q) {
    qty = Number(q[1] ?? q[2] ?? q[3]);
    text = (text.slice(0, q.index) + text.slice(q.index + q[0].length)).trim();
  }
  let price: number | undefined;
  const hit = amountsIn(text).pop();
  if (hit) {
    price = hit.value;
    text = (text.slice(0, hit.start) + text.slice(hit.end)).trim();
  }
  if (!qty) {
    const lead = /^(\d{1,2})\s+(?=\p{L})/u.exec(text);
    if (lead) {
      qty = Number(lead[1]);
      text = text.slice(lead[0].length);
    }
  }
  text = text
    .replace(/\s+(?:por|a|de|en|unos?|unas?|aprox\.?|~)$/i, '')
    .replace(/^[\s\-–—•*:,.~]+|[\s\-–—•*:,.~]+$/g, '')
    .replace(/\s{2,}/g, ' ');
  return { text: (text || raw.trim()).slice(0, 200), qty: qty && qty > 1 ? qty : undefined, price };
}

/** Lo que cuesta una cosa de una lista (precio por cantidad). */
export const entryCost = (e: Pick<ShopEntry, 'price' | 'qty'>) => (e.price ?? 0) * (e.qty ?? 1);

export function listStats(l: ShopList) {
  const pending = l.items.filter((i) => !i.done);
  const done = l.items.filter((i) => i.done);
  return {
    pending,
    done,
    /** Lo que falta por comprar, aproximado. */
    left: pending.reduce((s, i) => s + entryCost(i), 0),
    total: l.items.reduce((s, i) => s + entryCost(i), 0),
  };
}

const STOP = new Set([
  'para',
  'con',
  'del',
  'las',
  'los',
  'una',
  'unos',
  'unas',
  'que',
  'por',
  'mas',
  'sin',
  'nuevo',
  'nueva',
]);
const words = (s: string) =>
  normalizeText(s)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => w.replace(/(es|s)$/, ''));

/**
 * El gasto del mes que parece esa compra: su nombre tiene la palabra principal (la primera) o todas
 * las palabras, y si le pusiste precio, cuesta algo parecido. Nunca uno que ya se usó.
 */
export function matchPurchase(
  item: Pick<ShopItem, 'text' | 'price'>,
  moves: readonly Entry[],
  used: ReadonlySet<string>,
) {
  const want = words(item.text);
  if (!want.length) return undefined;
  let best: Entry | undefined;
  let bestScore = 0;
  for (const e of moves) {
    if (used.has(e.id) || flowOf(e) !== 'gasto') continue;
    const has = new Set(words(e.title));
    const common = want.filter((w) => has.has(w)).length;
    if (!has.has(want[0]) && common < want.length) continue;
    if (item.price) {
      const r = e.amount / item.price;
      if (r < 0.4 || r > 2.5) continue;
    }
    const score =
      common / want.length +
      (item.price ? 1 - Math.min(1, Math.abs(e.amount - item.price) / item.price) : 0);
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

export function shopStats(items: readonly ShopItem[], entries: readonly Entry[]) {
  const si = items.filter((i) => i.status === 'si');
  const no = items.filter((i) => i.status === 'no');
  const pending = items.filter((i) => i.status === 'pendiente');
  const cost = (i: ShopItem) =>
    (i.entryId ? entries.find((e) => e.id === i.entryId)?.amount : undefined) ?? i.price ?? 0;
  return {
    si,
    no,
    pending,
    /** Lo que pensabas gastar (aproximado). */
    planned: items.reduce((s, i) => s + (i.price ?? 0), 0),
    /** Lo que gastaste en lo que sí compraste (lo real si está enlazado; si no, lo aproximado). */
    spent: si.reduce((s, i) => s + cost(i), 0),
  };
}

/** «Compraste 4 de 6; no compraste «A» y «B».» (para el cierre del mes). */
export function shopSummary(items: readonly ShopItem[]) {
  if (!items.length) return '';
  const si = items.filter((i) => i.status === 'si').length;
  const no = items.filter((i) => i.status !== 'si');
  const names = no
    .slice(0, 2)
    .map((i) => `«${i.text}»`)
    .join(' y ');
  return `De tu lista de compras compraste ${si} de ${items.length}${no.length ? `; no: ${names}${no.length > 2 ? ` y ${no.length - 2} más` : ''}` : ''}.`;
}
