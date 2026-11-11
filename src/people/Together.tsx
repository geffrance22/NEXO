import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  Check,
  Clapperboard,
  Columns3,
  Handshake,
  Layers,
  MapPin,
  Plus,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry, Kind, Person } from '../data';
import { incomeColors, kindMeta } from '../composer/kinds';
import { commitmentKinds, commitmentOf, commitmentsWith } from '../lib/commitments';
import { episodeKindOf } from '../lib/episodes';
import { friendlyDate, money, normalizeText, shortDate } from '../lib/format';
import { exchangeKinds, type PersonStats } from '../lib/people';
import { placeKinds, placeOf } from '../lib/places';
import { PhotoThumbs } from '../components/PhotoThumbs';
import { RichText } from '../components/RichText';
import { aimBoard } from '../planner/boardView';
import { usePersonCards } from '../planner/personCards';

const monthNames = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const plural: Partial<Record<Kind, string>> = {
  Nota: 'Notas',
  Encuentro: 'Encuentros',
  Película: 'Películas',
  Libro: 'Libros',
  Trabajo: 'Trabajo',
  Aprendizaje: 'Aprendizajes',
  Movimiento: 'Dinero',
};
/** Orden de los filtros de la línea de tiempo. */
const kindOrder: Kind[] = [
  'Encuentro',
  'Nota',
  'Película',
  'Libro',
  'Trabajo',
  'Aprendizaje',
  'Movimiento',
];

const recommended = (e: Entry) =>
  normalizeText(e.body + ' ' + e.tags.join(' ')).includes('recomend');

/**
 * Recuerdos con todo su contexto: tipo, lugar, calificación, monto, fotos. Sin `limit`, se agrupan
 * por mes.
 */
