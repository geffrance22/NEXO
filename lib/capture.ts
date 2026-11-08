import type {
  CommitmentKind,
  Direction,
  EpisodeKind,
  ExchangeKind,
  Gender,
  PlaceKind,
  TieKind,
  UpdateKind,
  Workspace,
} from '../data';
import {
  BIRTHDAY_DATE,
  URL_RE,
  VISIT,
  VISIT_PLACE,
  askIn,
  cleanUrl,
  exchangeIn,
  factIn,
  ideaIn,
  learningSource,
  mediaIn,
  moodIn,
  sharedIn,
  workIn,
} from './captureRules';
import { moods } from '../composer/controls';
import { addDays, normalizeText, todayInputValue } from './format';
import { daysBetween } from './people';
import { recognize, type Mention } from './recognize';

// ───────────────────────── Piezas de una experiencia ─────────────────────────

type Base = {
  id: string;
  /** Si se guarda (puedes excluir cualquier pieza antes de guardar). */
  on: boolean;
  /** Frase del texto original de la que salió. */
  evidence: string;
};
export type EncounterPiece = Base & {
  kind: 'encuentro';
  personIds: string[];
  placeId: string | null;
  /** Lugar nuevo (no está en tus lugares): se crea al guardar si tiene nombre. */
  placeName: string;
  placeKind: PlaceKind;
  date: string;
  activity: string;
  title: string;
};
export type MoneyPiece = Base & {
  kind: 'movimiento';
  amount: number;
  direction: Direction;
  category: string;
  date: string;
  title: string;
  /** Ya existe un movimiento igual cerca de esa fecha: se enlaza en lugar de duplicarlo. */
  dupOf?: string;
};
export type UpdatePiece = Base & {
  kind: 'novedad';
  personId: string;
  updateKind: UpdateKind;
  text: string;
  date: string;
};
export type CommitmentPiece = Base & {
  kind: 'compromiso';
  title: string;
  commitment: CommitmentKind;
  /** AAAA-MM-DD o vacío. */
  due: string;
  /** A quién se lo prometiste / de quién lo esperas. */
  personId: string | null;
  /** Todas las personas que aparecen en el compromiso. */
  peopleIds: string[];
};
export type ConnectionPiece = Base & { kind: 'conexion'; a: string; b: string; text: string };
export type LearningPiece = Base & {
  kind: 'aprendizaje';
  title: string;
  /** Libro, Curso, Video, Artículo, Persona o Práctica (como en el formulario). */
  source: string;
  sourceName: string;
};
export type NotePiece = Base & { kind: 'nota'; text: string };
/** Un libro, una película o una serie: vista, leyendo, por ver… con calificación. */
export type MediaPiece = Base & {
  kind: 'obra';
  media: 'Libro' | 'Película';
  series: boolean;
  title: string;
  author: string;
  platform: string;
  /** quiero: por ver o leer; curso: leyéndolo o viéndola; listo: terminado o vista. */
  status: 'quiero' | 'curso' | 'listo';
  rating: number;
  /** Con quién la viste o quién aparece. */
  personIds: string[];
  /** Quién te la recomendó (o te prestó el libro). */
  recommendedBy: string | null;
};
export type IdeaPiece = Base & {
  kind: 'idea';
  title: string;
  /** nota: idea suelta; trabajo: proyecto en etapa «Idea». */
  as: 'nota' | 'trabajo';
};
export type WorkPiece = Base & {
  kind: 'trabajo';
  title: string;
  stage: 'idea' | 'curso' | 'pausa' | 'listo';
  nextStep: string;
  due: string;
  personIds: string[];
};
/** Algo que diste o recibiste: alimenta «Dar y recibir» en su ficha. */
export type ExchangePiece = Base & {
  kind: 'intercambio';
  personId: string;
  dir: 'dar' | 'recibir';
  exchange: ExchangeKind;
  note: string;
  date: string;
};
/** Un dato de su ficha: gustos, lo que no le gusta, ideas de regalo, cumpleaños u otro dato. */
export type FactPiece = Base & {
  kind: 'dato';
  personId: string;
  field: 'likes' | 'dislikes' | 'gifts' | 'birthday' | 'fact';
  label: string;
  value: string;
};
/** Para preguntarle la próxima vez («¿Cómo le fue en la entrevista?»). */
export type AskPiece = Base & { kind: 'preguntar'; personId: string; text: string };
/** Un lugar donde estuviste sin un encuentro con alguien: se guarda como nota en ese lugar. */
export type VisitPiece = Base & {
  kind: 'visita';
  placeId: string | null;
  placeName: string;
  placeKind: PlaceKind;
  activity: string;
  title: string;
  date: string;
};
/** Un enlace del texto: se guarda en Lecturas (o como nota si no se puede capturar). */
export type LinkPiece = Base & {
  kind: 'enlace';
  url: string;
  title: string;
  save: 'lecturas' | 'nota';
  /** Quién te lo pasó. */
  personId: string | null;
};

export type Piece =
  | EncounterPiece
  | MoneyPiece
  | UpdatePiece
  | CommitmentPiece
  | ConnectionPiece
  | LearningPiece
  | NotePiece
  | MediaPiece
  | IdeaPiece
  | WorkPiece
  | ExchangePiece
  | FactPiece
  | AskPiece
  | VisitPiece
  | LinkPiece;
export type PieceKind = Piece['kind'];

/** Nombre que no está en tu universo: se puede crear al guardar. */
export type NewPerson = { id: string; name: string; on: boolean };

export type CapturePlan = {
  text: string;
  /** Cuándo pasó. */
  date: string;
  pieces: Piece[];
  newPeople: NewPerson[];
  /** Nombres de pila que coinciden con varias personas (la pieza usa la más probable). */
  ambiguous: { name: string; ids: string[]; chosen: string }[];
  /** Parentescos del texto («mi mamá», «mi tío Carlos») por resolver o guardar como vínculo. */
  kinLinks: KinLink[];
  episode: { on: boolean; title: string; kind: EpisodeKind };
  /** Cómo te sentiste (valor de `moods`): va en el encuentro, la visita y la nota. */
  mood: number | null;
};

/**
 * Un parentesco nombrado: a quién se refiere y si se guarda el vínculo. Si aún no se sabe quién
 * es, `id` es un comodín («kin:…») que las piezas usan hasta que lo elijas.
 */
export type KinLink = {
  id: string;
  /** «tu mamá», «la hermana de Laura». */
  label: string;
  kind: TieKind;
  gender: Gender | null;
  /** Dueño del vínculo: tú (ME) u otra persona. */
  owner: string;
  /** Persona elegida (existente o «new:…»); null mientras no se elija. */
  personId: string | null;
  /** Guardar «<persona> es <vínculo> de <dueño>» al guardar la experiencia. */
  save: boolean;
};

