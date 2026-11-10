import {
  Banknote,
  BookMarked,
  Briefcase,
  Clapperboard,
  Lightbulb,
  ListChecks,
  PenLine,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Kind } from '../data';

export type KindMeta = {
  icon: LucideIcon;
  /** Cómo se llama en pantalla (el tipo guardado no cambia: «Nota» se muestra como «Entrada»). */
  label: string;
  /** Frase corta para el selector de tipo. */
  hint: string;
  saveLabel: string;
  /** Color de acento del formulario, su versión suave y la de texto sobre fondo suave. */
  accent: string;
  soft: string;
  ink: string;
  /** Tipos con una sola imagen principal (póster, portada, comprobante). */
  cover?: boolean;
};

export const kindMeta: Record<Kind, KindMeta> = {
  Nota: {
    icon: PenLine,
    label: 'Entrada',
    hint: 'Lo que viviste y sentiste, en tu diario',
    saveLabel: 'Guardar en el diario',
    accent: '#5f8247',
    soft: '#eaf1e0',
    ink: '#3a5229',
  },
  Encuentro: {
    label: 'Encuentro',
    icon: Users,
    hint: 'Con quién estuviste y cómo fue',
    saveLabel: 'Guardar encuentro',
    accent: '#8a6fa8',
    soft: '#f0e9f6',
    ink: '#553f6e',
  },
  Película: {
    label: 'Película',
    icon: Clapperboard,
    hint: 'Películas y series que viste o quieres ver',
    saveLabel: 'Guardar película',
    accent: '#6b75b8',
    soft: '#e9ebf8',
    ink: '#3c4378',
    cover: true,
  },
  Libro: {
    label: 'Libro',
    icon: BookMarked,
    hint: 'Tu lectura, frases y progreso',
    saveLabel: 'Guardar libro',
    accent: '#b08843',
    soft: '#f8f0dd',
    ink: '#6c5224',
    cover: true,
  },
  Trabajo: {
    label: 'Trabajo',
    icon: Briefcase,
    hint: 'Proyectos, avances y próximos pasos',
    saveLabel: 'Guardar trabajo',
    accent: '#4d7b9d',
    soft: '#e3eef6',
    ink: '#2b4c64',
  },
  Aprendizaje: {
    label: 'Aprendizaje',
    icon: Lightbulb,
    hint: 'Algo nuevo que ya sabes',
    saveLabel: 'Guardar aprendizaje',
    accent: '#3c9186',
    soft: '#dff2ef',
    ink: '#205750',
  },
  Movimiento: {
    label: 'Movimiento',
    icon: Banknote,
    hint: 'Un ingreso o un gasto',
    saveLabel: 'Guardar movimiento',
    accent: '#c0674a',
    soft: '#f9e9e2',
    ink: '#7d3a26',
    cover: true,
  },
  Pendiente: {
    label: 'Pendiente',
    icon: ListChecks,
    hint: 'Algo por hacer, con fecha',
    saveLabel: 'Guardar pendiente',
    accent: '#c4705a',
    soft: '#f9e8e2',
    ink: '#7b3f30',
  },
};

/** Los ingresos se tiñen de verde; el resto de colores no cambia. */
export const incomeColors = { accent: '#4f8f5a', soft: '#e3f1e5', ink: '#2d5a36' };
/** Las series se distinguen de las películas con su propio color. */
export const seriesColors = { accent: '#a0527f', soft: '#f6e9f1', ink: '#6e2f57' };
