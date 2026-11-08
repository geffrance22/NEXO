import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  Activity,
  ArrowDownUp,
  ArrowUpDown,
  Bell,
  BellPlus,
  Cake,
  ChevronDown,
  ChevronRight,
  Flower2,
  Sparkles,
  UsersRound,
  CircleCheck,
  CircleUserRound,
  Clock,
  LayoutGrid,
  List,
  Layers,
  MessageCircleWarning,
  Plus,
  Search,
  Settings2,
  Star,
  StickyNote,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Group, Person, Relation } from '../data';
import { PageHeading } from '../components/PageHeading';
import { groupKinds, groupsOf } from '../lib/relations';
import { normalizeText } from '../lib/format';
import {
  interestsOf,
  isReachable,
  relationMeta,
  relationOf,
  relativeDay,
  remindersFor,
  searchText,
  statsFor,
  statusMeta,
  type PersonStats,
} from '../lib/people';
import { Avatar } from '../people/Avatar';
import { BondRing } from '../people/PersonPanel';
import { DuplicatesDialog, useDuplicates } from '../people/MergeDialog';
import { GroupActions } from '../relations/GroupActions';
import { PersonMenu } from '../people/PersonMenu';
import { PersonPanel } from '../people/PersonPanel';
import { BirthdaysDialog } from '../people/BirthdaysDialog';
import { SuggestionsDialog, useSuggestions } from '../relations/Suggestions';
import { GroupManager } from '../relations/GroupManager';
import { GroupPicker, groupVars } from '../relations/GroupPicker';
import { markSeen, useSeen } from '../relations/dismissed';
import '../people/people.css';

type TabId = 'todos' | 'favoritos' | 'contactar' | Relation;
type Sort = 'reciente' | 'vinculo' | 'olvidados' | 'nombre' | 'nuevos';
type View = 'grid' | 'faces' | 'list';
const tabs: { id: TabId; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'favoritos', label: 'Favoritos' },
  { id: 'familia', label: 'Familia' },
  { id: 'pareja', label: 'Pareja' },
  { id: 'amistad', label: 'Amistad' },
  { id: 'trabajo', label: 'Trabajo' },
  { id: 'contactar', label: 'Por contactar' },
];
const sorts: { id: Sort; label: string }[] = [
  { id: 'reciente', label: 'Más reciente' },
  { id: 'vinculo', label: 'Vínculo más fuerte' },
  { id: 'olvidados', label: 'Hace más tiempo' },
  { id: 'nombre', label: 'Nombre' },
  { id: 'nuevos', label: 'Añadidos hace poco' },
];
const views: { id: View; label: string; icon: typeof List }[] = [
  { id: 'grid', label: 'Tarjetas', icon: LayoutGrid },
  { id: 'faces', label: 'Caras', icon: CircleUserRound },
  { id: 'list', label: 'Lista', icon: List },
];
const storedView = (): View => {
  const v = localStorage.getItem('nexo-people-view');
  return v === 'list' || v === 'faces' ? v : 'grid';
};

type Row = { person: Person; stats: PersonStats; groups: Group[] };
type ItemProps = { row: Row; active: boolean; onOpen: () => void };

const varsOf = (p: Person) => {
  const m = relationMeta[relationOf(p)];
  return { '--accent': m.color, '--soft': m.soft, '--ink': m.ink } as CSSProperties;
};
const openOnEnter = (onOpen: () => void) => (e: ReactKeyboardEvent) => {
  if (e.key === 'Enter' && e.target === e.currentTarget) onOpen();
};

/** Índice de vínculo; para quien ya no está, una flor en su lugar. */
function Bond({ row, size }: { row: Row; size: number }) {
  if (row.person.profile.status === 'memoria')
    return (
      <span
        className="pp-ring pp-ring-memory"
        style={{ width: size, height: size }}
        title="En memoria"
      >
        <Flower2 size={Math.round(size * 0.42)} />
      </span>
    );
  return <BondRing value={row.stats.bond} size={size} />;
}

