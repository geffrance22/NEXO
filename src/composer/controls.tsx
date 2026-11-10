import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Star } from 'lucide-react';
import { MoodIcon, moods, moodValue } from './moods';

/** Área de texto que crece con lo que escribes. */
export function AutoTextarea({
  value,
  minRows = 3,
  ...rest
}: { value: string; minRows?: number } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);
  return <textarea ref={ref} rows={minRows} value={value} {...rest} />;
}

type Option<T extends string> = { value: T; label: string; icon?: ReactNode };

/** Selector de varias opciones con un indicador que se desliza. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Option<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  label: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      className="cp-seg"
      role="radiogroup"
      aria-label={label}
      style={{ '--n': options.length, '--i': index } as CSSProperties}
    >
      <span className="cp-seg-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          key={o.value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Fichas de elección única. Con `clearable`, pulsar la elegida la quita. */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  clearable = false,
  label,
}: {
  options: (T | Option<T>)[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  clearable?: boolean;
  label: string;
}) {
  return (
    <div className="cp-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        const on = opt.value === value;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={on}
            key={opt.value}
            className={'cp-chip' + (on ? ' on' : '')}
            onClick={() => onChange(on && clearable ? undefined : opt.value)}
          >
            {'icon' in opt && opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Calificación de 1 a 5 estrellas. Pulsar la misma estrella la quita. */
export function Stars({
  value = 0,
  onChange,
  label,
  size = 30,
}: {
  value?: number;
  onChange: (value: number) => void;
  label: string;
  size?: number;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="cp-stars" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} de 5`}
          key={n}
          className={n <= shown ? 'on' : ''}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? 0 : n)}
        >
          <Star size={size} />
        </button>
      ))}
    </div>
  );
}

export { moods, moodOf, moodTone, moodValue, MoodIcon, type Mood } from './moods';

/**
 * Los ánimos, cada uno con su ícono y un tooltip con su nombre. Pulsar el elegido lo quita.
 * Un valor antiguo (de la lista anterior) se muestra como su equivalente actual.
 */
export function MoodPicker({
  value,
  onChange,
  label,
  large = false,
}: {
  value?: number;
  onChange: (value: number | undefined) => void;
  label: string;
  large?: boolean;
}) {
  const current = moodValue(value);
  return (
    <div
      className={
        'cp-moods' + (large ? ' large' : '') + (current !== undefined ? ' has-value' : '')
      }
      role="radiogroup"
      aria-label={label}
    >
      {moods.map((m) => {
        const on = current === m.value;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={m.label}
            key={m.value}
            className={on ? 'on' : ''}
            style={{ '--mood': m.color } as CSSProperties}
            onClick={() => onChange(on ? undefined : m.value)}
          >
            <MoodIcon mood={m} solid={on} className="cp-mood-icon" />
            <span className="cp-mood-label" aria-hidden="true">
              {m.label}
            </span>
            <span className="cp-mood-tip" aria-hidden="true">
              {m.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Etiqueta pequeña sobre un bloque del formulario. */
export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="cp-label">
      {children}
      {hint && <span>{hint}</span>}
    </div>
  );
}

export const priorities = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
] as const;

/** Prioridad con un punto de color: verde, ámbar y rojo. */
export function PriorityPicker({
  value,
  onChange,
}: {
  value: 'baja' | 'media' | 'alta';
  onChange: (value: 'baja' | 'media' | 'alta') => void;
}) {
  return (
    <div className="cp-chips" role="radiogroup" aria-label="Prioridad">
      {priorities.map((p) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === p.value}
          key={p.value}
          className={'cp-chip priority-' + p.value + (value === p.value ? ' on' : '')}
          onClick={() => onChange(p.value)}
        >
          <i className="cp-dot" />
          {p.label}
        </button>
      ))}
    </div>
  );
}

const confidenceLabels = [
  'Apenas lo vi',
  'Algo entendí',
  'Lo entiendo',
  'Lo domino bien',
  'Podría enseñarlo',
];

/** Cinco puntos para medir qué tan bien entendiste algo. */
export function ConfidenceDots({
  value = 0,
  onChange,
}: {
  value?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="cp-confidence">
      <div className="cp-dots" role="radiogroup" aria-label="Nivel de comprensión">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={confidenceLabels[n - 1]}
            key={n}
            className={n <= value ? 'on' : ''}
            onClick={() => onChange(value === n ? 0 : n)}
          />
        ))}
      </div>
      <span>{value ? confidenceLabels[value - 1] : 'Toca para indicar'}</span>
    </div>
  );
}
