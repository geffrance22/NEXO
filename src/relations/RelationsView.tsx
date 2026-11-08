import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  GitBranch,
  Link2,
  Pencil,
  Share2,
  Sparkles,
  TreePine,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { GraphCanvas } from '../components/GraphCanvas';
import type { Group } from '../data';
import { groupKinds, tieCategories, tieCategoryList } from '../lib/relations';
import { useDismissed } from './dismissed';
import { SuggestionsDialog, useInferred, useSuggestions } from './Suggestions';
import { Avatar } from '../people/Avatar';
import { FloatCard } from '../pages/ConnectionsPage';
import { familyTree, relationsGraph, type RelationFilter } from '../pages/graphs';
import './relations.css';

function GroupFloat({ group, onClose }: { group: Group; onClose: () => void }) {
  const { workspace, openGroup, go } = useApp();
  const m = groupKinds[group.kind] ?? groupKinds.otro;
  const members = group.member_ids.flatMap((id) => workspace.people.find((p) => p.id === id) ?? []);
  return (
    <aside
      className="gc-float"
      style={{ '--accent': m.color, '--soft': m.soft, '--ink': '#27301f' } as CSSProperties}
    >
      <button type="button" className="gc-float-x" aria-label="Cerrar" onClick={onClose}>
        <X size={15} />
      </button>
      <div className="gc-float-head">
        <span
          className="lf-place-tile"
          style={{ '--c': m.color, '--s': m.soft, width: 44, height: 44 } as CSSProperties}
        >
          <m.icon size={20} />
        </span>
        <div>
          <strong>{group.name}</strong>
          <span>
            {m.label} · {members.length} {members.length === 1 ? 'persona' : 'personas'}
          </span>
        </div>
      </div>
      {group.description && <p className="rl-float-desc">{group.description}</p>}
      <div className="rl-float-members">
        {members.slice(0, 12).map((p) => (
          <button type="button" key={p.id} title={p.name} onClick={() => go('Personas', p)}>
            <Avatar person={p} size={30} />
          </button>
        ))}
      </div>
      <button type="button" className="gc-float-link" onClick={() => openGroup(group)}>
        <Pencil size={13} /> Editar grupo
      </button>
    </aside>
  );
}

const relLegend = () => (
  <div className="gc-legend">
    {tieCategoryList.map((c) => (
      <span key={c}>
        <i style={{ background: tieCategories[c].color }} />
        {tieCategories[c].label}
      </span>
    ))}
    <span>
      <i className="rl-legend-dash" /> Deducido
    </span>
  </div>
);

/** Red de vínculos entre personas (con grupos) o el árbol familiar. */
export function RelationsView({ mode }: { mode: 'relaciones' | 'arbol' }) {
  const { workspace, openTie, openGroup } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<RelationFilter>(() => {
    try {
      return {
        ties: true,
        groups: true,
        inferred: true,
        ...JSON.parse(localStorage.getItem('nexo-rel-filter') ?? '{}'),
      };
    } catch {
      return { ties: true, groups: true, inferred: true };
    }
  });
  const toggle = (k: keyof RelationFilter) => {
    const next = { ...filter, [k]: !filter[k] };
    setFilter(next);
    setSelected(null);
    localStorage.setItem('nexo-rel-filter', JSON.stringify(next));
  };

  const skip = useDismissed();
  const [reviewing, setReviewing] = useState(false);
  const suggestions = useSuggestions();
  const graph = useMemo(
    () =>
      mode === 'arbol'
        ? { ...familyTree(workspace.people, workspace.ties, skip) }
        : {
            ...relationsGraph(workspace.people, workspace.ties, workspace.groups, filter, skip),
            bands: [],
          },
    [mode, workspace.people, workspace.ties, workspace.groups, filter, skip],
  );
  const inferredCount = useInferred().length;
  const person = workspace.people.find((p) => p.id === selected) ?? null;
  const group = selected?.startsWith('g:')
    ? workspace.groups.find((g) => 'g:' + g.id === selected)
    : undefined;
  const first = workspace.people[0];

  return (
    <>
      <div className="cx-sub">
        <p className="cx-hint">
          {mode === 'arbol'
            ? 'Tu familia por generaciones. Los parentescos que se deducen se dibujan punteados.'
            : 'Quién es qué de quién, y los grupos que los reúnen. Pasa el cursor para ver cada vínculo.'}
        </p>
        <div className="cx-toggles" role="group" aria-label="Mostrar">
          {mode === 'relaciones' && (
            <>
              <button
                type="button"
                aria-pressed={filter.ties}
                className={filter.ties ? 'on' : ''}
                onClick={() => toggle('ties')}
              >
                <Link2 size={14} /> Vínculos
              </button>
              <button
                type="button"
                aria-pressed={filter.groups}
                className={filter.groups ? 'on' : ''}
                onClick={() => toggle('groups')}
              >
                <Users size={14} /> Grupos
              </button>
              <button
                type="button"
                aria-pressed={filter.inferred}
                className={filter.inferred ? 'on' : ''}
                onClick={() => toggle('inferred')}
              >
                <Sparkles size={14} /> Deducidos {inferredCount > 0 && <i>{inferredCount}</i>}
              </button>
            </>
          )}
          <button type="button" className="rl-tool" onClick={() => openGroup()}>
            <Users size={14} /> Nuevo grupo
          </button>
          {first && (
            <button type="button" className="rl-tool" onClick={() => openTie(person)}>
              <Link2 size={14} /> {person ? `Vincular a ${person.name.split(' ')[0]}` : 'Vincular'}
            </button>
          )}
          {suggestions.length > 0 && (
            <button type="button" className="rl-tool sug" onClick={() => setReviewing(true)}>
              <Sparkles size={14} /> Por confirmar <i>{suggestions.length}</i>
            </button>
          )}
        </div>
      </div>
      {reviewing && <SuggestionsDialog onClose={() => setReviewing(false)} />}

      {graph.nodes.length ? (
        <>
          <GraphCanvas
            key={mode + JSON.stringify(filter)}
            nodes={graph.nodes}
            edges={graph.edges}
            bands={graph.bands}
            selected={selected}
            onSelect={setSelected}
            height={620}
            overlay={
              person ? (
                <FloatCard
                  person={person}
                  entries={workspace.entries}
                  onClose={() => setSelected(null)}
                />
              ) : group ? (
                <GroupFloat group={group} onClose={() => setSelected(null)} />
              ) : null
            }
          />
          <div className="cx-foot">
            {relLegend()}
            <span>
              <Users size={13} />{' '}
              {graph.nodes.filter((n) => !n.center && !n.id.startsWith('g:')).length} personas
              {mode === 'relaciones' && filter.groups && ` · ${workspace.groups.length} grupos`}
            </span>
          </div>
        </>
      ) : (
        <div className="wr-empty">
          {mode === 'arbol' ? <TreePine size={28} /> : <Share2 size={28} />}
          <h3>
            {mode === 'arbol'
              ? 'Tu árbol aún no tiene ramas.'
              : 'Aún no hay vínculos entre personas.'}
          </h3>
          <p>
            {mode === 'arbol'
              ? 'Vincula padres, hijos, hermanos o parejas desde la ficha de cada persona (pestaña Vínculos).'
              : 'Desde la ficha de una persona, en «Vínculos», di quién es qué de quién o crea un grupo en común.'}
          </p>
          {first && (
            <button type="button" className="pp-btn dark" onClick={() => openTie(null)}>
              {mode === 'arbol' ? <GitBranch size={15} /> : <Link2 size={15} />} Crear el primer
              vínculo <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
