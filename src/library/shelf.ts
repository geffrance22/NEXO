import {
  BookHeart,
  BookMarked,
  Briefcase,
  Clapperboard,
  Images,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  NotebookTabs,
  Quote,
  StickyNote,
  Tv,
  Users,
  type LucideIcon,
} from "lucide-react";
import { plainText } from "../components/RichText";
import type { Entry, EntryDetails, Kind, Person } from "../data";
import { kindMeta, seriesColors } from "../composer/kinds";
import { isOpenTask } from "../lib/commitments";
import { bookPace, hoursLabel, isSeries, screenMinutes } from "../lib/entries";
import { normalizeText, todayInputValue } from "../lib/format";
import { finishedOn } from "./goals";

export type TabId =
  // Libroteca
  | "inicio"
  | "peliculas"
  | "series"
  | "libros"
  | "citas"
  /** Notas libres (tablero tipo Keep, tabla `quick_notes`). */
  | "lienzo"
  /** CAPTURAS: imágenes en YourImageShare, por carpetas (tablas `screenshots*`). */
  | "capturas"
  // Agenda
  | "cuadernos"
  | "pendientes"
  | "trabajo"
  | "encuentros"
  | "notas"
  | "aprendizajes";

/** Las dos páginas que comparten pestañas, estantes y vistas. */
export type ShelfSection = "Libroteca" | "Agenda";

export type ViewMode = "portadas" | "tarjetas" | "lista";
export type SortId =
  | "reciente"
  | "antiguo"
  | "titulo"
  | "calificacion"
  | "anio"
  | "progreso"
  | "confianza"
  | "vence";

export const sortLabels: Record<SortId, string> = {
  reciente: "Más recientes",
  antiguo: "Más antiguos",
  titulo: "Título (A–Z)",
  calificacion: "Mejor calificados",
  anio: "Año de estreno",
  progreso: "Más avanzados",
  confianza: "Por reforzar primero",
  vence: "Fecha límite",
};

export type Shelf = { id: string; label: string; test: (e: Entry) => boolean };
export type Tone = { accent: string; soft: string; ink: string };

/** Colores de lo que no es un tipo de recuerdo (o se distingue dentro de uno). */
export const tones = {
  series: seriesColors,
  lecturas: { accent: "#b0703a", soft: "#fbf1e6", ink: "#7a4a22" },
  citas: { accent: "#8c6d4f", soft: "#f4ece3", ink: "#5b4330" },
  inicio: { accent: "#5f8247", soft: "#eaf1e0", ink: "#3a5229" },
} satisfies Record<string, Tone>;

export type EntryTab = {
  id: TabId;
  label: string;
  icon: LucideIcon;
  kind: Kind;
  tone: Tone;
  match: (e: Entry) => boolean;
  views: ViewMode[];
  shelves?: Shelf[];
  /** Estante con el que se abre (por defecto, todos). */
  shelf?: string;
  sorts: SortId[];
  /** Nombre de lo que se añade: «Añadir película». */
  noun: string;
  /** Detalles con los que se abre el formulario según el estante elegido. */
  addDetails?: (shelf: string) => EntryDetails | undefined;
  /** Frase para cuando no hay nada. */
  empty: string;
};

const watch = (e: Entry) => e.details.watch ?? "vista";
const read = (e: Entry) => e.details.read ?? "leyendo";

/** Libro físico que es tuyo: está en tu estantería. */
export const inMyShelf = (e: Entry) =>
  e.kind === "Libro" &&
  e.details.bookFormat === "fisico" &&
  (e.details.bookOwner ?? "mio") === "mio";

/** Cómo lo tienes: «PDF / digital», «Prestado por Ana»… (vacío si es tuyo o no se sabe). */
export function bookCopyLabel(e: Entry, long = false) {
  const d = e.details;
  if (e.kind !== "Libro" || !d.bookFormat) return "";
  if (d.bookFormat === "digital") return "PDF / digital";
  if (d.bookOwner === "prestado")
    return d.lentBy ? `Prestado por ${d.lentBy}` : "Prestado";
  return long ? "Físico · de tu estantería" : "";
}
const MEDIA: ViewMode[] = ["portadas", "tarjetas", "lista"];
const PLAIN: ViewMode[] = ["tarjetas", "lista"];
const tone = (k: Kind): Tone => kindMeta[k];

