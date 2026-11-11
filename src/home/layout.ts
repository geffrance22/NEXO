import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import type { HomeBlock, HomeLayout } from '../data';
import type { BlockDef, Choice, OptDef, Opts, Zone } from './types';

/** Lo que trae Mi espacio la primera vez: lo de siempre. El resto se agrega desde «Personalizar». */
export const DEFAULT_LAYOUT: HomeLayout = {
  v: 1,
  main: ['today', 'recent', 'notes'].map((t) => ({ key: t, type: t, on: true, opts: {} })),
  side: ['capture', 'follow', 'pinned', 'reading', 'quote', 'radar', 'circle', 'summary'].map(
    (t) => ({ key: t, type: t, on: true, opts: {} }),
  ),
};

// ───────────────────────── Ajustes comunes a todos los bloques ─────────────────────────

export const whenChoices: Choice[] = [
  { value: 'siempre', label: 'Siempre' },
  { value: 'semana', label: 'Entre semana' },
  { value: 'finde', label: 'Fines de semana' },
  { value: 'manana', label: 'En las mañanas' },
  { value: 'tarde', label: 'En las tardes' },
  { value: 'noche', label: 'En las noches' },
];

/** Cuándo se ve, cuánto ancho ocupa en el centro y si se oculta cuando no tiene nada. */
export function commonOpts(def: BlockDef, zone: Zone): OptDef[] {
  const out: OptDef[] = [];
  if (!def.noTitle)
    out.push({
      key: '_title',
      label: 'Título',
      hint: 'Vacío: el de siempre',
      type: 'text',
      def: '',
      placeholder: def.label,
      max: 60,
    });
  out.push({ key: '_when', label: 'Cuándo se muestra', type: 'select', choices: whenChoices, def: 'siempre' });
  if (zone === 'main')
    out.push({
      key: '_w',
      label: 'Ancho en el centro',
      type: 'select',
      choices: [
        { value: 'full', label: 'Completo' },
        { value: 'half', label: 'Mitad' },
      ],
      def: def.wide ? 'full' : 'half',
    });
  if (def.canHide)
    out.push({
      key: '_hide',
      label: 'Ocultarlo si no hay nada que mostrar',
      type: 'toggle',
      def: def.hideDef ?? false,
    });
  return out;
}

export function defaultsOf(def: BlockDef, zone: Zone): Opts {
  const out: Opts = {};
  for (const o of [...(def.opts ?? []), ...commonOpts(def, zone)]) out[o.key] = o.def;
  return out;
}

/** ¿Toca mostrarlo ahora? (según el día de la semana o la hora). */
export function visibleNow(when: unknown, now = new Date()) {
  const day = now.getDay();
  const h = now.getHours();
  switch (when) {
    case 'semana':
      return day >= 1 && day <= 5;
    case 'finde':
      return day === 0 || day === 6;
    case 'manana':
      return h >= 5 && h < 12;
    case 'tarde':
      return h >= 12 && h < 19;
    case 'noche':
      return h >= 19 || h < 5;
    default:
      return true;
  }
}

// ───────────────────────── Leer lo guardado ─────────────────────────

const isBlock = (b: unknown): b is HomeBlock => {
  const x = b as HomeBlock;
  return Boolean(x && typeof x.key === 'string' && typeof x.type === 'string');
};

/** Lo guardado, sin bloques rotos ni repetidos. null si no sirve. */
export function fixLayout(raw: unknown, known: (type: string) => boolean): HomeLayout | null {
  const r = raw as Partial<HomeLayout> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.main) || !Array.isArray(r.side)) return null;
  const seen = new Set<string>();
  const clean = (arr: unknown[]) =>
    arr.filter(isBlock).flatMap((b) => {
      if (!known(b.type) || seen.has(b.key)) return [];
      seen.add(b.key);
      return [
        {
          key: b.key,
          type: b.type,
          on: b.on !== false,
          opts: b.opts && typeof b.opts === 'object' && !Array.isArray(b.opts) ? b.opts : {},
        },
      ];
    });
  return { v: 1, main: clean(r.main), side: clean(r.side) };
}

// ───────────────────────── Cambios ─────────────────────────

const zoneOf = (l: HomeLayout, key: string): Zone | null =>
  l.main.some((b) => b.key === key) ? 'main' : l.side.some((b) => b.key === key) ? 'side' : null;

export const findBlock = (l: HomeLayout, key: string) =>
  [...l.main, ...l.side].find((b) => b.key === key) ?? null;
export { zoneOf };

