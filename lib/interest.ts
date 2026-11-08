import type { Person } from '../data';
import { normalizeText, splitList } from './format';
import { updatesOf } from './updates';

/**
 * A quién le puede interesar un texto (un resaltado, un artículo): se cruzan sus palabras con lo
 * que sabes de cada persona (novedades recientes, intereses, palabras clave, gustos, trabajo…).
 * Es local y explica el motivo: «Busca trabajo» o «Le interesa: diseño».
 */

export type Interested = {
  person: Person;
  score: number;
  /** Por qué: «Está buscando trabajo en diseño», «Le interesa: fotografía». */
  reason: string;
  /** Palabras que coincidieron. */
  words: string[];
};

/** Palabras vacías: no dicen nada del tema. */
const STOP = new Set(
  (
    'para como pero porque cuando donde desde hasta entre sobre tambien esta este esto estos estas ' +
    'eso esos esas aquel aquella tiene tienen tener hacer hace hecho puede pueden poder sera seran ' +
    'siempre nunca mucho muchos mucha muchas poco pocos otra otro otros otras cada todo todos toda ' +
    'todas mismo misma mismos solo sola solamente mientras segun ademas aunque entonces despues ' +
    'antes ahora aqui alli algo alguien nadie nada cual cuales quien quienes cuyo dijo dice decir ' +
    'segun estan estaba estaban fueron sido siendo haber habia hubo habra seria serian anos tiempo ' +
    'manera forma parte gran grande nuevo nueva nuevos nuevas mejor peor mayor menor primero primera ' +
    'ultimo ultima vez veces dias semana meses personas persona gente cosa cosas sino incluso hacia ' +
    'with that this from have they their about which would there were what when your more will ' +
    'been also into than them only other some these could'
  ).split(' '),
);

/** Temas: si el texto toca uno, cuenta para quien lo tenga (aunque usen palabras distintas). */
const TOPICS: [string, RegExp][] = [
  [
    'trabajo',
    /\b(trabaj|emple|vacante|contrat|entrevista|curriculum|hoja de vida|reclut|oferta laboral|despid|renunci|ascens|salario|sueldo|linkedin)/,
  ],
  [
    'estudios',
    /\b(estudi|beca|maestr|doctorad|universidad|carrera|curso|diplomad|posgrado|admision|examen|tesis)/,
  ],
  [
    'salud',
    /\b(salud|medic|enferm|hospital|tratamiento|terapia|cancer|diabet|ansiedad|depresion|nutric|dieta|embaraz)/,
  ],
  [
    'negocio',
    /\b(emprend|negocio|startup|empresa propia|ventas|clientes|marketing|inversion|invertir|financ|ahorro|cripto|bolsa)/,
  ],
  [
    'tecnologia',
    /\b(tecnolog|programa|software|inteligencia artificial|\bia\b|datos|app|aplicacion|desarroll|codigo)/,
  ],
  ['diseno', /\b(disen|grafic|ilustra|branding|ux|ui|tipograf|fotograf)/],
  ['viaje', /\b(viaj|vuelo|turism|pasaporte|visa|destino|vacaciones)/],
  ['familia', /\b(hijos?|maternidad|paternidad|crianza|bebe|ninos|educacion infantil|adolescen)/],
  ['hogar', /\b(vivienda|apartamento|arriendo|hipoteca|mudanz|casa propia)/],
  ['deporte', /\b(deport|futbol|correr|maraton|gimnasio|ciclis|yoga|entren)/],
  ['musica', /\b(music|cancion|concierto|guitarra|piano|banda)/],
  ['arte', /\b(arte|pintur|museo|cine|pelicula|teatro|literatura|novela|poesia|escrit)/],
  ['comida', /\b(cocin|receta|restaurant|gastronom|cafe|vino)/],
  ['fe', /\b(iglesia|fe\b|dios|biblia|oracion|espiritual)/],
];
const UPDATE_TOPIC: Record<string, string> = {
  trabajo: 'trabajo',
  estudios: 'estudios',
  salud: 'salud',
  familia: 'familia',
  hogar: 'hogar',
  viaje: 'viaje',
  logro: 'negocio',
};

