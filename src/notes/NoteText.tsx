import type { ReactNode } from 'react';
import { parseLines, type Line } from './marks';
import { parseInline, type Inline } from './richText';

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.t === 'text') return n.v;
    if (n.t === 'link')
      return (
        <a
          key={i}
          className="kp-a"
          href={n.href}
          target="_blank"
          rel="noopener noreferrer"
          title={n.href}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {n.label.replace(/^https?:\/\/(www\.)?/i, '')}
        </a>
      );
    const kids = renderInline(n.kids);
    if (n.m === 'b') return <strong key={i}>{kids}</strong>;
    if (n.m === 'i') return <em key={i}>{kids}</em>;
    if (n.m === 'u') return <u key={i}>{kids}</u>;
    return <s key={i}>{kids}</s>;
  });
}

const content = (l: Line) => {
  const kids = renderInline(parseInline(l.text));
  return kids.length ? kids : <br />;
};

/** El texto de una nota con su formato (títulos, listas, negritas…) y enlaces clicables. */
export function NoteText({ text }: { text: string }) {
  const lines = parseLines(text);
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === 'ul' || l.kind === 'ol') {
      const items: Line[] = [];
      while (i < lines.length && lines[i].kind === l.kind) items.push(lines[i++]);
      i--;
      const lis = items.map((it, j) => <li key={j}>{content(it)}</li>);
      out.push(
        l.kind === 'ul' ? (
          <ul key={i}>{lis}</ul>
        ) : (
          <ol key={i} start={l.n}>
            {lis}
          </ol>
        ),
      );
      continue;
    }
    const cls = l.kind === 'h1' ? 'kp-h1' : l.kind === 'h2' ? 'kp-h2' : undefined;
    out.push(
      <div key={i} className={cls}>
        {content(l)}
      </div>,
    );
  }
  return <>{out}</>;
}
