import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BookMarked,
  ChevronDown,
  ChevronUp,
  Images,
  Library,
  Newspaper,
  Plus,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Shot } from '../capturas/model';
import { peekShot } from '../capturas/nav';
import type { Entry } from '../data';
import { useGridCols } from '../hooks/useGridCols';
import { kindMeta } from '../composer/kinds';
import { isSeries, kindLabel } from '../lib/entries';
import { friendlyDate, todayInputValue } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { RecentNotes } from '../notes/RecentNotes';
import type { KeepNote } from '../notes/useNotes';
import { toneVars } from './Collection';
import { isActive, progressOf, withEpisode } from './progress';
import { useOpenReading, type ShelfReading } from './ReadingShelf';
import { ReadingGoalStrip } from './ReadingGoal';
import { onMyShelf, ShelfSheet } from './ShelfSheet';
import {
  addedAt,
  sectionTabs,
  tabById,
  tabSummary,
  tones,
  toneOf,
  type TabId,
  type Tone,
} from './shelf';

const COLLECTION: TabId[] = ['peliculas', 'series', 'libros'];
const MEDIA = new Set<TabId>(['peliculas', 'series', 'libros']);
/** Filas de «En curso» visibles al principio y cuántas suma cada «Ver más». */
const NOW_ROWS = 2;
/** «Recientes»: dos filas como mucho, con las columnas que quepan (hasta este tope). */
const RECENT_ROWS = 2;
const RECENT_MAX = 16;

type NowItem = {
  key: string;
  label: string;
  title: string;
  cover?: string;
  icon: LucideIcon;
  tone: Tone;
  progress: number | null;
  sub: string;
  open: () => void;
  /** Avance rápido sin abrir nada (series: +1 episodio). */
  quick?: { label: string; title: string; run: () => void };
};

/** Una tarjeta de «Recientes»: una película, serie o libro, o una captura. */
type RecentItem = {
  key: string;
  /** Cuándo llegó (ISO): ordena la mezcla. */
  at: string;
  title: string;
  kind: string;
  img?: string;
  icon: LucideIcon;
  tone: Tone;
  /** Póster (vertical) o captura (apaisada). */
  frame: 'media' | 'wide';
  open: () => void;
};

/**
 * Vista principal de Libroteca: lo que tienes a medias (y se actualiza desde aquí), lo último que
 * añadiste y una tarjeta por cada sección con algo dentro. Cada tarjeta abre su pestaña.
 */
