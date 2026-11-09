import { useMemo, useState, type CSSProperties } from 'react';
import { Check, CheckCheck, Link2, Plus, Sparkles, UserRound, Users, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Person } from '../data';
import {
  ME,
  explain,
  groupKinds,
  groupsOf,
  guessGroupKind,
  kindWithNature,
  kindWord,
  tieCategories,
  tieCategoryList,
  tieKey,
  tieKinds,
  tiesOf,
  type TieView,
} from '../lib/relations';
import { genderOf } from '../lib/gender';
import { Avatar } from '../people/Avatar';
import { dismiss, undismiss } from './dismissed';
import { GroupPicker } from './GroupPicker';
import { SuggestionList, useInferred, useSuggestions } from './Suggestions';

/**
 * Los grupos de una persona en una ventana: arriba en los que ya está; debajo los sugeridos (los
 * de su gente) y los demás. Buscas, te sugiere los que existen y, si no está, lo creas ahí mismo.
 * Cada cambio se guarda al instante.
 */
export function PersonGroupsDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const { workspace, updateGroup, saveGroup, openGroup, notify } = useApp();
  const first = person.name.split(' ')[0];
  const mine = workspace.groups.filter((g) => g.member_ids.includes(person.id)).map((g) => g.id);
  // Fijos arriba: en los que estaba al abrir y los que crees aquí (no saltan al marcar).
  const [pinned, setPinned] = useState(mine);
  const near = new Set(tiesOf(person.id, workspace.ties).map((v) => v.other));
  const suggested = workspace.groups
    .filter((g) => !mine.includes(g.id) && g.member_ids.some((m) => near.has(m)))
    .map((g) => g.id);

  const toggle = (id: string) => {
    const g = workspace.groups.find((x) => x.id === id);
    if (!g) return;
    const on = g.member_ids.includes(person.id);
    void updateGroup(
      g,
      {
        member_ids: on ? g.member_ids.filter((x) => x !== person.id) : [...g.member_ids, person.id],
      },
      true,
    );
  };
  const create = async (name: string) => {
    const g = await saveGroup(
      { name, kind: guessGroupKind(name), description: '', member_ids: [person.id] },
      true,
    );
    if (!g) return;
    setPinned((p) => [...p, g.id]);
    notify(`Grupo «${g.name}» creado con ${first}.`);
  };

  return (
    <GroupPicker
      title={`Grupos de ${first}`}
      hint={
        mine.length
          ? `Está en ${mine.length} ${mine.length === 1 ? 'grupo' : 'grupos'}`
          : 'Aún no está en ningún grupo'
      }
      selected={mine}
      pinned={pinned}
      pinnedLabel="Está en"
      suggested={suggested}
      onToggle={toggle}
      onCreate={(name) => void create(name)}
      footer={
        <button
          type="button"
          className="gp-foot-link"
          onClick={() => {
            onClose();
            openGroup(undefined, [person.id]);
          }}
        >
          <Plus size={15} /> Nuevo grupo con detalles
        </button>
      }
      onClose={onClose}
    />
  );
}

/** Botón «Grupos» de la ficha: abre la ventana de sus grupos. */
function GroupAdder({ person }: { person: Person }) {
  const [open, setOpen] = useState(false);
  const count = useApp().workspace.groups.filter((g) => g.member_ids.includes(person.id)).length;
  return (
    <>
      <button type="button" className="pp-btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Users size={15} /> {count ? 'Sus grupos' : 'Añadir a grupo'}
      </button>
      {open && <PersonGroupsDialog person={person} onClose={() => setOpen(false)} />}
    </>
  );
}

