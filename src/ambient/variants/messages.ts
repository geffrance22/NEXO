import { kindMeta } from '../../composer/kinds';
import { isReady, isSealed, daysUntil } from '../../diary/capsule';
import { kindLabel } from '../../lib/entries';
import { addDays, friendlyDate } from '../../lib/format';
import { daysToBirthday, relativeDay } from '../../lib/people';
import { hashOf, plural } from '../scene';
import { titleOf, type Signals } from '../signals';

/**
 * Los mensajes del lenguaje circular: cada uno nace de un dato concreto de Nexo y se describe con
 * los conceptos que la gramática sabe dibujar (cuándo, de qué trata, cuánto, con cuántas personas
 * y, solo si lo marcaste, el tono de tu ánimo). Nunca se inventa uno sin dato detrás.
 */

export type Tense = 'pasado' | 'presente' | 'futuro';
export type Domain =
  | 'animo'
  | 'episodio'
  | 'persona'
  | 'lectura'
  | 'asuntos'
  | 'ritmo'
  | 'memoria'
  | 'capsula'
  | 'calma';
export type Target = {
  kind: 'entry' | 'episode' | 'person' | 'agenda';
  id?: string;
  label: string;
};

export type Message = {
  id: string;
  tense: Tense;
  domain: Domain;
  /** Magnitud: recuerdos, días, asuntos… (se dibuja como número de trazos). */
  count: number;
  people: number;
  /** Tono 1–5 del ánimo marcado (solo mensajes de ánimo). */
  tone?: number;
  color?: string;
  /** Si habla de ti (punto central). */
  self: boolean;
  phrase: string;
  context: string;
  target?: Target;
};

