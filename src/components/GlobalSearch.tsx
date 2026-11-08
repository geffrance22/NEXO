import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link2, Search, type LucideIcon } from 'lucide-react';
import { useApp } from '../AppContext';
import { kindMeta } from '../composer/kinds';
import { useDismiss } from '../hooks/useDismiss';
import { kindLabel } from '../lib/entries';
import { episodeKindOf } from '../lib/episodes';
import { shortDate } from '../lib/format';
import { relationMeta, relationOf } from '../lib/people';
import { placeKinds } from '../lib/places';
import { ME, groupKinds, tieCategories, tieKinds } from '../lib/relations';
import { searchWorkspace, type SearchHit } from '../lib/search';
import { Avatar } from '../people/Avatar';

type Look = { icon: LucideIcon; color: string; soft: string };

/** Ícono, colores y textos de una fila de resultado. */
function describe(hit: SearchHit): { title: string; sub: string; look: Look | null } {
  switch (hit.type) {
    case 'person':
      return {
        title: hit.person.name,
        sub: relationMeta[relationOf(hit.person)].label,
        look: null,
      };
    case 'entry': {
      const { entry } = hit;
      const meta = kindMeta[entry.kind];
      return {
        title: entry.title || entry.kind,
        sub: `${kindLabel(entry)} · ${shortDate(entry.created_at)}`,
        look: { icon: meta.icon, color: meta.ink, soft: meta.soft },
      };
    }
    case 'place': {
      const { place } = hit;
      const kind = placeKinds[place.kind] ?? placeKinds.otro;
      return {
        title: place.name,
        sub: [kind.label, place.city].filter(Boolean).join(' · '),
        look: { icon: kind.icon, color: kind.color, soft: kind.soft },
      };
    }
    case 'tie': {
      const { tie, a, b } = hit;
      const info = tieKinds[tie.kind];
      const category = tieCategories[info?.category ?? 'otro'];
      return {
        title: `${a?.name ?? 'Tú'} → ${b.name}`,
        sub: [info?.label, tie.note].filter(Boolean).join(' · '),
        look: { icon: Link2, color: category.color, soft: category.soft },
      };
    }
    case 'group': {
      const { group } = hit;
      const kind = groupKinds[group.kind] ?? groupKinds.otro;
      const n = group.member_ids.length;
      return {
        title: group.name,
        sub: `${kind.label} · ${n} ${n === 1 ? 'persona' : 'personas'}`,
        look: { icon: kind.icon, color: kind.color, soft: kind.soft },
      };
    }
    case 'episode': {
      const { episode } = hit;
      const kind = episodeKindOf(episode.kind);
      const when = episode.starts_on ?? episode.created_at;
      return {
        title: episode.title,
        sub: [kind.label, shortDate(when)].filter(Boolean).join(' · '),
        look: { icon: kind.icon, color: kind.color, soft: kind.soft },
      };
    }
  }
}

/** Campo de búsqueda del encabezado: personas, recuerdos, lugares, vínculos y grupos. */
export function GlobalSearch() {
  const { workspace, go, viewEntry, openTie, openGroup } = useApp();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const groups = useMemo(() => searchWorkspace(workspace, query), [workspace, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  const shown = open && query.trim() !== '';
  const current = flat.length ? Math.min(active, flat.length - 1) : -1;
  const optionId = (i: number) => `${listId}-${i}`;

  const close = useCallback(() => setOpen(false), []);
  useDismiss(shown, root, close);

  const pick = (hit: SearchHit) => {
    setOpen(false);
    setQuery('');
    switch (hit.type) {
      case 'person':
        return go('Personas', hit.person);
      case 'place':
        return go('Lugares', hit.place);
      case 'entry':
        return viewEntry(hit.entry);
      case 'tie':
        return openTie(hit.b, [hit.a?.id ?? ME]);
      case 'group':
        return openGroup(hit.group);
      case 'episode':
        return go('Episodios', hit.episode);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown) return setOpen(query.trim() !== '');
      if (!flat.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (e.key === 'Enter' && shown && current >= 0) {
      e.preventDefault();
      pick(flat[current]);
    }
  };

  let index = 0;
  return (
    <div className="gsearch" ref={root}>
      <label className="gs-field">
        <Search size={15} aria-hidden="true" />
        <input
          className="gs-input"
          role="combobox"
          aria-label="Buscar en todo el espacio"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown && current >= 0 ? optionId(current) : undefined}
          placeholder="Buscar…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </label>
      {shown && (
        <div className="pp-dropdown gs-panel" role="listbox" id={listId}>
          {groups.length === 0 && (
            <div className="gs-empty" role="option" aria-selected="false" aria-disabled="true">
              Sin resultados para «{query.trim()}»
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <span className="pp-dropdown-label" aria-hidden="true">
                {group.label}
              </span>
              {group.hits.map((hit) => {
                const i = index++;
                const { title, sub, look } = describe(hit);
                return (
                  <div
                    key={i}
                    id={optionId(i)}
                    className={'gs-row' + (i === current ? ' active' : '')}
                    role="option"
                    aria-selected={i === current}
                    onMouseMove={() => i !== current && setActive(i)}
                    onClick={() => pick(hit)}
                  >
                    {hit.type === 'person' ? (
                      <Avatar person={hit.person} size={28} />
                    ) : (
                      look && (
                        <span
                          className="gs-ico"
                          style={{ background: look.soft, color: look.color }}
                        >
                          <look.icon size={15} />
                        </span>
                      )
                    )}
                    <span className="gs-text">
                      <span className="gs-title">{title}</span>
                      {sub && <span className="gs-sub">{sub}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
