import { useEffect, useMemo, useState } from 'react';
import { Library, Plus, Quote, Search, Tv, X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { isSeries } from '../lib/entries';
import { normalizeText, todayInputValue } from '../lib/format';
import {
  EmptyState,
  EntryCollection,
  ShelfChips,
  SortMenu,
  ViewSwitch,
  type ShelfToggle,
} from './Collection';
import { useMediaBackfill } from './enrich';
import { Inicio } from './Inicio';
import { QuoteSheet, QuoteWall, quotesOf } from './Quotes';
import { useReadingShelf } from './ReadingShelf';
import {
  entryTabs,
  forgetLibTab,
  requestedLibTab,
  searchText,
  sortEntries,
  tabById,
  tabOrder,
  tabSummary,
  tones,
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
const FEMININE = new Set<TabId>(['peliculas', 'notas']);
/** Pestañas con tarjetas de póster. */
const MEDIA_TABS = new Set<TabId>(['peliculas', 'libros']);

function loadViews(): Partial<Record<TabId, ViewMode>> {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/**
 * Libroteca: todo lo que guardas, por secciones. «Inicio» trae lo que tienes en curso, lo último
 * que añadiste y una tarjeta por sección; cada pestaña tiene sus estantes, su orden, su vista
 * (tarjetas, portadas o lista) y su botón «Añadir».
 */
export function Libroteca() {
  const { workspace, openEntry } = useApp();
  const [tab, setTabRaw] = useState<TabId>(() => requestedLibTab() ?? 'inicio');
  const [query, setQuery] = useState('');
  const [views, setViews] = useState(loadViews);
  const [sorts, setSorts] = useState<Partial<Record<TabId, SortId>>>({});
  const [shelves, setShelves] = useState<Partial<Record<TabId, string>>>({});
  // Pastillas aparte: «Series» en Películas y «Citas» en Libros.
  const [seriesOnly, setSeriesOnly] = useState(false);
  const [citas, setCitas] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [quoteSheet, setQuoteSheet] = useState(false);
  const readings = useReadingShelf();
  useEffect(forgetLibTab, []);

  const people = useMemo(() => new Map(workspace.people.map((p) => [p.id, p])), [workspace.people]);
  const lists = useMemo(() => {
    const out = new Map<TabId, Entry[]>();
    for (const t of entryTabs) out.set(t.id, workspace.entries.filter(t.match));
    return out;
  }, [workspace.entries]);
  const quoteCount = useMemo(() => quotesOf(workspace.entries).length, [workspace.entries]);
  const searchIndex = useMemo(
    () => new Map(workspace.entries.map((e) => [e.id, searchText(e, people)])),
    [workspace.entries, people],
  );
  // Películas y series guardadas sin póster (p. ej. al capturarlas): se buscan en TMDB.
  useMediaBackfill(lists.get('peliculas') ?? []);

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

  const total = workspace.entries.length;
  const countOf = (id: TabId) => (id === 'inicio' ? total : (lists.get(id)?.length ?? 0));

  // Lo que dice el encabezado: cifras de este año, no frases.
  const today = todayInputValue();
  const year = today.slice(0, 4);
  const inYear = (iso: string) => todayInputValue(new Date(iso)).startsWith(year);
  const seen = workspace.entries.filter(
    (e) =>
      e.kind === 'Película' && (e.details.watch ?? 'vista') === 'vista' && inYear(e.created_at),
  ).length;
  const booksDone = workspace.entries.filter(
    (e) => e.kind === 'Libro' && e.details.read === 'terminado' && inYear(e.created_at),
  ).length;
  const stats = [
    `${total.toLocaleString('es-CO')} ${total === 1 ? 'recuerdo' : 'recuerdos'}`,
    seen ? `${seen} ${seen === 1 ? 'vista' : 'vistas'} en ${year}` : '',
    booksDone ? `${booksDone} ${booksDone === 1 ? 'libro' : 'libros'} en ${year}` : '',
  ].filter(Boolean);

  const entryTab = tabById.get(tab);
  const shelf = entryTab ? (shelves[tab] ?? entryTab.shelf ?? 'todos') : 'todos';
  const label = tabOrder.find((t) => t.id === tab)!.label;
  const quotesOn = tab === 'libros' && citas;
  const seriesOn = tab === 'peliculas' && seriesOnly;
  const add = quotesOn
    ? { label: 'Añadir cita', run: () => setQuoteSheet(true) }
    : entryTab
      ? {
          label: 'Añadir ' + (seriesOn ? 'serie' : entryTab.noun),
          run: () => {
            const details = entryTab.addDetails?.(shelf);
            openEntry(entryTab.kind, [], seriesOn ? { ...details, series: true } : details);
          },
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
    const found = sortEntries(workspace.entries.filter(matches), 'reciente');
    const view = viewOf('inicio', PLAIN_VIEWS);
    content = (
      <>
        <div className="lt-toolbar">
          <p className="lt-summary">
            {found.length} {found.length === 1 ? 'resultado' : 'resultados'} en toda tu libreta
          </p>
          <div className="lt-toolbar-end">
            <ViewSwitch views={PLAIN_VIEWS} value={view} onChange={(v) => setView('inicio', v)} />
          </div>
        </div>
        {found.length ? (
          <EntryCollection entries={found.slice(0, limit)} view={view} />
        ) : (
          <p className="lt-none">Nada coincide con «{query.trim()}».</p>
        )}
        {more(found.length)}
      </>
    );
  } else if (tab === 'inicio') {
    content =
      total || readings?.length ? (
        <Inicio lists={lists} readings={readings} onTab={setTab} />
      ) : (
        <EmptyState
          icon={Library}
          title="Tu Libroteca está vacía. Lo que guardes aparecerá aquí, por secciones."
          action={{ label: 'Añadir lo primero', run: () => openEntry() }}
        />
      );
  } else if (entryTab) {
    const all = lists.get(tab) ?? [];
    const found = all.filter(matches);
    // «Series» deja solo las series; los estantes cuentan dentro de eso.
    const scope = seriesOn ? found.filter(isSeries) : found;
    const shelfList = entryTab.shelves ?? [];
    const test = shelfList.find((s) => s.id === shelf)?.test;
    const inShelf = test ? scope.filter(test) : scope;
    const sort = sorts[tab] ?? entryTab.sorts[0];
    const sorted = sortEntries(inShelf, sort);
    const view = viewOf(tab, entryTab.views);
    const summary = tabSummary(entryTab, all, today);
    const toggles: ShelfToggle[] =
      tab === 'peliculas'
        ? [
            {
              label: 'Series',
              icon: Tv,
              tone: tones.series,
              count: found.filter(isSeries).length,
              on: seriesOn,
              onToggle: () => {
                setSeriesOnly((v) => !v);
                setLimit(PAGE);
              },
            },
          ]
        : tab === 'libros'
          ? [
              {
                label: 'Citas',
                icon: Quote,
                tone: tones.citas,
                keep: true,
                count: quoteCount,
                on: quotesOn,
                onToggle: () => setCitas((v) => !v),
              },
            ]
          : [];
    const chips = shelfList.length ? (
      <ShelfChips
        value={quotesOn ? '' : shelf}
        onChange={(id) => {
          setShelves((s) => ({ ...s, [tab]: id }));
          setCitas(false);
          setLimit(PAGE);
        }}
        toggles={toggles}
        items={[
          { id: 'todos', label: FEMININE.has(tab) ? 'Todas' : 'Todos', count: scope.length },
          ...shelfList.map((s) => ({
            id: s.id,
            label: s.label,
            count: scope.filter(s.test).length,
          })),
        ]}
      />
    ) : (
      <span />
    );

    content = !all.length ? (
      <EmptyState icon={entryTab.icon} title={entryTab.empty} action={add} />
    ) : quotesOn ? (
      <>
        {summary.length > 0 && <p className="lt-summary lead">{summary.join(' · ')}</p>}
        <QuoteWall query={query} onAdd={() => setQuoteSheet(true)} lead={chips} />
      </>
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
            {needle
              ? `Nada coincide con «${query.trim()}».`
              : seriesOn && !scope.length
                ? 'Aún no hay series.'
                : 'Nada en este estante.'}
          </p>
        )}
        {more(sorted.length)}
      </>
    );
  }

  const placeholder =
    tab === 'inicio'
      ? 'Buscar en todo'
      : quotesOn
        ? 'Buscar en tus citas'
        : `Buscar en ${seriesOn ? 'series' : label}`;

  return (
    <div className="lt">
      <header className="lt-head">
        <div className="lt-title">
          <h1>Libroteca</h1>
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
              aria-label="Buscar en Libroteca"
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

      <nav className="lt-tabs" role="tablist" aria-label="Secciones de Libroteca">
        {tabOrder.map((t) => {
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
