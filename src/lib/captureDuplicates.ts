import type { Entry, Person, Workspace } from "../data";
import type { CapturePlan, Piece } from "./capture";
import { contentWords } from "./captureMemory";
import { distance } from "./duplicates";
import { ordinal, readsBefore, sameBook } from "../library/rereads";
import { friendlyDate, money, normalizeText, todayInputValue } from "./format";
import { daysBetween } from "./people";

/**
 * Duplicados de una captura: piezas que ya están en Nexo (un gasto ya registrado, un pendiente
 * igual que sigue abierto, un libro que ya está en la Libroteca, un gusto que ya está en su
 * ficha…) y piezas repetidas dentro del mismo texto. Las que ya existen empiezan apagadas y, si
 * son un recuerdo, se enlazan al episodio en lugar de crearse otra vez.
 */

export type Dup = { id: string | null; text: string };

const norm = (s: string) => normalizeText(s).replace(/\s+/g, " ").trim();

/** Dos textos dicen lo mismo: iguales, o casi las mismas palabras con contenido. */
export function similarText(a: string, b: string) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const A = contentWords(na, 14);
  const B = contentWords(nb, 14);
  if (!A.length || !B.length) return false;
  const inter = A.filter((x) => B.includes(x)).length;
  const union = new Set([...A, ...B]).size;
  return (
    inter / union >= 0.6 ||
    (inter >= 2 && inter === Math.min(A.length, B.length))
  );
}

const dayOf = (e: Entry) => todayInputValue(new Date(e.created_at));
const near = (e: Entry, date: string, days: number) =>
  Math.abs(daysBetween(dayOf(e), date)) <= days;
const realIds = (ids: string[]) =>
  ids.filter((id) => !id.startsWith("new:") && !id.startsWith("kin:"));
const listHas = (list: string[] | undefined, value: string) =>
  (list ?? []).some((x) => norm(x) === norm(value) || similarText(x, value));

