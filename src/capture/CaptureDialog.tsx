import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Info,
  Layers,
  LoaderCircle,
  Network,
  Quote,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { captureWithAssistant } from "../assistant";
import { Sheet } from "../components/Sheet";
import type { CommitmentKind, Episode, EpisodeKind, UpdateKind } from "../data";
import {
  adoptExisting,
  captureLessons,
  paragraphs,
  planFromAi,
  planNotes,
  pieceName,
  proposeBatch,
  splitExperiences,
  swapPerson,
  type CapturePlan,
  type KinLink,
  type Piece,
} from "../lib/capture";
import { learnFromCapture } from "../lib/captureMemory";
import { exchangeKinds } from "../lib/people";
import { MoodPicker, Stars, moods } from "../composer/controls";
import type { ExchangeKind } from "../data";
import { cueOptions } from "../lib/recognize";
import { genderOf } from "../lib/gender";
import { ME, kinCall, tiesOf } from "../lib/relations";
import { commitmentKindList, commitmentKinds } from "../lib/commitments";
import { episodeKindList, episodeKinds } from "../lib/episodes";
import { errorMessage, thousands, todayInputValue } from "../lib/format";
import { updateKindList, updateKinds } from "../lib/updates";
import { expenseCategories, incomeCategories } from "../composer/logic";
import { Avatar } from "../people/Avatar";
import { CaptureHelp } from "./CaptureHelp";
import { metaOf } from "./meta";
import {
  CapturePeople,
  PeopleField,
  PersonField,
  PickDialog,
  PlaceField,
  personCounts,
  personItems,
  type PersonOpt,
} from "./Pickers";
import { newShared, peopleOf, saveCapture } from "./saveCapture";
import "./capture.css";

const platforms = [
  "Cine",
  "Netflix",
  "Prime Video",
  "Disney+",
  "Max",
  "Apple TV",
  "YouTube",
];
const learnSources = [
  "Libro",
  "Curso",
  "Video",
  "Artículo",
  "Persona",
  "Práctica",
];
const factFields = [
  ["likes", "Le gusta"],
  ["dislikes", "No le gusta"],
  ["gifts", "Idea de regalo"],
  ["birthday", "Cumpleaños"],
  ["fact", "Otro dato"],
] as const;
const activities = [
  "Café",
  "Comida",
  "Fiesta",
  "Visita",
  "Paseo",
  "Viaje",
  "Llamada",
  "Videollamada",
  "Trabajo",
  "Deporte",
];
/** Avisos visibles antes de «Ver más». */
const NOTES_SHOWN = 3;

/**
 * Captura una experiencia en texto libre y deja que Nexo proponga sus piezas: el encuentro, el
 * gasto, la novedad, el compromiso, la conexión… Antes de guardar puedes corregir o excluir cada
 * una. Todas quedan enlazadas entre sí (en un episodio) y al texto original. Si el texto cuenta
 * varias experiencias (separadas por «---», párrafos con su fecha o una lista), se proponen y se
 * guardan por separado.
 */
