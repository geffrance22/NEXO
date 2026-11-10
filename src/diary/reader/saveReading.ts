import type { AppContextValue } from "../../AppContext";
import { cleanDetails } from "../../composer/logic";
import type {
  Entry,
  EntryDetails,
  EntryInput,
  Person,
  PersonProfile,
} from "../../data";
import { normalizeText, todayInputValue } from "../../lib/format";
import { fresh } from "../../planner/NoteEditor";
import { put } from "../../planner/shared";
import type { DiaryPiece } from "./pieces";

const base = (
  over: Partial<EntryInput> & Pick<EntryInput, "kind" | "title">,
): EntryInput => ({
  body: "",
  tags: [],
  personIds: [],
  date: todayInputValue(),
  amount: 0,
  direction: "egreso",
  status: "pendiente",
  images: [],
  details: {},
  file: null,
  removeFile: false,
  ...over,
});

const addUnique = (list: string[] = [], more: string[]) => {
  const seen = new Set(list.map((x) => normalizeText(x)));
  return [
    ...list,
    ...more.filter((x) => !seen.has(normalizeText(x)) && seen.add(normalizeText(x))),
  ];
};

/**
 * Guarda las piezas que aceptaste de la lectura de una entrada. Todo queda enlazado a la entrada
 * (`sourceId` en lo nuevo, `entryId` en las novedades). Devuelve cuántas se guardaron.
 */
