import {
  Briefcase,
  Church,
  Dumbbell,
  GraduationCap,
  HeartHandshake,
  Home,
  Plane,
  Tag,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Gender, Group, GroupKind, Person, Relation, Tie, TieKind, TieNature } from '../data';
import type { Brain, SurnameLesson } from './brain';
import { normalizeText } from './format';
import { genderOf } from './gender';

export type TieCategory = 'familia' | 'pareja' | 'amistad' | 'trabajo' | 'otro';

type TieInfo = {
  label: string;
  /** Cómo se dice para un hombre y para una mujer. */
  m: string;
  f: string;
  inverse: TieKind;
  category: TieCategory;
  /** Generación de «a» menos la de «b» (−1: «a» está una generación arriba). */
  gen?: number;
};

/** «a» es <label> de «b». */
export const tieKinds: Record<TieKind, TieInfo> = {
  padre: {
    label: 'Padre / Madre',
    m: 'padre',
    f: 'madre',
    inverse: 'hijo',
    category: 'familia',
    gen: -1,
  },
  hijo: {
    label: 'Hijo / Hija',
    m: 'hijo',
    f: 'hija',
    inverse: 'padre',
    category: 'familia',
    gen: 1,
  },
  hermano: {
    label: 'Hermano / Hermana',
    m: 'hermano',
    f: 'hermana',
    inverse: 'hermano',
    category: 'familia',
    gen: 0,
  },
  abuelo: {
    label: 'Abuelo / Abuela',
    m: 'abuelo',
    f: 'abuela',
    inverse: 'nieto',
    category: 'familia',
    gen: -2,
  },
  nieto: {
    label: 'Nieto / Nieta',
    m: 'nieto',
    f: 'nieta',
    inverse: 'abuelo',
    category: 'familia',
    gen: 2,
  },
  tio: { label: 'Tío / Tía', m: 'tío', f: 'tía', inverse: 'sobrino', category: 'familia', gen: -1 },
  sobrino: {
    label: 'Sobrino / Sobrina',
    m: 'sobrino',
    f: 'sobrina',
    inverse: 'tio',
    category: 'familia',
    gen: 1,
  },
  primo: {
    label: 'Primo / Prima',
    m: 'primo',
    f: 'prima',
    inverse: 'primo',
    category: 'familia',
    gen: 0,
  },
  suegro: {
    label: 'Suegro / Suegra',
    m: 'suegro',
    f: 'suegra',
    inverse: 'yerno',
    category: 'familia',
    gen: -1,
  },
  yerno: {
    label: 'Yerno / Nuera',
    m: 'yerno',
    f: 'nuera',
    inverse: 'suegro',
    category: 'familia',
    gen: 1,
  },
  cunado: {
    label: 'Cuñado / Cuñada',
    m: 'cuñado',
    f: 'cuñada',
    inverse: 'cunado',
    category: 'familia',
    gen: 0,
  },
  familiar: {
    label: 'Familiar',
    m: 'familiar',
    f: 'familiar',
    inverse: 'familiar',
    category: 'familia',
  },
  pareja: {
    label: 'Pareja',
    m: 'pareja',
    f: 'pareja',
    inverse: 'pareja',
    category: 'pareja',
    gen: 0,
  },
  expareja: {
    label: 'Expareja',
    m: 'expareja',
    f: 'expareja',
    inverse: 'expareja',
    category: 'pareja',
    gen: 0,
  },
  mejoramigo: {
    label: 'Mejor amigo/a',
    m: 'mejor amigo',
    f: 'mejor amiga',
    inverse: 'mejoramigo',
    category: 'amistad',
  },
  amigo: { label: 'Amigo / Amiga', m: 'amigo', f: 'amiga', inverse: 'amigo', category: 'amistad' },
  companero: {
    label: 'Compañero/a de estudio',
    m: 'compañero de estudio',
    f: 'compañera de estudio',
    inverse: 'companero',
    category: 'amistad',
  },
  vecino: {
    label: 'Vecino / Vecina',
    m: 'vecino',
    f: 'vecina',
    inverse: 'vecino',
    category: 'amistad',
  },
  conocido: {
    label: 'Conocido/a',
    m: 'conocido',
    f: 'conocida',
    inverse: 'conocido',
    category: 'otro',
  },
  colega: { label: 'Colega', m: 'colega', f: 'colega', inverse: 'colega', category: 'trabajo' },
  jefe: { label: 'Jefe / Jefa', m: 'jefe', f: 'jefa', inverse: 'subordinado', category: 'trabajo' },
  subordinado: {
    label: 'A su cargo',
    m: 'a su cargo',
    f: 'a su cargo',
    inverse: 'jefe',
    category: 'trabajo',
  },
  socio: { label: 'Socio / Socia', m: 'socio', f: 'socia', inverse: 'socio', category: 'trabajo' },
  mentor: {
    label: 'Mentor/a',
    m: 'mentor',
    f: 'mentora',
    inverse: 'aprendiz',
    category: 'trabajo',
  },
  aprendiz: {
    label: 'Aprendiz',
    m: 'aprendiz',
    f: 'aprendiz',
    inverse: 'mentor',
    category: 'trabajo',
  },
  otro: {
    label: 'Otro vínculo',
    m: 'otro vínculo',
    f: 'otro vínculo',
    inverse: 'otro',
    category: 'otro',
  },
};

