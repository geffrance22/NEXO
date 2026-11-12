import { kindMeta } from '../composer/kinds';
import { moodOf, type Mood } from '../composer/moods';
import type { Entry, Episode, Person, StoredImage, Workspace } from '../data';
import { isActive, progressOf } from '../library/progress';
import { commitmentKindList, commitmentOf, isOpenTask } from '../lib/commitments';
import { episodeKindOf } from '../lib/episodes';
import { addDays, todayInputValue } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { daysBetween } from '../lib/people';

/**
 * Lo que la escena ambiental sabe de ti, leído de lo que ya hay en Nexo. Se separa a propósito el
 * ánimo que marcaste (lo único que habla de cómo te sientes) de las señales de actividad (cuánto
 * registras, qué sigue abierto), que solo describen movimiento y nunca se leen como emoción.
 */

export type DayPart = 'madrugada' | 'mañana' | 'tarde' | 'noche';
export const partOf = (hour: number): DayPart =>
  hour < 6 ? 'madrugada' : hour < 12 ? 'mañana' : hour < 19 ? 'tarde' : 'noche';

/** Un ánimo que marcaste tú, con la entrada donde lo hiciste. */
export type MoodMark = { mood: Mood; day: string; entry: Entry; ago: number };
/** Un día reciente: su ánimo marcado (si lo hubo) y cuántas cosas registraste. */
export type Day = { day: string; mark: MoodMark | null; count: number };

/**
 * Ritmo: registros de los últimos 7 días frente a tu semana habitual (las 4 anteriores).
 * `level` va de 0 (quieto) a 1 (muy activo); 0,5 es tu semana de siempre.
 */
export type Rhythm = {
  week: number;
  base: number;
  level: number;
  activeDays: number;
  trend: 'menos' | 'parejo' | 'más' | null;
};

/** Asuntos abiertos que comparten naturaleza (tipo de compromiso o episodios en curso). */
export type OpenGroup = {
  key: string;
  label: string;
  color: string;
  items: { id: string; title: string; entry?: Entry; episode?: Episode }[];
};

/**
 * Algo que orbita en tu universo: un episodio activo, una persona presente en tus recuerdos, un
 * libro que estás leyendo o una serie que estás viendo.
 */
export type Body = {
  id: string;
  type: 'episode' | 'person' | 'book' | 'series';
  ref: string;
  title: string;
  color: string;
  /** Cuánto pesa: recuerdos y novedades vinculados. */
  weight: number;
  /** Días desde su último movimiento. */
  ago: number;
  /** Movimiento en las últimas dos semanas. */
  recent: number;
  /** Personas del episodio que no orbitan por su cuenta. */
  moons: string[];
  /** Personas en total (para contarlo). */
  people: number;
  /** Otros cuerpos con los que comparte personas. */
  ties: string[];
  /** Su foto en miniatura: la de la persona o la portada del episodio (si la hay). */
  image?: string;
  /** Una o dos iniciales, para cuando no hay foto. */
  mark: string;
  /** Libros y series: cuánto llevas (0–1), si se sabe, y en qué vas («Pág. 120 de 300»). */
  progress?: number;
  note?: string;
};

/** Un libro o una serie de la órbita. */
export const isMedia = (b: Body) => b.type === 'book' || b.type === 'series';

/** Tú, en el centro del universo: tu foto de «Mi ficha» o tus iniciales. */
export type Me = { name: string; image?: string; mark: string };

export type Signals = {
  today: string;
  hour: number;
  part: DayPart;
  /** El último ánimo que marcaste, si fue en los últimos 3 días. */
  mood: MoodMark | null;
  /** Los últimos 7 días, del más antiguo a hoy. */
  week: Day[];
  rhythm: Rhythm;
  open: { groups: OpenGroup[]; total: number };
  bodies: Body[];
  me: Me;
  ws: Workspace;
  capsules: Entry[];
};

