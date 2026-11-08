import type { Entry, Episode, Person, PersonUpdate, Workspace } from '../data';
import { ageInDays, commitmentKinds, commitmentOf, counterpartOf, isOpenTask } from './commitments';
import { addDays, todayInputValue } from './format';
import { genderOf } from './gender';
import { closenessOf, daysBetween, daysToBirthday, statsFor } from './people';
import { ME, kinCall, tieKinds, tiesOf } from './relations';

/** Qué tipo de cosa merece tu atención. */
export type AgendaKind =
  | 'compromiso'
  | 'espera'
  | 'seguimiento'
  | 'encuentro'
  | 'cierre'
  | 'cumple'
  | 'proyecto'
  | 'episodio'
  | 'contacto';

export const agendaKindLabels: Record<AgendaKind, string> = {
  compromiso: 'Compromisos con fecha',
  espera: 'Lo que estás esperando',
  seguimiento: 'Seguimientos de novedades',
  encuentro: 'Encuentros próximos',
  cierre: 'Encuentros por cerrar',
  cumple: 'Cumpleaños',
  proyecto: 'Proyectos sin próximo paso',
  episodio: 'Episodios por cerrar',
  contacto: 'Personas a las que escribir',
};

export type AgendaAction =
  'completar' | 'preguntado' | 'preparar' | 'cerrar' | 'abrir' | 'paso' | 'escribir';

export type AgendaItem = {
  /** Clave estable de esta aparición (para posponer o descartar). */
  id: string;
  kind: AgendaKind;
  title: string;
  detail: string;
  /** Por qué aparece: «Vence hoy», «Lo prometiste», «Persona cercana». */
  why: string[];
  score: number;
  action: AgendaAction;
  person?: Person;
  entry?: Entry;
  update?: PersonUpdate;
  episode?: Episode;
};

export type AgendaPrefs = { kinds: Record<AgendaKind, boolean>; max: number };
export const defaultAgendaPrefs: AgendaPrefs = {
  kinds: {
    compromiso: true,
    espera: true,
    seguimiento: true,
    encuentro: true,
    cierre: true,
    cumple: true,
    proyecto: true,
    episodio: true,
    contacto: true,
  },
  max: 6,
};

const day = (iso: string) => todayInputValue(new Date(iso));
const first = (p?: Person | null) => p?.name.split(' ')[0] ?? '';

/** «tu hermana», «tu jefe» o el nombre, según el vínculo que tengas con ella. */
function howYouCall(p: Person, ws: Workspace) {
  const v = tiesOf(ME, ws.ties).find((x) => x.other === p.id);
  if (!v || !['familia', 'pareja'].includes(tieKinds[v.kind].category)) return first(p);
  const g = genderOf(p);
  // Sin saber el sexo, mejor el nombre solo que «tu padre/madre».
  if (!g && tieKinds[v.kind].m !== tieKinds[v.kind].f) return first(p);
  return `tu ${kinCall(v.kind, g)} ${first(p)}`;
}

/** Puntos por cercanía de fecha: lo vencido y lo de hoy primero; más allá de una semana, nada. */
function urgency(d: number) {
  if (d < 0) return 100 + Math.min(-d, 10) * 2;
  if (d === 0) return 90;
  if (d === 1) return 70;
  if (d <= 3) return 50;
  if (d <= 7) return 25;
  return 0;
}
const whenWord = (d: number) =>
  d < 0
    ? `Venció hace ${-d} ${d === -1 ? 'día' : 'días'}`
    : d === 0
      ? 'Vence hoy'
      : d === 1
        ? 'Vence mañana'
        : `Vence en ${d} días`;

/**
 * Lo que merece tu atención hoy: una selección pequeña, explicable y configurable. La prioridad
 * combina la fecha, la importancia que elegiste y el contexto (si es una promesa, si la persona
 * es cercana). No premia tener muchos registros. `skip` son descartes y aplazamientos.
 */
