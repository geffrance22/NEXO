import { useMemo, type CSSProperties } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookMarked,
  Check,
  Feather,
  ListChecks,
  Newspaper,
  Pencil,
  Pin,
  Plus,
  Sparkles,
  Tv,
  Users,
  Wand2,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { TodayAgenda } from '../agenda/TodayAgenda';
import type { Entry } from '../data';
import { isActive, progressOf, withEpisode } from '../library/progress';
import { addedAt, goLibroteca, toneOf } from '../library/shelf';
import { QuoteOfDayCard } from '../library/QuoteOfDay';
import { entryImages } from '../lib/moviePosters';
import { commitmentKinds, commitmentOf, counterpartOf, isOpenTask } from '../lib/commitments';
import { friendlyDate, money, todayInputValue } from '../lib/format';
import { closenessOf, relationMeta, relationOf, relativeDay, statsFor } from '../lib/people';
import { Avatar } from '../people/Avatar';
import { Masonry } from './Masonry';
import { ReadingPick } from '../readings/ReadingPick';
import { PinnedColumnCard } from '../planner/PinnedColumn';
import './home.css';

const RECENT_MAX = 12;

/**
 * Inicio. A la izquierda, lo de hoy y lo último que añadiste; a la derecha, tarjetas pequeñas que
 * se apilan solas (captura, lectura, pendientes, tu círculo y un resumen). Cada columna crece por
 * su cuenta, así no quedan huecos entre bloques.
 */
export function Overview() {
  const { go } = useApp();
  const showTasks = () => goLibroteca(go, 'pendientes');

  return (
    <div className="home">
      <div className="home-main">
        <TodayAgenda />
        <Recent />
      </div>
      <aside className="home-side" aria-label="Accesos rápidos">
        <CaptureCard />
        <FollowCard />
        <PinnedColumnCard />
        <ReadingPick />
        <QuoteOfDayCard />
        <RadarCard onShowAll={showTasks} />
        <CircleCard />
        <SummaryCard onShowTasks={showTasks} />
      </aside>
    </div>
  );
}

