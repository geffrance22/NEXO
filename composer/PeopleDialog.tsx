import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Search, Sparkles, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Person, Relation } from '../data';
import { normalizeText } from '../lib/format';
import { relationMeta, relationOf, relations, searchText } from '../lib/people';
import { Avatar } from '../people/Avatar';
import type { ComposerApi } from './useComposer';

type PeopleApi = ComposerApi['people'];

/** Buscar y elegir varias personas cómodamente; si no existe, se crea con un clic. */
export function PeopleDialog({
  api,
  initialQuery = '',
  onClose,
}: {
  api: PeopleApi;
  initialQuery?: string;
  onClose: () => void;
}) {
  const { workspace, createPerson } = useApp();
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<Relation | 'todas'>('todas');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of workspace.entries)
      for (const id of e.person_ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [workspace.entries]);

  const selected = new Set(api.selected);
  const suggested = new Set(api.suggested.map((p) => p.id));
  const needle = normalizeText(query.trim());
  const present = relations.filter((r) => api.all.some((p) => relationOf(p) === r));
  const matches = api.all
    .filter(
      (p) =>
        (filter === 'todas' || relationOf(p) === filter) &&
        (!needle || searchText(p).includes(needle)),
    )
    .sort(
      (a, b) =>
        (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'es'),
    );
  const exact = api.all.some((p) => normalizeText(p.name) === needle);

  const pick = (p: Person) => {
    if (selected.has(p.id)) api.toggle(p.id);
    // Al crear, las sugerencias ya cuentan como elegidas: tocarlas las descarta.
    else if (suggested.has(p.id)) (api.autoLink ? api.dismiss : api.accept)(p.id);
    else api.toggle(p.id);
  };
  const create = async () => {
    if (!query.trim() || busy) return;
    setBusy(true);
    const person = await createPerson(query.trim());
    setBusy(false);
    if (person) {
      api.accept(person.id);
      setQuery('');
    }
  };

  const frequent = matches
    .filter((p) => !suggested.has(p.id) && (counts.get(p.id) ?? 0) > 0)
    .slice(0, 8);
  const groups: { title: string; people: Person[] }[] = needle
    ? [{ title: '', people: matches }]
    : [
        { title: 'Reconocidas en tu texto', people: matches.filter((p) => suggested.has(p.id)) },
        { title: 'Frecuentes', people: frequent },
        {
          title: 'Todas',
          people: matches
            .filter((p) => !suggested.has(p.id) && !frequent.includes(p))
            .sort((a, b) => a.name.localeCompare(b.name, 'es')),
        },
      ];
  const chosen = api.all.filter((p) => selected.has(p.id) || (api.autoLink && suggested.has(p.id)));

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
    >
      <div className="pk" role="dialog" aria-modal="true" aria-label="Elegir personas">
        <header className="pk-head">
          <h3>¿Con quién?</h3>
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
            placeholder="Busca por nombre, apodo, ciudad…"
            maxLength={120}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (matches[0] && (exact || needle)) pick(matches[0]);
              else void create();
            }}
          />
        </label>
        {present.length > 1 && (
          <div className="cp-chips pk-filters">
            <button
              type="button"
              className={'cp-chip' + (filter === 'todas' ? ' on' : '')}
              onClick={() => setFilter('todas')}
            >
              Todas
            </button>
            {present.map((r) => (
              <button
                type="button"
                key={r}
                className={'cp-chip' + (filter === r ? ' on' : '')}
                onClick={() => setFilter(r)}
              >
                {relationMeta[r].label}
              </button>
            ))}
          </div>
        )}

        <div className="pk-list">
          {query.trim() && !exact && (
            <button
              type="button"
              className="pk-row create"
              onClick={() => void create()}
              disabled={busy}
            >
              <span className="pk-tile">
                <Plus size={17} />
              </span>
              <span>
                <strong>Crear «{query.trim()}»</strong>
                <small>Nueva persona en tu universo</small>
              </span>
            </button>
          )}
          {groups.map(
            (g) =>
              g.people.length > 0 && (
                <div key={g.title || 'r'}>
                  {g.title && (
                    <span className="pk-group">
                      {g.title === 'Reconocidas en tu texto' && <Sparkles size={12} />} {g.title}
                    </span>
                  )}
                  {g.people.map((p) => {
                    const on =
                      selected.has(p.id) ||
                      (api.autoLink && suggested.has(p.id) && !selected.has(p.id));
                    return (
                      <button
                        type="button"
                        key={p.id}
                        className={'pk-row' + (on ? ' on' : '')}
                        onClick={() => pick(p)}
                      >
                        <Avatar person={p} size={36} />
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {relationMeta[relationOf(p)].label}
                            {p.role ? ` · ${p.role}` : ''}
                            {counts.get(p.id)
                              ? ` · ${counts.get(p.id)} ${counts.get(p.id) === 1 ? 'recuerdo' : 'recuerdos'}`
                              : ''}
                          </small>
                        </span>
                        <i className={'pk-tick' + (on ? ' on' : '')}>
                          <Check size={13} strokeWidth={3} />
                        </i>
                      </button>
                    );
                  })}
                </div>
              ),
          )}
          {!matches.length && !query.trim() && (
            <p className="pp-empty pk-empty">
              Aún no tienes personas. Escribe un nombre para crearla.
            </p>
          )}
        </div>

        <footer className="pk-foot">
          <div className="pk-chosen">
            {chosen.slice(0, 6).map((p) => (
              <Avatar key={p.id} person={p} size={28} />
            ))}
            <span>
              {chosen.length
                ? `${chosen.length} ${chosen.length === 1 ? 'persona' : 'personas'}`
                : 'Nadie aún'}
            </span>
          </div>
          <button type="button" className="cp-btn cta" onClick={onClose}>
            <Check size={16} /> Listo
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
