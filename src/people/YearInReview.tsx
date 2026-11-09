import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  BookOpen,
  CalendarHeart,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clapperboard,
  Clock,
  Crown,
  Gift,
  HeartHandshake,
  Images,
  Layers,
  Lightbulb,
  MapPin,
  Newspaper,
  PartyPopper,
  Play,
  Smile,
  Sparkles,
  Star,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry, Person } from '../data';
import { episodeKindOf } from '../lib/episodes';
import { hoursLabel, PACE } from '../lib/entries';
import { initials, money } from '../lib/format';
import { relationMeta } from '../lib/people';
import { placeKinds } from '../lib/places';
import { day, readingsOf, type WeekReading } from '../weekly/week';
import { Avatar } from './Avatar';
import { yearReview, type Year, type YearReview } from './yearReview';
import './wrapped.css';

type Tone = 'forest' | 'rose' | 'sky' | 'sun' | 'plum' | 'clay' | 'ink' | 'mint';

/** Una historia: se ve en miniatura en la tira y en grande en el visor. */
type Slide = {
  id: string;
  tone: Tone;
  icon: LucideIcon;
  label: string;
  /** Foto de fondo (oscurecida para que el texto se lea). */
  photo?: string;
  body: ReactNode;
  action?: { label: string; run: () => void };
};

