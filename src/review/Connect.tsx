import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  FileText,
  Layers,
  Lightbulb,
  Link2,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  Quote,
  RefreshCw,
  Share2,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { reviewSpark, type SparkIdea } from "../assistant";
import { useApp } from "../AppContext";
import type { Person } from "../data";
import { errorMessage, splitList, todayInputValue } from "../lib/format";
import { shareText, whatsappLink } from "../lib/interest";
import type { ReviewCard } from "./cards";
import type { Link, LinkType, Mode } from "./links";

const heads: Record<
  Exclude<Mode, "recordar">,
  { icon: LucideIcon; label: string }
> = {
  conectar: { icon: Link2, label: "Conecta con" },
  construir: { icon: Target, label: "Para tu proyecto" },
  idear: { icon: Lightbulb, label: "Ponla a trabajar" },
};

const kinds: Record<LinkType, { icon: LucideIcon; label: string }> = {
  proyecto: { icon: Target, label: "Proyecto" },
  tarea: { icon: ListChecks, label: "Pendiente" },
  episodio: { icon: Layers, label: "Episodio" },
  persona: { icon: Users, label: "Persona" },
  nota: { icon: FileText, label: "Nota" },
  cita: { icon: Quote, label: "Otra cita" },
};

const first = (name: string) => name.split(" ")[0];

/** Lo que se le pregunta a quien repasa, según con qué conecta. */
const asks: Record<LinkType, (l: Link) => string> = {
  proyecto: (l) => `¿Qué de esto cambiaría algo en «${l.title}»?`,
  tarea: () => "Puede darte otra manera de resolver este pendiente.",
  episodio: (l) => `¿Cómo se cruza con «${l.title}»?`,
  persona: (l) =>
    `¿Le servirá a ${first(l.title)}? Mándasela con un mensaje tuyo.`,
  nota: () => "Conversa con algo que ya habías escrito.",
  cita: () => "Dos ideas tuyas que se hablan entre sí.",
};

/**
 * Lo que aparece debajo de una tarjeta cuando el momento se da: con qué se conecta la idea y qué
 * hacer con eso. Se puede pedir una idea a la IA y guardarla como proyecto. Nada se hace solo.
 */
