import type { Gender, Relation, TieKind } from '../../data';
import { normalizeText } from '../../lib/format';
import { relations } from '../../lib/people';
import { relationForKind, tieKinds } from '../../lib/relations';

/**
 * Lectura de personas por lote: un vCard del teléfono, un CSV (Google, Outlook, Excel), fichas
 * «Nombre: …» o una lista escrita a mano («Laura Gómez, mi prima, 300 123 4567, cumple 12 de
 * marzo»). Todo pasa por los mismos filtros: nombres, teléfonos, correos y fechas válidos, largos
 * con tope y nada inventado. Lo que no encaja en un campo queda en «Datos libres» o en las notas.
 */

export type BatchFact = { label: string; value: string };
export type BatchPerson = {
  name: string;
  alias: string;
  gender: Gender | null;
  relation: Relation | null;
  /** Lo que es para ti (vínculo contigo): «mi mamá» → padre. */
  kin: TieKind | null;
  role: string;
  phone: string;
  email: string;
  social: string;
  city: string;
  occupation: string;
  company: string;
  /** MM-DD o vacío. */
  birthday: string;
  birthYear: number | null;
  metHow: string;
  family: string;
  interests: string[];
  likes: string[];
  dislikes: string[];
  gifts: string[];
  keywords: string[];
  facts: BatchFact[];
  bio: string;
  favorite: boolean;
};
export type Parsed = { person: BatchPerson; notes: string[] };
export type ParseKind = 'vcard' | 'csv' | 'bloques' | 'lineas' | 'nombres';
export type ParseResult = { rows: Parsed[]; kind: ParseKind | null };
/** Lo que ayuda a reconocer (las ciudades de tu gente, de tus lugares y la tuya). */
export type ParseContext = { cities: string[] };

export const MAX_ROWS = 500;
export const kindLabels: Record<ParseKind, string> = {
  vcard: 'Contactos (vCard)',
  csv: 'Tabla (CSV)',
  bloques: 'Fichas',
  lineas: 'Una por línea',
  nombres: 'Lista de nombres',
};

export const CAP = {
  name: 120,
  alias: 60,
  role: 120,
  phone: 30,
  email: 120,
  social: 80,
  city: 80,
  occupation: 80,
  company: 80,
  metHow: 200,
  family: 200,
  bio: 4000,
  item: 80,
  list: 20,
  factLabel: 60,
  factValue: 300,
  facts: 20,
};

export const emptyPerson = (): BatchPerson => ({
  name: '',
  alias: '',
  gender: null,
  relation: null,
  kin: null,
  role: '',
  phone: '',
  email: '',
  social: '',
  city: '',
  occupation: '',
  company: '',
  birthday: '',
  birthYear: null,
  metHow: '',
  family: '',
  interests: [],
  likes: [],
  dislikes: [],
  gifts: [],
  keywords: [],
  facts: [],
  bio: '',
  favorite: false,
});

// ───────────────────────── Texto ─────────────────────────

/** Sin tildes, en minúsculas y con un solo espacio. */
export const nz = (s: string) => normalizeText(s).replace(/\s+/g, ' ').trim();
/** Sin espacios de más, comillas ni puntuación suelta en los extremos. */
export const tidy = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’«»*•·\-–—.,;:|]+/, '')
    .replace(/[\s"'“”‘’«»*•·\-–—,;:|]+$/, '')
    .trim();
export const capFirst = (s: string) => (s ? s[0].toLocaleUpperCase('es') + s.slice(1) : s);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() : s);
const pad = (n: number) => String(n).padStart(2, '0');
const hasLetters = (s: string) => /\p{L}/u.test(s);
const digitsOf = (s: string) => s.replace(/\D/g, '');

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'do', 'dos', 'van', 'von', 'e']);
/** «laura gómez» o «LAURA GÓMEZ» → «Laura Gómez» (lo que ya trae mayúsculas se respeta). */
export function titleName(s: string) {
  const t = tidy(s);
  if (!t || (t !== t.toLowerCase() && t !== t.toUpperCase())) return t;
  return t
    .toLowerCase()
    .split(' ')
    .map((w, i) =>
      i > 0 && PARTICLES.has(w)
        ? w
        : w
            .split('-')
            .map((x) => capFirst(x))
            .join('-'),
    )
    .join(' ');
}