export function Moments({ entries, limit }: { entries: Entry[]; limit?: number }) {
  const { viewEntry, workspace } = useApp();
  const list = limit ? entries.slice(0, limit) : entries;
  if (!list.length) return <p className="pp-empty">Todavía no hay recuerdos con esta persona.</p>;
  let lastGroup = '';
  return (
    <ol className="pj-moments">
      {list.map((e) => {
        const d = new Date(e.created_at);
        const group = limit ? '' : `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        const header = group !== lastGroup ? group : '';
        lastGroup = group;
        const m = kindMeta[e.kind];
        const income = e.kind === 'Movimiento' && e.direction === 'ingreso';
        const color = income ? incomeColors : m;
        const place = placeOf(e, workspace.places)?.name ?? e.details.place;
        const meta = [
          e.kind === 'Encuentro' && e.details.activity ? e.details.activity : e.kind,
          place,
          e.details.rating ? '★'.repeat(Math.min(5, e.details.rating)) : '',
          e.kind === 'Movimiento' && e.amount ? (income ? '+' : '−') + money(e.amount) : '',
          (e.kind === 'Libro' || e.kind === 'Película') && recommended(e) ? 'Recomendación' : '',
        ].filter(Boolean);
        return (
          <li key={e.id}>
            {header && <span className="pj-month">{header}</span>}
            <button
              type="button"
              className="pj-m"
              style={{ '--c': color.accent, '--s': color.soft } as CSSProperties}
              onClick={() => viewEntry(e)}
            >
              <i className="pj-m-icon">
                <m.icon size={15} />
              </i>
              <span className="pj-m-main">
                <strong>{e.title}</strong>
                <small>{meta.join(' · ')}</small>
                {e.body && (
                  <span className="pj-m-body">
                    <RichText text={e.body.slice(0, 220)} />
                  </span>
                )}
              </span>
              <time dateTime={e.created_at}>{shortDate(e.created_at)}</time>
            </button>
            {e.images.length > 0 && (
              <div className="pj-m-photos">
                <PhotoThumbs images={e.images} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * «Juntos»: todo lo que compartes con una persona. Episodios, lugares, libros y películas, dinero,
 * lo que se dan, lo que tienen pendiente y la línea de tiempo completa con filtros.
 */
export function Together({
  person,
  stats,
  onReciprocity,
}: {
  person: Person;
  stats: PersonStats;
  /** Abre la pestaña «Dar y recibir» (solo en la ficha completa). */
  onReciprocity?: () => void;
}) {
  const { workspace, go, openEntry, viewEntry, toggleEntry } = useApp();
  const [filter, setFilter] = useState<Kind | 'todo'>('todo');
  const id = person.id;

  const data = useMemo(() => {
    const shared = stats.entries.filter((e) => e.kind !== 'Pendiente');
    const inEpisodes = new Set(shared.map((e) => e.episode_id).filter(Boolean));
    const episodes = workspace.episodes
      .filter((ep) => ep.person_ids.includes(id) || inEpisodes.has(ep.id))
      .sort((a, b) => (b.starts_on ?? b.created_at).localeCompare(a.starts_on ?? a.created_at));
    const placeCount = new Map<string, number>();
    for (const e of shared) {
      const p = placeOf(e, workspace.places);
      if (p) placeCount.set(p.id, (placeCount.get(p.id) ?? 0) + 1);
    }
    const places = workspace.places
      .filter((p) => placeCount.has(p.id))
      .map((p) => ({ place: p, n: placeCount.get(p.id)! }))
      .sort((a, b) => b.n - a.n);
    const media = shared.filter((e) => e.kind === 'Libro' || e.kind === 'Película');
    const moves = shared.filter((e) => e.kind === 'Movimiento');
    const spent = moves.filter((e) => e.direction === 'egreso').reduce((s, e) => s + e.amount, 0);
    const earned = moves.filter((e) => e.direction === 'ingreso').reduce((s, e) => s + e.amount, 0);
    const counts = new Map<Kind, number>();
    for (const e of shared) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    const first = stats.interactions[stats.interactions.length - 1];
    return {
      shared,
      episodes,
      places,
      media,
      moves,
      spent,
      earned,
      counts,
      first,
      meetings: counts.get('Encuentro') ?? 0,
    };
  }, [stats, workspace.episodes, workspace.places, id]);

  const onBoards = usePersonCards(id);
  const commitments = commitmentsWith(id, workspace.entries);
  // El pendiente que nació en una tarjeta ya sale en «En tableros»: no se muestra dos veces.
  const openCommitments = [...commitments.mine, ...commitments.theirs]
    .filter((e) => !onBoards.entryIds.has(e.id))
    .sort((a, b) => (a.details.due ?? '9999').localeCompare(b.details.due ?? '9999'));
  const exchanges = [...(person.profile.exchanges ?? [])]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  const timeline = filter === 'todo' ? data.shared : data.shared.filter((e) => e.kind === filter);
  const filters = kindOrder.filter((k) => data.counts.has(k));

  const since = data.first ? new Date(data.first.created_at) : null;
  const empty =
    !data.shared.length &&
    !openCommitments.length &&
    !onBoards.cards.length &&
    !exchanges.length;

  return (
    <div className="pp-tab pj">
      <div className="pj-stats">
        <div>
          <b>{stats.interactions.length}</b>
          <span>Recuerdos</span>
        </div>
        <div>
          <b>{data.meetings}</b>
          <span>Encuentros</span>
        </div>
        <div>
          <b>{data.places.length}</b>
          <span>Lugares</span>
        </div>
        <div>
          <b>
            {since ? `${monthNames[since.getMonth()].slice(0, 3)} ${since.getFullYear()}` : '—'}
          </b>
          <span>Desde</span>
        </div>
      </div>

      <button type="button" className="pp-text-btn" onClick={() => openEntry(undefined, [id])}>
        <Plus size={14} /> Añadir recuerdo
      </button>

      {empty && (
        <p className="pp-empty">Todavía no hay nada compartido con {person.name.split(' ')[0]}.</p>
      )}

      {data.episodes.length > 0 && (
        <>
          <h4>
            <Layers size={15} /> Episodios
          </h4>
          <div className="pj-eps">
            {data.episodes.slice(0, 12).map((ep) => {
              const k = episodeKindOf(ep.kind);
              const when = ep.starts_on ? shortDate(ep.starts_on + 'T12:00:00') : '';
              return (
                <button
                  type="button"
                  key={ep.id}
                  className="pj-ep"
                  style={{ '--c': k.color, '--s': k.soft } as CSSProperties}
                  onClick={() => go('Episodios', ep)}
                >
                  <i>
                    <k.icon size={16} />
                  </i>
                  <span>
                    <strong>{ep.title}</strong>
                    <small>{[k.label, when].filter(Boolean).join(' · ')}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {data.places.length > 0 && (
        <>
          <h4>
            <MapPin size={15} /> Lugares
          </h4>
          <div className="pj-places">
            {data.places.slice(0, 10).map(({ place, n }) => {
              const k = placeKinds[place.kind] ?? placeKinds.otro;
              return (
                <button
                  type="button"
                  key={place.id}
                  style={{ '--c': k.color, '--s': k.soft } as CSSProperties}
                  onClick={() => go('Lugares', place)}
                >
                  <k.icon size={13} />
                  {place.name}
                  {n > 1 && <em>{n}</em>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {data.media.length > 0 && (
        <>
          <h4>
            <Clapperboard size={15} /> Libros y películas
          </h4>
          <div className="pj-media">
            {data.media.slice(0, 8).map((e) => {
              const m = kindMeta[e.kind];
              return (
                <button
                  type="button"
                  key={e.id}
                  style={{ '--c': m.accent, '--s': m.soft } as CSSProperties}
                  onClick={() => viewEntry(e)}
                >
                  <i>
                    <m.icon size={14} />
                  </i>
                  <span>
                    <strong>{e.title}</strong>
                    <small>
                      {[
                        e.details.rating ? '★'.repeat(Math.min(5, e.details.rating)) : '',
                        recommended(e) ? 'Recomendación' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || e.kind}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {data.moves.length > 0 && (
        <>
          <h4>
            <Banknote size={15} /> Dinero
          </h4>
          <div className="pj-money">
            <div>
              <ArrowUpRight size={15} />
              <b>{money(data.spent)}</b>
              <span>Gastos</span>
            </div>
            <div className="in">
              <ArrowDownLeft size={15} />
              <b>{money(data.earned)}</b>
              <span>Ingresos</span>
            </div>
            <div className="n">
              <b>{data.moves.length}</b>
              <span>{data.moves.length === 1 ? 'Movimiento' : 'Movimientos'}</span>
            </div>
          </div>
        </>
      )}

      {openCommitments.length > 0 && (
        <>
          <h4>
            <Handshake size={15} /> Compromisos
          </h4>
          <div className="pj-list">
            {openCommitments.slice(0, 6).map((e) => {
              const k = commitmentKinds[commitmentOf(e)];
              return (
                <div
                  className="pj-row"
                  key={e.id}
                  style={{ '--c': k.color, '--s': k.soft } as CSSProperties}
                >
                  <button
                    type="button"
                    className="pp-check"
                    aria-label="Completar"
                    onClick={() => toggleEntry(e)}
                  >
                    <Check size={13} />
                  </button>
                  <button type="button" className="pj-row-main" onClick={() => viewEntry(e)}>
                    <strong>{e.title}</strong>
                    <small>
                      <k.icon size={11} /> {k.short}
                      {e.details.due && (
                        <>
                          {' · '}
                          <CalendarClock size={11} /> {friendlyDate(e.details.due)}
                        </>
                      )}
                    </small>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {onBoards.cards.length > 0 && (
        <>
          <h4>
            <Columns3 size={15} /> En tableros
          </h4>
          <div className="pj-list">
            {onBoards.cards.slice(0, 6).map((c) => (
              <div className="pj-row" key={c.id}>
                <button
                  type="button"
                  className="pj-row-main"
                  title="Abrir la tarjeta en su tablero"
                  onClick={() => {
                    aimBoard(c.board_id, c.list_id, c.id);
                    go('Tableros');
                  }}
                >
                  <strong>{c.title}</strong>
                  <small>
                    {c.board_name} · {c.list_name}
                    {c.due && (
                      <>
                        {' · '}
                        <CalendarClock size={11} /> {friendlyDate(c.due)}
                      </>
                    )}
                  </small>
                </button>
              </div>
            ))}
            {onBoards.cards.length > 6 && (
              <small className="pj-more">+{onBoards.cards.length - 6} más en tus tableros</small>
            )}
          </div>
        </>
      )}

      {exchanges.length > 0 && (
        <>
          <h4 className="pp-h-row">
            <ArrowUpRight size={15} /> Dar y recibir
            {onReciprocity && (
              <button type="button" className="pp-text-btn" onClick={onReciprocity}>
                Ver todo <ArrowRight size={13} />
              </button>
            )}
          </h4>
          <div className="pj-list">
            {exchanges.map((x) => (
              <div className={'pj-row x ' + x.dir} key={x.id}>
                <i className="pj-x-icon">
                  {x.dir === 'dar' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                </i>
                <span className="pj-row-main">
                  <strong>
                    {x.dir === 'dar' ? 'Diste' : 'Recibiste'} · {exchangeKinds[x.kind]}
                  </strong>
                  {x.note && <small>{x.note}</small>}
                </span>
                <time>{shortDate(x.date + 'T12:00:00')}</time>
              </div>
            ))}
          </div>
        </>
      )}

      {data.shared.length > 0 && (
        <>
          <h4>Línea de tiempo</h4>
          {filters.length > 1 && (
            <div className="pj-filter" role="radiogroup" aria-label="Filtrar por tipo">
              <button
                type="button"
                role="radio"
                aria-checked={filter === 'todo'}
                className={filter === 'todo' ? 'on' : ''}
                onClick={() => setFilter('todo')}
              >
                Todo <em>{data.shared.length}</em>
              </button>
              {filters.map((k) => (
                <button
                  type="button"
                  role="radio"
                  key={k}
                  aria-checked={filter === k}
                  className={filter === k ? 'on' : ''}
                  onClick={() => setFilter(k)}
                >
                  {plural[k] ?? k} <em>{data.counts.get(k)}</em>
                </button>
              ))}
            </div>
          )}
          <Moments entries={timeline} />
        </>
      )}
    </div>
  );
}
