import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, MapPin, Plus, Search, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Place, PlaceKind } from '../data';
import { normalizeText } from '../lib/format';
import { isAt, placeKindList, placeKinds, placeSearchText } from '../lib/places';

/** Elegir o crear el lugar de un recuerdo. */
export function PlaceDialog({
  selectedId,
  initialQuery = '',
  onPick,
  onClose,
}: {
  selectedId?: string;
  initialQuery?: string;
  onPick: (place: Place | null) => void;
  onClose: () => void;
}) {
  const { workspace, savePlace } = useApp();
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<PlaceKind>('otro');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const visits = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of workspace.places)
      m.set(p.id, workspace.entries.filter((e) => isAt(e, p)).length);
    return m;
  }, [workspace]);

  const needle = normalizeText(query.trim());
  const list = workspace.places
    .filter((p) => !needle || placeSearchText(p).includes(needle))
    .sort(
      (a, b) =>
        (visits.get(b.id) ?? 0) - (visits.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'es'),
    );
  const exact = workspace.places.some((p) => normalizeText(p.name) === needle);

  const create = async () => {
    if (!query.trim() || busy) return;
    setBusy(true);
    const place = await savePlace({
      name: query.trim(),
      kind,
      city: '',
      address: '',
      story: '',
      images: [],
      favorite: false,
    });
    setBusy(false);
    if (place) {
      onPick(place);
      onClose();
    }
  };

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
    >
      <div className="pk" role="dialog" aria-modal="true" aria-label="Elegir lugar">
        <header className="pk-head">
          <h3>¿Dónde fue?</h3>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <label className="pk-search">
          <Search size={16} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca o escribe un lugar nuevo…"
            maxLength={120}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (list[0] && (exact || !query.trim())) {
                onPick(list[0]);
                onClose();
              } else void create();
            }}
          />
        </label>

        <div className="pk-list">
          {query.trim() && !exact && (
            <div className="pk-create">
              <button
                type="button"
                className="pk-row create"
                onClick={() => void create()}
                disabled={busy}
              >
                <span className="pk-tile">
                  <Plus size={17} />
                </span>
                <span>
                  <strong>Crear «{query.trim()}»</strong>
                  <small>Nuevo lugar · {placeKinds[kind].label}</small>
                </span>
              </button>
              <div className="cp-chips pk-kinds">
                {placeKindList.map((k) => {
                  const Icon = placeKinds[k].icon;
                  return (
                    <button
                      type="button"
                      key={k}
                      className={'cp-chip' + (kind === k ? ' on' : '')}
                      onClick={() => setKind(k)}
                    >
                      <Icon size={13} /> {placeKinds[k].label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {list.map((p) => {
            const meta = placeKinds[p.kind] ?? placeKinds.otro;
            const Icon = meta.icon;
            const on = p.id === selectedId;
            const cover = p.images[0];
            return (
              <button
                type="button"
                key={p.id}
                className={'pk-row' + (on ? ' on' : '')}
                onClick={() => {
                  onPick(on ? null : p);
                  onClose();
                }}
              >
                <span
                  className="pk-tile"
                  style={{ '--c': meta.color, '--s': meta.soft } as CSSProperties}
                >
                  {cover ? <img src={cover.thumb ?? cover.url} alt="" /> : <Icon size={17} />}
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {meta.label}
                    {p.city ? ` · ${p.city}` : ''} · {visits.get(p.id) ?? 0}{' '}
                    {visits.get(p.id) === 1 ? 'visita' : 'visitas'}
                  </small>
                </span>
                {on && <Check size={17} className="pk-check" />}
              </button>
            );
          })}
          {!list.length && !query.trim() && (
            <p className="pp-empty pk-empty">
              <MapPin size={15} /> Aún no tienes lugares. Escribe uno para crearlo.
            </p>
          )}
        </div>
        {selectedId && (
          <footer className="pk-foot">
            <button
              type="button"
              className="cp-btn ghost"
              onClick={() => {
                onPick(null);
                onClose();
              }}
            >
              Quitar lugar
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
