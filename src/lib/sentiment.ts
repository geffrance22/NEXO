import { normalizeText } from './format';

/**
 * Tono de un texto en español, sin IA: palabras positivas y negativas (por su raíz, sin tildes),
 * con negaciones («no fue bueno», «nada divertido»), intensificadores («muy», «súper») y emojis.
 * Sirve para saber si un encuentro, una nota o la razón de un pendiente suenan bien o mal.
 */

/** Raíces positivas: «disfrut» cubre disfruté, disfrutamos, disfrutando… */
const POSITIVE = [
  'genial', 'excelente', 'feliz', 'felices', 'alegr', 'encant', 'maravill', 'increibl', 'divert',
  'diverti', 'chever', 'bacan', 'delicios', 'bonit', 'lind', 'hermos', 'agradec', 'gracias',
  'abraz', 'reimos', 'nos reimos', 'risa', 'carcajad', 'disfrut', 'emocion', 'orgull', 'apoy',
  'ayudo', 'me ayudo', 'nos ayudo', 'tranquil', 'perfect', 'buenisim', 'brutal', 'espectacular',
  'fantastic', 'especial', 'carin', 'cercan', 'confianz', 'conect', 'complicidad', 'reconcili',
  'nos entendimos', 'me escucho', 'me entendio', 'comprensiv', 'celebr', 'felicit', 'regal',
  'sorpres', 'rico', 'rica', 'calidez', 'calido', 'calida', 'amable', 'dulce', 'generos', 'chimba',
  'linda tarde', 'buen rato', 'buena charla', 'gran dia', 'te quiero', 'la quiero', 'lo quiero',
  'los quiero', 'amor', 'amamos', 'adoro',
  'inspir', 'motiv', 'valio la pena', 'de lujo', 'lo maximo', 'la pasamos bien', 'pasamos rico',
];
/** Raíces negativas. */
const NEGATIVE = [
  'pelea', 'pelear', 'peleamos', 'pelee', 'peleo', 'discuti', 'discusion', 'enoj', 'rabia',
  'furios', 'trist', 'llor', 'decepcion', 'frustr', 'aburr', 'incomod', 'tension', 'tenso', 'tensa',
  'molest', 'grit', 'ignor', 'me cancelo', 'nos cancelo', 'cancelo el plan', 'me dejo plantad',
  'dejo plantad', 'menti', 'mintio', 'traicion', 'celos', 'dolor', 'dolio', 'preocup', 'estres',
  'horribl', 'terribl', 'pesim', 'fatal', 'odio', 'odia', 'distant', 'frialdad', 'groser', 'injust',
  'culpa', 'problema', 'ofendi', 'resentid', 'herid', 'lastim', 'desplant', 'desagrad', 'insoport',
  'fastidi', 'cansad de', 'no me escribio', 'no contesto', 'no responde', 'me ignoro', 'no vino',
  'no llego', 'se olvido', 'falto', 'quedo mal', 'quede mal', 'mal rato', 'mala onda',
  'mal ambiente', 'incumpli', 'abuso', 'se aprovecho', 'manipul', 'chism', 'critic', 'humill',
  'regano', 'distanci', 'alejad', 'se alejo', 'nos alejamos', 'roce', 'reclam', 'desconfi',
];
/** Palabras sueltas (deben coincidir completas para no confundir: «mal» no es «malta»). */
const POS_WORDS = new Set(['bien', 'bueno', 'buena', 'buenos', 'buenas', 'mejor', 'top', 'gusto', 'paz']);
const NEG_WORDS = new Set(['mal', 'malo', 'mala', 'malos', 'malas', 'peor', 'feo', 'fea', 'raro', 'rara', 'pesado', 'pesada', 'rudo', 'ruda', 'frio', 'fria']);

const NEGATORS = new Set(['no', 'nunca', 'jamas', 'ni', 'nada', 'tampoco', 'sin', 'nadie']);
const BOOST = new Set(['muy', 'super', 'demasiado', 're', 'tan', 'bastante', 'mucho', 'mucha', 'increiblemente', 'sumamente']);

