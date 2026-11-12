import type {
  GraphBand,
  GraphEdge,
  GraphNode,
  GraphRing,
} from "../components/GraphCanvas";
import type {
  Entry,
  Gender,
  Group,
  Person,
  Place,
  StoredImage,
  Tie,
  TieKind,
} from "../data";
import { genderOf } from "../lib/gender";
import {
  ME,
  generations,
  groupKinds,
  inferTies,
  kindTitle,
  tieCategories,
  tieKinds,
} from "../lib/relations";
import { initials } from "../lib/format";
import {
  closenessLabels,
  closenessOf,
  coOccurrence,
  relationMeta,
  relationOf,
  relations,
} from "../lib/people";
import { placeKinds, placeOf } from "../lib/places";

export type GraphFilter = { people: boolean; places: boolean };

/** Pone tu foto de «Mi ficha» en el nodo «Tú» (si tienes una). */
export const withMyPhoto = (
  nodes: GraphNode[],
  photo?: StoredImage,
): GraphNode[] => {
  const src = photo?.thumb ?? photo?.medium ?? photo?.url;
  return src
    ? nodes.map((n) => (n.id === ME ? { ...n, photo: src } : n))
    : nodes;
};

const photoOf = (p: Person) =>
  p.profile.photo?.thumb ?? p.profile.photo?.medium ?? p.profile.photo?.url;
const personNode = (p: Person, x: number, y: number, r: number): GraphNode => {
  const m = relationMeta[relationOf(p)];
  return {
    id: p.id,
    x,
    y,
    r,
    label: p.name.split(" ").slice(0, 2).join(" "),
    initials: initials(p.name).toUpperCase(),
    fill: m.soft,
    stroke: m.color,
    ink: m.ink,
    photo: photoOf(p),
  };
};
const placeNode = (p: Place, x: number, y: number, r: number): GraphNode => {
  const m = placeKinds[p.kind] ?? placeKinds.otro;
  const img = p.images[0];
  return {
    id: p.id,
    x,
    y,
    r,
    label: p.name,
    initials: "",
    fill: m.soft,
    stroke: m.color,
    ink: m.color,
    shape: "place",
    icon: m.icon,
    photo: img ? (img.thumb ?? img.url) : undefined,
  };
};

const isInteraction = (e: Entry) =>
  e.kind !== "Pendiente" && e.kind !== "Movimiento";

/** Visitas a cada lugar y cuántas veces estuvo cada persona en cada lugar. */
function placeLinks(entries: Entry[], places: Place[]) {
  const visits = new Map<string, number>();
  const pairs = new Map<string, { person: string; place: string; n: number }>();
  for (const e of entries) {
    if (!isInteraction(e)) continue;
    const place = placeOf(e, places);
    if (!place) continue;
    visits.set(place.id, (visits.get(place.id) ?? 0) + 1);
    for (const id of new Set(e.person_ids)) {
      const key = id + "|" + place.id;
      const x = pairs.get(key);
      if (x) x.n++;
      else pairs.set(key, { person: id, place: place.id, n: 1 });
    }
  }
  return { visits, pairs: [...pairs.values()] };
}

/** Tú en el centro; cada persona en la órbita de su cercanía y los lugares en la órbita exterior. */
export function egoGraph(
  people: Person[],
  places: Place[],
  entries: Entry[],
  f: GraphFilter,
) {
  const { counts, pairs } = coOccurrence(entries);
  const shown = f.people ? people.filter((p) => counts.has(p.id)) : [];
  const max = Math.max(1, ...shown.map((p) => counts.get(p.id)!));
  const ringR = (c: number) => 120 + (5 - c) * 95;
  const nodes: GraphNode[] = [
    {
      id: "me",
      x: 0,
      y: 0,
      r: 34,
      label: "Tú",
      initials: "Tú",
      fill: "#303f31",
      stroke: "#303f31",
      ink: "#fff",
      center: true,
    },
  ];
  const edges: GraphEdge[] = [];
  for (let c = 5; c >= 1; c--) {
    const ring = shown
      .filter((p) => closenessOf(p) === c)
      .sort(
        (a, b) =>
          relations.indexOf(relationOf(a)) - relations.indexOf(relationOf(b)) ||
          counts.get(b.id)! - counts.get(a.id)!,
      );
    ring.forEach((p, i) => {
      const angle = (i / ring.length) * Math.PI * 2 + c * 0.7;
      const n = counts.get(p.id)!;
      nodes.push(
        personNode(
          p,
          Math.cos(angle) * ringR(c),
          Math.sin(angle) * ringR(c),
          15 + 13 * Math.sqrt(n / max),
        ),
      );
      edges.push({ a: "me", b: p.id, w: n, tone: "soft" });
    });
  }
  for (const x of pairs) if (f.people) edges.push({ a: x.a, b: x.b, w: x.n });
  const used = [...new Set(shown.map((p) => closenessOf(p)))];
  const rings: GraphRing[] = [5, 4, 3, 2, 1]
    .filter((c) => used.includes(c))
    .map((c) => ({ r: ringR(c), label: closenessLabels[c] }));

  let hiddenPlaces = 0;
  if (f.places) {
    const links = placeLinks(entries, places);
    const list = places.filter((p) => links.visits.has(p.id));
    hiddenPlaces = places.length - list.length;
    const outer = shown.length ? ringR(Math.min(...used)) + 115 : 170;
    const maxV = Math.max(1, ...list.map((p) => links.visits.get(p.id)!));
    list.forEach((p, i) => {
      const angle = (i / list.length) * Math.PI * 2 + 0.35;
      nodes.push(
        placeNode(
          p,
          Math.cos(angle) * outer,
          Math.sin(angle) * outer,
          14 + 10 * Math.sqrt(links.visits.get(p.id)! / maxV),
        ),
      );
      edges.push({
        a: "me",
        b: p.id,
        w: links.visits.get(p.id)!,
        tone: "soft",
      });
    });
    if (f.people)
      for (const x of links.pairs)
        if (counts.has(x.person))
          edges.push({ a: x.person, b: x.place, w: x.n, tone: "place" });
    if (list.length) rings.push({ r: outer, label: "Lugares" });
  }
  return {
    nodes,
    edges,
    rings,
    hidden: f.people ? people.length - shown.length : 0,
    hiddenPlaces,
  };
}

