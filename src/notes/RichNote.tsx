import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Bold,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  RemoveFormatting,
  Sparkles,
  Strikethrough,
  Type,
  Underline,
  X,
  type LucideIcon,
} from 'lucide-react';
import { diff, type TextHistory } from '../composer/useTextHistory';
import { editorToMd, htmlToMd, inlineEditorHtml, toEditorHtml } from './richText';

/*
 * Editor de texto con formato al estilo Keep: lo que ves es lo que queda (sin asteriscos a la
 * vista), pero se guarda como texto plano con marcas (ver marks.ts). Deshacer y rehacer
 * (Ctrl + Z / Ctrl + Y y las flechas de la barra) usan un historial propio de la nota.
 */

export type FormatCommand =
  'bold' | 'italic' | 'underline' | 'strike' | 'h1' | 'h2' | 'text' | 'ul' | 'ol' | 'clear';

type FormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  block: 'h1' | 'h2' | 'text' | 'ul' | 'ol';
};
const NONE: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  block: 'text',
};

type Bubble = { x: number; y: number; below: boolean };

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? '⌘' : 'Ctrl+';
const SHIFT = MAC ? '⇧' : 'Shift+';

const TOOLS: Record<FormatCommand, { icon: LucideIcon; label: string; keys?: string }> = {
  h1: { icon: Heading1, label: 'Título', keys: '# + espacio' },
  h2: { icon: Heading2, label: 'Subtítulo', keys: '## + espacio' },
  text: { icon: Type, label: 'Texto normal' },
  bold: { icon: Bold, label: 'Negrita', keys: MOD + 'B' },
  italic: { icon: Italic, label: 'Cursiva', keys: MOD + 'I' },
  underline: { icon: Underline, label: 'Subrayado', keys: MOD + 'U' },
  strike: { icon: Strikethrough, label: 'Tachado', keys: MOD + SHIFT + 'X' },
  ul: { icon: List, label: 'Viñetas', keys: '- + espacio' },
  ol: { icon: ListOrdered, label: 'Lista numerada', keys: '1. + espacio' },
  clear: { icon: RemoveFormatting, label: 'Quitar formato' },
};
const tip = (c: FormatCommand) =>
  TOOLS[c].keys ? `${TOOLS[c].label} (${TOOLS[c].keys})` : TOOLS[c].label;

const exec = (cmd: string, value?: string) => {
  try {
    return document.execCommand(cmd, false, value);
  } catch {
    return false;
  }
};
const queryState = (cmd: string) => {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
};

const LINE_TAGS = /^(DIV|P|H[1-6]|LI|BLOCKQUOTE|PRE)$/;

/** El bloque (línea) donde está el cursor, o el propio editor en la primera línea suelta. */
function blockOf(node: Node | null, root: HTMLElement): HTMLElement {
  let n: Node | null = node;
  while (n && n !== root) {
    if (n instanceof HTMLElement && LINE_TAGS.test(n.tagName)) return n;
    n = n.parentNode;
  }
  return root;
}

function blockKind(node: Node | null, root: HTMLElement): FormatState['block'] {
  let n: Node | null = node;
  while (n && n !== root) {
    if (n instanceof HTMLElement) {
      if (n.tagName === 'H1') return 'h1';
      if (/^H[2-6]$/.test(n.tagName)) return 'h2';
      if (n.tagName === 'UL') return 'ul';
      if (n.tagName === 'OL') return 'ol';
    }
    n = n.parentNode;
  }
  return 'text';
}

/** Texto desde el inicio de la línea hasta el cursor. */
function beforeCaret(block: HTMLElement, sel: Selection) {
  const r = document.createRange();
  r.setStart(block, 0);
  r.setEnd(sel.anchorNode!, sel.anchorOffset);
  return { range: r, text: r.toString() };
}

