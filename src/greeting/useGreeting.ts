import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import type { MyRecord, Workspace } from '../data';
import { todayInputValue } from '../lib/format';
import { useDismissed } from '../relations/dismissed';
import { askGreeting } from './api';
import { buildGreetingInput, nameOf } from './context';
import { partOf, type Greeting, type LocalFacts, type Part, type Weather } from './greeting';
import { localGreeting, salutation } from './local';
import {
  isFresh,
  isUsable,
  lifetime,
  pause,
  pausedUntil,
  pushHistory,
  readHistory,
  readStored,
  writeStored,
  type Stored,
} from './store';

/**
 * `ai`: el saludo de la IA · `wait`: ya está el saludo y el mensaje viene en camino · `local`: el
 * saludo de respaldo (la IA no está disponible o tardó demasiado).
 */
export type Phase = 'ai' | 'wait' | 'local';
export type GreetingView = {
  phase: Phase;
  greeting: Greeting;
  weather: Weather | null;
  /** Se está pidiendo uno nuevo. */
  pending: boolean;
  part: Part;
};

type Source = { workspace: Workspace; me: MyRecord; skip: ReadonlySet<string> };

/** Tras un fallo no se insiste durante este tiempo. */
const RETRY_AFTER = 3 * 60_000;
/** Si la IA tarda más que esto, se muestra el saludo de respaldo mientras sigue llegando. */
const SLOW_AFTER = 3500;
const NO_FACTS: LocalFacts = { myBirthday: false };

// Una sola petición a la vez, aunque haya varios componentes (o el modo estricto de React) pidiendo.
let inflight: { key: string; promise: Promise<Stored> } | null = null;

function generate(uid: string, read: () => Source): Promise<Stored> {
  const when = new Date();
  const day = todayInputValue(when);
  const part = partOf(when);
  const key = `${uid}|${day}|${part}`;
  if (inflight?.key === key) return inflight.promise;

  const promise = (async () => {
    const { workspace, me, skip } = read();
    const input = buildGreetingInput(workspace, me, skip, when);
    const res = await askGreeting({
      digest: input.digest,
      ahora: {
        fecha: day,
        hora: when.toLocaleTimeString('es-CO', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        dia: when.toLocaleDateString('es-CO', { weekday: 'long' }),
        mes: when.toLocaleDateString('es-CO', { month: 'long' }),
        parte: part,
        zona: Intl.DateTimeFormat().resolvedOptions().timeZone,
        idioma: navigator.language,
      },
      recientes: readHistory(),
    });
    const at = Date.now();
    const stored: Stored = {
      uid,
      at,
      exp: at + lifetime(),
      day,
      part,
      name: input.name,
      greeting: res.greeting,
      weather: res.weather,
    };
    writeStored(stored);
    pushHistory(res.greeting);
    return stored;
  })();

  inflight = { key, promise };
  const done = () => {
    if (inflight?.promise === promise) inflight = null;
  };
  promise.then(done, done);
  return promise;
}

/**
 * El saludo de Mi espacio. Si hay uno de la IA vigente (10 a 15 minutos), se muestra al instante.
 * Si no, aparece el saludo con tu nombre y el mensaje llega en cuanto la IA responde; si tarda o
 * falla, se queda uno de respaldo. Cuando el actual vence, se pide otro sin que tengas que hacer
 * nada.
 */
export function useGreeting(): GreetingView {
  const { workspace, me, user, dataReady } = useApp();
  const skip = useDismissed();
  const uid = user.id;

  const [stored, setStored] = useState<Stored | null>(() => readStored(uid));
  const [clock, setClock] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [seed] = useState(() => Math.random());

  // Lo último que hay en pantalla, para que `refresh` no dependa de cada cambio.
  const source = useRef<Source>({ workspace, me, skip });
  source.current = { workspace, me, skip };
  const ready = useRef(dataReady);
  ready.current = dataReady;
  const current = useRef(stored);
  current.current = stored;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    // Hace falta tener cargados tus datos (si no, el resumen saldría vacío) y la pestaña a la vista.
    if (!ready.current || document.hidden) return;
    const t = new Date();
    const have = current.current;
    if (have && isFresh(have, todayInputValue(t), partOf(t), t.getTime())) return;
    if (pausedUntil() > t.getTime()) return;
    setPending(true);
    try {
      const next = await generate(uid, () => source.current);
      if (alive.current) setStored(next);
    } catch {
      pause(RETRY_AFTER);
    } finally {
      if (alive.current) {
        setPending(false);
        setClock(Date.now());
      }
    }
  }, [uid]);

  // Al terminar de cargar tus datos.
  useEffect(() => {
    void refresh();
  }, [refresh, dataReady]);

  // Al volver a la pestaña.
  useEffect(() => {
    const wake = () => {
      setClock(Date.now());
      void refresh();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [refresh]);

  // Y, si la página sigue abierta, cuando se cumple el tiempo del saludo actual.
  useEffect(() => {
    if (!stored) return;
    const id = window.setTimeout(
      () => {
        setClock(Date.now());
        void refresh();
      },
      Math.max(3000, stored.exp - Date.now()) + 400,
    );
    return () => window.clearTimeout(id);
  }, [stored, refresh]);

  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), SLOW_AFTER);
    return () => window.clearTimeout(id);
  }, []);

  const now = new Date(clock);
  const day = todayInputValue(now);
  const part = partOf(now);
  const live = stored && isUsable(stored, day, part, clock) ? stored : null;
  const offline = pausedUntil() > clock;
  const phase: Phase = live ? 'ai' : offline || slow ? 'local' : 'wait';
  // Antes de que cargue tu ficha se usa el nombre de la última vez (así no «aparece» de repente).
  const name = nameOf(me) ?? (dataReady ? null : (stored?.name ?? null));

  const facts = useMemo(
    () =>
      phase === 'local' && dataReady
        ? buildGreetingInput(workspace, me, skip, new Date(clock)).facts
        : NO_FACTS,
    [phase, dataReady, workspace, me, skip, clock],
  );

  const n = Math.floor(seed * 1000);
  const greeting: Greeting = live
    ? live.greeting
    : phase === 'wait'
      ? { kind: 'tip', title: salutation(part, name, n), text: '', actions: [] }
      : localGreeting({ part, name, facts, seed });

  return { phase, greeting, weather: live?.weather ?? null, pending, part };
}
