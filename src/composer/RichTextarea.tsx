import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  AtSign,
  Check,
  Highlighter,
  MapPin,
  Sparkles,
  Strikethrough,
  Type,
} from "lucide-react";
import { renderRich } from "../components/RichText";
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
  const pendingSelection = useRef<[number, number] | null>(null);
  const own = useTextHistory(value, onChange);
  const h = history ?? own;
  const hRef = useRef(h);
  hRef.current = h;

  useLayoutEffect(() => {
    h.attach(ta.current);
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
  }, [value]);

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
    if (start === end || !el.value.slice(start, end).trim())
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
      h.change(el.value);
    }
  };

  const toggle = (marker: "==" | "~~") => {
    if (!sel) return;
    const { start, end } = sel;
    const v = value;
    const inner = v.slice(start, end);
    if (
      v.slice(start - 2, start) === marker &&
      v.slice(end, end + 2) === marker
    ) {
      replace(start - 2, end + 2, inner, [start - 2, end - 2]);
    } else if (
      inner.length >= 4 &&
      inner.startsWith(marker) &&
      inner.endsWith(marker)
    ) {
      replace(start, end, inner.slice(2, -2), [start, end - 4]);
    } else {
      // Cada línea por separado: las marcas no cruzan saltos de línea.
      const wrapped = inner
        .split("\n")
        .map((line) => {
          const t = line.trim();
          if (!t) return line;
          const lead = line.slice(0, line.indexOf(t));
          return (
            lead + marker + t + marker + line.slice(lead.length + t.length)
          );
        })
        .join("\n");
      replace(start, end, wrapped, [start + 2, start + wrapped.length - 2]);
    }
    setSel(null);
  };

  const run = (
    fn: ((text: string) => boolean | void) | undefined,
    done: string,
  ) => {
    if (!sel || !fn) return;
    const text = value.slice(sel.start, sel.end).replace(/==|~~/g, "").trim();
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
  const onKeyDown = (e: KeyboardEvent) => {
    const step = historyShortcut(e);
    if (step) {
      e.preventDefault();
      setSel(null);
      h[step]();
      return;
    }
    if (e.key === "Escape" && sel) {
      e.stopPropagation();
      setSel(null);
    }
  };

  const left = sel
    ? Math.min(Math.max(sel.x, 160), window.innerWidth - 160)
    : 0;
  const above = sel ? sel.y > 70 : true;

  /** Dónde está hoy el fragmento por el que se preguntó (pudo moverse si el texto cambió). */
  const spanOf = (t: AskTarget): [number, number] | null => {
    if (value.slice(t.start, t.end) === t.text) return [t.start, t.end];
    const i = value.indexOf(t.text);
    return i >= 0 ? [i, i + t.text.length] : null;
  };
  const openAsk = () => {
    if (!sel) return;
    setAsking({ ...sel, text: value.slice(sel.start, sel.end) });
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
    const at = spanOf(asking)?.[1] ?? value.length;
    // Al final del párrafo donde está la selección, como un párrafo propio.
    const nl = value.indexOf("\n", at);
    const end = nl < 0 ? value.length : nl;
    const block = "\n\n" + text.trim();
    replace(end, end, block, [end + 2, end + block.length]);
    setAsking(null);
    setFlash("Añadido a la entrada");
    window.setTimeout(() => setFlash(""), 1400);
  };

  const tools = [
    actions.ask && {
      key: "ai",
      icon: Sparkles,
      label: "IA",
      onClick: openAsk,
    },
    actions.person && {
      key: "p",
      icon: AtSign,
      label: "Persona",
      onClick: () => run(actions.person, "Persona vinculada"),
    },
    {
      key: "h",
      icon: Highlighter,
      label: "Resaltar",
      onClick: () => toggle("=="),
    },
    {
      key: "s",
      icon: Strikethrough,
      label: "Tachar",
      onClick: () => toggle("~~"),
    },
    actions.place && {
      key: "l",
      icon: MapPin,
      label: "Lugar",
      onClick: () => run(actions.place, "Lugar asignado"),
    },
    actions.title && {
      key: "t",
      icon: Type,
      label: "Título",
      onClick: () => run(actions.title, "Título actualizado"),
    },
  ].filter(Boolean) as {
    key: string;
    icon: typeof AtSign;
    label: string;
    onClick: () => void;
  }[];

  return (
    <div className="rt">
      <div className={"rt-mirror " + className} aria-hidden="true">
        {renderRich(value, { names, showMarkers: true })}
        {"\u200b"}
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
          h.change(e.target.value);
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
                className={t.key === "ai" ? "ai" : undefined}
                onClick={t.onClick}
                title={t.key === "ai" ? "Preguntar o pedir algo a la IA" : t.label}
              >
                <t.icon size={15} />
                {t.key === "ai" ? (
                  <span className="rt-sr">Preguntar a la IA</span>
                ) : (
                  <span>{t.label}</span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
      {asking && actions.ask && (
        <AskSelection
          quote={asking.text.replace(/==|~~/g, "").trim()}
          point={asking}
          onAsk={(prompt) =>
            actions.ask!(asking.text.replace(/==|~~/g, "").trim(), prompt)
          }
          onReplace={askReplace}
          onInsert={askInsert}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}