/** Quién aparece con quién (y en qué lugares), acomodado con un modelo de fuerzas. */
export function networkGraph(
  people: Person[],
  places: Place[],
  entries: Entry[],
  f: GraphFilter,
) {
  const { counts, pairs } = coOccurrence(entries);
  const links = f.places
    ? placeLinks(entries, places)
    : { visits: new Map<string, number>(), pairs: [] };
  const items: {
    id: string;
    weight: number;
    node: (x: number, y: number, r: number) => GraphNode;
  }[] = [];
  const edges: GraphEdge[] = [];

  if (f.people) {
    const ids = new Set(pairs.flatMap((x) => [x.a, x.b]));
    if (f.places) for (const x of links.pairs) ids.add(x.person);
    for (const p of people)
      if (ids.has(p.id))
        items.push({
          id: p.id,
          weight: counts.get(p.id) ?? 1,
          node: (x, y, r) => personNode(p, x, y, r),
        });
    for (const x of pairs) edges.push({ a: x.a, b: x.b, w: x.n });
  }
  if (f.places) {
    const byPlace = new Map<string, Set<string>>();
    for (const x of links.pairs) {
      if (!byPlace.has(x.place)) byPlace.set(x.place, new Set());
      byPlace.get(x.place)!.add(x.person);
    }
    const list = places.filter((p) =>
      f.people ? byPlace.has(p.id) : links.visits.has(p.id),
    );
    for (const p of list)
      items.push({
        id: p.id,
        weight: links.visits.get(p.id) ?? 1,
        node: (x, y, r) => placeNode(p, x, y, r),
      });
    if (f.people) {
      for (const x of links.pairs)
        edges.push({ a: x.person, b: x.place, w: x.n, tone: "place" });
    } else {
      // Sin personas: dos lugares se unen si la misma gente estuvo en ambos.
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = byPlace.get(list[i].id) ?? new Set<string>();
          const shared = [...(byPlace.get(list[j].id) ?? [])].filter((id) =>
            a.has(id),
          ).length;
          if (shared)
            edges.push({
              a: list[i].id,
              b: list[j].id,
              w: shared,
              tone: "place",
            });
        }
      }
    }
  }

  const pos = forceLayout(
    items.map((it) => it.id),
    edges,
  );
  const max = Math.max(1, ...items.map((it) => it.weight));
  const nodes = items.map((it, i) =>
    it.node(pos[i].x, pos[i].y, 14 + 14 * Math.sqrt(it.weight / max)),
  );
  return { nodes, edges };
}

// ───────────────────────── Relaciones y árbol familiar ─────────────────────────

export type RelationFilter = {
  ties: boolean;
  groups: boolean;
  inferred: boolean;
};

const meNode = (x = 0, y = 0): GraphNode => ({
  id: ME,
  x,
  y,
  r: 30,
  label: "Tú",
  initials: "Tú",
  fill: "#303f31",
  stroke: "#303f31",
  ink: "#fff",
  center: true,
});
/** Etiqueta de la línea: con el sexo de quien es «a» («madre», «tía»), o la forma corta. */
const shortKind = (k: TieKind, g?: Gender | null) =>
  g ? kindTitle(k, g) : tieKinds[k].label.split(" /")[0].split("/")[0];

