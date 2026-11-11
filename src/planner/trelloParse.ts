import { todayInputValue } from "../lib/format";
import type { BoardSpec, SpecCard } from "./boardStore";

/**
 * Lee la exportación JSON de un tablero de Trello (Menú → Imprimir, exportar y compartir →
 * Exportar como JSON) y la convierte en un tablero de Nexo: listas → columnas, tarjetas con su
 * descripción, etiquetas, listas de verificación (con lo ya marcado), fechas de inicio y límite,
 * color de portada, adjuntos como enlaces y, si se quiere, los comentarios.
 */

type TLabel = { id: string; name?: string; color?: string | null };
type TList = { id: string; name?: string; closed?: boolean; pos?: number; color?: string | null };
type TCard = {
  id: string;
  name?: string;
  desc?: string;
  idList?: string;
  closed?: boolean;
  pos?: number;
  due?: string | null;
  start?: string | null;
  dueComplete?: boolean;
  idLabels?: string[];
  labels?: TLabel[];
  dateLastActivity?: string;
  cover?: { color?: string | null } | null;
  attachments?: { name?: string; url?: string }[];
};
type TChecklist = {
  id: string;
  idCard?: string;
  name?: string;
  pos?: number;
  checkItems?: { name?: string; state?: string; pos?: number; due?: string | null }[];
};
type TAction = {
  type?: string;
  date?: string;
  data?: { text?: string; card?: { id?: string } };
  memberCreator?: { fullName?: string; username?: string };
};
type TBoard = {
  name?: string;
  desc?: string;
  closed?: boolean;
  prefs?: { background?: string; backgroundColor?: string | null };
  labels?: TLabel[];
  lists?: TList[];
  cards?: TCard[];
  checklists?: TChecklist[];
  actions?: TAction[];
};

export type TrelloOptions = {
  /** Las tarjetas archivadas en Trello entran como archivadas (si no, se dejan fuera). */
  archived: boolean;
  /** Los comentarios se añaden al final de la descripción. */
  comments: boolean;
};

export type TrelloBoard = {
  /** Nombre del archivo (para identificarlo en la lista). */
  file: string;
  name: string;
  raw: TBoard;
  stats: {
    lists: number;
    cards: number;
    archived: number;
    checks: number;
    labels: number;
    comments: number;
  };
};

/** Lo más grande que se acepta (las exportaciones con muchas acciones pesan bastante). */
export const MAX_TRELLO_BYTES = 60 * 1024 * 1024;

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const byPos = <T extends { pos?: number }>(a: T, b: T) => (a.pos ?? 0) - (b.pos ?? 0);

/** Valida que el JSON sea un tablero de Trello y cuenta lo que trae. */
export function readTrello(text: string, file: string): TrelloBoard {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("No es un archivo JSON válido.");
  }
  const b = data as TBoard;
  if (!b || typeof b !== "object" || !Array.isArray(b.lists) || !Array.isArray(b.cards))
    throw new Error("No parece una exportación de tablero de Trello (faltan listas o tarjetas).");
  const open = new Set(arr<TList>(b.lists).filter((l) => !l.closed).map((l) => l.id));
  const cards = arr<TCard>(b.cards).filter((c) => c.idList && open.has(c.idList));
  const ids = new Set(cards.map((c) => c.id));
  return {
    file,
    name: (str(b.name).trim() || file.replace(/\.json$/i, "")).slice(0, 120),
    raw: b,
    stats: {
      lists: open.size,
      cards: cards.filter((c) => !c.closed).length,
      archived: cards.filter((c) => c.closed).length,
      checks: arr<TChecklist>(b.checklists)
        .filter((k) => k.idCard && ids.has(k.idCard))
        .reduce((n, k) => n + arr(k.checkItems).length, 0),
      labels: arr(b.labels).length,
      comments: arr<TAction>(b.actions).filter(
        (a) => a.type === "commentCard" && ids.has(str(a.data?.card?.id)),
      ).length,
    },
  };
}

/** Colores de Trello → los de Nexo. */
const TONE: Record<string, string> = {
  green: "green",
  lime: "green",
  yellow: "yellow",
  orange: "orange",
  red: "red",
  purple: "purple",
  blue: "blue",
  sky: "teal",
  pink: "pink",
  black: "slate",
};
const toneOf = (c?: string | null) => (c ? (TONE[c.replace(/_(light|dark)$/, "")] ?? "") : "");
const COLOR_NAME: Record<string, string> = {
  green: "Verde",
  yellow: "Amarillo",
  orange: "Naranja",
  red: "Rojo",
  purple: "Morado",
  blue: "Azul",
  sky: "Celeste",
  lime: "Lima",
  pink: "Rosa",
  black: "Negro",
};
/** Fondos de Trello → el más parecido de Nexo. */
const BACKGROUND: Record<string, string> = {
  blue: "ocean",
  sky: "ocean",
  green: "sage",
  lime: "sage",
  orange: "sand",
  red: "dawn",
  pink: "dawn",
  purple: "dusk",
};

