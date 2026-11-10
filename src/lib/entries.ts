import type { Entry, Person, Place } from "../data";
import { moodOf } from "../composer/moods";
import { feelingsOf } from "../composer/MoodTrio";
import { plainText } from "../components/RichText";
import { commitmentKinds, commitmentOf, counterpartOf } from "./commitments";
import {
  addDays,
  friendlyDate,
  money,
  normalizeText,
  todayInputValue,
} from "./format";
import { placeOf } from "./places";

export const stages = {
  idea: "Idea",
  curso: "En curso",
  pausa: "En pausa",
  listo: "Terminado",
};
const readStates = {
  estante: "En tu estantería",
  quiero: "Por leer",
  leyendo: "Leyendo",
  terminado: "Terminado",
};

/**
 * Una serie (no una película). Lo que elegiste en el formulario manda; si nunca lo elegiste, se
 * deduce de la ficha de TMDB o de la etiqueta «serie» (capturas antiguas).
 */
export function isSeries(e: Pick<Entry, "kind" | "tags" | "details">) {
  if (e.kind !== "Película") return false;
  const d = e.details;
  if (d.series !== undefined) return d.series;
  return (
    d.movieInfo?.type === "tv" ||
    e.tags.some((t) => normalizeText(t) === "serie")
  );
}

/** Nombre del tipo para mostrar: «Serie» en lugar de «Película» cuando lo es. */
export const kindLabel = (e: Entry) => (isSeries(e) ? "Serie" : e.kind);

/** El texto del recuerdo en una sola línea, sin marcas: sirve de resumen en las tarjetas. */
export function entrySummary(e: Entry) {
  const text = plainText(e.body).replace(/\s+/g, " ").trim();
  if (text) return text;
  const d = e.details;
  if (e.kind === "Libro" && d.quotes?.[0]) return `“${d.quotes[0]}”`;
  if (e.kind === "Trabajo" && d.nextStep) return `Siguiente: ${d.nextStep}`;
  if (e.kind === "Aprendizaje" && d.apply) return `Lo aplicaré: ${d.apply}`;
  return "";
}

export type Fact = { text: string; tone?: "warn" | "good" | "bad" };

/** Datos breves de un recuerdo (lugar, ánimo, fecha límite…) para mostrarlos como etiquetas. */
export function entryFacts(
  e: Entry,
  ws: { places: Place[]; people: Person[] },
  today = todayInputValue(),
): Fact[] {
  const d = e.details;
  const out: Fact[] = [];
  // Las entradas del diario pueden tener hasta tres ánimos, cada uno con su causa.
  const feelings = feelingsOf(d)
    .map((f) => ({ mood: moodOf(f.mood), why: f.why }))
    .filter((f) => f.mood);
  const place = d.place ? (placeOf(e, ws.places)?.name ?? d.place) : "";

  switch (e.kind) {
    case "Encuentro":
      if (d.activity) out.push({ text: d.activity });
      if (place) out.push({ text: place });
      break;
    case "Nota":
      if (place) out.push({ text: place });
      if (d.where && d.where !== place) out.push({ text: `📍 ${d.where}` });
      break;
    case "Película":
      if (d.watch === "quiero") out.push({ text: "Por ver" });
      if (d.watch === "viendo") {
        const at = [
          d.seasonAt && `T${d.seasonAt}`,
          d.episodeAt && `E${d.episodeAt}`,
        ]
          .filter(Boolean)
          .join(" ");
        out.push({ text: at ? `Viendo · ${at}` : "Viendo" });
      }
      if (d.rating) out.push({ text: "★".repeat(d.rating) });
      if (d.year) out.push({ text: d.year });
      if (d.platform) out.push({ text: d.platform });
      break;
    case "Libro":
      if (d.read) out.push({ text: readStates[d.read] });
      if (d.author) out.push({ text: d.author });
      if (d.rating) out.push({ text: "★".repeat(d.rating) });
      break;
    case "Trabajo":
      if (d.stage) out.push({ text: stages[d.stage] });
      break;
    case "Aprendizaje":
      if (d.source)
        out.push({
          text: d.sourceName ? `${d.source} · ${d.sourceName}` : d.source,
        });
      break;
    case "Movimiento":
      if (e.tags[0]) out.push({ text: e.tags[0] });
      if (d.method) out.push({ text: d.method });
      break;
    case "Pendiente": {
      const k = commitmentOf(e);
      const who = counterpartOf(e, ws.people)?.name.split(" ")[0];
      if (k !== "quiero" || who)
        out.push({
          text: [commitmentKinds[k].short, who].filter(Boolean).join(" · "),
        });
      break;
    }
  }
  for (const f of feelings)
    out.push({
      text: `${f.mood!.emoji} ${f.mood!.label}${f.why ? ` · ${f.why}` : ""}`,
    });
  if ((e.kind === "Pendiente" || e.kind === "Trabajo") && d.due) {
    const open = e.status !== "completado";
    const late = open && d.due < today;
    out.push({
      text:
        (late ? "Venció " : "Para ") + friendlyDate(d.due, today).toLowerCase(),
      tone: late ? "bad" : open && d.due === today ? "warn" : undefined,
    });
  }
  if (d.priority === "alta") out.push({ text: "Prioridad alta", tone: "warn" });
  return out;
}

