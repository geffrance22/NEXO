import type { Direction, Entry, EntryDetails, EntryInput, Kind } from "../data";

/** Qué detalles se guardan según el tipo: lo que sobre (p. ej. al cambiar de tipo) se descarta. */
export const detailKeys: Record<Kind, (keyof EntryDetails)[]> = {
  Nota: ["mood", "feelings", "where", "place", "placeId", "ctx", "sleep", "exercise"],
  Encuentro: ["mood", "place", "placeId", "activity"],
  Película: [
    "movieInfo",
    "tmdbPoster",
    "year",
    "platform",
    "watch",
    "rating",
    "series",
    "seasonAt",
    "episodeAt",
    "episodeState",
    "episodeNotes",
    "follow",
    "ritual",
  ],
  Libro: [
    "bookEdition",
    "author",
    "bookFormat",
    "bookOwner",
    "lentBy",
    "lentById",
    "read",
    "readNo",
    "finishedAt",
    "pagesRead",
    "pagesTotal",
    "rating",
    "quotes",
    "quoteReview",
    "pageLog",
    "follow",
    "ritual",
    "bookPhotos",
  ],
  Trabajo: ["stage", "priority", "nextStep", "due"],
  Aprendizaje: [
    "source",
    "sourceName",
    "confidence",
    "apply",
    "sourceId",
    "review",
    "readingId",
    "readingSummary",
  ],
  Movimiento: [
    "method",
    "flow",
    "pending",
    "paidOn",
    "due",
    "toMethod",
    "currency",
    "original",
    "fx",
    "place",
    "placeId",
    "asset",
    "warrantyUntil",
    "worth",
    "deductible",
    "split",
    "repeat",
    "recurringId",
    "goalId",
    "debtId",
    "pocketId",
    "chargeId",
    "chargeNew",
  ],
  Pendiente: [
    "priority",
    "due",
    "commitment",
    "owner",
    "beneficiary",
    "waitingSince",
    "snoozed",
    "sourceId",
    "missed",
  ],
};

/** Valores que se asumen cuando la persona no elige nada. */
export const detailDefaults: Partial<Record<Kind, EntryDetails>> = {
  Película: { watch: "vista" },
  Libro: { read: "leyendo" },
  Trabajo: { stage: "curso", priority: "media" },
  Pendiente: { priority: "media" },
};