/** La versión pequeña de una foto (la que conviene para un avatar). */
export const thumbOf = (img?: StoredImage) => (img ? img.thumb || img.medium || img.url : undefined);

/** Palabras que no dan inicial («Viaje a Cartagena» → «VC»). */
const SMALL = new Set(
  'a al con de del e el en la las los mi o para por su tu u un una y'.split(' '),
);
/** Una o dos iniciales en mayúscula, de las primeras palabras con peso. */
export function markOf(text: string) {
  const words = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const strong = words.filter((w) => !SMALL.has(w.toLowerCase()));
  return (strong.length ? strong : words)
    .slice(0, 2)
    .map((w) => Array.from(w)[0])
    .join('')
    .toUpperCase();
}

const dayOf = (iso: string) => todayInputValue(new Date(iso));
/** Cuándo lo registraste (si no se sabe, cuándo pasó). */
const loggedDay = (e: Entry) => dayOf(e.recorded_at ?? e.created_at);
export const titleOf = (e: Entry) => e.title.trim() || 'Sin título';

const LABELS: Record<string, string> = {
  quiero: 'Lo que quieres hacer',
  prometi: 'Lo que prometiste',
  espero: 'Lo que esperas de alguien',
  depende: 'Lo que depende de otra persona',
};
const COLORS: Record<string, string> = {
  quiero: '#6f8a56',
  prometi: '#a9775f',
  espero: '#b0914f',
  depende: '#5f7f97',
  episodios: '#8a7aa0',
};

export function readSignals(
  ws: Workspace,
  capsules: Entry[],
  now = new Date(),
  me: { name: string; photo?: StoredImage } = { name: '' },
): Signals {
  const today = todayInputValue(now);
  const hour = now.getHours();
  const entries = ws.entries;

  // Actividad por día (lo que registraste), para el ritmo y la semana.
  const perDay = new Map<string, number>();
  for (const e of entries) {
    const d = loggedDay(e);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const countOn = (d: string) => perDay.get(d) ?? 0;

  // Ánimo explícito: solo lo que marcaste en una entrada.
  const marks: MoodMark[] = [];
  for (const e of entries) {
    const mood = moodOf(e.details.mood);
    if (!mood) continue;
    const day = dayOf(e.created_at);
    if (day > today) continue;
    const ago = daysBetween(day, today);
    if (ago > 6) continue;
    marks.push({ mood, day, entry: e, ago });
  }
  marks.sort((a, b) => b.entry.created_at.localeCompare(a.entry.created_at));
  const mood = marks.find((m) => m.ago <= 2) ?? null;

  const week: Day[] = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6);
    return {
      day,
      mark: marks.find((m) => m.day === day) ?? null,
      count: countOn(day),
    };
  });

  let weekCount = 0;
  let activeDays = 0;
  for (const d of week) {
    weekCount += d.count;
    if (d.count) activeDays++;
  }
  let before = 0;
  for (let i = 7; i < 35; i++) before += countOn(addDays(today, -i));
  const base = before / 4;
  const ratio = weekCount / Math.max(base, 1);
  const rhythm: Rhythm = {
    week: weekCount,
    base,
    level: clamp01(weekCount / (Math.max(base, 3) * 2)),
    activeDays,
    trend:
      base < 1 && weekCount < 1 ? null : ratio < 0.6 ? 'menos' : ratio > 1.4 ? 'más' : 'parejo',
  };

  // Asuntos abiertos: pendientes por tipo de compromiso y episodios en curso.
  const active = ws.episodes.filter((ep) => ep.status === 'activo');
  const groups: OpenGroup[] = [];
  for (const k of commitmentKindList) {
    const items = entries
      .filter((e) => isOpenTask(e) && commitmentOf(e) === k)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((e) => ({ id: e.id, title: titleOf(e), entry: e }));
    if (items.length) groups.push({ key: k, label: LABELS[k], color: COLORS[k], items });
  }
  if (active.length)
    groups.push({
      key: 'episodios',
      label: active.length === 1 ? 'Un episodio en curso' : 'Episodios en curso',
      color: COLORS.episodios,
      items: active.map((ep) => ({
        id: ep.id,
        title: ep.title || 'Episodio',
        episode: ep,
      })),
    });
  const total = groups.reduce((a, g) => a + g.items.length, 0);

  return {
    today,
    hour,
    part: partOf(hour),
    mood,
    week,
    rhythm,
    open: { groups, total },
    bodies: bodiesOf(ws, active, today),
    me: { name: me.name, image: thumbOf(me.photo), mark: markOf(me.name) || 'Tú' },
    ws,
    capsules,
  };
}

