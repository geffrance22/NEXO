import { type ReactNode } from 'react';
import { ArrowRight, BookMarked, Newspaper, Plus, Tv, type LucideIcon } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { kindMeta } from '../composer/kinds';
import { isSeries, kindLabel } from '../lib/entries';
import { friendlyDate, todayInputValue } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { toneVars } from './Collection';
import { isActive, progressOf, withEpisode } from './progress';
import { useOpenReading, type ShelfReading } from './ReadingShelf';
import {
  addedAt,
  tabById,
  tabOrder,
  tabSummary,
  tones,
  toneOf,
  type TabId,
  type Tone,
} from './shelf';

const COLLECTION: TabId[] = ['peliculas', 'libros', 'aprendizajes'];
const NOTEBOOK: TabId[] = ['notas', 'encuentros', 'pendientes', 'trabajo'];
const MEDIA = new Set<TabId>(['peliculas', 'libros']);
const NOW_MAX = 12;
const RECENT = 6;

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

/**
 * Vista principal de Libroteca: lo que tienes a medias (y se actualiza desde aquí), lo último que
 * añadiste y una tarjeta por cada sección con algo dentro. Cada tarjeta abre su pestaña.
 */
export function Inicio({
  lists,
  readings,
  onTab,
}: {
  lists: Map<TabId, Entry[]>;
  readings: ShelfReading[] | null;
  onTab: (tab: TabId) => void;
}) {
  const { workspace, viewEntry, openProgress, patchEntry, notify } = useApp();
  const reading = useOpenReading();
  const today = todayInputValue();

  const cover = (e: Entry) => {
    const img = entryImages(e)[0];
    return img ? (img.thumb ?? img.medium ?? img.url) : undefined;
  };
  const nextEpisode = async (e: Entry) => {
    const season = e.details.seasonAt ?? 1;
    const episode = (e.details.episodeAt ?? 0) + 1;
    const ok = await patchEntry(e, { details: withEpisode(e, season, episode) });
    if (ok) notify(`${e.title}: vas en la T${season} · E${episode}.`);
  };

  // En curso: primero lo que actualizaste hace menos, luego lo demás.
  const active = [...(lists.get('libros') ?? []), ...(lists.get('peliculas') ?? [])]
    .filter(isActive)
    .sort(
      (a, b) =>
        Number(Boolean(b.details.follow)) - Number(Boolean(a.details.follow)) ||
        addedAt(b).localeCompare(addedAt(a)),
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
        : { label: '+1 ep.', title: 'Siguiente episodio', run: () => void nextEpisode(e) },
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

  const recent = [...workspace.entries]
    .sort((a, b) => addedAt(b).localeCompare(addedAt(a)))
    .slice(0, RECENT);

  const card = (id: TabId) => {
    const meta = tabOrder.find((t) => t.id === id)!;
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

  const collection = COLLECTION.map(card).filter(Boolean);
  const notebook = NOTEBOOK.map(card).filter(Boolean);

  return (
    <div className="lt-home">
      {now.length > 0 && (
        <section aria-labelledby="lt-now">
          <h2 className="lt-h2" id="lt-now">
            En curso <i>{now.length}</i>
          </h2>
          <div className="lt-now">
            {now.slice(0, NOW_MAX).map((it) => (
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
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="lt-recent">
          <h2 className="lt-h2" id="lt-recent">
            Recientes
          </h2>
          <div className="lt-recent">
            {recent.map((e) => {
              const img = e.kind !== 'Movimiento' ? cover(e) : undefined;
              const media = e.kind === 'Película' || e.kind === 'Libro';
              const Icon = isSeries(e) ? Tv : kindMeta[e.kind].icon;
              return (
                <button
                  type="button"
                  key={e.id}
                  className="lt-rec"
                  style={toneVars(toneOf(e))}
                  onClick={() => viewEntry(e)}
                >
                  <span className={'lt-thumb' + (media ? ' media' : '')}>
                    {img ? <img src={img} alt="" loading="lazy" /> : <Icon size={15} />}
                  </span>
                  <span className="lt-rec-main">
                    <strong>{e.title || e.kind}</strong>
                    <small>
                      {kindLabel(e)} ·{' '}
                      {friendlyDate(todayInputValue(new Date(addedAt(e))), today).toLowerCase()}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
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
      {notebook.length > 0 && (
        <section aria-labelledby="lt-nb">
          <h2 className="lt-h2" id="lt-nb">
            Libreta
          </h2>
          <div className="lt-secs small">{notebook}</div>
        </section>
      )}
      {reading.sheet}
    </div>
  );
}
