import type {
  Entry,
  Exchange,
  ExchangeKind,
  Kind,
  Person,
  PersonStatus,
  PersonUpdate,
  Relation,
} from '../data';
import { addDays, normalizeText, splitList, todayInputValue } from './format';

// ───────────────────────── Catálogos ─────────────────────────

export const relationMeta: Record<
  Relation,
  { label: string; color: string; soft: string; ink: string }
> = {
  familia: { label: 'Familia', color: '#c0674a', soft: '#f9e9e2', ink: '#7d3a26' },
  pareja: { label: 'Pareja', color: '#c25683', soft: '#f8e5ee', ink: '#7a2f52' },
  amistad: { label: 'Amistad', color: '#5f8247', soft: '#eaf1e0', ink: '#3a5229' },
  trabajo: { label: 'Trabajo', color: '#4d7b9d', soft: '#e3eef6', ink: '#2b4c64' },
  conocido: { label: 'Conocido', color: '#9a8a62', soft: '#f4efe2', ink: '#5e5236' },
  otro: { label: 'Otro', color: '#7d8590', soft: '#eef0f3', ink: '#474d55' },
};
export const relations = Object.keys(relationMeta) as Relation[];
export const relationOf = (p: Person): Relation => p.profile.relation ?? 'otro';

export const closenessLabels = ['', 'Lejano', 'Conocido', 'Amigo', 'Cercano', 'Íntimo'];
export const closenessOf = (p: Person) => p.profile.closeness ?? 3;

/** Estado de la relación: con quién ya no hablas y a quién recuerdas. */
export const statusMeta: Record<PersonStatus, { label: string; short: string }> = {
  distante: { label: 'Ya no en contacto', short: 'Sin contacto' },
  memoria: { label: 'En memoria', short: 'En memoria' },
};
export const statusOf = (p: Person): PersonStatus | 'activa' => p.profile.status ?? 'activa';
/** Tiene sentido escribirle, sugerir verla o recordarle su cumpleaños. */
export const isReachable = (p: Person) => !p.profile.status;

export const exchangeKinds: Record<ExchangeKind, string> = {
  favor: 'Favor',
  regalo: 'Regalo',
  apoyo: 'Apoyo',
  tiempo: 'Tiempo',
  dinero: 'Dinero',
  iniciativa: 'Iniciativa',
};

export const cadenceOptions = [
  { value: 0, label: 'Sin meta' },
  { value: 7, label: 'Semanal' },
  { value: 15, label: 'Quincenal' },
  { value: 30, label: 'Mensual' },
  { value: 90, label: 'Trimestral' },
  { value: 180, label: 'Semestral' },
];

// ───────────────────────── Fechas ─────────────────────────

const DAY = 86_400_000;
const localDay = (iso: string) => todayInputValue(new Date(iso));
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to + 'T12:00:00') - Date.parse(from + 'T12:00:00')) / DAY);

/** «Hoy», «Ayer», «Hace 3 días», «Hace 2 semanas», «Hace 4 meses», «Hace 1 año». */
export function relativeDay(date: string | null, today = todayInputValue()) {
  if (!date) return 'Nunca';
  const d = daysBetween(date, today);
  if (d <= 0) return d === 0 ? 'Hoy' : 'Próximamente';
  if (d === 1) return 'Ayer';
  if (d < 14) return `Hace ${d} días`;
  if (d < 60) return `Hace ${Math.round(d / 7)} semanas`;
  if (d < 365) return `Hace ${Math.round(d / 30)} meses`;
  const y = Math.round(d / 365);
  return `Hace ${y} ${y === 1 ? 'año' : 'años'}`;
}