export const tieCategories: Record<TieCategory, { label: string; color: string; soft: string }> = {
  familia: { label: 'Familia', color: '#c0674a', soft: '#f9e9e2' },
  pareja: { label: 'Pareja', color: '#c25683', soft: '#f8e5ee' },
  amistad: { label: 'Amistad', color: '#5f8247', soft: '#eaf1e0' },
  trabajo: { label: 'Trabajo', color: '#4d7b9d', soft: '#e3eef6' },
  otro: { label: 'Otros', color: '#7d8590', soft: '#eef0f3' },
};
export const tieCategoryList = Object.keys(tieCategories) as TieCategory[];
export const kindsByCategory = (cat: TieCategory) =>
  (Object.keys(tieKinds) as TieKind[]).filter((k) => tieKinds[k].category === cat);

/** Vínculos que tiene sentido elegir para cada tipo de relación de la ficha. */
export const kindsForRelation = (r: Relation): TieKind[] =>
  r === 'conocido' ? ['conocido'] : r === 'otro' ? ['otro', 'conocido'] : kindsByCategory(r);
/** Relación de la ficha que corresponde a un vínculo contigo. */
export const relationForKind = (k: TieKind): Relation => {
  const c = tieKinds[k].category;
  return c === 'otro' ? (k === 'conocido' ? 'conocido' : 'otro') : c;
};

/**
 * Cómo se dice el vínculo: con el sexo de la persona, «madre», «tía», «hermana»; sin él,
 * «padre/madre», «tío/a», «hermano/a».
 */
export function kindWord(k: TieKind, g?: Gender | null) {
  const info = tieKinds[k];
  if (g) return info[g];
  if (info.m === info.f) return info.m;
  // «hermano» / «hermana» → «hermano/a»; «padre» / «madre» → «padre/madre».
  return info.f === info.m.slice(0, -1) + 'a' ? info.m + '/a' : `${info.m}/${info.f}`;
}
/** Igual que `kindWord`, con mayúscula inicial (para botones). */
export const kindTitle = (k: TieKind, g?: Gender | null) => {
  const w = kindWord(k, g);
  return w[0].toUpperCase() + w.slice(1);
};
/** Forma cariñosa con la que hablas de tu familia: «tu mamá», «tu abuelita»… */
export function kinCall(k: TieKind, g?: Gender | null) {
  if (k === 'padre') return g === 'f' ? 'mamá' : g === 'm' ? 'papá' : 'papá/mamá';
  return kindWord(k, g);
}

export const groupKinds: Record<
  GroupKind,
  { label: string; icon: LucideIcon; color: string; soft: string }
> = {
  familia: { label: 'Familia', icon: Home, color: '#c0674a', soft: '#f9e9e2' },
  trabajo: { label: 'Trabajo', icon: Briefcase, color: '#4d7b9d', soft: '#e3eef6' },
  iglesia: { label: 'Iglesia', icon: Church, color: '#8a6fa8', soft: '#f0e9f6' },
  estudio: { label: 'Estudio', icon: GraduationCap, color: '#6b75b8', soft: '#e9ebf8' },
  amigos: { label: 'Amigos', icon: Users, color: '#5f8247', soft: '#eaf1e0' },
  deporte: { label: 'Deporte', icon: Dumbbell, color: '#c48a2a', soft: '#fbf1dc' },
  comunidad: { label: 'Comunidad', icon: HeartHandshake, color: '#3c9186', soft: '#dff2ef' },
  viaje: { label: 'Viaje', icon: Plane, color: '#a84f74', soft: '#f6e4ec' },
  otro: { label: 'Otro', icon: Tag, color: '#7d8590', soft: '#eef0f3' },
};
export const groupKindList = Object.keys(groupKinds) as GroupKind[];

export const ME = 'me';
const key = (id: string | null) => id ?? ME;

export const pairKey = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);

/** Clave estable de un vínculo, mírese desde el lado que se mire. */
export function tieKey(a: string | null, b: string, kind: TieKind) {
  const x = key(a);
  return x <= b ? `${x}|${b}|${kind}` : `${b}|${x}|${tieKinds[kind].inverse}`;
}

/** Forma única de guardar un vínculo: «Tú» siempre en «a» y los simétricos en orden fijo. */
export function canonicalTie(a: string | null, b: string, kind: TieKind) {
  let x = key(a);
  let y = b;
  let k = kind;
  if (y === ME) {
    [x, y] = [y, x];
    k = tieKinds[k].inverse;
  }
  if (x !== ME && tieKinds[k].inverse === k && x > y) [x, y] = [y, x];
  return { a: x === ME ? null : x, b: y, kind: k };
}

/** Un vínculo visto desde una persona: quién es el otro y qué es el otro para ella. */
export type TieView = { tie: Tie; other: string; kind: TieKind };

export function tiesOf(id: string, ties: Tie[]): TieView[] {
  const out: TieView[] = [];
  for (const t of ties) {
    if (key(t.a) === id)
      out.push({ tie: t, other: t.b, kind: tieKinds[t.kind]?.inverse ?? 'otro' });
    else if (t.b === id) out.push({ tie: t, other: key(t.a), kind: t.kind });
  }
  return out;
}