export const entryTabs: EntryTab[] = [
  {
    // Solo películas: las series tienen su propia pestaña.
    id: "peliculas",
    label: "Películas",
    icon: Clapperboard,
    kind: "Película",
    tone: tone("Película"),
    match: (e) => e.kind === "Película" && !isSeries(e),
    views: ["tarjetas", "portadas", "lista"],
    shelves: [
      { id: "quiero", label: "Por ver", test: (e) => watch(e) === "quiero" },
      { id: "viendo", label: "Viendo", test: (e) => watch(e) === "viendo" },
      { id: "vista", label: "Vistas", test: (e) => watch(e) === "vista" },
    ],
    sorts: ["reciente", "calificacion", "anio", "titulo", "antiguo"],
    noun: "película",
    addDetails: (s) =>
      s === "quiero" || s === "viendo" ? { watch: s } : undefined,
    empty: "Aún no hay películas.",
  },
  {
    id: "series",
    label: "Series",
    icon: Tv,
    kind: "Película",
    tone: tones.series,
    match: isSeries,
    views: ["tarjetas", "portadas", "lista"],
    shelves: [
      { id: "quiero", label: "Por ver", test: (e) => watch(e) === "quiero" },
      { id: "viendo", label: "Viendo", test: (e) => watch(e) === "viendo" },
      { id: "vista", label: "Vistas", test: (e) => watch(e) === "vista" },
    ],
    sorts: ["reciente", "calificacion", "anio", "titulo", "antiguo"],
    noun: "serie",
    addDetails: (s) => ({
      series: true,
      ...(s === "quiero" || s === "viendo" ? { watch: s } : {}),
    }),
    empty: "Aún no hay series.",
  },
  {
    id: "libros",
    label: "Libros",
    icon: BookMarked,
    kind: "Libro",
    tone: tone("Libro"),
    match: (e) => e.kind === "Libro",
    views: MEDIA,
    shelves: [
      { id: "quiero", label: "Quiero leer", test: (e) => read(e) === "quiero" },
      { id: "leyendo", label: "Leyendo", test: (e) => read(e) === "leyendo" },
      {
        id: "terminado",
        label: "Terminados",
        test: (e) => read(e) === "terminado",
      },
      { id: "estanteria", label: "Estantería", test: inMyShelf },
    ],
    sorts: ["reciente", "progreso", "calificacion", "titulo", "antiguo"],
    noun: "libro",
    addDetails: (s) =>
      s === "estanteria"
        ? { bookFormat: "fisico", bookOwner: "mio", read: "estante" }
        : s === "quiero" || s === "leyendo" || s === "terminado"
          ? { read: s }
          : undefined,
    empty: "Aún no hay libros.",
  },
  {
    id: "aprendizajes",
    label: "Aprendizajes",
    icon: Lightbulb,
    kind: "Aprendizaje",
    tone: tone("Aprendizaje"),
    match: (e) => e.kind === "Aprendizaje",
    views: PLAIN,
    shelves: [
      {
        id: "reforzar",
        label: "Por reforzar",
        test: (e) => Boolean(e.details.confidence && e.details.confidence <= 2),
      },
      {
        id: "dominados",
        label: "Dominados",
        test: (e) => (e.details.confidence ?? 0) >= 4,
      },
      {
        id: "aplicar",
        label: "Con plan para aplicar",
        test: (e) => Boolean(e.details.apply),
      },
    ],
    sorts: ["reciente", "confianza", "titulo", "antiguo"],
    noun: "aprendizaje",
    empty: "Aún no hay aprendizajes.",
  },
  {
    id: "notas",
    label: "Diario",
    icon: BookHeart,
    kind: "Nota",
    tone: tone("Nota"),
    match: (e) => e.kind === "Nota",
    views: PLAIN,
    shelves: [
      {
        id: "personas",
        label: "Con personas",
        test: (e) => e.person_ids.length > 0,
      },
      { id: "fotos", label: "Con fotos", test: (e) => e.images.length > 0 },
    ],
    sorts: ["reciente", "titulo", "antiguo"],
    noun: "entrada",
    empty: "Tu diario está en blanco.",
  },
  {
    id: "encuentros",
    label: "Encuentros",
    icon: Users,
    kind: "Encuentro",
    tone: tone("Encuentro"),
    match: (e) => e.kind === "Encuentro",
    views: PLAIN,
    shelves: [
      {
        id: "lugar",
        label: "Con lugar",
        test: (e) => Boolean(e.details.place),
      },
      { id: "fotos", label: "Con fotos", test: (e) => e.images.length > 0 },
    ],
    sorts: ["reciente", "titulo", "antiguo"],
    noun: "encuentro",
    empty: "Aún no hay encuentros.",
  },
  {
    id: "pendientes",
    label: "Pendientes",
    icon: ListChecks,
    kind: "Pendiente",
    tone: tone("Pendiente"),
    match: (e) => e.kind === "Pendiente",
    views: PLAIN,
    shelves: [
      { id: "abiertos", label: "Abiertos", test: isOpenTask },
      { id: "hechos", label: "Hechos", test: (e) => e.status === "completado" },
    ],
    shelf: "abiertos",
    sorts: ["vence", "reciente", "titulo", "antiguo"],
    noun: "pendiente",
    empty: "Nada pendiente.",
  },
  {
    id: "trabajo",
    label: "Trabajo",
    icon: Briefcase,
    kind: "Trabajo",
    tone: tone("Trabajo"),
    match: (e) => e.kind === "Trabajo",
    views: PLAIN,
    shelves: [
      { id: "idea", label: "Ideas", test: (e) => e.details.stage === "idea" },
      {
        id: "curso",
        label: "En curso",
        test: (e) => (e.details.stage ?? "curso") === "curso",
      },
      {
        id: "pausa",
        label: "En pausa",
        test: (e) => e.details.stage === "pausa",
      },
      {
        id: "listo",
        label: "Terminados",
        test: (e) => e.details.stage === "listo",
      },
    ],
    sorts: ["reciente", "vence", "titulo", "antiguo"],
    noun: "trabajo",
    addDetails: (s) =>
      s === "idea" || s === "curso" || s === "pausa" || s === "listo"
        ? { stage: s }
        : undefined,
    empty: "Aún no hay proyectos ni tareas de trabajo.",
  },
];

