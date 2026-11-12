import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  CircleHelp,
  Feather,
  LoaderCircle,
  Network,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { Sheet } from "../components/Sheet";
import type { CommitmentKind, Episode, EpisodeKind, UpdateKind } from "../data";
import {
  adoptExisting,
  captureLessons,
  pieceName,
  swapPerson,
  type CapturePlan,
  type KinLink,
  type Piece,
} from "../lib/capture";
import { learnFromCapture } from "../lib/captureMemory";
import { exchangeKinds } from "../lib/people";
import { MoodPicker, Stars } from "../composer/controls";
import type { ExchangeKind } from "../data";
import { cueOptions } from "../lib/recognize";
import { commitmentKindList, commitmentKinds } from "../lib/commitments";
import {
  episodeKindList,
  episodeKindOf,
  episodeKinds,
} from "../lib/episodes";
import {
  errorMessage,
  normalizeText,
  thousands,
  todayInputValue,
} from "../lib/format";
import { updateKindList, updateKinds } from "../lib/updates";
import { expenseCategories, incomeCategories } from "../composer/logic";
import { Avatar } from "../people/Avatar";
import {
  planCount,
  removeJobs,
  updateJob,
  type PieceJob,
} from "../instants/analysis";
import { excerpt } from "../instants/model";
import { linkInstant } from "../instants/store";
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
/** Un plan en la revisión: de qué búsqueda y de qué instante salió. */
type ReviewRow = {
  jobId: string;
  index: number;
  instantId: string;
  keepText: boolean;
};

/**
 * Junta lo que encontraron varias búsquedas en una sola revisión. La misma persona nueva en dos
 * instantes («conocí a Mariana» y luego «Mariana me escribió») queda como una sola.
 */
function combine(jobs: PieceJob[]) {
  const rows: ReviewRow[] = [];
  const plans: CapturePlan[] = [];
  const initial: (CapturePlan | undefined)[] = [];
  const seen = new Map<string, string>();
  for (const j of jobs)
    j.plans.forEach((p, i) => {
      let plan = p;
      for (const n of p.newPeople) {
        const key = normalizeText(n.name.trim());
        const prev = seen.get(key);
        if (!prev) {
          seen.set(key, n.id);
          continue;
        }
        if (prev === n.id) continue;
        plan = swapPerson(plan, n.id, prev, "");
        plan = {
          ...plan,
          newPeople: plan.newPeople.map((x) =>
            x.id === n.id ? { ...x, id: prev } : x,
          ),
          kinLinks: plan.kinLinks.map((k) =>
            k.personId === n.id ? { ...k, personId: prev } : k,
          ),
        };
      }
      rows.push({
        jobId: j.id,
        index: i,
        instantId: j.planInstants[i] ?? "",
        keepText: j.keepText,
      });
      plans.push(plan);
      initial.push(j.initial[i]);
    });
  return { rows, plans, initial };
}

/**
 * Revisión de las piezas que Nexo encontró en segundo plano en tus instantes: el encuentro, el
 * gasto, la novedad, el compromiso, la conexión… Puedes corregir o excluir cada una. Al guardar,
 * cada pieza queda vinculada a su instante (no copia el texto). Si cierras sin guardar, siguen
 * esperando en la barra.
 */
