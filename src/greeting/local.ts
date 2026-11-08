import type { Greeting, GreetingKind, LocalFacts, Part } from './greeting';

/**
 * Saludo sin IA: sale al instante mientras llega el de la IA, y es el que se queda si la función
 * no está disponible. Usa la hora, tu nombre y lo que Nexo ya sabe de tu día.
 */

const pick = <T>(items: readonly T[], n: number): T => items[n % items.length];
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** El saludo según la hora, con tu nombre si lo hay (varias formas para no repetirse). */
export function salutation(part: Part, name: string | null, n: number) {
  const who = name ? `, ${name}` : '';
  const options: Record<Part, string[]> = {
    mañana: [`Buenos días${who}.`, `Buen día${who}.`, `Arranca la mañana${who}.`],
    tarde: [`Buenas tardes${who}.`, `Buenas${who}, ¿cómo va la tarde?`, `Qué tal esa tarde${who}.`],
    noche: [`Buenas noches${who}.`, `Cerrando el día${who}.`, `Última curva del día${who}.`],
    madrugada: [`Qué madrugada${who}.`, `Buenas${who}, a esta hora.`, `Sigues en pie${who}.`],
  };
  return pick(options[part], n);
}

type Generic = { kind: GreetingKind; text: string; action?: string };
const generic: Record<Part, Generic[]> = {
  mañana: [
    {
      kind: 'plan',
      text: 'Elige una sola cosa importante para hoy y empieza por ella; lo demás se va acomodando.',
    },
    {
      kind: 'tip',
      text: 'Antes de abrir el celular, un vaso de agua y cinco minutos para ti. Después, el mundo.',
    },
    {
      kind: 'consejo',
      text: 'Un buen día se arma con un primer paso pequeño. ¿Cuál es el de hoy?',
    },
  ],
  tarde: [
    {
      kind: 'tip',
      text: 'Mitad del día: estírate, toma agua y decide qué sí alcanza hoy y qué puede esperar.',
    },
    {
      kind: 'plan',
      text: 'Si lo difícil sigue pendiente, regálale diez minutos ahora; lo demás se hace liviano.',
    },
    {
      kind: 'consejo',
      text: 'La tarde es buena para cerrar cabos sueltos: un mensaje, una llamada, un pendiente.',
    },
  ],
  noche: [
    {
      kind: 'plan',
      text: 'Cierra el día con una línea: ¿qué fue lo mejor de hoy? Nexo lo guarda por ti.',
      action: 'Anotar lo mejor de hoy',
    },
    {
      kind: 'consejo',
      text: 'Deja lista una sola cosa para mañana y suelta el resto; se descansa mejor así.',
    },
    {
      kind: 'tip',
      text: 'Pantallas abajo y luz baja un rato antes de dormir: el sueño de esta noche es el rendimiento de mañana.',
    },
  ],
  madrugada: [
    {
      kind: 'consejo',
      text: 'Si no es por gusto, lo mejor es dormir: todo se ve distinto con luz.',
    },
    {
      kind: 'humor',
      text: 'A esta hora las ideas parecen geniales y los problemas enormes. Anótalas y decide mañana.',
      action: 'Anotarlo',
    },
  ],
};

export function localGreeting({
  part,
  name,
  facts,
  seed,
}: {
  part: Part;
  name: string | null;
  facts: LocalFacts;
  /** Número entre 0 y 1 fijo durante la visita: elige siempre la misma variante. */
  seed: number;
}): Greeting {
  const n = Math.floor(seed * 1000);
  const title = salutation(part, name, n);

  if (facts.myBirthday) {
    return {
      kind: 'cumple',
      title: `Feliz cumpleaños${name ? `, ${name}` : ''}.`,
      text: 'Hoy el día es tuyo: deja que te celebren y date un gusto que no sea negociable.',
      actions: [],
    };
  }
  if (facts.birthday) {
    return {
      kind: 'cumple',
      title,
      text: `Hoy cumple años ${facts.birthday.name}. Un mensaje a tiempo vale más que uno perfecto.`,
      actions: [
        { id: 'person:' + facts.birthday.id, label: `Escribirle a ${facts.birthday.name}` },
      ],
    };
  }

  const options: Greeting[] = [];
  if (facts.urgent) {
    options.push({
      kind: 'recordatorio',
      title,
      text: `Ojo con esto. ${facts.urgent.text}.`,
      actions: facts.urgent.entryId
        ? [{ id: 'entry:' + facts.urgent.entryId, label: 'Abrirlo' }]
        : [],
    });
  }
  if (facts.book) {
    options.push({
      kind: 'libro',
      title,
      text: `«${facts.book.title}» te espera${facts.book.where ? ` (${facts.book.where})` : ''}. Unas páginas hoy ya cuentan.`,
      actions: [{ id: 'progress:' + facts.book.id, label: 'Actualizar mi lectura' }],
    });
  }
  if (facts.series) {
    options.push({
      kind: 'serie',
      title,
      text: `¿Hoy toca un capítulo de «${facts.series.title}»?${facts.series.where ? ` ${capitalize(facts.series.where)}.` : ''}`,
      actions: [{ id: 'progress:' + facts.series.id, label: 'Marcar mi avance' }],
    });
  }
  const base = pick(generic[part], n);
  options.push({
    kind: base.kind,
    title,
    text: base.text,
    actions: base.action ? [{ id: 'capture', label: base.action }] : [],
  });
  return pick(options, n >> 2);
}