const isMemory = (kind: string) => kind !== 'Movimiento' && kind !== 'Pendiente';
const dayOf = (iso: string) => {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
const AGO = ['Hoy', 'Ayer', 'Anteayer'];

export function buildMessages(s: Signals): Message[] {
  const out: Message[] = [];
  const { ws, today } = s;

  // Ánimo marcado.
  if (s.mood) {
    const m = s.mood;
    const label = m.mood.label.toLowerCase();
    out.push({
      id: 'animo:' + m.entry.id,
      tense: m.ago === 0 ? 'presente' : 'pasado',
      domain: 'animo',
      count: s.week.filter((d) => d.mark).length,
      people: m.entry.person_ids.length,
      tone: m.mood.tone,
      color: m.mood.color,
      self: true,
      phrase: `${AGO[m.ago] ?? friendlyDate(m.day, today)} te sentiste ${label}.`,
      context: `Del ánimo que marcaste en «${titleOf(m.entry)}».`,
      target: { kind: 'entry', id: m.entry.id, label: 'Ver la entrada' },
    });
  }

  // Episodios en curso (los dos más recientes).
  for (const b of s.bodies.filter((x) => x.type === 'episode').slice(0, 2))
    out.push({
      id: 'episodio:' + b.ref,
      tense: 'presente',
      domain: 'episodio',
      count: Math.max(0, b.weight - 1),
      people: b.people,
      self: false,
      phrase: `«${b.title}» sigue en curso${b.people ? `, con ${plural(b.people, 'persona', 'personas')}` : ''}.`,
      context: `Episodio activo; su último movimiento fue ${relativeDay(addDays(today, -b.ago), today).toLowerCase()}.`,
      target: { kind: 'episode', id: b.ref, label: 'Abrir episodio' },
    });

  // Quien más aparece en tus recuerdos recientes.
  const near = s.bodies.find((x) => x.type === 'person');
  if (near)
    out.push({
      id: 'persona:' + near.ref,
      tense: near.ago <= 7 ? 'presente' : 'pasado',
      domain: 'persona',
      count: near.weight,
      people: 1,
      self: false,
      phrase: `${near.title} ha estado en ${plural(near.weight, 'recuerdo tuyo', 'recuerdos tuyos')} estos dos meses.`,
      context: 'De las personas vinculadas a tus recuerdos de los últimos 60 días.',
      target: { kind: 'person', id: near.ref, label: 'Ver su ficha' },
    });

  // El cumpleaños más cercano (próximas tres semanas).
  const bday = ws.people
    .map((p) => ({ p, d: daysToBirthday(p, today) }))
    .filter((x): x is { p: (typeof ws.people)[number]; d: number } => x.d !== null && x.d <= 21)
    .sort((a, b) => a.d - b.d)[0];
  if (bday)
    out.push({
      id: 'cumple:' + bday.p.id,
      tense: bday.d === 0 ? 'presente' : 'futuro',
      domain: 'persona',
      count: 1,
      people: 1,
      self: false,
      phrase:
        bday.d === 0
          ? `Hoy es el cumpleaños de ${bday.p.name}.`
          : `En ${plural(bday.d, 'día', 'días')} es el cumpleaños de ${bday.p.name}.`,
      context: 'De la fecha de cumpleaños guardada en su ficha.',
      target: { kind: 'person', id: bday.p.id, label: 'Ver su ficha' },
    });

  // Cápsulas del tiempo.
  const sealed = s.capsules
    .filter((e) => isSealed(e, today))
    .sort((a, b) => a.details.capsule!.opensOn.localeCompare(b.details.capsule!.opensOn));
  const ready = s.capsules.filter((e) => isReady(e, today));
  if (ready.length)
    out.push({
      id: 'capsula:lista',
      tense: 'presente',
      domain: 'capsula',
      count: ready.length,
      people: 0,
      self: true,
      phrase:
        ready.length === 1
          ? 'Una cápsula del tiempo ya se puede abrir.'
          : `${ready.length} cápsulas del tiempo ya se pueden abrir.`,
      context: 'De tus cápsulas del tiempo cuya fecha ya llegó.',
    });
  else if (sealed.length) {
    const n = daysUntil(sealed[0].details.capsule!.opensOn, today);
    out.push({
      id: 'capsula:' + sealed[0].id,
      tense: 'futuro',
      domain: 'capsula',
      count: sealed.length,
      people: 0,
      self: true,
      phrase:
        sealed.length === 1
          ? `Tu cápsula del tiempo se abrirá en ${plural(n, 'día', 'días')}.`
          : `Guardas ${sealed.length} cápsulas selladas; la próxima se abre en ${plural(n, 'día', 'días')}.`,
      context: 'De tus cápsulas del tiempo selladas (su contenido sigue oculto).',
    });
  }

  // En esta fecha, otro año.
  const md = today.slice(5);
  const year = Number(today.slice(0, 4));
  const past = ws.entries
    .filter((e) => isMemory(e.kind) && !e.details.vault && e.title.trim())
    .map((e) => ({ e, d: dayOf(e.created_at) }))
    .filter((x) => x.d.slice(5) === md && Number(x.d.slice(0, 4)) < year)
    .sort((a, b) => b.d.localeCompare(a.d))[0];
  if (past) {
    const years = year - Number(past.d.slice(0, 4));
    out.push({
      id: 'memoria:' + past.e.id,
      tense: 'pasado',
      domain: 'memoria',
      count: years,
      people: past.e.person_ids.length,
      self: false,
      phrase: `Hace ${plural(years, 'año', 'años')}, un día como hoy: «${titleOf(past.e)}».`,
      context: `${kindLabel(past.e) === 'Serie' ? 'Serie' : kindMeta[past.e.kind].label} del ${past.d.split('-').reverse().join('/')}.`,
      target: { kind: 'entry', id: past.e.id, label: 'Ver el recuerdo' },
    });
  }

  // Lo que estás leyendo y lo que está listo para repasar.
  const reading = ws.entries
    .filter((e) => e.kind === 'Libro' && (e.details.read ?? 'leyendo') === 'leyendo')
    .map((e) => ({
      e,
      last: e.details.pageLog?.[e.details.pageLog.length - 1]?.d ?? dayOf(e.created_at),
    }))
    .sort((a, b) => b.last.localeCompare(a.last))[0];
  if (reading) {
    const { pagesRead: at, pagesTotal: total } = reading.e.details;
    const pct = at && total ? Math.round((at / total) * 100) : 0;
    out.push({
      id: 'lectura:' + reading.e.id,
      tense: 'presente',
      domain: 'lectura',
      count: Math.max(1, Math.round(pct / 20)),
      people: 0,
      self: true,
      phrase: at
        ? `Vas en la página ${at} de «${titleOf(reading.e)}».`
        : `Estás leyendo «${titleOf(reading.e)}».`,
      context: pct ? `De tu Libroteca: llevas el ${pct} %.` : 'De tu Libroteca.',
      target: { kind: 'entry', id: reading.e.id, label: 'Ver el libro' },
    });
  }
  const due = ws.entries.filter(
    (e) =>
      e.kind === 'Aprendizaje' &&
      e.details.review &&
      e.details.review.step >= 0 &&
      e.details.review.due &&
      e.details.review.due <= today,
  ).length;
  if (due)
    out.push({
      id: 'repaso',
      tense: 'presente',
      domain: 'lectura',
      count: due,
      people: 0,
      self: true,
      phrase:
        due === 1
          ? 'Un aprendizaje está listo para repasar.'
          : `${due} aprendizajes están listos para repasar.`,
      context: 'Del repaso espaciado de tus aprendizajes.',
    });

  // Asuntos abiertos (sin hablar de retrasos).
  for (const g of s.open.groups) {
    if (g.key === 'episodios') continue;
    const n = g.items.length;
    const people = new Set(g.items.flatMap((x) => x.entry?.person_ids ?? [])).size;
    const phrase =
      g.key === 'prometi'
        ? `Tienes ${plural(n, 'promesa abierta', 'promesas abiertas')}.`
        : g.key === 'espero' || g.key === 'depende'
          ? `${n === 1 ? 'Un asunto tuyo está' : `${n} asuntos tuyos están`} en manos de otras personas.`
          : `${n === 1 ? 'Hay una cosa que quieres hacer' : `Hay ${n} cosas que quieres hacer`}, abiertas.`;
    out.push({
      id: 'asuntos:' + g.key,
      tense: 'presente',
      domain: 'asuntos',
      count: n,
      people,
      self: true,
      phrase,
      context: `De tus pendientes: ${g.label.toLowerCase()}.`,
      target:
        n === 1 && g.items[0].entry
          ? { kind: 'entry', id: g.items[0].id, label: 'Ver el pendiente' }
          : { kind: 'agenda', label: 'Ver en Agenda' },
    });
  }

  // Tu ritmo.
  const r = s.rhythm;
  if (ws.entries.length)
    out.push({
      id: 'ritmo',
      tense: 'presente',
      domain: 'ritmo',
      count: r.activeDays,
      people: 0,
      self: true,
      phrase: r.week
        ? `Esta semana registraste ${plural(r.week, 'momento', 'momentos')} en ${plural(r.activeDays, 'día', 'días')}.`
        : 'Esta semana Nexo ha estado en silencio.',
      context:
        r.trend === 'más'
          ? 'De tus registros de los últimos 7 días, algo más que tu semana habitual.'
          : r.trend === 'menos'
            ? 'De tus registros de los últimos 7 días, algo menos que tu semana habitual.'
            : 'De tus registros de los últimos 7 días.',
    });

  if (!out.length)
    out.push({
      id: 'calma',
      tense: 'presente',
      domain: 'calma',
      count: 0,
      people: 0,
      self: false,
      phrase: 'Todo está en calma por ahora.',
      context: 'Aún no hay datos recientes de los que nazca otro mensaje.',
    });

  // Un orden distinto cada día, pero estable durante el día.
  return out.sort((a, b) => hashOf(a.id + today) - hashOf(b.id + today));
}