// Alternativas (no una clase de caracteres): varios emojis llevan un selector de variante.
const emojiRe = (list: string) => new RegExp(list.split(' ').join('|'), 'gu');
const POS_EMOJI = emojiRe('😀 😃 😄 😁 😆 😊 🙂 😍 🥰 😘 🤗 🥳 🎉 ❤ 💛 💚 💙 💜 🧡 🤍 👏 🙌 💪 ✨ 😂 🤣 😌 ☺');
const NEG_EMOJI = emojiRe('😞 😔 😟 😕 🙁 ☹ 😣 😖 😫 😩 😢 😭 😤 😠 😡 🤬 💔 😒 🙄 😬 😰 😥');

export type Tone = {
  /** −1 (muy negativo) … 0 (neutro) … 1 (muy positivo). */
  score: number;
  pos: number;
  neg: number;
};

const tokens = (s: string) =>
  normalizeText(s)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Una expresión por lista: cada raíz empieza al inicio de una palabra (la última palabra de la raíz
 * es un prefijo; las anteriores, completas). Una sola pasada por el texto, aunque sea largo.
 */
const stemsRe = (stems: string[]) =>
  new RegExp(
    `(?<=^| )(?:${[...stems]
      .sort((a, b) => b.length - a.length)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})`,
    'g',
  );
const POS_RE = stemsRe(POSITIVE);
const NEG_RE = stemsRe(NEGATIVE);

/** Posiciones (en palabras) donde aparece alguna raíz. */
function hits(joined: string, re: RegExp) {
  const at: number[] = [];
  for (const m of joined.matchAll(re)) {
    const end = m.index ?? 0;
    let words = 0;
    for (let i = 0; i < end; i++) if (joined.charCodeAt(i) === 32) words++;
    at.push(words);
  }
  return at;
}

/** Lo ya leído (los mismos textos se leen muchas veces al pintar las tarjetas). */
const cache = new Map<string, Tone>();
const CACHE_MAX = 5000;

/** Tono de un texto (vacío o sin señales: 0). */
export function toneOf(text: string): Tone {
  const t = text.trim();
  if (!t) return { score: 0, pos: 0, neg: 0 };
  const hit = cache.get(t);
  if (hit) return hit;
  const out = readTone(t);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(t, out);
  return out;
}

function readTone(t: string): Tone {
  const list = tokens(t);
  const joined = list.join(' ');
  let pos = 0;
  let neg = 0;
  const weigh = (i: number, sign: 1 | -1) => {
    // «no fue nada divertido», «nunca me ayudó»: una negación en las dos palabras de antes.
    const before = list.slice(Math.max(0, i - 3), i);
    const negated = before.some((w) => NEGATORS.has(w));
    const boosted = before.some((w) => BOOST.has(w));
    const w = boosted ? 1.5 : 1;
    // Lo negado pesa menos que lo dicho: «no estuvo mal» no es «estuvo genial».
    if (negated) {
      if (sign > 0) neg += w * 0.8;
      else pos += w * 0.5;
    } else if (sign > 0) pos += w;
    else neg += w;
  };
  const seen = new Set<string>();
  const mark = (i: number, sign: 1 | -1) => {
    const k = `${i}${sign}`;
    if (seen.has(k)) return;
    seen.add(k);
    weigh(i, sign);
  };
  for (const i of hits(joined, POS_RE)) mark(i, 1);
  for (const i of hits(joined, NEG_RE)) mark(i, -1);
  list.forEach((w, i) => {
    if (POS_WORDS.has(w)) mark(i, 1);
    else if (NEG_WORDS.has(w)) mark(i, -1);
  });
  pos += (t.match(POS_EMOJI) ?? []).length * 0.8;
  neg += (t.match(NEG_EMOJI) ?? []).length * 0.8;
  const total = pos + neg;
  if (!total) return { score: 0, pos: 0, neg: 0 };
  // Con pocas señales, el tono se acerca a neutro (una sola palabra no lo decide todo).
  const confidence = Math.min(1, total / 3);
  return { score: ((pos - neg) / total) * confidence, pos, neg };
}
