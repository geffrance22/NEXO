import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "../backend";
import { addDays, normalizeText, todayInputValue } from "../lib/format";
import type { BoardCard, CardChanges, Priority } from "./boardStore";
import { isMissingPhase2 } from "./boardPhase";

/**
 * Plantillas de tarjeta: se invocan escribiendo /nombre al crear una tarjeta («/reunion Equipo
 * de diseño») o en la lista de una tarjeta abierta. Traen descripción, etiquetas, lista de
 * verificación, prioridad, color y una fecha relativa a hoy. Las de Nexo vienen puestas; las tuyas
 * se guardan en la base (migración 202611100009) o, sin ella, en este equipo.
 */
export type CardTemplate = {
  slug: string;
  name: string;
  /** Título por defecto si no escribes otro tras /nombre. */
  title?: string;
  body?: string;
  tags?: string[];
  checks?: string[];
  priority?: Priority;
  color?: string;
  /** Fecha límite a tantos días de hoy. */
  dueIn?: number;
  /** De Nexo (no se borra). */
  builtin?: boolean;
};

export const builtinCardTemplates: CardTemplate[] = [
  {
    slug: "reunion",
    name: "Reunión",
    title: "Reunión",
    tags: ["reunión"],
    body: "Objetivo:\n\nAsistentes:\n\nAcuerdos:\n",
    checks: ["Enviar la agenda", "Preparar materiales", "Tomar notas", "Enviar acuerdos y próximos pasos"],
  },
  {
    slug: "llamada",
    name: "Llamada",
    title: "Llamar a",
    tags: ["llamada"],
    checks: ["Qué quiero saber", "Llamar", "Anotar lo que quedó"],
    dueIn: 0,
  },
  {
    slug: "entrega",
    name: "Entrega a cliente",
    title: "Entrega",
    tags: ["Cliente"],
    priority: "alta",
    checks: ["Revisión final", "Exportar", "Enviar enlace", "Confirmar recepción", "Facturar"],
  },
  {
    slug: "viaje",
    name: "Viaje",
    title: "Viaje a",
    tags: ["viaje"],
    checks: ["Transporte", "Alojamiento", "Documentos", "Maleta", "Quién cuida la casa"],
  },
  {
    slug: "compra",
    name: "Compra",
    title: "Comprar",
    tags: ["compra"],
    checks: ["Comparar opciones", "Decidir", "Comprar", "Guardar la factura"],
  },
  {
    slug: "bug",
    name: "Error por arreglar",
    title: "Arreglar",
    tags: ["error"],
    priority: "media",
    body: "Qué pasa:\n\nCómo reproducirlo:\n\nQué debería pasar:\n",
    checks: ["Reproducir", "Arreglar", "Probar", "Avisar"],
  },
];

const LOCAL = "nexo-card-templates";
type State = { mine: CardTemplate[]; ready: boolean; local: boolean };
let state: State = { mine: [], ready: false, local: false };
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const set = (s: State) => {
  state = s;
  subs.forEach((f) => f());
};
const readLocal = (): CardTemplate[] => {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL) ?? "[]");
    return Array.isArray(v) ? (v as CardTemplate[]) : [];
  } catch {
    return [];
  }
};
const writeLocal = (list: CardTemplate[]) => {
  try {
    localStorage.setItem(LOCAL, JSON.stringify(list.slice(0, 100)));
  } catch {
    /* sin almacenamiento */
  }
};

const clean = (t: Partial<CardTemplate>): Omit<CardTemplate, "slug" | "name"> => ({
  ...(t.title && { title: String(t.title).slice(0, 240) }),
  ...(t.body && { body: String(t.body).slice(0, 8000) }),
  ...(Array.isArray(t.tags) && { tags: t.tags.filter((x) => typeof x === "string").slice(0, 12) }),
  ...(Array.isArray(t.checks) && {
    checks: t.checks.filter((x) => typeof x === "string").slice(0, 60),
  }),
  ...(t.priority && ["alta", "media", "baja"].includes(t.priority) && { priority: t.priority }),
  ...(t.color && { color: String(t.color).slice(0, 20) }),
  ...(typeof t.dueIn === "number" && { dueIn: Math.max(0, Math.min(365, Math.round(t.dueIn))) }),
});

function load() {
  loading ??= (async () => {
    const { data, error } = await supabase
      .from("board_card_templates")
      .select("slug,name,spec")
      .order("name");
    if (error) {
      set({ mine: readLocal(), ready: true, local: true });
      return;
    }
    const rows = (data ?? []) as { slug: string; name: string; spec: Partial<CardTemplate> }[];
    set({
      mine: rows.map((r) => ({ slug: r.slug, name: r.name, ...clean(r.spec ?? {}) })),
      ready: true,
      local: false,
    });
  })();
  return loading;
}

