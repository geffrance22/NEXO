import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, EntryDetails, EntryInput, EntryPatch, StoredImage } from '../data';
import { todayInputValue } from '../lib/format';
import {
  DIARY_VAULT_CHANGED,
  resetVault,
  seal,
  touchVault,
  unseal,
  useVault,
  type VaultStatus,
} from '../notes/vault';

/**
 * Bóveda del diario. Usa la misma clave que la bóveda de Notas (un solo PIN): el contenido de la
 * entrada (título, texto, etiquetas, personas, fotos y detalles) se cifra en el navegador y se
 * guarda en `details.vault`. En la base solo quedan en claro el tipo y la fecha.
 */

/** ¿La entrada está en la bóveda? (cifrada o ya descifrada: ambas llevan `details.vault`). */
export const isVaulted = (e: Entry) =>
  typeof e.details.vault === 'string' && e.details.vault !== '';

/** Lo que va cifrado de cada entrada. */
type Content = {
  title: string;
  body: string;
  tags: string[];
  person_ids: string[];
  images: StoredImage[];
  details: EntryDetails;
};

/** Los detalles sin lo que dice dónde está guardada la entrada. */
function bare(details: EntryDetails | undefined): EntryDetails {
  const { vault: _v, folder: _f, archived: _a, ...rest } = details ?? {};
  return rest;
}

const contentOf = (e: Partial<Content>): Content => ({
  title: e.title ?? '',
  body: e.body ?? '',
  tags: e.tags ?? [],
  person_ids: e.person_ids ?? [],
  images: e.images ?? [],
  details: bare(e.details),
});

/**
 * Título en claro de una entrada sellada. Este no revela nada y nunca se muestra (las selladas se
 * filtran).
 */
const SEALED_TITLE = 'Bóveda';

/** Cómo queda en claro una entrada sellada. */
const sealedRow = (secret: string): EntryPatch => ({
  title: SEALED_TITLE,
  body: '',
  tags: [],
  person_ids: [],
  images: [],
  details: { vault: secret },
});

export type DiaryVault = {
  status: VaultStatus;
  /** Entradas en la bóveda (se sabe aunque esté cerrada). */
  count: number;
  /** Ya descifradas; null mientras está cerrada. */
  entries: Entry[] | null;
  /** Aún descifrando. */
  opening: boolean;
  create: (pin: string) => Promise<string | null>;
  unlock: (pin: string) => Promise<string | null>;
  lock: () => void;
  /** Guarda una entrada en la bóveda (se cifra). */
  adopt: (e: Entry) => Promise<boolean>;
  /** La saca de la bóveda; `place` dice dónde queda (carpeta o archivo). */
  release: (e: Entry, place?: Pick<EntryDetails, 'folder' | 'archived'>) => Promise<boolean>;
  /** Cambia una entrada de la bóveda (se vuelve a cifrar). */
  patch: (e: Entry, changes: EntryPatch) => Promise<boolean>;
  /** Lo que se guardó desde el formulario al editar una entrada de la bóveda. */
  saveEdit: (e: Entry, input: EntryInput) => Promise<boolean>;
  /** Borra la bóveda entera (notas y entradas) si olvidaste el PIN. */
  reset: () => Promise<boolean>;
};

/**
 * La bóveda del diario a partir de todos los recuerdos (los sellados vienen vacíos). Se usa una
 * sola vez, arriba de todo: así la ficha y el formulario también ven las entradas descifradas.
 */
