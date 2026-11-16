import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useApp } from '../AppContext';
import { DEFAULT_SLOTS, shortcutOf } from './shortcuts';

export type Slots = [string, string];

const keyOf = (uid: string) => 'nexo-mobile-nav:' + uid;
const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
};
const readLocal = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const parse = (raw: string | null): unknown => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/** Lo guardado, si sirve: dos accesos que existan (uno que ya no exista vuelve al de siempre). */
function fix(raw: unknown): Slots | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const pick = (v: unknown, i: 0 | 1) =>
    typeof v === 'string' && shortcutOf(v) ? v : DEFAULT_SLOTS[i];
  return [pick(raw[0], 0), pick(raw[1], 1)];
}

/**
 * Los accesos del 2.º y el 4.º botón de la barra inferior. Lo que elijas en este teléfono manda
 * aquí; también se guarda en tu ficha, así un teléfono nuevo arranca con tu elección.
 */
export function useNavSlots() {
  const { user, me, meLoaded, meMissing, meFailed, patchMe } = useApp();
  const key = keyOf(user.id);
  const local = useSyncExternalStore(subscribe, () => readLocal(key));
  const remote = me.profile.mobileNav;
  const slots = useMemo<Slots>(
    () => fix(parse(local)) ?? fix(remote) ?? DEFAULT_SLOTS,
    [local, remote],
  );

  const save = useCallback(
    (next: Slots) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Sin almacenamiento local: queda en tu ficha. */
      }
      listeners.forEach((f) => f());
      // Sin la ficha cargada no se guarda allá (avisaría un error); en este teléfono ya quedó.
      if (meLoaded && !meMissing && !meFailed) void patchMe({ mobileNav: next });
    },
    [key, meLoaded, meMissing, meFailed, patchMe],
  );

  /** Pone `id` en el botón `slot`; si ya estaba en el otro, los intercambia. */
  const setSlot = useCallback(
    (slot: 0 | 1, id: string) => {
      const next: Slots = [...slots];
      const other = slot === 0 ? 1 : 0;
      if (next[other] === id) next[other] = next[slot];
      next[slot] = id;
      save(next);
    },
    [slots, save],
  );

  const reset = useCallback(() => save([...DEFAULT_SLOTS]), [save]);
  const isDefault = slots[0] === DEFAULT_SLOTS[0] && slots[1] === DEFAULT_SLOTS[1];

  return { slots, setSlot, reset, isDefault };
}
