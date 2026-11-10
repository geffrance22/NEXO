import { useMemo } from "react";
import { normalizeText } from "../lib/format";
import type { Shot } from "./model";
import { useCapturasWhen } from "./useCapturas";

export type ShotHit = { type: "shot"; shot: Shot };

const LIMIT = 6;

/**
 * Capturas cuyo título o descripción contienen lo buscado (sin importar tildes ni mayúsculas).
 * Se cargan la primera vez que se escribe algo en el buscador global.
 */
export function useCaptureSearch(query: string): ShotHit[] {
  const needle = normalizeText(query.trim());
  const { shots } = useCapturasWhen(needle !== "");
  return useMemo(() => {
    if (!needle || !shots) return [];
    const out: { shot: Shot; rank: number }[] = [];
    for (const shot of shots) {
      const name = normalizeText(shot.name);
      const inName = name.includes(needle);
      if (!inName && !normalizeText(shot.note).includes(needle)) continue;
      // Primero las que empiezan así, luego por título, luego por descripción; las archivadas al final.
      const rank =
        (name.startsWith(needle) ? 0 : inName ? 1 : 2) +
        (shot.archived_at ? 3 : 0);
      out.push({ shot, rank });
    }
    return out
      .sort(
        (a, b) =>
          a.rank - b.rank || b.shot.created_at.localeCompare(a.shot.created_at),
      )
      .slice(0, LIMIT)
      .map(({ shot }) => ({ type: "shot", shot }));
  }, [needle, shots]);
}