export const tabById = new Map(entryTabs.map((t) => [t.id, t]));

export type TabMeta = {
  id: TabId;
  label: string;
  icon: LucideIcon;
  divider?: boolean;
  iconOnly?: boolean;
};

/**
 * Pestañas de cada página, en orden. Libroteca guarda lo que ves y lees (con «Inicio» solo con su
 * ícono); Agenda, tu día a día y los cuadernos que lo reúnen. Los movimientos viven en Finanzas.
 */
export const sectionTabs: Record<ShelfSection, TabMeta[]> = {
  Libroteca: [
    { id: "inicio", label: "Inicio", icon: LayoutGrid, iconOnly: true },
    { id: "lienzo", label: "Notas", icon: StickyNote, divider: true },
    { id: "peliculas", label: "Películas", icon: Clapperboard, divider: true },
    { id: "series", label: "Series", icon: Tv },
    { id: "libros", label: "Libros", icon: BookMarked },
    { id: "citas", label: "Citas", icon: Quote },
    { id: "capturas", label: "CAPTURAS", icon: Images, divider: true },
  ],
  Agenda: [
    { id: "notas", label: "Diario", icon: BookHeart },
    { id: "pendientes", label: "Pendientes", icon: ListChecks, divider: true },
    { id: "encuentros", label: "Encuentros", icon: Users },
    { id: "trabajo", label: "Trabajo", icon: Briefcase },
    { id: "aprendizajes", label: "Aprendizajes", icon: Lightbulb },
    { id: "cuadernos", label: "Cuadernos", icon: NotebookTabs, divider: true },
  ],
};
export const isTabOf = (section: ShelfSection, s: string | null): s is TabId =>
  sectionTabs[section].some((t) => t.id === s);

/** Cuándo lo registraste (o, si no se sabe, cuándo pasó). */
export const addedAt = (e: Entry) => e.recorded_at ?? e.created_at;
export const yearOf = (e: Entry) =>
  e.details.year || e.details.movieInfo?.year || "";
const progressOf = (e: Entry) =>
  e.kind === "Libro"
    ? read(e) === "terminado"
      ? 101
      : (bookPace(e)?.percent ?? (read(e) === "leyendo" ? 0 : -1))
    : 0;

