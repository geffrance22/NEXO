import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BellPlus,
  Feather,
  GitCompareArrows,
  Link2,
  MapPin,
  Network,
  Orbit,
  Share2,
  Sparkles,
  StickyNote,
  TreePine,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry, Person, Place } from '../data';
import { GraphCanvas } from '../components/GraphCanvas';
import { placeKinds, placeStats } from '../lib/places';
import { egoGraph, networkGraph, type GraphFilter } from './graphs';
import {
  inYear,
  relationMeta,
  relationOf,
  relations,
  relativeDay,
  statsFor,
  yearsWithData,
} from '../lib/people';
import { Avatar } from '../people/Avatar';
import { BondRing } from '../people/PersonPanel';
import { RelationsView } from '../relations/RelationsView';
import { CompareView } from '../people/CompareView';
import { YearInReview } from '../people/YearInReview';
import '../people/people.css';

export type ConnectionsTab =
  'social' | 'conexiones' | 'relaciones' | 'arbol' | 'comparar' | 'wrapped';
type Tab = ConnectionsTab;
type Year = number | 'todo';

/** Ficha flotante: no tapa el lienzo, se puede seguir navegando mientras está abierta. */
export function FloatCard({
  person,
  entries,
  onClose,
}: {
  person: Person;
  entries: Entry[];
  onClose: () => void;
}) {
  const { go, openEntry, openTie, quickPerson, workspace } = useApp();
  const stats = useMemo(() => statsFor(person, workspace.entries), [person, workspace.entries]);
  const meta = relationMeta[relationOf(person)];
  const inRange = entries.filter(
    (e) => e.person_ids.includes(person.id) && e.kind !== 'Pendiente' && e.kind !== 'Movimiento',
  );
  const companions = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of inRange)
      for (const id of e.person_ids) if (id !== person.id) m.set(id, (m.get(id) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .flatMap(([id]) => workspace.people.find((p) => p.id === id) ?? []);
  }, [inRange, person.id, workspace.people]);

  return (
    <aside
      className="gc-float"
      style={{ '--accent': meta.color, '--soft': meta.soft, '--ink': meta.ink } as CSSProperties}
    >
      <button type="button" className="gc-float-x" aria-label="Cerrar" onClick={onClose}>
        <X size={15} />
      </button>
      <div className="gc-float-head">
        <Avatar person={person} size={54} />
        <div>
          <strong>{person.name}</strong>
          <span>
            {meta.label}
            {person.role ? ` · ${person.role}` : ''}
          </span>
        </div>
      </div>
      <div className="gc-float-stats">
        <BondRing value={stats.bond} size={38} />
        <div>
          <b>{inRange.length}</b>
          <span>en este periodo</span>
        </div>
        <div>
          <b>{relativeDay(stats.last)}</b>
          <span>última vez</span>
        </div>
      </div>
      {stats.reciprocity.state !== 'sin-datos' && (
        <p className={'gc-float-recip ' + stats.reciprocity.state}>{stats.reciprocity.label}</p>
      )}
      {companions.length > 0 && (
        <div className="gc-float-with">
          <span>Aparece con</span>
          <div>
            {companions.map((p) => (
              <span key={p.id} title={p.name}>
                <Avatar person={p} size={26} />
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="gc-float-actions">
        <button
          type="button"
          title="Añadir recuerdo"
          onClick={() => openEntry(undefined, [person.id])}
        >
          <Feather size={15} />
        </button>
        <button type="button" title="Nota rápida" onClick={() => quickPerson(person, 'nota')}>
          <StickyNote size={15} />
        </button>
        <button
          type="button"
          title="Recordarme"
          onClick={() => openEntry('Pendiente', [person.id])}
        >
          <BellPlus size={15} />
        </button>
        <button type="button" title="Algo que le di" onClick={() => quickPerson(person, 'dar')}>
          <ArrowUpRight size={15} />
        </button>
        <button type="button" title="Vincular con alguien" onClick={() => openTie(person)}>
          <Link2 size={15} />
        </button>
        <button
          type="button"
          title="Algo que me dio"
          onClick={() => quickPerson(person, 'recibir')}
        >
          <ArrowDownLeft size={15} />
        </button>
      </div>
      <button type="button" className="gc-float-link" onClick={() => go('Personas', person)}>
        Ver ficha completa <ArrowRight size={13} />
      </button>
    </aside>
  );
}

/** Ficha flotante de un lugar dentro del mapa. */
function PlaceFloat({
  place,
  entries,
  onClose,
}: {
  place: Place;
  entries: Entry[];
  onClose: () => void;
}) {
  const { go, openEntry, workspace } = useApp();
  const s = useMemo(
    () => placeStats(place, entries, workspace.people),
    [place, entries, workspace.people],
  );
  const all = useMemo(
    () => placeStats(place, workspace.entries, workspace.people),
    [place, workspace],
  );
  const meta = placeKinds[place.kind] ?? placeKinds.otro;
  const Icon = meta.icon;
  const cover = all.photos[0];
  return (
    <aside
      className="gc-float"
      style={{ '--accent': meta.color, '--soft': meta.soft, '--ink': '#27301f' } as CSSProperties}
    >
      <button type="button" className="gc-float-x" aria-label="Cerrar" onClick={onClose}>
        <X size={15} />
      </button>
      {cover && <img className="pl-float-cover" src={cover.medium ?? cover.url} alt="" />}
      <div className="gc-float-head">
        <span
          className="lf-place-tile"
          style={{ '--c': meta.color, '--s': meta.soft, width: 44, height: 44 } as CSSProperties}
        >
          <Icon size={20} />
        </span>
        <div>
          <strong>{place.name}</strong>
          <span>
            {meta.label}
            {place.city ? ` · ${place.city}` : ''}
          </span>
        </div>
      </div>
      <div className="gc-float-stats two">
        <div>
          <b>{s.visits.length}</b>
          <span>en este periodo</span>
        </div>
        <div>
          <b>{relativeDay(all.last)}</b>
          <span>última vez</span>
        </div>
      </div>
      {s.people.length > 0 && (
        <div className="gc-float-with">
          <span>Has estado aquí con</span>
          <div>
            {s.people.slice(0, 6).map(({ person }) => (
              <span key={person.id} title={person.name}>
                <Avatar person={person} size={26} />
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="gc-float-actions">
        <button
          type="button"
          title="Registrar un encuentro aquí"
          onClick={() => openEntry('Encuentro', [], { placeId: place.id, place: place.name })}
        >
          <Feather size={15} /> <span>Registrar encuentro aquí</span>
        </button>
      </div>
      <button type="button" className="gc-float-link" onClick={() => go('Lugares', place)}>
        Ver lugar completo <ArrowRight size={13} />
      </button>
    </aside>
  );
}

function Legend() {
  return (
    <div className="gc-legend">
      {relations.map((r) => (
        <span key={r}>
          <i style={{ background: relationMeta[r].color }} />
          {relationMeta[r].label}
        </span>
      ))}
    </div>
  );
}

export function ConnectionsPage({ initialTab = 'social' }: { initialTab?: Tab }) {
  const { workspace } = useApp();
  const [tab, setTab] = useState<Tab>(initialTab);
  const years = useMemo(() => yearsWithData(workspace.entries), [workspace.entries]);
  const [year, setYear] = useState<Year>('todo');
  const [selected, setSelected] = useState<string | null>(null);
  const scoped = useMemo(() => inYear(workspace.entries, year), [workspace.entries, year]);
  // Qué se muestra en el mapa (se recuerda entre visitas).
  const [filter, setFilter] = useState<GraphFilter>(() => {
    try {
      return {
        people: true,
        places: true,
        ...JSON.parse(localStorage.getItem('nexo-graph-filter') ?? '{}'),
      };
    } catch {
      return { people: true, places: true };
    }
  });
  const setShown = (key: keyof GraphFilter) => {
    const next = { ...filter, [key]: !filter[key] };
    setFilter(next);
    setSelected(null);
    localStorage.setItem('nexo-graph-filter', JSON.stringify(next));
  };
  const ego = useMemo(
    () => egoGraph(workspace.people, workspace.places, scoped, filter),
    [workspace.people, workspace.places, scoped, filter],
  );
  const net = useMemo(
    () => networkGraph(workspace.people, workspace.places, scoped, filter),
    [workspace.people, workspace.places, scoped, filter],
  );
  const graph = tab === 'social' ? ego : net;
  const person = workspace.people.find((p) => p.id === selected) ?? null;
  const place = workspace.places.find((p) => p.id === selected) ?? null;
  const peopleShown = graph.nodes.filter((n) => !n.center && n.shape !== 'place').length;
  const placesShown = graph.nodes.filter((n) => n.shape === 'place').length;
  // Relaciones y árbol no dependen del año: muestran la estructura completa.
  const structural = tab === 'relaciones' || tab === 'arbol';

  const tabs: { id: Tab; label: string; icon: typeof Orbit; hint: string }[] = [
    {
      id: 'social',
      label: 'Grafo social',
      icon: Orbit,
      hint: 'Todas las personas con las que has interactuado, por cercanía',
    },
    {
      id: 'conexiones',
      label: 'Conexiones',
      icon: Network,
      hint: 'Solo quienes aparecen juntos en un mismo recuerdo',
    },
    { id: 'relaciones', label: 'Relaciones', icon: Share2, hint: '' },
    { id: 'arbol', label: 'Árbol familiar', icon: TreePine, hint: '' },
    { id: 'comparar', label: 'Comparar', icon: GitCompareArrows, hint: '' },
    { id: 'wrapped', label: 'Tu año', icon: Sparkles, hint: '' },
  ];

  return (
    // Con mapa, el panel ocupa el alto disponible y la página no se desplaza; «Tu año» y
    // «Comparar» sí son largas.
    <div className={'cx' + (tab === 'wrapped' || tab === 'comparar' ? '' : ' fit')}>
      <div className="cx-top">
        <nav className="cx-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              key={t.id}
              className={tab === t.id ? 'on' : ''}
              onClick={() => {
                setTab(t.id);
                setSelected(null);
              }}
            >
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </nav>
        <div
          className={'cx-years' + (structural ? ' hidden' : '')}
          role="radiogroup"
          aria-label="Periodo"
        >
          {(['todo', ...years] as Year[]).map((y) => (
            <button
              type="button"
              role="radio"
              aria-checked={year === y}
              key={y}
              className={year === y ? 'on' : ''}
              onClick={() => {
                setYear(y);
                setSelected(null);
              }}
            >
              {y === 'todo' ? 'Todo el tiempo' : y}
            </button>
          ))}
        </div>
      </div>
      {structural ? (
        <RelationsView mode={tab as 'relaciones' | 'arbol'} />
      ) : tab === 'comparar' ? (
        <CompareView entries={scoped} />
      ) : tab === 'wrapped' ? (
        <div className="cx-year">
          <YearInReview year={year} />
        </div>
      ) : (
        <>
          <div className="cx-sub">
            <p className="cx-hint">{tabs.find((t) => t.id === tab)!.hint}</p>
            <div className="cx-toggles" role="group" aria-label="Mostrar en el mapa">
              <button
                type="button"
                aria-pressed={filter.people}
                className={filter.people ? 'on' : ''}
                onClick={() => setShown('people')}
              >
                <Users size={14} /> Personas
              </button>
              <button
                type="button"
                aria-pressed={filter.places}
                className={filter.places ? 'on' : ''}
                onClick={() => setShown('places')}
              >
                <MapPin size={14} /> Lugares
              </button>
            </div>
          </div>

          {peopleShown + placesShown > 0 ? (
            <>
              <GraphCanvas
                key={tab + String(year) + filter.people + filter.places}
                nodes={graph.nodes}
                edges={graph.edges}
                rings={tab === 'social' ? ego.rings : []}
                selected={selected}
                onSelect={setSelected}
                height={600}
                overlay={
                  person ? (
                    <FloatCard person={person} entries={scoped} onClose={() => setSelected(null)} />
                  ) : place ? (
                    <PlaceFloat place={place} entries={scoped} onClose={() => setSelected(null)} />
                  ) : null
                }
              />
              <div className="cx-foot">
                <Legend />
                <span>
                  {filter.people && (
                    <>
                      <Users size={13} /> {peopleShown} personas
                    </>
                  )}
                  {filter.places && (
                    <>
                      <MapPin size={13} /> {placesShown} lugares
                    </>
                  )}
                  {tab === 'social' &&
                    ego.hidden > 0 &&
                    ` · ${ego.hidden} sin interacciones en este periodo`}
                </span>
              </div>
            </>
          ) : (
            <div className="wr-empty">
              {tab === 'social' ? <Orbit size={28} /> : <Network size={28} />}
              <h3>
                {!filter.people && !filter.places
                  ? 'Activa personas o lugares para ver el mapa.'
                  : tab === 'social'
                    ? 'Aún no hay interacciones en este periodo.'
                    : 'Nada aparece conectado todavía.'}
              </h3>
              <p>Vincula personas y lugares a tus recuerdos y el mapa se irá dibujando solo.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
