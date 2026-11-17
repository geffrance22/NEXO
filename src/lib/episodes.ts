import {
  Briefcase,
  Building2,
  CloudRain,
  Coffee,
  Dumbbell,
  FileText,
  GraduationCap,
  Hammer,
  HandHeart,
  Handshake,
  Heart,
  HeartPulse,
  Milestone,
  Mountain,
  Palette,
  PartyPopper,
  PawPrint,
  Plane,
  Rocket,
  ShoppingBag,
  Shuffle,
  Signpost,
  Sparkles,
  StickyNote,
  Ticket,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type {
  Entry,
  Episode,
  EpisodeKind,
  EpisodeKindValue,
  EpisodeLinkKind,
  EpisodeOrigin,
  EpisodeUpdateKind,
  Person,
  Place,
  StoredImage,
} from '../data';
import { isDoneTask, isMissedTask, isOpenTask } from './commitments';
import { normalizeText, todayInputValue } from './format';
import { daysBetween } from './people';
import { flowOf, totals } from '../finance/money';
import {
  chargeStats,
  goalSaved,
  isOpenCharge,
  itemsOf,
  pocketStats,
  type ChargeStats,
  type FinItem,
} from '../finance/model';

export type EpisodeKindMeta = {
  label: string;
  icon: LucideIcon;
  color: string;
  soft: string;
  /** Título de ejemplo para el formulario. */
  example: string;
};

/** Tipos de episodio, de los más comunes a los menos (en ese orden se muestran). */
export const episodeKinds: Record<EpisodeKind, EpisodeKindMeta> = {
  viaje: {
    label: 'Viaje',
    icon: Plane,
    color: '#3c9186',
    soft: '#dff2ef',
    example: 'Viaje a Cartagena',
  },
  encuentro: {
    label: 'Encuentro',
    icon: Coffee,
    color: '#8a6fa8',
    soft: '#f0e9f6',
    example: 'Reencuentro del colegio',
  },
  celebracion: {
    label: 'Celebración',
    icon: PartyPopper,
    color: '#c25683',
    soft: '#f8e5ee',
    example: 'Cumpleaños de Laura',
  },
  evento: {
    label: 'Evento',
    icon: Ticket,
    color: '#c48a2a',
    soft: '#fbf1dc',
    example: 'Concierto en el Movistar Arena',
  },
  proyecto: {
    label: 'Proyecto',
    icon: Briefcase,
    color: '#4d7b9d',
    soft: '#e3eef6',
    example: 'Lanzamiento de la web',
  },
  colaboracion: {
    label: 'Colaboración',
    icon: Handshake,
    color: '#5f8247',
    soft: '#eaf1e0',
    example: 'Podcast con Andrés',
  },
  negocio: {
    label: 'Negocio',
    icon: Rocket,
    color: '#d0663f',
    soft: '#fbe9e1',
    example: 'Abrir la tienda online',
  },
  empleo: {
    label: 'Empleo',
    icon: Building2,
    color: '#56708a',
    soft: '#e6edf3',
    example: 'Búsqueda de trabajo',
  },
  estudio: {
    label: 'Estudios',
    icon: GraduationCap,
    color: '#5b63b7',
    soft: '#e8e9f8',
    example: 'Curso de fotografía',
  },
  salud: {
    label: 'Salud',
    icon: HeartPulse,
    color: '#c4506a',
    soft: '#f9e4e9',
    example: 'Recuperación de la rodilla',
  },
  deporte: {
    label: 'Deporte',
    icon: Dumbbell,
    color: '#2f8a6a',
    soft: '#dcf1e8',
    example: 'Preparación para la media maratón',
  },
  aventura: {
    label: 'Aventura',
    icon: Mountain,
    color: '#6f7f3a',
    soft: '#eef1dc',
    example: 'Travesía por el Cocuy',
  },
  familia: {
    label: 'Familia',
    icon: Users,
    color: '#b07a3c',
    soft: '#f7ecdd',
    example: 'Navidad en casa de los abuelos',
  },
  pareja: {
    label: 'Pareja',
    icon: Heart,
    color: '#d1495b',
    soft: '#fbe3e6',
    example: 'Aniversario de cinco años',
  },
  mascota: {
    label: 'Mascota',
    icon: PawPrint,
    color: '#a0703f',
    soft: '#f5ebdf',
    example: 'La llegada de Luna',
  },
  hogar: {
    label: 'Hogar',
    icon: Hammer,
    color: '#8a7350',
    soft: '#f3ede2',
    example: 'Remodelación de la cocina',
  },
  mudanza: {
    label: 'Mudanza',
    icon: Truck,
    color: '#9a8a62',
    soft: '#f4efe2',
    example: 'Mudanza al nuevo apartamento',
  },
  compra: {
    label: 'Gran compra',
    icon: ShoppingBag,
    color: '#b3792b',
    soft: '#faefdc',
    example: 'Compra del carro',
  },
  tramite: {
    label: 'Trámite',
    icon: FileText,
    color: '#6b7a8c',
    soft: '#e9edf2',
    example: 'Renovación del pasaporte',
  },
  creativo: {
    label: 'Creativo',
    icon: Palette,
    color: '#a35cb0',
    soft: '#f4e6f6',
    example: 'Grabar el primer EP',
  },
  voluntariado: {
    label: 'Voluntariado',
    icon: HandHeart,
    color: '#3f8f8f',
    soft: '#def0f0',
    example: 'Jornada en el comedor comunitario',
  },
  etapa: {
    label: 'Etapa de vida',
    icon: Milestone,
    color: '#6b75b8',
    soft: '#e9ebf8',
    example: 'Primer año en Madrid',
  },
  dificil: {
    label: 'Momento difícil',
    icon: CloudRain,
    color: '#64748b',
    soft: '#e8ecf1',
    example: 'Un mes complicado',
  },
  otro: {
    label: 'Otro',
    icon: Sparkles,
    color: '#7d8590',
    soft: '#eef0f3',
    example: 'Ponle un nombre',
  },
};
export const episodeKindList = Object.keys(episodeKinds) as EpisodeKind[];

/** Largo máximo del tipo escrito a mano (la base guarda hasta 30 caracteres con «otro:»). */
export const CUSTOM_KIND_MAX = 24;
const CUSTOM = 'otro:';
/** El nombre que escribiste en «Otro» («Boda», «Retiro»…), o '' si es un tipo de la lista. */
export const customKind = (kind: string) =>
  kind.startsWith(CUSTOM) ? kind.slice(CUSTOM.length) : '';
/** El tipo de la lista al que corresponde (los escritos a mano cuentan como «otro»). */
export const baseKind = (kind: string): EpisodeKind =>
  episodeKindList.includes(kind as EpisodeKind) ? (kind as EpisodeKind) : 'otro';
/** Lo que se guarda al elegir «Otro» y escribir un nombre. */
export const toCustomKind = (label: string): EpisodeKindValue => {
  const t = label.trim().replace(/\s+/g, ' ').slice(0, CUSTOM_KIND_MAX);
  return t ? `otro:${t}` : 'otro';
};
/** Nombre, ícono y colores de un tipo, incluido uno escrito a mano. */
export function episodeKindOf(kind: string): EpisodeKindMeta {
  const custom = customKind(kind);
  return custom ? { ...episodeKinds.otro, label: custom } : episodeKinds[baseKind(kind)];
}

/** Tipos de entrada de la bitácora de un episodio. */
export const episodeUpdateKinds: Record<
  EpisodeUpdateKind,
  { label: string; icon: LucideIcon; color: string; soft: string; hint: string }
> = {
  avance: {
    label: 'Avance',
    icon: TrendingUp,
    color: '#4d7b9d',
    soft: '#e3eef6',
    hint: '¿Qué avanzó? «Ya tenemos los tiquetes»',
  },
  decision: {
    label: 'Decisión',
    icon: Signpost,
    color: '#6b62b5',
    soft: '#eeebfa',
    hint: '¿Qué se decidió y por qué?',
  },
  cambio: {
    label: 'Cambio',
    icon: Shuffle,
    color: '#c48a2a',
    soft: '#fbf1dc',
    hint: '¿Qué cambió? «Se movió la fecha al sábado»',
  },
  problema: {
    label: 'Problema',
    icon: TriangleAlert,
    color: '#c0553f',
    soft: '#f9e5df',
    hint: '¿Qué salió mal o preocupa?',
  },
  logro: {
    label: 'Logro',
    icon: Trophy,
    color: '#3c9186',
    soft: '#dff2ef',
    hint: '¿Qué salió bien?',
  },
  nota: {
    label: 'Nota',
    icon: StickyNote,
    color: '#7d8590',
    soft: '#eef0f3',
    hint: 'Cualquier cosa que quieras recordar',
  },
};
export const episodeUpdateKindList = Object.keys(episodeUpdateKinds) as EpisodeUpdateKind[];

/** Cómo se lee un vínculo desde cada lado: A «se convirtió en» B ⇄ B «surgió de» A. */
export const episodeLinkKinds: Record<EpisodeLinkKind, { label: string; back: string }> = {
  derivo: { label: 'Se convirtió en', back: 'Surgió de' },
  continua: { label: 'Es continuación de', back: 'Continúa en' },
  parte: { label: 'Es parte de', back: 'Incluye' },
  relacionado: { label: 'Relacionado con', back: 'Relacionado con' },
};
export const episodeLinkKindList = Object.keys(episodeLinkKinds) as EpisodeLinkKind[];

/** Cómo se lee, desde el episodio nuevo, su relación con el de origen. */
export const originLabel = (from: Pick<EpisodeOrigin, 'kind' | 'holder'>) =>
  from.holder === 'new' ? episodeLinkKinds[from.kind].label : episodeLinkKinds[from.kind].back;

export type RelatedEpisode = {
  episode: Episode;
  kind: EpisodeLinkKind;
  /** El vínculo está guardado en este episodio (si no, en el otro). */
  own: boolean;
  label: string;
};

/** Episodios relacionados con uno, en los dos sentidos y sin repetir. */
export function relatedEpisodes(ep: Episode, all: Episode[]): RelatedEpisode[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  const out: RelatedEpisode[] = [];
  const seen = new Set<string>();
  for (const l of ep.links ?? []) {
    const other = byId.get(l.id);
    if (!other || seen.has(other.id)) continue;
    seen.add(other.id);
    out.push({ episode: other, kind: l.kind, own: true, label: episodeLinkKinds[l.kind].label });
  }
  for (const other of all) {
    if (other.id === ep.id || seen.has(other.id)) continue;
    const l = (other.links ?? []).find((x) => x.id === ep.id);
    if (!l) continue;
    seen.add(other.id);
    out.push({ episode: other, kind: l.kind, own: false, label: episodeLinkKinds[l.kind].back });
  }
  return out;
}

const day = (iso: string) => todayInputValue(new Date(iso));

// ───────────────────────── Episodio ↔ Finanzas ─────────────────────────

/** Lo de Finanzas que se puede conectar a un episodio. */
export type EpisodeFinItem = FinItem<'cobro'> | FinItem<'bolsillo'> | FinItem<'meta'>;

/**
 * Lo de Finanzas conectado a un episodio (trabajos por cobrar, bolsillos y carteras, metas) y lo
 * que eso trae: los abonos de sus trabajos y los gastos que salieron de sus carteras cuentan aquí
 * solos, sin enlazar cada movimiento ni escribir el valor dos veces.
 */
export function episodeFinance(
  ep: Pick<Episode, 'id'>,
  entries: readonly Entry[],
  fin: readonly FinItem[] | null | undefined,
) {
  const chargeItems = itemsOf(fin ?? null, 'cobro').filter((x) => x.data.episodeId === ep.id);
  const pocketItems = itemsOf(fin ?? null, 'bolsillo').filter((x) => x.data.episodeId === ep.id);
  const goalItems = itemsOf(fin ?? null, 'meta').filter((x) => x.data.episodeId === ep.id);
  const byCharge = new Map(chargeItems.map((c) => [c.id, c]));
  const byPocket = new Map(pocketItems.map((p) => [p.id, p]));
  /** Movimiento → lo de Finanzas por lo que cuenta aquí (si no tiene el episodio puesto). */
  const via = new Map<string, string>();
  if (byCharge.size || byPocket.size)
    for (const e of entries) {
      if (e.kind !== 'Movimiento' || e.episode_id) continue;
      const c = e.details.chargeId ? byCharge.get(e.details.chargeId) : undefined;
      if (c) {
        via.set(e.id, c.title);
        continue;
      }
      const p = e.details.pocketId ? byPocket.get(e.details.pocketId) : undefined;
      const f = p ? flowOf(e) : null;
      if (p && (f === 'gasto' || f === 'reembolso')) via.set(e.id, p.title);
    }
  // Un ingreso del episodio trae lo que le anexaste (sus gastos y lo que guardaste de él), también
  // lo que le anexes después: no hay que enlazar cada uno.
  const incomes = new Map<string, string>();
  for (const e of entries)
    if (
      e.kind === 'Movimiento' &&
      (e.episode_id === ep.id || via.has(e.id)) &&
      flowOf(e) === 'ingreso'
    )
      incomes.set(e.id, e.title || e.tags[0] || 'Ingreso');
  if (incomes.size)
    for (const e of entries) {
      if (e.kind !== 'Movimiento' || e.episode_id || via.has(e.id) || !e.details.fromIncome)
        continue;
      const from = incomes.get(e.details.fromIncome);
      if (from) via.set(e.id, from);
    }
  const charges = chargeItems.map((item) => ({ item, s: chargeStats(item, entries) }));
  const pockets = pocketItems.map((item) => {
    const st = pocketStats(item, entries);
    const spentHere = entries
      .filter(
        (e) =>
          e.kind === 'Movimiento' &&
          e.details.pocketId === item.id &&
          !e.details.pending &&
          flowOf(e) === 'gasto' &&
          (!e.episode_id || e.episode_id === ep.id),
      )
      .reduce((n, e) => n + e.amount, 0);
    return { item, balance: st.balance, spentHere };
  });
  const goals = goalItems.map((item) => ({ item, saved: goalSaved(item, entries) }));
  // Sin presupuesto propio, el episodio usa el de su meta o el de su bolsillo de ahorro.
  const goal = goals.find((g) => g.item.data.target > 0);
  const saving = pockets.find((p) => p.item.data.use === 'ahorro' && p.item.data.target);
  const budget = goal
    ? { amount: goal.item.data.target, from: goal.item.title }
    : saving
      ? { amount: saving.item.data.target!, from: saving.item.title }
      : null;
  return {
    charges,
    pockets,
    goals,
    via,
    budget,
    /** Lo que falta por cobrar de sus trabajos. */
    toCollect: charges.reduce((n, c) => n + (c.s.done ? 0 : c.s.left), 0),
    count: charges.length + pockets.length + goals.length,
  };
}
export type EpisodeFinance = ReturnType<typeof episodeFinance>;
export type EpisodeCharge = { item: FinItem<'cobro'>; s: ChargeStats };

/** El dinero de un episodio: lo enlazado a él más lo que llega por lo que tiene conectado. */
export function episodeMoney(
  ep: Pick<Episode, 'id' | 'budget'>,
  entries: readonly Entry[],
  fin: readonly FinItem[] | null | undefined,
) {
  const f = episodeFinance(ep, entries, fin);
  const list = entries.filter(
    (e) => e.kind === 'Movimiento' && (e.episode_id === ep.id || f.via.has(e.id)),
  );
  return { list, ...totals(list), budget: ep.budget ?? f.budget?.amount ?? null, finance: f };
}

const GENERIC = new Set([
  'para',
  'con',
  'del',
  'las',
  'los',
  'una',
  'unos',
  'unas',
  'este',
  'esta',
  'como',
  'sobre',
  'entre',
  'desde',
  'hasta',
  'abono',
  'pago',
  'cobro',
  'trabajo',
  'proyecto',
  'gasto',
  'ingreso',
  'ahorro',
  'meta',
  'bolsillo',
  'cartera',
  'parte',
  'total',
]);
/** Las palabras que distinguen un nombre (sin las comunes, y en singular). */
function keyWords(text: string) {
  const out = new Set<string>();
  for (const raw of normalizeText(text).split(/[^a-z0-9]+/)) {
    const w = raw.length > 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
    if ((w.length >= 4 || /^\d{3,}$/.test(w)) && !GENERIC.has(w)) out.add(w);
  }
  return out;
}

export type FinSuggestion = { item: EpisodeFinItem; why: string; score: number };

/**
 * Lo de Finanzas que parece de este episodio: el mismo nombre, la misma persona o las mismas
 * fechas. Solo lo que aún no está en otro episodio.
 */
export function suggestFinance(
  ep: Episode,
  fin: readonly FinItem[] | null | undefined,
  people: readonly Person[],
  episodeIds: ReadonlySet<string>,
): FinSuggestion[] {
  const words = keyWords(`${ep.title} ${ep.summary ?? ''}`);
  const from = ep.starts_on;
  const to = ep.ends_on ?? ep.starts_on;
  const near = (d?: string) =>
    Boolean(from && to && d && d >= addDaysSafe(from, -14) && d <= addDaysSafe(to, 14));
  const free = (x: EpisodeFinItem) => !x.data.episodeId || !episodeIds.has(x.data.episodeId);
  const pool: EpisodeFinItem[] = [
    ...itemsOf(fin ?? null, 'cobro').filter(isOpenCharge),
    ...itemsOf(fin ?? null, 'bolsillo').filter((p) => !p.archived),
    ...itemsOf(fin ?? null, 'meta').filter((g) => !g.archived),
  ].filter(free);
  const out: FinSuggestion[] = [];
  for (const item of pool) {
    const why: string[] = [];
    let score = 0;
    const shared = [...keyWords(item.title)].filter((w) => words.has(w)).length;
    if (shared) {
      score += Math.min(2, shared) * 3;
      why.push('mismo nombre');
    }
    if (item.kind === 'cobro') {
      const pid = item.data.personId;
      if (pid && ep.person_ids.includes(pid)) {
        score += 3;
        why.push(
          `con ${people.find((p) => p.id === pid)?.name.split(' ')[0] ?? 'la misma persona'}`,
        );
      }
      if (near(item.data.start)) {
        score += 1;
        why.push('mismas fechas');
      }
    } else if (item.kind === 'meta' && near(item.data.due)) {
      score += 1;
      why.push('mismas fechas');
    }
    if (score >= 3) out.push({ item, why: why.join(' · '), score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 4);
}

export type MoveSuggestion = { entry: Entry; why: string; score: number };

/**
 * Movimientos sueltos que parecen de este episodio: el mismo nombre, sus personas o sus fechas.
 * Los anexados a un ingreso no se sugieren solos: llegan con su ingreso.
 */
export function suggestMoves(
  ep: Episode,
  entries: readonly Entry[],
  people: readonly Person[],
  /** Los que ya cuentan aquí (por lo conectado). */
  counted: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): MoveSuggestion[] {
  const words = keyWords(`${ep.title} ${ep.summary ?? ''}`);
  const from = ep.starts_on;
  const to = ep.ends_on ?? ep.starts_on;
  const out: MoveSuggestion[] = [];
  for (const e of entries) {
    if (e.kind !== 'Movimiento' || e.episode_id || counted.has(e.id) || e.details.fromIncome)
      continue;
    const why: string[] = [];
    let score = 0;
    const text = `${e.title} ${e.tags.join(' ')} ${e.body.slice(0, 200)}`;
    const shared = [...keyWords(text)].filter((w) => words.has(w)).length;
    if (shared) {
      score += Math.min(2, shared) * 3;
      why.push('mismo nombre');
    }
    const d = day(e.created_at);
    if (from && to && d >= addDaysSafe(from, -3) && d <= addDaysSafe(to, 3)) {
      score += 2;
      why.push('mismas fechas');
    }
    const with_ = e.person_ids.filter((id) => ep.person_ids.includes(id));
    if (with_.length) {
      score += Math.min(2, with_.length) * 2;
      why.push(`con ${people.find((p) => p.id === with_[0])?.name.split(' ')[0] ?? 'su gente'}`);
    }
    if (score >= 3) out.push({ entry: e, why: why.join(' · '), score });
  }
  return out
    .sort((a, b) => b.score - a.score || b.entry.created_at.localeCompare(a.entry.created_at))
    .slice(0, 8);
}

/** Todo lo que reúne un episodio, con los totales calculados (nunca estimados). */
export function episodeSummary(
  ep: Episode,
  entries: Entry[],
  people: Person[],
  places: Place[],
  /** Lo de Finanzas: con él cuentan solos los abonos y gastos de lo que tiene conectado. */
  fin?: readonly FinItem[] | null,
) {
  const finance = episodeFinance(ep, entries, fin);
  const items = entries
    .filter((e) => e.episode_id === ep.id || finance.via.has(e.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const money = items.filter((e) => e.kind === 'Movimiento');
  const { spent, income: earned } = totals(money);
  const tasks = items.filter((e) => e.kind === 'Pendiente');
  const ids = new Set([...ep.person_ids, ...items.flatMap((e) => e.person_ids)]);
  const placeIds = new Set([
    ...ep.place_ids,
    ...items.flatMap((e) => (e.details.placeId ? [e.details.placeId] : [])),
  ]);
  const updates = people.flatMap((p) =>
    (p.profile.updates ?? [])
      .filter((u) => u.episodeId === ep.id)
      .map((u) => ({ person: p, update: u })),
  );
  // Galería: las fotos del episodio, de su bitácora, de sus recuerdos y de las novedades.
  const seen = new Set<string>();
  const photos: StoredImage[] = [
    ...(ep.images ?? []),
    ...(ep.updates ?? []).flatMap((u) => u.images ?? []),
    ...items.flatMap((e) => e.images),
    ...updates.flatMap(({ update }) => update.images ?? []),
  ].filter((i) => !seen.has(i.url) && seen.add(i.url));
  const dates = [
    ...items.map((e) => day(e.created_at)),
    ...(ep.updates ?? []).map((u) => u.date),
  ].sort();
  const from = ep.starts_on ?? dates[0] ?? null;
  const to = ep.ends_on ?? dates[dates.length - 1] ?? null;
  const today = todayInputValue();
  // En curso y sin fecha final: cuenta hasta hoy.
  const until = ep.status === 'activo' && !ep.ends_on ? today : (to ?? from);
  return {
    items,
    money,
    spent,
    earned,
    net: earned - spent,
    finance,
    /** El presupuesto: el propio o, si no tiene, el de su meta o bolsillo en Finanzas. */
    budget: ep.budget ?? finance.budget?.amount ?? null,
    budgetFrom: ep.budget ? null : (finance.budget?.from ?? null),
    open: tasks.filter(isOpenTask),
    done: tasks.filter(isDoneTask),
    missed: tasks.filter(isMissedTask),
    learnings: items.filter((e) => e.kind === 'Aprendizaje'),
    people: people.filter((p) => ids.has(p.id)),
    places: places.filter((p) => placeIds.has(p.id)),
    photos,
    updates,
    from,
    to,
    /** Días que abarca (contando el primero y el último). */
    days: from && until && until >= from ? daysBetween(from, until) + 1 : null,
    /** Días que faltan para que empiece (si es a futuro). */
    startsIn: from && from > today ? daysBetween(today, from) : null,
  };
}
export type EpisodeSummary = ReturnType<typeof episodeSummary>;

/** Último día en que pasó algo en el episodio: un recuerdo, la bitácora o su creación. */
export function lastActivity(ep: Episode, items: Entry[]) {
  const days = [
    day(ep.created_at),
    ...items.map((e) => day(e.recorded_at ?? e.created_at)),
    ...(ep.updates ?? []).map((u) => u.date),
  ];
  return days.reduce((max, d) => (d > max ? d : max), days[0]);
}

/** Recuerdos sueltos que probablemente pertenecen a un episodio: mismas fechas o personas. */
export function candidateEntries(ep: Episode, entries: Entry[], query = '') {
  const from = ep.starts_on;
  const to = ep.ends_on ?? ep.starts_on;
  const needle = normalizeText(query.trim());
  return entries
    .filter((e) => !e.episode_id)
    .map((e) => {
      const d = day(e.created_at);
      const inRange = from && to ? d >= addDaysSafe(from, -2) && d <= addDaysSafe(to, 2) : false;
      const shared = e.person_ids.filter((id) => ep.person_ids.includes(id)).length;
      const text = normalizeText(`${e.title} ${e.body} ${e.tags.join(' ')}`);
      const hit = needle ? text.includes(needle) : false;
      return { e, score: (inRange ? 3 : 0) + shared + (hit ? 5 : 0), hit };
    })
    .filter((x) => (needle ? x.hit : x.score > 0))
    .sort((a, b) => b.score - a.score || b.e.created_at.localeCompare(a.e.created_at))
    .slice(0, 40)
    .map((x) => x.e);
}

function addDaysSafe(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  return todayInputValue(new Date(y, m - 1, d + n));
}