/** Ctrl/⌘+Z deshace; Ctrl/⌘+Shift+Z y Ctrl+Y rehacen. */
function historyShortcut(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  // Con teclados no latinos `key` no es una letra: se usa la posición física.
  const key = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^Key/, '').toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.metaKey) return 'redo';
  return null;
}

/** Deja el cursor al final de lo que cambió entre `before` y el contenido actual del editor. */
function caretAfterChange(el: HTMLElement, before: string) {
  const at = diff(before, el.textContent ?? '').endB;
  const sel = document.getSelection();
  if (!sel) return;
  el.focus({ preventScroll: true });
  const r = document.createRange();
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = at;
  let placed = false;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const len = n.textContent?.length ?? 0;
    if (left <= len) {
      r.setStart(n, left);
      placed = true;
      break;
    }
    left -= len;
  }
  if (!placed) {
    r.selectNodeContents(el);
    r.collapse(false);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  const target = r.startContainer;
  (target instanceof HTMLElement ? target : target.parentElement)?.scrollIntoView({
    block: 'nearest',
  });
}

/** Marca temporal (en una copia del editor) para saber en qué línea termina la selección. */
const PIN = '\uE010';

/**
 * Línea del texto guardado donde termina `range`, y cuántas líneas tiene el texto. Se mide en una
 * copia del editor: el de verdad no se toca.
 */
function lineOfRange(root: HTMLElement, range: Range): { line: number; lines: number } | null {
  // El último trozo de texto que de verdad quedó seleccionado (con un triple clic la selección
  // termina al principio de la línea siguiente).
  const scope = range.commonAncestorContainer;
  const texts: Text[] = [];
  if (scope instanceof Text) texts.push(scope);
  else {
    const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) texts.push(n as Text);
  }
  let last: Text | null = null;
  let offset = 0;
  for (const t of texts) {
    if (!t.data.trim() || !range.intersectsNode(t)) continue;
    const from = t === range.startContainer ? range.startOffset : 0;
    const to = t === range.endContainer ? range.endOffset : t.length;
    if (to <= from) continue;
    last = t;
    offset = to;
  }
  if (!last) return null;
  const path: number[] = [];
  let n: Node = last;
  while (n !== root) {
    const parent = n.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, n));
    n = parent;
  }
  const copy = root.cloneNode(true) as HTMLElement;
  let target: Node | undefined = copy;
  for (const i of path) target = target?.childNodes[i];
  if (!(target instanceof Text)) return null;
  target.data = target.data.slice(0, offset) + PIN + target.data.slice(offset);
  const md = editorToMd(copy);
  const at = md.indexOf(PIN);
  if (at < 0) return null;
  return { line: md.slice(0, at).split('\n').length - 1, lines: md.split('\n').length };
}

/** Lo seleccionado al tocar la IA: el texto, dónde está en pantalla y en qué línea termina. */
export type AskTarget = {
  quote: string;
  point: { x: number; y: number };
  found: { line: number; lines: number } | null;
};

export type RichEditor = ReturnType<typeof useRichEditor>;

