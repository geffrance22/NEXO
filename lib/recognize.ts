import type { Gender, Person, Tie, TieKind } from '../data';
import { normalizeText } from './format';
import { genderOf } from './gender';
import { ME, kinCall, kindWord, surnamesOf, tieKinds, tiesOf } from './relations';

/**
 * Reconocer a las personas de un texto: por nombre completo, apodo, nombre de pila, apellido
 * («los Gómez») y parentesco («mi mamá», «mi tío Carlos», «la hermana de Laura»). Lo usan el
 * formulario de recuerdos y la captura de experiencias.
 */

/** Un tramo del texto que nombra a una o varias personas. */
export type Mention = {
  start: number;
  end: number;
  text: string;
  ids: string[];
  /** Son todas a la vez («los Gómez», «mis hermanos»); si no, varias `ids` son opciones. */
  group?: boolean;
  /** Por qué se reconoció: «nombre», «apellido», «tu mamá»… */
  why: string;
  strength: number;
};

/** Un parentesco nombrado en el texto, con lo que se sabe de quién es. */
export type KinCue = {
  /** Mismo dueño, vínculo y sexo = misma pista (aunque se repita en el texto). */
  key: string;
  start: number;
  end: number;
  /** «tu mamá», «tus hermanos», «la hermana de Laura». */
  label: string;
  /** Lo que la persona es del dueño («padre» con sexo «f» = madre). */
  kind: TieKind;
  gender: Gender | null;
  /** De quién: tú (ME) u otra persona. */
  owner: string;
  plural: boolean;
  /**
   * known: ya está vinculada; choose: hay varias que podrían ser; confirm: la nombraste («mi tío
   * Carlos») pero falta guardar el vínculo; unknown: nadie tiene ese vínculo todavía.
   */
  status: 'known' | 'choose' | 'confirm' | 'unknown';
  /** Personas que encajan (ya vinculadas así o la nombrada). */
  ids: string[];
  /** Nombre propio que sigue y no está en tu universo («mi tía Rosa»). */
  newName?: string;
};

