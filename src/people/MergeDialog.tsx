import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, LoaderCircle, Merge, Search, UsersRound, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Person } from '../data';
import { normalizeText } from '../lib/format';
import { duplicateKey, findDuplicates } from '../lib/duplicates';
import { relationMeta, relationOf, searchText } from '../lib/people';
import { groupsOf, tiesOf } from '../lib/relations';
import { dismiss, undismiss, useDismissed } from '../relations/dismissed';
import { Avatar } from './Avatar';
import './merge.css';

/** Esc cierra solo la ventana de arriba. */
function useEscape(close: () => void, capture: 'window' | 'document' = 'window') {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      ref.current();
    };
    const target = capture === 'window' ? window : document;
    target.addEventListener('keydown', onKey as EventListener, true);
    return () => target.removeEventListener('keydown', onKey as EventListener, true);
  }, [capture]);
}

/** Posibles duplicados vigentes (sin los que dijiste que no son la misma). */
export function useDuplicates() {
  const { workspace } = useApp();
  const skip = useDismissed();
  return useMemo(() => findDuplicates(workspace.people, skip), [workspace.people, skip]);
}

/** Cuánto hay de una persona: recuerdos, vínculos, grupos y datos de su ficha. */
function weightOf(p: Person, ws: ReturnType<typeof useApp>['workspace']) {
  const entries = ws.entries.filter((e) => e.person_ids.includes(p.id)).length;
  const ties = tiesOf(p.id, ws.ties).length;
  const groups = groupsOf(p.id, ws.groups).length;
  const fields = Object.keys(p.profile).length + (p.bio ? 2 : 0) + (p.interests ? 1 : 0);
  return { entries, ties, groups, score: entries * 3 + ties * 2 + groups + fields };
}

/**
 * Unir dos fichas de la misma persona: eliges cuál se queda; la otra le pasa sus recuerdos,
 * vínculos, grupos y datos, y desaparece.
 */
