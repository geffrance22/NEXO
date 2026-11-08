import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Banknote,
  CalendarClock,
  Check,
  CircleCheck,
  History,
  Layers,
  Link2,
  ListChecks,
  MapPin,
  Pencil,
  Plus,
  Quote,
  RotateCcw,
  Scale,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Unlink,
  Users,
  Wand2,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { PhotoThumbs } from '../components/PhotoThumbs';
import { kindMeta } from '../composer/kinds';
import type { Entry, Episode } from '../data';
import { commitmentKinds, commitmentOf } from '../lib/commitments';
import { candidateEntries, episodeKinds, episodeSummary, relatedEpisodes } from '../lib/episodes';
import { friendlyDate, money, shortDate, todayInputValue } from '../lib/format';
import { updateKinds } from '../lib/updates';
import { Avatar } from '../people/Avatar';
import { EpisodeGallery, EpisodeLog, RelatedEpisodes } from './EpisodeParts';
import './episodes.css';

const range = (from: string | null, to: string | null) => {
  if (!from) return 'Sin fecha';
  const f = (d: string) => shortDate(d + 'T12:00:00');
  return to && to !== from ? `${f(from)} – ${f(to)}` : f(from);
};

/** Episodios: cada uno reúne recuerdos, personas, lugares, dinero, tareas y aprendizajes. */
export function EpisodesPage() {
  const { workspace, selectedEpisode, openEpisode, openCapture, experiencesMissing } = useApp();
  const [filter, setFilter] = useState<'activo' | 'cerrado' | 'todos'>('todos');

  if (selectedEpisode) return <EpisodeDetail episode={selectedEpisode} />;

  const list = workspace.episodes
    .filter((e) => filter === 'todos' || e.status === filter)
    .sort((a, b) => (b.starts_on ?? b.created_at).localeCompare(a.starts_on ?? a.created_at));
  const counts = {
    todos: workspace.episodes.length,
    activo: workspace.episodes.filter((e) => e.status === 'activo').length,
    cerrado: workspace.episodes.filter((e) => e.status === 'cerrado').length,
  };

  return (
    <div className="ep-page">
      <div className="ep-bar">
        <div className="pp-pills" role="tablist">
          {(['todos', 'activo', 'cerrado'] as const).map((f) => (
            <button
              type="button"
              role="tab"
              key={f}
              aria-selected={filter === f}
              className={'pp-pill' + (filter === f ? ' on' : '')}
              onClick={() => setFilter(f)}
            >
              {f === 'todos' ? 'Todos' : f === 'activo' ? 'En curso' : 'Cerrados'}{' '}
              <i>{counts[f]}</i>
            </button>
          ))}
        </div>
        <div className="ep-bar-tools">
          <button type="button" className="pp-btn" onClick={() => openCapture()}>
            <Wand2 size={15} /> Capturar experiencia
          </button>
          <button
            type="button"
            className="pp-btn dark"
            disabled={experiencesMissing}
            onClick={() => openEpisode()}
          >
            <Plus size={15} /> Nuevo episodio
          </button>
        </div>
      </div>

      {experiencesMissing ? (
        <div className="pp-empty-state">
          <Layers size={30} />
          <h3>Los episodios necesitan la migración 008.</h3>
          <p>
            Ejecuta supabase/migrations/202611060008_experiences.sql en el SQL Editor de Supabase.
          </p>
        </div>
      ) : list.length ? (
        <div className="ep-grid">
          {list.map((ep) => (
            <EpisodeCard key={ep.id} episode={ep} />
          ))}
        </div>
      ) : (
        <div className="pp-empty-state">
          <Layers size={30} />
          <h3>{counts.todos ? 'Nada con ese filtro.' : 'Tus historias completas vivirán aquí.'}</h3>
          <p>
            Un viaje, una cena, una mudanza o un proyecto: cuéntalo y Nexo arma el episodio con sus
            piezas.
          </p>
          {!counts.todos && (
            <button type="button" className="pp-btn dark" onClick={() => openCapture()}>
              <Wand2 size={15} /> Capturar la primera experiencia
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EpisodeCard({ episode: ep }: { episode: Episode }) {
  const { workspace, go } = useApp();
  const s = useMemo(
    () => episodeSummary(ep, workspace.entries, workspace.people, workspace.places),
    [ep, workspace],
  );
  const m = episodeKinds[ep.kind] ?? episodeKinds.otro;
  const cover = s.photos[0];
  const related = relatedEpisodes(ep, workspace.episodes).length;
  const lastUpdate = [...ep.updates].sort((a, b) => b.date.localeCompare(a.date))[0];
  return (
    <button
      type="button"
      className="ep-card"
      style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
      onClick={() => go('Episodios', ep)}
    >
      <div className={'ep-card-cover' + (cover ? ' photo' : '')}>
        {cover ? (
          <img src={cover.medium ?? cover.url} alt="" loading="lazy" />
        ) : (
          <m.icon size={30} strokeWidth={1.6} />
        )}
        <span className={'ep-status ' + ep.status}>
          {ep.status === 'activo' ? 'En curso' : 'Cerrado'}
        </span>
      </div>
      <div className="ep-card-body">
        <small>
          <m.icon size={12} /> {m.label} · {range(s.from, s.to)}
        </small>
        <strong>{ep.title}</strong>
        <div className="ep-card-meta">
          <span>
            {s.items.length} {s.items.length === 1 ? 'pieza' : 'piezas'}
          </span>
          {s.spent > 0 && <span>−{money(s.spent)}</span>}
          {s.earned > 0 && <span className="good">+{money(s.earned)}</span>}
          {s.open.length > 0 && <span className="warn">{s.open.length} pendientes</span>}
          {related > 0 && (
            <span>
              <Link2 size={11} /> {related}
            </span>
          )}
        </div>
        {lastUpdate && (
          <p className="ep-card-last">
            <History size={12} /> {lastUpdate.text || 'Fotos nuevas'} ·{' '}
            {friendlyDate(lastUpdate.date)}
          </p>
        )}
        {s.people.length > 0 && (
          <div className="ep-faces">
            {s.people.slice(0, 6).map((p) => (
              <Avatar key={p.id} person={p} size={24} />
            ))}
            {s.people.length > 6 && <i>+{s.people.length - 6}</i>}
          </div>
        )}
      </div>
    </button>
  );
}

function EpisodeDetail({ episode: ep }: { episode: Episode }) {
  const app = useApp();
  const {
    workspace,
    go,
    openEpisode,
    updateEpisode,
    viewEntry,
    toggleEntry,
    linkEntries,
    openEntry,
    peekPerson,
  } = app;
  const s = useMemo(
    () => episodeSummary(ep, workspace.entries, workspace.people, workspace.places),
    [ep, workspace],
  );
  const m = episodeKinds[ep.kind] ?? episodeKinds.otro;
  const [adding, setAdding] = useState(false);
  const [outcome, setOutcome] = useState(ep.outcome);
  const budgetPct = ep.budget ? Math.min(100, Math.round((s.spent / ep.budget) * 100)) : null;
  const hasMoney = s.spent > 0 || s.earned > 0;
  const duration =
    s.startsIn !== null
      ? { value: `En ${s.startsIn} ${s.startsIn === 1 ? 'día' : 'días'}`, label: 'para empezar' }
      : s.days !== null
        ? {
            value: `${s.days} ${s.days === 1 ? 'día' : 'días'}`,
            label: ep.status === 'activo' && !ep.ends_on ? 'en curso' : 'de duración',
          }
        : null;

  return (
    <div className="ep-detail" style={{ '--c': m.color, '--s': m.soft } as CSSProperties}>
      <button type="button" className="pp-back" onClick={() => go('Episodios')}>
        <ArrowLeft size={15} /> Todos los episodios
      </button>
      <header className="ep-hero">
        <span className="ep-hero-icon">
          <m.icon size={26} />
        </span>
        <div>
          <small>
            {m.label} · {range(s.from, s.to)}
          </small>
          <h1>{ep.title}</h1>
          {ep.summary && <p>{ep.summary}</p>}
        </div>
        <div className="ep-hero-tools">
          <button
            type="button"
            className={'ep-status-btn ' + ep.status}
            onClick={() =>
              void updateEpisode(ep, {
                status: ep.status === 'activo' ? 'cerrado' : 'activo',
                ...(ep.status === 'activo' && !ep.ends_on && { ends_on: todayInputValue() }),
              })
            }
          >
            {ep.status === 'activo' ? (
              <>
                <CircleCheck size={15} /> Cerrar episodio
              </>
            ) : (
              <>
                <RotateCcw size={15} /> Reabrir
              </>
            )}
          </button>
          <button
            type="button"
            className="pp-icon-btn"
            aria-label="Editar episodio"
            onClick={() => openEpisode(ep)}
          >
            <Pencil size={16} />
          </button>
        </div>
      </header>

      <div className="ep-kpis">
        <div>
          <Users size={16} />
          <b>{s.people.length}</b>
          <span>{s.people.length === 1 ? 'persona' : 'personas'}</span>
        </div>
        <div>
          <Layers size={16} />
          <b>{s.items.length}</b>
          <span>{s.items.length === 1 ? 'pieza' : 'piezas'}</span>
        </div>
        <div className={'spent' + (budgetPct !== null && budgetPct >= 100 ? ' over' : '')}>
          <TrendingDown size={16} />
          <b>{money(s.spent)}</b>
          <span>{ep.budget ? `gastado de ${money(ep.budget)}` : 'gastado'}</span>
          {budgetPct !== null && (
            <i className="ep-budget-bar">
              <em style={{ width: budgetPct + '%' }} />
            </i>
          )}
        </div>
        <div className={'earned' + (s.earned > 0 ? ' good' : '')}>
          <TrendingUp size={16} />
          <b>{money(s.earned)}</b>
          <span>ingresos</span>
        </div>
        {hasMoney && (
          <div className={s.net < 0 ? 'over' : 'good'}>
            <Scale size={16} />
            <b>
              {s.net > 0 ? '+' : ''}
              {money(s.net)}
            </b>
            <span>balance</span>
          </div>
        )}
        <div className={s.open.length ? 'warn' : ''}>
          <ListChecks size={16} />
          <b>{s.open.length}</b>
          <span>{s.open.length === 1 ? 'pendiente abierto' : 'pendientes abiertos'}</span>
        </div>
        {duration && (
          <div>
            <CalendarClock size={16} />
            <b>{duration.value}</b>
            <span>{duration.label}</span>
          </div>
        )}
      </div>

      <div className="ep-cols">
        <div className="ep-main">
          <EpisodeLog episode={ep} />
          <section className="ep-panel">
            <div className="ep-panel-head">
              <h3>Historia</h3>
              <div>
                <button
                  type="button"
                  className="pp-text-btn"
                  onClick={() => openEntry(undefined, ep.person_ids)}
                >
                  <Plus size={13} /> Recuerdo
                </button>
                <button
                  type="button"
                  className="pp-text-btn"
                  onClick={() => openEntry('Movimiento', ep.person_ids)}
                >
                  <Banknote size={13} /> Gasto o ingreso
                </button>
                <button
                  type="button"
                  className="pp-text-btn"
                  onClick={() => openEntry('Pendiente', ep.person_ids)}
                >
                  <ListChecks size={13} /> Pendiente
                </button>
                <button type="button" className="pp-text-btn" onClick={() => setAdding((v) => !v)}>
                  <Link2 size={13} /> {adding ? 'Listo' : 'Enlazar existentes'}
                </button>
              </div>
            </div>
            {adding && <LinkPicker episode={ep} />}
            {s.items.length ? (
              <ol className="ep-timeline">
                {s.items.map((e, i) => {
                  const d = todayInputValue(new Date(e.created_at));
                  const prev = i ? todayInputValue(new Date(s.items[i - 1].created_at)) : '';
                  return (
                    <li key={e.id}>
                      {d !== prev && <span className="ep-day">{friendlyDate(d)}</span>}
                      <TimelineRow
                        entry={e}
                        onOpen={() => viewEntry(e)}
                        onUnlink={() => void linkEntries([e.id], null)}
                      />
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="pp-empty">
                Aún no tiene recuerdos. Enlaza los que ya tienes o captura uno nuevo.
              </p>
            )}
          </section>
          <EpisodeGallery episode={ep} photos={s.photos} />
        </div>

        <aside className="ep-side">
          {(s.open.length > 0 || s.done.length > 0) && (
            <section className="ep-panel">
              <h3>Compromisos</h3>
              {s.open.map((e) => (
                <TaskRow key={e.id} entry={e} onToggle={() => toggleEntry(e)} />
              ))}
              {s.done.length > 0 && <small className="ep-muted">{s.done.length} completados</small>}
            </section>
          )}

          {s.money.length > 0 && (
            <section className="ep-panel">
              <h3>Dinero</h3>
              <div className="ep-money">
                <span>
                  Gastos <b>{money(s.spent)}</b>
                </span>
                {s.earned > 0 && (
                  <span>
                    Ingresos <b>{money(s.earned)}</b>
                  </span>
                )}
                {s.earned > 0 && (
                  <span>
                    Neto <b className={s.net < 0 ? 'neg' : ''}>{money(s.net)}</b>
                  </span>
                )}
              </div>
              {s.money.map((e) => (
                <button type="button" key={e.id} className="ep-mov" onClick={() => viewEntry(e)}>
                  <span>{e.title}</span>
                  <b className={e.direction}>
                    {e.direction === 'ingreso' ? '+' : '−'}
                    {money(e.amount)}
                  </b>
                </button>
              ))}
              <small className="ep-muted">Calculado desde los movimientos de este episodio.</small>
            </section>
          )}

          <RelatedEpisodes episode={ep} />

          {(s.people.length > 0 || s.places.length > 0) && (
            <section className="ep-panel">
              <h3>Quiénes y dónde</h3>
              <div className="ep-people">
                {s.people.map((p) => (
                  <button type="button" key={p.id} onClick={() => peekPerson(p)} title={p.name}>
                    <Avatar person={p} size={30} />
                    <span>{p.name.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
              {s.places.map((pl) => (
                <button
                  type="button"
                  key={pl.id}
                  className="ep-place"
                  onClick={() => go('Lugares', pl)}
                >
                  <MapPin size={14} /> {pl.name}
                </button>
              ))}
            </section>
          )}

          {s.updates.length > 0 && (
            <section className="ep-panel">
              <h3>Novedades que salieron aquí</h3>
              {s.updates.map(({ person, update }) => {
                const um = updateKinds[update.kind] ?? updateKinds.otro;
                return (
                  <button
                    type="button"
                    key={update.id}
                    className="ep-update"
                    onClick={() => peekPerson(person)}
                  >
                    <um.icon size={14} style={{ color: um.color }} />
                    <span>
                      <b>{person.name.split(' ')[0]}</b> · {update.text}
                    </span>
                  </button>
                );
              })}
            </section>
          )}

          <section className="ep-panel">
            <h3>Resultado</h3>
            <textarea
              className="ep-outcome"
              rows={3}
              maxLength={4000}
              placeholder="¿Cómo salió? Decisiones, aprendizajes, qué harías distinto…"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              onBlur={() =>
                outcome.trim() !== ep.outcome &&
                void updateEpisode(ep, { outcome: outcome.trim() }, true)
              }
            />
          </section>

          {ep.source && (
            <section className="ep-panel">
              <h3>
                <Quote size={14} /> Texto original
              </h3>
              <blockquote className="xp-source ep-source">{ep.source}</blockquote>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function TimelineRow({
  entry: e,
  onOpen,
  onUnlink,
}: {
  entry: Entry;
  onOpen: () => void;
  onUnlink: () => void;
}) {
  const km = kindMeta[e.kind];
  return (
    <div className="ep-row" style={{ '--k': km.accent, '--ks': km.soft } as CSSProperties}>
      <span className="ep-row-icon">
        <km.icon size={14} />
      </span>
      <button type="button" className="ep-row-main" onClick={onOpen}>
        <strong>{e.title}</strong>
        <small>
          {e.kind}
          {e.kind === 'Movimiento' &&
            ` · ${e.direction === 'ingreso' ? '+' : '−'}${money(e.amount)}`}
          {e.kind === 'Pendiente' &&
            ` · ${commitmentKinds[commitmentOf(e)].short}${e.status === 'completado' ? ' · hecho' : ''}`}
          {e.details.place && ` · ${e.details.place}`}
        </small>
        {e.body && e.kind !== 'Encuentro' && <p>{e.body.slice(0, 180)}</p>}
        {e.images.length > 0 && <PhotoThumbs images={e.images} />}
      </button>
      <button
        type="button"
        className="ep-row-x"
        title="Quitar del episodio"
        aria-label="Quitar del episodio"
        onClick={onUnlink}
      >
        <Unlink size={13} />
      </button>
    </div>
  );
}

function TaskRow({ entry: e, onToggle }: { entry: Entry; onToggle: () => void }) {
  const { workspace } = useApp();
  const k = commitmentOf(e);
  const cm = commitmentKinds[k];
  const who = workspace.people.find(
    (p) => p.id === (e.details.beneficiary ?? e.details.owner ?? e.person_ids[0]),
  );
  return (
    <div className="ep-task" style={{ '--c': cm.color, '--s': cm.soft } as CSSProperties}>
      <button type="button" className="pp-check" aria-label="Completar" onClick={onToggle}>
        <Check size={13} />
      </button>
      <div>
        <strong>{e.title}</strong>
        <small>
          <cm.icon size={11} /> {cm.short}
          {who && ` · ${who.name.split(' ')[0]}`}
          {e.details.due && ` · ${friendlyDate(e.details.due)}`}
        </small>
      </div>
    </div>
  );
}

/** Enlaza recuerdos sueltos: primero los de esas fechas y personas; también por búsqueda. */
function LinkPicker({ episode }: { episode: Episode }) {
  const { workspace, linkEntries } = useApp();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const list = candidateEntries(episode, workspace.entries, q);
  return (
    <div className="ep-picker">
      <label className="pk-search">
        <Search size={15} />
        <input
          value={q}
          placeholder="Buscar recuerdos sueltos…"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {!q && list.length > 0 && (
        <small className="ep-muted">
          <Sparkles size={12} /> Sugeridos por fechas y personas
        </small>
      )}
      <div className="ep-picker-list">
        {list.map((e) => {
          const on = picked.includes(e.id);
          const km = kindMeta[e.kind];
          return (
            <button
              type="button"
              key={e.id}
              className={'ep-pick' + (on ? ' on' : '')}
              onClick={() => setPicked((l) => (on ? l.filter((x) => x !== e.id) : [...l, e.id]))}
            >
              <km.icon size={14} />
              <span>
                <strong>{e.title}</strong>
                <small>
                  {e.kind} · {shortDate(e.created_at)}
                </small>
              </span>
              <i className={'pk-tick' + (on ? ' on' : '')}>
                <Check size={12} strokeWidth={3} />
              </i>
            </button>
          );
        })}
        {!list.length && (
          <p className="pp-empty">
            {q ? 'Nada coincide.' : 'No hay recuerdos sueltos cerca de estas fechas.'}
          </p>
        )}
      </div>
      {picked.length > 0 && (
        <button
          type="button"
          className="pp-btn dark"
          onClick={async () => {
            if (await linkEntries(picked, episode.id)) setPicked([]);
          }}
        >
          <Link2 size={14} /> Enlazar {picked.length}
        </button>
      )}
    </div>
  );
}