/** Frase legible: «Laura es hermana de Camila». */
export function sentence(a: string, kind: TieKind, b: string) {
  return `${a} es ${tieKinds[kind].label.toLowerCase()} de ${b}`;
}

// ───────────────────────── Deducciones ─────────────────────────

/** Naturaleza de un parentesco y cómo se dice. */
export const natureWords: Record<TieNature, string> = {
  biologica: 'biológico',
  adoptiva: 'adoptivo',
  crianza: 'de crianza',
  politica: 'político',
  medio: 'medio',
};
/** Qué naturalezas tiene sentido elegir para cada parentesco. */
export const naturesFor = (k: TieKind): { value: TieNature; label: string }[] =>
  k === 'padre' || k === 'hijo'
    ? [
        { value: 'biologica', label: 'Biológico' },
        { value: 'adoptiva', label: 'Adoptivo' },
        { value: 'crianza', label: 'De crianza' },
      ]
    : k === 'hermano'
      ? [
          { value: 'biologica', label: 'Completo' },
          { value: 'medio', label: 'Medio hermano' },
          { value: 'crianza', label: 'Hermanastro' },
          { value: 'adoptiva', label: 'Adoptivo' },
        ]
      : [];
/** «hermana (medio)», «padre/madre (de crianza)». */
export const kindWithNature = (k: TieKind, n?: TieNature | null, g?: Gender | null) =>
  n && n !== 'biologica'
    ? `${kindWord(k, g)} (${g === 'f' ? natureWords[n].replace(/o$/, 'a') : natureWords[n]})`
    : kindWord(k, g);

/** Los vínculos de crianza o políticos no transmiten parentesco (el padre de un padrastro no es tu abuelo). */
const carries = (t: Tie) => t.nature !== 'crianza' && t.nature !== 'politica';

/**
 * Parentescos que se siguen con certeza de los que guardaste. Solo se usan vínculos guardados
 * (nunca otros deducidos), así una deducción no produce cadenas de nuevas «certezas»:
 * - Hermanos: hijos de un mismo padre o madre guardado.
 * - Abuelos, tíos, primos, cuñados y suegros.
 * Lo que es probable pero no seguro (los hermanos de tu hermano, la pareja de un padre…) va a
 * `probableTies` como sugerencia para confirmar. `skip` son las claves (`tieKey`) descartadas.
 */
export function inferTies(ties: Tie[], skip?: ReadonlySet<string>): Tie[] {
  const f = familyFacts(ties);
  const explicit = new Set(ties.map((t) => pairKey(key(t.a), t.b)));
  const out = new Map<string, Tie>();
  const push = (a: string, kind: TieKind, b: string, why: string, via: string) => {
    if (a === b) return;
    const pk = pairKey(a, b);
    if (explicit.has(pk) || out.has(pk)) return;
    const c = canonicalTie(a === ME ? null : a, b, kind);
    const id = tieKey(c.a, c.b, c.kind);
    if (skip?.has(id)) return;
    out.set(pk, { id: 'inf|' + id, ...c, note: '', created_at: '', inferred: true, why, via });
  };

  // Hermanos: comparten un padre o madre guardado.
  for (const [p, kids] of f.children) {
    const list = [...kids];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) push(list[i], 'hermano', list[j], 'padre-comun', p);
  }
  for (const [c, ps] of f.parents) {
    for (const p of ps) {
      for (const gp of f.parents.get(p) ?? []) push(gp, 'abuelo', c, 'abuelo', p);
      for (const u of f.siblings.get(p) ?? []) {
        push(u, 'tio', c, 'tio', p);
        for (const k of f.children.get(u) ?? []) push(k, 'primo', c, 'primo', u);
      }
    }
  }
  for (const [x, ps] of f.partners) {
    for (const q of ps) {
      for (const s of f.siblings.get(q) ?? []) push(s, 'cunado', x, 'cunado', q);
      for (const p of f.parents.get(q) ?? []) push(p, 'suegro', x, 'suegro', q);
    }
  }
  return [...out.values()];
}

/** Hechos familiares guardados (padres, hermanos y parejas), sin los de crianza ni políticos. */
function familyFacts(ties: Tie[]) {
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  const siblings = new Map<string, Set<string>>();
  const partners = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, a: string, b: string) => {
    if (!m.has(a)) m.set(a, new Set());
    m.get(a)!.add(b);
  };
  for (const t of ties) {
    if (!carries(t)) continue;
    const a = key(t.a);
    if (t.kind === 'padre') {
      add(parents, t.b, a);
      add(children, a, t.b);
    } else if (t.kind === 'hijo') {
      add(parents, a, t.b);
      add(children, t.b, a);
    } else if (t.kind === 'hermano') {
      add(siblings, a, t.b);
      add(siblings, t.b, a);
    } else if (t.kind === 'pareja') {
      add(partners, a, t.b);
      add(partners, t.b, a);
    }
  }
  return { parents, children, siblings, partners };
}

