import { useMemo, useRef, useState } from "react";
import { Brackets, LoaderCircle, MessageCircleQuestion } from "lucide-react";
import { errorMessage } from "../lib/format";
import { AiText } from "./AiText";
import {
  clozeAnswers,
  clozeBack,
  clozeExtra,
  clozeFront,
  clozeFull,
  isCloze,
  wrapCloze,
} from "./cloze";
import {
  BACK_MAX,
  createFlashcards,
  FRONT_MAX,
  updateFlashcard,
  type CardDraft,
  type Flashcard,
} from "./flashcardStore";
import { ReaderDialog } from "./ReaderDialog";
import "./flashcards.css";

export type CardKind = "qa" | "cloze";
/** Lo que llega para empezar una tarjeta nueva (p. ej. desde un subrayado). */
export type CardSeed = Partial<CardDraft> & { kind?: CardKind };

/** Una tarjeta por hueco: en cada una solo se oculta uno; los demás se leen. */
function splitCloze(front: string) {
  const n = clozeAnswers(front).length;
  return Array.from({ length: n }, (_, keep) => {
    let i = -1;
    return front.replace(/\{\{(.+?)(::(.+?))?\}\}/g, (all, a: string) =>
      ++i === keep ? all : a,
    );
  });
}

/**
 * Crear o editar una flashcard a mano. Dos tipos: pregunta y respuesta, o huecos (seleccionas
 * lo que quieres recordar y se oculta al repasar). Al editar, la memoria del repaso se conserva
 * salvo que pidas empezar de nuevo.
 */
export function CardEditor({
  card,
  seed,
  close,
  saved,
}: {
  /** La tarjeta que editas (si no, se crea una nueva con `seed`). */
  card?: Flashcard;
  seed?: CardSeed;
  close: () => void;
  saved: (cards: Flashcard[], edited: boolean) => void;
}) {
  const startCloze = card ? isCloze(card.front) : seed?.kind === "cloze";
  const [kind, setKind] = useState<CardKind>(startCloze ? "cloze" : "qa");
  const [front, setFront] = useState(card?.front ?? seed?.front ?? "");
  const [back, setBack] = useState(
    card
      ? startCloze
        ? clozeExtra(card.front, card.back)
        : card.back
      : (seed?.back ?? ""),
  );
  const [split, setSplit] = useState(false);
  const [restart, setRestart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const text = useRef<HTMLTextAreaElement>(null);

  const answers = useMemo(() => clozeAnswers(front), [front]);
  const clozeReady = kind === "cloze" && answers.length > 0;
  const ready =
    front.trim().length > 0 &&
    (kind === "cloze" ? answers.length > 0 : back.trim().length > 0);
  const changedFront = card ? front.trim() !== card.front.trim() : false;

  /** Oculta lo seleccionado en el texto (lo envuelve en llaves). */
  function hide() {
    const el = text.current;
    if (!el) return;
    const out = wrapCloze(front, el.selectionStart, el.selectionEnd);
    if (!out) {
      setError(
        "Selecciona en el texto la palabra o la frase que quieres ocultar.",
      );
      el.focus();
      return;
    }
    setError("");
    setFront(out.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(out.caret, out.caret);
    });
  }

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const finalBack = kind === "cloze" ? clozeBack(front, back) : back.trim();
      if (card) {
        const row = await updateFlashcard(
          card.id,
          { front, back: finalBack },
          restart,
        );
        saved([row], true);
      } else {
        const fronts =
          kind === "cloze" && split && answers.length > 1
            ? splitCloze(front)
            : [front];
        const rows = await createFlashcards(
          fronts.map((f) => ({
            front: f,
            back: kind === "cloze" ? clozeBack(f, back) : finalBack,
            reading_id: seed?.reading_id ?? null,
            source: seed?.source ?? "",
          })),
        );
        saved(rows, false);
      }
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReaderDialog
      title={card ? "Editar flashcard" : "Nueva flashcard"}
      className="fc-editor"
      busy={busy}
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <div
          className="fc-kinds"
          role="radiogroup"
          aria-label="Tipo de tarjeta"
        >
          <button
            type="button"
            role="radio"
            aria-checked={kind === "qa"}
            className={kind === "qa" ? "on" : ""}
            onClick={() => setKind("qa")}
          >
            <MessageCircleQuestion size={15} /> Pregunta y respuesta
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={kind === "cloze"}
            className={kind === "cloze" ? "on" : ""}
            onClick={() => setKind("cloze")}
          >
            <Brackets size={15} /> Huecos
          </button>
        </div>

        {kind === "qa" ? (
          <>
            <label>
              Pregunta
              <textarea
                autoFocus
                rows={3}
                maxLength={FRONT_MAX}
                value={front}
                placeholder="¿Qué quieres poder recordar?"
                onChange={(e) => setFront(e.target.value)}
              />
            </label>
            <label>
              Respuesta
              <textarea
                autoFocus={Boolean(front) && !back}
                rows={4}
                maxLength={BACK_MAX}
                value={back}
                placeholder="Breve y concreta"
                onChange={(e) => setBack(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Texto
              <textarea
                ref={text}
                autoFocus
                rows={5}
                maxLength={FRONT_MAX}
                value={front}
                placeholder="Escribe o pega el texto y oculta lo que quieres recordar"
                onChange={(e) => setFront(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key.toLowerCase() === "h" && e.altKey) {
                    e.preventDefault();
                    hide();
                  }
                }}
              />
            </label>
            <div className="fc-cloze-row">
              <button
                type="button"
                className="rd-dlg-btn ghost"
                onMouseDown={(e) => e.preventDefault()}
                onClick={hide}
              >
                <Brackets size={14} /> Ocultar lo seleccionado
              </button>
              <small>
                Alt + H · o escribe {"{{así}}"} · {"{{respuesta::pista}}"} deja
                una pista
              </small>
            </div>
            {clozeReady && (
              <div className="fc-preview" aria-live="polite">
                <span>Al repasar verás</span>
                <p>{clozeFront(front)}</p>
                <span>Y detrás</span>
                <AiText text={clozeFull(front)} />
              </div>
            )}
            <label>
              Nota (opcional)
              <textarea
                rows={2}
                maxLength={BACK_MAX}
                value={back}
                placeholder="Contexto o una explicación para cuando la veas detrás"
                onChange={(e) => setBack(e.target.value)}
              />
            </label>
            {!card && answers.length > 1 && (
              <label className="fc-check">
                <input
                  type="checkbox"
                  checked={split}
                  onChange={(e) => setSplit(e.target.checked)}
                />
                Una tarjeta por hueco ({answers.length} tarjetas)
              </label>
            )}
          </>
        )}

        {card && changedFront && (
          <label className="fc-check">
            <input
              type="checkbox"
              checked={restart}
              onChange={(e) => setRestart(e.target.checked)}
            />
            Pregunta otra cosa: empezar su repaso de cero
          </label>
        )}

        {error && <p role="alert">{error}</p>}
        <div className="rd-dlg-foot">
          <button
            type="button"
            className="rd-dlg-btn ghost"
            disabled={busy}
            onClick={close}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rd-dlg-btn primary"
            disabled={!ready || busy}
          >
            {busy && <LoaderCircle className="spin" size={14} />}
            {card
              ? "Guardar"
              : split && answers.length > 1
                ? `Crear ${answers.length} tarjetas`
                : "Crear tarjeta"}
          </button>
        </div>
      </form>
    </ReaderDialog>
  );
}
