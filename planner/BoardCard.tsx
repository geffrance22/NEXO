import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlignLeft,
  Archive,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  Link2,
  ListChecks,
  Plus,
  Repeat as RepeatIcon,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Person } from '../data';
import { Avatar } from '../people/Avatar';
import { cardPeople } from './boardPeople';
import { repeatLabel } from './boardRepeat';
import type { BoardCard } from './boardStore';
import { dueState, tagTone, toneOf } from './boardTheme';

type Open = { checks: boolean; body: boolean };
/** Lo que se puede hacer desde la tarjeta sin abrirla. */
export type CardInline = {
  toggleChecks: () => void;
  toggleBody: () => void;
  check: (id: string) => void;
  addCheck: (text: string) => void;
};

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/**
 * Lo que muestra una tarjeta: color, etiquetas, título y sus señales. La lista de verificación
 * y la descripción se despliegan ahí mismo (con `inline`, se tachan puntos sin abrir la ficha).
 */
export function CardFace({
  card,
  done,
  linkedTask,
  open = { checks: false, body: false },
  inline,
}: {
  card: BoardCard;
  done: boolean;
  linkedTask: boolean;
  open?: Open;
  inline?: CardInline;
}) {
  const { workspace } = useApp();
  const due = dueState(card.due, done);
  const checks = card.checks.length;
  const ticked = card.checks.filter((c) => c.done).length;
  const entry = card.entry_id ? workspace.entries.find((e) => e.id === card.entry_id) : undefined;
  const people = cardPeople(card, entry)
    .map((id) => workspace.people.find((p) => p.id === id))
    .filter((p): p is Person => Boolean(p));
  const links = Boolean(card.note_id || card.episode_id || card.reading_id);
  const body = card.body.trim();
  const showChecks = open.checks && checks > 0;
  const showBody = open.body && Boolean(body);
  const Toggle = inline ? 'button' : 'span';
  return (
    <>
      {card.tags.length > 0 && (
        <div className="bd-tags">
          {card.tags.slice(0, 4).map((t) => {
            const tone = tagTone(t);
            return (
              <span key={t} style={{ '--tc': tone.c, '--ts': tone.s } as CSSProperties}>
                {t}
              </span>
            );
          })}
          {card.tags.length > 4 && <span className="more">+{card.tags.length - 4}</span>}
        </div>
      )}
      <span className="bd-card-title">{card.title}</span>
      {(due || checks > 0 || body || links || linkedTask || people.length > 0 || card.repeat) && (
        <div className="bd-badges">
          {due && (
            <span className={'bd-due ' + due.tone} title="Fecha límite">
              <Calendar size={12} /> {due.label}
            </span>
          )}
          {card.repeat && (
            <span className="bd-repeat" title={repeatLabel(card.repeat, card.due)}>
              <RepeatIcon size={12} />
            </span>
          )}
          {checks > 0 && (
            <Toggle
              {...(inline && {
                type: 'button' as const,
                'data-nodrag': true,
                'aria-expanded': showChecks,
                onClick: (e: { stopPropagation: () => void }) => {
                  stop(e);
                  inline.toggleChecks();
                },
              })}
              className={
                'bd-badge-toggle' + (ticked === checks ? ' full' : '') + (showChecks ? ' open' : '')
              }
              title={
                inline
                  ? showChecks
                    ? 'Plegar la lista'
                    : 'Desplegar la lista aquí'
                  : 'Lista de verificación'
              }
            >
              <CheckSquare size={12} /> {ticked}/{checks}
              {inline && <ChevronDown size={11} className="bd-chev" />}
            </Toggle>
          )}
          {body && (
            <Toggle
              {...(inline && {
                type: 'button' as const,
                'data-nodrag': true,
                'aria-expanded': showBody,
                onClick: (e: { stopPropagation: () => void }) => {
                  stop(e);
                  inline.toggleBody();
                },
              })}
              className={'bd-badge-toggle' + (showBody ? ' open' : '')}
              title={
                inline
                  ? showBody
                    ? 'Plegar la descripción'
                    : 'Desplegar la descripción aquí'
                  : 'Tiene descripción'
              }
            >
              <AlignLeft size={12} />
              {inline && <ChevronDown size={11} className="bd-chev" />}
            </Toggle>
          )}
          {linkedTask && !people.length && (
            <span title="Vinculada a un pendiente">
              <ListChecks size={12} />
            </span>
          )}
          {links && (
            <span title="Vinculada en Nexo">
              <Link2 size={12} />
            </span>
          )}
          {people.length > 0 && (
            <span
              className="bd-faces"
              title={people.map((p) => p.name).join(', ')}
              aria-label={`Con ${people.map((p) => p.name).join(', ')}`}
            >
              {people.slice(0, 3).map((p) => (
                <Avatar key={p.id} person={p} size={20} />
              ))}
              {people.length > 3 && <i>+{people.length - 3}</i>}
            </span>
          )}
        </div>
      )}
      {showBody && (
        <p className="bd-inline-body" data-nodrag onClick={stop}>
          {body}
        </p>
      )}
      {showChecks && <InlineChecks card={card} ticked={ticked} inline={inline} />}
    </>
  );
}

