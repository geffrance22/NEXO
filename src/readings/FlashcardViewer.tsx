import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, RotateCcw, Shuffle, X } from "lucide-react";
import type { Flashcard } from "./flashcardStore";
import "./flashcardViewer.css";

/**
 * Ajusta el tamaño de letra para que el texto quepa entero en su cara de la tarjeta:
 * la tarjeta nunca hace scroll. Parte de `max` y baja hasta `min`.
 */
function useFit(text: string, max: number, min = 11) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const b = box.current;
    const p = inner.current;
    if (!b || !p) return;
    const fit = () => {
      let size = max;
      p.style.fontSize = size + "px";
      while (size > min && p.offsetHeight > b.clientHeight) {
        size -= 1;
        p.style.fontSize = size + "px";
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => ro.disconnect();
  }, [text, max, min]);
  return { box, inner };
}

function Face({
  side,
  label,
  text,
  max,
}: {
  side: "front" | "back";
  label: string;
  text: string;
  max: number;
}) {
  const { box, inner } = useFit(text, max);
  return (
    <div className={"fcv-face " + side} aria-hidden="true">
      <span className="fcv-label">{label}</span>
      <div className="fcv-text" ref={box}>
        <p ref={inner}>{text}</p>
      </div>
    </div>
  );
}

/**
 * Modo estudio: las flashcards una a una en una ventana translúcida. Clic (o espacio)
 * para girarla; flechas, teclado o deslizar para pasar. Esc o clic fuera para cerrar.
 */
export function FlashcardViewer({
  cards,
  start = 0,
  onClose,
}: {
  cards: Flashcard[];
  start?: number;
  onClose: () => void;
}) {
  const [deck, setDeck] = useState(cards);
  const [shuffled, setShuffled] = useState(false);
  const [index, setIndex] = useState(
    Math.min(Math.max(start, 0), cards.length - 1),
  );
  const [flipped, setFlipped] = useState(false);
  const [dir, setDir] = useState<1 | -1 | 0>(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const card = deck[index];
  const last = deck.length - 1;

  const go = (step: 1 | -1) => {
    const next = index + step;
    if (next < 0 || next > last) return;
    setDir(step);
    setFlipped(false);
    setIndex(next);
  };
  const flip = () => setFlipped((f) => !f);
  const restart = () => {
    setDir(-1);
    setFlipped(false);
    setIndex(0);
  };
  const toggleShuffle = () => {
    if (shuffled) setDeck(cards);
    else {
      const d = [...cards];
      for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
      }
      setDeck(d);
    }
    setShuffled(!shuffled);
    setDir(1);
    setFlipped(false);
    setIndex(0);
  };

  // Teclado y bloqueo del scroll de la página mientras está abierta.
  const keys = useRef({ go, flip, onClose });
  keys.current = { go, flip, onClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (e.key === "Escape") k.onClose();
      else if (e.key === "ArrowRight") k.go(1);
      else if (e.key === "ArrowLeft") k.go(-1);
      else if (
        e.key === " " ||
        e.key === "Enter" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        // Un botón con el foco ya responde a Enter y espacio por sí mismo.
        if (
          (e.key === " " || e.key === "Enter") &&
          e.target instanceof HTMLButtonElement
        )
          return;
        e.preventDefault();
        k.flip();
      }
    };
    document.addEventListener("keydown", onKey);
    const html = document.documentElement.style.overflow;
    const body = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const before = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = html;
      document.body.style.overflow = body;
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  if (!card) return null;

  return createPortal(
    <div
      className="fcv"
      role="dialog"
      aria-modal="true"
      aria-label="Estudiar flashcards"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="fcv-panel">
        <header className="fcv-head">
          <span className="fcv-source" title={card.source}>
            {card.source || "Tus flashcards"}
          </span>
          <button
            type="button"
            className={"fcv-icon" + (shuffled ? " on" : "")}
            title={shuffled ? "Volver al orden original" : "Barajar"}
            aria-label="Barajar"
            aria-pressed={shuffled}
            disabled={deck.length < 2}
            onClick={toggleShuffle}
          >
            <Shuffle size={17} />
          </button>
          <button
            type="button"
            className="fcv-icon"
            title="Empezar de nuevo"
            aria-label="Empezar de nuevo"
            disabled={index === 0}
            onClick={restart}
          >
            <RotateCcw size={17} />
          </button>
          <button
            type="button"
            className="fcv-icon"
            title="Cerrar (Esc)"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>

        <div className="fcv-progress" aria-hidden="true">
          <span style={{ width: `${((index + 1) / deck.length) * 100}%` }} />
        </div>

        <div className="fcv-stage">
          <div
            key={card.id}
            className={
              "fcv-slot" + (dir === 1 ? " in-next" : dir === -1 ? " in-prev" : "")
            }
          >
            <div
              ref={cardRef}
              className={"fcv-card" + (flipped ? " flipped" : "")}
              role="button"
              tabIndex={0}
              aria-pressed={flipped}
              aria-label={
                flipped
                  ? "Respuesta: " + card.back + ". Pulsa para ver la pregunta."
                  : "Pregunta: " + card.front + ". Pulsa para ver la respuesta."
              }
              onPointerDown={(e) => {
                swipe.current = { x: e.clientX, y: e.clientY, moved: false };
              }}
              onPointerMove={(e) => {
                const s = swipe.current;
                if (s && Math.abs(e.clientX - s.x) > 10) s.moved = true;
              }}
              onPointerUp={(e) => {
                const s = swipe.current;
                if (!s) return;
                const dx = e.clientX - s.x;
                const dy = e.clientY - s.y;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy))
                  go(dx < 0 ? 1 : -1);
              }}
              onPointerCancel={() => (swipe.current = null)}
              onClick={() => {
                if (swipe.current?.moved) return;
                flip();
              }}
            >
              <div className="fcv-inner">
                <Face side="front" label="Pregunta" text={card.front} max={30} />
                <Face side="back" label="Respuesta" text={card.back} max={24} />
              </div>
            </div>
          </div>
        </div>

        <footer className="fcv-foot">
          <button
            type="button"
            className="fcv-nav"
            aria-label="Anterior"
            title="Anterior (←)"
            disabled={index === 0}
            onClick={() => go(-1)}
          >
            <ChevronLeft size={24} />
          </button>
          <div className="fcv-mid">
            <span className="fcv-count">
              {index + 1} <i>/</i> {deck.length}
            </span>
            <span className="fcv-hint">
              {flipped ? "Toca para ver la pregunta" : "Toca para ver la respuesta"}
            </span>
          </div>
          <button
            type="button"
            className="fcv-nav"
            aria-label="Siguiente"
            title="Siguiente (→)"
            disabled={index === last}
            onClick={() => go(1)}
          >
            <ChevronRight size={24} />
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
