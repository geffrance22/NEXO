import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../backend';
import type { StoredImage } from '../data';
import type { Check } from '../planner/shared';
import {
  missingColumn,
  NOTES_CHANGED,
  type KeepNote,
  type NoteFields,
  type NotesStore,
} from './useNotes';

/**
 * Bóveda de notas. El PIN nunca sale del navegador: de él se deriva una clave AES-GCM de 256 bits
 * (PBKDF2-SHA-256) que cifra el contenido de cada nota antes de guardarlo. En la base de datos solo
 * quedan la sal, el número de vueltas y un verificador cifrado para comprobar el PIN.
 */
const ITERATIONS = 600_000;
const VERIFY = 'nexo-vault-v1';
/** Se bloquea sola tras este tiempo sin usarla. */
export const AUTO_LOCK_MS = 5 * 60_000;
/** Intentos fallidos antes de esperar. */
const MAX_TRIES = 5;
const WAIT_MS = 30_000;

export const PIN_RE = /^\d{4,8}$/;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(pin: string, salt: string, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(salt), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function seal(key: CryptoKey, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return `v1.${toB64(iv)}.${toB64(new Uint8Array(data))}`;
}

export async function unseal<T>(key: CryptoKey, secret: string): Promise<T> {
  const [v, iv, data] = secret.split('.');
  if (v !== 'v1' || !iv || !data) throw Error('Formato desconocido');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv) },
    key,
    fromB64(data),
  );
  return JSON.parse(dec.decode(plain)) as T;
}

type VaultRow = { salt: string; iterations: number; verifier: string };
export type VaultStatus = 'loading' | 'missing' | 'none' | 'locked' | 'open';

// La clave vive solo en memoria (se pierde al recargar) y se comparte entre las vistas.
const session: {
  row: VaultRow | null | undefined;
  key: CryptoKey | null;
  used: number;
  fails: number;
  waitUntil: number;
  missing: boolean;
} = {
  row: undefined,
  key: null,
  used: 0,
  fails: 0,
  waitUntil: 0,
  missing: false,
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
// Otra sesión (cerrar sesión o cambiar de cuenta): se olvida todo.
let sessionUser: string | null | undefined;
supabase.auth.onAuthStateChange((_event, auth) => {
  const uid = auth?.user.id ?? null;
  if (uid === sessionUser) return;
  sessionUser = uid;
  session.row = undefined;
  session.key = null;
  session.fails = 0;
  session.waitUntil = 0;
  emit();
  if (uid && listeners.size) void loadRow();
});

/** Marca la bóveda como en uso (reinicia el bloqueo automático). */
export const touchVault = () => {
  if (session.key) session.used = Date.now();
};
export const lockVault = () => {
  if (!session.key) return;
  session.key = null;
  emit();
};

async function loadRow() {
  const { data, error } = await supabase
    .from('note_vaults')
    .select('salt,iterations,verifier')
    .maybeSingle();
  if (error) {
    // La tabla no existe: falta la migración.
    session.missing =
      error.code === '42P01' || error.code === 'PGRST205' || /note_vaults/.test(error.message);
    session.row = null;
  } else {
    session.missing = false;
    session.row = (data as VaultRow | null) ?? null;
  }
  emit();
}

/** Estado de la bóveda y lo necesario para crearla, abrirla y cerrarla. */
export function useVault() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    if (session.row === undefined) void loadRow();
    // Bloqueo automático por inactividad.
    const t = window.setInterval(() => {
      if (session.key && Date.now() - session.used > AUTO_LOCK_MS) lockVault();
    }, 15_000);
    return () => {
      listeners.delete(l);
      window.clearInterval(t);
    };
  }, []);

  const status: VaultStatus =
    session.row === undefined
      ? 'loading'
      : session.missing
        ? 'missing'
        : !session.row
          ? 'none'
          : session.key
            ? 'open'
            : 'locked';

  /** Crea la bóveda con este PIN y la deja abierta. */
  const create = useCallback(async (pin: string) => {
    if (!PIN_RE.test(pin)) return 'El PIN debe tener de 4 a 8 números.';
    const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveKey(pin, salt, ITERATIONS);
    const row = {
      salt,
      iterations: ITERATIONS,
      verifier: await seal(key, VERIFY),
    };
    const { error } = await supabase.from('note_vaults').insert(row);
    if (error) return error.message || 'No se pudo crear la bóveda.';
    session.row = row;
    session.key = key;
    session.used = Date.now();
    emit();
    return null;
  }, []);

  /** Abre la bóveda. Devuelve null si el PIN es correcto; si no, el motivo. */
  const unlock = useCallback(async (pin: string) => {
    const row = session.row;
    if (!row) return 'Aún no tienes una bóveda.';
    const wait = session.waitUntil - Date.now();
    if (wait > 0) return `Demasiados intentos. Espera ${Math.ceil(wait / 1000)} s.`;
    try {
      const key = await deriveKey(pin, row.salt, row.iterations);
      if ((await unseal<string>(key, row.verifier)) !== VERIFY) throw Error();
      session.key = key;
      session.used = Date.now();
      session.fails = 0;
      emit();
      return null;
    } catch {
      session.fails += 1;
      if (session.fails >= MAX_TRIES) {
        session.fails = 0;
        session.waitUntil = Date.now() + WAIT_MS;
        return 'PIN incorrecto. Espera 30 s antes de volver a intentarlo.';
      }
      return 'PIN incorrecto.';
    }
  }, []);

  /** Comprueba un PIN sin cambiar el estado (para cambiarlo). */
  const keyFor = useCallback(async (pin: string) => {
    const row = session.row;
    if (!row) return null;
    try {
      const key = await deriveKey(pin, row.salt, row.iterations);
      return (await unseal<string>(key, row.verifier)) === VERIFY ? key : null;
    } catch {
      return null;
    }
  }, []);

  return {
    status,
    key: session.key,
    create,
    unlock,
    keyFor,
    lock: lockVault,
    reload: loadRow,
  };
}

