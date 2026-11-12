import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApp } from '../AppContext';
import { goSection } from '../library/shelf';
import { MIN_STAY, nextPick, readPick, savePick, type Pick, type Variant } from './choose';
import { MixControls } from './MixControls';
import type { Nav, Scene, SceneInit } from './scene';
import { readSignals } from './signals';
import { Stage } from './Stage';
import { Logogram } from './variants/glyph';
import { Mixer } from './variants/mixer';
import { Plant } from './variants/plant';
import { School } from './variants/school';
import { Universe } from './variants/universe';
import './ambient.css';

/**
 * Escena ambiental de Mi espacio: ocupa el hueco a la derecha del saludo, directamente sobre el
 * fondo. Muestra una sola de cinco variantes, elegida con azar ponderado por tu contexto; se
 * queda al menos 10 minutos (también si recargas) y cambia solo cuando no la estás usando, con un
 * fundido. Todo lo que muestra sale de tus datos en Nexo; sin datos, queda en un estado neutro.
 */

const make: Record<Variant, (init: SceneInit) => Scene> = {
  universo: (i) => new Universe(i),
  planta: (i) => new Plant(i),
  mezclador: (i) => new Mixer(i),
  peces: (i) => new School(i),
  glifo: (i) => new Logogram(i),
};

const copy: Record<Variant, { label: string; help: string }> = {
  universo: {
    label:
      'Pequeño universo: tus episodios activos, las personas de tus recuerdos recientes y los libros y series en curso, en órbita',
    help: 'Flechas para recorrer los planetas y Enter para saber qué representa cada uno. El sistema gira solo; con el puntero puedes empujarlos, lanzarlos o arrastrar el vacío para acelerar el giro.',
  },
  planta: {
    label: 'Planta sensible: su postura sigue el ánimo que marcaste y su vaivén, tu ritmo reciente',
    help: 'Flechas para recorrer las hojas, una por cada uno de los últimos 7 días, y Enter para ver ese día. Mayúsculas con las flechas laterales dobla el tallo.',
  },
  mezclador: {
    label: 'Mezclador de ambientes: lluvia, bosque y viento',
    help: 'Flechas laterales para elegir un ambiente y flechas arriba y abajo para cambiar su intensidad. El sonido solo se activa con el botón de sonido.',
  },
  peces: {
    label:
      'Acuario: las personas con las que tuviste un buen momento y tus encuentros próximos nadan entre los bancos de tus asuntos abiertos',
    help: 'Flechas para recorrer los peces y Enter para saber quién es cada uno. Toca el agua para echar comida: van a por ella, comen y crecen un poco. El puntero genera una corriente.',
  },
  glifo: {
    label: 'Lenguaje circular de Nexo: un símbolo propio que escribe un mensaje sobre tu contexto',
    help: 'El símbolo cambia cada dos segundos. Enter detiene la escritura y lee su mensaje; las flechas laterales pasan al siguiente o al anterior.',
  },
};

const REDUCE = '(prefers-reduced-motion: reduce)';
const subscribeReduce = (f: () => void) => {
  const m = window.matchMedia(REDUCE);
  m.addEventListener('change', f);
  return () => m.removeEventListener('change', f);
};
const isReduced = () => window.matchMedia(REDUCE).matches;

/** Tras dejar de interactuar, cuánto esperar antes de permitir el cambio de variante. */
const IDLE = 45_000;

