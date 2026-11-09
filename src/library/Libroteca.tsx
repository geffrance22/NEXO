import { useEffect, useMemo, useState } from 'react';
import { Library, Plus, Quote, Search, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { isOpenTask } from '../lib/commitments';
import { normalizeText, todayInputValue } from '../lib/format';
import { Cuadernos } from '../cuadernos/Cuadernos';
import { NotebookView } from '../cuadernos/NotebookView';
import { useCuadernos } from '../cuadernos/useCuadernos';
import { EmptyState, EntryCollection, ShelfChips, SortMenu, ViewSwitch } from './Collection';
import { useMediaBackfill } from './enrich';
import { Inicio } from './Inicio';
import { QuoteSheet, QuoteWall, quotesOf } from './Quotes';
import { useReadingShelf } from './ReadingShelf';
import {
  entryTabs,
  forgetTab,
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
const PAGE = 60;
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

/** Libroteca: películas, series, libros y sus citas. */
export function Libroteca() {
  return <ShelfPage section="Libroteca" />;
}

/**
 * Agenda: tu día a día (pendientes, trabajo, encuentros, notas y aprendizajes) y los cuadernos que
 * lo reúnen. Con `notebookId`, abre ese cuaderno en su lienzo.
 */
export function Agenda({ notebookId }: { notebookId?: string | null }) {
  if (notebookId) return <NotebookView id={notebookId} />;
  return <ShelfPage section="Agenda" />;
}

/**
 * Una página con pestañas: cada pestaña tiene sus estantes, su orden, su vista (tarjetas, portadas
 * o lista) y su botón «Añadir». La primera pestaña de cada página es especial: «Inicio» en
 * Libroteca y «Cuadernos» en Agenda.
 */
function ShelfPage({ section }: { section: ShelfSection }) {
  const { workspace, openEntry } = useApp();
  const tabs = sectionTabs[section];
  const home = tabs[0].id;
  const [tab, setTabRaw] = useState<TabId>(() => requestedTab(section) ?? home);
  const [query, setQuery] = useState('');
  const [views, setViews] = useState(loadViews);
  const [sorts, setSorts] = useState<Partial<Record<TabId, SortId>>>({});
  const [shelves, setShelves] = useState<Partial<Record<TabId, string>>>({});
  const [limit, setLimit] = useState(PAGE);
  const [quoteSheet, setQuoteSheet] = useState(false);
  const [creating, setCreating] = useState(false);
  const readings = useReadingShelf();
  const notebooks = useCuadernos();
  useEffect(() => forgetTab(section), [section]);

  const people = useMemo(() => new Map(workspace.people.map((p) => [p.id, p])), [workspace.people]);
  const lists = useMemo(() => {
    const out = new Map<TabId, Entry[]>();
    for (const t of entryTabs) out.set(t.id, workspace.entries.filter(t.match));
    return out;
  }, [workspace.entries]);
  const library = useMemo(() => workspace.entries.filter(isLibrary), [workspace.entries]);
  const watchables = useMemo(
    () => workspace.entries.filter((e) => e.kind === 'Película'),
    [workspace.entries],
  );
  const quoteCount = useMemo(() => quotesOf(workspace.entries).length, [workspace.entries]);
  const searchIndex = useMemo(
    () => new Map(workspace.entries.map((e) => [e.id, searchText(e, people)])),
    [workspace.entries, people],
  );
  // Películas y series guardadas sin póster (p. ej. al capturarlas): se buscan en TMDB.
  useMediaBackfill(section === 'Libroteca' ? watchables : []);

  const setTab = (next: TabId) => {
    setTabRaw(next);
    setLimit(PAGE);
  };
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
        : id === 'cuadernos'
          ? (notebooks.list?.length ?? 0)
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
    const booksDone = library.filter(
      (e) => e.kind === 'Libro' && e.details.read === 'terminado' && inYear(e.created_at),
    ).length;
    stats = [
      plural(library.length, 'título', 'títulos'),
      seen ? `${seen} ${seen === 1 ? 'vista' : 'vistas'} en ${year}` : '',
      booksDone ? `${booksDone} ${booksDone === 1 ? 'libro' : 'libros'} en ${year}` : '',
    ];
  } else {
    const open = (lists.get('pendientes') ?? []).filter(isOpenTask);
    const late = open.filter((e) => e.details.due && e.details.due < today).length;
    const working = (lists.get('trabajo') ?? []).filter(
      (e) => (e.details.stage ?? 'curso') === 'curso',
    ).length;
    const nbs = notebooks.list?.length ?? 0;
    stats = [
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
      : tab === 'cuadernos'
        ? { label: 'Nuevo cuaderno', run: () => setCreating(true) }
        : entryTab
          ? {
              label: 'Añadir ' + entryTab.noun,
              run: () => openEntry(entryTab.kind, [], entryTab.addDetails?.(shelf)),
            }
          : { label: 'Añadir', run: () => openEntry() };

  const needle = normalizeText(query.trim());
  const matches = (e: Entry) => !needle || Boolean(searchIndex.get(e.id)?.includes(needle));
  const more = (n: number) =>
    n > limit && (
      <button type="button" className="lt-more" onClick={() => setLimit((l) => l + PAGE)}>
        Ver más <span>{n - limit}</span>
      </button>
    );

  let content;
  if (tab === 'inicio' && needle) {
    const found = sortEntries(library.filter(matches), 'reciente');
    const view = viewOf('inicio', PLAIN_VIEWS);
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
          <EntryCollection entries={found.slice(0, limit)} view={view} media />
        ) : (
          <p className="lt-none">Nada coincide con «{query.trim()}».</p>
        )}
        {more(found.length)}
      </>
    );
  } else if (tab === 'inicio') {
    content =
      library.length || readings?.length ? (
        <Inicio lists={lists} readings={readings} onTab={setTab} />
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
      <QuoteWall query={query} onAdd={() => setQuoteSheet(true)} />
    ) : (
      <EmptyState
        icon={Quote}
        title="Aún no hay citas. Guarda las frases que te marquen de tus libros."
        action={add}
      />
    );
  } else if (tab === 'cuadernos') {
    content = <Cuadernos query={query} creating={creating} setCreating={setCreating} />;
  } else if (entryTab) {
    const all = lists.get(tab) ?? [];
    const found = all.filter(matches);
    const shelfList = entryTab.shelves ?? [];
    const test = shelfList.find((s) => s.id === shelf)?.test;
    const inShelf = test ? found.filter(test) : found;
    const sort = sorts[tab] ?? entryTab.sorts[0];
    const sorted = sortEntries(inShelf, sort);
    const view = viewOf(tab, entryTab.views);
    const summary = tabSummary(entryTab, all, today);
    const chips = shelfList.length ? (
      <ShelfChips
        value={shelf}
        onChange={(id) => {
          setShelves((s) => ({ ...s, [tab]: id }));
          setLimit(PAGE);
        }}
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
      <EmptyState icon={entryTab.icon} title={entryTab.empty} action={add} />
    ) : (
      <>
        {summary.length > 0 && <p className="lt-summary lead">{summary.join(' · ')}</p>}
        <div className="lt-toolbar">
          {chips}
          <div className="lt-toolbar-end">
            <SortMenu
              options={entryTab.sorts}
              value={sort}
              onChange={(v) => setSorts((s) => ({ ...s, [tab]: v }))}
            />
            <ViewSwitch views={entryTab.views} value={view} onChange={(v) => setView(tab, v)} />
          </div>
        </div>
        {sorted.length ? (
          <EntryCollection
            entries={sorted.slice(0, limit)}
            view={view}
            media={MEDIA_TABS.has(tab)}
          />
        ) : (
          <p className="lt-none">
            {needle ? `Nada coincide con «${query.trim()}».` : 'Nada en este estante.'}
          </p>
        )}
        {more(sorted.length)}
      </>
    );
  }

  const placeholder =
    tab === 'inicio'
      ? 'Buscar en Libroteca'
      : tab === 'citas'
        ? 'Buscar en tus citas'
        : tab === 'cuadernos'
          ? 'Buscar cuadernos'
          : `Buscar en ${label}`;

  return (
    <div className={'lt' + (section === 'Agenda' ? ' lt-agenda' : '')}>
      <header className="lt-head">
        <div className="lt-title">
          <h1>{section}</h1>
          <p>
            {stats.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </p>
        </div>
        <div className="lt-actions">
          <label className="lt-search">
            <Search size={15} />
            <input
              type="search"
              placeholder={placeholder}
              aria-label={`Buscar en ${section}`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
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
                  (n === 0 ? ' lt-zero' : '') +
                  (t.iconOnly ? ' icon' : '')
                }
                onClick={() => setTab(t.id)}
              >
                <t.icon size={t.iconOnly ? 16 : 14} />
                {!t.iconOnly && (
                  <>
                    {t.label}
                    <i>{n.toLocaleString('es-CO')}</i>
                  </>
                )}
              </button>
            </span>
          );
        })}
      </nav>

      <div className="lt-body" role="tabpanel" aria-label={label}>
        {content}
      </div>
      {quoteSheet && <QuoteSheet onClose={() => setQuoteSheet(false)} />}
    </div>
  );
}
