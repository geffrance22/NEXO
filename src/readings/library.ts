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
  /**
   * La primera vez que lo abriste (migración 202611100002): vacío si nunca lo abriste; sin la
   * migración no viene.
   */
  opened_at?: string | null;
};
type Change = Partial<Card> | ((c: Card) => Partial<Card>);

/** ¿Va antes `a` que `b` en la lista? (más reciente primero, como `reading_list`). */
const newer = (a: Card, b: Card) =>
  a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id);

/** Artículos por página (el `limit` de `reading_list`). */
const PAGE = 32;
/**
 * Con menos letras, la búsqueda recorre el texto entero de todos los artículos (el índice de
 * trigramas no sirve) y casi todo coincide: se espera a la segunda letra.
 */
const MIN_QUERY = 2;

export function useLibrary(view: string, query: string, revision: number, filtersRev = 0) {
  const needle = query.trim().length >= MIN_QUERY ? query.trim() : '';
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
    moreRef = useRef(false),
    // La próxima página reemplaza la lista (es la primera tras buscar, refrescar o cambiar de vista).
    replace = useRef(true),
    request = useRef<AbortController | null>(null);
  moreRef.current = more;
  useEffect(() => {
    let live = true;
    supabase.rpc('reading_filters').then(({ data }) => {
      if (live && data) setFilters(data);
    });
    return () => {
      live = false;
    };
  }, [revision, filtersRev]);
  // Los fijados de esta vista van aparte, arriba (sin la migración 012 simplemente no hay).
  const pinView = useRef(view);
  useEffect(() => {
    let live = true;
    // Otra colección: los fijados de la anterior se quitan ya. Al buscar siguen a la vista
    // hasta que llegan los nuevos.
    if (pinView.current !== view) {
      pinView.current = view;
      setPinned([]);
    }
    if (view === 'marks') return;
    const t = setTimeout(
      async () => {
        const { data, error } = await supabase.rpc('reading_pinned', {
          scope: view,
          needle,
        });
        if (live && !error) setPinned(data as Card[]);
      },
      needle ? 180 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [view, needle, revision]);
  const load = useCallback(async () => {
    if (pending.current || view === 'marks') return;
    pending.current = true;
    setLoading(true);
    const version = epoch.current;
    const controller = new AbortController();
    request.current = controller;
    try {
      const { data, error } = await supabase
        .rpc('reading_list', {
          scope: view,
          needle,
          before_date: cursor.current?.created_at ?? null,
          before_id: cursor.current?.id ?? null,
        })
        .abortSignal(controller.signal);
      if (version !== epoch.current) return;
      if (error) throw error;
      const rows = data as Card[];
      // Los fijados ya salen arriba: no se repiten abajo.
      const page = rows.filter((r) => !r.pinned_at);
      const first = replace.current;
      replace.current = false;
      setCards((v) => (first ? page : [...v, ...page]));
      cursor.current = rows.at(-1) ?? null;
      setMore(rows.length === PAGE);
    } catch (e) {
      if (version === epoch.current) setError((e as Error).message);
    } finally {
      if (version === epoch.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }, [view, needle]);
  const shownView = useRef(view);
  useEffect(() => {
    epoch.current++;
    // Lo que se estaba pidiendo para la búsqueda anterior ya no sirve.
    request.current?.abort();
    cursor.current = null;
    pending.current = false;
    replace.current = true;
    // Otra colección: se vacía ya. Al buscar o refrescar, la lista que había sigue a la vista
    // hasta que llega la nueva: sin parpadeos ni saltos.
    if (shownView.current !== view) {
      shownView.current = view;
      setCards([]);
    }
    setMore(false);
    setError('');
    setLoading(view !== 'marks');
    const t = setTimeout(load, needle ? 180 : 0);
    return () => {
      clearTimeout(t);
      epoch.current++;
      request.current?.abort();
    };
  }, [load, revision]);

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
