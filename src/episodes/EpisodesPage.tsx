import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowUpDown,
  Banknote,
  CalendarClock,
  CalendarDays,
  Camera,
  Check,
  CircleAlert,
  CircleCheck,
  History,
  Layers,
  Link2,
  ListChecks,
  MapPin,
  Pencil,
  Play,
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
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { PhotoThumbs } from '../components/PhotoThumbs';
import { EmbedBar } from '../components/EmbedBar';
import { kindMeta } from '../composer/kinds';
import type { Entry, Episode, EpisodeKind, Person } from '../data';
import { commitmentKinds, commitmentOf } from '../lib/commitments';
import {
  candidateEntries,
  episodeKindOf,
  episodeKinds,
  episodeSummary,
  lastActivity,
  relatedEpisodes,
  type EpisodeKindMeta,
  type EpisodeSummary,
} from '../lib/episodes';
import { friendlyDate, money, normalizeText, shortDate, todayInputValue } from '../lib/format';
import { daysBetween } from '../lib/people';
import { updateKinds } from '../lib/updates';
import { Avatar } from '../people/Avatar';
import { EpisodeGallery, EpisodeLog, RelatedEpisodes } from './EpisodeParts';
import './episodes.css';

const range = (from: string | null, to: string | null) => {
  if (!from) return 'Sin fecha';
  const f = (d: string) => shortDate(d + 'T12:00:00');
  return to && to !== from ? `${f(from)} – ${f(to)}` : f(from);
};
const day = (iso: string) => todayInputValue(new Date(iso));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Tab = 'activo' | 'cerrado';
type Sort = 'fecha' | 'actividad' | 'gasto';
const sortLabels: Record<Sort, string> = {
  fecha: 'Por fecha',
  actividad: 'Última actividad',
  gasto: 'Mayor gasto',
};
/** Un episodio activo sin nada nuevo en estos días se marca como «sin novedades». */
const QUIET_DAYS = 21;
/** Tipos para empezar rápido cuando aún no hay episodios. */
const STARTERS: EpisodeKind[] = [
  'viaje',
  'celebracion',
  'proyecto',
  'evento',
  'estudio',
  'salud',
  'mudanza',
  'negocio',
];

/** Un episodio con lo que se calcula una sola vez para la lista. */
type Row = {
  ep: Episode;
  s: EpisodeSummary;
  kind: EpisodeKindMeta;
  /** Último día con actividad (AAAA-MM-DD). */
  last: string;
  /** Primer día (o el de creación si no tiene fecha). */
  start: string;
  /** Texto normalizado para buscar. */
  text: string;
};

/** Episodios: cada uno reúne recuerdos, personas, lugares, dinero, tareas y aprendizajes. */
export function EpisodesPage() {
  const { selectedEpisode } = useApp();
  return selectedEpisode ? <EpisodeDetail episode={selectedEpisode} /> : <EpisodesList />;
}

