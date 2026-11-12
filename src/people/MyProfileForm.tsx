import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { useApp } from "../AppContext";
import { AutoTextarea } from "../composer/controls";
import { TagInput } from "../composer/TagInput";
import type {
  Gender,
  MyDate,
  MyGoal,
  NexoLength,
  NexoTone,
  PersonFact,
  Place,
  ProfileChange,
  ReadingPart,
} from "../data";
import { genderLabels } from "../lib/gender";
import { normalizeText } from "../lib/format";
import { lengthLabels, readingPartLabels, toneLabels } from "../lib/myself";
import { surnamesOf } from "../lib/relations";
import type { Draft } from "./myDraft";
import { MONTHS } from "./MyProfileView";

export const FORM_SECTIONS = [
  { id: "basico", label: "Sobre ti" },
  { id: "gustos", label: "Gustos" },
  { id: "ahora", label: "Ahora" },
  { id: "vida", label: "Vida" },
  { id: "datos", label: "Datos" },
  { id: "nexo", label: "Nexo" },
] as const;

const FACT_IDEAS = [
  "Talla",
  "Grupo sanguíneo",
  "Alergias",
  "Signo",
  "Comida favorita",
  "Mascota",
];
const DATE_IDEAS = ["Aniversario", "Mi santo", "Graduación"];
const HISTORY_FIELDS: Record<ProfileChange["field"], string> = {
  city: "Viví en",
  occupation: "Trabajé como",
  company: "Estuve en",
};
const PLACE_ROLES = [
  { key: "casa", label: "Tu casa", kind: "casa" },
  { key: "trabajo", label: "Tu trabajo", kind: "trabajo" },
  { key: "estudio", label: "Donde estudias", kind: "cultura" },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (month: number) =>
  month ? new Date(2024, month, 0).getDate() : 31;
const thisYear = new Date().getFullYear();

/**
 * Día, mes y año (opcional) de una fecha que vuelve cada año. Guarda MM-DD y el año aparte; si el
 * mes nuevo es más corto, el día se ajusta (31 de abril → 30 de abril).
 */
function DayMonthYear({
  id,
  md,
  year,
  onChange,
  yearLabel = "Año (opcional)",
}: {
  id?: string;
  md?: string;
  year?: number;
  onChange: (md: string | undefined, year: number | undefined) => void;
  yearLabel?: string;
}) {
  const [month, setMonth] = useState(md ? md.slice(0, 2) : "");
  const [day, setDay] = useState(md ? md.slice(3, 5) : "");
  const [y, setY] = useState(year ? String(year) : "");
  const yearOk = (v: string) =>
    /^\d{4}$/.test(v) && +v >= 1900 && +v <= thisYear;
  const emit = (m: string, d: string, yy: string) =>
    onChange(
      m && d ? `${m}-${d}` : undefined,
      yearOk(yy) ? Number(yy) : undefined,
    );
  const bad = y !== "" && !yearOk(y);
  return (
    <>
      <div className="mf-bday">
        <select
          id={id}
          aria-label="Día"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            emit(month, e.target.value, y);
          }}
        >
          <option value="">Día</option>
          {Array.from({ length: daysIn(Number(month)) }, (_, i) => (
            <option key={i} value={pad(i + 1)}>
              {i + 1}
            </option>
          ))}
        </select>
        <select
          aria-label="Mes"
          value={month}
          onChange={(e) => {
            const m = e.target.value;
            const max = daysIn(Number(m));
            const d = day && Number(day) > max ? pad(max) : day;
            setMonth(m);
            setDay(d);
            emit(m, d, y);
          }}
        >
          <option value="">Mes</option>
          {MONTHS.map((name, i) => (
            <option key={name} value={pad(i + 1)}>
              {name}
            </option>
          ))}
        </select>
        <input
          aria-label={yearLabel}
          inputMode="numeric"
          maxLength={4}
          placeholder={yearLabel}
          value={y}
          aria-invalid={bad}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 4);
            setY(v);
            emit(month, day, v);
          }}
        />
      </div>
      {bad && (
        <small className="bad">
          El año debe estar entre 1900 y {thisYear}.
        </small>
      )}
      {!bad && Boolean(day) !== Boolean(month) && (
        <small className="bad">Elige también el {day ? "mes" : "día"}.</small>
      )}
    </>
  );
}

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mf-sec" id={"mf-s-" + id} data-section={id}>
      <h3>
        {title}
        {hint && <span>{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/** El formulario de tu ficha: todo lo que puedes contar de ti, por secciones. */
export function MyProfileForm({
  d,
  set,
  tagSuggestions,
}: {
  d: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  tagSuggestions: string[];
}) {
  const { workspace, savePlace, notify } = useApp();
  const pretty = surnamesOf(d.name ?? "").map(
    (s) => (d.name ?? "").split(/\s+/).find((w) => normalizeText(w) === s) ?? s,
  );

  const field = (
    key: "alias" | "city" | "hometown" | "occupation" | "company",
    label: string,
    placeholder: string,
  ) => (
    <label className="mf-field">
      <span>{label}</span>
      <input
        id={"mf-" + key}
        value={d[key] ?? ""}
        maxLength={80}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  const tags = (
    key: "interests" | "likes" | "dislikes" | "languages" | "skills",
    label: string,
    placeholder: string,
    hint?: string,
    suggest = true,
  ) => (
    <div className="mf-tagrow">
      <label className="mf-label" htmlFor={"mf-" + key}>
        {label}
      </label>
      {hint && <small className="mf-hint">{hint}</small>}
      <TagInput
        id={"mf-" + key}
        tags={d[key] ?? []}
        max={20}
        suggestions={suggest ? tagSuggestions : undefined}
        onChange={(v) => set(key, v)}
        placeholder={placeholder}
      />
    </div>
  );

  // ── Listas editables ──
  const goals = d.goalItems ?? [];
  const setGoal = (i: number, patch: Partial<MyGoal>) =>
    set(
      "goalItems",
      goals.map((g, j) => (j === i ? { ...g, ...patch } : g)),
    );
  const history = d.history ?? [];
  const setStage = (i: number, patch: Partial<ProfileChange>) =>
    set(
      "history",
      history.map((h, j) => (j === i ? { ...h, ...patch } : h)),
    );
  const facts = d.facts ?? [];
  const setFact = (i: number, patch: Partial<PersonFact>) =>
    set(
      "facts",
      facts.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    );
  const dates = d.dates ?? [];
  const setDate = (i: number, patch: Partial<MyDate>) =>
    set(
      "dates",
      dates.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    );
  const voice = d.nexoVoice ?? {};
  const exclude = d.readingExclude ?? [];

  const episodes = workspace.episodes
    .filter((e) => e.status === "activo")
    .slice(0, 40);
  const works = workspace.entries
    .filter((e) => e.kind === "Trabajo" && e.details.stage !== "listo")
    .slice(0, 40);

  /** Crea el lugar «Casa» (o el que toque) y lo deja elegido. */
  async function createPlace(role: (typeof PLACE_ROLES)[number]) {
    const name =
      role.key === "casa"
        ? "Casa"
        : role.key === "trabajo"
          ? d.company?.trim() || "Trabajo"
          : d.company?.trim() || "Donde estudio";
    const place = await savePlace({
      name,
      kind: role.kind,
      city: d.city?.trim() ?? "",
      address: "",
      story: "",
      images: [],
      favorite: false,
    });
    if (place) {
      set("places", { ...d.places, [role.key]: place.id });
      notify(`Creaste el lugar «${place.name}».`);
    }
  }
  const placeOptions = (kind: Place["kind"]) =>
    [...workspace.places].sort(
      (a, b) =>
        Number(b.kind === kind) - Number(a.kind === kind) ||
        a.name.localeCompare(b.name, "es"),
    );

  return (
    <>
      <Section id="basico" title="Sobre ti">
        <div className="mf-grid">
          <label className="mf-field full">
            <span>Nombre completo</span>
            <input
              id="mf-name"
              value={d.name ?? ""}
              maxLength={120}
              placeholder="Con tus apellidos"
              onChange={(e) => set("name", e.target.value)}
            />
            <small>
              {pretty.length
                ? `Tus apellidos: ${pretty.join(" · ")}. Con ellos Nexo reconoce a tu familia.`
                : "Escríbelo con tus apellidos: así Nexo reconoce a tu familia."}
            </small>
          </label>
          {field("alias", "Cómo te dicen", "Apodo")}
          <div className="mf-field">
            <span>Sexo</span>
            <div className="mf-seg" role="radiogroup" aria-label="Sexo">
              {(["f", "m"] as Gender[]).map((g, i) => (
                <button
                  type="button"
                  role="radio"
                  key={g}
                  id={i === 0 ? "mf-gender" : undefined}
                  aria-checked={d.gender === g}
                  className={d.gender === g ? "on" : ""}
                  onClick={() => set("gender", d.gender === g ? undefined : g)}
                >
                  {genderLabels[g]}
                </button>
              ))}
            </div>
          </div>
          <div className="mf-field full">
            <span id="mf-bday-label">Fecha de nacimiento</span>
            <div
              className="mf-birth"
              role="group"
              aria-labelledby="mf-bday-label"
            >
              <div className="mf-birth-date">
                <DayMonthYear
                  id="mf-bday"
                  md={d.birthday}
                  year={d.birthYear}
                  onChange={(md, y) => {
                    set("birthday", md);
                    set("birthYear", y);
                  }}
                />
              </div>
              <label className="mf-birth-time">
                <input
                  type="time"
                  aria-label="Hora (opcional)"
                  value={d.birthTime ?? ""}
                  onChange={(e) =>
                    set("birthTime", e.target.value || undefined)
                  }
                />
                {d.birthTime && (
                  <button
                    type="button"
                    aria-label="Quitar la hora"
                    title="Quitar la hora"
                    onClick={() => set("birthTime", undefined)}
                  >
                    <X size={13} />
                  </button>
                )}
              </label>
            </div>
            <small>
              El año y la hora son opcionales. Sin año, Nexo solo recuerda el
              día.
            </small>
          </div>
          {field("city", "Ciudad donde vives", "Medellín")}
          {field("hometown", "De dónde eres", "Ciudad o región de origen")}
          {field("occupation", "A qué te dedicas", "Diseñadora, estudiante…")}
          {field(
            "company",
            "Dónde trabajas o estudias",
            "Empresa o institución",
          )}
        </div>
      </Section>

      <Section id="gustos" title="Gustos">
        <div className="mf-tags">
          {tags(
            "interests",
            "Te interesa",
            "Fotografía, historia, correr…",
            "Temas que sigues o quieres aprender. También ordenan tu Libroteca por afinidad.",
          )}
          {tags("likes", "Te encanta", "Café de la mañana, el mar…")}
          {tags("dislikes", "No te gusta", "Madrugar, el ruido…")}
          {tags("languages", "Idiomas", "Español, inglés…", undefined, false)}
          {tags(
            "skills",
            "Habilidades",
            "Cocinar, Excel, guitarra…",
            undefined,
            false,
          )}
        </div>
      </Section>

      <Section id="ahora" title="Ahora" hint="Metas con plazo y avance">
        <div className="mf-rows" id="mf-goals" tabIndex={-1}>
          {goals.map((g, i) => (
            <div className="mf-goal-row" key={g.id}>
              <input
                className="mf-in grow"
                value={g.text}
                maxLength={120}
                placeholder="Aprender inglés, terminar la tesis…"
                aria-label="Meta"
                onChange={(e) => setGoal(i, { text: e.target.value })}
              />
              <button
                type="button"
                className="mf-x"
                aria-label="Quitar meta"
                onClick={() =>
                  set(
                    "goalItems",
                    goals.filter((_, j) => j !== i),
                  )
                }
              >
                <X size={14} />
              </button>
              <div className="mf-goal-opts">
                <label>
                  <span>Para</span>
                  <input
                    type="date"
                    className="mf-in"
                    value={g.due ?? ""}
                    onChange={(e) =>
                      setGoal(i, { due: e.target.value || undefined })
                    }
                  />
                </label>
                <label className="mf-range">
                  <span>Avance {g.progress ?? 0}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={g.progress ?? 0}
                    onChange={(e) =>
                      setGoal(i, { progress: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  <span>Va con</span>
                  <select
                    className="mf-in"
                    value={g.link ? `${g.link.kind}:${g.link.id}` : ""}
                    onChange={(e) => {
                      const [kind, id] = e.target.value.split(":");
                      setGoal(i, {
                        link: id
                          ? { kind: kind as "episodio" | "trabajo", id }
                          : undefined,
                      });
                    }}
                  >
                    <option value="">Nada</option>
                    {episodes.length > 0 && (
                      <optgroup label="Episodios">
                        {episodes.map((e) => (
                          <option key={e.id} value={`episodio:${e.id}`}>
                            {e.title}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {works.length > 0 && (
                      <optgroup label="Trabajos">
                        {works.map((e) => (
                          <option key={e.id} value={`trabajo:${e.id}`}>
                            {e.title}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              </div>
            </div>
          ))}
          {goals.length < 12 && (
            <button
              type="button"
              className="cp-chip"
              onClick={() =>
                set("goalItems", [
                  ...goals,
                  { id: crypto.randomUUID(), text: "" },
                ])
              }
            >
              <Plus size={13} /> Añadir meta
            </button>
          )}
        </div>
        <div className="mf-tagrow">
          <label className="mf-label" htmlFor="mf-about">
            En tus palabras
          </label>
          <AutoTextarea
            id="mf-about"
            className="cp-soft-area mf-about"
            minRows={3}
            maxLength={3000}
            placeholder="Lo que quieras que Nexo tenga en cuenta de ti."
            value={d.about ?? ""}
            onChange={(e) => set("about", e.target.value)}
          />
        </div>
      </Section>

      <Section id="vida" title="Vida" hint="Trayectoria, lugares y fechas">
        <span className="mf-label">Trayectoria</span>
        <small className="mf-hint">
          Dónde viviste, trabajaste o estudiaste antes. Si cambias tu ciudad,
          ocupación o empresa, lo anterior pasa aquí solo.
        </small>
        <div className="mf-rows" id="mf-history" tabIndex={-1}>
          {history.map((h, i) => (
            <div className="mf-row" key={i}>
              <select
                className="mf-in"
                aria-label="Qué"
                value={h.field}
                onChange={(e) =>
                  setStage(i, {
                    field: e.target.value as ProfileChange["field"],
                  })
                }
              >
                {Object.entries(HISTORY_FIELDS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                className="mf-in grow"
                value={h.value}
                maxLength={80}
                placeholder={
                  h.field === "city"
                    ? "Bogotá"
                    : h.field === "company"
                      ? "Universidad, empresa…"
                      : "Mesero, practicante…"
                }
                aria-label="Dónde o qué"
                onChange={(e) => setStage(i, { value: e.target.value })}
              />
              <label className="mf-until">
                <span>hasta</span>
                <input
                  type="month"
                  className="mf-in"
                  value={h.until.slice(0, 7)}
                  onChange={(e) =>
                    setStage(i, {
                      until: e.target.value ? e.target.value + "-01" : "",
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="mf-x"
                aria-label="Quitar etapa"
                onClick={() =>
                  set(
                    "history",
                    history.filter((_, j) => j !== i),
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="cp-chip"
            onClick={() =>
              set("history", [
                ...history,
                { field: "city", value: "", until: "" },
              ])
            }
          >
            <Plus size={13} /> Añadir etapa
          </button>
        </div>

        <span className="mf-label mf-gap">Tus lugares</span>
        <small className="mf-hint">
          Con ellos la captura y el diario entienden «en casa» o «en la
          oficina».
        </small>
        <div className="mf-grid" id="mf-places" tabIndex={-1}>
          {PLACE_ROLES.map((role) => {
            const value = d.places?.[role.key] ?? "";
            return (
              <label className="mf-field" key={role.key}>
                <span>{role.label}</span>
                <select
                  className="mf-in"
                  value={value}
                  onChange={(e) => {
                    if (e.target.value === "__new")
                      return void createPlace(role);
                    set("places", {
                      ...d.places,
                      [role.key]: e.target.value || undefined,
                    });
                  }}
                >
                  <option value="">Sin elegir</option>
                  {placeOptions(role.kind).map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                      {pl.city ? ` · ${pl.city}` : ""}
                    </option>
                  ))}
                  <option value="__new">＋ Crear un lugar nuevo</option>
                </select>
              </label>
            );
          })}
        </div>

        <span className="mf-label mf-gap">Tus fechas</span>
        <small className="mf-hint">
          Aniversarios, tu santo… Aparecen en tu agenda de hoy.
        </small>
        <div className="mf-rows" id="mf-dates" tabIndex={-1}>
          {dates.map((f, i) => (
            <div className="mf-row wrap" key={f.id}>
              <input
                className="mf-in grow"
                value={f.label}
                maxLength={60}
                placeholder="Aniversario con Ana"
                aria-label="Qué se celebra"
                onChange={(e) => setDate(i, { label: e.target.value })}
              />
              <div className="mf-date-pick">
                <DayMonthYear
                  md={f.md || undefined}
                  year={f.year}
                  yearLabel="Desde (año)"
                  onChange={(md, year) => setDate(i, { md: md ?? "", year })}
                />
              </div>
              <button
                type="button"
                className="mf-x"
                aria-label="Quitar fecha"
                onClick={() =>
                  set(
                    "dates",
                    dates.filter((_, j) => j !== i),
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="cp-chips">
            {DATE_IDEAS.filter(
              (idea) => !dates.some((f) => f.label === idea),
            ).map((idea) => (
              <button
                type="button"
                key={idea}
                className="cp-chip"
                onClick={() =>
                  set("dates", [
                    ...dates,
                    { id: crypto.randomUUID(), label: idea, md: "" },
                  ])
                }
              >
                <Plus size={13} /> {idea}
              </button>
            ))}
            <button
              type="button"
              className="cp-chip"
              onClick={() =>
                set("dates", [
                  ...dates,
                  { id: crypto.randomUUID(), label: "", md: "" },
                ])
              }
            >
              <Plus size={13} /> Otra fecha
            </button>
          </div>
        </div>
      </Section>

      <Section
        id="datos"
        title="Datos libres"
        hint="Talla, alergias, grupo sanguíneo…"
      >
        <div className="mf-rows" id="mf-facts" tabIndex={-1}>
          {facts.map((f, i) => (
            <div className="mf-row" key={f.id}>
              <input
                className="mf-in"
                placeholder="Qué"
                maxLength={60}
                value={f.label}
                aria-label="Dato"
                onChange={(e) => setFact(i, { label: e.target.value })}
              />
              <input
                className="mf-in grow"
                placeholder="Valor"
                maxLength={300}
                value={f.value}
                aria-label="Valor"
                onChange={(e) => setFact(i, { value: e.target.value })}
              />
              <button
                type="button"
                className="mf-x"
                aria-label="Quitar dato"
                onClick={() =>
                  set(
                    "facts",
                    facts.filter((_, j) => j !== i),
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="cp-chips">
            {FACT_IDEAS.filter(
              (idea) => !facts.some((f) => f.label === idea),
            ).map((idea) => (
              <button
                type="button"
                key={idea}
                className="cp-chip"
                onClick={() =>
                  set("facts", [
                    ...facts,
                    { id: crypto.randomUUID(), label: idea, value: "" },
                  ])
                }
              >
                <Plus size={13} /> {idea}
              </button>
            ))}
            <button
              type="button"
              className="cp-chip"
              onClick={() =>
                set("facts", [
                  ...facts,
                  { id: crypto.randomUUID(), label: "", value: "" },
                ])
              }
            >
              <Plus size={13} /> Otro dato
            </button>
          </div>
        </div>
      </Section>

      <Section
        id="nexo"
        title="Cómo te habla Nexo"
        hint="Saludo, chat y lectura"
      >
        <div className="mf-field">
          <span>Tono</span>
          <div className="mf-seg wrap" role="radiogroup" aria-label="Tono">
            {(Object.keys(toneLabels) as NexoTone[]).map((t, i) => (
              <button
                type="button"
                role="radio"
                key={t}
                id={i === 0 ? "mf-tone" : undefined}
                aria-checked={voice.tone === t}
                className={voice.tone === t ? "on" : ""}
                onClick={() =>
                  set("nexoVoice", {
                    ...voice,
                    tone: voice.tone === t ? undefined : t,
                  })
                }
              >
                {toneLabels[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="mf-field mf-gap">
          <span>Extensión</span>
          <div className="mf-seg" role="radiogroup" aria-label="Extensión">
            {(Object.keys(lengthLabels) as NexoLength[]).map((t) => (
              <button
                type="button"
                role="radio"
                key={t}
                aria-checked={voice.length === t}
                className={voice.length === t ? "on" : ""}
                onClick={() =>
                  set("nexoVoice", {
                    ...voice,
                    length: voice.length === t ? undefined : t,
                  })
                }
              >
                {lengthLabels[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="mf-tagrow mf-gap">
          <label className="mf-label" htmlFor="mf-avoid">
            Temas que prefieres que no saque
          </label>
          <TagInput
            id="mf-avoid"
            tags={voice.avoid ?? []}
            max={12}
            onChange={(v) => set("nexoVoice", { ...voice, avoid: v })}
            placeholder="Política, mi ex…"
          />
        </div>
        <span className="mf-label mf-gap">Privacidad de la lectura</span>
        <small className="mf-hint">
          Lo que marques no se envía a la IA cuando escribe tu lectura.
        </small>
        <div className="mf-checks">
          {(Object.keys(readingPartLabels) as ReadingPart[]).map((k) => (
            <label key={k} className={exclude.includes(k) ? "on" : ""}>
              <input
                type="checkbox"
                checked={exclude.includes(k)}
                onChange={(e) =>
                  set(
                    "readingExclude",
                    e.target.checked
                      ? [...exclude, k]
                      : exclude.filter((x) => x !== k),
                  )
                }
              />
              Sin {readingPartLabels[k].toLowerCase()}
            </label>
          ))}
        </div>
      </Section>
    </>
  );
}
