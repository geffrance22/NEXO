import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AtSign,
  BookOpen,
  Briefcase,
  Check,
  CheckCheck,
  CircleCheck,
  Clapperboard,
  GraduationCap,
  HandHeart,
  Info,
  Lightbulb,
  ListTodo,
  LoaderCircle,
  MapPin,
  MessageCircleQuestion,
  Smile,
  Sparkles,
  UserPlus,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "../../AppContext";
import { Sheet } from "../../components/Sheet";
import { MoodIcon, moodOf } from "../../composer/moods";
import { errorMessage, thousands } from "../../lib/format";
import type { DiaryPiece, DiaryReading } from "./pieces";
import { saveReading } from "./saveReading";
import "./reader.css";

/** Una entrada recién guardada que la IA está leyendo en segundo plano. */
export type DiaryJob = {
  entryId: string;
  title: string;
  reading: Promise<DiaryReading>;
};

type Meta = { label: string; icon: LucideIcon; color: string };

/**
 * Lectura de una entrada del diario. Mientras la IA lee, una tarjeta pequeña lo dice en una
 * esquina; cuando termina, se abre la propuesta (la entrada ya está guardada: descartarla no la
 * toca). Si hay otra ventana abierta, la tarjeta espera a que la abras tú.
 */
export function DiaryReader({
  job,
  hold,
  onDone,
}: {
  job: DiaryJob;
  /** Hay otra ventana abierta: no se abre la propuesta sola. */
  hold: boolean;
  onDone: () => void;
}) {
  const app = useApp();
  const { workspace, notify } = app;
  const [state, setState] = useState<"reading" | "ready" | "empty">("reading");
  const [summary, setSummary] = useState("");
  const [pieces, setPieces] = useState<DiaryPiece[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);

  useEffect(() => {
    let alive = true;
    job.reading
      .then((r) => {
        if (!alive) return;
        setSummary(r.summary);
        setPieces(r.pieces);
        setState(r.pieces.length ? "ready" : "empty");
      })
      .catch((e) => {
        if (!alive) return;
        notify(`Tu entrada quedó guardada. La IA no pudo leerla: ${errorMessage(e)}`);
        onDone();
      });
    return () => {
      alive = false;
    };
    // Solo al empezar la lectura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.reading]);

  // Nada que proponer: la tarjeta lo dice un momento y se va.
  useEffect(() => {
    if (state !== "empty") return;
    const t = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(t);
  }, [state, onDone]);

  // Lista: se abre sola (una vez) si no hay otra ventana encima.
  useEffect(() => {
    if (state === "ready" && !hold && !autoOpened) {
      setAutoOpened(true);
      setOpen(true);
    }
  }, [state, hold, autoOpened]);

  const nameOf = (id: string | null) =>
    workspace.people.find((p) => p.id === id)?.name ?? "";
  const first = (id: string | null) => nameOf(id).split(" ")[0];
  const set = (id: string, patch: Partial<DiaryPiece>) =>
    setPieces((list) =>
      list.map((p) => (p.id === id ? ({ ...p, ...patch } as DiaryPiece) : p)),
    );
  const chosen = pieces.filter((p) => p.on).length;

  const save = async () => {
    if (!chosen || saving) return;
    setSaving(true);
    try {
      const n = await saveReading(job.entryId, pieces, app);
      notify(
        n
          ? `Listo: ${n} ${n === 1 ? "pieza conectada" : "piezas conectadas"} desde tu entrada.`
          : "No se guardó ninguna pieza.",
      );
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setSaving(false);
      onDone();
    }
  };

  if (!open)
    return (
      <div className={"dr-float " + state} role="status" aria-live="polite">
        <span className="dr-float-icon">
          {state === "reading" ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Sparkles size={16} />
          )}
        </span>
        <span className="dr-float-text">
          {state === "reading" ? (
            <>
              <b>Leyendo tu entrada…</b>
              <small>Ya quedó guardada</small>
            </>
          ) : state === "empty" ? (
            <>
              <b>Nada más que conectar</b>
              <small>Tu entrada quedó guardada</small>
            </>
          ) : (
            <>
              <b>
                {pieces.length} {pieces.length === 1 ? "pieza propuesta" : "piezas propuestas"}
              </b>
              <small>De «{job.title.slice(0, 40)}»</small>
            </>
          )}
        </span>
        {state === "ready" && (
          <button type="button" className="dr-float-go" onClick={() => setOpen(true)}>
            Revisar
          </button>
        )}
        <button
          type="button"
          className="dr-float-x"
          aria-label="Descartar la lectura"
          onClick={onDone}
        >
          <X size={14} />
        </button>
      </div>
    );

  return (
    // Tocar fuera (o Esc) no descarta: la propuesta se minimiza a la barra flotante, con lo que
    // ya ajustaste, hasta que la guardes o la cierres.
    <Sheet
      label="Lo que Nexo leyó en tu entrada"
      className="dr"
      onRequestClose={() => {
        if (!saving) setOpen(false);
      }}
    >
      <header className="dr-head">
        <span className="dr-head-icon">
          <Sparkles size={18} />
        </span>
        <div>
          <h2>Nexo leyó tu entrada</h2>
          <p>{summary || "Esto es lo que se puede conectar con el resto de tu memoria."}</p>
        </div>
        <button type="button" className="cp-close" aria-label="Cerrar" onClick={onDone}>
          <X size={20} />
        </button>
      </header>
      <p className="dr-note">
        <Check size={13} /> «{job.title.slice(0, 60)}» ya está en tu diario. Elige qué más
        guardar y ajústalo si hace falta.
      </p>

      <div className="dr-list">
        {pieces.map((p) => (
          <PieceRow
            key={p.id}
            piece={p}
            meta={metaOf(p, first)}
            onToggle={(on) => set(p.id, { on })}
          >
            <PieceEdit piece={p} set={(patch) => set(p.id, patch)} nameOf={nameOf} />
          </PieceRow>
        ))}
      </div>

      <footer className="dr-foot">
        <button type="button" className="cp-btn ghost" onClick={onDone} disabled={saving}>
          Descartar
        </button>
        <button
          type="button"
          className="cp-btn cta"
          disabled={!chosen || saving}
          onClick={() => void save()}
        >
          {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
          {chosen ? `Guardar ${chosen} ${chosen === 1 ? "pieza" : "piezas"}` : "Nada elegido"}
        </button>
      </footer>
    </Sheet>
  );
}

function metaOf(p: DiaryPiece, first: (id: string | null) => string): Meta {
  switch (p.kind) {
    case "cumplido":
      return { label: "Pendiente cumplido", icon: CheckCheck, color: "#4f8a4a" };
    case "tarea":
      return p.done
        ? { label: "Hecho", icon: CircleCheck, color: "#4f8a4a" }
        : { label: "Por hacer", icon: ListTodo, color: "#c0674a" };
    case "avance":
      return {
        label: p.workId ? "Avance de proyecto" : "Proyecto nuevo",
        icon: Briefcase,
        color: "#4d7b9d",
      };
    case "obra":
      return {
        label: p.mediaId ? "En tu Libroteca" : p.media === "Libro" ? "Libro nuevo" : p.series ? "Serie nueva" : "Película nueva",
        icon: p.media === "Libro" ? BookOpen : Clapperboard,
        color: p.media === "Libro" ? "#b08843" : "#6b75b8",
      };
    case "novedad":
      return { label: `Novedad de ${first(p.personId)}`, icon: Sparkles, color: "#8a6fa8" };
    case "dato":
      return { label: `Dato de ${first(p.personId)}`, icon: Info, color: "#8a6fa8" };
    case "preguntar":
      return { label: `Preguntarle a ${first(p.personId)}`, icon: MessageCircleQuestion, color: "#8a6fa8" };
    case "intercambio":
      return {
        label: p.dir === "dar" ? `Le diste a ${first(p.personId)}` : `Te dio ${first(p.personId)}`,
        icon: HandHeart,
        color: "#c0674a",
      };
    case "movimiento":
      return { label: p.direction === "ingreso" ? "Ingreso" : "Gasto", icon: Wallet, color: "#3f8f7a" };
    case "aprendizaje":
      return { label: "Aprendizaje", icon: GraduationCap, color: "#5b66d6" };
    case "idea":
      return { label: "Idea", icon: Lightbulb, color: "#e09b0b" };
    case "vincular":
      return { label: "Vincular a la entrada", icon: AtSign, color: "#5f8247" };
    case "persona":
      return { label: "Persona nueva", icon: UserPlus, color: "#5f8247" };
    case "lugar":
      return { label: "Dónde pasó", icon: MapPin, color: "#5f8247" };
    case "animo":
      return { label: "Cómo te sentiste", icon: Smile, color: "#e09b0b" };
  }
}

function PieceRow({
  piece,
  meta,
  onToggle,
  children,
}: {
  piece: DiaryPiece;
  meta: Meta;
  onToggle: (on: boolean) => void;
  children: ReactNode;
}) {
  const Icon = meta.icon;
  return (
    <article
      className={"dr-piece" + (piece.on ? "" : " off")}
      style={{ "--c": meta.color } as CSSProperties}
    >
      <label className="dr-check" title={piece.on ? "Se guardará" : "No se guardará"}>
        <input
          type="checkbox"
          checked={piece.on}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span aria-hidden="true">
          <Check size={13} />
        </span>
      </label>
      <div className="dr-piece-body">
        <span className="dr-kind">
          <Icon size={13} /> {meta.label}
        </span>
        {children}
        {piece.evidence && <q className="dr-evidence">{piece.evidence}</q>}
      </div>
    </article>
  );
}

/** Lo que se puede ajustar (y hacia dónde dirigir) cada pieza. */
function PieceEdit({
  piece: p,
  set,
  nameOf,
}: {
  piece: DiaryPiece;
  set: (patch: Partial<DiaryPiece>) => void;
  nameOf: (id: string | null) => string;
}) {
  const text = (value: string, onChange: (v: string) => void, label: string, max = 180) => (
    <input
      className="dr-input"
      value={value}
      maxLength={max}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  const seg = <T extends string>(
    value: T,
    options: readonly (readonly [T, string])[],
    onChange: (v: T) => void,
    label: string,
  ) => (
    <span className="dr-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === v}
          key={v}
          className={value === v ? "on" : ""}
          onClick={() => onChange(v)}
        >
          {l}
        </button>
      ))}
    </span>
  );
  const people = useMemo(
    () =>
      p.kind === "tarea"
        ? [...new Set([...(p.personId ? [p.personId] : []), ...p.peopleIds])].map(nameOf).filter(Boolean)
        : [],
    [p, nameOf],
  );

  switch (p.kind) {
    case "cumplido":
      return <strong className="dr-title">{p.title}</strong>;
    case "tarea":
      return (
        <>
          {text(p.title, (title) => set({ title }), "Qué")}
          <span className="dr-row">
            {seg(p.done ? "si" : "no", [["si", "Ya lo hice"], ["no", "Por hacer"]] as const, (v) => set({ done: v === "si" }), "Estado")}
            {!p.done && (
              <input
                type="date"
                className="dr-date"
                value={p.due}
                aria-label="Para cuándo"
                onChange={(e) => set({ due: e.target.value })}
              />
            )}
            {people.length > 0 && <small className="dr-people">Con {people.join(", ")}</small>}
          </span>
        </>
      );
    case "avance":
      return (
        <>
          {p.workId ? <strong className="dr-title">{p.title}</strong> : text(p.title, (title) => set({ title }), "Proyecto")}
          <span className="dr-row">
            {seg(p.stage, [["idea", "Idea"], ["curso", "En curso"], ["pausa", "En pausa"], ["listo", "Listo"]] as const, (stage) => set({ stage }), "Etapa")}
          </span>
          <input
            className="dr-input soft"
            value={p.nextStep}
            maxLength={200}
            placeholder="Lo que sigue (opcional)"
            aria-label="Lo que sigue"
            onChange={(e) => set({ nextStep: e.target.value })}
          />
        </>
      );
    case "obra":
      return (
        <>
          {p.mediaId ? <strong className="dr-title">{p.title}</strong> : text(p.title, (title) => set({ title }), "Título")}
          <span className="dr-row">
            {seg(
              p.status,
              [["quiero", p.media === "Libro" ? "Quiero leerlo" : "Quiero verla"], ["curso", p.media === "Libro" ? "Leyendo" : "Viendo"], ["listo", "Terminado"]] as const,
              (status) => set({ status }),
              "Estado",
            )}
          </span>
        </>
      );
    case "novedad":
    case "preguntar":
      return text(p.text, (t) => set({ text: t }), "Texto", 500);
    case "dato":
      return (
        <span className="dr-row">
          {p.field === "fact" && <small className="dr-people">{p.label || "Dato"}:</small>}
          {p.field === "likes" && <small className="dr-people">Le gusta:</small>}
          {p.field === "dislikes" && <small className="dr-people">No le gusta:</small>}
          {p.field === "gifts" && <small className="dr-people">Idea de regalo:</small>}
          {p.field === "birthday" && <small className="dr-people">Cumpleaños (MM-DD):</small>}
          {text(p.value, (value) => set({ value }), "Valor", 80)}
        </span>
      );
    case "intercambio":
      return (
        <>
          {text(p.note, (note) => set({ note }), "Qué fue", 200)}
          <span className="dr-row">
            {seg(p.dir, [["dar", "Diste"], ["recibir", "Recibiste"]] as const, (dir) => set({ dir }), "Dirección")}
          </span>
        </>
      );
    case "movimiento":
      return (
        <span className="dr-row">
          <input
            className="dr-input amount"
            inputMode="numeric"
            value={thousands(p.amount)}
            aria-label="Monto"
            onChange={(e) => set({ amount: Number(e.target.value.replace(/\D/g, "")) || 0 })}
          />
          {text(p.title, (title) => set({ title }), "Concepto", 120)}
        </span>
      );
    case "aprendizaje":
      return text(p.title, (title) => set({ title }), "Aprendizaje");
    case "idea":
      return (
        <>
          {text(p.title, (title) => set({ title }), "Idea")}
          <span className="dr-row">
            {seg(p.project ? "p" : "n", [["n", "Como nota"], ["p", "Como proyecto"]] as const, (v) => set({ project: v === "p" }), "Dónde guardarla")}
          </span>
        </>
      );
    case "vincular":
      return <strong className="dr-title">{nameOf(p.personId)}</strong>;
    case "persona":
      return (
        <>
          {text(p.name, (name) => set({ name }), "Nombre", 120)}
          {p.note && <small className="dr-people">{p.note}</small>}
        </>
      );
    case "lugar":
      return <strong className="dr-title">{p.placeName}</strong>;
    case "animo":
      return (
        <span className="dr-moods">
          {p.feelings.map((f) => {
            const m = moodOf(f.mood);
            return m ? (
              <span key={f.mood} className="dr-mood">
                <MoodIcon mood={m} size={20} solid /> {m.label}
                {f.why && <small> · {f.why}</small>}
              </span>
            ) : null;
          })}
        </span>
      );
  }
}
