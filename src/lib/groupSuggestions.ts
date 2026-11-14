import type { Entry, Episode, Group, Person, Tie } from '../data';
import { genderOf } from './gender';
import { normalizeText } from './format';
import { isInteraction } from './people';
import { ME, kindWord, surnamesOf, tieKinds, tiesOf, type Suggestion } from './relations';

/** Clave para descartar «¿X está en este grupo?» (también se usa al sacar a alguien de un grupo). */
export const groupKey = (groupId: string, personId: string) => `grp|${groupId}|${personId}`;

/** Palabras que no distinguen a un grupo de otro («Familia», «Equipo de», «Los»…). */
const GENERIC = new Set([
  'familia',
  'grupo',
  'equipo',
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'y',
  'mis',
  'mi',
  'amigos',
  'amigas',
  'trabajo',
  'iglesia',
  'club',
  'parche',
  'combo',
  'companeros',
  'colegas',
  'curso',
  'clase',
  'gente',
]);

const words = (s: string) =>
  normalizeText(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
/** ¿El texto (ya normalizado, entre espacios) dice la frase completa? */
const says = (text: string, phrase: string) => phrase.length >= 3 && text.includes(` ${phrase} `);
const pad = (s: string) => ' ' + words(s).join(' ') + ' ';
const clip = (s: string) => (s.length > 50 ? s.slice(0, 48).trimEnd() + '…' : s);

/**
 * Cómo se reconoce un grupo en un texto: su nombre completo y, si es distintivo, su núcleo.
 * `distinctive`: el nombre dice algo propio («Rappi», «Iglesia Central»); «Trabajo» o «Amigos»
 * solos no bastan para afirmar que alguien pertenece.
 */
function needlesOf(g: Group) {
  const all = words(g.name);
  const full = all.join(' ');
  const core = all.filter((w) => !GENERIC.has(w) && w.length >= 3).join(' ');
  const out = [full];
  // «Equipo de Rappi» también se reconoce por «Rappi» (en la familia, el núcleo es un apellido).
  if (g.kind !== 'familia' && core && core !== full && core.length >= 5) out.push(core);
  return { needles: out.filter((n) => n.length >= 3), distinctive: core.length > 0 };
}

type Hit = { reason: string; score: number; exact: boolean };

/**
 * Quién podría estar en un grupo y aún no está, con el motivo:
 * - Su ficha lo dice (rol, empresa, ocupación, su gente, palabras clave…): se puede aceptar en lote.
 * - Aparece en recuerdos o episodios con varios del grupo, o en uno que nombra al grupo.
 * - En un grupo familiar: es pariente de alguien del grupo o lleva su apellido.
 * Lo descartado (o la persona que sacaste del grupo) no se vuelve a sugerir.
 */
export function suggestGroups(
  people: Person[],
  groups: Group[],
  ties: Tie[],
  entries: Entry[],
  episodes: Episode[],
  skip: ReadonlySet<string>,
): Suggestion[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const live = ties.filter((t) => (t.a === null || byId.has(t.a)) && byId.has(t.b));
  const first = (id: string) => byId.get(id)?.name.split(' ')[0] ?? '?';
  // Lo que dice la ficha de cada persona, por campo. `exact`: decirlo ahí es decir que pertenece
  // (su rol, su empresa, sus palabras clave); en lo demás solo es una pista para preguntar.
  const fields = new Map(
    people.map((p) => {
      const pr = p.profile;
      const list: [string, string, boolean][] = [
        ['Su rol', p.role, true],
        ['Su empresa', pr.company ?? '', true],
        ['Sus palabras clave', (pr.keywords ?? []).join(', '), true],
        ['Su ocupación', pr.occupation ?? '', false],
        ['Su gente', pr.family ?? '', false],
        ['Cómo se conocieron', pr.metHow ?? '', false],
        ['Su historia', p.bio, false],
      ];
      return [
        p.id,
        list.filter(([, v]) => v.trim()).map(([k, v, exact]) => [k, v, pad(v), exact] as const),
      ];
    }),
  );
  const together = entries.filter(isInteraction);
  const out: Suggestion[] = [];

  for (const g of groups) {
    const members = new Set(g.member_ids.filter((id) => byId.has(id)));
    const { needles, distinctive } = needlesOf(g);
    const hits = new Map<string, Hit[]>();
    const hit = (id: string, h: Hit) => {
      if (members.has(id) || !byId.has(id) || skip.has(groupKey(g.id, id))) return;
      hits.set(id, [...(hits.get(id) ?? []), h]);
    };

    // 1. Su ficha nombra al grupo.
    for (const p of people) {
      for (const [label, raw, text, strong] of fields.get(p.id) ?? []) {
        if (!needles.some((n) => says(text, n))) continue;
        const exact = strong && distinctive;
        hit(p.id, {
          reason: `${label} dice «${clip(raw.trim())}»`,
          score: exact ? 5 : 3,
          exact,
        });
        if (exact) break;
      }
    }

    // 2. Recuerdos y episodios: con varios del grupo, o uno que nombra al grupo.
    // Con al menos dos del grupo a la vez (estar con uno solo no dice nada del grupo).
    if (members.size >= 2) {
      const seen = new Map<string, { entries: number; episodes: number; with: Set<string> }>();
      const count = (ids: string[], key: 'entries' | 'episodes') => {
        const inside = ids.filter((id) => members.has(id));
        if (inside.length < 2) return;
        for (const id of ids) {
          if (members.has(id)) continue;
          const s = seen.get(id) ?? { entries: 0, episodes: 0, with: new Set<string>() };
          s[key]++;
          inside.forEach((m) => s.with.add(m));
          seen.set(id, s);
        }
      };
      for (const e of together) count([...new Set(e.person_ids)], 'entries');
      for (const ep of episodes) count([...new Set(ep.person_ids)], 'episodes');
      for (const [id, s] of seen) {
        const weight = s.entries + 2 * s.episodes;
        if (weight < 2) continue;
        const names = [...s.with].slice(0, 2).map(first);
        const where = [
          s.entries ? `${s.entries} ${s.entries === 1 ? 'recuerdo' : 'recuerdos'}` : '',
          s.episodes ? `${s.episodes} ${s.episodes === 1 ? 'episodio' : 'episodios'}` : '',
        ]
          .filter(Boolean)
          .join(' y ');
        hit(id, {
          reason: `Aparece con ${names.join(' y ')}${s.with.size > 2 ? ' y otros del grupo' : ''} en ${where}`,
          score: 2 + Math.min(2, weight / 3),
          exact: false,
        });
      }
    }
    // Un recuerdo que nombra al grupo («Ensayo del coro»), si el nombre es distintivo.
    for (const e of distinctive ? entries : []) {
      if (!e.person_ids.length) continue;
      const text = pad(e.title + ' ' + e.body);
      if (!needles.some((n) => says(text, n))) continue;
      for (const id of new Set(e.person_ids))
        hit(id, { reason: `Aparece en «${clip(e.title)}»`, score: 3, exact: false });
    }

    // 3. Grupo familiar: parientes de quienes están y quienes llevan su apellido.
    if (g.kind === 'familia') {
      const surname = words(g.name).filter((w) => !GENERIC.has(w) && w.length >= 3);
      for (const m of members) {
        for (const v of tiesOf(m, live)) {
          if (v.other === ME || tieKinds[v.kind]?.category !== 'familia' || v.kind === 'expareja')
            continue;
          const other = byId.get(v.other);
          if (!other) continue;
          hit(v.other, {
            reason: `Es ${kindWord(v.kind, genderOf(other))} de ${first(m)}, que está en el grupo`,
            score: 3,
            exact: false,
          });
        }
      }
      if (surname.length)
        for (const p of people) {
          const shared = surnamesOf(p.name).filter((s) => surname.includes(s));
          if (shared.length)
            hit(p.id, {
              reason: `Lleva el apellido ${p.name.split(/\s+/).find((w) => normalizeText(w) === shared[0]) ?? shared[0]}`,
              score: 2.5,
              exact: false,
            });
        }
    }

    // Una sugerencia por persona: el mejor motivo (y cuántos más hay).
    const ranked = [...hits.entries()]
      .map(([id, list]) => {
        const best = [...list].sort((a, b) => b.score - a.score)[0];
        const score = list.reduce((s, h) => s + h.score, 0);
        return { id, best, score, more: new Set(list.map((h) => h.reason)).size - 1 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    for (const r of ranked)
      out.push({
        id: groupKey(g.id, r.id),
        type: 'grupo',
        title: `¿${first(r.id)} está en «${g.name}»?`,
        members: [r.id],
        reason:
          r.best.reason +
          (r.more > 0 ? ` · y ${r.more} ${r.more === 1 ? 'pista más' : 'pistas más'}` : ''),
        options: [],
        join: { groupId: g.id, exact: r.best.exact },
      });
  }
  // Lo que dicen las fichas primero; luego lo que más pistas tiene.
  return out.sort((a, b) => Number(Boolean(b.join?.exact)) - Number(Boolean(a.join?.exact)));
}