function findDup(p: Piece, ws: Workspace, date: string): Dup | null {
  const person = (id: string) => ws.people.find((x) => x.id === id);
  const entry = (test: (e: Entry) => boolean) => ws.entries.find(test);
  switch (p.kind) {
    case "movimiento": {
      const e = entry(
        (e) =>
          e.kind === "Movimiento" &&
          e.amount === p.amount &&
          e.direction === p.direction &&
          near(e, p.date, 2),
      );
      return e
        ? {
            id: e.id,
            text: `Ya hay un ${p.direction === "ingreso" ? "ingreso" : "gasto"} de ${money(p.amount)} el ${friendlyDate(dayOf(e)).toLowerCase()}: se enlaza en vez de duplicarlo.`,
          }
        : null;
    }
    case "encuentro": {
      const ids = realIds(p.personIds);
      if (!ids.length) return null;
      const e = entry((e) => {
        if (e.kind !== "Encuentro" || !near(e, p.date, 1)) return false;
        const shared = ids.filter((id) => e.person_ids.includes(id)).length;
        return shared >= Math.max(1, Math.ceil(ids.length / 2));
      });
      return e
        ? {
            id: e.id,
            text: `Ya registraste «${e.title}» ${friendlyDate(dayOf(e)).toLowerCase()}.`,
          }
        : null;
    }
    case "compromiso": {
      const e = entry(
        (e) =>
          e.kind === "Pendiente" &&
          e.status === "pendiente" &&
          similarText(e.title, p.title),
      );
      return e
        ? { id: e.id, text: `Ya tienes este pendiente abierto: «${e.title}».` }
        : null;
    }
    case "obra": {
      const e = entry(
        (e) => e.kind === p.media && norm(e.title) === norm(p.title),
      );
      return e
        ? { id: e.id, text: `«${e.title}» ya está en tu Libroteca.` }
        : null;
    }
    case "idea":
    case "trabajo": {
      const e = entry(
        (e) =>
          (e.kind === "Trabajo" ||
            (e.kind === "Nota" && e.tags.includes("idea"))) &&
          similarText(e.title, p.title),
      );
      return e
        ? { id: e.id, text: `Se parece a «${e.title}», que ya tienes.` }
        : null;
    }
    case "aprendizaje": {
      const e = entry(
        (e) => e.kind === "Aprendizaje" && similarText(e.title, p.title),
      );
      return e
        ? { id: e.id, text: `Ya anotaste algo parecido: «${e.title}».` }
        : null;
    }
    case "visita": {
      const name = norm(p.placeName);
      const e = entry(
        (e) =>
          e.kind === "Nota" &&
          e.tags.includes("lugar") &&
          near(e, p.date, 0) &&
          ((p.placeId && e.details.placeId === p.placeId) ||
            (name !== "" && norm(e.details.place ?? "") === name)),
      );
      return e
        ? { id: e.id, text: "Ya registraste esta visita ese día." }
        : null;
    }
    case "enlace": {
      const e = entry((e) => e.kind === "Nota" && e.body.includes(p.url));
      return e
        ? { id: e.id, text: "Este enlace ya está guardado en una nota." }
        : null;
    }
    case "conexion": {
      const e = entry(
        (e) =>
          e.kind === "Nota" &&
          e.tags.includes("conexión") &&
          e.person_ids.includes(p.a) &&
          e.person_ids.includes(p.b),
      );
      return e
        ? { id: e.id, text: "Ya habías anotado esta posible conexión." }
        : null;
    }
    case "novedad": {
      const u = person(p.personId)?.profile.updates?.find(
        (u) =>
          Math.abs(daysBetween(u.date, p.date || date)) <= 60 &&
          similarText(u.text, p.text),
      );
      return u ? { id: null, text: `Ya está en su ficha: «${u.text}».` } : null;
    }
    case "dato": {
      const pr = person(p.personId)?.profile;
      if (!pr) return null;
      const has =
        p.field === "birthday"
          ? pr.birthday === p.value
          : p.field === "fact"
            ? (pr.facts ?? []).some(
                (f) =>
                  norm(f.label) === norm(p.label) &&
                  norm(f.value) === norm(p.value),
              )
            : listHas(pr[p.field], p.value);
      return has ? { id: null, text: "Ese dato ya está en su ficha." } : null;
    }
    case "preguntar":
      return listHas(person(p.personId)?.profile.askNext, p.text)
        ? { id: null, text: "Ya tenías esa pregunta pendiente." }
        : null;
    case "intercambio":
      return (person(p.personId)?.profile.exchanges ?? []).some(
        (x) => x.date === p.date && x.dir === p.dir && x.kind === p.exchange,
      )
        ? { id: null, text: "Ya está en «Dar y recibir» de su ficha." }
        : null;
    default:
      return null;
  }
}

/** Clave para encontrar la misma pieza repetida dentro del texto. */
function selfKey(p: Piece): string | null {
  switch (p.kind) {
    case "compromiso":
    case "idea":
    case "trabajo":
    case "aprendizaje":
    case "obra":
      return `${p.kind}|${norm(p.title)}`;
    case "novedad":
    case "preguntar":
      return `${p.kind}|${p.personId}|${norm(p.text)}`;
    case "dato":
      return `${p.kind}|${p.personId}|${p.field}|${norm(p.value)}`;
    case "conexion":
      return `${p.kind}|${[p.a, p.b].sort().join("|")}`;
    case "enlace":
      return `${p.kind}|${p.url}`;
    case "movimiento":
      return `${p.kind}|${p.amount}|${p.direction}|${norm(p.evidence)}`;
    default:
      return null;
  }
}

