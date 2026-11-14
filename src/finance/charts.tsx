import { useState, type CSSProperties, type ReactNode } from 'react';
import { moneyShort } from './money';

/** Gráficos propios, livianos y sin librerías: dona, barras, líneas y calendario. */

const palette = ['#c0674a', '#4f6bb5', '#3c9186', '#a0527f', '#c58a1c', '#6b62b5', '#5f8247', '#8a6d4a', '#d06b8c', '#2f7d6d'];
const known: Record<string, string> = {
  Comida: '#c0674a',
  Transporte: '#4f6bb5',
  Hogar: '#8a6d4a',
  Salud: '#3c9186',
  Ocio: '#a0527f',
  Educación: '#6b62b5',
  Trabajo: '#5f8247',
  Compras: '#c58a1c',
  Regalos: '#d06b8c',
  Impuestos: '#6f7a66',
  Ahorro: '#2f7d6d',
  Emergencias: '#2f7d6d',
  Meta: '#2f7d6d',
  Otro: '#9aa391',
  'Sin categoría': '#b8bfae',
  Salario: '#4f8f5a',
  Ventas: '#3c9186',
  Honorarios: '#5f8247',
  Regalo: '#d06b8c',
  Reembolso: '#7b9bb5',
  Inversión: '#c58a1c',
  Transferencia: '#8c95a3',
  Préstamo: '#b0703a',
};
export function catColor(name: string) {
  if (known[name]) return known[name];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export type DonutSlice = { name: string; value: number; color?: string };

export function Donut({
  slices,
  size = 168,
  thickness = 18,
  children,
  active,
  onActive,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  children?: ReactNode;
  active?: string | null;
  onActive?: (name: string | null) => void;
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let at = 0;
  return (
    <div className="fz-donut" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef1e8" strokeWidth={thickness} />
        {total > 0 &&
          slices.map((s) => {
            const len = (Math.max(0, s.value) / total) * c;
            const gap = slices.length > 1 ? Math.min(2.5, len / 3) : 0;
            const el = (
              <circle
                key={s.name}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color ?? catColor(s.name)}
                strokeWidth={active === s.name ? thickness + 4 : thickness}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-at}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: 'stroke-width .2s', opacity: active && active !== s.name ? 0.35 : 1 }}
                onMouseEnter={() => onActive?.(s.name)}
                onMouseLeave={() => onActive?.(null)}
              />
            );
            at += len;
            return el;
          })}
      </svg>
      <div className="fz-donut-center">{children}</div>
    </div>
  );
}

export type Bar = { key: string; label: string; value: number; value2?: number; tip?: string; mark?: boolean };

/** Barras verticales (una o dos series), con una línea de promedio opcional. */
export function Bars({
  data,
  height = 150,
  average,
  color = 'var(--fz-out)',
  color2 = 'var(--fz-in)',
  every = 1,
}: {
  data: Bar[];
  height?: number;
  average?: number;
  color?: string;
  color2?: string;
  /** Cada cuántas barras se muestra la etiqueta. */
  every?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.value2 ?? 0)), average ?? 0);
  const shown = data.find((d) => d.key === hover);
  return (
    <div className="fz-bars" style={{ '--h': height + 'px' } as CSSProperties} onMouseLeave={() => setHover(null)}>
      <div className="fz-bars-plot">
        {average !== undefined && average > 0 && (
          <span className="fz-bars-avg" style={{ bottom: (average / max) * 100 + '%' }}>
            <em>prom. {moneyShort(average)}</em>
          </span>
        )}
        {data.map((d) => (
          <div
            key={d.key}
            className={'fz-bar' + (d.key === hover ? ' on' : '') + (d.mark ? ' mark' : '')}
            onMouseEnter={() => setHover(d.key)}
            title={d.tip}
          >
            <i style={{ height: (Math.max(0, d.value) / max) * 100 + '%', background: color }} />
            {d.value2 !== undefined && (
              <i style={{ height: (Math.max(0, d.value2) / max) * 100 + '%', background: color2 }} />
            )}
          </div>
        ))}
      </div>
      <div className="fz-bars-axis">
        {data.map((d, i) => (
          <span key={d.key}>{i % every === 0 ? d.label : ''}</span>
        ))}
      </div>
      <div className="fz-bars-tip" aria-live="polite">
        {shown ? shown.tip : '\u00a0'}
      </div>
    </div>
  );
}