export async function saveReading(
  entryId: string,
  pieces: DiaryPiece[],
  app: AppContextValue,
): Promise<number> {
  const on = pieces.filter((p) => p.on);
  const find = (id: string) => app.workspace.entries.find((e) => e.id === id);
  let entry: Entry | undefined = find(entryId);
  let count = 0;
  const date = entry ? todayInputValue(new Date(entry.created_at)) : todayInputValue();
  const quote = (p: DiaryPiece) => (p.evidence ? `«${p.evidence}»` : "");

  // 1. Personas nuevas: se crean y quedan vinculadas a la entrada.
  const linkIds: string[] = [];
  for (const p of on) {
    if (p.kind === "vincular") linkIds.push(p.personId);
    if (p.kind !== "persona" || !p.name.trim()) continue;
    const person = await app.createPerson(p.name.trim().slice(0, 120));
    if (!person) continue;
    count++;
    linkIds.push(person.id);
    if (p.note.trim())
      await app.patchPerson(
        person,
        { profile: { ...person.profile, metHow: p.note.trim().slice(0, 300), metOn: date } },
        true,
      );
  }

  // 2. La entrada misma: personas, lugar y ánimo que propuso la lectura.
  if (entry) {
    const details: EntryDetails = { ...entry.details };
    let touched = false;
    for (const p of on) {
      if (p.kind === "lugar") {
        details.placeId = p.placeId;
        details.place = p.placeName;
        touched = true;
      }
      if (p.kind === "animo" && p.feelings.length) {
        details.feelings = p.feelings;
        details.mood = p.feelings[0].mood;
        touched = true;
      }
    }
    const people = [...new Set([...entry.person_ids, ...linkIds])];
    const morePeople = people.length !== entry.person_ids.length;
    if (touched || morePeople) {
      const ok = await app.patchEntry(entry, {
        ...(touched && { details }),
        ...(morePeople && { person_ids: people }),
      });
      if (ok) {
        count += on.filter((p) => p.kind === "lugar" || p.kind === "animo").length;
        count += linkIds.length - on.filter((p) => p.kind === "persona").length;
        entry = { ...entry, details, person_ids: people };
      }
    }
  }
  const source = entry ? { sourceId: entry.id } : {};

  // 3. Lo que conecta con lo que ya tienes y lo nuevo.
  const adds = new Map<
    string,
    Pick<PersonProfile, "updates" | "exchanges" | "likes" | "dislikes" | "gifts" | "askNext" | "facts" | "birthday">
  >();
  const addsFor = (id: string) => {
    let a = adds.get(id);
    if (!a) adds.set(id, (a = {}));
    return a;
  };
  const now = () => new Date().toISOString();

  for (const p of on) {
    switch (p.kind) {
      case "cumplido": {
        const task = find(p.taskId);
        if (task && task.status !== "completado" && (await app.patchEntry(task, { status: "completado" })))
          count++;
        break;
      }
      case "tarea": {
        const details: EntryDetails = { priority: "media", ...source };
        if (!p.done) {
          if (p.due) details.due = p.due;
          if (p.commitment !== "quiero") details.commitment = p.commitment;
          if (p.personId && p.commitment === "prometi") details.beneficiary = p.personId;
          if (p.personId && (p.commitment === "espero" || p.commitment === "depende"))
            details.owner = p.personId;
        }
        const saved = await app.createEntry(
          base({
            kind: "Pendiente",
            title: p.title,
            body: quote(p),
            personIds: [...new Set([...(p.personId ? [p.personId] : []), ...p.peopleIds])],
            date: p.done ? p.date : date,
            status: p.done ? "completado" : "pendiente",
            details,
          }),
          true,
        );
        if (saved) count++;
        break;
      }
      case "avance": {
        const work = p.workId ? find(p.workId) : undefined;
        if (work) {
          const ok = await app.patchEntry(work, {
            details: cleanDetails("Trabajo", {
              ...work.details,
              stage: p.stage,
              ...(p.nextStep.trim() && { nextStep: p.nextStep.trim() }),
            }),
          });
          if (ok) count++;
          break;
        }
        const saved = await app.createEntry(
          base({
            kind: "Trabajo",
            title: p.title,
            body: quote(p),
            date,
            details: cleanDetails("Trabajo", {
              stage: p.stage,
              priority: "media",
              nextStep: p.nextStep.trim() || undefined,
            }),
          }),
          true,
        );
        if (saved) count++;
        break;
      }
      case "obra": {
        const known = p.mediaId ? find(p.mediaId) : undefined;
        const book = p.media === "Libro";
        const state: EntryDetails = book
          ? {
              read: p.status === "listo" ? "terminado" : p.status === "curso" ? "leyendo" : "quiero",
              ...(p.status === "listo" && { finishedAt: date }),
            }
          : {
              watch: p.status === "quiero" ? "quiero" : p.status === "curso" && p.series ? "viendo" : "vista",
              ...(p.series && { series: true }),
            };
        if (p.rating && p.status === "listo") state.rating = p.rating;
        if (known) {
          const ok = await app.patchEntry(known, {
            details: cleanDetails(known.kind, { ...known.details, ...state }),
          });
          if (ok) count++;
          break;
        }
        const saved = await app.createEntry(
          base({
            kind: p.media,
            title: p.title,
            body: quote(p),
            date,
            details: cleanDetails(p.media, state),
          }),
          true,
        );
        if (saved) count++;
        break;
      }
      case "movimiento": {
        const saved = await app.createEntry(
          base({
            kind: "Movimiento",
            title: p.title || p.category,
            body: quote(p),
            tags: p.category && p.category !== "Otro" ? [p.category] : [],
            date: p.date,
            amount: p.amount,
            direction: p.direction,
          }),
          true,
        );
        if (saved) count++;
        break;
      }
      case "aprendizaje": {
        const saved = await app.createEntry(
          base({
            kind: "Aprendizaje",
            title: p.title,
            body: quote(p),
            date,
            details: cleanDetails("Aprendizaje", {
              source: p.source,
              sourceName: p.sourceName || undefined,
              ...source,
            }),
          }),
          true,
        );
        if (saved) count++;
        break;
      }
      case "idea": {
        // Como proyecto va a Trabajo; si no, a tus notas de Libroteca (no al diario, para no
        // sumar entradas que no escribiste).
        if (!p.project) {
          try {
            const { id: _id, ...note } = fresh(null);
            void _id;
            await put("quick_notes", {
              ...note,
              title: p.title.trim().slice(0, 180),
              body: quote(p),
              tags: ["idea"],
            });
            window.dispatchEvent(new Event("nexo:idea-saved"));
            count++;
          } catch {
            /* Sin la tabla de notas: la idea no se guarda, lo demás sí. */
          }
          break;
        }
        const saved = await app.createEntry(
          base({
            kind: "Trabajo",
            title: p.title,
            body: quote(p),
            tags: ["idea"],
            date,
            details: cleanDetails("Trabajo", { stage: "idea", priority: "media" }),
          }),
          true,
        );
        if (saved) count++;
        break;
      }
      case "novedad":
        (addsFor(p.personId).updates ??= []).push({
          id: crypto.randomUUID(),
          date: p.date,
          kind: p.updateKind,
          text: p.text.trim().slice(0, 500),
          created_at: now(),
          ...(entry && { entryId: entry.id }),
        });
        break;
      case "intercambio":
        (addsFor(p.personId).exchanges ??= []).push({
          id: crypto.randomUUID(),
          date: p.date,
          dir: p.dir,
          kind: p.exchange,
          weight: 1,
          ...(p.note.trim() && { note: p.note.trim().slice(0, 200) }),
        });
        break;
      case "dato": {
        const a = addsFor(p.personId);
        const value = p.value.trim();
        if (!value) break;
        if (p.field === "birthday") a.birthday = value;
        else if (p.field === "fact")
          (a.facts ??= []).push({ id: crypto.randomUUID(), label: p.label.trim() || "Dato", value });
        else (a[p.field] ??= []).push(value.slice(0, 80));
        break;
      }
      case "preguntar":
        if (p.text.trim()) (addsFor(p.personId).askNext ??= []).push(p.text.trim().slice(0, 200));
        break;
      default:
        break;
    }
  }

  // 4. Una sola escritura por ficha.
  for (const [id, a] of adds) {
    const person: Person | undefined = app.workspace.people.find((x) => x.id === id);
    if (!person) continue;
    const pr = person.profile;
    const next: PersonProfile = {
      ...pr,
      ...(a.updates && { updates: [...a.updates, ...(pr.updates ?? [])].slice(0, 300) }),
      ...(a.exchanges && { exchanges: [...a.exchanges, ...(pr.exchanges ?? [])].slice(0, 500) }),
      ...(a.likes && { likes: addUnique(pr.likes, a.likes) }),
      ...(a.dislikes && { dislikes: addUnique(pr.dislikes, a.dislikes) }),
      ...(a.gifts && { gifts: addUnique(pr.gifts, a.gifts) }),
      ...(a.askNext && { askNext: addUnique(pr.askNext, a.askNext) }),
      ...(a.facts && { facts: [...(pr.facts ?? []), ...a.facts] }),
      ...(a.birthday && { birthday: a.birthday }),
    };
    if (await app.patchPerson(person, { profile: next }, true))
      count +=
        (a.updates?.length ?? 0) +
        (a.exchanges?.length ?? 0) +
        (a.likes?.length ?? 0) +
        (a.dislikes?.length ?? 0) +
        (a.gifts?.length ?? 0) +
        (a.askNext?.length ?? 0) +
        (a.facts?.length ?? 0) +
        (a.birthday ? 1 : 0);
  }
  return count;
}
