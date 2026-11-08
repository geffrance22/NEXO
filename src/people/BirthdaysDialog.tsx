import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  BellPlus,
  Cake,
  CalendarPlus,
  Flower2,
  Gift,
  MessageCircle,
  PartyPopper,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { addDays, todayInputValue } from '../lib/format';
import { ageOf, daysToBirthday, relationMeta, relationOf } from '../lib/people';
import { Avatar } from './Avatar';
import { GiftIdeas } from './GiftIdeas';

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
  // Ideas de regalo abiertas encima (para quién).
  const [gift, setGift] = useState<{ id: string; turns: number | null; date: string } | null>(null);
  const giftOpen = useRef(false);
  giftOpen.current = Boolean(gift);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // Esc cierra primero las ideas de regalo; luego, los cumpleaños.
      if (giftOpen.current) setGift(null);
      else closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const today = todayInputValue();
  const all = useMemo(
    () =>
      workspace.people
        .filter((p) => p.profile.status !== 'distante')
        .map((p) => ({ p, d: daysToBirthday(p, today) }))
        .filter((x): x is { p: (typeof workspace.people)[number]; d: number } => x.d !== null)
        .sort((a, b) => a.d - b.d),
    [workspace.people, today],
  );
  const soon = all.filter((x) => x.d <= 30);
  const later = all.filter((x) => x.d > 30).slice(0, 4);
  const missing = workspace.people.filter((p) => !p.profile.birthday && !p.profile.status);
  const giftPerson = gift ? workspace.people.find((p) => p.id === gift.id) : undefined;

  const row = ({ p, d }: (typeof all)[number], dim = false) => {
    const meta = relationMeta[relationOf(p)];
    const date = addDays(today, d);
    const age = ageOf(p, date);
    const [mm, dd] = (p.profile.birthday ?? '01-01').split('-').map(Number);
    // Quien ya no está: se recuerda la fecha, sin felicitar ni regalar.
    const memory = p.profile.status === 'memoria';
    const digits = memory ? '' : (p.profile.phone ?? '').replace(/\D/g, '');
    const first = p.name.split(' ')[0];
    return (
      <li
        key={p.id}
        className={
          'bday-row' + (d === 0 ? ' today' : '') + (dim ? ' dim' : '') + (memory ? ' memory' : '')
        }
        style={{ '--accent': meta.color, '--soft': meta.soft, '--ink': meta.ink } as CSSProperties}
      >
        <span className="bday-date">
          <b>{dd}</b>
          {MONTHS[mm - 1]}
        </span>
        <button type="button" className="bday-who" onClick={() => onOpen(p.id)}>
          <Avatar person={p} size={36} />
          <span>
            <strong>{p.name}</strong>
            <small>
              {memory
                ? age !== null
                  ? `Habría cumplido ${age}`
                  : 'En su memoria'
                : age !== null
                  ? `Cumple ${age}`
                  : meta.label}
            </small>
          </span>
        </button>
        <span className="bday-when">
          {d === 0 ? (
            <>{memory ? <Flower2 size={13} /> : <PartyPopper size={13} />} Hoy</>
          ) : d === 1 ? (
            'Mañana'
          ) : (
            `En ${d} días`
          )}
        </span>
        <span className="bday-actions">
          {!memory && (
            <button
              type="button"
              className="gift"
              title="Ideas de regalo"
              aria-label={`Ideas de regalo para ${first}`}
              onClick={() => setGift({ id: p.id, turns: age, date })}
            >
              <Gift size={15} />
            </button>
          )}
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
              openEntry('Pendiente', [p.id], { due: memory ? date : addDays(date, -1) });
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
      <div className="pk bday" role="dialog" aria-modal="true" aria-label="Próximos cumpleaños">
        <header className="bday-head">
          <span className="bday-icon">
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
        <div className="bday-scroll">
          {soon.length > 0 && <ul className="bday-list">{soon.map((x) => row(x))}</ul>}
          {later.length > 0 && (
            <>
              <span className="bday-label">Más adelante</span>
              <ul className="bday-list">{later.map((x) => row(x, true))}</ul>
            </>
          )}
          {!all.length && (
            <p className="pp-empty bday-empty">
              Aún no guardas cumpleaños. Empieza por alguien cercano.
            </p>
          )}
        </div>
        {missing.length > 0 && (
          <footer className="bday-foot">
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
      {gift && giftPerson && (
        <GiftIdeas
          key={giftPerson.id}
          person={giftPerson}
          birthday={{ turns: gift.turns, date: gift.date }}
          onClose={() => setGift(null)}
        />
      )}
    </div>,
    document.body,
  );
}