/** Por qué se dedujo un vínculo, en una frase corta. */
export function explain(t: Tie, nameOf: (id: string) => string) {
  if (!t.why || !t.via) return '';
  const me = t.via === ME;
  const v = me ? '' : nameOf(t.via);
  switch (t.why) {
    case 'padre-comun':
      return me ? 'Ambos son tus hijos' : `Comparten a ${v} como padre o madre`;
    case 'tio':
      return me ? 'Hermano/a tuyo' : `Hermano/a de ${v}`;
    default:
      return me ? 'A través de ti' : `A través de ${v}`;
  }
}

/**
 * Parentescos probables pero no seguros, para preguntarte (nunca se dan por hechos):
 * - Los hermanos de alguien quizá lo sean entre sí (o son medios hermanos por distinto lado).
 * - El padre de tu hermano quizá también sea el tuyo.
 * - La pareja de tu padre puede ser tu madre… o no.
 */
function probableTies(
  ties: Tie[],
  known: Set<string>,
  nameOf: (id: string) => string,
): Suggestion[] {
  const f = familyFacts(ties);
  const out: Suggestion[] = [];
  // Hermanos de una misma persona que aún no se sabe si lo son entre sí.
  for (const [z, sibs] of f.siblings) {
    const list = [...sibs].sort();
    const pairs: [string, string][] = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (!known.has(pairKey(list[i], list[j]))) pairs.push([list[i], list[j]]);
    if (!pairs.length) continue;
    const members = [...new Set(pairs.flat())];
    out.push({
      id: 'sib|' + z + '|' + members.sort().join(','),
      type: 'probable',
      members,
      pairs,
      options: ['hermano'],
      reason:
        z === ME
          ? 'Son tus hermanos. Si son medios hermanos por distinto lado, no lo son entre sí.'
          : `Son hermanos de ${nameOf(z)}. Si son medios hermanos por distinto lado, no lo son entre sí.`,
      title:
        members.length === 2
          ? `¿${nameOf(members[0])} y ${nameOf(members[1])} también son hermanos?`
          : `¿Los hermanos de ${z === ME ? 'ti' : nameOf(z)} lo son entre sí?`,
    });
  }
  // El padre de tu hermano quizá sea también el tuyo.
  for (const [x, sibs] of f.siblings) {
    for (const s of sibs) {
      for (const p of f.parents.get(s) ?? []) {
        if (p === x || known.has(pairKey(p, x))) continue;
        out.push({
          id: 'par|' + tieKey(p === ME ? null : p, x, 'padre'),
          type: 'probable',
          members: [p, x],
          tie: { a: p, b: x, kind: 'padre' },
          options: ['padre'],
          choices: [
            { label: 'Sí, también', kind: 'padre' },
            { label: 'De crianza', kind: 'padre', nature: 'crianza' },
          ],
          reason: `Es padre o madre de ${nameOf(s)}, ${x === ME ? 'tu' : 'su'} hermano/a.`,
          title:
            x === ME
              ? `¿${nameOf(p)} también es tu padre o madre?`
              : `¿${nameOf(p)} también es padre o madre de ${nameOf(x)}?`,
        });
      }
    }
  }
  // La pareja de un padre puede ser el otro padre, uno de crianza… o ninguno.
  for (const [c, ps] of f.parents) {
    if (ps.size !== 1) continue;
    const [p] = ps;
    for (const q of f.partners.get(p) ?? []) {
      if (q === c || known.has(pairKey(q, c))) continue;
      out.push({
        id: 'pp|' + tieKey(q === ME ? null : q, c, 'padre'),
        type: 'probable',
        members: [q, c],
        tie: { a: q, b: c, kind: 'padre' },
        options: ['padre'],
        choices: [
          { label: 'Sí, su padre/madre', kind: 'padre' },
          { label: 'De crianza', kind: 'padre', nature: 'crianza' },
        ],
        reason: `Es pareja de ${nameOf(p)}, ${c === ME ? 'tu' : 'su'} padre o madre.`,
        title:
          c === ME
            ? `¿${nameOf(q)} es tu padre o madre?`
            : `¿${nameOf(q)} es padre o madre de ${nameOf(c)}?`,
      });
    }
  }
  return out;
}

// ───────────────────────── Sugerencias ─────────────────────────

