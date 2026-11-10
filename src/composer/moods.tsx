import type { CSSProperties } from 'react';
import {
  RiCloudyFill,
  RiCloudyLine,
  RiEmotionLaughFill,
  RiEmotionLaughLine,
  RiEmotionSadFill,
  RiEmotionSadLine,
  RiFlashlightFill,
  RiFlashlightLine,
  RiHeartPulseFill,
  RiHeartPulseLine,
  RiHourglassFill,
  RiHourglassLine,
  RiMoonClearFill,
  RiMoonClearLine,
  RiSparkling2Fill,
  RiSparkling2Line,
  RiZzzFill,
  RiZzzLine,
  type RemixiconComponentType,
} from '@remixicon/react';
import { normalizeText } from '../lib/format';
import './moods.css';

/*
 * Remix Icon no tiene cara enojada: esta sigue su retícula (24×24) y reutiliza el contorno
 * y la boca de `emotion-unhappy`, con los ojos un poco más bajos y dos cejas fruncidas.
 * Se pinta con `evenodd`: en la versión de trazo los rasgos quedan llenos dentro del aro;
 * en la rellena quedan calados sobre el círculo.
 */
const FACE_OUTER =
  'M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22Z';
const FACE_INNER =
  'M12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20Z';
const ANGRY_FEATURES =
  // Boca hacia abajo
  'M7 17.5C7 14.7386 9.23858 12.5 12 12.5C14.7614 12.5 17 14.7386 17 17.5H15C15 15.8431 13.6569 14.5 12 14.5C10.3431 14.5 9 15.8431 9 17.5H7Z' +
  // Ojos
  'M8 12.6C7.28203 12.6 6.7 12.018 6.7 11.3C6.7 10.582 7.28203 10 8 10C8.71797 10 9.3 10.582 9.3 11.3C9.3 12.018 8.71797 12.6 8 12.6Z' +
  'M16 12.6C15.282 12.6 14.7 12.018 14.7 11.3C14.7 10.582 15.282 10 16 10C16.718 10 17.3 10.582 17.3 11.3C17.3 12.018 16.718 12.6 16 12.6Z' +
  // Cejas que bajan hacia el centro
  'M7.2 6.6L10.8 8.4L10 10L6.4 8.2Z' +
  'M16.8 6.6L13.2 8.4L14 10L17.6 8.2Z';

const angryFace =
  (d: string): RemixiconComponentType =>
  ({ color = 'currentColor', size = 24, className, ...rest }) => (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill={color}
      {...rest}
      className={'remixicon ' + (className ?? '')}
    >
      <path fillRule="evenodd" d={d} />
    </svg>
  );
const RiEmotionAngryLine = angryFace(FACE_OUTER + FACE_INNER + ANGRY_FEATURES);
const RiEmotionAngryFill = angryFace(FACE_OUTER + ANGRY_FEATURES);

export type Mood = {
  /** Lo que se guarda en `details.mood`. */
  value: number;
  label: string;
  /** Para los textos planos (etiquetas, resúmenes); en pantalla se usa `MoodIcon`. */
  emoji: string;
  /** Tono de 1 (difícil) a 5 (muy bien), para promedios, rachas y el mapa del diario. */
  tone: 1 | 2 | 3 | 4 | 5;
  color: string;
  /** Trazo para el estado normal y relleno para el elegido (Remix Icon). */
  icon: RemixiconComponentType;
  iconFill: RemixiconComponentType;
  /** Nombre corto para el CSS (animación propia de cada ánimo). */
  key: string;
};

/**
 * Diez estados, de lo más luminoso a lo más pesado: primero los buenos, luego los serenos
 * (que miran hacia dentro) y al final los difíciles. 1 «Triste», 3 «Neutral», 4 «Alegre» y
 * 6 «Inquieto» reutilizan valores antiguos (Triste, Normal, Bien y Tenso); 9–14 son nuevos.
 * El orden es solo visual: para comparar ánimos se usa `tone`.
 */
