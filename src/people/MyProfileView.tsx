import { useMemo, type ReactNode } from "react";
import {
  BookOpen,
  Briefcase,
  CalendarHeart,
  Flame,
  GraduationCap,
  Home,
  Languages,
  Link2,
  MapPin,
  MessageCircleHeart,
  NotebookPen,
  Pencil,
  Plus,
  Quote,
  Route,
  Shield,
  Smile,
  Target,
  Users,
  Wrench,
} from "lucide-react";
import { useApp } from "../AppContext";
import type { MyProfile, Person, Place } from "../data";
import { genderOf } from "../lib/gender";
import { normalizeText, shortDate, todayInputValue } from "../lib/format";
import {
  daysToMonthDay,
  goalItemsOf,
  lengthLabels,
  matchesFor,
  moodWord,
  nexoNumbers,
  readingPartLabels,
  toneLabels,
  type Match,
} from "../lib/myself";
import {
  ME,
  kindWord,
  surnamesOf,
  tieKinds,
  tiesOf,
  type TieCategory,
  type TieView,
} from "../lib/relations";
import { closestPeople } from "../lib/selfDigest";
import { booksFinishedIn, useReadingGoals } from "../library/goals";
import { Avatar } from "./Avatar";

export const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const SHORT_MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** «14 de marzo» a partir de MM-DD. */
export const monthDay = (md: string) =>
  `${Number(md.slice(3))} de ${MONTHS[Number(md.slice(0, 2)) - 1]}`;