/** El nombre corto con que se invoca: «Reunión semanal» → «reunion-semanal». */
export const slugify = (name: string) =>
  normalizeText(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "plantilla";

/** Las tuyas primero (una tuya con el mismo nombre reemplaza a la de Nexo). */
export function allTemplates(mine = state.mine) {
  const own = new Set(mine.map((t) => t.slug));
  return [...mine, ...builtinCardTemplates.filter((t) => !own.has(t.slug))];
}

export async function saveCardTemplate(t: CardTemplate) {
  const tpl: CardTemplate = { slug: slugify(t.slug || t.name), name: t.name.trim().slice(0, 80), ...clean(t) };
  const next = [...state.mine.filter((x) => x.slug !== tpl.slug), tpl].sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  );
  set({ ...state, mine: next });
  if (state.local) {
    writeLocal(next);
    return { ok: true, local: true };
  }
  const { slug, name, ...spec } = tpl;
  const { error } = await supabase
    .from("board_card_templates")
    .upsert({ slug, name, spec }, { onConflict: "owner_id,slug" });
  if (error) {
    if (isMissingPhase2(error) || error.code === "42P01" || error.code === "PGRST205") {
      set({ ...state, local: true });
      writeLocal(next);
      return { ok: true, local: true };
    }
    set({ ...state, mine: state.mine.filter((x) => x.slug !== tpl.slug) });
    return { ok: false, error: error.message };
  }
  return { ok: true, local: false };
}
export async function removeCardTemplate(slug: string) {
  const before = state.mine;
  set({ ...state, mine: before.filter((x) => x.slug !== slug) });
  if (state.local) return writeLocal(state.mine);
  const { error } = await supabase.from("board_card_templates").delete().eq("slug", slug);
  if (error) set({ ...state, mine: before });
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export function useCardTemplates() {
  const s = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    void load();
  }, []);
  return { all: allTemplates(s.mine), mine: s.mine, ready: s.ready, local: s.local };
}

/** La /palabra que estás escribiendo (para sugerir plantillas). */
export function slashAt(text: string, caret: number) {
  const m = /(^|\s)\/([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret));
  if (!m) return null;
  return { query: m[2], start: caret - m[2].length - 1 };
}

/** Busca un /nombre en el texto que corresponda a una plantilla. Devuelve la plantilla y el resto. */
export function takeSlash(text: string, templates: CardTemplate[]) {
  const re = /(^|\s)\/([\p{L}\p{N}_-]+)(?=\s|$)/gu;
  for (const m of text.matchAll(re)) {
    const key = slugify(m[2]);
    const t = templates.find((x) => x.slug === key);
    if (!t) continue;
    const at = m.index! + m[1].length;
    const rest = (text.slice(0, at) + text.slice(at + 1 + m[2].length)).replace(/\s{2,}/g, " ").trim();
    return { template: t, rest };
  }
  return null;
}

/** Lo que una plantilla añade a una tarjeta (sin borrar lo que ya tiene). */
export function templateChanges(
  t: CardTemplate,
  card: Pick<BoardCard, "body" | "tags" | "checks" | "due" | "priority" | "color">,
  today = todayInputValue(),
): CardChanges {
  const have = new Set(card.checks.map((c) => normalizeText(c.text)));
  const checks = (t.checks ?? []).filter((x) => x.trim() && !have.has(normalizeText(x)));
  const tags = (t.tags ?? []).filter(
    (x) => !card.tags.some((y) => normalizeText(y) === normalizeText(x)),
  );
  const out: CardChanges = {};
  if (t.body && !card.body.includes(t.body.trim()))
    out.body = card.body.trim() ? `${card.body.trim()}\n\n${t.body}` : t.body;
  if (tags.length) out.tags = [...card.tags, ...tags];
  if (checks.length)
    out.checks = [
      ...card.checks,
      ...checks.map((text) => ({ id: crypto.randomUUID(), text, done: false })),
    ];
  if (t.priority && !card.priority) out.priority = t.priority;
  if (t.color && !card.color) out.color = t.color;
  if (typeof t.dueIn === "number" && !card.due) out.due = addDays(today, t.dueIn);
  return out;
}

/** Una plantilla a partir de una tarjeta (para «Guardar como plantilla de tarjeta»). */
export function templateFromCard(card: BoardCard, name: string): CardTemplate {
  return {
    slug: slugify(name),
    name: name.trim().slice(0, 80) || "Plantilla",
    title: card.title,
    ...(card.body.trim() && { body: card.body }),
    ...(card.tags.length && { tags: card.tags }),
    ...(card.checks.length && { checks: card.checks.map((c) => c.text) }),
    ...(card.priority && { priority: card.priority }),
    ...(card.color && { color: card.color }),
  };
}
