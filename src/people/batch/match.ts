import type { Person, PersonFact, PersonInput, PersonProfile, Relation } from '../../data';
import { distance, mergedProfile } from '../../lib/duplicates';
import { normalizeText, splitList } from '../../lib/format';
import { guessGender } from '../../lib/gender';
import { relationForKind } from '../../lib/relations';
import { phoneKey, type BatchPerson } from './parse';

/** Una persona que ya tienes y que parece la misma de la lista, con los motivos. */
export type Match = { person: Person; reasons: string[]; strength: number };

const words = (s: string) =>
  normalizeText(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

type Info = { x: Person; w: string[]; full: string; phone: string; email: string; alias: string };

/**
 * Busca, para cada fila del lote, si ya tienes a esa persona: mismo nombre, un nombre que completa
 * al otro («Laura» y «Laura Gómez»), casi igual («Jhonatan» y «Jonathan»), mismo teléfono, mismo
 * correo o su apodo. Con índices, para que cientos de filas contra miles de personas sea rápido.
 */
export function matcher(people: Person[]) {
  const info: Info[] = people.map((x) => {
    const w = words(x.name);
    return {
      x,
      w,
      full: w.join(' '),
      phone: phoneKey(x.profile.phone ?? ''),
      email: (x.profile.email ?? '').trim().toLowerCase(),
      alias: words(x.profile.alias ?? '').join(' '),
    };
  });
  const byFirst = new Map<string, Info[]>();
  const byPhone = new Map<string, Info[]>();
  const byEmail = new Map<string, Info[]>();
  const byAlias = new Map<string, Info[]>();
  const add = (m: Map<string, Info[]>, k: string, i: Info) => {
    if (!k) return;
    const l = m.get(k);
    if (l) l.push(i);
    else m.set(k, [i]);
  };
  for (const i of info) {
    add(byFirst, i.w[0] ?? '', i);
    add(byPhone, i.phone, i);
    add(byEmail, i.email, i);
    add(byAlias, i.alias, i);
  }
  const firsts = [...byFirst.keys()];

  return (p: BatchPerson): Match | null => {
    const w = words(p.name);
    const full = w.join(' ');
    const phone = phoneKey(p.phone);
    const email = p.email.trim().toLowerCase();
    const alias = words(p.alias).join(' ');
    const cands = new Set<Info>();
    if (w[0])
      for (const k of firsts)
        if (k === w[0] || (k.length >= 4 && w[0].length >= 4 && distance(k, w[0], 1) <= 1))
          for (const c of byFirst.get(k)!) cands.add(c);
    for (const c of byPhone.get(phone) ?? []) cands.add(c);
    for (const c of byEmail.get(email) ?? []) cands.add(c);
    for (const c of byAlias.get(full) ?? []) cands.add(c);
    if (alias) for (const c of byFirst.get(words(p.alias)[0] ?? '') ?? []) if (c.full === alias) cands.add(c);

    let best: Match | null = null;
    for (const c of cands) {
      const reasons: string[] = [];
      let strength = 0;
      if (full && c.full === full) {
        reasons.push('mismo nombre');
        strength += 3;
      } else if (full && c.w[0] === w[0] && c.w.length !== w.length) {
        const [short, long] = c.w.length < w.length ? [c.w, w] : [w, c.w];
        if (short.every((t) => long.includes(t))) {
          reasons.push('un nombre completa al otro');
          strength += short.length > 1 ? 2 : 1;
        }
      } else if (
        full.length >= 6 &&
        c.full.length >= 6 &&
        c.w.length === w.length &&
        distance(full, c.full, 2) <= 2
      ) {
        reasons.push('nombre casi igual');
        strength += 2;
      }
      if (phone && c.phone === phone) {
        reasons.push('mismo teléfono');
        strength += 3;
      }
      if (email && c.email === email) {
        reasons.push('mismo correo');
        strength += 3;
      }
      if ((alias && alias === c.full) || (c.alias && c.alias === full)) {
        reasons.push('su apodo coincide');
        strength += 2;
      }
      if (!reasons.length) continue;
      if (!best || strength > best.strength) best = { person: c.x, reasons, strength: Math.min(4, strength) };
    }
    return best;
  };
}

/** JSON con las claves ordenadas (para saber si dos fichas dicen lo mismo). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}

/** La relación de la fila: la suya, la de su parentesco contigo o la que elegiste para todas. */
export const relationOfRow = (p: BatchPerson, fallback: Relation | null): Relation | null =>
  p.relation ?? (p.kin ? relationForKind(p.kin) : fallback);

/** Lo de la fila como ficha (solo lo que tiene valor). */
export function profileOf(p: BatchPerson, fallback: Relation | null): PersonProfile {
  const out: PersonProfile = {};
  const relation = relationOfRow(p, fallback);
  if (relation) out.relation = relation;
  if (p.alias) out.alias = p.alias;
  // El sexo solo se guarda si no es el que ya se deduce del nombre.
  if (p.gender && p.gender !== guessGender(p.name, p.role)) out.gender = p.gender;
  if (p.phone) out.phone = p.phone;
  if (p.email) out.email = p.email;
  if (p.social) out.social = p.social;
  if (p.city) out.city = p.city;
  if (p.occupation) out.occupation = p.occupation;
  if (p.company) out.company = p.company;
  if (p.birthday) {
    out.birthday = p.birthday;
    if (p.birthYear) out.birthYear = p.birthYear;
  }
  if (p.metHow) out.metHow = p.metHow;
  if (p.family) out.family = p.family;
  if (p.likes.length) out.likes = p.likes;
  if (p.dislikes.length) out.dislikes = p.dislikes;
  if (p.gifts.length) out.gifts = p.gifts;
  if (p.keywords.length) out.keywords = p.keywords;
  if (p.facts.length)
    out.facts = p.facts.map<PersonFact>((f) => ({ id: crypto.randomUUID(), label: f.label, value: f.value }));
  if (p.favorite) out.favorite = true;
  return out;
}

/** Una persona nueva lista para guardar. */
export const inputOf = (p: BatchPerson, fallback: Relation | null): PersonInput => ({
  name: p.name.trim().slice(0, 120),
  role: p.role.trim(),
  interests: p.interests.join(', '),
  bio: p.bio.trim(),
  profile: profileOf(p, fallback),
});

/**
 * Completar la ficha que ya tienes con lo de la fila: solo se llena lo vacío y las listas se suman
 * sin repetir; nada de lo que ya estaba se pisa (ni el nombre). null si no aporta nada.
 */
export function completeWith(existing: Person, p: BatchPerson, fallback: Relation | null) {
  const profile = profileOf(p, fallback);
  // Un cumpleaños distinto no trae su año: no se mezclan.
  if (existing.profile.birthday && existing.profile.birthday !== profile.birthday) delete profile.birthYear;
  // La relación que elegiste para todas no cambia la de alguien que ya la tiene.
  if (existing.profile.relation) delete profile.relation;
  const pseudo: Person = {
    id: 'lote',
    name: p.name,
    role: p.role,
    color: '',
    interests: p.interests.join(', '),
    bio: p.bio,
    created_at: '',
    profile,
  };
  const merged = mergedProfile(existing, pseudo);
  // `mergedProfile` guarda el otro nombre como apodo; aquí no (la fila no renombra a nadie).
  if (!existing.profile.alias) {
    if (p.alias) merged.profile.alias = p.alias;
    else delete merged.profile.alias;
  }
  // Un campo que quedó guardado vacío («») también se llena con lo de la lista.
  const target = merged.profile as Record<string, unknown>;
  for (const [k, v] of Object.entries(profile))
    if (target[k] === '' && v !== '' && v !== undefined) target[k] = v;
  // Lo que la lista no trae (novedades, dar y recibir, historial) queda exactamente como estaba.
  for (const k of ['updates', 'exchanges', 'history'] as const) {
    if (existing.profile[k]) target[k] = existing.profile[k];
    else delete target[k];
  }
  const same =
    merged.role === existing.role &&
    normalizeText(merged.interests) === normalizeText(existing.interests) &&
    merged.bio === existing.bio &&
    stable(merged.profile) === stable(existing.profile);
  if (same) return null;
  // Lo nuevo, para mostrarlo («teléfono, cumpleaños, 2 gustos»).
  const added: string[] = [];
  const before = existing.profile;
  const now = merged.profile;
  const label: [keyof PersonProfile, string][] = [
    ['phone', 'teléfono'],
    ['email', 'correo'],
    ['social', 'red social'],
    ['city', 'ciudad'],
    ['occupation', 'ocupación'],
    ['company', 'empresa'],
    ['birthday', 'cumpleaños'],
    ['relation', 'relación'],
    ['alias', 'apodo'],
    ['metHow', 'cómo se conocieron'],
  ];
  for (const [k, l] of label) if (!before[k] && now[k]) added.push(l);
  for (const [k, l] of [
    ['likes', 'gustos'],
    ['dislikes', 'lo que no le gusta'],
    ['gifts', 'regalos'],
    ['keywords', 'palabras clave'],
    ['facts', 'datos'],
  ] as const) {
    const n = (now[k]?.length ?? 0) - (before[k]?.length ?? 0);
    if (n > 0) added.push(`${n} ${l}`);
  }
  const moreInterests = splitList(merged.interests).length - splitList(existing.interests).length;
  if (moreInterests > 0) added.push(`${moreInterests} intereses`);
  if (merged.bio !== existing.bio) added.push('notas');
  if (!existing.role && merged.role) added.push('contexto');
  return { changes: merged, added };
}