function bodiesOf(ws: Workspace, active: Episode[], today: string): Body[] {
  const byEpisode = new Map<string, Entry[]>();
  for (const e of ws.entries)
    if (e.episode_id) byEpisode.set(e.episode_id, [...(byEpisode.get(e.episode_id) ?? []), e]);

  const episodes = active.map((ep) => {
    const linked = byEpisode.get(ep.id) ?? [];
    const days = [
      dayOf(ep.created_at),
      ...(ep.starts_on ? [ep.starts_on] : []),
      ...linked.map(loggedDay),
      ...ep.updates.map((u) => u.date),
    ].filter((d) => d <= today);
    const last = days.reduce((m, d) => (d > m ? d : m), '');
    const since = addDays(today, -13);
    const recent =
      linked.filter((e) => loggedDay(e) >= since).length +
      ep.updates.filter((u) => u.date >= since && u.date <= today).length;
    const people = new Set([...ep.person_ids, ...linked.flatMap((e) => e.person_ids)]);
    // Portada: la primera foto del episodio o, si no tiene, la del recuerdo más reciente con fotos.
    const cover =
      ep.images?.[0] ??
      [...linked]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .find((e) => e.images?.length)?.images[0];
    return {
      id: 'ep:' + ep.id,
      type: 'episode' as const,
      ref: ep.id,
      title: ep.title || 'Episodio',
      color: episodeKindOf(ep.kind).color,
      weight: linked.length + ep.updates.length + 1,
      ago: last ? Math.max(0, daysBetween(last, today)) : 30,
      recent,
      moons: [...people],
      people: people.size,
      ties: [] as string[],
      image: thumbOf(cover),
      mark: markOf(ep.title || 'Episodio'),
    };
  });
  episodes.sort((a, b) => a.ago - b.ago || b.weight - a.weight);
  const shownEpisodes = episodes.slice(0, 4);

  // Lo que estás leyendo y las series que estás viendo (hasta tres, lo más reciente primero).
  const since = addDays(today, -13);
  const media = ws.entries
    .filter(isActive)
    .map((e) => {
      const log = e.details.pageLog ?? [];
      const days = [loggedDay(e), ...log.map((x) => x.d)].filter((d) => d <= today);
      const last = days.reduce((m, d) => (d > m ? d : m), '');
      const prog = progressOf(e, today);
      return {
        id: 'm:' + e.id,
        type: e.kind === 'Libro' ? ('book' as const) : ('series' as const),
        ref: e.id,
        title: titleOf(e),
        color: kindMeta[e.kind].accent,
        weight: 1 + log.length,
        ago: last ? Math.max(0, daysBetween(last, today)) : 30,
        recent: log.filter((x) => x.d >= since && x.d <= today).length,
        moons: [] as string[],
        people: e.person_ids.length,
        ties: [] as string[],
        image: thumbOf(entryImages(e)[0]),
        mark: markOf(titleOf(e)),
        progress: prog.percent === null ? undefined : clamp01(prog.percent / 100),
        note: prog.text,
        entry: e,
      };
    })
    .sort((a, b) => a.ago - b.ago || b.recent - a.recent)
    .slice(0, 3);

  // Personas presentes en tus recuerdos de los últimos 60 días.
  const from = addDays(today, -59);
  const seen = new Map<string, { n: number; last: string; recent: number }>();
  for (const e of ws.entries) {
    if (!e.person_ids.length) continue;
    const d = dayOf(e.created_at);
    if (d < from || d > today) continue;
    for (const id of e.person_ids) {
      const s = seen.get(id) ?? { n: 0, last: '', recent: 0 };
      s.n++;
      if (d > s.last) s.last = d;
      if (daysBetween(d, today) < 14) s.recent++;
      seen.set(id, s);
    }
  }
  const room = Math.max(0, Math.min(3, 9 - shownEpisodes.length - media.length));
  const people = [...seen.entries()]
    .map(([id, s]) => ({ p: ws.people.find((x: Person) => x.id === id), s }))
    .filter((x): x is { p: Person; s: { n: number; last: string; recent: number } } => !!x.p)
    .sort((a, b) => b.s.n - a.s.n || b.s.last.localeCompare(a.s.last))
    .slice(0, room)
    .map(({ p, s }) => ({
      id: 'p:' + p.id,
      type: 'person' as const,
      ref: p.id,
      title: p.name,
      color: p.color || '#8fa07c',
      weight: s.n,
      ago: daysBetween(s.last, today),
      recent: s.recent,
      moons: [] as string[],
      people: 1,
      ties: [] as string[],
      image: thumbOf(p.profile.photo),
      mark: markOf(p.name),
    }));

  // Relaciones: una persona que orbita sola y además está en un episodio queda unida a él.
  const solo = new Set(people.map((b) => b.ref));
  for (const ep of shownEpisodes) {
    for (const pid of ep.moons) {
      if (!solo.has(pid)) continue;
      const pb = people.find((b) => b.ref === pid);
      if (!pb) continue;
      ep.ties.push(pb.id);
      pb.ties.push(ep.id);
    }
    ep.moons = ep.moons.filter((pid) => !solo.has(pid));
  }
  // Dos episodios que comparten personas también se relacionan.
  for (let i = 0; i < shownEpisodes.length; i++)
    for (let j = i + 1; j < shownEpisodes.length; j++) {
      const a = shownEpisodes[i];
      const b = shownEpisodes[j];
      const ap = active.find((x) => x.id === a.ref);
      const bp = active.find((x) => x.id === b.ref);
      const linked = ap?.links.some((l) => l.id === b.ref) || bp?.links.some((l) => l.id === a.ref);
      if (linked || a.moons.some((m) => b.moons.includes(m))) {
        a.ties.push(b.id);
        b.ties.push(a.id);
      }
    }
  // Un libro o una serie se une a quien lo comparte contigo y al episodio al que pertenece.
  const out: Body[] = [];
  for (const { entry, ...m } of media) {
    for (const pid of entry.person_ids) {
      const pb = people.find((b) => b.ref === pid);
      if (!pb) continue;
      m.ties.push(pb.id);
      pb.ties.push(m.id);
    }
    const ep = entry.episode_id && shownEpisodes.find((b) => b.ref === entry.episode_id);
    if (ep) {
      m.ties.push(ep.id);
      ep.ties.push(m.id);
    }
    out.push(m);
  }
  return [...shownEpisodes, ...out, ...people];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Frase neutra sobre el ritmo, sin juicios («más» o «menos» que tu semana habitual). */
export function rhythmText(r: Rhythm) {
  if (!r.week) return 'Estos últimos 7 días no hay registros nuevos.';
  const n = `${r.week} ${r.week === 1 ? 'registro' : 'registros'} en los últimos 7 días`;
  if (r.trend === 'más') return `${n}, algo más que tu semana habitual.`;
  if (r.trend === 'menos') return `${n}, algo menos que tu semana habitual.`;
  if (r.trend === 'parejo') return `${n}, parecido a tu semana habitual.`;
  return `${n}.`;
}
