import { useMemo, useState, type CSSProperties } from 'react';
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  Feather,
  Flame,
  History,
  Hourglass,
  ImageIcon,
  Layers,
  MapPin,
  Shuffle,
  SmilePlus,
} from 'lucide-react';
import { useApp } from '../../AppContext';
import { kindMeta } from '../../composer/kinds';
import { MoodIcon, moodOf } from '../../composer/moods';
import type { Entry, StoredImage } from '../../data';
import { countdown, isSealed, capsuleDay } from '../../diary/capsule';
import { buildDays, streaks, wordsOf } from '../../diary/model';
import { useFinance } from '../../finance/store';
import { itemsOf, occurrences } from '../../finance/model';
import { periodAt, totals } from '../../finance/money';
import { isOpenTask } from '../../lib/commitments';
import { kindLabel } from '../../lib/entries';
import { episodeKindOf } from '../../lib/episodes';
import { addDays, friendlyDate, money, todayInputValue } from '../../lib/format';
import { daysBetween, daysToBirthday, isReachable, relativeDay } from '../../lib/people';
import { placeKinds } from '../../lib/places';
import { booksFinishedIn, finishedOn } from '../../library/goals';
import { Card, daySeed } from '../Card';
import { Mosaic, rowHeight } from '../Mosaic';
import { bool, num, str, type BlockProps } from '../types';

const dayOfIso = (iso: string) => todayInputValue(new Date(iso));
const isMemory = (e: Entry) => e.kind !== 'Movimiento' && e.kind !== 'Pendiente';

