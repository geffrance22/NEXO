import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { supabase } from '../backend';
import { byRank, rankAt, type Board, type Column } from './boardStore';
import { backgroundOf, toneOf } from './boardTheme';

/**
 * Mover una columna a otro tablero: primero eliges el tablero y luego dónde queda (al principio,
 * después de alguna columna o al final). Sus tarjetas, también las archivadas, van con ella.
 */
export function MoveColumnMenu({
  column,
  boards,
  onMove,
  onBack,
}: {
  column: Column;
  /** Los otros tableros. */
  boards: Board[];
  onMove: (board: Board, rank: number) => void;
  onBack: () => void;
}) {
  const [target, setTarget] = useState<Board | null>(null);
  const [cols, setCols] = useState<Column[] | null>(null);

  useEffect(() => {
    if (!target) return;
    let live = true;
    setCols(null);
    void supabase
      .from('board_lists')
      .select('*')
      .eq('board_id', target.id)
      .then(({ data }) => {
        if (live) setCols(((data ?? []) as Column[]).sort(byRank));
      });
    return () => {
      live = false;
    };
  }, [target?.id]);

  if (!target)
    return (
      <>
        <div className="bd-pop-back">
          <button type="button" aria-label="Volver" onClick={onBack}>
            <ArrowLeft size={15} />
          </button>
          <span>Mover «{column.name}» a…</span>
        </div>
        {boards.length ? (
          <div className="bd-pick-list">
            {boards.map((b) => (
              <button
                type="button"
                key={b.id}
                className="bd-pick-item"
                onClick={() => setTarget(b)}
              >
                <i style={{ background: backgroundOf(b.background).css }} />
                <span>{b.name}</span>
                <ChevronRight size={15} className="bd-pick-go" />
              </button>
            ))}
          </div>
        ) : (
          <p className="bd-pop-note solo">No tienes otros tableros todavía.</p>
        )}
      </>
    );

  const ranks = (cols ?? []).map((c) => c.rank);
  const positions = cols
    ? [
        { label: 'Al principio', index: 0 },
        ...cols.map((c, i) => ({ label: `Después de «${c.name}»`, index: i + 1, tone: c.color })),
      ]
    : [];
  return (
    <>
      <div className="bd-pop-back">
        <button type="button" aria-label="Volver" onClick={() => setTarget(null)}>
          <ArrowLeft size={15} />
        </button>
        <span>¿Dónde, en «{target.name}»?</span>
      </div>
      {!cols ? (
        <p className="bd-pop-note solo">
          <LoaderCircle className="spin" size={14} /> Cargando columnas…
        </p>
      ) : (
        <div className="bd-pick-list">
          {positions.map((p) => {
            const last = p.index === positions.length - 1;
            const t = 'tone' in p ? toneOf(p.tone) : null;
            return (
              <button
                type="button"
                key={p.index}
                className="bd-pick-item"
                onClick={() => onMove(target, rankAt(ranks, p.index))}
              >
                <i className="dot" style={{ background: t?.c ?? '#c3cbc5' }} />
                <span>{p.label}</span>
                {last && cols.length > 0 && <small>Al final</small>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
