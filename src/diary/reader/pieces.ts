import type { DiaryReadInput } from "../../assistant";
import { allMoneyCategories } from "../../composer/logic";
import { moodByName } from "../../composer/moods";
import type { Feeling } from "../../composer/MoodTrio";
import type {
  CommitmentKind,
  Entry,
  EntryInput,
  ExchangeKind,
  MyProfile,
  UpdateKind,
  Workspace,
} from "../../data";
import { genderOf } from "../../lib/gender";
import { normalizeText } from "../../lib/format";
import { selfContext } from "../../lib/myself";
import { ME, kinCall, tiesOf } from "../../lib/relations";

/**
 * Lo que Nexo propone tras leer una entrada del diario. A diferencia de «Capturar experiencia»
 * (que arma un encuentro desde cero), aquí la entrada ya existe: las piezas la conectan con lo
 * que ya tienes (pendientes que cumpliste, proyectos que avanzaste, libros que terminaste) y
 * alimentan lo demás (planes, tareas ya hechas, fichas de tu gente, gastos, ideas…).
 */
type Base = { id: string; on: boolean; evidence: string };

export type DiaryPiece = Base &
  (
    | { kind: "cumplido"; taskId: string; title: string }
    /** `done`: ya lo hiciste (queda como tarea realizada) o lo harás (pendiente). */
    | {
        kind: "tarea";
        done: boolean;
        title: string;
        date: string;
        due: string;
        commitment: CommitmentKind;
        personId: string | null;
        peopleIds: string[];
      }
    | {
        kind: "avance";
        workId: string | null;
        title: string;
        stage: "idea" | "curso" | "pausa" | "listo";
        nextStep: string;
      }
    | {
        kind: "obra";
        mediaId: string | null;
        media: "Libro" | "Película";
        series: boolean;
        title: string;
        status: "quiero" | "curso" | "listo";
        rating: number;
      }
    | {
        kind: "novedad";
        personId: string;
        updateKind: UpdateKind;
        text: string;
        date: string;
      }
    | {
        kind: "dato";
        personId: string;
        field: "likes" | "dislikes" | "gifts" | "birthday" | "fact";
        label: string;
        value: string;
      }
    | { kind: "preguntar"; personId: string; text: string }
    | {
        kind: "intercambio";
        personId: string;
        dir: "dar" | "recibir";
        exchange: ExchangeKind;
        note: string;
        date: string;
      }
    | {
        kind: "movimiento";
        amount: number;
        direction: "ingreso" | "egreso";
        category: string;
        title: string;
        date: string;
      }
    | { kind: "aprendizaje"; title: string; source: string; sourceName: string }
    /** `project`: va a Trabajo como idea; si no, queda como nota con la etiqueta «idea». */
    | { kind: "idea"; title: string; project: boolean }
    | { kind: "vincular"; personId: string }
    | { kind: "persona"; name: string; note: string }
    | { kind: "lugar"; placeId: string; placeName: string }
    | { kind: "animo"; feelings: Feeling[] }
  );

export type DiaryReading = { summary: string; pieces: DiaryPiece[] };

/** Lo que se le cuenta a la IA: la entrada y lo que ya existe para conectarla. */
export function readingInput(
  input: EntryInput,
  workspace: Workspace,
  /** Tu ficha: para entender «en casa», «mi trabajo». */
  me?: MyProfile,
): DiaryReadInput {
  const byId = new Map(workspace.people.map((p) => [p.id, p]));
  const kin = new Map(
    tiesOf(ME, workspace.ties)
      .filter((v) => v.other !== ME && byId.has(v.other))
      .map((v) => [
        v.other,
        `tu ${kinCall(v.kind, genderOf(byId.get(v.other)))}`,
      ]),
  );
  const names = (ids: string[]) =>
    ids
      .map((id) => byId.get(id)?.name.split(" ")[0])
      .filter(Boolean)
      .join(", ");
  const recent = (a: Entry, b: Entry) => b.created_at.localeCompare(a.created_at);
  const entries = workspace.entries.slice().sort(recent);
  return {
    text: input.body,
    title: input.title,
    date: input.date,
    linked: input.personIds,
    hasMood: Boolean(input.details.feelings?.length || input.details.mood),
    people: workspace.people.slice(0, 400).map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.profile.alias && { alias: p.profile.alias }),
      ...(kin.get(p.id) && { kin: kin.get(p.id) }),
    })),
    places: workspace.places
      .slice(0, 200)
      .map((p) => ({ id: p.id, name: p.name })),
    tasks: entries
      .filter((e) => e.kind === "Pendiente" && e.status !== "completado")
      .slice(0, 150)
      .map((e) => ({
        id: e.id,
        title: e.title,
        ...(e.details.due && { due: e.details.due }),
        ...(e.person_ids.length && { people: names(e.person_ids) }),
      })),
    works: entries
      .filter((e) => e.kind === "Trabajo" && e.details.stage !== "listo")
      .slice(0, 80)
      .map((e) => ({
        id: e.id,
        title: e.title,
        stage: e.details.stage ?? "curso",
        ...(e.details.nextStep && { next: e.details.nextStep }),
      })),
    media: entries
      .filter(
        (e) =>
          (e.kind === "Libro" && e.details.read !== "terminado") ||
          (e.kind === "Película" && e.details.watch !== "vista"),
      )
      .slice(0, 150)
      .map((e) => ({
        id: e.id,
        type: e.kind === "Libro" ? "libro" : e.details.series ? "serie" : "pelicula",
        title: e.title,
        status:
          e.kind === "Libro"
            ? (e.details.read ?? "leyendo")
            : (e.details.watch ?? "quiero"),
      })),
    ...(me && { me: selfContext(me, workspace.places) }),
  };
}

