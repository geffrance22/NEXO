import { Fragment, type ReactNode } from 'react';

/**
 * Enlaces dentro de las notas. El texto se guarda plano: un enlace con nombre queda como
 * `[nombre](https://…)` y una dirección suelta, tal cual. Al mostrar la nota se vuelven clicables.
 */
const LINK =
  /\[([^\]\n]{1,300})\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<>"'`]+)/gi;
const TRAILING = /[.,;:!?…]+$/;

/** Solo direcciones web y de correo; lo demás (javascript:, data:…) no se enlaza. */
export function safeHref(raw: string): string | null {
  const url = /^www\./i.test(raw) ? 'https://' + raw : raw;
  try {
    const u = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** Quita la puntuación final y los paréntesis de cierre que no abrió el propio enlace. */
function trimBare(url: string) {
  let out = url.replace(TRAILING, '');
  while (out.endsWith(')') && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0))
    out = out.slice(0, -1).replace(TRAILING, '');
  return out;
}

type Piece = { text: string } | { label: string; href: string; raw: string };

function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    let raw = m[0];
    let label: string;
    let target: string;
    if (m[2]) {
      label = m[1];
      target = m[2];
    } else {
      raw = trimBare(m[3]);
      label = raw;
      target = raw;
    }
    const href = safeHref(target);
    if (!href) continue;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ label, href, raw });
    last = at + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Texto con sus enlaces clicables (se abren en otra pestaña sin abrir la nota). */
export function LinkedText({ text }: { text: string }) {
  const parts = pieces(text);
  return (
    <>
      {parts.map((p, i): ReactNode =>
        'text' in p ? (
          <Fragment key={i}>{p.text}</Fragment>
        ) : (
          <a
            key={i}
            className="kp-a"
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            title={p.href}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {p.label.replace(/^https?:\/\/(www\.)?/i, '')}
          </a>
        ),
      )}
    </>
  );
}

/** Los enlaces de un texto, sin repetir. */
export function linksIn(text: string) {
  const seen = new Set<string>();
  const out: { label: string; href: string }[] = [];
  for (const p of pieces(text))
    if ('href' in p && !seen.has(p.href)) {
      seen.add(p.href);
      out.push({ label: p.label, href: p.href });
    }
  return out;
}

/** El texto tal como se lee: `[nombre](url)` → `nombre`. */
export const plainOf = (text: string) =>
  text.replace(/\[([^\]\n]{1,300})\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/gi, '$1');

export const hostOf = (href: string) => {
  try {
    const u = new URL(href);
    return u.protocol === 'mailto:' ? u.pathname : u.hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
};

const BLOCK = new Set([
  'P',
  'DIV',
  'LI',
  'UL',
  'OL',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'TR',
  'TABLE',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
]);

/**
 * Lo que pegas desde una web o un documento, como texto de nota: conserva los saltos de párrafo,
 * las viñetas y los hipervínculos (como `[texto](url)`). Devuelve null si no trae enlaces (entonces
 * basta el pegado normal).
 */
export function htmlToNoteText(html: string): string | null {
  if (!/<a\s[^>]*href/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  const newline = () => {
    if (out && !out.endsWith('\n')) out += '\n';
  };
  const walk = (node: Node, pre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? '';
      out += pre ? t : t.replace(/\s+/g, ' ');
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName;
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD'].includes(tag)) return;
    if (tag === 'BR') {
      out += '\n';
      return;
    }
    if (tag === 'A') {
      const href = safeHref(node.getAttribute('href') ?? '');
      const label = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (href) {
        const bare = href.replace(/\/$/, '');
        const same = !label || label === href || label === bare || href.endsWith(label);
        out += same ? href : `[${label.replace(/[[\]]/g, '')}](${href})`;
        return;
      }
    }
    const block = BLOCK.has(tag);
    if (block) newline();
    if (tag === 'LI') out += '• ';
    for (const child of node.childNodes) walk(child, pre || tag === 'PRE');
    if (block) newline();
  };
  walk(doc.body, false);
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, '').replace(/^ +/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
