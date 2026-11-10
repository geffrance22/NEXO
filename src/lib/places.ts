import {
  Briefcase,
  Coffee,
  Dumbbell,
  Home,
  MapPin,
  Palmtree,
  Plane,
  Theater,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import type { Entry, Person, Place, PlaceKind, StoredImage } from '../data';
import { normalizeText, todayInputValue } from './format';

export const placeKinds: Record<
  PlaceKind,
  { label: string; icon: LucideIcon; color: string; soft: string }
> = {
  cafe: { label: 'Café', icon: Coffee, color: '#9a6b45', soft: '#f5ebe1' },
  comida: { label: 'Comida', icon: UtensilsCrossed, color: '#c0674a', soft: '#f9e9e2' },
  casa: { label: 'Casa', icon: Home, color: '#5f8247', soft: '#eaf1e0' },
  trabajo: { label: 'Trabajo', icon: Briefcase, color: '#4d7b9d', soft: '#e3eef6' },
  naturaleza: { label: 'Naturaleza', icon: Palmtree, color: '#3c9186', soft: '#dff2ef' },
  viaje: { label: 'Viaje', icon: Plane, color: '#6b75b8', soft: '#e9ebf8' },
  bar: { label: 'Bar', icon: Wine, color: '#a84f74', soft: '#f6e4ec' },
  cultura: { label: 'Cultura', icon: Theater, color: '#8a6fa8', soft: '#f0e9f6' },
  deporte: { label: 'Deporte', icon: Dumbbell, color: '#c48a2a', soft: '#fbf1dc' },
  otro: { label: 'Otro', icon: MapPin, color: '#7d8590', soft: '#eef0f3' },
};
export const placeKindList = Object.keys(placeKinds) as PlaceKind[];

const localDay = (iso: string) => todayInputValue(new Date(iso));

/**
 * ¿Este recuerdo pasó en este lugar? Solo cuenta el lugar vinculado (`details.placeId`). La
 * ubicación desde donde escribiste (`details.where`) es otra cosa y nunca hace una visita.
 */
export function isAt(e: Entry, place: Place) {
  return e.details.placeId === place.id;
}

export function placeOf(e: Entry, places: Place[]) {
  return places.find((p) => isAt(e, p)) ?? null;
}

export type PlaceStats = {
  visits: Entry[];
  last: string | null;
  first: string | null;
  /** Fotos propias del lugar y de los recuerdos que pasaron ahí. */
  photos: StoredImage[];
  people: { person: Person; n: number }[];
  mood: number | null;
};

export function placeStats(place: Place, entries: Entry[], people: Person[]): PlaceStats {
  const visits = entries
    .filter((e) => isAt(e, place))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const counts = new Map<string, number>();
  for (const e of visits) for (const id of e.person_ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const seen = new Set<string>();
  const photos = [...place.images, ...visits.flatMap((e) => e.images)].filter(
    (i) => !seen.has(i.url) && seen.add(i.url),
  );
  const moods = visits.map((e) => e.details.mood).filter((m): m is number => typeof m === 'number');
  const moodCount = new Map<number, number>();
  for (const m of moods) moodCount.set(m, (moodCount.get(m) ?? 0) + 1);
  return {
    visits,
    last: visits[0] ? localDay(visits[0].created_at) : null,
    first: visits.length ? localDay(visits[visits.length - 1].created_at) : null,
    photos,
    people: [...counts.entries()]
      .flatMap(([id, n]) => {
        const person = people.find((p) => p.id === id);
        return person ? [{ person, n }] : [];
      })
      .sort((a, b) => b.n - a.n),
    mood: moodCount.size ? [...moodCount.entries()].sort((a, b) => b[1] - a[1])[0][0] : null,
  };
}

export const placeSearchText = (p: Place) =>
  normalizeText([p.name, p.city, p.address, p.story, placeKinds[p.kind]?.label].join(' '));