/** «2 h 15 min» o «45 min». */
export function minutesLabel(n: number) {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/**
 * Promedios para estimar cuando la ficha no trae el dato: duración de una película y de un
 * episodio, episodios por temporada, páginas de un libro y minutos por página (≈ 250 palabras
 * por página a un ritmo cómodo de unas 170 palabras por minuto).
 */
export const PACE = {
  movieMinutes: 110,
  episodeMinutes: 42,
  episodesPerSeason: 10,
  bookPages: 300,
  minutesPerPage: 1.5,
} as const;

/**
 * Episodios que ya viste de una serie: todos si la terminaste; si la estás viendo, las temporadas
 * completas anteriores más el episodio en el que vas. Sin datos de TMDB se usa el promedio.
 */
export function episodesSeen(e: Pick<Entry, "kind" | "tags" | "details">) {
  if (!isSeries(e)) return 0;
  const d = e.details;
  const watch = d.watch ?? "vista";
  if (watch === "quiero") return 0;
  const info = d.movieInfo?.type === "tv" ? d.movieInfo : undefined;
  const seasons = info?.seasons || 0;
  const total = info?.episodes || 0;
  const perSeason = total && seasons ? total / seasons : PACE.episodesPerSeason;
  if (watch === "vista") return total || Math.round((seasons || 1) * perSeason);
  const seen =
    Math.round(Math.max(0, (d.seasonAt ?? 1) - 1) * perSeason) +
    (d.episodeAt ?? 0);
  return total ? Math.min(seen, total) : seen;
}

/** Minutos frente a la pantalla: la película completa o los episodios vistos de la serie. */
export function screenMinutes(e: Pick<Entry, "kind" | "tags" | "details">) {
  if (e.kind !== "Película" || e.details.watch === "quiero") return 0;
  const runtime = e.details.movieInfo?.runtime || 0;
  if (isSeries(e)) return episodesSeen(e) * (runtime || PACE.episodeMinutes);
  return runtime || PACE.movieMinutes;
}

/** «45 min», «12 h» o «1.240 h»: tiempo aproximado, sin minutos sueltos cuando ya son horas. */
export function hoursLabel(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.round(minutes / 60).toLocaleString("es-CO")} h`;
}

export type BookPace = {
  /** 0–100 */
  percent: number;
  /** Páginas por día (en tu último mes de lectura, o desde que lo empezaste). */
  perDay: number;
  /** Páginas que leíste hoy (según lo que actualizaste). */
  todayPages: number;
  /** AAAA-MM-DD estimada para terminarlo (null si falta saber el ritmo). */
  eta: string | null;
};

const dayOf = (iso: string) => todayInputValue(new Date(iso));
const daysFrom = (from: string, to: string) =>
  Math.round(
    (Date.parse(to + "T12:00:00") - Date.parse(from + "T12:00:00")) / 864e5,
  );
const PACE_WINDOW = 30;

/**
 * Cuánto llevas de un libro que estás leyendo y, a tu ritmo, cuándo lo terminarías. El ritmo sale
 * del historial de páginas (el último mes); sin historial, de los días desde que lo empezaste.
 */
export function bookPace(e: Entry, today = todayInputValue()): BookPace | null {
  const {
    read = "leyendo",
    pagesRead = 0,
    pagesTotal = 0,
    pageLog = [],
  } = e.details;
  if (e.kind !== "Libro" || read !== "leyendo" || pagesTotal <= 0) return null;
  const percent = Math.min(100, Math.round((pagesRead / pagesTotal) * 100));
  let base = { d: dayOf(e.created_at), p: 0 };
  if (pageLog.length) {
    const since = addDays(today, -PACE_WINDOW);
    base = [...pageLog].reverse().find((x) => x.d <= since) ?? pageLog[0];
  }
  const perDay =
    Math.max(0, pagesRead - base.p) / Math.max(1, daysFrom(base.d, today));
  const before = [...pageLog].reverse().find((x) => x.d < today) ?? pageLog[0];
  const todayPages =
    pageLog.some((x) => x.d === today) && before
      ? Math.max(0, pagesRead - before.p)
      : 0;
  const left = Math.max(0, pagesTotal - pagesRead);
  const daysLeft = perDay > 0 ? Math.ceil(left / perDay) : Infinity;
  return {
    percent,
    perDay,
    todayPages,
    eta: daysLeft <= 365 ? addDays(today, daysLeft) : null,
  };
}

/** «Lo terminas mañana», «Lo terminas el jue 12 nov». */
export const etaLabel = (eta: string, today = todayInputValue()) => {
  const f = friendlyDate(eta, today);
  return /^(Hoy|Mañana|Ayer)$/.test(f)
    ? `Lo terminas ${f.toLowerCase()}`
    : `Lo terminas el ${f}`;
};

/** Ficha técnica de una película, serie o libro (de TMDB y de lo que guardaste). */
export function mediaSpecs(e: Entry) {
  const rows: [string, string][] = [];
  let overview = "";
  const d = e.details;
  const info = d.movieInfo;
  if (e.kind === "Película" && info) {
    const tv = info.type === "tv";
    if (info.director)
      rows.push([tv ? "Creada por" : "Dirección", info.director]);
    if (tv && info.seasons)
      rows.push([
        "Temporadas",
        info.seasons + (info.episodes ? ` · ${info.episodes} episodios` : ""),
      ]);
    if (info.runtime)
      rows.push([tv ? "Episodio" : "Duración", minutesLabel(info.runtime)]);
    if (info.cast?.length)
      rows.push(["Reparto", info.cast.slice(0, 4).join(", ")]);
    if (info.genres.length) rows.push(["Género", info.genres.join(" · ")]);
    if (info.tmdbRating)
      rows.push(["En TMDB", info.tmdbRating.toLocaleString("es-CO") + " / 10"]);
    overview = info.overview?.trim() ?? "";
  }
  const pace = bookPace(e);
  if (e.kind === "Libro") {
    if (d.bookEdition?.publisher)
      rows.push(["Editorial", d.bookEdition.publisher]);
    if (d.bookFormat)
      rows.push([
        "Ejemplar",
        d.bookFormat === "digital"
          ? "PDF / digital"
          : d.bookOwner === "prestado"
            ? "Físico · prestado" + (d.lentBy ? ` por ${d.lentBy}` : "")
            : "Físico · de tu estantería",
      ]);
    if (d.pagesTotal && d.read !== "leyendo")
      rows.push(["Páginas", String(d.pagesTotal)]);
    if (pace && pace.perDay > 0) {
      rows.push([
        "Ritmo",
        (pace.perDay < 10
          ? pace.perDay.toFixed(1).replace(".", ",")
          : Math.round(pace.perDay)) + " págs. al día",
      ]);
      if (pace.eta) rows.push(["A este ritmo", etaLabel(pace.eta)]);
    }
  }
  return { rows, overview, progress: pace ? pace.percent : null };
}

/** «−$ 48.000» o «+$ 1.200.000». */
export const signedAmount = (e: Entry) =>
  (e.direction === "ingreso" ? "+" : "−") + money(e.amount);

/** «Viernes, 6 de noviembre de 2026». */
export function longDate(iso: string) {
  const s = new Date(iso).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
