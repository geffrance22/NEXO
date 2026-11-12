import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AlarmClock,
  AlignLeft,
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Bell,
  BookOpen,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  Columns3,
  Flag,
  GitBranch,
  Highlighter,
  History,
  Hourglass,
  Layers,
  LayoutTemplate,
  Link2,
  ListChecks,
  LoaderCircle,
  Lock,
  MessageCircle,
  Minus,
  Palette,
  Plus,
  Repeat as RepeatIcon,
  RotateCcw,
  Tag,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { Sheet } from '../components/Sheet';
import type { CommitmentKind, Entry, Person } from '../data';
import {
  ageInDays,
  commitmentKindList,
  commitmentKinds,
  commitmentOf,
  MISSED_ONE,
  missedText,
  nudgeText,
  outcomeHint,
  whatsappLink,
} from '../lib/commitments';
import { episodeKindOf } from '../lib/episodes';
import { addDays, friendlyDate, nextMonday, shortDate, todayInputValue } from '../lib/format';
import { relationMeta, relationOf, searchText } from '../lib/people';
import { Avatar } from '../people/Avatar';
import { Popover } from './BoardPopover';
import { ageOf, ageText, snoozeState } from './BoardCard';
import { SnoozeMenu } from './BoardSnooze';
import { priorityLabels } from './boardRules';
import { PRIORITIES, type BoardCard, type CardChanges, type Column, type Priority } from './boardStore';
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
import { RoutineStats } from './views/RoutineStats';
import { blocksCard, otherOf, stillBlocks, type CardLinksApi, type LinkCond } from './cardLinks';
import {
  saveCardTemplate,
  slashAt,
  takeSlash,
  templateChanges,
  templateFromCard,
  useCardTemplates,
} from './boardCardTemplates';
import { missingPhase2Text, usePhase2 } from './boardPhase';

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
  power = true,
  sync = true,
  aging = 0,
  onPatch,
  onToggleDone,
  onArchive,
  onDelete,
  onClose,
  links,
  boardCards = [],
  isDoneId,
  onPeopleAdded,
  onHistory,
}: {
  card: BoardCard;
  /** Columnas del tablero (vacío en Archivados). */
  columns: Column[];
  done: boolean;
  /** Ya existe la migración 014 (completar, archivar, color). */
  extras: boolean;
  /** Ya existe la migración 202611090002 (prioridad, resaltar, posponer). */
  power?: boolean;
  /** Ya existe la migración 202611100008 (inicio, rutinas). */
  sync?: boolean;
  /** Días para «Tarjetas que envejecen» en su tablero (0: no). */
  aging?: number;
  onPatch: (changes: CardChanges) => void;
  onToggleDone: () => void;
  /** Archivar o, si ya está archivada, desarchivar. */
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** Vínculos entre tarjetas del tablero (sin ellos no se ven las dependencias). */
  links?: CardLinksApi;
  /** Las demás tarjetas del tablero (para elegir dependencias). */
  boardCards?: BoardCard[];
  isDoneId?: (id: string) => boolean;
  /** Se añadieron personas (para las reglas «Se le añade una persona»). */
  onPeopleAdded?: (ids: string[]) => void;
  /** Abre el historial de esta tarjeta. */
  onHistory?: () => void;
}) {
  const archived = Boolean(card.archived_at);
  const { notify } = useApp();
  const phase2 = usePhase2();
  const templates = useCardTemplates();
  const title = useDraft(card.title, (v) => {
    const t = v.replace(/\s+/g, ' ').trim();
    if (t && t !== card.title) onPatch({ title: t });
  });
  const body = useDraft(card.body, (v) => v !== card.body && onPatch({ body: v }));
  const [tag, setTag] = useState('');
  const [item, setItem] = useState('');
  const [editingBody, setEditingBody] = useState(false);
  const [colMenu, setColMenu] = useState<DOMRect | null>(null);
  const [repeatMenu, setRepeatMenu] = useState<DOMRect | null>(null);
  const [snoozeMenu, setSnoozeMenu] = useState<DOMRect | null>(null);
  const [dateFor, setDateFor] = useState<string | null>(null);
  const [itemCaret, setItemCaret] = useState(0);
  const snz = snoozeState(card);
  const age = ageOf(card, aging, done);
  const due = dueState(card.due, done);
  const ticked = card.checks.filter((c) => c.done).length;
  const pct = card.checks.length ? Math.round((100 * ticked) / card.checks.length) : 0;
  const tone = toneOf(card.color);
  const column = columns.find((c) => c.id === card.list_id);
  const today = todayInputValue();

  const setChecks = (checks: CheckItem[]) => onPatch({ checks });
  const addTag = () => {
    const parts = tag
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length) onPatch({ tags: [...new Set([...card.tags, ...parts])] });
    setTag('');
  };
  /** «/reunion» en la lista: aplica la plantilla de tarjeta (suma lo que trae). */
  const applySlash = (text: string) => {
    const hit = takeSlash(text.trim(), templates.all);
    if (!hit) return false;
    const ch = templateChanges(hit.template, card);
    if (!power) {
      delete ch.priority;
    }
    if (Object.keys(ch).length) onPatch(ch);
    notify(
      Object.keys(ch).length
        ? `Plantilla «${hit.template.name}» aplicada.`
        : `La tarjeta ya tenía todo lo de «${hit.template.name}».`,
    );
    return true;
  };
  const addItem = () => {
    if (item.trim().startsWith('/') && applySlash(item)) return setItem('');
    const lines = item
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    if (lines.length)
      setChecks([
        ...card.checks,
        ...lines.map((text) => ({
          id: crypto.randomUUID(),
          text,
          done: false,
        })),
      ]);
    setItem('');
  };
  const slash = slashAt(item, itemCaret);
  const slashHits = slash
    ? templates.all
        .filter((t) => t.slug.startsWith(slash.query.toLowerCase()) || !slash.query)
        .slice(0, 6)
    : [];
  const [naming, setNaming] = useState<string | null>(null);
  const saveAsTemplate = async (name: string) => {
    if (!name.trim()) return;
    setNaming(null);
    const tpl = templateFromCard(card, name);
    const res = await saveCardTemplate(tpl);
    notify(
      res.ok
        ? `Plantilla guardada: escribe /${tpl.slug} al crear una tarjeta${res.local ? ' (solo en este equipo)' : ''}.`
        : 'No se pudo guardar la plantilla: ' + (res.error ?? 'error'),
    );
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
                      {dateFor === c.id ? (
                        <input
                          type="date"
                          className="bdm-check-date"
                          autoFocus
                          defaultValue={c.due ?? ''}
                          aria-label="Fecha del punto"
                          onBlur={(e) => {
                            const v = e.target.value || null;
                            if (v !== (c.due ?? null))
                              setChecks(card.checks.map((x) => (x.id === c.id ? { ...x, due: v } : x)));
                            setDateFor(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setDateFor(null);
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={
                            'bdm-check-due' +
                            (c.due ? ' on' : '') +
                            (c.due && !c.done && c.due < today ? ' late' : '') +
                            (c.due && !c.done && c.due === today ? ' today' : '')
                          }
                          title={c.due ? `Para ${friendlyDate(c.due).toLowerCase()} · cambiar` : 'Ponerle fecha'}
                          aria-label={c.due ? `Fecha: ${friendlyDate(c.due)}` : 'Ponerle fecha al punto'}
                          onClick={() => setDateFor(c.id)}
                        >
                          <Calendar size={12} />
                          {c.due && <span>{friendlyDate(c.due, today)}</span>}
                        </button>
                      )}
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
                placeholder="Añadir un punto… (o /plantilla)"
                aria-label="Nuevo punto"
                onChange={(e) => {
                  setItem(e.target.value);
                  setItemCaret(e.target.selectionStart ?? e.target.value.length);
                }}
                onSelect={(e) => setItemCaret(e.currentTarget.selectionStart ?? 0)}
                onKeyDown={(e) => {
                  if (slashHits.length && e.key === 'Tab') {
                    e.preventDefault();
                    setItem('/' + slashHits[0].slug);
                  }
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (!text.includes('\n')) return;
                  e.preventDefault();
                  setItem(text);
                  setTimeout(() => (e.target as HTMLInputElement).form?.requestSubmit());
                }}
              />
              {slashHits.length > 0 && (
                <ul className="bdm-slash" role="listbox" aria-label="Plantillas de tarjeta">
                  {slashHits.map((t) => (
                    <li key={t.slug}>
                      <button
                        type="button"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => {
                          applySlash('/' + t.slug);
                          setItem('');
                        }}
                      >
                        <LayoutTemplate size={13} /> <b>/{t.slug}</b> <span>{t.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </form>
          </section>

          {links && !archived && (
            <section className="bdm-sec">
              <h3>
                <GitBranch size={15} /> Dependencias
              </h3>
              <Dependencies
                card={card}
                links={links}
                cards={boardCards}
                columns={columns}
                isDoneId={isDoneId ?? (() => false)}
                typed={links.typed && phase2 !== false}
              />
            </section>
          )}

          <section className="bdm-sec">
            <h3>
              <Link2 size={15} /> Vínculos de Nexo
            </h3>
            <NexoLinks
              card={card}
              done={done}
              onPatch={onPatch}
              leave={leave}
              onPeopleAdded={onPeopleAdded}
            />
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

          {sync && !archived && (
            <section>
              <h4>
                <Bell size={13} /> Recordatorio
              </h4>
              <input
                type="datetime-local"
                value={card.remind_at ? toLocalInput(card.remind_at) : ''}
                aria-label="Recordatorio"
                disabled={phase2 === false}
                onChange={(e) =>
                  onPatch({
                    remind_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                    reminded_at: null,
                  })
                }
              />
              <div className="bdm-quick">
                {(
                  [
                    ['En 1 h', () => new Date(Date.now() + 3_600_000)],
                    ['Mañana 9:00', () => atHour(addDays(today, 1), 9)],
                    ...(card.due ? ([['El día, 9:00', () => atHour(card.due!, 9)]] as const) : []),
                  ] as const
                ).map(([label, at]) => (
                  <button
                    type="button"
                    key={label}
                    disabled={phase2 === false}
                    onClick={() => {
                      if ('Notification' in window && Notification.permission === 'default')
                        void Notification.requestPermission().catch(() => undefined);
                      onPatch({ remind_at: at().toISOString(), reminded_at: null });
                    }}
                  >
                    {label}
                  </button>
                ))}
                {card.remind_at && (
                  <button
                    type="button"
                    onClick={() => onPatch({ remind_at: null, reminded_at: null })}
                  >
                    Quitar
                  </button>
                )}
              </div>
              <small className="bdm-repeat-hint">
                {phase2 === false
                  ? missingPhase2Text
                  : card.reminded_at
                    ? 'Ya te avisó. Cambia la hora para que vuelva a avisar.'
                    : 'Te avisa aunque no tengas Nexo abierto si el servidor está programado.'}
              </small>
            </section>
          )}

          {sync && !archived && (
            <section>
              <h4>
                <Calendar size={13} /> Inicio
              </h4>
              <input
                type="date"
                value={card.starts || ''}
                max={card.due || undefined}
                aria-label="Fecha de inicio"
                onChange={(e) => onPatch({ starts: e.target.value || null })}
              />
              <small className="bdm-repeat-hint">
                Con inicio y fecha límite se ve como una barra en la línea de tiempo.
              </small>
            </section>
          )}

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
            <RoutineStats card={card} sync={sync} />
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
              <Flag size={13} /> Prioridad
            </h4>
            <div className="bdm-prio" role="radiogroup" aria-label="Prioridad">
              {(['', ...PRIORITIES] as Priority[]).map((p) => (
                <button
                  type="button"
                  key={p || 'none'}
                  role="radio"
                  aria-checked={card.priority === p}
                  className={(card.priority === p ? 'on ' : '') + 'p-' + (p || 'none')}
                  disabled={!power}
                  onClick={() => onPatch({ priority: p })}
                >
                  {p ? priorityLabels[p] : 'Ninguna'}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={'bdm-toggle' + (card.highlight ? ' on' : '')}
              aria-pressed={card.highlight}
              disabled={!power}
              title="Resalta la tarjeta entera. Para unas palabras escribe **así**; para tacharlas, --así--"
              onClick={() => onPatch({ highlight: !card.highlight })}
            >
              <Highlighter size={14} />
              <span>{card.highlight ? 'Resaltada' : 'Resaltar'}</span>
              <i className="bdm-switch" aria-hidden="true" />
            </button>
          </section>

          {!archived && (
            <section>
              <h4>
                <AlarmClock size={13} /> Posponer
              </h4>
              <button
                type="button"
                className={'bdm-repeat' + (snz?.on ? ' on' : '')}
                aria-haspopup="menu"
                aria-expanded={Boolean(snoozeMenu)}
                disabled={!power}
                onClick={(e) => setSnoozeMenu(e.currentTarget.getBoundingClientRect())}
              >
                <AlarmClock size={14} />
                <span>{snz?.on ? `Hasta ${snz.label.toLowerCase()}` : 'Ahora no'}</span>
                <ChevronDown size={13} />
              </button>
              {snz?.on && (
                <small className="bdm-repeat-hint">
                  No se ve en la columna; vuelve sola ese día.
                </small>
              )}
              {snoozeMenu && (
                <Popover
                  anchor={snoozeMenu}
                  width={260}
                  label="Posponer"
                  onClose={() => setSnoozeMenu(null)}
                >
                  <SnoozeMenu
                    current={card.snoozed_until}
                    onPick={(until) => {
                      setSnoozeMenu(null);
                      onPatch({ snoozed_until: until });
                    }}
                  />
                </Popover>
              )}
            </section>
          )}

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
            {onHistory && (
              <button type="button" onClick={onHistory}>
                <History size={14} /> Historial
              </button>
            )}
            {naming === null ? (
              <button type="button" onClick={() => setNaming(card.title.slice(0, 40))}>
                <LayoutTemplate size={14} /> Guardar como plantilla de tarjeta
              </button>
            ) : (
              <form
                className="bdm-add small"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveAsTemplate(naming);
                }}
              >
                <LayoutTemplate size={13} />
                <input
                  autoFocus
                  value={naming}
                  maxLength={80}
                  placeholder="Nombre (se invoca con /nombre)"
                  aria-label="Nombre de la plantilla de tarjeta"
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setNaming(null);
                    }
                  }}
                />
              </form>
            )}
            <button type="button" className="danger" onClick={onDelete}>
              <Trash2 size={14} /> Eliminar
            </button>
          </section>

          {card.created_at && <p className="bdm-meta">Creada el {shortDate(card.created_at)}</p>}
          {card.touched_at && (
            <p className={'bdm-meta' + (age.level ? ' aged' : '')}>
              {age.level ? <Hourglass size={11} /> : null} Último cambio:{' '}
              {age.days ? `hace ${ageText(age.days)}` : shortDate(card.touched_at)}
            </p>
          )}
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
const pad = (n: number) => String(n).padStart(2, '0');
/** ISO → valor de un campo datetime-local (hora de este equipo). */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const atHour = (day: string, h: number) => new Date(`${day}T${pad(h)}:00:00`);

/**
 * Dependencias de la tarjeta: con qué otras está vinculada y cómo. «Depende de» (la otra la
 * bloquea), «Bloquea a» o simplemente relacionadas. Un bloqueo dura hasta que la otra se complete
 * o llegue a una columna; mientras tanto, la tarjeta se ve con candado.
 */
function Dependencies({
  card,
  links,
  cards,
  columns,
  isDoneId,
  typed,
}: {
  card: BoardCard;
  links: CardLinksApi;
  cards: BoardCard[];
  columns: Column[];
  isDoneId: (id: string) => boolean;
  /** Existe la migración de vínculos con tipo. */
  typed: boolean;
}) {
  const { notify } = useApp();
  const [picking, setPicking] = useState<'depends' | 'blocks' | 'rel' | null>(null);
  const mine = links.links.filter((l) => l.a === card.id || l.b === card.id);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const colName = (id: string) => columns.find((c) => c.id === id)?.name ?? 'otra columna';
  const items = useMemo<PickItem[]>(
    () =>
      cards
        .filter((c) => c.id !== card.id && !links.has(card.id, c.id))
        .map((c) => ({
          id: c.id,
          title: c.title,
          sub: colName(c.list_id) + (isDoneId(c.id) ? ' · completada' : ''),
          icon: (
            <span className="bdp-glyph">
              <Columns3 size={15} />
            </span>
          ),
        })),
    [cards, card.id, links.links],
  );
  const kindOf = (l: (typeof mine)[number]) =>
    l.kind !== 'blocks' ? 'rel' : l.blocker === card.id ? 'blocks' : 'depends';

  return (
    <div className="bdm-deps">
      {mine.map((l) => {
        const otherId = otherOf(l, card.id);
        const other = byId.get(otherId);
        const k = kindOf(l);
        const blocker = l.blocker ? byId.get(l.blocker) : undefined;
        const active =
          l.kind === 'blocks' && stillBlocks(l, blocker, (id) => isDoneId(id));
        return (
          <div key={l.a + l.b} className={'bdm-dep' + (active ? ' active' : '')}>
            <div className="bdm-dep-main">
              {active ? <Lock size={13} /> : <Link2 size={13} />}
              <span>
                <b>{other?.title ?? 'Tarjeta archivada o de otro tablero'}</b>
                {other && (
                  <small>
                    {colName(other.list_id)}
                    {isDoneId(otherId) ? ' · completada' : ''}
                  </small>
                )}
              </span>
              <button
                type="button"
                className="bdm-icon"
                aria-label="Quitar el vínculo"
                onClick={() => {
                  links.unlink(l.a, l.b);
                  notify('Vínculo quitado.', {
                    label: 'Deshacer',
                    icon: 'undo',
                    run: () => links.link(l.a, l.b, l),
                  });
                }}
              >
                <X size={13} />
              </button>
            </div>
            <div className="bdm-dep-opts">
              <select
                value={k}
                aria-label="Tipo de vínculo"
                disabled={!typed}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'rel') links.setType(l.a, l.b, { kind: 'rel' });
                  else
                    links.setType(l.a, l.b, {
                      kind: 'blocks',
                      blocker: v === 'blocks' ? card.id : otherId,
                      cond: 'done',
                    });
                }}
              >
                <option value="rel">Relacionada</option>
                <option value="depends">Depende de ella (la bloquea)</option>
                <option value="blocks">Esta la bloquea</option>
              </select>
              {l.kind === 'blocks' && (
                <select
                  value={l.cond ?? 'done'}
                  aria-label="Hasta cuándo bloquea"
                  onChange={(e) =>
                    links.setType(l.a, l.b, { kind: 'blocks', cond: e.target.value as LinkCond })
                  }
                >
                  <option value="done">hasta que se complete</option>
                  {columns.map((c) => (
                    <option key={c.id} value={'list:' + c.id}>
                      hasta que llegue a «{c.name.slice(0, 30)}»
                    </option>
                  ))}
                </select>
              )}
            </div>
            {l.kind === 'blocks' && (
              <input
                className="bdm-dep-note"
                defaultValue={l.note ?? ''}
                maxLength={300}
                placeholder="Qué falta (opcional)"
                aria-label="Qué falta"
                onBlur={(e) =>
                  e.target.value !== (l.note ?? '') &&
                  links.setType(l.a, l.b, { kind: 'blocks', note: e.target.value })
                }
              />
            )}
          </div>
        );
      })}
      <div className="bdm-dep-add">
        <button type="button" disabled={!typed} onClick={() => setPicking('depends')}>
          <Lock size={13} /> Depende de…
        </button>
        <button type="button" disabled={!typed} onClick={() => setPicking('blocks')}>
          <Lock size={13} /> Bloquea a…
        </button>
        <button type="button" onClick={() => setPicking('rel')}>
          <Link2 size={13} /> Relacionar
        </button>
      </div>
      {!typed && <small className="bdm-repeat-hint">{missingPhase2Text}</small>}
      {picking && (
        <LinkPicker
          title={
            picking === 'depends'
              ? '¿De qué tarjeta depende?'
              : picking === 'blocks'
                ? '¿A qué tarjeta bloquea?'
                : 'Relacionar con una tarjeta'
          }
          placeholder="Busca una tarjeta del tablero…"
          hint="Tarjetas de este tablero"
          items={items}
          onPick={(id) => {
            links.link(
              card.id,
              id,
              picking === 'rel'
                ? undefined
                : { kind: 'blocks', blocker: picking === 'depends' ? id : card.id, cond: 'done' },
            );
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/** ¿Hay otra tarjeta que todavía bloquea a esta? Devuelve la primera que la bloquea. */
export function blockerOf(
  card: Pick<BoardCard, 'id'>,
  links: CardLinksApi['links'],
  byId: (id: string) => BoardCard | undefined,
  isDoneId: (id: string) => boolean,
) {
  for (const l of links) {
    if (!blocksCard(l, card.id)) continue;
    const b = byId(l.blocker!);
    if (stillBlocks(l, b, isDoneId)) return b;
  }
  return undefined;
}

/** Compromiso del pendiente de la tarjeta: lo prometí, lo espero, depende de alguien. */
function Commitment({
  task,
  people,
  title,
}: {
  task: Entry;
  people: Person[];
  title: string;
}) {
  const { patchEntry } = useApp();
  const k = commitmentOf(task);
  const whoId =
    (k === 'prometi' ? task.details.beneficiary : k === 'quiero' ? undefined : task.details.owner) ??
    people[0]?.id;
  const who = people.find((p) => p.id === whoId) ?? people[0];
  const waiting = k === 'espero' || k === 'depende';
  const days = ageInDays(task);
  const set = (next: CommitmentKind, personId = who?.id) => {
    const d = { ...task.details };
    delete d.owner;
    delete d.beneficiary;
    if (next === 'quiero') delete d.commitment;
    else d.commitment = next;
    if (personId && next === 'prometi') d.beneficiary = personId;
    if (personId && (next === 'espero' || next === 'depende')) {
      d.owner = personId;
      // Al empezar a esperar se cuenta desde hoy.
      if (!(k === 'espero' || k === 'depende')) d.waitingSince = todayInputValue();
    } else delete d.waitingSince;
    void patchEntry(task, { details: d });
  };
  const wa = who && waiting ? whatsappLink(who.profile.phone, nudgeText(who, title, days)) : null;
  return (
    <div className="bdm-commit">
      <div className="bdm-commit-kinds" role="radiogroup" aria-label="Tipo de compromiso">
        {commitmentKindList.map((x) => {
          const m = commitmentKinds[x];
          return (
            <button
              type="button"
              key={x}
              role="radio"
              aria-checked={k === x}
              className={k === x ? 'on' : ''}
              style={{ '--cm': m.color, '--cs': m.soft } as CSSProperties}
              title={m.label}
              onClick={() => set(x)}
            >
              <m.icon size={13} /> {m.short}
            </button>
          );
        })}
      </div>
      {k !== 'quiero' && people.length > 1 && (
        <label className="bdm-commit-who">
          <span>{commitmentKinds[k].who}</span>
          <select value={who?.id ?? ''} onChange={(e) => set(k, e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {waiting && who && (
        <div className={'bdm-wait' + (days >= 7 ? ' long' : '')}>
          <Hourglass size={13} />
          <span>
            En espera de <b>{who.name.split(' ')[0]}</b> ·{' '}
            {days === 0 ? 'desde hoy' : days === 1 ? '1 día' : `${days} días`}
          </span>
          {wa ? (
            <a className="bdm-wa" href={wa} target="_blank" rel="noreferrer" title="Preguntarle por WhatsApp">
              <MessageCircle size={13} /> WhatsApp
            </a>
          ) : (
            <small title="Añade su teléfono en su ficha para escribirle desde aquí">Sin teléfono</small>
          )}
          <button
            type="button"
            className="bdm-icon"
            title="Volver a contar desde hoy (ya le preguntaste)"
            aria-label="Volver a contar desde hoy"
            onClick={() =>
              void patchEntry(task, { details: { ...task.details, waitingSince: todayInputValue() } })
            }
          >
            <RotateCcw size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

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
  onPeopleAdded,
}: {
  card: BoardCard;
  done: boolean;
  onPatch: (changes: CardChanges) => void;
  /** Cierra la ficha y navega. */
  leave: (to: () => void) => void;
  onPeopleAdded?: (ids: string[]) => void;
}) {
  const {
    workspace,
    askOutcome,
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
  const taskMissed = task?.status === 'no_realizado';
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
    const added = ids.filter((id) => !peopleIds.includes(id));
    try {
      if (task) {
        if (!ids.length && isBoardEntry(task)) {
          onPatch({ entry_id: null, person_id: null });
          removeEntry(task, true);
          return;
        }
        const ok = await patchEntry(task, { person_ids: ids });
        if (ok && card.person_id) onPatch({ person_id: null });
        if (ok && added.length) onPeopleAdded?.(added);
        return;
      }
      if (!ids.length) {
        if (card.person_id) onPatch({ person_id: null });
        return;
      }
      const entry = await createEntry(boardEntryInput(card, ids, done), true);
      if (entry) {
        onPatch({ entry_id: entry.id, person_id: null });
        if (added.length) onPeopleAdded?.(added);
      }
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
            Number(a.status !== 'pendiente') - Number(b.status !== 'pendiente') ||
            (a.details.due ?? '9999').localeCompare(b.details.due ?? '9999'),
        )
        .map((e) => ({
          id: e.id,
          title: e.title,
          sub:
            e.status === 'completado'
              ? 'Hecho'
              : e.status === 'no_realizado'
                ? MISSED_ONE
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
          const k = episodeKindOf(ep.kind);
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
  const epKind = episode ? episodeKindOf(episode.kind) : null;

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
          {task && <Commitment task={task} people={linkedPeople} title={card.title} />}
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
                  : taskMissed
                    ? missedText(task)
                    : task.details.due
                    ? 'Para ' + friendlyDate(task.details.due).toLowerCase()
                    : 'Sin fecha',
              }
            }
            extra={
              task && (
                <button
                  type="button"
                  className={'bdm-taskdone' + (taskDone ? ' on' : '') + (taskMissed ? ' miss' : '')}
                  title={
                    task.status === 'pendiente'
                      ? outcomeHint(task)
                      : 'Reabrir el pendiente'
                  }
                  aria-haspopup={task.status === 'pendiente' ? 'menu' : undefined}
                  // Abierto: «Hecho» o «No lo hice»; cerrado (hecho o soltado): lo reabre.
                  onClick={(e) => askOutcome(task, e.currentTarget)}
                >
                  {taskMissed ? (
                    <Minus size={13} strokeWidth={3} />
                  ) : (
                    <Check size={13} strokeWidth={3} />
                  )}{' '}
                  {taskDone ? 'Hecho' : taskMissed ? MISSED_ONE : 'Completar'}
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
          onClick={() => leave(() => go('Libroteca', { id: card.note_id! }))}
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
