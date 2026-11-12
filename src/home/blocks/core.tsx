import { useId, useMemo, type CSSProperties } from 'react';
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
import { useApp } from '../../AppContext';
import { Masonry } from '../../components/Masonry';
import { kindMeta } from '../../composer/kinds';
import type { Entry, Kind } from '../../data';
import { totals } from '../../finance/money';
import { commitmentKinds, commitmentOf, counterpartOf, isOpenTask } from '../../lib/commitments';
import { friendlyDate, money, todayInputValue } from '../../lib/format';
import { entryImages } from '../../lib/moviePosters';
import {
  closenessOf,
  isInteraction,
  isReachable,
  relationMeta,
  relationOf,
  relativeDay,
} from '../../lib/people';
import { isActive, progressOf, withEpisode } from '../../library/progress';
import { addedAt, goLibroteca, goSection, toneOf } from '../../library/shelf';
import { Avatar } from '../../people/Avatar';
import { RecentNotebooks } from '../../cuadernos/RecentNotebooks';
import { useCuadernos } from '../../cuadernos/useCuadernos';
import { bool, list, num, str, titleOf, type BlockProps } from '../types';

/** Los últimos recuerdos que añadiste (de cualquier tipo, o solo de los que elijas). */
export function RecentBlock({ opts }: BlockProps) {
  const { workspace, openEntry, go } = useApp();
  const headId = useId();
  const max = num(opts, 'count', 12);
  const only = list(opts, 'kinds') as Kind[];
  // Los cuadernos de Agenda entran cuando se ven todos los tipos (las notas libres tienen su bloque).
  const withNotebooks = !only.length;
  const notebooks = useCuadernos();
  const hasNotebooks = withNotebooks && !notebooks.missing && Boolean(notebooks.list?.length);
  const pool = useMemo(
    () => (only.length ? workspace.entries.filter((e) => only.includes(e.kind)) : workspace.entries),
    [workspace.entries, only.join()],
  );
  const recent = useMemo(
    () => [...pool].sort((a, b) => addedAt(b).localeCompare(addedAt(a))).slice(0, max),
    [pool, max],
  );

  return (
    <section className="nb" aria-labelledby={headId}>
      <header className="nb-head">
        <h2 id={headId}>
          {titleOf(opts, only.length === 1 ? kindMeta[only[0]].label : 'Recientes')}
        </h2>
        <div className="nb-head-end">
          {pool.length > recent.length && (
            <button type="button" className="nb-link" onClick={() => goLibroteca(go, 'inicio')}>
              Ver todo en Libroteca <ArrowUpRight size={13} />
            </button>
          )}
          <button type="button" className="nb-new" onClick={() => openEntry(only.length === 1 ? only[0] : undefined)}>
            <Plus size={15} /> Nuevo
          </button>
        </div>
      </header>
      {hasNotebooks && <RecentNotebooks />}
      {recent.length > 0 ? (
        <Masonry entries={recent} />
      ) : hasNotebooks ? null : (
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
export function FollowBlock({ opts }: BlockProps) {
  const { workspace, go, openProgress, patchEntry, notify } = useApp();
  const today = todayInputValue();
  const all = workspace.entries.filter((e) => e.details.follow && isActive(e));
  const items = all.slice(0, num(opts, 'count', 10));
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
          <Pin size={15} /> {titleOf(opts, 'Siguiendo')} <i>{all.length}</i>
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
              <button type="button" className="fw-main" title="Actualizar progreso" onClick={() => openProgress(e)}>
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

export function CaptureBlock({ opts }: BlockProps) {
  const { openCapture, openChat, openWeekly } = useApp();
  return (
    <section className="hc hcap">
      <h3>
        <Wand2 size={16} /> {titleOf(opts, '¿Qué pasó?')}
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
        {bool(opts, 'ask', true) && (
          <button type="button" className="cap-ask" onClick={openChat}>
            <Sparkles size={14} /> Consultar memoria
          </button>
        )}
      </div>
      {bool(opts, 'weekly', true) && (
        <button type="button" className="cap-week" onClick={openWeekly}>
          <Newspaper size={14} /> <span>Tu semana en un periódico</span> <ArrowRight size={13} />
        </button>
      )}
    </section>
  );
}

/** Compromisos abiertos: primero lo que vence antes; sin fecha, al final. */
export function RadarBlock({ opts }: BlockProps) {
  const { workspace, toggleEntry, viewEntry, openEntry, go } = useApp();
  const today = todayInputValue();
  const max = num(opts, 'count', 4);
  const filter = str(opts, 'filter', 'todos');
  const open = useMemo(
    () =>
      workspace.entries
        .filter(isOpenTask)
        .filter((e) => {
          const due = e.details.due;
          switch (filter) {
            case 'prometi':
              return commitmentOf(e) === 'prometi';
            case 'espero':
              return commitmentOf(e) === 'espero' || commitmentOf(e) === 'depende';
            case 'confecha':
              return Boolean(due);
            case 'urgente':
              return Boolean(due && due <= today);
            default:
              return true;
          }
        })
        .sort(
          (a, b) =>
            (a.details.due ?? '9999').localeCompare(b.details.due ?? '9999') ||
            b.created_at.localeCompare(a.created_at),
        ),
    [workspace.entries, filter, today],
  );

  return (
    <section className="hc">
      <header className="hc-head">
        <h3>
          <ListChecks size={15} /> {titleOf(opts, 'En tu radar')} {open.length > 0 && <i>{open.length}</i>}
        </h3>
        <button type="button" className="hc-link" onClick={() => openEntry('Pendiente')}>
          + Añadir
        </button>
      </header>
      {open.length ? (
        <ul className="hr-list">
          {open.slice(0, max).map((e) => (
            <RadarRow key={e.id} entry={e} today={today} onToggle={() => toggleEntry(e)} onOpen={() => viewEntry(e)} />
          ))}
        </ul>
      ) : (
        <p className="hc-empty">Nada pendiente. Buen momento para lo que viene.</p>
      )}
      {open.length > max && (
        <button type="button" className="hc-more" onClick={() => goSection(go, 'Agenda', 'pendientes')}>
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

/** Las personas más cercanas (favoritas primero) y cuándo fue la última vez. */
export function CircleBlock({ opts }: BlockProps) {
  const { workspace, go, peekPerson } = useApp();
  const max = num(opts, 'count', 4);
  const order = str(opts, 'order', 'cercanos');
  const people = useMemo(() => {
    // La última vez con cada persona, en una sola pasada.
    const last = new Map<string, string>();
    for (const e of workspace.entries) {
      if (!isInteraction(e)) continue;
      const d = todayInputValue(new Date(e.created_at));
      for (const id of e.person_ids) if ((last.get(id) ?? '') < d) last.set(id, d);
    }
    const byClose = (a: (typeof workspace.people)[number], b: (typeof workspace.people)[number]) =>
      Number(Boolean(b.profile.favorite)) - Number(Boolean(a.profile.favorite)) ||
      closenessOf(b) - closenessOf(a) ||
      a.name.localeCompare(b.name);
    const pool = workspace.people.filter(isReachable);
    const sorted =
      order === 'recientes'
        ? pool.filter((p) => last.has(p.id)).sort((a, b) => last.get(b.id)!.localeCompare(last.get(a.id)!))
        : order === 'olvidados'
          ? pool
              .filter((p) => closenessOf(p) >= 4)
              .sort((a, b) => (last.get(a.id) ?? '').localeCompare(last.get(b.id) ?? ''))
          : pool.sort(byClose);
    return sorted.slice(0, max).map((p) => ({ person: p, last: last.get(p.id) ?? null }));
  }, [workspace.people, workspace.entries, max, order]);
  if (!people.length) return null;

  return (
    <section className="hc">
      <header className="hc-head">
        <h3>
          <Users size={15} />{' '}
          {titleOf(
            opts,
            order === 'olvidados' ? 'Hace rato no ves' : order === 'recientes' ? 'Viste hace poco' : 'Tu círculo',
          )}
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
                  {relationMeta[relationOf(person)].label} · {last ? relativeDay(last).toLowerCase() : 'sin registros'}
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
export function SummaryBlock() {
  const { workspace, go } = useApp();
  const month = todayInputValue().slice(0, 7);
  const open = workspace.entries.filter(isOpenTask);
  const promised = open.filter((e) => commitmentOf(e) === 'prometi').length;
  const active = workspace.episodes.filter((e) => e.status === 'activo').length;
  const spent = totals(
    workspace.entries.filter(
      (e) => e.kind === 'Movimiento' && todayInputValue(new Date(e.created_at)).startsWith(month),
    ),
  ).spent;

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
      <button type="button" onClick={() => goSection(go, 'Agenda', 'pendientes')}>
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
