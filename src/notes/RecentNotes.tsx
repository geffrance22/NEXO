import type { CSSProperties } from 'react';
import { ArrowRight, ListChecks, Pin, StickyNote } from 'lucide-react';
import { friendlyDate, todayInputValue } from '../lib/format';
import { colorOf } from './palette';
import { plainOf } from './links';
import type { KeepNote } from './useNotes';
import './notes.css';

const SHOWN = 10;

/** Primera línea con algo escrito. */
const firstLine = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) ?? '';

/**
 * Las últimas notas libres en miniatura (para «Recientes» en el inicio de Libroteca): una tira de
 * papelitos que se desplaza de lado. Cada uno abre su nota en la pestaña «Notas».
 */
export function RecentNotes({
  notes,
  onOpen,
  onAll,
}: {
  notes: KeepNote[];
  onOpen: (id: string) => void;
  onAll: () => void;
}) {
  const live = notes
    .filter((n) => !n.archived && !n.vaulted)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!live.length) return null;
  const shown = live.slice(0, SHOWN);
  const today = todayInputValue();

  return (
    <div className="kp-recent">
      <div className="kp-recent-head">
        <span>
          <StickyNote size={13} /> Notas
        </span>
        <button type="button" onClick={onAll}>
          Ver todas <i>{live.length.toLocaleString('es-CO')}</i> <ArrowRight size={13} />
        </button>
      </div>
      <div className="kp-strip">
        {shown.map((n) => {
          const c = colorOf(n.color);
          const title = n.title || firstLine(plainOf(n.body)) || n.checks[0]?.text || 'Nota';
          const text = plainOf(n.title ? n.body : n.body.split('\n').slice(1).join(' '));
          const total = n.checks.length;
          const done = n.checks.filter((x) => x.done).length;
          return (
            <button
              type="button"
              key={n.id}
              className="kp-mini"
              style={{ '--kp-bg': c.bg, '--kp-ink': c.ink } as CSSProperties}
              onClick={() => onOpen(n.id)}
              title={title}
            >
              <strong>{title}</strong>
              {total > 0 ? (
                <span className="kp-mini-list">
                  <span className="kp-mini-bar">
                    <i style={{ width: (done / total) * 100 + '%' }} />
                  </span>
                  <small>
                    <ListChecks size={11} /> {done}/{total}
                  </small>
                </span>
              ) : (
                text.trim() && <span className="kp-mini-text">{text.trim()}</span>
              )}
              <small className="kp-mini-meta">
                {n.pinned && <Pin size={10} />}
                {friendlyDate(todayInputValue(new Date(n.created_at)), today)}
                {n.tags[0] && <em>#{n.tags[0]}</em>}
              </small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
