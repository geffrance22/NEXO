import { useRef } from 'react';
import { CalendarDays } from 'lucide-react';
import { addDays, friendlyDate, nextMonday, nextSaturday, todayInputValue } from '../lib/format';

export type DateOption = 'today' | 'yesterday' | 'tomorrow' | 'weekend' | 'nextweek' | 'none';

const resolve: Record<DateOption, () => string> = {
  today: () => todayInputValue(),
  yesterday: () => addDays(todayInputValue(), -1),
  tomorrow: () => addDays(todayInputValue(), 1),
  weekend: () => nextSaturday(),
  nextweek: () => nextMonday(),
  none: () => '',
};
const labels: Record<DateOption, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  tomorrow: 'Mañana',
  weekend: 'Fin de semana',
  nextweek: 'Próx. semana',
  none: 'Sin fecha',
};

type DateChipsProps = {
  value: string;
  onChange: (value: string) => void;
  options: DateOption[];
  label: string;
};

/** Fechas rápidas (hoy, ayer, mañana…) y un calendario para cualquier otra. */
export function DateChips({ value, onChange, options, label }: DateChipsProps) {
  const input = useRef<HTMLInputElement>(null);
  // Si dos opciones caen en el mismo día (p. ej. «Mañana» y «Fin de semana» un viernes),
  // solo se marca la primera.
  const active = options.find((o) => resolve[o]() === value);
  const matched = active !== undefined;

  const openCalendar = () => {
    try {
      input.current?.showPicker();
    } catch {
      input.current?.focus();
      input.current?.click();
    }
  };

  return (
    <div className="cp-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o === active;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={on}
            key={o}
            className={'cp-chip' + (on ? ' on' : '')}
            onClick={() => onChange(resolve[o]())}
          >
            {labels[o]}
          </button>
        );
      })}
      <span className="cp-date-wrap">
        <button
          type="button"
          className={'cp-chip' + (!matched && value ? ' on' : '')}
          onClick={openCalendar}
        >
          <CalendarDays size={14} />
          {!matched && value ? friendlyDate(value) : 'Elegir fecha'}
        </button>
        <input
          ref={input}
          type="date"
          className="cp-date-hidden"
          aria-label={`${label}: elegir fecha`}
          tabIndex={-1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </div>
  );
}