/** «Hace un año hoy»: lo que pasó en esta misma fecha en años anteriores. */
export function OnThisDayBlock({ opts, zone }: BlockProps) {
  const { workspace, viewEntry } = useApp();
  const today = todayInputValue();
  const span = num(opts, 'window', 0);
  const rows = useMemo(() => {
    const year = Number(today.slice(0, 4));
    const out: { e: Entry; years: number }[] = [];
    for (const e of workspace.entries) {
      if (!isMemory(e)) continue;
      const d = dayOfIso(e.created_at);
      const y = Number(d.slice(0, 4));
      if (y >= year) continue;
      const same = `${year}-${d.slice(5)}`;
      if (Math.abs(daysBetween(same, today)) <= span) out.push({ e, years: year - y });
    }
    return out.sort((a, b) => a.years - b.years || b.e.created_at.localeCompare(a.e.created_at));
  }, [workspace.entries, today, span]);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={History}
      tone="#b07f4f"
      title="En este día"
      count={rows.length}
      empty={!rows.length}
      emptyText="Nada en esta fecha de años anteriores. Lo que escribas hoy aparecerá aquí el próximo año."
    >
      <ul className="hk-list">
        {rows.slice(0, num(opts, 'count', 4)).map(({ e, years }) => {
          const img = e.images[0];
          return (
            <li key={e.id}>
              <button type="button" onClick={() => viewEntry(e)}>
                {img ? (
                  <span className="hk-thumb">
                    <img src={img.thumb ?? img.medium ?? img.url} alt="" loading="lazy" />
                  </span>
                ) : (
                  <span className="hk-dot" style={{ background: kindMeta[e.kind].soft, color: kindMeta[e.kind].accent }}>
                    {years}
                  </span>
                )}
                <span className="hk-text">
                  {e.title && <strong>{e.title}</strong>}
                  <small>
                    Hace {years} {years === 1 ? 'año' : 'años'} · {kindLabel(e)}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Cómo te has sentido: un punto por día con el ánimo que marcaste. */
export function MoodBlock({ opts, zone }: BlockProps) {
  const { workspace, openEntry } = useApp();
  const today = todayInputValue();
  const days = num(opts, 'days', 14);
  const { cells, top, marked } = useMemo(() => {
    const since = addDays(today, -(days - 1));
    const byDay = new Map<string, number>();
    const count = new Map<number, number>();
    for (const e of workspace.entries) {
      const m = moodOf(e.details.mood);
      if (!m) continue;
      const d = dayOfIso(e.created_at);
      if (d < since || d > today) continue;
      if (!byDay.has(d)) byDay.set(d, m.value);
      count.set(m.value, (count.get(m.value) ?? 0) + 1);
    }
    const cells = Array.from({ length: days }, (_, i) => {
      const d = addDays(since, i);
      return { d, mood: moodOf(byDay.get(d)) };
    });
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    return { cells, top: best ? moodOf(best[0]) : undefined, marked: byDay.size };
  }, [workspace.entries, today, days]);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={SmilePlus}
      tone="#e09b0b"
      title="Tu ánimo"
      action={
        <button type="button" className="hc-link" onClick={() => openEntry('Nota')}>
          Escribir
        </button>
      }
      empty={!marked}
      emptyText={`No marcaste tu ánimo en los últimos ${days} días.`}
    >
      <div className="hk-moods" style={{ '--n': Math.min(days, 14) } as CSSProperties}>
        {cells.map(({ d, mood }) => (
          <span
            key={d}
            className={'hk-mood' + (d === today ? ' today' : '')}
            style={mood ? ({ '--m': mood.color } as CSSProperties) : undefined}
            title={`${friendlyDate(d, today)}${mood ? ': ' + mood.label : ''}`}
          />
        ))}
      </div>
      {top && (
        <p className="hk-mood-top">
          <MoodIcon mood={top} size={22} solid /> Lo que más sentiste: <b>{top.label}</b> · {marked}{' '}
          {marked === 1 ? 'día' : 'días'} con ánimo
        </p>
      )}
    </Card>
  );
}

/** Tu racha en el diario: días seguidos escribiendo y lo que llevas esta semana. */
export function StreakBlock({ opts, zone }: BlockProps) {
  const { workspace, openEntry } = useApp();
  const today = todayInputValue();
  const s = useMemo(() => {
    const notes = workspace.entries.filter((e) => e.kind === 'Nota' && !e.details.archived);
    const days = buildDays(notes);
    const st = streaks(days, today);
    const weekAgo = addDays(today, -6);
    const words = notes.filter((e) => dayOfIso(e.created_at) >= weekAgo).reduce((a, e) => a + wordsOf(e), 0);
    const last = notes.reduce((m, e) => (dayOfIso(e.created_at) > m ? dayOfIso(e.created_at) : m), '');
    const week = Array.from({ length: 7 }, (_, i) => addDays(weekAgo, i)).map((d) => ({ d, on: days.has(d) }));
    return { ...st, words, last, week, total: notes.length };
  }, [workspace.entries, today]);
  const goal = num(opts, 'goal', 7);
  return (
    <Card zone={zone} opts={opts} icon={Flame} tone="#e07a36" title="Tu diario">
      <div className="hk-streak">
        <div>
          <b>{s.current}</b>
          <span>{s.current === 1 ? 'día seguido' : 'días seguidos'}</span>
        </div>
        <div>
          <b>{s.best}</b>
          <span>mejor racha</span>
        </div>
        <div>
          <b>{s.words.toLocaleString('es-CO')}</b>
          <span>palabras esta semana</span>
        </div>
      </div>
      <div className="hk-week">
        {s.week.map((w) => (
          <i key={w.d} className={(w.on ? 'on' : '') + (w.d === today ? ' today' : '')} title={friendlyDate(w.d, today)} />
        ))}
      </div>
      <p className="hk-note">
        {s.alive
          ? s.current >= goal
            ? `¡Cumpliste tu meta de ${goal} días!`
            : `Hoy ya escribiste. Te faltan ${goal - s.current} para tu meta de ${goal}.`
          : s.current
            ? `Escribe hoy para no perder tu racha de ${s.current} ${s.current === 1 ? 'día' : 'días'}.`
            : s.last
              ? `Lo último que escribiste fue ${relativeDay(s.last, today).toLowerCase()}.`
              : 'Empieza hoy tu diario.'}
      </p>
      {!s.alive && (
        <button type="button" className="hk-cta" onClick={() => openEntry('Nota')}>
          <Feather size={14} /> Escribir hoy
        </button>
      )}
    </Card>
  );
}

/**
 * Fotos de tus recuerdos, distintas cada día (o al tocar «Otras»), en un mosaico donde cada una
 * conserva su forma.
 */
export function PhotoBlock({ opts, zone, inst }: BlockProps) {
  const { workspace, viewEntry, go } = useApp();
  const today = todayInputValue();
  const source = str(opts, 'source', 'todo');
  const count = num(opts, 'count', 1);
  const [shift, setShift] = useState(0);
  const pool = useMemo(() => {
    const out: { img: StoredImage; e: Entry | null; label: string; placeId?: string }[] = [];
    if (source === 'lugares') {
      for (const p of workspace.places) for (const img of p.images) out.push({ img, e: null, label: p.name, placeId: p.id });
      return out;
    }
    for (const e of workspace.entries) {
      if (!e.images.length || e.kind === 'Movimiento' || e.kind === 'Película' || e.kind === 'Libro') continue;
      if (source === 'encuentros' && e.kind !== 'Encuentro') continue;
      if (source === 'diario' && e.kind !== 'Nota') continue;
      for (const img of e.images) out.push({ img, e, label: e.title });
    }
    return out;
  }, [workspace.entries, workspace.places, source]);
  // Una mezcla distinta cada día (y con cada «Otras»), sin repetir fotos.
  const picks = useMemo(() => {
    if (!pool.length) return [];
    const salt = `${inst.key}|${shift}`;
    return pool
      .map((p, i) => ({ p, h: daySeed(salt + p.img.url + i, today) }))
      .sort((a, b) => a.h - b.h)
      .slice(0, count)
      .map((x) => x.p);
  }, [pool, inst.key, shift, today, count]);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={ImageIcon}
      tone="#4f8f5a"
      title={count === 1 ? 'Un recuerdo' : 'Recuerdos en fotos'}
      action={
        pool.length > count ? (
          <button
            type="button"
            className="hc-icon"
            title={count === 1 ? 'Otra' : 'Otras'}
            aria-label={count === 1 ? 'Otra foto' : 'Otras fotos'}
            onClick={() => setShift((n) => n + 1)}
          >
            <Shuffle size={14} />
          </button>
        ) : undefined
      }
      empty={!picks.length}
      emptyText="Las fotos de tus recuerdos aparecerán aquí."
    >
      <Mosaic
        row={rowHeight(opts.size, zone)}
        items={picks.map((pick, i) => ({
          key: pick.img.url + i,
          src: pick.img.medium ?? pick.img.url,
          title: pick.label,
          sub: pick.e ? relativeDay(dayOfIso(pick.e.created_at), today) : undefined,
          onOpen: () => (pick.e ? viewEntry(pick.e) : go('Lugares', { id: pick.placeId! })),
        }))}
      />
    </Card>
  );
}

/** Cápsulas del tiempo selladas y cuándo se abre la próxima (sin revelar nada de lo que dicen). */
export function CapsulesBlock({ opts, zone }: BlockProps) {
  const { capsules, openEntry } = useApp();
  const today = todayInputValue();
  const sealed = capsules
    .filter((e) => isSealed(e, today))
    .sort((a, b) => a.details.capsule!.opensOn.localeCompare(b.details.capsule!.opensOn));
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={Hourglass}
      tone="#a0613a"
      title="Cápsulas del tiempo"
      count={sealed.length}
      empty={!sealed.length}
      emptyText={
        <>
          Escribe en tu diario y elige «Cápsula del tiempo» al guardar: se sella hasta la fecha que elijas.{' '}
          <button type="button" className="hk-inline" onClick={() => openEntry('Nota')}>
            Escribir una
          </button>
        </>
      }
    >
      <ul className="hk-list">
        {sealed.slice(0, num(opts, 'count', 3)).map((e) => (
          <li key={e.id}>
            <span className="hk-row-static">
              <span className="hk-dot" style={{ background: '#f8ebe1', color: '#a0613a' }}>
                <Hourglass size={13} />
              </span>
              <span className="hk-text">
                <strong>Se abre {countdown(e.details.capsule!.opensOn, today)}</strong>
                <small>
                  {capsuleDay(e.details.capsule!.opensOn)} · escrita {relativeDay(dayOfIso(e.created_at), today).toLowerCase()}
                </small>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** El mes en un calendario: cuánto registraste cada día. */
export function ActivityBlock({ opts, zone }: BlockProps) {
  const { workspace } = useApp();
  const today = todayInputValue();
  const what = str(opts, 'what', 'todo');
  const month = today.slice(0, 7);
  const { counts, max, total } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of workspace.entries) {
      if (what === 'todo' ? !isMemory(e) : what === 'diario' ? e.kind !== 'Nota' : e.kind !== 'Encuentro') continue;
      const d = dayOfIso(e.created_at);
      if (!d.startsWith(month)) continue;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const values = [...counts.values()];
    return { counts, max: Math.max(1, ...values), total: values.reduce((a, b) => a + b, 0) };
  }, [workspace.entries, month, what]);
  const [y, m] = month.split('-').map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const daysIn = new Date(y, m, 0).getDate();
  const label = new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long' });
  return (
    <Card zone={zone} opts={opts} icon={CalendarDays} tone="#5b66d6" title={`Tu ${label}`} count={total}>
      <div className="hk-cal">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
          <b key={i}>{d}</b>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={'x' + i} />
        ))}
        {Array.from({ length: daysIn }, (_, i) => {
          const d = `${month}-${String(i + 1).padStart(2, '0')}`;
          const n = counts.get(d) ?? 0;
          return (
            <span
              key={d}
              className={'hk-cal-day' + (d === today ? ' today' : '') + (d > today ? ' future' : '')}
              style={n ? ({ '--lv': 0.25 + (n / max) * 0.75 } as CSSProperties) : undefined}
              title={`${friendlyDate(d, today)}: ${n} ${n === 1 ? 'recuerdo' : 'recuerdos'}`}
            >
              {i + 1}
            </span>
          );
        })}
      </div>
    </Card>
  );
}

/** Tu semana, mes o año en cifras. */
export function StatsBlock({ opts, zone }: BlockProps) {
  const { workspace } = useApp();
  const kind = str(opts, 'period', 'año') as 'semana' | 'mes' | 'año';
  const p = periodAt(kind);
  const s = useMemo(() => {
    const inP = (iso: string) => {
      const d = dayOfIso(iso);
      return d >= p.from && d <= p.to;
    };
    const list = workspace.entries.filter((e) => inP(e.created_at));
    const places = new Set(list.flatMap((e) => (e.details.placeId ? [e.details.placeId] : [])));
    const books = booksFinishedIn(workspace.entries, p.from.slice(0, 4)).filter((e) => {
      const d = finishedOn(e);
      return d >= p.from && d <= p.to;
    }).length;
    return {
      memories: list.filter(isMemory).length,
      meetings: list.filter((e) => e.kind === 'Encuentro').length,
      people: workspace.people.filter((x) => inP(x.created_at)).length,
      places: places.size,
      books,
      movies: list.filter((e) => e.kind === 'Película' && e.details.watch === 'vista').length,
      learned: list.filter((e) => e.kind === 'Aprendizaje').length,
      spent: totals(list.filter((e) => e.kind === 'Movimiento')).spent,
    };
  }, [workspace.entries, workspace.people, p.from, p.to]);
  const cells: [string, string][] = [
    [s.memories.toLocaleString('es-CO'), 'recuerdos'],
    [String(s.meetings), 'encuentros'],
    [String(s.people), 'personas nuevas'],
    [String(s.places), 'lugares'],
    [String(s.books), 'libros terminados'],
    [String(s.movies), 'películas y series'],
    [String(s.learned), 'aprendizajes'],
    ...(bool(opts, 'money', true) ? ([[money(s.spent), 'gastado']] as [string, string][]) : []),
  ];
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={BarChart3}
      tone="#6b62b5"
      title={kind === 'semana' ? 'Tu semana' : kind === 'mes' ? 'Tu mes' : `Tu ${p.from.slice(0, 4)}`}
    >
      <div className="hk-stats">
        {cells.map(([v, l]) => (
          <div key={l}>
            <b>{v}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

type Ahead = { key: string; d: string; title: string; what: string; color: string; open?: () => void };

/** Lo que viene en los próximos días: fechas límite, cumpleaños, episodios y pagos. */
export function AheadBlock({ opts, zone }: BlockProps) {
  const { workspace, viewEntry, peekPerson, go } = useApp();
  const fin = useFinance();
  const today = todayInputValue();
  const days = num(opts, 'days', 7);
  const withMoney = bool(opts, 'money', true);
  const horizon = addDays(today, days);
  const rows = useMemo(() => {
    const out: Ahead[] = [];
    for (const e of workspace.entries) {
      const due = e.details.due;
      if (e.kind === 'Pendiente' && isOpenTask(e) && due && due <= horizon)
        out.push({ key: e.id, d: due, title: e.title, what: 'Pendiente', color: kindMeta.Pendiente.accent, open: () => viewEntry(e) });
      else if (e.kind === 'Trabajo' && e.details.stage !== 'listo' && due && due >= today && due <= horizon)
        out.push({ key: e.id, d: due, title: e.title, what: 'Trabajo', color: kindMeta.Trabajo.accent, open: () => viewEntry(e) });
      else if (withMoney && e.kind === 'Movimiento' && e.details.pending) {
        const d = dayOfIso(e.created_at);
        if (d <= horizon)
          out.push({
            key: e.id,
            d,
            title: `${e.title} · ${money(e.amount)}`,
            what: e.direction === 'ingreso' ? 'Por cobrar' : 'Por pagar',
            color: '#c0674a',
            open: () => viewEntry(e),
          });
      }
    }
    for (const p of workspace.people) {
      if (!isReachable(p)) continue;
      const n = daysToBirthday(p, today);
      if (n !== null && n <= days)
        out.push({ key: 'b' + p.id, d: addDays(today, n), title: p.name, what: 'Cumpleaños', color: '#c0558a', open: () => peekPerson(p) });
    }
    for (const ep of workspace.episodes)
      if (ep.starts_on && ep.starts_on >= today && ep.starts_on <= horizon)
        out.push({ key: 'e' + ep.id, d: ep.starts_on, title: ep.title, what: 'Empieza', color: episodeKindOf(ep.kind).color, open: () => go('Episodios', ep) });
    if (withMoney)
      for (const r of itemsOf(fin.items, 'recurrente')) {
        if (r.archived || r.data.paused) continue;
        for (const o of occurrences(r.data, today, horizon))
          out.push({ key: r.id + o.period, d: o.d, title: `${r.title} · ${money(r.data.amount)}`, what: 'Fijo', color: '#3f6b4f', open: () => go('Finanzas') });
      }
    return out.sort((a, b) => a.d.localeCompare(b.d));
  }, [workspace, fin.items, today, horizon, days, withMoney, viewEntry, peekPerson, go]);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={CalendarRange}
      tone="#4f6bb5"
      title="Lo que viene"
      count={rows.length}
      empty={!rows.length}
      emptyText={`Nada con fecha en los próximos ${days} días.`}
    >
      <ul className="hk-ahead">
        {rows.slice(0, num(opts, 'count', 6)).map((r) => (
          <li key={r.key} className={r.d < today ? 'late' : ''}>
            <button type="button" onClick={r.open}>
              <span className="hk-when">{r.d < today ? 'Vencido' : friendlyDate(r.d, today)}</span>
              <span className="hk-text">
                <strong>{r.title}</strong>
                <small style={{ color: r.color }}>{r.what}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Tus lugares: los que más visitas, los últimos o tus favoritos. */
export function PlacesBlock({ opts, zone }: BlockProps) {
  const { workspace, go } = useApp();
  const today = todayInputValue();
  const mode = str(opts, 'mode', 'frecuentes');
  const rows = useMemo(() => {
    const stats = new Map<string, { n: number; last: string }>();
    for (const e of workspace.entries) {
      const id = e.details.placeId;
      if (!id || e.kind === 'Movimiento') continue;
      const d = dayOfIso(e.created_at);
      const s = stats.get(id) ?? { n: 0, last: '' };
      s.n++;
      if (d > s.last) s.last = d;
      stats.set(id, s);
    }
    const all = workspace.places.map((p) => ({ p, s: stats.get(p.id) ?? { n: 0, last: '' } }));
    const pool = mode === 'favoritos' ? all.filter((x) => x.p.favorite) : all.filter((x) => x.s.n > 0);
    return pool.sort((a, b) =>
      mode === 'recientes' ? b.s.last.localeCompare(a.s.last) : b.s.n - a.s.n || b.s.last.localeCompare(a.s.last),
    );
  }, [workspace.entries, workspace.places, mode]);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={MapPin}
      tone="#c0674a"
      title={mode === 'favoritos' ? 'Lugares favoritos' : mode === 'recientes' ? 'Dónde estuviste' : 'Tus lugares'}
      link="Lugares"
      onLink={() => go('Lugares')}
      empty={!rows.length}
      emptyText="Elige un lugar al guardar un encuentro y aparecerá aquí."
    >
      <ul className="hk-list">
        {rows.slice(0, num(opts, 'count', 4)).map(({ p, s }) => {
          const k = placeKinds[p.kind] ?? placeKinds.otro;
          const cover = p.images[0];
          return (
            <li key={p.id}>
              <button type="button" onClick={() => go('Lugares', p)}>
                {cover ? (
                  <span className="hk-thumb">
                    <img src={cover.thumb ?? cover.url} alt="" loading="lazy" />
                  </span>
                ) : (
                  <span className="hk-dot" style={{ background: k.soft, color: k.color }}>
                    <k.icon size={14} />
                  </span>
                )}
                <span className="hk-text">
                  <strong>{p.name}</strong>
                  <small>
                    {s.n ? `${s.n} ${s.n === 1 ? 'visita' : 'visitas'} · ${relativeDay(s.last, today).toLowerCase()}` : k.label}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Episodios en curso, con lo que llevan gastado frente a su presupuesto. */
export function EpisodesBlock({ opts, zone }: BlockProps) {
  const { workspace, go, openEpisode } = useApp();
  const status = str(opts, 'status', 'activo');
  const rows = useMemo(() => {
    const spent = new Map<string, Entry[]>();
    for (const e of workspace.entries)
      if (e.episode_id && e.kind === 'Movimiento') spent.set(e.episode_id, [...(spent.get(e.episode_id) ?? []), e]);
    return workspace.episodes
      .filter((ep) => status === 'todos' || ep.status === 'activo')
      .sort((a, b) => (b.starts_on ?? b.created_at).localeCompare(a.starts_on ?? a.created_at))
      .map((ep) => ({ ep, spent: totals(spent.get(ep.id) ?? []).spent }));
  }, [workspace.entries, workspace.episodes, status]);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={Layers}
      tone="#3c9186"
      title={status === 'activo' ? 'Episodios activos' : 'Episodios'}
      count={rows.length}
      action={
        <button type="button" className="hc-link" onClick={() => openEpisode()}>
          + Nuevo
        </button>
      }
      empty={!rows.length}
      emptyText="Un viaje, un proyecto o una mudanza: crea un episodio para reunir todo lo que pase."
    >
      <ul className="hk-list">
        {rows.slice(0, num(opts, 'count', 4)).map(({ ep, spent }) => {
          const k = episodeKindOf(ep.kind);
          const pct = ep.budget ? Math.min(100, Math.round((spent / ep.budget) * 100)) : null;
          return (
            <li key={ep.id}>
              <button type="button" onClick={() => go('Episodios', ep)}>
                <span className="hk-dot" style={{ background: k.soft, color: k.color }}>
                  <k.icon size={14} />
                </span>
                <span className="hk-text">
                  <strong>{ep.title}</strong>
                  <small>
                    {k.label}
                    {spent > 0 && ` · ${money(spent)}${ep.budget ? ` de ${money(ep.budget)}` : ''}`}
                  </small>
                  {pct !== null && (
                    <span className={'hk-bar' + (pct >= 100 ? ' bad' : pct >= 80 ? ' warn' : '')}>
                      <i style={{ width: pct + '%' }} />
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