function PersonCard({ row, active, onOpen }: ItemProps) {
  const { openEntry, patchPerson, quickPerson } = useApp();
  const { person: p, stats: s } = row;
  const meta = relationMeta[relationOf(p)];
  const fav = Boolean(p.profile.favorite);
  const n = s.interactions.length;
  // Accesos directos de la tarjeta: cuatro en una sola línea.
  const actions = [
    {
      icon: Plus,
      label: 'Recuerdo',
      title: 'Añadir un recuerdo',
      run: () => openEntry(undefined, [p.id]),
    },
    {
      icon: BellPlus,
      label: 'Recordar',
      title: 'Recordarme algo sobre esta persona',
      run: () => openEntry('Pendiente', [p.id]),
    },
    {
      icon: Activity,
      label: 'Novedad',
      title: '¿Qué hay de nuevo en su vida?',
      run: () => quickPerson(p, 'novedad'),
    },
    { icon: StickyNote, label: 'Nota', title: 'Nota rápida', run: () => quickPerson(p, 'nota') },
  ];
  return (
    <article
      className={'pc' + (active ? ' active' : '')}
      style={varsOf(p)}
      onClick={onOpen}
      onKeyDown={openOnEnter(onOpen)}
      tabIndex={0}
      aria-label={`Abrir ficha de ${p.name}`}
    >
      <header>
        <Avatar person={p} size={44} />
        <div className="pc-id">
          <h3>{p.name}</h3>
          <span>{p.role || meta.label}</span>
        </div>
        <div className="pc-tools" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="pp-icon-btn"
            aria-label={`Dar o recibir con ${p.name.split(' ')[0]}`}
            title="Dar o recibir"
            onClick={() => quickPerson(p, 'dar')}
          >
            <ArrowUpDown size={15} />
          </button>
          <button
            type="button"
            className={'pp-icon-btn' + (fav ? ' fav' : '')}
            aria-label={fav ? 'Quitar de favoritos' : 'Marcar favorito'}
            aria-pressed={fav}
            onClick={() => void patchPerson(p, { profile: { ...p.profile, favorite: !fav } }, true)}
          >
            <Star size={15} />
          </button>
          <PersonMenu person={p} />
        </div>
      </header>
      <div className="pp-chips small">
        <span className="rel">{meta.label}</span>
        {p.profile.status && (
          <span className={'st ' + p.profile.status}>
            {p.profile.status === 'memoria' && <Flower2 size={11} />}
            {statusMeta[p.profile.status].short}
          </span>
        )}
        {row.groups.slice(0, 2).map((g) => {
          const gm = groupKinds[g.kind] ?? groupKinds.otro;
          return (
            <span
              key={g.id}
              className="grp"
              style={{ '--c': gm.color, '--s': gm.soft } as CSSProperties}
            >
              <gm.icon size={11} /> {g.name}
            </span>
          );
        })}
        {interestsOf(p)
          .slice(0, row.groups.length ? 1 : 2)
          .map((t) => (
            <span key={t}>{t}</span>
          ))}
        {s.birthdayIn !== null && s.birthdayIn <= 14 && (
          <span className="warm">
            <Cake size={11} /> {s.birthdayIn === 0 ? 'Hoy' : `En ${s.birthdayIn} d`}
          </span>
        )}
        {s.overdue && (
          <span className="alert">
            <MessageCircleWarning size={11} /> Escríbele
          </span>
        )}
      </div>
      <div className="pc-meta">
        <Bond row={row} size={34} />
        <div>
          <span>
            <Clock size={12} /> <b>{relativeDay(s.last)}</b>
            {n > 0 && ` · ${n} ${n === 1 ? 'recuerdo' : 'recuerdos'}`}
          </span>
          <small className={'recip ' + s.reciprocity.state}>{s.reciprocity.label}</small>
        </div>
      </div>
      {s.nextPending && (
        <p className="pc-next">
          <CircleCheck size={13} /> <span>{s.nextPending.title}</span>
        </p>
      )}
      <footer className="pc-actions" onClick={(e) => e.stopPropagation()}>
        {actions.map((a) => (
          <button type="button" key={a.label} title={a.title} aria-label={a.title} onClick={a.run}>
            <a.icon size={17} />
            <span>{a.label}</span>
          </button>
        ))}
      </footer>
    </article>
  );
}

