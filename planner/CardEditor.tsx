import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AlignLeft,
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  BookOpen,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  Columns3,
  Layers,
  Link2,
  ListChecks,
  LoaderCircle,
  Palette,
  Plus,
  Repeat as RepeatIcon,
  Tag,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { Sheet } from '../components/Sheet';
import { episodeKinds } from '../lib/episodes';
import { addDays, friendlyDate, nextMonday, shortDate, todayInputValue } from '../lib/format';
import { relationMeta, relationOf, searchText } from '../lib/people';
import { Avatar } from '../people/Avatar';
import { Popover } from './BoardPopover';
import type { BoardCard, CardChanges, Column } from './boardStore';
import { dueState, tagTone, tones, toneOf } from './boardTheme';
import { LinkPicker, type PickItem } from './LinkPicker';
import { boardEntryInput, cardPeople, isBoardEntry } from './boardPeople';
import {
  REPEATS,
  nextWeekday,
  repeatHint,
  repeatLabel,
  weekdayOf,
  type Repeat,
} from './boardRepeat';
import type { Check as CheckItem } from './shared';

/** Texto que se guarda solo: al dejar de escribir, al salir del campo o al cerrar. */
function useDraft(value: string, commit: (v: string) => void, delay = 700) {
  const [text, setText] = useState(value);
  const dirty = useRef(false);
  const latest = useRef({ text, commit });
  latest.current = { text, commit };
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!dirty.current) setText(value);
  }, [value]);
  const flush = () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    latest.current.commit(latest.current.text);
  };
  useEffect(() => () => flush(), []);
  return {
    text,
    set: (v: string) => {
      dirty.current = true;
      setText(v);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    flush,
    reset: () => {
      window.clearTimeout(timer.current);
      dirty.current = false;
      setText(value);
    },
  };
}

/**
 * Ficha de una tarjeta: título, columna, completada, descripción, lista de verificación,
 * etiquetas, fecha, color y vínculos de Nexo. Todo se guarda al instante, sin botón de guardar.
 */
