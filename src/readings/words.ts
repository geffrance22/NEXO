import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../backend';
import type { Notify } from '../hooks/useToast';
import { normalizeText } from '../lib/format';

/** Una palabra o un concepto por aprender (tabla `reading_words`, migración 013). */
export type Word = {
  id: string;
  term: string;
  /** La frase del artículo donde apareció. */
  context: string;
  /** Lo que significa, con tus palabras. */
  note: string;
  reading_id: string | null;
  /** Título del artículo (se conserva aunque el artículo se borre). */
  source: string;
  /** Cuándo lo tachaste como aprendido. */
  learned_at: string | null;
  created_at: string;
};
export type NewWord = Pick<Word, 'term'> & Partial<Pick<Word, 'context' | 'reading_id' | 'source'>>;

export const WORDS_SQL = 'supabase/migrations/202611070013_reading_words.sql';
/** Clave para comparar términos: sin tildes, mayúsculas ni espacios de más. */
export const wordKey = (s: string) => normalizeText(s.trim().replace(/\s+/g, ' '));

/** Término limpio a partir de lo seleccionado: sin comillas ni puntuación en los bordes. */
export function cleanTerm(s: string) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'«»“”‘’()[\]¿¡.,;:!?…*_-]+|[\s"'«»“”‘’()[\]¿¡.,;:!?…*_-]+$/g, '')
    .trim();
}
/** Solo palabras o conceptos (no párrafos enteros). */
export const isTerm = (s: string) => s.length >= 1 && s.length <= 120 && s.split(' ').length <= 12;

/** Dónde empieza y termina la frase que contiene el fragmento [start, end). */
export function sentenceAround(content: string, start: number, end: number) {
  const stop = /[.!?\n]/;
  let a = start;
  while (a > 0 && !stop.test(content[a - 1]) && start - a < 500) a--;
  let b = end;
  while (b < content.length && !stop.test(content[b]) && b - end < 500) b++;
  if (b < content.length && content[b] !== '\n') b++;
  return { start: a, end: b };
}

const isMissing = (e: { code?: string; message?: string }) =>
  e.code === '42P01' ||
  e.code === 'PGRST205' ||
  /reading_words/.test(e.message ?? '') ||
  /schema cache|does not exist|could not find/i.test(e.message ?? '');

/**
 * El diccionario: se carga una vez y todo cambia al instante (añadir, tachar, anotar, borrar);
 * se guarda de fondo y, si falla, se deshace con un aviso.
 */
