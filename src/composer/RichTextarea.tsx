import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  AtSign,
  Bold,
  Check,
  Highlighter,
  MapPin,
  Sparkles,
  Strikethrough,
  Type,
} from "lucide-react";
import {
  HIDDEN,
  fromHidden,
  renderRich,
  stripHidden,
  toHidden,
  type MarkKind,
} from "../components/RichText";
import { AskSelection, type AskResult } from "./AskSelection";
import { caretPoint, revealCaret } from "./caret";
import { useTextHistory, type TextHistory } from "./useTextHistory";

export type RichActions = {
  person?: (text: string) => boolean | void;
  place?: (text: string) => boolean | void;
  title?: (text: string) => void;
  /** Preguntar o pedir algo a la IA sobre lo seleccionado. */
  ask?: (selection: string, prompt: string) => Promise<AskResult>;
};

type Selection = { start: number; end: number; x: number; y: number };
type AskTarget = Selection & { text: string };

const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent ?? "")
  ? "⌘"
  : "Ctrl+";

const isHidden = (ch: string | undefined) =>
  ch === HIDDEN.b || ch === HIDDEN.h || ch === HIDDEN.s;

/** Posición en el texto guardado → posición en el textarea (con marcas invisibles). */
function toViewOffset(text: string, at: number) {
  const pin = "\uE000";
  const shown = toHidden(text.slice(0, at) + pin + text.slice(at));
  const i = shown.indexOf(pin);
  return i >= 0 ? i : Math.min(at, toHidden(text).length);
}

/** Tramos `[inicio, fin)` marcados con `mk`, incluidas las dos marcas. */
function spansOf(text: string, mk: string): [number, number][] {
  const re = new RegExp(`${mk}[^\\n${mk}]+${mk}`, "g");
  return Array.from(text.matchAll(re), (m) => [
    m.index ?? 0,
    (m.index ?? 0) + m[0].length,
  ]);
}

/** El contenedor con scroll vertical más cercano (el que se mueve cuando el texto crece). */
function scrollParent(el: HTMLElement) {
  for (let box = el.parentElement; box; box = box.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(box).overflowY)) return box;
  return null;
}

/** Ctrl/⌘+Z deshace; Ctrl/⌘+Shift+Z y Ctrl+Y rehacen. Devuelve null si no es un atajo de historial. */
function historyShortcut(e: KeyboardEvent): "undo" | "redo" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  // Con teclados no latinos `key` no es una letra: se usa la posición física.
  const key = /^[a-z]$/i.test(e.key)
    ? e.key.toLowerCase()
    : e.code.replace(/^Key/, "").toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && !e.metaKey) return "redo";
  return null;
}