/** Estado compartido entre el editor, la burbuja de la selección y la barra «Aa». */
export function useRichEditor() {
  const ref = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const dragging = useRef(false);
  const [state, setState] = useState<FormatState>(NONE);
  const [bubble, setBubble] = useState<Bubble | null>(null);

  const inside = (n: Node | null) => !!n && !!ref.current?.contains(n);

  const refresh = useCallback(() => {
    const el = ref.current;
    const sel = document.getSelection();
    if (!el || !sel?.rangeCount || !inside(sel.anchorNode)) {
      setBubble(null);
      return;
    }
    const range = sel.getRangeAt(0);
    saved.current = range.cloneRange();
    setState({
      bold: queryState('bold'),
      italic: queryState('italic'),
      underline: queryState('underline'),
      strike: queryState('strikeThrough'),
      block: blockKind(sel.anchorNode, el),
    });
    if (
      sel.isCollapsed ||
      !sel.toString().trim() ||
      dragging.current ||
      document.activeElement !== el
    ) {
      setBubble(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return setBubble(null);
    const below = rect.top < 64;
    setBubble({
      x: Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150),
      y: below ? rect.bottom + 10 : rect.top - 10,
      below,
    });
  }, []);

  useEffect(() => {
    const onSel = () => refresh();
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      refresh();
    };
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('mouseup', onUp);
    };
  }, [refresh]);

  useEffect(() => {
    if (!bubble) return;
    const move = () => refresh();
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc cierra la burbuja, no la nota.
      e.stopPropagation();
      setBubble(null);
    };
    window.addEventListener('scroll', move, true);
    window.addEventListener('resize', move);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('scroll', move, true);
      window.removeEventListener('resize', move);
      window.removeEventListener('keydown', key, true);
    };
  }, [bubble, refresh]);

  /** Devuelve el cursor al editor (si tocaste un botón de fuera) antes de aplicar un formato. */
  const restore = () => {
    const el = ref.current;
    const sel = document.getSelection();
    if (!el || !sel) return false;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    if (!sel.rangeCount || !inside(sel.anchorNode)) {
      sel.removeAllRanges();
      if (saved.current && inside(saved.current.startContainer)) sel.addRange(saved.current);
      else {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        sel.addRange(r);
      }
    }
    return true;
  };

  const run = (cmd: FormatCommand) => {
    const el = ref.current;
    if (!el || !restore()) return;
    exec('styleWithCSS', 'false');
    const block = blockKind(document.getSelection()?.anchorNode ?? null, el);
    const leaveList = () => {
      if (block === 'ul') exec('insertUnorderedList');
      if (block === 'ol') exec('insertOrderedList');
    };
    switch (cmd) {
      case 'bold':
      case 'italic':
      case 'underline':
        exec(cmd);
        break;
      case 'strike':
        exec('strikeThrough');
        break;
      case 'h1':
      case 'h2':
        leaveList();
        exec('formatBlock', block === cmd ? '<div>' : `<${cmd}>`);
        break;
      case 'text':
        leaveList();
        if (block === 'h1' || block === 'h2') exec('formatBlock', '<div>');
        break;
      case 'ul':
      case 'ol':
        if (block === 'h1' || block === 'h2') exec('formatBlock', '<div>');
        exec(cmd === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
        break;
      case 'clear':
        exec('removeFormat');
        if (block === 'h1' || block === 'h2') exec('formatBlock', '<div>');
        break;
    }
    refresh();
  };

  /** Deshace o rehace en `history` y, al redibujarse, deja el cursor donde fue el cambio. */
  const follow = useRef(false);
  const step = (history: TextHistory, kind: 'undo' | 'redo') => {
    if (!(kind === 'undo' ? history.canUndo : history.canRedo)) return;
    follow.current = true;
    setBubble(null);
    history[kind]();
  };

  /** Lo seleccionado ahora (o lo último, si el foco se fue a un botón), para preguntar a la IA. */
  const target = (): AskTarget | null => {
    const el = ref.current;
    const sel = document.getSelection();
    if (!el) return null;
    const live = !!sel?.rangeCount && !sel.isCollapsed && inside(sel.anchorNode);
    const range = live ? sel!.getRangeAt(0) : saved.current;
    if (!range || range.collapsed || !inside(range.commonAncestorContainer)) return null;
    const quote = (live ? sel!.toString() : range.toString()).trim();
    if (!quote) return null;
    const rect = range.getBoundingClientRect();
    const point =
      rect.width || rect.height
        ? { x: rect.left + rect.width / 2, y: rect.bottom - 10 }
        : { x: bubble?.x ?? window.innerWidth / 2, y: bubble?.y ?? window.innerHeight / 3 };
    return { quote, point, found: lineOfRange(el, range) };
  };

  return { ref, state, bubble, run, refresh, dragging, setBubble, follow, step, target };
}

