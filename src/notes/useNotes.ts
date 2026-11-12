import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../backend';
import { useApp } from '../AppContext';
import type { StoredImage } from '../data';
import type { Named, Note } from '../planner/shared';

/** Una nota libre tal como viene de `quick_notes`. */
export type KeepNote = Note & {
  created_at: string;
  /**
   * Última vez que cambió su contenido (la pone la base de datos). null: aún no se sabe (notas de
   * antes de la migración); undefined: la base de datos no tiene la columna.
   */
  updated_at?: string | null;
  /** Orden en el lienzo: menor = más arriba. */
  rank: number;
  images: StoredImage[];
  /** Cuándo recordártela (ISO), o null. */
  remind_at: string | null;
  /** En la bóveda: el contenido va cifrado en `secret` y el resto queda vacío. */
  vaulted: boolean;
  secret: string | null;
};
export type NoteFields = Partial<Omit<KeepNote, 'id' | 'created_at' | 'updated_at'>>;
/** Lo que cuenta como modificar la nota (igual que el trigger `touch_quick_note`). */
const CONTENT = ['title', 'body', 'checks', 'tags', 'images', 'secret'] as const;

/** Lo que se dispara cuando otra parte de la app guarda una nota (p. ej. «Nueva idea»). */
export const NOTES_CHANGED = 'nexo:idea-saved';
/** Lo que se dispara cuando este almacén cambia una nota (buscador, recordatorios). */
export const NOTES_TOUCHED = 'nexo:notes-touched';
const touched = () => window.dispatchEvent(new Event(NOTES_TOUCHED));

export type NotesStore = {
  /** `null` mientras carga la primera vez. En el orden del lienzo. */
  notes: KeepNote[] | null;
  books: Named[];
  error: string;
  /** Falta la migración de orden, fotos, recordatorios y bóveda. */
  outdated: boolean;
  create: (fields: NoteFields) => Promise<KeepNote | null>;
  patch: (id: string, fields: NoteFields) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  saveBook: (name: string, id?: string) => Promise<string | null>;
  removeBook: (id: string) => Promise<boolean>;
};

/** Error de Postgres por columna inexistente (la migración aún no se ejecutó). */
export const missingColumn = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === '42703' || /column .* does not exist/i.test(e.message ?? '')));

async function loadAll<T>(table: string, order: string, ascending: boolean) {
  const all: T[] = [];
  for (let n = 0; ; n += 500) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(order, { ascending })
      .order('id')
      .range(n, n + 499);
    if (error) throw error;
    all.push(...(data as T[]));
    if (data.length < 500) return all;
  }
}

/** Completa lo que falta si la base de datos aún no tiene las columnas nuevas. */
export const normalizeNote = (x: Partial<KeepNote> & { id: string; created_at: string }) =>
  ({
    ...x,
    title: x.title ?? '',
    body: x.body ?? '',
    color: x.color ?? 'linen',
    tags: x.tags ?? [],
    checks: x.checks ?? [],
    book_id: x.book_id ?? null,
    episode_id: x.episode_id ?? null,
    pinned: Boolean(x.pinned),
    archived: Boolean(x.archived),
    rank: typeof x.rank === 'number' ? x.rank : -Date.parse(x.created_at),
    images: Array.isArray(x.images) ? x.images : [],
    remind_at: x.remind_at ?? null,
    vaulted: Boolean(x.vaulted),
    secret: x.secret ?? null,
    updated_at: x.updated_at === undefined ? undefined : x.updated_at,
  }) as KeepNote;

/** El orden del lienzo (estable aunque dos notas tengan el mismo rango). */
export const byRank = (a: KeepNote, b: KeepNote) => a.rank - b.rank || a.id.localeCompare(b.id);
const sorted = (list: KeepNote[]) => [...list].sort(byRank);

/**
 * Notas libres y sus cuadernos, con cambios optimistas: la tarjeta cambia al instante y, si la
 * base de datos rechaza el cambio, vuelve a como estaba y se avisa.
 */
