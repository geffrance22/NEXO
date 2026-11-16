import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Plus, Search, Star, Tag, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { normalizeText } from '../lib/format';
import { Popover } from '../instants/Popover';
import { CatIcon } from './catIcons';
import { financeState, saveSettings, settingsOf } from './store';
import './categories.css';

/**
 * El panel para elegir categorías: una cuadrícula con su ícono, buscador y crear una nueva ahí
 * mismo. Con `multiple` se eligen varias; la primera es la principal (la que cuenta en
 * presupuestos y gráficos). Con `confirmLabel`, el cambio se aplica al confirmar.
 */
export function CategoryPanel({
  anchor,
  options,
  value,
  onChange,
  onClose,
  multiple = true,
  createIn,
  title = 'Categoría',
  confirmLabel,
  onConfirm,
  align = 'start',
  compact = false,
  context,
  extra,
}: {
  anchor: HTMLElement;
  options: string[];
  value: string[];
  /** Cada cambio, al momento (sin `confirmLabel`). */
  onChange?: (list: string[]) => void;
  onClose: () => void;
  multiple?: boolean;
  /** Dónde se guarda una categoría que crees desde la búsqueda (de gasto o de ingreso). */
  createIn?: 'out' | 'in';
  title?: string;
  confirmLabel?: string;
  onConfirm?: (list: string[]) => void;
  align?: 'start' | 'end';
  /** Versión pequeña: fichas en vez de tarjetas (p. ej. al registrar desde Apuntes). */
  compact?: boolean;
  /** Una línea sobre lo que se está clasificando («Taxi · −$12.000»). */
  context?: string;
  /** Algo más en la versión compacta, sobre el pie (p. ej. reemplazar o añadir en lote). */
  extra?: ReactNode;
}) {
  const { notify } = useApp();
  const [picked, setPicked] = useState<string[]>(value);
  const [q, setQ] = useState('');
  const [made, setMade] = useState<string[]>([]);
  const all = [...options, ...made.filter((m) => !options.includes(m))];
  const needle = normalizeText(q.trim());
  const shown = needle ? all.filter((o) => normalizeText(o).includes(needle)) : all;
  const exact = all.some((o) => normalizeText(o) === needle);
  const canCreate = Boolean(createIn && q.trim().length >= 2 && !exact);
  const live = !confirmLabel;

  const apply = (next: string[]) => {
    setPicked(next);
    if (live) onChange?.(next);
  };
  const toggle = (name: string) => {
    if (!multiple) {
      const next = picked[0] === name ? [] : [name];
      apply(next);
      if (live && next.length) onClose();
      return;
    }
    apply(picked.includes(name) ? picked.filter((x) => x !== name) : [...picked, name]);
  };
  const makeMain = (name: string) => apply([name, ...picked.filter((x) => x !== name)]);
  const create = async () => {
    if (!createIn) return;
    const name = q.trim().slice(0, 30);
    const s = settingsOf(financeState().items);
    const key = createIn === 'out' ? 'extraOut' : 'extraIn';
    if (!s[key].includes(name)) {
      const r = await saveSettings({ [key]: [...s[key], name] });
      if (r !== true) return notify(r);
    }
    setMade((m) => [...m, name]);
    setQ('');
    toggle(name);
  };

  if (compact)
    return (
      <Popover
        anchor={anchor}
        align={align}
        label={title}
        className="fz-catpick compact"
        onClose={onClose}
      >
        <header className="fz-cpk-head">
          <span>
            <strong>{title}</strong>
            {context && <small title={context}>{context}</small>}
          </span>
          <button type="button" className="fz-cpk-x" aria-label="Cerrar" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <label className="fz-cpk-search">
          <Search size={13} />
          <input
            value={q}
            autoFocus
            maxLength={30}
            placeholder={createIn ? 'Buscar o crear…' : 'Buscar…'}
            aria-label="Buscar categoría"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (shown.length === 1) toggle(shown[0]);
              else if (canCreate) void create();
              else if (confirmLabel) onConfirm?.(picked);
            }}
          />
        </label>
        <div className="fz-cpk-list" role="group" aria-label={title}>
          {shown.map((name) => {
            const at = picked.indexOf(name);
            const on = at >= 0;
            return (
              <button
                type="button"
                key={name}
                role={multiple ? 'checkbox' : 'radio'}
                aria-checked={on}
                className={'fz-cpk' + (on ? ' on' : '')}
                title={multiple && at === 0 && picked.length > 1 ? 'Principal' : undefined}
                onClick={() => toggle(name)}
              >
                <CatIcon name={name} size={12} plain />
                {name}
                {on &&
                  (multiple && at === 0 && picked.length > 1 ? (
                    <Star size={10} className="fz-cpk-mark" />
                  ) : (
                    <Check size={11} strokeWidth={3} className="fz-cpk-mark" />
                  ))}
              </button>
            );
          })}
          {canCreate && (
            <button type="button" className="fz-cpk new" onClick={() => void create()}>
              <Plus size={12} /> Crear «{q.trim().slice(0, 30)}»
            </button>
          )}
          {!shown.length && !canCreate && <p className="fz-catpick-none">Nada con «{q}».</p>}
        </div>
        {extra && <div className="fz-fpanel-extra">{extra}</div>}
        <footer className="fz-cpk-foot">
          <small>
            {picked.length > 1
              ? `${picked.length} · la de la estrella es la principal`
              : picked.length
                ? picked[0]
                : 'Sin categoría'}
          </small>
          {confirmLabel ? (
            <button type="button" className="fz-cpk-go" onClick={() => onConfirm?.(picked)}>
              {confirmLabel}
            </button>
          ) : (
            <button type="button" className="fz-cpk-go" onClick={onClose}>
              Listo
            </button>
          )}
        </footer>
      </Popover>
    );

  return (
    <Popover anchor={anchor} align={align} label={title} className="fz-catpick" onClose={onClose}>
      <header className="fz-catpick-head">
        <label className="fz-catpick-search">
          <Search size={14} />
          <input
            value={q}
            autoFocus
            maxLength={30}
            placeholder={createIn ? 'Buscar o crear una categoría' : 'Buscar categoría'}
            aria-label="Buscar categoría"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (shown.length === 1) toggle(shown[0]);
              else if (canCreate) void create();
            }}
          />
          {q && (
            <button type="button" aria-label="Borrar búsqueda" onClick={() => setQ('')}>
              <X size={13} />
            </button>
          )}
        </label>
      </header>

      <div className="fz-catpick-grid" role="group" aria-label={title}>
        {shown.map((name) => {
          const at = picked.indexOf(name);
          const on = at >= 0;
          return (
            <button
              type="button"
              key={name}
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={on}
              className={'fz-catpick-tile' + (on ? ' on' : '')}
              onClick={() => toggle(name)}
            >
              <CatIcon name={name} size={16} />
              <span>{name}</span>
              {on && (
                <i className="fz-catpick-tick" aria-hidden="true">
                  <Check size={10} strokeWidth={3.4} />
                </i>
              )}
              {multiple && at === 0 && picked.length > 1 && <em>Principal</em>}
            </button>
          );
        })}
        {canCreate && (
          <button type="button" className="fz-catpick-tile new" onClick={() => void create()}>
            <span className="fz-cat-ico new" aria-hidden="true">
              <Plus size={16} />
            </span>
            <span>Crear «{q.trim().slice(0, 30)}»</span>
          </button>
        )}
        {!shown.length && !canCreate && <p className="fz-catpick-none">Nada con «{q}».</p>}
      </div>

      <footer className="fz-catpick-foot">
        {multiple && picked.length > 1 ? (
          <span className="fz-catpick-order" aria-label="Tus categorías en orden">
            {picked.map((n, i) => (
              <button
                type="button"
                key={n}
                className={i === 0 ? 'main' : ''}
                title={
                  i === 0 ? 'Principal: cuenta en presupuestos y gráficos' : 'Hacerla la principal'
                }
                onClick={() => makeMain(n)}
              >
                {i === 0 && <Star size={10} />} {n}
              </button>
            ))}
          </span>
        ) : (
          <small>
            {multiple ? 'Puedes elegir varias. La primera es la principal.' : 'Elige una.'}
          </small>
        )}
        {confirmLabel ? (
          <button type="button" className="fz-btn primary sm" onClick={() => onConfirm?.(picked)}>
            {confirmLabel}
          </button>
        ) : (
          multiple && (
            <button type="button" className="fz-btn primary sm" onClick={onClose}>
              Listo
            </button>
          )
        )}
      </footer>
    </Popover>
  );
}

