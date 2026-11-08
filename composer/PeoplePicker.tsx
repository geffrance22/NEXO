import { useState } from 'react';
import { Check, Search, Sparkles, X } from 'lucide-react';
import { Avatar } from '../people/Avatar';
import { normalizeText } from '../lib/format';
import { PersonCues } from './PersonCues';
import type { ComposerApi } from './useComposer';

type PeopleApi = ComposerApi['people'];

/**
 * Elegir personas. «rail»: avatares grandes en una fila (para encuentros).
 * «compact»: fichas con buscador (para el resto de tipos).
 */
export function PeoplePicker({ api, variant }: { api: PeopleApi; variant: 'rail' | 'compact' }) {
  const [query, setQuery] = useState('');
  const { all, selected, suggested } = api;
  const needle = normalizeText(query.trim());
  const matches = all.filter((p) => normalizeText(p.name).includes(needle));

  // Nombre corto bajo cada avatar: el de pila, o dos palabras si otra persona se llama igual.
  const firstNames = all.map((p) => normalizeText(p.name.split(' ')[0]));
  const shortName = (name: string) => {
    const words = name.split(' ').filter(Boolean);
    const clash = firstNames.filter((n) => n === normalizeText(words[0] ?? '')).length > 1;
    return clash ? words.slice(0, 2).join(' ') : (words[0] ?? name);
  };

  if (!all.length) {
    return (
      <p className="cp-empty">
        Aún no tienes personas. Añádelas desde la sección Personas y aparecerán aquí.
      </p>
    );
  }

  /** «tu mamá», «apellido»: por qué se reconoció. */
  const reason = (id: string) => {
    const w = api.why.get(id);
    return w ? `Reconocida en tu texto (${w})` : 'Reconocida en tu texto';
  };
  const kinWhy = (id: string) => {
    const w = api.why.get(id);
    return w && w !== 'nombre' && w !== 'apodo' ? w : '';
  };

  const hint = suggested.length > 0 && (
    <p className="cp-hint">
      <Sparkles size={13} />
      {api.autoLink
        ? 'Reconocí nombres en tu texto: se vincularán al guardar. Quita con la X los que no apliquen.'
        : 'Reconocí nombres en tu texto. Pulsa para vincularlos.'}
    </p>
  );

  if (variant === 'rail') {
    const shown = needle ? matches : all;
    return (
      <div className="cp-people">
        {all.length > 8 && (
          <label className="cp-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar persona…"
              aria-label="Buscar persona"
            />
          </label>
        )}
        <div className="cp-rail" role="group" aria-label="Personas">
          {shown.map((p) => {
            const on = selected.includes(p.id);
            const maybe = !on && suggested.some((s) => s.id === p.id);
            return (
              <button
                type="button"
                key={p.id}
                aria-pressed={on}
                title={p.name}
                className={'cp-rail-item' + (on ? ' on' : '') + (maybe ? ' maybe' : '')}
                onClick={() => (maybe ? api.accept(p.id) : api.toggle(p.id))}
              >
                <span className="cp-avatar" style={{ background: p.color }}>
                  <Avatar person={p} size={42} />
                  {on && (
                    <i className="cp-avatar-check">
                      <Check size={12} strokeWidth={3} />
                    </i>
                  )}
                  {maybe && (
                    <i className="cp-avatar-check maybe">
                      <Sparkles size={11} />
                    </i>
                  )}
                </span>
                <span className="cp-rail-name">{shortName(p.name)}</span>
              </button>
            );
          })}
          {!shown.length && <span className="cp-empty">Nadie coincide con «{query}».</span>}
        </div>
        <PersonCues api={api} />
        {hint}
      </div>
    );
  }

  const chosen = selected.flatMap((id) => all.find((p) => p.id === id) ?? []);
  const candidates = needle ? matches.filter((p) => !selected.includes(p.id)).slice(0, 6) : [];
  return (
    <div className="cp-people">
      <div className="cp-tokens">
        {chosen.map((p) => (
          <span className="cp-token" key={p.id}>
            <Avatar person={p} size={24} />
            {p.name}
            <button
              type="button"
              aria-label={`Quitar a ${p.name}`}
              onClick={() => api.toggle(p.id)}
            >
              <X size={13} />
            </button>
          </span>
        ))}
        {suggested.map((p) => (
          <span className="cp-token maybe" key={p.id} title={reason(p.id)}>
            <button type="button" className="cp-token-add" onClick={() => api.accept(p.id)}>
              <Avatar person={p} size={22} />
              {p.name}
              {kinWhy(p.id) && <small className="cp-token-why">{kinWhy(p.id)}</small>}
            </button>
            <button
              type="button"
              aria-label={`Descartar a ${p.name}`}
              onClick={() => api.dismiss(p.id)}
            >
              <X size={13} />
            </button>
          </span>
        ))}
        <label className="cp-token-input">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && candidates[0]) {
                e.preventDefault();
                api.toggle(candidates[0].id);
                setQuery('');
              }
            }}
            placeholder={
              chosen.length || suggested.length ? 'Añadir otra…' : 'Buscar y añadir personas…'
            }
            aria-label="Buscar persona"
          />
        </label>
      </div>
      {candidates.length > 0 && (
        <div className="cp-results" role="listbox" aria-label="Resultados">
          {candidates.map((p) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              key={p.id}
              onClick={() => {
                api.toggle(p.id);
                setQuery('');
              }}
            >
              <Avatar person={p} size={24} />
              {p.name}
              <small>{p.role}</small>
            </button>
          ))}
        </div>
      )}
      {needle && !candidates.length && (
        <span className="cp-empty">Nadie coincide con «{query}».</span>
      )}
      <PersonCues api={api} />
      {hint}
    </div>
  );
}