export function CardEditor({
  card,
  columns,
  done,
  extras,
  onPatch,
  onToggleDone,
  onArchive,
  onDelete,
  onClose,
}: {
  card: BoardCard;
  /** Columnas del tablero (vacío en Archivados). */
  columns: Column[];
  done: boolean;
  /** Ya existe la migración 014 (completar, archivar, color). */
  extras: boolean;
  onPatch: (changes: CardChanges) => void;
  onToggleDone: () => void;
  /** Archivar o, si ya está archivada, desarchivar. */
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const archived = Boolean(card.archived_at);
  const title = useDraft(card.title, (v) => {
    const t = v.replace(/\s+/g, ' ').trim().slice(0, 240);
    if (t && t !== card.title) onPatch({ title: t });
  });
  const body = useDraft(card.body, (v) => v !== card.body && onPatch({ body: v.slice(0, 20000) }));
  const [tag, setTag] = useState('');
  const [item, setItem] = useState('');
  const [editingBody, setEditingBody] = useState(false);
  const [colMenu, setColMenu] = useState<DOMRect | null>(null);
  const [repeatMenu, setRepeatMenu] = useState<DOMRect | null>(null);
  const due = dueState(card.due, done);
  const ticked = card.checks.filter((c) => c.done).length;
  const pct = card.checks.length ? Math.round((100 * ticked) / card.checks.length) : 0;
  const tone = toneOf(card.color);
  const column = columns.find((c) => c.id === card.list_id);

  const setChecks = (checks: CheckItem[]) => onPatch({ checks });
  const addTag = () => {
    const parts = tag
      .split(',')
      .map((t) => t.trim().slice(0, 40))
      .filter(Boolean);
    if (parts.length) onPatch({ tags: [...new Set([...card.tags, ...parts])] });
    setTag('');
  };
  const addItem = () => {
    const lines = item
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    if (lines.length)
      setChecks([
        ...card.checks,
        ...lines.map((text) => ({
          id: crypto.randomUUID(),
          text: text.slice(0, 300),
          done: false,
        })),
      ]);
    setItem('');
  };
  const leave = (to: () => void) => {
    title.flush();
    body.flush();
    onClose();
    to();
  };

  return (
    <Sheet
      label={card.title}
      size="lg"
      className="bdm"
      // Con la ficha de un pendiente, una persona o un buscador encima, Esc es para ellos.
      yieldTo=".sheet.ev, .bdp-backdrop, .nx-peek, .bd-pop"
      onRequestClose={onClose}
    >
      {tone && <i className="bdm-band" style={{ background: tone.c }} />}
      <header className="bdm-head">
        <button
          type="button"
          className={'bdm-done' + (done ? ' on' : '')}
          aria-pressed={done}
          title={done ? 'Marcar como no completada' : 'Marcar como completada'}
          onClick={onToggleDone}
        >
          <Check size={14} strokeWidth={3} />
        </button>
        <div className="bdm-titlebox">
          <textarea
            className="bdm-title"
            rows={1}
            maxLength={240}
            value={title.text}
            aria-label="Título de la tarjeta"
            onChange={(e) => title.set(e.target.value)}
            onBlur={title.flush}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                title.reset();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
          />
          <p className="bdm-where">
            {archived ? (
              <>
                <Archive size={13} /> Archivada
                {card.board_name && ` · de ${card.board_name}`}
                {card.list_name && ` › ${card.list_name}`}
              </>
            ) : (
              <>
                <Columns3 size={13} /> En
                <button
                  type="button"
                  className="bdm-colbtn"
                  aria-haspopup="menu"
                  aria-expanded={Boolean(colMenu)}
                  onClick={(e) => setColMenu(e.currentTarget.getBoundingClientRect())}
                >
                  {toneOf(column?.color) && <i style={{ background: toneOf(column?.color)!.c }} />}
                  {column?.name ?? card.list_name ?? 'Columna'}
                  <ChevronDown size={13} />
                </button>
                {done && <span className="bdm-pill ok">Completada</span>}
                {colMenu && (
                  <Popover
                    anchor={colMenu}
                    align="start"
                    width={240}
                    label="Mover a la columna"
                    onClose={() => setColMenu(null)}
                  >
                    <p className="bd-pop-label">Mover a</p>
                    {columns.map((c) => {
                      const t = toneOf(c.color);
                      return (
                        <button
                          type="button"
                          key={c.id}
                          className={'bd-pick-item' + (c.id === card.list_id ? ' on' : '')}
                          onClick={() => {
                            if (c.id !== card.list_id) onPatch({ list_id: c.id });
                            setColMenu(null);
                          }}
                        >
                          <i className="dot" style={{ background: t?.c ?? '#c3cbc5' }} />
                          <span>{c.name}</span>
                          {c.id === card.list_id && <Check size={15} />}
                        </button>
                      );
                    })}
                  </Popover>
                )}
              </>
            )}
          </p>
        </div>
        <button type="button" className="bdm-x" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="bdm-body">
        <div className="bdm-main">
          {/* Etiquetas y fecha, a la vista */}
          {(card.tags.length > 0 || due) && (
            <div className="bdm-chips">
              {due && (
                <span className={'bd-due ' + due.tone}>
                  <Calendar size={12} /> {due.label}
                </span>
              )}
              {card.tags.map((t) => {
                const tt = tagTone(t);
                return (
                  <span
                    key={t}
                    className="bdm-tag"
                    style={{ '--tc': tt.c, '--ts': tt.s } as CSSProperties}
                  >
                    {t}
                    <button
                      type="button"
                      aria-label={`Quitar la etiqueta ${t}`}
                      onClick={() => onPatch({ tags: card.tags.filter((x) => x !== t) })}
                    >
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <section className="bdm-sec">
            <h3>
              <AlignLeft size={15} /> Descripción
            </h3>
            {editingBody || !card.body.trim() ? (
              <textarea
                className="bdm-desc"
                rows={4}
                value={body.text}
                autoFocus={editingBody}
                placeholder="Añade una descripción más detallada…"
                onChange={(e) => body.set(e.target.value)}
                onFocus={() => setEditingBody(true)}
                onBlur={() => {
                  body.flush();
                  setEditingBody(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    (e.target as HTMLTextAreaElement).blur();
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="bdm-desc-view"
                title="Editar la descripción"
                onClick={() => setEditingBody(true)}
              >
                {card.body}
              </button>
            )}
          </section>

          <section className="bdm-sec">
            <h3>
              <CheckSquare size={15} /> Lista de verificación
              {card.checks.length > 0 && (
                <small>
                  {ticked}/{card.checks.length}
                </small>
              )}
            </h3>
            {card.checks.length > 0 && (
              <>
                <div className={'bdm-progress' + (pct === 100 ? ' full' : '')}>
                  <i style={{ width: pct + '%' }} />
                  <span>{pct}%</span>
                </div>
                <ul className="bdm-checks">
                  {card.checks.map((c) => (
                    <li key={c.id} className={c.done ? 'on' : ''}>
                      <button
                        type="button"
                        className="bdm-check"
                        aria-pressed={c.done}
                        aria-label={c.done ? 'Desmarcar' : 'Marcar'}
                        onClick={() =>
                          setChecks(
                            card.checks.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)),
                          )
                        }
                      >
                        <Check size={11} strokeWidth={3} />
                      </button>
                      <input
                        defaultValue={c.text}
                        maxLength={300}
                        aria-label="Punto de la lista"
                        onBlur={(e) => {
                          const text = e.target.value.trim();
                          if (!text) setChecks(card.checks.filter((x) => x.id !== c.id));
                          else if (text !== c.text)
                            setChecks(card.checks.map((x) => (x.id === c.id ? { ...x, text } : x)));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                      <button
                        type="button"
                        className="bdm-icon"
                        aria-label="Quitar el punto"
                        onClick={() => setChecks(card.checks.filter((x) => x.id !== c.id))}
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <form
              className="bdm-add"
              onSubmit={(e) => {
                e.preventDefault();
                addItem();
              }}
            >
              <Plus size={14} />
              <input
                value={item}
                placeholder="Añadir un punto…"
                aria-label="Nuevo punto"
                onChange={(e) => setItem(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (!text.includes('\n')) return;
                  e.preventDefault();
                  setItem(text);
                  setTimeout(() => (e.target as HTMLInputElement).form?.requestSubmit());
                }}
              />
            </form>
          </section>

          <section className="bdm-sec">
            <h3>
              <Link2 size={15} /> Vínculos de Nexo
            </h3>
            <NexoLinks card={card} done={done} onPatch={onPatch} leave={leave} />
          </section>
        </div>

        <aside className="bdm-side">
          <section>
            <h4>
              <Calendar size={13} /> Fecha límite
            </h4>
            <input
              type="date"
              value={card.due || ''}
              aria-label="Fecha límite"
              onChange={(e) => onPatch({ due: e.target.value || null })}
            />
            <div className="bdm-quick">
              {(
                [
                  ['Hoy', todayInputValue()],
                  ['Mañana', addDays(todayInputValue(), 1)],
                  ['Lunes', nextMonday()],
                  ['En 7 días', addDays(todayInputValue(), 7)],
                ] as const
              ).map(([label, value]) => (
                <button
                  type="button"
                  key={label}
                  className={card.due === value ? 'on' : ''}
                  onClick={() => onPatch({ due: value })}
                >
                  {label}
                </button>
              ))}
              {card.due && (
                <button
                  type="button"
                  onClick={() => onPatch({ due: null, ...(card.repeat && { repeat: '' }) })}
                >
                  Quitar
                </button>
              )}
            </div>
          </section>

          <section>
            <h4>
              <RepeatIcon size={13} /> Repetir
            </h4>
            <button
              type="button"
              className={'bdm-repeat' + (card.repeat ? ' on' : '')}
              aria-haspopup="menu"
              aria-expanded={Boolean(repeatMenu)}
              onClick={(e) => setRepeatMenu(e.currentTarget.getBoundingClientRect())}
            >
              <RepeatIcon size={14} />
              <span>{repeatLabel(card.repeat, card.due)}</span>
              <ChevronDown size={13} />
            </button>
            {card.repeat && (
              <small className="bdm-repeat-hint">
                Al completarla vuelve sola, con la fecha siguiente.
              </small>
            )}
            {repeatMenu && (
              <Popover
                anchor={repeatMenu}
                width={250}
                label="Repetir"
                onClose={() => setRepeatMenu(null)}
              >
                <p className="bd-pop-label">Se repite</p>
                {(['', ...REPEATS] as Repeat[]).map((r) => (
                  <button
                    type="button"
                    key={r || 'none'}
                    className={'bd-pick-item' + (card.repeat === r ? ' on' : '')}
                    onClick={() => {
                      // Sin fecha, empieza hoy (el día de la semana sale de la fecha).
                      onPatch({ repeat: r, ...(r && !card.due && { due: todayInputValue() }) });
                      if (r !== 'weekly' && r !== 'biweekly') setRepeatMenu(null);
                    }}
                  >
                    <span>
                      {repeatLabel(r, card.due)}
                      {r && <small className="bd-pick-sub">{repeatHint[r]}</small>}
                    </span>
                    {card.repeat === r && <Check size={15} />}
                  </button>
                ))}
                {(card.repeat === 'weekly' || card.repeat === 'biweekly') && (
                  <>
                    <p className="bd-pop-label">El día</p>
                    <div className="bdm-weekdays">
                      {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => {
                        const day = (i + 1) % 7;
                        const on = card.due ? weekdayOf(card.due) === day : false;
                        return (
                          <button
                            type="button"
                            key={d}
                            className={on ? 'on' : ''}
                            aria-pressed={on}
                            aria-label={
                              [
                                'domingo',
                                'lunes',
                                'martes',
                                'miércoles',
                                'jueves',
                                'viernes',
                                'sábado',
                              ][day]
                            }
                            onClick={() => onPatch({ due: nextWeekday(day) })}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </Popover>
            )}
          </section>

          <section>
            <h4>
              <Tag size={13} /> Etiquetas
            </h4>
            <form
              className="bdm-add small"
              onSubmit={(e) => {
                e.preventDefault();
                addTag();
              }}
            >
              <Plus size={13} />
              <input
                value={tag}
                maxLength={120}
                placeholder="Nueva etiqueta"
                aria-label="Nueva etiqueta"
                onChange={(e) => setTag(e.target.value)}
                onBlur={addTag}
              />
            </form>
          </section>

          <section>
            <h4>
              <Palette size={13} /> Color
            </h4>
            <div className="bdm-swatches">
              <button
                type="button"
                className={'none' + (!card.color ? ' on' : '')}
                title="Sin color"
                aria-label="Sin color"
                onClick={() => onPatch({ color: '' })}
              />
              {tones.map((t) => (
                <button
                  type="button"
                  key={t.key}
                  className={card.color === t.key ? 'on' : ''}
                  style={{ background: t.c }}
                  title={t.label}
                  aria-label={t.label}
                  disabled={!extras}
                  onClick={() => onPatch({ color: t.key })}
                />
              ))}
            </div>
          </section>

          <section className="bdm-actions">
            <h4>Acciones</h4>
            <button type="button" onClick={onToggleDone} className={done ? '' : 'ok'}>
              <Check size={14} /> {done ? 'Marcar sin completar' : 'Marcar completada'}
            </button>
            <button
              type="button"
              onClick={onArchive}
              disabled={!archived && !done}
              title={!archived && !done ? 'Complétala para poder archivarla' : undefined}
            >
              {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              {archived ? 'Desarchivar' : 'Archivar'}
            </button>
            {!archived && !done && <small>Complétala para poder archivarla.</small>}
            <button type="button" className="danger" onClick={onDelete}>
              <Trash2 size={14} /> Eliminar
            </button>
          </section>

          {card.created_at && <p className="bdm-meta">Creada el {shortDate(card.created_at)}</p>}
        </aside>
      </div>
    </Sheet>
  );
}

const host = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

type Picking = 'person' | 'task' | 'episode' | 'reading';

/**
 * Vínculos de la tarjeta con Nexo: persona, pendiente, episodio y lectura. Cada uno se elige en
 * un buscador pequeño con sugerencias; ya vinculado, se ve, se cambia, se abre o se quita.
 */
function NexoLinks({
  card,
  done,
  onPatch,
  leave,
}: {
  card: BoardCard;
  done: boolean;
  onPatch: (changes: CardChanges) => void;
  /** Cierra la ficha y navega. */
  leave: (to: () => void) => void;
}) {
  const {
    workspace,
    toggleEntry,
    viewEntry,
    go,
    createPerson,
    createEntry,
    patchEntry,
    removeEntry,
    peekPerson,
  } = useApp();
  const [picking, setPicking] = useState<Picking | null>(null);
  const [reading, setReading] = useState<{ id: string; title: string; url: string } | null>(null);

  useEffect(() => {
    if (!card.reading_id) return setReading(null);
    let live = true;
    void supabase
      .from('reading_cards')
      .select('id,title,url')
      .eq('id', card.reading_id)
      .maybeSingle()
      .then(({ data }) => live && setReading(data));
    return () => {
      live = false;
    };
  }, [card.reading_id]);

  const task = workspace.entries.find((e) => e.id === card.entry_id);
  const episode = workspace.episodes.find((e) => e.id === card.episode_id);
  const taskDone = task?.status === 'completado';
  const fromBoard = isBoardEntry(task);
  const peopleIds = cardPeople(card, task);
  const linkedPeople = peopleIds
    .map((id) => workspace.people.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const [savingPeople, setSavingPeople] = useState(false);

  /**
   * Guarda las personas en el pendiente de la tarjeta (lo crea si no hay). Sin nadie, el
   * pendiente que nació aquí se elimina.
   */
  const savePeople = async (ids: string[]) => {
    setSavingPeople(true);
    try {
      if (task) {
        if (!ids.length && isBoardEntry(task)) {
          onPatch({ entry_id: null, person_id: null });
          removeEntry(task, true);
          return;
        }
        const ok = await patchEntry(task, { person_ids: ids });
        if (ok && card.person_id) onPatch({ person_id: null });
        return;
      }
      if (!ids.length) {
        if (card.person_id) onPatch({ person_id: null });
        return;
      }
      const entry = await createEntry(boardEntryInput(card, ids, done), true);
      if (entry) onPatch({ entry_id: entry.id, person_id: null });
    } finally {
      setSavingPeople(false);
    }
  };
  const names = linkedPeople.map((p) => p.name.split(' ')[0]);
  const namesText =
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;

  // Las personas con las que más registras aparecen primero.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of workspace.entries)
      for (const id of e.person_ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [workspace.entries]);
  const people = useMemo<PickItem[]>(
    () =>
      [...workspace.people]
        .sort(
          (a, b) =>
            Number(Boolean(b.profile.favorite)) - Number(Boolean(a.profile.favorite)) ||
            (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
            a.name.localeCompare(b.name, 'es'),
        )
        .map((p) => ({
          id: p.id,
          title: p.name,
          sub: [relationMeta[relationOf(p)].label, p.profile.occupation]
            .filter(Boolean)
            .join(' · '),
          icon: <Avatar person={p} size={30} />,
          match: searchText(p),
        })),
    [workspace.people, counts],
  );
  const tasks = useMemo<PickItem[]>(
    () =>
      workspace.entries
        .filter((e) => e.kind === 'Pendiente')
        .sort(
          (a, b) =>
            Number(a.status === 'completado') - Number(b.status === 'completado') ||
            (a.details.due ?? '9999').localeCompare(b.details.due ?? '9999'),
        )
        .map((e) => ({
          id: e.id,
          title: e.title,
          sub:
            e.status === 'completado'
              ? 'Hecho'
              : e.details.due
                ? 'Para ' + friendlyDate(e.details.due).toLowerCase()
                : 'Sin fecha',
          icon: (
            <span className={'bdp-glyph' + (e.status === 'completado' ? ' ok' : '')}>
              {e.status === 'completado' ? <Check size={15} /> : <ListChecks size={15} />}
            </span>
          ),
        })),
    [workspace.entries],
  );
  const episodes = useMemo<PickItem[]>(
    () =>
      [...workspace.episodes]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((ep) => {
          const k = episodeKinds[ep.kind] ?? episodeKinds.otro;
          return {
            id: ep.id,
            title: ep.title,
            sub: `${k.label} · ${ep.status === 'activo' ? 'En curso' : 'Cerrado'}`,
            icon: (
              <span className="bdp-glyph" style={{ background: k.soft, color: k.color }}>
                <k.icon size={15} />
              </span>
            ),
          };
        }),
    [workspace.episodes],
  );
  const searchReadings = async (q: string): Promise<PickItem[]> => {
    const base = supabase.from('reading_cards').select('id,title,url,minutes');
    const { data } = await (q ? base.ilike('title', `%${q}%`) : base)
      .order('created_at', { ascending: false })
      .limit(20);
    return (
      (data ?? []) as { id: string; title: string; url: string; minutes: number | null }[]
    ).map((r) => ({
      id: r.id,
      title: r.title,
      sub: [host(r.url), r.minutes ? `${r.minutes} min` : ''].filter(Boolean).join(' · '),
      icon: (
        <span className="bdp-glyph">
          <BookOpen size={15} />
        </span>
      ),
    }));
  };
  const epKind = episode ? (episodeKinds[episode.kind] ?? episodeKinds.otro) : null;

  return (
    <>
      {linkedPeople.length ? (
        <div className="bdm-people">
          <div className="bdm-people-head">
            <small>
              <UsersRound size={13} /> Personas
            </small>
            {savingPeople && <LoaderCircle className="spin" size={13} />}
          </div>
          <div className="bdm-people-list">
            {linkedPeople.map((p) => (
              <span key={p.id} className="bdm-person">
                <button
                  type="button"
                  className="bdm-person-main"
                  title={`Ver la ficha de ${p.name}`}
                  onClick={() => peekPerson(p)}
                >
                  <Avatar person={p} size={24} />
                  <span>{p.name.split(' ').slice(0, 2).join(' ')}</span>
                </button>
                <button
                  type="button"
                  className="bdm-person-x"
                  aria-label={`Quitar a ${p.name}`}
                  disabled={savingPeople}
                  onClick={() => void savePeople(peopleIds.filter((x) => x !== p.id))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="bdm-person-add"
              title="Añadir o quitar personas"
              aria-label="Añadir personas"
              disabled={savingPeople}
              onClick={() => setPicking('person')}
            >
              <Plus size={14} />
            </button>
          </div>
          {task && (
            <p className="bdm-people-note">
              {fromBoard
                ? `Está en los Pendientes de ${namesText}: se completa y se elimina con la tarjeta.`
                : `También en el pendiente «${task.title.slice(0, 60)}».`}
              <button type="button" onClick={() => viewEntry(task)}>
                Ver pendiente <ArrowUpRight size={12} />
              </button>
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="bdm-link-add wide"
          disabled={savingPeople}
          onClick={() => setPicking('person')}
        >
          <span className="bdm-link-lead">
            {savingPeople ? <LoaderCircle className="spin" size={15} /> : <UsersRound size={15} />}
          </span>
          <span>
            Añadir personas
            <small>Aparecerá en sus Pendientes y se completa con la tarjeta</small>
          </span>
          <Plus size={15} />
        </button>
      )}
      <div className="bdm-links">
        {!fromBoard && (
          <LinkTile
            icon={<ListChecks size={15} />}
            label="Pendiente"
            empty="Vincular un pendiente"
            value={
              task && {
                main: task.title,
                sub: taskDone
                  ? 'Hecho'
                  : task.details.due
                    ? 'Para ' + friendlyDate(task.details.due).toLowerCase()
                    : 'Sin fecha',
              }
            }
            extra={
              task && (
                <button
                  type="button"
                  className={'bdm-taskdone' + (taskDone ? ' on' : '')}
                  title={taskDone ? 'Reabrir el pendiente' : 'Completar el pendiente'}
                  onClick={() => toggleEntry(task)}
                >
                  <Check size={13} strokeWidth={3} /> {taskDone ? 'Hecho' : 'Completar'}
                </button>
              )
            }
            onAdd={() => setPicking('task')}
            onOpen={task && (() => viewEntry(task))}
            onClear={() => onPatch({ entry_id: null })}
          />
        )}
        <LinkTile
          icon={<Layers size={15} />}
          label="Episodio"
          empty="Vincular un episodio"
          value={
            episode &&
            epKind && {
              lead: (
                <span
                  className="bdp-glyph"
                  style={{ background: epKind.soft, color: epKind.color }}
                >
                  <epKind.icon size={15} />
                </span>
              ),
              main: episode.title,
              sub: `${epKind.label} · ${episode.status === 'activo' ? 'En curso' : 'Cerrado'}`,
            }
          }
          onAdd={() => setPicking('episode')}
          onOpen={episode && (() => leave(() => go('Episodios', episode)))}
          onClear={() => onPatch({ episode_id: null })}
        />
        <LinkTile
          icon={<BookOpen size={15} />}
          label="Lectura"
          empty="Vincular una lectura"
          value={
            card.reading_id
              ? { main: reading?.title ?? 'Lectura vinculada', sub: host(reading?.url) }
              : null
          }
          onAdd={() => setPicking('reading')}
          onOpen={
            card.reading_id
              ? () => leave(() => go('Lecturas', { id: card.reading_id! }))
              : undefined
          }
          onClear={() => onPatch({ reading_id: null })}
        />
      </div>
      {card.note_id && (
        <button
          type="button"
          className="bdm-note"
          onClick={() => leave(() => go('Notas', { id: card.note_id! }))}
        >
          Ver la nota original <ArrowUpRight size={13} />
        </button>
      )}

      {picking === 'person' && (
        <LinkPicker
          title="Personas de la tarjeta"
          placeholder="Busca por nombre, apodo, trabajo…"
          hint="Tus personas más frecuentes"
          items={people}
          multi={{ initial: peopleIds, onSave: (ids) => void savePeople(ids) }}
          create={{
            label: (q) => `Crear a «${q}»`,
            run: async (q) => (await createPerson(q.slice(0, 120)))?.id ?? null,
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'task' && (
        <LinkPicker
          title="Vincular un pendiente"
          placeholder="Busca un pendiente…"
          hint="Primero los abiertos, por fecha"
          items={tasks}
          current={card.entry_id}
          create={{
            blank: true,
            label: (q) => (q ? `Crear el pendiente «${q}»` : 'Crear un pendiente con esta tarjeta'),
            run: async (q) => {
              const entry = await createEntry(
                {
                  title: (q || card.title).slice(0, 180),
                  body: card.body.slice(0, 4000),
                  kind: 'Pendiente',
                  tags: [],
                  personIds: peopleIds,
                  date: todayInputValue(),
                  amount: 0,
                  direction: 'egreso',
                  status: 'pendiente',
                  images: [],
                  details: { priority: 'media', ...(card.due && { due: card.due }) },
                  file: null,
                  removeFile: false,
                },
                true,
              );
              if (entry) onPatch({ entry_id: entry.id });
            },
          }}
          onPick={(id) => {
            const t = workspace.entries.find((x) => x.id === id);
            onPatch({ entry_id: id, ...(t?.details.due && !card.due && { due: t.details.due }) });
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'episode' && (
        <LinkPicker
          title="Vincular un episodio"
          placeholder="Busca un episodio…"
          hint="Los más recientes"
          items={episodes}
          current={card.episode_id}
          onPick={(id) => onPatch({ episode_id: id })}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'reading' && (
        <LinkPicker
          title="Vincular una lectura"
          placeholder="Busca un artículo por título…"
          hint="Tus lecturas más recientes"
          search={searchReadings}
          current={card.reading_id}
          onPick={(id) => onPatch({ reading_id: id })}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

/** Un vínculo: vacío, un botón para añadirlo; con valor, se cambia, se abre o se quita. */
function LinkTile({
  icon,
  label,
  empty,
  value,
  extra,
  onAdd,
  onOpen,
  onClear,
}: {
  icon: ReactNode;
  label: string;
  empty: string;
  value?: { lead?: ReactNode; main: string; sub?: string } | null | false;
  extra?: ReactNode;
  onAdd: () => void;
  onOpen?: (() => void) | false;
  onClear: () => void;
}) {
  if (!value)
    return (
      <button type="button" className="bdm-link-add" onClick={onAdd}>
        <span className="bdm-link-lead">{icon}</span>
        <span>{empty}</span>
        <Plus size={15} />
      </button>
    );
  return (
    <div className="bdm-link">
      <button
        type="button"
        className="bdm-link-main"
        title={`Cambiar ${label.toLowerCase()}`}
        onClick={onAdd}
      >
        <span className="bdm-link-lead">
          {value.lead ?? <span className="bdp-glyph">{icon}</span>}
        </span>
        <span className="bdm-link-text">
          <small>{label}</small>
          <b>{value.main}</b>
          {value.sub && <em>{value.sub}</em>}
        </span>
      </button>
      {extra}
      <div className="bdm-link-acts">
        {onOpen && (
          <button
            type="button"
            title="Abrir"
            aria-label={`Abrir ${label.toLowerCase()}`}
            onClick={onOpen}
          >
            <ArrowUpRight size={15} />
          </button>
        )}
        <button
          type="button"
          title="Quitar"
          aria-label={`Quitar ${label.toLowerCase()}`}
          onClick={onClear}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
