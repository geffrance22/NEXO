import type { Entry, Episode, Person, Workspace } from '../data';
import { isOpenTask } from '../lib/commitments';
import { friendlyDate, normalizeText } from '../lib/format';
import { whoMightCare, wordsOf } from '../lib/interest';
import type { ReviewCard } from './cards';
import { quoteKey } from './quotes';

/**
 * Conexiones de una idea con el resto de tu mundo en Nexo: tus proyectos, pendientes, episodios,
 * notas, otras citas y las personas a las que les puede servir. Todo se calcula aquí, sin IA y sin
 * enviar nada: se cruzan las palabras y se explica con cuáles coincidió.
 */

export type LinkType = 'proyecto' | 'tarea' | 'episodio' | 'persona' | 'nota' | 'cita';

export type Link = {
  type: LinkType;
  id: string;
  title: string;
  /** Una línea que explica de qué se trata: «En curso · Próximo paso: …», «Le interesa: viajes». */
  detail: string;
  /** Palabras que tienen en común. */
  words: string[];
  /** Coincide en varias palabras o en una muy poco común: vale la pena mostrarla. */
  strong: boolean;
  score: number;
  entry?: Entry;
  episode?: Episode;
  person?: Person;
};

type Doc = {
  link: Pick<Link, 'type' | 'id' | 'title' | 'detail' | 'entry' | 'episode'>;
  /** Raíz de cada palabra → la palabra tal como aparece. */
  stems: Map<string, string>;
  /** Qué tanto pesa este tipo de cosa (un proyecto vale más que una nota suelta). */
  weight: number;
};
export type Corpus = { docs: Doc[]; df: Map<string, number> };

const clip = (s: string | undefined, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

// Terminaciones frecuentes del español, de la más larga a la más corta.
const ENDINGS = (
  'amientos imientos amiento imiento aciones uciones adores adoras mente ando iendo acion ucion ' +
  'ador adora ables ibles able ible ismos ismo istas ista ados adas idos idas ado ada ido ida ' +
  'eros eras ero era ivos ivas ivo iva ares eres ores es as os ar er ir s a o e'
)
  .split(' ')
  .sort((a, b) => b.length - a.length);

/** Raíz aproximada de una palabra (sin tildes): «viajar», «viajes» y «viajero» comparten «viaj». */
export function root(word: string) {
  let r = word;
  for (const end of ENDINGS) {
    if (r.length - end.length >= 4 && r.endsWith(end)) {
      r = r.slice(0, -end.length);
      break;
    }
  }
  return r.slice(0, 7);
}

const tokens = (text: string) => {
  const out = new Map<string, string>();
  for (const w of wordsOf(text)) {
    const s = root(w);
    if (!out.has(s)) out.set(s, w);
  }
  return out;
};

/** Con menos cosas tuyas que estas, una sola palabra en común no basta para hablar de conexión. */
const ENOUGH_DOCS = 15;

export function buildCorpus(ws: Workspace): Corpus {
  const docs: Doc[] = [];
  const add = (link: Doc['link'], text: string, weight: number) => {
    const stems = tokens(text);
    if (stems.size >= 2) docs.push({ link, stems, weight });
  };

  const notes: Entry[] = [];
  for (const e of ws.entries) {
    if (e.kind === 'Trabajo') {
      const stage = e.details.stage ?? 'curso';
      if (stage !== 'idea' && stage !== 'curso') continue;
      const next = e.details.nextStep;
      const label = stage === 'idea' ? 'Idea' : 'En curso';
      add(
        {
          type: 'proyecto',
          id: e.id,
          title: e.title,
          detail: next ? `${label} · Próximo paso: ${clip(next, 80)}` : label,
          entry: e,
        },
        [e.title, e.body, next, e.tags.join(' ')].join(' '),
        1.25,
      );
    } else if (isOpenTask(e)) {
      const due = e.details.due;
      add(
        {
          type: 'tarea',
          id: e.id,
          title: e.title,
          detail: due ? `Pendiente · ${friendlyDate(due).toLowerCase()}` : 'Pendiente',
          entry: e,
        },
        `${e.title} ${e.body}`,
        1,
      );
    } else if (e.kind === 'Nota' || e.kind === 'Aprendizaje') {
      notes.push(e);
    } else if (e.kind === 'Libro') {
      for (const raw of e.details.quotes ?? []) {
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (!text) continue;
        add(
          {
            type: 'cita',
            id: e.id + ':' + quoteKey(text),
            title: clip(text, 120),
            detail: e.title + (e.details.author ? ` · ${e.details.author}` : ''),
            entry: e,
          },
          text,
          0.85,
        );
      }
    }
  }
  // Las notas más recientes: miles de notas viejas solo meterían ruido.
  notes
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 250)
    .forEach((e) =>
      add(
        {
          type: 'nota',
          id: e.id,
          title: e.title,
          detail: e.kind === 'Aprendizaje' ? 'Algo que aprendiste' : 'Una nota tuya',
          entry: e,
        },
        [e.title, clip(e.body, 500), e.tags.join(' ')].join(' '),
        0.9,
      ),
    );
  for (const ep of ws.episodes) {
    if (ep.status !== 'activo') continue;
    add(
      {
        type: 'episodio',
        id: ep.id,
        title: ep.title,
        detail: ep.summary ? clip(ep.summary, 90) : 'Episodio en curso',
        episode: ep,
      },
      [ep.title, ep.summary].join(' '),
      1.1,
    );
  }

  const df = new Map<string, number>();
  for (const d of docs) for (const s of d.stems.keys()) df.set(s, (df.get(s) ?? 0) + 1);
  return { docs, df };
}