/** Vista «Caras»: solo foto y nombre, para encontrar a alguien de un vistazo. */
function PersonFace({ row, active, onOpen }: ItemProps) {
  const { person: p, stats: s } = row;
  const meta = relationMeta[relationOf(p)];
  const soon = s.birthdayIn !== null && s.birthdayIn <= 14;
  return (
    <div
      className={'pf' + (active ? ' active' : '')}
      style={varsOf(p)}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={openOnEnter(onOpen)}
      aria-label={`Abrir ficha de ${p.name}`}
    >
      <span className="pf-face">
        <Avatar person={p} size={72} />
        {p.profile.favorite && (
          <i className="pf-badge fav" title="Favorita">
            <Star size={11} />
          </i>
        )}
        {p.profile.status === 'memoria' && (
          <i className="pf-badge mem" title="En memoria">
            <Flower2 size={11} />
          </i>
        )}
        {(soon || s.overdue) && (
          <i
            className={'pf-badge ' + (soon ? 'cake' : 'alert')}
            title={soon ? 'Cumpleaños pronto' : 'Hace tiempo que no hablan'}
          >
            {soon ? <Cake size={11} /> : <MessageCircleWarning size={11} />}
          </i>
        )}
      </span>
      <strong>{p.name}</strong>
      <small>{p.role || meta.label}</small>
      <span className="pf-menu" onClick={(e) => e.stopPropagation()}>
        <PersonMenu person={p} />
      </span>
    </div>
  );
}

function PersonRow({ row, active, onOpen }: ItemProps) {
  const { person: p, stats: s } = row;
  const meta = relationMeta[relationOf(p)];
  return (
    <div
      className={'pr' + (active ? ' active' : '')}
      style={varsOf(p)}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={openOnEnter(onOpen)}
    >
      <Avatar person={p} size={36} />
      <span className="pr-name">
        <strong>
          {p.name} {p.profile.favorite && <Star size={12} className="pp-star-on" />}
        </strong>
        <small>{p.role || meta.label}</small>
      </span>
      <span className="pr-rel">{meta.label}</span>
      <span className="pr-last">{relativeDay(s.last)}</span>
      <span className="pr-pend">{s.nextPending?.title ?? '—'}</span>
      <Bond row={row} size={30} />
      <span onClick={(e) => e.stopPropagation()}>
        <PersonMenu person={p} />
      </span>
    </div>
  );
}