export function CaptureDialog({
  initialText = "",
  people: preset = [],
  onClose,
}: {
  initialText?: string;
  people?: string[];
  onClose: () => void;
}) {
  const app = useApp();
  const { workspace, confirm, notify, go } = app;
  const [text, setText] = useState(initialText);
  const [plans, setPlans] = useState<CapturePlan[] | null>(null);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [help, setHelp] = useState(false);
  /** Experiencias ya afinadas con IA (para no gastar otra consulta sin querer). */
  const [refined, setRefined] = useState<Set<number>>(new Set());
  /** Separar en varias experiencias: null = lo decide Nexo. */
  const [split, setSplit] = useState<boolean | null>(null);
  const [allNotes, setAllNotes] = useState(false);
  /** Lo que Nexo propuso al principio (para aprender de lo que corriges). */
  const initial = useRef<CapturePlan[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const plan = plans?.[Math.min(at, plans.length - 1)] ?? null;

  useEffect(() => {
    if (plans) return;
    const t = window.setTimeout(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 60);
    return () => window.clearTimeout(t);
  }, [plans]);

  // El campo crece con el texto (hasta un tope; luego hace scroll).
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 280;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? "auto" : "hidden";
  }, [text, plans]);

  const partsOf = (t: string) => {
    if (split === false) return [t.trim()];
    const auto = splitExperiences(t);
    if (split === true) return auto.length > 1 ? auto : paragraphs(t);
    return auto;
  };

  // Vista previa en vivo (con un respiro mientras escribes): piezas, avisos y ánimo.
  const deferred = useDeferredValue(text);
  const autoParts = useMemo(() => splitExperiences(deferred), [deferred]);
  const canSplit = autoParts.length > 1 || paragraphs(deferred).length > 1;
  const drafts = useMemo(
    () =>
      deferred.trim().length > 8
        ? proposeBatch(partsOf(deferred), workspace)
        : [],
    // partsOf solo depende de `split`.
    [deferred, workspace, split],
  );
  const preview = drafts.flatMap((d) => d.pieces);
  const notes = drafts.flatMap((d, i) =>
    planNotes(d, workspace).map((n) => ({
      ...n,
      text: drafts.length > 1 ? `${i + 1}. ${n.text}` : n.text,
    })),
  );
  const previewMood =
    drafts.length === 1 && drafts[0].mood
      ? moods.find((m) => m.value === drafts[0].mood)
      : undefined;

  const buildPlans = () => {
    const next = proposeBatch(partsOf(text), workspace);
    // Las personas desde las que se abrió la captura van en el encuentro.
    if (preset.length)
      for (const p of next) {
        const enc = p.pieces.find((x) => x.kind === "encuentro");
        if (enc) enc.personIds = [...new Set([...preset, ...enc.personIds])];
      }
    initial.current = next;
    return next;
  };
  const propose = () => {
    if (!text.trim()) return;
    setPlans(buildPlans());
    setRefined(new Set());
    setAt(0);
  };

  /** Cambia la experiencia que estás revisando. */
  const setPlan = (fn: (p: CapturePlan | null) => CapturePlan | null) =>
    setPlans((ps) => ps && ps.map((p, i) => (i === at ? (fn(p) ?? p) : p)));

  /** «tu mamá», «tu jefe»… de cada persona vinculada contigo. */
  const myKin = useMemo(() => {
    const byId = new Map(workspace.people.map((p) => [p.id, p]));
    return new Map(
      tiesOf(ME, workspace.ties)
        .filter((v) => v.other !== ME && byId.has(v.other))
        .map((v) => [
          v.other,
          `tu ${kinCall(v.kind, genderOf(byId.get(v.other)))}`,
        ]),
    );
  }, [workspace.people, workspace.ties]);

  const refine = async () => {
    if (!text.trim() || busy) return;
    let list = plans;
    let index = at;
    if (!list) {
      list = buildPlans();
      index = 0;
      setPlans(list);
      setAt(0);
      setRefined(new Set());
    }
    const base = list[index];
    setBusy("ai");
    try {
      const raw = await captureWithAssistant(base.text, {
        today: todayInputValue(),
        people: workspace.people.slice(0, 400).map((p) => ({
          id: p.id,
          name: p.name,
          ...(p.profile.alias && { alias: p.profile.alias }),
          // Para que entienda «mi mamá», «mi tío»…: lo que es para ti.
          ...(myKin.get(p.id) && { kin: myKin.get(p.id) }),
        })),
        places: workspace.places
          .slice(0, 200)
          .map((p) => ({ id: p.id, name: p.name })),
      });
      const next = planFromAi(raw, base, workspace);
      setPlans((ps) => (ps ?? list).map((p, i) => (i === index ? next : p)));
      setRefined((s) => new Set(s).add(index));
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const setPiece = (id: string, patch: Partial<Piece>) =>
    setPlan((p) =>
      p
        ? {
            ...p,
            pieces: p.pieces.map((x) =>
              x.id === id ? ({ ...x, ...patch } as Piece) : x,
            ),
          }
        : p,
    );
  const toSave = (plans ?? []).filter(
    (p) => !p.off && p.pieces.some((x) => x.on),
  );
  const totalOn = toSave.reduce(
    (s, p) => s + p.pieces.filter((x) => x.on).length,
    0,
  );

  const save = async () => {
    if (!plans || !toSave.length || busy) return;
    setBusy("save");
    const shared = newShared();
    let count = 0;
    let people = 0;
    let ties = 0;
    const episodes: Episode[] = [];
    try {
      for (const p of toSave) {
        // Aprende de lo que corregiste (solo en este navegador, con tope de tamaño).
        learnFromCapture(captureLessons(initial.current[plans.indexOf(p)], p));
        const r = await saveCapture(p, app, shared);
        count += r.count;
        people += r.people;
        ties += r.ties;
        if (r.episode) episodes.push(r.episode);
      }
    } catch (e) {
      notify(errorMessage(e));
      return;
    } finally {
      setBusy(null);
    }
    if (!count && !episodes.length && !people && !ties) return;
    const fresh = people
      ? ` · ${people} ${people === 1 ? "persona nueva" : "personas nuevas"}`
      : "";
    const linked = ties
      ? ` · ${ties} ${ties === 1 ? "vínculo" : "vínculos"}`
      : "";
    const pieces = `${count} ${count === 1 ? "pieza" : "piezas"}`;
    notify(
      toSave.length > 1
        ? `${toSave.length} experiencias guardadas: ${pieces}${episodes.length ? ` en ${episodes.length} ${episodes.length === 1 ? "episodio" : "episodios"}` : ""}${fresh}${linked}.`
        : `Experiencia guardada: ${pieces}${episodes[0] ? ` en «${episodes[0].title}»` : ""}${fresh}${linked}.`,
      episodes.length === 1
        ? {
            label: "Ver episodio",
            icon: "open",
            run: () => go("Episodios", episodes[0]),
          }
        : episodes.length > 1
          ? { label: "Ver episodios", icon: "open", run: () => go("Episodios") }
          : undefined,
    );
    onClose();
  };

  const requestClose = async () => {
    if (text.trim() && text !== initialText) {
      const ok = await confirm({
        title: "¿Descartar lo que escribiste?",
        message: "Nada de esta experiencia se ha guardado todavía.",
        confirmLabel: "Descartar",
        cancelLabel: "Seguir",
        danger: true,
        icon: "warning",
      });
      if (!ok) return;
    }
    onClose();
  };

  // Personas que se pueden elegir en las piezas: las tuyas, las nuevas del texto y los
  // parentescos aún sin elegir («tu mamá»).
  const newPeople = plan?.newPeople;
  const kinLinks = plan?.kinLinks;
  const options = useMemo<PersonOpt[]>(
    () => [
      ...workspace.people.map((p) => ({ id: p.id, name: p.name, person: p })),
      ...(newPeople ?? [])
        .filter((n) => n.on)
        .map((n) => ({
          id: n.id,
          name: n.name,
          note: "Nueva · se crea al guardar",
        })),
      ...(kinLinks ?? [])
        .filter((k) => !k.personId)
        .map((k) => ({
          id: k.id,
          name: k.label,
          note: "Parentesco por elegir",
        })),
    ],
    [workspace.people, newPeople, kinLinks],
  );
  const counts = useMemo(
    () => personCounts(workspace.entries),
    [workspace.entries],
  );
  const items = useMemo(() => personItems(options, counts), [options, counts]);
  const inText = useMemo(
    () =>
      plan
        ? [
            ...new Set([
              ...preset,
              ...plan.pieces.flatMap(peopleOf),
              ...plan.newPeople.map((n) => n.id),
              ...plan.kinLinks.map((k) => k.personId ?? k.id),
            ]),
          ].filter(Boolean)
        : [],
    [plan, preset],
  );
  const addPerson = (name: string) => {
    const id = "new:" + crypto.randomUUID();
    setPlan(
      (p) => p && { ...p, newPeople: [...p.newPeople, { id, name, on: true }] },
    );
    return id;
  };
  const peopleCtx = useMemo(
    () => ({ options, items, inText, addPerson }),
    // addPerson solo depende de `at`.
    [options, items, inText, at],
  );
  const nameOf = (id: string | null) =>
    options.find((o) => o.id === id)?.name ?? "";
  const personOf = (id: string) => workspace.people.find((p) => p.id === id);
  const shownNotes = allNotes ? notes : notes.slice(0, NOTES_SHOWN);
  const showMood =
    plan?.pieces.some(
      (p) =>
        p.on &&
        (p.kind === "encuentro" || p.kind === "visita" || p.kind === "nota"),
    ) ?? false;
  const asks =
    (plan?.ambiguous.length ?? 0) +
    (plan?.kinLinks.length ?? 0) +
    (plan?.newPeople.length ?? 0);
  const aiDone = plan ? refined.has(at) : false;

  return (
    <Sheet
      label="Capturar una experiencia"
      size="lg"
      className="xp-sheet"
      yieldTo=".xp-help-backdrop, .xp-pk-backdrop"
      onRequestClose={requestClose}
    >
      <CapturePeople.Provider value={peopleCtx}>
        <div
          className="xp"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (plans) void save();
              else propose();
            }
          }}
        >
          <header className="xp-head">
            {plans ? (
              <button
                type="button"
                className="xp-icon"
                aria-label="Volver al texto"
                title="Volver al texto"
                onClick={() => setPlans(null)}
              >
                <ArrowLeft size={18} />
              </button>
            ) : null}
            <h2>{plans ? "Revisa y guarda" : "Nueva experiencia"}</h2>
            <button
              type="button"
              className="xp-icon"
              aria-label="Cómo funciona"
              title="Cómo funciona"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={18} />
            </button>
            <button
              type="button"
              className="xp-icon"
              aria-label="Cerrar"
              onClick={requestClose}
            >
              <X size={18} />
            </button>
          </header>

          {!plan ? (
            <div className="xp-write">
              <textarea
                ref={area}
                className="xp-area"
                rows={2}
                maxLength={12000}
                value={text}
                placeholder="¿Qué pasó? Cuéntalo como te salga…"
                aria-label="Qué pasó"
                onChange={(e) => setText(e.target.value)}
              />
              <div className="xp-detected" aria-live="polite">
                {preview.map((p) => {
                  const m = metaOf(p);
                  return (
                    <i
                      key={p.id}
                      className={p.on ? "" : "off"}
                      title={p.dup?.text ?? p.hint ?? p.evidence}
                      style={{ "--c": m.color, "--s": m.soft } as CSSProperties}
                    >
                      <m.icon size={12} /> {pieceName(p)}
                    </i>
                  );
                })}
                {previewMood && (
                  <i
                    style={
                      { "--c": "#a8721d", "--s": "#fbf1dc" } as CSSProperties
                    }
                  >
                    {previewMood.emoji} {previewMood.label}
                  </i>
                )}
              </div>
              {canSplit && deferred.trim().length > 8 && (
                <label className="xp-split">
                  <input
                    type="checkbox"
                    checked={drafts.length > 1}
                    onChange={(e) => setSplit(e.target.checked)}
                  />
                  <Layers size={14} />
                  {drafts.length > 1
                    ? `${drafts.length} experiencias, se guardan por separado`
                    : "Separar en varias experiencias"}
                </label>
              )}
              {notes.length > 0 && (
                <ul className="xp-feedback" aria-live="polite">
                  {shownNotes.map((n, i) => (
                    <li key={i} className={n.tone}>
                      {n.tone === "dup" ? (
                        <Copy size={13} />
                      ) : n.tone === "warn" ? (
                        <CircleHelp size={13} />
                      ) : (
                        <Info size={13} />
                      )}
                      <span>{n.text}</span>
                    </li>
                  ))}
                  {notes.length > NOTES_SHOWN && (
                    <li className="more">
                      <button
                        type="button"
                        onClick={() => setAllNotes((v) => !v)}
                      >
                        {allNotes
                          ? "Ver menos"
                          : `${notes.length - NOTES_SHOWN} más`}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          ) : (
            <div className="xp-review">
              {plans && plans.length > 1 && (
                <nav className="xp-batch" aria-label="Experiencias">
                  {plans.map((p, i) => (
                    <button
                      type="button"
                      key={i}
                      className={
                        (i === at ? "on" : "") + (p.off ? " skip" : "")
                      }
                      onClick={() => setAt(i)}
                      title={p.text}
                    >
                      <b>{i + 1}</b>
                      <span>{p.episode.title || p.text.slice(0, 40)}</span>
                      <small>
                        {p.off
                          ? "Omitida"
                          : p.pieces.filter((x) => x.on).length}
                      </small>
                    </button>
                  ))}
                  <label className="xp-check xp-batch-skip">
                    <input
                      type="checkbox"
                      checked={!plan.off}
                      onChange={(e) =>
                        setPlan((p) => p && { ...p, off: !e.target.checked })
                      }
                    />
                    Guardar esta
                  </label>
                </nav>
              )}

              <EpisodeToggle
                plan={plan}
                setPlan={setPlan}
                disabled={app.experiencesMissing}
              />

              {showMood && (
                <div className="xp-mood">
                  <MoodPicker
                    value={plan.mood ?? undefined}
                    onChange={(m) =>
                      setPlan((p) => p && { ...p, mood: m ?? null })
                    }
                    label="Cómo te sentiste"
                  />
                </div>
              )}

              {asks > 0 && (
                <div className="xp-asks">
                  {plan.ambiguous.map((a) => (
                    <div className="xp-ask" key={a.name}>
                      <span className="xp-ask-text">
                        ¿Qué <b>{a.name}</b>?
                      </span>
                      <div className="xp-ask-opts">
                        {a.ids.map((id) => {
                          const p = personOf(id);
                          if (!p) return null;
                          return (
                            <button
                              type="button"
                              key={id}
                              className={
                                "xp-opt" + (a.chosen === id ? " on" : "")
                              }
                              onClick={() =>
                                a.chosen !== id &&
                                setPlan(
                                  (pl) =>
                                    pl && swapPerson(pl, a.chosen, id, a.name),
                                )
                              }
                            >
                              <Avatar person={p} size={20} /> {p.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {plan.kinLinks.map((k) => (
                    <KinLinkRow
                      key={k.id}
                      link={k}
                      plan={plan}
                      setPlan={setPlan}
                    />
                  ))}

                  {plan.newPeople.map((n) => (
                    <div
                      key={n.id}
                      className={"xp-ask" + (n.on ? "" : " muted")}
                    >
                      <label
                        className="xp-check"
                        title={n.on ? "Se creará" : "No se creará"}
                      >
                        <input
                          type="checkbox"
                          checked={n.on}
                          onChange={(e) =>
                            setPlan(
                              (p) =>
                                p && {
                                  ...p,
                                  newPeople: p.newPeople.map((x) =>
                                    x.id === n.id
                                      ? { ...x, on: e.target.checked }
                                      : x,
                                  ),
                                },
                            )
                          }
                        />
                      </label>
                      <UserPlus size={15} className="xp-ask-icon" />
                      <input
                        className="xp-inline"
                        value={n.name}
                        maxLength={120}
                        aria-label="Nombre de la persona nueva"
                        onChange={(e) =>
                          setPlan(
                            (p) =>
                              p && {
                                ...p,
                                newPeople: p.newPeople.map((x) =>
                                  x.id === n.id
                                    ? { ...x, name: e.target.value }
                                    : x,
                                ),
                              },
                          )
                        }
                      />
                      <small className="xp-tag">Nueva</small>
                      {n.like && personOf(n.like) && (
                        <button
                          type="button"
                          className="xp-opt"
                          title="Usar la ficha que ya tienes"
                          onClick={() =>
                            setPlan((p) => p && adoptExisting(p, n.id, n.like!))
                          }
                        >
                          <Avatar person={personOf(n.like)!} size={20} /> ¿Es{" "}
                          {personOf(n.like)!.name}?
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="xp-pieces">
                {plan.pieces.map((p) => (
                  <PieceCard
                    key={p.id}
                    piece={p}
                    onToggle={(on) => setPiece(p.id, { on })}
                  >
                    <PieceFields
                      piece={p}
                      set={(patch) => setPiece(p.id, patch)}
                      nameOf={nameOf}
                    />
                  </PieceCard>
                ))}
              </div>

              <button
                type="button"
                className="xp-source-toggle"
                aria-expanded={showSource}
                onClick={() => setShowSource((v) => !v)}
              >
                <Quote size={13} /> Texto original
                <ChevronDown size={14} className={showSource ? "open" : ""} />
              </button>
              {showSource && (
                <blockquote className="xp-source">{plan.text}</blockquote>
              )}
            </div>
          )}

          <footer className="xp-foot">
            <span className="xp-keys" aria-hidden="true">
              <kbd>Ctrl</kbd>
              <kbd>Enter</kbd>
            </span>
            <button
              type="button"
              className={
                "xp-ai" +
                (busy === "ai" ? " busy" : "") +
                (aiDone ? " done" : "")
              }
              disabled={!text.trim() || Boolean(busy)}
              onClick={() => void refine()}
              aria-label="Afinar con IA"
              data-tip={aiDone ? "Afinado con IA · otra vez" : "Afinar con IA"}
            >
              {busy === "ai" ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Sparkles size={18} />
              )}
            </button>
            {plans ? (
              <button
                type="button"
                className="cp-btn cta"
                disabled={!totalOn || Boolean(busy)}
                onClick={() => void save()}
              >
                {busy === "save" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                Guardar{" "}
                {totalOn > 0 && <span className="xp-count">{totalOn}</span>}
              </button>
            ) : (
              <button
                type="button"
                className="cp-btn cta"
                disabled={!text.trim() || Boolean(busy)}
                onClick={propose}
              >
                Continuar <ArrowRight size={16} />
              </button>
            )}
          </footer>
        </div>
      </CapturePeople.Provider>
      {help && <CaptureHelp onClose={() => setHelp(false)} />}
    </Sheet>
  );
}

/**
 * Un parentesco del texto: «¿Quién es tu mamá?» (eliges a alguien o escribes un nombre nuevo) o
 * «Guardar a Carlos como tu tío». Lo elegido entra en las piezas y el vínculo se guarda.
 */
function KinLinkRow({
  link,
  plan,
  setPlan,
}: {
  link: KinLink;
  plan: CapturePlan;
  setPlan: (fn: (p: CapturePlan | null) => CapturePlan | null) => void;
}) {
  const { workspace } = useApp();
  const [open, setOpen] = useState(false);
  const counts = useMemo(
    () => personCounts(workspace.entries),
    [workspace.entries],
  );
  const ranked = useMemo(() => {
    const cue = {
      key: link.id,
      start: 0,
      end: 0,
      label: link.label,
      kind: link.kind,
      gender: link.gender,
      owner: link.owner,
      plural: false,
      status: "unknown" as const,
      ids: [],
    };
    return cueOptions(cue, workspace.people, workspace.ties);
    // Solo cambia si cambia la gente o el parentesco.
  }, [
    workspace.people,
    workspace.ties,
    link.id,
    link.label,
    link.kind,
    link.gender,
    link.owner,
  ]);
  const items = useMemo(() => {
    const byId = new Map(workspace.people.map((p) => [p.id, p]));
    const order = new Map(ranked.map((id, i) => [id, i]));
    return personItems(
      ranked.flatMap((id) => {
        const p = byId.get(id);
        return p ? [{ id, name: p.name, person: p }] : [];
      }),
      counts,
    ).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [ranked, workspace.people, counts]);

  const patch = (p: CapturePlan, changes: Partial<KinLink>): CapturePlan => ({
    ...p,
    kinLinks: p.kinLinks.map((x) =>
      x.id === link.id ? { ...x, ...changes } : x,
    ),
  });
  /** Elegir a alguien: reemplaza el comodín en las piezas por esa persona. */
  const choose = (to: string) =>
    setPlan((p) => {
      if (!p) return p;
      const from = link.personId ?? link.id;
      const next = from === to ? p : swapPerson(p, from, to, "");
      return patch(next, { personId: to, save: true });
    });
  const createNew = (name: string) => {
    const n = name.trim();
    if (!n) return;
    const id = "new:" + crypto.randomUUID();
    setPlan((p) => {
      if (!p) return p;
      const withPerson = {
        ...p,
        newPeople: [...p.newPeople, { id, name: n, on: true }],
      };
      return patch(swapPerson(withPerson, link.personId ?? link.id, id, ""), {
        personId: id,
        save: true,
      });
    });
  };

  const chosen = link.personId
    ? workspace.people.find((p) => p.id === link.personId)
    : undefined;
  const chosenName =
    chosen?.name ??
    plan.newPeople.find((n) => n.id === link.personId)?.name ??
    "";

  return (
    <div className={"xp-ask" + (link.personId ? "" : " pending")}>
      <Network size={15} className="xp-ask-icon" />
      {link.personId ? (
        <>
          <label className="xp-check">
            <input
              type="checkbox"
              checked={link.save}
              onChange={(e) =>
                setPlan((p) => p && patch(p, { save: e.target.checked }))
              }
            />
            <span>
              <b>{chosenName.split(" ")[0] || "¿?"}</b> es {link.label}
            </span>
          </label>
          <button
            type="button"
            className="xp-link-btn"
            onClick={() => setOpen(true)}
          >
            Cambiar
          </button>
        </>
      ) : (
        <>
          <span className="xp-ask-text">
            ¿Quién es <b>{link.label}</b>?
          </span>
          <button
            type="button"
            className="xp-opt primary"
            onClick={() => setOpen(true)}
          >
            Elegir
          </button>
        </>
      )}
      {open && (
        <PickDialog
          title={`¿Quién es ${link.label}?`}
          placeholder="Busca o escribe un nombre nuevo…"
          items={items}
          selected={link.personId ? [link.personId] : []}
          pinned={ranked.slice(0, 6)}
          pinnedLabel="Más probable"
          onToggle={choose}
          onCreate={createNew}
          createHint="Persona nueva, se crea al guardar"
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function EpisodeToggle({
  plan,
  setPlan,
  disabled,
}: {
  plan: CapturePlan;
  setPlan: (fn: (p: CapturePlan | null) => CapturePlan | null) => void;
  disabled: boolean;
}) {
  const ep = plan.episode;
  const m = episodeKinds[ep.kind];
  const on = ep.on && !disabled;
  const set = (patch: Partial<CapturePlan["episode"]>) =>
    setPlan((p) => p && { ...p, episode: { ...p.episode, ...patch } });
  return (
    <div
      className={"xp-episode" + (on ? " on" : "")}
      style={{ "--c": m.color, "--s": m.soft } as CSSProperties}
    >
      <div className="xp-episode-head">
        <label
          className="xp-switch"
          title={
            disabled
              ? "Necesita la migración 008. Las piezas se guardan igual, sueltas."
              : on
                ? "No agrupar"
                : "Agrupar en un episodio"
          }
        >
          <input
            type="checkbox"
            checked={on}
            disabled={disabled}
            aria-label="Agrupar en un episodio"
            onChange={(e) => set({ on: e.target.checked })}
          />
          <i />
        </label>
        {on ? (
          <input
            className="xp-title"
            value={ep.title}
            maxLength={120}
            placeholder="Nombre del episodio"
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Nombre del episodio"
          />
        ) : (
          <span className="xp-episode-off">
            {disabled ? "Piezas sueltas" : "Sin episodio"}
          </span>
        )}
        <input
          type="date"
          className="xp-date"
          value={plan.date}
          max="2100-12-31"
          onChange={(e) => {
            const date = e.target.value || plan.date;
            setPlan(
              (p) =>
                p && {
                  ...p,
                  date,
                  pieces: p.pieces.map((x) =>
                    x.kind === "encuentro" ||
                    x.kind === "movimiento" ||
                    x.kind === "novedad" ||
                    x.kind === "intercambio" ||
                    x.kind === "visita"
                      ? { ...x, date }
                      : x,
                  ),
                },
            );
          }}
          aria-label="Cuándo pasó"
          title="Cuándo pasó"
        />
      </div>
      {on && (
        <div
          className="xp-kinds"
          role="radiogroup"
          aria-label="Tipo de episodio"
        >
          {episodeKindList.map((k) => {
            const km = episodeKinds[k];
            return (
              <button
                type="button"
                key={k}
                role="radio"
                aria-checked={ep.kind === k}
                className={ep.kind === k ? "on" : ""}
                onClick={() => set({ kind: k as EpisodeKind })}
              >
                <km.icon size={13} /> {km.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PieceCard({
  piece,
  onToggle,
  children,
}: {
  piece: Piece;
  onToggle: (on: boolean) => void;
  children: ReactNode;
}) {
  const m = metaOf(piece);
  return (
    <section
      className={"xp-piece" + (piece.on ? "" : " off")}
      style={{ "--c": m.color, "--s": m.soft } as CSSProperties}
    >
      <header>
        <span className="xp-piece-icon">
          <m.icon size={15} />
        </span>
        <span className="xp-piece-name">
          <strong>{pieceName(piece)}</strong>
          {piece.evidence && (
            <small title={piece.evidence}>«{piece.evidence}»</small>
          )}
        </span>
        <label
          className="xp-switch"
          title={piece.on ? "No guardar" : "Guardar"}
        >
          <input
            type="checkbox"
            checked={piece.on}
            aria-label={`Guardar ${pieceName(piece)}`}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <i />
        </label>
      </header>
      {piece.on && <div className="xp-piece-body">{children}</div>}
      {piece.dup && (
        <p className="xp-dup">
          {piece.dup.text}
          {!piece.on && (piece.dup.id ? " Se enlazará al episodio." : "")}
        </p>
      )}
      {!piece.dup && piece.hint && (
        <p className="xp-dup xp-hintline">{piece.hint}</p>
      )}
    </section>
  );
}

/** Segmentos («Gasto | Ingreso»). */
function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="xp-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          type="button"
          key={v}
          role="radio"
          aria-checked={value === v}
          className={value === v ? "on" : ""}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function DateInput({
  value,
  onChange,
  label,
  optional = false,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  optional?: boolean;
}) {
  return (
    <input
      type="date"
      className={"xp-date" + (optional && !value ? " empty" : "")}
      value={value}
      max="2100-12-31"
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      title={label}
    />
  );
}

function PieceFields({
  piece: p,
  set,
  nameOf,
}: {
  piece: Piece;
  set: (patch: Partial<Piece>) => void;
  nameOf: (id: string | null) => string;
}) {
  switch (p.kind) {
    case "encuentro":
      return (
        <div className="xp-grid">
          <input
            className="xp-wide xp-strong"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Título"
          />
          <PeopleField
            ids={p.personIds}
            onChange={(personIds) => set({ personIds })}
          />
          <div className="xp-row">
            <PlaceField
              placeId={p.placeId}
              placeName={p.placeName}
              placeKind={p.placeKind}
              onChange={(patch) => set(patch)}
            />
            <select
              className="xp-select"
              value={p.activity}
              onChange={(e) => set({ activity: e.target.value })}
              aria-label="Qué hicieron"
            >
              <option value="">Actividad</option>
              {[
                ...new Set([
                  ...(p.activity ? [p.activity] : []),
                  ...activities,
                ]),
              ].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <DateInput
              value={p.date}
              onChange={(v) => set({ date: v || p.date })}
              label="Fecha"
            />
          </div>
        </div>
      );
    case "movimiento": {
      const cats =
        p.direction === "ingreso" ? incomeCategories : expenseCategories;
      return (
        <div className="xp-grid">
          <div className="xp-row">
            <Seg
              value={p.direction}
              label="Tipo"
              options={[
                ["egreso", "Gasto"],
                ["ingreso", "Ingreso"],
              ]}
              onChange={(direction) => set({ direction })}
            />
            <label className="xp-money">
              $
              <input
                inputMode="numeric"
                value={thousands(p.amount)}
                onChange={(e) =>
                  set({
                    amount: Number(e.target.value.replace(/\D/g, "")) || 0,
                  })
                }
                aria-label="Monto"
              />
            </label>
            <select
              className="xp-select"
              value={p.category}
              title={
                p.why && p.category !== "Otro"
                  ? `${p.category} ${p.why}`
                  : undefined
              }
              onChange={(e) =>
                set({ category: e.target.value, title: e.target.value })
              }
              aria-label="Categoría"
            >
              {[...new Set([p.category, ...cats])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <DateInput
              value={p.date}
              onChange={(v) => set({ date: v || p.date })}
              label="Fecha"
            />
          </div>
          {p.guessed && (
            <small className="xp-warn">
              ¿Lo pagaste o te lo pagaron? Revísalo.
            </small>
          )}
        </div>
      );
    }
    case "novedad":
      return (
        <div className="xp-grid">
          <div className="xp-row">
            <PersonField
              value={p.personId}
              label="¿De quién?"
              onChange={(id) => id && set({ personId: id })}
            />
            <select
              className="xp-select"
              value={p.updateKind}
              onChange={(e) =>
                set({ updateKind: e.target.value as UpdateKind })
              }
              aria-label="Tipo de novedad"
            >
              {updateKindList.map((k) => (
                <option key={k} value={k}>
                  {updateKinds[k].label}
                </option>
              ))}
            </select>
          </div>
          <input
            className="xp-wide"
            value={p.text}
            maxLength={500}
            onChange={(e) => set({ text: e.target.value })}
            aria-label="Novedad"
          />
        </div>
      );
    case "compromiso": {
      const cm = commitmentKinds[p.commitment];
      return (
        <div className="xp-grid">
          <Seg
            value={p.commitment}
            label="Tipo de compromiso"
            options={commitmentKindList.map(
              (k) => [k, commitmentKinds[k].short] as const,
            )}
            onChange={(k) => set({ commitment: k as CommitmentKind })}
          />
          <input
            className="xp-wide xp-strong"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Qué"
          />
          <div className="xp-row">
            <PersonField
              value={p.personId}
              label={cm.who}
              placeholder={cm.who}
              optional
              onChange={(id) => set({ personId: id })}
            />
            <DateInput
              value={p.due}
              onChange={(due) => set({ due })}
              label="Para cuándo"
              optional
            />
          </div>
        </div>
      );
    }
    case "conexion":
      return (
        <div className="xp-grid">
          <small className="xp-hint">
            {nameOf(p.a) || "¿?"} ↔ {nameOf(p.b) || "¿?"}
          </small>
          <input
            className="xp-wide"
            value={p.text}
            maxLength={300}
            onChange={(e) => set({ text: e.target.value })}
            aria-label="Conexión"
          />
        </div>
      );
    case "aprendizaje":
      return (
        <div className="xp-grid">
          <input
            className="xp-wide xp-strong"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Qué aprendiste"
          />
          <div className="xp-row">
            <select
              className="xp-select"
              value={p.source}
              onChange={(e) => set({ source: e.target.value })}
              aria-label="Fuente"
            >
              {[
                ...new Set([...(p.source ? [p.source] : []), ...learnSources]),
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <input
              className="xp-inline xp-grow"
              value={p.sourceName}
              maxLength={120}
              placeholder="Título o quién"
              onChange={(e) => set({ sourceName: e.target.value })}
              aria-label="Nombre de la fuente"
            />
          </div>
        </div>
      );
    case "nota":
      return (
        <textarea
          className="xp-wide"
          rows={3}
          value={p.text}
          maxLength={4000}
          onChange={(e) => set({ text: e.target.value })}
          aria-label="Nota"
        />
      );
    case "obra": {
      const book = p.media === "Libro";
      const shelved = book && p.status === "estante";
      const states = book
        ? ([
            ["estante", "Estantería"],
            ["quiero", "Por leer"],
            ["curso", "Leyendo"],
            ["listo", "Terminado"],
          ] as const)
        : ([
            ["quiero", "Por ver"],
            ["curso", "Viendo"],
            ["listo", "Vista"],
          ] as const);
      return (
        <div className="xp-grid">
          <div className="xp-row">
            <Seg
              value={p.media}
              label="Tipo"
              options={[
                ["Película", "Película o serie"],
                ["Libro", "Libro"],
              ]}
              onChange={(m) =>
                set(
                  m === "Libro"
                    ? { media: m, platform: "", series: false }
                    : {
                        media: m,
                        author: "",
                        copy: "",
                        ...(p.status === "estante" && {
                          status: "quiero" as const,
                        }),
                      },
                )
              }
            />
            {!book && (
              <label className="xp-check">
                <input
                  type="checkbox"
                  checked={p.series}
                  onChange={(e) => set({ series: e.target.checked })}
                />
                Serie
              </label>
            )}
          </div>
          <input
            className="xp-wide xp-strong"
            value={p.title}
            maxLength={120}
            placeholder="Título"
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Título"
          />
          <div className="xp-row">
            {book ? (
              <input
                className="xp-inline"
                value={p.author}
                maxLength={120}
                placeholder="Autor"
                onChange={(e) => set({ author: e.target.value })}
                aria-label="Autor"
              />
            ) : (
              <select
                className="xp-select"
                value={p.platform}
                onChange={(e) => set({ platform: e.target.value })}
                aria-label="Dónde"
              >
                <option value="">¿Dónde?</option>
                {[
                  ...new Set([
                    ...(p.platform ? [p.platform] : []),
                    ...platforms,
                  ]),
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            )}
            <Seg
              value={p.status}
              label="Estado"
              options={states}
              onChange={(v) =>
                set({
                  status: v,
                  ...((v === "quiero" || v === "estante") && { rating: 0 }),
                  ...(v === "estante" && { copy: "mio" as const }),
                })
              }
            />
            {p.status !== "quiero" && !shelved && (
              <Stars
                value={p.rating}
                size={18}
                label="Calificación"
                onChange={(rating) => set({ rating })}
              />
            )}
            {book && !shelved && (
              <select
                className="xp-select"
                value={p.copy}
                onChange={(e) => set({ copy: e.target.value as typeof p.copy })}
                aria-label="Ejemplar"
              >
                <option value="">¿Tu ejemplar?</option>
                <option value="mio">Es mío · a la estantería</option>
                <option value="prestado">Me lo prestaron</option>
              </select>
            )}
          </div>
          <div className="xp-row">
            <PersonField
              value={p.recommendedBy}
              label={
                book && p.copy === "prestado"
                  ? "¿Quién te lo prestó?"
                  : book
                    ? "¿Quién te lo recomendó?"
                    : "¿Quién te la recomendó?"
              }
              placeholder={
                book && p.copy === "prestado"
                  ? "Prestado por…"
                  : "Recomendada por…"
              }
              optional
              onChange={(id) => set({ recommendedBy: id })}
            />
            <PeopleField
              ids={p.personIds}
              label="¿Con quién?"
              onChange={(personIds) => set({ personIds })}
            />
          </div>
        </div>
      );
    }
    case "idea":
      return (
        <div className="xp-grid">
          <input
            className="xp-wide xp-strong"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="La idea"
          />
          <Seg
            value={p.as}
            label="Guardar como"
            options={[
              ["nota", "Idea suelta"],
              ["trabajo", "Proyecto"],
            ]}
            onChange={(as) => set({ as })}
          />
        </div>
      );
    case "trabajo":
      return (
        <div className="xp-grid">
          <input
            className="xp-wide xp-strong"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Qué hiciste"
          />
          <div className="xp-row">
            <Seg
              value={p.stage}
              label="Etapa"
              options={[
                ["idea", "Idea"],
                ["curso", "En curso"],
                ["pausa", "En pausa"],
                ["listo", "Listo"],
              ]}
              onChange={(stage) => set({ stage })}
            />
            <DateInput
              value={p.due}
              onChange={(due) => set({ due })}
              label="Fecha límite"
              optional
            />
          </div>
          <input
            className="xp-wide"
            value={p.nextStep}
            maxLength={180}
            placeholder="Siguiente paso"
            onChange={(e) => set({ nextStep: e.target.value })}
            aria-label="Siguiente paso"
          />
          <PeopleField
            ids={p.personIds}
            onChange={(personIds) => set({ personIds })}
          />
        </div>
      );
    case "intercambio":
      return (
        <div className="xp-grid">
          <div className="xp-row">
            <Seg
              value={p.dir}
              label="Dirección"
              options={[
                ["recibir", "Recibiste"],
                ["dar", "Diste"],
              ]}
              onChange={(dir) => set({ dir })}
            />
            <select
              className="xp-select"
              value={p.exchange}
              onChange={(e) =>
                set({ exchange: e.target.value as ExchangeKind })
              }
              aria-label="Qué"
            >
              {(Object.keys(exchangeKinds) as ExchangeKind[]).map((k) => (
                <option key={k} value={k}>
                  {exchangeKinds[k]}
                </option>
              ))}
            </select>
            <span className="xp-label">{p.dir === "dar" ? "a" : "de"}</span>
            <PersonField
              value={p.personId}
              label={p.dir === "dar" ? "¿A quién?" : "¿De quién?"}
              onChange={(id) => id && set({ personId: id })}
            />
          </div>
          <input
            className="xp-wide"
            value={p.note}
            maxLength={120}
            placeholder="Qué fue"
            onChange={(e) => set({ note: e.target.value })}
            aria-label="Detalle"
          />
        </div>
      );
    case "dato": {
      const year = todayInputValue().slice(0, 4);
      return (
        <div className="xp-row">
          <PersonField
            value={p.personId}
            label="¿De quién?"
            onChange={(id) => id && set({ personId: id })}
          />
          <select
            className="xp-select"
            value={p.field}
            onChange={(e) =>
              set({
                field: e.target.value as typeof p.field,
                ...(e.target.value === "birthday" && { value: "" }),
              })
            }
            aria-label="Qué dato"
          >
            {factFields.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          {p.field === "fact" && (
            <input
              className="xp-inline xp-short"
              value={p.label}
              maxLength={40}
              placeholder="Dato"
              onChange={(e) => set({ label: e.target.value })}
              aria-label="Nombre del dato"
            />
          )}
          {p.field === "birthday" ? (
            <DateInput
              value={/^\d{2}-\d{2}$/.test(p.value) ? `${year}-${p.value}` : ""}
              onChange={(v) => set({ value: v.slice(5) })}
              label="Día del cumpleaños"
            />
          ) : (
            <input
              className="xp-inline xp-grow"
              value={p.value}
              maxLength={80}
              onChange={(e) => set({ value: e.target.value })}
              aria-label="Valor"
            />
          )}
        </div>
      );
    }
    case "preguntar":
      return (
        <div className="xp-grid">
          <PersonField
            value={p.personId}
            label="¿A quién?"
            onChange={(id) => id && set({ personId: id })}
          />
          <input
            className="xp-wide"
            value={p.text}
            maxLength={200}
            onChange={(e) => set({ text: e.target.value })}
            aria-label="Qué preguntarle"
          />
        </div>
      );
    case "visita":
      return (
        <div className="xp-grid">
          <input
            className="xp-wide xp-strong"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Título"
          />
          <div className="xp-row">
            <PlaceField
              placeId={p.placeId}
              placeName={p.placeName}
              placeKind={p.placeKind}
              onChange={(patch) => set(patch)}
            />
            <DateInput
              value={p.date}
              onChange={(v) => set({ date: v || p.date })}
              label="Fecha"
            />
          </div>
        </div>
      );
    case "enlace":
      return (
        <div className="xp-grid">
          <a className="xp-link" href={p.url} target="_blank" rel="noreferrer">
            {p.url}
          </a>
          <div className="xp-row">
            <Seg
              value={p.save}
              label="Guardar en"
              options={[
                ["lecturas", "Lecturas"],
                ["nota", "Nota"],
              ]}
              onChange={(save) => set({ save })}
            />
            <PersonField
              value={p.personId}
              label="¿Quién te lo pasó?"
              placeholder="Te lo pasó…"
              optional
              onChange={(id) => set({ personId: id })}
            />
          </div>
        </div>
      );
  }
}