/** Raíz corta para que «diseñadora» y «diseño» coincidan. */
const stem = (w: string) => (w.length > 6 ? w.slice(0, 6) : w);
const wordsOf = (text: string) =>
  normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
const topicsOf = (text: string) => {
  const t = normalizeText(text);
  return TOPICS.filter(([, re]) => re.test(t)).map(([k]) => k);
};

/** Personas a las que el texto parece interesarles, de la más a la menos. */
export function whoMightCare(text: string, people: Person[], context = '', max = 5): Interested[] {
  const own = wordsOf(text);
  const all = [...new Set([...own, ...wordsOf(context)])];
  const stems = new Set(all.map(stem));
  const textTopics = new Set([...topicsOf(text), ...topicsOf(context)]);
  if (!stems.size && !textTopics.size) return [];
  const fieldHits = (value: string) => {
    const ws = [...new Set(wordsOf(value))];
    return ws.filter((w) => stems.has(stem(w)));
  };

  const out: Interested[] = [];
  for (const p of people) {
    const pr = p.profile;
    let score = 0;
    let reason = '';
    let best = 0;
    const words = new Set<string>();
    const consider = (value: string | undefined, weight: number, why: (v: string) => string) => {
      if (!value?.trim()) return;
      const hits = fieldHits(value);
      const topics = topicsOf(value).filter((t) => textTopics.has(t));
      const s = hits.length * weight + topics.length * weight * 0.8;
      if (!s) return;
      score += s;
      hits.forEach((h) => words.add(h));
      if (s > best) {
        best = s;
        reason = why(value);
      }
    };

    // Novedades recientes: lo que vive ahora («Está buscando trabajo») pesa más.
    for (const u of updatesOf(p).slice(0, 8)) {
      const fresh = Date.now() - Date.parse(u.date + 'T12:00:00') < 120 * 86_400_000;
      consider(u.text, fresh ? 4 : 2, (v) => v);
      const topic = UPDATE_TOPIC[u.kind];
      if (fresh && topic && textTopics.has(topic)) {
        score += 3;
        if (best < 3) {
          best = 3;
          reason = u.text;
        }
      }
    }
    for (const i of splitList(p.interests)) consider(i, 3, (v) => `Le interesa: ${v}`);
    for (const k of pr.keywords ?? []) consider(k, 2.5, (v) => `La recuerdas por: ${v}`);
    for (const l of pr.likes ?? []) consider(l, 2, (v) => `Le gusta: ${v}`);
    consider(pr.occupation, 2.5, (v) => `Trabaja como ${v}`);
    consider(pr.company, 2, (v) => `Trabaja en ${v}`);
    consider(p.role, 1.5, (v) => v);
    consider(p.bio, 1, () => 'Por lo que sabes de su vida');
    for (const f of pr.facts ?? []) consider(f.value, 1.5, () => `${f.label}: ${f.value}`);
    for (const q of pr.askNext ?? []) consider(q, 2, (v) => `Querías preguntarle: ${v}`);

    if (score >= 2.5) out.push({ person: p, score, reason, words: [...words].slice(0, 4) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/** Mensaje para compartir: la cita, el título y el enlace. */
export function shareText(quote: string, title: string, url: string, note = '') {
  const q = quote.trim().replace(/\s+/g, ' ');
  return [note.trim(), `«${q.length > 600 ? q.slice(0, 600) + '…' : q}»`, `— ${title}`, url]
    .filter(Boolean)
    .join('\n\n');
}

/** Enlace de WhatsApp con el número de la persona (si lo tiene). */
export function whatsappLink(phone: string | undefined, text: string) {
  const digits = phone?.replace(/[^\d+]/g, '').replace(/^\+/, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