function TieRow({ view, person }: { view: TieView; person: Person }) {
  const { workspace, go, removeTie, saveTie, notify } = useApp();
  const other = view.other === ME ? null : workspace.people.find((p) => p.id === view.other);
  if (view.other !== ME && !other) return null;
  const cat = tieCategories[tieKinds[view.kind].category];
  const inferred = Boolean(view.tie.inferred);
  const first = person.name.split(' ')[0];
  const nameOf = (id: string) =>
    id === person.id
      ? first
      : (workspace.people.find((p) => p.id === id)?.name.split(' ')[0] ?? '?');
  const detail = inferred ? explain(view.tie, nameOf) : view.tie.note;
  return (
    <div
      className={'rl-row' + (inferred ? ' inferred' : '')}
      style={{ '--c': cat.color, '--s': cat.soft } as CSSProperties}
    >
      <button
        type="button"
        className="rl-row-main"
        disabled={!other}
        onClick={() => other && go('Personas', other)}
      >
        {other ? <Avatar person={other} size={34} /> : <span className="rl-me">Tú</span>}
        <span>
          <strong>{other ? other.name : 'Tú'}</strong>
          <small>
            {other
              ? `${kindWithNature(view.kind, view.tie.nature, genderOf(other))} de ${first}`
              : `${first} es tu ${kindWithNature(tieKinds[view.kind].inverse, view.tie.nature, genderOf(person))}`}
            {detail ? ` · ${detail}` : ''}
          </small>
        </span>
      </button>
      {inferred ? (
        <span className="rl-row-tools">
          <button
            type="button"
            className="rl-confirm"
            title="Guardar este vínculo"
            onClick={() =>
              void saveTie({ a: view.tie.a, b: view.tie.b, kind: view.tie.kind }, true)
            }
          >
            <Check size={13} /> Confirmar
          </button>
          <button
            type="button"
            className="rl-x show"
            aria-label="No es así"
            title="No es así"
            onClick={() => {
              const k = tieKey(view.tie.a, view.tie.b, view.tie.kind);
              dismiss(k);
              notify('No se volverá a deducir.', { label: 'Deshacer', run: () => undismiss(k) });
            }}
          >
            <X size={14} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="rl-x"
          aria-label="Quitar vínculo"
          title="Quitar vínculo"
          onClick={() => void removeTie(view.tie)}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Resumen corto de vínculos y grupos (en el Resumen de la ficha). */
export function TieChips({ person }: { person: Person }) {
  const { workspace, go } = useApp();
  const views = tiesOf(person.id, workspace.ties);
  const groups = groupsOf(person.id, workspace.groups);
  if (!views.length && !groups.length) return null;
  const first = person.name.split(' ')[0];
  return (
    <div className="rl-chips">
      {views.slice(0, 6).map((v) => {
        const other = v.other === ME ? null : workspace.people.find((p) => p.id === v.other);
        const cat = tieCategories[tieKinds[v.kind].category];
        const g = genderOf(other);
        const label = other
          ? `${other.name.split(' ')[0]} · ${kindWord(v.kind, g)}`
          : `Tu ${kindWord(tieKinds[v.kind].inverse, genderOf(person))}`;
        return (
          <button
            type="button"
            key={v.tie.id}
            style={{ '--c': cat.color, '--s': cat.soft } as CSSProperties}
            title={other ? `${other.name} es ${kindWord(v.kind, g)} de ${first}` : undefined}
            onClick={() => other && go('Personas', other)}
          >
            {label}
          </button>
        );
      })}
      {groups.map((g) => {
        const m = groupKinds[g.kind] ?? groupKinds.otro;
        return (
          <span
            key={g.id}
            className="grp"
            style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
          >
            <m.icon size={12} /> {g.name}
          </span>
        );
      })}
    </div>
  );
}

/** Pestaña «Vínculos»: con quién se relaciona esta persona y en qué grupos está. */
export function TiesTab({ person }: { person: Person }) {
  const { workspace, openTie, openGroup, go, saveTies } = useApp();
  const views = useMemo(() => tiesOf(person.id, workspace.ties), [person.id, workspace.ties]);
  const allInferred = useInferred();
  const inferred = useMemo(() => tiesOf(person.id, allInferred), [person.id, allInferred]);
  const suggestions = useSuggestions(person.id);
  const groups = groupsOf(person.id, workspace.groups);
  const withMe = views.find((v) => v.other === ME);
  const byCat = tieCategoryList
    .map((c) => ({
      c,
      list: views.filter((v) => v.other !== ME && tieKinds[v.kind].category === c),
    }))
    .filter((x) => x.list.length);
  const first = person.name.split(' ')[0];

  return (
    <div className="pp-tab">
      <div className="rl-actions">
        <button type="button" className="pp-btn dark" onClick={() => openTie(person)}>
          <Link2 size={15} /> Vincular con alguien
        </button>
        <GroupAdder person={person} />
      </div>

      {suggestions.length > 0 && (
        <>
          <h4>
            <Sparkles size={15} /> Sugerencias
          </h4>
          <SuggestionList list={suggestions} max={3} />
        </>
      )}

      <h4>
        <UserRound size={15} /> Contigo
      </h4>
      {withMe ? (
        <TieRow view={withMe} person={person} />
      ) : (
        <button type="button" className="pp-text-btn" onClick={() => openTie(null, [person.id])}>
          <Plus size={13} /> ¿Qué es {first} para ti?
        </button>
      )}

      {byCat.map(({ c, list }) => (
        <div key={c}>
          <h4>
            <i className="rl-dot" style={{ background: tieCategories[c].color }} />{' '}
            {tieCategories[c].label}
          </h4>
          {list.map((v) => (
            <TieRow key={v.tie.id} view={v} person={person} />
          ))}
        </div>
      ))}
      {!byCat.length && (
        <p className="pp-empty">Aún no está vinculada con otras personas de tu universo.</p>
      )}

      {inferred.length > 0 && (
        <>
          <h4 className="rl-h-tools">
            <Sparkles size={15} /> Deducidos de otros vínculos
            {inferred.length > 1 && (
              <button
                type="button"
                className="pp-text-btn"
                onClick={() =>
                  void saveTies(inferred.map((v) => ({ a: v.tie.a, b: v.tie.b, kind: v.tie.kind })))
                }
              >
                <CheckCheck size={13} /> Confirmar todos
              </button>
            )}
          </h4>
          {inferred.map((v) => (
            <TieRow key={v.tie.id} view={v} person={person} />
          ))}
        </>
      )}

      <h4>
        <Users size={15} /> Grupos
      </h4>
      {!groups.length && <p className="pp-empty">No está en ningún grupo todavía.</p>}
      <div className="rl-group-cards">
        {groups.map((g) => {
          const m = groupKinds[g.kind] ?? groupKinds.otro;
          const members = g.member_ids.flatMap((id) =>
            id === person.id ? [] : (workspace.people.find((p) => p.id === id) ?? []),
          );
          return (
            <div
              className="rl-group-card"
              key={g.id}
              style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
            >
              <button type="button" className="rl-group-head" onClick={() => openGroup(g)}>
                <span className="pk-tile">
                  <m.icon size={16} />
                </span>
                <span>
                  <strong>{g.name}</strong>
                  <small>
                    {m.label} · {g.member_ids.length}{' '}
                    {g.member_ids.length === 1 ? 'persona' : 'personas'}
                  </small>
                </span>
              </button>
              <div className="rl-faces">
                {members.slice(0, 8).map((p) => (
                  <button type="button" key={p.id} title={p.name} onClick={() => go('Personas', p)}>
                    <Avatar person={p} size={26} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
