import { useMemo } from 'react';
import { Cake, HeartHandshake, MessageCircle, Sparkles, Target, UserPlus, Users } from 'lucide-react';
import { useApp } from '../../AppContext';
import { friendlyDate, todayInputValue } from '../../lib/format';
import {
  ageOf,
  closenessOf,
  daysBetween,
  daysToBirthday,
  isInteraction,
  isReachable,
  relationMeta,
  relationOf,
  relativeDay,
} from '../../lib/people';
import { Avatar } from '../../people/Avatar';
import { Card } from '../Card';
import { num, str, type BlockProps } from '../types';

const dayOfIso = (iso: string) => todayInputValue(new Date(iso));
const first = (name: string) => name.split(' ')[0];
const inDays = (n: number) => (n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`);

/** La última vez que viste o hablaste con cada persona (una sola pasada por tus recuerdos). */
function useLastContact() {
  const { workspace } = useApp();
  return useMemo(() => {
    const last = new Map<string, string>();
    for (const e of workspace.entries) {
      if (!isInteraction(e)) continue;
      const d = dayOfIso(e.created_at);
      for (const id of e.person_ids) if ((last.get(id) ?? '') < d) last.set(id, d);
    }
    return last;
  }, [workspace.entries]);
}

/** Cumpleaños que vienen: cuántos cumple y cuántas ideas de regalo tienes anotadas. */
export function BirthdaysBlock({ opts, zone }: BlockProps) {
  const { workspace, peekPerson } = useApp();
  const today = todayInputValue();
  const days = num(opts, 'days', 30);
  const rows = useMemo(
    () =>
      workspace.people
        .filter(isReachable)
        .flatMap((p) => {
          const n = daysToBirthday(p, today);
          return n !== null && n <= days ? [{ p, n }] : [];
        })
        .sort((a, b) => a.n - b.n),
    [workspace.people, today, days],
  );
  const shown = rows.slice(0, num(opts, 'count', 5));
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={Cake}
      tone="#c0558a"
      title="Cumpleaños"
      count={rows.length}
      empty={!rows.length}
      emptyText={`Nadie cumple en los próximos ${days} días.`}
    >
      <ul className="hk-people">
        {shown.map(({ p, n }) => {
          const age = ageOf(p, today);
          const turns = age === null ? null : n === 0 ? age : age + 1;
          const gifts = p.profile.gifts?.length ?? 0;
          return (
            <li key={p.id} className={n === 0 ? 'hot' : ''}>
              <button type="button" onClick={() => peekPerson(p)}>
                <Avatar person={p} size={32} />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {n === 0 ? '¡Hoy!' : inDays(n)}
                    {turns !== null && ` · cumple ${turns}`}
                    {gifts > 0 && ` · ${gifts} ${gifts === 1 ? 'idea' : 'ideas'} de regalo`}
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

/** A quién escribirle: metas de contacto vencidas o gente cercana que hace rato no ves. */
export function ReconnectBlock({ opts, zone }: BlockProps) {
  const { workspace, peekPerson } = useApp();
  const today = todayInputValue();
  const last = useLastContact();
  const mode = str(opts, 'mode', 'meta');
  const days = num(opts, 'days', 45);
  const min = Number(str(opts, 'closeness', '4'));
  const rows = useMemo(() => {
    const out = workspace.people
      .filter(isReachable)
      .map((p) => {
        const l = last.get(p.id) ?? null;
        const since = l ? daysBetween(l, today) : null;
        const cadence = p.profile.cadence ?? 0;
        const due =
          mode === 'meta'
            ? cadence > 0 && (since === null || since > cadence)
            : closenessOf(p) >= min && (since === null || since > days);
        return { p, l, since, due };
      })
      .filter((x) => x.due);
    return out.sort((a, b) => (b.since ?? 9999) - (a.since ?? 9999));
  }, [workspace.people, last, today, mode, days, min]);
  const shown = rows.slice(0, num(opts, 'count', 4));
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={HeartHandshake}
      tone="#5f8247"
      title="Para reconectar"
      count={rows.length}
      empty={!rows.length}
      emptyText={
        mode === 'meta'
          ? 'Estás al día con todas tus metas de contacto.'
          : `Has visto a tu gente cercana en los últimos ${days} días.`
      }
    >
      <ul className="hk-people">
        {shown.map(({ p, l }) => {
          const phone = p.profile.phone?.replace(/[^\d+]/g, '').replace(/^\+/, '');
          return (
            <li key={p.id}>
              <button type="button" onClick={() => peekPerson(p)}>
                <Avatar person={p} size={32} />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {relationMeta[relationOf(p)].label} · {l ? relativeDay(l, today).toLowerCase() : 'sin registros'}
                  </small>
                </span>
              </button>
              {phone && (
                <a
                  className="hc-icon"
                  href={`https://wa.me/${phone}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Escribirle a ${first(p.name)}`}
                  aria-label={`Escribirle a ${first(p.name)}`}
                >
                  <MessageCircle size={14} />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Gente que conociste hace poco. */
export function NewPeopleBlock({ opts, zone }: BlockProps) {
  const { workspace, peekPerson, go } = useApp();
  const today = todayInputValue();
  const days = num(opts, 'days', 30);
  const rows = useMemo(
    () =>
      workspace.people
        .map((p) => ({ p, d: p.profile.metOn ?? dayOfIso(p.created_at) }))
        .filter((x) => daysBetween(x.d, today) <= days && x.d <= today)
        .sort((a, b) => b.d.localeCompare(a.d)),
    [workspace.people, today, days],
  );
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={UserPlus}
      tone="#4f6bb5"
      title="Gente nueva"
      count={rows.length}
      link="Personas"
      onLink={() => go('Personas')}
      empty={!rows.length}
      emptyText={`No conociste a nadie nuevo en los últimos ${days} días.`}
    >
      <ul className="hk-people">
        {rows.slice(0, num(opts, 'count', 4)).map(({ p, d }) => (
          <li key={p.id}>
            <button type="button" onClick={() => peekPerson(p)}>
              <Avatar person={p} size={32} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {relativeDay(d, today)}
                  {p.profile.metHow ? ` · ${p.profile.metHow}` : ''}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Tus últimos encuentros, con quién y dónde. */
export function MeetingsBlock({ opts, zone }: BlockProps) {
  const { workspace, viewEntry, openEntry } = useApp();
  const today = todayInputValue();
  const rows = useMemo(
    () =>
      workspace.entries
        .filter((e) => e.kind === 'Encuentro')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, num(opts, 'count', 4)),
    [workspace.entries, opts.count],
  );
  const byId = new Map(workspace.people.map((p) => [p.id, p]));
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={Users}
      tone="#8a6fa8"
      title="Últimos encuentros"
      action={
        <button type="button" className="hc-link" onClick={() => openEntry('Encuentro', [])}>
          + Añadir
        </button>
      }
      empty={!rows.length}
      emptyText="Aún no registras encuentros."
    >
      <ul className="hk-list">
        {rows.map((e) => {
          const who = e.person_ids.flatMap((id) => {
            const p = byId.get(id);
            return p ? [p] : [];
          });
          return (
            <li key={e.id}>
              <button type="button" onClick={() => viewEntry(e)}>
                <span className="hk-faces">
                  {who.slice(0, 3).map((p) => (
                    <Avatar key={p.id} person={p} size={24} />
                  ))}
                </span>
                <span className="hk-text">
                  <strong>{e.title}</strong>
                  <small>
                    {friendlyDate(dayOfIso(e.created_at), today)}
                    {e.details.place && ` · ${e.details.place}`}
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

/** Lo que escribiste en tu ficha sobre en qué estás ahora (metas, proyectos, lo que aprendes). */
export function MyGoalsBlock({ opts, zone }: BlockProps) {
  const { me, openMe } = useApp();
  const goals = me.profile.goals ?? [];
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={Target}
      tone="#3c9186"
      title="En qué estás"
      link="Mi ficha"
      onLink={openMe}
      empty={!goals.length}
      emptyText={
        <>
          Cuéntale a Nexo tus metas y proyectos en{' '}
          <button type="button" className="hk-inline" onClick={openMe}>
            Mi ficha
          </button>
          .
        </>
      }
    >
      <ul className="hk-goals">
        {goals.slice(0, num(opts, 'count', 5)).map((g) => (
          <li key={g}>
            <Sparkles size={12} /> {g}
          </li>
        ))}
      </ul>
    </Card>
  );
}
