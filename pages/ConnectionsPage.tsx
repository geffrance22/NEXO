import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BellPlus,
  CalendarHeart,
  Feather,
  HeartHandshake,
  Link2,
  MapPin,
  Network,
  Orbit,
  PartyPopper,
  Share2,
  Sparkles,
  StickyNote,
  TreePine,
  UserPlus,
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
  wrappedFor,
  yearsWithData,
} from '../lib/people';
import { Avatar } from '../people/Avatar';
import { BondRing } from '../people/PersonPanel';
import { RelationsView } from '../relations/RelationsView';
import '../people/people.css';

type Tab = 'social' | 'conexiones' | 'relaciones' | 'arbol' | 'wrapped';
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

function Wrapped({ year }: { year: Year }) {
  const { workspace, go } = useApp();
  const w = useMemo(() => wrappedFor(workspace.people, workspace.entries, year), [workspace, year]);
  const maxMonth = Math.max(1, ...w.months);
  const title = year === 'todo' ? 'Toda tu historia' : `Tu ${year} en personas`;
  if (!w.total) {
    return (
      <div className="wr-empty">
        <Sparkles size={28} />
        <h3>Sin interacciones con personas en este periodo.</h3>
        <p>Vincula personas a tus recuerdos y aquí aparecerá tu resumen.</p>
      </div>
    );
  }
  const balance =
    w.give + w.receive ? Math.round(((w.give - w.receive) / (w.give + w.receive)) * 100) : null;
  return (
    <div className="wr">
      <section className="wr-card hero">
        <span className="wr-eyebrow">{title}</span>
        <h2>
          {w.total} momentos
          <br />
          con {w.people} {w.people === 1 ? 'persona' : 'personas'}
        </h2>
        {w.busiest && <p>Tu mes más social fue {w.busiest}.</p>}
        <div className="wr-months" aria-hidden="true">
          {w.months.map((m, i) => (
            <i
              key={i}
              style={{ height: `${10 + (m / maxMonth) * 90}%` }}
              className={m === maxMonth ? 'top' : ''}
            />
          ))}
        </div>
      </section>

      <section className="wr-card top">
        <span className="wr-eyebrow">Tu gente</span>
        <ol>
          {w.top.map(({ person, n }, i) => (
            <li key={person.id}>
              <button type="button" onClick={() => go('Personas', person)}>
                <b>{i + 1}</b>
                <Avatar person={person} size={i === 0 ? 46 : 34} />
                <span>
                  <strong>{person.name}</strong>
                  <i style={{ width: `${(n / w.top[0].n) * 100}%` }} />
                </span>
                <em>{n}</em>
              </button>
            </li>
          ))}
        </ol>
      </section>

      {w.duo?.a && w.duo.b && (
        <section className="wr-card duo">
          <span className="wr-eyebrow">
            <HeartHandshake size={14} /> Dúo inseparable
          </span>
          <div className="wr-duo">
            <Avatar person={w.duo.a} size={58} />
            <Avatar person={w.duo.b} size={58} />
          </div>
          <h3>
            {w.duo.a.name.split(' ')[0]} y {w.duo.b.name.split(' ')[0]}
          </h3>
          <p>
            Aparecieron juntos en {w.duo.n} {w.duo.n === 1 ? 'recuerdo' : 'recuerdos'}.
          </p>
        </section>
      )}

      {w.biggest && (
        <section className="wr-card big">
          <span className="wr-eyebrow">
            <PartyPopper size={14} /> El más concurrido
          </span>
          <h3>{w.biggest.title}</h3>
          <p>{w.biggest.person_ids.length} personas en un mismo momento.</p>
          <div className="wr-faces">
            {w.biggest.person_ids.slice(0, 8).flatMap((id) => {
              const p = workspace.people.find((x) => x.id === id);
              return p ? [<Avatar key={id} person={p} size={30} />] : [];
            })}
          </div>
        </section>
      )}

      {w.topKind && (
        <section className="wr-card kind">
          <span className="wr-eyebrow">Lo que más hicieron</span>
          <h3>{w.topKind.kind}</h3>
          <p>{w.topKind.n} veces.</p>
        </section>
      )}

      {balance !== null && (
        <section className="wr-card bal">
          <span className="wr-eyebrow">Dar y recibir</span>
          <h3>
            {Math.abs(balance) <= 20 ? 'Equilibrado' : balance > 0 ? 'Diste más' : 'Recibiste más'}
          </h3>
          <p>
            {w.give} puntos dados · {w.receive} recibidos
          </p>
        </section>
      )}

      {w.newPeople.length > 0 && (
        <section className="wr-card new">
          <span className="wr-eyebrow">
            <UserPlus size={14} /> Llegaron a tu vida
          </span>
          <div className="wr-faces wrap">
            {w.newPeople.slice(0, 12).map((p) => (
              <button type="button" key={p.id} title={p.name} onClick={() => go('Personas', p)}>
                <Avatar person={p} size={38} />
              </button>
            ))}
          </div>
          <p>
            {w.newPeople.length} {w.newPeople.length === 1 ? 'persona nueva' : 'personas nuevas'}.
          </p>
        </section>
      )}

      {w.faded.length > 0 && (
        <section className="wr-card faded">
          <span className="wr-eyebrow">
            <CalendarHeart size={14} /> Para retomar
          </span>
          <div className="wr-faces wrap">
            {w.faded.slice(0, 12).map((p) => (
              <button type="button" key={p.id} title={p.name} onClick={() => go('Personas', p)}>
                <Avatar person={p} size={38} />
              </button>
            ))}
          </div>
          <p>Hablaste con ellas el año anterior, pero no en este.</p>
        </section>
      )}
    </div>
  );
}

export function ConnectionsPage() {
  const { workspace } = useApp();
  const [tab, setTab] = useState<Tab>('social');
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
    { id: 'wrapped', label: 'Tu año', icon: Sparkles, hint: 'Un resumen de tu vida social' },
  ];

  return (
    <div className="cx">
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
      ) : (
        <>
          <div className="cx-sub">
            <p className="cx-hint">{tabs.find((t) => t.id === tab)!.hint}</p>
            {tab !== 'wrapped' && (
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
            )}
          </div>

          {tab === 'wrapped' ? (
            <Wrapped year={year} />
          ) : peopleShown + placesShown > 0 ? (
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
