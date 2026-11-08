import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { WeekPeek } from '../weekly/WeekPeek';
import type { ReadRow } from '../weekly/week';

/** Un artículo de Lecturas que terminaste o que llevas empezado. */
export type ShelfReading = {
  id: string;
  title: string;
  url: string;
  cover: string | null;
  minutes: number | null;
  read_at: string | null;
  mark_count: number;
  progress: number | null;
  created_at: string;
};

const COLUMNS = 'id,title,url,cover,minutes,read_at,mark_count,progress,created_at';

/**
 * Lecturas que llevas a medias (para «En curso»). Avanzan solas al leer en Lecturas. Sin la
 * migración 012 no se sabe cuáles terminaste: quedan las empezadas.
 */
export function useReadingShelf() {
  const [rows, setRows] = useState<ShelfReading[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const full = await supabase
        .from('reading_cards')
        .select(COLUMNS)
        .is('read_at', null)
        .gt('progress', 0)
        .order('created_at', { ascending: false })
        .limit(40);
      let data = full.data as ShelfReading[] | null;
      if (full.error) {
        const started = await supabase
          .from('reading_cards')
          .select('id,title,url,cover,minutes,mark_count,progress,created_at')
          .gt('progress', 0)
          .lt('progress', 100)
          .order('created_at', { ascending: false })
          .limit(40);
        data = started.error
          ? []
          : (started.data as Omit<ShelfReading, 'read_at'>[]).map((r) => ({ ...r, read_at: null }));
      }
      if (live) setRows(data ?? []);
    })();
    return () => {
      live = false;
    };
  }, []);
  return rows;
}

export const isFinished = (r: ShelfReading) => Boolean(r.read_at);

const toPeek = (r: ShelfReading): ReadRow => ({
  id: r.id,
  title: r.title,
  url: r.url,
  cover: r.cover,
  minutes: r.minutes,
  read_at: r.read_at!,
  marks: r.mark_count ?? 0,
});

/** Abre una lectura: la terminada, en su ficha (como en el periódico); la empezada, en Lecturas. */
export function useOpenReading() {
  const { go } = useApp();
  const [peek, setPeek] = useState<ReadRow | null>(null);
  const open = (r: ShelfReading) => (isFinished(r) ? setPeek(toPeek(r)) : go('Lecturas', r));
  const sheet = peek ? (
    <WeekPeek peek={{ kind: 'reading', row: peek }} onClose={() => setPeek(null)} />
  ) : null;
  return { open, sheet };
}