export function useNotes(enabled = true): NotesStore {
  const { notify } = useApp();
  const [notes, setNotes] = useState<KeepNote[] | null>(null);
  const [books, setBooks] = useState<Named[]>([]);
  const [error, setError] = useState('');
  const [outdated, setOutdated] = useState(false);
  const [rev, setRev] = useState(0);
  const latest = useRef(notes);
  latest.current = notes;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const loadNotes = () =>
      loadAll<KeepNote>('quick_notes', 'rank', true).then(
        (n) => ({ n, old: false }),
        async (e: { code?: string; message?: string }) => {
          if (!missingColumn(e)) throw e;
          // Sin la migración nueva: el orden de siempre y sin bóveda.
          return {
            n: await loadAll<KeepNote>('quick_notes', 'created_at', false),
            old: true,
          };
        },
      );
    Promise.all([loadNotes(), loadAll<Named>('note_books', 'name', true)])
      .then(([{ n, old }, b]) => {
        if (!live) return;
        setNotes(sorted(n.map(normalizeNote)));
        setOutdated(old);
        setBooks(b);
        setError('');
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(e.message || 'No se pudieron cargar las notas.');
        setNotes((n) => n ?? []);
      });
    return () => {
      live = false;
    };
  }, [enabled, rev]);

  useEffect(() => {
    if (!enabled) return;
    const reload = () => setRev((r) => r + 1);
    window.addEventListener(NOTES_CHANGED, reload);
    return () => window.removeEventListener(NOTES_CHANGED, reload);
  }, [enabled]);

  const fail = useCallback(
    (e: { message?: string } | null) => notify(e?.message || 'No se pudo guardar la nota.'),
    [notify],
  );
  const old = useRef(outdated);
  old.current = outdated;
  /** Sin la migración nueva, esas columnas no existen: no se envían. */
  const fit = (fields: NoteFields): NoteFields => {
    if (!old.current) return fields;
    const { rank, images, remind_at, vaulted, secret, ...rest } = fields;
    void [rank, images, remind_at, vaulted, secret];
    return rest;
  };

  const create = useCallback(
    async (fields: NoteFields) => {
      const { data, error } = await supabase
        .from('quick_notes')
        .insert(fit(fields))
        .select('*')
        .single();
      if (error) {
        fail(error);
        return null;
      }
      const note = normalizeNote(data as KeepNote);
      setNotes((list) => sorted([note, ...(list ?? [])]));
      touched();
      return note;
    },
    [fail],
  );

  const patch = useCallback(
    async (id: string, fields: NoteFields) => {
      const before = latest.current?.find((n) => n.id === id);
      // La base de datos pone la fecha de modificación; aquí solo se adelanta lo que hará.
      const touches =
        before?.updated_at !== undefined &&
        CONTENT.some(
          (k) => k in fields && JSON.stringify(fields[k]) !== JSON.stringify(before?.[k]),
        );
      const stamp = touches ? { updated_at: new Date().toISOString() } : {};
      setNotes(
        (list) =>
          list && sorted(list.map((n) => (n.id === id ? { ...n, ...fields, ...stamp } : n))),
      );
      const { error } = await supabase.from('quick_notes').update(fit(fields)).eq('id', id);
      if (error) {
        if (before) setNotes((list) => list && sorted(list.map((n) => (n.id === id ? before : n))));
        fail(error);
        return false;
      }
      touched();
      return true;
    },
    [fail],
  );

  const remove = useCallback(
    async (id: string) => {
      const before = latest.current;
      setNotes((list) => list?.filter((n) => n.id !== id) ?? list);
      const { error } = await supabase.from('quick_notes').delete().eq('id', id);
      if (error) {
        setNotes(before);
        fail(error);
        return false;
      }
      touched();
      return true;
    },
    [fail],
  );

  const saveBook = useCallback(
    async (name: string, id?: string) => {
      const db = supabase.from('note_books');
      const { data, error } = await (id ? db.update({ name }).eq('id', id) : db.insert({ name }))
        .select('id,name')
        .single();
      if (error) {
        fail(error);
        return null;
      }
      const book = data as Named;
      setBooks((list) =>
        (id ? list.map((b) => (b.id === id ? book : b)) : [...list, book]).sort((a, b) =>
          a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
        ),
      );
      return book.id;
    },
    [fail],
  );

  const removeBook = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('note_books').delete().eq('id', id);
      if (error) {
        fail(error);
        return false;
      }
      // La base de datos deja sus notas sin cuaderno (on delete set null).
      setBooks((list) => list.filter((b) => b.id !== id));
      setNotes(
        (list) => list?.map((n) => (n.book_id === id ? { ...n, book_id: null } : n)) ?? list,
      );
      return true;
    },
    [fail],
  );

  return {
    notes,
    books,
    error,
    outdated,
    create,
    patch,
    remove,
    saveBook,
    removeBook,
  };
}

/** Texto en el que se busca una nota. */
export const noteText = (n: Note) =>
  [n.title, n.body, n.tags.join(' '), n.checks.map((c) => c.text).join(' ')].join(' ');

/** Nota sin nada escrito ni fotos (no se guarda). */
export const isBlank = (
  n: Pick<Note, 'title' | 'body' | 'checks'> & { images?: readonly unknown[] },
) => !n.title.trim() && !n.body.trim() && !n.checks.some((c) => c.text.trim()) && !n.images?.length;