/** Lo que se cruza: el texto de la idea y de dónde viene. */
export type Probe = { text: string; context: string; bookId?: string; quoteId?: string };

export function probeOf(card: ReviewCard): Probe {
  return card.source === 'cita'
    ? {
        text: card.quote,
        context: card.from.title,
        bookId: card.book.id,
        quoteId: card.book.id + ':' + card.key,
      }
    : { text: card.quote, context: card.from.title };
}

/**
 * Hasta dos conexiones: la mejor y, si la hay, la mejor de otra clase (un proyecto y una persona
 * dicen más que dos proyectos). Vacío si nada coincide de verdad.
 */
export function findLinks(probe: Probe, corpus: Corpus, people: Person[]): Link[] {
  const own = tokens(`${probe.text} ${probe.context}`);
  if (own.size < 2) return [];
  // Las palabras tal como las escribiste (con tildes y eñes) para mostrar por qué conecta.
  const written = new Map<string, string>();
  for (const w of `${probe.text} ${probe.context}`.match(/\p{L}[\p{L}\p{N}]{3,}/gu) ?? []) {
    const s = root(normalizeText(w));
    if (!written.has(s)) written.set(s, w.toLowerCase());
  }

  // Ni la idea misma ni su libro: lo interesante es lo de afuera. Y como tampoco cuentan para saber
  // qué tan común es una palabra, se descuentan (si no, todo lo que dice la idea parecería vulgar).
  const outside = (l: Doc['link']) =>
    (probe.quoteId && l.id === probe.quoteId) || (probe.bookId && l.entry?.id === probe.bookId);
  const left = new Map<string, number>();
  let total = 0;
  for (const doc of corpus.docs) {
    if (outside(doc.link)) {
      for (const s of doc.stems.keys()) left.set(s, (left.get(s) ?? 0) + 1);
    } else total++;
  }
  const df = (s: string) => Math.max(1, (corpus.df.get(s) ?? 0) - (left.get(s) ?? 0));
  const idf = (s: string) => Math.log(1 + total / df(s));
  const found: Link[] = [];

  for (const doc of corpus.docs) {
    const l = doc.link;
    if (outside(l)) continue;
    const shared: string[] = [];
    let sum = 0;
    let rare = false;
    for (const s of doc.stems.keys()) {
      if (!own.has(s)) continue;
      shared.push(s);
      sum += idf(s);
      if (df(s) <= 2) rare = true;
    }
    const n = shared.length;
    if (!n) continue;
    // Varias palabras en común, o una sola pero poco común (un nombre, un tema propio).
    const solid = n >= (l.type === 'cita' ? 3 : 2) && sum >= 3;
    const single = rare && total >= ENOUGH_DOCS && l.type !== 'cita';
    if (!solid && !single) continue;
    // Casi el mismo texto no es una conexión: es la misma idea copiada.
    if (n >= 6 && n / Math.min(own.size, doc.stems.size) > 0.75) continue;
    found.push({
      ...l,
      words: shared.slice(0, 4).map((s) => written.get(s) ?? own.get(s) ?? s),
      strong: (n >= 3 && sum >= 6) || (n >= 2 && sum >= 7),
      score: sum * doc.weight,
    });
  }

  // Personas: solo con una coincidencia clara; las que ya no están o no tienes cerca no se sugieren.
  const reachable = people.filter((p) => !p.profile.status);
  for (const m of whoMightCare(probe.text, reachable, probe.context, 3)) {
    if (m.score < 4.5) continue;
    found.push({
      type: 'persona',
      id: m.person.id,
      title: m.person.name.split(' ').slice(0, 2).join(' '),
      detail: m.reason,
      words: m.words,
      strong: m.score >= 7,
      score: m.score,
      person: m.person,
    });
  }

  found.sort((a, b) => b.score - a.score);
  const first = found[0];
  if (!first) return [];
  const other = found.find((l) => l.type !== first.type);
  return other ? [first, other] : [first];
}

// ───────────────────────── Cuándo y cómo mostrarlas ─────────────────────────

/**
 * `recordar`: solo repasar. `conectar`: esta idea se cruza con algo tuyo. `construir`: sirve para un
 * proyecto. `idear`: ya la sabes, toca ponerla a trabajar.
 */
export type Mode = 'recordar' | 'conectar' | 'construir' | 'idear';
export type Plan = { mode: Mode; links: Link[] };

export const modeOf = (links: Link[]): Exclude<Mode, 'recordar'> =>
  links[0] ? (links[0].type === 'proyecto' ? 'construir' : 'conectar') : 'idear';

/**
 * Decide, para cada tarjeta de la sesión, si toca solo repasar o sacarle partido. Casi siempre es
 * repasar: el resto depende del momento. Más probable si la conexión es clara; mucho más si ya
 * dominas la idea (para entonces recordarla ya no es el reto, usarla sí); nunca dos seguidas y a lo
 * sumo dos de cada cinco.
 */
export function planSession(
  cards: ReviewCard[],
  ws: Workspace,
  random: () => number = Math.random,
): Plan[] {
  const corpus = buildCorpus(ws);
  const cap = Math.max(1, Math.ceil(cards.length * 0.4));
  let shown = 0;
  let last = -9;
  return cards.map((card, i): Plan => {
    const links = findLinks(probeOf(card), corpus, ws.people);
    const base = links[0] ? (links[0].strong ? 0.6 : 0.3) : 0;
    const learned = card.step >= 3;
    let p = learned ? (links[0] ? Math.min(0.9, base * 1.5) : 0.3) : base;
    if (i - last <= 1) p = 0;
    if (shown >= cap) p = 0;
    if (random() >= p) return { mode: 'recordar', links };
    shown++;
    last = i;
    return { mode: modeOf(links), links };
  });
}
