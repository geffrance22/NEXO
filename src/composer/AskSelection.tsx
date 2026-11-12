import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  ArrowUp,
  Copy,
  CornerDownLeft,
  Replace,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { AiText } from "../readings/AiText";

/**
 * `place`: la indicación pedía dejar la respuesta en el texto (debajo de la selección o al final),
 * así que se pone ahí sin más clics.
 */
export type AskResult = { answer: string; rewrite: boolean; place?: "below" | "end" };
export type AskQuick = { label: string; prompt: string };

/** Atajos pensados para escribir un diario (vacío: profundizar). */
const QUICK: AskQuick[] = [
  { label: "Profundiza", prompt: "" },
  {
    label: "Mejora la redacción",
    prompt: "Mejora la redacción de este fragmento sin cambiar lo que digo ni mi voz.",
  },
  {
    label: "Corrige",
    prompt: "Corrige solo la ortografía, los acentos y la puntuación.",
  },
  { label: "Más breve", prompt: "Hazlo más breve sin perder lo importante." },
  { label: "Otra mirada", prompt: "¿Cómo podría ver esto de otra forma?" },
  {
    label: "Pregúntame",
    prompt: "Hazme una o dos preguntas para seguir escribiendo sobre esto.",
  },
];

const W = 380;
const EDGE = 10;

/** Mantiene la ventana entera dentro de la pantalla. */
const clampPos = (left: number, top: number, w: number, h: number) => ({
  left: Math.min(Math.max(left, EDGE), Math.max(EDGE, window.innerWidth - w - EDGE)),
  top: Math.min(Math.max(top, EDGE), Math.max(EDGE, window.innerHeight - h - EDGE)),
});

/**
 * Panel para preguntarle o pedirle algo a la IA sobre lo que seleccionaste en la entrada.
 * Si la respuesta es el fragmento reescrito, se puede poner en su lugar; si es una reflexión,
 * se puede añadir debajo (o al final, con `onAppend`) o copiar.
 */