/** Una persona que ya tienes y cuyo nombre se parece al nuevo («Andrez» → Andrés Pérez). */
export function lookalike(name: string, people: Person[]): string | null {
  const w = norm(name).split(" ").filter(Boolean);
  if (!w.length || w[0].length < 4) return null;
  let best: { id: string; d: number } | null = null;
  for (const p of people) {
    if (p.profile.status === "memoria") continue;
    const pw = norm(p.name).split(" ").filter(Boolean);
    if (!pw.length) continue;
    const first = distance(w[0], pw[0], 1);
    if (first > 1) continue;
    // Con apellido: también debe parecerse.
    if (w[1] && pw[1] && distance(w[1], pw[1], 2) > 2) continue;
    const d = first + (w[1] && pw[1] ? distance(w[1], pw[1], 2) : 0);
    if (d === 0 && w.length === pw.length) return p.id;
    if (!best || d < best.d) best = { id: p.id, d };
  }
  return best && best.d <= 2 ? best.id : null;
}

/**
 * Un libro de tu estantería que aún no empezabas y que el texto hace avanzar («empecé a leer…»,
 * «terminé…»): no es un duplicado, se actualiza esa misma ficha.
 */
function shelfBookFor(p: Piece, ws: Workspace): Entry | null {
  if (p.kind !== "obra" || p.media !== "Libro" || p.status === "estante")
    return null;
  const e = ws.entries.find(
    (e) =>
      e.kind === "Libro" &&
      e.details.bookFormat === "fisico" &&
      (e.details.bookOwner ?? "mio") === "mio" &&
      norm(e.title) === norm(p.title),
  );
  if (!e) return null;
  const read = e.details.read;
  // Solo si avanza: de la estantería a cualquier estado, o de «por leer» a leyendo o terminado.
  return read === "estante" || (read === "quiero" && p.status !== "quiero")
    ? e
    : null;
}

/**
 * Un libro que ya terminaste y que el texto vuelve a leer («empecé a releer…», «lo terminé otra
 * vez»): no es un duplicado, es tu siguiente lectura. Devuelve su número (2, 3…) o 0. Si ya lo
 * estás leyendo ahora mismo, sí es un duplicado.
 */
function rereadFor(p: Piece, ws: Workspace, date: string): number {
  if (p.kind !== "obra" || p.media !== "Libro") return 0;
  if (p.status !== "curso" && p.status !== "listo") return 0;
  const book = { title: p.title, author: p.author };
  const open = ws.entries.some(
    (e) =>
      e.kind === "Libro" &&
      (e.details.read ?? "leyendo") === "leyendo" &&
      sameBook(book, { title: e.title, author: e.details.author }),
  );
  if (open) return 0;
  const prior = readsBefore(book, ws.entries, date);
  return prior > 0 ? prior + 1 : 0;
}

/** Marca lo que ya existe, quita lo repetido dentro del texto y avisa de nombres parecidos. */
export function markDuplicates(plan: CapturePlan, ws: Workspace): CapturePlan {
  const seen = new Set<string>();
  const pieces: Piece[] = [];
  for (const p of plan.pieces) {
    const key = selfKey(p);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const dup = p.dup ?? findDup(p, ws, plan.date);
    const shelf = !p.dup && p.kind === "obra" ? shelfBookFor(p, ws) : null;
    const again = !p.dup && !shelf ? rereadFor(p, ws, plan.date) : 0;
    pieces.push(
      shelf
        ? ({
            ...p,
            shelfId: shelf.id,
            copy: "mio",
            hint: `«${shelf.title}» está en tu estantería: se actualiza su estado.`,
          } as Piece)
        : again
          ? ({
              ...p,
              readNo: again,
              hint: `Ya lo habías leído: se guarda como tu ${ordinal(again)} lectura.`,
            } as Piece)
          : dup
          ? ({ ...p, on: false, dup } as Piece)
          : p,
    );
  }
  const newPeople = plan.newPeople.map((n) =>
    n.like !== undefined
      ? n
      : { ...n, like: lookalike(n.name, ws.people) ?? undefined },
  );
  return { ...plan, pieces, newPeople };
}
