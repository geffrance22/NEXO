import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { normalizeText, todayInputValue } from '../lib/format';
import { relativeDay } from '../lib/people';
import { Avatar } from '../people/Avatar';
import { GroupActions, lastTogether } from './GroupActions';
import { groupMeta, groupVars } from './GroupPicker';
import './groups.css';

/** Gestionar grupos: verlos todos, crear, editar y eliminar. */
export function GroupManager({ onClose }: { onClose: () => void }) {
  const { workspace, openGroup, removeGroup } = useApp();
  const [query, setQuery] = useState('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Con un grupo abierto encima (o la confirmación de borrar), Esc es para ellos.
      if (document.querySelector('.rl-dialog, .confirm[role="alertdialog"], .gmsg')) return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const byId = useMemo(() => new Map(workspace.people.map((p) => [p.id, p])), [workspace.people]);
  const needle = normalizeText(query.trim());
  const groups = [...workspace.groups]
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .filter(
      (g) =>
        !needle ||
        normalizeText(`${g.name} ${g.description} ${groupMeta(g.kind).label}`).includes(needle),
    );
  const grouped = new Set(workspace.groups.flatMap((g) => g.member_ids)).size;
  const total = workspace.groups.length;

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="pk gm" role="dialog" aria-modal="true" aria-label="Gestionar grupos">
        <header className="pk-head gp-head">
          <div>
            <h3>Grupos</h3>
            <small>
              {total
                ? `${total} ${total === 1 ? 'grupo' : 'grupos'} · ${grouped} ${grouped === 1 ? 'persona agrupada' : 'personas agrupadas'}`
                : 'La familia, el trabajo, la iglesia, el equipo…'}
            </small>
          </div>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {total > 5 && (
          <label className="pk-search">
            <Search size={16} />
            <input
              autoFocus
              value={query}
              placeholder="Buscar un grupo…"
              aria-label="Buscar grupos"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}

        {total ? (
          <div className="gm-list">
            {groups.map((g) => {
              const m = groupMeta(g.kind);
              const members = g.member_ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
              const last = lastTogether(g, workspace.people, workspace.entries);
              return (
                <div className="gm-row" key={g.id} style={groupVars(g.kind)}>
                  <button
                    type="button"
                    className="gm-main"
                    title="Editar el grupo"
                    onClick={() => openGroup(g)}
                  >
                    <span className="pk-tile">
                      <m.icon size={17} />
                    </span>
                    <span className="gm-text">
                      <strong>{g.name}</strong>
                      <small>
                        {m.label} · {members.length} {members.length === 1 ? 'persona' : 'personas'}
                        {last
                          ? ` · juntos ${relativeDay(todayInputValue(new Date(last.created_at))).toLowerCase()}`
                          : g.description
                            ? ` · ${g.description}`
                            : ''}
                      </small>
                    </span>
                    {members.length > 0 && (
                      <span className="gm-faces" aria-hidden="true">
                        {members.slice(0, 4).map((p) => (
                          <Avatar key={p.id} person={p} size={24} />
                        ))}
                        {members.length > 4 && <i>+{members.length - 4}</i>}
                      </span>
                    )}
                  </button>
                  {members.length > 0 && <GroupActions group={g} compact onLeave={onClose} />}
                  <button
                    type="button"
                    className="gm-act"
                    title="Editar"
                    aria-label={`Editar el grupo ${g.name}`}
                    onClick={() => openGroup(g)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    className="gm-act danger"
                    title="Eliminar"
                    aria-label={`Eliminar el grupo ${g.name}`}
                    onClick={() => removeGroup(g)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
            {!groups.length && (
              <p className="pp-empty pk-empty">Ningún grupo coincide con «{query.trim()}».</p>
            )}
          </div>
        ) : (
          <div className="gm-empty">
            <span className="gm-empty-icon">
              <Layers size={22} />
            </span>
            <strong>Aún no tienes grupos</strong>
            <p>Agrupa a tu gente para encontrarla rápido: la familia, el trabajo, la iglesia…</p>
          </div>
        )}

        <footer className="pk-foot">
          <span className="gm-hint">Toca un grupo para editarlo</span>
          <button type="button" className="cp-btn cta" onClick={() => openGroup()}>
            <Plus size={16} /> Nuevo grupo
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
