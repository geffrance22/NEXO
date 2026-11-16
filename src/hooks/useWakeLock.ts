import { useEffect } from 'react';

/**
 * Mantiene la pantalla encendida mientras `on` (p. ej. leyendo un artículo o escuchándolo).
 * Con `idleMs`, la suelta si pasas ese tiempo sin tocar, desplazar ni teclear (dejaste el celular
 * a un lado) y la recupera al volver. El sistema la quita al cambiar de app: se pide otra vez al
 * volver a Nexo. Sin soporte (o con ahorro de batería) no hace nada.
 */
export function useWakeLock(on: boolean, idleMs = 0) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let asking = false;
    let alive = true;
    let awake = true;
    let timer = 0;

    const acquire = async () => {
      if (!alive || !awake || lock || asking || document.visibilityState !== 'visible') return;
      asking = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (!alive || !awake) {
          void next.release().catch(() => {});
          return;
        }
        lock = next;
        next.addEventListener('release', () => {
          if (lock === next) lock = null;
        });
      } catch {
        /* sin permiso, sin batería o la pestaña no está a la vista */
      } finally {
        asking = false;
      }
    };
    const release = () => {
      const held = lock;
      lock = null;
      void held?.release().catch(() => {});
    };
    let last = -Infinity;
    const poke = () => {
      if (!idleMs) return;
      // Al desplazar llegan decenas de eventos por segundo: basta con contar uno por segundo.
      const now = performance.now();
      if (awake && now - last < 1000) return;
      last = now;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        awake = false;
        release();
      }, idleMs);
      if (!awake) {
        awake = true;
        void acquire();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    poke();
    const opts = { capture: true, passive: true } as const;
    const activity = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchmove'] as const;
    document.addEventListener('visibilitychange', onVisible);
    if (idleMs) for (const type of activity) document.addEventListener(type, poke, opts);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (idleMs) for (const type of activity) document.removeEventListener(type, poke, opts);
      release();
    };
  }, [on, idleMs]);
}
