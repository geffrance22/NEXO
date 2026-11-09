import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, MapPin, Plus, Search, UserPlus, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Person, PlaceKind } from '../data';
import { initials, normalizeText } from '../lib/format';
import { relationMeta, relationOf, searchText } from '../lib/people';
import { placeKindList, placeKinds, placeSearchText } from '../lib/places';
import { Avatar } from '../people/Avatar';

/** Cuántas filas se pintan a la vez (con miles de personas, se afina escribiendo). */
const LIMIT = 60;

export type PickItem = {
  id: string;
  name: string;
  sub?: string;
  lead?: ReactNode;
  /** Texto normalizado donde se busca (por defecto, el nombre). */
  search?: string;
};

/**
 * Buscador en ventana: filtra mientras escribes, se maneja con flechas y Enter, y si no existe
 * lo que buscas ofrece crearlo. Sirve para una sola opción o para varias.
 */
export function PickDialog({
  title,
  placeholder,
  items,
  selected,
  multi = false,
  pinned = [],
  pinnedLabel = 'En este texto',
  onToggle,
  onCreate,
  createHint,
  onClear,
  footer,
  onClose,
}: {
  title: string;
  placeholder: string;
  items: PickItem[];
  selected: string[];
  multi?: boolean;
  /** Ids que van primero cuando no hay búsqueda. */
  pinned?: string[];
  pinnedLabel?: string;
  onToggle: (id: string) => void;
  onCreate?: (name: string) => void;
  createHint?: string;
  onClear?: () => void;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const t = window.setTimeout(() => input.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const needle = normalizeText(query.trim());
  const chosen = new Set(selected);
  const pinSet = new Set(pinned);
  const matches = useMemo(() => {
    if (!needle) return items;
    const starts: PickItem[] = [];
    const rest: PickItem[] = [];
    for (const it of items) {
      const name = normalizeText(it.name);
      if (name.startsWith(needle) || name.includes(' ' + needle)) starts.push(it);
      else if ((it.search ?? name).includes(needle)) rest.push(it);
    }
    return [...starts, ...rest];
  }, [items, needle]);
  const exact = items.some((it) => normalizeText(it.name) === needle);
  const canCreate = Boolean(onCreate && query.trim() && !exact);

  const groups: { title: string; rows: PickItem[] }[] = needle
    ? [{ title: '', rows: matches.slice(0, LIMIT) }]
    : [
        { title: pinnedLabel, rows: matches.filter((it) => pinSet.has(it.id)) },
        {
          title: pinned.length ? 'Todas' : '',
          rows: matches.filter((it) => !pinSet.has(it.id)).slice(0, LIMIT),
        },
      ];
  const flat = groups.flatMap((g) => g.rows);
  const hidden = (needle ? matches.length : items.length - pinSet.size) - LIMIT;
  const rowsTotal = flat.length + (canCreate ? 1 : 0);

  useEffect(() => setCursor(0), [needle]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const pick = (id: string) => {
    onToggle(id);
    if (!multi) onClose();
    else {
      setQuery('');
      input.current?.focus();
    }
  };
  const create = () => {
    const name = query.trim();
    if (!onCreate || !name) return;
    onCreate(name);
    if (!multi) onClose();
    else setQuery('');
  };
  const activate = (i: number) => {
    if (canCreate && i === flat.length) create();
    else if (flat[i]) pick(flat[i].id);
  };

  let index = -1;
  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop xp-pk-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
    >
      <div className="pk xp-pk" role="dialog" aria-modal="true" aria-label={title}>
        <header className="pk-head">
          <h3>{title}</h3>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <label className="pk-search">
          <Search size={16} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            maxLength={120}
            role="combobox"
            aria-expanded="true"
            aria-controls="xp-pk-list"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(rowsTotal - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (multi && !query.trim()) onClose();
                else activate(flat.length ? cursor : 0);
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="xp-pk-clear"
              aria-label="Borrar búsqueda"
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
        </label>

        <div className="pk-list" id="xp-pk-list" ref={list} role="listbox">
          {groups.map(
            (g, gi) =>
              g.rows.length > 0 && (
                <div key={gi}>
                  {g.title && <span className="pk-group">{g.title}</span>}
                  {g.rows.map((it) => {
                    index++;
                    const i = index;
                    const on = chosen.has(it.id);
                    return (
                      <button
                        type="button"
                        key={it.id}
                        data-i={i}
                        role="option"
                        aria-selected={on}
                        className={'pk-row' + (on ? ' on' : '') + (i === cursor ? ' cur' : '')}
                        onMouseMove={() => i !== cursor && setCursor(i)}
                        onClick={() => pick(it.id)}
                      >
                        {it.lead ?? (
                          <span className="pk-tile xp-initials">{initials(it.name).toUpperCase()}</span>
                        )}
                        <span>
                          <strong>{it.name}</strong>
                          {it.sub && <small>{it.sub}</small>}
                        </span>
                        {multi ? (
                          <i className={'pk-tick' + (on ? ' on' : '')}>
                            <Check size={13} strokeWidth={3} />
                          </i>
                        ) : (
                          on && <Check size={17} className="pk-check" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ),
          )}
          {canCreate && (
            <button
              type="button"
              data-i={flat.length}
              className={'pk-row create' + (cursor === flat.length ? ' cur' : '')}
              onMouseMove={() => setCursor(flat.length)}
              onClick={create}
            >
              <span className="pk-tile">
                <Plus size={17} />
              </span>
              <span>
                <strong>Añadir «{query.trim()}»</strong>
                {createHint && <small>{createHint}</small>}
              </span>
            </button>
          )}
          {hidden > 0 && (
            <p className="xp-pk-more">
              {needle ? `${hidden} resultados más. Afina la búsqueda.` : `Escribe para buscar entre ${items.length}.`}
            </p>
          )}
          {!flat.length && !canCreate && <p className="xp-pk-more">Sin resultados.</p>}
        </div>

        {(multi || onClear || footer) && (
          <footer className="pk-foot">
            {footer ?? <span />}
            <div className="xp-pk-actions">
              {onClear && selected.length > 0 && (
                <button
                  type="button"
                  className="cp-btn ghost"
                  onClick={() => {
                    onClear();
                    onClose();
                  }}
                >
                  Quitar
                </button>
              )}
              {multi && (
                <button type="button" className="cp-btn cta" onClick={onClose}>
                  <Check size={16} /> Listo
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ───────────── Personas ───────────── */

export type PersonOpt = { id: string; name: string; person?: Person; note?: string };

type PeopleCtx = {
  options: PersonOpt[];
  /** Las mismas opciones, listas para el buscador (más frecuentes primero). */
  items: PickItem[];
  /** Personas que aparecen en esta experiencia (van primero). */
  inText: string[];
  /** Añade una persona nueva (se crea al guardar) y devuelve su id provisional. */
  addPerson: (name: string) => string;
};
export const CapturePeople = createContext<PeopleCtx>({
  options: [],
  items: [],
  inText: [],
  addPerson: () => '',
});

/** Cuántos recuerdos tiene cada persona (para ordenar por frecuencia). */
export function personCounts(entries: { person_ids: string[] }[]) {
  const m = new Map<string, number>();
  for (const e of entries) for (const id of e.person_ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export function personItems(options: PersonOpt[], counts: Map<string, number>): PickItem[] {
  return options
    .map((o) => {
      const n = counts.get(o.id) ?? 0;
      return {
        id: o.id,
        name: o.name,
        n,
        sub: o.person
          ? [
              relationMeta[relationOf(o.person)].label,
              o.person.role,
              n ? `${n} ${n === 1 ? 'recuerdo' : 'recuerdos'}` : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : o.note,
        lead: o.person ? (
          <Avatar person={o.person} size={36} />
        ) : (
          <span className="pk-tile xp-new-tile">
            <UserPlus size={16} />
          </span>
        ),
        search: o.person ? searchText(o.person) : normalizeText(o.name),
      };
    })
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'es'));
}

function PersonAvatar({ opt, size = 22 }: { opt?: PersonOpt; size?: number }) {
  if (opt?.person) return <Avatar person={opt.person} size={size} />;
  return (
    <span className="xp-dot-avatar" style={{ width: size, height: size } as CSSProperties}>
      {opt ? initials(opt.name).toUpperCase() : <UserPlus size={12} />}
    </span>
  );
}

/** Una sola persona: un botón que abre el buscador. */
export function PersonField({
  value,
  onChange,
  label,
  placeholder = 'Elegir persona',
  optional = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  placeholder?: string;
  optional?: boolean;
}) {
  const { options, items, inText, addPerson } = useContext(CapturePeople);
  const [open, setOpen] = useState(false);
  const opt = options.find((o) => o.id === value);
  return (
    <>
      <span className={'xp-field-pill' + (opt ? ' set' : '')}>
        <button type="button" aria-label={label} title={label} onClick={() => setOpen(true)}>
          <PersonAvatar opt={opt} />
          <span>{opt?.name ?? placeholder}</span>
          <ChevronDown size={14} />
        </button>
        {optional && opt && (
          <button
            type="button"
            className="xp-pill-x"
            aria-label="Quitar"
            onClick={() => onChange(null)}
          >
            <X size={12} />
          </button>
        )}
      </span>
      {open && (
        <PickDialog
          title={label}
          placeholder="Busca por nombre, apodo, ciudad…"
          items={items}
          selected={value ? [value] : []}
          pinned={inText.filter((id) => options.some((o) => o.id === id))}
          onToggle={(id) => onChange(id === value && optional ? null : id)}
          onCreate={(name) => onChange(addPerson(name))}
          createHint="Persona nueva, se crea al guardar"
          onClear={optional ? () => onChange(null) : undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Varias personas: chips y un botón para buscar más. */
export function PeopleField({
  ids,
  onChange,
  label = '¿Con quién?',
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const { options, items, inText, addPerson } = useContext(CapturePeople);
  const [open, setOpen] = useState(false);
  const latest = useRef(ids);
  latest.current = ids;
  const set = (next: string[]) => {
    latest.current = next;
    onChange(next);
  };
  return (
    <div className="xp-people">
      {ids.map((id) => {
        const opt = options.find((o) => o.id === id);
        return (
          <span key={id} className="xp-person-chip">
            <PersonAvatar opt={opt} size={20} />
            {opt?.name ?? '¿?'}
            <button
              type="button"
              aria-label="Quitar"
              onClick={() => set(ids.filter((x) => x !== id))}
            >
              <X size={11} />
            </button>
          </span>
        );
      })}
      <button type="button" className="xp-add" onClick={() => setOpen(true)}>
        <Plus size={13} /> {ids.length ? 'Persona' : 'Añadir personas'}
      </button>
      {open && (
        <PickDialog
          title={label}
          placeholder="Busca por nombre, apodo, ciudad…"
          items={items}
          selected={ids}
          multi
          pinned={inText.filter((id) => options.some((o) => o.id === id))}
          onToggle={(id) => {
            const cur = latest.current;
            set(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
          }}
          onCreate={(name) => set([...latest.current, addPerson(name)])}
          createHint="Persona nueva, se crea al guardar"
          footer={
            <span className="xp-pk-count">
              {ids.length
                ? `${ids.length} ${ids.length === 1 ? 'persona' : 'personas'}`
                : 'Nadie aún'}
            </span>
          }
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/* ───────────── Lugares ───────────── */

/**
 * El lugar de una pieza: uno de los tuyos o uno nuevo (que se crea al guardar). Si es nuevo,
 * se elige su tipo.
 */
export function PlaceField({
  placeId,
  placeName,
  placeKind,
  onChange,
}: {
  placeId: string | null;
  placeName: string;
  placeKind?: PlaceKind;
  onChange: (patch: { placeId: string | null; placeName: string; placeKind?: PlaceKind }) => void;
}) {
  const { workspace } = useApp();
  const [open, setOpen] = useState(false);
  const place = placeId ? workspace.places.find((p) => p.id === placeId) : undefined;
  const label = place?.name ?? placeName.trim();
  const items = useMemo(
    () =>
      workspace.places
        .map((p) => {
          const m = placeKinds[p.kind] ?? placeKinds.otro;
          return {
            id: p.id,
            name: p.name,
            sub: [m.label, p.city].filter(Boolean).join(' · '),
            lead: (
              <span className="pk-tile" style={{ '--c': m.color, '--s': m.soft } as CSSProperties}>
                <m.icon size={16} />
              </span>
            ),
            search: placeSearchText(p),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [workspace.places],
  );
  return (
    <>
      <span className={'xp-field-pill' + (label ? ' set' : '')}>
        <button type="button" aria-label="Lugar" title="Lugar" onClick={() => setOpen(true)}>
          <MapPin size={14} />
          <span>{label || 'Lugar'}</span>
          {!place && label && <em>nuevo</em>}
          <ChevronDown size={14} />
        </button>
        {label && (
          <button
            type="button"
            className="xp-pill-x"
            aria-label="Quitar lugar"
            onClick={() => onChange({ placeId: null, placeName: '' })}
          >
            <X size={12} />
          </button>
        )}
      </span>
      {!place && label && placeKind && (
        <select
          className="xp-select"
          value={placeKind}
          onChange={(e) =>
            onChange({ placeId: null, placeName, placeKind: e.target.value as PlaceKind })
          }
          aria-label="Tipo de lugar"
        >
          {placeKindList.map((k) => (
            <option key={k} value={k}>
              {placeKinds[k].label}
            </option>
          ))}
        </select>
      )}
      {open && (
        <PickDialog
          title="¿Dónde fue?"
          placeholder="Busca o escribe un lugar nuevo…"
          items={items}
          selected={placeId ? [placeId] : []}
          onToggle={(id) =>
            onChange(id === placeId ? { placeId: null, placeName: '' } : { placeId: id, placeName: '' })
          }
          onCreate={(name) => onChange({ placeId: null, placeName: name })}
          createHint="Lugar nuevo, se crea al guardar"
          onClear={label ? () => onChange({ placeId: null, placeName: '' }) : undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
