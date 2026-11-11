import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Feather,
  MapPin,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Place, PlaceKind } from '../data';
import { money, normalizeText, shortDate } from '../lib/format';
import { relativeDay } from '../lib/people';
import {
  placeKindList,
  placeKinds,
  placeSearchText,
  placeStats,
} from '../lib/places';
import { RichText } from '../components/RichText';
import { moods } from '../composer/controls';
import { Avatar } from '../people/Avatar';
import '../people/people.css';
import '../places/places.css';

function PlaceDetail({ place }: { place: Place }) {
  const {
    workspace,
    go,
    openPlace,
    removePlace,
    openImages,
    openEntry,
    viewEntry,
    updatePlace,
    peekPerson,
  } = useApp();
  const s = useMemo(
    () => placeStats(place, workspace.entries, workspace.people),
    [place, workspace],
  );
  const meta = placeKinds[place.kind] ?? placeKinds.otro;
  const Icon = meta.icon;
  const cover = s.photos[0];
  const mood = moods.find((m) => m.value === s.mood);
  return (
    <div className="pl-detail" style={{ '--c': meta.color, '--s': meta.soft } as CSSProperties}>
      <button type="button" className="pp-back" onClick={() => go('Lugares')}>
        <ArrowLeft size={15} /> Todos los lugares
      </button>
      <header className={'pl-hero' + (cover ? ' photo' : '')}>
        {cover && <img src={cover.url} alt="" />}
        <div className="pl-hero-body">
          <span className="pl-kind">
            <Icon size={14} /> {meta.label}
          </span>
          <h1>{place.name}</h1>
          {(place.city || place.address) && (
            <p>{[place.address, place.city].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="pl-hero-tools">
          <button
            type="button"
            className={'pp-icon-btn' + (place.favorite ? ' fav' : '')}
            aria-label="Favorito"
            onClick={() => void updatePlace(place, { favorite: !place.favorite }, true)}
          >
            <Star size={17} />
          </button>
          <button
            type="button"
            className="pp-icon-btn"
            aria-label="Editar lugar"
            onClick={() => openPlace(place)}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="pp-icon-btn"
            aria-label="Eliminar lugar"
            onClick={() => removePlace(place)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div className="pl-metrics">
        <div>
          <b>{s.visits.length}</b>
          <span>Visitas</span>
        </div>
        <div>
          <b>{relativeDay(s.last)}</b>
          <span>Última vez</span>
        </div>
        <div>
          <b>{s.first ? shortDate(s.first + 'T12:00:00') : '—'}</b>
          <span>Primera vez</span>
        </div>
        <div>
          <b>{mood ? `${mood.emoji} ${mood.label}` : '—'}</b>
          <span>Cómo se siente</span>
        </div>
        {s.spentCount > 0 && (
          <div title={`${s.spentCount} ${s.spentCount === 1 ? 'movimiento' : 'movimientos'}`}>
            <b>{money(s.spent)}</b>
            <span>Gastado aquí</span>
          </div>
        )}
      </div>

      <div className="pl-cols">
        <div>
          {place.story && (
            <>
              <h4>Su historia</h4>
              <p className="pp-bio">{place.story}</p>
            </>
          )}
          <h4>Lo que ha pasado aquí</h4>
          <button
            type="button"
            className="pp-text-btn"
            onClick={() => openEntry('Encuentro', [], { placeId: place.id, place: place.name })}
          >
            <Plus size={14} /> Registrar un encuentro
          </button>
          {!s.visits.length && (
            <p className="pp-empty">
              Elige este lugar al guardar un encuentro o una nota y su historia se irá llenando
              sola.
            </p>
          )}
          <ol className="pp-timeline">
            {s.visits.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => viewEntry(e)}>
                  <i className={'pp-tl-dot kind-' + e.kind} />
                  <span className="pp-tl-main">
                    <strong>{e.title}</strong>
                    {e.body && (
                      <small>
                        <RichText text={e.body.slice(0, 160)} />
                      </small>
                    )}
                  </span>
                  <span className="pp-tl-date">
                    {shortDate(e.created_at)}
                    <em>{e.kind}</em>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <aside>
          <h4>
            <Users size={15} /> Con quién has estado aquí
          </h4>
          {!s.people.length && <p className="pp-empty">Nadie registrado todavía.</p>}
          <div className="pp-people-list">
            {s.people.slice(0, 10).map(({ person, n }) => (
              <button type="button" key={person.id} onClick={() => peekPerson(person)}>
                <Avatar person={person} size={32} />
                <span>
                  <strong>{person.name}</strong>
                  <small>
                    {n} {n === 1 ? 'vez' : 'veces'}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <h4>Fotos</h4>
          {!s.photos.length && (
            <p className="pp-empty">Las fotos de tus recuerdos aquí aparecerán solas.</p>
          )}
          <div className="pl-gallery">
            {s.photos.slice(0, 12).map((img, i) => (
              <button type="button" key={img.url} onClick={() => openImages(s.photos, i)}>
                <img src={img.thumb ?? img.medium ?? img.url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function PlacesPage() {
  const { workspace, selectedPlace, go, openPlace } = useApp();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<PlaceKind | 'todos'>('todos');
  const rows = useMemo(
    () =>
      workspace.places
        .map((p) => ({ place: p, s: placeStats(p, workspace.entries, workspace.people) }))
        .sort(
          (a, b) =>
            Number(b.place.favorite) - Number(a.place.favorite) ||
            (b.s.last ?? '').localeCompare(a.s.last ?? ''),
        ),
    [workspace],
  );

  if (selectedPlace) return <PlaceDetail place={selectedPlace} />;

  const needle = normalizeText(query.trim());
  const visible = rows.filter(
    (r) =>
      (kind === 'todos' || r.place.kind === kind) &&
      (!needle || placeSearchText(r.place).includes(needle)),
  );
  const kinds = placeKindList.filter((k) => rows.some((r) => r.place.kind === k));

  return (
    <div className="pl-page">
      <label className="pp-search">
        <Search size={17} />
        <input
          id="search"
          placeholder="Buscar lugares, ciudades, historias…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {kinds.length > 1 && (
        <nav className="pp-filter-tabs">
          <button
            type="button"
            className={kind === 'todos' ? 'on' : ''}
            onClick={() => setKind('todos')}
          >
            Todos <i>{rows.length}</i>
          </button>
          {kinds.map((k) => (
            <button
              type="button"
              key={k}
              className={kind === k ? 'on' : ''}
              onClick={() => setKind(k)}
            >
              {placeKinds[k].label} <i>{rows.filter((r) => r.place.kind === k).length}</i>
            </button>
          ))}
        </nav>
      )}

      <div className="pl-grid">
        {visible.map(({ place, s }) => {
          const meta = placeKinds[place.kind] ?? placeKinds.otro;
          const Icon = meta.icon;
          const cover = s.photos[0];
          return (
            <button
              type="button"
              key={place.id}
              className="pl-card"
              style={{ '--c': meta.color, '--s': meta.soft } as CSSProperties}
              onClick={() => go('Lugares', place)}
            >
              <span className="pl-cover">
                {cover ? (
                  <img src={cover.medium ?? cover.url} alt="" loading="lazy" />
                ) : (
                  <Icon size={34} strokeWidth={1.4} />
                )}
                {place.favorite && (
                  <i className="pl-fav">
                    <Star size={13} />
                  </i>
                )}
              </span>
              <span className="pl-card-body">
                <span className="pl-kind">
                  <Icon size={12} /> {meta.label}
                  {place.city ? ` · ${place.city}` : ''}
                </span>
                <strong>{place.name}</strong>
                <small>
                  <Feather size={12} /> {s.visits.length}{' '}
                  {s.visits.length === 1 ? 'recuerdo' : 'recuerdos'} · {relativeDay(s.last)}
                </small>
                {s.people.length > 0 && (
                  <span className="pl-faces">
                    {s.people.slice(0, 5).map(({ person }) => (
                      <Avatar key={person.id} person={person} size={24} />
                    ))}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        <button type="button" className="pl-card add" onClick={() => openPlace()}>
          <MapPin size={26} />
          <strong>Nuevo lugar</strong>
          <small>Un café, una casa, un viaje…</small>
        </button>
      </div>
    </div>
  );
}