/** Días hasta el próximo cumpleaños (0 = hoy) o null si no hay fecha. */
export function daysToBirthday(p: Person, today = todayInputValue()) {
  const b = p.profile.birthday;
  if (!b || !/^\d{2}-\d{2}$/.test(b)) return null;
  const year = Number(today.slice(0, 4));
  let next = `${year}-${b}`;
  if (b === '02-29' && !isLeap(year)) next = `${year}-02-28`;
  let d = daysBetween(today, next);
  if (d < 0) {
    const y2 = year + 1;
    next = b === '02-29' && !isLeap(y2) ? `${y2}-02-28` : `${y2}-${b}`;
    d = daysBetween(today, next);
  }
  return d;
}
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function ageOf(p: Person, today = todayInputValue()) {
  const { birthYear, birthday } = p.profile;
  if (!birthYear) return null;
  let age = Number(today.slice(0, 4)) - birthYear;
  if (birthday && today.slice(5) < birthday) age--;
  return age >= 0 && age < 130 ? age : null;
}

// ───────────────────────── Interacciones ─────────────────────────

/**
 * Recuerdos que cuentan como interacción. Los movimientos, pendientes y las posibles conexiones
 * no: anotar que Andrés podría ayudar a Laura no significa que hablaste con Andrés.
 */
export const isInteraction = (e: Entry) =>
  e.kind !== 'Pendiente' && e.kind !== 'Movimiento' && !e.tags.includes('conexión');

export type PersonStats = {
  entries: Entry[];
  interactions: Entry[];
  last: string | null;
  daysSince: number | null;
  pending: Entry[];
  nextPending: Entry | null;
  /** Meta de contacto vencida: «toca escribirle». */
  overdue: boolean;
  /** Días hasta su cumpleaños; null si no hay fecha o si ya no están en contacto. */
  birthdayIn: number | null;
  reciprocity: Reciprocity;
  bond: number;
  /** Interacciones en los últimos 365 días. */
  yearCount: number;
};

