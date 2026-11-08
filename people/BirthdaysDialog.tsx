import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { BellPlus, Cake, CalendarPlus, MessageCircle, PartyPopper, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { addDays, todayInputValue } from '../lib/format';
import { ageOf, daysToBirthday, relationMeta, relationOf } from '../lib/people';
import { Avatar } from './Avatar';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Próximos cumpleaños: los de los próximos 30 días y, debajo, los que siguen. */
export function BirthdaysDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (personId: string) => void;
}) {
  const { workspace, openEntry, editPerson } = useApp();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const today = todayInputValue();
  const all = useMemo(
    () =>
      workspace.people
        .map((p) => ({ p, d: daysToBirthday(p, today) }))
        .filter((x): x is { p: (typeof workspace.people)[number]; d: number } => x.d !== null)
        .sort((a, b) => a.d - b.d),
    [workspace.people, today],
  );
  const soon = all.filter((x) => x.d <= 30);
  const later = all.filter((x) => x.d > 30).slice(0, 4);
  const missing = workspace.people.filter((p) => !p.profile.birthday);

  const row = ({ p, d }: (typeof all)[number], dim = false) => {
    const meta = relationMeta[relationOf(p)];
    const date = addDays(today, d);
    const age = ageOf(p, date);
    const [mm, dd] = (p.profile.birthday ?? '01-01').split('-').map(Number);
    const digits = (p.profile.phone ?? '').replace(/\D/g, '');
    const first = p.name.split(' ')[0];
    return (
      <li
        key={p.id}
        className={'bd-row' + (d === 0 ? ' today' : '') + (dim ? ' dim' : '')}
        style={{ '--accent': meta.color, '--soft': meta.soft, '--ink': meta.ink } as CSSProperties}
      >
        <span className="bd-date">
          <b>{dd}</b>
          {MONTHS[mm - 1]}
        </span>
        <button type="button" className="bd-who" onClick={() => onOpen(p.id)}>
          <Avatar person={p} size={36} />
          <span>
            <strong>{p.name}</strong>
            <small>{age !== null ? `Cumple ${age}` : meta.label}</small>
          </span>
        </button>
        <span className="bd-when">
          {d === 0 ? (
            <>
              <PartyPopper size={13} /> Hoy
            </>
          ) : d === 1 ? (
            'Mañana'
          ) : (
            `En ${d} días`
          )}
        </span>
        <span className="bd-actions">
          {digits && (
            <a
              href={`https://wa.me/${digits}?text=${encodeURIComponent(`¡Feliz cumpleaños, ${first}! 🎉`)}`}
              target="_blank"
              rel="noreferrer"
              title={`Felicitar a ${first} por WhatsApp`}
              aria-label={`Felicitar a ${first}`}
            >
              <MessageCircle size={15} />
            </a>
          )}
          <button
            type="button"
            title="Recordármelo"
            aria-label={`Recordarme el cumpleaños de ${first}`}
            onClick={() => {
              onClose();
              openEntry('Pendiente', [p.id], { due: addDays(date, -1) });
            }}
          >
            <BellPlus size={15} />
          </button>
        </span>
      </li>
    );
  };

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="pk bd" role="dialog" aria-modal="true" aria-label="Próximos cumpleaños">
        <header className="bd-head">
          <span className="bd-icon">
            <Cake size={20} />
          </span>
          <div>
            <h3>Próximos cumpleaños</h3>
            <p>
              {soon.length
                ? `${soon.length} en los próximos 30 días`
                : 'Nadie cumple años en los próximos 30 días'}
            </p>
          </div>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="bd-scroll">
          {soon.length > 0 && <ul className="bd-list">{soon.map((x) => row(x))}</ul>}
          {later.length > 0 && (
            <>
              <span className="pp-dropdown-label">Más adelante</span>
              <ul className="bd-list">{later.map((x) => row(x, true))}</ul>
            </>
          )}
          {!all.length && (
            <p className="pp-empty bd-empty">
              Aún no guardas cumpleaños. Empieza por alguien cercano.
            </p>
          )}
        </div>
        {missing.length > 0 && (
          <footer className="bd-foot">
            <span>
              {missing.length} {missing.length === 1 ? 'persona' : 'personas'} sin fecha
            </span>
            <button
              type="button"
              className="pp-text-btn"
              onClick={() => {
                onClose();
                editPerson(missing[0], 'fechas');
              }}
            >
              <CalendarPlus size={14} /> Añadir la de {missing[0].name.split(' ')[0]}
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
