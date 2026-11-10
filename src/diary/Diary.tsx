import { memo, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  CalendarDays,
  Feather,
  Flame,
  History,
  MapPin,
  Pencil,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { moods } from "../composer/controls";
import { plainText } from "../components/RichText";
import { Sheet } from "../components/Sheet";
import { LoadMore, useInfinite } from "../components/LoadMore";
import type { Entry, Person } from "../data";
import { addDays, friendlyDate, todayInputValue } from "../lib/format";
import { Avatar } from "../people/Avatar";
import {
  agoLabel,
  buildDays,
  commonMood,
  dayOf,
  dayOfYear,
  levelOf,
  longDay,
  monthShort,
  monthTitle,
  onThisDay,
  streaks,
  weekdayIndex,
  weekdayShort,
  weeksBetween,
  wordsOf,
  type DayStat,
} from "./model";
import "./diary.css";

const moodOf = (n?: number | null) => moods.find((m) => m.value === n);
const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;
const WEEK = ["L", "M", "X", "J", "V", "S", "D"];

type Filter = "todas" | "personas" | "fotos" | `m:${number}`;
type MapMode = "constancia" | "animo";

/**
 * El diario: la entrada de hoy, la constancia del año (al estilo de las contribuciones de
 * GitHub, pero por días escritos y por ánimo), lo que escribiste un día como hoy y todas las
 * entradas en una línea de tiempo por meses y días.
 */
export function Diary({
  entries,
  matches,
  query,
}: {
  /** Todas las entradas del diario (recuerdos de tipo «Nota»). */
  entries: Entry[];
  /** El buscador de la página. */
  matches: (e: Entry) => boolean;
  query: string;
}) {
  const { openEntry } = useApp();
  const today = todayInputValue();
  const days = useMemo(() => buildDays(entries), [entries]);
  const searching = query.trim() !== "";
  const [day, setDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todas");
  const [yearOpen, setYearOpen] = useState(false);

  const found = useMemo(() => entries.filter(matches), [entries, matches]);
  const moodChips = useMemo(
    () => moods.filter((m) => found.some((e) => e.details.mood === m.value)),
    [found],
  );
  const list = useMemo(() => {
    const test: (e: Entry) => boolean =
      filter === "personas"
        ? (e) => e.person_ids.length > 0
        : filter === "fotos"
          ? (e) => e.images.length > 0
          : filter.startsWith("m:")
            ? (e) => e.details.mood === Number(filter.slice(2))
            : () => true;
    return found
      .filter((e) => (!day || dayOf(e) === day) && test(e))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [found, day, filter]);
  const pager = useInfinite(list, 20, [day, filter, query].join("|"));
  const listHead = useRef<HTMLDivElement>(null);

  const write = () => openEntry("Nota", []);
  // Al elegir un día en el mapa del año, se cierra la ventana y se va a las entradas de ese día.
  const pickDay = (date: string | null) => {
    setDay(date);
    if (!date) return;
    setYearOpen(false);
    window.requestAnimationFrame(() =>
      listHead.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  return (
    <div className="dy">
      {!searching && (
        <TodayCard
          days={days}
          today={today}
          onWrite={write}
          onYear={entries.length ? () => setYearOpen(true) : undefined}
        />
      )}
      {yearOpen &&
        createPortal(
          <Sheet
            label="Tu año en el diario"
            className="dyy"
            onRequestClose={() => setYearOpen(false)}
          >
            <DiaryMap
              days={days}
              today={today}
              selected={day}
              onSelect={pickDay}
              onClose={() => setYearOpen(false)}
            />
          </Sheet>,
          document.body,
        )}

      <div className="dy-list-head" ref={listHead}>
        {!searching && (
          <h3>
            Entradas
            {found.length > 0 && (
              <small>{found.length.toLocaleString("es-CO")}</small>
            )}
          </h3>
        )}
        <div className="dy-toolbar">
        <div
          className="dy-filters"
          role="radiogroup"
          aria-label="Filtrar el diario"
        >
          {(
            [
              ["todas", "Todas", found.length],
              [
                "personas",
                "Con personas",
                found.filter((e) => e.person_ids.length).length,
              ],
              [
                "fotos",
                "Con fotos",
                found.filter((e) => e.images.length).length,
              ],
            ] as const
          ).map(([id, label, n]) =>
            id !== "todas" && !n ? null : (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={filter === id}
                className={filter === id ? "on" : ""}
                onClick={() => setFilter(id)}
              >
                {label} <i>{n}</i>
              </button>
            ),
          )}
          {moodChips.length > 0 && (
            <span className="dy-filters-div" aria-hidden="true" />
          )}
          {moodChips.map((m) => {
            const id: Filter = `m:${m.value}`;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={filter === id}
                aria-label={m.label}
                title={m.label}
                className={"mood" + (filter === id ? " on" : "")}
                onClick={() => setFilter(filter === id ? "todas" : id)}
              >
                {m.emoji}
              </button>
            );
          })}
        </div>
        {day && (
          <button
            type="button"
            className="dy-day-chip"
            onClick={() => setDay(null)}
          >
            <CalendarDays size={13} /> {longDay(day)}
            <X size={13} aria-label="Ver todos los días" />
          </button>
        )}
        </div>
      </div>

      {searching && (
        <p className="dy-found">
          {list.length
            ? `${plural(list.length, "entrada coincide", "entradas coinciden")} con «${query.trim()}»`
            : `Nada en tu diario coincide con «${query.trim()}».`}
        </p>
      )}

      {!entries.length ? (
        <div className="dy-blank">
          <Feather size={22} />
          <strong>Tu diario empieza hoy</strong>
          <p>
            Escribe unas líneas sobre tu día. Cada entrada queda aquí, en su
            fecha, y va llenando tu año.
          </p>
          <button type="button" className="dy-cta" onClick={write}>
            <Pencil size={15} /> Escribir la primera entrada
          </button>
        </div>
      ) : (
        !searching &&
        !list.length && <p className="dy-found">Nada con este filtro.</p>
      )}

      <Timeline entries={pager.visible} today={today} />
      <LoadMore
        rest={pager.rest}
        onMore={pager.loadMore}
        shown={pager.visible.length}
        auto={searching}
      />

      {!searching && entries.length > 0 && (
        <Recall days={days} today={today} />
      )}
    </div>
  );
}

/* ───────── Hoy ───────── */

function TodayCard({
  days,
  today,
  onWrite,
  onYear,
}: {
  days: Map<string, DayStat>;
  today: string;
  onWrite: () => void;
  /** Abre la ventana con el mapa del año (sin entradas no aparece). */
  onYear?: () => void;
}) {
  const { current, best, alive } = useMemo(
    () => streaks(days, today),
    [days, today],
  );
  const year = today.slice(0, 4);
  const yearDays = useMemo(
    () =>
      [...days.keys()].filter((d) => d.startsWith(year) && d <= today).length,
    [days, year, today],
  );
  const words = useMemo(
    () => [...days.values()].reduce((sum, d) => sum + d.words, 0),
    [days],
  );
  const written = days.get(today);
  const monday = addDays(today, -weekdayIndex(today));
  const week = WEEK.map((label, i) => {
    const date = addDays(monday, i);
    return { label, date, stat: days.get(date) };
  });
  const elapsed = dayOfYear(today);
  const pct = Math.round((yearDays / elapsed) * 100);

  return (
    <section className="dy-today" aria-label="Hoy">
      <div className="dy-today-main">
        <span className="dy-eyebrow">
          <i className={written ? "done" : ""} aria-hidden="true" />
          {written
            ? `Hoy · ${plural(written.entries.length, "entrada", "entradas")} · ${plural(written.words, "palabra", "palabras")}`
            : "Hoy · aún sin escribir"}
        </span>
        <h2>{longDay(today)}</h2>
      </div>

      <ol className="dy-week" aria-label="Esta semana">
        {week.map(({ label, date, stat }) => {
          const mood = moodOf(stat?.mood);
          const state =
            date === today ? " today" : date > today ? " future" : "";
          return (
            <li
              key={date}
              className={(stat ? "on" : "") + state}
              title={`${longDay(date)}${stat ? " · " + plural(stat.entries.length, "entrada", "entradas") + (mood ? ` · ${mood.label}` : "") : ""}`}
            >
              <small>{label}</small>
              <span className="dy-week-dot" />
            </li>
          );
        })}
      </ol>

      <button type="button" className="dy-cta" onClick={onWrite}>
        <Pencil size={14} />
        {written ? "Añadir entrada" : "Escribir hoy"}
      </button>

      <div className="dy-today-foot">
      <dl className="dy-stats">
        <Stat
          icon={Flame}
          value={current}
          unit={current === 1 ? "día" : "días"}
          label="Racha"
          hint={
            current && !alive
              ? "Escribe hoy para no perder la racha"
              : current
                ? "Días seguidos escribiendo"
                : "Empieza una racha hoy"
          }
          hot={current > 0}
        />
        <Stat
          value={best}
          unit={best === 1 ? "día" : "días"}
          label="Récord"
          hint="Tu racha más larga"
        />
        <Stat
          value={yearDays}
          unit={`· ${pct}%`}
          label={`Días en ${year}`}
          hint={`${plural(yearDays, "día escrito", "días escritos")} de los ${elapsed} que van del año`}
        />
        <Stat
          value={words}
          label="Palabras"
          hint={
            words
              ? `≈ ${Math.max(1, Math.round(words / 250)).toLocaleString("es-CO")} páginas escritas`
              : "Aún sin palabras"
          }
        />
      </dl>
      {onYear && <YearButton days={days} today={today} onClick={onYear} />}
      </div>
    </section>
  );
}

const MINI_WEEKS = 12;

/** Botón para abrir el mapa del año, con una vista previa de las últimas semanas. */
function YearButton({
  days,
  today,
  onClick,
}: {
  days: Map<string, DayStat>;
  today: string;
  onClick: () => void;
}) {
  const weeks = useMemo(
    () => weeksBetween(addDays(today, -(MINI_WEEKS * 7 - 1)), today),
    [today],
  );
  return (
    <button
      type="button"
      className="dy-year-btn"
      onClick={onClick}
      aria-haspopup="dialog"
      title="Ver tu constancia y tu ánimo durante el año"
    >
      <span
        className="dy-year-mini"
        style={{ "--weeks": weeks.length } as CSSProperties}
        aria-hidden="true"
      >
        {weeks.flatMap((w) =>
          w.map((c) => (
            <i
              key={c.date}
              className={
                !c.inRange || c.date > today
                  ? "out"
                  : "l" + levelOf(days.get(c.date))
              }
            />
          )),
        )}
      </span>
      <span className="dy-year-txt">
        <small>Tu año</small>
        <strong>Ver seguimiento</strong>
      </span>
      <ArrowUpRight size={15} className="dy-year-arrow" aria-hidden="true" />
    </button>
  );
}

function Stat({
  icon: Icon,
  value,
  unit,
  label,
  hint,
  hot,
}: {
  icon?: typeof Flame;
  value: number;
  unit?: string;
  label: string;
  hint: string;
  hot?: boolean;
}) {
  return (
    <div className={"dy-stat" + (hot ? " hot" : "")} title={hint}>
      <dt>{label}</dt>
      <dd>
        {Icon && <Icon size={13} aria-hidden="true" />}
        <strong>{value.toLocaleString("es-CO")}</strong>
        {unit && <span>{unit}</span>}
      </dd>
    </div>
  );
}

/* ───────── Mapa del año ───────── */

const toneNames = ["", "Difícil", "Tenso", "Normal", "Bien", "Genial"];

function DiaryMap({
  days,
  today,
  selected,
  onSelect,
  onClose,
}: {
  days: Map<string, DayStat>;
  today: string;
  selected: string | null;
  onSelect: (date: string | null) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<MapMode>("constancia");
  const [range, setRange] = useState<string>("12m");
  const [hover, setHover] = useState<string | null>(null);
  const years = useMemo(() => {
    const set = new Set([
      today.slice(0, 4),
      ...[...days.keys()].map((d) => d.slice(0, 4)),
    ]);
    return [...set].sort().reverse();
  }, [days, today]);

  const [from, to] =
    range === "12m"
      ? [addDays(today, -364), today]
      : [`${range}-01-01`, `${range}-12-31`];
  const weeks = useMemo(() => weeksBetween(from, to), [from, to]);
  const inRange = useMemo(
    () => [...days.values()].filter((d) => d.date >= from && d.date <= to),
    [days, from, to],
  );
  const words = inRange.reduce((s, d) => s + d.words, 0);
  const mood = commonMood(inRange.flatMap((d) => d.entries));
  const months = weeks.map((w, i) => {
    const first = w.find((c) => c.inRange && c.date.endsWith("-01"));
    return first ? { col: i, label: monthShort(first.date) } : null;
  });

  const focus = hover ?? selected;
  const focusStat = focus ? days.get(focus) : undefined;
  const focusMood = moodOf(focusStat?.mood);

  return (
    <section className="dy-map-card" aria-label="Tu año en el diario">
      <button
        type="button"
        className="dy-map-close"
        aria-label="Cerrar"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <header className="dy-map-head">
        <div>
          <span className="dy-map-eyebrow">Seguimiento del diario</span>
          <h3>{range === "12m" ? "Tus últimos 12 meses" : `Tu ${range}`}</h3>
          <p>
            {plural(inRange.length, "día escrito", "días escritos")} ·{" "}
            {plural(words, "palabra", "palabras")}
            {mood ? ` · casi siempre ${moodOf(mood)?.emoji}` : ""}
          </p>
        </div>
        <div className="dy-map-controls">
          <div
            className="dy-seg"
            role="radiogroup"
            aria-label="Qué muestra el mapa"
          >
            {(
              [
                ["constancia", "Constancia"],
                ["animo", "Ánimo"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                className={mode === id ? "on" : ""}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="dy-seg" role="radiogroup" aria-label="Periodo">
            {["12m", ...years].map((y) => (
              <button
                key={y}
                type="button"
                role="radio"
                aria-checked={range === y}
                className={range === y ? "on" : ""}
                onClick={() => setRange(y)}
              >
                {y === "12m" ? "12 meses" : y}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="dy-map-scroll">
        <div
          className={"dy-map " + mode}
          style={{ "--weeks": weeks.length } as CSSProperties}
          onMouseLeave={() => setHover(null)}
        >
          {months.map(
            (m) =>
              m && (
                <span
                  key={"m" + m.col}
                  className="dy-map-month"
                  style={{ gridColumn: m.col + 2, gridRow: 1 }}
                >
                  {m.label}
                </span>
              ),
          )}
          {["lun", "mié", "vie"].map((d, i) => (
            <span
              key={d}
              className="dy-map-wd"
              style={{ gridColumn: 1, gridRow: i * 2 + 2 }}
            >
              {d}
            </span>
          ))}
          {weeks.flatMap((w, col) =>
            w.map((c, row) => {
              const style = { gridColumn: col + 2, gridRow: row + 2 };
              if (!c.inRange)
                return (
                  <span key={c.date} className="dy-cell out" style={style} />
                );
              const stat = days.get(c.date);
              const cls =
                "dy-cell" +
                (mode === "constancia"
                  ? ` l${levelOf(stat)}`
                  : stat
                    ? ` t${stat.tone ?? 0}`
                    : " l0") +
                (c.date > today ? " future" : "") +
                (c.date === today ? " today" : "") +
                (c.date === selected ? " sel" : "");
              if (!stat)
                return (
                  <span
                    key={c.date}
                    className={cls}
                    style={style}
                    onMouseEnter={() => setHover(c.date)}
                  />
                );
              return (
                <button
                  key={c.date}
                  type="button"
                  className={cls}
                  style={style}
                  aria-pressed={c.date === selected}
                  aria-label={`${longDay(c.date)}: ${plural(stat.entries.length, "entrada", "entradas")}`}
                  onMouseEnter={() => setHover(c.date)}
                  onFocus={() => setHover(c.date)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect(c.date === selected ? null : c.date)}
                />
              );
            }),
          )}
        </div>
      </div>

      <footer className="dy-map-foot">
        <p className="dy-map-focus" aria-live="polite">
          {focus ? (
            <>
              <strong>{longDay(focus)}</strong>
              {focusStat ? (
                <>
                  {" · "}
                  {plural(
                    focusStat.entries.length,
                    "entrada",
                    "entradas",
                  )} · {plural(focusStat.words, "palabra", "palabras")}
                  {focusMood && ` · ${focusMood.emoji} ${focusMood.label}`}
                </>
              ) : (
                focus <= today && " · sin escribir"
              )}
            </>
          ) : (
            "Pasa por un día para verlo; tócalo para leer solo ese día."
          )}
        </p>
        {mode === "constancia" ? (
          <span className="dy-legend" aria-hidden="true">
            Menos
            {[0, 1, 2, 3, 4].map((l) => (
              <i key={l} className={"dy-cell l" + l} />
            ))}
            Más
          </span>
        ) : (
          <span className="dy-legend animo" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((t) => (
              <span key={t}>
                <i className={"dy-cell t" + t} />
                {toneNames[t]}
              </span>
            ))}
            <span>
              <i className="dy-cell t0" />
              Sin ánimo
            </span>
          </span>
        )}
      </footer>
    </section>
  );
}

/* ───────── Un día como hoy ───────── */

function Recall({
  days,
  today,
}: {
  days: Map<string, DayStat>;
  today: string;
}) {
  const { viewEntry } = useApp();
  const hits = useMemo(() => onThisDayList(days, today), [days, today]);
  if (!hits.length) return null;
  return (
    <section className="dy-recall" aria-label="Un día como hoy">
      <h3>
        <History size={15} /> Un día como hoy
      </h3>
      <div className="dy-recall-list">
        {hits.map(({ d, e }) => (
          <button
            key={e.id}
            type="button"
            className="dy-recall-card"
            onClick={() => viewEntry(e)}
          >
            <small>
              {agoLabel(d.date, today)} · {friendlyDate(d.date, today)}
            </small>
            <strong>{e.title || "Entrada"}</strong>
            <span>{excerpt(e).text}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const onThisDayList = (days: Map<string, DayStat>, today: string) =>
  onThisDay(days, today)
    .flatMap((d) => d.entries.map((e) => ({ d, e })))
    .slice(0, 4);

/* ───────── Línea de tiempo ───────── */

/** El título y el texto sin repetir: si el título salió de la primera línea, no se repite. */
function excerpt(e: Entry) {
  const text = plainText(e.body).replace(/\s+/g, " ").trim();
  const head = e.title.replace(/…$/, "").trim();
  if (head && text.startsWith(head)) {
    const rest = text.slice(head.length).replace(/^[\s.,;:—-]+/, "");
    return { title: e.title, text: rest };
  }
  return { title: e.title, text };
}

type MonthGroup = {
  month: string;
  days: { date: string; entries: Entry[] }[];
  count: number;
};

function Timeline({ entries, today }: { entries: Entry[]; today: string }) {
  const groups = useMemo(() => {
    const out: MonthGroup[] = [];
    for (const e of entries) {
      const date = dayOf(e);
      const month = date.slice(0, 7);
      let m = out[out.length - 1];
      if (!m || m.month !== month)
        out.push((m = { month, days: [], count: 0 }));
      let d = m.days[m.days.length - 1];
      if (!d || d.date !== date) m.days.push((d = { date, entries: [] }));
      d.entries.push(e);
      m.count++;
    }
    return out;
  }, [entries]);
  if (!groups.length) return null;
  return (
    <div className="dy-timeline">
      {groups.map((m) => {
        const mood = moodOf(commonMood(m.days.flatMap((d) => d.entries)));
        return (
          <section key={m.month} className="dy-month">
            <h3 className="dy-month-head">
              {monthTitle(m.month)}
              <small>
                {plural(m.count, "entrada", "entradas")}
                {mood && ` · ${mood.emoji}`}
              </small>
            </h3>
            {m.days.map((d) => (
              <div
                key={d.date}
                className={"dy-day" + (d.date === today ? " today" : "")}
              >
                <div className="dy-date" aria-label={longDay(d.date)}>
                  <b>{Number(d.date.slice(8))}</b>
                  <span>{d.date === today ? "hoy" : weekdayShort(d.date)}</span>
                </div>
                <div className="dy-day-entries">
                  {d.entries.map((e) => (
                    <DiaryCard key={e.id} entry={e} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

const MAX_FACES = 3;

const DiaryCard = memo(function DiaryCard({ entry }: { entry: Entry }) {
  const { workspace, viewEntry, editEntry, openImages } = useApp();
  const { title, text } = excerpt(entry);
  const mood = moodOf(entry.details.mood);
  const people = entry.person_ids
    .map((id) => workspace.people.find((p) => p.id === id))
    .filter((p): p is Person => Boolean(p));
  const words = wordsOf(entry);
  const minutes = Math.max(1, Math.round(words / 200));
  const photos = entry.images;
  return (
    <article className="dy-card">
      <button
        type="button"
        className="dy-card-open"
        onClick={() => viewEntry(entry)}
      >
        <span className="dy-card-meta">
          {mood && (
            <span className="dy-mood">
              {mood.emoji} {mood.label}
            </span>
          )}
          {entry.details.place && (
            <span>
              <MapPin size={12} /> {entry.details.place}
            </span>
          )}
          <span className="dy-card-len">
            {plural(words, "palabra", "palabras")} · {minutes} min
          </span>
        </span>
        {title && <strong className="dy-card-title">{title}</strong>}
        {text && <span className="dy-card-text">{text}</span>}
      </button>
      {photos.length > 0 && (
        <div className="dy-card-photos">
          {photos.slice(0, 4).map((img, i) => (
            <button
              key={img.url}
              type="button"
              aria-label={`Ver foto ${i + 1}`}
              onClick={() => openImages(photos, i)}
            >
              <img
                src={img.thumb ?? img.medium ?? img.url}
                alt=""
                loading="lazy"
              />
              {i === 3 && photos.length > 4 && (
                <span>+{photos.length - 4}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {(people.length > 0 || entry.tags.length > 0) && (
        <footer className="dy-card-foot">
          {people.length > 0 && (
            <span
              className="dy-faces"
              title={people.map((p) => p.name).join(", ")}
            >
              {people.slice(0, MAX_FACES).map((p) => (
                <Avatar key={p.id} person={p} size={22} />
              ))}
              <em>
                {people
                  .slice(0, 2)
                  .map((p) => p.name.split(" ")[0])
                  .join(", ")}
                {people.length > 2 ? ` y ${people.length - 2} más` : ""}
              </em>
            </span>
          )}
          {entry.tags.length > 0 && (
            <span className="dy-tags">
              {entry.tags.slice(0, 4).map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </span>
          )}
        </footer>
      )}
      <button
        type="button"
        className="dy-card-edit"
        aria-label="Editar entrada"
        title="Editar"
        onClick={() => editEntry(entry)}
      >
        <Pencil size={13} />
      </button>
    </article>
  );
});