export type Recognition = { mentions: Mention[]; cues: KinCue[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

type KinWord = { kind: TieKind; g: Gender | null; plural?: boolean };

/** Palabras de parentesco (sin tildes) y lo que significan. */
const KIN_WORDS: Record<string, KinWord> = {
  padre: { kind: 'padre', g: 'm' },
  papa: { kind: 'padre', g: 'm' },
  papi: { kind: 'padre', g: 'm' },
  papito: { kind: 'padre', g: 'm' },
  padrastro: { kind: 'padre', g: 'm' },
  madre: { kind: 'padre', g: 'f' },
  mama: { kind: 'padre', g: 'f' },
  mami: { kind: 'padre', g: 'f' },
  mamita: { kind: 'padre', g: 'f' },
  madrastra: { kind: 'padre', g: 'f' },
  padres: { kind: 'padre', g: null, plural: true },
  papas: { kind: 'padre', g: null, plural: true },
  hijo: { kind: 'hijo', g: 'm' },
  hija: { kind: 'hijo', g: 'f' },
  hijastro: { kind: 'hijo', g: 'm' },
  hijastra: { kind: 'hijo', g: 'f' },
  hijos: { kind: 'hijo', g: null, plural: true },
  hijas: { kind: 'hijo', g: 'f', plural: true },
  hermano: { kind: 'hermano', g: 'm' },
  hermana: { kind: 'hermano', g: 'f' },
  hermanito: { kind: 'hermano', g: 'm' },
  hermanita: { kind: 'hermano', g: 'f' },
  hermanastro: { kind: 'hermano', g: 'm' },
  hermanastra: { kind: 'hermano', g: 'f' },
  'medio hermano': { kind: 'hermano', g: 'm' },
  'media hermana': { kind: 'hermano', g: 'f' },
  hermanos: { kind: 'hermano', g: null, plural: true },
  hermanas: { kind: 'hermano', g: 'f', plural: true },
  abuelo: { kind: 'abuelo', g: 'm' },
  abuela: { kind: 'abuelo', g: 'f' },
  abuelito: { kind: 'abuelo', g: 'm' },
  abuelita: { kind: 'abuelo', g: 'f' },
  abuelos: { kind: 'abuelo', g: null, plural: true },
  abuelas: { kind: 'abuelo', g: 'f', plural: true },
  nieto: { kind: 'nieto', g: 'm' },
  nieta: { kind: 'nieto', g: 'f' },
  nietos: { kind: 'nieto', g: null, plural: true },
  nietas: { kind: 'nieto', g: 'f', plural: true },
  tio: { kind: 'tio', g: 'm' },
  tia: { kind: 'tio', g: 'f' },
  tios: { kind: 'tio', g: null, plural: true },
  tias: { kind: 'tio', g: 'f', plural: true },
  sobrino: { kind: 'sobrino', g: 'm' },
  sobrina: { kind: 'sobrino', g: 'f' },
  sobrinos: { kind: 'sobrino', g: null, plural: true },
  sobrinas: { kind: 'sobrino', g: 'f', plural: true },
  primo: { kind: 'primo', g: 'm' },
  prima: { kind: 'primo', g: 'f' },
  primos: { kind: 'primo', g: null, plural: true },
  primas: { kind: 'primo', g: 'f', plural: true },
  suegro: { kind: 'suegro', g: 'm' },
  suegra: { kind: 'suegro', g: 'f' },
  suegros: { kind: 'suegro', g: null, plural: true },
  yerno: { kind: 'yerno', g: 'm' },
  nuera: { kind: 'yerno', g: 'f' },
  cunado: { kind: 'cunado', g: 'm' },
  cunada: { kind: 'cunado', g: 'f' },
  cunados: { kind: 'cunado', g: null, plural: true },
  esposo: { kind: 'pareja', g: 'm' },
  esposa: { kind: 'pareja', g: 'f' },
  marido: { kind: 'pareja', g: 'm' },
  novio: { kind: 'pareja', g: 'm' },
  novia: { kind: 'pareja', g: 'f' },
  pareja: { kind: 'pareja', g: null },
  exesposo: { kind: 'expareja', g: 'm' },
  exesposa: { kind: 'expareja', g: 'f' },
  exnovio: { kind: 'expareja', g: 'm' },
  exnovia: { kind: 'expareja', g: 'f' },
  expareja: { kind: 'expareja', g: null },
  'ex esposo': { kind: 'expareja', g: 'm' },
  'ex esposa': { kind: 'expareja', g: 'f' },
  'ex novio': { kind: 'expareja', g: 'm' },
  'ex novia': { kind: 'expareja', g: 'f' },
  'ex pareja': { kind: 'expareja', g: null },
  'mejor amigo': { kind: 'mejoramigo', g: 'm' },
  'mejor amiga': { kind: 'mejoramigo', g: 'f' },
  amigo: { kind: 'amigo', g: 'm' },
  amiga: { kind: 'amigo', g: 'f' },
  amigos: { kind: 'amigo', g: null, plural: true },
  amigas: { kind: 'amigo', g: 'f', plural: true },
  'companero de trabajo': { kind: 'colega', g: 'm' },
  'companera de trabajo': { kind: 'colega', g: 'f' },
  companero: { kind: 'companero', g: 'm' },
  companera: { kind: 'companero', g: 'f' },
  colega: { kind: 'colega', g: null },
  vecino: { kind: 'vecino', g: 'm' },
  vecina: { kind: 'vecino', g: 'f' },
  jefe: { kind: 'jefe', g: 'm' },
  jefa: { kind: 'jefe', g: 'f' },
  socio: { kind: 'socio', g: 'm' },
  socia: { kind: 'socio', g: 'f' },
  mentor: { kind: 'mentor', g: 'm' },
  mentora: { kind: 'mentor', g: 'f' },
};
const KIN_ALT = Object.keys(KIN_WORDS)
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/ /g, '\\s+'))
  .join('|');

/** Vínculos por los que vale la pena preguntar «¿quién es?» si aún no hay nadie. */
const ASKABLE = new Set<TieKind>([
  'padre',
  'hijo',
  'hermano',
  'abuelo',
  'nieto',
  'tio',
  'sobrino',
  'primo',
  'suegro',
  'yerno',
  'cunado',
  'pareja',
  'expareja',
  'mejoramigo',
  'jefe',
  'socio',
  'mentor',
]);

