import type { Group, Person, Tie, TieKind } from '../data';
import {
  ME,
  pairKey,
  rejectedAmong,
  rejectedForMe,
  surnamesOf,
  tieKinds,
  tiesOf,
} from './relations';

/**
 * Lo que Nexo aprendió de tus respuestas sobre un apellido. No se guarda aparte: se deduce de lo
 * que ya hay (los vínculos que confirmaste y las sugerencias que descartaste), así que se corrige
 * solo si deshaces algo o restableces el apellido.
 */
export type SurnameLesson = {
  /** Familiares tuyos que lo llevan. */
  mineYes: number;
  /** «No es familia mía» a quien lo lleva. */
  mineNo: number;
  /** Parentescos confirmados entre quienes lo llevan. */
  amongYes: number;
  /** «No son familia» a un grupo que lo comparte. */
  amongNo: number;
  /** Qué suelen ser para ti quienes lo llevan (primo, tío…), de más a menos frecuente. */
  kinds: TieKind[];
  /** Entre ellos, qué suelen ser (hermanos, primos…). */
  among: TieKind[];
  /** Claves descartadas que explican los «no» (para restablecerlas). */
  rejected: string[];
};

export type Brain = { surnames: Map<string, SurnameLesson> };

const isFamily = (k: TieKind) => tieKinds[k]?.category === 'familia';

/** Parentescos que valen igual en los dos sentidos (sirven para un grupo de apellido). */
const SYMMETRIC = new Set<TieKind>(['hermano', 'primo', 'familiar', 'cunado']);

const ranked = (tally: Map<TieKind, number>) =>
  [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

type Draft = Omit<SurnameLesson, 'kinds' | 'among'> & {
  kinds: Map<TieKind, number>;
  among: Map<TieKind, number>;
};

/** Aprende de tus confirmaciones y descartes de parentescos por apellido. */
export function learn(
  people: Person[],
  ties: Tie[],
  groups: Group[],
  skip: ReadonlySet<string>,
  mySurnames: string[],
): Brain {
  const byId = new Map(people.map((p) => [p.id, p]));
  const live = ties.filter((t) => (t.a === null || byId.has(t.a)) && byId.has(t.b));
  const sn = new Map(people.map((p) => [p.id, surnamesOf(p.name)]));
  const surOf = (id: string) => (id === ME ? mySurnames : (sn.get(id) ?? []));
  const draft = new Map<string, Draft>();
  const at = (s: string) => {
    let l = draft.get(s);
    if (!l) {
      l = {
        mineYes: 0,
        mineNo: 0,
        amongYes: 0,
        amongNo: 0,
        kinds: new Map(),
        among: new Map(),
        rejected: [],
      };
      draft.set(s, l);
    }
    return l;
  };
  const bump = (m: Map<TieKind, number>, k: TieKind) => m.set(k, (m.get(k) ?? 0) + 1);

  // Sí, entre ellos: parentescos confirmados entre dos que comparten apellido.
  const familyPairs = new Set<string>();
  for (const t of live) {
    if (!isFamily(t.kind)) continue;
    familyPairs.add(pairKey(t.a ?? ME, t.b));
    if (t.a === null) continue;
    for (const s of surOf(t.a).filter((s) => surOf(t.b).includes(s))) {
      const l = at(s);
      l.amongYes++;
      if (SYMMETRIC.has(t.kind)) bump(l.among, t.kind);
    }
  }
  // Sí, contigo: cada apellido de un familiar tuyo, con lo que es para ti.
  const myFamilySurnames = new Set(mySurnames);
  const linkedToMe = new Set<string>();
  for (const v of tiesOf(ME, live)) {
    linkedToMe.add(v.other);
    if (!isFamily(v.kind)) continue;
    for (const s of surOf(v.other)) {
      myFamilySurnames.add(s);
      const l = at(s);
      l.mineYes++;
      bump(l.kinds, v.kind);
    }
  }

  // No: sugerencias de apellido descartadas sin que después se confirmara el parentesco.
  for (const k of skip) {
    if (k.startsWith('mine|')) {
      const id = k.slice(5);
      if (!byId.has(id) || linkedToMe.has(id)) continue;
      for (const s of surOf(id).filter((s) => myFamilySurnames.has(s))) {
        const l = at(s);
        l.mineNo++;
        l.rejected.push(k);
      }
    } else if (k.startsWith('sur|')) {
      const ids = k
        .slice(4)
        .split(',')
        .filter((id) => byId.has(id));
      if (ids.length < 2) continue;
      let tied = false;
      for (let i = 0; i < ids.length && !tied; i++)
        for (let j = i + 1; j < ids.length && !tied; j++)
          if (familyPairs.has(pairKey(ids[i], ids[j]))) tied = true;
      // Si con ese botón creaste un grupo familiar, fue un sí.
      if (
        tied ||
        groups.some((g) => g.kind === 'familia' && ids.every((id) => g.member_ids.includes(id)))
      )
        continue;
      for (const s of surOf(ids[0]).filter((s) => ids.every((id) => surOf(id).includes(s)))) {
        const l = at(s);
        l.amongNo++;
        l.rejected.push(k);
      }
    }
  }

  const surnames = new Map<string, SurnameLesson>();
  for (const [s, l] of draft)
    surnames.set(s, { ...l, kinds: ranked(l.kinds), among: ranked(l.among) });
  return { surnames };
}

/** Apellidos que Nexo dejó de sugerir por tus respuestas. */
export function ignoredSurnames(brain: Brain) {
  return [...brain.surnames.entries()]
    .filter(([, l]) => rejectedForMe(l) || rejectedAmong(l))
    .map(([s, l]) => ({ surname: s, keys: [...new Set(l.rejected)] }))
    .sort((a, b) => a.surname.localeCompare(b.surname));
}