/** El cuerpo de la nota: escribe con formato; Ctrl + B, I, U y atajos como «# » o «- ». */
export function RichNote({
  editor,
  value,
  onChange,
  className,
  placeholder,
  label,
  autoFocus,
  history,
  onAsk,
}: {
  editor: RichEditor;
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
  /** Historial compartido con las flechas de la barra. */
  history?: TextHistory;
  /** Con esto, la burbuja de la selección termina con el botón de la IA. */
  onAsk?: (target: AskTarget) => void;
}) {
  const { ref, run, bubble, refresh, dragging, follow, step } = editor;
  const last = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const historyRef = useRef(history);
  historyRef.current = history;
  const draggingOut = useRef(false);

  // Solo se reescribe cuando el texto cambia desde fuera (al abrir, al deshacer…).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value === last.current) return;
    const before = el.textContent ?? '';
    el.innerHTML = toEditorHtml(value);
    last.current = value;
    if (follow.current) {
      follow.current = false;
      caretAfterChange(el, before);
    }
  }, [value]);

  // Deshacer/rehacer desde el menú contextual o el menú Edición del sistema.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      const h = historyRef.current;
      if (!h || (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo')) return;
      e.preventDefault();
      step(h, e.inputType === 'historyUndo' ? 'undo' : 'redo');
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!autoFocus || !el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    // Solo al abrir.
  }, []);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const md = editorToMd(el);
    last.current = md;
    if (historyRef.current) historyRef.current.change(md);
    else onChangeRef.current(md);
  };

  /** Pega o suelta texto: con formato si viene de una web o un documento. */
  const insert = (data: DataTransfer) => {
    const html = data.getData('text/html');
    const md = (html ? htmlToMd(html) : '') || data.getData('text/plain').replace(/\r\n?/g, '\n');
    if (!md) return;
    exec('styleWithCSS', 'false');
    if (!md.includes('\n') && !/^(#{1,6}|[-*•]|\d{1,4}[.)]) /.test(md)) {
      if (md === data.getData('text/plain')) exec('insertText', md);
      else exec('insertHTML', inlineEditorHtml(md));
    } else exec('insertHTML', toEditorHtml(md));
    emit();
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    // Las fotos las sube el formulario.
    if (Array.from(e.clipboardData.files).some((f) => f.type.startsWith('image/'))) return;
    e.preventDefault();
    e.stopPropagation();
    insert(e.clipboardData);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      // Sin esto el navegador metería la foto dentro del texto.
      e.preventDefault();
      return;
    }
    // Mover un trozo dentro de la propia nota: lo hace el navegador.
    if (draggingOut.current) return;
    e.preventDefault();
    const doc = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    };
    const sel = document.getSelection();
    let range: Range | null = null;
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
      if (p) {
        range = document.createRange();
        range.setStart(p.offsetNode, p.offset);
      }
    } else range = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
    ref.current?.focus();
    if (range && sel && ref.current?.contains(range.startContainer)) {
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    insert(e.dataTransfer);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current;
    const sel = document.getSelection();
    if (!el || !sel) return;
    const kind = history && historyShortcut(e);
    if (kind) {
      e.preventDefault();
      step(history, kind);
      return;
    }
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && (k === 'b' || k === 'i' || k === 'u')) {
      e.preventDefault();
      run(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
      return;
    }
    if (mod && e.shiftKey && k === 'x') {
      e.preventDefault();
      run('strike');
      return;
    }
    if (!sel.isCollapsed || !sel.anchorNode || e.ctrlKey || e.metaKey || e.altKey) return;

    // Atajos al empezar una línea: «# », «## », «- », «* » y «1. ».
    if (e.key === ' ') {
      const block = blockOf(sel.anchorNode, el);
      const { range, text } = beforeCaret(block, sel);
      const kind = blockKind(sel.anchorNode, el);
      const cmd: FormatCommand | null =
        text === '#'
          ? 'h1'
          : text === '##'
            ? 'h2'
            : text === '-' || text === '*'
              ? 'ul'
              : /^1[.)]$/.test(text)
                ? 'ol'
                : null;
      if (!cmd || cmd === kind) return;
      e.preventDefault();
      sel.removeAllRanges();
      sel.addRange(range);
      exec('delete');
      run(cmd);
      return;
    }
    // Retroceso al principio de un título: vuelve a texto normal (como en Docs o Notion).
    if (e.key === 'Backspace') {
      const kind = blockKind(sel.anchorNode, el);
      if (kind !== 'h1' && kind !== 'h2') return;
      if (beforeCaret(blockOf(sel.anchorNode, el), sel).text) return;
      e.preventDefault();
      exec('formatBlock', '<div>');
      emit();
    }
  };

  return (
    <>
      <div
        ref={ref}
        className={'kp-rich ' + className}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder}
        data-empty={value.trim() ? undefined : ''}
        spellCheck
        onInput={emit}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragStart={() => (draggingOut.current = true)}
        onDragEnd={() => (draggingOut.current = false)}
        onMouseDown={() => (dragging.current = true)}
        onKeyUp={refresh}
        onBlur={() => window.setTimeout(refresh, 0)}
      />
      {bubble &&
        createPortal(
          <div
            className={'kp-bubble' + (bubble.below ? ' below' : '')}
            style={{ left: bubble.x, top: bubble.y }}
            role="toolbar"
            aria-label="Formato del texto seleccionado"
            onMouseDown={(e) => e.preventDefault()}
          >
            <FormatButtons editor={editor} groups={BUBBLE} />
            {onAsk && (
              <div className="kp-fmt-group">
                <button
                  type="button"
                  className="kp-fmt-btn kp-fmt-ai"
                  aria-label="Preguntar a la IA"
                  title="Preguntar a la IA sobre lo seleccionado"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const t = editor.target();
                    if (!t) return;
                    editor.setBubble(null);
                    onAsk(t);
                  }}
                >
                  <Sparkles size={16} />
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

const BUBBLE: FormatCommand[][] = [
  ['bold', 'italic', 'underline', 'strike'],
  ['h1', 'h2'],
  ['clear'],
];
const BAR: FormatCommand[][] = [
  ['h1', 'h2', 'text'],
  ['bold', 'italic', 'underline', 'strike'],
  ['ul', 'ol'],
  ['clear'],
];

const isOn = (s: FormatState, c: FormatCommand) =>
  c === 'bold'
    ? s.bold
    : c === 'italic'
      ? s.italic
      : c === 'underline'
        ? s.underline
        : c === 'strike'
          ? s.strike
          : c === 'h1' || c === 'h2' || c === 'text' || c === 'ul' || c === 'ol'
            ? s.block === c
            : false;

function FormatButtons({ editor, groups }: { editor: RichEditor; groups: FormatCommand[][] }) {
  return (
    <>
      {groups.map((group, g) => (
        <div className="kp-fmt-group" key={g}>
          {group.map((c) => {
            const { icon: Icon, label } = TOOLS[c];
            const on = c !== 'clear' && isOn(editor.state, c);
            return (
              <button
                type="button"
                key={c}
                className={'kp-fmt-btn' + (on ? ' on' : '')}
                aria-label={label}
                aria-pressed={c === 'clear' ? undefined : on}
                title={tip(c)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.run(c)}
              >
                <Icon size={16} strokeWidth={c === 'bold' ? 2.6 : 2} />
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** La barra «Aa» en una sola línea: títulos, estilos de letra y listas. */
export function FormatBar({ editor, onClose }: { editor: RichEditor; onClose: () => void }) {
  return (
    <div className="kp-fmt" role="toolbar" aria-label="Opciones de formato">
      <div className="kp-fmt-scroll">
        <FormatButtons editor={editor} groups={BAR} />
      </div>
      <button
        type="button"
        className="kp-fmt-btn kp-fmt-close"
        aria-label="Cerrar opciones de formato"
        title="Cerrar"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  );
}