export function Inicio({
  lists,
  readings,
  notes,
  shots,
  onTab,
  onOpenNote,
}: {
  lists: Map<TabId, Entry[]>;
  readings: ShelfReading[] | null;
  /** Notas libres sin archivar, más recientes primero. */
  notes: KeepNote[];
  /** CAPTURAS (las archivadas no salen en «Recientes»). */
  shots: Shot[] | null;
  onTab: (tab: TabId) => void;
  onOpenNote: (id: string) => void;
}) {
  const { workspace, viewEntry, openProgress, patchEntry, notify } = useApp();
  const reading = useOpenReading();
  const today = todayInputValue();

  // Rejillas «En curso» y «Recientes» (sus columnas cambian con el ancho) y filas abiertas.
  const nowRef = useRef<HTMLDivElement>(null);
  const recentRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(NOW_ROWS);
  const [shelfOpen, setShelfOpen] = useState(false);

  const cover = (e: Entry) => {
    const img = entryImages(e)[0];
    return img ? (img.thumb ?? img.medium ?? img.url) : undefined;
  };
  const nextEpisode = async (e: Entry) => {
    const season = e.details.seasonAt ?? 1;
    const episode = (e.details.episodeAt ?? 0) + 1;
    const ok = await patchEntry(e, {
      details: withEpisode(e, season, episode, 'por-ver'),
    });
    if (ok) notify(`${e.title}: vas en la T${season} · E${episode}.`);
  };

  // En curso: primero lo que actualizaste hace menos, luego lo demás.
  const active = useMemo(
    () =>
      [
        ...(lists.get('libros') ?? []),
        ...(lists.get('peliculas') ?? []),
        ...(lists.get('series') ?? []),
      ]
        .filter(isActive)
        .sort(
          (a, b) =>
            Number(Boolean(b.details.follow)) - Number(Boolean(a.details.follow)) ||
            addedAt(b).localeCompare(addedAt(a)),
        ),
    [lists],
  );
  const now: NowItem[] = active.map((e) => {
    const p = progressOf(e, today);
    const book = e.kind === 'Libro';
    return {
      key: e.id,
      label: book ? 'Leyendo' : 'Viendo',
      title: e.title,
      cover: cover(e),
      icon: book ? BookMarked : Tv,
      tone: toneOf(e),
      progress: p.percent,
      sub: p.text,
      open: () => openProgress(e),
      quick: book
        ? undefined
        : {
            label: '+1 ep.',
            title: 'Siguiente episodio',
            run: () => void nextEpisode(e),
          },
    };
  });
  for (const r of readings ?? []) {
    if (r.read_at || !r.progress || r.progress >= 100) continue;
    now.push({
      key: r.id,
      label: 'Lectura',
      title: r.title,
      cover: r.cover ?? undefined,
      icon: Newspaper,
      tone: tones.lecturas,
      progress: r.progress,
      sub: `Vas en el ${r.progress}%`,
      open: () => reading.open(r),
    });
  }

  const hasNow = now.length > 0;
  const cols = useGridCols(nowRef, hasNow);
  const shown = Math.min(now.length, cols * rows);
  const hidden = now.length - shown;
  const canCollapse = !hidden && rows > NOW_ROWS && now.length > cols * NOW_ROWS;

  // Lo último que llegó, mezclado: películas, series y libros con las capturas. Una captura se
  // abre aquí mismo en su visor (no lleva a la pestaña CAPTURAS).
  const recent = useMemo(() => {
    const items: RecentItem[] = [];
    for (const e of workspace.entries) {
      if (e.kind !== 'Película' && e.kind !== 'Libro') continue;
      items.push({
        key: e.id,
        at: addedAt(e),
        title: e.title || e.kind,
        kind: kindLabel(e),
        img: cover(e),
        icon: isSeries(e) ? Tv : kindMeta[e.kind].icon,
        tone: toneOf(e),
        frame: 'media',
        open: () => viewEntry(e),
      });
    }
    for (const s of shots ?? []) {
      if (s.archived_at) continue;
      items.push({
        key: 'shot:' + s.id,
        at: s.created_at,
        title: s.name || 'Captura',
        kind: 'Captura',
        img: s.thumb ?? s.url,
        icon: Images,
        tone: tones.capturas,
        frame: 'wide',
        open: () => peekShot(s.id),
      });
    }
    // Por fecha real (las de la base de datos y las del navegador no se escriben igual).
    return items
      .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
      .slice(0, RECENT_MAX);
    // `cover` y `viewEntry` no cambian lo que se muestra.
  }, [workspace.entries, shots]);
  const recentCols = useGridCols(recentRef, recent.length > 0);

  const card = (id: TabId) => {
    const meta = sectionTabs.Libroteca.find((t) => t.id === id)!;
    const tab = tabById.get(id);
    const list = lists.get(id) ?? [];
    if (!tab || !list.length) return null;
    const bits = tabSummary(tab, list, today);
    let visual: ReactNode = null;
    let stacked = false;
    if (MEDIA.has(id)) {
      const covers = list
        .map((e) => entryImages(e)[0])
        .filter(Boolean)
        .slice(0, 4);
      stacked = covers.length > 0;
      if (stacked)
        visual = (
          <span className={'lt-stack n' + covers.length}>
            {covers.map((img, i) => (
              <img key={i + img.url} src={img.medium ?? img.url} alt="" loading="lazy" />
            ))}
          </span>
        );
    } else {
      const last = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 2);
      visual = (
        <span className="lt-sec-last">
          {last.map((e) => (
            <span key={e.id}>{e.title || e.kind}</span>
          ))}
        </span>
      );
    }
    const Icon = meta.icon;
    return (
      <button
        type="button"
        key={id}
        className={'lt-sec' + (stacked ? ' media' : '')}
        style={toneVars(tab.tone)}
        onClick={() => onTab(id)}
      >
        <span className="lt-sec-top">
          <span className="lt-sec-icon">
            <Icon size={16} />
          </span>
          <span className="lt-sec-n">{list.length.toLocaleString('es-CO')}</span>
        </span>
        <strong>
          {meta.label} <ArrowRight size={14} />
        </strong>
        {bits.length > 0 && <small>{bits.slice(0, 4).join(' · ')}</small>}
        {visual}
      </button>
    );
  };

  // «Estantería»: los libros en papel que tienes en casa. Abre su ventana, no la pestaña Libros.
  const shelfBooks = (lists.get('libros') ?? []).filter(onMyShelf);
  const shelfCard = () => {
    if (!shelfBooks.length) return null;
    const borrowed = shelfBooks.filter((e) => e.details.bookOwner === 'prestado').length;
    const mine = shelfBooks.length - borrowed;
    const bits = [
      mine && `${mine} ${mine === 1 ? 'tuyo' : 'tuyos'}`,
      borrowed && `${borrowed} ${borrowed === 1 ? 'prestado' : 'prestados'}`,
    ].filter(Boolean);
    const covers = shelfBooks
      .map((e) => entryImages(e)[0])
      .filter(Boolean)
      .slice(0, 4);
    const stacked = covers.length > 0;
    return (
      <button
        type="button"
        key="estanteria"
        className={'lt-sec' + (stacked ? ' media' : '')}
        style={toneVars(tabById.get('libros')!.tone)}
        onClick={() => setShelfOpen(true)}
      >
        <span className="lt-sec-top">
          <span className="lt-sec-icon">
            <Library size={16} />
          </span>
          <span className="lt-sec-n">{shelfBooks.length.toLocaleString('es-CO')}</span>
        </span>
        <strong>
          Estantería <ArrowRight size={14} />
        </strong>
        {bits.length > 0 && <small>{bits.join(' · ')}</small>}
        {stacked ? (
          <span className={'lt-stack n' + covers.length}>
            {covers.map((img, i) => (
              <img key={i + img.url} src={img.medium ?? img.url} alt="" loading="lazy" />
            ))}
          </span>
        ) : (
          <span className="lt-sec-last">
            {shelfBooks.slice(0, 2).map((e) => (
              <span key={e.id}>{e.title || e.kind}</span>
            ))}
          </span>
        )}
      </button>
    );
  };

  const collection = [...COLLECTION.map(card), shelfCard()].filter(Boolean);

  return (
    <div className="lt-home">
      <ReadingGoalStrip entries={lists.get('libros') ?? []} onOpen={() => onTab('libros')} />
      {hasNow && (
        <section aria-labelledby="lt-now">
          <h2 className="lt-h2" id="lt-now">
            En curso <i>{now.length}</i>
          </h2>
          <div className="lt-now" ref={nowRef}>
            {now.slice(0, shown).map((it) => (
              <div key={it.key} className="lt-now-card" style={toneVars(it.tone)}>
                <button
                  type="button"
                  className="lt-now-open"
                  aria-label={
                    it.label === 'Lectura' ? `Abrir ${it.title}` : `Actualizar ${it.title}`
                  }
                  onClick={it.open}
                />
                <span className="lt-now-art">
                  {it.cover ? (
                    <img src={it.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <it.icon size={18} />
                  )}
                </span>
                <span className="lt-now-body">
                  <small>{it.label}</small>
                  <strong>{it.title}</strong>
                  {it.progress !== null && (
                    <span className="lt-now-bar">
                      <i style={{ width: it.progress + '%' }} />
                    </span>
                  )}
                  <em>{it.sub}</em>
                </span>
                {it.quick ? (
                  <button
                    type="button"
                    className="lt-now-quick"
                    title={it.quick.title}
                    onClick={it.quick.run}
                  >
                    {it.quick.label}
                  </button>
                ) : it.label !== 'Lectura' ? (
                  <span className="lt-now-quick ghost" aria-hidden="true">
                    <Plus size={14} />
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          {hidden > 0 && (
            <button
              type="button"
              className="lt-more lt-now-more"
              onClick={() => setRows((r) => r + NOW_ROWS)}
            >
              Ver más <span>{hidden}</span> <ChevronDown size={14} />
            </button>
          )}
          {canCollapse && (
            <button type="button" className="lt-more lt-now-more" onClick={() => setRows(NOW_ROWS)}>
              Ver menos <ChevronUp size={14} />
            </button>
          )}
        </section>
      )}

      {(recent.length > 0 || notes.length > 0) && (
        <section aria-labelledby="lt-recent">
          <h2 className="lt-h2" id="lt-recent">
            Recientes
          </h2>
          {recent.length > 0 && (
            <div className="lt-recent" ref={recentRef}>
              {recent.slice(0, recentCols * RECENT_ROWS).map((it) => (
                <button
                  type="button"
                  key={it.key}
                  className="lt-rec"
                  style={toneVars(it.tone)}
                  onClick={it.open}
                >
                  <span className={'lt-thumb ' + it.frame}>
                    {it.img ? (
                      <img src={it.img} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <it.icon size={15} />
                    )}
                  </span>
                  <span className="lt-rec-main">
                    <strong>{it.title}</strong>
                    <small>
                      {it.kind} ·{' '}
                      {friendlyDate(todayInputValue(new Date(it.at)), today).toLowerCase()}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <RecentNotes notes={notes} onOpen={onOpenNote} onAll={() => onTab('lienzo')} />
        </section>
      )}

      {collection.length > 0 && (
        <section aria-labelledby="lt-col">
          <h2 className="lt-h2" id="lt-col">
            Colección
          </h2>
          <div className="lt-secs">{collection}</div>
        </section>
      )}
      {reading.sheet}
      {shelfOpen && <ShelfSheet books={shelfBooks} onClose={() => setShelfOpen(false)} />}
    </div>
  );
}