function groupNode(g: Group, x: number, y: number, r: number): GraphNode {
  const m = groupKinds[g.kind] ?? groupKinds.otro;
  return {
    id: "g:" + g.id,
    x,
    y,
    r,
    label: g.name,
    initials: "",
    fill: m.soft,
    stroke: m.color,
    ink: m.color,
    shape: "place",
    icon: m.icon,
  };
}

/** Vínculos directos (y deducidos) entre personas, y los grupos que las reúnen. */
export function relationsGraph(
  people: Person[],
  ties: Tie[],
  groups: Group[],
  f: RelationFilter,
  skip?: ReadonlySet<string>,
) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const list: Tie[] = [
    ...(f.ties ? ties : []),
    ...(f.inferred ? inferTies(ties, skip) : []),
  ];
  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const t of list) {
    const a = t.a ?? ME;
    if ((a !== ME && !byId.has(a)) || !byId.has(t.b)) continue;
    const cat = tieCategories[tieKinds[t.kind]?.category ?? "otro"];
    edges.push({
      a,
      b: t.b,
      w: 2,
      color: cat.color,
      dashed: t.inferred,
      label: `${shortKind(t.kind, a === ME ? null : genderOf(byId.get(a)))}${t.inferred ? " (deducido)" : ""}`,
    });
    bump(a);
    bump(t.b);
  }
  const shownGroups = f.groups
    ? groups.filter((g) => g.member_ids.some((m) => byId.has(m)))
    : [];
  for (const g of shownGroups) {
    const m = groupKinds[g.kind] ?? groupKinds.otro;
    for (const id of g.member_ids) {
      if (!byId.has(id)) continue;
      edges.push({
        a: "g:" + g.id,
        b: id,
        w: 1,
        color: m.color,
        tone: "soft",
        label: g.name,
      });
      bump(id);
      bump("g:" + g.id);
    }
  }
  const ids = [...degree.keys()];
  const pos = forceLayout(ids, edges);
  const max = Math.max(1, ...degree.values());
  const nodes = ids.map((id, i) => {
    const { x, y } = pos[i];
    const r = 15 + 12 * Math.sqrt((degree.get(id) ?? 1) / max);
    if (id === ME) return meNode(x, y);
    if (id.startsWith("g:"))
      return groupNode(
        shownGroups.find((g) => "g:" + g.id === id)!,
        x,
        y,
        r + 2,
      );
    return personNode(byId.get(id)!, x, y, r);
  });
  return { nodes, edges };
}

const genLabels: Record<number, string> = {
  [-3]: "Bisabuelos",
  [-2]: "Abuelos",
  [-1]: "Padres y tíos",
  0: "Tu generación",
  1: "Hijos y sobrinos",
  2: "Nietos",
  3: "Bisnietos",
};