/** Deja solo los detalles del tipo, sin vacíos, y aplica las reglas de coherencia. */
export function cleanDetails(kind: Kind, details: EntryDetails): EntryDetails {
  const merged = { ...detailDefaults[kind], ...details } as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = {};
  for (const key of detailKeys[kind]) {
    let value = merged[key];
    if (typeof value === "string") value = value.trim();
    // Listas de textos (frases) se limpian; las de objetos (historial de lectura) se conservan.
    if (Array.isArray(value))
      value = value
        .map((x) => (typeof x === "string" ? x.trim() : x))
        .filter((x) => x !== "" && x != null);
    const empty =
      value === undefined ||
      value === "" ||
      value === 0 ||
      (Array.isArray(value) && value.length === 0);
    if (!empty) out[key] = value;
  }
  if (kind === "Película") {
    const info = out.movieInfo as EntryDetails["movieInfo"];
    const series =
      out.series === true || (out.series === undefined && info?.type === "tv");
    // «Viendo» es de las series; una película se ve o no se ve.
    if (!series && out.watch === "viendo") out.watch = "vista";
    // La calificación solo tiene sentido cuando ya la viste (o vas avanzando en la serie).
    if (out.watch === "quiero") delete out.rating;
    if (!series || out.watch !== "viendo") {
      delete out.seasonAt;
      delete out.episodeAt;
      delete out.episodeState;
    }
    // Las calificaciones de episodios se quedan aunque la termines; en una película, no aplican.
    if (!series) delete out.episodeNotes;
  }
  if (kind === "Libro") {
    // «Solo en mi estantería»: es tuyo, en papel, y aún no dices si lo leerás.
    if (out.read === "estante") {
      out.bookFormat = "fisico";
      out.bookOwner = "mio";
    }
    if (out.read !== "terminado") {
      delete out.rating;
      delete out.finishedAt;
    }
    if (out.read !== "leyendo") delete out.pagesRead;
    if (out.read === "quiero" || out.read === "estante") delete out.pageLog;
    // El número de lectura solo cuenta desde la segunda y mientras lo lees o ya lo terminaste.
    const n = Math.floor(Number(out.readNo));
    if (n >= 2 && n <= 99 && (out.read === "leyendo" || out.read === "terminado"))
      out.readNo = n;
    else delete out.readNo;
    // Tuyo o prestado solo aplica al papel; «de quién», solo si es prestado.
    if (out.bookFormat !== "fisico") delete out.bookOwner;
    else if (!out.bookOwner) out.bookOwner = "mio";
    if (out.bookOwner !== "prestado") {
      delete out.lentBy;
      delete out.lentById;
    }
    if (!out.lentBy) delete out.lentById;
  }
  if (kind === "Movimiento") {
    // Lo que solo existe en ciertos tipos de movimiento no se guarda en los demás.
    if (out.pending !== true) {
      delete out.pending;
      if (out.flow !== "prestamo") delete out.due;
    } else delete out.paidOn;
    if (out.flow !== "transferencia") delete out.toMethod;
    if (out.flow !== "ahorro") delete out.goalId;
    // Bolsillos: los llena el ahorro o un ingreso; los vacía un gasto (no aplica a lo demás).
    if (out.flow === "transferencia" || out.flow === "prestamo") delete out.pocketId;
    // Abonos de un cobro por partes: solo los ingresos.
    if (out.flow && out.flow !== "ingreso") {
      delete out.chargeId;
      delete out.chargeNew;
    }
    if (out.chargeId) delete out.chargeNew;
    const draft = out.chargeNew as EntryDetails["chargeNew"];
    if (draft && !(draft.total > 0)) delete out.chargeNew;
    if (!out.currency || out.currency === "COP") {
      delete out.currency;
      delete out.original;
      delete out.fx;
    }
    if (out.asset !== true) {
      delete out.asset;
      delete out.warrantyUntil;
    }
    if (out.deductible !== true) delete out.deductible;
    if (out.worth !== 1 && out.worth !== -1) delete out.worth;
    const split = out.split as EntryDetails["split"];
    if (!split || !(split.n > 1)) delete out.split;
  }
  // Anclar solo se guarda cuando está activo.
  if (out.follow !== true) delete out.follow;
  return out as EntryDetails;
}

/** Un libro de tu estantería que aún no empezabas (al empezarlo se actualiza esa misma ficha). */
export const shelfOnly = (e: Entry) =>
  e.kind === "Libro" &&
  (e.details.read === "estante" || e.details.read === "quiero");

/**
 * Lo que escribiste en el formulario de libro, sumado a la ficha que ya estaba en tu estantería:
 * lo nuevo manda, pero no se pierden su portada, sus fotos, sus frases ni sus personas.
 */
export function mergeIntoShelfBook(book: Entry, input: EntryInput): EntryInput {
  const d = book.details;
  const n = input.details;
  const byUrl = new Map(
    [...(d.bookPhotos ?? []), ...(n.bookPhotos ?? [])].map((img) => [
      img.url,
      img,
    ]),
  );
  const quotes = [...new Set([...(d.quotes ?? []), ...(n.quotes ?? [])])];
  const body =
    book.body && input.body && !input.body.includes(book.body)
      ? `${book.body}\n\n${input.body}`
      : input.body || book.body;
  return {
    ...input,
    body,
    tags: [...new Set([...book.tags, ...input.tags])],
    personIds: [...new Set([...book.person_ids, ...input.personIds])],
    images: input.images.length ? input.images : book.images,
    details: cleanDetails("Libro", {
      ...d,
      ...n,
      author: n.author || d.author,
      bookEdition: n.bookEdition ?? d.bookEdition,
      pagesTotal: n.pagesTotal || d.pagesTotal,
      quotes,
      bookPhotos: [...byUrl.values()],
    }),
  };
}

const clip = (s: string, max = 180) =>
  s.trim().replace(/\s+/g, " ").slice(0, max);

