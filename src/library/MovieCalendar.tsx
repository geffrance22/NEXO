import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clapperboard,
  ExternalLink,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { kindMeta } from '../composer/kinds';
import { isSeries } from '../lib/entries';
import { todayInputValue } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { yearOf } from './shelf';
import './movieCalendar.css';

/** El día en que la viste (created_at es cuándo pasó). */
const dayOf = (e: Entry) => todayInputValue(new Date(e.created_at));
const isWatched = (e: Entry) =>
  e.kind === 'Película' && !isSeries(e) && (e.details.watch ?? 'vista') === 'vista';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MONTHS = Array.from({ length: 12 }, (_, m) =>
  cap(new Date(2000, m, 1).toLocaleDateString('es-CO', { month: 'long' })),
);
const WEEK = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const two = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${two(m + 1)}-${two(d)}`;

/** 42 casillas (6 semanas, de lunes a domingo); null fuera del mes. */
function monthCells(y: number, m: number) {
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const total = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, i) => {
    const d = i - lead + 1;
    return d >= 1 && d <= total ? d : null;
  });
}

const longDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return cap(
    new Date(y, m - 1, d).toLocaleDateString('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  );
};

const look = kindMeta['Película'];
const tone = { '--mc-c': look.accent, '--mc-s': look.soft, '--mc-k': look.ink } as CSSProperties;

/** Botón de la pestaña Películas que abre el calendario de lo que viste. */
export function MovieCalendarButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="lb-btn mc-launch"
        aria-label="Calendario de películas"
        title="Calendario de películas"
        onClick={() => setOpen(true)}
      >
        <CalendarDays size={16} />
      </button>
      {open && createPortal(<MovieCalendar onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/**
 * Calendario de películas vistas: el año en doce meses o un mes en grande, con cuántas viste
 * cada día. Un clic en un día abre sus fichas; de ahí se pasa a la siguiente o a la anterior,
 * dentro del día o a lo largo de todo lo que has visto. Nunca se desplaza: todo cabe en pantalla.
 */
function MovieCalendar({ onClose }: { onClose: () => void }) {
  const { workspace, viewEntry } = useApp();
  const today = todayInputValue();
  // Todas las vistas, de la más antigua a la más reciente.
  const all = useMemo(
    () =>
      workspace.entries
        .filter(isWatched)
        .sort(
          (a, b) =>
            dayOf(a).localeCompare(dayOf(b)) || a.created_at.localeCompare(b.created_at),
        ),
    [workspace.entries],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of all) {
      const d = dayOf(e);
      const list = map.get(d);
      if (list) list.push(e);
      else map.set(d, [e]);
    }
    return map;
  }, [all]);

  const [mode, setMode] = useState<'anio' | 'mes'>('anio');
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) - 1);
  // La película abierta (índice en `all`); null: se ve el calendario.
  const [at, setAt] = useState<number | null>(null);
  const movie = at === null ? null : all[at];

  // Al moverte entre fichas, el calendario te sigue (al volver estás en ese mes).
  useEffect(() => {
    if (!movie) return;
    const d = dayOf(movie);
    setYear(Number(d.slice(0, 4)));
    setMonth(Number(d.slice(5, 7)) - 1);
  }, [movie]);

  const openDay = (date: string) => {
    const first = byDay.get(date)?.[0];
    if (first) setAt(all.indexOf(first));
  };
  const step = (n: number) =>
    setAt((i) => (i === null ? i : Math.max(0, Math.min(all.length - 1, i + n))));
  /** Al primer título del día anterior o siguiente con películas. */
  const jumpDay = (dir: 1 | -1) =>
    setAt((i) => {
      if (i === null) return i;
      const from = dayOf(all[i]);
      let j = i;
      if (dir === 1) {
        while (j < all.length && dayOf(all[j]) === from) j++;
        return j < all.length ? j : i;
      }
      while (j >= 0 && dayOf(all[j]) === from) j--;
      if (j < 0) return i;
      const target = dayOf(all[j]);
      while (j > 0 && dayOf(all[j - 1]) === target) j--;
      return j;
    });
  const shift = (n: number) => {
    if (mode === 'anio') return setYear((y) => y + n);
    const next = new Date(year, month + n, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  const live = useRef({ at, step, jumpDay, shift, onClose });
  live.current = { at, step, jumpDay, shift, onClose };
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      // Lo que esté encima (la ficha completa, un visor de fotos) manda.
      if (document.querySelector('.sheet-backdrop, .confirm-backdrop, .lightbox')) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      const k = live.current;
      if (e.key === 'Escape') {
        if (k.at !== null) setAt(null);
        else k.onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (k.at === null) k.shift(dir);
        else if (e.shiftKey) k.jumpDay(dir);
        else k.step(dir);
      } else if (k.at !== null && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))
        k.jumpDay(e.key === 'ArrowDown' ? 1 : -1);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  const inYear = all.filter((e) => dayOf(e).startsWith(String(year))).length;
  const monthKey = `${year}-${two(month + 1)}`;
  const inMonth = all.filter((e) => dayOf(e).startsWith(monthKey)).length;

  const pressed = useRef(false);
  return (
    <div
      className="mc-backdrop"
      onMouseDown={(e) => (pressed.current = e.target === e.currentTarget)}
      onClick={(e) => pressed.current && e.target === e.currentTarget && onClose()}
    >
      <div className="mc" style={tone} role="dialog" aria-modal="true" aria-label="Calendario de películas">
        {movie ? (
          <MovieDetail
            movie={movie}
            index={at!}
            total={all.length}
            sameDay={byDay.get(dayOf(movie)) ?? [movie]}
            onPick={(e) => setAt(all.indexOf(e))}
            onStep={step}
            onJump={jumpDay}
            onBack={() => setAt(null)}
            onClose={onClose}
            onOpen={() => {
              onClose();
              viewEntry(movie);
            }}
          />
        ) : (
          <>
            <header className="mc-head">
              <span className="mc-mark" aria-hidden="true">
                <Clapperboard size={16} />
              </span>
              <div className="mc-nav">
                <button type="button" aria-label="Anterior" title="Anterior (←)" onClick={() => shift(-1)}>
                  <ChevronLeft size={18} />
                </button>
                <h2>
                  {mode === 'anio' ? (
                    year
                  ) : (
                    <>
                      {MONTHS[month]} <span>{year}</span>
                    </>
                  )}
                </h2>
                <button type="button" aria-label="Siguiente" title="Siguiente (→)" onClick={() => shift(1)}>
                  <ChevronRight size={18} />
                </button>
              </div>
              <small className="mc-count">
                {mode === 'anio' ? inYear : inMonth}{' '}
                {(mode === 'anio' ? inYear : inMonth) === 1 ? 'película' : 'películas'}
              </small>
              <div className="mc-switch" role="tablist" aria-label="Vista">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'anio'}
                  onClick={() => setMode('anio')}
                >
                  Año
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'mes'}
                  onClick={() => setMode('mes')}
                >
                  Mes
                </button>
              </div>
              <button type="button" className="mc-close" aria-label="Cerrar" title="Cerrar (Esc)" onClick={onClose}>
                <X size={18} />
              </button>
            </header>

            {mode === 'anio' ? (
              <div className="mc-year">
                {MONTHS.map((name, m) => {
                  const key = `${year}-${two(m + 1)}`;
                  const n = all.filter((e) => dayOf(e).startsWith(key)).length;
                  return (
                    <section key={m} className={'mc-mini' + (n ? ' has' : '')}>
                      <button
                        type="button"
                        className="mc-mini-head"
                        title={`Ver ${name} en grande`}
                        onClick={() => {
                          setMonth(m);
                          setMode('mes');
                        }}
                      >
                        <strong>{name}</strong>
                        {n > 0 && <i>{n}</i>}
                      </button>
                      <div className="mc-mini-grid">
                        {monthCells(year, m).map((d, i) => {
                          if (d === null) return <span key={i} />;
                          const date = iso(year, m, d);
                          const count = byDay.get(date)?.length ?? 0;
                          return count ? (
                            <button
                              type="button"
                              key={i}
                              className={'mc-d on' + (date === today ? ' today' : '')}
                              title={`${longDate(date)} · ${count} ${count === 1 ? 'película' : 'películas'}`}
                              onClick={() => openDay(date)}
                            >
                              <b>{d}</b>
                              {count > 1 && <em>{count}</em>}
                            </button>
                          ) : (
                            <span key={i} className={'mc-d' + (date === today ? ' today' : '')}>
                              <b>{d}</b>
                            </span>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="mc-month">
                {WEEK.map((w) => (
                  <span key={w} className="mc-wd">
                    {w}
                  </span>
                ))}
                {monthCells(year, month).map((d, i) => {
                  if (d === null) return <span key={i} className="mc-cell out" />;
                  const date = iso(year, month, d);
                  const list = byDay.get(date) ?? [];
                  const img = list.length ? entryImages(list[0])[0] : undefined;
                  if (!list.length)
                    return (
                      <span key={i} className={'mc-cell' + (date === today ? ' today' : '')}>
                        <b>{d}</b>
                      </span>
                    );
                  return (
                    <button
                      type="button"
                      key={i}
                      className={'mc-cell on' + (img ? ' art' : '') + (date === today ? ' today' : '')}
                      title={list.map((e) => e.title).join(' · ')}
                      onClick={() => openDay(date)}
                    >
                      {img && <img src={img.thumb ?? img.medium ?? img.url} alt="" loading="lazy" />}
                      <b>{d}</b>
                      {list.length > 1 && <em>{list.length}</em>}
                      <small>{list[0].title}</small>
                    </button>
                  );
                })}
              </div>
            )}
            {!all.length && (
              <p className="mc-empty">Las películas que marques como vistas aparecerán aquí, en el día en que las viste.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <span className="mc-stars" aria-label={`${value} de 5`}>
      {'★'.repeat(full)}
      {half && '½'}
      <i>{'★'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)))}</i>
    </span>
  );
}

/** La ficha de una película vista, con el paso a la anterior o la siguiente. */
function MovieDetail({
  movie,
  index,
  total,
  sameDay,
  onPick,
  onStep,
  onJump,
  onBack,
  onClose,
  onOpen,
}: {
  movie: Entry;
  index: number;
  total: number;
  sameDay: Entry[];
  onPick: (e: Entry) => void;
  onStep: (n: number) => void;
  onJump: (dir: 1 | -1) => void;
  onBack: () => void;
  onClose: () => void;
  onOpen: () => void;
}) {
  const img = entryImages(movie)[0];
  const info = movie.details.movieInfo;
  const year = yearOf(movie);
  const meta = [
    year,
    info?.director,
    info?.runtime ? `${info.runtime} min` : '',
    movie.details.platform,
  ].filter(Boolean);
  const pos = sameDay.indexOf(movie);
  const review = movie.body.trim();
  const genres = (info?.genres ?? []).slice(0, 4);

  return (
    <div className="mc-detail" key={movie.id}>
      <header className="mc-head">
        <button type="button" className="mc-back" onClick={onBack}>
          <ArrowLeft size={15} /> Calendario
        </button>
        <div className="mc-day">
          <strong>{longDate(dayOf(movie))}</strong>
          <small>
            {sameDay.length > 1 ? `${pos + 1} de ${sameDay.length} este día · ` : ''}
            {index + 1} de {total} en total
          </small>
        </div>
        <button type="button" className="mc-close" aria-label="Cerrar" title="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="mc-stage">
        <button
          type="button"
          className="mc-arrow"
          aria-label="Película anterior"
          title="Anterior (←)"
          disabled={index === 0}
          onClick={() => onStep(-1)}
        >
          <ChevronLeft size={22} />
        </button>

        <article className="mc-card">
          <div className="mc-poster">
            {img ? (
              <img src={img.medium ?? img.url} alt="" />
            ) : (
              <span>
                <Clapperboard size={30} />
              </span>
            )}
          </div>
          <div className="mc-info">
            <h3>{movie.title}</h3>
            {meta.length > 0 && <p className="mc-meta">{meta.join(' · ')}</p>}
            {movie.details.rating ? <Stars value={movie.details.rating} /> : null}
            {genres.length > 0 && (
              <ul className="mc-genres">
                {genres.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
            {review ? (
              <p className="mc-review">{review}</p>
            ) : info?.overview ? (
              <p className="mc-review soft">{info.overview}</p>
            ) : null}
            <button type="button" className="mc-open" onClick={onOpen}>
              Abrir la ficha <ExternalLink size={13} />
            </button>
          </div>
        </article>

        <button
          type="button"
          className="mc-arrow"
          aria-label="Película siguiente"
          title="Siguiente (→)"
          disabled={index >= total - 1}
          onClick={() => onStep(1)}
        >
          <ChevronRight size={22} />
        </button>
      </div>

      <footer className="mc-foot">
        <button type="button" className="mc-jump" onClick={() => onJump(-1)} title="Día anterior (↑)">
          <ChevronsLeft size={15} /> Día anterior
        </button>
        {sameDay.length > 1 && (
          <div className="mc-strip" aria-label="Películas de este día">
            {sameDay.slice(0, 8).map((e) => {
              const p = entryImages(e)[0];
              return (
                <button
                  type="button"
                  key={e.id}
                  className={e.id === movie.id ? 'on' : ''}
                  title={e.title}
                  aria-label={e.title}
                  onClick={() => onPick(e)}
                >
                  {p ? <img src={p.thumb ?? p.medium ?? p.url} alt="" /> : <Clapperboard size={13} />}
                </button>
              );
            })}
            {sameDay.length > 8 && <i>+{sameDay.length - 8}</i>}
          </div>
        )}
        <button type="button" className="mc-jump" onClick={() => onJump(1)} title="Día siguiente (↓)">
          Día siguiente <ChevronsRight size={15} />
        </button>
      </footer>
    </div>
  );
}
