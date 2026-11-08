import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  Cake,
  Check,
  ClipboardCheck,
  Clock,
  Coffee,
  Hourglass,
  Layers,
  ListChecks,
  MessageCircle,
  MessageCircleQuestion,
  Settings2,
  Sparkles,
  Target,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../AppContext';
import {
  agendaFor,
  agendaKindLabels,
  defaultAgendaPrefs,
  discardKey,
  snoozeKey,
  type AgendaItem,
  type AgendaKind,
  type AgendaPrefs,
} from '../lib/agenda';
import { addDays, nextMonday, todayInputValue } from '../lib/format';
import { dismiss, undismiss, useDismissed } from '../relations/dismissed';
import { WeeklyAgendaCard } from '../weekly/WeeklyDigest';
import { ReviewAgendaCard } from './Review';
import './agenda.css';

const looks: Record<AgendaKind, { icon: LucideIcon; color: string; soft: string }> = {
  compromiso: { icon: ListChecks, color: '#c0674a', soft: '#f9e9e2' },
  espera: { icon: Hourglass, color: '#c48a2a', soft: '#fbf1dc' },
  seguimiento: { icon: MessageCircleQuestion, color: '#6b62b5', soft: '#eeebfa' },
  encuentro: { icon: Coffee, color: '#8a6fa8', soft: '#f0e9f6' },
  cierre: { icon: ClipboardCheck, color: '#8a6fa8', soft: '#f0e9f6' },
  cumple: { icon: Cake, color: '#c47a1e', soft: '#fdf0d9' },
  proyecto: { icon: Target, color: '#4d7b9d', soft: '#e3eef6' },
  episodio: { icon: Layers, color: '#3c9186', soft: '#dff2ef' },
  contacto: { icon: MessageCircle, color: '#5f8247', soft: '#eaf1e0' },
};

const STORAGE = 'nexo-agenda';
function loadPrefs(): AgendaPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as Partial<AgendaPrefs>;
    return {
      kinds: { ...defaultAgendaPrefs.kinds, ...(raw.kinds ?? {}) },
      max:
        typeof raw.max === 'number' ? Math.min(12, Math.max(3, raw.max)) : defaultAgendaPrefs.max,
    };
  } catch {
    return defaultAgendaPrefs;
  }
}

const whatsapp = (phone?: string) => {
  const digits = phone?.replace(/[^\d+]/g, '').replace(/^\+/, '');
  return digits ? `https://wa.me/${digits}` : null;
};

/**
 * Lo que merece tu atención hoy: pocas tarjetas, cada una con su motivo y una acción. Puedes
 * posponerlas o descartarlas, y elegir qué tipos ver.
 */
