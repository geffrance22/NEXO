import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../backend";
import type { Notify } from "../hooks/useToast";
import { afterWrites } from "./boardStore";

/**
 * Tarjetas vinculadas entre columnas (migración 202611090004). Un vínculo no tiene dirección: se
 * guarda una vez, con el id menor en `a`. Cambia al instante en pantalla y se guarda de fondo.
 */
export type CardLink = { a: string; b: string };

export const LINKS_SQL = "supabase/migrations/202611090004_card_links.sql";
const missingText = `Para vincular tarjetas entre columnas ejecuta ${LINKS_SQL} en el SQL Editor de Supabase.`;
const isMissing = (e: { code?: string; message?: string }) =>
  e.code === "42P01" ||
  e.code === "PGRST205" ||
  /board_card_links/.test(e.message ?? "");

/** El par en su orden guardado. */
export const pairOf = (x: string, y: string): CardLink =>
  x < y ? { a: x, b: y } : { a: y, b: x };
export const linkKey = (l: CardLink) => l.a + "|" + l.b;

export function useCardLinks(boardId: string | null, notify: Notify) {
  const [links, setLinks] = useState<CardLink[]>([]);
  const [missing, setMissing] = useState(false);
  const live = useRef(links);
  live.current = links;
  const put = (next: CardLink[]) => {
    live.current = next;
    setLinks(next);
  };

  // Son pocos: se cargan todos los tuyos y cada tablero muestra los de sus tarjetas.
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("board_card_links")
      .select("a,b")
      .limit(5000);
    if (error) {
      if (isMissing(error)) setMissing(true);
      return;
    }
    setMissing(false);
    const next = (data ?? []) as CardLink[];
    live.current = next;
    setLinks(next);
  }, []);
  useEffect(() => {
    if (boardId) void load();
  }, [boardId, load]);

  const fail = (e: { code?: string; message?: string }) => {
    if (isMissing(e)) {
      setMissing(true);
      notify(missingText);
    } else notify("No se pudo guardar el vínculo: " + (e.message ?? "error"));
    void load();
  };

  const has = (x: string, y: string) => {
    const k = linkKey(pairOf(x, y));
    return live.current.some((l) => linkKey(l) === k);
  };
  const link = (x: string, y: string) => {
    if (x === y || has(x, y)) return;
    if (missing) return notify(missingText);
    const row = pairOf(x, y);
    put([...live.current, row]);
    void supabase
      .from("board_card_links")
      .insert(row)
      .then(({ error }) => error && fail(error));
  };
  const unlink = (x: string, y: string) => {
    const row = pairOf(x, y);
    const k = linkKey(row);
    put(live.current.filter((l) => linkKey(l) !== k));
    void supabase
      .from("board_card_links")
      .delete()
      .eq("a", row.a)
      .eq("b", row.b)
      .then(({ error }) => error && fail(error));
  };
  /** Los vínculos de esas tarjetas (para volver a ponerlos si deshaces su borrado). */
  const of = (ids: string[]) => {
    const set = new Set(ids);
    return live.current.filter((l) => set.has(l.a) || set.has(l.b));
  };
  /**
   * Al deshacer un borrado: la base los quitó con la tarjeta; se vuelven a guardar en cuanto las
   * tarjetas existan otra vez.
   */
  const restore = (rows: CardLink[]) => {
    if (!rows.length || missing) return;
    const keys = new Set(live.current.map(linkKey));
    put([...live.current, ...rows.filter((r) => !keys.has(linkKey(r)))]);
    const ids = [...new Set(rows.flatMap((r) => [r.a, r.b]))];
    void Promise.all(ids.map(afterWrites)).then(() =>
      supabase
        .from("board_card_links")
        .upsert(rows, { onConflict: "a,b", ignoreDuplicates: true })
        .then(({ error }) => error && fail(error)),
    );
  };

  return { links, missing, has, link, unlink, of, restore };
}
