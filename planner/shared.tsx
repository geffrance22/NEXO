import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../backend';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { Plus, X } from 'lucide-react';
import './planner.css';
export type Named = { id: string; name: string };
export type Check = { id: string; text: string; done: boolean };
export type Note = {
  id: string;
  title: string;
  body: string;
  color: string;
  tags: string[];
  checks: Check[];
  book_id: string | null;
  episode_id: string | null;
  pinned: boolean;
  archived: boolean;
};
export type List = Named & { board_id: string; rank: number };
export type Card = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  checks: Check[];
  list_id: string;
  rank: number;
  due: string | null;
  entry_id: string | null;
  episode_id: string | null;
  person_id: string | null;
  reading_id: string | null;
  note_id: string | null;
};
export function useRows<T>(
  table: string,
  rev: number,
  field?: string,
  value?: string,
  order = 'id',
) {
  const key = [table, field || '', value || '', order].join('|');
  const [page, setPage] = useState<{ key: string; rows: T[] }>({ key: '', rows: [] }),
    [error, fail] = useState('');
  useEffect(() => {
    let live = true;

    fail('');
    if (field && !value) return;
    async function load() {
      const all: T[] = [];
      for (let n = 0; ; n += 500) {
        let q = supabase
          .from(table)
          .select('*')
          .order(order)
          .order('id')
          .range(n, n + 499);
        if (field) q = q.eq(field, value!);
        const { data, error } = await q;
        if (!live) return;
        if (error) {
          fail(error.message);
          return;
        }
        all.push(...(data as T[]));
        if (data.length < 500) {
          setPage({ key, rows: all });
          return;
        }
      }
    }
    void load().catch((e) => live && fail(e.message));
    return () => {
      live = false;
    };
  }, [table, rev, field, value, order]);
  return { rows: page.key === key ? page.rows : [], error };
}
export function useActions() {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false),
    [rev, refresh] = useState(0);
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      refresh((n) => n + 1);
    } catch (e) {
      notify((e as Error).message || 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, rev, act };
}
export async function put(table: string, fields: object, id?: string) {
  const db = supabase.from(table);
  const q = id ? db.update(fields).eq('id', id) : db.insert(fields);
  const { data, error } = await q.select('id').single();
  if (error) throw error;
  return data.id as string;
}
export async function remove(table: string, id: string) {
  const { error } = await supabase.from(table).delete().eq('id', id).select('id').single();
  if (error) throw error;
}
export function Panel({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet label={title} onRequestClose={close}>
      <div className="pl-dialog">
        <header>
          <h2>{title}</h2>
          <button onClick={close} aria-label="Cerrar">
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </Sheet>
  );
}
export function Checklist({ value, set }: { value: Check[]; set: (v: Check[]) => void }) {
  const [line, write] = useState('');
  function add() {
    if (line.trim()) {
      set([...value, { id: crypto.randomUUID(), text: line.trim(), done: false }]);
      write('');
    }
  }
  return (
    <fieldset>
      <legend>Lista de verificación</legend>
      {value.map((c) => (
        <div className="pl-check" key={c.id}>
          <input
            type="checkbox"
            checked={c.done}
            onChange={() => set(value.map((v) => (v.id === c.id ? { ...v, done: !v.done } : v)))}
          />
          <span>{c.text}</span>
          <button
            type="button"
            aria-label="Quitar punto"
            onClick={() => set(value.filter((v) => v.id !== c.id))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="pl-line">
        <input
          placeholder="Nuevo punto…"
          value={line}
          onChange={(e) => write(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" aria-label="Añadir punto" onClick={add}>
          <Plus size={16} />
        </button>
      </div>
    </fieldset>
  );
}
export function tags(text: string) {
  return [
    ...new Set(
      text
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}
export function NamePanel({
  title,
  initial = '',
  save,
  close,
  busy,
}: {
  title: string;
  initial?: string;
  save: (s: string) => void;
  close: () => void;
  busy: boolean;
}) {
  const [name, set] = useState(initial);
  return (
    <Panel title={title} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(name.trim());
        }}
      >
        <label>
          Nombre
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(e) => set(e.target.value)}
          />
        </label>
        <button className="pl-primary" disabled={busy || !name.trim()}>
          Guardar
        </button>
      </form>
    </Panel>
  );
}
export function useConfirmDelete() {
  const { confirm } = useApp();
  return useCallback(
    (title: string, message: string) =>
      confirm({ title, message, confirmLabel: 'Eliminar', danger: true, icon: 'trash' }),
    [confirm],
  );
}