export function statsFor(p: Person, all: Entry[], today = todayInputValue()): PersonStats {
  const entries = all
    .filter((e) => e.person_ids.includes(p.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const interactions = entries.filter((e) => isInteraction(e) && localDay(e.created_at) <= today);
  const last = interactions[0] ? localDay(interactions[0].created_at) : null;
  const daysSince = last ? daysBetween(last, today) : null;
  const pending = entries
    .filter((e) => e.kind === 'Pendiente' && e.status !== 'completado')
    .sort((a, b) => (a.details.due ?? '9999').localeCompare(b.details.due ?? '9999'));
  const cadence = p.profile.cadence ?? 0;
  const yearAgo = addDays(today, -365);
  const yearCount = interactions.filter((e) => localDay(e.created_at) >= yearAgo).length;
  const reciprocity = reciprocityOf(p);
  return {
    entries,
    interactions,
    last,
    daysSince,
    pending,
    nextPending: pending[0] ?? null,
    overdue: isReachable(p) && cadence > 0 && (daysSince === null || daysSince > cadence),
    birthdayIn: isReachable(p) ? daysToBirthday(p, today) : null,
    reciprocity,
    bond: bondScore(p, interactions, daysSince, reciprocity, today),
    yearCount,
  };
}

/** Cuánto pesa cada tipo de recuerdo como señal de vínculo: verse pesa más que anotar algo. */
const BOND_WEIGHT: Partial<Record<Kind, number>> = {
  Encuentro: 1,
  Nota: 0.5,
  Película: 0.6,
  Libro: 0.6,
  Trabajo: 0.6,
  Aprendizaje: 0.5,
};

/**
 * Índice de vínculo de 0 a 100. Se basa sobre todo en lo que de verdad pasa en el último año:
 * cuánto interactúan (ponderado por tipo), qué tan reciente fue la última vez, qué tan constante es
 * (meses distintos) y qué tan profundo (encuentros e intercambios). La cercanía que declaras y el
 * balance de dar y recibir solo suman si existen: si no los llenas, no restan.
 */
function bondScore(
  p: Person,
  interactions: Entry[],
  daysSince: number | null,
  r: Reciprocity,
  today: string,
) {
  const yearAgo = addDays(today, -365);
  let weight = 0;
  let meetings = 0;
  const months = new Set<string>();
  for (const e of interactions) {
    const day = localDay(e.created_at);
    if (day < yearAgo) break; // vienen de la más reciente a la más antigua
    weight += BOND_WEIGHT[e.kind] ?? 0.5;
    if (e.kind === 'Encuentro') meetings++;
    months.add(day.slice(0, 7));
  }
  const exchanges = (p.profile.exchanges ?? []).filter((x) => x.date >= yearAgo).length;
  const frequency = Math.min(1, Math.log1p(weight) / Math.log1p(20));
  const recency = daysSince === null ? 0 : Math.exp(-daysSince / 75);
  const consistency = Math.min(1, months.size / 8);
  const depth = Math.min(1, (meetings + exchanges * 0.5) / 10);
  const behavior = 0.35 * frequency + 0.25 * recency + 0.2 * consistency + 0.2 * depth;

  let sum = 0.65 * behavior;
  let used = 0.65;
  if (p.profile.closeness !== undefined) {
    sum += 0.25 * ((p.profile.closeness - 1) / 4);
    used += 0.25;
  }
  if (r.total >= 2) {
    sum += 0.1 * (1 - Math.min(1, Math.abs(r.score) / 100));
    used += 0.1;
  }
  return Math.round((100 * sum) / used);
}

// ───────────────────────── Reciprocidad ─────────────────────────

export type Reciprocity = {
  give: number;
  receive: number;
  total: number;
  /** -100 (solo recibes) … 0 (parejo) … 100 (solo das). */
  score: number;
  /** Margen que se considera «parejo» según la relación. */
  tolerance: number;
  state: 'sin-datos' | 'parejo' | 'das-mas' | 'recibes-mas';
  label: string;
  hint: string;
  byKind: Record<ExchangeKind, { give: number; receive: number }>;
  /** Quién tomó la iniciativa de buscar al otro. */
  initiative: { me: number; them: number };
};

// Con la familia y la pareja es normal que el balance oscile más que con el trabajo.
const tolerance: Record<Relation, number> = {
  familia: 40,
  pareja: 30,
  amistad: 25,
  trabajo: 15,
  conocido: 20,
  otro: 20,
};

export function reciprocityOf(
  p: Person,
  exchanges: Exchange[] = p.profile.exchanges ?? [],
): Reciprocity {
  const byKind = Object.fromEntries(
    (Object.keys(exchangeKinds) as ExchangeKind[]).map((k) => [k, { give: 0, receive: 0 }]),
  ) as Reciprocity['byKind'];
  let give = 0;
  let receive = 0;
  const initiative = { me: 0, them: 0 };
  for (const x of exchanges) {
    if (!byKind[x.kind]) continue;
    const w = x.weight ?? 1;
    if (x.dir === 'dar') {
      give += w;
      byKind[x.kind].give += w;
      if (x.kind === 'iniciativa') initiative.me++;
    } else {
      receive += w;
      byKind[x.kind].receive += w;
      if (x.kind === 'iniciativa') initiative.them++;
    }
  }
  const total = give + receive;
  const score = total ? Math.round(((give - receive) / total) * 100) : 0;
  const tol = tolerance[relationOf(p)];
  const first = p.name.split(' ')[0];
  if (total < 2) {
    return {
      give,
      receive,
      total,
      score,
      tolerance: tol,
      byKind,
      initiative,
      state: 'sin-datos',
      label: 'Sin datos aún',
      hint: `Registra lo que das y recibes con ${first} para medir el balance.`,
    };
  }
  if (Math.abs(score) <= tol) {
    return {
      give,
      receive,
      total,
      score,
      tolerance: tol,
      byKind,
      initiative,
      state: 'parejo',
      label: 'Equilibrado',
      hint: `Lo que das y recibes con ${first} está parejo para una relación de ${relationMeta[relationOf(p)].label.toLowerCase()}.`,
    };
  }
  return score > 0
    ? {
        give,
        receive,
        total,
        score,
        tolerance: tol,
        byKind,
        initiative,
        state: 'das-mas',
        label: score > 70 ? 'Das mucho más' : 'Das más',
        hint: `Estás aportando más de lo que recibes de ${first}. Puede valer la pena hablarlo o equilibrar tu energía.`,
      }
    : {
        give,
        receive,
        total,
        score,
        tolerance: tol,
        byKind,
        initiative,
        state: 'recibes-mas',
        label: score < -70 ? 'Recibes mucho más' : 'Recibes más',
        hint: `${first} te está dando más de lo que recibe. Un detalle o tu tiempo pueden equilibrarlo.`,
      };
}

// ───────────────────────── Perfil ─────────────────────────

const profileChecks: {
  key: string;
  label: string;
  section: PersonSection;
  ok: (p: Person) => boolean;
}[] = [
  { key: 'photo', label: 'Foto', section: 'esencia', ok: (p) => Boolean(p.profile.photo) },
  {
    key: 'relation',
    label: 'Tipo de relación',
    section: 'esencia',
    ok: (p) => Boolean(p.profile.relation),
  },
  { key: 'role', label: 'Contexto o rol', section: 'esencia', ok: (p) => Boolean(p.role) },
  {
    key: 'keywords',
    label: 'Palabras clave',
    section: 'esencia',
    ok: (p) => Boolean(p.profile.keywords?.length),
  },
  { key: 'phone', label: 'Teléfono', section: 'contacto', ok: (p) => Boolean(p.profile.phone) },
  { key: 'email', label: 'Correo', section: 'contacto', ok: (p) => Boolean(p.profile.email) },
  { key: 'city', label: 'Ciudad', section: 'contacto', ok: (p) => Boolean(p.profile.city) },
  {
    key: 'birthday',
    label: 'Cumpleaños',
    section: 'fechas',
    ok: (p) => Boolean(p.profile.birthday),
  },
  {
    key: 'met',
    label: 'Cómo se conocieron',
    section: 'fechas',
    ok: (p) => Boolean(p.profile.metHow || p.profile.metOn),
  },
  { key: 'work', label: 'Ocupación', section: 'vida', ok: (p) => Boolean(p.profile.occupation) },
  { key: 'interests', label: 'Intereses', section: 'gustos', ok: (p) => Boolean(p.interests) },
  {
    key: 'likes',
    label: 'Qué le gusta',
    section: 'gustos',
    ok: (p) => Boolean(p.profile.likes?.length),
  },
  {
    key: 'gifts',
    label: 'Ideas de regalo',
    section: 'gustos',
    ok: (p) => Boolean(p.profile.gifts?.length),
  },
  { key: 'bio', label: 'Su historia', section: 'historia', ok: (p) => Boolean(p.bio) },
  {
    key: 'cadence',
    label: 'Meta de contacto',
    section: 'esencia',
    ok: (p) => !isReachable(p) || p.profile.cadence !== undefined,
  },
];

export type PersonSection =
  'esencia' | 'vinculos' | 'contacto' | 'fechas' | 'vida' | 'gustos' | 'historia' | 'datos';

/** Qué tan completa está la ficha y qué falta (cada faltante abre su sección del formulario). */
export function completeness(p: Person) {
  const missing = profileChecks.filter((c) => !c.ok(p));
  return {
    percent: Math.round(((profileChecks.length - missing.length) / profileChecks.length) * 100),
    missing,
  };
}

/** Texto donde se busca a una persona (sin tildes). */
export function searchText(p: Person) {
  const pr = p.profile;
  return normalizeText(
    [
      p.name,
      p.role,
      p.interests,
      p.bio,
      pr.alias,
      pr.city,
      pr.occupation,
      pr.company,
      pr.family,
      pr.metHow,
      pr.email,
      pr.phone,
      pr.social,
      ...(pr.keywords ?? []),
      ...(pr.updates ?? []).map((u) => u.text),
      ...(pr.likes ?? []),
      ...(pr.gifts ?? []),
      ...(pr.facts ?? []).flatMap((f) => [f.label, f.value]),
      pr.relation ? relationMeta[pr.relation].label : '',
    ].join(' '),
  );
}

export const interestsOf = (p: Person) => splitList(p.interests);

// ───────────────────────── Recordatorios ─────────────────────────

export type Reminder = {
  id: string;
  person: Person;
  /** «recuerdo»: el cumpleaños de alguien que ya no está. */
  kind: 'cumple' | 'recuerdo' | 'pendiente' | 'contacto' | 'seguimiento';
  title: string;
  when: string;
  /** Para ordenar: días desde hoy (negativo = vencido). */
  in: number;
  entry?: Entry;
  /** Novedad por la que toca preguntarle. */
  update?: PersonUpdate;
};

const dueLabel = (d: number) =>
  d < 0
    ? `Venció hace ${-d} ${d === -1 ? 'día' : 'días'}`
    : d === 0
      ? 'Hoy'
      : d === 1
        ? 'Mañana'
        : `En ${d} días`;

export function remindersFor(people: Person[], entries: Entry[], today = todayInputValue()) {
  const out: Reminder[] = [];
  for (const p of people) {
    const s = statsFor(p, entries, today);
    const status = statusOf(p);
    const bIn = status === 'memoria' ? daysToBirthday(p, today) : s.birthdayIn;
    if (bIn !== null && bIn <= 30) {
      const age = ageOf(p, addDays(today, bIn));
      const memory = status === 'memoria';
      out.push({
        id: 'b' + p.id,
        person: p,
        kind: memory ? 'recuerdo' : 'cumple',
        title: memory
          ? `Cumpleaños de ${p.name} · ${age !== null ? `habría cumplido ${age}` : 'en su memoria'}`
          : `Cumpleaños de ${p.name}${age !== null ? ` · cumple ${age}` : ''}`,
        when: bIn === 0 ? 'Hoy' : bIn === 1 ? 'Mañana' : `En ${bIn} días`,
        in: bIn,
      });
    }
    for (const e of s.pending) {
      const due = e.details.due;
      const d = due ? daysBetween(today, due) : 99;
      if (d > 14) continue;
      out.push({
        id: 'p' + e.id + p.id,
        person: p,
        kind: 'pendiente',
        title: `${e.title} · ${p.name.split(' ')[0]}`,
        when: !due
          ? 'Sin fecha'
          : d < 0
            ? `Venció hace ${-d} ${d === -1 ? 'día' : 'días'}`
            : d === 0
              ? 'Hoy'
              : d === 1
                ? 'Mañana'
                : `En ${d} días`,
        in: due ? d : 50,
        entry: e,
      });
    }
    for (const u of status === 'activa' ? (p.profile.updates ?? []) : []) {
      if (!u.followUp || u.done) continue;
      const d = daysBetween(today, u.followUp);
      if (d > 14) continue;
      out.push({
        id: 'u' + u.id,
        person: p,
        kind: 'seguimiento',
        title: `Pregúntale a ${p.name.split(' ')[0]}: ${u.text.length > 60 ? u.text.slice(0, 58) + '…' : u.text}`,
        when: dueLabel(d),
        in: d,
        update: u,
      });
    }
    if (s.overdue) {
      out.push({
        id: 'c' + p.id,
        person: p,
        kind: 'contacto',
        title: `Escríbele a ${p.name.split(' ')[0]}`,
        when: s.daysSince === null ? 'Nunca han hablado' : `${s.daysSince} días sin hablar`,
        in: 40,
      });
    }
  }
  // Un mismo pendiente vinculado a varias personas aparece una sola vez.
  const seen = new Set<string>();
  return out
    .filter((r) => {
      const key = r.entry ? r.entry.id : r.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.in - b.in);
}

// ───────────────────────── Red ─────────────────────────

/** Recuerdos dentro del año elegido (o todos). */
export function inYear(entries: Entry[], year: number | 'todo') {
  if (year === 'todo') return entries;
  const y = String(year);
  return entries.filter((e) => localDay(e.created_at).startsWith(y));
}

export function yearsWithData(entries: Entry[]) {
  const years = new Set(
    entries
      .filter((e) => e.person_ids.length)
      .map((e) => Number(localDay(e.created_at).slice(0, 4))),
  );
  return [...years].sort((a, b) => b - a);
}

/** Cuántas veces aparece cada persona y cada pareja de personas en un mismo recuerdo. */
export function coOccurrence(entries: Entry[]) {
  const counts = new Map<string, number>();
  const pairs = new Map<string, { a: string; b: string; n: number }>();
  for (const e of entries) {
    if (!isInteraction(e)) continue;
    const ids = [...new Set(e.person_ids)];
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const key = a + '|' + b;
        const pair = pairs.get(key);
        if (pair) pair.n++;
        else pairs.set(key, { a, b, n: 1 });
      }
    }
  }
  return { counts, pairs: [...pairs.values()] };
}

/** Con quién más aparece una persona. */
export function companionsOf(personId: string, people: Person[], entries: Entry[]) {
  const { pairs } = coOccurrence(entries);
  return pairs
    .filter((x) => x.a === personId || x.b === personId)
    .map((x) => ({ person: people.find((p) => p.id === (x.a === personId ? x.b : x.a)), n: x.n }))
    .filter((x): x is { person: Person; n: number } => Boolean(x.person))
    .sort((a, b) => b.n - a.n);
}

// ───────────────────────── Resumen anual (wrapped) ─────────────────────────

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

export function wrappedFor(people: Person[], entries: Entry[], year: number | 'todo') {
  const scoped = inYear(entries, year).filter((e) => isInteraction(e) && e.person_ids.length);
  const { counts, pairs } = coOccurrence(scoped);
  const byId = new Map(people.map((p) => [p.id, p]));
  const top = [...counts.entries()]
    .flatMap(([id, n]) => (byId.has(id) ? [{ person: byId.get(id)!, n }] : []))
    .sort((a, b) => b.n - a.n);
  const months = Array.from({ length: 12 }, () => 0);
  for (const e of scoped) months[new Date(e.created_at).getMonth()]++;
  const busiest = months.indexOf(Math.max(...months));
  const kinds = new Map<string, number>();
  for (const e of scoped) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const topKind = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0];
  const biggest = [...scoped].sort((a, b) => b.person_ids.length - a.person_ids.length)[0];
  const duo = [...pairs].sort((a, b) => b.n - a.n)[0];

  // Personas nuevas: su primera interacción registrada cae en el año elegido.
  const firstSeen = new Map<string, string>();
  for (const e of [...entries]
    .filter(isInteraction)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    for (const id of e.person_ids)
      if (!firstSeen.has(id)) firstSeen.set(id, localDay(e.created_at));
  }
  const newPeople =
    year === 'todo'
      ? []
      : [...firstSeen.entries()]
          .filter(([, d]) => d.startsWith(String(year)))
          .flatMap(([id]) => byId.get(id) ?? []);

  // Personas con las que hablaste el año anterior y este no.
  const faded =
    year === 'todo'
      ? []
      : [...coOccurrence(inYear(entries, year - 1)).counts.keys()]
          .filter((id) => !counts.has(id))
          .flatMap((id) => byId.get(id) ?? []);

  let give = 0;
  let receive = 0;
  for (const p of people) {
    for (const x of p.profile.exchanges ?? []) {
      if (year !== 'todo' && !x.date.startsWith(String(year))) continue;
      if (x.dir === 'dar') give += x.weight;
      else receive += x.weight;
    }
  }

  return {
    total: scoped.length,
    people: counts.size,
    top: top.slice(0, 5),
    months,
    busiest: scoped.length ? monthNames[busiest] : null,
    topKind: topKind ? { kind: topKind[0], n: topKind[1] } : null,
    biggest: biggest && biggest.person_ids.length > 1 ? biggest : null,
    duo: duo ? { a: byId.get(duo.a), b: byId.get(duo.b), n: duo.n } : null,
    newPeople,
    faded,
    give,
    receive,
  };
}
