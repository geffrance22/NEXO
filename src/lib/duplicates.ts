import type {
  Exchange,
  Person,
  PersonFact,
  PersonProfile,
  PersonUpdate,
  ProfileChange,
} from '../data';
import { normalizeText, splitList } from './format';

/** Dos fichas que parecen ser la misma persona, con los motivos. */
export type DuplicatePair = {
  /** Clave para descartarla («No son la misma»). */
  id: string;
  a: Person;
  b: Person;
  reasons: string[];
  /** Qué tan seguro: 3 casi seguro, 1 posible. */
  strength: number;
};

export const duplicateKey = (a: string, b: string) => (a < b ? `dup|${a}|${b}` : `dup|${b}|${a}`);

const words = (s: string) =>
  normalizeText(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const digits = (s?: string) => {
  const d = (s ?? '').replace(/\D/g, '');
  // Los últimos 10 dígitos: así +57 300… y 300… cuentan igual.
  return d.length >= 7 ? d.slice(-10) : '';
};

/** Distancia de edición (para «Andres» y «Andrés Felipe» no, pero sí «Jhonatan» y «Jonathan»). */
export function distance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Posibles fichas repetidas: mismo nombre, nombre incompleto, mismo teléfono o correo, alias… */
export function findDuplicates(people: Person[], skip: ReadonlySet<string>): DuplicatePair[] {
  const info = people.map((p) => {
    const w = words(p.name);
    return {
      p,
      w,
      full: w.join(' '),
      phone: digits(p.profile.phone),
      email: normalizeText(p.profile.email?.trim() ?? ''),
      alias: words(p.profile.alias ?? '').join(' '),
    };
  });
  const out: DuplicatePair[] = [];
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const x = info[i];
      const y = info[j];
      const id = duplicateKey(x.p.id, y.p.id);
      if (skip.has(id) || !x.full || !y.full) continue;
      const reasons: string[] = [];
      let strength = 0;
      if (x.full === y.full) {
        reasons.push('Mismo nombre');
        strength += 3;
      } else if (x.w[0] === y.w[0] && x.w.length !== y.w.length) {
        // «Laura» y «Laura Gómez», o «Laura Gómez» y «Laura Gómez Ruiz».
        const [short, long] = x.w.length < y.w.length ? [x.w, y.w] : [y.w, x.w];
        if (short.every((t) => long.includes(t))) {
          reasons.push('Un nombre completa al otro');
          strength += short.length > 1 ? 2 : 1;
        }
      } else if (
        x.full.length >= 6 &&
        y.full.length >= 6 &&
        x.w.length === y.w.length &&
        distance(x.full, y.full, 2) <= 2
      ) {
        reasons.push('Nombres casi iguales');
        strength += 2;
      }
      if (x.phone && x.phone === y.phone) {
        reasons.push('Mismo teléfono');
        strength += 3;
      }
      if (x.email && x.email === y.email) {
        reasons.push('Mismo correo');
        strength += 3;
      }
      if ((x.alias && x.alias === y.full) || (y.alias && y.alias === x.full)) {
        reasons.push('Su alias es el nombre de la otra');
        strength += 2;
      }
      // Un nombre de pila suelto («Laura») frente a uno completo solo cuenta con otra señal.
      if (!reasons.length || (strength < 2 && reasons.length < 2)) continue;
      out.push({ id, a: x.p, b: y.p, reasons, strength: Math.min(3, strength) });
    }
  }
  return out.sort((a, b) => b.strength - a.strength);
}

const uniq = (list: string[]) => {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = normalizeText(s.trim());
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const byId = <T extends { id: string }>(a: T[] = [], b: T[] = []) => {
  const seen = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !seen.has(x.id))];
};

/**
 * Ficha unida: manda la que se conserva y la otra rellena lo que falte. Las listas (gustos,
 * novedades, datos, lo que se dan…) se suman sin repetir.
 */
export function mergedProfile(keep: Person, drop: Person) {
  const a = keep.profile;
  const b = drop.profile;
  const profile: PersonProfile = { ...b, ...a };
  const list = (k: 'likes' | 'dislikes' | 'gifts' | 'keywords' | 'askNext') => {
    const v = uniq([...(a[k] ?? []), ...(b[k] ?? [])]);
    if (v.length) profile[k] = v;
  };
  list('likes');
  list('dislikes');
  list('gifts');
  list('keywords');
  list('askNext');
  const facts: PersonFact[] = [...(a.facts ?? [])];
  for (const f of b.facts ?? [])
    if (!facts.some((x) => normalizeText(x.label + x.value) === normalizeText(f.label + f.value)))
      facts.push(f);
  if (facts.length) profile.facts = facts;
  const exchanges: Exchange[] = byId(a.exchanges, b.exchanges);
  if (exchanges.length) profile.exchanges = exchanges;
  const updates: PersonUpdate[] = byId(a.updates, b.updates).sort((x, y) =>
    y.date.localeCompare(x.date),
  );
  if (updates.length) profile.updates = updates;
  const history: ProfileChange[] = [...(a.history ?? [])];
  for (const h of b.history ?? [])
    if (!history.some((x) => x.field === h.field && x.value === h.value)) history.push(h);
  if (history.length) profile.history = history;
  if (a.favorite || b.favorite) profile.favorite = true;
  // Si no tenía cómo la llamas y la otra ficha tenía un nombre distinto (no solo más corto, como
  // «Laura» frente a «Laura Gómez»), ese nombre queda de alias.
  const kept = words(keep.name);
  if (!profile.alias && !words(drop.name).every((w) => kept.includes(w)))
    profile.alias = drop.name.slice(0, 80);

  const interests = uniq([...splitList(keep.interests), ...splitList(drop.interests)]).join(', ');
  const bio =
    keep.bio && drop.bio && normalizeText(keep.bio) !== normalizeText(drop.bio)
      ? `${keep.bio}\n\n${drop.bio}`
      : keep.bio || drop.bio;
  return {
    role: keep.role || drop.role,
    interests,
    bio: bio.slice(0, 8000),
    profile,
  };
}
