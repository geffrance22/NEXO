import { useState } from 'react';
import { useApp } from '../AppContext';
import { Panel, put, useActions, useRows, type List, type Named } from '../planner/shared';
import type { KeepNote } from './useNotes';

/** Convierte una nota en una tarjeta de un tablero (la tarjeta recuerda de qué nota salió). */
export function ToBoardSheet({ note, onClose }: { note: KeepNote; onClose: () => void }) {
  const { notify, go } = useApp();
  const { busy, rev, act } = useActions();
  const boards = useRows<Named & { is_template?: boolean }>('boards', rev);
  // Las plantillas no reciben tarjetas.
  const real = boards.rows.filter((b) => !b.is_template);
  const [board, pickBoard] = useState('');
  const [list, pickList] = useState('');
  const lists = useRows<List>('board_lists', rev, 'board_id', board, 'rank');
  const error = boards.error || lists.error;

  return (
    <Panel title="Crear tarjeta desde la nota" close={onClose}>
      {error && <p role="alert">{error}</p>}
      <label>
        Tablero
        <select
          value={board}
          onChange={(e) => {
            pickBoard(e.target.value);
            pickList('');
          }}
        >
          <option value="">Elige un tablero</option>
          {real.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {!real.length && !boards.error && <p>Crea primero un tablero en Tableros.</p>}
      <label>
        Columna
        <select value={list} onChange={(e) => pickList(e.target.value)} disabled={!board}>
          <option value="">Elige una columna</option>
          {lists.rows.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="pl-primary"
        disabled={busy || !list}
        onClick={() =>
          void act(async () => {
            await put('board_cards', {
              list_id: list,
              title: (note.title || note.body || 'Nota').slice(0, 240),
              body: note.body,
              tags: note.tags,
              checks: note.checks,
              note_id: note.id,
              episode_id: note.episode_id,
              rank: Date.now(),
            });
            onClose();
            notify('Tarjeta creada.', {
              label: 'Ver tablero',
              icon: 'open',
              run: () => go('Tableros'),
            });
          })
        }
      >
        Crear tarjeta
      </button>
    </Panel>
  );
}