export function TodayAgenda() {
  const { workspace, notify } = useApp();
  const skip = useDismissed();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [settings, setSettings] = useState(false);
  const items = useMemo(() => agendaFor(workspace, prefs, skip), [workspace, prefs, skip]);
  useEffect(() => localStorage.setItem(STORAGE, JSON.stringify(prefs)), [prefs]);

  const today = todayInputValue();
  const raw = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  // «Sábado, 7 de noviembre» (solo la primera letra en mayúscula).
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);

  const snooze = (item: AgendaItem, until: string, when: string) => {
    const k = snoozeKey(item.id, until);
    dismiss(k);
    notify(`Pospuesto hasta ${when}.`, { label: 'Deshacer', run: () => undismiss(k) });
  };
  const discard = (item: AgendaItem) => {
    const k = discardKey(item.id);
    dismiss(k);
    notify('Tarjeta descartada.', { label: 'Deshacer', run: () => undismiss(k) });
  };

  return (
    <section className="ag" aria-label="Hoy">
      <header className="ag-head">
        <div>
          <span className="ag-eyebrow">
            <Sparkles size={13} /> Qué merece tu atención
          </span>
          <h2>
            Hoy <small>{label}</small>
          </h2>
        </div>
        <button
          type="button"
          className="pp-icon-btn"
          aria-label="Elegir qué aparece"
          aria-expanded={settings}
          onClick={() => setSettings((v) => !v)}
        >
          <Settings2 size={17} />
        </button>
      </header>

      {settings && (
        <div className="ag-settings">
          <strong>Qué quieres ver aquí</strong>
          <div className="ag-toggles">
            {(Object.keys(agendaKindLabels) as AgendaKind[]).map((k) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={prefs.kinds[k]}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, kinds: { ...p.kinds, [k]: e.target.checked } }))
                  }
                />
                {agendaKindLabels[k]}
              </label>
            ))}
          </div>
          <label className="ag-max">
            Máximo de tarjetas
            <select
              value={prefs.max}
              onChange={(e) => setPrefs((p) => ({ ...p, max: Number(e.target.value) }))}
            >
              {[3, 4, 6, 8, 10, 12].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <small>
            La prioridad combina la fecha, la importancia que elegiste y si es una promesa o alguien
            cercano.
          </small>
        </div>
      )}

      {/* Repaso de lecturas y periódico semanal: se muestran solo cuando tocan. */}
      <div className="ag-list ag-extra">
        <WeeklyAgendaCard />
        <ReviewAgendaCard />
      </div>
      {items.length ? (
        <div className="ag-list">
          {items.map((item) => (
            <AgendaCard
              key={item.id}
              item={item}
              onSnooze={(until, when) => snooze(item, until, when)}
              onDiscard={() => discard(item)}
              today={today}
            />
          ))}
        </div>
      ) : (
        <div className="ag-empty">
          <Check size={20} />
          <div>
            <strong>Nada urgente por hoy.</strong>
            <span>
              Cuando prometas algo, esperes una respuesta o se acerque un encuentro, aparecerá aquí.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function AgendaCard({
  item,
  onSnooze,
  onDiscard,
  today,
}: {
  item: AgendaItem;
  onSnooze: (until: string, when: string) => void;
  onDiscard: () => void;
  today: string;
}) {
  const { toggleEntry, patchPerson, openBrief, go, editEntry, peekPerson } = useApp();
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [menu]);
  const look = looks[item.kind];
  const wa =
    item.person && !item.person.profile.status ? whatsapp(item.person.profile.phone) : null;

  const primary = (): { label: string; run: () => void } | null => {
    switch (item.action) {
      case 'completar':
        return item.entry
          ? {
              label: item.kind === 'espera' ? 'Ya llegó' : 'Hecho',
              run: () => toggleEntry(item.entry!),
            }
          : null;
      case 'preguntado':
        return item.person && item.update
          ? {
              label: 'Ya le pregunté',
              run: () => {
                const p = item.person!;
                void patchPerson(
                  p,
                  {
                    profile: {
                      ...p.profile,
                      updates: (p.profile.updates ?? []).map((u) =>
                        u.id === item.update!.id ? { ...u, done: true } : u,
                      ),
                    },
                  },
                  true,
                );
              },
            }
          : null;
      case 'preparar':
        return item.person
          ? { label: 'Preparar', run: () => openBrief(item.person!, 'antes', item.entry) }
          : null;
      case 'cerrar':
        return item.person
          ? { label: 'Cerrar en 30 s', run: () => openBrief(item.person!, 'despues', item.entry) }
          : null;
      case 'abrir':
        return item.episode
          ? { label: 'Abrir episodio', run: () => go('Episodios', item.episode!) }
          : null;
      case 'paso':
        return item.entry
          ? { label: 'Definir próximo paso', run: () => editEntry(item.entry!) }
          : null;
      case 'escribir':
        return item.person
          ? {
              label: wa ? 'Escribirle' : 'Ver ficha',
              run: () => (wa ? window.open(wa, '_blank', 'noopener') : peekPerson(item.person!)),
            }
          : null;
      case 'recordar':
        return item.person ? { label: 'Recordar', run: () => peekPerson(item.person!) } : null;
    }
  };
  const act = primary();

  return (
    <div
      className="ag-card"
      style={{ '--c': look.color, '--s': look.soft } as CSSProperties}
      ref={root}
    >
      <span className="ag-icon">
        <look.icon size={17} />
      </span>
      <div className="ag-main">
        <strong>{item.title}</strong>
        <p>{item.detail}</p>
        <div className="ag-why" title="Por qué aparece">
          {item.why.map((w) => (
            <i key={w}>{w}</i>
          ))}
        </div>
      </div>
      <div className="ag-actions">
        {act && (
          <button type="button" className="ag-primary" onClick={act.run}>
            {act.label} <ArrowRight size={13} />
          </button>
        )}
        <div className="ag-minor">
          {item.person && item.action !== 'escribir' && item.action !== 'recordar' && (
            <button
              type="button"
              title={`Ver a ${item.person.name}`}
              onClick={() => peekPerson(item.person!)}
            >
              {item.person.name.split(' ')[0]}
            </button>
          )}
          <button
            type="button"
            aria-label="Posponer"
            title="Posponer"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <Clock size={14} />
          </button>
          <button type="button" aria-label="Descartar" title="Descartar" onClick={onDiscard}>
            <X size={14} />
          </button>
        </div>
        {menu && (
          <div className="ag-menu" role="menu">
            <button role="menuitem" onClick={() => onSnooze(addDays(today, 1), 'mañana')}>
              Hasta mañana
            </button>
            <button role="menuitem" onClick={() => onSnooze(addDays(today, 3), 'dentro de 3 días')}>
              3 días
            </button>
            <button role="menuitem" onClick={() => onSnooze(nextMonday(today), 'el lunes')}>
              Hasta el lunes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
