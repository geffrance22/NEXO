/**
 * Cuadernos de Agenda: colecciones de accesos directos sobre un lienzo libre. Un elemento apunta a
 * algo que ya existe (un recuerdo, una persona, una lectura…) y guarda dónde está en el lienzo;
 * quitarlo del cuaderno no borra el original. Las fichas de texto viven solo en el cuaderno.
 */
export type NotebookItemType =
  'entry' | 'person' | 'place' | 'episode' | 'reading' | 'note' | 'text';

export type NotebookItem = {
  /** Identificador del elemento dentro del cuaderno (un mismo recuerdo solo entra una vez). */
  key: string;
  type: NotebookItemType;
  /** Id del original. En las fichas de texto, igual a `key`. */
  id: string;
  x: number;
  y: number;
  added_at: string;
  /** Solo en fichas de texto. */
  text?: string;
  /** Color de una ficha de texto. */
  color?: StickyColor;
};

export type Notebook = {
  id: string;
  name: string;
  description: string;
  color: NotebookColor;
  items: NotebookItem[];
  created_at: string;
  updated_at: string;
};

export type NotebookInput = Pick<Notebook, 'name' | 'description' | 'color'>;

export const notebookColors = {
  salvia: {
    accent: '#5f8247',
    soft: '#eaf1e0',
    ink: '#3a5229',
    label: 'Salvia',
  },
  lavanda: {
    accent: '#8a6fa8',
    soft: '#f0e9f6',
    ink: '#553f6e',
    label: 'Lavanda',
  },
  mar: { accent: '#3f7f99', soft: '#e3f0f5', ink: '#24566b', label: 'Mar' },
  arcilla: {
    accent: '#b0703a',
    soft: '#fbf1e6',
    ink: '#7a4a22',
    label: 'Arcilla',
  },
  rosa: { accent: '#b4566e', soft: '#f8e8ec', ink: '#7c3347', label: 'Rosa' },
  grafito: {
    accent: '#4d5560',
    soft: '#eceef1',
    ink: '#2e343b',
    label: 'Grafito',
  },
} as const;
export type NotebookColor = keyof typeof notebookColors;
export const isNotebookColor = (c: unknown): c is NotebookColor =>
  typeof c === 'string' && c in notebookColors;

export const stickyColors = {
  amarillo: { bg: '#fdf5d3', line: '#efe1a1', ink: '#5c4c12' },
  verde: { bg: '#e7f2dc', line: '#cbe0b6', ink: '#33502a' },
  azul: { bg: '#e2eef7', line: '#c2d9ea', ink: '#24486a' },
  rosa: { bg: '#f8e4ea', line: '#ecc6d1', ink: '#6e2c40' },
} as const;
export type StickyColor = keyof typeof stickyColors;

/** Tamaño de una tarjeta en el lienzo (el alto real depende del contenido). */
export const CARD_W = 240;
export const CARD_H = 150;
const GAP = 28;

const TYPES: NotebookItemType[] = [
  'entry',
  'person',
  'place',
  'episode',
  'reading',
  'note',
  'text',
];

/** Lo que llega de la base de datos, validado (un elemento raro se descarta, no rompe el lienzo). */
export function cleanItems(raw: unknown): NotebookItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: NotebookItem[] = [];
  for (const r of raw as Partial<NotebookItem>[]) {
    if (!r || typeof r !== 'object') continue;
    if (!TYPES.includes(r.type as NotebookItemType) || typeof r.id !== 'string') continue;
    const key = typeof r.key === 'string' ? r.key : `${r.type}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      type: r.type as NotebookItemType,
      id: r.id,
      x: Number.isFinite(r.x) ? Number(r.x) : 0,
      y: Number.isFinite(r.y) ? Number(r.y) : 0,
      added_at: typeof r.added_at === 'string' ? r.added_at : new Date().toISOString(),
      ...(r.type === 'text'
        ? {
            text: typeof r.text === 'string' ? r.text.slice(0, 4000) : '',
            color: r.color && r.color in stickyColors ? r.color : 'amarillo',
          }
        : {}),
    });
  }
  return out;
}

/** Clave de un acceso directo: el mismo recuerdo no entra dos veces en un cuaderno. */
export const refKey = (type: NotebookItemType, id: string) => `${type}:${id}`;

export const hasRef = (nb: Notebook, type: NotebookItemType, id: string) =>
  nb.items.some((i) => i.type === type && i.id === id);

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w + GAP / 2 &&
  b.x < a.x + a.w + GAP / 2 &&
  a.y < b.y + b.h + GAP / 2 &&
  b.y < a.y + a.h + GAP / 2;

/**
 * Huecos libres para `n` tarjetas nuevas, lo más cerca posible de `near` (el centro de lo que ves).
 * Sin `near`, a la derecha de lo que ya hay.
 */
export function freeSpots(
  items: NotebookItem[],
  n: number,
  near?: { x: number; y: number },
  heights: Map<string, number> = new Map(),
): { x: number; y: number }[] {
  const taken: Box[] = items.map((i) => ({
    x: i.x,
    y: i.y,
    w: CARD_W,
    h: heights.get(i.key) ?? CARD_H,
  }));
  let origin = near;
  if (!origin) {
    if (!taken.length) origin = { x: 0, y: 0 };
    else {
      const right = Math.max(...taken.map((b) => b.x + b.w));
      const top = Math.min(...taken.map((b) => b.y));
      origin = { x: right + GAP + CARD_W / 2, y: top + CARD_H / 2 };
    }
  }
  const stepX = CARD_W + GAP;
  const stepY = CARD_H + GAP;
  const out: { x: number; y: number }[] = [];
  // Espiral de celdas alrededor del punto de partida.
  for (let ring = 0; out.length < n && ring < 40; ring++) {
    for (let dy = -ring; dy <= ring && out.length < n; dy++) {
      for (let dx = -ring; dx <= ring && out.length < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const box = {
          x: Math.round(origin.x - CARD_W / 2 + dx * stepX),
          y: Math.round(origin.y - CARD_H / 2 + dy * stepY),
          w: CARD_W,
          h: CARD_H,
        };
        if (taken.some((t) => overlaps(t, box))) continue;
        taken.push(box);
        out.push({ x: box.x, y: box.y });
      }
    }
  }
  return out;
}

const ORDER: NotebookItemType[] = [
  'text',
  'person',
  'entry',
  'episode',
  'place',
  'reading',
  'note',
];

/**
 * Ordena el lienzo: columnas al estilo de un muro, agrupando por tipo (y los recuerdos por su
 * clase). `kindOf` da la clase de un recuerdo para que queden juntos.
 */
export function arrange(
  items: NotebookItem[],
  heights: Map<string, number>,
  kindOf: (item: NotebookItem) => string,
): NotebookItem[] {
  const sorted = [...items].sort(
    (a, b) =>
      ORDER.indexOf(a.type) - ORDER.indexOf(b.type) ||
      kindOf(a).localeCompare(kindOf(b)) ||
      a.added_at.localeCompare(b.added_at),
  );
  const cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(sorted.length * 1.4))));
  const tops = Array.from({ length: cols }, () => 0);
  const placed = new Map<string, { x: number; y: number }>();
  // En orden de lectura: cada tarjeta va a la columna menos alta.
  for (const it of sorted) {
    const col = tops.indexOf(Math.min(...tops));
    placed.set(it.key, { x: col * (CARD_W + GAP), y: tops[col] });
    tops[col] += (heights.get(it.key) ?? CARD_H) + GAP;
  }
  return items.map((it) => ({ ...it, ...placed.get(it.key)! }));
}
