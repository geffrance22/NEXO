import { useCallback, useState } from 'react';
import { useApp } from '../AppContext';
import type { DiaryFolder, Entry } from '../data';

/** Colores para las carpetas propias (el primero es el del diario). */
export const FOLDER_COLORS = [
  '#b4823a',
  '#c2674a',
  '#b0577d',
  '#7a62b8',
  '#4a74b8',
  '#3f8f8a',
  '#5f8f45',
  '#6f6a60',
];

/** Dónde estás mirando: el diario entero, una carpeta propia o una de las del sistema. */
export type FolderView = 'todas' | 'drafts' | 'archive' | 'vault' | `f:${string}`;

/** Adónde puede ir una entrada. */
export type FolderTarget = 'todas' | 'archive' | 'vault' | `f:${string}`;

const MAX_NAME = 40;
const localKey = (uid: string) => `nexo:diary-folders:${uid}`;

function readLocal(uid: string): DiaryFolder[] {
  try {
    const raw = JSON.parse(localStorage.getItem(localKey(uid)) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isFolder) : [];
  } catch {
    return [];
  }
}

const isFolder = (x: unknown): x is DiaryFolder =>
  Boolean(x) &&
  typeof (x as DiaryFolder).id === 'string' &&
  typeof (x as DiaryFolder).name === 'string';

export const cleanFolderName = (name: string) =>
  name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

/** La carpeta propia de una entrada (si aún existe). */
export const folderOf = (e: Entry, folders: DiaryFolder[]) =>
  e.details.folder ? folders.find((f) => f.id === e.details.folder) : undefined;

/**
 * Las carpetas propias del diario. Se guardan en «Mi ficha» (así se ven en todos tus
 * dispositivos); si esa tabla aún no existe, en este navegador.
 */
export function useDiaryFolders() {
  const { user, me, meMissing, saveMe } = useApp();
  const [local, setLocal] = useState(() => readLocal(user.id));
  const folders = (meMissing ? local : me.profile.diaryFolders?.filter(isFolder)) ?? [];

  const save = useCallback(
    async (next: DiaryFolder[]) => {
      if (meMissing) {
        setLocal(next);
        try {
          localStorage.setItem(localKey(user.id), JSON.stringify(next));
        } catch {
          /* Sin almacenamiento: dura mientras sigas aquí. */
        }
        return true;
      }
      return saveMe({ ...me.profile, diaryFolders: next });
    },
    [meMissing, me.profile, saveMe, user.id],
  );

  const create = async (name: string, color: string) => {
    const clean = cleanFolderName(name);
    if (!clean) return null;
    const folder: DiaryFolder = { id: crypto.randomUUID(), name: clean, color };
    return (await save([...folders, folder])) ? folder : null;
  };
  const update = (id: string, changes: Partial<Omit<DiaryFolder, 'id'>>) =>
    save(
      folders.map((f) =>
        f.id === id
          ? {
              ...f,
              ...changes,
              name: cleanFolderName(changes.name ?? f.name) || f.name,
            }
          : f,
      ),
    );
  const remove = (id: string) => save(folders.filter((f) => f.id !== id));
  /** Nuevo orden de las carpetas (los ids en el orden en que deben quedar). */
  const reorder = (ids: string[]) => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const next = ids.map((id) => byId.get(id)).filter((f): f is DiaryFolder => Boolean(f));
    // Las que no venían en la lista (creadas en otro dispositivo mientras tanto) van al final.
    for (const f of folders) if (!ids.includes(f.id)) next.push(f);
    if (next.every((f, i) => f.id === folders[i]?.id)) return Promise.resolve(true);
    return save(next);
  };

  return { folders, create, update, remove, reorder };
}