/** Fecha de Trello (ISO con hora, en UTC) → el día en tu zona horaria. */
const day = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : todayInputValue(d);
};
const when = (iso?: string) =>
  iso && !Number.isNaN(new Date(iso).getTime())
    ? new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })
    : "";

/** El tablero listo para crearlo con `createFrom`. */
export function trelloToSpec(t: TrelloBoard, opts: TrelloOptions): BoardSpec {
  const b = t.raw;
  const labels = new Map(arr<TLabel>(b.labels).map((l) => [l.id, l]));
  const lists = arr<TList>(b.lists).filter((l) => !l.closed).sort(byPos);

  const checklists = new Map<string, TChecklist[]>();
  for (const k of arr<TChecklist>(b.checklists).sort(byPos)) {
    if (!k.idCard) continue;
    checklists.set(k.idCard, [...(checklists.get(k.idCard) ?? []), k]);
  }
  // Las acciones vienen de la más nueva a la más vieja: se dan vuelta.
  const comments = new Map<string, TAction[]>();
  if (opts.comments)
    for (const a of [...arr<TAction>(b.actions)].reverse()) {
      const id = str(a.data?.card?.id);
      if (a.type !== "commentCard" || !id || !str(a.data?.text).trim()) continue;
      comments.set(id, [...(comments.get(id) ?? []), a]);
    }

  const cardOf = (c: TCard): SpecCard => {
    const name = str(c.name).trim() || "Sin título";
    const parts: string[] = [];
    // Títulos larguísimos: el título se acorta y el texto completo queda en la descripción.
    if (name.length > 240) parts.push(name);
    if (str(c.desc).trim()) parts.push(str(c.desc).trim());
    const files = arr<{ name?: string; url?: string }>(c.attachments).filter((x) =>
      /^https?:\/\//i.test(str(x.url)),
    );
    if (files.length)
      parts.push(
        "Adjuntos de Trello:\n" +
          files.map((x) => `- ${str(x.name).trim() || "Enlace"}: ${x.url}`).join("\n"),
      );
    const said = comments.get(c.id) ?? [];
    if (said.length)
      parts.push(
        "Comentarios de Trello:\n" +
          said
            .map((a) => {
              const who = a.memberCreator?.fullName || a.memberCreator?.username || "";
              const head = [when(a.date), who].filter(Boolean).join(" · ");
              return `- ${head ? head + ": " : ""}${str(a.data?.text).trim()}`;
            })
            .join("\n"),
      );

    const own = arr<TLabel>(c.labels).length
      ? arr<TLabel>(c.labels)
      : arr<string>(c.idLabels).flatMap((id) => labels.get(id) ?? []);
    const tags = [
      ...new Set(
        own
          .map((l) => str(l.name).trim() || COLOR_NAME[str(l.color).replace(/_(light|dark)$/, "")] || "")
          .filter(Boolean)
          .map((s) => s.slice(0, 40)),
      ),
    ];

    const cls = checklists.get(c.id) ?? [];
    const checkItems = cls.flatMap((k) =>
      arr<NonNullable<TChecklist["checkItems"]>[number]>(k.checkItems)
        .sort(byPos)
        .filter((i) => str(i.name).trim())
        .map((i) => ({
          // Con varias listas, cada punto lleva el nombre de la suya.
          text: (cls.length > 1 && str(k.name).trim()
            ? `${str(k.name).trim()} · ${str(i.name).trim()}`
            : str(i.name).trim()
          ).slice(0, 500),
          done: i.state === "complete",
          due: day(i.due),
        })),
    );

    return {
      title: name.length > 240 ? name.slice(0, 239) + "…" : name,
      body: parts.join("\n\n"),
      tags,
      checkItems,
      color: toneOf(c.cover?.color),
      due: day(c.due),
      starts: day(c.start),
      done: Boolean(c.dueComplete),
      doneAt: c.dueComplete ? (c.dateLastActivity ?? null) : null,
      archivedAt: c.closed ? (c.dateLastActivity ?? new Date().toISOString()) : null,
    };
  };

  const cards = arr<TCard>(b.cards)
    .filter((c) => opts.archived || !c.closed)
    .sort(byPos);
  return {
    background: BACKGROUND[str(b.prefs?.background)] ?? "",
    columns: lists.map((l) => ({
      name: str(l.name).trim().slice(0, 120) || "Sin nombre",
      color: toneOf(l.color),
      cards: cards.filter((c) => c.idList === l.id).map(cardOf),
    })),
  };
}
