import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Search, Sparkles, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Group, GroupKind } from '../data';
import { normalizeText } from '../lib/format';
import { groupKinds, guessGroupKind } from '../lib/relations';
import './groups.css';

export const groupMeta = (k: GroupKind) => groupKinds[k] ?? groupKinds.otro;
export const groupVars = (k: GroupKind) => {
  const m = groupMeta(k);
  return { '--c': m.color, '--s': m.soft } as CSSProperties;
};
const searchable = (g: Group) =>
  normalizeText(`${g.name} ${g.description} ${groupMeta(g.kind).label}`);
const people = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`;

/** Resalta en el nombre lo que escribiste (sin tildes, como la búsqueda). */
function Marked({ text, needle }: { text: string; needle: string }) {
  const at = needle ? normalizeText(text).indexOf(needle) : -1;
  if (at < 0 || normalizeText(text).length !== text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

/**
 * Elegir grupos en una ventana: buscas, te va sugiriendo y marcas varios. Con `onCreate`, lo que
 * escribes y no existe se puede crear ahí mismo.
 */
export function GroupPicker({
  title,
  hint,
  selected,
  onToggle,
  suggested = [],
  pending = [],
  onCreate,
  onRemovePending,
  footer,
  onClose,
}: {
  title: string;
  hint?: string;
  selected: string[];
  onToggle: (id: string) => void;
  /** Grupos que tienen sentido aquí (p. ej. los de su familia): salen primero. */
  suggested?: string[];
  /** Nombres de grupos nuevos que aún no existen (se crean al guardar). */
  pending?: string[];
  onCreate?: (name: string) => void;
  onRemovePending?: (name: string) => void;
  /** Acciones extra en el pie, a la izquierda. */
  footer?: ReactNode;
  onClose: () => void;
}) {
  const { workspace } = useApp();
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Si encima hay un grupo abierto o una confirmación, Esc es para ellos.
      if (document.querySelector('.rl-dialog, .confirm[role="alertdialog"]')) return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const needle = normalizeText(query.trim());
  const all = [...workspace.groups].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const matches = needle ? all.filter((g) => searchable(g).includes(needle)) : all;
  const exact =
    all.find((g) => normalizeText(g.name.trim()) === needle) ??
    (pending.some((n) => normalizeText(n) === needle) ? null : undefined);
  const hints = needle ? [] : all.filter((g) => suggested.includes(g.id));
  const rest = needle ? matches : all.filter((g) => !hints.includes(g));
  const canCreate = Boolean(onCreate && query.trim() && exact === undefined);
  const chosen = [
    ...all.filter((g) => selected.includes(g.id)).map((g) => ({ name: g.name, kind: g.kind })),
    ...pending.map((name) => ({ name, kind: guessGroupKind(name) })),
  ];

  const create = () => {
    const name = query.trim().slice(0, 80);
    if (!name || !onCreate) return;
    onCreate(name);
    setQuery('');
    input.current?.focus();
  };

  const row = (g: Group) => {
    const m = groupMeta(g.kind);
    const on = selected.includes(g.id);
    return (
      <button
        type="button"
        key={g.id}
        className={'pk-row gp-row' + (on ? ' on' : '')}
        style={groupVars(g.kind)}
        aria-pressed={on}
        onClick={() => onToggle(g.id)}
      >
        <span className="pk-tile">
          <m.icon size={17} />
        </span>
        <span>
          <strong>
            <Marked text={g.name} needle={needle} />
          </strong>
          <small>
            {m.label} · {people(g.member_ids.length)}
            {g.description ? ` · ${g.description}` : ''}
          </small>
        </span>
        <i className={'pk-tick' + (on ? ' on' : '')}>
          <Check size={13} strokeWidth={3} />
        </i>
      </button>
    );
  };

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="pk gp" role="dialog" aria-modal="true" aria-label={title}>
        <header className="pk-head gp-head">
          <div>
            <h3>{title}</h3>
            {hint && <small>{hint}</small>}
          </div>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <label className="pk-search">
          <Search size={16} />
          <input
            ref={input}
            value={query}
            maxLength={80}
            placeholder={onCreate ? 'Busca o escribe uno nuevo…' : 'Buscar un grupo…'}
            aria-label="Buscar grupos"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (exact) onToggle(exact.id);
              else if (canCreate) create();
              else if (matches[0]) onToggle(matches[0].id);
            }}
          />
          {query && (
            <button
              type="button"
              className="gp-clear"
              aria-label="Borrar la búsqueda"
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
        </label>

        <div className="pk-list">
          {canCreate && (
            <button
              type="button"
              className="pk-row create gp-row"
              style={groupVars(guessGroupKind(query))}
              onClick={create}
            >
              <span className="pk-tile">
                <Plus size={17} />
              </span>
              <span>
                <strong>Crear «{query.trim()}»</strong>
                <small>Grupo nuevo · {groupMeta(guessGroupKind(query)).label}</small>
              </span>
            </button>
          )}
          {!needle && pending.length > 0 && (
            <>
              <span className="pk-group">Nuevos</span>
              {pending.map((name) => {
                const k = guessGroupKind(name);
                const Icon = groupMeta(k).icon;
                return (
                  <button
                    type="button"
                    key={'new:' + name}
                    className="pk-row gp-row on"
                    style={groupVars(k)}
                    onClick={() => onRemovePending?.(name)}
                  >
                    <span className="pk-tile">
                      <Icon size={17} />
                    </span>
                    <span>
                      <strong>
                        {name} <em className="gp-badge">nuevo</em>
                      </strong>
                      <small>Se crea al guardar</small>
                    </span>
                    <i className="pk-tick on">
                      <Check size={13} strokeWidth={3} />
                    </i>
                  </button>
                );
              })}
            </>
          )}
          {hints.length > 0 && (
            <>
              <span className="pk-group">
                <Sparkles size={12} /> Sugeridos
              </span>
              {hints.map(row)}
              {rest.length > 0 && <span className="pk-group">Todos</span>}
            </>
          )}
          {rest.map(row)}
          {!all.length && !pending.length && !query.trim() && (
            <p className="pp-empty pk-empty">
              {onCreate
                ? 'Aún no tienes grupos. Escribe un nombre para crear el primero: Iglesia, Trabajo, Familia Gómez…'
                : 'Aún no tienes grupos.'}
            </p>
          )}
          {needle && !matches.length && !canCreate && (
            <p className="pp-empty pk-empty">Ningún grupo coincide con «{query.trim()}».</p>
          )}
        </div>

        <footer className="pk-foot">
          {footer ?? (
            <div className="gp-chosen">
              {chosen.length ? (
                <>
                  {chosen.slice(0, 3).map((c) => (
                    <span className="gp-chip" key={c.name} style={groupVars(c.kind)}>
                      {c.name}
                    </span>
                  ))}
                  {chosen.length > 3 && <span className="gp-more">+{chosen.length - 3}</span>}
                </>
              ) : (
                <span className="gp-none">Ninguno aún</span>
              )}
            </div>
          )}
          <button type="button" className="cp-btn cta" onClick={onClose}>
            <Check size={16} /> Listo
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