const PARTICLES = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'y',
  'e',
  'da',
  'do',
  'dos',
  'van',
  'von',
  'san',
]);
/** Nombres de pila frecuentes: no cuentan como apellido aunque vayan en segundo lugar. */
const GIVEN = new Set(
  (
    'maria jose juan luis ana carlos andres felipe alejandro alejandra fernanda fernando sofia ' +
    'isabel camila valentina daniela daniel paula andrea david miguel angel angela antonio manuel ' +
    'francisco javier eduardo alberto enrique pablo jesus carmen rosa lucia elena laura marta pedro ' +
    'jorge ricardo sebastian santiago nicolas mateo diego julian juliana catalina natalia carolina ' +
    'gabriela gabriel patricia monica claudia sandra adriana diana alexandra alexander cristian ' +
    'esteban samuel tomas victoria teresa beatriz pilar lorena liliana viviana marcela milena johana ' +
    'steven kevin brayan michael john jhon freddy alexis andre emilio martin simon valeria mariana ' +
    'antonia josefina guadalupe fabian hernan ivan oscar ruben sergio victor william yesica jessica'
  ).split(' '),
);
const words = (s: string) =>
  normalizeText(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Apellidos probables de un nombre completo (sin tildes). */
export function surnamesOf(name: string) {
  const t = words(name);
  if (t.length < 2) return [];
  return [
    ...new Set(t.slice(1).filter((w) => w.length >= 3 && !PARTICLES.has(w) && !GIVEN.has(w))),
  ];
}
/** Recupera la forma original («Gómez») de un apellido normalizado («gomez»). */
function prettyWord(w: string, names: string[]) {
  for (const n of names)
    for (const part of n.split(/\s+/)) if (normalizeText(part) === w) return part;
  return w[0].toUpperCase() + w.slice(1);
}

const KIN: Record<string, TieKind> = {
  hermano: 'hermano',
  hermana: 'hermano',
  hermanos: 'hermano',
  hermanas: 'hermano',
  padre: 'padre',
  papa: 'padre',
  papi: 'padre',
  madre: 'padre',
  mama: 'padre',
  mami: 'padre',
  padres: 'padre',
  hijo: 'hijo',
  hija: 'hijo',
  hijos: 'hijo',
  hijas: 'hijo',
  abuelo: 'abuelo',
  abuela: 'abuelo',
  abuelos: 'abuelo',
  nieto: 'nieto',
  nieta: 'nieto',
  nietos: 'nieto',
  tio: 'tio',
  tia: 'tio',
  tios: 'tio',
  sobrino: 'sobrino',
  sobrina: 'sobrino',
  sobrinos: 'sobrino',
  primo: 'primo',
  prima: 'primo',
  primos: 'primo',
  suegro: 'suegro',
  suegra: 'suegro',
  yerno: 'yerno',
  nuera: 'yerno',
  cunado: 'cunado',
  cunada: 'cunado',
  esposo: 'pareja',
  esposa: 'pareja',
  marido: 'pareja',
  novio: 'pareja',
  novia: 'pareja',
  pareja: 'pareja',
  exesposo: 'expareja',
  exesposa: 'expareja',
  exnovio: 'expareja',
  exnovia: 'expareja',
  expareja: 'expareja',
  amigo: 'amigo',
  amiga: 'amigo',
  amigos: 'amigo',
  jefe: 'jefe',
  jefa: 'jefe',
  companero: 'companero',
  companera: 'companero',
  colega: 'colega',
  socio: 'socio',
  socia: 'socio',
  vecino: 'vecino',
  vecina: 'vecino',
  mentor: 'mentor',
  mentora: 'mentor',
};
const MODS = new Set([
  'mayor',
  'menor',
  'querido',
  'querida',
  'politico',
  'politica',
  'segundo',
  'segunda',
]);
const FILLER = new Set([
  'la',
  'el',
  'los',
  'las',
  'mi',
  'mis',
  'su',
  'sus',
  'tu',
  'tus',
  'doctor',
  'doctora',
  'dr',
  'dra',
  'senor',
  'senora',
  'sr',
  'sra',
  'don',
  'dona',
  'ing',
  'ingeniero',
  'ingeniera',
  'lic',
  'profe',
  'profesor',
  'profesora',
]);

type NameRef = { id: string; seqs: string[][] };
function nameRefs(people: Person[]): NameRef[] {
  const firsts = new Map<string, number>();
  for (const p of people) {
    const f = words(p.name)[0];
    if (f) firsts.set(f, (firsts.get(f) ?? 0) + 1);
  }
  return people.map((p) => {
    const t = words(p.name);
    const seqs: string[][] = [t];
    if (t.length > 2) seqs.push([t[0], t[t.length - 1]], [t[0], t[1]]);
    if (t[0] && t[0].length >= 3 && firsts.get(t[0]) === 1) seqs.push([t[0]]);
    const alias = words(p.profile.alias ?? '');
    if (alias.length && alias.join('').length >= 3) seqs.push(alias);
    return { id: p.id, seqs };
  });
}
function matchAt(t: string[], j: number, self: string, refs: NameRef[]) {
  let best: { id: string; len: number } | null = null;
  for (const r of refs) {
    if (r.id === self) continue;
    for (const s of r.seqs) {
      if (!s.length || (best && s.length <= best.len)) continue;
      if (s.every((w, i) => t[j + i] === w)) best = { id: r.id, len: s.length };
    }
  }
  return best;
}
/** «Hermana de la Doctora Karla Fuentes», «Esposo: Pedro», «Hijos: Ana y Luis». */
function mentions(text: string, self: string, refs: NameRef[]) {
  const t = normalizeText(text)
    .replace(/[,;:/]+/g, ' , ')
    .split(/[^a-z0-9,]+/)
    .filter(Boolean);
  const out: { other: string; kind: TieKind; subject: boolean }[] = [];
  for (let i = 0; i < t.length; i++) {
    let kind = KIN[t[i]];
    if (!kind) continue;
    if (kind === 'amigo' && t[i - 1] === 'mejor') kind = 'mejoramigo';
    if (kind === 'pareja' && t[i - 1] === 'ex') kind = 'expareja';
    let j = i + 1;
    while (MODS.has(t[j])) j++;
    if (t[j] === ',') j++;
    let subject = false;
    if (t[j] === 'de' || t[j] === 'del') {
      subject = true;
      j++;
    }
    for (;;) {
      while (FILLER.has(t[j])) j++;
      const m = matchAt(t, j, self, refs);
      if (!m) break;
      out.push({ other: m.id, kind, subject });
      j += m.len;
      if (t[j] === ',' || t[j] === 'y' || t[j] === 'e') {
        j++;
        continue;
      }
      break;
    }
  }
  return out;
}
/** Un rol como «Hermana», «Mi mamá» o «Mejor amigo» dice qué es esa persona para ti. */
function kinToMe(role: string): TieKind | null {
  const t = words(role);
  if (t[0] === 'mi') t.shift();
  if (t[0] === 'mejor' && KIN[t[1]] === 'amigo') return 'mejoramigo';
  if (t[0] === 'ex' && KIN[t[1]] === 'pareja') return 'expareja';
  return KIN[t[0]] ?? null;
}
const clip = (s: string) => (s.length > 60 ? s.slice(0, 58).trimEnd() + '…' : s);

// ── Lo aprendido de tus respuestas (lo calcula `learn`, en brain.ts) ──
const NO_LESSON: SurnameLesson = {
  mineYes: 0,
  mineNo: 0,
  amongYes: 0,
  amongNo: 0,
  kinds: [],
  among: [],
  rejected: [],
};
const lessonOf = (brain: Brain | undefined, s: string) => brain?.surnames.get(s) ?? NO_LESSON;
/** Ya dijiste varias veces que quien lo lleva no es familia tuya, y casi nunca que sí. */
export const rejectedForMe = (l: SurnameLesson) => l.mineNo >= 2 && l.mineNo > l.mineYes * 2;
/** Ya dijiste que quienes lo comparten no son familia entre ellos, y ninguno lo es. */
export const rejectedAmong = (l: SurnameLesson) => l.amongNo >= 1 && l.amongYes === 0;
/** Pone primero lo que suele ser verdad (aprendido) sin perder las opciones de siempre. */
const orderOptions = (learned: TieKind[], base: TieKind[], max = 3): TieKind[] =>
  [...new Set([...learned.filter((k) => tieKinds[k]?.category === 'familia'), ...base])].slice(
    0,
    max,
  );

export type Suggestion = {
  /** Clave para descartarla. */
  id: string;
  type: 'texto' | 'tuya' | 'apellido' | 'probable';
  /** Pregunta ya redactada (si no, la arma la tarjeta). */
  title?: string;
  /** Botones con naturaleza propia («Sí, también» / «De crianza»). */
  choices?: { label: string; kind: TieKind; nature?: TieNature }[];
  members: string[];
  reason: string;
  /** Vínculo concreto propuesto («a» es kind de «b»). */
  tie?: { a: string; b: string; kind: TieKind };
  /** Qué pueden ser (la primera es la más probable). */
  options: TieKind[];
  /** Parejas aún sin vínculo dentro de un grupo de apellido. */
  pairs?: [string, string][];
  /** Nombre propuesto para crear un grupo familiar. */
  group?: string;
};

/**
 * Vínculos probables que aún no existen, para confirmar con un toque:
 * 1. Lo que dicen su rol y «su gente» («Hermana de Karla», «Mi mamá», «Hijos: Ana y Luis»).
 * 2. Quien comparte apellido con alguien de tu familia puede ser familia tuya.
 * 3. Quienes comparten apellido entre sí.
 */
export function suggestTies(
  people: Person[],
  ties: Tie[],
  groups: Group[],
  skip: ReadonlySet<string>,
  /** Tus apellidos (de «Mi ficha»), sin tildes: quien los comparte puede ser de tu familia. */
  mySurnames: string[] = [],
  myName = '',
  /** Lo aprendido de tus respuestas anteriores (ver `learn` en brain.ts). */
  brain?: Brain,
): Suggestion[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const live = ties.filter((t) => (t.a === null || byId.has(t.a)) && byId.has(t.b));
  const known = new Set([...live, ...inferTies(live, skip)].map((t) => pairKey(key(t.a), t.b)));
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => {
    if (!skip.has(s.id) && !out.some((o) => o.id === s.id)) out.push(s);
  };
  const refs = nameRefs(people);

  for (const p of people) {
    let named = false;
    const fields: [string, string][] = [
      ['Su rol', p.role],
      ['Su familia', p.profile.family ?? ''],
    ];
    for (const [label, text] of fields) {
      if (!text.trim()) continue;
      for (const m of mentions(text, p.id, refs)) {
        if (label === 'Su rol') named = true;
        const tie = m.subject
          ? { a: p.id, b: m.other, kind: m.kind }
          : { a: m.other, b: p.id, kind: m.kind };
        if (known.has(pairKey(tie.a, tie.b))) continue;
        add({
          id: 'txt|' + tieKey(tie.a, tie.b, tie.kind),
          type: 'texto',
          members: [tie.a, tie.b],
          tie,
          options: [tie.kind],
          reason: `${label} dice «${clip(text)}»`,
        });
      }
    }
    const k = named ? null : kinToMe(p.role);
    if (k && !known.has(pairKey(p.id, ME)))
      add({
        id: 'txt|' + tieKey(p.id, ME, k),
        type: 'tuya',
        members: [p.id, ME],
        tie: { a: p.id, b: ME, kind: k },
        options: [k],
        reason: `Su rol dice «${clip(p.role)}»`,
      });
  }

  const sn = new Map(people.map((p) => [p.id, surnamesOf(p.name)]));
  const myFamily = tiesOf(ME, live).filter(
    (v) => v.other !== ME && tieKinds[v.kind].category === 'familia',
  );
  for (const p of people) {
    const mine = sn.get(p.id)!;
    if (!mine.length || known.has(pairKey(p.id, ME))) continue;
    if (out.some((s) => s.members[0] === p.id && s.members[1] === ME)) continue;
    const rel =
      myFamily.find(
        (v) => v.kind === 'hermano' && sn.get(v.other)?.some((s) => mine.includes(s)),
      ) ?? myFamily.find((v) => v.other !== p.id && sn.get(v.other)?.some((s) => mine.includes(s)));
    if (!rel || rel.other === p.id) continue;
    const relPerson = byId.get(rel.other)!;
    const shared = sn.get(rel.other)!.filter((s) => mine.includes(s));
    const lesson = lessonOf(brain, shared[0]);
    // Ya dijiste varias veces que quienes llevan este apellido no son tu familia.
    if (rejectedForMe(lesson)) continue;
    add({
      id: 'mine|' + p.id,
      type: 'tuya',
      members: [p.id, ME],
      options: orderOptions(lesson.kinds, [
        ...new Set<TieKind>([rel.kind, 'hermano', 'primo', 'familiar']),
      ]),
      reason: `Comparte el apellido ${prettyWord(shared[0], [p.name])} con ${relPerson.name}, tu ${kindWord(rel.kind, genderOf(relPerson))}`,
    });
  }

  // Quien comparte tus apellidos (los de «Mi ficha») puede ser de tu familia. Un apellido muy
  // repetido en tu red (García, Rodríguez…) dice poco por sí solo: se sugiere si ya confirmaste
  // familia con él, si la persona tiene tus dos apellidos, si su ficha dice «Familia» o si está en
  // un grupo familiar con alguien de tu familia. Lo que ya descartaste baja el tope o lo apaga.
  if (mySurnames.length) {
    const freq = new Map<string, number>();
    for (const p of people) for (const s of sn.get(p.id)!) freq.set(s, (freq.get(s) ?? 0) + 1);
    const me = normalizeText(myName.trim());
    const myFamilyIds = new Set(myFamily.map((v) => v.other));
    const nearFamily = new Set(
      groups
        .filter((g) => g.kind === 'familia' && g.member_ids.some((id) => myFamilyIds.has(id)))
        .flatMap((g) => g.member_ids),
    );
    for (const p of people) {
      const theirs = sn.get(p.id)!;
      if (known.has(pairKey(p.id, ME))) continue;
      const both = mySurnames.length >= 2 && mySurnames.every((s) => theirs.includes(s));
      const evidence = both || p.profile.relation === 'familia' || nearFamily.has(p.id);
      const shared = theirs.filter((s) => {
        if (!mySurnames.includes(s)) return false;
        const l = lessonOf(brain, s);
        if (rejectedForMe(l) && !evidence) return false;
        const cap = l.mineYes ? Infinity : l.mineNo ? 4 : 12;
        return evidence || (freq.get(s) ?? 0) <= cap;
      });
      if (!shared.length) continue;
      // Si te guardaste a ti mismo como persona, no eres familia tuya.
      if (me && normalizeText(p.name.trim()) === me) continue;
      if (out.some((s) => s.members[0] === p.id && s.members[1] === ME)) continue;
      const label = shared.map((s) => prettyWord(s, [p.name])).join(' ');
      const lesson = lessonOf(brain, shared[0]);
      const kin = lesson.mineYes;
      add({
        id: 'mine|' + p.id,
        type: 'tuya',
        members: [p.id, ME],
        options: orderOptions(
          lesson.kinds,
          both ? ['hermano', 'primo', 'familiar'] : ['familiar', 'primo', 'tio'],
        ),
        reason:
          (both ? `Tiene tus dos apellidos: ${label}` : `Comparte tu apellido ${label}`) +
          (kin ? ` · ${kin} de tu familia ${kin === 1 ? 'lo lleva' : 'lo llevan'}` : ''),
      });
    }
  }

  const bySurname = new Map<string, string[]>();
  for (const p of people)
    for (const s of sn.get(p.id)!) bySurname.set(s, [...(bySurname.get(s) ?? []), p.id]);
  const clusters = new Map<string, { members: string[]; surnames: string[] }>();
  for (const [s, ids] of bySurname) {
    if (ids.length < 2 || ids.length > 15) continue;
    // Ya dijiste que quienes llevan este apellido no son familia: no se vuelve a preguntar cada
    // vez que llega alguien nuevo con él.
    if (rejectedAmong(lessonOf(brain, s))) continue;
    const k = [...ids].sort().join(',');
    const c = clusters.get(k);
    if (c) c.surnames.push(s);
    else clusters.set(k, { members: ids, surnames: [s] });
  }
  for (const [k, c] of clusters) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < c.members.length; i++)
      for (let j = i + 1; j < c.members.length; j++)
        if (!known.has(pairKey(c.members[i], c.members[j])))
          pairs.push([c.members[i], c.members[j]]);
    if (!pairs.length) continue;
    const names = c.members.map((id) => byId.get(id)!.name);
    const label = c.surnames.map((s) => prettyWord(s, names)).join(' ');
    const inGroup = groups.some((g) => c.members.every((m) => g.member_ids.includes(m)));
    const learned = c.surnames.flatMap((s) => lessonOf(brain, s).among);
    add({
      id: 'sur|' + k,
      type: 'apellido',
      members: c.members,
      pairs,
      options: orderOptions(
        learned,
        c.surnames.length > 1 ? ['hermano', 'primo', 'familiar'] : ['familiar', 'hermano', 'primo'],
      ),
      reason:
        c.members.length === 2
          ? `Comparten ${c.surnames.length > 1 ? 'los apellidos' : 'el apellido'} ${label}`
          : `${c.members.length} personas comparten ${c.surnames.length > 1 ? 'los apellidos' : 'el apellido'} ${label}`,
      group: inGroup ? undefined : `Familia ${label}`,
    });
  }
  // Parentescos probables (no se dan por hechos): se preguntan.
  const nameOf = (id: string) => (id === ME ? 'ti' : (byId.get(id)?.name.split(' ')[0] ?? '?'));
  for (const s of probableTies(live, known, nameOf)) add(s);
  const rank = { tuya: 0, texto: 1, probable: 2, apellido: 3 };
  return out.sort((a, b) => rank[a.type] - rank[b.type]);
}

