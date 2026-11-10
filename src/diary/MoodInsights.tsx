import { useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  BedDouble,
  CalendarDays,
  Clock,
  CloudSun,
  Dumbbell,
  Hash,
  HeartHandshake,
  MapPin,
  MessageCircle,
  Phone,
  Sparkles,
  Sunrise,
  TrendingDown,
  TrendingUp,
  Users,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "../AppContext";
import { MoodIcon } from "../composer/controls";
import { moodOf } from "../composer/moods";
import { Sheet } from "../components/Sheet";
import type { Person } from "../data";
import { addDays } from "../lib/format";
import { Avatar } from "../people/Avatar";
import {
  dimLabel,
  fmt,
  reasonProof,
  toneNames,
  type Analysis,
  type CareSignal,
  type Dim,
  type Factor,
  type Insight,
  type Reason,
} from "./insights";
import "./insights.css";

const dimIcon: Record<Dim | "tendencia", LucideIcon> = {
  persona: Users,
  lugar: MapPin,
  dia: CalendarDays,
  momento: Clock,
  luz: Sunrise,
  clima: CloudSun,
  sueno: BedDouble,
  ejercicio: Dumbbell,
  compania: Users,
  etiqueta: Hash,
  causa: MessageCircle,
  tendencia: TrendingUp,
};

/** Cuántas entradas con ánimo hacen falta para empezar a notar cosas. */
export const NEEDED = 4;

/* ───────── En el panel: lo que tu diario nota ───────── */

export function InsightsCard({
  analysis,
  onOpen,
}: {
  analysis: Analysis;
  onOpen: () => void;
}) {
  const { workspace } = useApp();
  const top = analysis.insights.slice(0, 3);
  if (analysis.n < NEEDED) {
    const left = NEEDED - analysis.n;
    return (
      <section className="dy-ins learning" aria-label="Lo que tu diario nota">
        <span className="dy-ins-spark" aria-hidden="true">
          <Sparkles size={16} />
        </span>
        <div className="dy-ins-learn">
          <strong>Tu diario está aprendiendo de ti</strong>
          <p>
            Marca tu ánimo en{" "}
            {left === 1 ? "una entrada más" : `${left} entradas más`} y empezará
            a notar con quién, dónde y en qué días te sientes mejor. La hora, la
            luz y el clima se guardan solos.
          </p>
          <span className="dy-ins-progress" aria-hidden="true">
            <i style={{ width: `${(analysis.n / NEEDED) * 100}%` }} />
          </span>
        </div>
      </section>
    );
  }
  return (
    <section className="dy-ins" aria-label="Lo que tu diario nota">
      <header className="dy-ins-head">
        <span className="dy-ins-eyebrow">
          <Sparkles size={13} /> Tu diario nota
        </span>
        <button type="button" className="dy-ins-open" onClick={onOpen}>
          Mapa de ánimo <ArrowUpRight size={14} />
        </button>
      </header>
      {top.length ? (
        <ul className="dy-ins-list">
          {top.map((i) => (
            <InsightItem
              key={i.id}
              insight={i}
              person={workspace.people.find((p) => p.id === i.personId)}
            />
          ))}
        </ul>
      ) : (
        <p className="dy-ins-none">
          Tu ánimo está bastante parejo: nada se aleja mucho de tu media (
          {fmt(analysis.baseline)}). Sigue marcando con quién estás, dónde y
          cómo dormiste para ver más.
        </p>
      )}
    </section>
  );
}

function InsightItem({
  insight: i,
  person,
}: {
  insight: Insight;
  person?: Person;
}) {
  const Icon =
    i.dim === "tendencia" && i.dir === "down" ? TrendingDown : dimIcon[i.dim];
  return (
    <li className={"dy-ins-item " + i.dir}>
      {person ? (
        <Avatar person={person} size={30} />
      ) : (
        <span className="dy-ins-ic" aria-hidden="true">
          <Icon size={15} />
        </span>
      )}
      <div>
        <p>{i.text}</p>
        <small>{i.proof}</small>
      </div>
    </li>
  );
}

/* ───────── El mapa de ánimo ───────── */

type Tab =
  "resumen" | "personas" | "lugares" | "tiempo" | "cuerpo" | "etiquetas";
const TABS: { id: Tab; label: string; dims: Dim[] }[] = [
  { id: "resumen", label: "Resumen", dims: [] },
  { id: "personas", label: "Personas", dims: ["persona", "compania"] },
  { id: "lugares", label: "Lugares", dims: ["lugar"] },
  {
    id: "tiempo",
    label: "Días y cielo",
    dims: ["dia", "momento", "luz", "clima"],
  },
  { id: "cuerpo", label: "Cuerpo", dims: ["sueno", "ejercicio"] },
  { id: "etiquetas", label: "Etiquetas y causas", dims: ["etiqueta", "causa"] },
];

export function MoodMapSheet({
  analysis: a,
  onClose,
}: {
  analysis: Analysis;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("resumen");
  const tabs = TABS.filter(
    (t) => t.id === "resumen" || t.dims.some((d) => a.dims[d].length),
  );
  const current = TABS.find((t) => t.id === tab)!;
  return createPortal(
    <Sheet
      label="Mapa de ánimo"
      className="dyy dy-mm-sheet"
      onRequestClose={onClose}
    >
      <section className="dy-mm">
        <button
          type="button"
          className="dy-map-close"
          aria-label="Cerrar"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <header className="dy-mm-head">
          <span className="dy-map-eyebrow">Mapa de ánimo</span>
          <h3>Lo que mueve tu ánimo</h3>
          <p>
            Tu media es <b>{fmt(a.baseline)}</b> de 5 (
            {toneNames[Math.round(a.baseline)]}) en {a.n}{" "}
            {a.n === 1 ? "entrada" : "entradas"} con ánimo
            {a.trend && (
              <>
                {" · "}
                últimas dos semanas{" "}
                <b className={a.trend.recent >= a.trend.before ? "up" : "down"}>
                  {a.trend.recent >= a.trend.before ? "▲" : "▼"}{" "}
                  {fmt(a.trend.recent)}
                </b>
              </>
            )}
          </p>
          <div
            className="dy-seg dy-mm-tabs"
            role="tablist"
            aria-label="Qué cruzar con tu ánimo"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? "on" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </header>

        <div className="dy-mm-body" role="tabpanel">
          {tab === "resumen" ? (
            <Summary a={a} />
          ) : (
            current.dims
              .filter((d) => a.dims[d].length)
              .map((d) => (
                <DimBlock
                  key={d}
                  dim={d}
                  factors={a.dims[d]}
                  baseline={a.baseline}
                />
              ))
          )}
        </div>
        <footer className="dy-mm-foot">
          Son relaciones que aparecen en tu diario, no diagnósticos. Se calculan
          en tu dispositivo.{" "}
          {a.coverage.ctx > 0 &&
            `${a.coverage.ctx} entradas guardaron solas su hora y su luz`}
          {a.coverage.weather > 0 && `, ${a.coverage.weather} su clima`}
          {a.coverage.ctx > 0 && "."} Marcar cómo dormiste y si hiciste
          ejercicio afina el mapa.
        </footer>
      </section>
    </Sheet>,
    document.body,
  );
}

function Summary({ a }: { a: Analysis }) {
  const { workspace } = useApp();
  return (
    <div className="dy-mm-summary">
      <div>
        <h4>Lo que nota</h4>
        {a.insights.length ? (
          <ul className="dy-ins-list stack">
            {a.insights.slice(0, 8).map((i) => (
              <InsightItem
                key={i.id}
                insight={i}
                person={workspace.people.find((p) => p.id === i.personId)}
              />
            ))}
          </ul>
        ) : (
          <p className="dy-ins-none">
            Aún nada se aleja mucho de tu media. Con más entradas aparecerán
            patrones.
          </p>
        )}
      </div>
      <div>
        <h4>Posibles razones</h4>
        <ReasonList
          title="En tus días difíciles aparece más…"
          kind="difíciles"
          tone="down"
          data={a.low}
        />
        <ReasonList
          title="En tus días buenos aparece más…"
          kind="buenos"
          tone="up"
          data={a.high}
        />
      </div>
    </div>
  );
}

function ReasonList({
  title,
  kind,
  tone,
  data,
}: {
  title: string;
  kind: string;
  tone: "up" | "down";
  data: { n: number; reasons: Reason[] };
}) {
  return (
    <div className={"dy-why " + tone}>
      <h5>{title}</h5>
      {data.reasons.length ? (
        <ol>
          {data.reasons.map((r) => {
            const Icon = dimIcon[r.dim];
            return (
              <li key={r.dim + r.key}>
                <Icon size={13} aria-hidden="true" />
                <div>
                  <strong>{r.label}</strong>
                  <span className="dy-why-bar" aria-hidden="true">
                    <i style={{ width: `${r.share * 100}%` }} />
                    <b style={{ left: `${r.rest * 100}%` }} />
                  </span>
                  <small>{reasonProof(r, data.n, kind)}</small>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>
          {data.n < 2
            ? `Aún hay pocos días ${kind} para buscar razones.`
            : "Nada destaca todavía: esos días se parecen al resto."}
        </p>
      )}
    </div>
  );
}

const pos = (x: number) => `${((x - 1) / 4) * 100}%`;

function DimBlock({
  dim,
  factors,
  baseline,
}: {
  dim: Dim;
  factors: Factor[];
  baseline: number;
}) {
  const { workspace } = useApp();
  const [all, setAll] = useState(false);
  const list = all ? factors : factors.slice(0, 8);
  const Icon = dimIcon[dim];
  return (
    <section className="dy-dim">
      <h4>
        <Icon size={14} /> {dimLabel[dim]}
      </h4>
      <ul>
        {list.map((f) => {
          const person =
            f.personId && workspace.people.find((p) => p.id === f.personId);
          const mood = moodOf(f.mood);
          const lo = Math.min(f.mean, baseline);
          const hi = Math.max(f.mean, baseline);
          return (
            <li
              key={f.key}
              className={
                (f.n < 3 ? "few " : "") + (f.mean >= baseline ? "up" : "down")
              }
            >
              <span className="dy-dim-name">
                {person && <Avatar person={person} size={22} />}
                <span>
                  <strong>{dim === "dia" ? cap(f.label) : f.label}</strong>
                  <small>
                    {f.n} {f.n === 1 ? "entrada" : "entradas"}
                    {f.n < 3 && " · pocas aún"}
                  </small>
                </span>
              </span>
              <span
                className="dy-dim-track"
                style={{ "--base": pos(baseline) } as CSSProperties}
                aria-hidden="true"
              >
                <i
                  style={{
                    left: pos(lo),
                    width: `calc(${pos(hi)} - ${pos(lo)})`,
                  }}
                />
                <b style={{ left: pos(f.mean) }} />
              </span>
              <span
                className="dy-dim-val"
                title={toneNames[Math.round(f.mean)]}
              >
                {fmt(f.mean)}
              </span>
              <span className="dy-dim-mood">
                {mood && <MoodIcon mood={mood} size={20} solid />}
              </span>
            </li>
          );
        })}
      </ul>
      {factors.length > 8 && (
        <button
          type="button"
          className="dy-dim-more"
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Ver menos" : `Ver ${factors.length - 8} más`}
        </button>
      )}
    </section>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ───────── Nota cuidadosa ───────── */

const careKey = (uid: string) => `nexo:diary-care:${uid}`;
type CareSeen = { date: string; days: number; kind: CareSignal["kind"] };

function seenCare(uid: string): CareSeen | null {
  try {
    const raw = localStorage.getItem(careKey(uid));
    return raw ? (JSON.parse(raw) as CareSeen) : null;
  } catch {
    return null;
  }
}

/** Ya la cerraste hace poco y la racha no ha crecido: no se vuelve a mostrar. */
export function careHidden(uid: string, s: CareSignal, today: string) {
  const seen = seenCare(uid);
  if (!seen || seen.kind !== s.kind) return false;
  if (s.kind === "palabras") return seen.date >= s.since;
  return seen.date >= addDays(today, -4) && s.days < seen.days + 2;
}

export function CareNote({
  signal,
  analysis,
  today,
  onDone,
}: {
  signal: CareSignal;
  analysis: Analysis;
  today: string;
  onDone: () => void;
}) {
  const { user, workspace, peekPerson, openEntry } = useApp();
  const [breath, setBreath] = useState(false);
  const heavy = signal.kind === "palabras";
  // Lo que en tu propio diario te sube el ánimo: una persona y algo del cuerpo.
  const friend = useMemo(() => {
    const best = analysis.dims.persona
      .filter((f) => f.n >= 2 && f.delta > 0.15)
      .sort((x, y) => y.delta - x.delta)[0];
    return best && workspace.people.find((p) => p.id === best.personId);
  }, [analysis, workspace.people]);
  const body = useMemo(() => {
    const sleep = analysis.dims.sueno.find((f) => f.key === "bien");
    const moved = analysis.dims.ejercicio.find((f) => f.key === "si");
    if (sleep && sleep.n >= 2 && sleep.delta > 0.15)
      return "En tu diario, dormir bien te sube el ánimo: esta noche, intenta acostarte un poco antes.";
    if (moved && moved.n >= 2 && moved.delta > 0.15)
      return "Los días que te mueves te sientan mejor: una caminata corta de diez minutos ya cuenta.";
    return "Sal un rato a la luz del día o camina sin rumbo diez minutos; al cuerpo le ayuda.";
  }, [analysis]);

  const dismiss = () => {
    try {
      localStorage.setItem(
        careKey(user.id),
        JSON.stringify({
          date: today,
          days: signal.days,
          kind: signal.kind,
        } satisfies CareSeen),
      );
    } catch {
      /* Sin almacenamiento: solo se oculta por ahora. */
    }
    onDone();
  };

  return (
    <section
      className={"dy-care" + (heavy ? " heavy" : "")}
      aria-label="Una nota para ti"
    >
      <span className="dy-care-ic" aria-hidden="true">
        <HeartHandshake size={18} />
      </span>
      <div className="dy-care-main">
        <strong>
          {heavy
            ? "Gracias por poner en palabras lo que sientes"
            : "Llevas unos días cuesta arriba"}
        </strong>
        <p>
          {heavy
            ? "Algo de lo que escribiste hace poco suena muy pesado. No tienes que cargarlo en soledad: hablarlo con alguien ayuda, y hay personas preparadas para escucharte ahora mismo."
            : `Tus últimos ${signal.days} días escritos vienen con el ánimo bajo. No tiene por qué ser algo grave, pero vale la pena tratarte con un poco más de cuidado.`}
        </p>
        <ul className="dy-care-ideas">
          <li>
            <button
              type="button"
              onClick={() => setBreath((v) => !v)}
              aria-expanded={breath}
            >
              <Wind size={14} /> Respira un minuto
            </button>
          </li>
          {friend && (
            <li>
              <button type="button" onClick={() => peekPerson(friend)}>
                <Users size={14} /> Escríbele a {friend.name.split(" ")[0]}
              </button>
            </li>
          )}
          <li>
            <button type="button" onClick={() => openEntry("Nota", [])}>
              <MessageCircle size={14} /> Escribir sin filtro
            </button>
          </li>
        </ul>
        {breath && (
          <p className="dy-care-breath" role="status">
            <span className="dy-care-orb" aria-hidden="true" />
            Inhala por la nariz 4 segundos, sostén 4, suelta el aire despacio en
            6. Repite cinco veces.
          </p>
        )}
        <p className="dy-care-tip">
          {friend &&
            `Los días con ${friend.name.split(" ")[0]} sueles estar mejor. `}
          {body}
        </p>
        <details className="dy-care-help" open={heavy}>
          <summary>Si necesitas hablar con alguien</summary>
          <p>
            <a href="tel:106">
              <Phone size={13} /> Línea 106
            </a>{" "}
            escucha y orientación en salud mental: gratuita, confidencial y 24
            horas, en Colombia. Si estás en riesgo, llama al{" "}
            <a href="tel:123">
              <Phone size={13} /> 123
            </a>
            . Fuera de Colombia, busca la línea de apoyo de tu país.
          </p>
        </details>
      </div>
      <button
        type="button"
        className="dy-care-x"
        onClick={dismiss}
        title="Gracias, cerrar"
      >
        <X size={14} aria-label="Cerrar la nota" />
      </button>
    </section>
  );
}
