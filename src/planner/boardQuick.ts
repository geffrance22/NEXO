import type { Person } from '../data';
import { normalizeText } from '../lib/format';
import type { Priority } from './boardStore';

/**
 * Escritura rápida al añadir tarjetas:
 * - `#etiqueta` añade la etiqueta.
 * - `@Ana` o `@Ana María` vincula a la persona (la más larga que coincida con tu gente).
 * - `!alta`, `!media`, `!baja` (o `!!!`, `!!`, `!` · `!1`, `!2`, `!3`) pone la prioridad.
 * - `**Texto**` (todo el título entre dos asteriscos) la deja resaltada. Con solo unas palabras
 *   entre `**` se resaltan esas palabras; entre `--`, se tachan.
 * Lo reconocido se quita del título; lo que no (una @ sin persona), se queda tal cual.
 */
export type Quick = {
  title: string;
  tags: string[];
  people: string[];
  priority: Priority;
  highlight: boolean;
  /** Menciones que no corresponden a nadie. */
  unknown: string[];
};

const PRIO: Record<string, Priority> = {
  alta: 'alta',
  urgente: 'alta',
  '1': 'alta',
  '!!!': 'alta',
  media: 'media',
  '2': 'media',
  '!!': 'media',
  baja: 'baja',
  '3': 'baja',
  '!': 'baja',
};
const TAG_RE = /(^|\s)#(\p{L}[\p{L}\p{N}_\-/.]*)/gu;
const PRIO_RE = /(^|\s)!(alta|media|baja|urgente|[123]|!{0,2})(?=\s|$)/giu;
const isEdge = (ch: string | undefined) => !ch || /[\s,.;:!?)]/.test(ch);

/** Nombres con los que se puede mencionar a alguien: los primeros nombres en orden, el apodo y nombre + apellido. */
function handles(p: Person) {
  const out = new Set<string>();
  const add = (s?: string) => {
    const n = normalizeText((s ?? '').trim()).replace(/\s+/g, ' ');
    if (n) out.add(n);
  };
  const words = p.name.trim().split(/\s+/);
  for (let i = 1; i <= words.length; i++) add(words.slice(0, i).join(' '));
  if (words.length > 2) add(`${words[0]} ${words.at(-1)}`);
  add(p.profile.alias);
  return [...out];
}

/** La persona mencionada al inicio de `rest` (el texto tras la @) y cuántos caracteres ocupa. */
function personAt(rest: string, people: Person[]) {
  const n = normalizeText(rest.replace(/_/g, ' '));
  // Un nombre que comparten varias personas no vale (salvo el nombre completo de alguien).
  const count = new Map<string, number>();
  for (const p of people) for (const h of handles(p)) count.set(h, (count.get(h) ?? 0) + 1);
  let best: { id: string; len: number } | null = null;
  for (const p of people) {
    const full = normalizeText(p.name.trim()).replace(/\s+/g, ' ');
    for (const h of handles(p)) {
      if (h !== full && (count.get(h) ?? 0) > 1) continue;
      if (!n.startsWith(h) || !isEdge(n[h.length])) continue;
      if (!best || h.length > best.len) best = { id: p.id, len: h.length };
    }
  }
  return best;
}

export function parseQuick(text: string, people: Person[]): Quick {
  let s = text;
  const ids: string[] = [];
  const unknown: string[] = [];

  // @personas (de derecha a izquierda, así los cortes no corren las posiciones). El nombre se
  // queda en el título («Llamar a Keila»); solo se quita la @.
  const ats = [...s.matchAll(/(^|\s)@/g)].map((m) => m.index! + m[1].length).reverse();
  for (const at of ats) {
    const hit = personAt(s.slice(at + 1), people);
    if (!hit) {
      const word = s.slice(at + 1).match(/^[^\s]+/)?.[0];
      if (word) unknown.unshift(word);
      continue;
    }
    if (!ids.includes(hit.id)) ids.unshift(hit.id);
    s = s.slice(0, at) + s.slice(at + 1, at + 1 + hit.len).replace(/_/g, ' ') + s.slice(at + 1 + hit.len);
  }

  // #etiquetas
  const tags: string[] = [];
  s = s.replace(TAG_RE, (_m, lead: string, tag: string) => {
    const t = tag.replace(/[.\-/]+$/, '');
    if (t && !tags.some((x) => normalizeText(x) === normalizeText(t))) tags.push(t);
    return lead;
  });

  // !prioridad (la última manda)
  let priority: Priority = '';
  s = s.replace(PRIO_RE, (_m, lead: string, v: string) => {
    const key = v.toLowerCase();
    priority = PRIO[key === '' ? '!' : key.startsWith('!') ? '!' + key : key] ?? priority;
    return lead;
  });

  let title = s.replace(/\s{2,}/g, ' ').trim();
  // **resaltada**: todo el título entre ** resalta la tarjeta entera. Si solo van unas palabras
  // entre ** (o entre -- para tacharlas), las marcas se quedan y se ven sobre esas palabras.
  let highlight = false;
  const star = /^\*\*([\s\S]+)\*\*$/.exec(title);
  if (star && star[1].trim() && !star[1].includes('**')) {
    highlight = true;
    title = star[1].trim();
  }
  if (!title) title = text.trim();
  return { title, tags, people: ids, priority, highlight, unknown };
}

/** ¿Hay algo de escritura rápida en el texto? (para mostrar la vista previa). */
export const hasQuick = (q: Quick) =>
  q.tags.length > 0 || q.people.length > 0 || Boolean(q.priority) || q.highlight;

/** La palabra que estás escribiendo tras una @ o un # (para sugerir). */
export function tokenAt(text: string, caret: number) {
  const before = text.slice(0, caret);
  const m = /(^|\s)([@#])([^\s@#]*)$/.exec(before);
  if (!m) return null;
  return { kind: m[2] as '@' | '#', query: m[3], start: caret - m[3].length - 1 };
}
