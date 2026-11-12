import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../backend";
import type { AppUser, MyProfile, MyRecord, PastReading } from "../data";
import { errorMessage } from "../lib/format";
import type { Notify } from "./useToast";

export const MY_PROFILE_SQL = "supabase/migrations/202611080001_my_profile.sql";
const HINT = `Para guardar tu ficha ejecuta ${MY_PROFILE_SQL} en el SQL Editor de Supabase.`;
const LOAD_FAILED =
  "Tu ficha no terminó de cargar. Recarga la página antes de guardar.";
const EMPTY: MyRecord = {
  profile: {},
  reading: "",
  highlights: [],
  reading_at: null,
};
/** Cuántas lecturas anteriores se guardan. */
const HISTORY = 6;

const isMissing = (e: { code?: string; message?: string }) =>
  e.code === "42P01" ||
  e.code === "PGRST205" ||
  (/my_profile/.test(e.message ?? "") &&
    /does not exist|schema cache|find the table/i.test(e.message ?? ""));

/** Limpia lo que llega de la base (puede venir incompleto o mal formado). */
function clean(row: Partial<MyRecord> | null): MyRecord {
  if (!row) return EMPTY;
  const profile =
    row.profile &&
    typeof row.profile === "object" &&
    !Array.isArray(row.profile)
      ? row.profile
      : {};
  return {
    profile,
    reading: typeof row.reading === "string" ? row.reading : "",
    highlights: Array.isArray(row.highlights)
      ? row.highlights.filter((h): h is string => typeof h === "string")
      : [],
    reading_at: typeof row.reading_at === "string" ? row.reading_at : null,
  };
}

/** Tu propia ficha («Mi ficha»): se carga al entrar y se guarda en `my_profile`. */
export function useMyProfile(user: AppUser, notify: Notify) {
  const [me, setMe] = useState<MyRecord>(EMPTY);
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Si la carga falló (sin que falte la tabla), guardar reemplazaría tu ficha por una vacía.
  const [failed, setFailed] = useState(false);
  const latest = useRef(me);
  latest.current = me;

  useEffect(() => {
    let live = true;
    void supabase
      .from("my_profile")
      .select("profile,reading,highlights,reading_at")
      .eq("owner_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        setLoaded(true);
        if (error) {
          if (isMissing(error)) setMissing(true);
          else setFailed(true);
          return;
        }
        setMe(clean(data));
      });
    return () => {
      live = false;
    };
  }, [user.id]);

  /**
   * Guarda al instante y lo deshace si la base falla. `changes` puede ser una función que recibe la
   * ficha más reciente: así no se pisa lo que otra parte de la app guardó mientras tanto.
   */
  const save = useCallback(
    async (
      changes: Partial<MyRecord> | ((now: MyRecord) => Partial<MyRecord>),
    ) => {
      if (missing) {
        notify(HINT);
        return false;
      }
      if (!loaded || failed) {
        notify(LOAD_FAILED);
        return false;
      }
      const before = latest.current;
      const next = {
        ...before,
        ...(typeof changes === "function" ? changes(before) : changes),
      };
      latest.current = next;
      setMe(next);
      const { error } = await supabase.from("my_profile").upsert(
        {
          owner_id: user.id,
          profile: next.profile,
          reading: next.reading,
          highlights: next.highlights,
          reading_at: next.reading_at,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      );
      if (!error) return true;
      latest.current = before;
      setMe(before);
      if (isMissing(error)) {
        setMissing(true);
        notify(HINT);
      } else notify("No se pudo guardar tu ficha: " + errorMessage(error));
      return false;
    },
    [failed, loaded, missing, notify, user.id],
  );

  const saveMe = useCallback((profile: MyProfile) => save({ profile }), [save]);

  /**
   * Cambia solo los campos indicados, encima de la ficha más reciente. Un campo en `undefined` se
   * borra; los que no se mencionan (Mi espacio, carpetas del diario, metas de lectura) no se tocan.
   */
  const patchMe = useCallback(
    (fields: Partial<MyProfile>) =>
      save((now) => {
        const profile: Record<string, unknown> = { ...now.profile };
        for (const [k, v] of Object.entries(fields)) {
          if (v === undefined) delete profile[k];
          else profile[k] = v;
        }
        return { profile: profile as MyProfile };
      }),
    [save],
  );

  /** Guarda la lectura nueva; la anterior pasa al historial. */
  const saveMyReading = useCallback(
    (reading: string, highlights: string[]) =>
      save((now) => {
        const history: PastReading[] = now.profile.readingHistory ?? [];
        const past =
          now.reading.trim() && now.reading_at
            ? [
                {
                  at: now.reading_at,
                  reading: now.reading,
                  highlights: now.highlights,
                },
                ...history,
              ]
            : history;
        return {
          reading,
          highlights,
          reading_at: new Date().toISOString(),
          profile: { ...now.profile, readingHistory: past.slice(0, HISTORY) },
        };
      }),
    [save],
  );

  return {
    me,
    meMissing: missing,
    meLoaded: loaded,
    meFailed: failed,
    saveMe,
    patchMe,
    saveMyReading,
  };
}