// ───────────────────────── Fechas ─────────────────────────

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1,
  febrero: 2, feb: 2, february: 2,
  marzo: 3, mar: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6, june: 6,
  julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, september: 9, sept: 9, sep: 9, set: 9,
  octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12,
};
const MONTH_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const DAY_MONTH = new RegExp(
  `\\b(\\d{1,2})(?:\\s+de)?\\s+(${MONTH_RE})\\.?(?![a-z])(?:,?\\s+(?:de\\s+|del\\s+)?(\\d{4}))?`,
);
const MONTH_DAY = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})\\b(?:,?\\s+(\\d{4}))?`);
/** Una fecha completa dentro de un texto (con año, o con el nombre del mes). */
const STRONG_DATE = new RegExp(
  `\\b\\d{1,2}\\s*[/.-]\\s*\\d{1,2}\\s*[/.-]\\s*\\d{2,4}\\b|\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b|\\b\\d{1,2}(?:\\s+de)?\\s+(?:${MONTH_RE})(?![a-z])`,
);
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export type DateOut = { md: string; year: number | null };
export function makeDate(m: number, d: number, y: number | null): DateOut | null {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= DAYS_IN[m - 1])) return null;
  // El 29 de febrero solo existe en años bisiestos.
  if (m === 2 && d === 29 && y && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return null;
  const now = new Date().getFullYear();
  return { md: `${pad(m)}-${pad(d)}`, year: y && y >= 1900 && y <= now ? y : null };
}
const fullYear = (y: string) => {
  if (y.length !== 2) return Number(y);
  const n = Number(y);
  return n > new Date().getFullYear() % 100 ? 1900 + n : 2000 + n;
};

/**
 * Una fecha de cumpleaños en casi cualquier forma: 1990-03-12, 12/03/1990, 12/03, «12 de marzo
 * (de 1990)», «marzo 12», --03-12 (vCard sin año). Las numéricas son día/mes; con `md`, mes/día
 * (si un número pasa de 12, se sabe cuál es cuál).
 */
export function parseDate(raw: string, order: 'dm' | 'md' = 'dm'): DateOut | null {
  const s = nz(raw);
  let m: RegExpMatchArray | null;
  if ((m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) return makeDate(+m[2], +m[3], +m[1]);
  if ((m = s.match(/(?:^|\s)--(\d{2})-?(\d{2})\b/))) return makeDate(+m[1], +m[2], null);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:t.*)?$/))) return makeDate(+m[2], +m[3], +m[1]);
  if ((m = s.match(/\b(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}|\d{2}))?\b/))) {
    const a = +m[1];
    const b = +m[2];
    const [day, month] =
      a > 12 && b <= 12 ? [a, b] : b > 12 && a <= 12 ? [b, a] : order === 'md' ? [b, a] : [a, b];
    return makeDate(month, day, m[3] ? fullYear(m[3]) : null);
  }
  if ((m = s.match(DAY_MONTH))) return makeDate(MONTHS[m[2]], +m[1], m[3] ? +m[3] : null);
  if ((m = s.match(MONTH_DAY))) return makeDate(MONTHS[m[1]], +m[2], m[3] ? +m[3] : null);
  return null;
}
/** ¿El texto es solo una fecha? */
function onlyDate(s: string) {
  const t = nz(s).replace(/^el\s+/, '');
  return (
    /^\d{1,4}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?$/.test(t) ||
    /^--\d{2}-?\d{2}$/.test(t) ||
    new RegExp(`^\\d{1,2}(?:\\s+de)?\\s+(?:${MONTH_RE})\\.?(?:,?\\s+(?:de\\s+)?\\d{4})?$`).test(t) ||
    new RegExp(`^(?:${MONTH_RE})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?$`).test(t)
  );
}
const BIRTH_WORDS =
  /\b(cumple(?:anos)?|naci[oa]|nacimiento|birthday|bday|fecha de nacimiento|f\.?\s?nac)\b/;
/** Quita la fecha (y, si se pide, las palabras de cumpleaños) de un texto. */
function withoutDate(s: string, words: boolean) {
  let out = s
    .replace(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?/g, ' ')
    .replace(new RegExp(`\\b\\d{1,2}(?:\\s+de)?\\s+(?:${MONTH_RE})\\.?(?![a-z])(?:,?\\s+(?:de\\s+)?\\d{4})?`, 'gi'), ' ');
  if (words)
    out = out.replace(
      /(?<![\p{L}\p{N}])(cumpleaños|cumpleanos|cumple|nació|nacio|nacida|nacido|nacimiento|birthday|bday|el|es)(?![\p{L}\p{N}]):?/giu,
      ' ',
    );
  return tidy(out);
}

// ───────────────────────── Contacto ─────────────────────────

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const EMAIL_ONE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PHONE = /(?:\+|00)?\(?\d[\d\s().-]{5,}\d/g;
const SOCIAL = '\\b(?:https?:\\/\\/)?(?:www\\.)?(instagram|twitter|x|tiktok|facebook|fb|linkedin|threads)\\.(?:com|net)\\/(?:in\\/|@)?([A-Za-z0-9_.-]{2,60})\\/?';
const OTHER_URL = /\bhttps?:\/\/[^\s,;]+|\bwww\.[^\s,;]+/gi;
const HANDLE = /(^|[\s(,;:])@([A-Za-z0-9_.]{2,30})\b/g;

/** Un teléfono limpio (de 7 a 15 dígitos), o '' si no lo es. */
export function cleanPhone(raw: string) {
  const s = raw.replace(/[^\d+\s().-]/g, '').replace(/\s+/g, ' ').trim();
  const d = digitsOf(s);
  if (d.length < 7 || d.length > 15) return '';
  return clip(s.replace(/^00/, '+'), CAP.phone);
}
export const isEmail = (s: string) => EMAIL_ONE.test(s.trim());
const isDateLike = (s: string) => /^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/.test(s.trim());
/** «@lau.g», o el enlace si es de LinkedIn o Facebook. */
function socialOf(net: string, user: string) {
  const n = net.toLowerCase();
  const u = user.replace(/\/+$/, '');
  if (n === 'linkedin') return `linkedin.com/in/${u}`;
  if (n === 'facebook' || n === 'fb') return `facebook.com/${u}`;
  return '@' + u.replace(/^@/, '');
}
export function cleanSocial(raw: string) {
  const s = tidy(raw).replace(/\s+/g, '').replace(/^x-apple:/i, '');
  if (!s) return '';
  const url = new RegExp('^' + SOCIAL, 'i').exec(s);
  if (url) return clip(socialOf(url[1], url[2]), CAP.social);
  if (/^@?[A-Za-z0-9_.]{2,30}$/.test(s)) return '@' + s.replace(/^@/, '');
  return clip(s, CAP.social);
}

// ───────────────────────── Parentescos y relación ─────────────────────────

const KIN_WORDS: Record<string, [TieKind, Gender | null]> = {
  mama: ['padre', 'f'], mami: ['padre', 'f'], madre: ['padre', 'f'], mamita: ['padre', 'f'],
  papa: ['padre', 'm'], papi: ['padre', 'm'], padre: ['padre', 'm'], papito: ['padre', 'm'],
  hijo: ['hijo', 'm'], hija: ['hijo', 'f'],
  hermano: ['hermano', 'm'], hermana: ['hermano', 'f'], hermanito: ['hermano', 'm'], hermanita: ['hermano', 'f'],
  abuelo: ['abuelo', 'm'], abuela: ['abuelo', 'f'], abuelito: ['abuelo', 'm'], abuelita: ['abuelo', 'f'],
  nieto: ['nieto', 'm'], nieta: ['nieto', 'f'],
  tio: ['tio', 'm'], tia: ['tio', 'f'],
  sobrino: ['sobrino', 'm'], sobrina: ['sobrino', 'f'],
  primo: ['primo', 'm'], prima: ['primo', 'f'],
  suegro: ['suegro', 'm'], suegra: ['suegro', 'f'],
  yerno: ['yerno', 'm'], nuera: ['yerno', 'f'],
  cunado: ['cunado', 'm'], cunada: ['cunado', 'f'],
  familiar: ['familiar', null],
  esposo: ['pareja', 'm'], esposa: ['pareja', 'f'], marido: ['pareja', 'm'],
  novio: ['pareja', 'm'], novia: ['pareja', 'f'], pareja: ['pareja', null],
  exnovio: ['expareja', 'm'], exnovia: ['expareja', 'f'], 'ex novio': ['expareja', 'm'], 'ex novia': ['expareja', 'f'],
  exesposo: ['expareja', 'm'], exesposa: ['expareja', 'f'], 'ex esposo': ['expareja', 'm'], 'ex esposa': ['expareja', 'f'],
  expareja: ['expareja', null], 'ex pareja': ['expareja', null],
  'mejor amigo': ['mejoramigo', 'm'], 'mejor amiga': ['mejoramigo', 'f'],
  amigo: ['amigo', 'm'], amiga: ['amigo', 'f'], parcero: ['amigo', 'm'], parcera: ['amigo', 'f'], parce: ['amigo', null],
  companero: ['companero', 'm'], companera: ['companero', 'f'],
  vecino: ['vecino', 'm'], vecina: ['vecino', 'f'],
  jefe: ['jefe', 'm'], jefa: ['jefe', 'f'],
  colega: ['colega', null],
  socio: ['socio', 'm'], socia: ['socio', 'f'],
  mentor: ['mentor', 'm'], mentora: ['mentor', 'f'],
  conocido: ['conocido', 'm'], conocida: ['conocido', 'f'],
};
const KIN_RE = new RegExp(
  `^(${Object.keys(KIN_WORDS)
    .sort((a, b) => b.length - a.length)
    .join('|')})(s|es)?(?![a-z])(.*)$`,
);
/** Palabras sueltas que dicen el tipo de relación. */
const CATEGORY: Record<string, Relation> = {
  familia: 'familia', familiares: 'familia', family: 'familia',
  trabajo: 'trabajo', laboral: 'trabajo', work: 'trabajo', oficina: 'trabajo', cliente: 'trabajo',
  clientes: 'trabajo', proveedor: 'trabajo', proveedores: 'trabajo', coworkers: 'trabajo',
  amistad: 'amistad', amigos: 'amistad', amigas: 'amistad', friends: 'amistad',
  conocidos: 'conocido', conocidas: 'conocido',
};
/** Las que además dicen algo que conviene guardar como contexto («Cliente»). */
const CATEGORY_ROLE = /^(cliente|clientes|proveedor|proveedores)$/;
const WORK_PLACE = /^\s+de\s+(?:la\s+|el\s+)?(?:trabajo|oficina|empresa|chamba|labor)\b/;
const STUDY_PLACE =
  /^\s+de\s+(?:la\s+|el\s+)?(?:estudio|estudios|clase|clases|colegio|universidad|u|curso|carrera|maestria|bachillerato|escuela|instituto)\b/;
/** «de la U», «del colegio», «de infancia»: dónde es tu amiga (sigue siendo tuya). */
const MINE_PLACE =
  /^\s+(?:de|del)\s+(?:la\s+|el\s+|los\s+|las\s+)?(?:u|universidad|colegio|oficina|trabajo|empresa|iglesia|gym|gimnasio|barrio|cuadra|conjunto|edificio|infancia|toda la vida|siempre|clase|curso|carrera|equipo|futbol|deporte|viaje|intercambio)\b|^\s+del\s/;

type KinHit = {
  kind: TieKind | null;
  relation: Relation | null;
  gender: Gender | null;
  /** Es tuyo (tu mamá) y no de otra persona (la mamá de Ana). */
  mine: boolean;
  /** Dice algo más que el parentesco («amiga del colegio», «mamá de Ana»). */
  more: boolean;
  plural: boolean;
};

/** «mi mamá», «es mi jefe», «amiga del colegio», «mamá de Ana», «Familia»… o null. */
function kinOf(raw: string): KinHit | null {
  const f = nz(raw).replace(/[.:!]+$/, '');
  const lead = /^(?:(?:es|son|era)\s+)?(?:(mi|mis|nuestr[oa]s?|su|sus)\s+)?(.*)$/.exec(f)!;
  const owner = lead[1] ?? '';
  const body = lead[2];
  const cat = CATEGORY[body];
  if (cat)
    return {
      kind: null,
      relation: cat,
      gender: null,
      mine: true,
      more: CATEGORY_ROLE.test(body),
      plural: /s$/.test(body),
    };
  const m = KIN_RE.exec(body);
  if (!m) return null;
  const entry = KIN_WORDS[m[1]];
  let kind = entry[0];
  const gender = entry[1];
  const rest = m[3] ?? '';
  const plural = Boolean(m[2]);
  // «su esposa», «sus primos»: de otra persona.
  if (/^(su|sus)$/.test(owner)) return { kind: null, relation: null, gender, mine: false, more: true, plural };
  if (kind === 'companero' && WORK_PLACE.test(rest)) kind = 'colega';
  // «mamá de Ana», «prima de mi mamá»: es pariente de otra persona.
  const ofOther =
    /^\s+de\s/.test(rest) && !MINE_PLACE.test(rest) && !WORK_PLACE.test(rest) && !STUDY_PLACE.test(rest);
  if (ofOther) {
    const family = tieKinds[kind].category === 'familia';
    const ofMine = /^\s+de\s+(mi|mis)\s/.test(rest);
    return family && ofMine
      ? { kind: 'familiar', relation: 'familia', gender, mine: true, more: true, plural }
      : { kind: null, relation: family ? null : relationForKind(kind), gender, mine: false, more: true, plural };
  }
  return { kind, relation: relationForKind(kind), gender, mine: true, more: rest.trim().length > 0, plural };
}

// ───────────────────────── Etiquetas de campo ─────────────────────────

type FieldKey =
  | 'name' | 'first' | 'middle' | 'last' | 'alias' | 'phone' | 'email' | 'birthday' | 'city'
  | 'country' | 'address' | 'occupation' | 'company' | 'social' | 'web' | 'im' | 'relation'
  | 'role' | 'bio' | 'likes' | 'dislikes' | 'gifts' | 'interests' | 'family' | 'metHow'
  | 'keywords' | 'gender' | 'favorite' | 'labels' | 'skip';

/** De etiqueta a campo. Palabras completas (así «Marcela» no es «cel», ni «Gustavo», «gusta»). */
const FIELD_RULES: [RegExp, FieldKey][] = [
  [/^(labels|group membership|grupos?|etiquetas|categorias|categories)$/, 'labels'],
  // Google: «Relation 1 - Value» es un pariente de esa persona («Mother: Ana»).
  [/^relation$/, 'family'],
  [/\b(label|type)\b|^tipo$/, 'skip'],
  [/\b(mail|correo)\b.*\b(display|mostrar)\b|\bdisplay\b.*\bmail\b/, 'skip'],
  [/^(photo|foto|imagen|picture|avatar)$/, 'skip'],
  [/^(name prefix|prefix|prefijo|tratamiento|name suffix|suffix|sufijo|title|titulo|initials|iniciales)$/, 'skip'],
  [/\b(phonetic|yomi|fonetico)\b/, 'skip'],
  [/^(file as|archivar como|priority|prioridad|sensitivity|confidencialidad|private|privado|mileage|kilometraje|billing information|directory server|location|ubicacion|user|usuario \d)$/, 'skip'],
  [/\b(postal|zip|po box|extended address|region|state|provincia)\b/, 'skip'],
  [/\b(fax|pager|buscapersonas|telex|isdn|radio phone)\b/, 'skip'],
  [/\b(apodo|alias|nickname|sobrenombre)\b|\ble dicen\b|\bcomo le digo\b/, 'alias'],
  [/\b(middle name|additional name|segundo nombre|otro nombre)\b/, 'middle'],
  [/\b(last name|family name|surname|apellidos?)\b/, 'last'],
  [/\b(first name|given name|primer nombre|nombre de pila)\b/, 'first'],
  [/^(nombres?|name|full name|display name|nombre completo|contacto|persona|quien)$/, 'name'],
  [/\bno le gustan?\b|\b(dislikes?|odia|disgustos?)\b/, 'dislikes'],
  [/\b(regalos?|gifts?|wishlist|deseos?)\b|\bideas? de regalo\b/, 'gifts'],
  [/\b(intereses|interes|interests?|hobby|hobbies|aficion|aficiones|pasatiempos?)\b/, 'interests'],
  [/^(favorit[oa]s?|favorite|starred|destacad[oa]|estrella)$/, 'favorite'],
  [/\ble gustan?\b|\ble encanta\b|\b(gustos?|likes|preferencias?)\b|^gusta$/, 'likes'],
  [/\b(cumpleanos|cumple|birthday|nacimiento|birth|bday|birthdate)\b|\bfecha de nac/, 'birthday'],
  [/\b(e ?mail|mail|correo|correo electronico)\b/, 'email'],
  [/\b(phone|telefono|tel|cel|celular|movil|mobile|whatsapp|wsp|numero|fono|fax)\b/, 'phone'],
  [/\b(instagram|twitter|tiktok|linkedin|facebook|threads|redes|social)\b|\bred social\b|^(ig|x)$/, 'social'],
  [/\b(im|impp|skype|telegram|signal)\b/, 'im'],
  [/\b(website|web|sitio|pagina|url|blog)\b/, 'web'],
  [/\b(ciudad|city|localidad|municipio|residencia)\b|\bvive en\b/, 'city'],
  [/\b(pais|country)\b/, 'country'],
  [/\b(address|direccion|domicilio|street|calle)\b/, 'address'],
  [/\b(job title|organization title|cargo|puesto|ocupacion|profesion|oficio|position|job)\b/, 'occupation'],
  [/\b(department|departamento)\b/, 'skip'],
  [/\b(company|empresa|organization|organisation|organizacion|compania|negocio|employer)\b|\blugar de trabajo\b|\btrabaja en\b/, 'company'],
  [/\b(relacion|vinculo|parentesco|categoria)\b|\btipo de contacto\b/, 'relation'],
  [/^(rol|role|contexto|quien es)$/, 'role'],
  [/\b(familia|family|hijos|mascotas?|spouse|children|conyuge|esposo|esposa)\b|\bsu gente\b/, 'family'],
  [/\bconoc|\bhow we met\b|\bcomo nos\b/, 'metHow'],
  [/\b(palabras clave|palabra clave|keywords|tags)\b/, 'keywords'],
  [/\b(sexo|genero|gender)\b/, 'gender'],
  [/\b(notas?|notes?|bio|biografia|descripcion|comentarios?|observacion|observaciones|about|detalles|info)\b/, 'bio'],
];
const labelKey = (label: string) =>
  normalizeText(label)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\b(value|valor)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** El campo de una etiqueta («Teléfono 1 - Valor», «E-mail», «Cumpleaños»…), o null. */
function fieldOf(label: string): FieldKey | null {
  const l = labelKey(label);
  if (!l || l.length > 40) return null;
  for (const [re, key] of FIELD_RULES) if (re.test(l)) return key;
  return null;
}
/** Etiquetas sueltas que nunca son un nombre. */
const LABEL_WORDS = new Set(
  (
    'nombre nombres name telefono tel cel celular movil whatsapp correo email mail cumpleanos cumple ' +
    'ciudad empresa trabajo cargo ocupacion profesion notas nota apodo alias direccion pais redes ' +
    'instagram facebook twitter tiktok linkedin web gustos intereses regalos familia relacion genero ' +
    'sexo contacto contactos persona personas lista hombre mujer'
  ).split(' '),
);

// ───────────────────────── Ciudades y oficios ─────────────────────────

const CITIES = [
  'bogota', 'medellin', 'cali', 'barranquilla', 'cartagena', 'bucaramanga', 'pereira', 'manizales',
  'santa marta', 'cucuta', 'ibague', 'villavicencio', 'pasto', 'monteria', 'neiva', 'armenia',
  'popayan', 'tunja', 'valledupar', 'sincelejo', 'riohacha', 'quibdo', 'yopal', 'leticia', 'chia',
  'envigado', 'itagui', 'bello', 'sabaneta', 'soacha', 'zipaquira', 'rionegro', 'cajica', 'mosquera',
  'funza', 'facatativa', 'girardot', 'duitama', 'sogamoso', 'palmira', 'buenaventura', 'tulua',
  'floridablanca', 'giron', 'piedecuesta', 'apartado', 'san andres', 'madrid', 'barcelona', 'sevilla',
  'lima', 'quito', 'guayaquil', 'santiago', 'caracas', 'panama', 'miami', 'orlando', 'londres',
  'paris', 'roma', 'berlin', 'toronto', 'montreal', 'mexico', 'ciudad de mexico', 'cdmx',
  'guadalajara', 'monterrey', 'cancun', 'buenos aires', 'montevideo', 'asuncion', 'la paz',
  'san jose', 'san salvador', 'nueva york', 'new york', 'los angeles', 'houston', 'chicago',
];
const OFFICES = new Set(
  (
    'abogado abogada medico medica doctor doctora enfermero enfermera ingeniero ingeniera arquitecto ' +
    'arquitecta disenador disenadora programador programadora desarrollador desarrolladora contador ' +
    'contadora profesor profesora docente maestro maestra periodista fotografo fotografa psicologo ' +
    'psicologa odontologo odontologa dentista veterinario veterinaria chef cocinero cocinera mesero ' +
    'mesera estudiante gerente asesor asesora vendedor vendedora comerciante emprendedor emprendedora ' +
    'empresario empresaria piloto musico musica cantante actor actriz policia militar conductor ' +
    'conductora taxista economista administrador administradora secretaria secretario recepcionista ' +
    'peluquero peluquera estilista barbero entrenador entrenadora deportista futbolista nutricionista ' +
    'fisioterapeuta terapeuta pastor sacerdote escritor escritora traductor traductora consultor ' +
    'consultora analista investigador investigadora cientifico cientifica pintor pintora artista ' +
    'carpintero electricista mecanico plomero jubilado jubilada pensionado pensionada freelance ' +
    'independiente youtuber influencer'
  ).split(' '),
);
/** Terminaciones casi siempre de oficio («dentista», «psicóloga»); las demás, solo de la lista. */
const OFFICE_SUFFIX = /(ista|logo|loga|grafo|grafa)$/;
const isOffice = (raw: string) => {
  const f = nz(raw);
  const w = f.split(' ');
  return (
    w.length <= 3 &&
    (OFFICES.has(f) || OFFICES.has(w[0]) || (w.length === 1 && /^\p{Ll}/u.test(raw.trim()) && OFFICE_SUFFIX.test(f)))
  );
};

const citySets = new WeakMap<ParseContext, Set<string>>();
function citiesOf(ctx: ParseContext) {
  let s = citySets.get(ctx);
  if (!s) {
    s = new Set([...CITIES, ...ctx.cities.map(nz)].filter(Boolean));
    citySets.set(ctx, s);
  }
  return s;
}

// ───────────────────────── Aplicar a la ficha ─────────────────────────

type ListKey = 'interests' | 'likes' | 'dislikes' | 'gifts' | 'keywords';
type State = {
  /** El último campo de lista que se llenó (para «le gusta el café, el mar y leer»). */
  last: ListKey | null;
  first: string;
  middle: string;
  lastName: string;
  order: 'dm' | 'md';
  cities: Set<string>;
};
const newState = (ctx: ParseContext, order: 'dm' | 'md' = 'dm'): State => ({
  last: null,
  first: '',
  middle: '',
  lastName: '',
  order,
  cities: citiesOf(ctx),
});

/** «el café, la playa y leer» → café, playa, leer (sin el artículo de adelante). */
const items = (raw: string) =>
  raw
    .split(/\s*(?:[,;/]|\s+y\s+|\s+e\s+|\n)\s*/)
    .map((x) => clip(tidy(x).replace(/^(?:el|la|los|las|un|una|unos|unas)\s+(?=\S)/i, ''), CAP.item))
    .filter((x) => x && hasLetters(x));
function pushList(p: BatchPerson, key: ListKey, raw: string, st: State | null, split = true) {
  const seen = new Set(p[key].map(nz));
  for (const it of split ? items(raw) : [clip(tidy(raw), CAP.item)]) {
    if (p[key].length >= CAP.list) break;
    const k = nz(it);
    if (it && !seen.has(k)) {
      seen.add(k);
      p[key].push(it);
    }
  }
  if (st) st.last = key;
}
function appendText(cur: string, more: string, sep: string, cap: number) {
  const m = more.trim();
  if (!m || nz(cur).includes(nz(m))) return cur;
  return clip(cur ? cur + sep + capFirst(m) : capFirst(m), cap);
}
/** Valores de relleno que traen algunas exportaciones («Normal», «False», «0/0/00»). */
const JUNK = /^(0|false|falso|true|normal|unspecified|no especificado|none|null|n\/a|-|0\/0\/00|00\/00\/0000)$/i;
function addFact(p: BatchPerson, label: string, value: string) {
  const l = clip(capFirst(tidy(label.replace(/\s*\d+\s*-\s*(value|valor)\s*$/i, ''))), CAP.factLabel);
  const v = clip(tidy(value), CAP.factValue);
  if (!l || !v || JUNK.test(v) || p.facts.length >= CAP.facts) return;
  if (p.facts.some((f) => nz(f.label) === nz(l) && nz(f.value) === nz(v))) return;
  p.facts.push({ label: l, value: v });
}
function setPhone(p: BatchPerson, notes: string[], raw: string) {
  const ph = cleanPhone(raw);
  if (!ph) {
    if (digitsOf(raw).length && !JUNK.test(raw.trim()))
      notes.push(`«${clip(raw.trim(), 30)}» no parece un teléfono: no se usó.`);
    return;
  }
  if (!p.phone) p.phone = ph;
  else if (digitsOf(p.phone).slice(-10) !== digitsOf(ph).slice(-10)) addFact(p, 'Otro teléfono', ph);
}
function setEmail(p: BatchPerson, notes: string[], raw: string) {
  const e = raw.trim().replace(/^mailto:/i, '').toLowerCase();
  if (!EMAIL_ONE.test(e)) {
    if (e && !JUNK.test(e)) notes.push(`«${clip(raw.trim(), 40)}» no es un correo válido: no se usó.`);
    return;
  }
  if (!p.email) p.email = clip(e, CAP.email);
  else if (p.email !== e) addFact(p, 'Otro correo', e);
}
function setSocial(p: BatchPerson, raw: string) {
  const s = cleanSocial(raw);
  if (!s) return;
  if (!p.social) p.social = s;
  else if (nz(p.social) !== nz(s)) addFact(p, 'Otra red', s);
}
function setBirthday(p: BatchPerson, notes: string[], raw: string, st: State) {
  if (/^[\s0/.-]*$/.test(raw)) return;
  const d = parseDate(raw, st.order);
  if (!d) {
    notes.push(`No entendí la fecha «${clip(raw.trim(), 30)}»: no se usó.`);
    return;
  }
  if (!p.birthday) {
    p.birthday = d.md;
    if (d.year) p.birthYear = d.year;
  } else if (p.birthday !== d.md) addFact(p, 'Otra fecha', raw);
}
function setGender(p: BatchPerson, raw: string) {
  const g = nz(raw);
  if (/^(f|femenino|mujer|female|woman|fem)$/.test(g)) p.gender = 'f';
  else if (/^(m|h|masculino|hombre|male|man|masc)$/.test(g)) p.gender = 'm';
}
const YES = /^(si|sí|yes|true|1|x|✓|✔|★|⭐|verdadero)$/i;

function applyKin(p: BatchPerson, hit: KinHit, raw: string) {
  if (hit.gender && !p.gender) p.gender = hit.gender;
  if (hit.mine && hit.kind && !p.kin) p.kin = hit.kind;
  if (hit.relation && !p.relation) p.relation = hit.relation;
  // «amiga del colegio», «mamá de Ana», «Cliente»: queda como contexto.
  if (hit.more && !p.role) {
    const t = tidy(raw).replace(/^(?:(?:es|era)\s+)?(?:mi|mis)\s+/i, '');
    p.role = clip(capFirst(t), CAP.role);
  }
}

/** Pone un valor con su etiqueta («Teléfono: …», una columna del CSV, un campo del vCard). */
function setField(p: BatchPerson, notes: string[], key: FieldKey, value: string, st: State) {
  const v = value.trim();
  if (!v) return;
  switch (key) {
    case 'skip':
      return;
    case 'name':
      if (!p.name) p.name = v;
      return;
    case 'first':
      st.first = st.first ? st.first + ' ' + v : v;
      return;
    case 'middle':
      st.middle = st.middle ? st.middle + ' ' + v : v;
      return;
    case 'last':
      st.lastName = st.lastName ? st.lastName + ' ' + v : v;
      return;
    case 'alias':
      if (!p.alias) p.alias = clip(tidy(v), CAP.alias);
      return;
    case 'phone':
      for (const part of v.split(/\s*[,;/|]\s*|\s+o\s+/)) setPhone(p, notes, part);
      return;
    case 'email':
      for (const part of v.match(EMAIL) ?? [v]) setEmail(p, notes, part);
      return;
    case 'birthday':
      setBirthday(p, notes, v, st);
      return;
    case 'city':
      if (!p.city && hasLetters(v)) p.city = clip(tidy(v), CAP.city);
      return;
    case 'country':
      addFact(p, 'País', v);
      return;
    case 'address':
      // Las exportaciones traen la dirección completa y también por partes: basta una.
      if (!p.facts.some((f) => f.label === 'Dirección')) addFact(p, 'Dirección', v);
      return;
    case 'occupation':
      if (!p.occupation && hasLetters(v)) p.occupation = clip(capFirst(tidy(v)), CAP.occupation);
      return;
    case 'company':
      if (!p.company && hasLetters(v)) p.company = clip(tidy(v), CAP.company);
      return;
    case 'social':
      setSocial(p, v);
      return;
    case 'web':
      if (new RegExp(SOCIAL, 'i').test(v)) setSocial(p, v);
      else addFact(p, 'Web', v);
      return;
    case 'im':
      addFact(p, 'Mensajería', v);
      return;
    case 'relation': {
      const hit = kinOf(v);
      if (hit) applyKin(p, hit, v);
      else if (!p.role && hasLetters(v)) p.role = clip(capFirst(tidy(v)), CAP.role);
      return;
    }
    case 'role':
      if (!p.role) p.role = clip(capFirst(tidy(v)), CAP.role);
      return;
    case 'bio':
      if (!JUNK.test(v)) p.bio = appendText(p.bio, v, '\n\n', CAP.bio);
      return;
    case 'likes':
    case 'dislikes':
    case 'gifts':
    case 'interests':
    case 'keywords':
      pushList(p, key, v, st);
      return;
    case 'family':
      p.family = appendText(p.family, v, '; ', CAP.family);
      return;
    case 'metHow':
      if (!p.metHow) p.metHow = clip(capFirst(tidy(v)), CAP.metHow);
      return;
    case 'gender':
      setGender(p, v);
      return;
    case 'favorite':
      if (YES.test(v)) p.favorite = true;
      return;
    case 'labels':
      for (const raw of v.split(/\s*(?::::|,|;)\s*/)) {
        const t = raw.trim();
        if (!t) continue;
        if (/^\*\s*starred$/i.test(t)) p.favorite = true;
        if (t.startsWith('*') || /^(mycontacts|my contacts|mis contactos)$/i.test(t)) continue;
        const hit = kinOf(t);
        if (hit) applyKin(p, hit, t);
        else pushList(p, 'keywords', t, st, false);
      }
      return;
  }
}

/** ¿Parece un nombre de persona? (letras, de una a seis palabras, sin ser una etiqueta). */
function nameLike(raw: string) {
  const s = tidy(raw);
  if (s.length < 2 || s.length > 80) return false;
  const words = s.split(' ');
  if (words.length > 6) return false;
  if (!words.every((w) => /^[\p{L}][\p{L}'’.-]*$/u.test(w))) return false;
  const f = nz(s);
  if (LABEL_WORDS.has(f) || CATEGORY[f] || MONTHS[f] || kinOf(f)) return false;
  return true;
}
/** Un nombre propio: como `nameLike` y con mayúscula en cada palabra («Laura de la Cruz»). */
function properName(raw: string) {
  const s = tidy(raw);
  return (
    nameLike(s) &&
    s.split(' ').every((w) => /^\p{Lu}/u.test(w) || PARTICLES.has(w.toLowerCase()))
  );
}
/** Quita del nombre lo que no es el nombre: «Laura "Lau" Gómez», «Laura mi prima». */
function splitName(p: BatchPerson, raw: string) {
  let s = raw;
  const quoted = /["“«]([^"”»]{2,40})["”»]/.exec(s);
  if (quoted) {
    if (!p.alias) p.alias = tidy(quoted[1]);
    s = s.replace(quoted[0], ' ');
  }
  const kin = /\s+(?:es\s+)?(?:mi|mis)\s+(.+)$/i.exec(s);
  if (kin) {
    const hit = kinOf('mi ' + kin[1]);
    if (hit) {
      applyKin(p, hit, 'mi ' + kin[1]);
      s = s.slice(0, kin.index);
    }
  }
  return tidy(s);
}

/**
 * Un trozo de texto sobre una persona: lo clasifica y lo pone en su campo. `first`: es el primer
 * trozo de su línea (el nombre suele ir ahí, aunque coincida con una ciudad, como «Florencia»).
 */
function applyFragment(p: BatchPerson, notes: string[], frag: string, st: State, first: boolean) {
  let raw = frag.replace(/\s+/g, ' ').trim();
  if (!raw) return;
  let took = false;

  // 1. Correos, redes y enlaces (antes que los teléfonos: un usuario puede tener números).
  raw = raw.replace(EMAIL, (m) => {
    setEmail(p, notes, m);
    took = true;
    return ' ';
  });
  raw = raw.replace(new RegExp(SOCIAL, 'gi'), (_m, net: string, user: string) => {
    setSocial(p, socialOf(net, user));
    took = true;
    return ' ';
  });
  raw = raw.replace(OTHER_URL, (m) => {
    addFact(p, 'Web', m);
    took = true;
    return ' ';
  });
  raw = raw.replace(HANDLE, (_m, pre: string, user: string) => {
    setSocial(p, '@' + user);
    took = true;
    return pre;
  });
  raw = raw.trim();
  if (!raw) return;

  // 2. Fechas: un cumpleaños («cumple 12 de marzo», «12/03/1990») salvo que sea cuándo se conocieron.
  //    Una fecha dentro de otra frase («viaje a Cartagena el 3 de mayo») no es su cumpleaños: solo
  //    cuenta si lo demás es el nombre («Laura Gómez 12/03/1990»).
  const f0 = nz(raw);
  const met = /\b(conoc|nos presentaron|me la presento|me lo presento)/.test(f0);
  if (!met) {
    const keyword = BIRTH_WORDS.test(f0);
    const sole = onlyDate(raw);
    const strong = !keyword && !sole && STRONG_DATE.test(f0);
    const rest = strong ? withoutDate(raw, false) : '';
    if (keyword || sole || (strong && (!rest || properName(rest)))) {
      if (parseDate(raw, st.order)) {
        setBirthday(p, notes, raw, st);
        raw = withoutDate(raw, keyword);
        if (!raw || !hasLetters(raw)) return;
      } else if (onlyDate(raw)) {
        notes.push(`No entendí la fecha «${clip(raw, 30)}»: no se usó.`);
        return;
      }
    }
  }
  // Un año suelto justo después del cumpleaños («marzo 12, 1990»).
  if (/^\d{4}$/.test(raw) && p.birthday && !p.birthYear) {
    const y = Number(raw);
    if (y >= 1900 && y <= new Date().getFullYear()) p.birthYear = y;
    return;
  }

  // 3. Teléfonos (sin confundirlos con fechas).
  if (!met)
    raw = raw.replace(PHONE, (m) => {
      if (isDateLike(m)) return m;
      setPhone(p, notes, m);
      took = true;
      return ' ';
    });
  // «Tel:», «Correo:» que quedaron solos después de sacar el dato.
  if (took)
    raw = raw.replace(
      /(?<![\p{L}\p{N}])(tel[eé]fono|tel|celular|cel|m[oó]vil|whatsapp|wsp|wpp|correo|e-?mail|mail|instagram|ig)(?![\p{L}\p{N}])\.?:?/giu,
      ' ',
    );
  raw = tidy(raw);
  if (!raw) return;
  const f = nz(raw);

  // 4. «Campo: valor».
  const labeled = /^([^:]{1,30}):\s*(.+)$/.exec(raw);
  if (labeled) {
    const [, label, value] = labeled;
    const key = fieldOf(label);
    // «Tipo: Móvil» y otras etiquetas de relleno de las exportaciones.
    if (key === 'skip') return;
    if (key) {
      setField(p, notes, key, value, st);
      if (key === 'first' || key === 'last' || key === 'middle') composeName(p, st);
      return;
    }
    const hit = kinOf(label);
    if (hit) {
      // «Mamá: Laura Gómez».
      applyKin(p, hit, label);
      if (!p.name && nameLike(splitName(emptyPerson(), value))) p.name = splitName(p, value);
      else applyFragment(p, notes, value, st, false);
      return;
    }
    // «Laura Gómez: amiga del colegio», «Laura: mi prima» (y no «Signo: Leo»).
    if (!p.name && first && nameLike(label) && (label.trim().includes(' ') || kinOf(value))) {
      p.name = splitName(p, label);
      applyFragment(p, notes, value, st, false);
      return;
    }
    if (hasLetters(label) && label.trim().split(' ').length <= 4) {
      addFact(p, label, value);
      return;
    }
  }

  // 5. Parentesco o tipo de relación.
  const hit = kinOf(raw);
  if (hit) {
    applyKin(p, hit, raw);
    st.last = null;
    return;
  }

  // 6. Frases conocidas.
  let m: RegExpExecArray | null;
  if ((m = /^(?:vive|vivo|reside|est[aá]|queda)\s+en\s+(.+)$/i.exec(raw))) {
    if (!p.city) p.city = clip(tidy(m[1]), CAP.city);
    return;
  }
  if ((m = /^trabaja\s+(?:en|para)\s+(.+)$/i.exec(raw))) {
    if (!p.company) p.company = clip(tidy(m[1]), CAP.company);
    return;
  }
  if ((m = /^(?:trabaja\s+(?:como|de)|es)\s+(.+)$/i.exec(raw)) && m[1].split(' ').length <= 6) {
    const rest = m[1];
    if (/^de\s+\p{Lu}/u.test(rest)) {
      if (!p.city) p.city = clip(tidy(rest.slice(3)), CAP.city);
      return;
    }
    const at = /^(.{2,40}?)\s+(?:en|at|@)\s+((?:el |la |los |las )?[\p{Lu}\d].{1,60})$/u.exec(rest);
    if (at) {
      if (!p.occupation) p.occupation = clip(capFirst(tidy(at[1])), CAP.occupation);
      if (!p.company) p.company = clip(tidy(at[2]), CAP.company);
    } else if (!p.occupation) p.occupation = clip(capFirst(tidy(rest)), CAP.occupation);
    return;
  }
  if ((m = /^estudia\s+(.+)$/i.exec(raw))) {
    if (!p.occupation) p.occupation = clip('Estudia ' + tidy(m[1]), CAP.occupation);
    return;
  }
  if ((m = /^no\s+le\s+gustan?\s+(.+)$|^(?:odia|detesta|no soporta)\s+(.+)$/i.exec(raw))) {
    pushList(p, 'dislikes', m[1] ?? m[2], st);
    return;
  }
  if (
    (m =
      /^(?:le\s+)?(?:gusta|gustan|encanta|encantan|fascina|fascinan)\s+(.+)$|^(?:ama|adora|fan de|fan[aá]tic[oa] de)\s+(.+)$/i.exec(
        raw,
      ))
  ) {
    pushList(p, 'likes', m[1] ?? m[2], st);
    return;
  }
  if ((m = /^(?:le\s+)?interesan?\s+(.+)$/i.exec(raw))) {
    pushList(p, 'interests', m[1], st);
    return;
  }
  if ((m = /^(?:regalo|regalarle|ideas? de regalo|le gustar[ií]a(?: tener)?)\s*:?\s+(.+)$/i.exec(raw))) {
    pushList(p, 'gifts', m[1], st);
    return;
  }
  if ((m = /^(?:apodo|alias|le dicen|le decimos|le digo|sobrenombre)\s*:?\s+(.+)$/i.exec(raw))) {
    if (!p.alias) p.alias = clip(tidy(m[1]), CAP.alias);
    return;
  }
  if (met) {
    if (!p.metHow) p.metHow = clip(capFirst(raw), CAP.metHow);
    else p.bio = appendText(p.bio, raw, '\n\n', CAP.bio);
    return;
  }
  if (
    /^(?:tiene\s+(?:\d+|un|una|dos|tres)\s+hij|casad[oa]\s+con|su\s+(?:esposo|esposa|pareja|novio|novia|marido|hij[oa]s?|perro|gato|mascota)\b|mascota\b)/i.test(
      raw,
    )
  ) {
    p.family = appendText(p.family, raw, '; ', CAP.family);
    return;
  }
  if (/^(hombre|mujer|masculino|femenino)$/.test(f)) {
    setGender(p, f);
    return;
  }
  if (/^(favorit[oa]|⭐+|★+|vip)$/i.test(raw)) {
    p.favorite = true;
    return;
  }
  if ((m = /^(de|desde|en)\s+([\p{Lu}][\p{L}.]+(?:\s+(?:de\s+|del\s+)?[\p{Lu}][\p{L}.]+){0,3})$/u.exec(raw))) {
    // «de Medellín» es de dónde es; «en Chía», solo si es una ciudad conocida.
    if (m[1].toLowerCase() !== 'en' || st.cities.has(nz(m[2]))) {
      if (!p.city) p.city = clip(m[2], CAP.city);
      else pushList(p, 'keywords', raw, st, false);
      return;
    }
  }

  // 7. Sigue la lista anterior («le gusta el café, el mar y leer»).
  if (st.last && st.last !== 'keywords' && /^\p{Ll}/u.test(raw) && raw.split(' ').length <= 6) {
    pushList(p, st.last, raw, st);
    return;
  }

  // 8. El nombre (el primer trozo que lo parece).
  if (!p.name) {
    const name = splitName(emptyPerson(), raw);
    if (nameLike(name) && (first || !st.cities.has(nz(name))) && !(isOffice(name) && !first)) {
      p.name = splitName(p, raw);
      return;
    }
  }

  // 9. Ciudad u oficio sueltos.
  if (st.cities.has(f)) {
    if (!p.city) p.city = clip(tidy(raw), CAP.city);
    else pushList(p, 'keywords', raw, st, false);
    return;
  }
  // «diseñador en Rappi»: el oficio y dónde (antes que el oficio solo, para no juntarlos).
  const at = /^(.{2,40}?)\s+(?:en|at|@)\s+((?:el |la |los |las )?[\p{Lu}\d].{1,60})$/u.exec(raw);
  if (at && isOffice(at[1])) {
    if (!p.occupation) p.occupation = clip(capFirst(tidy(at[1])), CAP.occupation);
    if (!p.company) p.company = clip(tidy(at[2]), CAP.company);
    return;
  }
  if (!p.occupation && isOffice(raw)) {
    p.occupation = clip(capFirst(tidy(raw)), CAP.occupation);
    return;
  }

  // 10. Lo demás: corto, palabra clave (cómo la recuerdas); largo, a las notas.
  if (raw.length <= 60 && raw.split(' ').length <= 8) pushList(p, 'keywords', raw, st, false);
  else p.bio = appendText(p.bio, raw, '\n\n', CAP.bio);
  st.last = null;
}

function composeName(p: BatchPerson, st: State) {
  const full = [st.first, st.middle, st.lastName].filter(Boolean).join(' ').trim();
  if (full) p.name = full;
}

/** Deja la ficha lista: nombre bonito, todo dentro de sus límites, sin repetidos. */
export function finish(p: BatchPerson, notes: string[]): Parsed {
  p.name = clip(titleName(p.name.replace(/[\d_@#]+/g, ' ')), CAP.name);
  if (p.name && !hasLetters(p.name)) p.name = '';
  p.alias = clip(tidy(p.alias), CAP.alias);
  if (nz(p.alias) === nz(p.name)) p.alias = '';
  p.role = clip(tidy(p.role), CAP.role);
  if (p.email && !EMAIL_ONE.test(p.email)) p.email = '';
  if (p.phone) p.phone = cleanPhone(p.phone);
  if (p.social) p.social = cleanSocial(p.social);
  p.city = clip(tidy(p.city), CAP.city);
  p.occupation = clip(tidy(p.occupation), CAP.occupation);
  p.company = clip(tidy(p.company), CAP.company);
  p.metHow = clip(p.metHow.trim(), CAP.metHow);
  p.family = clip(p.family.trim(), CAP.family);
  p.bio = clip(p.bio.trim(), CAP.bio);
  if (p.birthday && !/^\d{2}-\d{2}$/.test(p.birthday)) p.birthday = '';
  if (!p.birthday) p.birthYear = null;
  if (p.kin && !(p.kin in tieKinds)) p.kin = null;
  if (p.relation && !relations.includes(p.relation)) p.relation = null;
  if (p.kin && !p.relation) p.relation = relationForKind(p.kin);
  for (const k of ['interests', 'likes', 'dislikes', 'gifts', 'keywords'] as const) {
    const seen = new Set<string>();
    p[k] = p[k]
      .map((x) => clip(tidy(x), CAP.item))
      .filter((x) => x && !seen.has(nz(x)) && seen.add(nz(x)))
      .slice(0, CAP.list);
  }
  // Lo que ya quedó en un campo no se repite como palabra clave.
  const taken = new Set(
    [p.name, p.city, p.occupation, p.company, p.alias, p.role].filter(Boolean).map(nz),
  );
  p.keywords = p.keywords.filter((k) => !taken.has(nz(k)));
  p.facts = p.facts.slice(0, CAP.facts);
  if (!p.name) notes.push('Falta el nombre.');
  return { person: p, notes: [...new Set(notes)] };
}

// ───────────────────────── vCard ─────────────────────────

function decodeQP(value: string, charset: string) {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(c.charCodeAt(0) & 0xff);
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }
}
const unescapeV = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

type CardLine = { key: string; params: string; value: string };

function parseVCard(text: string, ctx: ParseContext): Parsed[] {
  // Líneas dobladas (RFC 6350: siguen con un espacio) y saltos suaves de quoted-printable («=»
  // al final), solo en esas líneas: una foto en base64 también puede terminar en «=».
  const lines: string[] = [];
  for (const l of text.replace(/\r\n?/g, '\n').split('\n')) {
    const prev = lines.length ? lines[lines.length - 1] : null;
    if (prev !== null && /^[ \t]/.test(l)) lines[lines.length - 1] = prev + l.slice(1);
    else if (prev !== null && prev.endsWith('=') && /QUOTED-PRINTABLE/i.test(prev.split(':')[0]))
      lines[lines.length - 1] = prev.slice(0, -1) + l;
    else lines.push(l);
  }
  const out: Parsed[] = [];
  let card: CardLine[] | null = null;
  for (const line of lines) {
    if (/^BEGIN:VCARD/i.test(line)) {
      card = [];
      continue;
    }
    if (/^END:VCARD/i.test(line)) {
      if (card) {
        const row = fromCard(card, ctx);
        if (row.person.name || row.person.phone || row.person.email) out.push(row);
      }
      card = null;
      continue;
    }
    if (!card) continue;
    const at = line.indexOf(':');
    if (at < 1) continue;
    const head = line.slice(0, at).replace(/^item\d+\./i, '');
    const [key, ...params] = head.split(';');
    card.push({ key: key.toUpperCase(), params: params.join(';').toUpperCase(), value: line.slice(at + 1) });
  }
  return out;
}

function fromCard(card: CardLine[], ctx: ParseContext): Parsed {
  const p = emptyPerson();
  const notes: string[] = [];
  const st = newState(ctx);
  const val = (c: CardLine) => {
    const qp = /QUOTED-PRINTABLE/.test(c.params);
    const charset = /CHARSET=([\w-]+)/.exec(c.params)?.[1] ?? 'utf-8';
    return unescapeV(qp ? decodeQP(c.value, charset) : c.value);
  };
  // Los celulares primero.
  const phones = card
    .filter((c) => c.key === 'TEL')
    .sort((a, b) => Number(/CELL|MOBILE/.test(b.params)) - Number(/CELL|MOBILE/.test(a.params)));
  let structured = '';
  for (const c of card) {
    if (c.key === 'PHOTO' || c.key === 'TEL') continue;
    const v = val(c);
    if (!v) continue;
    switch (c.key) {
      case 'FN':
        if (!p.name) p.name = v;
        break;
      case 'N': {
        const [last = '', first = '', middle = ''] = v.split(';').map((x) => x.trim());
        structured = [first, middle, last].filter(Boolean).join(' ');
        break;
      }
      case 'NICKNAME':
        if (!p.alias) p.alias = clip(v.split(',')[0].trim(), CAP.alias);
        break;
      case 'EMAIL':
        setEmail(p, notes, v);
        break;
      case 'BDAY':
        setBirthday(p, notes, v, st);
        break;
      case 'ORG': {
        const org = v.split(';')[0].trim();
        if (org && !p.company) p.company = clip(org, CAP.company);
        break;
      }
      case 'TITLE':
        if (!p.occupation) p.occupation = clip(capFirst(v), CAP.occupation);
        break;
      case 'ROLE':
        if (!p.occupation) p.occupation = clip(capFirst(v), CAP.occupation);
        else if (!p.role) p.role = clip(capFirst(v), CAP.role);
        break;
      case 'ADR': {
        const parts = v.split(';').map((x) => x.trim());
        if (parts[3] && !p.city) p.city = clip(parts[3], CAP.city);
        if (parts[2]) addFact(p, 'Dirección', parts[2]);
        if (parts[6]) addFact(p, 'País', parts[6]);
        break;
      }
      case 'NOTE':
        p.bio = appendText(p.bio, v, '\n\n', CAP.bio);
        break;
      case 'X-SOCIALPROFILE':
        setSocial(p, v);
        break;
      case 'URL':
        setField(p, notes, 'web', v, st);
        break;
      case 'IMPP':
        addFact(p, 'Mensajería', v);
        break;
      case 'CATEGORIES':
        setField(p, notes, 'labels', v, st);
        break;
      case 'GENDER':
      case 'X-GENDER':
        setGender(p, v.split(';')[0]);
        break;
      case 'ANNIVERSARY':
      case 'X-ANNIVERSARY': {
        const d = parseDate(v);
        addFact(p, 'Aniversario', d ? `${d.md.slice(3)}/${d.md.slice(0, 2)}${d.year ? '/' + d.year : ''}` : v);
        break;
      }
      default:
        break;
    }
  }
  for (const c of phones) setPhone(p, notes, val(c));
  if (!p.name && structured) p.name = structured;
  if (!p.name && p.company) {
    p.name = p.company;
    notes.push('Sin nombre en el contacto: se usó el de la empresa.');
  }
  return finish(p, notes);
}

// ───────────────────────── CSV ─────────────────────────

function delimiterOf(text: string) {
  const sample = text.split('\n').slice(0, 6).join('\n');
  let best: string | null = null;
  let count = 0;
  for (const d of [',', ';', '\t']) {
    let n = 0;
    let quoted = false;
    for (const c of sample) {
      if (c === '"') quoted = !quoted;
      else if (c === d && !quoted) n++;
    }
    if (n > count) {
      count = n;
      best = d;
    }
  }
  return best;
}
/** Filas de un CSV con comillas, separadores y saltos de línea dentro de los campos. */
function splitCsv(text: string, d: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell.trim()) {
      quoted = true;
      cell = '';
    } else if (c === d) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** ¿Esta celda es un dato y no un encabezado? (un correo, un teléfono, una fecha). */
const looksData = (c: string) => EMAIL_ONE.test(c.trim()) || digitsOf(c).length >= 5 || parseDate(c) !== null;
/** ¿La primera fila es un encabezado? (al menos dos columnas conocidas, o el nombre y otra). */
function headerOf(cells: string[]) {
  if (cells.some((c) => looksData(c))) return null;
  const keys = cells.map((c) => fieldOf(c));
  const known = keys.filter((k) => k && k !== 'skip').length;
  const named = keys.some((k) => k === 'name' || k === 'first' || k === 'last');
  return known >= 2 || (named && cells.length >= 2) ? keys : null;
}

function parseCsv(text: string, d: string, ctx: ParseContext): Parsed[] | null {
  const rows = splitCsv(text, d);
  if (rows.length < 2) return null;
  const keys = headerOf(rows[0]);
  if (!keys) return null;
  const head = rows[0].map((h) => h.trim());
  // Cumpleaños mes/día (Outlook en inglés): si en alguno el segundo número pasa de 12.
  const bday = keys.findIndex((k) => k === 'birthday');
  let order: 'dm' | 'md' = 'dm';
  if (bday >= 0) {
    let dm = 0;
    let md = 0;
    for (const r of rows.slice(1)) {
      const m = /^\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})/.exec(r[bday] ?? '');
      if (!m) continue;
      if (+m[1] > 12) dm++;
      if (+m[2] > 12) md++;
    }
    if (md > dm) order = 'md';
  }
  const out: Parsed[] = [];
  for (const r of rows.slice(1)) {
    const p = emptyPerson();
    const notes: string[] = [];
    const st = newState(ctx, order);
    r.forEach((cell, i) => {
      const v = cell.trim();
      if (!v) return;
      const key = keys[i];
      if (key) setField(p, notes, key, v, st);
      // Columnas que Nexo no conoce: quedan como dato libre, con su encabezado.
      else if (head[i] && head[i].length <= CAP.factLabel) addFact(p, head[i], v);
    });
    if (!p.name) composeName(p, st);
    // «Nombre» y «Apellido» en columnas distintas.
    else if (st.lastName && !nz(p.name).includes(nz(st.lastName)))
      p.name = [p.name, st.middle, st.lastName].filter(Boolean).join(' ');
    if (!p.name && !p.phone && !p.email) continue;
    out.push(finish(p, notes));
  }
  return out;
}

// ───────────────────────── Texto libre ─────────────────────────

const SEPARATORS = /\s*[;|·•\t]\s*|\s+[-–—]\s+|\s*,\s*|\s*[([\]]\s*|\s*\)\s*/;
const BULLET = /^\s*(?:[-*•·>]+|\d{1,3}[.)-]|[a-z][.)])\s+/i;
const LABELED_LINE = /^\s*([^:\n]{1,30}?)\s*[:=]\s*(.*)$/;

type Section = { relation: Relation | null; kin: TieKind | null; keyword: string };

/** Un encabezado de sección («Familia:», «## Amigos del colegio», «PRIMOS»). */
function sectionOf(line: string): Section | null {
  const raw = line.trim();
  if (!raw || /\d|@/.test(raw)) return null;
  const marked = /^#+\s*/.test(raw) || /:\s*$/.test(raw);
  const t = tidy(raw.replace(/^#+\s*/, '').replace(/:\s*$/, ''));
  if (!t || t.split(' ').length > 5) return null;
  const upper = t.length > 3 && t === t.toUpperCase() && /\p{Lu}/u.test(t);
  const hit = kinOf(t);
  if (hit && (hit.plural || marked || upper || CATEGORY[nz(t)]))
    return {
      relation: hit.relation,
      kin: hit.mine && hit.plural ? hit.kind : null,
      keyword: hit.more ? capFirst(t.toLowerCase()) : '',
    };
  // Solo con «#» o «:» al final: un texto en mayúsculas puede ser un nombre («LAURA GÓMEZ»).
  if (marked) return { relation: null, kin: null, keyword: capFirst(upper ? t.toLowerCase() : t) };
  return null;
}

function fromFragments(frags: string[], ctx: ParseContext, section: Section | null): Parsed {
  const p = emptyPerson();
  const notes: string[] = [];
  const st = newState(ctx);
  frags.forEach((f, i) => applyFragment(p, notes, f, st, i === 0));
  if (section) {
    if (section.relation && !p.relation) p.relation = section.relation;
    if (section.kin && !p.kin) p.kin = section.kin;
    if (section.keyword) pushList(p, 'keywords', section.keyword, null, false);
  }
  return finish(p, notes);
}

/** «Laura, Carlos y Mariana»: varios nombres en una sola línea. */
function namesIn(line: string, cities: Set<string>) {
  const parts = line
    .split(/\s*[,;/]\s*|\s+y\s+|\s+e\s+/)
    .map((x) => tidy(x.replace(BULLET, '')))
    .filter(Boolean);
  if (parts.length < 2 || !parts.every((x) => nameLike(x) && !isOffice(x))) return null;
  // «Laura, Medellín»: con dos trozos, uno de ellos ciudad, no son dos personas.
  const towns = parts.filter((x) => cities.has(nz(x))).length;
  if (towns && (parts.length === 2 || towns * 2 >= parts.length)) return null;
  return parts;
}

/** Una línea que es un dato de la persona de arriba (no otra persona). */
function detailLine(l: string, cities: Set<string>) {
  const t = l.replace(BULLET, '').trim();
  return (
    /@|\d/.test(t) ||
    LABELED_LINE.test(t) ||
    Boolean(kinOf(t)) ||
    cities.has(nz(t)) ||
    isOffice(t.split(SEPARATORS)[0] ?? '') ||
    /^\p{Ll}/u.test(t) ||
    /^(vive|trabaja|estudia|le |no le |es |de |cumple|naci|conoc)/i.test(t)
  );
}

function parseText(text: string, ctx: ParseContext): ParseResult {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim());
  const filled = lines.filter(Boolean);
  if (!filled.length) return { rows: [], kind: null };
  const cities = citiesOf(ctx);
  const keep = (rows: Parsed[]) => rows.filter((r) => r.person.name || r.person.phone || r.person.email);

  // Una sola línea con varios nombres.
  if (filled.length === 1) {
    const names = namesIn(filled[0], cities);
    if (names) return { rows: keep(names.map((n) => fromFragments([n], ctx, null))), kind: 'nombres' };
  }

  const groups: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (!l) {
      if (cur.length) groups.push(cur);
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) groups.push(cur);

  // Fichas «Campo: valor» (con una línea en blanco entre personas, o un «Nombre:» nuevo).
  // Solo etiquetas limpias («Teléfono:»): «Laura - tel: 300…» es una línea con su persona.
  const labeled = filled.filter((l) => {
    const m = LABELED_LINE.exec(l);
    if (!m || !m[2].trim() || /[-–,;|]/.test(m[1]) || m[1].trim().split(/\s+/).length > 4) return false;
    // «Familia: Laura, Carlos» es una sección con sus nombres, no el campo de una ficha.
    if (kinOf(m[1])) return false;
    const key = fieldOf(m[1]);
    return key && key !== 'skip';
  }).length;
  if (labeled >= 2 && labeled >= filled.length * 0.4) {
    const rows: Parsed[] = [];
    for (const g of groups) {
      let frags: string[] = [];
      const flush = () => {
        if (frags.length) rows.push(fromFragments(frags, ctx, null));
        frags = [];
      };
      for (const l of g) {
        const m = LABELED_LINE.exec(l);
        if (
          m &&
          fieldOf(m[1]) === 'name' &&
          frags.some((f) => {
            const fm = LABELED_LINE.exec(f);
            return fm ? fieldOf(fm[1]) === 'name' : false;
          })
        )
          flush();
        frags.push(l.replace(BULLET, ''));
      }
      flush();
    }
    return { rows: keep(rows), kind: 'bloques' };
  }

  // Fichas sin etiquetas: el nombre arriba y sus datos debajo, con una línea en blanco entre
  // personas. Solo si de verdad lo parece (si no, cada línea es una persona).
  const multi = groups.filter((g) => g.length > 1);
  if (
    groups.length >= 2 &&
    multi.length >= groups.length * 0.6 &&
    multi.every(
      (g) => nameLike(splitName(emptyPerson(), g[0].replace(BULLET, ''))) && g.slice(1).every((l) => detailLine(l, cities)),
    )
  ) {
    const rows = groups.map((g) =>
      fromFragments(
        g.flatMap((l) => l.replace(BULLET, '').split(SEPARATORS)),
        ctx,
        null,
      ),
    );
    return { rows: keep(rows), kind: 'bloques' };
  }

  // Una persona por línea (con secciones «Familia:», «Trabajo:»…).
  const rows: Parsed[] = [];
  let section: Section | null = null;
  for (const l of filled) {
    if (/^(\/\/|--\s)/.test(l)) continue;
    const sec = sectionOf(l);
    if (sec) {
      section = sec;
      continue;
    }
    const line = l.replace(BULLET, '');
    // «Familia: Laura, Carlos y Ana»: la sección y sus nombres en la misma línea.
    const inline = LABELED_LINE.exec(line);
    const inlineSec = inline && inline[2].trim() ? sectionOf(inline[1] + ':') : null;
    if (inline && inlineSec && (inlineSec.relation || inlineSec.kin)) {
      const list = namesIn(inline[2], cities) ?? (nameLike(inline[2]) ? [tidy(inline[2])] : null);
      if (list) {
        for (const n of list) rows.push(fromFragments([n], ctx, inlineSec));
        continue;
      }
    }
    // «Laura Gómez, Carlos Ruiz, Mariana Díaz»: varios nombres completos en una línea (tres o
    // más; con dos, el segundo puede ser su empresa).
    const names = namesIn(line, cities);
    if (names && names.length >= 3 && names.every((n) => n.split(' ').length >= 2 && properName(n))) {
      for (const n of names) rows.push(fromFragments([n], ctx, section));
      continue;
    }
    const delim = /"/.test(line) ? delimiterOf(line) : null;
    const frags = delim ? (splitCsv(line, delim)[0] ?? []) : line.split(SEPARATORS);
    rows.push(fromFragments(frags, ctx, section));
  }
  const kept = keep(rows);
  const bare = kept.every(
    (r) => !r.person.phone && !r.person.email && !r.person.birthday && !r.person.keywords.length && !r.person.kin,
  );
  return { rows: kept, kind: bare ? 'nombres' : 'lineas' };
}

/** Lee lo que pegaste o importaste: vCard, CSV con encabezado, fichas o una lista. */
export function parsePeople(text: string, ctx: ParseContext): ParseResult {
  const t = text.replace(/^\uFEFF/, '');
  if (!t.trim()) return { rows: [], kind: null };
  if (/BEGIN:VCARD/i.test(t)) return { rows: parseVCard(t, ctx), kind: 'vcard' };
  const norm = t.replace(/\r\n?/g, '\n');
  const d = delimiterOf(norm);
  if (d) {
    const rows = parseCsv(norm, d, ctx);
    if (rows) return { rows, kind: 'csv' };
  }
  return parseText(norm, ctx);
}

/** ¿Es texto libre? (la IA solo hace falta ahí: vCard y CSV ya traen sus campos). */
export const isFreeText = (kind: ParseKind | null) =>
  kind === 'lineas' || kind === 'bloques' || kind === 'nombres';

// ───────────────────────── Lo que propone la IA ─────────────────────────

/** Partes del texto de hasta `max` caracteres, sin cortar una persona por la mitad. */
export function chunksOf(text: string, max = 3000) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const out: string[] = [];
  let cur = '';
  const push = (s: string) => {
    if (cur && cur.length + s.length + 2 > max) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? cur + '\n' + s : s;
  };
  for (const b of blocks) {
    if (b.length <= max) push(b + '\n');
    else
      for (const line of b.split('\n')) {
        if (line.length <= max) push(line);
        else for (let i = 0; i < line.length; i += max) push(line.slice(i, i + max));
      }
  }
  if (cur.trim()) out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean);
}

/**
 * Convierte lo que devolvió la IA en fichas válidas, con los mismos filtros que la lectura local.
 * Además, nada que no esté en el texto: el nombre debe aparecer, y el teléfono, el correo, la red
 * y el año también; si no, se descartan (la IA no inventa contactos).
 */
export function fromAi(list: unknown, source: string) {
  const hay = ' ' + nz(source).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  const has = (s: string) => {
    const w = nz(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return Boolean(w) && hay.includes(' ' + w + ' ');
  };
  const digits = digitsOf(source);
  const lower = source.toLowerCase();
  const rows: Parsed[] = [];
  let dropped = 0;
  for (const item of Array.isArray(list) ? list.slice(0, MAX_ROWS) : []) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const s = (k: string, n = 300) => (typeof o[k] === 'string' ? (o[k] as string).trim().slice(0, n) : '');
    const arr = (k: string) =>
      Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const name = s('name', CAP.name);
    const words = nz(name)
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 1);
    // El nombre tiene que estar en el texto (al menos una de sus palabras).
    if (!words.length || !words.some((w) => hay.includes(' ' + w + ' '))) {
      dropped++;
      continue;
    }
    const p = emptyPerson();
    const notes: string[] = [];
    p.name = name;
    const alias = s('alias', CAP.alias);
    if (alias && has(alias)) p.alias = alias;
    const phone = s('phone', 40);
    if (phone) {
      const d = digitsOf(phone);
      if (d.length >= 7 && digits.includes(d.slice(-7))) setPhone(p, notes, phone);
    }
    const email = s('email', CAP.email).toLowerCase();
    if (email && lower.includes(email)) setEmail(p, notes, email);
    const social = s('social', CAP.social);
    if (social && lower.includes(social.replace(/^@/, '').toLowerCase())) setSocial(p, social);
    const g = s('gender', 4);
    if (g === 'f' || g === 'm') p.gender = g;
    const rel = s('relation', 20) as Relation;
    if (relations.includes(rel)) p.relation = rel;
    const kin = s('kin', 20) as TieKind;
    if (kin && kin in tieKinds) p.kin = kin;
    p.role = s('role', CAP.role);
    p.city = s('city', CAP.city);
    p.occupation = s('occupation', CAP.occupation);
    p.company = s('company', CAP.company);
    const md = /^(\d{1,2})-(\d{1,2})$/.exec(s('birthday', 10));
    if (md) {
      const d = makeDate(+md[1], +md[2], null);
      if (d) p.birthday = d.md;
    }
    const year = Number(o.birth_year);
    if (p.birthday && Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear()) {
      if (source.includes(String(year)) || new RegExp(`[/.-]${String(year).slice(2)}\\b`).test(source))
        p.birthYear = year;
    }
    p.metHow = s('met_how', CAP.metHow);
    p.family = s('family', CAP.family);
    for (const k of ['interests', 'likes', 'dislikes', 'gifts', 'keywords'] as const)
      for (const it of arr(k)) pushList(p, k, it, null, false);
    for (const f of Array.isArray(o.facts) ? o.facts : []) {
      const fo = (f ?? {}) as Record<string, unknown>;
      if (typeof fo.label === 'string' && typeof fo.value === 'string') addFact(p, fo.label, fo.value);
    }
    p.bio = s('notes', CAP.bio);
    rows.push(finish(p, notes));
  }
  return { rows, dropped };
}

// ───────────────────────── El lote ─────────────────────────

/** Llena lo vacío de `a` con lo de `b` (dos filas de la misma persona). */
export function mergeInto(a: BatchPerson, b: BatchPerson): BatchPerson {
  const out: BatchPerson = { ...a, facts: [...a.facts] };
  for (const k of ['alias', 'role', 'phone', 'email', 'social', 'city', 'occupation', 'company', 'metHow'] as const)
    if (!out[k] && b[k]) out[k] = b[k];
  if (!out.birthday && b.birthday) {
    out.birthday = b.birthday;
    out.birthYear = b.birthYear;
  } else if (!out.birthYear && b.birthYear && out.birthday === b.birthday) out.birthYear = b.birthYear;
  out.gender = out.gender ?? b.gender;
  out.relation = out.relation ?? b.relation;
  out.kin = out.kin ?? b.kin;
  out.favorite = out.favorite || b.favorite;
  out.family = appendText(out.family, b.family, '; ', CAP.family);
  out.bio = appendText(out.bio, b.bio, '\n\n', CAP.bio);
  for (const k of ['interests', 'likes', 'dislikes', 'gifts', 'keywords'] as const) {
    const seen = new Set(out[k].map(nz));
    out[k] = [...out[k], ...b[k].filter((x) => !seen.has(nz(x)))].slice(0, CAP.list);
  }
  for (const f of b.facts) addFact(out, f.label, f.value);
  // Un teléfono o un correo distinto no se pierde.
  if (b.phone && phoneKey(out.phone) !== phoneKey(b.phone)) addFact(out, 'Otro teléfono', b.phone);
  if (b.email && out.email !== b.email) addFact(out, 'Otro correo', b.email);
  return out;
}

/** Los últimos 10 dígitos (así +57 300… y 300… cuentan igual). */
export const phoneKey = (s: string) => {
  const d = digitsOf(s);
  return d.length >= 7 ? d.slice(-10) : '';
};
