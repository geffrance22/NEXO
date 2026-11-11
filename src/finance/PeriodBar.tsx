import { ChevronLeft, ChevronRight } from 'lucide-react';
import { todayInputValue } from '../lib/format';
import { periodAt, periodLabel, shiftPeriod, type Period, type PeriodKind } from './money';

/** Selector del periodo: semana, mes, año o todo, con flechas para moverse. */
export function PeriodBar({
  period,
  onChange,
  children,
}: {
  period: Period;
  onChange: (p: Period) => void;
  children?: React.ReactNode;
}) {
  const today = todayInputValue();
  const isNow = today >= period.from && today <= period.to;
  return (
    <div className="fz-period">
      <div className="fz-period-kinds" role="radiogroup" aria-label="Periodo">
        {(['semana', 'mes', 'año', 'todo'] as PeriodKind[]).map((k) => (
          <button
            type="button"
            role="radio"
            aria-checked={period.kind === k}
            key={k}
            className={period.kind === k ? 'on' : ''}
            onClick={() => onChange(periodAt(k))}
          >
            {k === 'todo' ? 'Todo' : k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      {period.kind !== 'todo' && (
        <div className="fz-period-nav">
          <button type="button" aria-label="Anterior" onClick={() => onChange(shiftPeriod(period, -1))}>
            <ChevronLeft size={16} />
          </button>
          <strong>{periodLabel(period)}</strong>
          <button
            type="button"
            aria-label="Siguiente"
            disabled={isNow}
            onClick={() => onChange(shiftPeriod(period, 1))}
          >
            <ChevronRight size={16} />
          </button>
          {!isNow && (
            <button type="button" className="fz-period-now" onClick={() => onChange(periodAt(period.kind))}>
              Hoy
            </button>
          )}
        </div>
      )}
      {children && <div className="fz-period-extra">{children}</div>}
    </div>
  );
}
