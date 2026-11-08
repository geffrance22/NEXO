import type { Person, PersonProfile } from '../data';
import { normalizeText, splitList } from './format';

/** Lo que una novedad deja ver de los gustos de una persona. */
export type Tastes = { interests: string[]; likes: string[]; dislikes: string[] };

/**
 * Aficiones que se reconocen por su nombre (texto sin tildes, como `normalizeText`). Solo cuentan
 * en una frase que hable de hacerlas («juega», «practica», «clases de»…), no en cualquier mención.
 */
const HOBBIES: [RegExp, string][] = [
  [/\b(futbol|futbolito|microfutbol)\b/, 'Fútbol'],
  [/\b(baloncesto|basket|basquet|basquetbol)\b/, 'Baloncesto'],
  [/\b(voleibol|voley|volley)\b/, 'Voleibol'],
  [/\b(tenis de mesa|ping ?pong)\b/, 'Tenis de mesa'],
  [/\b(natacion|nadar)\b/, 'Natación'],
  [/\b(ciclismo|ciclomontanismo|montar (en )?bici(cleta)?|rodar en bici(cleta)?)\b/, 'Ciclismo'],
  [/\b(running|maratones|maraton|media maraton|salir a correr|trotar)\b/, 'Correr'],
  [/\byoga\b/, 'Yoga'],
  [/\bpilates\b/, 'Pilates'],
  [/\bcrossfit\b/, 'CrossFit'],
  [/\b(gimnasio|gym|pesas)\b/, 'Gimnasio'],
  [/\b(senderismo|hiking|trekking|caminatas)\b/, 'Senderismo'],
  [/\bescalada\b/, 'Escalada'],
  [/\b(surf|surfear)\b/, 'Surf'],
  [/\b(boxeo|kickboxing|karate|taekwondo|jiu ?jitsu|artes marciales)\b/, 'Artes marciales'],
  [/\b(bailar|baile|danza|salsa caleña)\b/, 'Baile'],
  [/\bguitarra\b/, 'Guitarra'],
  [/\bpiano\b/, 'Piano'],
  [/\bviolin\b/, 'Violín'],
  [/\b(ukelele|ukulele)\b/, 'Ukelele'],
  [/\b(saxofon|saxo)\b/, 'Saxofón'],
  [/\b(cantar|canto|coro)\b/, 'Canto'],
  [/\bconciertos?\b/, 'Conciertos'],
  [/\b(leer|lectura|novelas)\b/, 'Lectura'],
  [/\b(escribir|escritura|poesia|poemas)\b/, 'Escritura'],
  [/\b(fotografia|tomar fotos)\b/, 'Fotografía'],
  [/\b(dibujar|dibujo|ilustracion|acuarela|oleo|pintar cuadros)\b/, 'Dibujo y pintura'],
  [/\b(ceramica|tejer|tejido|crochet|bordado|manualidades|carpinteria)\b/, 'Manualidades'],
  [/\b(cocinar|reposteria|hornear|panaderia)\b/, 'Cocina'],
  [/\b(videojuegos?|gamer|playstation|xbox|nintendo)\b/, 'Videojuegos'],
  [/\bajedrez\b/, 'Ajedrez'],
  [/\bjuegos de mesa\b/, 'Juegos de mesa'],
  [/\b(programar|programacion)\b/, 'Programación'],
  [/\b(jardineria|huerta|bonsai)\b/, 'Jardinería'],
  [/\b(pesca|pescar)\b/, 'Pesca'],
  [/\b(camping|acampar)\b/, 'Camping'],
  [/\b(meditar|meditacion|mindfulness)\b/, 'Meditación'],
  [/\b(cine|peliculas)\b/, 'Cine'],
  [/\bteatro\b/, 'Teatro'],
  [/\b(anime|manga)\b/, 'Anime'],
  [/\b(viajar|mochilear)\b/, 'Viajes'],
  [/\b(ingles|frances|aleman|italiano|portugues|japones|coreano|mandarin|idiomas)\b/, 'Idiomas'],
];

/** La frase habla de hacer algo (no de una mención de paso como «fuimos al cine»). */
const CUE =
  /\b(practica|juega|jugar|jugando|entrena|entrenando|clases?|curso|taller|aprend|empezo|empezando|se metio|se inscribio|afici|hobby|pasatiempo|fan|fanatic|apasiona|encanta|fascina|gusta|disfruta|toca|va al|va a|hace|compite|compitio|torneo|campeonato|competencia|club|corrio|termino|gano|participo|retomo|volvio a|sigue)/;
/** Lo que niega una afición cerca de su nombre («dejó el fútbol», «no sabe nadar»). */
const NEGATION = /\b(no|ya no|nunca|dejo|dejo de|odia|detesta|abandono)\b[^.;!?]{0,24}$/;

