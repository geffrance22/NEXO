import type { MyProfile, ProfileChange } from "../data";
import { todayInputValue } from "../lib/format";
import { goalItemsOf } from "../lib/myself";
import { surnamesOf } from "../lib/relations";

/** Lo único que edita el formulario. El resto de tu ficha (Mi espacio, diario…) no se toca. */
export const EDITABLE = [
  "name",
  "alias",
  "gender",
  "birthday",
  "birthYear",
  "birthTime",
  "city",
  "hometown",
  "occupation",
  "company",
  "history",
  "places",
  "interests",
  "likes",
  "dislikes",
  "languages",
  "skills",
  "facts",
  "dates",
  "goalItems",
  "about",
  "nexoVoice",
  "readingExclude",
] as const;
export type Draft = Pick<MyProfile, (typeof EDITABLE)[number]>;

export const pickDraft = (p: MyProfile): Draft => {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (p[k] !== undefined) out[k] = p[k];
  out.goalItems = goalItemsOf(p);
  return out as Draft;
};

/** Sin textos ni listas vacías: un campo vacío se borra de la ficha. */
const cleanValue = (v: unknown): unknown => {
  if (typeof v === "string") return v.trim() || undefined;
  if (Array.isArray(v)) return v.length ? v : undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = Object.fromEntries(
      Object.entries(v).filter(([, x]) => cleanValue(x) !== undefined),
    );
    return Object.keys(o).length ? o : undefined;
  }
  return v ?? undefined;
};

/**
 * Los campos del formulario listos para guardar (los vacíos van en `undefined` y se borran). Si
 * cambiaste tu ciudad, ocupación o empresa, lo anterior pasa a tu trayectoria con la fecha de hoy.
 */
export function toPatch(d: Draft, before: MyProfile): Partial<MyProfile> {
  const draft: Draft = {
    ...d,
    facts: d.facts?.filter((f) => f.label.trim() && f.value.trim()),
    dates: d.dates?.filter((f) => f.label.trim() && /^\d{2}-\d{2}$/.test(f.md)),
    goalItems: d.goalItems
      ?.map((g) => ({ ...g, text: g.text.trim() }))
      .filter((g) => g.text),
    history: d.history?.filter((h) => h.value.trim() && h.until),
  };
  const history: ProfileChange[] = [...(draft.history ?? [])];
  for (const field of ["occupation", "company", "city"] as const) {
    const was = (before[field] ?? "").trim();
    const now = (draft[field] ?? "").trim();
    if (
      was &&
      was !== now &&
      !history.some((h) => h.field === field && h.value.trim() === was)
    )
      history.unshift({ field, value: was, until: todayInputValue() });
  }
  draft.history = history.slice(0, 40);
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) out[k] = cleanValue(draft[k]);
  // `goals` (texto) sigue igual a tus metas: lo leen Mi espacio, el saludo y el chat.
  out.goals = cleanValue(draft.goalItems?.map((g) => g.text));
  return out as Partial<MyProfile>;
}

/** Lo que se puede contar de ti, en orden: cada pendiente lleva a su campo. */
export function checklist(p: Draft, hasPhoto: boolean) {
  const items = [
    { id: "mf-photo", done: hasPhoto, todo: "Sube una foto tuya" },
    {
      id: "mf-name",
      done: surnamesOf(p.name ?? "").length > 0,
      todo: "Escribe tu nombre con tus apellidos",
    },
    {
      id: "mf-alias",
      done: Boolean(p.alias?.trim()),
      todo: "Cuenta cómo te dicen",
    },
    { id: "mf-gender", done: Boolean(p.gender), todo: "Indica tu sexo" },
    {
      id: "mf-bday",
      done: Boolean(p.birthday),
      todo: "Añade tu fecha de nacimiento",
    },
    { id: "mf-city", done: Boolean(p.city?.trim()), todo: "Añade tu ciudad" },
    {
      id: "mf-occupation",
      done: Boolean(p.occupation?.trim()),
      todo: "Cuenta a qué te dedicas",
    },
    {
      id: "mf-company",
      done: Boolean(p.company?.trim()),
      todo: "Añade dónde trabajas o estudias",
    },
    {
      id: "mf-interests",
      done: Boolean(p.interests?.length),
      todo: "Añade lo que te interesa",
    },
    {
      id: "mf-likes",
      done: Boolean(p.likes?.length),
      todo: "Cuenta lo que te encanta",
    },
    {
      id: "mf-dislikes",
      done: Boolean(p.dislikes?.length),
      todo: "Cuenta lo que no te gusta",
    },
    {
      id: "mf-goals",
      done: Boolean(p.goalItems?.some((g) => g.text.trim())),
      todo: "Cuéntale a Nexo en qué estás",
    },
    {
      id: "mf-places",
      done: Boolean(p.places?.casa || p.places?.trabajo || p.places?.estudio),
      todo: "Marca tu casa o tu trabajo",
    },
    {
      id: "mf-about",
      done: Boolean(p.about?.trim()),
      todo: "Escribe algo de ti en tus palabras",
    },
  ];
  const done = items.filter((x) => x.done).length;
  return {
    percent: Math.round((100 * done) / items.length),
    missing: items.filter((x) => !x.done),
  };
}