export const moods: Mood[] = [
  { value: 4, key: 'alegre', label: 'Alegre', emoji: '😄', tone: 5, color: '#e09b0b', icon: RiEmotionLaughLine, iconFill: RiEmotionLaughFill },
  { value: 14, key: 'poderoso', label: 'Poderoso', emoji: '⚡', tone: 5, color: '#a345c9', icon: RiFlashlightLine, iconFill: RiFlashlightFill },
  { value: 13, key: 'inspirado', label: 'Inspirado', emoji: '✨', tone: 4, color: '#14a08f', icon: RiSparkling2Line, iconFill: RiSparkling2Fill },
  { value: 11, key: 'reflexivo', label: 'Reflexivo', emoji: '🤔', tone: 3, color: '#5b66d6', icon: RiMoonClearLine, iconFill: RiMoonClearFill },
  { value: 12, key: 'nostalgico', label: 'Nostálgico', emoji: '🥹', tone: 3, color: '#b07f4f', icon: RiHourglassLine, iconFill: RiHourglassFill },
  { value: 3, key: 'neutral', label: 'Neutral', emoji: '😐', tone: 3, color: '#86917a', icon: RiCloudyLine, iconFill: RiCloudyFill },
  { value: 10, key: 'cansado', label: 'Cansado', emoji: '🥱', tone: 2, color: '#77809a', icon: RiZzzLine, iconFill: RiZzzFill },
  { value: 6, key: 'inquieto', label: 'Inquieto', emoji: '😰', tone: 2, color: '#e07a36', icon: RiHeartPulseLine, iconFill: RiHeartPulseFill },
  { value: 1, key: 'triste', label: 'Triste', emoji: '😢', tone: 1, color: '#4a78c2', icon: RiEmotionSadLine, iconFill: RiEmotionSadFill },
  { value: 9, key: 'enojado', label: 'Enojado', emoji: '😠', tone: 1, color: '#d4433b', icon: RiEmotionAngryLine, iconFill: RiEmotionAngryFill },
];

/** Valores de la versión anterior que ya no están en la lista, con su equivalente actual. */
const LEGACY: Record<number, number> = { 2: 6, 5: 4, 7: 3, 8: 4 };
/** Nombres antiguos (o que pueda devolver el asistente) con su valor actual. */
const LEGACY_NAMES: Record<string, number> = {
  tenso: 6,
  raro: 6,
  normal: 3,
  tranquilo: 3,
  bien: 4,
  feliz: 4,
  divertido: 4,
  genial: 4,
  frustrado: 9,
  enojada: 9,
  cansada: 10,
  inquieta: 6,
  reflexiva: 11,
  nostalgica: 12,
  inspirada: 13,
  poderosa: 14,
};

/** El valor actual de un ánimo guardado (convierte los antiguos); undefined si no es válido. */
export function moodValue(v?: number | null): number | undefined {
  if (typeof v !== 'number') return undefined;
  const value = LEGACY[v] ?? v;
  return moods.some((m) => m.value === value) ? value : undefined;
}

export const moodOf = (v?: number | null) => {
  const value = moodValue(v);
  return value === undefined ? undefined : moods.find((m) => m.value === value);
};

export const moodTone = (v?: number | null): number | null => moodOf(v)?.tone ?? null;

/** Un ánimo por su nombre («nostálgico», «Tranquilo»…), o null. */
export function moodByName(name: string): number | null {
  const n = normalizeText(name.trim());
  if (!n) return null;
  return moods.find((m) => normalizeText(m.label) === n)?.value ?? LEGACY_NAMES[n] ?? null;
}

/**
 * El ícono de un ánimo: una ficha redondeada con un tinte de su color y su símbolo.
 * `solid` la pinta llena y usa el símbolo relleno (elegido).
 * Sin `size`, toma el tamaño de `--mood-size` (28 px por defecto).
 */
export function MoodIcon({
  mood,
  size,
  solid = false,
  className = '',
}: {
  mood: Mood;
  size?: number;
  solid?: boolean;
  className?: string;
}) {
  const Icon = solid ? mood.iconFill : mood.icon;
  return (
    <span
      className={'mood-orb' + (solid ? ' solid' : '') + (className ? ' ' + className : '')}
      data-mood={mood.key}
      style={
        {
          '--mood': mood.color,
          ...(size && { '--mood-size': `${size}px` }),
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <Icon />
    </span>
  );
}
