import {
  Layers,
  MapPin,
  Newspaper,
  StickyNote,
  Tv,
  Type,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { plainText } from '../components/RichText';
import { kindMeta } from '../composer/kinds';
import type { Person, Workspace } from '../data';
import { entrySummary, kindLabel, isSeries } from '../lib/entries';
import { friendlyDate, todayInputValue } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { tones, toneOf, type Tone } from '../library/shelf';
import { hostOf, type Extras } from './digest';
import type { NotebookItem, NotebookItemType } from './model';

/** Lo que se dibuja de un elemento del cuaderno (en el lienzo, en la lista y en el buscador). */
export type CardModel = {
  label: string;
  title: string;
  sub?: string;
  text?: string;
  cover?: string;
  /** Portada vertical (póster o libro) en lugar de foto apaisada. */
  poster?: boolean;
  icon: LucideIcon;
  tone: Tone;
  person?: Person;
  /** El original ya no existe (se borró). */
  missing?: boolean;
  /** Un pendiente hecho. */
  done?: boolean;
};

export const typeMeta: Record<
  NotebookItemType,
  { label: string; plural: string; icon: LucideIcon; tone: Tone }
> = {
  entry: {
    label: 'Recuerdo',
    plural: 'Recuerdos',
    icon: Layers,
    tone: tones.inicio,
  },
  person: {
    label: 'Persona',
    plural: 'Personas',
    icon: UserRound,
    tone: { accent: '#3f7f99', soft: '#e3f0f5', ink: '#24566b' },
  },
  place: {
    label: 'Lugar',
    plural: 'Lugares',
    icon: MapPin,
    tone: { accent: '#b4566e', soft: '#f8e8ec', ink: '#7c3347' },
  },
  episode: {
    label: 'Episodio',
    plural: 'Episodios',
    icon: Layers,
    tone: { accent: '#4d5560', soft: '#eceef1', ink: '#2e343b' },
  },
  reading: {
    label: 'Lectura',
    plural: 'Lecturas',
    icon: Newspaper,
    tone: tones.lecturas,
  },
  note: {
    label: 'Nota rápida',
    plural: 'Notas rápidas',
    icon: StickyNote,
    tone: { accent: '#a08a2a', soft: '#fbf5dc', ink: '#5c4c12' },
  },
  text: {
    label: 'Ficha',
    plural: 'Fichas',
    icon: Type,
    tone: { accent: '#a08a2a', soft: '#fbf5dc', ink: '#5c4c12' },
  },
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const dateOf = (iso: string, today: string) => friendlyDate(todayInputValue(new Date(iso)), today);

export function resolveItem(it: NotebookItem, ws: Workspace, extras: Extras | null): CardModel {
  const meta = typeMeta[it.type];
  const today = todayInputValue();
  const gone: CardModel = {
    label: meta.label,
    title: 'Ya no existe',
    sub: 'Se borró el original. Puedes quitarlo del cuaderno.',
    icon: meta.icon,
    tone: meta.tone,
    missing: true,
  };
  switch (it.type) {
    case 'entry': {
      const e = ws.entries.find((x) => x.id === it.id);
      if (!e) return gone;
      const img = entryImages(e)[0];
      const media = e.kind === 'Película' || e.kind === 'Libro';
      const names = e.person_ids
        .flatMap((id) => ws.people.find((p) => p.id === id)?.name.split(' ')[0] ?? [])
        .slice(0, 3);
      return {
        label: kindLabel(e),
        title: e.title || kindLabel(e),
        sub: [dateOf(e.recorded_at ?? e.created_at, today), names.join(', ')]
          .filter(Boolean)
          .join(' · '),
        text: clip(entrySummary(e), 180),
        cover: img ? (img.medium ?? img.thumb ?? img.url) : undefined,
        poster: media,
        icon: isSeries(e) ? Tv : kindMeta[e.kind].icon,
        tone: toneOf(e),
        done: e.kind === 'Pendiente' && e.status === 'completado',
      };
    }
    case 'person': {
      const p = ws.people.find((x) => x.id === it.id);
      if (!p) return gone;
      return {
        label: meta.label,
        title: p.name,
        sub: [p.role || p.profile.occupation, p.profile.city].filter(Boolean).join(' · '),
        text: clip(p.interests || p.bio, 140),
        icon: meta.icon,
        tone: meta.tone,
        person: p,
      };
    }
    case 'place': {
      const pl = ws.places.find((x) => x.id === it.id);
      if (!pl) return gone;
      const img = pl.images[0];
      return {
        label: meta.label,
        title: pl.name,
        sub: [pl.kind, pl.city].filter(Boolean).join(' · '),
        text: clip(pl.story, 140),
        cover: img ? (img.medium ?? img.thumb ?? img.url) : undefined,
        icon: meta.icon,
        tone: meta.tone,
      };
    }
    case 'episode': {
      const ep = ws.episodes.find((x) => x.id === it.id);
      if (!ep) return gone;
      const img = ep.images?.[0];
      return {
        label: meta.label,
        title: ep.title,
        sub: [ep.kind, ep.starts_on ? dateOf(ep.starts_on + 'T12:00:00', today) : '']
          .filter(Boolean)
          .join(' · '),
        text: clip(ep.summary, 140),
        cover: img ? (img.medium ?? img.thumb ?? img.url) : undefined,
        icon: meta.icon,
        tone: meta.tone,
      };
    }
    case 'reading': {
      if (!extras)
        return {
          label: meta.label,
          title: '…',
          icon: meta.icon,
          tone: meta.tone,
        };
      const r = extras.readings.get(it.id);
      if (!r) return gone;
      return {
        label: meta.label,
        title: r.title,
        sub: hostOf(r.url),
        text: clip(r.excerpt ?? '', 140),
        cover: r.cover ?? undefined,
        icon: meta.icon,
        tone: meta.tone,
      };
    }
    case 'note': {
      if (!extras)
        return {
          label: meta.label,
          title: '…',
          icon: meta.icon,
          tone: meta.tone,
        };
      const n = extras.notes.get(it.id);
      if (!n) return gone;
      return {
        label: meta.label,
        title: n.title || 'Nota',
        text: clip(plainText(n.body).replace(/\s+/g, ' ').trim(), 180),
        icon: meta.icon,
        tone: meta.tone,
      };
    }
    case 'text':
      return {
        label: meta.label,
        title: '',
        text: it.text,
        icon: meta.icon,
        tone: meta.tone,
      };
  }
}