/** Árbol genealógico: cada generación en su fila, parejas juntas e hijos bajo sus padres. */
export function familyTree(
  people: Person[],
  ties: Tie[],
  skip?: ReadonlySet<string>,
) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const all = [...ties, ...inferTies(ties, skip)].filter(
    (t) => (t.a === null || byId.has(t.a)) && byId.has(t.b),
  );
  const { gen, comp, family } = generations(all);
  const parentsOf = new Map<string, string[]>();
  const partnerOf = new Map<string, string>();
  for (const t of family) {
    const a = t.a ?? ME;
    if (t.kind === "padre")
      parentsOf.set(t.b, [...(parentsOf.get(t.b) ?? []), a]);
    if (t.kind === "hijo") parentsOf.set(a, [...(parentsOf.get(a) ?? []), t.b]);
    if (t.kind === "pareja") {
      partnerOf.set(a, t.b);
      partnerOf.set(t.b, a);
    }
  }
  const SPACING = 140;
  const ROW = 170;
  const x = new Map<string, number>();
  let offset = 0;
  const comps = [...new Set(comp.values())];
  const meComp = comp.get(ME);
  // El componente con «Tú» va primero; el resto, a la derecha.
  comps.sort((a, b) => (a === meComp ? -1 : b === meComp ? 1 : a - b));
  for (const c of comps) {
    const members = [...comp.entries()]
      .filter(([, cc]) => cc === c)
      .map(([id]) => id);
    const gens = [...new Set(members.map((id) => gen.get(id)!))].sort(
      (a, b) => a - b,
    );
    let width = 0;
    for (const g of gens) {
      const row = members.filter((id) => gen.get(id) === g);
      // Orden: bajo el promedio de sus padres; las parejas, juntas.
      const score = (id: string) => {
        const ps = (parentsOf.get(id) ?? []).filter((p) => x.has(p));
        return ps.length
          ? ps.reduce((s, p) => s + x.get(p)!, 0) / ps.length
          : Infinity;
      };
      row.sort(
        (a, b) =>
          score(a) - score(b) ||
          (a === ME
            ? -1
            : b === ME
              ? 1
              : (byId.get(a)?.name ?? "").localeCompare(
                  byId.get(b)?.name ?? "",
                  "es",
                )),
      );
      const ordered: string[] = [];
      for (const id of row) {
        if (ordered.includes(id)) continue;
        ordered.push(id);
        const partner = partnerOf.get(id);
        if (partner && row.includes(partner) && !ordered.includes(partner))
          ordered.push(partner);
      }
      const centered = ordered
        .map((id) => score(id))
        .filter((s) => s !== Infinity);
      const center = centered.length
        ? centered.reduce((a, b) => a + b, 0) / centered.length
        : offset + ((ordered.length - 1) * SPACING) / 2;
      const start = Math.max(
        offset,
        center - ((ordered.length - 1) * SPACING) / 2,
      );
      ordered.forEach((id, i) => x.set(id, start + i * SPACING));
      width = Math.max(width, start - offset + ordered.length * SPACING);
    }
    offset += width + 160;
  }

  const nodes: GraphNode[] = [...x.keys()].map((id) => {
    const y = gen.get(id)! * ROW;
    if (id === ME) return meNode(x.get(id)!, y);
    return personNode(byId.get(id)!, x.get(id)!, y, 24);
  });
  const fam = tieCategories.familia.color;
  const edges: GraphEdge[] = [];
  for (const t of all) {
    const a = t.a ?? ME;
    if (!x.has(a) || !x.has(t.b)) continue;
    if (t.kind === "padre" || t.kind === "hijo")
      edges.push({
        a,
        b: t.b,
        w: 2,
        color: fam,
        dashed: t.inferred,
        label: t.kind === "padre" ? "Padre / Madre" : "Hijo / Hija",
      });
    else if (t.kind === "pareja")
      edges.push({
        a,
        b: t.b,
        w: 4,
        color: tieCategories.pareja.color,
        label: "Pareja",
      });
    else if (t.kind === "expareja")
      edges.push({
        a,
        b: t.b,
        w: 1,
        color: tieCategories.pareja.color,
        dashed: true,
        label: "Expareja",
      });
    else if (t.kind === "hermano" && !t.inferred)
      edges.push({
        a,
        b: t.b,
        w: 1,
        color: fam,
        dashed: true,
        tone: "soft",
        label: "Hermanos",
      });
  }
  const used = [...new Set(nodes.map((n) => n.y / ROW))].sort((a, b) => a - b);
  const bands: GraphBand[] = used.map((g, i) => ({
    y: g * ROW,
    label:
      meComp !== undefined
        ? (genLabels[g] ?? `Generación ${g > 0 ? "+" : ""}${g}`)
        : `Generación ${i + 1}`,
  }));
  return { nodes, edges, bands };
}

/** Acomoda nodos con un modelo de fuerzas simple (repulsión + resortes en las aristas). */
export function forceLayout(ids: string[], edges: GraphEdge[]) {
  const items = ids;
  const index = new Map(items.map((id, i) => [id, i]));
  const n = items.length;
  const pos = items.map((_, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const r = 60 + 14 * Math.sqrt(n) * (1 + (i % 3) * 0.25);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 };
  });
  const k = 110;
  const springs = edges
    .filter((e) => index.has(e.a) && index.has(e.b))
    .map((e) => ({ s: index.get(e.a)!, t: index.get(e.b)!, w: e.w }));
  for (let it = 0, temp = 40; it < 320; it++, temp *= 0.985) {
    for (const p of pos) {
      p.vx = -p.x * 0.012;
      p.vy = -p.y * 0.012;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x || 0.01;
        const dy = pos[i].y - pos[j].y || 0.01;
        const force = (k * k) / Math.max(dx * dx + dy * dy, 100);
        pos[i].vx += dx * force * 0.02;
        pos[i].vy += dy * force * 0.02;
        pos[j].vx -= dx * force * 0.02;
        pos[j].vy -= dy * force * 0.02;
      }
    }
    for (const l of springs) {
      const a = pos[l.s];
      const b = pos[l.t];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = ((d - k / (1 + Math.log1p(l.w) * 0.6)) / d) * 0.06;
      a.vx += dx * force;
      a.vy += dy * force;
      b.vx -= dx * force;
      b.vy -= dy * force;
    }
    for (const p of pos) {
      const v = Math.hypot(p.vx, p.vy);
      const s = v > temp ? temp / v : 1;
      p.x += p.vx * s;
      p.y += p.vy * s;
    }
  }
  return pos;
}
