import { useEffect, useRef, useState } from 'react';
import { Puzzle, SearchX, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { PiecesReview } from '../capture/CaptureDialog';
import {
  bindPieceJobs,
  jobCount,
  removeJobs,
  setPiecesReview,
  updateJob,
  usePieceJobs,
} from './analysis';
import { analyzeJob } from './engine';
import './instants.css';

/** Lo que va diciendo mientras lee (cambia solo, sin repetir el anterior). */
const PHRASES = [
  'Leyendo tu instante…',
  'Buscando personas y lugares…',
  'Conectando con tu memoria…',
  'Mirando si hay gastos o pendientes…',
  'Reconociendo nombres y fechas…',
  'Uniendo los puntos…',
  'Pensando qué vale la pena guardar…',
  'Revisando lo que ya tenías…',
];
const EMPTY_MS = 3200;

/** Búsquedas que ya están corriendo en esta pestaña (no se lanzan dos veces). */
const running = new Set<string>();

/**
 * La barra de abajo a la derecha: mientras Nexo lee lo que publicaste (en segundo plano), cuenta
 * las piezas que va encontrando. Sigue ahí aunque cambies de sección o cierres el navegador, hasta
 * que las revises o las descartes. Si no encontró nada, lo dice y se va.
 */
export function PiecesBar() {
  const app = useApp();
  const { user, dataReady, confirm } = app;
  const { jobs, review } = usePieceJobs();
  const latest = useRef(app);
  latest.current = app;

  useEffect(() => bindPieceJobs(user.id), [user.id]);

  // Cada búsqueda pendiente corre una vez (con tus datos ya cargados, para reconocer a tu gente).
  useEffect(() => {
    if (!dataReady) return;
    for (const job of jobs) {
      if (job.status !== 'analizando' || running.has(job.id)) continue;
      running.add(job.id);
      updateJob(job.id, { tries: job.tries + 1 });
      void (async () => {
        try {
          const a = latest.current;
          const found = await analyzeJob(job, { workspace: a.workspace, me: a.me.profile });
          updateJob(job.id, { ...found, status: found.plans.length ? 'listo' : 'vacio' });
        } catch {
          updateJob(job.id, { status: 'vacio', plans: [] });
        } finally {
          running.delete(job.id);
        }
      })();
    }
  }, [jobs, dataReady]);

  const busy = jobs.filter((j) => j.status === 'analizando');
  const ready = jobs.filter((j) => j.status === 'listo');
  const empty = jobs.filter((j) => j.status === 'vacio');
  const count = ready.reduce((s, j) => s + jobCount(j), 0);
  const from = new Set(ready.flatMap((j) => j.planInstants.filter(Boolean))).size || ready.length;

  // Lo que no dio nada se anuncia un momento y se va.
  const emptyKey = empty.map((j) => j.id).join();
  useEffect(() => {
    if (!emptyKey) return;
    const ids = emptyKey.split(',');
    const t = window.setTimeout(() => removeJobs(ids), EMPTY_MS);
    return () => window.clearTimeout(t);
  }, [emptyKey]);

  // Frases que van cambiando mientras lee.
  const [phrase, setPhrase] = useState(0);
  const reading = busy.length > 0;
  useEffect(() => {
    if (!reading) return;
    const t = window.setInterval(
      () =>
        setPhrase((i) => {
          const next = Math.floor(Math.random() * (PHRASES.length - 1));
          return next >= i ? next + 1 : next;
        }),
      2600,
    );
    return () => window.clearInterval(t);
  }, [reading]);

  useEffect(() => {
    if (review && !ready.length) setPiecesReview(false);
  }, [review, ready.length]);

  const openReview = () => {
    if (ready.length) setPiecesReview(true);
  };

  const close = async () => {
    if (!busy.length && !ready.length) {
      removeJobs(jobs.map((j) => j.id));
      return;
    }
    if (count > 0) {
      const what = count === 1 ? 'la pieza' : `las ${count} piezas`;
      const answer = await confirm({
        title: `¿Descartar ${what}?`,
        message:
          'Las encontró Nexo en tus instantes. Los instantes quedan tal cual; solo se pierde lo que propuso a partir de ellos.' +
          (busy.length ? ' También deja de leer lo que tenía en cola.' : ''),
        confirmLabel: 'Descartar',
        altLabel: 'Revisarlas',
        cancelLabel: 'Seguir después',
        danger: true,
        icon: 'warning',
      });
      if (answer === 'alt') openReview();
      else if (answer) removeJobs(jobs.map((j) => j.id));
      return;
    }
    const ok = await confirm({
      title: '¿Dejar de buscar piezas?',
      message:
        'Nexo sigue leyendo lo que publicaste. Si lo detienes, tus instantes quedan tal cual, pero no te propondrá nada a partir de ellos.',
      confirmLabel: 'Detener',
      cancelLabel: 'Que siga',
      icon: 'question',
    });
    if (ok) removeJobs(jobs.map((j) => j.id));
  };

  // La revisión toma lo listo al abrirse; lo que termine mientras tanto espera aquí.
  if (review && ready.length)
    return <PiecesReview jobs={ready} onClose={() => setPiecesReview(false)} />;

  const state = reading ? 'busy' : ready.length ? 'ready' : empty.length ? 'empty' : null;
  if (!state) return null;

  const title =
    state === 'busy'
      ? PHRASES[phrase]
      : state === 'ready'
        ? `${count} ${count === 1 ? 'pieza' : 'piezas'} por revisar`
        : 'No encontré piezas nuevas';
  const sub =
    state === 'busy'
      ? count
        ? `${count} ${count === 1 ? 'lista' : 'listas'} · sigo con ${busy.length === 1 ? 'otro instante' : `${busy.length} más`}`
        : busy.length > 1
          ? `${busy.length} publicaciones en cola`
          : 'En segundo plano · sigue con lo tuyo'
      : state === 'ready'
        ? `De ${from} ${from === 1 ? 'instante' : 'instantes'} · cada una queda vinculada`
        : 'Tu instante queda guardado tal cual.';

  return (
    <div className="ib" data-state={state} role="status" aria-live="polite">
      <button
        type="button"
        className="ib-main"
        onClick={openReview}
        disabled={!ready.length}
        title={ready.length ? 'Revisar las piezas' : undefined}
      >
        <span className="ib-orb" aria-hidden="true">
          {state === 'busy' ? (
            <i className="ib-ring" />
          ) : state === 'ready' ? (
            <Puzzle size={16} />
          ) : (
            <SearchX size={16} />
          )}
          {count > 0 && <b className="ib-count">{count > 99 ? '99+' : count}</b>}
        </span>
        <span className="ib-text">
          <strong key={state === 'busy' ? phrase : state}>{title}</strong>
          <small>{sub}</small>
        </span>
      </button>
      {ready.length > 0 && (
        <button type="button" className="ib-go" onClick={openReview}>
          Revisar
        </button>
      )}
      <button
        type="button"
        className="ib-x"
        aria-label={state === 'empty' ? 'Cerrar' : 'Descartar'}
        title={state === 'empty' ? 'Cerrar' : 'Descartar'}
        onClick={() => void close()}
      >
        <X size={15} />
      </button>
      {state === 'empty' && <i className="ib-timer" style={{ animationDuration: `${EMPTY_MS}ms` }} />}
    </div>
  );
}
