import { AlarmClock, Check, Sunrise } from 'lucide-react';
import { addDays, friendlyDate, nextMonday, todayInputValue } from '../lib/format';

/** Hasta cuándo posponer: lo más usado a un toque y una fecha a elegir. */
export function snoozeChoices(today = todayInputValue()) {
  return [
    { label: 'Mañana', date: addDays(today, 1) },
    { label: 'En 3 días', date: addDays(today, 3) },
    { label: 'El lunes', date: nextMonday(today) },
    { label: 'En una semana', date: addDays(today, 7) },
    { label: 'En un mes', date: addDays(today, 30) },
  ];
}

/**
 * Menú de posponer (va dentro de un Popover). Una tarjeta pospuesta desaparece de su columna hasta
 * esa fecha; ese día vuelve sola. `current` es la fecha a la que ya está pospuesta, si hay.
 */
export function SnoozeMenu({
  current,
  onPick,
}: {
  current?: string | null;
  onPick: (until: string | null) => void;
}) {
  const today = todayInputValue();
  const on = Boolean(current && current > today);
  return (
    <>
      <p className="bd-pop-label">Posponer hasta</p>
      {snoozeChoices(today).map((c) => (
        <button
          type="button"
          key={c.label}
          className={'bd-pick-item' + (current === c.date ? ' on' : '')}
          onClick={() => onPick(c.date)}
        >
          <AlarmClock size={14} className="bd-pick-lead" />
          <span>{c.label}</span>
          <small>{friendlyDate(c.date, today)}</small>
          {current === c.date && <Check size={15} />}
        </button>
      ))}
      <label className="bd-snz-date">
        <span>Otra fecha</span>
        <input
          type="date"
          min={addDays(today, 1)}
          defaultValue={on ? current! : ''}
          onChange={(e) => e.target.value > today && onPick(e.target.value)}
        />
      </label>
      {on && (
        <>
          <div className="bd-pop-sep" />
          <button type="button" className="bd-pick-item" onClick={() => onPick(null)}>
            <Sunrise size={14} className="bd-pick-lead" />
            <span>Despertar ahora</span>
          </button>
        </>
      )}
      <p className="bd-pop-note">Sale de la columna y vuelve sola ese día.</p>
    </>
  );
}