/** Lo que va cifrado de cada nota. */
type Content = {
  title: string;
  body: string;
  tags: string[];
  checks: Check[];
  images: StoredImage[];
};
const CONTENT = ['title', 'body', 'tags', 'checks', 'images'] as const;
const EMPTY: Content = {
  title: '',
  body: '',
  tags: [],
  checks: [],
  images: [],
};
const contentOf = (n: Partial<Content>): Content => ({
  title: n.title ?? '',
  body: n.body ?? '',
  tags: n.tags ?? [],
  checks: n.checks ?? [],
  images: n.images ?? [],
});
const hasContent = (f: NoteFields) => CONTENT.some((k) => k in f);
/** Campos que se guardan en claro (orden, color, fijada, recordatorio). */
function outside(f: NoteFields): NoteFields {
  const out: NoteFields = { ...f };
  for (const k of CONTENT) delete out[k];
  delete out.vaulted;
  delete out.secret;
  delete out.book_id;
  delete out.episode_id;
  delete out.archived;
  return out;
}

export type VaultStore = NotesStore & {
  /** Aún descifrando las notas. */
  opening: boolean;
  /** Mueve una nota normal a la bóveda (se cifra). */
  adopt: (n: KeepNote) => Promise<boolean>;
  /** Saca una nota de la bóveda (vuelve a quedar en claro). */
  release: (n: KeepNote) => Promise<boolean>;
  /** Cambia el PIN y vuelve a cifrar todas las notas de la bóveda. */
  changePin: (current: string, next: string) => Promise<string | null>;
  /** Borra la bóveda y todas sus notas (si olvidaste el PIN). */
  reset: () => Promise<boolean>;
};

/**
 * Las notas de la bóveda, ya descifradas, con la misma forma que el almacén normal: lo que
 * escribes se cifra antes de guardarse. Sin clave, la lista queda vacía.
 */
