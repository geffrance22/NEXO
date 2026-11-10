import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Copy,
  CornerDownLeft,
  Replace,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { AiText } from "../readings/AiText";

export type AskResult = { answer: string; rewrite: boolean };

/** Atajos pensados para escribir un diario (vacío: profundizar). */
const QUICK = [
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

/**
 * Panel para preguntarle o pedirle algo a la IA sobre lo que seleccionaste en la entrada.
 * Si la respuesta es el fragmento reescrito, se puede poner en su lugar; si es una reflexión,
 * se puede añadir debajo o copiar.
 */
export function AskSelection({
  quote,
  point,
  onAsk,
  onReplace,
  onInsert,
  onClose,
}: {
  quote: string;
  /** Dónde quedó la selección (coordenadas de la ventana). */
  point: { x: number; y: number };
  onAsk: (prompt: string) => Promise<AskResult>;
  onReplace: (text: string) => void;
  onInsert: (text: string) => void;
  onClose: () => void;
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
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Un toque fuera lo cierra (Esc también).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // Debajo de la selección si cabe; si no, encima. Se recoloca al crecer con la respuesta.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const place = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(W, vw - EDGE * 2);
      const h = el.offsetHeight;
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
    return () => ro.disconnect();
  }, [point]);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const send = async (p: string) => {
    if (loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    setAsked(p);
    try {
      setResult(await onAsk(p));
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
  const askedLabel = asked
    ? (QUICK.find((q) => q.prompt === asked)?.label ?? asked)
    : "Profundiza";

  return createPortal(
    <div
      ref={root}
      className="rt-ai"
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
      <header className="rt-ai-head">
        <span>
          <Sparkles size={13} /> Preguntar a Nexo
        </span>
        <button type="button" aria-label="Cerrar" title="Cerrar (Esc)" onClick={onClose}>
          <X size={14} />
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
          {result.rewrite && (
            <button type="button" className="primary" onClick={() => onReplace(result.answer)}>
              <Replace size={13} /> Reemplazar
            </button>
          )}
          <button type="button" onClick={() => onInsert(result.answer)}>
            <CornerDownLeft size={13} /> Añadir debajo
          </button>
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
          {QUICK.map((q) => (
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
          placeholder={result ? "Pide otra cosa…" : "Pregunta o pide algo sobre esto…"}
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
