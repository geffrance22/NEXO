import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, CalendarClock, Moon, Sun, Sunrise } from 'lucide-react';
import { supabase } from '../backend';
import { useApp } from '../AppContext';
import { plainOf } from './links';
import { NOTES_CHANGED, NOTES_TOUCHED } from './useNotes';

const pad = (n: number) => String(n).padStart(2, '0');
const at = (d: Date, h: number, m = 0) => {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** «Hoy, 18:00», «Mañana, 08:00», «lun 16 nov, 08:00». */
export function reminderLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const k = dayKey(d);
  if (k === dayKey(now)) return `Hoy, ${time(d)}`;
  if (k === dayKey(addDays(now, 1))) return `Mañana, ${time(d)}`;
  if (k === dayKey(addDays(now, -1))) return `Ayer, ${time(d)}`;
  const date = d.toLocaleDateString('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${date.replace(/\./g, '')}, ${time(d)}`;
}
export const isDue = (iso: string | null, now = Date.now()) =>
  Boolean(iso && Date.parse(iso) <= now);

/** Pide permiso para avisos del sistema la primera vez que pones un recordatorio. */
export function askNotifications() {
  if ('Notification' in window && Notification.permission === 'default')
    void Notification.requestPermission().catch(() => undefined);
}

/** Atajos para «Recordármelo», más una fecha y hora a tu gusto. */
export function ReminderMenu({
  value,
  onPick,
  close,
}: {
  value: string | null;
  onPick: (iso: string | null) => void;
  close: () => void;
}) {
  const now = new Date();
  const tomorrow = addDays(now, 1);
  const monday = addDays(now, (8 - now.getDay()) % 7 || 7);
  const presets = [
    now.getHours() < 17 && {
      label: 'Más tarde hoy',
      when: at(now, 18),
      icon: Sun,
    },
    now.getHours() >= 17 &&
      now.getHours() < 20 && {
        label: 'Esta noche',
        when: at(now, 21),
        icon: Moon,
      },
    { label: 'Mañana', when: at(tomorrow, 8), icon: Sunrise },
    { label: 'La próxima semana', when: at(monday, 8), icon: CalendarClock },
  ].filter(Boolean) as { label: string; when: Date; icon: typeof Sun }[];
  const initial = value ? new Date(value) : at(tomorrow, 8);
  const [date, setDate] = useState(dayKey(initial));
  const [clock, setClock] = useState(time(initial));
  const pick = (d: Date | null) => {
    if (d) askNotifications();
    onPick(d ? d.toISOString() : null);
    close();
  };
  const custom = new Date(`${date}T${clock || '08:00'}`);
  const valid = !Number.isNaN(custom.getTime());

  return (
    <div className="kp-menu kp-remind">
      <p>Recordármelo</p>
      {presets.map((p) => (
        <button type="button" key={p.label} onClick={() => pick(p.when)}>
          <p.icon size={14} /> {p.label}
          <small>{reminderLabel(p.when.toISOString(), now).replace(/^(Hoy|Mañana), /, '')}</small>
        </button>
      ))}
      <form
        className="kp-remind-pick"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) pick(custom);
        }}
      >
        <input
          type="date"
          aria-label="Fecha"
          value={date}
          min={dayKey(now)}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          type="time"
          aria-label="Hora"
          value={clock}
          onChange={(e) => setClock(e.target.value)}
        />
        <button type="submit" className="kp-remind-save" disabled={!valid}>
          Guardar
        </button>
      </form>
      {value && (
        <button type="button" className="danger" onClick={() => pick(null)}>
          <BellOff size={14} /> Quitar recordatorio
        </button>
      )}
    </div>
  );
}

/** Ficha pequeña con el recordatorio de una nota (en rojo si ya pasó). */
export function ReminderChip({ iso, onClear }: { iso: string; onClear?: () => void }) {
  return (
    <span className={'kp-meta-chip kp-bell' + (isDue(iso) ? ' due' : '')} title="Recordatorio">
      <Bell size={11} /> {reminderLabel(iso)}
      {onClear && (
        <button type="button" aria-label="Quitar recordatorio" onClick={onClear}>
          ×
        </button>
      )}
    </span>
  );
}

type Due = {
  id: string;
  title: string;
  body: string;
  vaulted?: boolean;
  remind_at: string;
};
const FIRED_KEY = 'nexo-note-reminders-fired';
const readFired = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
};
const saveFired = (map: Record<string, string>) => {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(map));
  } catch {
    /* Sin almacenamiento: puede repetirse el aviso al recargar. */
  }
};

/**
 * Vigila los recordatorios de las notas mientras Nexo está abierto: a su hora muestra un aviso (y
 * una notificación del sistema si la permitiste). Cada recordatorio avisa una sola vez. Las notas de
 * la bóveda avisan sin mostrar su contenido.
 */
export function NoteReminders() {
  const { go, notify } = useApp();
  const [list, setList] = useState<Due[]>([]);
  const [rev, setRev] = useState(0);
  const nav = useRef({ go, notify });
  nav.current = { go, notify };

  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await supabase
        .from('quick_notes')
        .select('id,title,body,vaulted,remind_at')
        .not('remind_at', 'is', null)
        .eq('archived', false)
        .limit(500);
      if (!live || r.error) return; // Sin la migración no hay recordatorios.
      setList((r.data ?? []) as Due[]);
    };
    void load();
    return () => {
      live = false;
    };
  }, [rev]);

  useEffect(() => {
    const reload = () => setRev((v) => v + 1);
    window.addEventListener(NOTES_TOUCHED, reload);
    window.addEventListener(NOTES_CHANGED, reload);
    const slow = window.setInterval(reload, 10 * 60_000);
    return () => {
      window.removeEventListener(NOTES_TOUCHED, reload);
      window.removeEventListener(NOTES_CHANGED, reload);
      window.clearInterval(slow);
    };
  }, []);

  useEffect(() => {
    if (!list.length) return;
    const check = () => {
      const fired = readFired();
      const now = Date.now();
      const due = list.filter((n) => isDue(n.remind_at, now) && fired[n.id] !== n.remind_at);
      if (!due.length) return;
      for (const n of due) fired[n.id] = n.remind_at;
      // Olvida los avisos de notas que ya no tienen recordatorio.
      const alive = new Set(list.map((n) => n.id));
      for (const id of Object.keys(fired)) if (!alive.has(id)) delete fired[id];
      saveFired(fired);

      const first = due[0];
      const name = first.vaulted
        ? 'una nota de tu bóveda'
        : `«${(first.title || plainOf(first.body).split('\n')[0] || 'Nota').slice(0, 80)}»`;
      const text =
        due.length === 1
          ? `Recordatorio: ${name}`
          : `Tienes ${due.length} recordatorios de notas, empezando por ${name}.`;
      const open = () => nav.current.go('Libroteca', { id: first.id });
      nav.current.notify(text, { label: 'Abrir', icon: 'open', run: open });
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('Nexo · Recordatorio', {
            body: text.replace(/^Recordatorio: /, ''),
            tag: 'nexo-note-' + first.id,
            icon: '/nexo-favicon.svg',
          });
          n.onclick = () => {
            window.focus();
            open();
            n.close();
          };
        } catch {
          /* Algunos navegadores solo permiten notificaciones desde un service worker. */
        }
      }
    };
    check();
    const t = window.setInterval(check, 20_000);
    return () => window.clearInterval(t);
  }, [list]);

  return null;
}
