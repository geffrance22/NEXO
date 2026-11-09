import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../backend';
import { normalizeText } from '../lib/format';
import { MAX_HITS_PER_GROUP } from '../lib/search';
import { plainOf } from './links';
import { missingColumn, NOTES_CHANGED, NOTES_TOUCHED } from './useNotes';

export type NoteHit = {
  type: 'note';
  id: string;
  title: string;
  body: string;
  archived: boolean;
  created_at: string;
};
type Row = Omit<NoteHit, 'type'> & {
  tags: string[] | null;
  checks: { text: string }[] | null;
  text: string;
};

/** Notas en claro (nunca las de la bóveda), cargadas una vez y renovadas cuando cambian. */
let cache: Row[] | null = null;
let stale = true;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const invalidate = () => {
  stale = true;
};
window.addEventListener(NOTES_TOUCHED, invalidate);
window.addEventListener(NOTES_CHANGED, invalidate);
// Otra cuenta en la misma pestaña: no se busca en las notas de la anterior.
let searchUser: string | null | undefined;
supabase.auth.onAuthStateChange((_event, auth) => {
  const uid = auth?.user.id ?? null;
  if (uid === searchUser) return;
  searchUser = uid;
  cache = null;
  stale = true;
});

async function load() {
  const cols = 'id,title,body,tags,checks,archived,created_at';
  let res = await supabase
    .from('quick_notes')
    .select(cols)
    .eq('vaulted', false)
    .order('created_at', { ascending: false })
    .limit(2000);
  // Sin la migración nueva no hay bóveda: todas las notas están en claro.
  if (missingColumn(res.error))
    res = await supabase
      .from('quick_notes')
      .select(cols)
      .order('created_at', { ascending: false })
      .limit(2000);
  if (res.error) return;
  cache = (res.data as Omit<Row, 'text'>[]).map((n) => ({
    ...n,
    text: normalizeText(
      [
        n.title,
        plainOf(n.body),
        n.body,
        (n.tags ?? []).join(' '),
        (n.checks ?? []).map((c) => c.text).join(' '),
      ].join(' '),
    ),
  }));
  stale = false;
  listeners.forEach((l) => l());
}

/** Busca en las notas libres para el buscador global (sin tildes ni mayúsculas). */
export function useNoteSearch(query: string) {
  const [, setTick] = useState(0);
  const active = query.trim() !== '';
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (!active || !stale || loading) return;
    loading = load().finally(() => {
      loading = null;
    });
  }, [active, query]);

  return useMemo(() => {
    const words = normalizeText(query).split(/\s+/).filter(Boolean);
    if (!words.length || !cache) return [];
    const found = cache.filter((n) => words.every((w) => n.text.includes(w)));
    const inTitle = (n: Row) => {
      const t = normalizeText(n.title);
      return words.every((w) => t.includes(w));
    };
    return found
      .sort(
        (a, b) =>
          Number(inTitle(b)) - Number(inTitle(a)) || Number(a.archived) - Number(b.archived),
      )
      .slice(0, MAX_HITS_PER_GROUP)
      .map((n): NoteHit => ({
        type: 'note',
        id: n.id,
        title: n.title,
        body: n.body,
        archived: n.archived,
        created_at: n.created_at,
      }));
    // `cache` cambia fuera de React; el aviso de `listeners` vuelve a pintar.
  }, [query, cache]);
}
