import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, LoaderCircle, Search, Trash2, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Group, GroupKind } from '../data';
import { normalizeText } from '../lib/format';
import { relationMeta, relationOf, searchText } from '../lib/people';
import { groupKindList, groupKinds } from '../lib/relations';
import { Avatar } from '../people/Avatar';

/** Crear o editar un grupo: la iglesia, un trabajo, la familia Gómez… y quiénes están. */
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
  const [name, setName] = useState(group?.name ?? '');
  const [kind, setKind] = useState<GroupKind>(group?.kind ?? 'amigos');
  const [description, setDescription] = useState(group?.description ?? '');
  const [members, setMembers] = useState<string[]>(group?.member_ids ?? preset);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
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

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const input = { name: name.trim(), kind, description: description.trim(), member_ids: members };
    const ok = group ? await updateGroup(group, input) : await saveGroup(input);
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
        aria-label={group ? 'Editar grupo' : 'Nuevo grupo'}
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
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="cp-chips rl-gkinds">
          {groupKindList.map((k) => {
            const m = groupKinds[k];
            return (
              <button
                type="button"
                key={k}
                className={'cp-chip' + (kind === k ? ' on' : '')}
                onClick={() => setKind(k)}
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
            {group ? 'Guardar' : 'Crear grupo'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