/** Línea simple: para el valor de una inversión o el saldo de los próximos días. */
export function Line({
  series,
  height = 120,
  zero = false,
  points,
}: {
  series: { values: number[]; color: string; dashed?: boolean; fill?: boolean }[];
  height?: number;
  /** Dibuja la línea del cero (si los valores cruzan a negativo). */
  zero?: boolean;
  /** Cuántos puntos tiene el eje (una serie más corta llega solo hasta donde va). */
  points?: number;
}) {
  const all = series.flatMap((s) => s.values);
  if (all.length < 2) return <div className="fz-line empty" style={{ height }} />;
  const min = Math.min(...all, zero ? 0 : Infinity);
  const max = Math.max(...all, zero ? 0 : -Infinity);
  const span = max - min || 1;
  const W = 100;
  const H = 40;
  const y = (v: number) => H - ((v - min) / span) * (H - 4) - 2;
  return (
    <svg className="fz-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      {zero && min < 0 && max > 0 && (
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="#d9ded0" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      )}
      {series.map((s, k) => {
        const n = points ?? s.values.length;
        const x = (i: number) => (i / Math.max(1, n - 1)) * W;
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
        if (s.values.length === 1) pts.push(`${x(0) + 0.5},${y(s.values[0])}`);
        return (
          <g key={k}>
            {s.fill && (
              <polygon points={`0,${H} ${pts.join(' ')} ${x(s.values.length - 1)},${H}`} fill={s.color} opacity="0.1" />
            )}
            <polyline
              points={pts.join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray={s.dashed ? '4 4' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Mini barras de resultado diario: verde si ganó, rojo si perdió, gris si quedó igual. */
export function DayBars({ days, count = 24 }: { days: { d: string; change: number }[]; count?: number }) {
  const list = days.slice(-count);
  const max = Math.max(1, ...list.map((x) => Math.abs(x.change)));
  return (
    <div className="fz-daybars" aria-hidden="true">
      {list.map((x) => (
        <i
          key={x.d}
          className={x.change > 0 ? 'up' : x.change < 0 ? 'down' : 'flat'}
          style={{ height: Math.max(8, (Math.abs(x.change) / max) * 100) + '%' }}
          title={`${x.d}: ${x.change > 0 ? '+' : ''}${moneyShort(x.change)}`}
        />
      ))}
    </div>
  );
}

const weekdays = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Calendario de un mes con un color por día (gasto del día, o resultado de una inversión). */
export function MonthGrid({
  month,
  cell,
}: {
  month: string;
  cell: (day: string) => { tone?: 'up' | 'down' | 'flat' | 'heat'; level?: number; tip?: string } | null;
}) {
  const [y, m] = month.split('-').map(Number);
  const first = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="fz-month">
      {weekdays.map((w, i) => (
        <b key={i}>{w}</b>
      ))}
      {Array.from({ length: first }, (_, i) => (
        <span key={'x' + i} />
      ))}
      {Array.from({ length: days }, (_, i) => {
        const d = `${month}-${pad(i + 1)}`;
        const c = cell(d);
        return (
          <span
            key={d}
            className={'fz-day' + (c?.tone ? ' ' + c.tone : '')}
            style={c?.level !== undefined ? ({ '--lv': c.level } as CSSProperties) : undefined}
            title={c?.tip}
          >
            {i + 1}
          </span>
        );
      })}
    </div>
  );
}

/** Barra de progreso con marcas (p. ej. tus tres escenarios). */
export function Progress({
  value,
  max,
  marks = [],
  tone = 'in',
}: {
  value: number;
  max: number;
  marks?: { at: number; label: string }[];
  tone?: 'in' | 'out' | 'warn' | 'bad';
}) {
  const top = Math.max(max, value, ...marks.map((m) => m.at), 1);
  return (
    <div className={'fz-progress ' + tone}>
      <i style={{ width: Math.min(100, (value / top) * 100) + '%' }} />
      {marks.map((m) => (
        <em key={m.label} style={{ left: (m.at / top) * 100 + '%' }} title={`${m.label}: ${moneyShort(m.at)}`}>
          <small>{m.label}</small>
        </em>
      ))}
    </div>
  );
}

/** Anillo de avance (presupuesto usado, índice del mes…) con lo que quieras en el centro. */
export function Ring({
  value,
  max,
  size = 120,
  thickness = 10,
  tone = 'in',
  children,
}: {
  value: number;
  max: number;
  size?: number;
  thickness?: number;
  tone?: 'in' | 'out' | 'warn' | 'bad' | 'top' | 'good' | 'mid' | 'low';
  children?: ReactNode;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className={'fz-ring ' + tone} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="fz-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} />
        <circle
          className="fz-ring-bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${pct * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="fz-ring-center">{children}</div>
    </div>
  );
}
