import type { Entry, RitualTopic } from '../data';
import { isSeries } from '../lib/entries';
import { randomBelow, sample } from '../lib/random';

/**
 * Banco de preguntas del ritual de cierre. Cada pregunta tiene un tema que decide qué parte del
 * aprendizaje alimenta: «llevar» es la idea clave, «cambio» lo que vas a aplicar y «recomendar»
 * a quién se lo pasarías. El resto da variedad (un momento, una emoción, una crítica, una
 * conexión con tu vida). `{obra}` se cambia por «este libro», «esta película» o «esta serie».
 */

export type Medium = 'libro' | 'pelicula' | 'serie';

export type Question = {
  id: string;
  topic: RitualTopic;
  text: string;
  /** Pista dentro del campo de respuesta. */
  hint: string;
  /** Solo para estos formatos (por defecto, todos). */
  only?: Medium[];
};

export const BANK: Question[] = [
  // ───── Lo que te llevas (la idea clave del aprendizaje) ─────
  {
    id: 'llevar-1',
    topic: 'llevar',
    text: '¿Qué te llevas de {obra}?',
    hint: 'La idea, frase o imagen que quieres conservar',
  },
  {
    id: 'llevar-2',
    topic: 'llevar',
    text: 'Si tuvieras que resumir {obra} en una sola idea, ¿cuál sería?',
    hint: 'Una frase, con tus palabras',
  },
  {
    id: 'llevar-3',
    topic: 'llevar',
    text: '¿Qué idea de {obra} quieres que siga contigo dentro de un año?',
    hint: 'Lo que no te gustaría olvidar',
  },
  {
    id: 'llevar-4',
    topic: 'llevar',
    text: '¿Qué entendiste gracias a {obra} que antes no veías?',
    hint: 'Algo que ahora ves distinto',
  },
  {
    id: 'llevar-5',
    topic: 'llevar',
    text: '¿Qué le enseñarías a alguien a partir de {obra}, en dos frases?',
    hint: 'Como si se lo explicaras a un amigo',
  },
  {
    id: 'llevar-6',
    topic: 'llevar',
    text: '¿Qué pregunta te dejó {obra} dando vueltas?',
    hint: 'Y, si la tienes, tu respuesta de hoy',
  },
  {
    id: 'llevar-7',
    topic: 'llevar',
    text: '¿Qué capítulo o idea del libro releerías primero, y por qué?',
    hint: 'Lo que más valor tuvo para ti',
    only: ['libro'],
  },
  {
    id: 'llevar-8',
    topic: 'llevar',
    text: '¿Qué dice {obra} sobre las personas o sobre la vida?',
    hint: 'El tema de fondo, más allá de la trama',
    only: ['pelicula', 'serie'],
  },

  // ───── Qué cambia en ti (lo que vas a aplicar) ─────
  {
    id: 'cambio-1',
    topic: 'cambio',
    text: '¿Qué cambia en ti después de {obra}?',
    hint: 'Una forma de pensar, de mirar o de actuar',
  },
  {
    id: 'cambio-2',
    topic: 'cambio',
    text: '¿Qué vas a hacer distinto esta semana por {obra}?',
    hint: 'Algo pequeño y concreto',
  },
  {
    id: 'cambio-3',
    topic: 'cambio',
    text: '¿Qué hábito, decisión o conversación te inspira {obra}?',
    hint: 'Lo que pondrías en marcha',
  },
  {
    id: 'cambio-4',
    topic: 'cambio',
    text: '¿Qué creencia tuya puso a prueba {obra}?',
    hint: 'Si la reforzó o la movió',
  },
  {
    id: 'cambio-5',
    topic: 'cambio',
    text: '¿Dónde de tu vida aplicarías lo que te dejó {obra}?',
    hint: 'Trabajo, familia, un proyecto, contigo…',
  },
  {
    id: 'cambio-6',
    topic: 'cambio',
    text: '¿Qué harías si fueras la persona protagonista de {obra}?',
    hint: 'Y qué dice eso de ti',
    only: ['pelicula', 'serie'],
  },
  {
    id: 'cambio-7',
    topic: 'cambio',
    text: '¿Qué consejo del libro vas a poner a prueba primero?',
    hint: 'Cómo y cuándo',
    only: ['libro'],
  },

  // ───── A quién se lo recomendarías ─────
  {
    id: 'recomendar-1',
    topic: 'recomendar',
    text: '¿A quién se lo recomendarías y por qué?',
    hint: 'Elige personas abajo y cuéntale el motivo',
  },
  {
    id: 'recomendar-2',
    topic: 'recomendar',
    text: '¿Quién de tu gente necesita {obra} ahora mismo?',
    hint: 'Y qué le dirías al recomendársela',
  },
  {
    id: 'recomendar-3',
    topic: 'recomendar',
    text: '¿Con quién te gustaría comentar {obra}?',
    hint: 'La conversación que te gustaría tener',
  },

  // ───── Variedad ─────
  {
    id: 'momento-1',
    topic: 'momento',
    text: '¿Qué escena o momento de {obra} se te quedó grabado?',
    hint: 'Descríbelo como lo recuerdas',
  },
  {
    id: 'momento-2',
    topic: 'momento',
    text: '¿Qué frase o diálogo de {obra} te gustaría recordar?',
    hint: 'Aunque no sea textual',
  },
  {
    id: 'emocion-1',
    topic: 'emocion',
    text: '¿Cómo te sentiste al terminar {obra}?',
    hint: 'Sin filtro',
  },
  {
    id: 'emocion-2',
    topic: 'emocion',
    text: '¿Qué personaje te movió más y qué te hizo sentir?',
    hint: 'Admiración, rabia, ternura…',
  },
  {
    id: 'critica-1',
    topic: 'critica',
    text: '¿En qué no estás de acuerdo con {obra}?',
    hint: 'Lo que discutirías con quien lo creó',
  },
  {
    id: 'critica-2',
    topic: 'critica',
    text: '¿Qué le sobró o le faltó a {obra}?',
    hint: 'Lo que cambiarías',
  },
  {
    id: 'conexion-1',
    topic: 'conexion',
    text: '¿Con qué momento de tu vida conecta {obra}?',
    hint: 'Algo que viviste o estás viviendo',
  },
  {
    id: 'conexion-2',
    topic: 'conexion',
    text: '¿Qué otro libro, película o idea te recordó {obra}?',
    hint: 'Y en qué se parecen',
  },
];

