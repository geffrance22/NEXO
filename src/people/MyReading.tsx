import { useEffect, useState } from "react";
import {
  ChevronDown,
  EyeOff,
  History,
  LoaderCircle,
  Pin,
  RefreshCw,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useApp } from "../AppContext";
import { selfReading } from "../assistant";
import { errorMessage, normalizeText, todayInputValue } from "../lib/format";
import { relativeDay } from "../lib/people";
import {
  buildSelfDigest,
  selfBasis,
  type ReadingLite,
} from "../lib/selfDigest";

const STEPS = [
  "Mirando a tu gente…",
  "Repasando tus recuerdos…",
  "Hojeando tus lecturas…",
  "Escribiendo tu lectura…",
];

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Los rasgos que se muestran: los fijados primero; los ocultos, nunca. */
export function useTraits() {
  const { me } = useApp();
  const pinned = me.profile.traitsPinned ?? [];
  const hidden = me.profile.traitsHidden ?? [];
  const isIn = (list: string[], t: string) =>
    list.some((x) => normalizeText(x) === normalizeText(t));
  const traits = [
    ...pinned,
    ...me.highlights.filter((h) => !isIn(pinned, h) && !isIn(hidden, h)),
  ];
  return { traits, pinned, hidden, isIn };
}

/**
 * «Lectura de Nexo»: lo que la IA ve de ti. Se pliega (así arranca) y al abrirla se lee completa,
 * con sus rasgos y las lecturas anteriores.
 */
