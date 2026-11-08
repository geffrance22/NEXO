import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Calendar, Check, CheckSquare } from 'lucide-react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { friendlyDate } from '../lib/format';
import { isRepeat, nextDue } from './boardRepeat';
import { dueState, isDivider, toneOf } from './boardTheme';
import { aimBoard } from './boardView';
import type { Check as CheckItem } from './shared';
import './pinned.css';

type Col = {
  id: string;
  name: string;
  board_id: string;
  color?: string;
  boards?: { name: string } | null;
};
type Row = {
  id: string;
  title: string;
  done?: boolean;
  due: string | null;
  checks: CheckItem[];
  entry_id: string | null;
  repeat?: string;
};
const SHOWN = 5;

/**
 * Mi espacio: la columna que anclaste desde Tableros, como acceso rápido. Muestra hasta cinco
 * tarjetas; se completan aquí mismo y un toque abre la tarjeta (o el tablero) en Tableros.
 */
export function PinnedColumnCard() {
  const { workspace, toggleEntry, patchEntry, notify, go } = useApp();
  const [col, setCol] = useState<Col | null>(null);
  const [cards, setCards] = useState<Row[]>([]);
  const [extras, setExtras] = useState(true);

  const load = useCallback(async () => {
    const c = await supabase
      .from('board_lists')
      .select('*, boards(name)')
      .eq('pinned', true)
      .maybeSingle();
    if (c.error || !c.data) {
      setCol(null);
      return;
    }
    const list = c.data as Col;
    const query = (cols: string) =>
      supabase
        .from('board_cards')
        .select(cols)
        .eq('list_id', list.id)
        .is('archived_at', null)
        .order('rank')
        .order('id')
        .limit(300);
    let rows = await query('id,title,done,due,checks,entry_id,repeat');
    // Sin la migración 016: sin repetir.
    if (rows.error) rows = await query('id,title,done,due,checks,entry_id');
    let full = true;
    if (rows.error) {
      // Sin la migración 014: sin completadas ni archivadas.
      full = false;
      rows = (await supabase
        .from('board_cards')
        .select('id,title,due,checks,entry_id')
        .eq('list_id', list.id)
        .order('rank')
        .order('id')
        .limit(300)) as typeof rows;
    }
    setExtras(full);
    setCol(list);
    setCards(
      ((rows.data ?? []) as unknown as Row[]).map((r) => ({
        ...r,
        checks: Array.isArray(r.checks) ? r.checks : [],
      })),
    );
  }, []);

  useEffect(() => {
    void load();
    // Al volver a la pestaña, lo último del tablero.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const tasks = useMemo(
    () => new Map(workspace.entries.map((e) => [e.id, e])),
    [workspace.entries],
  );
  /** Con un pendiente vinculado, su estado manda (como en Tableros). */
  const isDone = (c: Row) => {
    const task = tasks.get(c.entry_id ?? '');
    return task ? task.status === 'completado' : Boolean(c.done);
  };
  if (!col) return null;

  const real = cards.filter((c) => !isDivider(c.title));
  const top = real.slice(0, SHOWN);
  const more = real.length - top.length;
  const open = real.filter((c) => !isDone(c)).length;
  const tone = toneOf(col.color);
  const toBoard = (card?: string) => {
    aimBoard(col.board_id, col.id, card);
    go('Tableros');
  };

  const toggle = (c: Row) => {
    const next = !isDone(c);
    const task = tasks.get(c.entry_id ?? '');
    // Se repite: vuelve abierta con la fecha siguiente y la lista limpia.
    if (next && c.repeat && isRepeat(c.repeat)) {
      const due = nextDue(c.repeat, c.due) ?? c.due;
      const checks = c.checks.map((x) => ({ ...x, done: false }));
      setCards((v) => v.map((x) => (x.id === c.id ? { ...x, due, checks } : x)));
      if (task)
        void patchEntry(task, {
          status: 'pendiente',
          details: { ...task.details, ...(due && { due }) },
        });
      void supabase
        .from('board_cards')
        .update({ due, checks, done: false, done_at: null })
        .eq('id', c.id)
        .then(({ error }) => error && notify('No se pudo guardar: ' + error.message));
      notify(`Hecho. Se repite: vuelve ${due ? friendlyDate(due).toLowerCase() : 'abierta'}.`);
      return;
    }
    if (task && (task.status === 'completado') !== next) toggleEntry(task);
    if (!extras) return;
    setCards((v) => v.map((x) => (x.id === c.id ? { ...x, done: next } : x)));
    void supabase
      .from('board_cards')
      .update({ done: next, done_at: next ? new Date().toISOString() : null })
      .eq('id', c.id)
      .then(({ error }) => {
        if (!error) return;
        setCards((v) => v.map((x) => (x.id === c.id ? { ...x, done: !next } : x)));
        notify('No se pudo guardar: ' + error.message);
      });
  };

  return (
    <section
      className="hc hpin"
      style={tone ? ({ '--pc': tone.c } as CSSProperties) : undefined}
      aria-label={`Columna anclada: ${col.name}`}
    >
      <header className="hc-head">
        <h3>
          <i className="hpin-dot" aria-hidden="true" />
          <span className="hpin-name">{col.name}</span>
          {open > 0 && <i>{open}</i>}
        </h3>
        <button
          type="button"
          className="hc-link"
          title="Abrir en Tableros"
          onClick={() => toBoard()}
        >
          <span className="hpin-board">{col.boards?.name ?? 'Tablero'}</span>
          <ArrowUpRight size={13} />
        </button>
      </header>

      {top.length ? (
        <ul className="hpin-list">
          {top.map((c) => {
            const done = isDone(c);
            const due = dueState(c.due, done);
            const ticked = c.checks.filter((x) => x.done).length;
            return (
              <li key={c.id} className={done ? 'done' : ''}>
                <button
                  type="button"
                  className="hpin-check"
                  aria-pressed={done}
                  title={done ? 'Marcar como no completada' : 'Completar'}
                  aria-label={done ? 'Marcar como no completada' : 'Completar'}
                  onClick={() => toggle(c)}
                >
                  <Check size={11} strokeWidth={3.2} />
                </button>
                <button
                  type="button"
                  className="hpin-main"
                  title="Abrir la tarjeta en Tableros"
                  onClick={() => toBoard(c.id)}
                >
                  <strong>{c.title}</strong>
                  {(due || c.checks.length > 0) && (
                    <small>
                      {due && (
                        <span className={'hpin-due ' + due.tone}>
                          <Calendar size={11} /> {due.label}
                        </span>
                      )}
                      {c.checks.length > 0 && (
                        <span className={ticked === c.checks.length ? 'full' : ''}>
                          <CheckSquare size={11} /> {ticked}/{c.checks.length}
                        </span>
                      )}
                    </small>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hc-empty">Esta columna está vacía por ahora.</p>
      )}

      {more > 0 && (
        <button type="button" className="hpin-more" onClick={() => toBoard()}>
          Ver {more} más
        </button>
      )}
    </section>
  );
}