export function PeoplePage() {
  const { workspace, selected, openPerson, toggleEntry, patchPerson } = useApp();
  // Filtro por grupo: puedes elegir varios (sale quien esté en cualquiera de ellos).
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groupPick, setGroupPick] = useState(false);
  const [manage, setManage] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabId>('todos');
  const [sort, setSort] = useState<Sort>('reciente');
  const [view, setView] = useState<View>(storedView);
  const [peek, setPeek] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'cumples' | 'sugerencias' | 'duplicados' | null>(null);
  const duplicates = useDuplicates();
  const [remOpen, setRemOpen] = useState(() => localStorage.getItem('nexo-reminders') === 'open');
  const suggestions = useSuggestions();
  const seen = useSeen();
  const slot = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => localStorage.setItem('nexo-people-view', view), [view]);
  useEffect(() => localStorage.setItem('nexo-reminders', remOpen ? 'open' : 'closed'), [remOpen]);

  const rows = useMemo<Row[]>(
    () =>
      workspace.people.map((p) => ({
        person: p,
        stats: statsFor(p, workspace.entries),
        groups: groupsOf(p.id, workspace.groups),
      })),
    [workspace],
  );
  // Los 10 más próximos (vencidos y de hoy primero).
  const reminders = useMemo(
    () => remindersFor(workspace.people, workspace.entries).slice(0, 10),
    [workspace],
  );
  const peekPerson = workspace.people.find((p) => p.id === peek) ?? null;
  // Solo los grupos que siguen existiendo (si borras uno, deja de filtrar).
  const activeGroups = workspace.groups.filter((g) => groupIds.includes(g.id));
  const inGroups = activeGroups.length ? new Set(activeGroups.flatMap((g) => g.member_ids)) : null;

  // La ficha lateral es fija (bajo la barra superior) y se alinea con su columna de la cuadrícula.
  useLayoutEffect(() => {
    const el = slot.current;
    if (!peekPerson || !el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((b) =>
        b && b.left === r.left && b.width === r.width ? b : { left: r.left, width: r.width },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [peekPerson]);

  // Esc cierra el panel lateral.
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.sheet, .confirm-backdrop, .nx-peek'))
        setPeek(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [peek]);

  if (selected) {
    return (
      <div className="pp-page full">
        <PersonPanel person={selected} variant="full" />
      </div>
    );
  }

  const needle = normalizeText(query.trim());
  const matchTab = (r: Row) =>
    tab === 'todos'
      ? true
      : tab === 'favoritos'
        ? Boolean(r.person.profile.favorite)
        : tab === 'contactar'
          ? r.stats.overdue
          : relationOf(r.person) === tab;
  const counts = Object.fromEntries(tabs.map((t) => [t.id, 0])) as Record<TabId, number>;
  for (const r of rows) {
    for (const t of tabs) {
      if (
        t.id === 'todos' ||
        (t.id === 'favoritos' && r.person.profile.favorite) ||
        (t.id === 'contactar' && r.stats.overdue) ||
        relationOf(r.person) === t.id
      ) {
        counts[t.id]++;
      }
    }
  }
  const visible = rows
    .filter(
      (r) =>
        matchTab(r) &&
        (!inGroups || inGroups.has(r.person.id)) &&
        (!needle || searchText(r.person).includes(needle)),
    )
    .sort((a, b) => {
      switch (sort) {
        case 'reciente':
          return (b.stats.last ?? '').localeCompare(a.stats.last ?? '');
        case 'vinculo':
          return (
            Number(isReachable(b.person)) - Number(isReachable(a.person)) ||
            b.stats.bond - a.stats.bond
          );
        case 'olvidados':
          // Con quien ya no estás en contacto no es «olvido»: va al final.
          return (
            Number(isReachable(b.person)) - Number(isReachable(a.person)) ||
            (b.stats.daysSince ?? 1e6) - (a.stats.daysSince ?? 1e6)
          );
        case 'nombre':
          return a.person.name.localeCompare(b.person.name, 'es');
        case 'nuevos':
          return b.person.created_at.localeCompare(a.person.created_at);
      }
    });

  const birthdays = rows.filter((r) => r.stats.birthdayIn !== null && r.stats.birthdayIn <= 30);
  // Solo cuenta lo que falta resolver (los deducidos ya se ven solos en la red y el árbol).
  const pending = suggestions.length;
  const fresh = suggestions.some((s) => !seen.has(s.id));
  const summary: {
    icon: typeof Users;
    value: number;
    label: string;
    tab?: TabId;
    onClick?: () => void;
    tone?: 'alert' | 'sug' | 'sug fresh';
  }[] = [
    {
      icon: Users,
      value: rows.length,
      label: rows.length === 1 ? 'persona' : 'personas',
      tab: 'todos',
    },
    { icon: Star, value: counts.favoritos, label: 'favoritas', tab: 'favoritos' },
    {
      icon: Cake,
      value: birthdays.length,
      label: 'cumpleaños en 30 días',
      onClick: () => setDialog('cumples'),
    },
    {
      icon: MessageCircleWarning,
      value: counts.contactar,
      label: 'por contactar',
      tab: 'contactar',
      tone: counts.contactar > 0 ? 'alert' : undefined,
    },
    ...(duplicates.length > 0
      ? [
          {
            icon: UsersRound,
            value: duplicates.length,
            label: duplicates.length === 1 ? 'posible duplicado' : 'posibles duplicados',
            onClick: () => setDialog('duplicados'),
            tone: 'sug' as const,
          },
        ]
      : []),
    ...(pending > 0
      ? [
          {
            icon: Sparkles,
            value: pending,
            label: pending === 1 ? 'vínculo por confirmar' : 'vínculos por confirmar',
            onClick: () => {
              markSeen(suggestions.map((s) => s.id));
              setDialog('sugerencias');
            },
            tone: fresh ? ('sug fresh' as const) : ('sug' as const),
          },
        ]
      : []),
  ];
  const open = (id: string) => setPeek(id);
  const Item = view === 'faces' ? PersonFace : view === 'list' ? PersonRow : PersonCard;

  return (
    <div className={'pp-page' + (peekPerson ? ' with-drawer' : '')}>
      <div className="pp-main">
        <PageHeading />

        <div className="pp-summary">
          {summary.map((k) => {
            const body = (
              <>
                <k.icon size={14} /> <b>{k.value}</b> {k.label}
              </>
            );
            return (
              <button
                type="button"
                key={k.label}
                className={
                  (k.tab && tab === k.tab && k.tab !== 'todos' ? 'on' : '') +
                  (k.tone ? ' ' + k.tone : '')
                }
                onClick={k.onClick ?? (() => setTab(tab === k.tab ? 'todos' : k.tab!))}
              >
                {body}
              </button>
            );
          })}
        </div>

        <div className="pp-bar">
          <label className="pp-search">
            <Search size={16} />
            <input
              id="search"
              placeholder="Buscar por nombre, interés, ciudad…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="pp-sort" title="Ordenar">
            <ArrowDownUp size={14} />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Ordenar"
            >
              {sorts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="pp-view" role="radiogroup" aria-label="Vista">
            {views.map((v) => (
              <button
                type="button"
                role="radio"
                key={v.id}
                aria-checked={view === v.id}
                className={view === v.id ? 'on' : ''}
                onClick={() => setView(v.id)}
                aria-label={v.label}
                title={v.label}
              >
                <v.icon size={16} />
              </button>
            ))}
          </div>
        </div>

        <div className="pp-filters">
          <div className="pp-pills" role="tablist" aria-label="Relación">
            {tabs
              .filter((t) => t.id === 'todos' || t.id === 'favoritos' || counts[t.id] > 0)
              .map((t) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  key={t.id}
                  className={'pp-pill' + (tab === t.id ? ' on' : '')}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  <i>{counts[t.id]}</i>
                </button>
              ))}
          </div>
          <div className="pp-pills" role="group" aria-label="Grupos">
            {workspace.groups.length > 0 && (
              <button
                type="button"
                aria-haspopup="dialog"
                className={
                  'pp-pill gp-filter' +
                  (activeGroups.length === 1 ? ' one' : activeGroups.length ? ' on' : '')
                }
                style={activeGroups.length === 1 ? groupVars(activeGroups[0].kind) : undefined}
                title="Filtrar por grupo"
                onClick={() => setGroupPick(true)}
              >
                {activeGroups.length === 1 ? (
                  (() => {
                    const Icon = (groupKinds[activeGroups[0].kind] ?? groupKinds.otro).icon;
                    return <Icon size={13} />;
                  })()
                ) : (
                  <Layers size={13} />
                )}
                {activeGroups.length === 0
                  ? 'Grupo'
                  : activeGroups.length === 1
                    ? activeGroups[0].name
                    : `${activeGroups.length} grupos`}
                {activeGroups.length > 0 ? <i>{inGroups?.size ?? 0}</i> : <ChevronDown size={13} />}
              </button>
            )}
            {activeGroups.length > 0 && (
              <button
                type="button"
                className="pp-pill icon"
                aria-label="Quitar el filtro de grupo"
                title="Quitar el filtro"
                onClick={() => setGroupIds([])}
              >
                <X size={13} />
              </button>
            )}
            <button type="button" className="pp-pill add" onClick={() => setManage(true)}>
              {workspace.groups.length ? (
                <>
                  <Settings2 size={13} /> Gestionar grupos
                </>
              ) : (
                <>
                  <Plus size={13} /> Crear un grupo
                </>
              )}
            </button>
          </div>
        </div>

        {activeGroups.length === 1 &&
          (() => {
            const g = activeGroups[0];
            const gm = groupKinds[g.kind] ?? groupKinds.otro;
            const n = inGroups?.size ?? 0;
            return (
              <div className="ga-bar" style={groupVars(g.kind)}>
                <div className="ga-bar-id">
                  <span className="pk-tile">
                    <gm.icon size={17} />
                  </span>
                  <span>
                    <strong>{g.name}</strong>
                    <small>
                      {n} {n === 1 ? 'persona' : 'personas'}
                    </small>
                  </span>
                </div>
                <GroupActions group={g} />
              </div>
            );
          })()}

        {visible.length > 0 &&
          (view === 'list' ? (
            <div className="pp-list">
              <div className="pr head">
                <span />
                <span>Nombre</span>
                <span className="pr-rel">Relación</span>
                <span className="pr-last">Última vez</span>
                <span className="pr-pend">Pendiente</span>
                <span>Vínculo</span>
                <span />
              </div>
              {visible.map((r) => (
                <Item
                  key={r.person.id}
                  row={r}
                  active={peek === r.person.id}
                  onOpen={() => open(r.person.id)}
                />
              ))}
            </div>
          ) : (
            <div className={view === 'faces' ? 'pp-faces' : 'pp-grid'}>
              {visible.map((r) => (
                <Item
                  key={r.person.id}
                  row={r}
                  active={peek === r.person.id}
                  onOpen={() => open(r.person.id)}
                />
              ))}
            </div>
          ))}

        {!visible.length && (
          <div className="pp-empty-state">
            <Users size={30} />
            <h3>
              {rows.length
                ? 'Nadie coincide con ese filtro.'
                : 'Tu universo empieza con una persona.'}
            </h3>
            {!rows.length && (
              <button type="button" className="pp-btn dark" onClick={() => openPerson()}>
                <Plus size={15} /> Añadir la primera
              </button>
            )}
          </div>
        )}

        {reminders.length > 0 && (
          <section className={'pp-reminders' + (remOpen ? ' open' : '')}>
            <button
              type="button"
              className="pp-rem-head"
              aria-expanded={remOpen}
              onClick={() => setRemOpen((v) => !v)}
            >
              <Bell size={15} /> Próximos recordatorios <i>{reminders.length}</i>
              {!remOpen && (
                <span className="pp-rem-next">
                  {reminders[0].title} · {reminders[0].when}
                </span>
              )}
              <ChevronDown size={16} className="pp-rem-chev" />
            </button>
            {remOpen &&
              reminders.map((r) => (
                <div className={'pp-reminder ' + r.kind} key={r.id}>
                  {r.kind === 'pendiente' && r.entry ? (
                    <button
                      type="button"
                      className="pp-check"
                      aria-label="Completar"
                      onClick={() => toggleEntry(r.entry!)}
                    >
                      <CircleCheck size={14} />
                    </button>
                  ) : r.kind === 'seguimiento' && r.update ? (
                    <button
                      type="button"
                      className="pp-check"
                      aria-label="Ya le pregunté"
                      title="Ya le pregunté"
                      onClick={() => {
                        const p = r.person;
                        const id = r.update!.id;
                        void patchPerson(
                          p,
                          {
                            profile: {
                              ...p.profile,
                              updates: (p.profile.updates ?? []).map((u) =>
                                u.id === id ? { ...u, done: true } : u,
                              ),
                            },
                          },
                          true,
                        );
                      }}
                    >
                      <CircleCheck size={14} />
                    </button>
                  ) : r.kind === 'cumple' ? (
                    <Cake size={16} />
                  ) : r.kind === 'recuerdo' ? (
                    <Flower2 size={16} />
                  ) : (
                    <MessageCircleWarning size={16} />
                  )}
                  <button
                    type="button"
                    className="pp-reminder-main"
                    onClick={() => open(r.person.id)}
                  >
                    <span>{r.title}</span>
                    <small>{r.when}</small>
                    <ChevronRight size={15} />
                  </button>
                </div>
              ))}
          </section>
        )}
      </div>

      {peekPerson && <div className="pp-drawer-slot" ref={slot} aria-hidden="true" />}
      {peekPerson && (
        <aside
          className="pp-drawer"
          aria-label={`Ficha de ${peekPerson.name}`}
          style={
            box
              ? ({ '--dl': box.left + 'px', '--dw': box.width + 'px' } as CSSProperties)
              : undefined
          }
        >
          <PersonPanel
            key={peekPerson.id}
            person={peekPerson}
            variant="drawer"
            onClose={() => setPeek(null)}
          />
        </aside>
      )}
      {dialog === 'cumples' && (
        <BirthdaysDialog
          onClose={() => setDialog(null)}
          onOpen={(id) => {
            setDialog(null);
            setPeek(id);
          }}
        />
      )}
      {dialog === 'sugerencias' && <SuggestionsDialog onClose={() => setDialog(null)} />}
      {dialog === 'duplicados' && <DuplicatesDialog onClose={() => setDialog(null)} />}
      {groupPick && (
        <GroupPicker
          title="Filtrar por grupo"
          hint="Elige uno o varios: verás a quien esté en cualquiera"
          selected={groupIds}
          onToggle={(id) =>
            setGroupIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
          }
          footer={
            <button
              type="button"
              className="gp-foot-link"
              onClick={() => {
                setGroupPick(false);
                setManage(true);
              }}
            >
              <Settings2 size={14} /> Gestionar grupos
            </button>
          }
          onClose={() => setGroupPick(false)}
        />
      )}
      {manage && <GroupManager onClose={() => setManage(false)} />}
    </div>
  );
}
