import { pieces, safeHref } from './links';
import {
  lineToMd,
  MARK,
  MARK_ORDER,
  markOf,
  MARKERS,
  parseLines,
  type BlockKind,
  type Line,
  type Mark,
} from './marks';

/** Un tramo de una línea: texto, enlace o texto con formato (que a su vez lleva tramos). */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'link'; label: string; href: string; raw: string }
  | { t: 'mark'; m: Mark; kids: Inline[] };

const HOLE = /\uE000(\d+)\uE001/g;

/** Los tramos de una línea. Los enlaces se apartan antes para que sus `_` o `**` no cuenten. */
export function parseInline(text: string): Inline[] {
  const links: Inline[] = [];
  let masked = '';
  for (const p of pieces(text)) {
    if ('text' in p) masked += p.text;
    else {
      masked += `\uE000${links.length}\uE001`;
      links.push({ t: 'link', ...p });
    }
  }
  return marksIn(masked, links);
}

function marksIn(text: string, links: Inline[]): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...unmask(text.slice(last, at), links));
    const [mark, inner] = markOf(m);
    out.push({ t: 'mark', m: mark, kids: marksIn(inner, links) });
    last = at + m[0].length;
  }
  if (last < text.length) out.push(...unmask(text.slice(last), links));
  return out;
}

function unmask(text: string, links: Inline[]): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(HOLE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: 'text', v: text.slice(last, at) });
    out.push(links[Number(m[1])]);
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

/* ───────── Texto guardado → HTML del editor ───────── */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TAG: Record<Mark, string> = { b: 'b', i: 'i', u: 'u', s: 's' };

/** En el editor los enlaces se ven tal cual se escriben (`[nombre](url)`), para poder editarlos. */
function inlineHtml(nodes: Inline[]): string {
  return nodes
    .map((n) =>
      n.t === 'text'
        ? esc(n.v)
        : n.t === 'link'
          ? esc(n.raw)
          : `<${TAG[n.m]}>${inlineHtml(n.kids)}</${TAG[n.m]}>`,
    )
    .join('');
}

/** HTML (solo etiquetas conocidas y texto escapado) para el editor. */
export function toEditorHtml(md: string): string {
  let html = '';
  let list: 'ul' | 'ol' | null = null;
  for (const l of parseLines(md)) {
    const inner = inlineHtml(parseInline(l.text)) || '<br>';
    if (l.kind === 'ul' || l.kind === 'ol') {
      if (list !== l.kind) {
        if (list) html += `</${list}>`;
        html += l.kind === 'ol' && l.n !== 1 ? `<ol start="${l.n}">` : `<${l.kind}>`;
        list = l.kind;
      }
      html += `<li>${inner}</li>`;
      continue;
    }
    if (list) html += `</${list}>`;
    list = null;
    html += l.kind === 'p' ? `<div>${inner}</div>` : `<${l.kind}>${inner}</${l.kind}>`;
  }
  if (list) html += `</${list}>`;
  return html;
}

/** Solo lo de dentro de la línea (para pegar texto de una línea sin partirla). */
export const inlineEditorHtml = (text: string) => inlineHtml(parseInline(text));

/* ───────── HTML (editor o portapapeles) → texto guardado ───────── */

const BLOCKS = new Set([
  'DIV',
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'NAV',
  'MAIN',
  'FIGURE',
  'FIGCAPTION',
  'DL',
  'DT',
  'DD',
  'ADDRESS',
]);
const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'HEAD',
  'META',
  'LINK',
  'TITLE',
  'NOSCRIPT',
  'IMG',
  'PICTURE',
  'SVG',
  'IFRAME',
  'OBJECT',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'INPUT',
  'BUTTON',
  'SELECT',
  'TEXTAREA',
]);
const BLOCK_SELECTOR = [...BLOCKS].join(',');

type Options = {
  /** Texto pegado de una web: los espacios y saltos del HTML no cuentan. */
  collapse: boolean;
  /** Convierte `<a href>` en `[nombre](url)` (en el editor los enlaces ya son texto). */
  links: boolean;
};

const isEl = (n: Node): n is HTMLElement => n.nodeType === Node.ELEMENT_NODE;
const isBlock = (n: Node) => isEl(n) && BLOCKS.has(n.tagName);

function marksOf(el: HTMLElement): Mark[] {
  const tag = el.tagName;
  const st = el.style;
  const out = new Set<Mark>();
  const weight = st.fontWeight;
  if (weight) {
    if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) out.add('b');
  } else if (tag === 'B' || tag === 'STRONG') out.add('b');
  if (st.fontStyle) {
    if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') out.add('i');
  } else if (tag === 'I' || tag === 'EM') out.add('i');
  const deco = `${st.textDecoration} ${st.textDecorationLine}`;
  if (tag === 'U' || tag === 'INS' || deco.includes('underline')) out.add('u');
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || deco.includes('line-through'))
    out.add('s');
  return MARK_ORDER.filter((m) => out.has(m));
}

