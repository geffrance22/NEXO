import { useSyncExternalStore } from 'react';
import type { CapturePlan } from '../lib/capture';

/** Un instante (o una parte del hilo) que Nexo lee en segundo plano. */
export type PieceItem = {
  /** El instante del que sale (vacío si no se pudo guardar como instante). */
  id: string;
  text: string;
  mood: number | null;
  /** AAAA-MM-DD si elegiste cuándo pasó. */
  date: string | null;
  /** Lugares que marcaste al escribir: el encuentro o la visita fueron ahí. */
  places?: { id: string; name: string }[];
};

/**
 * Una búsqueda de piezas: lo que publicaste de una vez. Mientras está «analizando» corre en
 * segundo plano; «listo» espera a que lo revises; «vacio» no encontró nada. Se guarda en este
 * navegador: si cierras y vuelves, sigue ahí (y lo que estaba a medias se vuelve a leer).
 */
export type PieceJob = {
  id: string;
  items: PieceItem[];
  /** Personas desde las que lo escribiste o que elegiste al escribir (van en el encuentro). */
  people: string[];
  /** Episodio elegido al escribir: las piezas se suman a él en vez de crear otro. */
  episodeId: string | null;
  /** Sin instante guardado (falta la tabla): las fichas conservan el texto, como antes. */
  keepText: boolean;
  status: 'analizando' | 'listo' | 'vacio';
  plans: CapturePlan[];
  /** Lo que Nexo propuso al principio (para aprender de lo que corriges). */
  initial: CapturePlan[];
  /** El instante del que salió cada plan (mismo orden que `plans`). */
  planInstants: string[];
  createdAt: string;
  /** Intentos de lectura (si se cierra el navegador a mitad, se reintenta pocas veces). */
  tries: number;
};

type State = { uid: string | null; jobs: PieceJob[]; review: boolean };

const MAX_JOBS = 30;
const MAX_TRIES = 3;
const key = (uid: string) => `nexo-instant-pieces:${uid}`;

let state: State = { uid: null, jobs: [], review: false };
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const pieceJobsState = () => state;

function set(next: Partial<State>, persist = true) {
  state = { ...state, ...next };
  if (persist && state.uid && next.jobs) save();
  subs.forEach((f) => f());
}

function save() {
  if (!state.uid) return;
  try {
    const keep = state.jobs.filter((j) => j.status !== 'vacio');
    if (keep.length) localStorage.setItem(key(state.uid), JSON.stringify(keep));
    else localStorage.removeItem(key(state.uid));
  } catch {
    /* Sin espacio o sin almacenamiento: sigue en memoria mientras la pestaña esté abierta. */
  }
}

function read(uid: string): PieceJob[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(uid)) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (j): j is PieceJob =>
          j && typeof j.id === 'string' && Array.isArray(j.items) && Array.isArray(j.plans),
      )
      .map((j) => ({
        ...j,
        people: Array.isArray(j.people) ? j.people : [],
        initial: Array.isArray(j.initial) ? j.initial : [],
        planInstants: Array.isArray(j.planInstants) ? j.planInstants : [],
        tries: Number(j.tries) || 0,
      }))
      // Lo que quedó a medias demasiadas veces se descarta (algo en ese texto lo rompe).
      .filter((j) => j.status === 'listo' || (j.status === 'analizando' && j.tries < MAX_TRIES));
  } catch {
    return [];
  }
}

/** Carga la cola de esta cuenta (al iniciar sesión o cambiar de cuenta). */
export function bindPieceJobs(uid: string) {
  if (state.uid === uid) return;
  set({ uid, jobs: read(uid), review: false }, false);
}

/** Suma una búsqueda de piezas a la cola (lo anterior que esperaba revisión se conserva). */
export function enqueuePieces(
  job: Pick<PieceJob, 'items' | 'people' | 'episodeId' | 'keepText'>,
): PieceJob | null {
  const items = job.items.filter((i) => /\p{L}{2}/u.test(i.text));
  if (!items.length) return null;
  const made: PieceJob = {
    ...job,
    items,
    id: crypto.randomUUID(),
    status: 'analizando',
    plans: [],
    initial: [],
    planInstants: [],
    createdAt: new Date().toISOString(),
    tries: 0,
  };
  set({ jobs: [...state.jobs, made].slice(-MAX_JOBS) });
  return made;
}

export function updateJob(id: string, patch: Partial<PieceJob>) {
  if (!state.jobs.some((j) => j.id === id)) return;
  set({ jobs: state.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) });
}

export function removeJobs(ids: string[]) {
  const drop = new Set(ids);
  if (!state.jobs.some((j) => drop.has(j.id))) return;
  set({ jobs: state.jobs.filter((j) => !drop.has(j.id)) });
}

/** Abre (o cierra) la revisión de las piezas encontradas. */
export function setPiecesReview(review: boolean) {
  if (review === state.review) return;
  set({ review }, false);
}

export function usePieceJobs() {
  return useSyncExternalStore(subscribe, () => state);
}

/** Piezas encendidas (y personas nuevas) de un plan: lo que «cuenta» para el contador. */
export const planCount = (p: CapturePlan) =>
  p.off ? 0 : p.pieces.filter((x) => x.on).length + p.newPeople.filter((n) => n.on).length;

export const jobCount = (j: PieceJob) =>
  j.status === 'listo' ? j.plans.reduce((s, p) => s + planCount(p), 0) : 0;