export function sortEntries(list: Entry[], sort: SortId) {
  const out = [...list];
  const newest = (a: Entry, b: Entry) =>
    b.created_at.localeCompare(a.created_at);
  switch (sort) {
    case "reciente":
      return out.sort(newest);
    case "antiguo":
      return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case "titulo":
      return out.sort((a, b) =>
        a.title.localeCompare(b.title, "es", { sensitivity: "base" }),
      );
    case "calificacion":
      return out.sort(
        (a, b) =>
          (b.details.rating ?? 0) - (a.details.rating ?? 0) || newest(a, b),
      );
    case "anio":
      return out.sort(
        (a, b) => yearOf(b).localeCompare(yearOf(a)) || newest(a, b),
      );
    case "progreso":
      // Los que lees primero (más avanzados arriba), luego terminados y al final por leer.
      return out.sort((a, b) => {
        const pa = progressOf(a);
        const pb = progressOf(b);
        const rank = (p: number) => (p > 100 ? 1 : p < 0 ? 2 : 0);
        return rank(pa) - rank(pb) || pb - pa || newest(a, b);
      });
    case "confianza":
      return out.sort(
        (a, b) =>
          (a.details.confidence ?? 9) - (b.details.confidence ?? 9) ||
          newest(a, b),
      );
    case "vence":
      return out.sort(
        (a, b) =>
          Number(a.status === "completado") -
            Number(b.status === "completado") ||
          (a.details.due ?? "9999").localeCompare(b.details.due ?? "9999") ||
          newest(a, b),
      );
  }
}

