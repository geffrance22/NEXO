import { useSyncExternalStore } from "react";
import type { EntryDetails, StoredImage } from "../data";

/**
 * Borrador de una entrada del diario. Vive solo en este navegador (localStorage) y no cuenta
 * para nada: no se vincula a personas, no suma a rachas ni a resúmenes. Al publicarlo se guarda
 * como una entrada normal y se borra de aquí.
 */
export type DiaryDraft = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  /** Personas que elegiste: se vinculan solo al publicar. */
  personIds: string[];
  /** AAAA-MM-DD */
  date: string;
  details: EntryDetails;
  images: StoredImage[];
  /** ISO: última vez que cambió. */
  updated_at: string;
};

const MAX_DRAFTS = 30;
const keyOf = (uid: string) => `nexo:diary-drafts:${uid}`;
const EMPTY: DiaryDraft[] = [];

const cache = new Map<string, DiaryDraft[]>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(uid: string): DiaryDraft[] {
  const hit = cache.get(uid);
  if (hit) return hit;
  let list: DiaryDraft[] = EMPTY;
  try {
    const raw = localStorage.getItem(keyOf(uid));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed))
      list = parsed.filter(
        (d): d is DiaryDraft =>
          !!d && typeof d.id === "string" && typeof d.body === "string",
      );
  } catch {
    /* Sin almacenamiento o dato dañado: sin borradores. */
  }
  cache.set(uid, list);
  return list;
}

function write(uid: string, list: DiaryDraft[]) {
  const next = list
    .slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, MAX_DRAFTS);
  cache.set(uid, next);
  try {
    localStorage.setItem(keyOf(uid), JSON.stringify(next));
  } catch {
    /* Sin almacenamiento: queda en memoria mientras la pestaña siga abierta. */
  }
  emit();
}

// Otra pestaña cambió los borradores: se vuelven a leer.
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (!e.key?.startsWith("nexo:diary-drafts:")) return;
    cache.delete(e.key.slice("nexo:diary-drafts:".length));
    emit();
  });

export const readDrafts = read;

/** Guarda (o reemplaza) un borrador. */
export function saveDraft(uid: string, draft: DiaryDraft) {
  write(uid, [draft, ...read(uid).filter((d) => d.id !== draft.id)]);
}

export function removeDraft(uid: string, id: string) {
  const list = read(uid);
  if (list.some((d) => d.id === id))
    write(
      uid,
      list.filter((d) => d.id !== id),
    );
}

/** Los borradores del usuario, del más reciente al más antiguo. */
export function useDrafts(uid: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => read(uid),
    () => EMPTY,
  );
}

/** ¿Hay algo que valga la pena guardar como borrador? */
export const draftHasContent = (d: Pick<DiaryDraft, "title" | "body" | "images">) =>
  Boolean(d.title.trim() || d.body.trim() || d.images.length);
