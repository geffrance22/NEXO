import { useMemo, useState } from "react";
import {
  AtSign,
  BedDouble,
  Dumbbell,
  Hash,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { askEntry } from "../../assistant";
import { clampWhere, whereAmI } from "../../diary/where";
import { DateChips } from "../DateChips";
import { PeopleField, PlaceField, useLinks } from "../LinkFields";
import { moodOf } from "../moods";
import { feelingsOf, MoodTrio, type Feeling } from "../MoodTrio";
import { PhotoButton, PhotoStrip } from "../PhotoBlocks";
import { RichTextarea } from "../RichTextarea";
import { TagInput } from "../TagInput";
import { historyKeys, useTextHistory } from "../useTextHistory";
import { DocBlock, type ViewProps } from "./shared";

/** Preguntas para empezar según cómo te sientes (mientras la hoja sigue en blanco). */
const MOOD_PROMPTS: Record<string, string[]> = {
  alegre: [
    "¿Qué te alegró el día?",
    "Cuenta ese momento que te hizo reír…",
    "¿A quién le contarías esto primero?",
  ],
  poderoso: [
    "¿Qué lograste hoy?",
    "¿Qué te hizo sentir imparable?",
    "Anota lo que hiciste bien, para no olvidarlo",
  ],
  inspirado: [
    "¿Qué idea te ronda?",
    "¿Qué te encendió la chispa hoy?",
    "Escríbela antes de que se escape…",
  ],
  reflexivo: [
    "¿En qué has estado pensando?",
    "¿Qué entendiste hoy que antes no veías?",
    "Una pregunta que te quedó dando vueltas…",
  ],
  nostalgico: [
    "¿Qué recuerdo volvió hoy?",
    "¿A quién o qué extrañas?",
    "Cuéntale a tu yo de antes…",
  ],
  neutral: [
    "Un día tranquilo también se cuenta: ¿qué pasó?",
    "¿Qué hiciste hoy, a grandes rasgos?",
    "Lo de siempre… ¿o hubo algo distinto?",
  ],
  cansado: [
    "¿Qué te quitó la energía hoy?",
    "¿Qué necesitas para descansar de verdad?",
    "Suelta aquí lo que pesa, sin orden…",
  ],
  inquieto: [
    "¿Qué te tiene inquieto?",
    "¿Qué es lo que más te preocupa ahora?",
    "Ponlo en palabras: ¿qué podría salir bien?",
  ],
  triste: [
    "¿Qué pasó? Aquí puedes contarlo con calma",
    "¿Qué te dolió hoy?",
    "¿Qué te haría sentir un poco mejor?",
  ],
  enojado: [
    "¿Qué te hizo enojar?",
    "Desahógate: nadie más lo va a leer",
    "¿Qué te habría gustado decir?",
  ],
};

/** Cómo dormiste anoche (se cruza con tu ánimo en el mapa del diario). */
const SLEEP = [
  ["poco", "Poco"],
  ["regular", "Regular"],
  ["bien", "Bien"],
] as const;

/** Frases cortas para invitar a escribir; cada vez sale una distinta. */
const PROMPTS = [
  "¿Cómo estuvo tu día?",
  "¿Qué te hizo sonreír hoy?",
  "Escribe sin pensarlo mucho…",
  "¿Qué te ronda la cabeza?",
  "Un momento de hoy para recordar",
  "¿Cómo empezó tu día?",
  "Lo pequeño también cuenta…",
  "¿Qué aprendiste hoy?",
  "Si hoy fuera un capítulo…",
  "¿En quién pensaste hoy?",
  "Respira y escribe lo que sientes",
  "¿Qué agradeces hoy?",
  "Lo que no dijiste en voz alta…",
  "¿Qué te sorprendió hoy?",
  "Hoy, en pocas palabras…",
  "¿Qué quieres recordar de esta semana?",
];

/**
 * Entrada del diario: una hoja en blanco para escribir sin distracciones. Al seleccionar texto
 * puedes preguntarle o pedirle algo a la IA sobre ese fragmento. Lo demás aparece cuando lo necesitas.
 */
export function NoteView({ c }: ViewProps) {
  const links = useLinks(c);
  const history = useTextHistory(c.body, c.setBody);
  const [showTags, setShowTags] = useState(c.tags.length > 0);
  const [prompt] = useState(
    () => PROMPTS[Math.floor(Math.random() * PROMPTS.length)],
  );
  // Una tirada al azar por vista: cada ánimo muestra siempre la misma pregunta mientras escribes.
  const [seed] = useState(() => Math.floor(Math.random() * 3));
  const feelings = feelingsOf(c.details);
  const setFeelings = (next: Feeling[]) => {
    c.setDetail("feelings", next.length ? next : undefined);
    c.setDetail("mood", next[0]?.mood);
  };
  // La hoja en blanco pregunta según el último ánimo que elegiste.
  const lastMood = moodOf(feelings[feelings.length - 1]?.mood);
  const placeholder = useMemo(() => {
    const list = lastMood && MOOD_PROMPTS[lastMood.key];
    return list ? list[seed % list.length] : prompt;
  }, [lastMood, seed, prompt]);
  const [locating, setLocating] = useState(false);
  const [whereError, setWhereError] = useState("");
  const locate = async () => {
    if (locating) return;
    setLocating(true);
    setWhereError("");
    try {
      c.setDetail("where", clampWhere(await whereAmI()));
    } catch (e) {
      setWhereError(e instanceof Error ? e.message : "No se pudo ubicar.");
      window.setTimeout(() => setWhereError(""), 4000);
    } finally {
      setLocating(false);
    }
  };
  const words = c.body.trim() ? c.body.trim().split(/\s+/).length : 0;
  const hasPeople =
    c.people.selected.length > 0 ||
    c.people.suggested.length > 0 ||
    c.people.cues.length > 0;
  const hasPlace = Boolean(c.details.place);
  const actions = {
    ...links.actions,
    ask: (selection: string, prompt: string) =>
      askEntry({ selection, prompt, text: c.body, title: c.title }),
  };

  return (
    <div className="cp-note">
      <div className="cp-title-wrap">
        <input
          className="cp-title-input"
          maxLength={180}
          value={c.title}
          onChange={(e) => c.setTitle(e.target.value)}
          aria-label="Título (opcional)"
        />
        {!c.title && (
          <span className="cp-title-ph" aria-hidden="true">
            Título <small>opcional</small>
          </span>
        )}
      </div>
      <div className="cp-note-page">
        <RichTextarea
          className="cp-writing"
          minRows={9}
          label="Tu entrada"
          placeholder={placeholder}
          value={c.body}
          onChange={c.setBody}
          names={links.names}
          actions={actions}
          history={history}
          autoFocusTarget
        />
      </div>
      {(hasPeople || hasPlace) && (
        <div className="lf-row">
          {hasPeople && <PeopleField c={c} links={links} compact />}
          {hasPlace && <PlaceField c={c} links={links} />}
        </div>
      )}
      {c.uploads.items.length > 0 ? (
        <PhotoStrip uploads={c.uploads} visible={3} />
      ) : (
        c.uploads.notice && <p className="cp-notice">{c.uploads.notice}</p>
      )}
      <div className="cp-note-mood">
        <span>¿Cómo te sientes?</span>
        <MoodTrio value={feelings} onChange={setFeelings} />
      </div>
      <div className="cp-note-body" role="group" aria-label="Tu cuerpo hoy">
        <BedDouble size={15} aria-hidden="true" />
        <span>Anoche dormiste</span>
        <span className="cp-sleep" role="radiogroup" aria-label="Cómo dormiste">
          {SLEEP.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={c.details.sleep === id}
              className={c.details.sleep === id ? "on" : ""}
              onClick={() =>
                c.setDetail("sleep", c.details.sleep === id ? undefined : id)
              }
            >
              {label}
            </button>
          ))}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={c.details.exercise === true}
          className={"cp-move" + (c.details.exercise ? " on" : "")}
          onClick={() =>
            c.setDetail("exercise", c.details.exercise ? undefined : true)
          }
        >
          <Dumbbell size={14} aria-hidden="true" />
          Hice ejercicio
        </button>
      </div>
      <div className="cp-tray">
        <PhotoButton uploads={c.uploads} label="Foto" />
        <button
          type="button"
          className={"cp-tray-btn" + (hasPeople ? " on" : "")}
          onClick={links.openPeople}
        >
          <AtSign size={17} />
          Personas
          {c.people.selected.length > 0 && <b>{c.people.selected.length}</b>}
        </button>
        <button
          type="button"
          className={"cp-tray-btn" + (hasPlace ? " on" : "")}
          onClick={links.openPlace}
          title="Un lugar del que hablas en la entrada"
        >
          <MapPin size={17} />
          Lugar
        </button>
        <button
          type="button"
          className={"cp-tray-btn" + (showTags ? " on" : "")}
          onClick={() => setShowTags((v) => !v)}
          aria-expanded={showTags}
        >
          <Hash size={17} />
          Etiquetas
          {c.tags.length > 0 && <b>{c.tags.length}</b>}
        </button>
        <span className="cp-tray-spacer" />
        <span
          className="cp-history"
          role="group"
          aria-label="Historial de la entrada"
        >
          <button
            type="button"
            className="cp-history-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={history.undo}
            disabled={!history.canUndo}
            title={`Deshacer (${historyKeys.undo})`}
            aria-label="Deshacer"
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="cp-history-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={history.redo}
            disabled={!history.canRedo}
            title={`Rehacer (${historyKeys.redo})`}
            aria-label="Rehacer"
          >
            <Redo2 size={16} />
          </button>
        </span>
        <span className="cp-count">
          {words} {words === 1 ? "palabra" : "palabras"}
        </span>
      </div>
      {showTags && <TagInput tags={c.tags} onChange={c.setTags} />}
      <div className="cp-note-foot">
        <div className="cp-note-when">
          <span>Fecha</span>
          <DateChips
            label="Fecha"
            options={["today", "yesterday"]}
            value={c.date}
            onChange={c.setDate}
          />
          {c.details.where ? (
            <span className="cp-where" title="Desde dónde escribes esta entrada">
              <LocateFixed size={13} />
              {c.details.where}
              <button
                type="button"
                aria-label="Quitar desde dónde escribes"
                onClick={() => c.setDetail("where", undefined)}
              >
                <X size={12} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={"cp-where-btn" + (locating ? " busy" : "")}
              onClick={() => void locate()}
              aria-label="Poner desde dónde escribes"
              title="Poner desde dónde escribes (tu ubicación ahora)"
              disabled={locating}
            >
              {locating ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <LocateFixed size={15} />
              )}
            </button>
          )}
          {whereError && (
            <small className="cp-where-error" role="status">
              {whereError}
            </small>
          )}
        </div>
        <DocBlock c={c} />
      </div>
      {links.dialogs}
    </div>
  );
}