/** Panel general: resumen, «En curso» y «Cerrados», búsqueda, tipos y orden. */
function EpisodesList() {
  const { workspace, openEpisode, openCapture, experiencesMissing } = useApp();
  const today = todayInputValue();
  const year = today.slice(0, 4);

  const rows = useMemo<Row[]>(
    () =>
      workspace.episodes.map((ep) => {
        const s = episodeSummary(ep, workspace.entries, workspace.people, workspace.places);
        const kind = episodeKindOf(ep.kind);
        return {
          ep,
          s,
          kind,
          last: lastActivity(ep, s.items),
          start: s.from ?? day(ep.created_at),
          text: normalizeText(
            [
              ep.title,
              ep.summary,
              ep.outcome,
              kind.label,
              ...s.people.map((p) => p.name),
              ...s.places.map((p) => p.name),
            ].join(' '),
          ),
        };
      }),
    [workspace],
  );
  const counts = {
    activo: rows.filter((r) => r.ep.status === 'activo').length,
    cerrado: rows.filter((r) => r.ep.status === 'cerrado').length,
  };
  // Abre en «En curso»; si no hay nada en curso pero sí cerrados, en «Cerrados».
  const [tab, setTab] = useState<Tab>(() =>
    !counts.activo && counts.cerrado ? 'cerrado' : 'activo',
  );
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('fecha');

  // ── Resumen de todos los episodios ──
  const active = rows.filter((r) => r.ep.status === 'activo');
  const upcoming = active
    .filter((r) => r.s.startsIn !== null)
    .sort((a, b) => a.start.localeCompare(b.start));
  const thisYear = rows.filter((r) => r.start.startsWith(year));
  const spentYear = thisYear.reduce((sum, r) => sum + r.s.spent, 0);
  const overBudget = active.filter((r) => r.ep.budget && r.s.spent > r.ep.budget).length;
  const openTasks = active.reduce((sum, r) => sum + r.s.open.length, 0);
  const withTasks = active.filter((r) => r.s.open.length).length;
  const daysYear = thisYear.reduce((sum, r) => sum + (r.s.days ?? 0), 0);
  const companions = new Map<string, { person: Person; n: number }>();
  for (const r of rows)
    for (const p of r.s.people)
      companions.set(p.id, { person: p, n: (companions.get(p.id)?.n ?? 0) + 1 });
  const top = [...companions.values()].sort((a, b) => b.n - a.n)[0];
  const next = upcoming[0];
  const stats: { icon: LucideIcon; value: string; label: string; sub?: string; tone?: string }[] = [
    {
      icon: Play,
      value: String(active.length - upcoming.length),
      label: 'en marcha',
      sub: next
        ? `Próximo: ${next.ep.title} · ${next.s.startsIn === 1 ? 'mañana' : `en ${next.s.startsIn} días`}`
        : 'Nada por empezar',
    },
    {
      icon: CalendarDays,
      value: String(thisYear.length),
      label: `${thisYear.length === 1 ? 'episodio' : 'episodios'} en ${year}`,
      sub: daysYear ? `${plural(daysYear, 'día', 'días')} de historias` : undefined,
    },
    {
      icon: TrendingDown,
      value: money(spentYear),
      label: `gastado en ${year}`,
      sub: overBudget
        ? `${plural(overBudget, 'episodio pasado', 'episodios pasados')} de presupuesto`
        : undefined,
      tone: overBudget ? 'warn' : undefined,
    },
    {
      icon: ListChecks,
      value: String(openTasks),
      label: openTasks === 1 ? 'pendiente abierto' : 'pendientes abiertos',
      sub: withTasks ? `en ${plural(withTasks, 'episodio', 'episodios')}` : 'Todo al día',
    },
    {
      icon: Users,
      value: String(companions.size),
      label: companions.size === 1 ? 'persona' : 'personas',
      sub: top ? `Más con ${top.person.name.split(' ')[0]} (${top.n})` : undefined,
    },
  ];

  // ── Lista de la pestaña ──
  const inTab = rows.filter((r) => r.ep.status === tab);
  const kindsHere = [...new Map(inTab.map((r) => [r.ep.kind, r.kind])).entries()]
    .map(([key, meta]) => ({ key, meta, n: inTab.filter((r) => r.ep.kind === key).length }))
    .sort((a, b) => b.n - a.n || a.meta.label.localeCompare(b.meta.label, 'es'));
  const kindOn = kindsHere.some((k) => k.key === kindFilter) ? kindFilter : null;
  const needle = normalizeText(query.trim());
  const shown = inTab.filter(
    (r) => (!kindOn || r.ep.kind === kindOn) && (!needle || r.text.includes(needle)),
  );
  const sorters: Record<Sort, (a: Row, b: Row) => number> = {
    fecha: (a, b) => b.start.localeCompare(a.start),
    actividad: (a, b) => b.last.localeCompare(a.last) || b.start.localeCompare(a.start),
    gasto: (a, b) => b.s.spent - a.s.spent || b.start.localeCompare(a.start),
  };
  let groups: { title: string; rows: Row[] }[];
  if (tab === 'activo') {
    // Lo que ya empezó, y aparte lo que viene (lo más cercano primero).
    groups = [
      {
        title: 'En marcha',
        rows: shown.filter((r) => r.s.startsIn === null).sort(sorters[sort]),
      },
      {
        title: 'Próximamente',
        rows: shown
          .filter((r) => r.s.startsIn !== null)
          .sort((a, b) => a.start.localeCompare(b.start)),
      },
    ].filter((g) => g.rows.length);
  } else if (sort === 'fecha') {
    // Cerrados por año, del más reciente al más antiguo.
    const years = new Map<string, Row[]>();
    for (const r of [...shown].sort(sorters.fecha)) {
      const y = (r.s.to ?? r.start).slice(0, 4);
      years.set(y, [...(years.get(y) ?? []), r]);
    }
    groups = [...years.entries()].map(([title, list]) => ({ title, rows: list }));
  } else {
    groups = [{ title: '', rows: [...shown].sort(sorters[sort]) }];
  }
  const showTitles = groups.length > 1 || tab === 'cerrado' || groups[0]?.title === 'Próximamente';
  const filtered = Boolean(needle || kindOn);

  if (experiencesMissing)
    return (
      <div className="pp-empty-state">
        <Layers size={30} />
        <h3>Los episodios necesitan la migración 008.</h3>
        <p>
          Ejecuta supabase/migrations/202611060008_experiences.sql en el SQL Editor de Supabase.
        </p>
      </div>
    );

  if (!rows.length)
    return (
      <div className="ep-empty">
        <span className="ep-empty-art">
          <Layers size={28} />
        </span>
        <h3>Tus historias completas vivirán aquí.</h3>
        <p>
          Un viaje, una celebración, una mudanza o un proyecto: cuéntalo y Nexo arma el episodio con
          sus personas, lugares, gastos y pendientes.
        </p>
        <div className="ep-empty-actions">
          <button type="button" className="pp-btn" onClick={() => openCapture()}>
            <Wand2 size={15} /> Capturar una experiencia
          </button>
          <button type="button" className="pp-btn dark" onClick={() => openEpisode()}>
            <Plus size={15} /> Nuevo episodio
          </button>
        </div>
        <div className="ep-empty-kinds">
          {STARTERS.map((k) => {
            const km = episodeKinds[k];
            return (
              <button
                type="button"
                key={k}
                style={{ '--kc': km.color, '--ks': km.soft } as CSSProperties}
                onClick={() => openEpisode(undefined, { kind: k })}
              >
                <km.icon size={15} /> {km.label}
              </button>
            );
          })}
        </div>
      </div>
    );

  return (
    <div className="ep-page">
      <div className="ep-stats">
        {stats.map((st) => (
          <div key={st.label} className={'ep-stat' + (st.tone ? ' ' + st.tone : '')}>
            <span className="ep-stat-icon">
              <st.icon size={16} />
            </span>
            <span className="ep-stat-text">
              <b>{st.value}</b>
              <span>{st.label}</span>
              {st.sub && <small title={st.sub}>{st.sub}</small>}
            </span>
          </div>
        ))}
      </div>

      <div className="ep-bar">
        <div className="pp-pills" role="tablist" aria-label="Estado de los episodios">
          {(['activo', 'cerrado'] as const).map((f) => (
            <button
              type="button"
              role="tab"
              key={f}
              aria-selected={tab === f}
              className={'pp-pill' + (tab === f ? ' on' : '')}
              onClick={() => setTab(f)}
            >
              {f === 'activo' ? 'En curso' : 'Cerrados'} <i>{counts[f]}</i>
            </button>
          ))}
        </div>
        <div className="ep-bar-tools">
          <label className="ep-search">
            <Search size={15} />
            <input
              type="search"
              value={query}
              placeholder="Buscar por nombre, persona o lugar"
              aria-label="Buscar episodios"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
            />
            {query && (
              <button type="button" aria-label="Borrar búsqueda" onClick={() => setQuery('')}>
                <X size={13} />
              </button>
            )}
          </label>
          <label className="ep-sort" title="Ordenar">
            <ArrowUpDown size={14} />
            <select
              value={sort}
              aria-label="Ordenar episodios"
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              {(Object.keys(sortLabels) as Sort[]).map((k) => (
                <option key={k} value={k}>
                  {sortLabels[k]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="pp-btn" onClick={() => openCapture()}>
            <Wand2 size={15} /> Capturar
          </button>
          <button type="button" className="pp-btn dark" onClick={() => openEpisode()}>
            <Plus size={15} /> Nuevo episodio
          </button>
        </div>
      </div>

      {kindsHere.length > 1 && (
        <div className="ep-kind-filter" role="group" aria-label="Filtrar por tipo">
          <button type="button" className={!kindOn ? 'on' : ''} onClick={() => setKindFilter(null)}>
            Todos los tipos
          </button>
          {kindsHere.map(({ key, meta, n }) => (
            <button
              type="button"
              key={key}
              className={kindOn === key ? 'on' : ''}
              style={{ '--kc': meta.color, '--ks': meta.soft } as CSSProperties}
              onClick={() => setKindFilter(kindOn === key ? null : key)}
            >
              <meta.icon size={13} /> {meta.label} <i>{n}</i>
            </button>
          ))}
        </div>
      )}

      {shown.length ? (
        groups.map((g) => (
          <section key={g.title || 'todos'} className="ep-group">
            {showTitles && g.title && (
              <h2 className="ep-group-title">
                {g.title} <i>{g.rows.length}</i>
              </h2>
            )}
            <div className="ep-grid">
              {g.rows.map((r) => (
                <EpisodeCard key={r.ep.id} row={r} today={today} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="ep-none">
          {filtered ? (
            <>
              <p>
                {needle ? `Nada coincide con «${query.trim()}»` : 'Nada de ese tipo'}
                {tab === 'activo' ? ' en curso.' : ' entre los cerrados.'}
              </p>
              <button
                type="button"
                className="pp-text-btn"
                onClick={() => {
                  setQuery('');
                  setKindFilter(null);
                }}
              >
                Quitar filtros
              </button>
            </>
          ) : tab === 'activo' ? (
            <>
              <p>No tienes nada en curso ahora mismo.</p>
              <button type="button" className="pp-text-btn" onClick={() => openEpisode()}>
                <Plus size={13} /> Empezar un episodio
              </button>
            </>
          ) : (
            <p>Aún no has cerrado ningún episodio. Ciérralos desde su ficha cuando terminen.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Cómo va un episodio: por empezar, en qué día va o cerrado. */
function cardStatus(
  ep: Episode,
  s: EpisodeSummary,
  today: string,
): { text: string; tone: 'soon' | 'live' | 'done' } {
  if (ep.status === 'cerrado') return { text: 'Cerrado', tone: 'done' };
  if (s.startsIn !== null)
    return { text: s.startsIn === 1 ? 'Empieza mañana' : `En ${s.startsIn} días`, tone: 'soon' };
  if (s.from) {
    const n = daysBetween(s.from, today) + 1;
    const total = ep.ends_on ? daysBetween(s.from, ep.ends_on) + 1 : null;
    if (total && n <= total) return { text: `Día ${n} de ${total}`, tone: 'live' };
    if (!total && n <= 60) return { text: `Día ${n}`, tone: 'live' };
  }
  return { text: 'En curso', tone: 'live' };
}

/** Lo que pide atención: ya terminó y sigue abierto, pendientes vencidos o mucho silencio. */
function cardFlag(
  ep: Episode,
  s: EpisodeSummary,
  last: string,
  today: string,
): { text: string; muted?: boolean } | null {
  if (ep.status !== 'activo') return null;
  if (ep.ends_on && ep.ends_on < today)
    return { text: `Terminó ${friendlyDate(ep.ends_on, today).toLowerCase()} · ¿lo cierras?` };
  const late = s.open.filter((e) => e.details.due && e.details.due < today).length;
  if (late) return { text: plural(late, 'pendiente vencido', 'pendientes vencidos') };
  if (s.startsIn === null) {
    const quiet = daysBetween(last, today);
    if (quiet >= QUIET_DAYS)
      return { text: `Sin novedades hace ${Math.round(quiet / 7)} semanas`, muted: true };
  }
  return null;
}

function EpisodeCard({ row, today }: { row: Row; today: string }) {
  const { workspace, go } = useApp();
  const { ep, s, kind: m, last } = row;
  const cover = s.photos[0];
  const related = relatedEpisodes(ep, workspace.episodes).length;
  const lastUpdate = [...ep.updates].sort((a, b) => b.date.localeCompare(a.date))[0];
  const status = cardStatus(ep, s, today);
  const flag = cardFlag(ep, s, last, today);
  const budgetPct = ep.budget ? Math.round((s.spent / ep.budget) * 100) : null;
  return (
    <button
      type="button"
      className={'ep-card ' + status.tone}
      style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
      onClick={() => go('Episodios', ep)}
    >
      <div className={'ep-card-cover' + (cover ? ' photo' : '')}>
        {cover ? (
          <img src={cover.medium ?? cover.url} alt="" loading="lazy" />
        ) : (
          <span className="ep-card-art">
            <m.icon size={30} strokeWidth={1.6} />
          </span>
        )}
        <span className="ep-card-kind">
          <m.icon size={12} /> {m.label}
        </span>
        <span className={'ep-status ' + status.tone}>
          {status.tone === 'live' && <i className="ep-live" aria-hidden="true" />}
          {status.text}
        </span>
      </div>
      <div className="ep-card-body">
        <small className="ep-card-when">
          <CalendarDays size={12} /> {range(s.from, s.to)}
          {ep.status === 'cerrado' && s.days && s.days > 1 ? ` · ${s.days} días` : ''}
        </small>
        <strong>{ep.title}</strong>
        {ep.summary && <p className="ep-card-sum">{ep.summary}</p>}
        {budgetPct !== null && (
          <div
            className={
              'ep-card-budget' + (budgetPct > 100 ? ' over' : budgetPct >= 80 ? ' warn' : '')
            }
          >
            <span>
              <b>{money(s.spent)}</b> de {money(ep.budget!)}
              <em>{budgetPct}%</em>
            </span>
            <i>
              <em style={{ width: Math.min(100, budgetPct) + '%' }} />
            </i>
          </div>
        )}
        <div className="ep-card-meta">
          <span>{plural(s.items.length, 'pieza', 'piezas')}</span>
          {s.photos.length > 0 && (
            <span title="Fotos">
              <Camera size={11} /> {s.photos.length}
            </span>
          )}
          {budgetPct === null && s.spent > 0 && <span>−{money(s.spent)}</span>}
          {s.earned > 0 && <span className="good">+{money(s.earned)}</span>}
          {s.open.length > 0 && (
            <span className="warn" title="Pendientes abiertos">
              <ListChecks size={11} /> {s.open.length}
            </span>
          )}
          {related > 0 && (
            <span title="Episodios relacionados">
              <Link2 size={11} /> {related}
            </span>
          )}
        </div>
        {flag ? (
          <p className={'ep-flag' + (flag.muted ? ' muted' : '')}>
            <CircleAlert size={12} /> {flag.text}
          </p>
        ) : (
          lastUpdate && (
            <p className="ep-card-last">
              <History size={12} /> {lastUpdate.text || 'Fotos nuevas'} ·{' '}
              {friendlyDate(lastUpdate.date, today)}
            </p>
          )
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

/**
 * La ficha de un episodio. Con `onClose` va dentro de una ventana (p. ej. desde un cuaderno): en
 * vez de «Episodios» lleva un acceso a la sección y un botón para cerrar.
 */
export function EpisodeDetail({
  episode: ep,
  onClose,
}: {
  episode: Episode;
  onClose?: () => void;
}) {
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
  const m = episodeKindOf(ep.kind);
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
      {onClose ? (
        <EmbedBar label="Abrir en Episodios" onOpen={() => go('Episodios', ep)} onClose={onClose} />
      ) : (
        <button type="button" className="pp-back" onClick={() => go('Episodios')}>
          <ArrowLeft size={15} /> Episodios
        </button>
      )}
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