const s = (v: unknown, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const isDate = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T) =>
  list.includes(v as T) ? (v as T) : fallback;

const UPDATE_KINDS = ["trabajo", "estudios", "salud", "amor", "familia", "hogar", "logro", "viaje", "animo", "otro"] as const;
const EXCHANGES = ["favor", "regalo", "apoyo", "tiempo", "dinero", "iniciativa"] as const;
const COMMITMENTS = ["quiero", "prometi", "espero", "depende"] as const;
const STAGES = ["idea", "curso", "pausa", "listo"] as const;
const FIELDS = ["likes", "dislikes", "gifts", "birthday", "fact"] as const;
const SOURCES = ["Libro", "Curso", "Video", "Artículo", "Persona", "Práctica"];

/**
 * Valida lo que devolvió la IA: solo ids que existen, sin duplicar lo que la entrada ya tiene y
 * sin repetir la misma pieza dos veces.
 */
export function piecesFromAi(
  raw: unknown[],
  entry: { personIds: string[]; date: string; placeId?: string; hasMood: boolean },
  workspace: Workspace,
): DiaryPiece[] {
  const people = new Set(workspace.people.map((p) => p.id));
  const byId = new Map(workspace.entries.map((e) => [e.id, e]));
  const places = new Map(workspace.places.map((p) => [p.id, p]));
  const person = (v: unknown) => {
    const id = s(v, 64);
    return people.has(id) ? id : null;
  };
  const ids = (v: unknown) =>
    [...new Set((Array.isArray(v) ? v : []).map(person))].filter(
      (x): x is string => Boolean(x),
    );
  const out: DiaryPiece[] = [];
  const seen = new Set<string>();
  const push = (key: string, p: DiaryPiece) => {
    const k = normalizeText(key);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const base = { id: crypto.randomUUID(), on: true, evidence: s(r.evidence, 400) };
    const date = isDate(r.date) || entry.date;
    switch (r.kind) {
      case "cumplido": {
        const task = byId.get(s(r.id, 64));
        if (!task || task.kind !== "Pendiente" || task.status === "completado") break;
        push("cumplido|" + task.id, { ...base, kind: "cumplido", taskId: task.id, title: task.title });
        break;
      }
      case "hecho":
      case "plan": {
        const title = s(r.title, 180);
        if (!title) break;
        const done = r.kind === "hecho";
        push("tarea|" + title, {
          ...base,
          kind: "tarea",
          done,
          title,
          date,
          due: done ? "" : isDate(r.due),
          commitment: oneOf(r.commitment, COMMITMENTS, "quiero"),
          personId: person(r.person),
          peopleIds: ids(r.people),
        });
        break;
      }
      case "avance": {
        const work = byId.get(s(r.id, 64));
        const known = work && work.kind === "Trabajo" ? work : null;
        const title = known?.title ?? s(r.title, 180);
        if (!title) break;
        push("avance|" + (known?.id ?? title), {
          ...base,
          kind: "avance",
          workId: known?.id ?? null,
          title,
          stage: oneOf(r.stage, STAGES, "curso"),
          nextStep: s(r.next_step, 200),
        });
        break;
      }
      case "obra": {
        const found = byId.get(s(r.id, 64));
        const known =
          found && (found.kind === "Libro" || found.kind === "Película") ? found : null;
        const media: "Libro" | "Película" = known
          ? known.kind === "Libro"
            ? "Libro"
            : "Película"
          : r.media === "libro"
            ? "Libro"
            : "Película";
        const title = known?.title ?? s(r.title, 180);
        if (!title) break;
        const rating = Math.round(Number(r.rating));
        push("obra|" + (known?.id ?? title), {
          ...base,
          kind: "obra",
          mediaId: known?.id ?? null,
          media,
          series: known ? Boolean(known.details.series) : r.media === "serie",
          title,
          status: oneOf(r.status, ["quiero", "curso", "listo"] as const, "curso"),
          rating: rating >= 1 && rating <= 5 ? rating : 0,
        });
        break;
      }
      case "novedad": {
        const who = person(r.person);
        const text = s(r.text, 500);
        if (!who || !text) break;
        push("novedad|" + who + text, {
          ...base,
          kind: "novedad",
          personId: who,
          updateKind: oneOf(r.update_kind, UPDATE_KINDS, "otro"),
          text,
          date,
        });
        break;
      }
      case "dato": {
        const who = person(r.person);
        const value = s(r.value, 80);
        if (!who || !value) break;
        const field = oneOf(r.field, FIELDS, "fact");
        if (field === "birthday" && !/^\d{2}-\d{2}$/.test(value)) break;
        push("dato|" + who + value, {
          ...base,
          kind: "dato",
          personId: who,
          field,
          label: s(r.label, 40),
          value,
        });
        break;
      }
      case "preguntar": {
        const who = person(r.person);
        const text = s(r.text, 200);
        if (!who || !text) break;
        push("preguntar|" + who + text, { ...base, kind: "preguntar", personId: who, text });
        break;
      }
      case "intercambio": {
        const who = person(r.person);
        if (!who) break;
        push("intercambio|" + who + s(r.note), {
          ...base,
          kind: "intercambio",
          personId: who,
          dir: r.dir === "recibir" ? "recibir" : "dar",
          exchange: oneOf(r.exchange, EXCHANGES, "favor"),
          note: s(r.note, 200),
          date,
        });
        break;
      }
      case "movimiento": {
        const amount = Math.round(Number(r.amount));
        if (!Number.isFinite(amount) || amount <= 0) break;
        const category = allMoneyCategories.includes(s(r.category))
          ? s(r.category)
          : "Otro";
        push("movimiento|" + amount + s(r.title), {
          ...base,
          kind: "movimiento",
          amount,
          direction: r.direction === "ingreso" ? "ingreso" : "egreso",
          category,
          title: s(r.title, 120) || category,
          date,
        });
        break;
      }
      case "aprendizaje": {
        const title = s(r.title, 180);
        if (!title) break;
        push("aprendizaje|" + title, {
          ...base,
          kind: "aprendizaje",
          title,
          source: SOURCES.includes(s(r.source)) ? s(r.source) : "Práctica",
          sourceName: s(r.source_name, 120),
        });
        break;
      }
      case "idea": {
        const title = s(r.title, 180);
        if (!title) break;
        push("idea|" + title, { ...base, kind: "idea", title, project: r.project === true });
        break;
      }
      case "vincular": {
        const who = person(r.person);
        if (!who || entry.personIds.includes(who)) break;
        push("vincular|" + who, { ...base, kind: "vincular", personId: who });
        break;
      }
      case "persona": {
        const name = s(r.name, 120);
        if (name.length < 2) break;
        const n = normalizeText(name);
        // Ya está en tus personas: no se crea otra ficha.
        if (workspace.people.some((p) => normalizeText(p.name) === n)) break;
        push("persona|" + name, { ...base, kind: "persona", name, note: s(r.note, 300) });
        break;
      }
      case "lugar": {
        const place = places.get(s(r.place_id, 64));
        if (!place || place.id === entry.placeId) break;
        push("lugar", { ...base, kind: "lugar", placeId: place.id, placeName: place.name });
        break;
      }
      case "animo": {
        if (entry.hasMood) break;
        const feelings = (Array.isArray(r.moods) ? r.moods : [])
          .map((m: unknown) => {
            const x = (m ?? {}) as Record<string, unknown>;
            const mood = moodByName(s(x.mood, 30));
            const why = s(x.why, 60);
            return mood === null ? null : { mood, ...(why && { why }) };
          })
          .filter((f): f is Feeling => f !== null)
          .filter((f, i, all) => all.findIndex((g) => g.mood === f.mood) === i)
          .slice(0, 3);
        if (feelings.length) push("animo", { ...base, kind: "animo", feelings });
        break;
      }
      default:
        break;
    }
  }
  return out.slice(0, 14);
}
