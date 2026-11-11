import { supabase } from "../backend";
import { hasPhase2 } from "./boardPhase";

/**
 * Qué reglas programadas ya actuaron sobre qué tarjeta (la misma fecha, la misma llegada, el
 * mismo día). Con la migración 202611100009 se guardan en la base (`board_rule_runs`): así los
 * demás equipos y el servidor (board-sweep) saben lo que ya pasó y no se repite. Sin ella, solo
 * queda la memoria de este navegador.
 */

/**
 * Las claves que ya se aplicaron en este tablero (vacío si no existe la tabla). Con `since`, solo
 * las anotadas desde entonces: sirve para enterarse de lo que hizo el servidor mientras tanto.
 */
export async function loadRuns(
  boardId: string,
  since?: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!(await hasPhase2())) return out;
  for (let n = 0; n < 20_000; n += 1000) {
    let q = supabase
      .from("board_rule_runs")
      .select("key")
      .eq("board_id", boardId);
    if (since) q = q.gte("created_at", since);
    const { data, error } = await q
      .order("created_at")
      .order("key")
      .range(n, n + 999);
    if (error) break;
    for (const r of (data ?? []) as { key: string }[]) out.add(r.key);
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** Anota esas claves (si ya estaban, no pasa nada). */
export async function saveRuns(boardId: string, keys: string[]) {
  if (!keys.length || !(await hasPhase2())) return;
  const rows = [...new Set(keys)].map((key) => ({
    board_id: boardId,
    key: key.slice(0, 300),
    source: "app",
  }));
  for (let i = 0; i < rows.length; i += 200) {
    // Un fallo aquí no detiene nada: la memoria local ya evita repetir en este equipo.
    await supabase
      .from("board_rule_runs")
      .upsert(rows.slice(i, i + 200), {
        onConflict: "owner_id,key",
        ignoreDuplicates: true,
      });
  }
}
