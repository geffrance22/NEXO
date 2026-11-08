import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { AtSign, Check, Highlighter, MapPin, Strikethrough, Type } from 'lucide-react';
import { renderRich } from '../components/RichText';

export type RichActions = {
  person?: (text: string) => boolean | void;
  place?: (text: string) => boolean | void;
  title?: (text: string) => void;
};

type Selection = { start: number; end: number; x: number; y: number };

/** Posición en pantalla del carácter `index` de un textarea (para selecciones con teclado). */
function caretPoint(ta: HTMLTextAreaElement, index: number) {
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  const props = [
    'boxSizing',
    'width',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
  ] as const;
  for (const p of props) div.style[p] = cs[p];
  Object.assign(div.style, {
    position: 'absolute',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    top: '0',
    left: '-9999px',
    borderStyle: 'solid',
  });
  div.textContent = ta.value.slice(0, index);
  const span = document.createElement('span');
  span.textContent = '\u200b';
  div.appendChild(span);
  document.body.appendChild(div);
  const r = ta.getBoundingClientRect();
  const point = { x: r.left + span.offsetLeft, y: r.top + span.offsetTop - ta.scrollTop };
  div.remove();
  return point;
}

/**
 * Área de texto que crece sola y entiende marcas: al seleccionar texto aparece, junto al puntero,
 * una barra para resaltar, tachar, vincular a una persona, marcar el lugar o usarlo como título.
 * Detrás del textarea hay un «espejo» que dibuja los resaltados con el mismo tamaño de letra.
 */
export function RichTextarea({
  value,
  onChange,
  className,
  placeholder,
  minRows = 3,
  names = [],
  actions = {},
  autoFocusTarget = false,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  minRows?: number;
  /** Nombres de las personas vinculadas: se resaltan en el texto. */
  names?: string[];
  actions?: RichActions;
  autoFocusTarget?: boolean;
  label: string;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [flash, setFlash] = useState('');
  const pendingSelection = useRef<[number, number] | null>(null);

  // Crece con el contenido (el espejo ocupa el mismo alto).
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    if (pendingSelection.current) {
      const [s, e] = pendingSelection.current;
      pendingSelection.current = null;
      el.setSelectionRange(s, e);
    }
  }, [value]);

  useEffect(() => {
    if (!sel) return;
    const hide = () => setSel(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [sel]);

  const read = (point?: { x: number; y: number }) => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end || !el.value.slice(start, end).trim()) return setSel(null);
    const p = point ?? caretPoint(el, start);
    setSel({ start, end, x: p.x, y: p.y });
  };

  /** Reemplaza un tramo conservando el «deshacer» del navegador. */
  const replace = (from: number, to: number, text: string, select: [number, number]) => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(from, to);
    pendingSelection.current = select;
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      el.setRangeText(text, from, to, 'end');
      onChange(el.value);
    }
  };

  const toggle = (marker: '==' | '~~') => {
    if (!sel) return;
    const { start, end } = sel;
    const v = value;
    const inner = v.slice(start, end);
    if (v.slice(start - 2, start) === marker && v.slice(end, end + 2) === marker) {
      replace(start - 2, end + 2, inner, [start - 2, end - 2]);
    } else if (inner.length >= 4 && inner.startsWith(marker) && inner.endsWith(marker)) {
      replace(start, end, inner.slice(2, -2), [start, end - 4]);
    } else {
      // Cada línea por separado: las marcas no cruzan saltos de línea.
      const wrapped = inner
        .split('\n')
        .map((line) => {
          const t = line.trim();
          if (!t) return line;
          const lead = line.slice(0, line.indexOf(t));
          return lead + marker + t + marker + line.slice(lead.length + t.length);
        })
        .join('\n');
      replace(start, end, wrapped, [start + 2, start + wrapped.length - 2]);
    }
    setSel(null);
  };

  const run = (fn: ((text: string) => boolean | void) | undefined, done: string) => {
    if (!sel || !fn) return;
    const text = value.slice(sel.start, sel.end).replace(/==|~~/g, '').trim();
    const linked = fn(text);
    setSel(null);
    if (linked !== false) {
      setFlash(done);
      window.setTimeout(() => setFlash(''), 1400);
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    const point = { x: e.clientX, y: e.clientY };
    window.setTimeout(() => read(point), 0);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.shiftKey || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) read();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && sel) {
      e.stopPropagation();
      setSel(null);
    }
  };

  const left = sel ? Math.min(Math.max(sel.x, 160), window.innerWidth - 160) : 0;
  const above = sel ? sel.y > 70 : true;
  const tools = [
    actions.person && {
      key: 'p',
      icon: AtSign,
      label: 'Persona',
      onClick: () => run(actions.person, 'Persona vinculada'),
    },
    { key: 'h', icon: Highlighter, label: 'Resaltar', onClick: () => toggle('==') },
    { key: 's', icon: Strikethrough, label: 'Tachar', onClick: () => toggle('~~') },
    actions.place && {
      key: 'l',
      icon: MapPin,
      label: 'Lugar',
      onClick: () => run(actions.place, 'Lugar asignado'),
    },
    actions.title && {
      key: 't',
      icon: Type,
      label: 'Título',
      onClick: () => run(actions.title, 'Título actualizado'),
    },
  ].filter(Boolean) as { key: string; icon: typeof AtSign; label: string; onClick: () => void }[];

  return (
    <div className="rt">
      <div className={'rt-mirror ' + className} aria-hidden="true">
        {renderRich(value, { names, showMarkers: true })}
        {'\u200b'}
      </div>
      <textarea
        ref={ta}
        className={className}
        rows={minRows}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        data-autofocus={autoFocusTarget || undefined}
        onChange={(e) => {
          setSel(null);
          onChange(e.target.value);
        }}
        onMouseUp={onMouseUp}
        onKeyUp={onKeyUp}
        onKeyDown={onKeyDown}
        onBlur={() => window.setTimeout(() => setSel(null), 120)}
      />
      {flash && (
        <span className="rt-flash" role="status">
          <Check size={13} /> {flash}
        </span>
      )}
      {sel &&
        createPortal(
          <div
            className={'rt-bar' + (above ? '' : ' below')}
            style={{ left, top: above ? sel.y - 12 : sel.y + 26 }}
            role="toolbar"
            aria-label="Opciones para el texto seleccionado"
            onMouseDown={(e) => e.preventDefault()}
          >
            {tools.map((t) => (
              <button type="button" key={t.key} onClick={t.onClick} title={t.label}>
                <t.icon size={15} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