export function PiecesReview({
  jobs: initialJobs,
  onClose,
}: {
  jobs: PieceJob[];
  onClose: () => void;
}) {
  const app = useApp();
  const { workspace, confirm, notify, go } = app;
  // Lo que había al abrir: si mientras revisas termina otra búsqueda, espera en la barra.
  const [jobs] = useState(initialJobs);
  const [start] = useState(() => combine(jobs));
  const { rows, initial } = start;
  const [plans, setPlans] = useState<CapturePlan[]>(start.plans);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [help, setHelp] = useState(false);
  const plan = plans[Math.min(at, plans.length - 1)] ?? null;
  const row = rows[Math.min(at, rows.length - 1)];
  const many = new Set(rows.map((r) => r.instantId || r.jobId)).size > 1;

  /** Cambia la experiencia que estás revisando. */
  const setPlan = (fn: (p: CapturePlan | null) => CapturePlan | null) =>
    setPlans((ps) => ps.map((p, i) => (i === at ? (fn(p) ?? p) : p)));

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
  const toSave = plans.filter((p) => planCount(p) > 0);
  const totalOn = toSave.reduce((s, p) => s + planCount(p), 0);

  /** Lo que cambiaste queda guardado en la barra (por si cierras y vuelves luego). */
  const keepEdits = () => {
    for (const j of jobs) {
      const mine = rows
        .map((r, i) => (r.jobId === j.id ? plans[i] : null))
        .filter((p): p is CapturePlan => p !== null);
      if (mine.length === j.plans.length) updateJob(j.id, { plans: mine });
    }
  };

  const save = async () => {
    if (!toSave.length || busy) return;
    setBusy(true);
    const shared = newShared();
    let count = 0;
    let people = 0;
    let ties = 0;
    const episodes: Episode[] = [];
    const linked = new Set<string>();
    const saved = new Set<number>();
    try {
      for (let i = 0; i < plans.length; i++) {
        const p = plans[i];
        if (!planCount(p)) continue;
        const r = rows[i];
        // Aprende de lo que corregiste (solo en este navegador, con tope de tamaño).
        learnFromCapture(captureLessons(initial[i], p));
        const done = await saveCapture(p, app, shared, {
          instantId: r.instantId || undefined,
          keepText: r.keepText || !r.instantId,
        });
        saved.add(i);
        count += done.count;
        people += done.people;
        ties += done.ties;
        if (done.episode && done.episodeMade) episodes.push(done.episode);
        if (r.instantId) {
          await linkInstant(r.instantId, done.links);
          linked.add(r.instantId);
        }
      }
    } catch (e) {
      // Lo que ya se guardó no se vuelve a guardar si lo intentas otra vez.
      setPlans((ps) => ps.map((p, i) => (saved.has(i) ? { ...p, off: true } : p)));
      setBusy(false);
      notify(errorMessage(e));
      return;
    }
    setBusy(false);
    removeJobs(jobs.map((j) => j.id));
    const fresh = people
      ? ` · ${people} ${people === 1 ? "persona nueva" : "personas nuevas"}`
      : "";
    const tied = ties ? ` · ${ties} ${ties === 1 ? "vínculo" : "vínculos"}` : "";
    const pieces = `${count} ${count === 1 ? "pieza guardada" : "piezas guardadas"}`;
    const where = linked.size
      ? linked.size === 1
        ? " y vinculadas a tu instante"
        : ` y vinculadas a ${linked.size} instantes`
      : "";
    const one = linked.size === 1 ? [...linked][0] : "";
    notify(
      `${pieces}${count ? where : ""}${fresh}${tied}.`,
      one
        ? { label: "Ver instante", icon: "open", run: () => app.openInstant(one) }
        : episodes.length === 1
          ? {
              label: "Ver episodio",
              icon: "open",
              run: () => go("Episodios", episodes[0]),
            }
          : undefined,
    );
    onClose();
  };

  const requestClose = () => {
    keepEdits();
    onClose();
  };

  const discard = async () => {
    const ok = await confirm({
      title: `¿Descartar ${totalOn === 1 ? "esta pieza" : `estas ${totalOn} piezas`}?`,
      message:
        "Tus instantes quedan tal cual; solo se descarta lo que Nexo propuso a partir de ellos.",
      confirmLabel: "Descartar",
      cancelLabel: "Seguir revisando",
      danger: true,
      icon: "warning",
    });
    if (!ok) return;
    removeJobs(jobs.map((j) => j.id));
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
  const preset = useMemo(
    () => jobs.find((j) => j.id === row?.jobId)?.people ?? [],
    [jobs, row?.jobId],
  );
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

  if (!plan) return null;
  return (
    <Sheet
      label="Piezas de tus instantes"
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
              void save();
            }
          }}
        >
          <header className="xp-head">
            <h2>
              {many ? "Piezas de tus instantes" : "Piezas de tu instante"}
              <small>
                Corrige o apaga lo que no va. Cada pieza queda vinculada a su
                instante.
              </small>
            </h2>
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
              aria-label="Cerrar (siguen esperando en la barra)"
              title="Cerrar · siguen esperando en la barra"
              onClick={requestClose}
            >
              <X size={18} />
            </button>
          </header>

          <div className="xp-review">
            {plans.length > 1 && (
              <nav className="xp-batch" aria-label="Experiencias">
                {plans.map((p, i) => (
                  <button
                    type="button"
                    key={i}
                    className={(i === at ? "on" : "") + (p.off ? " skip" : "")}
                    onClick={() => setAt(i)}
                    title={p.text}
                  >
                    <b>{i + 1}</b>
                    <span>{p.episode.title || excerpt(p.text, 40)}</span>
                    <small>{p.off ? "Omitida" : planCount(p)}</small>
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

            <button
              type="button"
              className="xp-source-toggle"
              aria-expanded={showSource}
              onClick={() => setShowSource((v) => !v)}
            >
              <Feather size={13} />
              <span>{excerpt(plan.text, showSource ? 40 : 110)}</span>
              <ChevronDown size={14} className={showSource ? "open" : ""} />
            </button>
            {showSource && (
              <blockquote className="xp-source">{plan.text}</blockquote>
            )}

            <EpisodeToggle
              plan={plan}
              setPlan={setPlan}
              disabled={app.experiencesMissing && !plan.episodeExisting}
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
                            className={"xp-opt" + (a.chosen === id ? " on" : "")}
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
                  <KinLinkRow key={k.id} link={k} plan={plan} setPlan={setPlan} />
                ))}

                {plan.newPeople.map((n) => (
                  <div key={n.id} className={"xp-ask" + (n.on ? "" : " muted")}>
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
                                x.id === n.id ? { ...x, name: e.target.value } : x,
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
              {!plan.pieces.length && (
                <p className="xp-none">
                  Aquí no hay piezas; solo personas o vínculos por guardar.
                </p>
              )}
            </div>
          </div>

          <footer className="xp-foot">
            <button
              type="button"
              className="cp-btn ghost xp-discard"
              disabled={busy}
              onClick={() => void discard()}
            >
              <Trash2 size={15} /> Descartar
            </button>
            <span className="xp-keys" aria-hidden="true">
              <kbd>Ctrl</kbd>
              <kbd>Enter</kbd>
            </span>
            <button
              type="button"
              className="cp-btn cta"
              disabled={!totalOn || busy}
              onClick={() => void save()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}
              Guardar{" "}
              {totalOn > 0 && <span className="xp-count">{totalOn}</span>}
            </button>
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
  const { workspace } = useApp();
  const ep = plan.episode;
  // El episodio que elegiste al escribir: las piezas se suman a él.
  const existing = plan.episodeExisting
    ? workspace.episodes.find((e) => e.id === plan.episodeExisting)
    : undefined;
  const m = existing ? episodeKindOf(existing.kind) : episodeKinds[ep.kind];
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
        {on && existing ? (
          <span className="xp-title xp-title-fixed" title="Se suman a este episodio">
            <m.icon size={14} /> {existing.title}
          </span>
        ) : on ? (
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
      {on && !existing && (
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
