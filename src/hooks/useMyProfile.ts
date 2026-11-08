import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../backend';
import type { AppUser, MyProfile, MyRecord } from '../data';
import { errorMessage } from '../lib/format';
import type { Notify } from './useToast';

export const MY_PROFILE_SQL = 'supabase/migrations/202611080001_my_profile.sql';
const HINT = `Para guardar tu ficha ejecuta ${MY_PROFILE_SQL} en el SQL Editor de Supabase.`;
const EMPTY: MyRecord = { profile: {}, reading: '', highlights: [], reading_at: null };

const isMissing = (e: { code?: string; message?: string }) =>
  e.code === '42P01' ||
  e.code === 'PGRST205' ||
  (/my_profile/.test(e.message ?? '') &&
    /does not exist|schema cache|find the table/i.test(e.message ?? ''));

/** Limpia lo que llega de la base (puede venir incompleto o mal formado). */
function clean(row: Partial<MyRecord> | null): MyRecord {
  if (!row) return EMPTY;
  const profile =
    row.profile && typeof row.profile === 'object' && !Array.isArray(row.profile)
      ? row.profile
      : {};
  return {
    profile,
    reading: typeof row.reading === 'string' ? row.reading : '',
    highlights: Array.isArray(row.highlights)
      ? row.highlights.filter((h): h is string => typeof h === 'string')
      : [],
    reading_at: typeof row.reading_at === 'string' ? row.reading_at : null,
  };
}

/** Tu propia ficha («Mi ficha»): se carga al entrar y se guarda en `my_profile`. */
export function useMyProfile(user: AppUser, notify: Notify) {
  const [me, setMe] = useState<MyRecord>(EMPTY);
  const [missing, setMissing] = useState(false);
  const latest = useRef(me);
  latest.current = me;

  useEffect(() => {
    let live = true;
    void supabase
      .from('my_profile')
      .select('profile,reading,highlights,reading_at')
      .eq('owner_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          if (isMissing(error)) setMissing(true);
          return;
        }
        setMe(clean(data));
      });
    return () => {
      live = false;
    };
  }, [user.id]);

  /** Guarda al instante y lo deshace si la base falla. */
  const save = useCallback(
    async (changes: Partial<MyRecord>) => {
      if (missing) {
        notify(HINT);
        return false;
      }
      const before = latest.current;
      const next = { ...before, ...changes };
      setMe(next);
      const { error } = await supabase.from('my_profile').upsert(
        {
          owner_id: user.id,
          profile: next.profile,
          reading: next.reading,
          highlights: next.highlights,
          reading_at: next.reading_at,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'owner_id' },
      );
      if (!error) return true;
      setMe(before);
      if (isMissing(error)) {
        setMissing(true);
        notify(HINT);
      } else notify('No se pudo guardar tu ficha: ' + errorMessage(error));
      return false;
    },
    [missing, notify, user.id],
  );

  const saveMe = useCallback((profile: MyProfile) => save({ profile }), [save]);
  const saveMyReading = useCallback(
    (reading: string, highlights: string[]) =>
      save({ reading, highlights, reading_at: new Date().toISOString() }),
    [save],
  );

  return { me, meMissing: missing, saveMe, saveMyReading };
}
