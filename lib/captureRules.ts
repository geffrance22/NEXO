import type { ExchangeKind } from '../data';
import { normalizeText } from './format';

/**
 * Reglas locales de la captura para lo que no es un encuentro ni un gasto: libros y películas,
 * ideas, trabajo, dar y recibir, datos de la gente, preguntas pendientes, lugares, enlaces y el
 * ánimo. Trabajan sobre el texto normalizado (sin tildes, en minúsculas), que conserva las
 * posiciones del original, así los títulos se sacan tal como los escribiste.
 */

const MONTHS: Record<string, string> = {
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  setiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12',
};
const pad = (n: number) => String(n).padStart(2, '0');
export const capital = (s: string) => {
  const t = s.trim().replace(/[\s,;.:]+$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

// ───────────────────────── Títulos ─────────────────────────

/** Título entre comillas: «Dune», "Dune", “Dune”. */
export function quoted(text: string): string | null {
  const m = text.match(/[«“"]([^»”"]{2,120})[»”"]/);
  return m ? m[1].trim() : null;
}

/** Dónde termina un título escrito sin comillas: un conector, una coma, el final de la frase. */
const TITLE_END =
  /\s+(?:con|en el|en la|en|ayer|hoy|anoche|esta (?:ma[ñn]ana|tarde|noche)|el (?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|porque|pero|por|para|cuando|mientras|otra vez|de nuevo)(?![\p{L}])|\s+y\s+(?=(?:me|nos|le|les|la pas|luego|despu[eé]s|fue|estuvo|est[aá]|tambi[eé]n|era|es)(?![\p{L}]))|\s+que\s+(?=(?:me|nos|le|les|est[aá]|es|fue|trata|habla|cuenta)(?![\p{L}]))|[,.;:!?()]/iu;

/** Lo que sigue a una posición, hasta el primer conector: «Dune con Laura» → «Dune». */
export function phraseAt(text: string, index: number) {
  const rest = text.slice(index).replace(/^\s+/, '');
  const cut = rest.search(TITLE_END);
  return (cut === -1 ? rest : rest.slice(0, cut)).trim();
}

/** «Hábitos atómicos de James Clear» → título y autor. */
function splitAuthor(title: string) {
  const m = title.match(
    /^(.+?)\s+de\s+([A-ZÁÉÍÓÚÑ][\p{L}.'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}.'-]+){0,2})$/u,
  );
  return m && m[1].length >= 2 ? { title: m[1], author: m[2] } : { title, author: '' };
}

/** Un título escrito sin comillas debe empezar con mayúscula o número («Dune», «1984»). */
const titleLike = (s: string) => /^[\p{Lu}\d¿¡]/u.test(s) && s.length >= 2 && s.length <= 90;

// ───────────────────────── Libros, películas y series ─────────────────────────

export type MediaHit = {
  media: 'Libro' | 'Película';
  /** Serie, documental o anime (se guarda como película marcada como serie). */
  series: boolean;
  title: string;
  author: string;
  status: 'quiero' | 'curso' | 'listo';
  rating: number;
  platform: string;
  recommended: boolean;
};

const BOOK_WORD = /\b(libro|novela|ensayo|biografia|cuento|comic|manga|audiolibro|saga)\b/;
const SCREEN_WORD =
  /\b(pelicula|peli|serie|miniserie|documental|anime|temporada|film|reality|dorama|k-?drama)\b/;
const SERIES_WORD = /\b(serie|miniserie|documental|anime|temporada|reality|dorama|k-?drama)\b/;
const READ_DONE =
  /\b(lei|leimos|me lei|termine de leer|acabe de leer|terminamos de leer|termine el libro|termine la novela|acabe el libro)\b/;
const READ_NOW =
  /\b(estoy leyendo|empece a leer|empece el libro|empece la novela|ando leyendo|sigo leyendo|voy por la mitad de)\b/;
const READ_WANT =
  /\b(quiero leer|tengo que leer|me gustaria leer|pendiente (?:por )?leer|voy a leer|(?:me )?(?:la |lo )?recomend\w* leer)\b/;
const WATCH_DONE =
  /\b(vi|vimos|me vi|nos vimos|termine de ver|acabe de ver|terminamos de ver|me termine|nos terminamos)\b/;
const WATCH_NOW =
  /\b(estoy viendo|estamos viendo|empece a ver|empezamos a ver|sigo viendo|ando viendo)\b/;
const WATCH_WANT =
  /\b(quiero ver|queremos ver|tengo que ver|me gustaria ver|quedamos en ver|pendiente (?:por )?ver|vamos a ver|(?:me )?(?:la |lo )?recomend\w* ver)\b/;
const RECOMMEND =
  /\b(me (?:la |lo )?recomendo|me (?:la |lo )?recomendaron|recomendacion de|me (?:presto|regalo|regalaron) (?:el|un) libro)\b/;
const PLATFORMS: [RegExp, string][] = [
  [/\bnetflix\b/, 'Netflix'],
  [/\b(hbo|max)\b/, 'Max'],
  [/\b(prime(?: video)?|amazon)\b/, 'Prime Video'],
  [/\bdisney\b/, 'Disney+'],
  [/\bapple ?tv\b/, 'Apple TV'],
  [/\byoutube\b/, 'YouTube'],
  [/\bcrunchyroll\b/, 'Crunchyroll'],
  [/\bmubi\b/, 'Mubi'],
  [/\bstar ?\+|\bstar plus\b/, 'Star+'],
  [/\b(al cine|en (?:el )?cine|en cine)\b/, 'Cine'],
];
const RATING: [RegExp, number][] = [
  [
    /\b(obra maestra|me encanto|me fascino|buenisim|excelente|espectacular|10 ?\/ ?10|5 ?\/ ?5|5 estrellas)/,
    5,
  ],
  [/\b(pesim|horrible|terrible|malisim|1 ?\/ ?5|1 estrella)/, 1],
  [/\b(no me gusto|aburrid|decepcion|flojit?[oa]\b|mal[oa]\b|2 ?\/ ?5|2 estrellas)/, 2],
  [/\b(muy buen[oa]|me gusto mucho|4 ?\/ ?5|4 estrellas|[89] ?\/ ?10)/, 4],
  [/\b(normal|regular|mas o menos|ni fu ni fa|3 ?\/ ?5|3 estrellas|[56] ?\/ ?10)\b/, 3],
  [/\b(me gusto|buen[oa]\b|chever|bacan|entretenid|recomendad)/, 4],
];

export const ratingIn = (n: string) => RATING.find(([re]) => re.test(n))?.[1] ?? 0;

/** Un libro, una película o una serie en la frase (con título, estado y calificación). */
export function mediaIn(text: string): MediaHit | null {
  const n = normalizeText(text);
  // Leer un artículo o una noticia no es un libro.
  if (
    /\b(articulo|noticia|post|blog|hilo|newsletter|correo|mensaje)\b/.test(n) &&
    !BOOK_WORD.test(n)
  )
    return null;
  const q = quoted(text);
  const platform = PLATFORMS.find(([re]) => re.test(n))?.[1] ?? '';
  const bookVerb = READ_DONE.exec(n) ?? READ_NOW.exec(n) ?? READ_WANT.exec(n);
  const screenVerb = WATCH_NOW.exec(n) ?? WATCH_WANT.exec(n) ?? WATCH_DONE.exec(n);
  const bookWord = BOOK_WORD.exec(n);
  const screenWord = SCREEN_WORD.exec(n);
  const recommended = RECOMMEND.test(n);
  // «Nos vimos», «vi a Laura»: sin palabra de película, comillas ni plataforma no es una obra.
  const screenish = Boolean(screenWord || ((q || platform) && screenVerb));
  const bookish = Boolean(bookWord || (q && bookVerb) || (bookVerb && !screenWord));
  if (!screenish && !bookish) return null;
  const media: MediaHit['media'] = bookWord || (bookish && !screenish) ? 'Libro' : 'Película';

  // Título: entre comillas; si no, lo que sigue a «la película…» o al verbo («vi Dune»).
  let title = q ?? '';
  if (!title) {
    const word = media === 'Libro' ? bookWord : screenWord;
    const verb = media === 'Libro' ? bookVerb : screenVerb;
    for (const m of [word, verb]) {
      if (!m) continue;
      let at = m.index + m[0].length;
      // «el libro de James Clear» no es el título.
      const next = text.slice(at).replace(/^\s+/, '');
      if (/^(?:a|al|con|de\s+(?:mi|su|tu)|que)\b/i.test(next)) continue;
      at = text.length - next.length;
      const candidate = phraseAt(text, at).replace(/^(?:el|la|los|las|un|una)\s+/i, '');
      if (titleLike(candidate)) {
        title = candidate;
        break;
      }
    }
  }
  let author = '';
  if (media === 'Libro' && title) ({ title, author } = splitAuthor(title));
  else if (title) title = splitAuthor(title).title;
  if (!title) return null;

  const verbDone = media === 'Libro' ? READ_DONE.test(n) : WATCH_DONE.test(n);
  const verbNow = media === 'Libro' ? READ_NOW.test(n) : WATCH_NOW.test(n);
  const verbWant = media === 'Libro' ? READ_WANT.test(n) : WATCH_WANT.test(n);
  const status: MediaHit['status'] = verbNow
    ? 'curso'
    : verbWant || recommended
      ? 'quiero'
      : verbDone
        ? 'listo'
        : media === 'Libro'
          ? 'quiero'
          : 'listo';
  return {
    media,
    series: media === 'Película' && SERIES_WORD.test(n),
    title: title.slice(0, 120),
    author,
    status,
    rating: status === 'quiero' ? 0 : ratingIn(n),
    platform: media === 'Película' ? platform : '',
    recommended,
  };
}

// ───────────────────────── Ideas y trabajo ─────────────────────────

const IDEA =
  /\b(?:se me ocurrio(?: que)?|tuve una idea(?: para| de)?|tengo una idea(?: para| de)?|idea:|una idea(?: para| de)|que tal si|y si (?=hacemos|hago|creamos|montamos|lanzamos)|podria(?:mos)? (?=hacer|crear|montar|lanzar|armar|abrir|escribir)|seria (?:bueno|chevere|genial|bacano|buena idea) (?=hacer|crear|montar|tener|lanzar|abrir|escribir)|quiero (?=crear|montar|lanzar|emprender|abrir (?:un|una|mi)|escribir un libro))\s*/;
const PROJECTISH =
  /\b(negocio|emprendimiento|empresa|startup|app|aplicacion|plataforma|producto|proyecto|campana|marca|tienda|servicio|clientes?|podcast|canal|curso|web|pagina|software|saas|agencia|restaurante)\b/;

export function ideaIn(text: string) {
  const n = normalizeText(text);
  const m = IDEA.exec(n);
  if (!m) return null;
  const title = capital(text.slice(m.index + m[0].length));
  if (title.length < 4) return null;
  return { title: title.slice(0, 180), project: PROJECTISH.test(n) };
}

const WORK_DONE =
  /\b(termine|terminamos|entregue|entregamos|lance|lanzamos|publique|publicamos|cerramos|firmamos|presente|presentamos|envie|mande|aprobaron|logramos)\b/;
const WORK_NOW =
  /\b(avance|avanzamos|estoy trabajando en|estamos trabajando en|empece|empezamos|arranque|arrancamos|sigo con|segui con|trabaje en|trabajamos en|me reuni con el cliente|nos reunimos con el cliente|disene|programe|escribi)\b/;
const WORK_WORD =
  /\b(proyecto|cliente|informe|propuesta|presentacion|diseno|codigo|entrega|campana|contrato|cotizacion|reporte|landing|pagina web|sitio web|app|sprint|lanzamiento|prototipo|mvp|tesis|plan de negocio|pitch|demo|version|funcionalidad|portafolio|factura)\b/;
const NEXT =
  /[,;]?\s*\b(?:falta|faltan|me falta|nos falta|el siguiente paso es|lo siguiente es|queda pendiente|ahora sigue|solo falta)\s+/;
const LEADING_TIME =
  /^\s*(?:hoy|ayer|anoche|antier|esta (?:ma[ñn]ana|tarde|noche)|el (?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?: pasado)?)[\s,]+/i;

/** Un avance de trabajo o de un proyecto: «Entregué la propuesta al cliente, falta la factura». */
export function workIn(text: string) {
  const n = normalizeText(text);
  if (!WORK_WORD.test(n)) return null;
  const done = WORK_DONE.test(n);
  if (!done && !WORK_NOW.test(n)) return null;
  const next = NEXT.exec(n);
  const main = next ? text.slice(0, next.index) : text;
  const title = capital(main.replace(LEADING_TIME, ''));
  if (title.length < 4) return null;
  return {
    title: title.slice(0, 180),
    stage: (done && !next ? 'listo' : 'curso') as 'listo' | 'curso',
    nextStep: next ? capital(text.slice(next.index + next[0].length)).slice(0, 180) : '',
  };
}

// ───────────────────────── Dar y recibir ─────────────────────────

const GOT: [RegExp, ExchangeKind][] = [
  [
    /\bme (?:regalo|regalaron|trajo|trajeron|dio un regalo|dieron un regalo|mando un regalo|dio un detalle)\b/,
    'regalo',
  ],
  [
    /\bme (?:hizo|hicieron) (?:un|el|un gran) favor\b|\bme (?:presto|prestaron)\b|\bme (?:cubrio|cubrieron)\b/,
    'favor',
  ],
  [
    /\bme (?:ayudo|ayudaron|apoyo|apoyaron|dio la mano|echo una mano|salvo|aconsejo|escucho)\b/,
    'apoyo',
  ],
  [/\bme (?:acompano|acompanaron|dedico tiempo|saco tiempo)\b/, 'tiempo'],
  [/\bme (?:invito|invitaron|busco|escribio primero|llamo primero|contacto)\b/, 'iniciativa'],
];
const GAVE: [RegExp, ExchangeKind][] = [
  [
    /\b(?:le|les) (?:regale|regalamos|lleve un regalo|di un regalo|mande un regalo|compre un regalo|di un detalle)\b/,
    'regalo',
  ],
  [
    /\b(?:le|les) (?:hice|hicimos) (?:un|el) favor\b|\b(?:le|les) (?:preste|prestamos)\b|\b(?:la|lo) (?:cubri|reemplace)\b/,
    'favor',
  ],
  [/\b(?:le|les|la|lo|los) (?:ayude|ayudamos|apoye|apoyamos|aconseje|escuche)\b/, 'apoyo'],
  [/\b(?:la|lo|los|las) (?:acompane|acompanamos)\b|\ble dedique tiempo\b/, 'tiempo'],
  [
    /\b(?:la|lo|los|las|le|les) (?:invite|invitamos|busque|escribi primero|llame primero)\b/,
    'iniciativa',
  ],
];

export function exchangeIn(text: string) {
  const n = normalizeText(text);
  for (const [list, dir] of [
    [GOT, 'recibir'],
    [GAVE, 'dar'],
  ] as const) {
    for (const [re, kind] of list) {
      const m = re.exec(n);
      if (!m) continue;
      const money =
        kind === 'favor' && /\d/.test(n) && /\b(presto|preste|prestaron|prestamos)\b/.test(n);
      // «un libro a Sofía» → «un libro» (la persona ya va aparte).
      const note = phraseAt(text, m.index + m[0].length)
        .replace(/^a\s+\S+\s*/i, '')
        .replace(/\s+a\s+\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?$/u, '');
      return {
        dir,
        kind: money ? ('dinero' as ExchangeKind) : kind,
        note: note.length > 2 && note.length < 120 ? note : '',
      };
    }
  }
  return null;
}

// ───────────────────────── Datos de la persona ─────────────────────────

export type FactHit =
  | { field: 'likes' | 'dislikes' | 'gifts'; value: string }
  | { field: 'birthday'; value: string }
  | { field: 'fact'; label: string; value: string };

const FACT_END =
  /[,.;!?]|\s+(?:pero|porque|aunque)\b|\s+y\s+(?=(?:no|le|me|es|est[aá]|quiere|odia|tambi[eé]n)(?![\p{L}]))/u;
const valueAt = (text: string, index: number) => {
  const rest = text.slice(index).replace(/^\s+/, '');
  const cut = rest.search(FACT_END);
  return (cut === -1 ? rest : rest.slice(0, cut)).trim().replace(/^(?:el|la|los|las)\s+/i, '');
};

/** «A Laura le encanta el sushi», «odia madrugar», «quiere una bicicleta», «cumple el 3 de mayo». */
export function factIn(text: string, date: string): FactHit | null {
  const n = normalizeText(text);
  let m =
    /\b(?:no le gusta|no le gustan|odia|detesta|no soporta|no come|no toma|no tolera)\s+/.exec(n);
  if (m) {
    const value = valueAt(text, m.index + m[0].length);
    if (value.length >= 2) return { field: 'dislikes', value: value.slice(0, 80) };
  }
  m =
    /\b(?:le|les) (?:encanta|encantan|fascina|fascinan|gusta mucho|gustan mucho|gusta|gustan|vuelve loc[oa])\s+/.exec(
      n,
    );
  if (m && !/\bno (?:le|les) /.test(n.slice(Math.max(0, m.index - 4), m.index + 4))) {
    const value = valueAt(text, m.index + m[0].length);
    if (value.length >= 2) return { field: 'likes', value: value.slice(0, 80) };
  }
  m = /\bes alergic[oa] (?:a|al|a la|a los|a las)\s+/.exec(n);
  if (m) {
    const value = valueAt(text, m.index + m[0].length);
    if (value) return { field: 'fact', label: 'Alergia', value: value.slice(0, 80) };
  }
  m =
    /\b(?:quiere|le gustaria tener|se antojo de|anda antojad[oa] de|sueña con tener|suena con tener|le hace falta)\s+(?:un|una|unos|unas)\s+/.exec(
      n,
    );
  if (m && !/\b(trabajo|empleo|novi[oa]|pareja|hijo|bebe|descanso)\b/.test(n.slice(m.index))) {
    const value = valueAt(text, m.index + m[0].length);
    if (value.length >= 2) return { field: 'gifts', value: value.slice(0, 80) };
  }
  m =
    /\b(?:su cumpleanos es|cumpleanos de \S+(?: \S+)? es|cumple(?: anos)?|nacio)\s+(?:el\s+)?(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/.exec(
      n,
    );
  if (m) return { field: 'birthday', value: `${MONTHS[m[2]]}-${pad(Number(m[1]))}` };
  // Lo celebraste el día que cuentas: ese es su cumpleaños.
  if (
    /\b(?:hoy es|fue|era|celebramos|festejamos|celebre) (?:el |su )cumpleanos\b|\bcumple(?: anos)? hoy\b|\bcumplio anos\b/.test(
      n,
    )
  )
    return { field: 'birthday', value: date.slice(5) };
  const pet = text.match(
    /\bsu (hij[oa]|herman[oa]|perr[oa]|gat[oa]|mascota|espos[oa]|novi[oa]|pareja|mamá|papá) se llama\s+([A-ZÁÉÍÓÚÑ][\p{L}]+)/iu,
  );
  if (pet) return { field: 'fact', label: capital(pet[1]), value: pet[2] };
  return null;
}

// ───────────────────────── Preguntas pendientes ─────────────────────────

const ASK =
  /\b(?:tengo que |quiero |debo |no olvidar |recordar |acordarme de |me falta )?(?:preguntarle|preguntarles|le quiero preguntar|le tengo que preguntar|le voy a preguntar|les quiero preguntar)\s+/;
const QUESTION_WORD =
  /^(como|cómo|si|que|qué|cuando|cuándo|donde|dónde|cual|cuál|cuanto|cuánto|por qué|por que|quien|quién)\b/i;

/** «Tengo que preguntarle a Laura cómo le fue en la entrevista» → «¿Cómo le fue en la entrevista?». */
export function askIn(text: string) {
  const n = normalizeText(text);
  const m = ASK.exec(n);
  if (!m) return null;
  let rest = text
    .slice(m.index + m[0].length)
    .replace(/^a\s+\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?\s+/u, '')
    .trim()
    .replace(/[.!]+$/, '');
  if (rest.length < 3) return null;
  rest = capital(rest);
  if (QUESTION_WORD.test(rest) && !rest.startsWith('¿'))
    rest = '¿' + rest.replace(/\?*$/, '') + '?';
  return { text: rest.slice(0, 200) };
}

// ───────────────────────── Lugares y enlaces ─────────────────────────

export const VISIT =
  /\b(fui a|fui al|fuimos a|fuimos al|estuve en|estuvimos en|visite|visitamos|pase por|conoci el|conoci la|conocimos el|conocimos la|me quede en|nos quedamos en|almorce en|cene en|desayune en|entrene en)\b/;
/** Lugar después de un verbo de visita: «fui al Parque Simón Bolívar». */
export const VISIT_PLACE =
  /(?<![\p{L}])(?:[Ff]u(?:[ií]|imos) a(?:l| la)?|[Ee]stuv(?:e|imos) en(?: el| la)?|[Vv]isit(?:é|e|amos)(?: el| la)?|[Pp]as(?:é|e) por(?: el| la)?|[Cc]onoc(?:í|i|imos) (?:el|la)|(?:[Mm]e|[Nn]os) qued(?:é|e|amos) en(?: el| la)?)\s+((?:[A-ZÁÉÍÓÚÑ][\wáéíóúñ'’-]*)(?:\s+(?:de|del|la|el|y)?\s*[A-ZÁÉÍÓÚÑ][\wáéíóúñ'’-]*){0,3})/u;

/** «su cumpleaños es el 3 de mayo»: esa fecha no es cuándo pasó lo que cuentas. */
export const BIRTHDAY_DATE =
  /(cumplea[ñn]os|cumple|naci[óo])[^.!?\n]{0,40}?\d{1,2} de [a-záéíóúñ]+/gi;

export const URL_RE = /https?:\/\/[^\s<>"«»]+/g;
export const cleanUrl = (u: string) => u.replace(/[).,;:!?]+$/, '');
const SHARED = /\b(me (?:paso|mando|envio|compartio|recomendo)|nos (?:paso|mando|compartio))\b/;
export const sharedIn = (text: string) => SHARED.test(normalizeText(text));

// ───────────────────────── Ánimo ─────────────────────────

/** Valores de `moods` (composer/controls): 1 triste … 5 genial; 6 tenso, 7 tranquilo, 8 divertido. */
const MOOD_WORDS: [RegExp, number][] = [
  [/\b(divertid|nos reimos|me rei|muert[oa] de la risa|chistos)/, 8],
  [
    /\b(genial|increible|espectacular|feliz|felicisim|maravillos|lo maximo|de lujo|brutal|buenisim)/,
    5,
  ],
  [/\b(triste|deprimid|fatal|horrible|llore|destrozad|nostalgic|pesimo)/, 1],
  [/\b(tens[oa]|estresad|ansios|preocupad|agotad|frustrad|de mal genio|enojad|furios)/, 6],
  [/\b(rar[oa]|extran|incomod|confundid)/, 2],
  [/\b(tranquil|relajad|en paz|calmad|descansad)/, 7],
  [/\b(normal|regular|ni fu ni fa|mas o menos)\b/, 3],
  [/\b(bien|chever|bacan|ric[oa]|agradable|bonit[oa]|lind[oa]|content[oa]|animad[oa])\b/, 4],
];
const MOOD_ANCHOR =
  /\b(me senti|me siento|me sentia|estoy|quede|termine|estuvo|estuvimos|fue un|fue una|la pase|la pasamos|nos fue|me fue|que dia|un dia|el dia)\b/g;

/** Cómo te sentiste: «me sentí tranquila», «la pasamos genial», «fue un día pesado». */
export function moodIn(text: string): number | null {
  const n = normalizeText(text);
  for (const a of n.matchAll(MOOD_ANCHOR)) {
    const at = a.index ?? 0;
    const window = n.slice(at + a[0].length, at + a[0].length + 40);
    const negated =
      /\bno\s*$/.test(n.slice(Math.max(0, at - 4), at)) || /^\s*(?:muy )?no\b/.test(window);
    for (const [re, value] of MOOD_WORDS) {
      if (!re.test(window)) continue;
      // «no me sentí bien» → raro; «no estuvo mal» → bien.
      if (negated) return value === 1 || value === 6 ? 4 : value === 3 ? null : 2;
      return value;
    }
  }
  return null;
}

// ───────────────────────── Aprendizajes ─────────────────────────

/** De dónde salió un aprendizaje (las fuentes del formulario de Aprendizaje). */
export function learningSource(n: string, withPeople: boolean) {
  if (/\b(libro|novela|leyendo|lei)\b/.test(n)) return 'Libro';
  if (/\b(curso|clase|taller|diplomado|bootcamp|webinar)\b/.test(n)) return 'Curso';
  if (/\b(video|youtube|podcast|documental|charla|ted|tiktok|reel)\b/.test(n)) return 'Video';
  if (/\b(articulo|post|blog|newsletter|hilo|noticia)\b/.test(n)) return 'Artículo';
  if (withPeople || /\b(me enseno|me explico|me conto|me dijo)\b/.test(n)) return 'Persona';
  return 'Práctica';
}
