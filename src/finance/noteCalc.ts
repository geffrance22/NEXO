import { normalizeText } from '../lib/format';
import { evalAmount } from './parse';

/**
 * Apuntes con calculadora: todo monto que empiece con «$» cuenta. Con «-» delante o detrás del
 * signo resta («-$12.000», «$-12k»); sin nada suma. Entiende «$5k», «$5.000», «$5000», «$1,5M»,
 * «$2 millones» y multiplica «$15k x3» o «3 x $15k». Una línea que termina en «:» (o empieza con
 * «#») abre una sección con su propio subtotal.
 */

export type NoteHit = {
  /** Clave estable mientras no cambie el concepto ni el monto (para saber si ya lo registraste). */
  key: string;
  start: number;
  end: number;
  /** Con signo y ya multiplicado. */
  value: number;
  /** Un solo monto, sin signo ni multiplicador. */
  unit: number;
  times: number;
  line: number;
  /** El concepto: lo que está escrito junto al monto. */
  label: string;
  section: string | null;
};

export type NoteSection = { title: string; plus: number; minus: number; total: number; n: number };

export type NoteCalc = {
  hits: NoteHit[];
  plus: number;
  minus: number;
  total: number;
  sections: NoteSection[];
};

const AMOUNT =
  /(?:(\d+(?:[.,]\d+)?)\s?[x×*]\s?)?([+\-−–])?\s?\$\s?([+\-−–])?\s?(\d[\d.,']*)(?:\s?(millones|millón|millon|mil|lucas|luca|palos|palo|k|m)(?![\p{L}\d]))?(?:\s?[x×*]\s?(\d+(?:[.,]\d+)?)(?!\d))?/giu;
const MINUS = /[-−–]/;

const factor = (s?: string) => {
  if (!s) return 1;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/** Lo que queda de un tramo de texto como concepto: sin viñetas, signos ni puntuación suelta. */
function cleanLabel(s: string) {
  return s
    .replace(/^[\s\-–—•*+=:;,.()[\]]+|[\s\-–—•*+=:;,.()[\]]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function headingOf(line: string) {
  const t = line.trim();
  if (!t || t.includes('$')) return null;
  if (/^#{1,3}\s+\S/.test(t)) return t.replace(/^#+\s+/, '').slice(0, 80);
  if (t.endsWith(':') && t.length <= 80) return t.slice(0, -1).trim();
  return null;
}

/** Los montos del apunte, sus sumas y los subtotales de cada sección. */
export function calcNote(text: string): NoteCalc {
  const hits: NoteHit[] = [];
  const sections = new Map<string, NoteSection>();
  const seen = new Map<string, number>();
  let offset = 0;
  let section: string | null = null;
  const lines = text.split('\n');
  lines.forEach((line, li) => {
    const head = headingOf(line);
    if (head !== null) section = head || null;
    const found: Omit<NoteHit, 'key' | 'label' | 'section' | 'line'>[] = [];
    AMOUNT.lastIndex = 0;
    for (let m = AMOUNT.exec(line); m; m = AMOUNT.exec(line)) {
      const [whole, pre, s1, s2, rawDigits, unitWord, post] = m;
      const digits = rawDigits.replace(/[.,'’]+$/, '');
      let end = m.index + whole.length;
      if (!unitWord && !post) end -= rawDigits.length - digits.length;
      const unit = evalAmount(digits + (unitWord ? ' ' + unitWord : ''));
      if (!unit || unit <= 0) continue;
      const times = factor(pre) * factor(post);
      const sign = MINUS.test(s1 ?? '') || MINUS.test(s2 ?? '') ? -1 : 1;
      found.push({ start: offset + m.index, end: offset + end, value: sign * Math.round(unit * times), unit, times });
    }
    found.forEach((h, i) => {
      // El concepto: lo escrito antes del monto (desde el anterior); si no hay, lo de después.
      const from = i ? found[i - 1].end - offset : 0;
      const before = cleanLabel(line.slice(from, h.start - offset));
      const after = cleanLabel(line.slice(h.end - offset, found[i + 1] ? found[i + 1].start - offset : undefined));
      const label = before || after || (section ?? 'Sin concepto');
      const base = normalizeText(label).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40) + '|' + h.value;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      hits.push({ ...h, key: n > 1 ? `${base}#${n}` : base, line: li, label, section });
      if (section) {
        const s = sections.get(section) ?? { title: section, plus: 0, minus: 0, total: 0, n: 0 };
        if (h.value > 0) s.plus += h.value;
        else s.minus -= h.value;
        s.total += h.value;
        s.n++;
        sections.set(section, s);
      }
    });
    offset += line.length + 1;
  });
  const plus = hits.filter((h) => h.value > 0).reduce((s, h) => s + h.value, 0);
  const minus = hits.filter((h) => h.value < 0).reduce((s, h) => s - h.value, 0);
  return { hits, plus, minus, total: plus - minus, sections: [...sections.values()] };
}

/** El texto partido en tramos normales y montos (para resaltarlos mientras escribes). */
export function noteSegments(text: string, hits: readonly NoteHit[]) {
  const out: { text: string; hit?: NoteHit }[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) out.push({ text: text.slice(at, h.start) });
    out.push({ text: text.slice(h.start, h.end), hit: h });
    at = h.end;
  }
  out.push({ text: text.slice(at) });
  return out;
}

/** El título que se muestra: el propio o la primera línea con texto. */
export function noteTitle(title: string, text: string) {
  if (title.trim()) return title.trim();
  const first = text
    .split('\n')
    .map((l) => l.replace(/^#+\s+/, '').trim())
    .find(Boolean);
  return first ? first.replace(/:$/, '').slice(0, 80) : 'Apunte sin título';
}
