import type { Entry, Episode, Group, Person, Place, Tie, Workspace } from '../data';
import type { FeedCard } from '../planner/boardFeed';
import { kindLabel } from './entries';
import { episodeKindOf } from './episodes';
import { normalizeText } from './format';
import { searchText } from './people';
import { placeSearchText } from './places';
import { groupKinds, tieKinds } from './relations';

/** Máximo de resultados que se muestran por grupo. */
export const MAX_HITS_PER_GROUP = 5;

export type SearchHit =
  | { type: 'person'; person: Person }
  | { type: 'entry'; entry: Entry }
  | { type: 'place'; place: Place }
  /** `a` es null cuando el vínculo parte de «Tú». */
  | { type: 'tie'; tie: Tie; a: Person | null; b: Person }
  | { type: 'group'; group: Group }
  | { type: 'episode'; episode: Episode }
  | { type: 'card'; card: FeedCard };

export type SearchGroup = { label: string; hits: SearchHit[] };

/** Elementos cuyo texto contiene todas las palabras; los que coinciden por nombre van primero. */
function match<T>(
  items: T[],
  words: string[],
  text: (item: T) => string,
  name?: (item: T) => string,
): T[] {
  const found = items.filter((item) => {
    const t = text(item);
    return words.every((w) => t.includes(w));
  });
  if (!name) return found;
  const inName = (item: T) => {
    const n = normalizeText(name(item));
    return words.every((w) => n.includes(w));
  };
  return found.sort((x, y) => Number(inName(y)) - Number(inName(x)));
}

/** Busca en todo el espacio (también en las tarjetas de tus tableros), sin distinguir mayúsculas ni tildes, y agrupa por tipo. */
export function searchWorkspace(
  workspace: Workspace,
  query: string,
  cards: readonly FeedCard[] = [],
): SearchGroup[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const people = match(workspace.people, words, searchText, (p) => p.name).map(
    (person): SearchHit => ({ type: 'person', person }),
  );

  const entries = match(workspace.entries, words, (e) =>
    normalizeText(
      [
        e.title,
        e.body,
        ...e.tags,
        kindLabel(e),
        e.details.author ?? '',
        ...(e.details.quotes ?? []),
        // Movimientos: también por monto («50000» o «50.000»), cuenta y lugar.
        ...(e.kind === 'Movimiento'
          ? [String(e.amount), e.amount.toLocaleString('es-CO'), e.details.method ?? '', e.details.place ?? '']
          : []),
      ].join(' '),
    ),
  ).map((entry): SearchHit => ({ type: 'entry', entry }));

  const places = match(workspace.places, words, placeSearchText, (p) => p.name).map(
    (place): SearchHit => ({ type: 'place', place }),
  );

  const byId = new Map(workspace.people.map((p) => [p.id, p]));
  const ties: SearchHit[] = [];
  for (const tie of workspace.ties) {
    const a = tie.a === null ? null : byId.get(tie.a);
    const b = byId.get(tie.b);
    if (a === undefined || !b) continue;
    const text = normalizeText(
      [a?.name ?? 'Tú', b.name, tieKinds[tie.kind]?.label, tie.note].join(' '),
    );
    if (words.every((w) => text.includes(w))) ties.push({ type: 'tie', tie, a, b });
  }
  const groups = match(workspace.groups, words, (g) =>
    normalizeText([g.name, g.description, groupKinds[g.kind]?.label].join(' ')),
  ).map((group): SearchHit => ({ type: 'group', group }));

  const names = (ids: string[]) => ids.map((id) => byId.get(id)?.name ?? '').join(' ');
  const episodes = match(
    workspace.episodes ?? [],
    words,
    (ep) =>
      normalizeText(
        [
          ep.title,
          ep.summary,
          ep.outcome,
          ep.source,
          episodeKindOf(ep.kind).label,
          names(ep.person_ids),
          ...(ep.updates ?? []).map((u) => u.text),
        ].join(' '),
      ),
    (ep) => ep.title,
  ).map((episode): SearchHit => ({ type: 'episode', episode }));

  // Tarjetas: las que coinciden por título primero; las completadas, al final.
  const boardCards = match(
    [...cards],
    words,
    (c) =>
      normalizeText(
        [
          c.title,
          c.body,
          ...c.tags,
          c.board_name,
          c.list_name,
          ...c.checks.map((x) => x.text),
        ].join(' '),
      ),
    (c) => c.title,
  )
    .sort((a, b) => Number(a.done) - Number(b.done))
    .map((card): SearchHit => ({ type: 'card', card }));

  return [
    { label: 'Personas', hits: people },
    { label: 'Episodios', hits: episodes },
    { label: 'Recuerdos', hits: entries },
    { label: 'Tarjetas de tableros', hits: boardCards },
    { label: 'Lugares', hits: places },
    { label: 'Vínculos y grupos', hits: [...ties, ...groups] },
  ]
    .map((g) => ({ ...g, hits: g.hits.slice(0, MAX_HITS_PER_GROUP) }))
    .filter((g) => g.hits.length > 0);
}