export const pieceLabels: Record<PieceKind, string> = {
  encuentro: 'Encuentro',
  movimiento: 'Movimiento',
  novedad: 'Novedad en su ficha',
  compromiso: 'Compromiso',
  conexion: 'Posible conexión',
  aprendizaje: 'Aprendizaje',
  nota: 'Nota',
  obra: 'Libro o película',
  idea: 'Idea',
  trabajo: 'Trabajo',
  intercambio: 'Dar y recibir',
  dato: 'Dato de su ficha',
  preguntar: 'Para preguntarle',
  visita: 'Lugar visitado',
  enlace: 'Enlace para leer',
};

/** Nombre corto de una pieza (para los chips de la vista previa). */
export function pieceName(p: Piece) {
  if (p.kind === 'obra') return p.media === 'Libro' ? 'Libro' : p.series ? 'Serie' : 'Película';
  if (p.kind === 'idea' && p.as === 'trabajo') return 'Idea de proyecto';
  return pieceLabels[p.kind];
}

// ───────────────────────── Fechas en lenguaje natural ─────────────────────────

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};
const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};
const weekdayOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};
const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha explícita: «15 de noviembre», «15/11», «el 15». */
function explicitDate(t: string, today: string, future: boolean): string | null {
  const year = Number(today.slice(0, 4));
  const fix = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let date = `${y}-${pad(m)}-${pad(d)}`;
    if (future && date < today) date = `${y + 1}-${pad(m)}-${pad(d)}`;
    if (!future && date > today) date = `${y - 1}-${pad(m)}-${pad(d)}`;
    return date;
  };
  let m = t.match(
    /\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?: de (\d{4}))?/,
  );
  if (m) {
    const y = m[3] ? Number(m[3]) : year;
    const d = fix(y, MONTHS[m[2]], Number(m[1]));
    return m[3] ? `${m[3]}-${pad(MONTHS[m[2]])}-${pad(Number(m[1]))}` : d;
  }
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    if (m[3]) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    }
    return fix(year, Number(m[2]), Number(m[1]));
  }
  m = t.match(/\b(?:el|este|para el|antes del) (\d{1,2})\b(?! de)/);
  if (m) {
    const month = Number(today.slice(5, 7));
    const d = Number(m[1]);
    let date = fix(year, month, d);
    if (date && future && date < today) date = addMonth(`${year}-${pad(month)}-${pad(d)}`);
    return date;
  }
  return null;
}
function addMonth(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return todayInputValue(new Date(y, m, d));
}

