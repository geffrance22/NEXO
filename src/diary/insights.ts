import { moodOf, moodTone } from "../composer/moods";
import { feelingsOf } from "../composer/MoodTrio";
import type { Entry, Person, Place } from "../data";
import { addDays, normalizeText } from "../lib/format";
import {
  dayPartLabel,
  dayPartOf,
  exercisedOf,
  lightLabel,
  lightOf,
  skyKind,
  skyLabel,
  sleepOf,
} from "./context";
import { dayOf, weekdayIndex, type DayStat } from "./model";

/*
 * Lo que tu diario nota: cruza el ánimo de cada entrada con quién estaba, dónde, qué día, a qué
 * hora, con qué luz y clima, cómo dormiste y si te moviste. Todo se calcula aquí, en tu
 * navegador, con tus propias entradas. Los promedios se «encogen» hacia tu media cuando hay
 * pocas entradas, para no sacar conclusiones de un solo día.
 */

export type Dim =
  | "persona"
  | "lugar"
  | "dia"
  | "momento"
  | "luz"
  | "clima"
  | "sueno"
  | "ejercicio"
  | "compania"
  | "etiqueta"
  | "causa";

export const dimLabel: Record<Dim, string> = {
  persona: "Personas",
  lugar: "Lugares",
  dia: "Días de la semana",
  momento: "Hora del día",
  luz: "Luz",
  clima: "Clima",
  sueno: "Sueño",
  ejercicio: "Ejercicio",
  compania: "Compañía",
  etiqueta: "Etiquetas",
  causa: "Causas que anotas",
};

export const toneNames = ["", "Difícil", "Tenso", "Normal", "Bien", "Genial"];

export type Factor = {
  dim: Dim;
  key: string;
  label: string;
  /** Entradas con ánimo en las que aparece. */
  n: number;
  /** Promedio real (1–5). */
  mean: number;
  /** Promedio ajustado a tu media según cuántas entradas hay. */
  fair: number;
  /** fair − tu media. */
  delta: number;
  /** El ánimo que más se repite. */
  mood: number | null;
  /** Persona o lugar de Nexo, si lo es. */
  personId?: string;
  placeId?: string;
};

export type Insight = {
  id: string;
  dim: Dim | "tendencia";
  /** «up» si habla de algo que te sube el ánimo; «down» si lo baja. */
  dir: "up" | "down" | "flat";
  text: string;
  /** La evidencia: cuántas entradas y qué promedios. */
  proof: string;
  weight: number;
  personId?: string;
};

export type Reason = {
  dim: Dim;
  key: string;
  label: string;
  /** En cuántos de esos días aparece y qué porcentaje es. */
  hits: number;
  share: number;
  /** El porcentaje en el resto de días. */
  rest: number;
  lift: number;
};

export type Analysis = {
  /** Entradas con ánimo marcado. */
  n: number;
  baseline: number;
  dims: Record<Dim, Factor[]>;
  insights: Insight[];
  low: { n: number; reasons: Reason[] };
  high: { n: number; reasons: Reason[] };
  trend: { recent: number; before: number; nRecent: number } | null;
  /** Cuántas entradas tienen contexto (hora, clima) y cuántas sueño o ejercicio. */
  coverage: { ctx: number; weather: number; body: number };
};

/** El tono (1–5) de una entrada: el promedio de sus hasta tres ánimos. */
export function toneOfEntry(e: Entry): number | null {
  const tones = feelingsOf(e.details)
    .map((f) => moodTone(f.mood))
    .filter((t): t is number => t !== null);
  return tones.length ? tones.reduce((a, b) => a + b, 0) / tones.length : null;
}

const WEEKDAYS = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
];
const SLEEP_LABEL = {
  poco: "Dormir poco",
  regular: "Dormir regular",
  bien: "Dormir bien",
};

type Feature = {
  dim: Dim;
  key: string;
  label: string;
  personId?: string;
  placeId?: string;
};