export function MergeDialog({
  person,
  other,
  onClose,
}: {
  person: Person;
  other?: Person;
  onClose: () => void;
}) {
  const { workspace, mergePeople } = useApp();
  const [pair, setPair] = useState<Person | null>(other ?? null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  useEscape(() => !busy && onClose());

  const dups = useDuplicates();
  const likely = useMemo(
    () =>
      new Set(
        dups.flatMap((d) =>
          d.a.id === person.id ? [d.b.id] : d.b.id === person.id ? [d.a.id] : [],
        ),
      ),
    [dups, person.id],
  );
  const wA = weightOf(person, workspace);
  const wB = pair ? weightOf(pair, workspace) : null;
  // Por defecto se queda la ficha con más historia.
  const [keepId, setKeepId] = useState<string | null>(null);
  const keep = !pair
    ? person
    : keepId === pair.id || (!keepId && wB!.score > wA.score)
      ? pair
      : person;
  const drop = pair ? (keep.id === person.id ? pair : person) : null;

  const needle = normalizeText(query.trim());
  const candidates = workspace.people
    .filter((p) => p.id !== person.id && (!needle || searchText(p).includes(needle)))
    .sort(
      (a, b) =>
        Number(likely.has(b.id)) - Number(likely.has(a.id)) || a.name.localeCompare(b.name, 'es'),
    )
    .slice(0, 60);

  const run = async () => {
    if (!drop || busy) return;
    setBusy(true);
    const ok = await mergePeople(keep, drop);
    setBusy(false);
    if (ok) onClose();
  };

  const card = (p: Person) => {
    const w = p.id === person.id ? wA : wB!;
    const m = relationMeta[relationOf(p)];
    const on = keep.id === p.id;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        className={'mg-card' + (on ? ' on' : '')}
        style={{ '--accent': m.color, '--soft': m.soft } as CSSProperties}
        onClick={() => setKeepId(p.id)}
      >
        <span className="mg-badge">{on ? <Check size={12} /> : null}</span>
        <Avatar person={p} size={52} />
        <strong>{p.name}</strong>
        <small>{p.role || m.label}</small>
        <span className="mg-counts">
          <span>
            <b>{w.entries}</b> recuerdos
          </span>
          <span>
            <b>{w.ties}</b> vínculos
          </span>
          <span>
            <b>{w.groups}</b> grupos
          </span>
        </span>
        <em>{on ? 'Se queda' : 'Se une'}</em>
      </button>
    );
  };

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop mg-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="pk mg" role="dialog" aria-modal="true" aria-label="Unir fichas">
        <header className="pk-head mg-head">
          <span className="pk-tile">
            <Merge size={18} />
          </span>
          <h3>{pair ? 'Unir fichas' : `Unir a ${person.name.split(' ')[0]} con…`}</h3>
          <button
            type="button"
            className="cp-close"
            aria-label="Cerrar"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        {!pair ? (
          <>
            <label className="pk-search">
              <Search size={16} />
              <input
                autoFocus
                value={query}
                placeholder="Buscar la otra ficha…"
                aria-label="Buscar persona"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="pk-list">
              {candidates.map((p) => (
                <button type="button" key={p.id} className="pk-row" onClick={() => setPair(p)}>
                  <Avatar person={p} size={34} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.role || relationMeta[relationOf(p)].label}</small>
                  </span>
                  {likely.has(p.id) && <i className="mg-likely">Parecida</i>}
                </button>
              ))}
              {!candidates.length && <p className="pp-empty pk-empty">Nadie coincide.</p>}
            </div>
          </>
        ) : (
          <>
            <div className="mg-pair" role="radiogroup" aria-label="Cuál ficha se queda">
              {card(person)}
              <span className="mg-arrow" aria-hidden="true">
                <Merge size={16} />
              </span>
              {card(pair)}
            </div>
            <p className="mg-note">
              {drop!.name.split(' ')[0]} pasa a {keep.name.split(' ')[0]} con todo lo suyo.
            </p>
          </>
        )}

        <footer className="pk-foot">
          {pair && !other ? (
            <button
              type="button"
              className="gp-foot-link"
              disabled={busy}
              onClick={() => {
                setPair(null);
                setKeepId(null);
              }}
            >
              Elegir otra
            </button>
          ) : (
            <span className="mg-warn">{pair ? 'No se puede deshacer' : ''}</span>
          )}
          <button
            type="button"
            className="cp-btn cta"
            disabled={!pair || busy}
            onClick={() => void run()}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <Merge size={15} />} Unir
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Posibles fichas repetidas, con «Unir» y «No son la misma». */
export function DuplicatesDialog({ onClose }: { onClose: () => void }) {
  const { openMerge, notify } = useApp();
  const list = useDuplicates();
  // Debajo de «Unir fichas»: ella atiende Esc primero (escucha en window).
  useEscape(onClose, 'document');

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="pk mg-dups" role="dialog" aria-modal="true" aria-label="Posibles duplicados">
        <header className="pk-head mg-head">
          <span className="pk-tile">
            <UsersRound size={18} />
          </span>
          <h3>Posibles duplicados</h3>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="pk-list mg-dup-list">
          {list.map((d) => (
            <div className="mg-dup" key={d.id}>
              <span className="mg-dup-faces">
                <Avatar person={d.a} size={34} />
                <Avatar person={d.b} size={34} />
              </span>
              <span className="mg-dup-main">
                <strong>
                  {d.a.name} <i>·</i> {d.b.name}
                </strong>
                <small>{d.reasons.join(' · ')}</small>
              </span>
              <button
                type="button"
                className="mg-dup-no"
                title="No son la misma"
                aria-label={`${d.a.name} y ${d.b.name} no son la misma persona`}
                onClick={() => {
                  const key = duplicateKey(d.a.id, d.b.id);
                  dismiss(key);
                  notify('Listo, no se volverá a sugerir.', {
                    label: 'Deshacer',
                    run: () => undismiss(key),
                  });
                }}
              >
                <X size={15} />
              </button>
              <button
                type="button"
                className="cp-btn cta mg-dup-go"
                onClick={() => openMerge(d.a, d.b)}
              >
                <Merge size={14} /> Unir
              </button>
            </div>
          ))}
          {!list.length && (
            <p className="pp-empty pk-empty">
              <Check size={16} /> No hay fichas repetidas.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
