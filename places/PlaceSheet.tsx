import { useState, type CSSProperties } from 'react';
import { Check, LoaderCircle, MapPin, Star, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { AutoTextarea, Label } from '../composer/controls';
import { PhotoStrip } from '../composer/PhotoBlocks';
import { useImageUploads } from '../composer/useImageUploads';
import type { Place, PlaceInput, PlaceKind } from '../data';
import { placeKindList, placeKinds } from '../lib/places';

/** Crear o editar un lugar: nombre, tipo, ubicación, su historia y fotos. */
export function PlaceSheet({
  place,
  initialName = '',
  onSave,
  onClose,
}: {
  place?: Place;
  initialName?: string;
  onSave: (input: PlaceInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const { confirm } = useApp();
  const [name, setName] = useState(place?.name ?? initialName);
  const [kind, setKind] = useState<PlaceKind>(place?.kind ?? 'otro');
  const [city, setCity] = useState(place?.city ?? '');
  const [address, setAddress] = useState(place?.address ?? '');
  const [story, setStory] = useState(place?.story ?? '');
  const [favorite, setFavorite] = useState(place?.favorite ?? false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const photos = useImageUploads(place?.images ?? [], 12);
  const meta = placeKinds[kind];
  const touch =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setTouched(true);
      set(v);
    };
  const problem = !name.trim()
    ? 'Falta el nombre.'
    : photos.busy
      ? 'Subiendo fotos…'
      : photos.hasError
        ? 'Una foto no se subió.'
        : null;

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    const ok = await onSave({
      name: name.trim(),
      kind,
      city: city.trim(),
      address: address.trim(),
      story: story.trim(),
      images: photos.images,
      favorite,
    });
    setBusy(false);
    if (ok) onClose();
  };
  const requestClose = async () => {
    if (
      (touched || photos.touched) &&
      !(await confirm({
        title: '¿Descartar los cambios?',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir editando',
        danger: true,
        icon: 'warning',
      }))
    )
      return;
    onClose();
  };

  return (
    <Sheet label={place ? 'Editar lugar' : 'Nuevo lugar'} onRequestClose={requestClose}>
      <form
        className="cp-composer"
        style={{ '--accent': meta.color, '--soft': meta.soft, '--ink': '#27301f' } as CSSProperties}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
          else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
        }}
      >
        <header className="cp-head">
          <span className="cp-kind-chip static">
            <MapPin size={17} />
            <strong>{place ? 'Editar lugar' : 'Nuevo lugar'}</strong>
          </span>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={requestClose}>
            <X size={20} />
          </button>
        </header>
        <div className="cp-scroll">
          <input
            className="cp-title-input"
            placeholder="Nombre del lugar"
            maxLength={120}
            value={name}
            onChange={(e) => touch(setName)(e.target.value)}
            data-autofocus
            autoFocus
          />
          <Label>Tipo</Label>
          <div className="pl-kinds" role="radiogroup" aria-label="Tipo de lugar">
            {placeKindList.map((k) => {
              const m = placeKinds[k];
              const Icon = m.icon;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  key={k}
                  className={kind === k ? 'on' : ''}
                  style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
                  onClick={() => touch(setKind)(k)}
                >
                  <Icon size={18} />
                  {m.label}
                </button>
              );
            })}
          </div>
          <div className="cp-two pl-gap">
            <label className="cp-pill-input">
              <MapPin size={16} />
              <input
                placeholder="Ciudad"
                maxLength={80}
                value={city}
                onChange={(e) => touch(setCity)(e.target.value)}
              />
            </label>
            <label className="cp-pill-input">
              <MapPin size={16} />
              <input
                placeholder="Dirección o referencia"
                maxLength={160}
                value={address}
                onChange={(e) => touch(setAddress)(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className={'ps-fav pl-gap' + (favorite ? ' on' : '')}
            onClick={() => touch(setFavorite)(!favorite)}
          >
            <Star size={15} /> {favorite ? 'Lugar favorito' : 'Marcar favorito'}
          </button>
          <Label hint="Lo que significa para ti">Su historia</Label>
          <AutoTextarea
            className="cp-soft-area"
            minRows={4}
            placeholder="Por qué es especial, qué ha pasado aquí, a quién te recuerda…"
            value={story}
            onChange={(e) => touch(setStory)(e.target.value)}
          />
          <Label hint="Las fotos de tus recuerdos aquí se suman solas">Fotos</Label>
          <PhotoStrip uploads={photos} addLabel="Añadir fotos" />
        </div>
        <footer className="cp-foot">
          <span className={'cp-status' + (problem ? ' problem' : '')}>
            {problem ?? 'Ctrl + Enter para guardar'}
          </span>
          <button type="button" className="cp-btn ghost" onClick={requestClose}>
            Cancelar
          </button>
          <button className="cp-btn cta" disabled={Boolean(problem) || busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
            {place ? 'Guardar lugar' : 'Crear lugar'}
          </button>
        </footer>
      </form>
    </Sheet>
  );
}