function featuresOf(
  e: Entry,
  people: Map<string, Person>,
  places: Map<string, Place>,
) {
  const out: Feature[] = [];
  for (const id of e.person_ids) {
    const p = people.get(id);
    if (p) out.push({ dim: "persona", key: id, label: p.name, personId: id });
  }
  // Solo el lugar vinculado; «desde dónde escribiste» (`where`) no es un lugar.
  const linked = e.details.placeId;
  const place = linked && (places.get(linked)?.name ?? e.details.place);
  if (linked && place?.trim())
    out.push({
      dim: "lugar",
      key: linked,
      label: place.trim(),
      placeId: linked,
    });
  const wd = weekdayIndex(dayOf(e));
  out.push({ dim: "dia", key: String(wd), label: WEEKDAYS[wd] });
  const part = dayPartOf(e);
  if (part) out.push({ dim: "momento", key: part, label: dayPartLabel[part] });
  const light = lightOf(e);
  if (light) out.push({ dim: "luz", key: light, label: lightLabel[light] });
  const sky = skyKind(e.details.ctx?.weather);
  if (sky) out.push({ dim: "clima", key: sky, label: skyLabel[sky] });
  const sleep = sleepOf(e);
  if (sleep) out.push({ dim: "sueno", key: sleep, label: SLEEP_LABEL[sleep] });
  const moved = exercisedOf(e);
  out.push({
    dim: "ejercicio",
    key: moved ? "si" : "no",
    label: moved ? "Con ejercicio" : "Sin ejercicio",
  });
  out.push({
    dim: "compania",
    key: e.person_ids.length ? "con" : "solo",
    label: e.person_ids.length ? "Con alguien" : "Sin nadie en la entrada",
  });
  for (const t of e.tags)
    out.push({ dim: "etiqueta", key: normalizeText(t), label: "#" + t });
  for (const f of feelingsOf(e.details))
    if (f.why?.trim())
      out.push({
        dim: "causa",
        key: normalizeText(f.why.trim()),
        label: f.why.trim(),
      });
  // Un mismo rasgo cuenta una vez por entrada.
  const seen = new Set<string>();
  return out.filter((f) => {
    const id = f.dim + "|" + f.key;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Cuánto pesa tu media frente a pocas entradas (como si hubiera K entradas «normales»). */
const K = 2;
const num = (n: number) =>
  n.toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
const pct = (x: number) => `${Math.round(x * 100)} %`;
const entradas = (n: number) => `${n} ${n === 1 ? "entrada" : "entradas"}`;
const first = (name: string) => name.split(" ")[0];

export function analyze(
  entries: Entry[],
  people: Person[],
  places: Place[],
  today: string,
): Analysis {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const placesById = new Map(places.map((p) => [p.id, p]));
  const rows = entries
    .map((e) => ({ e, tone: toneOfEntry(e) }))
    .filter((r): r is { e: Entry; tone: number } => r.tone !== null)
    .map((r) => ({ ...r, f: featuresOf(r.e, peopleById, placesById) }));
  const n = rows.length;
  const baseline = n ? rows.reduce((s, r) => s + r.tone, 0) / n : 3;

  // Promedio por rasgo.
  const acc = new Map<
    string,
    Feature & { sum: number; n: number; moods: Map<number, number> }
  >();
  for (const r of rows)
    for (const f of r.f) {
      const id = f.dim + "|" + f.key;
      let a = acc.get(id);
      if (!a) acc.set(id, (a = { ...f, sum: 0, n: 0, moods: new Map() }));
      a.sum += r.tone;
      a.n++;
      for (const fe of feelingsOf(r.e.details))
        a.moods.set(fe.mood, (a.moods.get(fe.mood) ?? 0) + 1);
    }
  const dims = Object.fromEntries(
    (Object.keys(dimLabel) as Dim[]).map((d) => [d, [] as Factor[]]),
  ) as Record<Dim, Factor[]>;
  for (const a of acc.values()) {
    const fair = (a.sum + K * baseline) / (a.n + K);
    let mood: number | null = null;
    let best = 0;
    for (const [m, c] of a.moods) if (c > best) [mood, best] = [m, c];
    dims[a.dim].push({
      dim: a.dim,
      key: a.key,
      label: a.label,
      n: a.n,
      mean: a.sum / a.n,
      fair,
      delta: fair - baseline,
      mood,
      personId: a.personId,
      placeId: a.placeId,
    });
  }
  for (const d of Object.keys(dims) as Dim[])
    dims[d].sort((a, b) =>
      d === "dia"
        ? Number(a.key) - Number(b.key)
        : b.n - a.n || b.delta - a.delta,
    );

  const insights = n >= 4 ? buildInsights(dims, baseline, rows) : [];

  // Tendencia: las dos últimas semanas frente a las dos anteriores.
  const since = addDays(today, -13);
  const before = addDays(today, -27);
  const recent = rows.filter((r) => dayOf(r.e) >= since);
  const prev = rows.filter((r) => dayOf(r.e) >= before && dayOf(r.e) < since);
  const avg = (list: { tone: number }[]) =>
    list.reduce((s, r) => s + r.tone, 0) / list.length;
  const trend =
    recent.length >= 3 && prev.length >= 3
      ? { recent: avg(recent), before: avg(prev), nRecent: recent.length }
      : null;
  if (trend && Math.abs(trend.recent - trend.before) >= 0.5)
    insights.unshift({
      id: "tendencia",
      dim: "tendencia",
      dir: trend.recent > trend.before ? "up" : "down",
      text:
        trend.recent > trend.before
          ? "Tus últimas dos semanas van mejor que las dos anteriores."
          : "Tus últimas dos semanas han sido más pesadas que las anteriores.",
      proof: `${num(trend.recent)} frente a ${num(trend.before)} · ${entradas(recent.length)} recientes`,
      weight: 99,
    });

  return {
    n,
    baseline,
    dims,
    insights,
    low: reasonsFor(rows, (t) => t <= 2.4),
    high: reasonsFor(rows, (t) => t >= 4),
    trend,
    coverage: {
      ctx: entries.filter((e) => e.details.ctx).length,
      weather: entries.filter((e) => typeof e.details.ctx?.weather === "number")
        .length,
      body: entries.filter(
        (e) => e.details.sleep || typeof e.details.exercise === "boolean",
      ).length,
    },
  };
}

/** Un rasgo «dice algo» si hay al menos 3 entradas y se separa de tu media de verdad. */
const telling = (f: Factor, min = 3) =>
  f.n >= min &&
  Math.abs(f.mean - (f.fair - f.delta)) >= 0.4 &&
  Math.abs(f.delta) >= 0.25;

function buildInsights(
  dims: Record<Dim, Factor[]>,
  b: number,
  rows: { e: Entry; tone: number }[],
): Insight[] {
  const out: Insight[] = [];
  const w = (f: Factor) => Math.abs(f.delta) * Math.sqrt(f.n);
  const proof = (f: Factor) =>
    `${num(f.mean)} frente a tu media de ${num(b)} · ${entradas(f.n)}` +
    (f.mood
      ? ` · lo que más sientes: ${moodOf(f.mood)?.label.toLowerCase()}`
      : "");

  for (const f of dims.persona.filter((f) => telling(f)).slice(0, 6)) {
    const name = first(f.label);
    out.push({
      id: "p" + f.key,
      dim: "persona",
      dir: f.delta > 0 ? "up" : "down",
      personId: f.personId,
      text:
        f.delta > 0
          ? `Los días con ${name} sueles estar mejor: tu ánimo sube.`
          : `Cuando ${name} aparece en tu diario, tu ánimo tiende a bajar. Puede que algo de ese vínculo te esté pesando.`,
      proof: proof(f),
      weight: w(f) * 1.2,
    });
  }
  for (const f of dims.lugar.filter((f) => telling(f)).slice(0, 4))
    out.push({
      id: "l" + f.key,
      dim: "lugar",
      dir: f.delta > 0 ? "up" : "down",
      text:
        f.delta > 0
          ? `En ${f.label} te sientes mejor que en otros sitios.`
          : `Lo que escribes desde ${f.label} suele ser más pesado.`,
      proof: proof(f),
      weight: w(f),
    });

  const days = dims.dia.filter((f) => f.n >= 2);
  if (days.length >= 3) {
    const sorted = [...days].sort((a, b2) => b2.fair - a.fair);
    const top = sorted[0];
    const low = sorted[sorted.length - 1];
    if (top.fair - low.fair >= 0.45)
      out.push({
        id: "dias",
        dim: "dia",
        dir: "flat",
        text: `Los ${plural(top.label)} son tus mejores días; los ${plural(low.label)}, los más cuesta arriba.`,
        proof: `${num(top.mean)} los ${plural(top.label)} · ${num(low.mean)} los ${plural(low.label)}`,
        weight: (top.fair - low.fair) * Math.sqrt(Math.min(top.n, low.n)) * 1.1,
      });
  }

  const pair = (
    dim: Dim,
    good: string,
    bad: string,
    text: (g: Factor, l: Factor) => string,
    single: (f: Factor) => string,
  ) => {
    const g = dims[dim].find((f) => f.key === good);
    const l = dims[dim].find((f) => f.key === bad);
    if (g && l && g.n >= 2 && l.n >= 2 && Math.abs(g.fair - l.fair) >= 0.4) {
      out.push({
        id: dim,
        dim,
        dir: g.fair > l.fair ? "up" : "down",
        text: text(g, l),
        proof: `${num(g.mean)} (${entradas(g.n)}) frente a ${num(l.mean)} (${entradas(l.n)})`,
        weight: Math.abs(g.fair - l.fair) * Math.sqrt(Math.min(g.n, l.n)) * 1.3,
      });
      return;
    }
    const one = [g, l].find((f) => f && telling(f));
    if (one)
      out.push({
        id: dim,
        dim,
        dir: one.delta > 0 ? "up" : "down",
        text: single(one),
        proof: proof(one),
        weight: w(one),
      });
  };
  pair(
    "sueno",
    "bien",
    "poco",
    (g, l) =>
      g.fair > l.fair
        ? `Dormir bien te cambia el día: tu ánimo pasa de ${num(l.mean)} a ${num(g.mean)}.`
        : "Curioso: tus días tras dormir poco no son peores que los demás.",
    (f) =>
      f.key === "poco"
        ? f.delta < 0
          ? "Los días después de dormir poco, tu ánimo baja."
          : "Aunque duermas poco, tu ánimo aguanta."
        : f.delta > 0
          ? "Cuando duermes bien, tu ánimo sube."
          : "Dormir bien no parece cambiar mucho tu ánimo.",
  );
  pair(
    "ejercicio",
    "si",
    "no",
    (g, l) =>
      g.fair > l.fair
        ? `Moverte te sienta bien: los días con ejercicio tu ánimo es ${num(g.mean)}; sin él, ${num(l.mean)}.`
        : "Los días con ejercicio no salen mejores en tu diario; quizá llegan en días de por sí cansados.",
    (f) =>
      f.delta > 0
        ? "Los días que te mueves tu ánimo sube."
        : "Los días sin moverte tu ánimo baja.",
  );
  pair(
    "luz",
    "dia",
    "noche",
    (g, l) =>
      g.fair > l.fair
        ? "Lo que escribes de día es más luminoso que lo que escribes de noche."
        : "De noche escribes con más calma que de día.",
    (f) =>
      f.delta > 0
        ? `${f.label} escribes con mejor ánimo.`
        : `${f.label} lo que escribes pesa más.`,
  );
  for (const f of dims.momento.filter((f) => telling(f, 3)).slice(0, 1))
    if (!out.some((i) => i.dim === "luz"))
      out.push({
        id: "m" + f.key,
        dim: "momento",
        dir: f.delta > 0 ? "up" : "down",
        text:
          f.delta > 0
            ? `${f.label} escribes con mejor ánimo.`
            : `${f.label} tus entradas suelen ser más pesadas.`,
        proof: proof(f),
        weight: w(f),
      });
  for (const f of dims.clima.filter((f) => telling(f, 3)).slice(0, 2))
    out.push({
      id: "c" + f.key,
      dim: "clima",
      dir: f.delta > 0 ? "up" : "down",
      text:
        f.key === "despejado"
          ? f.delta > 0
            ? "Con cielo despejado tu ánimo sube."
            : "Ni el sol te levanta el ánimo: los días despejados no salen mejores."
          : f.delta < 0
            ? `Los días de ${f.label.toLowerCase()} tu ánimo baja.`
            : `Los días de ${f.label.toLowerCase()} te sientan bien.`,
      proof: proof(f),
      weight: w(f) * 0.9,
    });
  pair(
    "compania",
    "con",
    "solo",
    (g, l) =>
      g.fair > l.fair
        ? "Cuando hay gente en tu día, tu ánimo sube."
        : "Tus días a solas salen mejor que los días con gente: te sienta tener tu espacio.",
    () => "",
  );
  for (let i = out.length - 1; i >= 0; i--) if (!out[i].text) out.splice(i, 1);
  for (const f of dims.etiqueta.filter((f) => telling(f)).slice(0, 3))
    out.push({
      id: "t" + f.key,
      dim: "etiqueta",
      dir: f.delta > 0 ? "up" : "down",
      text:
        f.delta > 0
          ? `Lo que etiquetas ${f.label} suele llegar con buen ánimo.`
          : `Lo que etiquetas ${f.label} suele llegar con el ánimo bajo.`,
      proof: proof(f),
      weight: w(f) * 0.8,
    });

  // La causa que más anotas cuando estás mal.
  const lowWhy = new Map<string, { label: string; n: number }>();
  let lowTotal = 0;
  for (const r of rows)
    for (const f of feelingsOf(r.e.details)) {
      if ((moodTone(f.mood) ?? 3) > 2) continue;
      lowTotal++;
      if (!f.why?.trim()) continue;
      const k = normalizeText(f.why.trim());
      const hit = lowWhy.get(k) ?? { label: f.why.trim(), n: 0 };
      hit.n++;
      lowWhy.set(k, hit);
    }
  const topWhy = [...lowWhy.values()].sort((a, b2) => b2.n - a.n)[0];
  if (topWhy && topWhy.n >= 2)
    out.push({
      id: "why",
      dim: "causa",
      dir: "down",
      text: `Cuando te sientes mal, la causa que más anotas es «${topWhy.label}».`,
      proof: `${topWhy.n} de ${lowTotal} ánimos difíciles`,
      weight: topWhy.n * 0.8,
    });

  return out.sort((a, b2) => b2.weight - a.weight);
}

/** «lunes» → «lunes», «sábado» → «sábados». */
const plural = (day: string) => (day.endsWith("s") ? day : day + "s");

/**
 * Qué aparece mucho más en un tipo de día (difíciles o buenos) que en el resto: son las posibles
 * razones. No prueban nada, pero apuntan hacia dónde mirar.
 */
function reasonsFor(
  rows: { e: Entry; tone: number; f: Feature[] }[],
  test: (tone: number) => boolean,
) {
  const inside = rows.filter((r) => test(r.tone));
  const outside = rows.filter((r) => !test(r.tone));
  if (inside.length < 2 || outside.length < 2)
    return { n: inside.length, reasons: [] };
  const count = (list: typeof rows) => {
    const m = new Map<string, { f: Feature; n: number }>();
    for (const r of list)
      for (const f of r.f) {
        const id = f.dim + "|" + f.key;
        const hit = m.get(id) ?? { f, n: 0 };
        hit.n++;
        m.set(id, hit);
      }
    return m;
  };
  const a = count(inside);
  const b = count(outside);
  const reasons: Reason[] = [];
  for (const [id, { f, n }] of a) {
    if (n < 2) continue;
    const share = n / inside.length;
    const rest = (b.get(id)?.n ?? 0) / outside.length;
    const lift = share / Math.max(rest, 0.5 / outside.length);
    if (lift < 1.5 || share - rest < 0.15) continue;
    if (f.dim === "ejercicio" && f.key === "no" && share < 0.8) continue;
    // La compañía y el día de la semana casi siempre están: solo cuentan si destacan mucho.
    if ((f.dim === "compania" || f.dim === "dia") && lift < 2) continue;
    reasons.push({
      dim: f.dim,
      key: f.key,
      label: reasonLabel(f),
      hits: n,
      share,
      rest,
      lift,
    });
  }
  reasons.sort(
    (x, y) => y.lift * Math.sqrt(y.hits) - x.lift * Math.sqrt(x.hits),
  );
  return { n: inside.length, reasons: reasons.slice(0, 6) };
}

function reasonLabel(f: Feature) {
  switch (f.dim) {
    case "persona":
      return `Estar con ${first(f.label)}`;
    case "lugar":
      return `Estar en ${f.label}`;
    case "dia":
      return `Ser ${f.label}`;
    case "clima":
      return f.key === "despejado"
        ? "Cielo despejado"
        : `Días de ${f.label.toLowerCase()}`;
    case "causa":
      return `«${f.label}»`;
    default:
      return f.label;
  }
}

export const reasonProof = (r: Reason, n: number, kind: string) =>
  `${r.hits} de tus ${n} días ${kind} (${pct(r.share)}, frente a ${pct(r.rest)} en el resto)`;

export const fmt = num;

/* ───────── Alerta cuidadosa ───────── */

export type CareSignal = {
  kind: "racha" | "palabras";
  /** Cuántos días seguidos (de los que escribiste) con el ánimo bajo. */
  days: number;
  /** El primer día de la racha. */
  since: string;
};

const HEAVY_WORDS =
  /\b(suicid|quitarme la vida|no quiero vivir|no quiero seguir|hacerme dano|desaparecer para siempre|mejor sin mi|no aguanto mas|quiero morir|me quiero morir)/;

/**
 * Una nota amable cuando encadenas varios días con el ánimo bajo (tres o más de los que
 * escribiste en las últimas dos semanas, sin uno bueno en medio) o cuando lo que escribes hace
 * poco suena muy pesado. Nunca es un diagnóstico.
 */
export function careSignal(
  days: Map<string, DayStat>,
  entries: Entry[],
  today: string,
): CareSignal | null {
  const week = addDays(today, -6);
  const heavy = entries.find(
    (e) =>
      dayOf(e) >= week &&
      HEAVY_WORDS.test(normalizeText(`${e.title} ${e.body}`)),
  );
  if (heavy) return { kind: "palabras", days: 0, since: dayOf(heavy) };
  const from = addDays(today, -13);
  const toned = [...days.values()]
    .filter((d) => d.date >= from && d.date <= today && d.tone !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!toned.length || toned[0].date < addDays(today, -3)) return null;
  let run = 0;
  for (const d of toned) {
    const tone = d.entries
      .map(toneOfEntry)
      .filter((t): t is number => t !== null);
    const avg = tone.reduce((s, t) => s + t, 0) / tone.length;
    if (avg > 2.4) break;
    run++;
  }
  return run >= 3
    ? { kind: "racha", days: run, since: toned[run - 1].date }
    : null;
}
