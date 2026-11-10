/**
 * Formato de las notas, guardado como texto plano al estilo Markdown (así la búsqueda, la bóveda y
 * las copias siguen funcionando igual):
 *
 * - Líneas: `# Título`, `## Subtítulo`, `- viñeta` (también `*` o `•`) y `1. lista numerada`.
 * - Dentro de la línea: `**negrita**`, `_cursiva_`, `++subrayado++` y `~~tachado~~`.
 *
 * Las marcas van pegadas al texto (`** hola**` no cuenta) y la cursiva no se abre a mitad de una
 * palabra, para no confundir nombres_con_guiones.
 */
export const MARK =
  /\*\*(?=\S)([^\n]*?\S)\*\*|~~(?=\S)([^\n]*?\S)~~|\+\+(?=\S)([^\n]*?\S)\+\+|(?<![\p{L}\p{N}_])_(?=\S)([^\n]*?\S)_(?![\p{L}\p{N}_])/gu;

export type Mark = 'b' | 'i' | 'u' | 's';
export const MARKERS: Record<Mark, string> = {
  b: '**',
  i: '_',
  u: '++',
  s: '~~',
};
/** Orden de apertura: la negrita por fuera (`**_así_**`). */
export const MARK_ORDER: Mark[] = ['b', 'i', 'u', 's'];

/** Qué marca abrió cada coincidencia de `MARK`, según el grupo que capturó. */
export const markOf = (m: RegExpMatchArray): [Mark, string] =>
  m[1] !== undefined
    ? ['b', m[1]]
    : m[2] !== undefined
      ? ['s', m[2]]
      : m[3] !== undefined
        ? ['u', m[3]]
        : ['i', m[4]];

export type BlockKind = 'p' | 'h1' | 'h2' | 'ul' | 'ol';
export type Line = { kind: BlockKind; text: string; n?: number };

const H1 = /^# (.*)$/;
const H2 = /^#{2,6} (.*)$/;
const UL = /^\s*[-*•] (.*)$/;
const OL = /^\s*(\d{1,4})[.)] (.*)$/;

/** Cada línea del texto con su tipo (título, viñeta, número o párrafo). */
export function parseLines(md: string): Line[] {
  return md.split('\n').map((line): Line => {
    let m: RegExpExecArray | null;
    if ((m = H1.exec(line))) return { kind: 'h1', text: m[1] };
    if ((m = H2.exec(line))) return { kind: 'h2', text: m[1] };
    if ((m = UL.exec(line))) return { kind: 'ul', text: m[1] };
    if ((m = OL.exec(line))) return { kind: 'ol', text: m[2], n: Number(m[1]) };
    return { kind: 'p', text: line };
  });
}

/** Una línea como texto guardado. */
export function lineToMd(l: Line): string {
  if (l.kind === 'ul') return '- ' + l.text;
  if (l.kind === 'ol') return `${l.n ?? 1}. ` + l.text;
  if (!l.text.trim()) return '';
  if (l.kind === 'h1') return '# ' + l.text;
  if (l.kind === 'h2') return '## ' + l.text;
  return l.text;
}

/** Quita las marcas de negrita, cursiva… (también anidadas). */
export function stripMarks(text: string): string {
  let prev = '';
  let out = text;
  while (out !== prev) {
    prev = out;
    out = out.replace(MARK, (...args) => (args[1] ?? args[2] ?? args[3] ?? args[4]) as string);
  }
  return out;
}

/** El texto sin formato: títulos como líneas normales y viñetas como «• ». */
export function stripFormat(md: string): string {
  return parseLines(md)
    .map((l) => {
      const text = stripMarks(l.text);
      if (l.kind === 'ul') return '• ' + text;
      if (l.kind === 'ol') return `${l.n}. ` + text;
      return text;
    })
    .join('\n');
}
