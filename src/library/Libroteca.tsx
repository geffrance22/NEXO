import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Library, Plus, Quote, Search, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { LoadMore, useInfinite } from '../components/LoadMore';
import type { Entry } from '../data';
import { isOpenTask } from '../lib/commitments';
import { normalizeText, todayInputValue } from '../lib/format';
import { Cuadernos } from '../cuadernos/Cuadernos';
import { Capturas } from '../capturas/Capturas';
import { useCapturas } from '../capturas/useCapturas';
import { NotebookView } from '../cuadernos/NotebookView';
import { useCuadernos } from '../cuadernos/useCuadernos';
import { Diary } from '../diary/Diary';
import { buildDays, streaks } from '../diary/model';
import { NotesBoard } from '../notes/NotesBoard';
import { noteText, useNotes } from '../notes/useNotes';
import { EmptyState, EntryCollection, ShelfChips, SortMenu, ViewSwitch } from './Collection';
import { useMediaBackfill } from './enrich';
import { Inicio } from './Inicio';
import { LetterboxdButton } from './LetterboxdImport';
import { MovieCalendarButton } from './MovieCalendar';
import { QuoteSheet, QuoteWall, countQuotes } from './Quotes';
import { ReadingGoal } from './ReadingGoal';
import { booksFinishedIn } from './goals';
import { useReadingShelf } from './ReadingShelf';
import { InicioSkeleton, StatsSkeleton, TabSkeleton } from './Skeletons';
import {
  entryTabs,
  rememberTab,
  requestedTab,
  searchText,
  sectionTabs,
  sortEntries,
  tabById,
  tabSummary,
  type ShelfSection,
  type SortId,
  type TabId,
  type ViewMode,
} from './shelf';
import './libroteca.css';

// Clave nueva: Películas arranca en «Tarjetas» aunque antes se hubiera elegido otra vista.
const VIEW_KEY = 'nexo-lib-view-2';
/** Tarjetas por tanda (las portadas y la lista cargan más, ver `useInfinite`). */
const PAGE = 40;
const PLAIN_VIEWS: ViewMode[] = ['tarjetas', 'lista'];
/** Pestañas que dicen «Todas» (el resto, «Todos»). */
const FEMININE = new Set<TabId>(['peliculas', 'series', 'notas']);
/** Pestañas con tarjetas de póster. */
const MEDIA_TABS = new Set<TabId>(['peliculas', 'series', 'libros']);
/** Lo que guarda Libroteca (lo demás vive en Agenda o en Finanzas). */
const isLibrary = (e: Entry) => e.kind === 'Película' || e.kind === 'Libro';