export function Connect({
  card,
  links,
  mode,
  onLeave,
  onSaved,
}: {
  card: ReviewCard;
  links: Link[];
  mode: Exclude<Mode, "recordar">;
  /** Cierra el repaso antes de abrir otra cosa (una ficha, un proyecto…). */
  onLeave: () => void;
  /** Se guardó una idea (para contarla al final del repaso). */
  onSaved: () => void;
}) {
  const {
    workspace,
    me,
    viewEntry,
    peekPerson,
    go,
    createEntry,
    patchEntry,
    notify,
  } = useApp();
  const [spark, setSpark] = useState<SparkIdea | null>(null);
  const [seen, setSeen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<"idea" | "paso" | null>(null);

  const head = heads[mode];
  const primary = links[0] as Link | undefined;
  const also = links[1] as Link | undefined;
  const source =
    card.from.title + (card.from.author ? ` · ${card.from.author}` : "");
  // Si es un proyecto sin próximo paso, la idea puede ser justamente ese paso.
  const project = primary?.type === "proyecto" ? primary.entry : undefined;
  const liveProject =
    project && (workspace.entries.find((e) => e.id === project.id) ?? project);
  const canStep = Boolean(
    spark?.step && liveProject && !liveProject.details.nextStep,
  );

  const ask = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const p = primary?.person;
      const out = await reviewSpark({
        idea: {
          texto: card.quote.slice(0, 900),
          de: card.from.title,
          autor: card.from.author,
          tipo:
            card.source === "cita"
              ? "cita de un libro"
              : card.source === "aprendizaje"
                ? "aprendizaje propio (lo que se llevó de un libro o una película)"
                : card.source === "palabra"
                  ? `palabra o concepto de su diccionario: «${card.word.term}»`
                  : card.source === "flashcard"
                    ? `flashcard de un artículo. Pregunta: «${card.card.front}». Respuesta: «${card.card.back}»`
                    : "resaltado de un artículo",
        },
        link: primary
          ? {
              tipo: primary.type,
              titulo: primary.title,
              detalle: primary.detail,
              palabras_en_comun:
                primary.type === "persona" ? undefined : primary.words,
              persona: p && {
                nombre: first(p.name),
                intereses: splitList(p.interests).slice(0, 6),
                le_gusta: p.profile.likes?.slice(0, 5),
                ocupacion: p.profile.occupation,
              },
            }
          : null,
        me: {
          metas: me.profile.goals?.slice(0, 5),
          intereses: me.profile.interests?.slice(0, 6),
          ocupacion: me.profile.occupation,
        },
        avoid: seen,
      });
      setSpark(out);
      setSeen((s) => [...s, out.idea]);
      setKept(null);
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** La idea queda como un proyecto en estado «idea», con la cita y lo que la inspiró. */
  const keepIdea = async () => {
    if (!spark || busy) return;
    setBusy(true);
    const person = primary?.type === "persona" ? primary.person : undefined;
    const saved = await createEntry(
      {
        title: spark.idea.slice(0, 180),
        body: [
          `«${card.quote.slice(0, 400)}» — ${source}`,
          spark.why && `Conecta: ${spark.why}`,
          spark.step && `Primer paso: ${spark.step}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        kind: "Trabajo",
        tags: ["idea"],
        personIds: person ? [person.id] : [],
        date: todayInputValue(),
        amount: 0,
        direction: "egreso",
        status: "pendiente",
        images: [],
        details: {
          stage: "idea",
          priority: "media",
          ...(spark.step && { nextStep: spark.step.slice(0, 200) }),
        },
        file: null,
        removeFile: false,
      },
      true,
    );
    setBusy(false);
    if (!saved) return;
    setKept("idea");
    onSaved();
    notify("Idea guardada en tus proyectos.");
  };

  const useAsStep = async () => {
    if (!spark || !liveProject || busy) return;
    setBusy(true);
    const ok = await patchEntry(liveProject, {
      details: { ...liveProject.details, nextStep: spark.step.slice(0, 200) },
    });
    setBusy(false);
    if (!ok) return;
    setKept("paso");
    notify(`Próximo paso definido en «${liveProject.title}».`);
  };

  const share = async (p: Person) => {
    const text = shareText(
      card.quote,
      source,
      "",
      `${first(p.name)}, esto me hizo pensar en ti:`,
    );
    const wa = whatsappLink(p.profile.phone, text);
    if (wa) {
      window.open(wa, "_blank", "noopener");
      return;
    }
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
      } catch {
        // Cancelado: no pasa nada.
      }
      return;
    }
    await navigator.clipboard?.writeText(text);
    notify(`Mensaje copiado: pégaselo a ${first(p.name)}.`);
  };

  const open = (l: Link) => {
    onLeave();
    if (l.person) peekPerson(l.person);
    else if (l.episode) go("Episodios", l.episode);
    else if (l.entry) viewEntry(l.entry);
  };

  const HeadIcon = head.icon;
  const PrimaryIcon = primary ? kinds[primary.type].icon : null;
  const AlsoIcon = also ? kinds[also.type].icon : null;

  return (
    <section className={"rv-link " + mode} aria-label={head.label}>
      <header className="rv-link-head">
        <HeadIcon size={13} /> {head.label}
      </header>

      {primary && PrimaryIcon ? (
        <>
          <div className="rv-link-row">
            <span className="rv-link-ico">
              <PrimaryIcon size={16} />
            </span>
            <span className="rv-link-text">
              <small>{kinds[primary.type].label}</small>
              <strong>{primary.title}</strong>
              <em>{primary.detail}</em>
              {primary.type !== "persona" && primary.words.length > 0 && (
                <span className="rv-link-words">
                  En común: {primary.words.join(" · ")}
                </span>
              )}
            </span>
          </div>
          <p className="rv-link-ask">{asks[primary.type](primary)}</p>
        </>
      ) : (
        <p className="rv-link-ask">
          Ya la dominas. ¿Dónde la pondrías a prueba esta semana?
        </p>
      )}

      {spark ? (
        <div className="rv-spark-out">
          <small>
            <Sparkles size={11} /> Idea
          </small>
          <p className="rv-spark-idea">{spark.idea}</p>
          {spark.step && (
            <p>
              <b>Primer paso:</b> {spark.step}
            </p>
          )}
          {spark.why && <p className="rv-spark-why">{spark.why}</p>}
          <div className="rv-link-actions">
            {kept ? (
              <span className="rv-kept">
                <Check size={13} />{" "}
                {kept === "idea"
                  ? "Guardada en tus proyectos"
                  : "Próximo paso listo"}
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="rv-spark"
                  disabled={busy}
                  onClick={() => void keepIdea()}
                >
                  <Lightbulb size={14} /> Guardar idea
                </button>
                {canStep && (
                  <button
                    type="button"
                    className="rv-ghost"
                    disabled={busy}
                    onClick={() => void useAsStep()}
                  >
                    <Target size={13} /> Usar como próximo paso
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              className="rv-ghost"
              disabled={busy}
              onClick={() => void ask()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={13} />
              ) : (
                <RefreshCw size={13} />
              )}{" "}
              Otra
            </button>
          </div>
        </div>
      ) : (
        <div className="rv-link-actions">
          <button
            type="button"
            className="rv-spark"
            disabled={busy}
            onClick={() => void ask()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Sparkles size={14} />
            )}{" "}
            Sacarle una idea
          </button>
          {primary?.person ? (
            <>
              <button
                type="button"
                className="rv-ghost"
                onClick={() => void share(primary.person!)}
              >
                {primary.person.profile.phone ? (
                  <MessageCircle size={13} />
                ) : (
                  <Share2 size={13} />
                )}{" "}
                Compartirle
              </button>
              <button
                type="button"
                className="rv-ghost"
                onClick={() => open(primary)}
              >
                Ver ficha
              </button>
            </>
          ) : (
            primary && (
              <button
                type="button"
                className="rv-ghost"
                onClick={() => open(primary)}
              >
                Abrir <ArrowUpRight size={13} />
              </button>
            )
          )}
        </div>
      )}

      {also && AlsoIcon && (
        <button
          type="button"
          className="rv-link-also"
          onClick={() => open(also)}
        >
          <AlsoIcon size={13} />
          <span>
            También con <b>{also.title}</b>
          </span>
          <ArrowUpRight size={12} />
        </button>
      )}
    </section>
  );
}
