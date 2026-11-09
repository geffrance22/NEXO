import { useMemo, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Bell, ImageIcon, ListChecks, Pin, Plus, StickyNote } from 'lucide-react';
import { useApp } from '../AppContext';
import { friendlyDate, todayInputValue } from '../lib/format';
import { goLibroteca } from '../library/shelf';
import { useNoteCommands } from './commands';
import { plainOf } from './links';
import { NoteSheet } from './NoteSheet';
import { colorOf } from './palette';
import { isDue, reminderLabel } from './reminders';
import { ToBoardSheet } from './ToBoardSheet';
import { useNotes, type KeepNote } from './useNotes';
import './notes.css';

const SHOWN = 8;
const firstLine = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) ?? '';

/**
 * «Notas» en Mi espacio: tus últimas notas libres (las que tienen un recordatorio vencido, primero).
 * Se abren y se editan aquí mismo, sin ir a Libroteca; lo que escribes se guarda al cerrar.
 */
export function HomeNotes() {
  const { go, workspace } = useApp();
  const store = useNotes(true);
  const cmd = useNoteCommands(store);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [toBoard, setToBoard] = useState<KeepNote | null>(null);

  const live = useMemo(
    () => (store.notes ?? []).filter((n) => !n.archived && !n.vaulted),
    [store.notes],
  );
  const recent = useMemo(() => {
    const now = Date.now();
    return [...live]
      .sort(
        (a, b) =>
          Number(isDue(b.remind_at, now)) - Number(isDue(a.remind_at, now)) ||
          b.created_at.localeCompare(a.created_at),
      )
      .slice(0, SHOWN);
  }, [live]);
  const episodes = useMemo(
    () => workspace.episodes.map((e) => ({ id: e.id, title: e.title })),
    [workspace.episodes],
  );
  const tags = useMemo(() => [...new Set(live.flatMap((n) => n.tags))], [live]);
  const note = editing && editing !== 'new' ? live.find((n) => n.id === editing) : undefined;
  const today = todayInputValue();

  if (store.notes === null) return null;

  return (
    <section className="nb kp-home" aria-labelledby="home-notes">
      <header className="nb-head">
        <h2 id="home-notes">
          Notas {live.length > 0 && <span>{live.length.toLocaleString('es-CO')}</span>}
        </h2>
        <div className="nb-head-end">
          {live.length > 0 && (
            <button type="button" className="nb-link" onClick={() => goLibroteca(go, 'lienzo')}>
              Ver todas en Libroteca <ArrowUpRight size={13} />
            </button>
          )}
          <button type="button" className="nb-new" onClick={() => setEditing('new')}>
            <Plus size={15} /> Nota
          </button>
        </div>
      </header>

      {recent.length > 0 ? (
        <div className="kp-home-grid">
          {recent.map((n) => {
            const c = colorOf(n.color);
            const title = n.title || firstLine(plainOf(n.body)) || n.checks[0]?.text || 'Nota';
            const text = plainOf(n.title ? n.body : n.body.split('\n').slice(1).join('\n')).trim();
            const total = n.checks.length;
            const done = n.checks.filter((x) => x.done).length;
            const img = n.images[0];
            const due = isDue(n.remind_at);
            return (
              <button
                type="button"
                key={n.id}
                className={'kp-home-card' + (n.color === 'linen' ? ' plain' : '')}
                style={{ '--kp-bg': c.bg, '--kp-ink': c.ink } as CSSProperties}
                onClick={() => setEditing(n.id)}
                title={title}
              >
                {img && (
                  <span className="kp-home-img">
                    <img src={img.thumb ?? img.medium ?? img.url} alt="" loading="lazy" />
                    {n.images.length > 1 && (
                      <i>
                        <ImageIcon size={10} /> {n.images.length}
                      </i>
                    )}
                  </span>
                )}
                <strong>{title}</strong>
                {total > 0 ? (
                  <span className="kp-home-list">
                    {n.checks.slice(0, img ? 2 : 4).map((x) => (
                      <small key={x.id} className={x.done ? 'done' : ''}>
                        <span className="box" /> {x.text}
                      </small>
                    ))}
                    {total > (img ? 2 : 4) && (
                      <small className="more">
                        <ListChecks size={11} /> {done}/{total}
                      </small>
                    )}
                  </span>
                ) : (
                  text && <span className={'kp-home-text' + (img ? ' short' : '')}>{text}</span>
                )}
                <span className="kp-home-meta">
                  {n.pinned && <Pin size={10} />}
                  {n.remind_at ? (
                    <em className={due ? 'due' : ''}>
                      <Bell size={10} /> {reminderLabel(n.remind_at)}
                    </em>
                  ) : (
                    friendlyDate(todayInputValue(new Date(n.created_at)), today)
                  )}
                  {n.tags[0] && <b>#{n.tags[0]}</b>}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="nb-empty">
          <StickyNote size={20} />
          <div>
            <strong>Aún no tienes notas.</strong>
            <span>Apunta una idea, una lista o un enlace para no olvidarlo.</span>
          </div>
          <button type="button" className="nb-new" onClick={() => setEditing('new')}>
            <Plus size={15} /> Escribir
          </button>
        </div>
      )}

      {(editing === 'new' || note) && (
        <NoteSheet
          key={note?.id ?? 'new'}
          note={note ?? null}
          store={store}
          books={store.books}
          episodes={episodes}
          tagSuggestions={tags}
          extras={!store.outdated}
          onClose={() => setEditing(null)}
          onArchive={cmd.archive}
          onDuplicate={cmd.duplicate}
          onDelete={(n) => cmd.remove(n, () => setEditing(null))}
          onToBoard={(n) => setToBoard(n)}
        />
      )}
      {toBoard && <ToBoardSheet note={toBoard} onClose={() => setToBoard(null)} />}
    </section>
  );
}
