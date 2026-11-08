import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarPlus,
  Check,
  Copy,
  CopyCheck,
  History,
  Mail,
  MessageCircle,
  Send,
  UserRound,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry, Group, Person } from '../data';
import { isInteraction, isReachable, relativeDay } from '../lib/people';
import { todayInputValue } from '../lib/format';
import { Avatar } from '../people/Avatar';
import { groupMeta, groupVars } from './GroupPicker';
import './groups.css';

const digitsOf = (phone?: string) => (phone ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '');
const firstName = (p: Person) => p.name.split(' ')[0];

/** Miembros que siguen existiendo. */
export function membersOf(group: Group, people: Person[]) {
  const byId = new Map(people.map((p) => [p.id, p]));
  return group.member_ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/**
 * La última vez que estuvieron juntos: el recuerdo más reciente con al menos la mitad del grupo
 * (y nunca menos de dos personas).
 */
export function lastTogether(group: Group, people: Person[], entries: Entry[]): Entry | null {
  const ids = new Set(membersOf(group, people).map((p) => p.id));
  if (ids.size < 2) return null;
  const need = Math.max(2, Math.ceil(ids.size / 2));
  const today = todayInputValue();
  let best: Entry | null = null;
  for (const e of entries) {
    if (!isInteraction(e) || todayInputValue(new Date(e.created_at)) > today) continue;
    if (best && e.created_at <= best.created_at) continue;
    let n = 0;
    for (const id of new Set(e.person_ids)) if (ids.has(id)) n++;
    if (n >= need) best = e;
  }
  return best;
}

/**
 * Acciones para todo un grupo: escribirles, planear un encuentro y la última vez que los viste
 * juntos. `compact`: solo íconos (en la lista de grupos).
 */
export function GroupActions({
  group,
  compact = false,
  onLeave,
}: {
  group: Group;
  compact?: boolean;
  /** Se llama antes de abrir otra ventana (p. ej. para cerrar la lista de grupos). */
  onLeave?: () => void;
}) {
  const { workspace, openEpisode, openEntry, viewEntry, experiencesMissing } = useApp();
  const [writing, setWriting] = useState(false);
  const members = membersOf(group, workspace.people);
  const reachable = members.filter(isReachable);
  const last = useMemo(
    () => lastTogether(group, workspace.people, workspace.entries),
    [group, workspace.people, workspace.entries],
  );

  const plan = () => {
    const ids = reachable.map((p) => p.id);
    onLeave?.();
    if (experiencesMissing) openEntry('Pendiente', ids);
    else
      openEpisode(undefined, {
        title: `Encuentro con ${group.name}`,
        kind: 'encuentro',
        status: 'activo',
        person_ids: ids,
      });
  };

  return (
    <div className={'ga' + (compact ? ' compact' : '')}>
      {!compact && (
        <button
          type="button"
          className="ga-last"
          disabled={!last}
          title={last ? last.title : undefined}
          onClick={() => {
            if (!last) return;
            onLeave?.();
            viewEntry(last);
          }}
        >
          <History size={14} />
          {last
            ? `Juntos ${relativeDay(todayInputValue(new Date(last.created_at))).toLowerCase()}`
            : 'Sin recuerdos juntos'}
        </button>
      )}
      <button
        type="button"
        className="ga-btn"
        disabled={!reachable.length}
        title="Escribirles a todos"
        aria-label={`Escribirles a todos en ${group.name}`}
        onClick={() => setWriting(true)}
      >
        <Send size={15} />
        {!compact && <span>Escribirles</span>}
      </button>
      <button
        type="button"
        className="ga-btn"
        disabled={!reachable.length}
        title="Planear un encuentro"
        aria-label={`Planear un encuentro con ${group.name}`}
        onClick={plan}
      >
        <CalendarPlus size={15} />
        {!compact && <span>Planear encuentro</span>}
      </button>
      {writing && <GroupMessage group={group} onClose={() => setWriting(false)} />}
    </div>
  );
}

/** Un mismo mensaje para todo el grupo: un WhatsApp por persona, un correo para todos o copiarlo. */
export function GroupMessage({ group, onClose }: { group: Group; onClose: () => void }) {
  const { workspace } = useApp();
  const [text, setText] = useState('');
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const m = groupMeta(group.kind);
  const members = membersOf(group, workspace.people).filter(isReachable);
  const emails = members.map((p) => p.profile.email?.trim()).filter(Boolean) as string[];
  const withPhone = members.filter((p) => digitsOf(p.profile.phone)).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // «{nombre}» se cambia por el nombre de cada persona.
  const forPerson = (p: Person) => text.replace(/\{nombre\}/gi, firstName(p));
  const generic = text.replace(/\{nombre\}\s*/gi, '').trim();

  const insertName = () => {
    const el = area.current;
    const at = el?.selectionStart ?? text.length;
    const next = text.slice(0, at) + '{nombre}' + text.slice(el?.selectionEnd ?? at);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + 8, at + 8);
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(generic);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* sin permiso para el portapapeles */
    }
  };

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop ga-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className="pk gmsg"
        role="dialog"
        aria-modal="true"
        aria-label={`Escribir a ${group.name}`}
        style={groupVars(group.kind)}
      >
        <header className="pk-head gp-head">
          <span className="pk-tile">
            <m.icon size={17} />
          </span>
          <div>
            <h3>{group.name}</h3>
            <small>
              {members.length} {members.length === 1 ? 'persona' : 'personas'}
            </small>
          </div>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="gmsg-compose">
          <textarea
            ref={area}
            autoFocus
            rows={3}
            maxLength={1500}
            value={text}
            placeholder="Escribe el mensaje…"
            aria-label="Mensaje"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="gmsg-name" onClick={insertName} title="Su nombre">
            <UserRound size={13} /> Nombre
          </button>
        </div>

        <ul className="gmsg-list">
          {members.map((p) => {
            const digits = digitsOf(p.profile.phone);
            const done = sent.has(p.id);
            return (
              <li key={p.id} className={done ? 'sent' : ''}>
                <Avatar person={p} size={30} />
                <span className="gmsg-who">{p.name}</span>
                {digits ? (
                  <a
                    className="gmsg-wa"
                    href={`https://wa.me/${digits}${text.trim() ? '?text=' + encodeURIComponent(forPerson(p)) : ''}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`WhatsApp a ${firstName(p)}`}
                    onClick={() => setSent((s) => new Set(s).add(p.id))}
                  >
                    {done ? <Check size={15} /> : <MessageCircle size={15} />}
                  </a>
                ) : (
                  <span className="gmsg-none">—</span>
                )}
              </li>
            );
          })}
        </ul>

        <footer className="pk-foot">
          <span className="gm-hint">{withPhone ? `${sent.size} de ${withPhone}` : ''}</span>
          <button
            type="button"
            className="cp-btn ghost"
            disabled={!generic}
            onClick={() => void copy()}
          >
            {copied ? <CopyCheck size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar'}
          </button>
          {emails.length > 0 && (
            <a
              className="cp-btn cta"
              href={`mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(group.name)}&body=${encodeURIComponent(generic)}`}
            >
              <Mail size={15} /> Correo
            </a>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
