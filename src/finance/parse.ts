import type { Direction, Entry, MoneyFlow } from '../data';
import { amountsIn, directionAt } from '../lib/capture';
import { guessCategory } from '../lib/captureCategories';
import { addDays, normalizeText, todayInputValue } from '../lib/format';

const UNITS: Record<string, number> = {
  k: 1e3,
  mil: 1e3,
  luca: 1e3,
  lucas: 1e3,
  barra: 1e3,
  barras: 1e3,
  m: 1e6,
  millon: 1e6,
  millones: 1e6,
  palo: 1e6,
  palos: 1e6,
};

/** «12.000», «1,5», «1.500,50», «1'200.000» → número (punto y coma como los usamos aquí). */
function readNumber(raw: string): number | null {
  let s = raw.replace(/['’]/g, '');
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = s
      .split(dec === ',' ? '.' : ',')
      .join('')
      .replace(dec, '.');
  } else if (dots || commas) {
    const parts = s.split(dots ? '.' : ',');
    const grouped =
      parts.length > 1 && parts[0].length <= 3 && parts.slice(1).every((p) => p.length === 3);
    if (grouped) s = parts.join('');
    else if (parts.length === 2) s = `${parts[0]}.${parts[1]}`;
    else return null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Monto escrito como lo dirías o como una cuenta: «50k», «20 mil», «1,5 millones», «$48.000»,
 * «12.000+8.500», «3x15000». null si no se entiende.
 */
export function evalAmount(text: string): number | null {
  const s = normalizeText(text)
    .replace(/[−–]/g, '-')
    .replace(/×/g, 'x')
    .replace(/\$|\bcop\b|\bpesos?\b/g, ' ')
    .trim();
  if (!s) return null;
  const re =
    /\s*([+\-*x/])?\s*(\d[\d.,'’]*)\s*(millones|millon|mil|lucas|luca|barras|barra|palos|palo|k|m)?(?![a-z\d])\s*/y;
  const nums: number[] = [];
  const ops: string[] = [];
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m || !m[0].length) return null;
    const op = m[1];
    if (nums.length && !op) return null;
    let n = readNumber(m[2]);
    if (n === null) return null;
    if (m[3]) n *= UNITS[m[3]];
    if (!nums.length) {
      if (op && op !== '+' && op !== '-') return null;
      if (op === '-') n = -n;
    } else ops.push(op!);
    nums.push(n);
    i = re.lastIndex;
  }
  if (!nums.length) return null;
  // Primero multiplicaciones y divisiones, luego sumas y restas.
  const terms = [nums[0]];
  const signs: string[] = [];
  ops.forEach((op, k) => {
    const n = nums[k + 1];
    if (op === '*' || op === 'x') terms[terms.length - 1] *= n;
    else if (op === '/') terms[terms.length - 1] = n ? terms[terms.length - 1] / n : NaN;
    else {
      signs.push(op);
      terms.push(n);
    }
  });
  let r = terms[0];
  signs.forEach((op, k) => (r = op === '+' ? r + terms[k + 1] : r - terms[k + 1]));
  return Number.isFinite(r) ? Math.round(r) : null;
}

/** ¿Es una cuenta (tiene operaciones) y no solo un número? */
export const isExpression = (text: string) => /\d\s*[+\-*x×/]\s*\d/.test(text.replace(/^\s*-/, ''));

const METHOD_WORDS: [RegExp, string][] = [
  [/\b(?:en |con )?efectivo\b|\bcash\b/, 'Efectivo'],
  [/\b(?:por |con |en |de )?nequi\b/, 'Nequi'],
  [/\b(?:por |con |en |de )?daviplata\b/, 'Daviplata'],
  [/\b(?:con (?:la )?)?(?:tarjeta (?:de )?)?credito\b/, 'Crédito'],
  [/\b(?:con (?:la )?)?(?:tarjeta (?:de )?)?debito\b/, 'Débito'],
  [/\b(?:con (?:la )?)?tarjeta\b/, 'Tarjeta'],
  [/\b(?:por )?transferencia\b|\bpse\b/, 'Transferencia'],
];

const FLOW_WORDS: [RegExp, MoneyFlow, Direction][] = [
  [/\b(?:le |les )?preste\b|\bprestamo (?:a|para)\b/, 'prestamo', 'egreso'],
  [/\bme prest(?:o|aron)\b|\bprestamo de\b/, 'prestamo', 'ingreso'],
  [/\bahorre\b|\bal ahorro\b|\bal bolsillo\b|\bpara (?:el )?ahorro\b/, 'ahorro', 'egreso'],
  [/\bme devolvi(?:o|eron)\b|\breembols/, 'reembolso', 'ingreso'],
  [/\bretire\b|\bsaque del cajero\b|\bcajero\b|\bpase (?:plata )?(?:a|de) mi\b/, 'transferencia', 'egreso'],
];

const DATE_WORDS: [RegExp, number][] = [
  [/\b(?:antier|anteayer|antes de ayer)\b/, -2],
  [/\bayer\b/, -1],
  [/\bhoy\b/, 0],
  [/\bmanana\b/, 1],
];
const PENDING = /\b(?:debo pagar|tengo que pagar|por pagar|me deben|por cobrar|vence|pendiente)\b/;
const FILLER =
  /\b(?:pague|gaste|compre|me costo|costo|me cobraron|recibi|me pagaron|me pago|cobre|gane|vendi|ahorre|retire|preste|le preste|me prestaron|me presto|me devolvio|me devolvieron)\b/g;

export type QuickGuess = {
  amount?: number;
  title?: string;
  direction?: Direction;
  flow?: MoneyFlow;
  category?: string;
  method?: string;
  date?: string;
  pending?: boolean;
};

/**
 * «almuerzo con Laura 38 mil nequi», «ayer me pagaron 2 millones del proyecto»: monto, concepto,
 * tipo, categoría, medio y fecha de una sola línea. Las personas las reconoce el formulario solo
 * (por el concepto).
 */
export function parseQuickLine(
  text: string,
  opts: { entries?: Entry[]; accounts?: string[]; today?: string } = {},
): QuickGuess {
  const raw = text.trim();
  if (!raw) return {};
  const today = opts.today ?? todayInputValue();
  const n = normalizeText(raw);
  // Los tramos que no van en el concepto (se borran del texto original si mide lo mismo).
  const drop: [number, number][] = [];
  const out: QuickGuess = {};

  const hit = amountsIn(raw)[0];
  if (hit) {
    out.amount = hit.value;
    drop.push([hit.start, hit.end]);
  } else {
    const loose = /(?:^|\s)(\d[\d.,']*\s*(?:k|mil|m)?)(?=\s|$)/.exec(n);
    const v = loose ? evalAmount(loose[1]) : null;
    if (v && v > 0) {
      out.amount = v;
      drop.push([loose!.index, loose!.index + loose![0].length]);
    }
  }

  for (const [re, flow, dir] of FLOW_WORDS)
    if (re.test(n)) {
      out.flow = flow;
      out.direction = dir;
      break;
    }
  if (!out.flow) {
    const dir = directionAt(n, hit?.start ?? 0);
    if (dir) {
      out.direction = dir;
      out.flow = dir === 'ingreso' ? 'ingreso' : 'gasto';
    }
  }

  const accounts = (opts.accounts ?? []).map((a) => [normalizeText(a), a] as const);
  for (const [k, name] of accounts) {
    const at = k.length >= 3 ? n.search(new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)) : -1;
    if (at >= 0) {
      out.method = name;
      drop.push([Math.max(0, at - 4), at + k.length]);
      break;
    }
  }
  if (!out.method)
    for (const [re, name] of METHOD_WORDS) {
      const m = re.exec(n);
      if (m) {
        out.method = name;
        drop.push([m.index, m.index + m[0].length]);
        break;
      }
    }

  for (const [re, shift] of DATE_WORDS) {
    const m = re.exec(n);
    if (m) {
      out.date = addDays(today, shift);
      if (shift > 0) out.pending = true;
      drop.push([m.index, m.index + m[0].length]);
      break;
    }
  }
  if (PENDING.test(n)) out.pending = true;
  for (const m of n.matchAll(FILLER)) drop.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);

  const base = n.length === raw.length ? raw : n;
  let title = '';
  for (let i = 0; i < base.length; i++) if (!drop.some(([a, b]) => i >= a && i < b)) title += base[i];
  title = title
    .replace(/\s+/g, ' ')
    .replace(/^(?:en|de|del|por|para|un|una|el|la|y)\s+/i, '')
    .replace(/\s+(?:en|de|del|por|con|y|a)$/i, '')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .trim();
  if (title) out.title = title.charAt(0).toUpperCase() + title.slice(1);

  if (out.flow === 'gasto' || out.flow === 'ingreso' || !out.flow) {
    const direction = out.direction ?? 'egreso';
    const g = guessCategory({
      near: title,
      local: title,
      clause: raw,
      whole: raw,
      direction,
      entries: opts.entries,
    });
    if (g.category && g.category !== 'Otro') out.category = g.category;
  }
  return out;
}