export function useVaultStore(store: NotesStore, key: CryptoKey | null): VaultStore {
  // id → contenido descifrado de ese `secret`.
  const [plain, setPlain] = useState(() => new Map<string, { secret: string; c: Content }>());
  const cache = useRef(plain);
  cache.current = plain;
  const remember = (id: string, secret: string, c: Content) =>
    setPlain((m) => new Map(m).set(id, { secret, c }));

  const sealedNotes = useMemo(() => (store.notes ?? []).filter((n) => n.vaulted), [store.notes]);

  useEffect(() => {
    if (!key) {
      setPlain(new Map());
      return;
    }
    const todo = sealedNotes.filter(
      (n) => n.secret && cache.current.get(n.id)?.secret !== n.secret,
    );
    if (!todo.length) return;
    let live = true;
    void Promise.all(
      todo.map(async (n) => {
        try {
          return [n.id, n.secret!, contentOf(await unseal<Content>(key, n.secret!))] as const;
        } catch {
          return [
            n.id,
            n.secret!,
            { ...EMPTY, title: 'No se pudo abrir esta nota', body: '' },
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
  }, [sealedNotes, key]);

  const notes = useMemo(() => {
    if (!key || store.notes === null) return null;
    return sealedNotes.flatMap((n) => {
      const p = plain.get(n.id);
      return p ? [{ ...n, ...p.c }] : [];
    });
  }, [sealedNotes, plain, key, store.notes]);
  const opening = Boolean(key) && sealedNotes.some((n) => !plain.has(n.id));
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const current = (id: string) => notesRef.current?.find((n) => n.id === id);

  const create = async (fields: NoteFields) => {
    if (!key) return null;
    touchVault();
    const c = contentOf(fields);
    const secret = await seal(key, c);
    const made = await store.create({
      ...outside(fields),
      ...EMPTY,
      book_id: null,
      episode_id: null,
      vaulted: true,
      secret,
    });
    if (!made) return null;
    remember(made.id, secret, c);
    return { ...made, ...c };
  };

  const patch = async (id: string, fields: NoteFields) => {
    if (!key) return false;
    touchVault();
    if (!hasContent(fields)) return store.patch(id, outside(fields));
    const before = current(id);
    const c = contentOf({ ...(before ?? EMPTY), ...fields });
    const secret = await seal(key, c);
    remember(id, secret, c);
    return store.patch(id, { ...outside(fields), secret });
  };

  const adopt = async (n: KeepNote) => {
    if (!key) return false;
    touchVault();
    const c = contentOf(n);
    const secret = await seal(key, c);
    remember(n.id, secret, c);
    return store.patch(n.id, {
      ...EMPTY,
      book_id: null,
      episode_id: null,
      archived: false,
      vaulted: true,
      secret,
    });
  };

  /** `n` llega ya descifrada (desde la tarjeta o recién guardada desde el editor). */
  const release = async (n: KeepNote) => {
    touchVault();
    return store.patch(n.id, { ...contentOf(n), vaulted: false, secret: null });
  };

  const changePin = async (pinNow: string, next: string) => {
    if (!PIN_RE.test(next)) return 'El nuevo PIN debe tener de 4 a 8 números.';
    const row = session.row;
    if (!row) return 'Aún no tienes una bóveda.';
    let oldKey: CryptoKey;
    try {
      oldKey = await deriveKey(pinNow, row.salt, row.iterations);
      if ((await unseal<string>(oldKey, row.verifier)) !== VERIFY) throw Error();
    } catch {
      return 'El PIN actual no es correcto.';
    }
    const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
    const newKey = await deriveKey(next, salt, ITERATIONS);
    // Primero se vuelven a cifrar las notas; si algo falla, se deshace lo hecho.
    const done: { id: string; secret: string }[] = [];
    const undo = async () => {
      for (const d of done)
        await supabase.from('quick_notes').update({ secret: d.secret }).eq('id', d.id);
    };
    for (const n of sealedNotes) {
      if (!n.secret) continue;
      let c: Content;
      try {
        c = contentOf(await unseal<Content>(oldKey, n.secret));
      } catch {
        continue; // Ya estaba ilegible: se deja como está.
      }
      const secret = await seal(newKey, c);
      const { error } = await supabase.from('quick_notes').update({ secret }).eq('id', n.id);
      if (error) {
        await undo();
        return 'No se pudo cambiar el PIN. Tus notas siguen con el PIN anterior.';
      }
      done.push({ id: n.id, secret: n.secret });
    }
    const fresh = {
      salt,
      iterations: ITERATIONS,
      verifier: await seal(newKey, VERIFY),
    };
    const { error } = await supabase
      .from('note_vaults')
      .update({ ...fresh, updated_at: new Date().toISOString() })
      .not('owner_id', 'is', null);
    if (error) {
      await undo();
      return 'No se pudo cambiar el PIN. Tus notas siguen con el PIN anterior.';
    }
    session.row = fresh;
    session.key = newKey;
    session.used = Date.now();
    emit();
    window.dispatchEvent(new Event(NOTES_CHANGED));
    return null;
  };

  const reset = async () => {
    const del = await supabase.from('quick_notes').delete().eq('vaulted', true);
    if (del.error && !missingColumn(del.error)) return false;
    const { error } = await supabase.from('note_vaults').delete().not('owner_id', 'is', null);
    if (error) return false;
    session.row = null;
    session.key = null;
    emit();
    window.dispatchEvent(new Event(NOTES_CHANGED));
    return true;
  };

  return {
    ...store,
    books: [],
    notes,
    opening,
    create,
    patch,
    adopt,
    release,
    changePin,
    reset,
  };
}