/** Etiqueta corta de cada tema (para la ficha y para el texto del aprendizaje). */
export const topicLabel: Record<RitualTopic, string> = {
  llevar: 'Lo que me llevo',
  cambio: 'Qué cambia en mí',
  recomendar: 'Se lo recomendaría a',
  momento: 'Un momento que me quedó',
  emocion: 'Cómo me dejó',
  critica: 'En lo que no estoy de acuerdo',
  conexion: 'Con qué conecta',
};

export const mediumOf = (e: Entry): Medium =>
  e.kind === 'Libro' ? 'libro' : isSeries(e) ? 'serie' : 'pelicula';

const work: Record<Medium, string> = {
  libro: 'este libro',
  pelicula: 'esta película',
  serie: 'esta serie',
};

/** El texto de la pregunta para esa obra. Si empieza por `{obra}` va con mayúscula. */
export function phrase(q: Question, medium: Medium) {
  return q.text.replace(/\{obra\}/g, (_, at: number) => {
    const w = work[medium];
    return at === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });
}

const fits = (q: Question, medium: Medium) => !q.only || q.only.includes(medium);

// ───── Variedad entre cierres: las vistas hace poco se dejan para después ─────
const RECENT_KEY = 'nexo-ritual-recent';
const RECENT_MAX = 14;

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Anota las preguntas que respondiste para no repetirlas en los próximos cierres. */
export function rememberAsked(ids: string[]) {
  try {
    const next = [...ids, ...readRecent().filter((id) => !ids.includes(id))].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Sin almacenamiento, solo se pierde la variedad entre sesiones.
  }
}

/** Una al azar del grupo, prefiriendo las que no salieron hace poco ni están en `avoid`. */
function pickOne(pool: Question[], avoid: string[]) {
  const recent = readRecent();
  const open = pool.filter((q) => !avoid.includes(q.id));
  const fresh = open.filter((q) => !recent.includes(q.id));
  const from = fresh.length ? fresh : open.length ? open : pool;
  return from[randomBelow(from.length)];
}

/** Los temas que no son ni la idea clave ni el cambio: el tercer hueco. */
const EXTRA: RitualTopic[] = ['recomendar', 'momento', 'emocion', 'critica', 'conexion'];

/**
 * Las preguntas de un cierre (1 a 3), siempre de temas distintos: la primera es la idea que te
 * llevas, la segunda lo que cambia en ti y la tercera, casi la mitad de las veces, a quién se lo
 * recomendarías; si no, algo distinto (un momento, una emoción, una crítica…).
 */
export function pickQuestions(medium: Medium, count: number, avoid: string[] = []): Question[] {
  const pool = BANK.filter((q) => fits(q, medium));
  const of = (topic: RitualTopic) => pool.filter((q) => q.topic === topic);
  const out: Question[] = [pickOne(of('llevar'), avoid)];
  if (count >= 2) out.push(pickOne(of('cambio'), avoid));
  if (count >= 3) {
    const topic =
      randomBelow(100) < 45
        ? 'recomendar'
        : sample(
            EXTRA.filter((t) => t !== 'recomendar'),
            1,
          )[0];
    out.push(pickOne(of(topic), avoid));
  }
  return out;
}

/** Otra pregunta del mismo tema (o de la variedad, si es la tercera) para cambiar una sola. */
export function swapQuestion(current: Question, medium: Medium, taken: Question[]): Question {
  const pool = BANK.filter((q) => fits(q, medium));
  const extra = EXTRA.includes(current.topic);
  // La tercera puede pasar a cualquier tema de variedad que no esté ya en el cierre.
  const used = new Set(taken.filter((q) => q.id !== current.id).map((q) => q.topic));
  const same = pool.filter((q) =>
    extra ? EXTRA.includes(q.topic) && !used.has(q.topic) : q.topic === current.topic,
  );
  return pickOne(
    same,
    taken.map((q) => q.id),
  );
}