/**
 * Área de texto que crece sola y entiende marcas: al seleccionar texto aparece, junto al puntero,
 * una barra para poner en negrita, resaltar, tachar, vincular a una persona, marcar el lugar o
 * usarlo como título. Detrás del textarea hay un «espejo» que dibuja el formato con el mismo
 * tamaño de letra. Las marcas se guardan como `**`, `==` y `~~`, pero en el campo son caracteres
 * invisibles: el texto se ve limpio.
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
  history,
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
  /** Historial compartido con botones externos; sin él, el campo lleva el suyo (solo atajos). */
  history?: TextHistory;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [asking, setAsking] = useState<AskTarget | null>(null);
  const [flash, setFlash] = useState("");
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const pendingSelection = useRef<[number, number] | null>(null);
  const own = useTextHistory(value, onChange);
  const h = history ?? own;
  const hRef = useRef(h);
  hRef.current = h;

  // Lo que muestra el textarea: el texto con marcas invisibles. Se conserva lo escrito mientras
  // equivalga al valor (así el cursor no salta); si el valor cambió desde fuera, se recalcula.
  const shownRef = useRef<string | null>(null);
  if (shownRef.current === null || fromHidden(shownRef.current) !== value)
    shownRef.current = toHidden(value);
  const shown = shownRef.current;

  /**
   * Cambio en el textarea: se guarda con las marcas de siempre. Si quedó una marca suelta o se
   * escribió `**así**` a mano, el campo se ordena al momento y el cursor se queda donde estaba.
   */
  const commit = (next: string, caret?: number) => {
    const stored = fromHidden(next);
    let view = next;
    const clean = toHidden(stored);
    if (clean !== next && caret !== undefined) {
      const pin = "\uE000";
      const pinned = toHidden(
        fromHidden(next.slice(0, caret) + pin + next.slice(caret)),
      );
      const at = pinned.indexOf(pin);
      if (at >= 0 && pinned.slice(0, at) + pinned.slice(at + 1) === clean) {
        view = clean;
        pendingSelection.current = [at, at];
      }
    }
    shownRef.current = view;
    rerender();
    h.change(stored);
  };

  useLayoutEffect(() => {
    h.attach(ta.current, toViewOffset);
    return () => h.attach(null);
  }, [h.attach]);

  // Deshacer/rehacer desde el menú contextual o el menú Edición del sistema.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== "historyUndo" && e.inputType !== "historyRedo")
        return;
      e.preventDefault();
      setSel(null);
      if (e.inputType === "historyUndo") hRef.current.undo();
      else hRef.current.redo();
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  // Crece con el contenido (el espejo ocupa el mismo alto). Al medir, el alto vuelve a «auto»
  // un instante: se guarda el scroll del contenedor para que no salte, y si el texto creció
  // mientras escribes, se desplaza lo justo para que el cursor siga a la vista.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    const box = scrollParent(el);
    const top = box?.scrollTop ?? 0;
    const before = el.offsetHeight;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
    if (box) box.scrollTop = top;
    if (pendingSelection.current) {
      const [s, e] = pendingSelection.current;
      pendingSelection.current = null;
      el.setSelectionRange(s, e);
    }
    if (document.activeElement === el && el.offsetHeight !== before)
      revealCaret(el, el.selectionEnd);
  }, [shown]);

  useEffect(() => {
    if (!sel) return;
    const hide = () => setSel(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [sel]);

  const read = (point?: { x: number; y: number }) => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end || !stripHidden(el.value.slice(start, end)).trim())
      return setSel(null);
    const p = point ?? caretPoint(el, start);
    setSel({ start, end, x: p.x, y: p.y });
  };

  /** Reemplaza un tramo; el cambio entra en el historial como un paso propio. */
  const replace = (
    from: number,
    to: number,
    text: string,
    select: [number, number],
  ) => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(from, to);
    pendingSelection.current = select;
    const ok = document.execCommand("insertText", false, text);
    if (!ok) {
      el.setRangeText(text, from, to, "end");
      commit(el.value);
    }
  };

  /** Pone o quita negrita, resaltado o tachado en lo seleccionado. */
  const toggle = (kind: MarkKind) => {
    const el = ta.current;
    if (!el) return;
    let { selectionStart: start, selectionEnd: end } = el;
    if (start === end) return;
    const mk = HIDDEN[kind];
    const v = shown;
    const spans = spansOf(v, mk);
    const inside = spans.find(([a, b]) => start >= a && end <= b);
    if (inside) {
      // Ya tiene ese formato: se quita solo de lo seleccionado.
      const [a, b] = inside;
      const s = Math.max(start, a + 1);
      const e = Math.min(end, b - 1);
      const wrap = (t: string) => (t.trim() ? mk + t + mk : t);
      const before = wrap(v.slice(a + 1, s));
      const mid = v.slice(s, e);
      const text = before + mid + wrap(v.slice(e, b - 1));
      replace(a, b, text, [a + before.length, a + before.length + mid.length]);
    } else {
      // Si toca otros tramos con el mismo formato, se unen en uno.
      for (const [a, b] of spans) {
        if (start > a && start < b) start = a;
        if (end > a && end < b) end = b;
      }
      const inner = v.slice(start, end).split(mk).join("");
      // Cada línea por separado: las marcas no cruzan saltos de línea.
      const wrapped = inner
        .split("\n")
        .map((line) => {
          const t = line.trim();
          if (!stripHidden(t)) return line;
          const lead = line.slice(0, line.indexOf(t));
          return lead + mk + t + mk + line.slice(lead.length + t.length);
        })
        .join("\n");
      replace(start, end, wrapped, [start + 1, start + wrapped.length - 1]);
    }
    setSel(null);
  };

  const run = (
    fn: ((text: string) => boolean | void) | undefined,
    done: string,
  ) => {
    if (!sel || !fn) return;
    const text = stripHidden(shown.slice(sel.start, sel.end)).trim();
    const linked = fn(text);
    setSel(null);
    if (linked !== false) {
      setFlash(done);
      window.setTimeout(() => setFlash(""), 1400);
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    const point = { x: e.clientX, y: e.clientY };
    window.setTimeout(() => read(point), 0);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.shiftKey || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a"))
      read();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const step = historyShortcut(e);
    if (step) {
      e.preventDefault();
      setSel(null);
      h[step]();
      return;
    }
    const el = e.currentTarget;
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    if (mod && (e.key.toLowerCase() === "b" || e.code === "KeyB")) {
      e.preventDefault();
      toggle("b");
      return;
    }
    if (e.key === "Escape" && sel) {
      e.stopPropagation();
      setSel(null);
      return;
    }
    // Las marcas no se ven: el cursor las salta, y borrar actúa sobre la letra de al lado.
    const { selectionStart: s, selectionEnd: end, value: v } = el;
    if (s !== end || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace" || e.key === "ArrowLeft") {
      let p = s;
      while (p > 0 && isHidden(v[p - 1])) p--;
      if (p !== s) el.setSelectionRange(p, p);
    } else if (e.key === "Delete" || e.key === "ArrowRight") {
      let p = s;
      while (p < v.length && isHidden(v[p])) p++;
      if (p !== s) el.setSelectionRange(p, p);
    }
  };
  /** Al copiar no viajan las marcas invisibles. */
  const onCopy = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const raw = el.value.slice(el.selectionStart, el.selectionEnd);
    if (raw === stripHidden(raw)) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", stripHidden(raw));
    if (e.type === "cut")
      replace(el.selectionStart, el.selectionEnd, "", [
        el.selectionStart,
        el.selectionStart,
      ]);
  };

  const left = sel
    ? Math.min(Math.max(sel.x, 160), window.innerWidth - 160)
    : 0;
  const above = sel ? sel.y > 70 : true;

  /** Dónde está hoy el fragmento por el que se preguntó (pudo moverse si el texto cambió). */
  const spanOf = (t: AskTarget): [number, number] | null => {
    if (shown.slice(t.start, t.end) === t.text) return [t.start, t.end];
    const i = shown.indexOf(t.text);
    return i >= 0 ? [i, i + t.text.length] : null;
  };
  const openAsk = () => {
    if (!sel) return;
    setAsking({ ...sel, text: shown.slice(sel.start, sel.end) });
    setSel(null);
  };
  const askReplace = (text: string) => {
    if (!asking) return;
    const span = spanOf(asking);
    if (!span) return;
    const clean = text.trim();
    replace(span[0], span[1], clean, [span[0], span[0] + clean.length]);
    setAsking(null);
    setFlash("Texto reemplazado");
    window.setTimeout(() => setFlash(""), 1400);
  };
  const askInsert = (text: string) => {
    if (!asking) return;
    const at = spanOf(asking)?.[1] ?? shown.length;
    // Al final del párrafo donde está la selección, como un párrafo propio.
    const nl = shown.indexOf("\n", at);
    const end = nl < 0 ? shown.length : nl;
    const block = "\n\n" + text.trim();
    replace(end, end, block, [end + 2, end + block.length]);
    setAsking(null);
    setFlash("Añadido a la entrada");
    window.setTimeout(() => setFlash(""), 1400);
  };

  type Tool = {
    key: string;
    icon: typeof AtSign;
    label: string;
    /** Se ve el nombre junto al ícono (solo «Título», que con el ícono solo parece «fuente»). */
    text?: boolean;
    onClick: () => void;
  };
  const tools = [
    actions.ask && {
      key: "ai",
      icon: Sparkles,
      label: "Preguntar o pedir algo a la IA",
      onClick: openAsk,
    },
    {
      key: "b",
      icon: Bold,
      label: `Negrita (${MOD}B)`,
      onClick: () => toggle("b"),
    },
    {
      key: "h",
      icon: Highlighter,
      label: "Resaltar",
      onClick: () => toggle("h"),
    },
    {
      key: "s",
      icon: Strikethrough,
      label: "Tachar",
      onClick: () => toggle("s"),
    },
    actions.person && {
      key: "p",
      icon: AtSign,
      label: "Vincular a una persona",
      onClick: () => run(actions.person, "Persona vinculada"),
    },
    actions.place && {
      key: "l",
      icon: MapPin,
      label: "Usar como lugar",
      onClick: () => run(actions.place, "Lugar asignado"),
    },
    actions.title && {
      key: "t",
      icon: Type,
      label: "Título",
      text: true,
      onClick: () => run(actions.title, "Título actualizado"),
    },
  ].filter(Boolean) as Tool[];

  const askQuote = asking ? stripHidden(asking.text).trim() : "";

  return (
    <div className="rt">
      <div className={"rt-mirror " + className} aria-hidden="true">
        {renderRich(shown, { names, editor: true })}
        {"\u200b"}
      </div>
      <textarea
        ref={ta}
        className={className}
        rows={minRows}
        value={shown}
        placeholder={placeholder}
        aria-label={label}
        data-autofocus={autoFocusTarget || undefined}
        onChange={(e) => {
          setSel(null);
          commit(e.target.value, e.target.selectionEnd);
        }}
        onMouseUp={onMouseUp}
        onKeyUp={onKeyUp}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCopy}
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
            className={"rt-bar" + (above ? "" : " below")}
            style={{ left, top: above ? sel.y - 12 : sel.y + 26 }}
            role="toolbar"
            aria-label="Opciones para el texto seleccionado"
            onMouseDown={(e) => e.preventDefault()}
          >
            {tools.map((t) => (
              <button
                type="button"
                key={t.key}
                className={
                  t.key === "ai" ? "ai" : t.text ? "with-text" : undefined
                }
                onClick={t.onClick}
                title={t.label}
                aria-label={t.text ? undefined : t.label}
              >
                <t.icon size={16} strokeWidth={t.key === "b" ? 2.6 : 2} />
                {t.text && <span>{t.label}</span>}
              </button>
            ))}
          </div>,
          document.body,
        )}
      {asking && actions.ask && (
        <AskSelection
          quote={askQuote}
          point={asking}
          onAsk={(prompt) => actions.ask!(askQuote, prompt)}
          onReplace={askReplace}
          onInsert={askInsert}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}