/** Envuelve cada línea con las marcas, dejando los espacios de los bordes por fuera. */
function wrap(inner: string, marks: Mark[]): string {
  if (!marks.length) return inner;
  const open = marks.map((m) => MARKERS[m]).join('');
  const close = [...marks]
    .reverse()
    .map((m) => MARKERS[m])
    .join('');
  return inner
    .split('\n')
    .map((line) => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(line);
      if (!m || !m[2]) return line;
      return m[1] + open + m[2] + close + m[3];
    })
    .join('\n');
}

function inline(node: Node, active: Set<Mark>, o: Options): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const v = (node.nodeValue ?? '').replace(/\u00a0/g, ' ');
    return o.collapse ? v.replace(/\s+/g, ' ') : v;
  }
  if (!isEl(node) || SKIP.has(node.tagName)) return '';
  if (node.tagName === 'BR') return '\n';
  const kids = (set: Set<Mark>) =>
    Array.from(node.childNodes)
      .map((c) => inline(c, set, o))
      .join('');
  if (node.tagName === 'A' && o.links) {
    const href = safeHref(node.getAttribute('href') ?? '');
    const label = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (href && label) {
      const bare = href.replace(/\/$/, '');
      const same = label === href || label === bare || href.endsWith(label);
      const link = same ? href : `[${label.replace(/[[\]]/g, '')}](${href})`;
      return wrap(
        link,
        marksOf(node).filter((m) => !active.has(m)),
      );
    }
  }
  const add = marksOf(node).filter((m) => !active.has(m));
  const text = wrap(kids(new Set([...active, ...add])), add);
  return isBlock(node) ? text + '\n' : text;
}

function pushInline(run: Node[], kind: BlockKind, out: Line[], o: Options) {
  let text = run.map((n) => inline(n, new Set(), o)).join('');
  if (!text.includes('\n') && !text.trim()) return;
  // El último salto es el que el navegador pone para que una línea vacía tenga alto.
  if (text.endsWith('\n')) text = text.slice(0, -1);
  for (const line of text.split('\n'))
    out.push({
      kind,
      text: o.collapse ? line.trim() : line.replace(/\s+$/, ''),
    });
}

function blocks(parent: Node, kind: BlockKind, out: Line[], o: Options) {
  let run: Node[] = [];
  const flush = () => {
    if (run.length) pushInline(run, kind, out, o);
    run = [];
  };
  for (const child of Array.from(parent.childNodes)) {
    if (isEl(child) && SKIP.has(child.tagName)) continue;
    if (!isBlock(child)) {
      // Envoltorios en línea con párrafos dentro (Google Docs pega todo dentro de un <b>).
      if (isEl(child) && child.querySelector(BLOCK_SELECTOR)) {
        flush();
        blocks(child, kind, out, o);
      } else run.push(child);
      continue;
    }
    flush();
    const el = child as HTMLElement;
    const tag = el.tagName;
    if (tag === 'UL' || tag === 'OL') {
      list(el, tag === 'OL' ? 'ol' : 'ul', out, o);
      continue;
    }
    const k: BlockKind = tag === 'H1' ? 'h1' : /^H[2-6]$/.test(tag) ? 'h2' : kind;
    const before = out.length;
    blocks(el, k, out, o);
    if (out.length === before && !o.collapse) out.push({ kind: k, text: '' });
  }
  flush();
}

function list(el: HTMLElement, kind: 'ul' | 'ol', out: Line[], o: Options) {
  let n = Number(el.getAttribute('start')) || 1;
  for (const c of Array.from(el.childNodes)) {
    if (!isEl(c)) {
      if (c.textContent?.trim()) out.push({ kind, text: c.textContent.trim(), n: n++ });
      continue;
    }
    if (c.tagName === 'UL' || c.tagName === 'OL') {
      list(c, c.tagName === 'OL' ? 'ol' : 'ul', out, o);
      continue;
    }
    const before = out.length;
    blocks(c, kind, out, o);
    if (out.length === before) out.push({ kind, text: '' });
    for (let i = before; i < out.length; i++) if (out[i].kind === 'ol') out[i].n = n++;
  }
}

function toMd(lines: Line[], o: Options) {
  let md = lines.map(lineToMd).join('\n');
  if (o.collapse) md = md.replace(/\n{3,}/g, '\n\n').trim();
  return md;
}

/** Lo que hay en el editor, como texto guardado. */
export const editorToMd = (root: HTMLElement) => {
  const o = { collapse: false, links: false };
  const lines: Line[] = [];
  blocks(root, 'p', lines, o);
  return toMd(lines, o);
};

/** Lo que pegas desde una web o un documento: conserva títulos, viñetas, negritas y enlaces. */
export function htmlToMd(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const o = { collapse: true, links: true };
  const lines: Line[] = [];
  blocks(doc.body, 'p', lines, o);
  return toMd(lines, o);
}
