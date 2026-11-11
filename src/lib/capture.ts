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
} from "../data";
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
} from "./captureRules";
import { moods } from "../composer/controls";
import { guessCategory } from "./captureCategories";
import { suggestConnections } from "./captureConnections";
import {
  findDate,
  futureDate,
  startsWithDate,
  stripDates,
} from "./captureDates";
import { markDuplicates } from "./captureDuplicates";
import {
  contentWords,
  learnedPerson,
  readMemory,
  usuallyDropped,
} from "./captureMemory";
import {
  addDays,
  friendlyDate,
  money,
  normalizeText,
  todayInputValue,
} from "./format";
import { recognize, type Mention } from "./recognize";

// ───────────────────────── Piezas de una experiencia ─────────────────────────

type Base = {
  id: string;
  /** Si se guarda (puedes excluir cualquier pieza antes de guardar). */
  on: boolean;
  /** Frase del texto original de la que salió. */
  evidence: string;
  /** Ya existe en Nexo: empieza apagada y, si es un recuerdo (`id`), se enlaza al episodio. */
  dup?: { id: string | null; text: string };
  /** Por qué se propuso o qué conviene revisar («Por su oficio», «Sueles descartar esto»). */
  hint?: string;
};
export type EncounterPiece = Base & {
  kind: "encuentro";
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
  kind: "movimiento";
  amount: number;
  direction: Direction;
  category: string;
  date: string;
  title: string;
  /** Por qué esa categoría («por el lugar», «como la última vez con «rappi»»). */
  why?: string;
  /** Lo que se dijo junto al monto: de aquí aprende la categoría si la corriges. */
  cue?: string;
  /** No se dijo si lo pagaste o te lo pagaron: se tomó como gasto. */
  guessed?: boolean;
};
export type UpdatePiece = Base & {
  kind: "novedad";
  personId: string;
  updateKind: UpdateKind;
  text: string;
  date: string;
};
export type CommitmentPiece = Base & {
  kind: "compromiso";
  title: string;
  commitment: CommitmentKind;
  /** AAAA-MM-DD o vacío. */
  due: string;
  /** A quién se lo prometiste / de quién lo esperas. */
  personId: string | null;
  /** Todas las personas que aparecen en el compromiso. */
  peopleIds: string[];
};
export type ConnectionPiece = Base & {
  kind: "conexion";
  a: string;
  b: string;
  text: string;
};
export type LearningPiece = Base & {
  kind: "aprendizaje";
  title: string;
  /** Libro, Curso, Video, Artículo, Persona o Práctica (como en el formulario). */
  source: string;
  sourceName: string;
};
export type NotePiece = Base & { kind: "nota"; text: string };
/** Un libro, una película o una serie: vista, leyendo, por ver… con calificación. */
export type MediaPiece = Base & {
  kind: "obra";
  media: "Libro" | "Película";
  series: boolean;
  title: string;
  author: string;
  platform: string;
  /**
   * quiero: por ver o leer; curso: leyéndolo o viéndola; listo: terminado o vista.
   * estante (solo libros): lo tienes en tu estantería, sin decir si lo leerás.
   */
  status: "estante" | "quiero" | "curso" | "listo";
  /** Libros: tu ejemplar en papel («mio», va a tu estantería) o prestado («prestado»). */
  copy: "mio" | "prestado" | "";
  /** Libro que ya está en tu estantería sin empezar: se actualiza su estado en vez de duplicarlo. */
  shelfId?: string;
  /** Libro que ya habías terminado: qué lectura es esta (2 = la segunda). */
  readNo?: number;
  rating: number;
  /** Con quién la viste o quién aparece. */
  personIds: string[];
  /** Quién te la recomendó (o te prestó el libro). */
  recommendedBy: string | null;
};
export type IdeaPiece = Base & {
  kind: "idea";
  title: string;
  /** nota: idea suelta; trabajo: proyecto en etapa «Idea». */
  as: "nota" | "trabajo";
};
export type WorkPiece = Base & {
  kind: "trabajo";
  title: string;
  stage: "idea" | "curso" | "pausa" | "listo";
  nextStep: string;
  due: string;
  personIds: string[];
};
/** Algo que diste o recibiste: alimenta «Dar y recibir» en su ficha. */
export type ExchangePiece = Base & {
  kind: "intercambio";
  personId: string;
  dir: "dar" | "recibir";
  exchange: ExchangeKind;
  note: string;
  date: string;
};
/** Un dato de su ficha: gustos, lo que no le gusta, ideas de regalo, cumpleaños u otro dato. */
export type FactPiece = Base & {
  kind: "dato";
  personId: string;
  field: "likes" | "dislikes" | "gifts" | "birthday" | "fact";
  label: string;
  value: string;
};
/** Para preguntarle la próxima vez («¿Cómo le fue en la entrevista?»). */
export type AskPiece = Base & {
  kind: "preguntar";
  personId: string;
  text: string;
};
/** Un lugar donde estuviste sin un encuentro con alguien: se guarda como nota en ese lugar. */
export type VisitPiece = Base & {
  kind: "visita";
  placeId: string | null;
  placeName: string;
  placeKind: PlaceKind;
  activity: string;
  title: string;
  date: string;
};
/** Un enlace del texto: se guarda en Lecturas (o como nota si no se puede capturar). */
export type LinkPiece = Base & {
  kind: "enlace";
  url: string;
  title: string;
  save: "lecturas" | "nota";
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
export type PieceKind = Piece["kind"];

/** Nombre que no está en tu universo: se puede crear al guardar. */
export type NewPerson = {
  id: string;
  name: string;
  on: boolean;
  /** Alguien que ya tienes con un nombre parecido («Andrez» → Andrés Pérez). */
  like?: string;
};

export type CapturePlan = {
  text: string;
  /** Cuándo pasó. */
  date: string;
  /** La expresión de la que salió la fecha («ayer», «el viernes pasado»). */
  dateFrom?: string;
  /** En un lote: esta experiencia no se guarda. */
  off?: boolean;
  pieces: Piece[];
  newPeople: NewPerson[];
  /** Nombres de pila que coinciden con varias personas (la pieza usa la más probable). */
  ambiguous: {
    name: string;
    ids: string[];
    chosen: string;
    learned?: boolean;
  }[];
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
  encuentro: "Encuentro",
  movimiento: "Movimiento",
  novedad: "Novedad en su ficha",
  compromiso: "Compromiso",
  conexion: "Posible conexión",
  aprendizaje: "Aprendizaje",
  nota: "Entrada al diario",
  obra: "Libro o película",
  idea: "Idea",
  trabajo: "Trabajo",
  intercambio: "Dar y recibir",
  dato: "Dato de su ficha",
  preguntar: "Para preguntarle",
  visita: "Lugar visitado",
  enlace: "Enlace para leer",
};

/** Nombre corto de una pieza (para los chips de la vista previa). */
export function pieceName(p: Piece) {
  if (p.kind === "obra")
    return p.media === "Libro" ? "Libro" : p.series ? "Serie" : "Película";
  if (p.kind === "idea" && p.as === "trabajo") return "Idea de proyecto";
  return pieceLabels[p.kind];
}

// ───────────────────────── Fechas en lenguaje natural ─────────────────────────

// Viven en `captureDates`: «ayer», «hace 2 semanas», «dentro de 2 meses», «en un año», «15/03»…
export { futureDate, pastDate } from "./captureDates";

// ───────────────────────── Personas y lugares mencionados ─────────────────────────

// Las personas se reconocen con `recognize` (nombre, apodo, apellido y parentesco).

/** Palabras con mayúscula que no son nombres de persona. */
const NOT_NAMES = new Set(
  (
    "yo el la los las un una mi su tu hoy ayer manana lunes martes miercoles jueves viernes sabado domingo " +
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre dios " +
    "whatsapp instagram zoom meet teams google navidad semana santa netflix youtube spotify uber " +
    "rappi didi pero luego despues entonces tambien ademas"
  ).split(" "),
);
/** Tratamientos que van antes del nombre («don Pedro», «la doctora Ruiz»). */
const HONORIFIC =
  /^(?:don|doña|dona|señor|senor|señora|senora|doctor|doctora|dr\.?|dra\.?|profe|profesor|profesora)\s+/i;

// ───────────────────────── Reglas ─────────────────────────

const ACTIVITY: [RegExp, string, string][] = [
  [/\b(almorc|almorzamos|almuerzo|almorzar)/, "Comida", "Almuerzo"],
  [/\b(cene|cenamos|cena\b|cenar)/, "Comida", "Cena"],
  [/\b(desayun)/, "Comida", "Desayuno"],
  [/\b(brunch)/, "Comida", "Brunch"],
  [
    /\b(comimos|comida con|fuimos a comer|salimos a comer|onces)/,
    "Comida",
    "Comida",
  ],
  [/\b(cafe|tinto|cafecito)/, "Café", "Café"],
  [
    /\b(videollamada|zoom|meet\b|teams\b|facetime)/,
    "Videollamada",
    "Videollamada",
  ],
  [
    /\b(llame|llamada|me llamo|hablamos por telefono|nos llamamos)/,
    "Llamada",
    "Llamada",
  ],
  [
    /\b(fiesta|celebramos|festejamos|cumpleanos de|rumba|rumbeamos|discoteca|bailamos|cervezas|tragos)/,
    "Fiesta",
    "Celebración",
  ],
  [
    /\b(visite|me visito|fui a su casa|vino a la casa|vinieron a la casa|nos visitaron)/,
    "Visita",
    "Visita",
  ],
  [
    /\b(paseo|caminamos|fuimos a caminar|caminata|senderismo|fuimos al parque)/,
    "Paseo",
    "Paseo",
  ],
  [/\b(viaje|viajamos|nos fuimos de viaje)/, "Viaje", "Viaje"],
  [/\b(reuni|reunion|trabajamos|comite|junta\b)/, "Trabajo", "Reunión"],
  [
    /\b(jugamos|partido|gimnasio|entrenamos|corrimos|montamos bici|nadamos|futbol|tenis|padel)/,
    "Deporte",
    "Deporte",
  ],
];
const MEETING =
  /\b(almorc|almorzamos|cene|cenamos|desayun|comimos|me vi con|nos vimos|vi a|visite|visitamos a|me visito|nos visito|fui con|fuimos|sali con|salimos|tomamos|nos tomamos|tome (?:un )?(?:cafe|tinto)|hable con|hablamos|llame a|me llamo|conversamos|converse|me reuni|nos reunimos|reunion con|estuve con|estuvimos|celebramos|festejamos|jugamos|pasamos|conoci a|me encontre con|nos encontramos|acompane a|recogi a|parchamos|compartimos|cuadramos con|me escribio|nos escribimos)/;

/** Verbos de dinero; con /g para ubicar el más cercano a cada monto. */
const MONEY_OUT =
  /\b(pague|pagamos|pago (?:la|el|los|las)|gaste|gastamos|costo|costaron|me costo|me cobraron|nos cobraron|salio en|salio por|valio|compre|compramos|inverti|le preste|les preste|preste|aporte|transferi|consigne|abone|cancele|propina|di\b|le di|deje de propina|suscripcion|mensualidad)/g;
const MONEY_IN =
  /\b(me pagaron|me pago|nos pagaron|recibi|recibimos|cobre|me dieron|gane|vendi|vendimos|me devolvio|me devolvieron|me transfirieron|me consignaron|me prestaron|me llego|me entro|me entraron|facture|me giraron)/g;

/**
 * Montos: «$48.000», «48 mil», «1,5 millones», «2.5M» no (se confunde con metros), «1'200.000»,
 * «50k», «20 lucas», «un palo», «COP 30000», «500 pesos». Los espacios no separan miles para
 * no confundir teléfonos («300 123 4567») con plata.
 */
const AMOUNT =
  /(\$\s*|\bcop\s*)?(\d{1,3}(?:[.'’,]\d{3})+(?!\d)|\d+(?:[.,]\d{1,2})?(?=\s*(?:mil\b|millon|millones|palos?\b|k\b|lucas|barras))|\d+)\s*(millones|millon|mil\b|palos?\b|k\b|lucas\b|barras\b)?(\s*(?:pesos|cop\b|usd|dolares|euros))?/gi;
const WORD_AMOUNT =
  /\b(un|una|medio|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta|cien)\s+(millones|millon|mil|palos?|lucas|barras)\b/g;
const WORD_NUM: Record<string, number> = {
  un: 1,
  una: 1,
  medio: 0.5,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  veinte: 20,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  cien: 100,
};
/** Después de un número, palabras que dicen que no es plata («3 personas», «20%»). */
const NOT_MONEY_AFTER =
  /^\s*(?:%|personas|gente|dias|horas|minutos|km|kilometros|kilos|anos|veces|libros|paginas|cuotas|meses|semanas|capitulos|episodios|temporadas|estrellas|puntos|grados|am\b|pm\b|de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre))/;

const unitValue = (unit: string) => {
  const u = normalizeText(unit);
  if (u === "mil" || u === "k" || u === "lucas" || u === "barras") return 1000;
  if (u.startsWith("millon") || u.startsWith("palo")) return 1e6;
  return 1;
};

export type AmountHit = { value: number; start: number; end: number; unit: boolean };

/** Los montos de una frase, con su posición (para leer el contexto de cada uno). */
export function amountsIn(text: string): AmountHit[] {
  const n = normalizeText(text);
  const out: AmountHit[] = [];
  for (const m of n.matchAll(AMOUNT)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const digits = m[2];
    const unit = m[3] ?? "";
    const currency = Boolean(m[1] || m[4]);
    const grouped = /[.'’,]\d{3}$/.test(digits);
    if (!currency && !unit && !grouped && Number(digits) < 1000) continue;
    if (/^(19|20)\d{2}$/.test(digits) && !currency && !unit) continue;
    // Teléfonos, cédulas y otros números largos sin signo de plata.
    if (!currency && !unit && !grouped && digits.length >= 9) continue;
    if (NOT_MONEY_AFTER.test(n.slice(end))) continue;
    // «a las 3», «el 15»: horas y días.
    if (
      !currency &&
      !unit &&
      !grouped &&
      /\b(?:a las|las|el|del|al)\s*$/.test(
        n.slice(Math.max(0, start - 7), start),
      )
    )
      continue;
    const clean = grouped
      ? digits.replace(/[.'’,]/g, "")
      : digits.replace(",", ".");
    const value = Math.round(Number(clean) * (unit ? unitValue(unit) : 1));
    if (!value || value > 1e11) continue;
    out.push({ value, start, end, unit: Boolean(unit || currency) });
  }
  for (const m of n.matchAll(WORD_AMOUNT)) {
    const start = m.index ?? 0;
    if (out.some((a) => start < a.end && start + m[0].length > a.start))
      continue;
    out.push({
      value: Math.round(WORD_NUM[m[1]] * unitValue(m[2])),
      start,
      end: start + m[0].length,
      unit: true,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Dirección del monto: el verbo de dinero más cercano antes de él (o después, si no hay). */
export function directionAt(n: string, at: number): Direction | null {
  const verbs: { at: number; end: number; dir: Direction }[] = [];
  for (const m of n.matchAll(MONEY_IN))
    verbs.push({
      at: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      dir: "ingreso",
    });
  for (const m of n.matchAll(MONEY_OUT)) {
    const s = m.index ?? 0;
    // «me pagó la cena»: el «pagó la» de adentro no es un gasto.
    if (verbs.some((v) => v.dir === "ingreso" && s >= v.at && s < v.end))
      continue;
    verbs.push({ at: s, end: s + m[0].length, dir: "egreso" });
  }
  if (!verbs.length) return null;
  const before = verbs.filter((v) => v.at <= at).sort((a, b) => b.at - a.at)[0];
  return (before ?? verbs.sort((a, b) => a.at - b.at)[0]).dir;
}

const UPDATE_RULES: [RegExp, UpdateKind][] = [
  [
    /\b(esta|anda|sigue) buscando (trabajo|empleo|chamba)|consiguio (trabajo|empleo)|empezo a trabajar|tiene (un )?trabajo nuevo|nuevo trabajo|(la|lo) ascendieron|renuncio|(lo|la) despidieron|se quedo sin (trabajo|empleo)|cambio de trabajo|esta trabajando en/,
    "trabajo",
  ],
  [
    /\bse graduo|esta estudiando|empezo (la|una|su) (maestria|carrera|especializacion)|entro a (la universidad|estudiar)|termino (la|su) (carrera|tesis)/,
    "estudios",
  ],
  [
    /\b(esta|anda) enferm|(la|lo) operaron|esta en el hospital|se lesiono|se fracturo|esta en tratamiento|se esta recuperando/,
    "salud",
  ],
  [
    /\bse caso|se va a casar|se comprometio|tiene novi[oa]|termino con su|se separo|se divorcio|esta saliendo con/,
    "amor",
  ],
  [
    /\besta embarazada|va a ser (mama|papa)|tuvo (un|una) beb|nacio su|murio su|fallecio su/,
    "familia",
  ],
  [
    /\bse mudo|se va a mudar|compro (casa|apartamento|apto)|se fue a vivir/,
    "hogar",
  ],
  [/\b(gano|lanzo|abrio su|monto su|termino su primera)/, "logro"],
  [/\bse va (de viaje|a viajar)|viaja a|esta de viaje|se va para/, "viaje"],
  [
    /\b(esta|anda) (muy )?(triste|feliz|estresad|deprimid|content|preocupad|cansad|agotad|ilusionad)/,
    "animo",
  ],
];

const PROMISE =
  /\b(?:le |les )?(prometi|quede en|me comprometi a|le ofreci|le dije que le (?:iba a )?)\s+/;
const WANT = /\b(tengo que|debo|necesito|voy a|me toca|hay que)\s+/;
const WAIT =
  /\b(me va a|me van a|quedo en|quedaron en|estoy esperando (?:que )?|espero que (?:me )?)\s*/;
const DEPENDS = /\bdepende de\s+/;
const LEARN =
  /\b(aprendi(?: que)?|descubri que|me enseno(?: que)?|entendi que)\s+/;

const capital = (s: string) => {
  const t = s.trim().replace(/[\s,;.]+$/, "");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

/** Divide el texto en frases y separa «… y le prometí…» en dos partes. */
function clauses(text: string) {
  const out: { text: string; start: number }[] = [];
  // Un punto entre dígitos es separador de miles («48.000»), no fin de frase.
  const re = /(?:[^.!?;\n]|(?<=\d)\.(?=\d))+[.!?;]?/g;
  for (const m of text.matchAll(re)) {
    const s = m[0];
    const start = m.index ?? 0;
    const norm = normalizeText(s);
    const split = norm.search(
      /[,;]?\s+(?:y|pero|y luego|y despues|luego|despues)\s+(?=(?:le |les )?(?:prometi|quede en|me comprometi|tengo que|me va a|quedo en|aprendi|descubri|pague|pagamos|gaste|compre|me pagaron|me pago|le preste|me presto|me prestaron|se me ocurrio)\b)/,
    );
    if (split > 0) {
      out.push({ text: s.slice(0, split), start });
      const rest = s
        .slice(split)
        .replace(/^[,;]?\s+(?:y luego|y despues|y|pero|luego|despues)\s+/i, "");
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
  memory = readMemory(),
): CapturePlan {
  const source = text.trim();
  // La fecha de un cumpleaños o la de un enlace no dicen cuándo pasó lo que cuentas.
  const dateHit = findDate(
    source
      .replace(BIRTHDAY_DATE, (s) => " ".repeat(s.length))
      .replace(URL_RE, (s) => " ".repeat(s.length)),
    "past",
    today,
  );
  const date = dateHit?.date ?? today;
  const lastSeen = (id: string) =>
    ws.entries.find((e) => e.person_ids.includes(id))?.created_at ?? "";
  const rec = recognize(
    source,
    ws.people,
    ws.ties ?? [],
    (id) => Date.parse(lastSeen(id)) || 0,
  );
  const mentions: Mention[] = [...rec.mentions];
  const newPeople: NewPerson[] = [];

  // Parentescos: «mi mamá» ya vinculada es esa persona; si aún no se sabe quién es, un comodín
  // que eliges antes de guardar; «mi tío Carlos» sin ese vínculo propone guardarlo.
  const kinLinks: KinLink[] = [];
  for (const c of rec.cues) {
    const base = {
      label: c.label,
      kind: c.kind,
      gender: c.gender,
      owner: c.owner,
      save: true,
    };
    if (c.status === "unknown") {
      const id = "kin:" + uid();
      kinLinks.push({ ...base, id, personId: null });
      mentions.push({
        start: c.start,
        end: c.end,
        text: source.slice(c.start, c.end),
        ids: [id],
        why: c.label,
        strength: 2,
      });
    } else if (c.status === "confirm" && c.newName) {
      let fresh = newPeople.find(
        (n) => normalizeText(n.name) === normalizeText(c.newName!),
      );
      if (!fresh)
        newPeople.push(
          (fresh = { id: "new:" + uid(), name: c.newName, on: true }),
        );
      kinLinks.push({ ...base, id: "kl:" + uid(), personId: fresh.id });
      mentions.push({
        start: c.start,
        end: c.end,
        text: source.slice(c.start, c.end),
        ids: [fresh.id],
        why: c.label,
        strength: 2,
      });
    } else if (c.status === "confirm" && c.ids.length === 1) {
      kinLinks.push({ ...base, id: "kl:" + uid(), personId: c.ids[0] });
    }
  }
  mentions.sort((a, b) => a.start - b.start);

  // Un nombre ambiguo: el que elegiste la última vez para ese nombre; si no, con quien hablaste
  // más recientemente.
  const recent = (ids: string[]) =>
    [...ids].sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)))[0];
  const pickFor = (name: string, ids: string[]) =>
    learnedPerson(name, ids, memory) ?? recent(ids);
  const seenAmbiguous = new Set<string>();
  const ambiguous = mentions
    .filter((m) => m.ids.length > 1 && !m.group)
    .filter((m) => {
      const k = m.ids.slice().sort().join();
      return !seenAmbiguous.has(k) && seenAmbiguous.add(k);
    })
    .map((m) => {
      const learned = learnedPerson(m.text, m.ids, memory);
      return {
        name: m.text,
        ids: m.ids,
        chosen: learned ?? recent(m.ids),
        learned: Boolean(learned),
      };
    });
  /** Personas de un tramo: todas si es un grupo («los Gómez»), la más probable si es ambiguo. */
  const resolved = (m: Mention) =>
    m.group ? m.ids : m.ids.length > 1 ? [pickFor(m.text, m.ids)] : m.ids;
  const peopleIn = (start: number, end: number) => [
    ...new Set(
      mentions
        .filter((m) => m.start >= start && m.end <= end)
        .flatMap(resolved),
    ),
  ];
  const allPeople = [...new Set(mentions.flatMap(resolved))];

  // Nombres nuevos: «con Mariana», «conocí a Pedro», «con mi amiga Sofía», «con Laura y Pedro».
  const NAME = "[A-ZÁÉÍÓÚÑ][a-záéíóúñü'’]+(?:\\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñü'’]+)?";
  const nameRe = new RegExp(
    `\\b(?:con|junto a|conoc[ií] a|conocimos a|vi a|llam[ée] a|present[ée] a|me present[óo] a|acompañ[ée] a|recog[ií] a|contacto de|n[úu]mero de|tel[ée]fono de|correo de|donde)\\s+(?:(?:mi|su|tu)\\s+(?:amig[oa]|compañer[oa]|vecin[oa]|colega|jef[ea]|novi[oa]|socio|socia|profe|cliente)\\s+)?((?:don|doña|doctor|doctora|profe)\\s+)?(${NAME})((?:\\s*(?:,|\\by\\b|\\be\\b)\\s*${NAME})*)`,
    "g",
  );
  const addNew = (raw: string, at: number) => {
    const name = raw.replace(HONORIFIC, "").trim();
    if (!name || mentions.some((x) => at >= x.start && at < x.end)) return;
    if (NOT_NAMES.has(normalizeText(name.split(" ")[0]))) return;
    if (
      ws.places.some((p) =>
        normalizeText(p.name).startsWith(normalizeText(name)),
      )
    )
      return;
    if (!newPeople.some((n) => normalizeText(n.name) === normalizeText(name)))
      newPeople.push({ id: "new:" + uid(), name, on: true });
  };
  for (const m of source.matchAll(nameRe)) {
    const first = m[2];
    const firstAt =
      (m.index ?? 0) + m[0].length - (m[3]?.length ?? 0) - first.length;
    addNew(first, firstAt);
    // Los que siguen en la lista («con Laura, Pedro y Ana»).
    if (m[3]) {
      const listAt = (m.index ?? 0) + m[0].length - m[3].length;
      for (const x of m[3].matchAll(new RegExp(NAME, "g")))
        addNew(x[0], listAt + (x.index ?? 0));
    }
  }
  const newIdsIn = (s: string) =>
    newPeople
      .filter((n) => normalizeText(s).includes(normalizeText(n.name)))
      .map((n) => n.id);

  const norm = normalizeText(source);
  const pieces: Piece[] = [];

  // Lugar: uno conocido nombrado en el texto o «en <Nombre propio>».
  let placeId: string | null = null;
  let placeName = "";
  const known = ws.places
    .filter(
      (p) =>
        p.name.trim().length >= 3 &&
        norm.includes(normalizeText(p.name.trim())),
    )
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
      !NOT_NAMES.has(normalizeText(v[1].split(" ")[0])) &&
      !mentions.some((x) => source.indexOf(v[1]) === x.start) &&
      !newPeople.some((x) => normalizeText(x.name) === normalizeText(v[1]))
    )
      placeName = v[1].trim();
  }

  // Encuentro: un verbo de encuentro con alguien, o personas en algo contado en pasado.
  const act = ACTIVITY.find(([re]) => re.test(norm));
  const placeKindNow: PlaceKind | null = placeId
    ? (ws.places.find((p) => p.id === placeId)?.kind ?? null)
    : placeName
      ? guessPlaceKind(placeName, act?.[1])
      : null;
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
          ws.people.find((p) => p.id === id)?.name.split(" ")[0] ??
          newPeople.find((n) => n.id === id)?.name.split(" ")[0] ??
          kinLinks.find((k) => k.id === id)?.label,
      )
      .filter(Boolean);
    const place = placeId
      ? ws.places.find((p) => p.id === placeId)!.name
      : placeName;
    const what = act?.[2] ?? "Encuentro";
    pieces.push({
      id: uid(),
      kind: "encuentro",
      on: true,
      evidence: firstClause.text.trim(),
      personIds: ids,
      placeId,
      placeName: placeId ? "" : placeName,
      placeKind: guessPlaceKind(placeName, act?.[1]),
      date,
      activity: act?.[1] ?? "",
      title:
        `${what}${names.length ? " con " + names.join(", ") : ""}${place ? " · " + place : ""}`.slice(
          0,
          180,
        ),
    });
  }

  // Enlaces: van a Lecturas. Se quitan del texto que se analiza (sus puntos partirían frases).
  for (const m of source.matchAll(URL_RE)) {
    const url = cleanUrl(m[0]);
    const around = clauses(
      source.replace(URL_RE, (u) => " ".repeat(u.length)),
    ).find(
      (c) =>
        (m.index ?? 0) >= c.start &&
        (m.index ?? 0) <= c.start + c.text.length + 1,
    );
    const who = around
      ? peopleIn(around.start, around.start + around.text.length)
      : [];
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (pieces.some((p) => p.kind === "enlace" && p.url === url)) continue;
    pieces.push({
      id: uid(),
      kind: "enlace",
      on: true,
      evidence: around?.text.trim() || url,
      url,
      title: host,
      save: "lecturas",
      personId:
        around && sharedIn(around.text)
          ? (who[0] ?? mainPerson)
          : (who[0] ?? null),
    });
  }
  const scan = source.replace(URL_RE, (u) => " ".repeat(u.length));

  for (const c of clauses(scan)) {
    const n = normalizeText(c.text);
    const people = [
      ...new Set([
        ...peopleIn(c.start, c.start + c.text.length),
        ...newIdsIn(c.text),
      ]),
    ];
    const subject = people[0] ?? mainPerson;
    // Lo específico (una obra, una idea, una pregunta) gana sobre lo genérico (un compromiso).
    let claimed = false;
    let aboutPerson = false;

    // Dinero: cada monto con su dirección y su categoría según lo que se dice junto a él.
    const amounts = amountsIn(c.text);
    const hasVerb =
      new RegExp(MONEY_OUT.source).test(n) ||
      new RegExp(MONEY_IN.source).test(n);
    if (amounts.length && (hasVerb || amounts.some((a) => a.unit))) {
      amounts.slice(0, 4).forEach((a, i) => {
        // Lo que se dice junto al monto: lo que sigue («12 mil del taxi») y lo que va antes
        // desde el monto anterior («el taxi me costó 12 mil»).
        const before = c.text.slice(i ? amounts[i - 1].end : 0, a.start);
        const after = c.text
          .slice(a.end, amounts[i + 1]?.start ?? c.text.length)
          .split(/[,;]|\s(?:y|e|pero|luego|después|despues)\s/i)[0];
        const dir = directionAt(n, a.start);
        const direction: Direction = dir ?? "egreso";
        const guess = guessCategory({
          near: after,
          local: before,
          clause: c.text,
          whole: source,
          direction,
          activity: act?.[1],
          placeKind: placeKindNow,
          entries: ws.entries,
          memory,
        });
        pieces.push({
          id: uid(),
          kind: "movimiento",
          on: true,
          evidence: c.text.trim(),
          amount: a.value,
          direction,
          category: guess.category,
          why: guess.why,
          cue: contentWords(`${after} ${before}`, 6).join(" "),
          guessed: !dir,
          date,
          title:
            guess.category === "Otro"
              ? direction === "ingreso"
                ? "Ingreso"
                : "Egreso"
              : guess.category,
        });
      });
    }

    // Una pregunta para la próxima vez («tengo que preguntarle a Laura cómo le fue»).
    const ask = askIn(c.text);
    if (ask && subject) {
      pieces.push({
        id: uid(),
        kind: "preguntar",
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
        kind: "obra",
        on: true,
        evidence: c.text.trim(),
        media: work.media,
        series: work.series,
        title: work.title,
        author: work.author,
        platform: work.platform,
        status: work.status,
        copy: work.copy,
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
        kind: "idea",
        on: true,
        evidence: c.text.trim(),
        title: idea.title,
        as: idea.project ? "trabajo" : "nota",
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
        ? "prometi"
        : wait
          ? "espero"
          : depends
            ? "depende"
            : "quiero";
      const action = c.text.slice(hit.index + hit[0].length);
      const title = capital(stripDates(action, today));
      if (title.length >= 3) {
        // La fecha puede ir antes del verbo («El viernes tengo que…»), pero «hoy le prometí» no
        // dice para cuándo es.
        const lead = findDate(c.text.slice(0, hit.index), "future", today);
        const due =
          futureDate(action, today) ??
          (lead &&
          !/^(?:hoy|esta|ahorita|en la)/.test(normalizeText(lead.phrase.trim()))
            ? lead.date
            : "");
        const inAction = people.filter((id) =>
          normalizeText(action).includes(nameOfNorm(id, ws, newPeople)),
        );
        // A quién se lo prometiste: la persona del texto antes de la acción, o la del encuentro.
        const before = people.filter((id) => !inAction.includes(id));
        const counterpart =
          kind === "quiero"
            ? (before[0] ?? null)
            : (before[0] ??
              (kind === "prometi" ? mainPerson : inAction[0]) ??
              mainPerson);
        const peopleIds = [
          ...new Set([...(counterpart ? [counterpart] : []), ...inAction]),
        ];
        pieces.push({
          id: uid(),
          kind: "compromiso",
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
            kind: "conexion",
            on: true,
            evidence: c.text.trim(),
            a: counterpart,
            b: other,
            text: "",
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
        kind: "trabajo",
        on: true,
        evidence: c.text.trim(),
        title: job.title,
        stage: job.stage,
        nextStep: job.nextStep,
        due: job.nextStep ? (futureDate(job.nextStep, today) ?? "") : "",
        personIds: people,
      });
      claimed = true;
    }

    // Aprendizaje
    const learn = !claimed ? n.match(LEARN) : null;
    if (learn && learn.index !== undefined) {
      const title = capital(c.text.slice(learn.index + learn[0].length));
      if (title.length >= 3) {
        const book = pieces.find(
          (p): p is MediaPiece => p.kind === "obra" && p.media === "Libro",
        );
        // «Terminé «Hábitos atómicos» y aprendí que…»: lo aprendiste del libro.
        const guess = learningSource(n, people.length > 0);
        const from = guess === "Práctica" && book ? "Libro" : guess;
        pieces.push({
          id: uid(),
          kind: "aprendizaje",
          on: true,
          evidence: c.text.trim(),
          title: title.slice(0, 180),
          source: from,
          sourceName:
            from === "Libro" && book
              ? book.title
              : from === "Persona" && (people[0] ?? mainPerson)
                ? displayName(
                    (people[0] ?? mainPerson)!,
                    ws,
                    newPeople,
                    kinLinks,
                  )
                : "",
        });
      }
      claimed = true;
    }

    // Dar y recibir («Laura me ayudó con la mudanza», «le regalé un libro a Pedro»).
    const swap = subject ? exchangeIn(c.text) : null;
    if (swap && subject) {
      pieces.push({
        id: uid(),
        kind: "intercambio",
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
        kind: "dato",
        on: true,
        evidence: c.text.trim(),
        personId: subject,
        field: fact.field,
        label: fact.field === "fact" ? fact.label : "",
        value: fact.value,
      });
      aboutPerson = true;
    }

    // Novedad de alguien
    const rule =
      !claimed && !aboutPerson
        ? UPDATE_RULES.find(([re]) => re.test(n))
        : undefined;
    if (rule && subject) {
      let t = c.text.trim();
      // «Laura está buscando trabajo» → «Está buscando trabajo» (ya va en su ficha).
      const name = mentions.find(
        (m) => m.start >= c.start && m.start <= c.start + 2,
      );
      if (name) t = t.slice(name.end - c.start).replace(/^[\s,]+/, "");
      pieces.push({
        id: uid(),
        kind: "novedad",
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
  const enc = pieces.find((p) => p.kind === "encuentro") as
    EncounterPiece | undefined;
  if (!enc && (placeId || placeName) && VISIT.test(norm)) {
    const place = placeId
      ? ws.places.find((p) => p.id === placeId)!.name
      : placeName;
    const visitClause =
      clauses(scan).find((c) =>
        normalizeText(c.text).includes(normalizeText(place)),
      ) ?? clauses(scan)[0];
    pieces.unshift({
      id: uid(),
      kind: "visita",
      on: true,
      evidence: visitClause.text.trim(),
      placeId,
      placeName: placeId ? "" : placeName,
      placeKind: guessPlaceKind(placeName, act?.[1]),
      activity: act?.[1] ?? "",
      title: `${act?.[2] ?? "Visita"} · ${place}`.slice(0, 180),
      date,
    });
  }

  // Texto de la conexión, con el motivo si hay una novedad de esa persona.
  for (const p of pieces) {
    if (p.kind !== "conexion") continue;
    const nameA = displayName(p.a, ws, newPeople, kinLinks);
    const nameB = displayName(p.b, ws, newPeople, kinLinks);
    const need = pieces.find(
      (x) => x.kind === "novedad" && x.personId === p.a,
    ) as UpdatePiece | undefined;
    p.text = `${nameB} podría ayudar a ${nameA}${need ? `: ${need.text.charAt(0).toLowerCase()}${need.text.slice(1)}` : ""}`;
  }

  if (!pieces.length) {
    pieces.push({
      id: uid(),
      kind: "nota",
      on: true,
      evidence: source,
      text: source,
    });
  }

  // Conexiones por contexto compartido (oficio, empresa, intereses): sugerencias apagadas.
  pieces.push(
    ...suggestConnections(
      pieces,
      ws,
      [...allPeople, ...pieces.flatMap(peopleOfPiece)],
      uid,
    ),
  );

  // Lo que sueles descartar empieza apagado (aprendido de tus capturas anteriores).
  for (const p of pieces) {
    if (p.on && p.kind !== "nota" && usuallyDropped(p.kind, memory)) {
      p.on = false;
      p.hint = "Sueles descartar este tipo de pieza: actívala si la quieres.";
    }
  }

  const mood = moodIn(scan);
  const first = pieces[0];
  return markDuplicates(
    {
      text: source,
      date,
      dateFrom: dateHit?.phrase.trim(),
      pieces,
      newPeople,
      ambiguous,
      kinLinks,
      mood,
      episode: {
        // Solo si hay algo que las una: un encuentro, una visita o un viaje, una celebración…
        on:
          pieces.length >= 2 &&
          (Boolean(enc) ||
            first.kind === "visita" ||
            episodeKindFor(norm, false) !== "otro"),
        title: (
          enc?.title ??
          (first.kind === "visita" ? first.title : null) ??
          capital(
            scan.replace(/\s{2,}/g, " ").split(/[.!?\n]/)[0] ?? "Experiencia",
          )
        ).slice(0, 120),
        kind: episodeKindFor(norm, Boolean(enc)),
      },
    },
    ws,
  );
}

/** Personas que aparecen en una pieza. */
export function peopleOfPiece(p: Piece): string[] {
  switch (p.kind) {
    case "encuentro":
    case "obra":
    case "trabajo":
      return [
        ...p.personIds,
        ...(p.kind === "obra" && p.recommendedBy ? [p.recommendedBy] : []),
      ];
    case "novedad":
    case "intercambio":
    case "dato":
    case "preguntar":
      return [p.personId];
    case "compromiso":
      return [...p.peopleIds, ...(p.personId ? [p.personId] : [])];
    case "conexion":
      return [p.a, p.b];
    case "enlace":
      return p.personId ? [p.personId] : [];
    default:
      return [];
  }
}

/** Qué clase de episodio parece: un viaje, una celebración, un evento, un proyecto… */
function episodeKindFor(n: string, encounter: boolean): EpisodeKind {
  if (
    /\b(viaje|viajamos|vuelo|hotel|aeropuerto|vacaciones|hostal|airbnb)\b/.test(
      n,
    )
  )
    return "viaje";
  if (
    /\b(boda|matrimonio|aniversario|grado|graduacion|bautizo|baby shower|despedida|celebramos|festejamos|fiesta)\b/.test(
      n,
    ) ||
    /\b(fue|es hoy|era|celebramos el) (el |su )?cumpleanos\b/.test(n)
  )
    return "celebracion";
  if (
    /\b(concierto|conferencia|festival|feria|congreso|charla|obra de teatro|partido|evento|torneo)\b/.test(
      n,
    )
  )
    return "evento";
  if (
    /\b(mudanza|me mude|nos mudamos|trasteo|nuevo apartamento|nueva casa)\b/.test(
      n,
    )
  )
    return "mudanza";
  if (
    /\b(proyecto|cliente|lanzamiento|startup|emprendimiento|propuesta|contrato)\b/.test(
      n,
    )
  )
    return "proyecto";
  return encounter ? "encuentro" : "otro";
}

function guessPlaceKind(name: string, activity?: string): PlaceKind {
  const n = normalizeText(name);
  if (/\b(cafe|coffee|tienda de cafe)\b/.test(n) || activity === "Café")
    return "cafe";
  if (
    /\b(restaurante|asadero|pizzeria|cocina|parrilla)\b/.test(n) ||
    activity === "Comida"
  )
    return "comida";
  if (/\b(bar|pub|cerveceria|discoteca)\b/.test(n)) return "bar";
  if (
    /\b(parque|playa|montana|rio|lago|reserva|jardin|botanico|sendero|cerro|bosque|cascada)\b/.test(
      n,
    )
  )
    return "naturaleza";
  if (/\b(oficina|cowork|empresa)\b/.test(n) || activity === "Trabajo")
    return "trabajo";
  if (/\b(teatro|museo|cine|galeria|biblioteca)\b/.test(n)) return "cultura";
  if (/\b(gimnasio|gym|cancha|estadio)\b/.test(n) || activity === "Deporte")
    return "deporte";
  return "otro";
}

function displayName(
  id: string,
  ws: Workspace,
  fresh: NewPerson[],
  kin: KinLink[] = [],
) {
  return (
    ws.people.find((p) => p.id === id)?.name.split(" ")[0] ??
    fresh.find((n) => n.id === id)?.name.split(" ")[0] ??
    kin.find((k) => k.id === id)?.label ??
    "alguien"
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
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const str = (v: unknown, max = 500) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const date = isDate(obj.date) ? obj.date : base.date;
  const newPeople: NewPerson[] = Array.isArray(obj.new_people)
    ? obj.new_people
        .map((n) => str(n, 120))
        .filter(
          (n) =>
            n &&
            !ws.people.some((p) => normalizeText(p.name) === normalizeText(n)),
        )
        .map((name) => ({ id: "new:" + uid(), name, on: true }))
    : base.newPeople;
  const personId = (v: unknown): string | null => {
    const s = str(v, 200);
    if (!s) return null;
    if (ws.people.some((p) => p.id === s)) return s;
    const byName = ws.people.find(
      (p) => normalizeText(p.name) === normalizeText(s),
    );
    if (byName) return byName.id;
    const fresh = newPeople.find(
      (n) => normalizeText(n.name) === normalizeText(s),
    );
    return fresh?.id ?? null;
  };
  const ids = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.map(personId).filter((x): x is string => Boolean(x)))]
      : [];
  const updateKinds: UpdateKind[] = [
    "trabajo",
    "estudios",
    "salud",
    "amor",
    "familia",
    "hogar",
    "logro",
    "viaje",
    "animo",
    "otro",
  ];
  const commitments: CommitmentKind[] = [
    "quiero",
    "prometi",
    "espero",
    "depende",
  ];
  const pieces: Piece[] = [];
  for (const p of (Array.isArray(obj.pieces) ? obj.pieces : []) as AiPiece[]) {
    const evidence = str(p.evidence, 400);
    switch (p.kind) {
      case "encuentro": {
        const place = ws.places.find(
          (x) =>
            x.id === p.place_id ||
            normalizeText(x.name) === normalizeText(str(p.place)),
        );
        pieces.push({
          id: uid(),
          kind: "encuentro",
          on: true,
          evidence,
          personIds: ids(p.people),
          placeId: place?.id ?? null,
          placeName: place ? "" : str(p.place, 120),
          placeKind: "otro",
          date: isDate(p.date) ? p.date : date,
          activity: str(p.activity, 40),
          title: str(p.title, 180) || "Encuentro",
        });
        break;
      }
      case "movimiento": {
        const amount = Number(p.amount);
        if (!(amount > 0)) break;
        const direction: Direction =
          p.direction === "ingreso" ? "ingreso" : "egreso";
        const d = isDate(p.date) ? p.date : date;
        const category = str(p.category, 40) || "Otro";
        pieces.push({
          id: uid(),
          kind: "movimiento",
          on: true,
          evidence,
          amount,
          direction,
          category,
          cue: contentWords(evidence, 6).join(" "),
          date: d,
          title: str(p.title, 180) || category,
        });
        break;
      }
      case "novedad": {
        const who = personId(p.person);
        if (!who || !str(p.text)) break;
        const uk = updateKinds.includes(p.update_kind as UpdateKind)
          ? (p.update_kind as UpdateKind)
          : "otro";
        pieces.push({
          id: uid(),
          kind: "novedad",
          on: true,
          evidence,
          personId: who,
          updateKind: uk,
          text: str(p.text),
          date: isDate(p.date) ? p.date : date,
        });
        break;
      }
      case "compromiso": {
        const title = str(p.title, 180);
        if (!title) break;
        const k = commitments.includes(p.commitment as CommitmentKind)
          ? (p.commitment as CommitmentKind)
          : "quiero";
        const counterpart = personId(p.person);
        pieces.push({
          id: uid(),
          kind: "compromiso",
          on: true,
          evidence,
          title,
          commitment: k,
          due: isDate(p.due) && p.due >= addDays(today, -30) ? p.due : "",
          personId: counterpart,
          peopleIds: [
            ...new Set([
              ...(counterpart ? [counterpart] : []),
              ...ids(p.people),
            ]),
          ],
        });
        break;
      }
      case "conexion": {
        const a = personId(p.a);
        const b = personId(p.b);
        if (a && b && a !== b)
          pieces.push({
            id: uid(),
            kind: "conexion",
            on: true,
            evidence,
            a,
            b,
            text: str(p.text, 300),
          });
        break;
      }
      case "aprendizaje": {
        if (!str(p.title)) break;
        const from = str(p.source, 20);
        pieces.push({
          id: uid(),
          kind: "aprendizaje",
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
      case "nota":
        if (str(p.text))
          pieces.push({
            id: uid(),
            kind: "nota",
            on: true,
            evidence,
            text: str(p.text, 4000),
          });
        break;
      case "obra": {
        const title = str(p.title, 120);
        if (!title) break;
        const kind = normalizeText(str(p.media, 20));
        const media = kind === "libro" ? "Libro" : "Película";
        const status = (["estante", "quiero", "curso", "listo"] as const).find(
          (s) =>
            (s === "estante" ? media === "Libro" : true) &&
            (s === p.status || (s === "listo" && p.status === "terminado")),
        );
        const rating = Math.round(Number(p.rating));
        const copy =
          media !== "Libro"
            ? ""
            : status === "estante" || p.copy === "mio"
              ? "mio"
              : p.copy === "prestado"
                ? "prestado"
                : "";
        pieces.push({
          id: uid(),
          kind: "obra",
          on: true,
          evidence,
          media,
          series: kind === "serie" || kind === "documental" || kind === "anime",
          title,
          author: media === "Libro" ? str(p.author, 120) : "",
          platform: media === "Película" ? str(p.platform, 40) : "",
          status: status ?? (media === "Libro" ? "quiero" : "listo"),
          copy,
          rating:
            rating >= 1 &&
            rating <= 5 &&
            status !== "quiero" &&
            status !== "estante"
              ? rating
              : 0,
          personIds: ids(p.people),
          recommendedBy: personId(p.recommended_by),
        });
        break;
      }
      case "idea":
        if (str(p.title))
          pieces.push({
            id: uid(),
            kind: "idea",
            on: true,
            evidence,
            title: str(p.title, 180),
            as: p.project === true ? "trabajo" : "nota",
          });
        break;
      case "trabajo": {
        const title = str(p.title, 180);
        if (!title) break;
        const stage = (["idea", "curso", "pausa", "listo"] as const).find(
          (s) => s === p.stage,
        );
        pieces.push({
          id: uid(),
          kind: "trabajo",
          on: true,
          evidence,
          title,
          stage: stage ?? "curso",
          nextStep: str(p.next_step, 180),
          due: isDate(p.due) && p.due >= addDays(today, -30) ? p.due : "",
          personIds: ids(p.people),
        });
        break;
      }
      case "intercambio": {
        const who = personId(p.person);
        const kind = EXCHANGES.find((k) => k === p.exchange);
        if (!who || !kind) break;
        pieces.push({
          id: uid(),
          kind: "intercambio",
          on: true,
          evidence,
          personId: who,
          dir: p.dir === "dar" ? "dar" : "recibir",
          exchange: kind,
          note: str(p.note, 120),
          date: isDate(p.date) ? p.date : date,
        });
        break;
      }
      case "dato": {
        const who = personId(p.person);
        const field = (
          ["likes", "dislikes", "gifts", "birthday", "fact"] as const
        ).find((f) => f === p.field);
        let value = str(p.value, 120);
        if (field === "birthday")
          value = /^\d{2}-\d{2}$/.test(value) ? value : "";
        if (!who || !field || !value) break;
        pieces.push({
          id: uid(),
          kind: "dato",
          on: true,
          evidence,
          personId: who,
          field,
          label: field === "fact" ? str(p.label, 40) || "Dato" : "",
          value,
        });
        break;
      }
      case "preguntar": {
        const who = personId(p.person);
        if (who && str(p.text))
          pieces.push({
            id: uid(),
            kind: "preguntar",
            on: true,
            evidence,
            personId: who,
            text: str(p.text, 200),
          });
        break;
      }
      case "visita": {
        const place = ws.places.find(
          (x) =>
            x.id === p.place_id ||
            normalizeText(x.name) === normalizeText(str(p.place)),
        );
        const name = place?.name ?? str(p.place, 120);
        if (!name) break;
        pieces.push({
          id: uid(),
          kind: "visita",
          on: true,
          evidence,
          placeId: place?.id ?? null,
          placeName: place ? "" : name,
          placeKind: place?.kind ?? guessPlaceKind(name, str(p.activity, 40)),
          activity: str(p.activity, 40),
          title: str(p.title, 180) || `Visita · ${name}`,
          date: isDate(p.date) ? p.date : date,
        });
        break;
      }
      case "enlace": {
        const url = cleanUrl(str(p.url, 2000));
        if (!/^https?:\/\//.test(url)) break;
        pieces.push({
          id: uid(),
          kind: "enlace",
          on: true,
          evidence,
          url,
          title: str(p.title, 180) || url,
          save: "lecturas",
          personId: personId(p.person),
        });
        break;
      }
    }
  }
  if (!pieces.length) return base;
  // Los enlaces del texto no se pierden aunque la IA los omita.
  for (const l of base.pieces)
    if (
      l.kind === "enlace" &&
      !pieces.some((x) => x.kind === "enlace" && x.url === l.url)
    )
      pieces.push(l);
  const moodName = normalizeText(str((obj as { mood?: unknown }).mood, 20));
  const mood =
    moods.find((m) => normalizeText(m.label) === moodName)?.value ?? base.mood;
  return markDuplicates(
    {
      ...base,
      date,
      pieces,
      newPeople,
      mood,
      episode: {
        ...base.episode,
        on:
          pieces.length >= 2 &&
          (base.episode.on ||
            pieces.some((p) => p.kind === "encuentro" || p.kind === "visita")),
        title: str(obj.episode_title, 120) || base.episode.title,
      },
    },
    ws,
  );
}

const LEARN_SOURCES = [
  "Libro",
  "Curso",
  "Video",
  "Artículo",
  "Persona",
  "Práctica",
];
const EXCHANGES: ExchangeKind[] = [
  "favor",
  "regalo",
  "apoyo",
  "tiempo",
  "dinero",
  "iniciativa",
];

// ───────────────────────── Personas en las piezas ─────────────────────────

/** Cambia una persona por otra en todas las piezas (al aclarar un nombre ambiguo). */
export function swapPerson(
  plan: CapturePlan,
  from: string,
  to: string,
  name: string,
): CapturePlan {
  const sw = (id: string | null) => (id === from ? to : id);
  const swList = (ids: string[]) => [...new Set(ids.map((id) => sw(id)!))];
  return {
    ...plan,
    ambiguous: plan.ambiguous.map((a) =>
      a.name === name ? { ...a, chosen: to } : a,
    ),
    pieces: plan.pieces.map((p) => {
      switch (p.kind) {
        case "encuentro":
          return { ...p, personIds: swList(p.personIds) };
        case "novedad":
          return { ...p, personId: sw(p.personId)! };
        case "compromiso":
          return {
            ...p,
            personId: sw(p.personId),
            peopleIds: swList(p.peopleIds),
          };
        case "conexion":
          return { ...p, a: sw(p.a)!, b: sw(p.b)! };
        case "obra":
          return {
            ...p,
            personIds: swList(p.personIds),
            recommendedBy: sw(p.recommendedBy),
          };
        case "trabajo":
          return { ...p, personIds: swList(p.personIds) };
        case "intercambio":
        case "dato":
        case "preguntar":
          return { ...p, personId: sw(p.personId)! };
        case "enlace":
          return { ...p, personId: sw(p.personId) };
        default:
          return p;
      }
    }),
  };
}

/** Usa una ficha que ya tienes en lugar de crear la persona nueva («Andrez» → Andrés Pérez). */
export function adoptExisting(
  plan: CapturePlan,
  newId: string,
  personId: string,
): CapturePlan {
  const next = swapPerson(plan, newId, personId, "");
  return {
    ...next,
    newPeople: next.newPeople.filter((n) => n.id !== newId),
    kinLinks: next.kinLinks.map((k) =>
      k.personId === newId ? { ...k, personId } : k,
    ),
  };
}

// ───────────────────────── Varias experiencias a la vez ─────────────────────────

const BULLET = /^(?:[-•*·]|\d{1,2}[.)])\s+/;

/** Párrafos separados por una línea en blanco. */
export const paragraphs = (text: string) =>
  text
    .trim()
    .split(/\n[ \t]*\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

/**
 * Parte un texto en varias experiencias cuando se nota que son varias: separadas por «---»,
 * párrafos que empiezan con su fecha («Ayer…», «El lunes…», «15/11: …»), una lista con viñetas o
 * una línea por día. Si no, es una sola.
 */
export function splitExperiences(
  text: string,
  today = todayInputValue(),
): string[] {
  const t = text.trim();
  if (!t) return [];
  const cut = t
    .split(/\n[ \t]*(?:-{3,}|\*{3,}|={3,}|_{3,})[ \t]*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  if (cut.length > 1) return cut;
  const paras = paragraphs(t);
  if (
    paras.length > 1 &&
    paras.filter((p) => startsWithDate(p, today)).length >=
      Math.max(2, paras.length - 1)
  )
    return paras;
  const lines = t
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length >= 2 && lines.every((l) => BULLET.test(l)))
    return lines.map((l) => l.replace(BULLET, "")).filter((l) => l.length > 3);
  if (lines.length >= 2 && lines.every((l) => startsWithDate(l, today)))
    return lines;
  return [t];
}

/**
 * Propone cada experiencia del lote. La misma persona nueva en varias («conocí a Mariana» y
 * luego «volví a ver a Mariana») queda como una sola: se crea una vez.
 */
export function proposeBatch(
  texts: string[],
  ws: Workspace,
  today = todayInputValue(),
) {
  const seen = new Map<string, string>();
  return texts.map((t) => {
    let plan = proposeCapture(t, ws, today);
    for (const n of plan.newPeople) {
      const key = normalizeText(n.name.trim());
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, n.id);
        continue;
      }
      plan = swapPerson(plan, n.id, prev, "");
      plan = {
        ...plan,
        newPeople: plan.newPeople.map((x) =>
          x.id === n.id ? { ...x, id: prev } : x,
        ),
        kinLinks: plan.kinLinks.map((k) =>
          k.personId === n.id ? { ...k, personId: prev } : k,
        ),
      };
    }
    return plan;
  });
}

// ───────────────────────── Avisos de la vista previa ─────────────────────────

export type PlanNote = { tone: "warn" | "info" | "dup"; text: string };

/**
 * Lo que conviene saber antes de proponer: de dónde salió la fecha, nombres que pueden ser
 * varias personas, parentescos sin elegir, personas nuevas parecidas a otras, lo que ya existe,
 * gastos sin categoría o sin dirección clara y sugerencias de conexión.
 */
export function planNotes(
  plan: CapturePlan,
  ws: Workspace,
  today = todayInputValue(),
) {
  const notes: PlanNote[] = [];
  const name = (id: string) => ws.people.find((p) => p.id === id)?.name ?? "";
  if (plan.dateFrom && plan.date !== today)
    notes.push({
      tone: "info",
      text: `Fecha: ${friendlyDate(plan.date, today).toLowerCase()} (por «${plan.dateFrom}»).`,
    });
  for (const a of plan.ambiguous) {
    const others = a.ids
      .filter((id) => id !== a.chosen)
      .map(name)
      .filter(Boolean)
      .join(", ");
    notes.push({
      tone: "warn",
      text: `«${a.name}» puede ser ${name(a.chosen)} o ${others}. Usaré a ${name(a.chosen).split(" ")[0]} (${a.learned ? "la elegiste la última vez" : "la viste más recientemente"}); puedes cambiarlo al revisar.`,
    });
  }
  for (const k of plan.kinLinks)
    if (!k.personId)
      notes.push({
        tone: "warn",
        text: `¿Quién es ${k.label}? Lo eliges al revisar.`,
      });
  for (const n of plan.newPeople)
    notes.push(
      n.like
        ? {
            tone: "warn",
            text: `«${n.name}» se parece a ${name(n.like)}: ¿es la misma persona?`,
          }
        : { tone: "info", text: `Persona nueva: ${n.name}.` },
    );
  for (const p of plan.pieces) {
    if (p.dup) {
      notes.push({ tone: "dup", text: p.dup.text });
      continue;
    }
    if (p.kind === "movimiento") {
      const what = money(p.amount);
      if (p.guessed && p.category === "Otro")
        notes.push({
          tone: "warn",
          text: `${what}: no dice si lo pagaste o te lo pagaron ni de qué fue. Lo tomé como gasto sin categoría.`,
        });
      else if (p.guessed)
        notes.push({
          tone: "warn",
          text: `${what}: no dice si lo pagaste o te lo pagaron; lo tomé como gasto.`,
        });
      else if (p.category === "Otro")
        notes.push({
          tone: "warn",
          text: `${what}: no sé de qué fue; elige la categoría al revisar.`,
        });
      else if (p.why)
        notes.push({
          tone: "info",
          text: `${what} → ${p.category}, ${p.why}.`,
        });
    } else if (
      p.kind === "compromiso" &&
      p.commitment === "prometi" &&
      !p.personId
    ) {
      notes.push({
        tone: "warn",
        text: `No sé a quién le prometiste «${p.title}».`,
      });
    } else if (p.kind === "conexion" && p.hint && !p.on) {
      notes.push({
        tone: "info",
        text: `Sugerencia: ${p.text} (${p.hint.toLowerCase()}).`,
      });
    }
  }
  return notes;
}

// ───────────────────────── Aprendizaje ─────────────────────────

/** Lo que se aprende al guardar: comparando lo que Nexo propuso con lo que guardaste. */
export function captureLessons(
  initial: CapturePlan | undefined,
  final: CapturePlan,
) {
  const before = new Map((initial?.pieces ?? []).map((p) => [p.id, p]));
  return {
    names: final.ambiguous.map((a) => ({ name: a.name, chosen: a.chosen })),
    cats: final.pieces
      .filter(
        (p): p is MoneyPiece =>
          p.kind === "movimiento" && p.on && Boolean(p.cue),
      )
      .map((p) => {
        const b = before.get(p.id) as MoneyPiece | undefined;
        return {
          words: p.cue!.split(" ").filter(Boolean),
          category: p.category,
          corrected: Boolean(b && b.category !== p.category),
        };
      }),
    kinds: final.pieces.flatMap((p) => {
      const b = before.get(p.id);
      // Lo que empezó apagado y siguió apagado no dice nada.
      if (!b || (!b.on && !p.on)) return [];
      return [{ kind: p.kind, kept: p.on }];
    }),
  };
}