/** Nombres que también son palabras comunes: solo cuentan con mayúscula y no al inicio de frase. */
const COMMON = new Set(
  (
    'rosa luz paz sol mar flor cielo alba mercedes dolores pilar angel angeles rocio esperanza ' +
    'victoria aurora blanca clara gloria consuelo amparo socorro rosario soledad milagros iris ' +
    'salvador leal leon cruz santos reyes nieves castillo flores torres mesa vega prado rios pena ' +
    'moreno blanco rubio bravo delgado calvo cano lobo toro montes campos ramos rosales serrano ' +
    'marin navarro sierra cortes guerra medina franco duque conde'
  ).split(' '),
);
/** Palabras con mayúscula que no son nombres. */
const NOT_NAMES = new Set(
  (
    'yo el la los las un una mi su tu hoy ayer manana lunes martes miercoles jueves viernes sabado ' +
    'domingo enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre ' +
    'diciembre dios navidad semana santa'
  ).split(' '),
);

const isUpper = (ch: string | undefined) => Boolean(ch && ch !== ch.toLowerCase());
/** ¿En esa posición empieza una frase? (inicio del texto o tras . ! ? ¡ ¿ o salto de línea). */
function sentenceStart(text: string, i: number) {
  for (let j = i - 1; j >= 0; j--) {
    const c = text[j];
    if (/\s/.test(c)) continue;
    return /[.!?¡¿\n:«"“(]/.test(c);
  }
  return true;
}

/** Nombres, apodos, nombres de pila y apellidos que aparecen en el texto. */
function nameMentions(text: string, hay: string, people: Person[]) {
  const raw: { start: number; end: number; id: string; strength: number; why: string }[] = [];
  const find = (needle: string, id: string, strength: number, why: string, strict = false) => {
    const n = normalizeText(needle).trim().replace(/\s+/g, ' ');
    if (n.length < 3) return;
    const re = new RegExp(`${B}${esc(n).replace(/ /g, '\\s+')}${E}`, 'gu');
    for (const m of hay.matchAll(re)) {
      const at = m.index!;
      // Apellidos y nombres que son palabras comunes: con mayúscula y no al inicio de una frase.
      if (strict && (!isUpper(text[at]) || (COMMON.has(n) && sentenceStart(text, at)))) continue;
      raw.push({ start: at, end: at + m[0].length, id, strength, why });
    }
  };
  for (const p of people) {
    find(p.name, p.id, 3, 'nombre');
    if (p.profile.alias) find(p.profile.alias, p.id, 2, 'apodo');
    const parts = p.name.trim().split(/\s+/);
    if (parts.length > 2) find(`${parts[0]} ${parts[parts.length - 1]}`, p.id, 2, 'nombre');
    find(parts[0], p.id, 1, 'nombre', COMMON.has(normalizeText(parts[0])));
    for (const s of surnamesOf(p.name)) if (s.length >= 4) find(s, p.id, 1, 'apellido', true);
  }
  // Se queda con el tramo más largo; los tramos iguales agrupan a sus personas.
  const spans = new Map<string, Mention>();
  for (const r of raw) {
    const covered = raw.some(
      (o) => o.start <= r.start && o.end >= r.end && o.end - o.start > r.end - r.start,
    );
    if (covered) continue;
    const k = `${r.start}:${r.end}`;
    const m = spans.get(k) ?? {
      start: r.start,
      end: r.end,
      ids: [],
      text: text.slice(r.start, r.end),
      why: r.why,
      strength: r.strength,
    };
    if (!m.ids.includes(r.id)) m.ids.push(r.id);
    // Un apellido compartido junto a «los», «las», «familia»: son todos.
    if (r.why === 'apellido') {
      const before = hay.slice(Math.max(0, r.start - 16), r.start);
      if (/(?:\blos|\blas|\bfamilia|\bdonde los)\s+$/.test(before)) m.group = true;
    }
    spans.set(k, m);
  }
  return [...spans.values()].sort((a, b) => a.start - b.start);
}

/** Lo que cada persona es de alguien, según tus vínculos guardados. */
function holdersOf(owner: string, kind: TieKind, g: Gender | null, people: Person[], ties: Tie[]) {
  const byId = new Map(people.map((p) => [p.id, p]));
  return tiesOf(owner, ties)
    .filter((v) => v.kind === kind && v.other !== ME && byId.has(v.other))
    .map((v) => v.other)
    .filter((id) => {
      const pg = genderOf(byId.get(id));
      // Con el sexo pedido («mi tía»), fuera los que se sabe que son del otro.
      return !g || !pg || pg === g;
    });
}

/**
 * Personas, apellidos y parentescos del texto. `rank` ordena las opciones cuando hay varias
 * (p. ej. con quién hablaste más hace poco).
 */
export function recognize(
  text: string,
  people: Person[],
  ties: Tie[],
  rank: (id: string) => number = () => 0,
): Recognition {
  const hay = normalizeText(text);
  if (!hay.trim()) return { mentions: [], cues: [] };
  const mentions = nameMentions(text, hay, people);
  const cues = new Map<string, KinCue>();
  const kinSpans: Mention[] = [];

  const after = (end: number) => {
    // ¿Lo que sigue es una persona conocida o un nombre propio nuevo?
    const rest = text.slice(end);
    const gap = /^[\s,:]*/.exec(rest)![0].length;
    const named = mentions.find((m) => m.start === end + gap && gap <= 3 && gap > 0);
    if (named) return { named, newName: undefined };
    const fresh = /^\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñü]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+)?)/.exec(rest);
    if (fresh && !NOT_NAMES.has(normalizeText(fresh[1].split(' ')[0])))
      return { named: undefined, newName: fresh[1] };
    return { named: undefined, newName: undefined };
  };

  const add = (start: number, end: number, word: string, owner: string, label: string) => {
    const info = KIN_WORDS[word.replace(/\s+/g, ' ')];
    if (!info) return;
    const { kind, g, plural = false } = info;
    const holders = holdersOf(owner, kind, g, people, ties).sort((a, b) => rank(b) - rank(a));
    const { named, newName } = after(end);
    let status: KinCue['status'];
    let ids: string[];
    if (named) {
      const both = named.ids.filter((id) => holders.includes(id));
      if (both.length) {
        // «mi tío Carlos» con dos Carlos: es el que es tu tío.
        named.ids = both;
        status = both.length === 1 ? 'known' : 'choose';
        ids = both;
      } else {
        status = named.ids.length === 1 ? 'confirm' : 'choose';
        ids = named.ids;
      }
    } else if (newName && !plural) {
      status = 'confirm';
      ids = [];
    } else if (holders.length === 1 || (plural && holders.length)) {
      status = 'known';
      ids = holders;
    } else if (holders.length > 1) {
      status = 'choose';
      ids = holders;
    } else if (!plural && ASKABLE.has(kind)) {
      status = 'unknown';
      ids = [];
    } else return;

    const key = `${owner}|${kind}|${g ?? ''}|${plural ? 'p' : ''}|${newName ?? ''}`;
    if (!cues.has(key))
      cues.set(key, {
        key,
        start,
        end,
        label,
        kind,
        gender: g,
        owner,
        plural,
        status,
        ids,
        newName,
      });
    if (ids.length && (status === 'known' || status === 'choose' || status === 'confirm'))
      kinSpans.push({
        start,
        end,
        text: text.slice(start, end),
        ids,
        group: plural,
        why: label,
        strength: 2,
      });
  };

  // «mi mamá», «mis hermanos», «mi querida abuela», «mi tío Carlos».
  const mine = new RegExp(
    `${B}(mis?)\\s+(?:(?:querid|adorad|amad)[oa]s?\\s+)?(${KIN_ALT})(?:\\s+(?:mayor|menor|mayores|menores|politic[oa]s?|segund[oa]s?|lejan[oa]s?))?${E}`,
    'gu',
  );
  for (const m of hay.matchAll(mine)) {
    const start = m.index!;
    const end = start + m[0].length;
    const label = text.slice(start, end).replace(/^mis?/i, (p) => (p.length > 2 ? 'tus' : 'tu'));
    add(start, end, m[2], ME, label);
  }

  // «mamá», «papi», «la abuelita» sin «mi»: en casa casi siempre son los tuyos.
  const bare = new RegExp(`${B}(mama|mami|mamita|papa|papi|papito|abuelita|abuelito)${E}`, 'gu');
  for (const m of hay.matchAll(bare)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (cuesCover(cues, start)) continue;
    const word = m[1];
    // «mamá»/«papá» con tilde (sin ella «papa» puede ser el alimento o el Papa).
    if ((word === 'mama' || word === 'papa') && !/[áÁ]$/.test(text.slice(start, end))) continue;
    const prev = /([\p{L}]+)\s+$/u.exec(hay.slice(Math.max(0, start - 14), start))?.[1] ?? '';
    if (/^(mi|mis|su|sus|tu|tus|un|una|el|los|las|del|al)$/.test(prev)) continue;
    add(start, end, word, ME, `tu ${kinCall(KIN_WORDS[word].kind, KIN_WORDS[word].g)}`);
  }

  // «la hermana de Laura», «el papá de Andrés»: el dueño es otra persona.
  const theirs = new RegExp(`${B}(?:(el|la|los|las)\\s+)?(${KIN_ALT})\\s+(?:de|del)\\s+`, 'gu');
  for (const m of hay.matchAll(theirs)) {
    const start = m.index!;
    const end = start + m[0].length;
    const before = hay.slice(Math.max(0, start - 5), start);
    if (/\bmis?\s+$/.test(before)) continue;
    const owner = mentions.find((x) => x.start === end && x.ids.length === 1);
    if (!owner) continue;
    const kinEnd = end - (/\s+(?:de|del)\s+$/.exec(m[0])?.[0].length ?? 0);
    add(start, kinEnd, m[2], owner.ids[0], text.slice(start, owner.end));
  }

  return {
    mentions: [...mentions, ...kinSpans].sort((a, b) => a.start - b.start),
    cues: [...cues.values()].sort((a, b) => a.start - b.start),
  };
}