function loadViews(): Partial<Record<TabId, ViewMode>> {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/**
 * Libroteca: películas, series, libros, sus citas y tus notas libres. Con `noteId` abre esa nota
 * en la pestaña «Notas» (`nueva` abre el cuadro para escribir una).
 */
export function Libroteca({ noteId = null }: { noteId?: string | null }) {
  return <ShelfPage section="Libroteca" noteId={noteId} />;
}

/**
 * Agenda: tu diario y tu día a día (pendientes, encuentros, trabajo y aprendizajes), y los
 * cuadernos que lo reúnen. Con `notebookId`, abre ese cuaderno en su lienzo.
 */
export function Agenda({ notebookId }: { notebookId?: string | null }) {
  if (notebookId) return <NotebookView id={notebookId} />;
  return <ShelfPage section="Agenda" />;
}

/**
 * Una página con pestañas: cada pestaña tiene sus estantes, su orden, su vista (tarjetas, portadas
 * o lista) y su botón «Añadir». La primera pestaña de cada página es especial: «Inicio» en
 * Libroteca y «Pendientes» en Agenda.
 */
function ShelfPage({ section, noteId = null }: { section: ShelfSection; noteId?: string | null }) {
  const { workspace, openEntry, dataSettled, me } = useApp();
  const taste = useMemo(
    () => ({
      likes: [...(me.profile.interests ?? []), ...(me.profile.likes ?? [])],
      dislikes: me.profile.dislikes ?? [],
    }),
    [me.profile.interests, me.profile.likes, me.profile.dislikes],
  );
  const tabs = sectionTabs[section];
  const home = tabs[0].id;
  const [tab, setTab] = useState<TabId>(() =>
    noteId ? 'lienzo' : (requestedTab(section) ?? home),
  );
  const [query, setQuery] = useState('');
  // Filtrar listas largas no frena el teclado: el campo responde ya y la lista, en cuanto pueda.
  const deferredQuery = useDeferredValue(query);
  const [views, setViews] = useState(loadViews);
  const [sorts, setSorts] = useState<Partial<Record<TabId, SortId>>>({});
  const [shelves, setShelves] = useState<Partial<Record<TabId, string>>>({});
  const [quoteSheet, setQuoteSheet] = useState(false);
  const [creating, setCreating] = useState(false);
  const readings = useReadingShelf();
  const notebooks = useCuadernos();
  const capturas = useCapturas();
  const [uploadTick, setUploadTick] = useState(0);
  const notes = useNotes(section === 'Libroteca');
  const liveNotes = useMemo(
    () => (notes.notes ?? []).filter((n) => !n.archived && !n.vaulted),
    [notes.notes],
  );
  // Nota por abrir en «Notas» y avisos para abrir «Escribe una nota…».
  const [openNote, setOpenNote] = useState<string | null>(noteId === 'nueva' ? null : noteId);
  const [composeTick, setComposeTick] = useState(noteId === 'nueva' ? 1 : 0);
  // Cada pestaña sabe que estás en ella: al volver a la página, abre aquí.
  useEffect(() => rememberTab(section, tab), [section, tab]);

  const people = useMemo(() => new Map(workspace.people.map((p) => [p.id, p])), [workspace.people]);
  // Solo las pestañas de esta página (Libroteca no necesita los pendientes de Agenda, ni al revés).
  const lists = useMemo(() => {
    const out = new Map<TabId, Entry[]>();
    for (const t of entryTabs)
      if (tabs.some((s) => s.id === t.id)) out.set(t.id, workspace.entries.filter(t.match));
    return out;
  }, [workspace.entries, tabs]);
  const library = useMemo(() => workspace.entries.filter(isLibrary), [workspace.entries]);
  const watchables = useMemo(
    () => workspace.entries.filter((e) => e.kind === 'Película'),
    [workspace.entries],
  );
  const quoteCount = useMemo(() => countQuotes(workspace.entries), [workspace.entries]);
  const needle = normalizeText(deferredQuery.trim());
  const searching = needle !== '';
  // El índice de búsqueda solo se arma al buscar (y una vez por lista, no en cada tecla).
  const searchIndex = useMemo(
    () => (searching ? new Map(workspace.entries.map((e) => [e.id, searchText(e, people)])) : null),
    [workspace.entries, people, searching],
  );
  // Películas y series guardadas sin póster (p. ej. al capturarlas): se buscan en TMDB.
  useMediaBackfill(section === 'Libroteca' ? watchables : []);

  // Mientras llegan tus datos (y, en Inicio, tus lecturas y notas) se ven esqueletos.
  const booting =
    !dataSettled ||
    (section === 'Libroteca' &&
      tab === 'inicio' &&
      !searching &&
      (readings === null || notes.notes === null));
  const countsReady = dataSettled && (section !== 'Libroteca' || notes.notes !== null);
  const viewOf = (id: TabId, allowed: ViewMode[]) => {
    const v = views[id];
    return v && allowed.includes(v) ? v : allowed[0];
  };
  const setView = (id: TabId, v: ViewMode) => {
    const next = { ...views, [id]: v };
    setViews(next);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(next));
    } catch {
      /* Sin almacenamiento: la vista dura mientras sigas en la página. */
    }
  };

  const countOf = (id: TabId) =>
    id === 'inicio'
      ? library.length
      : id === 'citas'
        ? quoteCount
        : id === 'lienzo'
          ? liveNotes.length
          : id === 'cuadernos'
            ? (notebooks.list?.length ?? 0)
            : id === 'capturas'
              ? (capturas.shots?.length ?? 0)
              : (lists.get(id)?.length ?? 0);

  // Lo que dice el encabezado: cifras, no frases.
  const today = todayInputValue();
  const year = today.slice(0, 4);
  const inYear = (iso: string) => todayInputValue(new Date(iso)).startsWith(year);
  const plural = (n: number, one: string, many: string) =>
    `${n.toLocaleString('es-CO')} ${n === 1 ? one : many}`;
  let stats: string[];
  if (section === 'Libroteca') {
    const seen = library.filter(
      (e) =>
        e.kind === 'Película' && (e.details.watch ?? 'vista') === 'vista' && inYear(e.created_at),
    ).length;
    const booksDone = booksFinishedIn(library, year).length;
    stats = [
      plural(library.length, 'título', 'títulos'),
      seen ? `${seen} ${seen === 1 ? 'vista' : 'vistas'} en ${year}` : '',
      booksDone ? `${booksDone} ${booksDone === 1 ? 'libro' : 'libros'} en ${year}` : '',
      liveNotes.length ? plural(liveNotes.length, 'nota', 'notas') : '',
    ];
  } else {
    const open = (lists.get('pendientes') ?? []).filter(isOpenTask);
    const late = open.filter((e) => e.details.due && e.details.due < today).length;
    const working = (lists.get('trabajo') ?? []).filter(
      (e) => (e.details.stage ?? 'curso') === 'curso',
    ).length;
    const nbs = notebooks.list?.length ?? 0;
    const streak = streaks(buildDays(lists.get('notas') ?? []), today).current;
    stats = [
      streak ? `Diario: ${plural(streak, 'día seguido', 'días seguidos')}` : '',
      plural(open.length, 'pendiente abierto', 'pendientes abiertos'),
      late ? plural(late, 'vencido', 'vencidos') : '',
      working ? `${working} en curso` : '',
      nbs ? plural(nbs, 'cuaderno', 'cuadernos') : '',
    ];
  }
  stats = stats.filter(Boolean);

  const entryTab = tabById.get(tab);
  const shelf = entryTab ? (shelves[tab] ?? entryTab.shelf ?? 'todos') : 'todos';
  const label = tabs.find((t) => t.id === tab)!.label;
  const add =
    tab === 'citas'
      ? { label: 'Añadir cita', run: () => setQuoteSheet(true) }
      : tab === 'lienzo'
        ? { label: 'Nueva nota', run: () => setComposeTick((t) => t + 1) }
        : tab === 'cuadernos'
          ? { label: 'Nuevo cuaderno', run: () => setCreating(true) }
          : tab === 'capturas'
            ? { label: 'Subir capturas', run: () => setUploadTick((t) => t + 1) }
            : entryTab
            ? {
                label:
                  tab === 'libros' && shelf === 'estanteria'
                    ? 'Añadir a la estantería'
                    : 'Añadir ' + entryTab.noun,
                run: () => openEntry(entryTab.kind, [], entryTab.addDetails?.(shelf)),
              }
            : { label: 'Añadir', run: () => openEntry() };

  const matches = (e: Entry) => !needle || Boolean(searchIndex?.get(e.id)?.includes(needle));
  const notesFound =
    tab === 'inicio' && needle
      ? liveNotes.filter((n) => normalizeText(noteText(n)).includes(needle)).length
      : 0;

  // La lista de la pestaña (filtrada, en su estante y ordenada) y su vista.
  const sort = entryTab ? (sorts[tab] ?? entryTab.sorts[0]) : 'reciente';
  const view =
    tab === 'inicio'
      ? viewOf('inicio', PLAIN_VIEWS)
      : entryTab
        ? viewOf(tab, entryTab.views)
        : 'lista';
  const pipeline = useMemo(() => {
    if (tab === 'inicio')
      return {
        found: [],
        sorted: needle ? sortEntries(library.filter(matches), 'reciente') : [],
      };
    if (!entryTab) return { found: [], sorted: [] };
    const found = (lists.get(tab) ?? []).filter(matches);
    const test = entryTab.shelves?.find((s) => s.id === shelf)?.test;
    return {
      found,
      sorted: sortEntries(test ? found.filter(test) : found, sort, taste),
    };
    // `matches` depende solo de `needle` y `searchIndex`.
  }, [tab, entryTab, lists, library, needle, searchIndex, shelf, sort, taste]);
  // Por tandas: cuantas más caben, más grande la tanda (las portadas son pequeñas).
  const pager = useInfinite(
    pipeline.sorted,
    view === 'portadas' ? 96 : view === 'lista' ? 60 : PAGE,
    [section, tab, shelf, sort, view, needle].join('|'),
  );
  const loadMore = (
    <LoadMore rest={pager.rest} onMore={pager.loadMore} shown={pager.visible.length} />
  );

  let content;
  // Notas, Cuadernos y CAPTURAS traen sus propios esqueletos.
  const skeleton = booting && tab !== 'lienzo' && tab !== 'cuadernos' && tab !== 'capturas';
  if (skeleton) {
    content =
      tab === 'inicio' ? (
        <InicioSkeleton />
      ) : tab === 'citas' ? (
        <TabSkeleton kind="quotes" />
      ) : (
        <TabSkeleton kind={MEDIA_TABS.has(tab) ? 'media' : 'plain'} view={view} />
      );
  } else if (tab === 'inicio' && needle) {
    const found = pipeline.sorted;
    content = (
      <>
        <div className="lt-toolbar">
          <p className="lt-summary">
            {found.length} {found.length === 1 ? 'resultado' : 'resultados'} en Libroteca
          </p>
          <div className="lt-toolbar-end">
            <ViewSwitch views={PLAIN_VIEWS} value={view} onChange={(v) => setView('inicio', v)} />
          </div>
        </div>
        {found.length ? (
          <EntryCollection entries={pager.visible} view={view} media />
        ) : (
          !notesFound && <p className="lt-none">Nada coincide con «{query.trim()}».</p>
        )}
        {loadMore}
        {notesFound > 0 && (
          <button type="button" className="lt-more" onClick={() => setTab('lienzo')}>
            {notesFound === 1 ? '1 nota coincide' : `${notesFound} notas coinciden`} · Ver en Notas
          </button>
        )}
      </>
    );
  } else if (tab === 'inicio') {
    content =
      library.length || readings?.length || liveNotes.length ? (
        <Inicio
          lists={lists}
          readings={readings}
          notes={liveNotes}
          onTab={setTab}
          onOpenNote={(id) => {
            setOpenNote(id);
            setTab('lienzo');
          }}
        />
      ) : (
        <EmptyState
          icon={Library}
          title="Tu Libroteca está vacía. Las películas, series y libros que guardes aparecerán aquí."
          action={{
            label: 'Añadir lo primero',
            run: () => openEntry('Película'),
          }}
        />
      );
  } else if (tab === 'citas') {
    content = quoteCount ? (
      <QuoteWall query={deferredQuery} onAdd={() => setQuoteSheet(true)} />
    ) : (
      <EmptyState
        icon={Quote}
        title="Aún no hay citas. Guarda las frases que te marquen de tus libros."
        action={add}
      />
    );
  } else if (tab === 'lienzo') {
    content = (
      <NotesBoard
        store={notes}
        query={deferredQuery}
        openId={openNote}
        onOpened={() => setOpenNote(null)}
        composeTick={composeTick}
        onComposeHandled={() => setComposeTick(0)}
      />
    );
  } else if (tab === 'cuadernos') {
    content = <Cuadernos query={deferredQuery} creating={creating} setCreating={setCreating} />;
  } else if (tab === 'capturas') {
    content = (
      <Capturas
        query={deferredQuery}
        uploadTick={uploadTick}
        onUploadHandled={() => setUploadTick(0)}
      />
    );
  } else if (tab === 'notas') {
    content = <Diary entries={lists.get('notas') ?? []} matches={matches} query={deferredQuery} />;
  } else if (entryTab) {
    const all = lists.get(tab) ?? [];
    const { found, sorted } = pipeline;
    const shelfList = entryTab.shelves ?? [];
    const summary = tabSummary(entryTab, all, today);
    const chips = shelfList.length ? (
      <ShelfChips
        value={shelf}
        onChange={(id) => setShelves((s) => ({ ...s, [tab]: id }))}
        items={[
          {
            id: 'todos',
            label: FEMININE.has(tab) ? 'Todas' : 'Todos',
            count: found.length,
          },
          ...shelfList.map((s) => ({
            id: s.id,
            label: s.label,
            count: found.filter(s.test).length,
          })),
        ]}
      />
    ) : (
      <span />
    );

    content = !all.length ? (
      <>
        <EmptyState icon={entryTab.icon} title={entryTab.empty} action={add} />
        {tab === 'peliculas' && <LetterboxdButton />}
      </>
    ) : (
      <>
        {tab === 'libros' && !needle && <ReadingGoal entries={all} />}
        {summary.length > 0 && <p className="lt-summary lead">{summary.join(' · ')}</p>}
        <div className="lt-toolbar">
          {chips}
          <div className="lt-toolbar-end">
            {tab === 'peliculas' && <MovieCalendarButton />}
            {tab === 'peliculas' && <LetterboxdButton />}
            <SortMenu
              options={entryTab.sorts}
              value={sort}
              onChange={(v) => setSorts((s) => ({ ...s, [tab]: v }))}
            />
            <ViewSwitch views={entryTab.views} value={view} onChange={(v) => setView(tab, v)} />
          </div>
        </div>
        {sorted.length ? (
          <EntryCollection entries={pager.visible} view={view} media={MEDIA_TABS.has(tab)} />
        ) : (
          <p className="lt-none">
            {needle
              ? `Nada coincide con «${query.trim()}».`
              : shelf === 'estanteria'
                ? 'Tu estantería está vacía. Añade los libros físicos que tienes en casa.'
                : 'Nada en este estante.'}
          </p>
        )}
        {loadMore}
      </>
    );
  }

  const placeholder =
    tab === 'inicio'
      ? 'Buscar en Libroteca'
      : tab === 'citas'
        ? 'Buscar en tus citas'
        : tab === 'lienzo'
          ? 'Buscar en tus notas'
          : tab === 'cuadernos'
            ? 'Buscar cuadernos'
            : tab === 'capturas'
              ? 'Buscar en CAPTURAS'
              : tab === 'notas'
              ? 'Buscar en tu diario'
              : `Buscar en ${label}`;

  return (
    <div className={'lt' + (section === 'Agenda' ? ' lt-agenda' : '')}>
      <header className="lt-head">
        <div className="lt-title">
          <h1>{section}</h1>
          {countsReady ? (
            <p className="lt-reveal">
              {stats.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </p>
          ) : (
            <StatsSkeleton />
          )}
        </div>
        <div className="lt-actions">
          <label className="lt-search">
            <Search size={15} />
            <input
              type="search"
              placeholder={placeholder}
              aria-label={`Buscar en ${section}`}
              value={query}
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
                <X size={14} />
              </button>
            )}
          </label>
          <button type="button" className="lt-add" onClick={add.run}>
            <Plus size={16} /> {add.label}
          </button>
        </div>
      </header>

      <nav className="lt-tabs" role="tablist" aria-label={`Secciones de ${section}`}>
        {tabs.map((t) => {
          const n = countOf(t.id);
          const known =
            dataSettled &&
            (t.id === 'lienzo'
              ? notes.notes !== null
              : t.id === 'cuadernos'
                ? notebooks.list != null
                : t.id === 'capturas'
                  ? capturas.shots != null
                  : true);
          return (
            <span key={t.id} className="lt-tab-wrap">
              {t.divider && <span className="lt-tabs-div" aria-hidden="true" />}
              <button
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-label={t.iconOnly ? t.label : undefined}
                title={t.iconOnly ? t.label : undefined}
                className={
                  (tab === t.id ? 'on' : '') +
                  (known && n === 0 ? ' lt-zero' : '') +
                  (t.iconOnly ? ' icon' : '')
                }
                onClick={() => setTab(t.id)}
              >
                <t.icon size={t.iconOnly ? 16 : 14} />
                {!t.iconOnly && (
                  <>
                    {t.label}
                    {known ? (
                      <i>{n.toLocaleString('es-CO')}</i>
                    ) : (
                      <i className="lt-sk-count" aria-hidden="true" />
                    )}
                  </>
                )}
              </button>
            </span>
          );
        })}
      </nav>

      {/* Un fundido corto al llegar los datos o al cambiar de pestaña; nada se desplaza. */}
      <div
        className="lt-body lt-reveal"
        key={tab + (skeleton ? ':sk' : '')}
        role="tabpanel"
        aria-label={label}
        aria-busy={skeleton || undefined}
      >
        {content}
      </div>
      {quoteSheet && <QuoteSheet onClose={() => setQuoteSheet(false)} />}
    </div>
  );
}
