import { useMemo, type CSSProperties } from 'react';
import { BookOpen, Briefcase, Clapperboard, GraduationCap, Target } from 'lucide-react';
import { useApp } from '../../AppContext';
import { kindMeta } from '../../composer/kinds';
import type { Entry } from '../../data';
import { isSeries } from '../../lib/entries';
import { friendlyDate, todayInputValue } from '../../lib/format';
import { entryImages } from '../../lib/moviePosters';
import { booksFinishedIn, useReadingGoals, yearProgress } from '../../library/goals';
import { isActive, progressOf } from '../../library/progress';
import { goLibroteca, goSection, toneOf } from '../../library/shelf';
import { Card, daySeed } from '../Card';
import { num, str, type BlockProps } from '../types';

/** Todo lo que estás leyendo o viendo, con cuánto llevas (no solo lo anclado). */
export function NowBlock({ opts, zone }: BlockProps) {
  const { workspace, openProgress, go } = useApp();
  const today = todayInputValue();
  const what = str(opts, 'what', 'todo');
  const rows = useMemo(
    () =>
      workspace.entries
        .filter(isActive)
        .filter((e) => what === 'todo' || (what === 'libros' ? e.kind === 'Libro' : e.kind === 'Película'))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [workspace.entries, what],
  );
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={BookOpen}
      tone="#a0527f"
      title={what === 'libros' ? 'Leyendo' : what === 'series' ? 'Viendo' : 'Leyendo y viendo'}
      count={rows.length}
      link="Libroteca"
      onLink={() => goLibroteca(go, 'inicio')}
      empty={!rows.length}
      emptyText="Nada en curso. Empieza un libro o una serie desde Libroteca."
    >
      <ul className="fw-list">
        {rows.slice(0, num(opts, 'count', 4)).map((e) => {
          const p = progressOf(e, today);
          const tone = toneOf(e);
          const img = entryImages(e)[0];
          return (
            <li key={e.id} className="fw-row" style={{ '--c': tone.accent, '--s': tone.soft, '--k': tone.ink } as CSSProperties}>
              <button type="button" className="fw-main" onClick={() => openProgress(e)} title="Actualizar progreso">
                <span className="fw-art">{img ? <img src={img.thumb ?? img.medium ?? img.url} alt="" /> : <BookOpen size={14} />}</span>
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
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Lo que quieres ver: las últimas que anotaste o unas al azar cada día. */
export function WatchlistBlock({ opts, zone, inst }: BlockProps) {
  const { workspace, viewEntry, go } = useApp();
  const today = todayInputValue();
  const what = str(opts, 'what', 'todo');
  const mode = str(opts, 'mode', 'recientes');
  const count = num(opts, 'count', 6);
  const pool = useMemo(
    () =>
      workspace.entries
        .filter((e) => e.kind === 'Película' && e.details.watch === 'quiero')
        .filter((e) => what === 'todo' || (what === 'series' ? isSeries(e) : !isSeries(e)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [workspace.entries, what],
  );
  const shown = useMemo(() => {
    if (mode !== 'azar' || pool.length <= count) return pool.slice(0, count);
    const start = daySeed(inst.key, today) % pool.length;
    return Array.from({ length: count }, (_, i) => pool[(start + i * 7) % pool.length]).filter(
      (e, i, a) => a.indexOf(e) === i,
    );
  }, [pool, mode, count, inst.key, today]);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={Clapperboard}
      tone="#c0674a"
      title="Por ver"
      count={pool.length}
      link="Películas"
      onLink={() => goLibroteca(go, 'peliculas')}
      empty={!pool.length}
      emptyText="Anota películas y series con «Quiero verla» y aparecerán aquí."
    >
      <div className="hk-posters" style={{ '--cols': num(opts, 'cols', 3) } as CSSProperties}>
        {shown.map((e) => {
          const img = entryImages(e)[0];
          return (
            <button type="button" key={e.id} title={e.title} onClick={() => viewEntry(e)}>
              {img ? <img src={img.thumb ?? img.medium ?? img.url} alt={e.title} loading="lazy" /> : <span>{e.title}</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** Tu meta de lectura del año: cuántos llevas y si vas al ritmo. */
export function BooksGoalBlock({ opts, zone }: BlockProps) {
  const { workspace, go } = useApp();
  const { goalOf } = useReadingGoals();
  const today = todayInputValue();
  const year = today.slice(0, 4);
  const goal = goalOf(year);
  const done = useMemo(() => booksFinishedIn(workspace.entries, year), [workspace.entries, year]);
  const { day, days } = yearProgress(today);
  const expected = goal ? (goal * day) / days : 0;
  const diff = Math.round(done.length - expected);
  const pct = goal ? Math.min(100, Math.round((done.length / goal) * 100)) : 0;
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={Target}
      tone="#5f8247"
      title={`Lectura ${year}`}
      link="Libros"
      onLink={() => goLibroteca(go, 'libros')}
      empty={!goal && !done.length}
      emptyText="Define tu meta de libros del año en Libroteca › Libros."
    >
      <div className="hk-goal">
        <b>
          {done.length}
          {goal ? <small> de {goal}</small> : null}
        </b>
        <span>{done.length === 1 ? 'libro terminado' : 'libros terminados'}</span>
      </div>
      {goal > 0 && (
        <>
          <span className="hk-bar big">
            <i style={{ width: pct + '%' }} />
            <em style={{ left: Math.min(100, (expected / goal) * 100) + '%' }} title="Donde deberías ir hoy" />
          </span>
          <p className="hk-note">
            {done.length >= goal
              ? '¡Cumpliste tu meta del año!'
              : diff > 0
                ? `Vas ${diff} ${diff === 1 ? 'libro' : 'libros'} por delante del ritmo.`
                : diff < 0
                  ? `Vas ${-diff} ${diff === -1 ? 'libro' : 'libros'} por detrás del ritmo.`
                  : 'Vas justo al ritmo.'}
          </p>
        </>
      )}
      {done[0] && <p className="hk-note muted">El último: {done[0].title}</p>}
    </Card>
  );
}

/** Aprendizajes que ya toca repasar (repaso espaciado). */
export function LearningsBlock({ opts, zone }: BlockProps) {
  const { workspace, viewEntry, go } = useApp();
  const today = todayInputValue();
  const rows = useMemo(
    () =>
      workspace.entries
        .filter((e) => {
          const r = e.details.review;
          return e.kind === 'Aprendizaje' && r && r.step >= 0 && r.due && r.due <= today;
        })
        .sort((a, b) => (a.details.review!.due ?? '').localeCompare(b.details.review!.due ?? '')),
    [workspace.entries, today],
  );
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={GraduationCap}
      tone={kindMeta.Aprendizaje.accent}
      title="Para repasar"
      count={rows.length}
      link="Aprendizajes"
      onLink={() => goSection(go, 'Agenda', 'aprendizajes')}
      empty={!rows.length}
      emptyText="Nada por repasar hoy. Tus aprendizajes vuelven cuando toca."
    >
      <ul className="hk-list">
        {rows.slice(0, num(opts, 'count', 4)).map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => viewEntry(e)}>
              <span className="hk-dot" style={{ background: kindMeta.Aprendizaje.soft, color: kindMeta.Aprendizaje.accent }}>
                <GraduationCap size={13} />
              </span>
              <span className="hk-text">
                <strong>{e.title}</strong>
                <small>{e.details.sourceName || e.details.source || 'Aprendizaje'}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const prio = { alta: 0, media: 1, baja: 2 } as const;

/** Trabajo en curso con su próximo paso y su fecha. */
export function WorkBlock({ opts, zone }: BlockProps) {
  const { workspace, viewEntry, openEntry } = useApp();
  const today = todayInputValue();
  const which = str(opts, 'which', 'curso');
  const rows = useMemo(
    () =>
      workspace.entries
        .filter((e) => e.kind === 'Trabajo' && (which === 'curso' ? (e.details.stage ?? 'curso') === 'curso' : e.details.stage !== 'listo'))
        .sort(
          (a, b) =>
            (a.details.due ?? '9999').localeCompare(b.details.due ?? '9999') ||
            prio[a.details.priority ?? 'media'] - prio[b.details.priority ?? 'media'],
        ),
    [workspace.entries, which],
  );
  const late = (e: Entry) => Boolean(e.details.due && e.details.due < today);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={Briefcase}
      tone={kindMeta.Trabajo.accent}
      title="Trabajo en curso"
      count={rows.length}
      action={
        <button type="button" className="hc-link" onClick={() => openEntry('Trabajo', [])}>
          + Añadir
        </button>
      }
      empty={!rows.length}
      emptyText="Sin proyectos en curso."
    >
      <ul className="hk-list">
        {rows.slice(0, num(opts, 'count', 4)).map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => viewEntry(e)}>
              <span className={'hk-prio ' + (e.details.priority ?? 'media')} />
              <span className="hk-text">
                <strong>{e.title}</strong>
                <small className={late(e) ? 'late' : ''}>
                  {[e.details.nextStep, e.details.due && (late(e) ? 'venció ' : '') + friendlyDate(e.details.due, today).toLowerCase()]
                    .filter(Boolean)
                    .join(' · ') || 'Sin próximo paso'}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
