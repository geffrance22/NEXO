import {
  Briefcase,
  GraduationCap,
  Heart,
  HeartPulse,
  Home,
  Plane,
  Smile,
  Sparkles,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Person, PersonUpdate, UpdateKind } from '../data';

/** Tipos de novedad: qué cambió en su vida. */
export const updateKinds: Record<
  UpdateKind,
  { label: string; icon: LucideIcon; color: string; soft: string; hint: string }
> = {
  trabajo: {
    label: 'Trabajo',
    icon: Briefcase,
    color: '#4d7b9d',
    soft: '#e3eef6',
    hint: 'Empezó a trabajar en…, la ascendieron…',
  },
  estudios: {
    label: 'Estudios',
    icon: GraduationCap,
    color: '#6b75b8',
    soft: '#e9ebf8',
    hint: 'Se graduó de…, empezó una maestría en…',
  },
  salud: {
    label: 'Salud',
    icon: HeartPulse,
    color: '#c0553f',
    soft: '#fbe6e1',
    hint: 'La operaron de…, se está recuperando de…',
  },
  amor: {
    label: 'Amor',
    icon: Heart,
    color: '#c25683',
    soft: '#f8e5ee',
    hint: 'Tiene pareja nueva, se comprometió, terminó…',
  },
  familia: {
    label: 'Familia',
    icon: Users,
    color: '#c0674a',
    soft: '#f9e9e2',
    hint: 'Va a ser mamá, nació su sobrino…',
  },
  hogar: {
    label: 'Hogar',
    icon: Home,
    color: '#9a8a62',
    soft: '#f4efe2',
    hint: 'Se mudó a…, compró casa…',
  },
  logro: {
    label: 'Logro',
    icon: Trophy,
    color: '#c48a2a',
    soft: '#fbf1dc',
    hint: 'Corrió su primera maratón, lanzó su negocio…',
  },
  viaje: {
    label: 'Viaje',
    icon: Plane,
    color: '#3c9186',
    soft: '#dff2ef',
    hint: 'Se va a Europa en diciembre…',
  },
  animo: {
    label: 'Ánimo',
    icon: Smile,
    color: '#5f8247',
    soft: '#eaf1e0',
    hint: 'Está pasando por un momento difícil…, está feliz porque…',
  },
  otro: {
    label: 'Otro',
    icon: Sparkles,
    color: '#7d8590',
    soft: '#eef0f3',
    hint: '¿Qué hay de nuevo?',
  },
};
export const updateKindList = Object.keys(updateKinds) as UpdateKind[];

/** Novedades de una persona, la más reciente primero. */
export const updatesOf = (p: Person): PersonUpdate[] =>
  [...(p.profile.updates ?? [])].sort(
    (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at),
  );