/** La lista de verificación desplegada en la columna: tachar y añadir puntos ahí mismo. */
function InlineChecks({
  card,
  ticked,
  inline,
}: {
  card: BoardCard;
  ticked: number;
  inline?: CardInline;
}) {
  const [text, setText] = useState('');
  const pct = Math.round((100 * ticked) / Math.max(1, card.checks.length));
  return (
    <div className="bd-inline-checks" data-nodrag onClick={stop} onKeyDown={stop}>
      <div className={'bd-mini-progress' + (pct === 100 ? ' full' : '')}>
        <i style={{ width: pct + '%' }} />
      </div>
      <ul>
        {card.checks.map((c) => (
          <li key={c.id}>
            {inline ? (
              <button
                type="button"
                className={'bd-ic' + (c.done ? ' on' : '')}
                aria-pressed={c.done}
                onClick={() => inline.check(c.id)}
              >
                <span className="bd-ic-box">
                  <Check size={10} strokeWidth={3.2} />
                </span>
                <span className="bd-ic-text">{c.text}</span>
              </button>
            ) : (
              <span className={'bd-ic' + (c.done ? ' on' : '')}>
                <span className="bd-ic-box">
                  <Check size={10} strokeWidth={3.2} />
                </span>
                <span className="bd-ic-text">{c.text}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {inline && (
        <form
          className="bd-ic-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            inline.addCheck(text.trim().slice(0, 300));
            setText('');
          }}
        >
          <Plus size={12} />
          <input
            value={text}
            maxLength={300}
            placeholder="Añadir un punto…"
            aria-label="Nuevo punto de la lista"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setText('');
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </form>
      )}
    </div>
  );
}

/** Divisor («---»): una línea que separa grupos de tarjetas. Se arrastra y se quita como una tarjeta. */
export function DividerTile({
  card,
  before,
  onDelete,
  onDragStart,
}: {
  card: BoardCard;
  before: string | null;
  onDelete: () => void;
  onDragStart: (e: ReactPointerEvent<HTMLElement>, before: string | null) => void;
}) {
  return (
    <div
      className="bd-divider"
      data-card={card.id}
      data-flip={'c:' + card.id}
      role="separator"
      aria-label="Divisor"
      title="Divisor · arrástralo para moverlo"
      onPointerDown={(e) => onDragStart(e, before)}
    >
      <i />
      <button
        type="button"
        className="bd-divider-x"
        data-nodrag
        title="Quitar el divisor"
        aria-label="Quitar el divisor"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

/**
 * Tarjeta en su columna. El círculo la completa (no se mueve de sitio); al pasar el cursor
 * aparecen eliminar y, si ya está completada, archivar. Un clic abre su ficha.
 */
export function CardTile({
  card,
  done,
  linkedTask,
  before,
  open,
  inline,
  onOpen,
  onToggle,
  onDelete,
  onArchive,
  onDragStart,
}: {
  card: BoardCard;
  done: boolean;
  linkedTask: boolean;
  /** Tarjeta que sigue (para el arrastre). */
  before: string | null;
  open: Open;
  inline: CardInline;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onDragStart: (e: ReactPointerEvent<HTMLElement>, before: string | null) => void;
}) {
  const tone = toneOf(card.color);
  return (
    <div
      className={'bd-card' + (done ? ' done' : '') + (tone ? ' tinted' : '')}
      style={tone ? ({ '--cc': tone.c } as CSSProperties) : undefined}
      data-card={card.id}
      data-flip={'c:' + card.id}
      role="button"
      tabIndex={0}
      aria-label={card.title + (done ? ' (completada)' : '')}
      onPointerDown={(e) => onDragStart(e, before)}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen();
        } else if (e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="bd-card-row">
        <button
          type="button"
          className="bd-done"
          data-nodrag
          aria-pressed={done}
          title={done ? 'Marcar como no completada' : 'Marcar como completada'}
          aria-label={done ? 'Marcar como no completada' : 'Marcar como completada'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <Check size={11} strokeWidth={3.2} />
        </button>
        <div className="bd-card-body">
          <CardFace card={card} done={done} linkedTask={linkedTask} open={open} inline={inline} />
        </div>
      </div>
      <div className="bd-card-acts" data-nodrag>
        {done && (
          <button
            type="button"
            title="Archivar"
            aria-label="Archivar la tarjeta"
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          >
            <Archive size={14} />
          </button>
        )}
        <button
          type="button"
          className="danger"
          title="Eliminar"
          aria-label="Eliminar la tarjeta"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
