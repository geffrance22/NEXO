import { addDays, friendlyDate, normalizeText, todayInputValue } from '../lib/format';

/** Colores de columnas, tarjetas y etiquetas. */
export const tones = [
  { key: 'green', label: 'Verde', c: '#3f9a63', s: '#e2f3e8' },
  { key: 'yellow', label: 'Amarillo', c: '#d29d17', s: '#fbf1d2' },
  { key: 'orange', label: 'Naranja', c: '#e2752e', s: '#fde8d8' },
  { key: 'red', label: 'Rojo', c: '#d24b45', s: '#fbe1df' },
  { key: 'purple', label: 'Morado', c: '#8a63c7', s: '#efe7fa' },
  { key: 'blue', label: 'Azul', c: '#3b7bd4', s: '#e1ecfb' },
  { key: 'teal', label: 'Turquesa', c: '#23968f', s: '#dcf3f1' },
  { key: 'pink', label: 'Rosa', c: '#cc5a93', s: '#fae3ef' },
  { key: 'slate', label: 'Gris', c: '#66727f', s: '#e9edf1' },
] as const;
export const toneOf = (key?: string | null) => tones.find((t) => t.key === key) ?? null;

/** Color fijo de una etiqueta (siempre el mismo para el mismo texto). */
export function tagTone(tag: string) {
  const k = normalizeText(tag);
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return tones[h % tones.length];
}

/** Fondos del tablero. `dark`: el texto sobre el fondo va en claro. */
export const backgrounds = [
  {
    key: '',
    label: 'Niebla',
    css: 'linear-gradient(165deg, #eef2ee 0%, #e2e9e3 100%)',
    dark: false,
  },
  {
    key: 'sage',
    label: 'Salvia',
    css: 'linear-gradient(150deg, #dbe9d8 0%, #b7d0bb 100%)',
    dark: false,
  },
  {
    key: 'sand',
    label: 'Arena',
    css: 'linear-gradient(150deg, #f3e9d8 0%, #dcc7a6 100%)',
    dark: false,
  },
  {
    key: 'dawn',
    label: 'Amanecer',
    css: 'linear-gradient(135deg, #fde3cb 0%, #f4bfb4 50%, #d8c4e8 100%)',
    dark: false,
  },
  {
    key: 'ocean',
    label: 'Océano',
    css: 'linear-gradient(135deg, #c3e3f2 0%, #88b4e0 100%)',
    dark: false,
  },
  {
    key: 'dusk',
    label: 'Atardecer',
    css: 'linear-gradient(135deg, #574a8c 0%, #c06c8e 100%)',
    dark: true,
  },
  {
    key: 'forest',
    label: 'Bosque',
    css: 'linear-gradient(135deg, #1e3a2e 0%, #3f6b50 100%)',
    dark: true,
  },
  {
    key: 'night',
    label: 'Noche',
    css: 'linear-gradient(135deg, #1b2232 0%, #3a4762 100%)',
    dark: true,
  },
] as const;
/** Una tarjeta que solo tiene guiones («---», tres o más) es un divisor. */
export const isDivider = (title: string) => /^[-—–_]{3,}$/.test(title.trim());

export const backgroundOf = (key?: string | null) =>
  backgrounds.find((b) => b.key === (key ?? '')) ?? backgrounds[0];

/** Cómo va una fecha límite: vencida, hoy o mañana, más adelante o cumplida. */
export function dueState(due: string | null, done: boolean) {
  if (!due) return null;
  const today = todayInputValue();
  const tone = done ? 'ok' : due < today ? 'late' : due <= addDays(today, 1) ? 'soon' : 'later';
  return { tone, label: friendlyDate(due, today) };
}