const DURATION = 7000;
const first = (p: Person) => p.name.split(' ')[0];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const longDate = (iso: string) =>
  new Date(day(iso) + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
const monthNames = 'EFMAMJJASOND'.split('');

/** Cara de una persona que escala con la historia (el tamaño va en unidades del contenedor). */
function Face({ person, size }: { person: Person; size: string }) {
  const meta = person.profile.relation ? relationMeta[person.profile.relation] : null;
  const photo = person.profile.photo;
  const src = photo ? (photo.medium ?? photo.url ?? photo.thumb) : null;
  return (
    <span
      className="ws-face"
      style={
        {
          '--f': size,
          background: meta?.soft ?? person.color,
          color: meta?.ink ?? '#4c5642',
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" loading="lazy" /> : initials(person.name).toUpperCase()}
    </span>
  );
}

function Story({ s }: { s: Slide }) {
  return (
    <div className={'ws ' + s.tone + (s.photo ? ' photo' : '')}>
      {s.photo && <img className="ws-bg" src={s.photo} alt="" loading="lazy" />}
      <div className="ws-in">
        <span className="ws-label">
          <s.icon /> {s.label}
        </span>
        <div className="ws-body">{s.body}</div>
      </div>
    </div>
  );
}

/** Visor a pantalla completa: avanza solo, toca a los lados para moverte, mantén para pausar. */
function StoryViewer({
  slides,
  index,
  onClose,
}: {
  slides: Slide[];
  index: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(index);
  const [hold, setHold] = useState(false);
  const downAt = useRef(0);
  const frame = useRef<HTMLDivElement>(null);
  const s = slides[i];
  const next = () => (i < slides.length - 1 ? setI(i + 1) : onClose());
  const prev = () => setI((x) => Math.max(0, x - 1));
  // Un toque largo pausa; al soltar no debe pasar de historia.
  const tap = (fn: () => void) => () => {
    if (Date.now() - downAt.current < 350) fn();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    frame.current?.focus();
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  return createPortal(
    <div
      className="wv"
      role="dialog"
      aria-modal="true"
      aria-label="Tu año en historias"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <button
        type="button"
        className="wv-nav"
        aria-label="Historia anterior"
        disabled={i === 0}
        onClick={prev}
      >
        <ChevronLeft size={22} />
      </button>
      <div
        ref={frame}
        tabIndex={-1}
        className="wv-frame"
        onPointerDown={() => {
          downAt.current = Date.now();
          setHold(true);
        }}
        onPointerUp={() => setHold(false)}
        onPointerLeave={() => setHold(false)}
        onPointerCancel={() => setHold(false)}
      >
        <div className="wv-bars" aria-hidden="true">
          {slides.map((x, j) => (
            <span key={x.id}>
              <i
                key={j === i ? 'run' : 'idle'}
                className={j < i ? 'done' : j === i ? 'run' : ''}
                style={
                  j === i
                    ? {
                        animationDuration: `${DURATION}ms`,
                        animationPlayState: hold ? 'paused' : 'running',
                      }
                    : undefined
                }
                onAnimationEnd={j === i ? next : undefined}
              />
            </span>
          ))}
        </div>
        <Story s={s} />
        <button
          type="button"
          className="wv-zone prev"
          aria-label="Anterior"
          onClick={tap(prev)}
        />
        <button
          type="button"
          className="wv-zone next"
          aria-label="Siguiente"
          onClick={tap(next)}
        />
        <button type="button" className="wv-x" aria-label="Cerrar" onClick={onClose}>
          <X size={20} />
        </button>
        {s.action && (
          <button
            type="button"
            className="wv-action"
            onClick={() => {
              onClose();
              s.action!.run();
            }}
          >
            {s.action.label} <ArrowRight size={15} />
          </button>
        )}
      </div>
      <button
        type="button"
        className="wv-nav"
        aria-label="Historia siguiente"
        onClick={next}
      >
        <ChevronRight size={22} />
      </button>
    </div>,
    document.body,
  );
}

function Stars({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="ws-stars" aria-label={`${n} de 5`}>
      {'★'.repeat(n)}
      <i>{'★'.repeat(Math.max(0, 5 - n))}</i>
    </span>
  );
}

/** Las historias que tienen algo que contar, en orden de relato. */
function useSlides(r: YearReview, reading: WeekReading | null, year: Year): Slide[] {
  const app = useApp();
  const { workspace, go, peekPerson, viewEntry, openImages } = app;
  const w = r.social;
  const byId = (id: string) => workspace.people.find((p) => p.id === id);
  const out: Slide[] = [];
  const yearLabel = year === 'todo' ? 'Toda tu historia' : `Tu ${year}`;
  const cover = (e: Entry) => {
    const c = r.cover(e);
    return c ? (c.medium ?? c.url) : null;
  };

  if (r.entries.length) {
    const facts = [
      w.people > 0 && [w.people, w.people === 1 ? 'persona' : 'personas'],
      r.places.length > 0 && [r.places.length, r.places.length === 1 ? 'lugar' : 'lugares'],
      r.activeDays > 0 && [r.activeDays, r.activeDays === 1 ? 'día con algo' : 'días con algo'],
      r.streak > 2 && [r.streak, 'días seguidos'],
    ].filter(Boolean) as [number, string][];
    out.push({
      id: 'intro',
      tone: 'forest',
      icon: Sparkles,
      label: yearLabel,
      body: (
        <>
          <p className="ws-kicker">Guardaste</p>
          <h2 className="ws-big">{r.entries.length}</h2>
          <p className="ws-title">{r.entries.length === 1 ? 'recuerdo' : 'recuerdos'}</p>
          {facts.length > 0 && (
            <ul className="ws-facts">
              {facts.map(([n, label]) => (
                <li key={label}>
                  <b>{n}</b> {label}
                </li>
              ))}
            </ul>
          )}
        </>
      ),
    });
  }

  const star = w.top[0];
  if (star) {
    out.push({
      id: 'star',
      tone: 'rose',
      icon: Crown,
      label: 'Tu persona',
      body: (
        <div className="ws-center">
          <Face person={star.person} size="46cqi" />
          <h2 className="ws-title xl">{star.person.name}</h2>
          <p className="ws-sub">
            {plural(star.n, 'momento juntos', 'momentos juntos')}
            {w.total > 1 && ` · ${Math.round((star.n / w.total) * 100)} % de tus momentos`}
          </p>
        </div>
      ),
      action: { label: `Ver a ${first(star.person)}`, run: () => peekPerson(star.person) },
    });
  }

  if (w.top.length > 1) {
    out.push({
      id: 'top',
      tone: 'sun',
      icon: Users,
      label: 'Tu gente',
      body: (
        <>
          <h3 className="ws-title">Con quién más compartiste</h3>
          <ol className="ws-rank">
            {w.top.map(({ person, n }, i) => (
              <li key={person.id}>
                <b>{i + 1}</b>
                <Face person={person} size={i === 0 ? '15cqi' : '12cqi'} />
                <span className="ws-rank-name">
                  <strong>{person.name}</strong>
                  <i style={{ width: `${(n / w.top[0].n) * 100}%` }} />
                </span>
                <em>{n}</em>
              </li>
            ))}
          </ol>
        </>
      ),
    });
  }

  if (w.busiest && w.total >= 3) {
    const max = Math.max(1, ...w.months);
    out.push({
      id: 'month',
      tone: 'sky',
      icon: CalendarHeart,
      label: 'Tu mes',
      body: (
        <>
          <p className="ws-kicker">Tu mes más social fue</p>
          <h2 className="ws-title xl cap">{w.busiest}</h2>
          <div className="ws-months">
            {w.months.map((m, i) => (
              <span key={i}>
                <i style={{ height: `${8 + (m / max) * 92}%` }} className={m === max ? 'top' : ''} />
                <small>{monthNames[i]}</small>
              </span>
            ))}
          </div>
          <p className="ws-sub">{plural(max, 'momento', 'momentos')} con tu gente ese mes.</p>
        </>
      ),
    });
  }

  if (w.duo?.a && w.duo.b) {
    const { a, b, n } = w.duo;
    out.push({
      id: 'duo',
      tone: 'plum',
      icon: HeartHandshake,
      label: 'Dúo inseparable',
      body: (
        <div className="ws-center">
          <div className="ws-pair">
            <Face person={a} size="34cqi" />
            <Face person={b} size="34cqi" />
          </div>
          <h2 className="ws-title">
            {first(a)} y {first(b)}
          </h2>
          <p className="ws-sub">Aparecieron juntos en {plural(n, 'recuerdo', 'recuerdos')}.</p>
        </div>
      ),
    });
  }

  // Momentos con foto, uno por historia.
  for (const e of r.moments) {
    const img = e.images[0];
    const people = e.person_ids.flatMap((id) => byId(id) ?? []);
    out.push({
      id: 'm' + e.id,
      tone: 'ink',
      icon: Sparkles,
      label: 'Un momento',
      photo: img.medium ?? img.url,
      body: (
        <div className="ws-bottom">
          <p className="ws-kicker">
            {longDate(e.created_at)}
            {e.details.place && ` · ${e.details.place}`}
          </p>
          <h2 className="ws-title">{e.title || e.kind}</h2>
          {people.length > 0 && (
            <div className="ws-faces">
              {people.slice(0, 6).map((p) => (
                <Face key={p.id} person={p} size="11cqi" />
              ))}
              {people.length > 6 && <em>+{people.length - 6}</em>}
            </div>
          )}
        </div>
      ),
      action: { label: 'Ver el recuerdo', run: () => viewEntry(e) },
    });
  }

  if (w.biggest && !r.moments.includes(w.biggest)) {
    const e = w.biggest;
    const people = e.person_ids.flatMap((id) => byId(id) ?? []);
    out.push({
      id: 'big',
      tone: 'clay',
      icon: PartyPopper,
      label: 'El más concurrido',
      photo: e.images[0] ? (e.images[0].medium ?? e.images[0].url) : undefined,
      body: (
        <div className={e.images[0] ? 'ws-bottom' : ''}>
          <h2 className="ws-big">{e.person_ids.length}</h2>
          <p className="ws-title">personas en un mismo momento</p>
          <p className="ws-sub">
            {e.title} · {longDate(e.created_at)}
          </p>
          <div className="ws-faces">
            {people.slice(0, 7).map((p) => (
              <Face key={p.id} person={p} size="11cqi" />
            ))}
          </div>
        </div>
      ),
      action: { label: 'Ver el recuerdo', run: () => viewEntry(e) },
    });
  }

  if (r.photos.length >= 3) {
    const shown = r.photos.slice(0, 6);
    out.push({
      id: 'photos',
      tone: 'ink',
      icon: Images,
      label: 'En fotos',
      body: (
        <>
          <div className={'ws-mosaic n' + shown.length}>
            {shown.map((p) => (
              <img key={p.url} src={p.thumb ?? p.medium ?? p.url} alt="" loading="lazy" />
            ))}
          </div>
          <h3 className="ws-title">{r.photos.length} fotos</h3>
          <p className="ws-sub">de tus recuerdos, episodios y novedades.</p>
        </>
      ),
      action: { label: 'Ver las fotos', run: () => openImages(r.photos, 0) },
    });
  }

  const topPlace = r.places[0];
  if (topPlace) {
    const k = placeKinds[topPlace.place?.kind ?? 'otro'] ?? placeKinds.otro;
    const img = topPlace.place?.images[0];
    out.push({
      id: 'place',
      tone: 'mint',
      icon: MapPin,
      label: 'Tu lugar',
      photo: img ? (img.medium ?? img.url) : undefined,
      body: (
        <div className={img ? 'ws-bottom' : ''}>
          {!img && (
            <span className="ws-tile" style={{ '--c': k.color, '--s': k.soft } as CSSProperties}>
              <k.icon />
            </span>
          )}
          <p className="ws-kicker">Donde más estuviste</p>
          <h2 className="ws-title xl">{topPlace.name}</h2>
          <p className="ws-sub">
            {plural(topPlace.visits.length, 'visita', 'visitas')}
            {topPlace.people.length > 0 &&
              ` · con ${topPlace.people
                .slice(0, 2)
                .map(first)
                .join(' y ')}${topPlace.people.length > 2 ? ` y ${topPlace.people.length - 2} más` : ''}`}
          </p>
          {r.places.length > 1 && (
            <ul className="ws-facts">
              <li>
                <b>{r.places.length}</b> lugares en total
              </li>
              {r.newPlaces.length > 0 && (
                <li>
                  <b>{r.newPlaces.length}</b> {r.newPlaces.length === 1 ? 'nuevo' : 'nuevos'}
                </li>
              )}
            </ul>
          )}
        </div>
      ),
      action: topPlace.place
        ? { label: 'Ver el lugar', run: () => go('Lugares', topPlace.place) }
        : undefined,
    });
  }

  if (r.moodTotal >= 3 && r.moodList[0]) {
    const top = r.moodList[0];
    out.push({
      id: 'mood',
      tone: 'sun',
      icon: Smile,
      label: 'Cómo te sentiste',
      body: (
        <div className="ws-center">
          <span className="ws-emoji">{top.emoji}</span>
          <h2 className="ws-title">Predominó {top.label.toLowerCase()}</h2>
          <p className="ws-sub">
            En {Math.round((top.n / r.moodTotal) * 100)} % de los recuerdos con ánimo.
          </p>
          {r.moodList.length > 1 && (
            <div className="ws-moods">
              {r.moodList.slice(1, 5).map((m) => (
                <span key={m.value} title={m.label}>
                  {m.emoji} <small>{Math.round((m.n / r.moodTotal) * 100)} %</small>
                </span>
              ))}
            </div>
          )}
        </div>
      ),
    });
  }

  if (r.books.length || r.pages > 0) {
    const covers = r.books.flatMap((e) => cover(e) ?? []).slice(0, 4);
    out.push({
      id: 'books',
      tone: 'clay',
      icon: BookOpen,
      label: 'Libros',
      body: (
        <>
          {covers.length > 0 && (
            <div className="ws-covers">
              {covers.map((src) => (
                <img key={src} src={src} alt="" loading="lazy" />
              ))}
            </div>
          )}
          {r.books.length > 0 ? (
            <>
              <h2 className="ws-big">{r.books.length}</h2>
              <p className="ws-title">
                {r.books.length === 1 ? 'libro terminado' : 'libros terminados'}
              </p>
            </>
          ) : (
            <p className="ws-title">Seguiste leyendo</p>
          )}
          {r.pages > 0 && (
            <p className="ws-sub">{r.pages.toLocaleString('es-CO')} páginas leídas.</p>
          )}
        </>
      ),
    });
  }

  if (r.movies.length || r.series.length) {
    const screen = [...r.movies, ...r.series];
    const covers = screen.flatMap((e) => cover(e) ?? []).slice(0, 4);
    out.push({
      id: 'screen',
      tone: 'ink',
      icon: Clapperboard,
      label: 'En pantalla',
      body: (
        <>
          {covers.length > 0 && (
            <div className="ws-covers">
              {covers.map((src) => (
                <img key={src} src={src} alt="" loading="lazy" />
              ))}
            </div>
          )}
          <h2 className="ws-big">{screen.length}</h2>
          <p className="ws-title">
            {[
              r.movies.length && plural(r.movies.length, 'película', 'películas'),
              r.series.length && plural(r.series.length, 'serie', 'series'),
            ]
              .filter(Boolean)
              .join(' y ')}
          </p>
          {r.movieHours > 0 && (
            <p className="ws-sub">Unas {plural(r.movieHours, 'hora', 'horas')} de cine.</p>
          )}
        </>
      ),
    });
  }

  if (r.favorite) {
    const e = r.favorite;
    const src = cover(e);
    out.push({
      id: 'fav',
      tone: 'sun',
      icon: Star,
      label: 'Tu favorito',
      photo: src ?? undefined,
      body: (
        <div className={src ? 'ws-bottom' : ''}>
          <p className="ws-kicker">{e.kind === 'Libro' ? 'El libro' : 'Lo que viste'} del año</p>
          <h2 className="ws-title xl">{e.title}</h2>
          {e.details.author && <p className="ws-sub">{e.details.author}</p>}
          <Stars n={e.details.rating} />
        </div>
      ),
      action: { label: 'Abrir', run: () => viewEntry(e) },
    });
  }

  if (reading?.articles.length) {
    const n = reading.articles.length;
    out.push({
      id: 'reading',
      tone: 'sky',
      icon: Newspaper,
      label: 'Lecturas',
      body: (
        <>
          <h2 className="ws-big">{n >= 30 ? '30+' : n}</h2>
          <p className="ws-title">{n === 1 ? 'lectura terminada' : 'lecturas terminadas'}</p>
          {reading.marks > 0 && (
            <p className="ws-sub">{plural(reading.marks, 'resaltado', 'resaltados')}.</p>
          )}
          {reading.quote && (
            <blockquote className="ws-quote">
              «{reading.quote.text}»<small>{reading.quote.title}</small>
            </blockquote>
          )}
        </>
      ),
      action: { label: 'Ir a Lecturas', run: () => go('Lecturas') },
    });
  }

  if (r.learnings.length) {
    out.push({
      id: 'learn',
      tone: 'mint',
      icon: Lightbulb,
      label: 'Aprendiste',
      body: (
        <>
          <h2 className="ws-big">{r.learnings.length}</h2>
          <p className="ws-title">{r.learnings.length === 1 ? 'cosa nueva' : 'cosas nuevas'}</p>
          <ul className="ws-lines">
            {r.learnings.slice(0, 3).map((e) => (
              <li key={e.id}>{e.title}</li>
            ))}
          </ul>
        </>
      ),
    });
  }

  if (r.episodes.length) {
    out.push({
      id: 'episodes',
      tone: 'plum',
      icon: Layers,
      label: 'Episodios',
      body: (
        <>
          <h2 className="ws-big">{r.episodes.length}</h2>
          <p className="ws-title">{r.episodes.length === 1 ? 'episodio vivido' : 'episodios vividos'}</p>
          <ul className="ws-lines icons">
            {r.episodes.slice(0, 4).map(({ episode }) => {
              const k = episodeKindOf(episode.kind);
              return (
                <li key={episode.id}>
                  <k.icon /> <span>{episode.title}</span>
                </li>
              );
            })}
          </ul>
        </>
      ),
      action: { label: 'Ver episodios', run: () => go('Episodios') },
    });
  }

  if (w.newPeople.length) {
    out.push({
      id: 'new',
      tone: 'forest',
      icon: UserPlus,
      label: 'Llegaron a tu vida',
      body: (
        <div className="ws-center">
          <div className="ws-faces wrap">
            {w.newPeople.slice(0, 9).map((p) => (
              <Face key={p.id} person={p} size="17cqi" />
            ))}
          </div>
          <h2 className="ws-title">
            {plural(w.newPeople.length, 'persona nueva', 'personas nuevas')}
          </h2>
          <p className="ws-sub">
            {w.newPeople
              .slice(0, 3)
              .map(first)
              .join(', ')}
            {w.newPeople.length > 3 ? ' y más.' : '.'}
          </p>
        </div>
      ),
    });
  }

  if (r.news.length) {
    out.push({
      id: 'news',
      tone: 'rose',
      icon: Sparkles,
      label: 'La vida de tu gente',
      body: (
        <>
          <h2 className="ws-big">{r.news.length}</h2>
          <p className="ws-title">{r.news.length === 1 ? 'novedad' : 'novedades'} que anotaste</p>
          <ul className="ws-lines">
            {r.news.slice(0, 3).map(({ person, update }) => (
              <li key={update.id}>
                <b>{first(person)}</b> · {update.text}
              </li>
            ))}
          </ul>
        </>
      ),
    });
  }

  if (w.give + w.receive > 0) {
    const balance = Math.round(((w.give - w.receive) / (w.give + w.receive)) * 100);
    out.push({
      id: 'give',
      tone: 'clay',
      icon: Gift,
      label: 'Dar y recibir',
      body: (
        <div className="ws-center">
          <h2 className="ws-title xl">
            {Math.abs(balance) <= 20 ? 'Equilibrado' : balance > 0 ? 'Diste más' : 'Recibiste más'}
          </h2>
          <div className="ws-scale">
            <i style={{ flex: Math.max(w.give, 0.0001) }} />
            <i style={{ flex: Math.max(w.receive, 0.0001) }} />
          </div>
          <p className="ws-sub">
            {w.give} puntos dados · {w.receive} recibidos
          </p>
        </div>
      ),
    });
  }

  const did = [
    r.notes.length > 0 && [r.notes.length, r.notes.length === 1 ? 'nota escrita' : 'notas escritas'],
    r.work.length > 0 && [r.work.length, r.work.length === 1 ? 'avance de trabajo' : 'avances de trabajo'],
    r.closed.length > 0 && [
      r.closed.length,
      r.closed.length === 1 ? 'pendiente cerrado' : 'pendientes cerrados',
    ],
  ].filter(Boolean) as [number, string][];
  if (did.length) {
    out.push({
      id: 'did',
      tone: 'sky',
      icon: CircleCheck,
      label: 'Lo que hiciste',
      body: (
        <ul className="ws-stack">
          {did.map(([n, label]) => (
            <li key={label}>
              <b>{n}</b>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      ),
    });
  }

  if (r.spent > 0 || r.earned > 0) {
    out.push({
      id: 'money',
      tone: 'mint',
      icon: Wallet,
      label: 'Tu dinero',
      body: (
        <ul className="ws-stack">
          {r.spent > 0 && (
            <li>
              <b className="small">−{money(r.spent)}</b>
              <span>gastado</span>
            </li>
          )}
          {r.earned > 0 && (
            <li>
              <b className="small">+{money(r.earned)}</b>
              <span>ingresos</span>
            </li>
          )}
          {r.topCategory && (
            <li>
              <b className="small">{r.topCategory[0]}</b>
              <span>donde más gastaste · {money(r.topCategory[1])}</span>
            </li>
          )}
        </ul>
      ),
      action: { label: 'Ir a Finanzas', run: () => go('Finanzas') },
    });
  }

  if (w.faded.length) {
    out.push({
      id: 'faded',
      tone: 'sun',
      icon: CalendarHeart,
      label: 'Para retomar',
      body: (
        <div className="ws-center">
          <div className="ws-faces wrap">
            {w.faded.slice(0, 9).map((p) => (
              <Face key={p.id} person={p} size="17cqi" />
            ))}
          </div>
          <h2 className="ws-title">{plural(w.faded.length, 'persona', 'personas')} por retomar</h2>
          <p className="ws-sub">Hablaste con ellas el año anterior, pero no en este.</p>
        </div>
      ),
    });
  }

  return out;
}

/** Tiempo aproximado entre libros y pantallas: total, reparto y una equivalencia amable. */
function MediaTime({ r }: { r: YearReview }) {
  const { read, screen, total } = r.time;
  const hours = total / 60;
  const days = Math.round((hours / 24) * 2) / 2;
  const afternoons = Math.round(hours / 3);
  const like =
    days >= 1
      ? `Como ${days.toLocaleString('es-CO')} ${days === 1 ? 'día' : 'días'} seguidos, sin parar.`
      : afternoons >= 1
        ? `Como ${plural(afternoons, 'tarde', 'tardes')} de domingo bien aprovechadas.`
        : null;
  const pagesRead = Math.round(read / PACE.minutesPerPage);
  const screenBits = [
    r.movies.length && plural(r.movies.length, 'película', 'películas'),
    r.episodesWatched && plural(r.episodesWatched, 'episodio', 'episodios'),
  ].filter(Boolean);
  const pct = (n: number) => `${Math.round((n / total) * 100)} %`;
  return (
    <div className="wr-time">
      <div className="wr-time-total">
        <Clock size={15} aria-hidden="true" />
        <strong>≈ {hoursLabel(total)}</strong>
        <span>entre páginas y pantallas</span>
      </div>
      {like && <p className="wr-time-like">{like}</p>}
      {read > 0 && screen > 0 && (
        <div className="wr-time-bar" aria-hidden="true">
          <i className="read" style={{ flexGrow: read }} />
          <i className="screen" style={{ flexGrow: screen }} />
        </div>
      )}
      <ul className="wr-time-legend">
        {read > 0 && (
          <li className="read">
            <BookOpen size={14} aria-hidden="true" />
            <span>
              Leyendo <b>{hoursLabel(read)}</b>
            </span>
            <small>
              {pagesRead.toLocaleString('es-CO')} págs.{screen > 0 && ` · ${pct(read)}`}
            </small>
          </li>
        )}
        {screen > 0 && (
          <li className="screen">
            <Clapperboard size={14} aria-hidden="true" />
            <span>
              En pantalla <b>{hoursLabel(screen)}</b>
            </span>
            <small>
              {screenBits.join(' · ')}
              {read > 0 && ` · ${pct(screen)}`}
            </small>
          </li>
        )}
      </ul>
      <p className="wr-time-note">
        Aproximado: {PACE.minutesPerPage.toLocaleString('es-CO')} min por página y la duración de
        cada película o episodio visto.
      </p>
    </div>
  );
}

/** Una tarjeta de «En detalle»: solo se dibuja si tiene algo. */
function Card({
  icon: Icon,
  title,
  tone,
  count,
  className = '',
  children,
}: {
  icon: LucideIcon;
  title: string;
  tone: Tone;
  count?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`wr-card ${tone} ${className}`}>
      <header className="wr-card-head">
        <span className="wr-ico" aria-hidden="true">
          <Icon size={16} />
        </span>
        <h3>{title}</h3>
        {count !== undefined && <span className="wr-count">{count}</span>}
      </header>
      {children}
    </section>
  );
}

/** Portada de las historias: una sola tarjeta (con las siguientes asomando detrás) que abre el visor. */
function StoryCover({
  slides,
  title,
  onOpen,
}: {
  slides: Slide[];
  title: string;
  onOpen: () => void;
}) {
  const [front, ...rest] = slides;
  const labels = rest.map((s) => s.label);
  const shown = [...new Set(labels)].slice(0, 3);
  const more = slides.length - 1 - shown.length;
  return (
    <button type="button" className="wr-cover" onClick={onOpen}>
      <span className="wr-cover-stack" aria-hidden="true">
        {rest[1] && <span className={'wr-cover-card back2 ws ' + rest[1].tone} />}
        {rest[0] && <span className={'wr-cover-card back1 ws ' + rest[0].tone} />}
        <span className="wr-cover-card front">
          <Story s={front} />
        </span>
      </span>
      <span className="wr-cover-text">
        <span className="wr-cover-kicker">
          <Sparkles size={14} /> {plural(slides.length, 'historia', 'historias')}
        </span>
        <strong>{title}</strong>
        {shown.length > 0 && (
          <span className="wr-cover-sub">
            {shown.join(' · ')}
            {more > 0 && ` y ${more} más`}
          </span>
        )}
        <span className="wr-cover-play">
          <Play size={14} /> Ver historias
        </span>
      </span>
    </button>
  );
}

/** «Tu año»: historias para recorrerlo y, debajo, el detalle navegable. */
export function YearInReview({ year }: { year: Year }) {
  const { workspace, go, peekPerson, viewEntry, openImages } = useApp();
  const r = useMemo(() => yearReview(workspace, year), [workspace, year]);
  const [reading, setReading] = useState<WeekReading | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setReading(null);
    void readingsOf(r.start, r.end)
      .then((x) => live && setReading(x))
      .catch(() => live && setReading(null));
    return () => {
      live = false;
    };
  }, [r.start, r.end]);

  const slides = useSlides(r, reading, year);
  const w = r.social;
  const media = [...r.books, ...r.movies, ...r.series].filter((e) => r.cover(e)).slice(0, 10);

  if (!slides.length) {
    return (
      <div className="wr-empty">
        <Sparkles size={28} />
        <h3>Aún no hay nada guardado en este periodo.</h3>
        <p>Registra encuentros, lugares, libros o películas y aquí aparecerá tu resumen.</p>
      </div>
    );
  }

  return (
    <div className="wr">
      <StoryCover
        slides={slides}
        title={`${year === 'todo' ? 'Toda tu historia' : `Tu ${year}`} en historias`}
        onOpen={() => setOpen(0)}
      />

      <div className="wr-grid">
        {w.top.length > 0 && (
          <Card icon={Users} title="Tu gente" tone="rose" className="top">
            <ol>
              {w.top.map(({ person, n }, i) => (
                <li key={person.id}>
                  <button type="button" onClick={() => peekPerson(person)}>
                    <b>{i + 1}</b>
                    <Avatar person={person} size={i === 0 ? 42 : 34} />
                    <span className="wr-top-name">
                      <strong>{person.name}</strong>
                      <i style={{ width: `${(n / w.top[0].n) * 100}%` }} />
                    </span>
                    <em>{n}</em>
                  </button>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {r.photos.length > 0 && (
          <Card
            icon={Images}
            title="Tus momentos"
            tone="sky"
            count={r.photos.length}
            className="photos wide"
          >
            <div className="wr-photos">
              {r.photos.slice(0, 9).map((p, i) => (
                <button
                  type="button"
                  key={p.url}
                  aria-label="Ver la foto"
                  onClick={() => openImages(r.photos, i)}
                >
                  <img src={p.thumb ?? p.medium ?? p.url} alt="" loading="lazy" />
                  {i === 8 && r.photos.length > 9 && <i>+{r.photos.length - 9}</i>}
                </button>
              ))}
            </div>
          </Card>
        )}

        {r.places.length > 0 && (
          <Card icon={MapPin} title="Tus lugares" tone="mint" count={r.places.length}>
            <ul className="wr-rows">
              {r.places.slice(0, 5).map((v) => {
                const k = placeKinds[v.place?.kind ?? 'otro'] ?? placeKinds.otro;
                const body = (
                  <>
                    <k.icon size={15} style={{ color: k.color, flex: 'none' }} />
                    <span>{v.name}</span>
                    <small>{plural(v.visits.length, 'vez', 'veces')}</small>
                  </>
                );
                return (
                  <li key={v.key}>
                    {v.place ? (
                      <button type="button" onClick={() => go('Lugares', v.place)}>
                        {body}
                      </button>
                    ) : (
                      <div>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {(media.length > 0 || r.time.total >= 30) && (
          <Card
            icon={BookOpen}
            title="Libros y pantallas"
            tone="clay"
            count={r.books.length + r.movies.length + r.series.length}
            className="media"
          >
            {r.time.total >= 30 && <MediaTime r={r} />}
            {media.length > 0 && (
              <div className="wr-covers">
                {media.map((e) => {
                  const c = r.cover(e)!;
                  return (
                    <button type="button" key={e.id} title={e.title} onClick={() => viewEntry(e)}>
                      <img src={c.thumb ?? c.medium ?? c.url} alt={e.title} loading="lazy" />
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {r.episodes.length > 0 && (
          <Card icon={Layers} title="Tus episodios" tone="plum" count={r.episodes.length}>
            <ul className="wr-rows">
              {r.episodes.slice(0, 5).map(({ episode }) => {
                const k = episodeKindOf(episode.kind);
                return (
                  <li key={episode.id}>
                    <button type="button" onClick={() => go('Episodios', episode)}>
                      <k.icon size={15} style={{ color: k.color, flex: 'none' }} />
                      <span>{episode.title}</span>
                      <small>{episode.status === 'activo' ? 'En curso' : 'Cerrado'}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {w.newPeople.length > 0 && (
          <Card icon={UserPlus} title="Llegaron a tu vida" tone="forest" count={w.newPeople.length}>
            <div className="wr-faces">
              {w.newPeople.slice(0, 14).map((p) => (
                <button type="button" key={p.id} title={p.name} onClick={() => peekPerson(p)}>
                  <Avatar person={p} size={38} />
                </button>
              ))}
            </div>
          </Card>
        )}

        {w.faded.length > 0 && (
          <Card icon={CalendarHeart} title="Para retomar" tone="sun" count={w.faded.length}>
            <div className="wr-faces">
              {w.faded.slice(0, 14).map((p) => (
                <button type="button" key={p.id} title={p.name} onClick={() => peekPerson(p)}>
                  <Avatar person={p} size={38} />
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>

      {open !== null && (
        <StoryViewer slides={slides} index={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