export function agendaFor(
  ws: Workspace,
  prefs: AgendaPrefs = defaultAgendaPrefs,
  skip: ReadonlySet<string> = new Set(),
  today = todayInputValue(),
): AgendaItem[] {
  const out: AgendaItem[] = [];
  const byId = new Map(ws.people.map((p) => [p.id, p]));
  const closeBonus = (p?: Person | null) =>
    !p ? 0 : (closenessOf(p) >= 4 ? 8 : 0) + (p.profile.favorite ? 5 : 0);

  // ── Compromisos y esperas ──
  for (const e of ws.entries) {
    if (!isOpenTask(e)) continue;
    if (e.details.snoozed && e.details.snoozed > today) continue;
    const k = commitmentOf(e);
    const who = counterpartOf(e, ws.people);
    const due = e.details.due;
    const d = due ? daysBetween(today, due) : null;
    const prio = e.details.priority === 'alta' ? 20 : e.details.priority === 'baja' ? -10 : 0;
    const name = who ? howYouCall(who, ws) : '';
    if (k === 'espero' || k === 'depende') {
      const waited = ageInDays(e, today);
      if (d !== null && d <= 1) {
        out.push({
          id: 'c|' + e.id,
          kind: 'espera',
          title:
            d < 0
              ? `${who ? first(who) : 'Alguien'} debía responder hace ${-d} ${d === -1 ? 'día' : 'días'}`
              : `${who ? first(who) : 'Alguien'} debería responder ${d === 0 ? 'hoy' : 'mañana'}`,
          detail: e.title,
          why: [commitmentKinds[k].label, whenWord(d)],
          score: urgency(d) - 5 + prio + closeBonus(who),
          action: 'completar',
          person: who ?? undefined,
          entry: e,
        });
      } else if (d === null && waited >= 5) {
        out.push({
          id: 'c|' + e.id,
          kind: 'espera',
          title: `Llevas ${waited} días esperando${who ? ` a ${first(who)}` : ''}`,
          detail: e.title,
          why: [commitmentKinds[k].label, 'Sin fecha', `Desde hace ${waited} días`],
          score: Math.min(60, 20 + waited * 2) + prio + closeBonus(who),
          action: 'escribir',
          person: who ?? undefined,
          entry: e,
        });
      }
      continue;
    }
    if (d !== null && d <= 3) {
      const promise = k === 'prometi';
      out.push({
        id: 'c|' + e.id,
        kind: 'compromiso',
        title: promise
          ? d < 0
            ? `Venció lo que prometiste${name ? ` a ${name}` : ''}`
            : `${d === 0 ? 'Hoy vence' : d === 1 ? 'Mañana vence' : `En ${d} días vence`} lo que prometiste${name ? ` a ${name}` : ''}`
          : d < 0
            ? 'Se te pasó la fecha'
            : d === 0
              ? 'Para hoy'
              : d === 1
                ? 'Para mañana'
                : `En ${d} días`,
        detail: e.title,
        why: [
          whenWord(d),
          ...(promise ? ['Lo prometiste'] : []),
          ...(e.details.priority === 'alta' ? ['Prioridad alta'] : []),
        ],
        score: urgency(d) + prio + (promise ? 15 : 0) + closeBonus(who),
        action: 'completar',
        person: who ?? undefined,
        entry: e,
      });
    } else if (d === null && k === 'prometi' && ageInDays(e, today) >= 7) {
      const age = ageInDays(e, today);
      out.push({
        id: 'c|' + e.id,
        kind: 'compromiso',
        title: `Hace ${age} días prometiste algo${name ? ` a ${name}` : ''}`,
        detail: e.title,
        why: ['Lo prometiste', 'Sin fecha'],
        score: 35 + prio + closeBonus(who),
        action: 'completar',
        person: who ?? undefined,
        entry: e,
      });
    }
  }

  // ── Seguimientos de novedades ──
  for (const p of ws.people) {
    for (const u of p.profile.updates ?? []) {
      if (!u.followUp || u.done) continue;
      const d = daysBetween(today, u.followUp);
      if (d > 1) continue;
      out.push({
        id: 'u|' + u.id,
        kind: 'seguimiento',
        title: `Hay una novedad de ${howYouCall(p, ws)} cuyo seguimiento llega ${d < 0 ? 'tarde' : d === 0 ? 'hoy' : 'mañana'}`,
        detail: u.text,
        why: [
          d < 0 ? `Atrasado ${-d} ${d === -1 ? 'día' : 'días'}` : d === 0 ? 'Hoy' : 'Mañana',
          'Querías preguntarle',
        ],
        score: urgency(d) - 10 + closeBonus(p),
        action: 'preguntado',
        person: p,
        update: u,
      });
    }
  }

  // ── Encuentros: los próximos (prepararlos) y los recién pasados (cerrarlos) ──
  for (const e of ws.entries) {
    if (e.kind !== 'Encuentro') continue;
    const d = daysBetween(today, day(e.created_at));
    const who = e.person_ids.map((id) => byId.get(id)).filter((p): p is Person => Boolean(p));
    if (!who.length) continue;
    const names = who.map(first).join(', ');
    if (d >= 0 && d <= 2) {
      // Temas abiertos con esa persona: compromisos, preguntas y seguimientos.
      const open = who.reduce(
        (n, p) =>
          n +
          ws.entries.filter(
            (x) =>
              isOpenTask(x) &&
              (x.person_ids.includes(p.id) ||
                x.details.owner === p.id ||
                x.details.beneficiary === p.id),
          ).length +
          (p.profile.askNext?.length ?? 0) +
          (p.profile.updates ?? []).filter((u) => u.followUp && !u.done).length,
        0,
      );
      out.push({
        id: 'm|' + e.id,
        kind: 'encuentro',
        title: `${d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : 'Pasado mañana'} verás a ${names}`,
        detail: open
          ? `${open} ${open === 1 ? 'tema quedó abierto' : 'temas quedaron abiertos'}: revísalos antes`
          : e.title,
        why: [
          d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : 'En 2 días',
          ...(open ? [`${open} pendientes`] : []),
        ],
        score: 75 - d * 10 + (open ? 10 : 0) + closeBonus(who[0]),
        action: 'preparar',
        person: who[0],
        entry: e,
      });
    } else if (d < 0 && d >= -1 && e.recorded_at && day(e.recorded_at) < day(e.created_at)) {
      // Lo habías agendado antes de que pasara: toca el cierre de 30 segundos.
      out.push({
        id: 'x|' + e.id,
        kind: 'cierre',
        title: `¿Cómo te fue con ${names}?`,
        detail: 'Cierra en 30 segundos: qué cambió, si quedó una promesa y cuándo retomar.',
        why: ['Ayer', 'Estaba agendado'],
        score: 55 + closeBonus(who[0]),
        action: 'cerrar',
        person: who[0],
        entry: e,
      });
    }
  }

  // ── Cumpleaños ──
  for (const p of ws.people) {
    const d = daysToBirthday(p, today);
    if (d === null) continue;
    const close = closenessOf(p) >= 4 || p.profile.favorite;
    if (d > (close ? 3 : 1)) continue;
    out.push({
      id: `b|${p.id}|${today.slice(0, 4)}`,
      kind: 'cumple',
      title:
        d === 0
          ? `Hoy cumple años ${howYouCall(p, ws)}`
          : d === 1
            ? `Mañana cumple años ${howYouCall(p, ws)}`
            : `${first(p)} cumple años en ${d} días`,
      detail: p.profile.gifts?.length
        ? `Ideas de regalo: ${p.profile.gifts.slice(0, 3).join(', ')}`
        : 'Escríbele o llámale',
      why: [
        d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `En ${d} días`,
        ...(close ? ['Persona cercana'] : []),
      ],
      score: (d === 0 ? 95 : d === 1 ? 65 : 40) + closeBonus(p),
      action: 'escribir',
      person: p,
    });
  }

  // ── Proyectos activos sin próximo paso ──
  for (const e of ws.entries) {
    if (e.kind !== 'Trabajo' || !['curso', 'idea'].includes(e.details.stage ?? 'curso')) continue;
    const due = e.details.due ? daysBetween(today, e.details.due) : null;
    if (due !== null && due <= 3) {
      out.push({
        id: 'p|' + e.id + '|due',
        kind: 'proyecto',
        title: `«${e.title}» ${due < 0 ? 'ya pasó su fecha' : due === 0 ? 'vence hoy' : `vence en ${due} días`}`,
        detail: e.details.nextStep
          ? `Próximo paso: ${e.details.nextStep}`
          : 'Sin próximo paso definido',
        why: [whenWord(due), ...(e.details.priority === 'alta' ? ['Prioridad alta'] : [])],
        score: urgency(due) + (e.details.priority === 'alta' ? 15 : 0),
        action: 'paso',
        entry: e,
      });
    } else if (!e.details.nextStep && e.details.stage !== 'idea') {
      out.push({
        id: 'p|' + e.id,
        kind: 'proyecto',
        title: 'Este proyecto sigue activo, pero no tiene próximo paso',
        detail: e.title,
        why: [
          'En curso',
          'Sin próximo paso',
          ...(e.details.priority === 'alta' ? ['Prioridad alta'] : []),
        ],
        score: 30 + (e.details.priority === 'alta' ? 15 : e.details.priority === 'baja' ? -10 : 0),
        action: 'paso',
        entry: e,
      });
    }
  }

  // ── Episodios que terminaron y siguen abiertos ──
  for (const ep of ws.episodes) {
    if (ep.status !== 'activo' || !ep.ends_on) continue;
    const d = daysBetween(ep.ends_on, today);
    if (d < 1) continue;
    out.push({
      id: 'e|' + ep.id,
      kind: 'episodio',
      title: `«${ep.title}» terminó hace ${d} ${d === 1 ? 'día' : 'días'}`,
      detail: 'Anota cómo salió y ciérralo: quedará como capítulo completo.',
      why: ['Terminó', 'Sigue activo'],
      score: 28,
      action: 'abrir',
      episode: ep,
    });
  }

  // ── Personas a las que escribir (solo cercanas, como mucho dos) ──
  const contacts = ws.people
    .filter((p) => closenessOf(p) >= 3 && (p.profile.cadence ?? 0) > 0)
    .map((p) => ({ p, s: statsFor(p, ws.entries, today) }))
    .filter((x) => x.s.overdue)
    .sort((a, b) => (b.s.daysSince ?? 1e4) - (a.s.daysSince ?? 1e4))
    .slice(0, 2);
  for (const { p, s } of contacts) {
    out.push({
      id: `k|${p.id}|${today.slice(0, 7)}`,
      kind: 'contacto',
      title: `Hace ${s.daysSince ?? 'mucho'} días que no hablas con ${howYouCall(p, ws)}`,
      detail: `Querías hablar cada ${p.profile.cadence} días.`,
      why: ['Meta de contacto', ...(closenessOf(p) >= 4 ? ['Persona cercana'] : [])],
      score: 22 + closeBonus(p),
      action: 'escribir',
      person: p,
    });
  }

  const snoozed = (id: string) =>
    [...skip].some((k) => k.startsWith('snz|' + id + '|') && k.slice(-10) > today);
  return out
    .filter((i) => prefs.kinds[i.kind] && !skip.has('ag|' + i.id) && !snoozed(i.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, prefs.max);
}

/** Clave para posponer una tarjeta hasta una fecha. */
export const snoozeKey = (id: string, until: string) => `snz|${id}|${until}`;
export const discardKey = (id: string) => 'ag|' + id;
export const tomorrow = () => addDays(todayInputValue(), 1);
