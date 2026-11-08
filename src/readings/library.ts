import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../backend';
export type Card = {
  id: string;
  url: string;
  title: string;
  folder: string;
  archived: boolean;
  favorite: boolean;
  tags: string[];
  created_at: string;
  excerpt: string;
  minutes: number;
  cover: string | null;
  mark_count: number;
  /** 1–100 si ya empezaste a leerlo (migración 202611070010); vacío si no. */
  progress?: number | null;
  /** Fijado arriba de la lista (migración 202611070012). */
  pinned_at?: string | null;
  /** Lo marcaste como completado (migración 202611070012). */
  read_at?: string | null;
};
type Change = Partial<Card> | ((c: Card) => Partial<Card>);

/** ¿Va antes `a` que `b` en la lista? (más reciente primero, como `reading_list`). */
const newer = (a: Card, b: Card) =>
  a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id);

export function useLibrary(view: string, query: string, revision: number, filtersRev = 0) {
  const [cards, setCards] = useState<Card[]>([]),
    [pinned, setPinned] = useState<Card[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [filters, setFilters] = useState<{
    folders: string[];
    tags: string[];
    counts?: Record<string, number>;
  }>({
    folders: [],
    tags: [],
  });
  const cursor = useRef<Card | null>(null),
    epoch = useRef(0),
    pending = useRef(false),
    moreRef = useRef(false);
  moreRef.current = more;
  useEffect(() => {
    let live = true;
    supabase.rpc('reading_filters').then(({ data }) => {
      if (data && live) setFilters(data);
    });
    return () => {
      live = false;
    };
  }, [revision, filtersRev]);
  // Los fijados de esta vista van aparte, arriba (sin la migración 012 simplemente no hay).
  const pinKey = useRef('');
  useEffect(() => {
    let live = true;
    const key = view + '|' + query.trim();
    if (pinKey.current !== key) {
      pinKey.current = key;
      setPinned([]);
    }
    if (view === 'marks') return;
    const t = setTimeout(
      async () => {
        const { data, error } = await supabase.rpc('reading_pinned', {
          scope: view,
          needle: query.trim(),
        });
        if (live && !error) setPinned(data as Card[]);
      },
      query ? 180 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [view, query, revision]);
  const load = useCallback(async () => {
    if (pending.current || view === 'marks') return;
    pending.current = true;
    setLoading(true);
    const version = epoch.current;
    try {
      const { data, error } = await supabase.rpc('reading_list', {
        scope: view,
        needle: query.trim(),
        before_date: cursor.current?.created_at ?? null,
        before_id: cursor.current?.id ?? null,
      });
      if (version !== epoch.current) return;
      if (error) throw error;
      const rows = data as Card[];
      // Los fijados ya salen arriba: no se repiten abajo.
      setCards((v) => [...v, ...rows.filter((r) => !r.pinned_at)]);
      cursor.current = rows.at(-1) ?? null;
      setMore(rows.length === 32);
    } catch (e) {
      if (version === epoch.current) setError((e as Error).message);
    } finally {
      if (version === epoch.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }, [view, query]);
  useEffect(() => {
    epoch.current++;
    cursor.current = null;
    pending.current = false;
    setCards([]);
    setMore(false);
    setError('');
    setLoading(false);
    const t = setTimeout(load, query ? 180 : 0);
    return () => {
      clearTimeout(t);
      epoch.current++;
    };
  }, [load, revision, query]);

  /** Cambia una tarjeta en la lista al instante (sin volver a pedirla). */
  const patch = useCallback((id: string, change: Change) => {
    const apply = (c: Card) =>
      c.id === id ? { ...c, ...(typeof change === 'function' ? change(c) : change) } : c;
    setCards((v) => v.map(apply));
    setPinned((v) => v.map(apply));
  }, []);

  /** Fija o suelta una tarjeta al instante: sube a los fijados o vuelve a su sitio. */
  const pin = useCallback((card: Card, on: boolean) => {
    const next = { ...card, pinned_at: on ? new Date().toISOString() : null };
    if (on) {
      setPinned((v) => [next, ...v.filter((c) => c.id !== card.id)]);
      setCards((v) => v.filter((c) => c.id !== card.id));
      return;
    }
    setPinned((v) => v.filter((c) => c.id !== card.id));
    setCards((v) => {
      if (v.some((c) => c.id === card.id)) return v;
      const at = v.findIndex((c) => newer(next, c));
      // Más antigua que lo cargado: aparecerá al cargar más.
      if (at === -1) return moreRef.current ? v : [...v, next];
      return [...v.slice(0, at), next, ...v.slice(at)];
    });
  }, []);

  return { cards, pinned, more, loading, error, filters, load, patch, pin };
}
