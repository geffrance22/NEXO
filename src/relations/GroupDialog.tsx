import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Group, GroupKind } from '../data';
import { normalizeText } from '../lib/format';
import { relationMeta, relationOf, searchText } from '../lib/people';
import { groupKindList, groupKinds, guessGroupKind } from '../lib/relations';
import { Avatar } from '../people/Avatar';
import { groupVars } from './GroupPicker';
import './groups.css';

/** Cuántos grupos existentes se sugieren mientras escribes el nombre. */
const MAX_SUGGESTIONS = 4;

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
 * Crear o editar un grupo: la iglesia, un trabajo, la familia Gómez… y quiénes están. Al crear,
 * mientras escribes el nombre sugiere los grupos que ya existen: elegir uno suma a estas personas
 * a ese grupo en vez de crear otro igual.
 */
export function GroupDialog({
  group,
  members: preset = [],
  onClose,
}: {
  group?: Group;
  members?: string[];
  onClose: () => void;
}) {
  const { workspace, saveGroup, updateGroup, removeGroup } = useApp();
  // Grupo existente que se está editando (el recibido, o uno elegido de las sugerencias).
  const [target, setTarget] = useState<Group | undefined>(group);
  const [name, setName] = useState(group?.name ?? '');
  const [kind, setKind] = useState<GroupKind>(group?.kind ?? 'amigos');
  // Mientras no elijas el tipo, se deduce del nombre («Familia Gómez» → Familia).
  const [kindTouched, setKindTouched] = useState(Boolean(group));
  const [description, setDescription] = useState(group?.description ?? '');
  const [members, setMembers] = useState<string[]>(group?.member_ids ?? preset);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [hl, setHl] = useState(-1);
  const nameInput = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    nameInput.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const meta = groupKinds[kind];
  const nameNeedle = normalizeText(name.trim());
  // Sugerencias solo al crear (o tras volver a «Crear uno nuevo»).
  const suggestions =
    !target && nameNeedle
      ? workspace.groups
          .filter((g) => normalizeText(g.name).includes(nameNeedle))
          .sort(
            (a, b) =>
              Number(normalizeText(b.name) === nameNeedle) -
                Number(normalizeText(a.name) === nameNeedle) ||
              Number(normalizeText(b.name).startsWith(nameNeedle)) -
                Number(normalizeText(a.name).startsWith(nameNeedle)) ||
              a.name.localeCompare(b.name, 'es'),
          )
          .slice(0, MAX_SUGGESTIONS)
      : [];
  const exact = suggestions.find((g) => normalizeText(g.name.trim()) === nameNeedle);
  const latest = (g: Group) => workspace.groups.find((x) => x.id === g.id) ?? g;
  // Personas que se suman al grupo elegido (las que ya estaban no cuentan).
  const added = target && !group ? members.filter((id) => !target.member_ids.includes(id)) : [];

  const needle = normalizeText(query.trim());
  const list = workspace.people
    .filter((p) => !needle || searchText(p).includes(needle))
    .sort(
      (a, b) =>
        Number(members.includes(b.id)) - Number(members.includes(a.id)) ||
        a.name.localeCompare(b.name, 'es'),
    );
  const toggle = (id: string) =>
    setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const typeName = (value: string) => {
    setName(value);
    setHl(-1);
    if (!kindTouched) {
      const guess = guessGroupKind(value);
      if (guess !== 'otro') setKind(guess);
    }
  };

  /** Usar un grupo que ya existe: estas personas se suman a él. */
  const pick = (g: Group) => {
    const current = latest(g);
    setTarget(current);
    setName(current.name);
    setKind(current.kind);
    setKindTouched(true);
    setDescription(current.description);
    setMembers((m) => [...new Set([...current.member_ids, ...m])]);
    setHl(-1);
  };
  /** Volver a crear uno nuevo (se descarta el grupo elegido). */
  const startOver = () => {
    setTarget(undefined);
    setName('');
    setKind('amigos');
    setKindTouched(false);
    setDescription('');
    setMembers(preset);
    requestAnimationFrame(() => nameInput.current?.focus());
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const input = { name: name.trim(), kind, description: description.trim(), member_ids: members };
    // Si escribiste el nombre exacto de uno que ya existe, se usa ese (sin duplicarlo).
    const existing = target ?? exact;
    const ok = target
      ? // Editado o elegido de las sugerencias: lo que ves manda.
        await updateGroup(latest(target), input)
      : existing
        ? // Mismo nombre que uno que ya existe: solo se suman las personas, sin tocar lo demás.
          await updateGroup(latest(existing), {
            member_ids: [...new Set([...latest(existing).member_ids, ...members])],
          })
        : await saveGroup(input);
    setBusy(false);
    if (ok) onClose();
  };

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className="pk rl-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={target ? 'Editar grupo' : 'Nuevo grupo'}
        style={{ '--accent': meta.color, '--soft': meta.soft } as CSSProperties}
      >
        <header className="pk-head">
          <span
            className="pk-tile"
            style={{ '--c': meta.color, '--s': meta.soft } as CSSProperties}
          >
            <meta.icon size={18} />
          </span>
          <input
            ref={nameInput}
            className="rl-name"
            value={name}
            maxLength={80}
            placeholder="Nombre del grupo: Iglesia, Equipo de Rappi…"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="gd-suggest"
            aria-autocomplete="list"
            onChange={(e) => typeName(e.target.value)}
            onKeyDown={(e) => {
              if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                // De -1 (el campo) a la última sugerencia, en círculo.
                const n = suggestions.length + 1;
                setHl((i) => ((i + 1 + step + n) % n) - 1);
                return;
              }
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (hl >= 0 && suggestions[hl]) pick(suggestions[hl]);
              else void save();
            }}
          />
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {suggestions.length > 0 && (
          <div className="gd-suggest" id="gd-suggest" role="listbox" aria-label="Grupos existentes">
            <span className="gd-suggest-label">Ya existen</span>
            {suggestions.map((g, i) => {
              const m = groupKinds[g.kind] ?? groupKinds.otro;
              const n = g.member_ids.length;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={hl === i}
                  key={g.id}
                  className={'gd-option' + (hl === i ? ' hl' : '')}
                  style={groupVars(g.kind)}
                  onMouseEnter={() => setHl(i)}
                  onClick={() => pick(g)}
                >
                  <span className="pk-tile">
                    <m.icon size={15} />
                  </span>
                  <span className="gd-option-text">
                    <strong>
                      <Marked text={g.name} needle={nameNeedle} />
                    </strong>
                    <small>
                      {m.label} · {n} {n === 1 ? 'persona' : 'personas'}
                    </small>
                  </span>
                  <em>
                    {preset.length ? 'Añadir aquí' : 'Abrir'} <ArrowRight size={12} />
                  </em>
                </button>
              );
            })}
            {!exact && (
              <span className="gd-new">
                <Plus size={13} /> O sigue escribiendo para crear «{name.trim()}»
              </span>
            )}
          </div>
        )}

        {target && !group && (
          <div className="gd-target" style={groupVars(target.kind)}>
            <Check size={14} />
            <span>
              Grupo existente
              {added.length > 0 &&
                ` · se suma${added.length === 1 ? '' : 'n'} ${added.length} ${added.length === 1 ? 'persona' : 'personas'}`}
            </span>
            <button type="button" className="pp-text-btn" onClick={startOver}>
              Crear uno nuevo
            </button>
          </div>
        )}

        <div className="cp-chips rl-gkinds">
          {groupKindList.map((k) => {
            const m = groupKinds[k];
            return (
              <button
                type="button"
                key={k}
                className={'cp-chip' + (kind === k ? ' on' : '')}
                onClick={() => {
                  setKind(k);
                  setKindTouched(true);
                }}
              >
                <m.icon size={13} /> {m.label}
              </button>
            );
          })}
        </div>
        <input
          className="cp-ghost-input rl-desc"
          maxLength={500}
          placeholder="Qué los une (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="pk-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar personas para el grupo…"
          />
        </label>
        <div className="pk-list">
          {list.map((p) => {
            const on = members.includes(p.id);
            return (
              <button
                type="button"
                key={p.id}
                className={'pk-row' + (on ? ' on' : '')}
                onClick={() => toggle(p.id)}
              >
                <Avatar person={p} size={34} />
                <span>
                  <strong>{p.name}</strong>
                  <small>{relationMeta[relationOf(p)].label}</small>
                </span>
                <i className={'pk-tick' + (on ? ' on' : '')}>
                  <Check size={13} strokeWidth={3} />
                </i>
              </button>
            );
          })}
        </div>
        <footer className="pk-foot">
          {group ? (
            <button
              type="button"
              className="cp-btn ghost rl-danger"
              onClick={() => {
                onClose();
                removeGroup(group);
              }}
            >
              <Trash2 size={15} /> Eliminar
            </button>
          ) : (
            <span className="rl-hint">
              {members.length} {members.length === 1 ? 'persona' : 'personas'}
            </span>
          )}
          <button
            type="button"
            className="cp-btn cta"
            disabled={!name.trim() || busy}
            onClick={() => void save()}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{' '}
            {group ? 'Guardar' : target || exact ? 'Añadir al grupo' : 'Crear grupo'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