const DISLIKE =
  /\b(?:ya no le gustan?|no le gustan?(?: (?:nada|mucho|para nada))?|odian?|detestan?|no soportan?|no aguanta|no tolera|le chocan?|le molestan?|le fastidian?|le aburren?|le dan? (?:mucho )?(?:miedo|asco|pereza)|le caen? mal|dejo de gustarle)\s+/g;
const LIKE =
  /\b(?:le|les) (?:encantan?|encanto|fascinan?|fascino|apasionan?|gustan? mucho|gustan?|gusto mucho|vuelven? loc[oa]s?)(?: mucho)?\s+/g;
const FAN =
  /\b(?:es|son) (?:muy |super |re )?(?:fan|fanatic[oa]s?|hinch[ao]s?|aficionad[oa]s?|amantes?|apasionad[oa]s?) (?:de|del|por)\s+/g;
const FAVORITE =
  /\bsu (?:comida|bebida|musica|banda|cantante|grupo|pelicula|serie|libro|autor|deporte|equipo|color|lugar|plan|postre|fruta) favorit[oa] es\s+/g;
/** Verbos de aficiones: el valor solo cuenta si es una afición conocida o algo breve. */
const DOES =
  /\b(?:practica|practican|empezo a practicar|colecciona|coleccionan|esta aprendiendo(?: a tocar)?|aprendio a tocar|esta tomando clases de|toma clases de|se metio a(?: clases de)?|se inscribio (?:a|en)(?: clases de)?|empezo (?:clases|un curso) de)\s+/g;
/** Verbos de jugar o entrenar: solo con un deporte o juego conocido («juega fútbol»). */
const PLAYS = /\b(?:juega|juegan|jugaba|empezo a jugar|entrena|entrenan|toca|tocan)\s+/g;