export function useDiaryVault(
  all: Entry[],
  patchEntry: (e: Entry, changes: EntryPatch) => Promise<boolean>,
  /** Algo cambió por fuera (PIN nuevo, bóveda restablecida): hay que recargar. */
  onOutsideChange: () => void,
): DiaryVault {
  const vault = useVault();
  const key = vault.key;
  const sealed = useMemo(() => all.filter(isVaulted), [all]);
  const raw = useRef(sealed);
  raw.current = sealed;
  // id → contenido descifrado de ese secreto.
  const [plain, setPlain] = useState(() => new Map<string, { secret: string; c: Content }>());
  const cache = useRef(plain);
  cache.current = plain;
  const remember = (id: string, secret: string, c: Content) =>
    setPlain((m) => new Map(m).set(id, { secret, c }));

  const outside = useRef(onOutsideChange);
  outside.current = onOutsideChange;
  useEffect(() => {
    const on = () => outside.current();
    window.addEventListener(DIARY_VAULT_CHANGED, on);
    return () => window.removeEventListener(DIARY_VAULT_CHANGED, on);
  }, []);

  useEffect(() => {
    if (!key) {
      setPlain(new Map());
      return;
    }
    const todo = sealed.filter((e) => cache.current.get(e.id)?.secret !== e.details.vault);
    if (!todo.length) return;
    let live = true;
    void Promise.all(
      todo.map(async (e) => {
        const secret = e.details.vault!;
        try {
          return [e.id, secret, contentOf(await unseal<Content>(key, secret))] as const;
        } catch {
          return [
            e.id,
            secret,
            contentOf({ title: 'No se pudo abrir esta entrada', body: '' }),
          ] as const;
        }
      }),
    ).then((rows) => {
      if (!live) return;
      setPlain((m) => {
        const next = new Map(m);
        for (const [id, secret, c] of rows) next.set(id, { secret, c });
        return next;
      });
    });
    return () => {
      live = false;
    };
  }, [sealed, key]);

  const entries = useMemo(() => {
    if (!key) return null;
    return sealed.flatMap((e) => {
      const p = plain.get(e.id);
      return p
        ? [
            {
              ...e,
              ...p.c,
              details: { ...p.c.details, vault: e.details.vault },
            },
          ]
        : [];
    });
  }, [sealed, plain, key]);
  const opening = Boolean(key) && sealed.some((e) => !plain.has(e.id));

  /** El recuerdo tal como está en la base (sellado). */
  const rowOf = (e: Entry) => raw.current.find((x) => x.id === e.id) ?? e;

  const adopt = async (e: Entry) => {
    if (!key || isVaulted(e)) return false;
    touchVault();
    const c = contentOf(e);
    const secret = await seal(key, c);
    remember(e.id, secret, c);
    return patchEntry(e, sealedRow(secret));
  };

  const release = async (e: Entry, place: Pick<EntryDetails, 'folder' | 'archived'> = {}) => {
    touchVault();
    const c = contentOf(e);
    const details: EntryDetails = { ...c.details };
    if (place.folder) details.folder = place.folder;
    if (place.archived) details.archived = true;
    return patchEntry(rowOf(e), {
      title: c.title.trim(),
      body: c.body,
      tags: c.tags,
      person_ids: c.person_ids,
      images: c.images,
      details,
    });
  };

  const patch = async (e: Entry, changes: EntryPatch) => {
    if (!key) return false;
    touchVault();
    const c = contentOf({ ...e, ...changes });
    const secret = await seal(key, c);
    remember(e.id, secret, c);
    const clear: EntryPatch = {};
    if (changes.status) clear.status = changes.status;
    if (changes.created_at) clear.created_at = changes.created_at;
    return patchEntry(rowOf(e), { ...sealedRow(secret), ...clear });
  };

  const saveEdit = (e: Entry, input: EntryInput) => {
    const row = rowOf(e);
    // Si no cambió el día, se conserva la hora original (igual que al editar cualquier recuerdo).
    const sameDay = input.date === todayInputValue(new Date(row.created_at));
    return patch(e, {
      title: input.title.trim(),
      body: input.body.trim(),
      tags: input.tags,
      person_ids: input.personIds,
      images: input.images,
      details: input.details,
      created_at: sameDay ? row.created_at : new Date(input.date + 'T12:00:00').toISOString(),
    });
  };

  return {
    status: vault.status,
    count: sealed.length,
    entries,
    opening,
    create: vault.create,
    unlock: vault.unlock,
    lock: vault.lock,
    adopt,
    release,
    patch,
    saveEdit,
    reset: resetVault,
  };
}
