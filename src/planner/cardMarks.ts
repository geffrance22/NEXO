/**
 * Formato dentro del texto de una tarjeta:
 * - `**palabras**` las resalta (solo esas palabras).
 * - `--palabras--` las tacha. Los guiones deben ir pegados al texto y no en medio de una palabra
 *   («a--b» o «---» no se tachan).
 */
const MARKS =
  /\*\*(?=\S)([\s\S]*?\S)\*\*|(?<![\p{L}\p{N}-])--(?=[^\s-])([\s\S]*?[^\s-])--(?![\p{L}\p{N}-])/gu;

export type MarkPiece =
  { kind: "text"; text: string } | { kind: "hl" | "st"; pieces: MarkPiece[] };

/** El texto en trozos: texto suelto, resaltado o tachado (se pueden anidar). */
export function markPieces(text: string): MarkPiece[] {
  const out: MarkPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKS)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    out.push(
      m[1] !== undefined
        ? { kind: "hl", pieces: markPieces(m[1]) }
        : { kind: "st", pieces: markPieces(m[2]) },
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Sin las marcas (para avisos, la agenda y lectores de pantalla). */
export const plainMarks = (text: string): string =>
  text.replace(MARKS, (_m, hl?: string, st?: string) =>
    plainMarks(hl ?? st ?? ""),
  );