export function Ambient() {
  const app = useApp();
  const { user, workspace, capsules, dataSettled, me } = app;
  const reduced = useSyncExternalStore(subscribeReduce, isReduced);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);
  // Tú, en el centro del universo: tu nombre y tu foto de «Mi ficha».
  const myName = me.profile.name?.trim() || user.email?.split('@')[0] || '';
  const myPhoto = me.profile.photo;
  const sig = useMemo(
    () => readSignals(workspace, capsules, new Date(clock), { name: myName, photo: myPhoto }),
    [workspace, capsules, clock, myName, myPhoto],
  );
  const sigRef = useRef(sig);
  sigRef.current = sig;

  const appRef = useRef(app);
  appRef.current = app;
  const nav = useMemo<Nav>(
    () => ({
      viewEntry: (id) => {
        const a = appRef.current;
        const e = a.workspace.entries.find((x) => x.id === id);
        if (e) a.viewEntry(e);
      },
      episode: (id) => appRef.current.go('Episodios', id ? { id } : null),
      person: (id) => {
        const a = appRef.current;
        const p = a.workspace.people.find((x) => x.id === id);
        if (p) a.peekPerson(p);
      },
      agenda: () => goSection(appRef.current.go, 'Agenda', 'pendientes'),
    }),
    [],
  );

  const [pick, setPick] = useState<Pick | null>(null);
  const pickRef = useRef<Pick | null>(null);
  const commit = useCallback(
    (next: Pick) => {
      pickRef.current = next;
      savePick(user.id, next);
      setPick(next);
    },
    [user.id],
  );

  // Primera elección: la guardada si aún no cumple 10 minutos; si no, una nueva.
  useEffect(() => {
    if (!dataSettled || pickRef.current) return;
    const saved = readPick(user.id);
    const now = Date.now();
    if (saved && saved.since <= now && now - saved.since < MIN_STAY) {
      pickRef.current = saved;
      setPick(saved);
    } else commit(nextPick(sigRef.current, saved, now));
  }, [dataSettled, user.id, commit]);

  const remember = useCallback(
    (key: string, value: unknown) => {
      const p = pickRef.current;
      if (!p) return;
      const next = { ...p, mem: { ...p.mem, [key]: value } };
      pickRef.current = next;
      savePick(user.id, next);
    },
    [user.id],
  );

  const busy = useRef({ stage: false, audio: false });
  const lastTouch = useRef(0);
  const [leaving, setLeaving] = useState(false);

  // Cumplidos los 10 minutos, se cambia en un momento tranquilo: sin interacción reciente, sin
  // explicación abierta y sin sonido. El cambio es un fundido, nunca un salto.
  useEffect(() => {
    if (!pick) return;
    let swap = 0;
    const calm = () =>
      !busy.current.stage && !busy.current.audio && Date.now() - lastTouch.current > IDLE;
    const id = window.setInterval(() => {
      const p = pickRef.current;
      if (!p || swap || Date.now() - p.since < MIN_STAY || !calm()) return;
      setLeaving(true);
      swap = window.setTimeout(
        () => {
          swap = 0;
          if (!calm()) {
            setLeaving(false);
            return;
          }
          commit(nextPick(sigRef.current, pickRef.current, Date.now()));
          setLeaving(false);
        },
        reduced ? 350 : 1400,
      );
    }, 15_000);
    return () => {
      clearInterval(id);
      clearTimeout(swap);
    };
  }, [pick, reduced, commit]);

  const scene = useMemo(
    () =>
      pick
        ? make[pick.v]({
            sig: sigRef.current,
            nav,
            reduced,
            mem: pick.mem,
            remember,
          })
        : null,
    // Una escena por elección: los datos nuevos le llegan con setData, sin reiniciarla.
    [pick?.v, pick?.since, reduced],
  );
  useEffect(() => {
    scene?.setData(sig);
  }, [scene, sig]);

  const onBusy = useCallback((b: boolean) => {
    busy.current.stage = b;
    if (b) lastTouch.current = Date.now();
  }, []);
  const onTouch = useCallback(() => {
    lastTouch.current = Date.now();
  }, []);
  const onAudio = useCallback((on: boolean) => {
    busy.current.audio = on;
  }, []);

  if (!pick || !scene) return <div className="amb" aria-hidden="true" />;
  const text = copy[pick.v];
  return (
    <div className={'amb' + (leaving ? ' leaving' : '')} data-variant={pick.v}>
      <div className="amb-in" key={pick.v + pick.since}>
        <Stage
          scene={scene}
          label={text.label}
          help={text.help}
          reduced={reduced}
          onBusy={onBusy}
          onTouch={onTouch}
        >
          {pick.v === 'mezclador' && (
            <MixControls
              scene={scene as Mixer}
              volume={typeof pick.mem.volume === 'number' ? pick.mem.volume : 0.6}
              remember={remember}
              onAudio={onAudio}
            />
          )}
        </Stage>
      </div>
    </div>
  );
}