/** Cuándo pasó algo contado en pasado: «ayer», «el viernes», «hace 3 días». */
export function pastDate(text: string, today = todayInputValue()): string | null {
  const t = normalizeText(text);
  if (/\b(anteayer|antier|antes de ayer)\b/.test(t)) return addDays(today, -2);
  if (/\bayer\b/.test(t)) return addDays(today, -1);
  if (/\b(hoy|esta manana|esta tarde|esta noche|hace un rato)\b/.test(t)) return today;
  let m = t.match(/\bhace (\d{1,2}|un|una|dos|tres) (dias?|semanas?)\b/);
  if (m) {
    const n = ({ un: 1, una: 1, dos: 2, tres: 3 } as Record<string, number>)[m[1]] ?? Number(m[1]);
    return addDays(today, -n * (m[2].startsWith('semana') ? 7 : 1));
  }
  if (/\bla semana pasada\b/.test(t)) return addDays(today, -7);
  m = t.match(/\b(?:el|este|el pasado) (lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (m) {
    const back = (weekdayOf(today) - WEEKDAYS[m[1]] + 7) % 7 || 7;
    return addDays(today, -back);
  }
  return explicitDate(t, today, false);
}

/** Para cuándo es algo contado en futuro: «el viernes», «mañana», «la próxima semana». */
export function futureDate(text: string, today = todayInputValue()): string | null {
  const t = normalizeText(text);
  if (/\bpasado manana\b/.test(t)) return addDays(today, 2);
  if (/\bmanana\b/.test(t) && !/\besta manana\b/.test(t)) return addDays(today, 1);
  if (/\b(hoy|esta tarde|esta noche|ahorita|hoy mismo)\b/.test(t)) return today;
  let m = t.match(/\ben (\d{1,2}|un|una|dos|tres) (dias?|semanas?)\b/);
  if (m) {
    const n = ({ un: 1, una: 1, dos: 2, tres: 3 } as Record<string, number>)[m[1]] ?? Number(m[1]);
    return addDays(today, n * (m[2].startsWith('semana') ? 7 : 1));
  }
  if (/\b(la proxima semana|la otra semana|la semana que viene)\b/.test(t)) {
    return addDays(today, (1 - weekdayOf(today) + 7) % 7 || 7);
  }
  if (/\b(este|el) fin de semana\b/.test(t)) return addDays(today, (6 - weekdayOf(today) + 7) % 7);
  if (/\bfin de mes\b/.test(t)) {
    const [y, mo] = today.split('-').map(Number);
    return todayInputValue(new Date(y, mo, 0));
  }
  m = t.match(
    /\b(?:el|este|el proximo|para el|antes del) (lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/,
  );
  if (m) return addDays(today, (WEEKDAYS[m[1]] - weekdayOf(today) + 7) % 7 || 7);
  return explicitDate(t, today, true);
}

/** Quita del texto la expresión de fecha («el viernes», «mañana»…) para dejar solo la acción. */
const DATE_PHRASE =
  /\s*(?:,\s*)?\b(?:pasado mañana|mañana|hoy(?: mismo)?|esta (?:tarde|noche)|(?:el|este|el próximo|para el|antes del) (?:lunes|martes|miércoles|jueves|viernes|sábado|domingo|\d{1,2})|la (?:próxima|otra) semana|la semana que viene|(?:este|el) fin de semana|en \d{1,2} (?:días?|semanas?)|(?:el )?\d{1,2} de \w+)\b/gi;

// ───────────────────────── Personas y lugares mencionados ─────────────────────────

// Las personas se reconocen con `recognize` (nombre, apodo, apellido y parentesco).

/** Palabras con mayúscula que no son nombres de persona. */
const NOT_NAMES = new Set(
  (
    'yo el la los las un una mi su tu hoy ayer manana lunes martes miercoles jueves viernes sabado domingo ' +
    'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre dios ' +
    'whatsapp instagram zoom meet teams google navidad semana santa'
  ).split(' '),
);

// ───────────────────────── Reglas ─────────────────────────

const ACTIVITY: [RegExp, string, string][] = [
  [/\b(almorc|almorzamos|almuerzo)/, 'Comida', 'Almuerzo'],
  [/\b(cene|cenamos|cena\b)/, 'Comida', 'Cena'],
  [/\b(desayun)/, 'Comida', 'Desayuno'],
  [/\b(comimos|comida con)/, 'Comida', 'Comida'],
  [/\b(cafe|tinto)/, 'Café', 'Café'],
  [/\b(videollamada|zoom|meet\b)/, 'Videollamada', 'Videollamada'],
  [/\b(llame|llamada|me llamo|hablamos por telefono)/, 'Llamada', 'Llamada'],
  [/\b(fiesta|celebramos|cumpleanos de)/, 'Fiesta', 'Celebración'],
  [/\b(visite|me visito|fui a su casa|vino a la casa)/, 'Visita', 'Visita'],
  [/\b(paseo|caminamos|fuimos a caminar)/, 'Paseo', 'Paseo'],
  [/\b(viaje|viajamos)/, 'Viaje', 'Viaje'],
  [/\b(reuni|reunion|trabajamos)/, 'Trabajo', 'Reunión'],
  [/\b(jugamos|partido|gimnasio|entrenamos)/, 'Deporte', 'Deporte'],
];
const MEETING =
  /\b(almorc|almorzamos|cene|cenamos|desayun|comimos|me vi con|nos vimos|vi a|visite|me visito|fui con|fuimos|sali con|salimos|tomamos|tome (?:un )?(?:cafe|tinto)|hable con|hablamos|llame a|me llamo|conversamos|conversé|me reuni|nos reunimos|reunion con|estuve con|estuvimos|celebramos|jugamos|pasamos|conoci a)/;

const MONEY_OUT =
  /\b(pague|pagamos|pago (?:la|el)|gaste|gastamos|costo|costaron|me cobraron|compre|compramos|inverti|le preste|preste|aporte|transferi|consigne|propina|di\b)/;
const MONEY_IN =
  /\b(me pagaron|me pago|recibi|cobre|me dieron|gane|vendi|me devolvio|me devolvieron|me transfirieron|me consignaron|me prestaron)/;
const AMOUNT =
  /(\$\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+(?:,\d+)?)\s*(mil(?:lones?)?|millon(?:es)?|k\b|lucas|barras)?/gi;

const CATEGORY_OUT: [RegExp, string][] = [
  [
    /\b(almuerz|almorc|comida|cena|cene|desayun|cafe|restaurante|pizza|hamburguesa|mercado|onces)/,
    'Comida',
  ],
  [
    /\b(taxi|uber|didi|bus|gasolina|peaje|parqueadero|vuelo|tiquete|pasaje|transporte)/,
    'Transporte',
  ],
  [/\b(cine|concierto|bar|fiesta|entrada|boleta|cerveza|trago|juego)/, 'Ocio'],
  [/\b(medico|farmacia|drogueria|consulta|examen|odontolog|terapia)/, 'Salud'],
  [/\b(arriendo|servicios|internet|luz|agua|aseo|hogar)/, 'Hogar'],
  [/\b(curso|libro|universidad|clase|matricula)/, 'Educación'],
  [/\b(ahorro|ahorre)/, 'Ahorro'],
];
const CATEGORY_IN: [RegExp, string][] = [
  [/\b(salario|sueldo|nomina|quincena)/, 'Salario'],
  [/\b(vendi|venta)/, 'Ventas'],
  [/\b(regalo|regalaron)/, 'Regalo'],
  [/\b(devolvio|devolvieron|reembolso)/, 'Reembolso'],
];

const UPDATE_RULES: [RegExp, UpdateKind][] = [
  [
    /\b(esta|anda|sigue) buscando (trabajo|empleo|chamba)|consiguio (trabajo|empleo)|empezo a trabajar|tiene (un )?trabajo nuevo|nuevo trabajo|(la|lo) ascendieron|renuncio|(lo|la) despidieron|se quedo sin (trabajo|empleo)|cambio de trabajo|esta trabajando en/,
    'trabajo',
  ],
  [
    /\bse graduo|esta estudiando|empezo (la|una|su) (maestria|carrera|especializacion)|entro a (la universidad|estudiar)|termino (la|su) (carrera|tesis)/,
    'estudios',
  ],
  [
    /\b(esta|anda) enferm|(la|lo) operaron|esta en el hospital|se lesiono|se fracturo|esta en tratamiento|se esta recuperando/,
    'salud',
  ],
  [
    /\bse caso|se va a casar|se comprometio|tiene novi[oa]|termino con su|se separo|se divorcio|esta saliendo con/,
    'amor',
  ],
  [
    /\besta embarazada|va a ser (mama|papa)|tuvo (un|una) beb|nacio su|murio su|fallecio su/,
    'familia',
  ],
  [/\bse mudo|se va a mudar|compro (casa|apartamento|apto)|se fue a vivir/, 'hogar'],
  [/\b(gano|lanzo|abrio su|monto su|termino su primera)/, 'logro'],
  [/\bse va (de viaje|a viajar)|viaja a|esta de viaje|se va para/, 'viaje'],
  [
    /\b(esta|anda) (muy )?(triste|feliz|estresad|deprimid|content|preocupad|cansad|agotad|ilusionad)/,
    'animo',
  ],
];

const PROMISE =
  /\b(?:le |les )?(prometi|quede en|me comprometi a|le ofreci|le dije que le (?:iba a )?)\s+/;
const WANT = /\b(tengo que|debo|necesito|voy a|me toca|hay que)\s+/;
const WAIT =
  /\b(me va a|me van a|quedo en|quedaron en|estoy esperando (?:que )?|espero que (?:me )?)\s*/;
const DEPENDS = /\bdepende de\s+/;
const LEARN = /\b(aprendi(?: que)?|descubri que|me enseno(?: que)?|entendi que)\s+/;

const capital = (s: string) => {
  const t = s.trim().replace(/[\s,;.]+$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

/** Divide el texto en frases y separa «… y le prometí…» en dos partes. */
function clauses(text: string) {
  const out: { text: string; start: number }[] = [];
  // Un punto entre dígitos es separador de miles («48.000»), no fin de frase.
  const re = /(?:[^.!?\n]|(?<=\d)\.(?=\d))+[.!?]?/g;
  for (const m of text.matchAll(re)) {
    const s = m[0];
    const start = m.index ?? 0;
    const norm = normalizeText(s);
    const split = norm.search(
      /[,;]?\s+(?:y|pero)\s+(?=(?:le |les )?(?:prometi|quede en|me comprometi|tengo que|me va a|quedo en|aprendi|descubri)\b)/,
    );
    if (split > 0) {
      out.push({ text: s.slice(0, split), start });
      const rest = s.slice(split).replace(/^[,;]?\s+(?:y|pero)\s+/i, '');
      out.push({ text: rest, start: start + s.length - rest.length });
    } else out.push({ text: s, start });
  }
  return out.filter((c) => c.text.trim().length > 1);
}

const uid = () => crypto.randomUUID();

/**
 * Propuesta de piezas a partir de un texto libre («Ayer almorcé con Laura en Café Norte. Pagué
 * 48.000…»): encuentro, movimiento, novedades, compromisos, conexiones y aprendizajes. Todo se
 * revisa antes de guardar. Es determinista y local; la IA puede afinarla después.
 */
export function proposeCapture(
  text: string,
  ws: Workspace,
  today = todayInputValue(),
): CapturePlan {
  const source = text.trim();
  // La fecha de un cumpleaños o la de un enlace no dicen cuándo pasó lo que cuentas.
  const date = pastDate(source.replace(BIRTHDAY_DATE, ' ').replace(URL_RE, ' '), today) ?? today;
  const lastSeen = (id: string) =>
    ws.entries.find((e) => e.person_ids.includes(id))?.created_at ?? '';
  const rec = recognize(source, ws.people, ws.ties ?? [], (id) => Date.parse(lastSeen(id)) || 0);
  const mentions: Mention[] = [...rec.mentions];
  const newPeople: NewPerson[] = [];

  // Parentescos: «mi mamá» ya vinculada es esa persona; si aún no se sabe quién es, un comodín
  // que eliges antes de guardar; «mi tío Carlos» sin ese vínculo propone guardarlo.
  const kinLinks: KinLink[] = [];
  for (const c of rec.cues) {
    const base = { label: c.label, kind: c.kind, gender: c.gender, owner: c.owner, save: true };
    if (c.status === 'unknown') {
      const id = 'kin:' + uid();
      kinLinks.push({ ...base, id, personId: null });
      mentions.push({
        start: c.start,
        end: c.end,
        text: source.slice(c.start, c.end),
        ids: [id],
        why: c.label,
        strength: 2,
      });
    } else if (c.status === 'confirm' && c.newName) {
      let fresh = newPeople.find((n) => normalizeText(n.name) === normalizeText(c.newName!));
      if (!fresh) newPeople.push((fresh = { id: 'new:' + uid(), name: c.newName, on: true }));
      kinLinks.push({ ...base, id: 'kl:' + uid(), personId: fresh.id });
      mentions.push({
        start: c.start,
        end: c.end,
        text: source.slice(c.start, c.end),
        ids: [fresh.id],
        why: c.label,
        strength: 2,
      });
    } else if (c.status === 'confirm' && c.ids.length === 1) {
      kinLinks.push({ ...base, id: 'kl:' + uid(), personId: c.ids[0] });
    }
  }
  mentions.sort((a, b) => a.start - b.start);

  const pick = (ids: string[]) =>
    [...ids].sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)))[0];
  const seenAmbiguous = new Set<string>();
  const ambiguous = mentions
    .filter((m) => m.ids.length > 1 && !m.group)
    .filter((m) => {
      const k = m.ids.slice().sort().join();
      return !seenAmbiguous.has(k) && seenAmbiguous.add(k);
    })
    .map((m) => ({ name: m.text, ids: m.ids, chosen: pick(m.ids) }));
  /** Personas de un tramo: todas si es un grupo («los Gómez»), la más probable si es ambiguo. */
  const resolved = (m: Mention) => (m.group ? m.ids : m.ids.length > 1 ? [pick(m.ids)] : m.ids);
  const peopleIn = (start: number, end: number) => [
    ...new Set(mentions.filter((m) => m.start >= start && m.end <= end).flatMap(resolved)),
  ];
  const allPeople = [...new Set(mentions.flatMap(resolved))];

  // Nombres nuevos: «con Mariana», «conocí a Pedro», «el contacto de Andrés».
  const nameRe =
    /\b(?:con|conoc[ií] a|vi a|llam[ée] a|present[ée] a|contacto de|n[úu]mero de|tel[ée]fono de|correo de)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/g;
  for (const m of source.matchAll(nameRe)) {
    const name = m[1];
    const at = (m.index ?? 0) + m[0].length - name.length;
    if (mentions.some((x) => at >= x.start && at < x.end)) continue;
    if (NOT_NAMES.has(normalizeText(name.split(' ')[0]))) continue;
    if (ws.places.some((p) => normalizeText(p.name).startsWith(normalizeText(name)))) continue;
    if (!newPeople.some((n) => normalizeText(n.name) === normalizeText(name)))
      newPeople.push({ id: 'new:' + uid(), name, on: true });
  }
  const newIdsIn = (s: string) =>
    newPeople.filter((n) => normalizeText(s).includes(normalizeText(n.name))).map((n) => n.id);

  const norm = normalizeText(source);
  const pieces: Piece[] = [];

  // Lugar: uno conocido nombrado en el texto o «en <Nombre propio>».
  let placeId: string | null = null;
  let placeName = '';
  const known = ws.places
    .filter((p) => p.name.trim().length >= 3 && norm.includes(normalizeText(p.name.trim())))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (known) placeId = known.id;
  else {
    const m = source.match(
      /\ben\s+((?:[A-ZÁÉÍÓÚÑ][\wáéíóúñ'’-]*)(?:\s+(?:de|del|la|el|y)?\s*[A-ZÁÉÍÓÚÑ][\wáéíóúñ'’-]*){0,3})/,
    );
    // «fui al Parque Simón Bolívar», «visité Monserrate».
    const v = m ?? source.match(VISIT_PLACE);
    if (
      v &&
      !NOT_NAMES.has(normalizeText(v[1].split(' ')[0])) &&
      !mentions.some((x) => source.indexOf(v[1]) === x.start) &&
      !newPeople.some((x) => normalizeText(x.name) === normalizeText(v[1]))
    )
      placeName = v[1].trim();
  }

  // Encuentro: un verbo de encuentro con alguien, o personas en algo contado en pasado.
  const act = ACTIVITY.find(([re]) => re.test(norm));
  const mainPeople = allPeople.length || newPeople.length;
  let mainPerson: string | null = allPeople[0] ?? newPeople[0]?.id ?? null;
  if (mainPeople && MEETING.test(norm)) {
    const firstClause = clauses(source)[0];
    const who = [
      ...new Set([
        ...peopleIn(0, firstClause.start + firstClause.text.length),
        ...newIdsIn(firstClause.text),
      ]),
    ];
    const ids = who.length
      ? who
      : allPeople.length
        ? [allPeople[0]]
        : newPeople.slice(0, 1).map((n) => n.id);
    mainPerson = ids[0] ?? mainPerson;
    const names = ids
      .map(
        (id) =>
          ws.people.find((p) => p.id === id)?.name.split(' ')[0] ??
          newPeople.find((n) => n.id === id)?.name.split(' ')[0] ??
          kinLinks.find((k) => k.id === id)?.label,
      )
      .filter(Boolean);
    const place = placeId ? ws.places.find((p) => p.id === placeId)!.name : placeName;
    const what = act?.[2] ?? 'Encuentro';
    pieces.push({
      id: uid(),
      kind: 'encuentro',
      on: true,
      evidence: firstClause.text.trim(),
      personIds: ids,
      placeId,
      placeName: placeId ? '' : placeName,
      placeKind: guessPlaceKind(placeName, act?.[1]),
      date,
      activity: act?.[1] ?? '',
      title:
        `${what}${names.length ? ' con ' + names.join(', ') : ''}${place ? ' · ' + place : ''}`.slice(
          0,
          180,
        ),
    });
  }

  // Enlaces: van a Lecturas. Se quitan del texto que se analiza (sus puntos partirían frases).
  for (const m of source.matchAll(URL_RE)) {
    const url = cleanUrl(m[0]);
    const around = clauses(source.replace(URL_RE, (u) => ' '.repeat(u.length))).find(
      (c) => (m.index ?? 0) >= c.start && (m.index ?? 0) <= c.start + c.text.length + 1,
    );
    const who = around ? peopleIn(around.start, around.start + around.text.length) : [];
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (pieces.some((p) => p.kind === 'enlace' && p.url === url)) continue;
    pieces.push({
      id: uid(),
      kind: 'enlace',
      on: true,
      evidence: around?.text.trim() || url,
      url,
      title: host,
      save: 'lecturas',
      personId: around && sharedIn(around.text) ? (who[0] ?? mainPerson) : (who[0] ?? null),
    });
  }
  const scan = source.replace(URL_RE, (u) => ' '.repeat(u.length));

  for (const c of clauses(scan)) {
    const n = normalizeText(c.text);
    const people = [
      ...new Set([...peopleIn(c.start, c.start + c.text.length), ...newIdsIn(c.text)]),
    ];
    const subject = people[0] ?? mainPerson;
    // Lo específico (una obra, una idea, una pregunta) gana sobre lo genérico (un compromiso).
    let claimed = false;
    let aboutPerson = false;

    // Dinero
    const out = MONEY_OUT.test(n);
    const inn = MONEY_IN.test(n);
    if (out || inn || /\$/.test(c.text)) {
      for (const m of c.text.matchAll(AMOUNT)) {
        const digits = m[2];
        const unit = (m[3] ?? '').toLowerCase();
        if (!m[1] && !unit && !/[.\s]\d{3}/.test(digits) && Number(digits) < 1000) continue;
        if (/^(19|20)\d{2}$/.test(digits) && !m[1] && !unit) continue;
        let value = Number(digits.replace(/[.\s]/g, '').replace(',', '.'));
        if (unit === 'mil' || unit === 'k' || unit === 'lucas' || unit === 'barras') value *= 1000;
        else if (unit.startsWith('millon') || unit.startsWith('millone')) value *= 1e6;
        value = Math.round(value);
        if (!value || value > 1e11) continue;
        const direction: Direction = inn && !out ? 'ingreso' : 'egreso';
        const cats = direction === 'ingreso' ? CATEGORY_IN : CATEGORY_OUT;
        const category =
          cats.find(([re]) => re.test(n))?.[1] ?? cats.find(([re]) => re.test(norm))?.[1] ?? 'Otro';
        const dup = ws.entries.find(
          (e) =>
            e.kind === 'Movimiento' &&
            e.amount === value &&
            e.direction === direction &&
            Math.abs(daysBetween(todayInputValue(new Date(e.created_at)), date)) <= 2,
        );
        pieces.push({
          id: uid(),
          kind: 'movimiento',
          on: !dup,
          evidence: c.text.trim(),
          amount: value,
          direction,
          category,
          date,
          title: category === 'Otro' ? (direction === 'ingreso' ? 'Ingreso' : 'Egreso') : category,
          dupOf: dup?.id,
        });
        break;
      }
    }

    // Una pregunta para la próxima vez («tengo que preguntarle a Laura cómo le fue»).
    const ask = askIn(c.text);
    if (ask && subject) {
      pieces.push({
        id: uid(),
        kind: 'preguntar',
        on: true,
        evidence: c.text.trim(),
        personId: subject,
        text: ask.text,
      });
      claimed = true;
      aboutPerson = true;
    }

    // Libros, películas y series («vimos Dune en Netflix, buenísima»).
    const work = !claimed ? mediaIn(c.text) : null;
    if (work) {
      const recommender = work.recommended ? (people[0] ?? mainPerson) : null;
      pieces.push({
        id: uid(),
        kind: 'obra',
        on: true,
        evidence: c.text.trim(),
        media: work.media,
        series: work.series,
        title: work.title,
        author: work.author,
        platform: work.platform,
        status: work.status,
        rating: work.rating,
        personIds: people.filter((id) => id !== recommender),
        recommendedBy: recommender,
      });
      claimed = true;
    }

    // Ideas («se me ocurrió montar una tienda de plantas»).
    const idea = !claimed ? ideaIn(c.text) : null;
    if (idea) {
      pieces.push({
        id: uid(),
        kind: 'idea',
        on: true,
        evidence: c.text.trim(),
        title: idea.title,
        as: idea.project ? 'trabajo' : 'nota',
      });
      claimed = true;
    }

    // Compromisos
    const promise = !claimed && n.match(PROMISE);
    const wait = !claimed && !promise && n.match(WAIT);
    const depends = !claimed && !promise && !wait && n.match(DEPENDS);
    const want = !claimed && !promise && !wait && !depends && n.match(WANT);
    const hit = promise || wait || depends || want;
    if (hit && hit.index !== undefined) {
      const kind: CommitmentKind = promise
        ? 'prometi'
        : wait
          ? 'espero'
          : depends
            ? 'depende'
            : 'quiero';
      const action = c.text.slice(hit.index + hit[0].length);
      const title = capital(action.replace(DATE_PHRASE, ' ').replace(/\s{2,}/g, ' '));
      if (title.length >= 3) {
        const due = futureDate(action, today) ?? '';
        const inAction = people.filter((id) =>
          normalizeText(action).includes(nameOfNorm(id, ws, newPeople)),
        );
        // A quién se lo prometiste: la persona del texto antes de la acción, o la del encuentro.
        const before = people.filter((id) => !inAction.includes(id));
        const counterpart =
          kind === 'quiero'
            ? (before[0] ?? null)
            : (before[0] ?? (kind === 'prometi' ? mainPerson : inAction[0]) ?? mainPerson);
        const peopleIds = [...new Set([...(counterpart ? [counterpart] : []), ...inAction])];
        pieces.push({
          id: uid(),
          kind: 'compromiso',
          on: true,
          evidence: c.text.trim(),
          title: title.slice(0, 180),
          commitment: kind,
          due,
          personId: counterpart,
          peopleIds,
        });
        // Posible conexión: el compromiso junta a dos personas distintas.
        const other = inAction.find((id) => id !== counterpart);
        if (counterpart && other) {
          pieces.push({
            id: uid(),
            kind: 'conexion',
            on: true,
            evidence: c.text.trim(),
            a: counterpart,
            b: other,
            text: '',
          });
        }
      }
      claimed = true;
    }

    // Trabajo y proyectos («entregué la propuesta al cliente, falta la factura»).
    const job = !claimed ? workIn(c.text) : null;
    if (job) {
      pieces.push({
        id: uid(),
        kind: 'trabajo',
        on: true,
        evidence: c.text.trim(),
        title: job.title,
        stage: job.stage,
        nextStep: job.nextStep,
        due: job.nextStep ? (futureDate(job.nextStep, today) ?? '') : '',
        personIds: people,
      });
      claimed = true;
    }

    // Aprendizaje
    const learn = !claimed ? n.match(LEARN) : null;
    if (learn && learn.index !== undefined) {
      const title = capital(c.text.slice(learn.index + learn[0].length));
      if (title.length >= 3) {
        const book = pieces.find((p): p is MediaPiece => p.kind === 'obra' && p.media === 'Libro');
        // «Terminé «Hábitos atómicos» y aprendí que…»: lo aprendiste del libro.
        const guess = learningSource(n, people.length > 0);
        const from = guess === 'Práctica' && book ? 'Libro' : guess;
        pieces.push({
          id: uid(),
          kind: 'aprendizaje',
          on: true,
          evidence: c.text.trim(),
          title: title.slice(0, 180),
          source: from,
          sourceName:
            from === 'Libro' && book
              ? book.title
              : from === 'Persona' && (people[0] ?? mainPerson)
                ? displayName((people[0] ?? mainPerson)!, ws, newPeople, kinLinks)
                : '',
        });
      }
      claimed = true;
    }

    // Dar y recibir («Laura me ayudó con la mudanza», «le regalé un libro a Pedro»).
    const swap = subject ? exchangeIn(c.text) : null;
    if (swap && subject) {
      pieces.push({
        id: uid(),
        kind: 'intercambio',
        on: true,
        evidence: c.text.trim(),
        personId: subject,
        dir: swap.dir,
        exchange: swap.kind,
        note: swap.note,
        date,
      });
      aboutPerson = true;
    }

    // Datos de su ficha («le encanta el sushi», «quiere una bicicleta», «cumple el 3 de mayo»).
    const fact = subject ? factIn(c.text, date) : null;
    if (fact && subject) {
      pieces.push({
        id: uid(),
        kind: 'dato',
        on: true,
        evidence: c.text.trim(),
        personId: subject,
        field: fact.field,
        label: fact.field === 'fact' ? fact.label : '',
        value: fact.value,
      });
      aboutPerson = true;
    }

    // Novedad de alguien
    const rule = !claimed && !aboutPerson ? UPDATE_RULES.find(([re]) => re.test(n)) : undefined;
    if (rule && subject) {
      let t = c.text.trim();
      // «Laura está buscando trabajo» → «Está buscando trabajo» (ya va en su ficha).
      const name = mentions.find((m) => m.start >= c.start && m.start <= c.start + 2);
      if (name) t = t.slice(name.end - c.start).replace(/^[\s,]+/, '');
      pieces.push({
        id: uid(),
        kind: 'novedad',
        on: true,
        evidence: c.text.trim(),
        personId: subject,
        updateKind: rule[1],
        text: capital(t).slice(0, 500),
        date,
      });
    }
  }

  // Un lugar donde estuviste sin encuentro con nadie: «fui al Parque Simón Bolívar».
  const enc = pieces.find((p) => p.kind === 'encuentro') as EncounterPiece | undefined;
  if (!enc && (placeId || placeName) && VISIT.test(norm)) {
    const place = placeId ? ws.places.find((p) => p.id === placeId)!.name : placeName;
    const visitClause =
      clauses(scan).find((c) => normalizeText(c.text).includes(normalizeText(place))) ??
      clauses(scan)[0];
    pieces.unshift({
      id: uid(),
      kind: 'visita',
      on: true,
      evidence: visitClause.text.trim(),
      placeId,
      placeName: placeId ? '' : placeName,
      placeKind: guessPlaceKind(placeName, act?.[1]),
      activity: act?.[1] ?? '',
      title: `${act?.[2] ?? 'Visita'} · ${place}`.slice(0, 180),
      date,
    });
  }

  // Texto de la conexión, con el motivo si hay una novedad de esa persona.
  for (const p of pieces) {
    if (p.kind !== 'conexion') continue;
    const nameA = displayName(p.a, ws, newPeople, kinLinks);
    const nameB = displayName(p.b, ws, newPeople, kinLinks);
    const need = pieces.find((x) => x.kind === 'novedad' && x.personId === p.a) as
      UpdatePiece | undefined;
    p.text = `${nameB} podría ayudar a ${nameA}${need ? `: ${need.text.charAt(0).toLowerCase()}${need.text.slice(1)}` : ''}`;
  }

  if (!pieces.length) {
    pieces.push({ id: uid(), kind: 'nota', on: true, evidence: source, text: source });
  }

  const mood = moodIn(scan);
  const first = pieces[0];
  return {
    text: source,
    date,
    pieces,
    newPeople,
    ambiguous,
    kinLinks,
    mood,
    episode: {
      // Solo si hay algo que las una: un encuentro, una visita o un viaje, una celebración…
      on:
        pieces.length >= 2 &&
        (Boolean(enc) || first.kind === 'visita' || episodeKindFor(norm, false) !== 'otro'),
      title: (
        enc?.title ??
        (first.kind === 'visita' ? first.title : null) ??
        capital(scan.replace(/\s{2,}/g, ' ').split(/[.!?\n]/)[0] ?? 'Experiencia')
      ).slice(0, 120),
      kind: episodeKindFor(norm, Boolean(enc)),
    },
  };
}

/** Qué clase de episodio parece: un viaje, una celebración, un evento, un proyecto… */
function episodeKindFor(n: string, encounter: boolean): EpisodeKind {
  if (/\b(viaje|viajamos|vuelo|hotel|aeropuerto|vacaciones|hostal|airbnb)\b/.test(n))
    return 'viaje';
  if (
    /\b(boda|matrimonio|aniversario|grado|graduacion|bautizo|baby shower|despedida|celebramos|festejamos|fiesta)\b/.test(
      n,
    ) ||
    /\b(fue|es hoy|era|celebramos el) (el |su )?cumpleanos\b/.test(n)
  )
    return 'celebracion';
  if (
    /\b(concierto|conferencia|festival|feria|congreso|charla|obra de teatro|partido|evento|torneo)\b/.test(
      n,
    )
  )
    return 'evento';
  if (/\b(mudanza|me mude|nos mudamos|trasteo|nuevo apartamento|nueva casa)\b/.test(n))
    return 'mudanza';
  if (/\b(proyecto|cliente|lanzamiento|startup|emprendimiento|propuesta|contrato)\b/.test(n))
    return 'proyecto';
  return encounter ? 'encuentro' : 'otro';
}

function guessPlaceKind(name: string, activity?: string): PlaceKind {
  const n = normalizeText(name);
  if (/\b(cafe|coffee|tienda de cafe)\b/.test(n) || activity === 'Café') return 'cafe';
  if (/\b(restaurante|asadero|pizzeria|cocina|parrilla)\b/.test(n) || activity === 'Comida')
    return 'comida';
  if (/\b(bar|pub|cerveceria|discoteca)\b/.test(n)) return 'bar';
  if (
    /\b(parque|playa|montana|rio|lago|reserva|jardin|botanico|sendero|cerro|bosque|cascada)\b/.test(
      n,
    )
  )
    return 'naturaleza';
  if (/\b(oficina|cowork|empresa)\b/.test(n) || activity === 'Trabajo') return 'trabajo';
  if (/\b(teatro|museo|cine|galeria|biblioteca)\b/.test(n)) return 'cultura';
  if (/\b(gimnasio|gym|cancha|estadio)\b/.test(n) || activity === 'Deporte') return 'deporte';
  return 'otro';
}

function displayName(id: string, ws: Workspace, fresh: NewPerson[], kin: KinLink[] = []) {
  return (
    ws.people.find((p) => p.id === id)?.name.split(' ')[0] ??
    fresh.find((n) => n.id === id)?.name.split(' ')[0] ??
    kin.find((k) => k.id === id)?.label ??
    'alguien'
  );
}
function nameOfNorm(id: string, ws: Workspace, fresh: NewPerson[]) {
  return normalizeText(displayName(id, ws, fresh));
}

// ───────────────────────── Propuesta de la IA ─────────────────────────

type AiPiece = Record<string, unknown> & { kind?: string };

/**
 * Convierte la propuesta de la IA en piezas válidas. Solo acepta ids de personas y lugares que
 * existen (o nombres nuevos), fechas AAAA-MM-DD y montos positivos; lo demás se descarta.
 */
export function planFromAi(
  raw: unknown,
  base: CapturePlan,
  ws: Workspace,
  today = todayInputValue(),
): CapturePlan {
  const obj = (raw ?? {}) as {
    date?: unknown;
    pieces?: unknown;
    new_people?: unknown;
    episode_title?: unknown;
  };
  const isDate = (v: unknown): v is string =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const date = isDate(obj.date) ? obj.date : base.date;
  const newPeople: NewPerson[] = Array.isArray(obj.new_people)
    ? obj.new_people
        .map((n) => str(n, 120))
        .filter((n) => n && !ws.people.some((p) => normalizeText(p.name) === normalizeText(n)))
        .map((name) => ({ id: 'new:' + uid(), name, on: true }))
    : base.newPeople;
  const personId = (v: unknown): string | null => {
    const s = str(v, 200);
    if (!s) return null;
    if (ws.people.some((p) => p.id === s)) return s;
    const byName = ws.people.find((p) => normalizeText(p.name) === normalizeText(s));
    if (byName) return byName.id;
    const fresh = newPeople.find((n) => normalizeText(n.name) === normalizeText(s));
    return fresh?.id ?? null;
  };
  const ids = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.map(personId).filter((x): x is string => Boolean(x)))] : [];
  const updateKinds: UpdateKind[] = [
    'trabajo',
    'estudios',
    'salud',
    'amor',
    'familia',
    'hogar',
    'logro',
    'viaje',
    'animo',
    'otro',
  ];
  const commitments: CommitmentKind[] = ['quiero', 'prometi', 'espero', 'depende'];
  const pieces: Piece[] = [];
  for (const p of (Array.isArray(obj.pieces) ? obj.pieces : []) as AiPiece[]) {
    const evidence = str(p.evidence, 400);
    switch (p.kind) {
      case 'encuentro': {
        const place = ws.places.find(
          (x) => x.id === p.place_id || normalizeText(x.name) === normalizeText(str(p.place)),
        );
        pieces.push({
          id: uid(),
          kind: 'encuentro',
          on: true,
          evidence,
          personIds: ids(p.people),
          placeId: place?.id ?? null,
          placeName: place ? '' : str(p.place, 120),
          placeKind: 'otro',
          date: isDate(p.date) ? p.date : date,
          activity: str(p.activity, 40),
          title: str(p.title, 180) || 'Encuentro',
        });
        break;
      }
      case 'movimiento': {
        const amount = Number(p.amount);
        if (!(amount > 0)) break;
        const direction: Direction = p.direction === 'ingreso' ? 'ingreso' : 'egreso';
        const d = isDate(p.date) ? p.date : date;
        const dup = ws.entries.find(
          (e) =>
            e.kind === 'Movimiento' &&
            e.amount === amount &&
            e.direction === direction &&
            Math.abs(daysBetween(todayInputValue(new Date(e.created_at)), d)) <= 2,
        );
        const category = str(p.category, 40) || 'Otro';
        pieces.push({
          id: uid(),
          kind: 'movimiento',
          on: !dup,
          evidence,
          amount,
          direction,
          category,
          date: d,
          title: str(p.title, 180) || category,
          dupOf: dup?.id,
        });
        break;
      }
      case 'novedad': {
        const who = personId(p.person);
        if (!who || !str(p.text)) break;
        const uk = updateKinds.includes(p.update_kind as UpdateKind)
          ? (p.update_kind as UpdateKind)
          : 'otro';
        pieces.push({
          id: uid(),
          kind: 'novedad',
          on: true,
          evidence,
          personId: who,
          updateKind: uk,
          text: str(p.text),
          date: isDate(p.date) ? p.date : date,
        });
        break;
      }
      case 'compromiso': {
        const title = str(p.title, 180);
        if (!title) break;
        const k = commitments.includes(p.commitment as CommitmentKind)
          ? (p.commitment as CommitmentKind)
          : 'quiero';
        const counterpart = personId(p.person);
        pieces.push({
          id: uid(),
          kind: 'compromiso',
          on: true,
          evidence,
          title,
          commitment: k,
          due: isDate(p.due) && p.due >= addDays(today, -30) ? p.due : '',
          personId: counterpart,
          peopleIds: [...new Set([...(counterpart ? [counterpart] : []), ...ids(p.people)])],
        });
        break;
      }
      case 'conexion': {
        const a = personId(p.a);
        const b = personId(p.b);
        if (a && b && a !== b)
          pieces.push({
            id: uid(),
            kind: 'conexion',
            on: true,
            evidence,
            a,
            b,
            text: str(p.text, 300),
          });
        break;
      }
      case 'aprendizaje': {
        if (!str(p.title)) break;
        const from = str(p.source, 20);
        pieces.push({
          id: uid(),
          kind: 'aprendizaje',
          on: true,
          evidence,
          title: str(p.title, 180),
          source: LEARN_SOURCES.includes(from)
            ? from
            : learningSource(normalizeText(evidence), false),
          sourceName: str(p.source_name, 120),
        });
        break;
      }
      case 'nota':
        if (str(p.text))
          pieces.push({ id: uid(), kind: 'nota', on: true, evidence, text: str(p.text, 4000) });
        break;
      case 'obra': {
        const title = str(p.title, 120);
        if (!title) break;
        const kind = normalizeText(str(p.media, 20));
        const media = kind === 'libro' ? 'Libro' : 'Película';
        const status = (['quiero', 'curso', 'listo'] as const).find(
          (s) => s === p.status || (s === 'listo' && p.status === 'terminado'),
        );
        const rating = Math.round(Number(p.rating));
        pieces.push({
          id: uid(),
          kind: 'obra',
          on: true,
          evidence,
          media,
          series: kind === 'serie' || kind === 'documental' || kind === 'anime',
          title,
          author: media === 'Libro' ? str(p.author, 120) : '',
          platform: media === 'Película' ? str(p.platform, 40) : '',
          status: status ?? (media === 'Libro' ? 'quiero' : 'listo'),
          rating: rating >= 1 && rating <= 5 && status !== 'quiero' ? rating : 0,
          personIds: ids(p.people),
          recommendedBy: personId(p.recommended_by),
        });
        break;
      }
      case 'idea':
        if (str(p.title))
          pieces.push({
            id: uid(),
            kind: 'idea',
            on: true,
            evidence,
            title: str(p.title, 180),
            as: p.project === true ? 'trabajo' : 'nota',
          });
        break;
      case 'trabajo': {
        const title = str(p.title, 180);
        if (!title) break;
        const stage = (['idea', 'curso', 'pausa', 'listo'] as const).find((s) => s === p.stage);
        pieces.push({
          id: uid(),
          kind: 'trabajo',
          on: true,
          evidence,
          title,
          stage: stage ?? 'curso',
          nextStep: str(p.next_step, 180),
          due: isDate(p.due) && p.due >= addDays(today, -30) ? p.due : '',
          personIds: ids(p.people),
        });
        break;
      }
      case 'intercambio': {
        const who = personId(p.person);
        const kind = EXCHANGES.find((k) => k === p.exchange);
        if (!who || !kind) break;
        pieces.push({
          id: uid(),
          kind: 'intercambio',
          on: true,
          evidence,
          personId: who,
          dir: p.dir === 'dar' ? 'dar' : 'recibir',
          exchange: kind,
          note: str(p.note, 120),
          date: isDate(p.date) ? p.date : date,
        });
        break;
      }
      case 'dato': {
        const who = personId(p.person);
        const field = (['likes', 'dislikes', 'gifts', 'birthday', 'fact'] as const).find(
          (f) => f === p.field,
        );
        let value = str(p.value, 120);
        if (field === 'birthday') value = /^\d{2}-\d{2}$/.test(value) ? value : '';
        if (!who || !field || !value) break;
        pieces.push({
          id: uid(),
          kind: 'dato',
          on: true,
          evidence,
          personId: who,
          field,
          label: field === 'fact' ? str(p.label, 40) || 'Dato' : '',
          value,
        });
        break;
      }
      case 'preguntar': {
        const who = personId(p.person);
        if (who && str(p.text))
          pieces.push({
            id: uid(),
            kind: 'preguntar',
            on: true,
            evidence,
            personId: who,
            text: str(p.text, 200),
          });
        break;
      }
      case 'visita': {
        const place = ws.places.find(
          (x) => x.id === p.place_id || normalizeText(x.name) === normalizeText(str(p.place)),
        );
        const name = place?.name ?? str(p.place, 120);
        if (!name) break;
        pieces.push({
          id: uid(),
          kind: 'visita',
          on: true,
          evidence,
          placeId: place?.id ?? null,
          placeName: place ? '' : name,
          placeKind: place?.kind ?? guessPlaceKind(name, str(p.activity, 40)),
          activity: str(p.activity, 40),
          title: str(p.title, 180) || `Visita · ${name}`,
          date: isDate(p.date) ? p.date : date,
        });
        break;
      }
      case 'enlace': {
        const url = cleanUrl(str(p.url, 2000));
        if (!/^https?:\/\//.test(url)) break;
        pieces.push({
          id: uid(),
          kind: 'enlace',
          on: true,
          evidence,
          url,
          title: str(p.title, 180) || url,
          save: 'lecturas',
          personId: personId(p.person),
        });
        break;
      }
    }
  }
  if (!pieces.length) return base;
  // Los enlaces del texto no se pierden aunque la IA los omita.
  for (const l of base.pieces)
    if (l.kind === 'enlace' && !pieces.some((x) => x.kind === 'enlace' && x.url === l.url))
      pieces.push(l);
  const moodName = normalizeText(str((obj as { mood?: unknown }).mood, 20));
  const mood = moods.find((m) => normalizeText(m.label) === moodName)?.value ?? base.mood;
  return {
    ...base,
    date,
    pieces,
    newPeople,
    mood,
    episode: {
      ...base.episode,
      on:
        pieces.length >= 2 &&
        (base.episode.on || pieces.some((p) => p.kind === 'encuentro' || p.kind === 'visita')),
      title: str(obj.episode_title, 120) || base.episode.title,
    },
  };
}

const LEARN_SOURCES = ['Libro', 'Curso', 'Video', 'Artículo', 'Persona', 'Práctica'];
const EXCHANGES: ExchangeKind[] = ['favor', 'regalo', 'apoyo', 'tiempo', 'dinero', 'iniciativa'];