// ───────────────────────── Grupos ─────────────────────────

export const groupsOf = (personId: string, groups: Group[]) =>
  groups.filter((g) => g.member_ids.includes(personId));

/** Tipo probable de un grupo por su nombre («Familia Gómez», «Equipo de fútbol», «Iglesia»…). */
export function guessGroupKind(name: string): GroupKind {
  const n = normalizeText(name);
  if (/\b(familia|primos|tios|herman|abuel|sobrin)/.test(n)) return 'familia';
  if (/\b(iglesia|parroquia|celula|ministerio|congregacion|oracion|catequesis|misa)/.test(n))
    return 'iglesia';
  if (
    /\b(futbol|gym|gimnasio|running|ciclis|yoga|crossfit|voley|baloncesto|basket|tenis|natacion|deporte|entreno)/.test(
      n,
    )
  )
    return 'deporte';
  if (/\b(trabajo|oficina|equipo|empresa|colegas|companeros de trabajo|clientes?|proyecto)/.test(n))
    return 'trabajo';
  if (/\b(universidad|colegio|clase|curso|maestria|semestre|promocion|egresados|carrera)/.test(n))
    return 'estudio';
  if (/\b(viaje|paseo|tour)/.test(n)) return 'viaje';
  if (/\b(amig|parche|combo|panas|crew)/.test(n)) return 'amigos';
  if (/\b(barrio|vecin|comunidad|voluntari|fundacion|conjunto)/.test(n)) return 'comunidad';
  return 'otro';
}

