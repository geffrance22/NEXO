import { useEffect, useState } from "react";
import { supabase } from "../backend";

/**
 * Migración de las fases 2 a 4 de Tableros: vínculos con tipo, recordatorios, reglas aplicadas
 * en la base, avisos del servidor, plantillas de tarjeta y enlaces de solo lectura. Sin ella todo
 * sigue funcionando como antes (lo nuevo avisa qué falta).
 */
export const PHASE2_SQL = "supabase/migrations/202611100009_board_phases_2_4.sql";
export const missingPhase2Text = `Para vínculos que bloquean, recordatorios, plantillas de tarjeta y enlaces de solo lectura ejecuta ${PHASE2_SQL} en el SQL Editor de Supabase.`;
export const isMissingPhase2 = (e: { message?: string }) =>
  /remind_at|reminded_at|blocker|board_rule_runs|board_inbox|board_card_templates|board_shares|shared_board/.test(
    e.message ?? "",
  );

let probe: Promise<boolean> | null = null;
let known: boolean | null = null;
const subs = new Set<(v: boolean) => void>();

/** ¿Existe la migración? Se pregunta una vez por sesión. */
export function hasPhase2(): Promise<boolean> {
  probe ??= Promise.resolve(
    supabase.from("board_rule_runs").select("key").limit(1),
  ).then(
    ({ error }) => {
      known = !error;
      subs.forEach((f) => f(known!));
      return known;
    },
    () => {
      probe = null;
      return false;
    },
  );
  return probe;
}
/** Si la migración falta después de todo (un error al guardar), se recuerda. */
export function markPhase2Missing() {
  known = false;
  probe = Promise.resolve(false);
  subs.forEach((f) => f(false));
}

/** null mientras se pregunta. */
export function usePhase2() {
  const [v, setV] = useState<boolean | null>(known);
  useEffect(() => {
    subs.add(setV);
    void hasPhase2().then(setV);
    return () => {
      subs.delete(setV);
    };
  }, []);
  return v;
}