const mapZone = (l: HomeLayout, zone: Zone, f: (list: HomeBlock[]) => HomeBlock[]): HomeLayout => ({
  ...l,
  [zone]: f(l[zone]),
});

export function patchBlock(l: HomeLayout, key: string, patch: Partial<HomeBlock>): HomeLayout {
  const z = zoneOf(l, key);
  if (!z) return l;
  return mapZone(l, z, (list) => list.map((b) => (b.key === key ? { ...b, ...patch } : b)));
}
export function setOpt(l: HomeLayout, key: string, k: string, v: unknown): HomeLayout {
  const b = findBlock(l, key);
  return b ? patchBlock(l, key, { opts: { ...b.opts, [k]: v } }) : l;
}
export function removeBlock(l: HomeLayout, key: string): HomeLayout {
  return { ...l, main: l.main.filter((b) => b.key !== key), side: l.side.filter((b) => b.key !== key) };
}
/** Lo pone antes o después de otro bloque (de la misma zona). */
export function placeBlock(l: HomeLayout, key: string, target: string, after: boolean): HomeLayout {
  const z = zoneOf(l, key);
  if (!z || key === target) return l;
  return mapZone(l, z, (list) => {
    const item = list.find((b) => b.key === key)!;
    const rest = list.filter((b) => b.key !== key);
    const at = rest.findIndex((b) => b.key === target);
    if (at < 0) return list;
    rest.splice(after ? at + 1 : at, 0, item);
    return rest;
  });
}
/** Sube o baja un lugar dentro de su zona. */
export function stepBlock(l: HomeLayout, key: string, dir: -1 | 1): HomeLayout {
  const z = zoneOf(l, key);
  if (!z) return l;
  return mapZone(l, z, (list) => {
    const i = list.findIndex((b) => b.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}
/** Lo pasa al centro o al panel (al final). */
export function moveToZone(l: HomeLayout, key: string, zone: Zone): HomeLayout {
  const b = findBlock(l, key);
  if (!b || zoneOf(l, key) === zone) return l;
  const without = removeBlock(l, key);
  return { ...without, [zone]: [...without[zone], b] };
}
export function addBlock(l: HomeLayout, def: BlockDef, zone: Zone, opts: Opts = {}): [HomeLayout, string] {
  const taken = new Set([...l.main, ...l.side].map((b) => b.key));
  let key = def.type;
  for (let i = 2; taken.has(key); i++) key = `${def.type}-${i}`;
  return [{ ...l, [zone]: [...l[zone], { key, type: def.type, on: true, opts }] }, key];
}

// ───────────────────────── Guardar ─────────────────────────

const localKey = (userId: string) => 'nexo-home:' + userId;
function readLocal(userId: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(localKey(userId)) ?? 'null');
  } catch {
    return null;
  }
}

/**
 * El diseño de Mi espacio. Se ve al instante, se guarda en este navegador y, un momento después,
 * en tu ficha (así es igual en todos tus dispositivos).
 */
export function useHomeLayout(known: (type: string) => boolean) {
  const { user, me, meMissing, saveMe } = useApp();
  const [layout, setLayout] = useState<HomeLayout>(
    () => fixLayout(me.profile.home, known) ?? fixLayout(readLocal(user.id), known) ?? DEFAULT_LAYOUT,
  );
  const current = useRef(layout);
  const touched = useRef(false);
  const profile = useRef(me.profile);
  profile.current = me.profile;
  const save = useRef({ saveMe, meMissing });
  save.current = { saveMe, meMissing };
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<HomeLayout | null>(null);

  // Lo guardado en tu ficha llega después de abrir: se usa mientras no hayas cambiado nada aquí.
  const remote = me.profile.home;
  useEffect(() => {
    if (touched.current) return;
    const r = fixLayout(remote, known);
    if (r) {
      current.current = r;
      setLayout(r);
    }
  }, [remote]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (!next || save.current.meMissing) return;
    void save.current.saveMe({ ...profile.current, home: next });
  }, []);
  useEffect(() => flush, [flush]);

  const update = useCallback(
    (f: (l: HomeLayout) => HomeLayout) => {
      const next = f(current.current);
      if (next === current.current) return;
      touched.current = true;
      current.current = next;
      setLayout(next);
      try {
        localStorage.setItem(localKey(user.id), JSON.stringify(next));
      } catch {
        /* Sin almacenamiento local: queda en tu ficha. */
      }
      pending.current = next;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 900);
    },
    [user.id, flush],
  );

  return { layout, update };
}
