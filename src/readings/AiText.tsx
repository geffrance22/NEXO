import type { ReactNode } from 'react';

/** **negritas** dentro de una línea. */
const inline = (s: string, key: string): ReactNode[] =>
  s
    .split(/(\*\*[^*\n]+\*\*)/g)
    .map((part, i) =>
      part.length > 4 && part.startsWith('**') && part.endsWith('**') ? (
        <strong key={key + i}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** Respuesta de la IA con su markdown ligero: párrafos, listas y negritas. */
export function AiText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const k = 'p' + out.length;
    out.push(
      <p key={k}>
        {para.map((l, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {inline(l, `${k}-${j}`)}
          </span>
        ))}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const k = 'u' + out.length;
    out.push(
      <ul key={k}>
        {list.map((l, j) => (
          <li key={j}>{inline(l, `${k}-${j}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.trim().split('\n')) {
    const line = raw.replace(/^#+\s*/, '');
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (BULLET.test(line)) {
      flushPara();
      list.push(line.replace(BULLET, ''));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="rd-ai-text">{out}</div>;
}

/**
 * Nota de un resaltado: el texto propio y, aparte, cada pregunta a la IA con su respuesta
 * (bloques que empiezan con «✦ »).
 */
export function MarkNote({ text }: { text: string }) {
  const parts = text.split(/\n{2,}(?=✦ )/);
  return (
    <div className="rd-note">
      {parts.map((part, i) => {
        if (!part.startsWith('✦ ')) return <p key={i}>{part}</p>;
        const [ask, ...rest] = part.slice(2).split('\n');
        return (
          <div className="rd-note-ai" key={i}>
            <strong>✦ {ask}</strong>
            <AiText text={rest.join('\n')} />
          </div>
        );
      })}
    </div>
  );
}
