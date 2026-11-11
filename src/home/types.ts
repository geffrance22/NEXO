import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { HomeBlock } from '../data';

/** Dónde vive un bloque: el centro de Mi espacio o el panel derecho. */
export type Zone = 'main' | 'side';
export type Opts = Record<string, unknown>;
export type Choice = { value: string; label: string };

/** Un ajuste de un bloque: el formulario de «Personalizar» se arma solo a partir de estos. */
export type OptDef =
  | {
      key: string;
      label: string;
      hint?: string;
      type: 'number';
      min: number;
      max: number;
      step?: number;
      def: number;
      unit?: string;
    }
  | {
      key: string;
      label: string;
      hint?: string;
      type: 'select';
      choices?: Choice[];
      /** Opciones que dependen de tus datos (p. ej. tus carpetas de capturas). */
      useChoices?: () => Choice[];
      def: string;
    }
  | { key: string; label: string; hint?: string; type: 'multi'; choices: Choice[]; def: string[] }
  | { key: string; label: string; hint?: string; type: 'toggle'; def: boolean }
  | { key: string; label: string; hint?: string; type: 'text'; def: string; placeholder?: string; max?: number };

export type BlockProps = { opts: Opts; zone: Zone; inst: HomeBlock };

export type GroupId =
  | 'dia'
  | 'gente'
  | 'memoria'
  | 'cultura'
  | 'trabajo'
  | 'dinero'
  | 'imagenes'
  | 'atajos';

export type BlockDef = {
  type: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  group: GroupId;
  /** Dónde puede ir. El primero es donde se agrega por defecto. */
  zones: Zone[];
  /** Se puede agregar varias veces (p. ej. una carpeta de capturas distinta en cada uno). */
  multi?: boolean;
  /** En el centro ocupa todo el ancho por defecto (si no, la mitad). */
  wide?: boolean;
  /** Puede ocultarse solo cuando no tiene nada que mostrar (y si lo hace por defecto). */
  canHide?: boolean;
  hideDef?: boolean;
  /** No tiene encabezado: no se le puede cambiar el título. */
  noTitle?: boolean;
  opts?: OptDef[];
  Component: ComponentType<BlockProps>;
};

// ───────────────────────── Leer ajustes ─────────────────────────

export const num = (o: Opts, k: string, d = 0) => {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
};
export const str = (o: Opts, k: string, d = '') => {
  const v = o[k];
  return typeof v === 'string' ? v : d;
};
export const bool = (o: Opts, k: string, d = false) => {
  const v = o[k];
  return typeof v === 'boolean' ? v : d;
};
/** El título que le pusiste al bloque, o el de siempre. */
export const titleOf = (o: Opts, fallback: string) => {
  const t = o._title;
  return typeof t === 'string' && t.trim() ? t.trim() : fallback;
};
export const list = (o: Opts, k: string) => {
  const v = o[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};
