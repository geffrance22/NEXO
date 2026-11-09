import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Check, ChevronDown, Plus, X, type LucideIcon } from 'lucide-react';
import type { Check as CheckItem } from '../planner/shared';
import { noteColors } from './palette';

/** Área de texto que crece con lo que escribes (sin barra de desplazamiento). */
export function AutoText({
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} {...props} />;
}

/**
 * Botón de ícono con un menú flotante. Se cierra al tocar fuera o con Esc (sin cerrar la ventana
 * que lo contiene).
 */
export function Pop({
  icon: Icon,
  label,
  align = 'start',
  children,
}: {
  icon: LucideIcon;
  label: string;
  align?: 'start' | 'end';
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    <div className={'kp-pop-wrap' + (open ? ' open' : '')} ref={ref}>
      <IconButton
        icon={Icon}
        label={label}
        pressed={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      />
      {open && (
        <div className={'kp-pop ' + align} role="menu" onClick={(e) => e.stopPropagation()}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function IconButton({
  icon: Icon,
  label,
  pressed,
  onClick,
  className = '',
  size = 16,
}: {
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  onClick: (e: ReactMouseEvent) => void;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      className={'kp-ic ' + className}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon size={size} />
    </button>
  );
}

/** Paleta de colores de nota. */
export function Swatches({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  return (
    <div className="kp-swatches" role="group" aria-label="Color de la nota">
      {noteColors.map((c) => (
        <button
          key={c.id}
          type="button"
          className={'kp-sw' + (value === c.id ? ' on' : '') + (c.id === 'linen' ? ' none' : '')}
          style={{ background: c.bg }}
          title={c.name}
          aria-label={c.name}
          aria-pressed={value === c.id}
          onClick={() => onPick(c.id)}
        >
          {value === c.id && <Check size={13} />}
        </button>
      ))}
    </div>
  );
}

/**
 * Lista de verificación al estilo Keep: escribe en «Elemento de lista» y se crea el punto; Enter
 * abre otro debajo; Retroceso en un punto vacío lo borra. Los marcados bajan a su propio grupo.
 */
export function CheckEditor({
  checks,
  onChange,
}: {
  checks: CheckItem[];
  onChange: (next: CheckItem[]) => void;
}) {
  const refs = useRef(new Map<string, HTMLInputElement>());
  const [focus, setFocus] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(true);
  useEffect(() => {
    if (!focus) return;
    const el = refs.current.get(focus);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    setFocus(null);
  }, [focus, checks]);

  const open = checks.filter((c) => !c.done);
  const done = checks.filter((c) => c.done);
  const update = (id: string, p: Partial<CheckItem>) =>
    onChange(checks.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const insertAfter = (id: string) => {
    const item = { id: crypto.randomUUID(), text: '', done: false };
    const next = [...checks];
    next.splice(checks.findIndex((c) => c.id === id) + 1, 0, item);
    onChange(next);
    setFocus(item.id);
  };
  const drop = (id: string) => {
    const i = open.findIndex((c) => c.id === id);
    onChange(checks.filter((c) => c.id !== id));
    const prev = open[i - 1];
    if (prev) setFocus(prev.id);
  };

  const row = (c: CheckItem) => (
    <div key={c.id} className={'kp-ci' + (c.done ? ' done' : '')}>
      <input
        type="checkbox"
        checked={c.done}
        aria-label={c.done ? 'Desmarcar' : 'Marcar'}
        onChange={() => update(c.id, { done: !c.done })}
      />
      <input
        ref={(el) => {
          if (el) refs.current.set(c.id, el);
          else refs.current.delete(c.id);
        }}
        className="kp-ci-text"
        value={c.text}
        maxLength={500}
        onChange={(e) => update(c.id, { text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            insertAfter(c.id);
          } else if (e.key === 'Backspace' && !c.text) {
            e.preventDefault();
            drop(c.id);
          }
        }}
      />
      <button
        type="button"
        className="kp-ci-x"
        aria-label="Quitar elemento"
        onClick={() => onChange(checks.filter((x) => x.id !== c.id))}
      >
        <X size={14} />
      </button>
    </div>
  );

  return (
    <div className="kp-checks">
      {open.map(row)}
      <div className="kp-ci add">
        <Plus size={16} />
        <input
          className="kp-ci-text"
          placeholder="Elemento de lista"
          value=""
          onChange={(e) => {
            const item = {
              id: crypto.randomUUID(),
              text: e.target.value,
              done: false,
            };
            onChange([...checks, item]);
            setFocus(item.id);
          }}
        />
      </div>
      {done.length > 0 && (
        <>
          <button
            type="button"
            className={'kp-done-toggle' + (showDone ? ' on' : '')}
            onClick={() => setShowDone((s) => !s)}
          >
            <ChevronDown size={15} />
            {done.length === 1 ? '1 elemento marcado' : `${done.length} elementos marcados`}
          </button>
          {showDone && done.map(row)}
        </>
      )}
    </div>
  );
}

/** Etiquetas como fichas: Enter o coma para añadir, Retroceso para quitar la última. */
export function TagEditor({
  tags,
  onChange,
  suggestions,
  autoFocus,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').slice(0, 60);
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...tags, t]);
    setText('');
  };
  const listId = 'kp-tags-' + useRef(Math.random().toString(36).slice(2)).current;
  return (
    <div className="kp-tags-edit">
      {tags.map((t) => (
        <span key={t} className="kp-tag">
          #{t}
          <button
            type="button"
            aria-label={`Quitar ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        list={listId}
        autoFocus={autoFocus}
        value={text}
        placeholder={tags.length ? 'Otra etiqueta…' : 'Añade una etiqueta…'}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(',')) add(v.slice(0, -1));
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !tags.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