/**
 * El campo de categorías del formulario: un botón con las elegidas (con su ícono) que abre el
 * panel. Sin ninguna elegida, ofrece tus frecuentes para tocar y listo.
 */
export function CategoryField({
  options,
  value,
  onChange,
  frequent = [],
  createIn,
  multiple = true,
}: {
  options: string[];
  value: string[];
  onChange: (list: string[]) => void;
  frequent?: string[];
  createIn?: 'out' | 'in';
  multiple?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const quick = frequent.filter((f) => options.includes(f)).slice(0, 3);
  const open = (el: HTMLElement) => setAnchor(anchor ? null : el);
  const several = value.length > 1;
  return (
    <div className="fm-cat" role="group" aria-label="Categoría">
      {value.map((n, i) => (
        <span key={n} className={'fm-cat-chip' + (i === 0 && several ? ' main' : '')}>
          <button
            type="button"
            className="fm-cat-name"
            title={
              i === 0 ? (several ? 'La principal · cambiar' : 'Cambiar') : 'Hacerla la principal'
            }
            aria-haspopup={i === 0 ? 'dialog' : undefined}
            onClick={(e) =>
              i === 0 ? open(e.currentTarget) : onChange([n, ...value.filter((x) => x !== n)])
            }
          >
            <CatIcon name={n} size={12} plain />
            {n}
            {i === 0 && several && <Star size={9} className="fm-cat-star" />}
          </button>
          <button
            type="button"
            className="fm-cat-x"
            aria-label={`Quitar ${n}`}
            title="Quitar"
            onClick={() => onChange(value.filter((x) => x !== n))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <button
        type="button"
        className={'fm-cat-add' + (value.length ? ' more' : '') + (anchor ? ' open' : '')}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        aria-label={value.length ? 'Añadir o cambiar categorías' : 'Elegir categoría'}
        title={value.length ? (multiple ? 'Añadir otra' : 'Cambiar') : undefined}
        onClick={(e) => open(e.currentTarget)}
      >
        {value.length ? (
          multiple ? (
            <Plus size={13} />
          ) : (
            <ChevronDown size={13} />
          )
        ) : (
          <>
            <Tag size={12} /> Elegir <ChevronDown size={12} />
          </>
        )}
      </button>
      {!value.length &&
        quick.map((n) => (
          <button type="button" key={n} className="fm-cat-quick" onClick={() => onChange([n])}>
            <CatIcon name={n} size={12} plain /> {n}
          </button>
        ))}
      {anchor && (
        <CategoryPanel
          compact
          anchor={anchor}
          title={multiple ? 'Categorías' : 'Categoría'}
          options={options}
          value={value}
          onChange={onChange}
          onClose={() => setAnchor(null)}
          createIn={createIn}
          multiple={multiple}
        />
      )}
    </div>
  );
}
