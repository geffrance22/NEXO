import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { normalizeText } from '../lib/format';
import { Popover } from './Popover';

export type QuickItem = {
  id: string;
  name: string;
  /** Una función se llama solo al pintar la fila (útil con miles de recuerdos). */
  sub?: string | (() => string);
  lead: ReactNode;
  /** Texto normalizado donde se busca. */
  search: string;
  /** Solo aparece al buscar (o si ya está elegido): nunca entre los sugeridos. */
  searchOnly?: boolean;
};

/** Con búsqueda: cuántos resultados se pintan (luego se afina escribiendo). */
const FOUND = 30;

/**
 * Buscador pequeño junto a su botón: sin escribir muestra solo los más frecuentes (`top`); al
 * escribir busca entre todos. Con `onCreate`, abajo hay un campo para añadir uno nuevo ahí mismo
 * (no se crea todavía: lo decide quien lo usa).
 */
export function QuickPick({
  anchor,
  label,
  placeholder,
  items,
  top,
  selected,
  onPick,
  onCreate,
  createPlaceholder = 'Nuevo',
  createIcon = <Plus size={15} />,
  noun,
  topLabel = 'Frecuentes',
  emptyTop,
  hint,
  onClose,
}: {
  anchor: HTMLElement;
  label: string;
  placeholder: string;
  /** Ya ordenados: lo más frecuente primero. */
  items: QuickItem[];
  top: number;
  selected: string[];
  onPick: (id: string) => void;
  onCreate?: (name: string) => void;
  createPlaceholder?: string;
  createIcon?: ReactNode;
  /** «lugares», «personas»: para los textos de ayuda. */
  noun: string;
  /** Título de lo sugerido (sin buscar). */
  topLabel?: string;
  /** Qué decir cuando, sin buscar, no hay nada que sugerir. */
  emptyTop?: string;
  /** Qué decir, sin buscar, de lo que solo sale al escribir (por defecto, cuántos hay; "" no dice nada). */
  hint?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [fresh, setFresh] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const needle = normalizeText(query.trim());
  const chosen = new Set(selected);

  useEffect(() => {
    const t = window.setTimeout(() => input.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, []);

  const rows = useMemo(() => {
    if (!needle) {
      const sel = new Set(selected);
      const picked = items.filter((i) => sel.has(i.id));
      const rest = items.filter((i) => !sel.has(i.id) && !i.searchOnly);
      // Lo elegido que solo sale buscando se suma a los sugeridos, no les quita sitio.
      const extra = picked.filter((i) => i.searchOnly).length;
      return [...picked, ...rest].slice(0, Math.max(top, picked.length) + extra);
    }
    const starts: QuickItem[] = [];
    const inside: QuickItem[] = [];
    for (const it of items) {
      const name = normalizeText(it.name);
      if (name.startsWith(needle) || name.includes(' ' + needle)) starts.push(it);
      else if (it.search.includes(needle)) inside.push(it);
    }
    return [...starts, ...inside].slice(0, FOUND);
    // `selected` solo importa sin búsqueda.
  }, [items, needle, top, selected]);

  // Solo si se puede crear se mira si ya existe (con miles de recuerdos, no se hace de balde).
  const canAdd = Boolean(
    onCreate && needle && !items.some((it) => normalizeText(it.name) === needle),
  );
  const total = rows.length + (canAdd ? 1 : 0);
  useEffect(() => setCursor(0), [needle]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const activate = (i: number) => {
    if (canAdd && i === rows.length) onCreate!(query.trim());
    else if (rows[i]) onPick(rows[i].id);
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    const name = fresh.trim();
    if (name && onCreate) onCreate(name);
  };
  const hidden = needle ? 0 : items.length - rows.length;

  return (
    <Popover anchor={anchor} onClose={onClose} label={label} className="qp">
      <label className="qp-search">
        <Search size={15} />
        <input
          ref={input}
          value={query}
          maxLength={120}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded="true"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(total - 1, c + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (total) activate(cursor);
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="qp-clear"
            aria-label="Borrar búsqueda"
            onClick={() => {
              setQuery('');
              input.current?.focus();
            }}
          >
            <X size={13} />
          </button>
        )}
      </label>

      <div className="qp-list" ref={list} role="listbox" aria-label={label}>
        {!needle && rows.length > 0 && <span className="qp-group">{topLabel}</span>}
        {rows.map((it, i) => {
          const on = chosen.has(it.id);
          return (
            <button
              type="button"
              key={it.id}
              data-i={i}
              role="option"
              aria-selected={on}
              className={'qp-row' + (i === cursor ? ' cur' : '') + (on ? ' on' : '')}
              onMouseMove={() => i !== cursor && setCursor(i)}
              onClick={() => onPick(it.id)}
            >
              {it.lead}
              <span className="qp-text">
                <strong>{it.name}</strong>
                {it.sub && <small>{typeof it.sub === 'function' ? it.sub() : it.sub}</small>}
              </span>
              {on && <Check size={15} className="qp-check" />}
            </button>
          );
        })}
        {canAdd && (
          <button
            type="button"
            data-i={rows.length}
            className={'qp-row add' + (cursor === rows.length ? ' cur' : '')}
            onMouseMove={() => setCursor(rows.length)}
            onClick={() => onCreate!(query.trim())}
          >
            <span className="qp-tile">
              <Plus size={15} />
            </span>
            <span className="qp-text">
              <strong>Añadir «{query.trim()}»</strong>
              <small>Nuevo · se crea al publicar</small>
            </span>
          </button>
        )}
        {needle && !rows.length && !canAdd && <p className="qp-note">Sin resultados.</p>}
        {!needle && !items.length && <p className="qp-note">Aún no tienes {noun}.</p>}
        {!needle && !rows.length && items.length > 0 && emptyTop && (
          <p className="qp-note">{emptyTop}</p>
        )}
        {hidden > 0 && hint !== '' && (
          <p className="qp-note">
            {hint ?? `Escribe para buscar entre ${items.length.toLocaleString('es-CO')} ${noun}.`}
          </p>
        )}
      </div>

      {onCreate && (
        <form className="qp-new" onSubmit={create}>
          {createIcon}
          <input
            value={fresh}
            maxLength={120}
            placeholder={createPlaceholder}
            aria-label={createPlaceholder}
            onChange={(e) => setFresh(e.target.value)}
          />
          <button type="submit" disabled={!fresh.trim()} aria-label="Añadir" title="Añadir">
            <Plus size={16} />
          </button>
        </form>
      )}
    </Popover>
  );
}
