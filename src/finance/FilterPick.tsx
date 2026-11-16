import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Popover } from '../instants/Popover';
import { normalizeText } from '../lib/format';
import './categories.css';

export type PickOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  /** Cuántos movimientos tiene (se muestra a la derecha). */
  count?: number;
};

/**
 * Un filtro como botón: muestra lo elegido (con su ícono) y abre un panel pequeño con las
 * opciones, su cantidad y un buscador si son muchas. La × lo quita.
 */
export function FilterPick({
  icon,
  placeholder,
  title,
  allLabel,
  options,
  value,
  onChange,
  extra,
  valueSuffix,
}: {
  icon: ReactNode;
  /** Lo que dice sin nada elegido («Categoría»). */
  placeholder: string;
  title: string;
  /** La primera opción, que quita el filtro («Todas las categorías»). */
  allLabel: string;
  options: PickOption[];
  value: string;
  onChange: (v: string) => void;
  /** Algo más dentro del panel, debajo de la lista (p. ej. cómo contar la categoría). */
  extra?: ReactNode;
  /** Un detalle junto a lo elegido en el botón («+ secundaria»). */
  valueSuffix?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.value === value);
  const needle = normalizeText(q.trim());
  const shown = needle ? options.filter((o) => normalizeText(o.label).includes(needle)) : options;
  const close = () => {
    setAnchor(null);
    setQ('');
  };
  const pick = (v: string) => {
    onChange(v);
    close();
  };

  return (
    <span className={'fz-fpick' + (current ? ' on' : '') + (anchor ? ' open' : '')}>
      <button
        type="button"
        className="fz-fpick-btn"
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => (anchor ? close() : setAnchor(e.currentTarget))}
      >
        <span className="fz-fpick-ico" aria-hidden="true">
          {current?.icon ?? icon}
        </span>
        <span className="fz-fpick-label">
          {current ? current.label : placeholder}
          {current && valueSuffix && <small> {valueSuffix}</small>}
        </span>
        {!current && <ChevronDown size={13} className="fz-fpick-chev" />}
      </button>
      {current && (
        <button
          type="button"
          className="fz-fpick-x"
          aria-label={`Quitar el filtro de ${placeholder.toLowerCase()}`}
          title="Quitar filtro"
          onClick={() => onChange('')}
        >
          <X size={12} />
        </button>
      )}
      {anchor && (
        <Popover
          anchor={anchor}
          label={title}
          className="fz-catpick compact fz-fpanel"
          onClose={close}
        >
          <header className="fz-cpk-head">
            <span>
              <strong>{title}</strong>
            </span>
            <button type="button" className="fz-cpk-x" aria-label="Cerrar" onClick={close}>
              <X size={14} />
            </button>
          </header>
          {options.length > 7 && (
            <label className="fz-cpk-search">
              <Search size={13} />
              <input
                value={q}
                autoFocus
                maxLength={40}
                placeholder="Buscar…"
                aria-label={`Buscar en ${title.toLowerCase()}`}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && shown.length === 1) {
                    e.preventDefault();
                    pick(shown[0].value);
                  }
                }}
              />
            </label>
          )}
          <ul className="fz-fpanel-list" role="listbox" aria-label={title}>
            {!needle && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  className={'fz-fpanel-row all' + (!value ? ' on' : '')}
                  onClick={() => pick('')}
                >
                  <span className="fz-fpanel-ico" aria-hidden="true">
                    {icon}
                  </span>
                  <span>{allLabel}</span>
                  {!value && <Check size={13} strokeWidth={2.6} className="fz-fpanel-check" />}
                </button>
              </li>
            )}
            {shown.map((o) => {
              const on = o.value === value;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={'fz-fpanel-row' + (on ? ' on' : '')}
                    onClick={() => pick(o.value)}
                  >
                    <span className="fz-fpanel-ico" aria-hidden="true">
                      {o.icon}
                    </span>
                    <span>{o.label}</span>
                    {on ? (
                      <Check size={13} strokeWidth={2.6} className="fz-fpanel-check" />
                    ) : (
                      o.count !== undefined && <small>{o.count}</small>
                    )}
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="fz-catpick-none">Nada con «{q}».</li>}
          </ul>
          {extra && <div className="fz-fpanel-extra">{extra}</div>}
        </Popover>
      )}
    </span>
  );
}
