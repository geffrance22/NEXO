import { moodTone } from "../composer/moods";
import type {
  MyGoal,
  MyProfile,
  NexoLength,
  NexoTone,
  Person,
  Place,
  ReadingPart,
  Workspace,
} from "../data";
import { buildDays, streaks } from "../diary/model";
import { addDays, normalizeText, splitList, todayInputValue } from "./format";
import { daysToBirthday } from "./people";

export const toneLabels: Record<NexoTone, string> = {
  calido: "Cálido",
  directo: "Directo",
  divertido: "Con humor",
  formal: "Formal",
};
export const lengthLabels: Record<NexoLength, string> = {
  breve: "Breve",
  normal: "Normal",
  detallado: "Detallado",
};
/** Lo que Nexo entiende de cada tono (va a la instrucción de la IA). */
const toneHint: Record<NexoTone, string> = {
  calido: "cálido y cercano",
  directo: "directo, sin rodeos ni adornos",
  divertido: "con humor y ligereza",
  formal: "formal y respetuoso, sin tuteo coloquial",
};
const lengthHint: Record<NexoLength, string> = {
  breve: "respuestas cortas, lo esencial",
  normal: "extensión normal",
  detallado: "respuestas más completas y con detalle",
};

export const readingPartLabels: Record<ReadingPart, string> = {
  finanzas: "Tus finanzas",
  animo: "Tu ánimo",
  textos: "El texto de tus recuerdos",
  pendientes: "Tus pendientes y trabajos",
  lugares: "Tus lugares",
};

/** Tus metas con estructura, en el orden de `goals` (las que se escribieron antes no se pierden). */
export function goalItemsOf(p: MyProfile): MyGoal[] {
  const items = p.goalItems ?? [];
  const texts = p.goals ?? [];
  if (!texts.length) return items;
  const left = [...items];
  return texts.map((text) => {
    const i = left.findIndex(
      (g) => normalizeText(g.text) === normalizeText(text),
    );
    return i >= 0 ? left.splice(i, 1)[0] : { id: crypto.randomUUID(), text };
  });
}

/** Días hasta una fecha MM-DD que vuelve cada año (0 = hoy), o null si no es válida. */
export const daysToMonthDay = (
  md: string | undefined,
  today = todayInputValue(),
) =>
  md ? daysToBirthday({ profile: { birthday: md } } as Person, today) : null;

/** Cómo quieres que te hable Nexo, en palabras para la IA (undefined si no lo indicaste). */
export function voiceOf(p: MyProfile) {
  const v = p.nexoVoice;
  if (!v || (!v.tone && !v.length && !v.avoid?.length)) return undefined;
  return {
    tono: v.tone ? toneHint[v.tone] : undefined,
    extension: v.length ? lengthHint[v.length] : undefined,
    temas_que_no_sacar: v.avoid?.length ? v.avoid.slice(0, 12) : undefined,
  };
}

/** La ciudad sin país ni región: «Medellín, Colombia» → «medellin». */
const cityKey = (s?: string) => normalizeText((s ?? "").split(",")[0].trim());

const placeName = (places: Place[], id?: string) =>
  id ? places.find((p) => p.id === id) : undefined;

/**
 * Lo que la IA de captura y del diario necesita de ti para entender «en casa», «mi trabajo» o
 * «la oficina»: tu ciudad, tu empresa y tus lugares.
 */
export function selfContext(p: MyProfile, places: Place[]) {
  const pick = (id?: string) => {
    const place = placeName(places, id);
    return place ? { id: place.id, name: place.name } : undefined;
  };
  const out = {
    name: p.name?.trim() || undefined,
    alias: p.alias?.trim() || undefined,
    city: p.city?.trim() || undefined,
    hometown: p.hometown?.trim() || undefined,
    occupation: p.occupation?.trim() || undefined,
    company: p.company?.trim() || undefined,
    home: pick(p.places?.casa),
    work: pick(p.places?.trabajo),
    study: pick(p.places?.estudio),
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}
export type SelfContext = NonNullable<ReturnType<typeof selfContext>>;

/** Palabras de una persona con las que se compara tu lista de intereses. */
const tastesOf = (p: Person) =>
  [
    ...splitList(p.interests ?? ""),
    ...(p.profile.likes ?? []),
    ...(p.profile.keywords ?? []),
  ].map((t) => ({ label: t, key: normalizeText(t.trim()) }));

export type Match = { person: Person; why?: string };

/**
 * Coincidencias contigo, igual que la familia por apellidos: quién trabaja o estudia donde tú,
 * quién vive en tu ciudad y quién comparte tus intereses. Sin personas que ya no están.
 */
export function matchesFor(p: MyProfile, people: Person[]) {
  const alive = people.filter((x) => x.profile.status !== "memoria");
  const company = normalizeText(p.company?.trim() ?? "");
  const city = cityKey(p.city);
  const mine = new Map(
    [...(p.interests ?? []), ...(p.likes ?? [])].map((t) => [
      normalizeText(t.trim()),
      t,
    ]),
  );
  const colleagues: Match[] = company
    ? alive
        .filter(
          (x) => normalizeText(x.profile.company?.trim() ?? "") === company,
        )
        .map((person) => ({ person }))
    : [];
  const neighbors: Match[] = city
    ? alive
        .filter((x) => cityKey(x.profile.city) === city)
        .map((person) => ({ person }))
    : [];
  const shared: Match[] = mine.size
    ? alive.flatMap((person) => {
        const hit = tastesOf(person).find((t) => t.key && mine.has(t.key));
        return hit ? [{ person, why: mine.get(hit.key)! }] : [];
      })
    : [];
  return { colleagues, neighbors, shared };
}

/** «Tu Nexo en números»: se calcula aquí, sin IA. */
export function nexoNumbers(ws: Workspace, today = todayInputValue()) {
  const since90 = addDays(today, -90);
  const moods = ws.entries
    .filter((e) => todayInputValue(new Date(e.created_at)) >= since90)
    .map((e) => moodTone(e.details.mood))
    .filter((m): m is number => typeof m === "number");
  const diary = ws.entries.filter((e) => e.kind === "Nota");
  const run = streaks(buildDays(diary), today);
  return {
    people: ws.people.length,
    memories: ws.entries.filter((e) => e.kind !== "Movimiento").length,
    mood: moods.length
      ? Math.round((10 * moods.reduce((s, m) => s + m, 0)) / moods.length) / 10
      : null,
    moodCount: moods.length,
    streak: run.current,
    bestStreak: run.best,
    wroteToday: run.alive,
  };
}

/** Una palabra para el ánimo promedio (1–5). */
export const moodWord = (m: number) =>
  m >= 4.3
    ? "Muy bien"
    : m >= 3.6
      ? "Bien"
      : m >= 2.8
        ? "Estable"
        : m >= 2
          ? "Bajo"
          : "Difícil";