/** Donde termina lo que le gusta. */
const END =
  /[.;!?\n(]|\s+(?:pero|porque|aunque|cuando|mientras|desde|hasta|con|en|los (?:lunes|martes|miercoles|jueves|viernes|sabados|domingos|fines)|todos|todas|cada|para)\b|\s+y\s+(?=(?:no|le|les|me|es|esta|quiere|odia|detesta|ya|tambien|se)\b)/;

const ARTICLE = /^(?:a|al|a la|a los|a las|el|la|los|las|un|una|unos|unas|de|del|mucho|muchos)\s+/;
/** Lo que no es un gusto: posesivos, verbos sueltos, pronombres… */
const NOT_A_TASTE =
  /^(?:que|como|cuando|donde|porque|si|nada|poco|eso|esto|esa|ese|ella|el|ellos|ellas|su|sus|mi|mis|tu|tus|nuestro|nuestra|para|por|con|sin|en|estar|ser|tener|salir|ir|verla|verlo|verte|hablar|sobre|sobretodo|especialmente|ademas|tambien|incluso|ahora|siempre|hoy|ayer|todo|todos|mas|menos|bastante)\b/;

const hobbyIn = (normalized: string) => HOBBIES.find(([re]) => re.test(normalized))?.[1];

function clean(raw: string) {
  let v = raw.trim();
  for (let i = 0; i < 3; i++) {
    const n = normalizeText(v);
    const art = ARTICLE.exec(n) ?? /^(?:ir|salir) (?:a|al|a la|a los|a las)\s+/.exec(n);
    const verb = /^hacer\s+/.exec(n);
    const cut = art ?? verb;
    if (!cut) break;
    v = v.slice(cut[0].length);
  }
  v = v.replace(/^[\s"'«»¡¿]+|[\s,;:.!?"'«»)]+$/gu, '');
  const n = normalizeText(v);
  if (v.length < 2 || v.length > 40 || v.split(/\s+/).length > 5 || NOT_A_TASTE.test(n))
    return null;
  return v[0].toUpperCase() + v.slice(1);
}

/** Lo que sigue a `from` hasta el final de la idea, separado en elementos («café, té y vino»). */
function valuesAt(text: string, norm: string, from: number) {
  const rest = norm.slice(from);
  const stop = rest.search(END);
  const span = text.slice(from, from + (stop === -1 ? rest.length : stop));
  return span
    .split(/,|\s+y\s+|\s+e\s+|\s+o\s+/)
    .map(clean)
    .filter((v): v is string => Boolean(v));
}

const key = (s: string) => normalizeText(s).replace(/\s+/g, ' ').trim();
const push = (list: string[], value: string) => {
  if (!list.some((x) => key(x) === key(value))) list.push(value);
};

/**
 * Intereses, aficiones y lo que no le gusta según el texto de una novedad («empezó clases de
 * guitarra», «le encanta el café», «ya no soporta madrugar»). Solo frases claras: mejor quedarse
 * corto que llenar la ficha de ruido.
 */
export function deduceTastes(raw: string): Tastes {
  const out: Tastes = { interests: [], likes: [], dislikes: [] };
  const text = raw.normalize('NFC');
  const all = normalizeText(text);
  // Los índices del texto sin tildes sirven para cortar el original si miden lo mismo.
  const source = all.length === text.length ? text : all;
  const like = (v: string) => {
    const hobby = v.split(/\s+/).length <= 2 ? hobbyIn(key(v)) : undefined;
    push(hobby ? out.interests : out.likes, hobby ?? v);
  };

  for (const m of all.matchAll(/[^.;!?\n]+/g)) {
    const start = m.index ?? 0;
    const clause = m[0];
    const original = source.slice(start, start + clause.length);
    const at = (from: number) => valuesAt(original, clause, from);
    let disliked = false;

    for (const d of clause.matchAll(DISLIKE)) {
      disliked = true;
      for (const v of at(d.index! + d[0].length)) push(out.dislikes, v);
    }
    for (const re of [LIKE, FAN, FAVORITE]) {
      for (const l of clause.matchAll(re)) {
        // «no le gusta» ya se tomó como algo que no le gusta.
        if (/\bno\s+$/.test(clause.slice(Math.max(0, l.index! - 4), l.index!))) continue;
        for (const v of at(l.index! + l[0].length)) like(v);
      }
    }
    // «Se metió a clases de salsa», «está aprendiendo inglés»: lo concreto vale más que la categoría.
    for (const a of clause.matchAll(DOES)) {
      for (const v of at(a.index! + a[0].length)) {
        const hobby = hobbyIn(key(v));
        if (v.split(/\s+/).length <= 3) push(out.interests, v);
        else if (hobby) push(out.interests, hobby);
      }
    }
    for (const a of clause.matchAll(PLAYS)) {
      // «le toca trabajar» es su turno, no un instrumento.
      if (/\b(?:le|les|me|te|nos)\s+$/.test(clause.slice(Math.max(0, a.index! - 5), a.index!)))
        continue;
      for (const v of at(a.index! + a[0].length)) {
        const hobby = hobbyIn(key(v));
        if (hobby) push(out.interests, hobby);
      }
    }
    // Aficiones nombradas en una frase que habla de hacerlas (si no salieron ya, p. ej. «Inglés»).
    if (!disliked && CUE.test(clause)) {
      for (const [re, label] of HOBBIES) {
        const hit = re.exec(clause);
        if (!hit || NEGATION.test(clause.slice(0, hit.index))) continue;
        if ([...out.interests, ...out.likes].some((v) => re.test(key(v)))) continue;
        push(out.interests, label);
      }
    }
  }

  // Lo que no le gusta manda: no se sugiere a la vez como gusto.
  const no = new Set(out.dislikes.map(key));
  out.likes = out.likes.filter((v) => !no.has(key(v))).slice(0, 6);
  out.interests = out.interests.filter((v) => !no.has(key(v))).slice(0, 6);
  out.dislikes = out.dislikes.slice(0, 6);
  return out;
}

export const hasTastes = (t: Tastes) => t.interests.length + t.likes.length + t.dislikes.length > 0;

/**
 * Suma lo deducido a la ficha. Lo más reciente manda: si antes le gustaba y ahora no, pasa a
 * «no le gusta» (y al revés). Devuelve los cambios para `patchPerson` (sin tocar lo demás) y qué
 * se añadió, para avisarlo.
 */
export function withTastes(person: Person, t: Tastes) {
  const interests = splitList(person.interests);
  const likes = [...(person.profile.likes ?? [])];
  const dislikes = [...(person.profile.dislikes ?? [])];
  const has = (list: string[], v: string) => list.some((x) => key(x) === key(v));
  const drop = (list: string[], v: string) => {
    const i = list.findIndex((x) => key(x) === key(v));
    if (i !== -1) list.splice(i, 1);
  };
  const added: Tastes = { interests: [], likes: [], dislikes: [] };
  for (const v of t.dislikes) {
    if (has(dislikes, v)) continue;
    drop(likes, v);
    drop(interests, v);
    dislikes.push(v);
    added.dislikes.push(v);
  }
  for (const v of t.likes) {
    if (has(likes, v) || has(interests, v)) continue;
    drop(dislikes, v);
    likes.push(v);
    added.likes.push(v);
  }
  for (const v of t.interests) {
    if (has(interests, v) || has(likes, v)) continue;
    drop(dislikes, v);
    interests.push(v);
    added.interests.push(v);
  }
  const profile: PersonProfile = {
    ...person.profile,
    likes: likes.slice(-40),
    dislikes: dislikes.slice(-40),
  };
  return {
    interests: interests.slice(-30).join(', '),
    profile,
    added,
    changed: hasTastes(added),
  };
}

/** «Fútbol, Café y Madrugar (no le gusta)», para el aviso. */
export function tastesLabel(t: Tastes) {
  const items = [...t.interests, ...t.likes, ...t.dislikes.map((d) => `${d} (no le gusta)`)];
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
}
