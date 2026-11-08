import { useState, type CSSProperties } from 'react';
import { MapPin, Plus, Sparkles, UserPlus, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Place } from '../data';
import { normalizeText } from '../lib/format';
import { placeKinds } from '../lib/places';
import { Avatar } from '../people/Avatar';
import { PeopleDialog } from './PeopleDialog';
import { PersonCues } from './PersonCues';
import { PlaceDialog } from './PlaceDialog';
import type { RichActions } from './RichTextarea';
import type { ComposerApi } from './useComposer';

/**
 * Personas y lugar de un recuerdo: los botones, las ventanas para elegirlos y las acciones que
 * usa la barra de selección del texto («vincular persona», «es el lugar», «usar como título»).
 */
export function useLinks(c: ComposerApi) {
  const { workspace } = useApp();
  const [peopleQuery, setPeopleQuery] = useState<string | null>(null);
  const [placeQuery, setPlaceQuery] = useState<string | null>(null);
  const placeId = c.details.placeId;

  const setPlace = (place: Place | null) => {
    c.setDetail('placeId', place?.id);
    c.setDetail('place', place?.name);
  };

  const actions: RichActions = {
    person: (text) => {
      const t = normalizeText(text);
      const all = c.people.all;
      const hit =
        all.find(
          (p) => normalizeText(p.name) === t || normalizeText(p.profile.alias ?? '') === t,
        ) ??
        (() => {
          const byFirst = all.filter((p) => normalizeText(p.name.split(' ')[0]) === t);
          return byFirst.length === 1 ? byFirst[0] : undefined;
        })();
      if (hit) {
        c.people.accept(hit.id);
        return true;
      }
      setPeopleQuery(text);
      return false;
    },
    place: (text) => {
      const hit = workspace.places.find((p) => normalizeText(p.name) === normalizeText(text));
      if (hit) {
        setPlace(hit);
        return true;
      }
      setPlaceQuery(text);
      return false;
    },
    title: (text) => c.setTitle(text.slice(0, 180)),
  };

  const linked = c.people.all.filter(
    (p) =>
      c.people.selected.includes(p.id) ||
      (c.people.autoLink && c.people.suggested.some((s) => s.id === p.id)),
  );
  const linkedIds = new Set(linked.map((p) => p.id));
  /** Lo que se resalta en el texto: nombres, apodos y cómo los nombraste («mi mamá», «Gómez»). */
  const names = [
    ...linked.flatMap((p) => [p.name, ...(p.profile.alias ? [p.profile.alias] : [])]),
    ...c.people.mentions.filter((m) => m.ids.some((id) => linkedIds.has(id))).map((m) => m.text),
  ];

  const dialogs = (
    <>
      {peopleQuery !== null && (
        <PeopleDialog
          api={c.people}
          initialQuery={peopleQuery}
          onClose={() => setPeopleQuery(null)}
        />
      )}
      {placeQuery !== null && (
        <PlaceDialog
          selectedId={placeId}
          initialQuery={placeQuery}
          onPick={setPlace}
          onClose={() => setPlaceQuery(null)}
        />
      )}
    </>
  );

  return {
    actions,
    names,
    dialogs,
    openPeople: () => setPeopleQuery(''),
    openPlace: () => setPlaceQuery(''),
    place: workspace.places.find((p) => p.id === placeId) ?? null,
    setPlace,
  };
}
export type Links = ReturnType<typeof useLinks>;

/** Personas elegidas como fichas, sugerencias del texto y el botón para agregar. */
export function PeopleField({
  c,
  links,
  compact = false,
}: {
  c: ComposerApi;
  links: Links;
  compact?: boolean;
}) {
  const api = c.people;
  const chosen = api.all.filter((p) => api.selected.includes(p.id));
  return (
    <div className={'lf-people' + (compact ? ' compact' : '')}>
      {chosen.map((p) => (
        <span className="lf-person" key={p.id}>
          <Avatar person={p} size={compact ? 24 : 30} />
          {p.name.split(' ').slice(0, 2).join(' ')}
          <button type="button" aria-label={`Quitar a ${p.name}`} onClick={() => api.toggle(p.id)}>
            <X size={13} />
          </button>
        </span>
      ))}
      {api.suggested.map((p) => {
        const why = api.why.get(p.id);
        const tag = why && why !== 'nombre' && why !== 'apodo' ? why : '';
        return (
          <span
            className={'lf-person maybe' + (api.autoLink ? ' auto' : '')}
            key={p.id}
            title={
              (api.autoLink ? 'Se vinculará al guardar' : 'Reconocida en tu texto') +
              (why ? ` · por ${why}` : '')
            }
          >
            <Sparkles size={12} />
            {api.autoLink ? (
              p.name.split(' ').slice(0, 2).join(' ')
            ) : (
              <button type="button" className="lf-accept" onClick={() => api.accept(p.id)}>
                <Plus size={12} /> {p.name.split(' ').slice(0, 2).join(' ')}
              </button>
            )}
            {tag && <small className="lf-why">{tag}</small>}
            <button
              type="button"
              aria-label={`Descartar a ${p.name}`}
              onClick={() => api.dismiss(p.id)}
            >
              <X size={13} />
            </button>
          </span>
        );
      })}
      <button type="button" className="lf-add" onClick={links.openPeople}>
        <UserPlus size={16} />{' '}
        {chosen.length || api.suggested.length ? 'Agregar' : 'Agregar persona'}
      </button>
      <PersonCues api={api} />
    </div>
  );
}

/** Lugar elegido (o el botón para elegirlo). */
export function PlaceField({ c, links }: { c: ComposerApi; links: Links }) {
  const place = links.place;
  const name = place?.name ?? c.details.place;
  if (!name) {
    return (
      <button type="button" className="lf-add place" onClick={links.openPlace}>
        <MapPin size={16} /> Elegir lugar
      </button>
    );
  }
  const meta = placeKinds[place?.kind ?? 'otro'];
  const Icon = meta.icon;
  const cover = place?.images[0];
  return (
    <span className="lf-place" style={{ '--c': meta.color, '--s': meta.soft } as CSSProperties}>
      <button
        type="button"
        className="lf-place-main"
        onClick={links.openPlace}
        title="Cambiar lugar"
      >
        <span className="lf-place-tile">
          {cover ? <img src={cover.thumb ?? cover.url} alt="" /> : <Icon size={15} />}
        </span>
        <span>
          <strong>{name}</strong>
          <small>
            {place ? meta.label + (place.city ? ` · ${place.city}` : '') : 'Sin ficha de lugar'}
          </small>
        </span>
      </button>
      <button type="button" aria-label="Quitar lugar" onClick={() => links.setPlace(null)}>
        <X size={13} />
      </button>
    </span>
  );
}