export function MyReading({
  readings,
  loadReadings,
  canSave,
}: {
  readings: ReadingLite[] | null;
  loadReadings: () => Promise<ReadingLite[]>;
  canSave: boolean;
}) {
  const { workspace, me, patchMe, saveMyReading } = useApp();
  const [open, setOpen] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const { traits, pinned, hidden, isIn } = useTraits();
  const hiddenNow = hidden.filter((h) => isIn(me.highlights, h));

  useEffect(() => {
    if (!thinking) return;
    setStep(0);
    const t = window.setInterval(
      () => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
      1900,
    );
    return () => window.clearInterval(t);
  }, [thinking]);

  const same = (a: string, b: string) => normalizeText(a) === normalizeText(b);
  const togglePin = (t: string) =>
    void patchMe({
      traitsPinned: isIn(pinned, t)
        ? pinned.filter((x) => !same(x, t))
        : [...pinned, t].slice(0, 8),
      traitsHidden: hidden.filter((x) => !same(x, t)),
    });
  const hideTrait = (t: string) =>
    void patchMe({
      traitsHidden: [...hidden.filter((x) => !same(x, t)), t].slice(-30),
      traitsPinned: pinned.filter((x) => !same(x, t)),
    });
  const showTrait = (t: string) =>
    void patchMe({ traitsHidden: hidden.filter((x) => !same(x, t)) });

  async function generate() {
    if (thinking || !canSave) return;
    setError("");
    setOpen(true);
    setThinking(true);
    try {
      const list = readings ?? (await loadReadings());
      const result = await selfReading(
        buildSelfDigest(workspace, me.profile, list),
      );
      await saveMyReading(result.reading, result.highlights);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setThinking(false);
    }
  }

  const newEntries = me.reading_at
    ? workspace.entries.filter((e) => e.created_at > me.reading_at!).length
    : 0;
  const newPeople = me.reading_at
    ? workspace.people.filter((p) => p.created_at > me.reading_at!).length
    : 0;
  const basis = selfBasis(workspace);
  const parts = paragraphs(me.reading);
  const past = me.profile.readingHistory ?? [];

  return (
    <section
      className={
        "mf-reading" + (open ? " open" : "") + (thinking ? " busy" : "")
      }
      aria-busy={thinking}
    >
      <div className="mf-reading-head">
        <button
          type="button"
          className="mf-reading-toggle"
          aria-expanded={open}
          aria-controls="mf-reading-body"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="mf-spark">
            <Sparkles size={16} />
          </span>
          <span className="mf-reading-title">
            <strong>Lectura de Nexo</strong>
            <small>
              {thinking
                ? STEPS[step]
                : me.reading_at
                  ? `Actualizada ${relativeDay(todayInputValue(new Date(me.reading_at))).toLowerCase()}`
                  : "Quién eres hoy, según todo lo que guardas"}
            </small>
            {!open && parts[0] && (
              <em className="mf-reading-peek">{parts[0]}</em>
            )}
          </span>
          <ChevronDown size={17} className="mf-chev" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="mf-gen"
          disabled={thinking || !canSave}
          title={me.reading ? "Pedir una lectura nueva" : "Generar tu lectura"}
          onClick={() => void generate()}
        >
          {thinking ? (
            <LoaderCircle className="spin" size={14} />
          ) : me.reading ? (
            <RefreshCw size={14} />
          ) : (
            <Sparkles size={14} />
          )}
          <span>
            {thinking ? "Leyendo…" : me.reading ? "Actualizar" : "Generar"}
          </span>
        </button>
      </div>

      {open && (
        <div className="mf-reading-body" id="mf-reading-body">
          {!thinking && me.reading && newEntries + newPeople > 0 && (
            <p className="mf-stale">
              Hay{" "}
              {[
                newEntries > 0 &&
                  `${newEntries} ${newEntries === 1 ? "recuerdo nuevo" : "recuerdos nuevos"}`,
                newPeople > 0 &&
                  `${newPeople} ${newPeople === 1 ? "persona nueva" : "personas nuevas"}`,
              ]
                .filter(Boolean)
                .join(" y ")}{" "}
              desde tu última lectura.
              <button
                type="button"
                disabled={!canSave}
                onClick={() => void generate()}
              >
                Actualizar ahora
              </button>
            </p>
          )}

          {thinking ? (
            <div className="mf-shimmer" aria-live="polite">
              <i />
              <i />
              <i />
              <i />
              <span key={step}>{STEPS[step]}</span>
            </div>
          ) : me.reading ? (
            <>
              <div className="mf-reading-text">
                {parts.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              {traits.length > 0 && (
                <div className="mf-traits">
                  {traits.map((t) => {
                    const fixed = isIn(pinned, t);
                    return (
                      <span key={t} className={fixed ? "pinned" : ""}>
                        {fixed && <Pin size={11} aria-label="Fijado" />}
                        {t}
                        <button
                          type="button"
                          disabled={!canSave}
                          title={
                            fixed
                              ? "Dejar de fijar"
                              : "Fijar: se conserva en las próximas lecturas"
                          }
                          aria-label={
                            fixed ? `Dejar de fijar «${t}»` : `Fijar «${t}»`
                          }
                          onClick={() => togglePin(t)}
                        >
                          <Pin size={12} />
                        </button>
                        <button
                          type="button"
                          disabled={!canSave}
                          title="No me representa: ocultarlo"
                          aria-label={`Ocultar «${t}»`}
                          onClick={() => hideTrait(t)}
                        >
                          <EyeOff size={12} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              {hiddenNow.length > 0 && (
                <div className="mf-hidden">
                  <button
                    type="button"
                    className="mf-add"
                    onClick={() => setShowHidden((v) => !v)}
                  >
                    {showHidden
                      ? "Esconder los ocultos"
                      : `${hiddenNow.length} ${hiddenNow.length === 1 ? "rasgo oculto" : "rasgos ocultos"}`}
                  </button>
                  {showHidden &&
                    hiddenNow.map((t) => (
                      <span key={t}>
                        {t}
                        <button
                          type="button"
                          disabled={!canSave}
                          aria-label={`Volver a mostrar «${t}»`}
                          title="Volver a mostrar"
                          onClick={() => showTrait(t)}
                        >
                          <Undo2 size={12} />
                        </button>
                      </span>
                    ))}
                </div>
              )}
            </>
          ) : (
            <p className="mf-reading-empty">
              Nexo lee a tu gente, tus recuerdos, tus lecturas y tus episodios,
              y escribe una descripción de quién eres hoy. Pídela cuando
              quieras: se actualiza con lo nuevo.
            </p>
          )}
          {error && (
            <p className="mf-error" role="alert">
              {error}
            </p>
          )}
          <small className="mf-basis">
            Con {basis.people} {basis.people === 1 ? "persona" : "personas"},{" "}
            {basis.entries} {basis.entries === 1 ? "recuerdo" : "recuerdos"},{" "}
            {basis.episodes} {basis.episodes === 1 ? "episodio" : "episodios"} y
            tus lecturas.
            {(me.profile.readingExclude?.length ?? 0) > 0 &&
              " Sin las partes que excluiste."}
          </small>

          {past.length > 0 && (
            <details className="mf-history">
              <summary>
                <History size={14} /> Lecturas anteriores ({past.length})
              </summary>
              <ol>
                {past.map((h) => (
                  <li key={h.at}>
                    <small>{longDate(h.at)}</small>
                    {h.highlights.length > 0 && (
                      <div className="mf-history-traits">
                        {h.highlights.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                    )}
                    {paragraphs(h.reading).map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