/** Los últimos recuerdos que añadiste, de cualquier tipo. Todo lo demás vive en Libroteca. */
function Recent() {
  const { workspace, openEntry, go } = useApp();
  const recent = useMemo(
    () =>
      [...workspace.entries]
        .sort((a, b) => addedAt(b).localeCompare(addedAt(a)))
        .slice(0, RECENT_MAX),
    [workspace.entries],
  );
  const total = workspace.entries.length;

  return (
    <section className="nb" aria-labelledby="recent">
      <header className="nb-head">
        <h2 id="recent">Recientes</h2>
        <div className="nb-head-end">
          {total > recent.length && (
            <button type="button" className="nb-link" onClick={() => goLibroteca(go, 'inicio')}>
              Ver todo en Libroteca <ArrowUpRight size={13} />
            </button>
          )}
          <button type="button" className="nb-new" onClick={() => openEntry()}>
            <Plus size={15} /> Nuevo
          </button>
        </div>
      </header>
      {recent.length > 0 ? (
        <Masonry entries={recent} />
      ) : (
        <div className="nb-empty">
          <Feather size={20} />
          <div>
            <strong>Aún no has añadido nada.</strong>
            <span>Escribe una nota o cuenta un encuentro.</span>
          </div>
          <button type="button" className="nb-new" onClick={() => openEntry('Nota')}>
            <Plus size={15} /> Escribir
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Libros y series anclados para seguirlos de cerca: cómo vas y un toque para actualizar (la serie
 * avanza un episodio sin abrir nada; el libro abre la página para escribir dónde vas).
 */
function FollowCard() {
  const { workspace, go, openProgress, patchEntry, notify } = useApp();
  const today = todayInputValue();
  const items = workspace.entries.filter((e) => e.details.follow && isActive(e));
  if (!items.length) return null;
  const nextEpisode = async (e: Entry) => {
    const season = e.details.seasonAt ?? 1;
    const episode = (e.details.episodeAt ?? 0) + 1;
    if (await patchEntry(e, { details: withEpisode(e, season, episode) }))
      notify(`${e.title}: T${season} · E${episode}.`);
  };

  return (
    <section className="hc fw">
      <header className="hc-head">
        <h3>
          <Pin size={15} /> Siguiendo <i>{items.length}</i>
        </h3>
        <button type="button" className="hc-link" onClick={() => goLibroteca(go, 'inicio')}>
          Libroteca <ArrowUpRight size={13} />
        </button>
      </header>
      <ul className="fw-list">
        {items.map((e) => {
          const p = progressOf(e, today);
          const tone = toneOf(e);
          const img = entryImages(e)[0];
          const book = e.kind === 'Libro';
          return (
            <li
              key={e.id}
              className="fw-row"
              style={{ '--c': tone.accent, '--s': tone.soft, '--k': tone.ink } as CSSProperties}
            >
              <button
                type="button"
                className="fw-main"
                title="Actualizar progreso"
                onClick={() => openProgress(e)}
              >
                <span className="fw-art">
                  {img ? (
                    <img src={img.thumb ?? img.medium ?? img.url} alt="" />
                  ) : book ? (
                    <BookMarked size={14} />
                  ) : (
                    <Tv size={14} />
                  )}
                </span>
                <span className="fw-body">
                  <strong>{e.title}</strong>
                  {p.percent !== null && (
                    <span className="fw-bar">
                      <i style={{ width: p.percent + '%' }} />
                    </span>
                  )}
                  <small>{p.text}</small>
                </span>
              </button>
              <button
                type="button"
                className="fw-quick"
                title={book ? 'Actualizar página' : 'Siguiente episodio'}
                onClick={() => (book ? openProgress(e) : void nextEpisode(e))}
              >
                {book ? <Pencil size={13} /> : '+1'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CaptureCard() {
  const { openCapture, openChat, openWeekly } = useApp();
  return (
    <section className="hc cap">
      <h3>
        <Wand2 size={16} /> ¿Qué pasó?
      </h3>
      <button
        type="button"
        className="cap-launch"
        aria-haspopup="dialog"
        aria-label="Escribir una experiencia"
        onClick={() => openCapture()}
      >
        Cuéntalo en una o dos frases… <ArrowRight size={16} />
      </button>
      <div className="cap-actions">
        <button type="button" className="cap-go" onClick={() => openCapture()}>
          Escribir
        </button>
        <button type="button" className="cap-ask" onClick={openChat}>
          <Sparkles size={14} /> Consultar memoria
        </button>
      </div>
      <button type="button" className="cap-week" onClick={openWeekly}>
        <Newspaper size={14} /> <span>Tu semana en un periódico</span> <ArrowRight size={13} />
      </button>
    </section>
  );
}

const RADAR_MAX = 4;

/** Compromisos abiertos: primero lo que vence antes; sin fecha, al final. */
function RadarCard({ onShowAll }: { onShowAll: () => void }) {
  const { workspace, toggleEntry, viewEntry, openEntry } = useApp();
  const today = todayInputValue();
  const open = useMemo(
    () =>
      workspace.entries
        .filter(isOpenTask)
        .sort(
          (a, b) =>
            (a.details.due ?? '9999').localeCompare(b.details.due ?? '9999') ||
            b.created_at.localeCompare(a.created_at),
        ),
    [workspace.entries],
  );

  return (
    <section className="hc">
      <header className="hc-head">
        <h3>
          <ListChecks size={15} /> En tu radar {open.length > 0 && <i>{open.length}</i>}
        </h3>
        <button type="button" className="hc-link" onClick={() => openEntry('Pendiente')}>
          + Añadir
        </button>
      </header>
      {open.length ? (
        <ul className="hr-list">
          {open.slice(0, RADAR_MAX).map((e) => (
            <RadarRow
              key={e.id}
              entry={e}
              today={today}
              onToggle={() => toggleEntry(e)}
              onOpen={() => viewEntry(e)}
            />
          ))}
        </ul>
      ) : (
        <p className="hc-empty">Nada pendiente. Buen momento para lo que viene.</p>
      )}
      {open.length > RADAR_MAX && (
        <button type="button" className="hc-more" onClick={onShowAll}>
          Ver los {open.length} pendientes
        </button>
      )}
    </section>
  );
}

function RadarRow({
  entry,
  today,
  onToggle,
  onOpen,
}: {
  entry: Entry;
  today: string;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { workspace } = useApp();
  const kind = commitmentOf(entry);
  const who = counterpartOf(entry, workspace.people)?.name.split(' ')[0];
  const due = entry.details.due;
  const late = due ? due < today : false;
  const bits = [
    kind !== 'quiero' ? commitmentKinds[kind].short : null,
    who,
    due ? (late ? 'venció ' : '') + friendlyDate(due, today).toLowerCase() : null,
  ].filter(Boolean);
  return (
    <li className="hr-row">
      <button type="button" className="hr-check" aria-label="Marcar como hecho" onClick={onToggle}>
        <Check size={12} />
      </button>
      <button type="button" className="hr-main" onClick={onOpen}>
        <strong>{entry.title}</strong>
        {bits.length > 0 && (
          <small className={late ? 'late' : due === today ? 'today' : ''}>{bits.join(' · ')}</small>
        )}
      </button>
    </li>
  );
}

const CIRCLE_MAX = 4;

/** Las personas más cercanas (favoritas primero) y cuándo fue la última vez. */
function CircleCard() {
  const { workspace, go, peekPerson } = useApp();
  const people = useMemo(
    () =>
      [...workspace.people]
        .sort(
          (a, b) =>
            Number(Boolean(b.profile.favorite)) - Number(Boolean(a.profile.favorite)) ||
            closenessOf(b) - closenessOf(a) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, CIRCLE_MAX)
        .map((p) => ({ person: p, last: statsFor(p, workspace.entries).last })),
    [workspace.people, workspace.entries],
  );
  if (!people.length) return null;

  return (
    <section className="hc">
      <header className="hc-head">
        <h3>
          <Users size={15} /> Tu círculo
        </h3>
        <button type="button" className="hc-link" onClick={() => go('Personas')}>
          Ver todos <ArrowUpRight size={13} />
        </button>
      </header>
      <ul className="hcirc">
        {people.map(({ person, last }) => (
          <li key={person.id}>
            <button type="button" onClick={() => peekPerson(person)}>
              <Avatar person={person} size={32} />
              <span>
                <strong>{person.name}</strong>
                <small>
                  {relationMeta[relationOf(person)].label} ·{' '}
                  {last ? relativeDay(last).toLowerCase() : 'sin registros'}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cifras de contexto, cada una lleva a su sección. */
function SummaryCard({ onShowTasks }: { onShowTasks: () => void }) {
  const { workspace, go } = useApp();
  const month = todayInputValue().slice(0, 7);
  const open = workspace.entries.filter(isOpenTask);
  const promised = open.filter((e) => commitmentOf(e) === 'prometi').length;
  const active = workspace.episodes.filter((e) => e.status === 'activo').length;
  const spent = workspace.entries
    .filter(
      (e) =>
        e.kind === 'Movimiento' &&
        e.direction === 'egreso' &&
        todayInputValue(new Date(e.created_at)).startsWith(month),
    )
    .reduce((s, e) => s + e.amount, 0);

  return (
    <section className="hc hsum">
      <button type="button" onClick={() => go('Personas')}>
        <b>{workspace.people.length}</b>
        <span>personas</span>
      </button>
      <button type="button" onClick={() => go('Episodios')}>
        <b>{active}</b>
        <span>{active === 1 ? 'episodio activo' : 'episodios activos'}</span>
      </button>
      <button type="button" onClick={onShowTasks}>
        <b>{promised}</b>
        <span>{promised === 1 ? 'promesa abierta' : 'promesas abiertas'}</span>
      </button>
      <button type="button" onClick={() => go('Finanzas')}>
        <b>{money(spent)}</b>
        <span>gastado este mes</span>
      </button>
    </section>
  );
}
