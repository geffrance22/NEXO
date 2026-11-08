import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Check,
  LoaderCircle,
  MapPin,
  Play,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { AutoTextarea, Label, Segmented } from '../composer/controls';
import { PeopleDialog, type PeopleChoice } from '../composer/PeopleDialog';
import { PlaceDialog } from '../composer/PlaceDialog';
import type { Episode, EpisodeInput, EpisodeKind, EpisodeOrigin, Person } from '../data';
import {
  CUSTOM_KIND_MAX,
  baseKind,
  customKind,
  episodeKindList,
  episodeKinds,
  originLabel,
  toCustomKind,
} from '../lib/episodes';
import { addDays, money, thousands, todayInputValue } from '../lib/format';
import { daysBetween } from '../lib/people';
import { placeKinds } from '../lib/places';
import { Avatar } from '../people/Avatar';
import './episodes.css';

/** Los tipos que se ven sin abrir «Más tipos». */
const FEATURED: EpisodeKind[] = [
  'viaje',
  'encuentro',
  'celebracion',
  'evento',
  'proyecto',
  'negocio',
  'estudio',
  'salud',
  'familia',
  'pareja',
];
/** Ideas para «Otro» (después de los que ya escribiste antes). */
const CUSTOM_IDEAS = ['Boda', 'Retiro', 'Intercambio', 'Embarazo', 'Concurso', 'Luna de miel'];
/** Duraciones rápidas: ponen la fecha final contando desde la inicial. */
const SPANS = [
  { days: 1, label: 'Un día' },
  { days: 3, label: '3 días' },
  { days: 7, label: 'Una semana' },
  { days: 30, label: 'Un mes' },
];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Crear o editar un episodio: un viaje, una cena, un proyecto… con fechas, gente y presupuesto. */
export function EpisodeSheet({
  episode,
  init,
  from,
  onClose,
}: {
  episode?: Episode;
  init?: Partial<EpisodeInput>;
  /** El episodio nuevo nace de otro («se convirtió en», «es continuación de»…) y queda enlazado. */
  from?: EpisodeOrigin;
  onClose: () => void;
}) {
  const { workspace, saveEpisode, updateEpisode, removeEpisode, go } = useApp();
  const today = todayInputValue();
  const startKind = episode?.kind ?? init?.kind ?? 'viaje';
  const [kind, setKind] = useState<EpisodeKind>(baseKind(startKind));
  const [custom, setCustom] = useState(customKind(startKind));
  const [allKinds, setAllKinds] = useState(() => {
    const k = baseKind(startKind);
    return k !== 'otro' && !FEATURED.includes(k);
  });
  const [d, setD] = useState<EpisodeInput>(() => ({
    title: episode?.title ?? init?.title ?? '',
    kind: startKind,
    status: episode?.status ?? init?.status ?? 'activo',
    starts_on: episode?.starts_on ?? init?.starts_on ?? today,
    ends_on: episode?.ends_on ?? init?.ends_on ?? null,
    summary: episode?.summary ?? init?.summary ?? '',
    source: episode?.source ?? init?.source ?? '',
    person_ids: episode?.person_ids ?? init?.person_ids ?? [],
    place_ids: episode?.place_ids ?? init?.place_ids ?? [],
    budget: episode?.budget ?? init?.budget ?? null,
    outcome: episode?.outcome ?? init?.outcome ?? '',
  }));
  // Mientras no toques el estado, se deduce de las fechas (si ya terminó, queda cerrado).
  const [statusTouched, setStatusTouched] = useState(Boolean(episode));
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const customInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof EpisodeInput>(k: K, v: EpisodeInput[K]) =>
    setD((x) => ({ ...x, [k]: v }));
  const m = episodeKinds[kind];
  const badRange = Boolean(d.starts_on && d.ends_on && d.ends_on < d.starts_on);
  const days =
    d.starts_on && d.ends_on && !badRange ? daysBetween(d.starts_on, d.ends_on) + 1 : null;

  // ── Tipo ──
  const pickKind = (k: EpisodeKind) => {
    setKind(k);
    if (k === 'otro') window.setTimeout(() => customInput.current?.focus(), 200);
  };
  const shownKinds = allKinds
    ? episodeKindList.filter((k) => k !== 'otro')
    : FEATURED.includes(kind) || kind === 'otro'
      ? FEATURED
      : [...FEATURED, kind];
  const ideas = useMemo(() => {
    const used = workspace.episodes.map((e) => customKind(e.kind)).filter(Boolean);
    return [...new Set([...used, ...CUSTOM_IDEAS])].slice(0, 7);
  }, [workspace.episodes]);

  // ── Fechas ──
  const setEnd = (end: string | null) =>
    setD((x) => ({
      ...x,
      ends_on: end,
      status: statusTouched ? x.status : end && end < today ? 'cerrado' : 'activo',
    }));
  const setSpan = (n: number) => {
    const start = d.starts_on ?? today;
    setD((x) => ({ ...x, starts_on: start }));
    setEnd(addDays(start, n - 1));
  };
  const startsIn = d.starts_on && d.starts_on > today ? daysBetween(today, d.starts_on) : 0;
  const statusHint =
    d.status === 'activo' && startsIn
      ? `Empieza en ${plural(startsIn, 'día', 'días')}: lo verás en «Próximamente».`
      : d.status === 'activo' && d.ends_on && d.ends_on < today
        ? 'Las fechas ya pasaron: ¿lo marcas como cerrado?'
        : d.status === 'cerrado'
          ? 'Al final del formulario puedes contar cómo salió.'
          : '';

  // ── Personas ──
  const people = useMemo(
    () => [...workspace.people].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [workspace.people],
  );
  // Las de siempre primero: aparecen en más recuerdos y episodios (y las favoritas suman).
  const frequent = useMemo(() => {
    const n = new Map<string, number>();
    const add = (id: string, by: number) => n.set(id, (n.get(id) ?? 0) + by);
    for (const e of workspace.entries) for (const id of e.person_ids) add(id, 1);
    for (const ep of workspace.episodes) for (const id of ep.person_ids) add(id, 3);
    for (const p of people) if (p.profile.favorite) add(p.id, 5);
    return people
      .filter((p) => n.get(p.id))
      .sort((a, b) => (n.get(b.id) ?? 0) - (n.get(a.id) ?? 0))
      .slice(0, 14);
  }, [people, workspace.entries, workspace.episodes]);
  const chosen = d.person_ids.flatMap((id) => people.find((p) => p.id === id) ?? []);
  const quickPeople = frequent.filter((p) => !d.person_ids.includes(p.id)).slice(0, 6);
  const togglePerson = (id: string) =>
    setD((x) => ({
      ...x,
      person_ids: x.person_ids.includes(id)
        ? x.person_ids.filter((i) => i !== id)
        : [...x.person_ids, id],
    }));
  const addPerson = (id: string) =>
    setD((x) => (x.person_ids.includes(id) ? x : { ...x, person_ids: [...x.person_ids, id] }));
  const peopleApi: PeopleChoice = {
    all: people,
    selected: d.person_ids,
    suggested: [] as Person[],
    toggle: togglePerson,
    accept: addPerson,
    dismiss: () => {},
    autoLink: false,
  };

  // ── Lugares ──
  const places = d.place_ids.flatMap((id) => workspace.places.find((p) => p.id === id) ?? []);

  const submit = async () => {
    if (!d.title.trim() || busy || badRange) return;
    setBusy(true);
    const clean: EpisodeInput = {
      ...d,
      kind: kind === 'otro' ? toCustomKind(custom) : kind,
      title: d.title.trim(),
      summary: d.summary.trim(),
      outcome: d.outcome.trim(),
    };
    if (episode) {
      if (await updateEpisode(episode, clean)) onClose();
    } else {
      const ep = await saveEpisode(clean);
      if (ep) {
        if (from) {
          const source = workspace.episodes.find((x) => x.id === from.episode.id) ?? from.episode;
          if (from.holder === 'new') {
            // «B es continuación de A»: lo guarda el nuevo.
            await updateEpisode(ep, { links: [{ id: source.id, kind: from.kind }] }, true);
          } else {
            // «A se convirtió en B»: lo guarda el de origen.
            await updateEpisode(
              source,
              {
                links: [
                  ...source.links.filter((l) => l.id !== ep.id),
                  { id: ep.id, kind: from.kind },
                ],
              },
              true,
            );
          }
        }
        onClose();
        go('Episodios', ep);
      }
    }
    setBusy(false);
  };

  return (
    <Sheet
      label={episode ? 'Editar episodio' : 'Nuevo episodio'}
      size="md"
      onRequestClose={onClose}
    >
      <form
        className="cp-composer ep-sheet"
        style={{ '--accent': m.color, '--soft': m.soft, '--ink': '#27301f' } as CSSProperties}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="cp-head">
          <span className="cp-kind-chip static">
            <m.icon size={17} />
            <strong>{episode ? 'Editar episodio' : 'Nuevo episodio'}</strong>
          </span>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="cp-scroll">
          <input
            className="cp-title-input"
            placeholder={kind === 'otro' ? 'Ponle un nombre a esta historia' : m.example}
            maxLength={120}
            value={d.title}
            autoFocus
            onChange={(e) => set('title', e.target.value)}
            aria-label="Nombre del episodio"
          />

          {/* ── Tipo ── */}
          <Label>Tipo</Label>
          <div className="ep-kinds" role="radiogroup" aria-label="Tipo de episodio">
            {[...shownKinds, 'otro' as const].map((k) => {
              const km = episodeKinds[k];
              const on = kind === k;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  key={k}
                  className={'ep-kind' + (on ? ' on' : '')}
                  style={{ '--kc': km.color, '--ks': km.soft } as CSSProperties}
                  onClick={() => pickKind(k)}
                >
                  <span className="ep-kind-icon">
                    <km.icon size={15} />
                  </span>
                  <span className="ep-kind-label">
                    {k === 'otro' && on && custom.trim() ? custom.trim() : km.label}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              className="ep-kind more"
              aria-expanded={allKinds}
              onClick={() => setAllKinds((v) => !v)}
            >
              {allKinds ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              {allKinds
                ? 'Menos tipos'
                : `Más tipos (${episodeKindList.length - 1 - FEATURED.length})`}
            </button>
          </div>
          {/* «Otro»: un recuadro para escribir el tipo, que se despliega suave. */}
          <div className={'ep-custom' + (kind === 'otro' ? ' open' : '')} inert={kind !== 'otro'}>
            <div>
              <label className="ep-custom-field">
                <Sparkles size={15} />
                <input
                  ref={customInput}
                  value={custom}
                  maxLength={CUSTOM_KIND_MAX}
                  placeholder="¿Qué tipo de episodio es? Boda, retiro, intercambio…"
                  aria-label="Tipo de episodio"
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter no envía el formulario: solo confirma el tipo.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />
                <small>
                  {custom.length}/{CUSTOM_KIND_MAX}
                </small>
              </label>
              <div className="ep-custom-ideas">
                {ideas.map((idea) => (
                  <button
                    type="button"
                    key={idea}
                    className={custom.trim() === idea ? 'on' : ''}
                    onClick={() => setCustom(idea)}
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Cuándo ── */}
          <Label hint={days ? plural(days, 'día', 'días') : 'La fecha final es opcional'}>
            Cuándo
          </Label>
          <div className="ep-when">
            <label className="ep-date">
              <span>Empieza</span>
              <input
                type="date"
                value={d.starts_on ?? ''}
                onChange={(e) => set('starts_on', e.target.value || null)}
              />
            </label>
            <ArrowRight size={16} className="ep-when-arrow" aria-hidden="true" />
            <label className={'ep-date' + (badRange ? ' bad' : '')}>
              <span>Termina</span>
              <input
                type="date"
                min={d.starts_on ?? undefined}
                value={d.ends_on ?? ''}
                onChange={(e) => setEnd(e.target.value || null)}
              />
            </label>
          </div>
          <div className="ep-spans">
            {SPANS.map((s) => (
              <button
                type="button"
                key={s.days}
                className={days === s.days ? 'on' : ''}
                onClick={() => setSpan(s.days)}
              >
                {s.label}
              </button>
            ))}
            <button type="button" className={!d.ends_on ? 'on' : ''} onClick={() => setEnd(null)}>
              Sin fecha final
            </button>
          </div>
          {badRange && <p className="cp-notice error">La fecha final es anterior a la inicial.</p>}

          {/* ── Estado ── */}
          <Label>Estado</Label>
          <div className="ep-status-pick">
            <Segmented
              label="Estado"
              value={d.status}
              onChange={(v) => {
                setStatusTouched(true);
                set('status', v);
              }}
              options={[
                { value: 'activo', label: 'En curso', icon: <Play size={14} /> },
                { value: 'cerrado', label: 'Cerrado', icon: <CircleCheck size={14} /> },
              ]}
            />
          </div>
          {statusHint && <p className="cp-hint">{statusHint}</p>}

          {/* ── Personas ── */}
          <Label hint="También cuentan las de sus recuerdos">Con quién</Label>
          <div className="lf-people">
            {chosen.map((p) => (
              <span className="lf-person" key={p.id}>
                <Avatar person={p} size={26} />
                {p.name.split(' ').slice(0, 2).join(' ')}
                <button
                  type="button"
                  aria-label={`Quitar a ${p.name}`}
                  onClick={() => togglePerson(p.id)}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
            <button type="button" className="lf-add" onClick={() => setPeopleOpen(true)}>
              <UserPlus size={16} /> {chosen.length ? 'Agregar' : 'Buscar o agregar personas'}
            </button>
          </div>
          {quickPeople.length > 0 && (
            <div className="ep-quick">
              <small>Frecuentes</small>
              {quickPeople.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  title={`Agregar a ${p.name}`}
                  onClick={() => addPerson(p.id)}
                >
                  <Avatar person={p} size={20} />
                  {p.name.split(' ')[0]}
                  <Plus size={12} />
                </button>
              ))}
            </div>
          )}

          {/* ── Lugares ── */}
          <Label hint="Opcional">Dónde</Label>
          <div className="lf-people">
            {places.map((pl) => {
              const pm = placeKinds[pl.kind] ?? placeKinds.otro;
              return (
                <span
                  className="lf-person ep-place-tok"
                  key={pl.id}
                  style={{ '--pc': pm.color, '--ps': pm.soft } as CSSProperties}
                >
                  <span className="ep-place-icon">
                    {pl.images[0] ? (
                      <img src={pl.images[0].thumb ?? pl.images[0].url} alt="" />
                    ) : (
                      <pm.icon size={13} />
                    )}
                  </span>
                  {pl.name}
                  {pl.city && <small>{pl.city}</small>}
                  <button
                    type="button"
                    aria-label={`Quitar ${pl.name}`}
                    onClick={() =>
                      set(
                        'place_ids',
                        d.place_ids.filter((x) => x !== pl.id),
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </span>
              );
            })}
            <button type="button" className="lf-add" onClick={() => setPlaceOpen(true)}>
              <MapPin size={16} /> {places.length ? 'Otro lugar' : 'Buscar o crear un lugar'}
            </button>
          </div>

          {/* ── Dinero ── */}
          <Label hint="Opcional · se compara con lo que gastes">Presupuesto</Label>
          <div className="ep-budget-row">
            <label className="cp-pill-input ep-budget">
              <span>$</span>
              <input
                inputMode="numeric"
                placeholder="0"
                aria-label="Presupuesto"
                value={d.budget ? thousands(d.budget) : ''}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, ''));
                  set('budget', n || null);
                }}
              />
              <small>COP</small>
            </label>
            {d.budget && days && days > 1 ? (
              <span className="ep-budget-day">≈ {money(d.budget / days)} por día</span>
            ) : null}
          </div>

          {/* ── Texto ── */}
          <Label>De qué se trata</Label>
          <AutoTextarea
            className="cp-soft-area"
            minRows={2}
            maxLength={4000}
            placeholder="Objetivo, contexto, qué esperas de esto…"
            value={d.summary}
            onChange={(e) => set('summary', e.target.value)}
          />
          {(d.status === 'cerrado' || d.outcome) && (
            <>
              <Label hint="Lo que salió, decisiones, aprendizajes">Resultado</Label>
              <AutoTextarea
                className="cp-soft-area"
                minRows={2}
                maxLength={4000}
                placeholder="¿Cómo terminó? ¿Qué harías distinto?"
                value={d.outcome}
                onChange={(e) => set('outcome', e.target.value)}
              />
            </>
          )}
        </div>

        <footer className="cp-foot">
          {episode ? (
            <button
              type="button"
              className="cp-btn ghost ep-danger"
              onClick={() => {
                onClose();
                removeEpisode(episode);
              }}
            >
              <Trash2 size={15} /> Eliminar
            </button>
          ) : (
            <span className="cp-status">
              {from
                ? `${originLabel(from)} «${from.episode.title}»`
                : 'Luego podrás añadirle recuerdos, gastos y pendientes.'}
            </span>
          )}
          <button type="button" className="cp-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="cp-btn cta" disabled={!d.title.trim() || busy || badRange}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{' '}
            {episode ? 'Guardar' : 'Crear episodio'}
          </button>
        </footer>
      </form>

      {peopleOpen && <PeopleDialog api={peopleApi} onClose={() => setPeopleOpen(false)} />}
      {placeOpen && (
        <PlaceDialog
          onPick={(place) => {
            if (place && !d.place_ids.includes(place.id))
              set('place_ids', [...d.place_ids, place.id]);
          }}
          onClose={() => setPlaceOpen(false)}
        />
      )}
    </Sheet>
  );
}