/** Lo que dos personas tienen en común: vínculos, grupos y amigos compartidos. */
export function commonGround(a: Person, b: Person, ties: Tie[], groups: Group[]) {
  const ga = groupsOf(a.id, groups).filter((g) => g.member_ids.includes(b.id));
  const na = new Set(tiesOf(a.id, ties).map((v) => v.other));
  const mutual = tiesOf(b.id, ties)
    .map((v) => v.other)
    .filter((id) => id !== a.id && id !== ME && na.has(id));
  return { groups: ga, mutual: [...new Set(mutual)] };
}

/** Árbol genealógico: generación relativa de cada persona en un componente familiar. */
export function generations(ties: Tie[]) {
  const family = ties.filter(
    (t) =>
      tieKinds[t.kind]?.gen !== undefined &&
      tieKinds[t.kind].category !== 'otro' &&
      t.kind !== 'expareja',
  );
  const adj = new Map<string, { to: string; d: number }[]>();
  const link = (a: string, b: string, d: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, d });
  };
  for (const t of family) {
    const a = key(t.a);
    const d = tieKinds[t.kind].gen!;
    // gen(a) = gen(b) + d
    link(t.b, a, d);
    link(a, t.b, -d);
  }
  const gen = new Map<string, number>();
  const comp = new Map<string, number>();
  let c = 0;
  const roots = [...adj.keys()].sort((x, y) =>
    x === ME ? -1 : y === ME ? 1 : adj.get(y)!.length - adj.get(x)!.length,
  );
  for (const root of roots) {
    if (gen.has(root)) continue;
    gen.set(root, 0);
    comp.set(root, c);
    const queue = [root];
    while (queue.length) {
      const x = queue.shift()!;
      for (const { to, d } of adj.get(x) ?? []) {
        if (gen.has(to)) continue;
        gen.set(to, gen.get(x)! + d);
        comp.set(to, c);
        queue.push(to);
      }
    }
    c++;
  }
  return { gen, comp, family };
}