const cuesCover = (cues: Map<string, KinCue>, at: number) =>
  [...cues.values()].some((c) => c.start <= at && c.end > at);

/** «tu mamá» → «¿Quién es tu mamá?»; con nombre nuevo, «¿Rosa es tu tía?». */
export function cueQuestion(c: KinCue, people: Person[]) {
  const name = (id: string) => people.find((p) => p.id === id)?.name.split(' ')[0] ?? '?';
  if (c.newName) return `¿${c.newName} es ${c.label}?`;
  if (c.status === 'confirm' && c.ids.length === 1) return `¿${name(c.ids[0])} es ${c.label}?`;
  if (c.status === 'choose') return `¿Quién de ellos es ${c.label}?`;
  return `¿Quién es ${c.label}?`;
}

/**
 * Personas para elegir como «tu mamá»: primero las del sexo y la relación que encajan, las que
 * comparten apellido con tu familia (o con el dueño) y con las que más hablas.
 */
export function cueOptions(
  c: KinCue,
  people: Person[],
  ties: Tie[],
  rank: (id: string) => number = () => 0,
) {
  if (c.status === 'choose') return c.ids;
  const owner = people.find((p) => p.id === c.owner);
  const family =
    c.owner === ME
      ? tiesOf(ME, ties)
          .filter((v) => v.other !== ME && tieKinds[v.kind].category === 'familia')
          .flatMap((v) => surnamesOf(people.find((p) => p.id === v.other)?.name ?? ''))
      : surnamesOf(owner?.name ?? '');
  const cat = tieKinds[c.kind].category;
  const score = (p: Person) => {
    const g = genderOf(p);
    let s = rank(p.id);
    if (c.gender && g === c.gender) s += 40;
    if (c.gender && g && g !== c.gender) s -= 80;
    if (p.profile.relation === cat || (cat === 'pareja' && p.profile.relation === 'pareja'))
      s += 30;
    if (surnamesOf(p.name).some((x) => family.includes(x))) s += 25;
    return s;
  };
  return people
    .filter((p) => p.id !== c.owner)
    .map((p) => ({ id: p.id, s: score(p), n: p.name }))
    .sort((a, b) => b.s - a.s || a.n.localeCompare(b.n, 'es'))
    .map((x) => x.id);
}

/** «Keila quedó como tu mamá». */
export const cueSaved = (c: KinCue, name: string) =>
  `${name} quedó como ${c.label.replace(/^tus?\s+/, 'tu ')}.`;

/** Forma del vínculo para la persona elegida («madre» si es mujer). */
export const cueWord = (c: KinCue, p?: Person | null) => kindWord(c.kind, c.gender ?? genderOf(p));