/** Texto en el que se busca (título, reseña, autor, plataforma, etiquetas, personas…). */
export function searchText(e: Entry, people: Map<string, Person>) {
  const d = e.details;
  return normalizeText(
    [
      e.title,
      plainText(e.body),
      d.author,
      d.lentBy,
      d.platform,
      d.place,
      d.activity,
      d.source,
      d.sourceName,
      d.apply,
      d.nextStep,
      d.movieInfo?.director,
      d.movieInfo?.cast?.join(" "),
      d.movieInfo?.genres.join(" "),
      ...(d.quotes ?? []),
      ...e.tags,
      ...e.person_ids.map((id) => people.get(id)?.name ?? ""),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

const avg = (list: number[]) =>
  list.length
    ? (list.reduce((s, n) => s + n, 0) / list.length)
        .toFixed(1)
        .replace(".", ",")
    : "";
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Datos que sí dicen algo de cada sección (para su encabezado y su tarjeta en Inicio). */
export function tabSummary(
  tab: EntryTab,
  list: Entry[],
  today = todayInputValue(),
): string[] {
  const bits: string[] = [];
  const rated = list.map((e) => e.details.rating ?? 0).filter(Boolean);
  switch (tab.id) {
    case "peliculas":
    case "series": {
      const series = list.filter(isSeries).length;
      const movies = list.length - series;
      if (movies) bits.push(plural(movies, "película", "películas"));
      if (series) bits.push(plural(series, "serie", "series"));
      const now = list.filter((e) => watch(e) === "viendo").length;
      if (now) bits.push(`${now} viendo`);
      const want = list.filter((e) => watch(e) === "quiero").length;
      if (want) bits.push(`${want} por ver`);
      // Horas de cine: películas vistas y los episodios que llevas (o todos) de cada serie.
      const minutes = list.reduce((s, e) => s + screenMinutes(e), 0);
      if (minutes >= 60) bits.push(`${hoursLabel(minutes)} de cine`);
      break;
    }
    case "libros": {
      const now = list.filter((e) => read(e) === "leyendo").length;
      const done = list.filter((e) => read(e) === "terminado");
      const year = today.slice(0, 4);
      const thisYear = done.filter((e) =>
        finishedOn(e).startsWith(year),
      ).length;
      if (now) bits.push(`${now} leyendo`);
      if (done.length)
        bits.push(plural(done.length, "terminado", "terminados"));
      const want = list.filter((e) => read(e) === "quiero").length;
      if (want) bits.push(`${want} por leer`);
      if (thisYear) bits.push(`${thisYear} este año`);
      const owned = list.filter(inMyShelf).length;
      if (owned) bits.push(`${owned} en tu estantería`);
      const pages = list.reduce(
        (s, e) =>
          s +
          (read(e) === "terminado"
            ? (e.details.pagesTotal ?? 0)
            : read(e) === "leyendo"
              ? (e.details.pagesRead ?? 0)
              : 0),
        0,
      );
      if (pages) bits.push(`${pages.toLocaleString("es-CO")} páginas`);
      const quotes = list.reduce(
        (s, e) => s + (e.details.quotes?.filter(Boolean).length ?? 0),
        0,
      );
      if (quotes) bits.push(plural(quotes, "cita", "citas"));
      break;
    }
    case "aprendizajes": {
      const weak = list.filter(
        (e) => e.details.confidence && e.details.confidence <= 2,
      ).length;
      const strong = list.filter(
        (e) => (e.details.confidence ?? 0) >= 4,
      ).length;
      if (weak) bits.push(`${weak} por reforzar`);
      if (strong) bits.push(plural(strong, "dominado", "dominados"));
      break;
    }
    case "pendientes": {
      const open = list.filter(isOpenTask);
      const late = open.filter(
        (e) => e.details.due && e.details.due < today,
      ).length;
      bits.push(plural(open.length, "abierto", "abiertos"));
      if (late) bits.push(plural(late, "vencido", "vencidos"));
      const done = list.length - open.length;
      if (done) bits.push(plural(done, "hecho", "hechos"));
      break;
    }
    case "trabajo": {
      const now = list.filter(
        (e) => (e.details.stage ?? "curso") === "curso",
      ).length;
      if (now) bits.push(`${now} en curso`);
      const done = list.filter((e) => e.details.stage === "listo").length;
      if (done) bits.push(plural(done, "terminado", "terminados"));
      break;
    }
    case "encuentros": {
      const people = new Set(list.flatMap((e) => e.person_ids)).size;
      if (people) bits.push(plural(people, "persona", "personas"));
      const places = new Set(list.map((e) => e.details.place).filter(Boolean))
        .size;
      if (places) bits.push(plural(places, "lugar", "lugares"));
      break;
    }
    case "notas": {
      const month = today.slice(0, 7);
      const n = list.filter((e) =>
        todayInputValue(new Date(e.created_at)).startsWith(month),
      ).length;
      if (n) bits.push(`${n} este mes`);
      break;
    }
  }
  if (rated.length && ["peliculas", "series", "libros"].includes(tab.id))
    bits.push(`★ ${avg(rated)} de media`);
  return bits;
}

export type Status = { label: string; tone: "want" | "now" | "done" };

/** Estado de una película, serie o libro para mostrarlo encima de su portada. */
export function statusOf(e: Entry): Status | null {
  const d = e.details;
  if (e.kind === "Película") {
    const w = watch(e);
    if (w === "quiero") return { label: "Por ver", tone: "want" };
    if (w === "viendo") {
      const at = [
        d.seasonAt && `T${d.seasonAt}`,
        d.episodeAt && `E${d.episodeAt}`,
      ]
        .filter(Boolean)
        .join(" ");
      return { label: at ? `Viendo · ${at}` : "Viendo", tone: "now" };
    }
    return { label: "Vista", tone: "done" };
  }
  if (e.kind === "Libro") {
    const r = read(e);
    if (r === "estante") return { label: "En tu estantería", tone: "want" };
    if (r === "quiero") return { label: "Quiero leer", tone: "want" };
    if (r === "leyendo") {
      const p = bookPace(e);
      // Releyéndolo: «2.ª lectura» en lugar de «Leyendo».
      const what =
        (d.readNo ?? 1) >= 2 ? `${d.readNo}.ª lectura` : "Leyendo";
      return { label: p ? `${what} · ${p.percent}%` : what, tone: "now" };
    }
    return { label: "Leído", tone: "done" };
  }
  return null;
}

/** Segunda línea bajo una portada: autor; o año y temporadas / plataforma. */
export function captionOf(e: Entry) {
  const d = e.details;
  if (e.kind === "Libro")
    return [d.author, bookCopyLabel(e)].filter(Boolean).join(" · ");
  const seasons = d.movieInfo?.type === "tv" ? d.movieInfo.seasons : undefined;
  return [
    yearOf(e),
    isSeries(e) && seasons
      ? plural(seasons, "temporada", "temporadas")
      : d.platform,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Colores de una película (o serie) o de cualquier otro recuerdo. */
export const toneOf = (e: Entry): Tone =>
  isSeries(e) ? tones.series : kindMeta[e.kind];

const tabKey = (section: ShelfSection) =>
  section === "Libroteca" ? "nexo-lib-tab" : "nexo-agenda-tab";
/** Abre Libroteca o Agenda en una pestaña (p. ej. «Ver los pendientes» desde el inicio). */
export function goSection(
  go: (page: ShelfSection) => void,
  section: ShelfSection,
  tab: TabId,
) {
  sessionStorage.setItem(tabKey(section), tab);
  go(section);
}
/** Atajo de siempre: Libroteca en una pestaña. */
export const goLibroteca = (go: (page: ShelfSection) => void, tab: TabId) =>
  goSection(go, "Libroteca", tab);
/** La pestaña que pidieron al abrir la página. Se borra con `forgetTab` al montar. */
export function requestedTab(section: ShelfSection): TabId | null {
  const tab = sessionStorage.getItem(tabKey(section));
  return isTabOf(section, tab) ? tab : null;
}
export const forgetTab = (section: ShelfSection) =>
  sessionStorage.removeItem(tabKey(section));