export function useWords(notify: Notify) {
  const [words, setWords] = useState<Word[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  // Palabras nuevas con id provisional («tmp:…») hasta que la base les da el suyo.
  const saving = useRef(new Map<string, Promise<string | null>>());
  const saved = useRef(new Map<string, string>());
  // Quitadas mientras se guardaban: si el guardado falla, no hace falta avisar.
  const dropped = useRef(new Set<string>());
  const same = (w: Word, id: string) => w.id === id || w.id === saved.current.get(id);
  const live = useRef(words);
  live.current = words;

  useEffect(() => {
    let alive = true;
    supabase
      .from('reading_words')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3000)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setState(isMissing(error) ? 'missing' : 'error');
        else {
          setWords((data ?? []) as Word[]);
          setState('ready');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const fail = useCallback(
    (e: { code?: string; message?: string }, what: string) => {
      if (isMissing(e)) {
        setState('missing');
        notify(`Para usar el diccionario ejecuta ${WORDS_SQL} en el SQL Editor de Supabase.`);
      } else notify(`${what}: ${e.message ?? 'error desconocido'}`);
    },
    [notify],
  );
  const realId = async (id: string) =>
    id.startsWith('tmp:') ? ((await saving.current.get(id)) ?? null) : id;

  const find = useCallback((term: string) => {
    const k = wordKey(term);
    return k ? live.current.find((w) => wordKey(w.term) === k) : undefined;
  }, []);

  /** Añade un término (si ya estaba, lo devuelve sin duplicarlo). */
  const add = useCallback(
    (input: NewWord): Word | null => {
      const term = cleanTerm(input.term).slice(0, 200);
      if (!term) return null;
      const existing = find(term);
      if (existing) return existing;
      const local: Word = {
        id: 'tmp:' + crypto.randomUUID(),
        term,
        context: (input.context ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200),
        note: '',
        reading_id: input.reading_id ?? null,
        source: (input.source ?? '').slice(0, 300),
        learned_at: null,
        created_at: new Date().toISOString(),
      };
      setWords((v) => [local, ...v]);
      const { id: _tmp, created_at: _at, ...row } = local;
      const save = (async () => {
        const { data, error } = await supabase
          .from('reading_words')
          .insert(row)
          .select('id')
          .single();
        if (error) throw error;
        return data.id as string;
      })();
      saving.current.set(
        local.id,
        save.catch(() => null),
      );
      save.then(
        (id) => {
          saved.current.set(local.id, id);
          setWords((v) => v.map((w) => (w.id === local.id ? { ...w, id } : w)));
        },
        (e) => {
          setWords((v) => v.filter((w) => w.id !== local.id));
          if (dropped.current.has(local.id)) return;
          if (e?.code === '23505') notify(`«${term}» ya estaba en tu diccionario.`);
          else fail(e, 'No se pudo guardar la palabra');
        },
      );
      return local;
    },
    [find, fail, notify],
  );

  /** Cambia una palabra al instante (tachar, nota, término). */
  const update = useCallback(
    (word: Word, changes: Partial<Pick<Word, 'term' | 'note' | 'learned_at'>>) => {
      const before: Partial<Word> = {};
      for (const k of Object.keys(changes) as (keyof typeof changes)[])
        (before as Record<string, unknown>)[k] = word[k];
      setWords((v) => v.map((w) => (same(w, word.id) ? { ...w, ...changes } : w)));
      void (async () => {
        const id = await realId(word.id);
        if (!id) return;
        const { error } = await supabase.from('reading_words').update(changes).eq('id', id);
        if (!error) return;
        setWords((v) => v.map((w) => (same(w, word.id) || w.id === id ? { ...w, ...before } : w)));
        fail(
          error,
          error.code === '23505' ? 'Ese término ya existe' : 'No se pudo guardar el cambio',
        );
      })();
    },
    [fail],
  );

  /** Tacha (o destacha) una palabra como aprendida. */
  const toggleLearned = useCallback(
    (word: Word) => update(word, { learned_at: word.learned_at ? null : new Date().toISOString() }),
    [update],
  );

  /** La borra al instante; el aviso permite deshacerlo. */
  const remove = useCallback(
    (word: Word, undo = true) => {
      setWords((v) => v.filter((w) => !same(w, word.id)));
      if (word.id.startsWith('tmp:')) dropped.current.add(word.id);
      let restored = false;
      const timer = window.setTimeout(
        async () => {
          if (restored) return;
          const id = await realId(word.id);
          if (!id) return;
          const { error } = await supabase.from('reading_words').delete().eq('id', id);
          if (!error) return;
          setWords((v) => (v.some((w) => w.id === id) ? v : [{ ...word, id }, ...v]));
          fail(error, 'No se pudo eliminar');
        },
        undo ? 6000 : 0,
      );
      if (!undo) return;
      notify(`«${word.term.slice(0, 40)}» salió de tu diccionario.`, {
        label: 'Deshacer',
        icon: 'undo',
        run: () => {
          restored = true;
          window.clearTimeout(timer);
          dropped.current.delete(word.id);
          const back = { ...word, id: saved.current.get(word.id) ?? word.id };
          setWords((v) =>
            v.some((w) => same(w, word.id))
              ? v
              : [...v, back].sort((a, b) => b.created_at.localeCompare(a.created_at)),
          );
        },
      });
    },
    [fail, notify],
  );

  return { words, state, find, add, update, toggleLearned, remove };
}
export type WordsApi = ReturnType<typeof useWords>;