export function AskSelection({
  quote,
  point,
  onAsk,
  onReplace,
  onInsert,
  onAppend,
  onClose,
  quick = QUICK,
  placeholder = "Pregunta o pide algo sobre esto…",
}: {
  quote: string;
  /** Dónde quedó la selección (coordenadas de la ventana). */
  point: { x: number; y: number };
  onAsk: (prompt: string) => Promise<AskResult>;
  /** Sin esto no se ofrece «Reemplazar» (p. ej. en las notas, que solo se amplían). */
  onReplace?: (text: string) => void;
  /** Debajo de la selección. */
  onInsert: (text: string) => void;
  /** Al final del texto. */
  onAppend?: (text: string) => void;
  onClose: () => void;
  /** Atajos (el de `prompt` vacío es la pregunta por defecto). */
  quick?: AskQuick[];
  placeholder?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const [prompt, setPrompt] = useState("");
  const [asked, setAsked] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Si la moviste a mano, ya no se recoloca sola junto a la selección. */
  const moved = useRef(false);

  // Debajo de la selección si cabe; si no, encima. Se recoloca al crecer con la respuesta.
  // Si la moviste, solo se asegura de que siga dentro de la ventana.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const place = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(W, vw - EDGE * 2);
      const h = el.offsetHeight;
      if (moved.current) {
        setPos((p) => p && clampPos(p.left, p.top, w, h));
        return;
      }
      const left = Math.min(Math.max(point.x - w / 2, EDGE), vw - w - EDGE);
      const below = point.y + 26;
      const above = point.y - 14 - h;
      const top =
        below + h <= vh - EDGE || above < EDGE
          ? Math.min(below, Math.max(EDGE, vh - h - EDGE))
          : above;
      setPos({ left, top });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [point]);

  /** Arrastrar desde el encabezado (ratón, lápiz o dedo). */
  const startDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = root.current;
    if (!el || !pos) return;
    e.preventDefault();
    const head = e.currentTarget;
    head.setPointerCapture(e.pointerId);
    const dx = e.clientX - pos.left;
    const dy = e.clientY - pos.top;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    moved.current = true;
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      setPos(clampPos(ev.clientX - dx, ev.clientY - dy, w, h));
    };
    const onUp = () => {
      setDragging(false);
      head.removeEventListener("pointermove", onMove);
      head.removeEventListener("pointerup", onUp);
      head.removeEventListener("pointercancel", onUp);
    };
    head.addEventListener("pointermove", onMove);
    head.addEventListener("pointerup", onUp);
    head.addEventListener("pointercancel", onUp);
  };

  // Listo para escribir apenas aparece. No antes: mientras se mide va oculto
  // (`visibility: hidden`) y un elemento oculto no recibe el foco.
  const focused = useRef(false);
  useEffect(() => {
    if (!pos || focused.current) return;
    focused.current = true;
    input.current?.focus({ preventScroll: true });
  }, [pos]);

  const send = async (p: string) => {
    if (loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    setAsked(p);
    try {
      const r = await onAsk(p);
      // Pediste dejarlo en el texto: se pone ahí (y quien abrió el panel lo cierra).
      if (r.place === "end" && onAppend) return onAppend(r.answer);
      if (r.place === "below") return onInsert(r.answer);
      setResult(r);
      setPrompt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      window.setTimeout(() => input.current?.focus({ preventScroll: true }), 0);
    }
  };
  const submit = () => {
    const p = prompt.trim();
    if (!p && result) return void send(asked);
    void send(p);
  };
  const askedLabel =
    quick.find((q) => q.prompt === asked)?.label ?? (asked || "Profundiza");

  return createPortal(
    <div
      ref={root}
      className={"rt-ai" + (dragging ? " dragging" : "")}
      role="dialog"
      aria-label="Preguntar a la IA sobre la selección"
      style={
        pos
          ? { left: pos.left, top: pos.top, width: Math.min(W, window.innerWidth - EDGE * 2) }
          : { left: 0, top: 0, visibility: "hidden" }
      }
      // Va en un portal pero los eventos de React suben por el árbol: el formulario de la
      // entrada no debe recibir estas teclas (Ctrl+Enter guardaría, Esc cerraría la ventana).
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== "Escape") return;
        e.preventDefault();
        onClose();
      }}
      onPaste={(e) => e.stopPropagation()}
    >
      <header
        className="rt-ai-head"
        onPointerDown={startDrag}
        title="Arrastra para mover"
      >
        <span>
          <Sparkles size={13} /> Preguntar a Nexo
        </span>
        <button
          type="button"
          className="rt-ai-close"
          aria-label="Cerrar"
          title="Cerrar (Esc)"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      <blockquote className="rt-ai-quote" title={quote}>
        {quote}
      </blockquote>

      {(loading || error || result) && (
        <div className="rt-ai-answer" aria-live="polite">
          {loading ? (
            <span className="rt-ai-thinking">
              <i />
              <i />
              <i /> Pensando…
            </span>
          ) : error ? (
            <p className="rt-ai-error">{error}</p>
          ) : (
            result && (
              <>
                <small className="rt-ai-asked">{askedLabel}</small>
                {result.rewrite ? (
                  <p className="rt-ai-rewrite">{result.answer}</p>
                ) : (
                  <AiText text={result.answer} />
                )}
              </>
            )
          )}
        </div>
      )}

      {result && !loading && (
        <div className="rt-ai-actions">
          {result.rewrite && onReplace && (
            <button type="button" className="primary" onClick={() => onReplace(result.answer)}>
              <Replace size={13} /> Reemplazar
            </button>
          )}
          <button type="button" onClick={() => onInsert(result.answer)}>
            <CornerDownLeft size={13} /> Añadir debajo
          </button>
          {onAppend && (
            <button type="button" onClick={() => onAppend(result.answer)}>
              <ArrowDownToLine size={13} /> Al final de la nota
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(result.answer);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            <Copy size={13} /> {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      )}

      {!result && !loading && (
        <div className="rt-ai-chips">
          {quick.map((q) => (
            <button type="button" key={q.label} onClick={() => void send(q.prompt)}>
              {q.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="rt-ai-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          submit();
        }}
      >
        <textarea
          ref={input}
          rows={1}
          maxLength={1500}
          aria-label="Pregunta o indicación para la IA"
          placeholder={result ? "Pide otra cosa…" : placeholder}
          value={prompt}
          disabled={loading}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="submit"
          disabled={loading}
          title={result && !prompt.trim() ? "Otra respuesta" : "Enviar (Enter)"}
          aria-label={result && !prompt.trim() ? "Otra respuesta" : "Enviar"}
        >
          {result && !prompt.trim() ? <RotateCcw size={14} /> : <ArrowUp size={15} />}
        </button>
      </form>
    </div>,
    document.body,
  );
}
