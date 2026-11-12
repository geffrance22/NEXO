import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastAction = { label: string; run: () => void; icon?: 'undo' | 'open' };
export type Notify = (text: string, action?: ToastAction) => void;
export type ToastItem = { id: number; message: string; action?: ToastAction; leaving?: boolean };

/** Máximo de avisos visibles a la vez; los más viejos salen primero. */
const MAX_VISIBLE = 4;
/** Duración de la animación de salida (coincide con .toast-slot.leaving en el CSS). */
const LEAVE_MS = 220;

/**
 * Avisos temporales apilados. Cada aviso nuevo entra abajo y empuja hacia
 * arriba a los que ya estaban; cada uno tiene su propio temporizador.
 */
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const list = useRef<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const nextId = useRef(1);

  const commit = useCallback((next: ToastItem[]) => {
    list.current = next;
    setToasts(next);
  }, []);

  const stopTimer = (id: number) => {
    const t = timers.current.get(id);
    if (t !== undefined) window.clearTimeout(t);
    timers.current.delete(id);
  };

  /** Marca el aviso como saliente y lo quita al terminar la animación. */
  const dismiss = useCallback(
    (id: number) => {
      const item = list.current.find((x) => x.id === id);
      if (!item || item.leaving) return;
      stopTimer(id);
      commit(list.current.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id);
          commit(list.current.filter((x) => x.id !== id));
        }, LEAVE_MS),
      );
    },
    [commit],
  );

  const clear = useCallback(() => {
    for (const x of list.current) dismiss(x.id);
  }, [dismiss]);

  const notify = useCallback<Notify>(
    (text, action) => {
      const id = nextId.current++;
      commit([...list.current, { id, message: text, action }]);
      // Si ya hay demasiados, el más viejo se va para dejar sitio.
      const active = list.current.filter((x) => !x.leaving);
      for (const x of active.slice(0, Math.max(0, active.length - MAX_VISIBLE))) dismiss(x.id);
      // Con «Deshacer» el aviso dura un poco más.
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), action ? 8000 : 5500),
      );
    },
    [commit, dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) window.clearTimeout(t);
      map.clear();
    };
  }, []);

  // Último aviso activo: lo usan pantallas que solo muestran un mensaje (p. ej. el acceso).
  const latest = [...toasts].reverse().find((x) => !x.leaving);

  return { toasts, message: latest?.message ?? '', notify, dismiss, clear };
}
