import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../backend";
import type { Notify } from "../hooks/useToast";
import { afterWrites, fetchPaged } from "./boardStore";
import { isMissingPhase2, markPhase2Missing, missingPhase2Text } from "./boardPhase";

/**
 * Tarjetas vinculadas entre columnas (migración 202611090004). Un vínculo se guarda una vez, con
 * el id menor en `a`. Con la migración 202611100009 tiene tipo: relacionadas, o una bloquea a la
 * otra (`blocker` dice cuál) hasta que se cumpla su condición: que se complete o que llegue a una
 * columna. Cambia al instante en pantalla y se guarda de fondo.
 */
export type LinkKind = "rel" | "blocks";
/** done: hasta que la que bloquea se complete · list:<id>: hasta que llegue a esa columna. */
export type LinkCond = "done" | `list:${string}`;
export type CardLink = {
  a: string;
  b: string;
  kind?: LinkKind;
  blocker?: string | null;
  cond?: LinkCond;
  note?: string;
};
export type LinkType = Pick<CardLink, "kind" | "blocker" | "cond" | "note">;

export const LINKS_SQL = "supabase/migrations/202611090004_card_links.sql";
const missingText = `Para vincular tarjetas entre columnas ejecuta ${LINKS_SQL} en el SQL Editor de Supabase.`;
const isMissing = (e: { code?: string; message?: string }) =>
  e.code === "42P01" ||
  e.code === "PGRST205" ||
  /board_card_links/.test(e.message ?? "");

/** El par en su orden guardado. */
export const pairOf = (x: string, y: string): CardLink =>
  x < y ? { a: x, b: y } : { a: y, b: x };
export const linkKey = (l: Pick<CardLink, "a" | "b">) => l.a + "|" + l.b;
/** La otra tarjeta del vínculo. */
export const otherOf = (l: CardLink, id: string) => (l.a === id ? l.b : l.a);
/** ¿Este vínculo hace que `id` esté bloqueada (si la condición aún no se cumple)? */
export const blocksCard = (l: CardLink, id: string) =>
  l.kind === "blocks" && Boolean(l.blocker) && l.blocker !== id && (l.a === id || l.b === id);

/** ¿Sigue vigente el bloqueo? `blocker` es la tarjeta que bloquea tal como está ahora. */
export function stillBlocks(
  l: CardLink,
  blocker: { list_id: string } | undefined,
  isDone: (id: string) => boolean,
) {
  if (!blocker || !l.blocker) return false;
  const cond = l.cond ?? "done";
  if (cond === "done") return !isDone(l.blocker);
  return blocker.list_id !== cond.slice(5);
}

export function useCardLinks(boardId: string | null, notify: Notify) {
  const [links, setLinks] = useState<CardLink[]>([]);
  const [missing, setMissing] = useState(false);
  /** Sin la migración 202611100009: sin tipo (todas relacionadas). */
  const [typed, setTyped] = useState(true);
  const live = useRef(links);
  live.current = links;
  const put = (next: CardLink[]) => {
    live.current = next;
    setLinks(next);
  };

  // Se cargan todos los tuyos (de a mil, sin tope) y cada tablero muestra los de sus tarjetas.
  const load = useCallback(async () => {
    const page = (cols: string) =>
      fetchPaged<CardLink>((from, to, count) =>
        supabase
          .from("board_card_links")
          // Las columnas cambian según la migración: se piden por nombre.
          .select(cols as "*", count ? { count: "exact" } : undefined)
          .order("a")
          .order("b")
          .range(from, to),
      );
    let res = await page("a,b,kind,blocker,cond,note");
    let withType = true;
    if (res.error && !res.rows.length && !isMissing(res.error)) {
      withType = false;
      res = await page("a,b");
    }
    const { rows, error } = res;
    if (error && !rows.length) {
      if (isMissing(error)) setMissing(true);
      return;
    }
    setMissing(false);
    setTyped(withType);
    const next = rows.map((r) => ({ ...r, kind: r.kind ?? "rel" }));
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
    } else if (isMissingPhase2(e) || /\bkind\b|\bcond\b|\bnote\b/.test(e.message ?? "")) {
      setTyped(false);
      markPhase2Missing();
      notify(missingPhase2Text);
    } else notify("No se pudo guardar el vínculo: " + (e.message ?? "error"));
    void load();
  };

  const find = (x: string, y: string) => {
    const k = linkKey(pairOf(x, y));
    return live.current.find((l) => linkKey(l) === k);
  };
  const has = (x: string, y: string) => Boolean(find(x, y));
  const link = (x: string, y: string, type?: LinkType) => {
    if (x === y || has(x, y)) return;
    if (missing) return notify(missingText);
    if (type?.kind === "blocks" && !typed) return notify(missingPhase2Text);
    const row: CardLink = { ...pairOf(x, y), ...(type?.kind === "blocks" && type) };
    put([...live.current, { kind: "rel", ...row }]);
    void supabase
      .from("board_card_links")
      .insert(row)
      .then(({ error }) => error && fail(error));
  };
  /** Cambia el tipo de un vínculo (relacionadas, o quién bloquea a quién y hasta cuándo). */
  const setType = (x: string, y: string, type: LinkType) => {
    const cur = find(x, y);
    if (!cur) return;
    if (!typed) return notify(missingPhase2Text);
    const changes: LinkType =
      type.kind === "blocks"
        ? {
            kind: "blocks",
            blocker: type.blocker ?? cur.blocker ?? cur.a,
            cond: type.cond ?? cur.cond ?? "done",
            note: (type.note ?? cur.note ?? "").slice(0, 300),
          }
        : { kind: "rel", blocker: null, cond: "done", note: (type.note ?? cur.note ?? "").slice(0, 300) };
    const k = linkKey(cur);
    put(live.current.map((l) => (linkKey(l) === k ? { ...l, ...changes } : l)));
    void supabase
      .from("board_card_links")
      .update(changes)
      .eq("a", cur.a)
      .eq("b", cur.b)
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
    const clean = rows.map((r) =>
      typed && r.kind === "blocks"
        ? { a: r.a, b: r.b, kind: r.kind, blocker: r.blocker, cond: r.cond, note: r.note ?? "" }
        : { a: r.a, b: r.b },
    );
    void Promise.all(ids.map(afterWrites)).then(() =>
      supabase
        .from("board_card_links")
        .upsert(clean, { onConflict: "a,b", ignoreDuplicates: true })
        .then(({ error }) => error && fail(error)),
    );
  };

  return { links, missing, typed, has, find, link, setType, unlink, of, restore };
}
export type CardLinksApi = ReturnType<typeof useCardLinks>;
