import { useState } from "react";
import { Brain, LoaderCircle } from "lucide-react";
import { useApp } from "../AppContext";
import type { EntryInput } from "../data";
import { cleanDetails } from "../composer/logic";
import { todayInputValue } from "../lib/format";
import { firstReview } from "../ritual/learning";
import { ReaderDialog } from "./ReaderDialog";
import { readingAI } from "./SpeedReader";

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
};
/** Primera frase del texto (o el texto recortado): el título del aprendizaje. */
const firstSentence = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{12,}?[.!?…])(\s|$)/);
  return clip(m ? m[1] : t, 110);
};

/**
 * Lo que aprendiste de un artículo, directo a Aprendizajes. Se guarda con un resumen muy breve
 * del artículo hecho con IA: queda aunque luego borres el artículo, y mientras exista, la ficha
 * del aprendizaje enlaza a él.
 */
export function LearnDialog({
  article,
  close,
}: {
  article: { id: string; title: string };
  close: () => void;
}) {
  const { createEntry, notify, viewEntry } = useApp();
  const [text, setText] = useState("");
  const [step, setStep] = useState<"" | "summary" | "saving">("");
  const [error, setError] = useState("");
  const busy = step !== "";
  const ready = text.trim().length > 0;

  async function send() {
    if (!ready || busy) return;
    setError("");
    setStep("summary");
    let summary = "";
    try {
      summary = (await readingAI(article.id, "summary", true)).summary;
    } catch {
      // Sin IA (cuota, red): el aprendizaje se guarda igual, sin resumen.
    }
    setStep("saving");
    const idea = text.trim();
    const title = firstSentence(idea);
    const input: EntryInput = {
      title,
      body: idea === title ? "" : idea,
      kind: "Aprendizaje",
      tags: [],
      personIds: [],
      date: todayInputValue(),
      amount: 0,
      direction: "egreso",
      status: "pendiente",
      images: [],
      file: null,
      removeFile: false,
      details: cleanDetails("Aprendizaje", {
        source: "Artículo",
        sourceName: article.title,
        readingId: article.id,
        readingSummary: summary ? clip(summary, 600) : undefined,
        review: { step: 0, due: firstReview() },
      }),
    };
    const entry = await createEntry(input, true);
    if (!entry) {
      setStep("");
      setError("No se pudo guardar el aprendizaje. Inténtalo de nuevo.");
      return;
    }
    close();
    notify(
      summary
        ? "Enviado a Aprendizajes."
        : "Enviado a Aprendizajes (sin resumen: la IA no respondió).",
      { label: "Ver", icon: "open", run: () => viewEntry(entry) },
    );
  }

  return (
    <ReaderDialog
      title="Lo que aprendí"
      close={close}
      busy={busy}
      className="rd-learn"
    >
      <form
        className="rd-learn-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <p className="rd-learn-from">De «{article.title}»</p>
        <textarea
          data-initial-focus
          aria-label="Lo que aprendiste"
          placeholder="¿Qué idea te llevas de este artículo?"
          value={text}
          disabled={busy}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <small>
          Se guarda con un resumen breve del artículo, aunque luego lo borres.
        </small>
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
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Brain size={15} />
            )}
            {step === "summary"
              ? "Resumiendo…"
              : step === "saving"
                ? "Guardando…"
                : "Enviar a Aprendizajes"}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
    </ReaderDialog>
  );
}