/** «jun 2024» a partir de AAAA-MM(-DD). */
const monthYear = (d: string) =>
  `${SHORT_MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

const GENTE: { cat: TieCategory; title: string }[] = [
  { cat: "familia", title: "Familia" },
  { cat: "pareja", title: "Pareja" },
  { cat: "amistad", title: "Amistades" },
];

const whenWord = (d: number) =>
  d === 0 ? "Hoy" : d === 1 ? "Mañana" : `En ${d} días`;

/**
 * Tu ficha para leer: lo esencial de ti, ordenado y resumido. Cada bloque vacío invita a
 * completarlo; «Editar» abre el formulario.
 */
export function MyProfileView({
  profile: p,
  onEdit,
  onClose,
}: {
  profile: MyProfile;
  /** Abre el formulario (y salta a ese campo, si se indica). */
  onEdit: (field?: string) => void;
  onClose: () => void;
}) {
  const { workspace, openTie, openGroup, peekPerson, go, viewEntry } = useApp();
  const today = todayInputValue();
  const year = today.slice(0, 4);
  const { goalOf } = useReadingGoals();

  const byId = useMemo(
    () => new Map(workspace.people.map((x) => [x.id, x])),
    [workspace.people],
  );
  const mine = useMemo(() => tiesOf(ME, workspace.ties), [workspace.ties]);
  const byCategory = useMemo(() => {
    const m = new Map<TieCategory, TieView[]>();
    for (const v of mine) {
      if (v.other === ME || !byId.has(v.other)) continue;
      const c = tieKinds[v.kind].category;
      m.set(c, [...(m.get(c) ?? []), v]);
    }
    return m;
  }, [mine, byId]);
  const closest = useMemo(
    () => closestPeople(workspace, today, 8),
    [workspace, today],
  );
  const numbers = useMemo(
    () => nexoNumbers(workspace, today),
    [workspace, today],
  );
  const matches = useMemo(
    () => matchesFor(p, workspace.people),
    [p, workspace.people],
  );

  // Familia por apellidos (sin los que ya vinculaste).
  const name = p.name ?? "";
  const surnames = surnamesOf(name);
  const tied = new Set(mine.map((v) => v.other));
  const kin = surnames.length
    ? workspace.people
        .filter(
          (x) =>
            !tied.has(x.id) &&
            normalizeText(x.name.trim()) !== normalizeText(name.trim()) &&
            surnamesOf(x.name).some((s) => surnames.includes(s)),
        )
        .slice(0, 12)
    : [];

  const placeOf = (id?: string) =>
    id ? workspace.places.find((x) => x.id === id) : undefined;
  const goals = goalItemsOf(p);
  const goal = goalOf(year);
  const booksDone = booksFinishedIn(workspace.entries, year).length;

  const leave = (run: () => void) => {
    onClose();
    run();
  };
  const openPlace = (place: Place) => leave(() => go("Lugares", place));

  const personChip = (x: Person, note: string, key: string) => (
    <button
      type="button"
      className="mf-kin"
      key={key}
      title={`Ver la ficha de ${x.name}`}
      onClick={() => peekPerson(x)}
    >
      <Avatar person={x} size={26} />
      <strong>{x.name.split(" ")[0]}</strong>
      {note && <small>{note}</small>}
    </button>
  );

  const section = (
    id: string,
    icon: ReactNode,
    title: string,
    children: ReactNode,
    edit?: string,
  ) => (
    <section className="mf-card" id={"mf-v-" + id}>
      <header>
        <span className="mf-card-ico">{icon}</span>
        <h3>{title}</h3>
        {edit && (
          <button
            type="button"
            className="mf-card-edit"
            onClick={() => onEdit(edit)}
          >
            <Pencil size={12} /> Editar
          </button>
        )}
      </header>
      {children}
    </section>
  );

  // ── Esencial ──
  const birth = p.birthday
    ? [
        monthDay(p.birthday) + (p.birthYear ? ` de ${p.birthYear}` : ""),
        p.birthTime && `${p.birthTime} h`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const familyCount = byCategory.get("familia")?.length ?? 0;
  const partnerCount = byCategory.get("pareja")?.length ?? 0;
  const friendCount = byCategory.get("amistad")?.length ?? 0;
  const essentials: {
    icon: ReactNode;
    label: string;
    value: string;
    field: string;
  }[] = [
    {
      icon: <CalendarHeart size={15} />,
      label: "Nacimiento",
      value: birth,
      field: "mf-bday",
    },
    {
      icon: <MapPin size={15} />,
      label: "Vives en",
      value: [p.city?.trim(), p.hometown?.trim() && `de ${p.hometown.trim()}`]
        .filter(Boolean)
        .join(" · "),
      field: "mf-city",
    },
    {
      icon: <Briefcase size={15} />,
      label: "A qué te dedicas",
      value: [p.occupation?.trim(), p.company?.trim()]
        .filter(Boolean)
        .join(" · "),
      field: "mf-occupation",
    },
    {
      icon: <Users size={15} />,
      label: "Tu gente",
      value: [
        familyCount && `${familyCount} de familia`,
        partnerCount &&
          (partnerCount === 1 ? "pareja" : `${partnerCount} parejas`),
        friendCount &&
          `${friendCount} ${friendCount === 1 ? "amistad" : "amistades"}`,
      ]
        .filter(Boolean)
        .join(" · "),
      field: "",
    },
  ];

  // ── Gustos ──
  const tasteGroups = [
    { label: "Te interesa", items: p.interests ?? [], tone: "" },
    { label: "Te encanta", items: p.likes ?? [], tone: "love" },
    { label: "No te gusta", items: p.dislikes ?? [], tone: "no" },
  ].filter((g) => g.items.length);
  const extras = [
    {
      icon: <Languages size={13} />,
      label: "Idiomas",
      items: p.languages ?? [],
    },
    { icon: <Wrench size={13} />, label: "Habilidades", items: p.skills ?? [] },
  ].filter((g) => g.items.length);

  // ── Trayectoria ──
  const now = [
    p.city?.trim() && {
      icon: <MapPin size={13} />,
      text: `Vives en ${p.city.trim()}`,
    },
    p.occupation?.trim() && {
      icon: <Briefcase size={13} />,
      text: p.occupation.trim(),
    },
    p.company?.trim() && {
      icon: <GraduationCap size={13} />,
      text: `En ${p.company.trim()}`,
    },
  ].filter(Boolean) as { icon: ReactNode; text: string }[];
  const past = [...(p.history ?? [])].sort((a, b) =>
    b.until.localeCompare(a.until),
  );
  const pastWord = {
    city: "Viviste en",
    occupation: "Fuiste",
    company: "Estuviste en",
  };

  // ── Lugares y fechas ──
  const myPlaces = (
    [
      ["casa", "Casa", <Home size={13} key="h" />],
      ["trabajo", "Trabajo", <Briefcase size={13} key="t" />],
      ["estudio", "Estudio", <GraduationCap size={13} key="e" />],
    ] as const
  ).flatMap(([k, label, icon]) => {
    const place = placeOf(p.places?.[k]);
    return place ? [{ k, label, icon, place }] : [];
  });
  const dates = (p.dates ?? [])
    .map((f) => ({ f, d: daysToMonthDay(f.md, today) }))
    .filter((x): x is { f: (typeof x)["f"]; d: number } => x.d !== null)
    .sort((a, b) => a.d - b.d);

  // ── Coincidencias ──
  const matchBox = (key: string, list: Match[], title: string, hint: string) =>
    list.length > 0 && (
      <div className="mf-match" key={key}>
        <div>
          <strong>{title}</strong>
          <small>{hint}</small>
          <div className="mf-kin-list">
            {list
              .slice(0, 6)
              .map((m) => personChip(m.person, m.why ?? "", key + m.person.id))}
            {list.length > 6 && (
              <span className="mf-more">+{list.length - 6}</span>
            )}
          </div>
        </div>
        <div className="mf-match-actions">
          <button
            type="button"
            className="mf-ghost-btn"
            onClick={() =>
              openTie(
                null,
                list.map((m) => m.person.id),
              )
            }
          >
            <Link2 size={13} /> Vincular
          </button>
          <button
            type="button"
            className="mf-ghost-btn"
            onClick={() =>
              openGroup(
                undefined,
                list.map((m) => m.person.id),
              )
            }
          >
            <Users size={13} /> Crear grupo
          </button>
        </div>
      </div>
    );
  const first = (list: Match[]) => list[0]?.person.name.split(" ")[0] ?? "";
  const plural = (n: number, one: string, many: string) =>
    n === 1 ? one : many;

  const voice = p.nexoVoice;
  const hasVoice = Boolean(
    voice?.tone || voice?.length || voice?.avoid?.length,
  );
  const excluded = p.readingExclude ?? [];

  return (
    <>
      {/* ── En números ── */}
      <section className="mf-numbers" aria-label="Tu Nexo en números">
        <div>
          <Users size={15} />
          <b>{numbers.people}</b>
          <small>{plural(numbers.people, "persona", "personas")}</small>
        </div>
        <div>
          <NotebookPen size={15} />
          <b>{numbers.memories}</b>
          <small>{plural(numbers.memories, "recuerdo", "recuerdos")}</small>
        </div>
        <div
          title={
            numbers.mood !== null
              ? `Promedio de ${numbers.moodCount} registros con ánimo`
              : undefined
          }
        >
          <Smile size={15} />
          <b>{numbers.mood !== null ? moodWord(numbers.mood) : "—"}</b>
          <small>ánimo · 90 días</small>
        </div>
        <div className={numbers.streak ? "hot" : ""}>
          <Flame size={15} />
          <b>{numbers.streak}</b>
          <small>
            {numbers.streak
              ? `${plural(numbers.streak, "día", "días")} de diario${numbers.wroteToday ? "" : " · escribe hoy"}`
              : numbers.bestStreak
                ? `racha · mejor: ${numbers.bestStreak}`
                : "días de diario"}
          </small>
        </div>
        <button
          type="button"
          className="mf-goal"
          title="Abrir la Libroteca"
          onClick={() => leave(() => go("Libroteca"))}
        >
          <BookOpen size={15} />
          <span>
            {goal
              ? `${booksDone} de ${goal} libros en ${year}`
              : `${booksDone} ${plural(booksDone, "libro terminado", "libros terminados")} en ${year}`}
            {!goal && <em> · ponte una meta</em>}
          </span>
          {goal > 0 && (
            <b>
              <i
                style={{
                  width: `${Math.min(100, Math.round((100 * booksDone) / goal))}%`,
                }}
              />
            </b>
          )}
        </button>
      </section>

      {/* ── Esencial ── */}
      {section(
        "esencial",
        <Shield size={14} />,
        "Lo esencial",
        <>
          <div className="mf-facts">
            {essentials.map((x) => (
              <div className="mf-fact" key={x.label}>
                <span className="mf-fact-ico">{x.icon}</span>
                <div>
                  <small>{x.label}</small>
                  {x.value ? (
                    <strong>{x.value}</strong>
                  ) : x.field ? (
                    <button
                      type="button"
                      className="mf-add"
                      onClick={() => onEdit(x.field)}
                    >
                      <Plus size={12} /> Añadir
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mf-add"
                      onClick={() => openTie(null)}
                    >
                      <Link2 size={12} /> Vincular
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {p.about?.trim() && (
            <blockquote className="mf-quote">
              <Quote size={14} aria-hidden="true" />
              {p.about.trim()}
            </blockquote>
          )}
        </>,
        "mf-name",
      )}

      {/* ── Gustos ── */}
      {(tasteGroups.length > 0 || extras.length > 0) &&
        section(
          "gustos",
          <MessageCircleHeart size={14} />,
          "Lo tuyo",
          <div className="mf-taste">
            {tasteGroups.map((g) => (
              <div key={g.label}>
                <small>{g.label}</small>
                <div className={"mf-chips " + g.tone}>
                  {g.items.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>
            ))}
            {extras.map((g) => (
              <div key={g.label}>
                <small>
                  {g.icon} {g.label}
                </small>
                <div className="mf-chips plain">
                  {g.items.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>,
          "mf-interests",
        )}

      {/* ── En qué estás ── */}
      {goals.length > 0 &&
        section(
          "ahora",
          <Target size={14} />,
          "En qué estás",
          <ul className="mf-goals">
            {goals.map((g) => {
              const ep =
                g.link?.kind === "episodio"
                  ? workspace.episodes.find((x) => x.id === g.link!.id)
                  : undefined;
              const work =
                g.link?.kind === "trabajo"
                  ? workspace.entries.find((x) => x.id === g.link!.id)
                  : undefined;
              const pct =
                g.progress ??
                (work?.details.stage === "listo" ? 100 : undefined);
              const late = g.due && g.due < today && (pct ?? 0) < 100;
              return (
                <li key={g.id}>
                  <div className="mf-goal-top">
                    <strong>{g.text}</strong>
                    {pct !== undefined && <b>{pct}%</b>}
                  </div>
                  {pct !== undefined && (
                    <span className="mf-bar">
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  )}
                  {(g.due || ep || work) && (
                    <div className="mf-goal-meta">
                      {g.due && (
                        <span className={late ? "late" : ""}>
                          {late ? "Venció" : "Para"} el{" "}
                          {shortDate(g.due + "T12:00:00")}
                        </span>
                      )}
                      {ep && (
                        <button
                          type="button"
                          onClick={() => leave(() => go("Episodios", ep))}
                        >
                          Episodio · {ep.title}
                        </button>
                      )}
                      {work && (
                        <button
                          type="button"
                          onClick={() => leave(() => viewEntry(work))}
                        >
                          Trabajo · {work.title}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>,
          "mf-goals",
        )}

      {/* ── Trayectoria ── */}
      {(now.length > 0 || past.length > 0) &&
        section(
          "trayectoria",
          <Route size={14} />,
          "Trayectoria",
          <ol className="mf-line">
            {now.length > 0 && (
              <li className="now">
                <small>Hoy</small>
                <div>
                  {now.map((x) => (
                    <span key={x.text}>
                      {x.icon} {x.text}
                    </span>
                  ))}
                </div>
              </li>
            )}
            {past.map((h) => (
              <li key={h.field + h.value + h.until}>
                <small>Hasta {monthYear(h.until)}</small>
                <div>
                  <span>
                    {pastWord[h.field]} {h.value}
                  </span>
                </div>
              </li>
            ))}
          </ol>,
          "mf-history",
        )}

      {/* ── Lugares y fechas ── */}
      {(myPlaces.length > 0 || dates.length > 0) &&
        section(
          "lugares",
          <MapPin size={14} />,
          "Tus lugares y fechas",
          <div className="mf-places">
            {myPlaces.length > 0 && (
              <div className="mf-chips plain">
                {myPlaces.map((x) => (
                  <button
                    type="button"
                    key={x.k}
                    onClick={() => openPlace(x.place)}
                  >
                    {x.icon} {x.label}: <b>{x.place.name}</b>
                  </button>
                ))}
              </div>
            )}
            {dates.length > 0 && (
              <ul className="mf-dates">
                {dates.map(({ f, d }) => {
                  const n = f.year
                    ? Number(year) - f.year + (today.slice(5) > f.md ? 1 : 0)
                    : 0;
                  return (
                    <li key={f.id} className={d <= 7 ? "soon" : ""}>
                      <span className="mf-date-day">
                        <b>{Number(f.md.slice(3))}</b>
                        <small>
                          {SHORT_MONTHS[Number(f.md.slice(0, 2)) - 1]}
                        </small>
                      </span>
                      <span>
                        <strong>{f.label}</strong>
                        <small>
                          {d <= 30 ? whenWord(d) : `En ${d} días`}
                          {n > 0 && ` · ${n} ${plural(n, "año", "años")}`}
                        </small>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          "mf-places",
        )}

      {/* ── Datos libres ── */}
      {(p.facts?.length ?? 0) > 0 &&
        section(
          "datos",
          <NotebookPen size={14} />,
          "Datos",
          <dl className="mf-dl">
            {p.facts!.map((f) => (
              <div key={f.id}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>,
          "mf-facts",
        )}

      {/* ── Mi gente ── */}
      <section className="mf-card" id="mf-v-gente">
        <header>
          <span className="mf-card-ico">
            <Users size={14} />
          </span>
          <h3>Mi gente</h3>
          <button
            type="button"
            className="mf-card-edit"
            onClick={() => openTie(null)}
          >
            <Link2 size={12} /> Vincular
          </button>
        </header>
        {GENTE.map(({ cat, title }) => {
          const list = byCategory.get(cat) ?? [];
          if (!list.length && cat !== "familia") return null;
          return (
            <div className="mf-group" key={cat}>
              <span className="mf-label">{title}</span>
              {list.length > 0 ? (
                <div className="mf-kin-list">
                  {list.map((v) => {
                    const x = byId.get(v.other)!;
                    return personChip(
                      x,
                      kindWord(v.kind, genderOf(x)),
                      v.tie.id,
                    );
                  })}
                </div>
              ) : (
                <div className="mf-empty">
                  <span>Aún no vinculas a tu familia.</span>
                  <button
                    type="button"
                    className="mf-link-btn"
                    onClick={() => openTie(null)}
                  >
                    <Link2 size={14} /> Vincular
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {closest.length > 0 && (
          <div className="mf-group">
            <span className="mf-label">Con quién más te ves</span>
            <small className="mf-hint">
              Por recuerdos juntos en los últimos 6 meses.
            </small>
            <div className="mf-kin-list">
              {closest.map(({ person, count }) =>
                personChip(
                  person,
                  `${count} ${plural(count, "recuerdo", "recuerdos")}`,
                  "c-" + person.id,
                ),
              )}
            </div>
          </div>
        )}
        {kin.length > 0 && (
          <div className="mf-match">
            <div>
              <strong>
                {kin.length === 1
                  ? `${kin[0].name.split(" ")[0]} comparte tu apellido`
                  : `${kin.length} personas comparten tus apellidos`}
              </strong>
              <small>¿Son tu familia?</small>
              <div className="mf-faces">
                {kin.slice(0, 8).map((x) => (
                  <Avatar key={x.id} person={x} size={26} />
                ))}
              </div>
            </div>
            <div className="mf-match-actions">
              <button
                type="button"
                className="mf-ghost-btn"
                onClick={() =>
                  openTie(
                    null,
                    kin.map((x) => x.id),
                  )
                }
              >
                <Link2 size={13} /> Vincular
              </button>
            </div>
          </div>
        )}
        {matchBox(
          "co",
          matches.colleagues,
          matches.colleagues.length === 1
            ? `${first(matches.colleagues)} está en ${p.company?.trim()}`
            : `${matches.colleagues.length} personas están en ${p.company?.trim()}`,
          "Trabajan o estudian donde tú.",
        )}
        {matchBox(
          "ci",
          matches.neighbors,
          matches.neighbors.length === 1
            ? `${first(matches.neighbors)} vive en ${p.city?.split(",")[0].trim()}`
            : `${matches.neighbors.length} personas viven en ${p.city?.split(",")[0].trim()}`,
          "Viven en tu ciudad.",
        )}
        {matchBox(
          "in",
          matches.shared,
          matches.shared.length === 1
            ? `${first(matches.shared)} comparte tu interés por ${matches.shared[0].why?.toLowerCase()}`
            : `${matches.shared.length} personas comparten tus intereses`,
          "Por lo que te interesa y te encanta.",
        )}
      </section>

      {/* ── Nexo y tú ── */}
      {section(
        "nexo",
        <MessageCircleHeart size={14} />,
        "Cómo te habla Nexo",
        <div className="mf-voice">
          {hasVoice ? (
            <div className="mf-chips plain">
              {voice?.tone && (
                <span>Tono: {toneLabels[voice.tone].toLowerCase()}</span>
              )}
              {voice?.length && (
                <span>
                  Respuestas: {lengthLabels[voice.length].toLowerCase()}
                </span>
              )}
              {voice?.avoid?.map((t) => (
                <span key={t} className="no">
                  Sin {t}
                </span>
              ))}
            </div>
          ) : (
            <p className="mf-muted">
              Nexo te habla con su estilo de siempre.{" "}
              <button
                type="button"
                className="mf-add"
                onClick={() => onEdit("mf-tone")}
              >
                Elegir cómo
              </button>
            </p>
          )}
          {excluded.length > 0 && (
            <p className="mf-muted">
              Tu lectura no usa:{" "}
              {excluded
                .map((k) => readingPartLabels[k].toLowerCase())
                .join(", ")}
              .
            </p>
          )}
        </div>,
        "mf-tone",
      )}
    </>
  );
}
