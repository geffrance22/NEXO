/** Formatting uses positions in the saved source, the same coordinate system as highlights. */
export type Format = {
  start: number;
  end: number;
  kind: 'hidden' | 'strong' | 'em' | 'heading' | 'quote' | 'code';
};
export function formats(source: string): Format[] {
  const result: Format[] = [];
  const hide = (start: number, end: number) => result.push({ start, end, kind: 'hidden' });
  for (const m of source.matchAll(/^(#{1,6}[ \t]+|>[ \t]+)(.+)$/gm)) {
    const start = m.index!,
      body = start + m[1].length;
    hide(start, body);
    result.push({
      start: body,
      end: start + m[0].length,
      kind: m[1][0] === '>' ? 'quote' : 'heading',
    });
  }
  for (const m of source.matchAll(
    /(!\[[^\]]*\]\([^)]+\))|(\*\*|__|\x60|\*|(?<!\w)_)(?=\S)([^\n]+?)(?<=\S)\2(?!\w)/g,
  )) {
    if (m[1]) continue;
    const width = m[2].length,
      start = m.index!,
      end = start + m[0].length;
    hide(start, start + width);
    hide(end - width, end);
    result.push({
      start: start + width,
      end: end - width,
      kind: width === 2 ? 'strong' : m[2] === '\x60' ? 'code' : 'em',
    });
  }
  return result;
}
export function readableSlice(source: string, start = 0, end = source.length) {
  const hidden = formats(source).filter((f) => f.kind === 'hidden');
  for (const m of source.matchAll(/!\[[^\]]*\]\([^)]+\)/g))
    hidden.push({ start: m.index!, end: m.index! + m[0].length, kind: 'hidden' });
  let pos = start,
    text = '';
  for (const range of hidden.sort((a, b) => a.start - b.start)) {
    if (range.end <= pos || range.start >= end) continue;
    text += source.slice(pos, Math.max(pos, range.start));
    pos = Math.max(pos, range.end);
  }
  return text + source.slice(pos, end);
}