type TitleFields = {
  title: string;
  body: string;
  details: EntryDetails;
  /** Nombres de pila de las personas vinculadas. */
  names: string[];
  direction: Direction;
  category?: string;
};

/**
 * Título final: el escrito, o uno razonable sacado del contenido. Una entrada del diario (Nota)
 * sin título queda sin título: no se copia parte del texto.
 */
export function deriveTitle(kind: Kind, f: TitleFields) {
  const typed = clip(f.title);
  if (typed) return typed;
  switch (kind) {
    case "Nota":
      return "";
    case "Encuentro": {
      const shown = f.names.slice(0, 3).join(", ");
      const more = f.names.length > 3 ? ` y ${f.names.length - 3} más` : "";
      const what = f.details.activity ?? "Encuentro";
      const who = f.names.length ? `${what} con ${shown}${more}` : what;
      return clip(f.details.place ? `${who} · ${f.details.place}` : who);
    }
    case "Movimiento":
      return (
        f.category ??
        (f.details.flow === "transferencia"
          ? "Transferencia"
          : f.details.flow === "prestamo"
            ? f.names.length
              ? `${f.direction === "egreso" ? "Préstamo a" : "Préstamo de"} ${f.names[0]}`
              : "Préstamo"
            : f.direction === "ingreso"
              ? "Ingreso"
              : "Gasto")
      );
    default:
      return kind;
  }
}

type ProblemFields = {
  title: string;
  body: string;
  details: EntryDetails;
  personIds: string[];
  amount: number;
};

/** Qué falta para poder guardar (null si ya se puede). */
export function problemFor(kind: Kind, f: ProblemFields): string | null {
  const has = (s?: string) => Boolean(s && s.trim());
  switch (kind) {
    case "Nota":
      return has(f.title) || has(f.body) ? null : "Escribe algo para guardar.";
    case "Encuentro":
      return has(f.title) ||
        has(f.body) ||
        f.personIds.length > 0 ||
        has(f.details.place)
        ? null
        : "Cuenta con quién, dónde o qué pasó.";
    case "Película":
      return has(f.title)
        ? null
        : f.details.series
          ? "Falta el nombre de la serie."
          : "Falta el nombre de la película.";
    case "Libro":
      return has(f.title) ? null : "Falta el título del libro.";
    case "Trabajo":
      return has(f.title) ? null : "Falta el nombre del proyecto o tarea.";
    case "Aprendizaje":
      return has(f.title) ? null : "Cuéntanos qué aprendiste.";
    case "Movimiento":
      if (!(f.amount > 0)) return "Indica el monto.";
      if (f.details.flow === "prestamo" && !f.personIds.length)
        return "Elige con quién es el préstamo.";
      if (
        f.details.flow === "transferencia" &&
        (!f.details.method || !f.details.toMethod)
      )
        return "Elige de qué cuenta sale y a cuál llega.";
      if (f.details.split && !f.personIds.length)
        return "Agrega con quién lo dividiste.";
      return null;
    case "Pendiente":
      return has(f.title) ? null : "Escribe qué tienes que hacer.";
  }
}

export const expenseCategories = [
  "Comida",
  "Transporte",
  "Hogar",
  "Salud",
  "Ocio",
  "Educación",
  "Trabajo",
  "Compras",
  "Regalos",
  "Impuestos",
  "Ahorro",
  "Otro",
];
export const incomeCategories = [
  "Salario",
  "Ventas",
  "Honorarios",
  "Regalo",
  "Reembolso",
  "Inversión",
  "Otro",
];
/** Categorías del ahorro: a dónde va la plata que no se gasta. */
export const savingCategories = ["Ahorro", "Inversión", "Emergencias", "Meta"];
export const allMoneyCategories = [
  ...new Set([...expenseCategories, ...incomeCategories, ...savingCategories]),
];

/** Categorías propias (Ajustes de Finanzas): se registran aquí para que el formulario las reconozca. */
const customMoneyCategories = new Set<string>();
export function setCustomMoneyCategories(list: string[]) {
  customMoneyCategories.clear();
  for (const c of list) customMoneyCategories.add(c);
}
export const isMoneyCategory = (t: string) =>
  allMoneyCategories.includes(t) || customMoneyCategories.has(t);
