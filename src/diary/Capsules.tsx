import { useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Flame,
  Hourglass,
  LoaderCircle,
  Lock,
  LockOpen,
  X,
} from "lucide-react";
import { useApp } from "../AppContext";
import { MoodIcon } from "../composer/controls";
import { moodOf } from "../composer/moods";
import { feelingsOf } from "../composer/MoodTrio";
import { PhotoThumbs } from "../components/PhotoThumbs";
import { RichText } from "../components/RichText";
import { Sheet } from "../components/Sheet";
import type { Entry } from "../data";
import { todayInputValue } from "../lib/format";
import { capsuleDay, countdown, daysUntil, isReady } from "./capsule";
import { dayOf } from "./model";

/** Qué tanto del camino lleva: de cuando la sellaste a cuando se abre (0 a 1). */
function progressOf(e: Entry, today: string) {
  const opensOn = e.details.capsule!.opensOn;
  const from = todayInputValue(new Date(e.recorded_at ?? e.created_at));
  const total = daysUntil(opensOn, from);
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - daysUntil(opensOn, today) / total));
}

/**
 * Cápsulas del tiempo del diario: las selladas, con su cuenta regresiva (sin mostrar nada de lo
 * que dicen), y las que ya llegaron a su fecha, listas para abrir.
 */
export function Capsules() {
  const { capsules, openCapsule, burnCapsule, confirm, notify } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [reading, setReading] = useState<Entry | null>(null);
  const today = todayInputValue();

  if (!capsules.length && !reading) return null;
  const list = [...capsules].sort((a, b) => {
    const ra = isReady(a, today) ? 0 : 1;
    const rb = isReady(b, today) ? 0 : 1;
    return ra - rb || a.details.capsule!.opensOn.localeCompare(b.details.capsule!.opensOn);
  });
  const readyCount = list.filter((e) => isReady(e, today)).length;

  const open = async (e: Entry) => {
    if (busy) return;
    setBusy(e.id);
    const opened = await openCapsule(e);
    setBusy(null);
    if (opened) setReading(opened);
  };

  const smash = async (e: Entry) => {
    const ok = await confirm({
      title: "¿Romper esta cápsula?",
      message: "Se borra sin abrirla: no podrás leer lo que escribiste.",
      confirmLabel: "Romper y borrar",
      cancelLabel: "Dejarla sellada",
      danger: true,
      icon: "trash",
    });
    if (ok && (await burnCapsule(e))) notify("Cápsula borrada.");
  };

  return (
    <section className="dy-drafts dy-caps" aria-label="Cápsulas del tiempo">
      {list.length > 0 && (
        <>
          <h3>
            <Hourglass size={14} /> Cápsulas del tiempo
            <small>{list.length}</small>
            <span className="dy-drafts-hint">
              {readyCount
                ? readyCount === 1
                  ? "Una ya se puede abrir"
                  : `${readyCount} ya se pueden abrir`
                : "Selladas: no aparecen en ningún lado hasta su fecha"}
            </span>
          </h3>
          <div className="dy-drafts-list">
            {list.map((e) => {
              const c = e.details.capsule!;
              const ready = isReady(e, today);
              const written = capsuleDay(dayOf(e));
              return (
                <article key={e.id} className={"dy-cap" + (ready ? " ready" : "")}>
                  {ready ? (
                    <button
                      type="button"
                      className="dy-cap-main"
                      disabled={busy === e.id}
                      onClick={() => void open(e)}
                    >
                      <span className="dy-cap-seal" aria-hidden="true">
                        {busy === e.id ? (
                          <LoaderCircle className="spin" size={18} />
                        ) : (
                          <LockOpen size={18} />
                        )}
                      </span>
                      <small>Escrita el {written}</small>
                      <strong>Lista para abrir</strong>
                      <span className="dy-cap-meta">
                        {c.once ? (
                          <>
                            <Flame size={12} /> Se ve una sola vez
                          </>
                        ) : (
                          "Ábrela cuando quieras"
                        )}
                      </span>
                    </button>
                  ) : (
                    <div className="dy-cap-main">
                      <span className="dy-cap-seal" aria-hidden="true">
                        <Lock size={17} />
                      </span>
                      <small>Escrita el {written}</small>
                      <strong>Se abre {countdown(c.opensOn, today)}</strong>
                      <span className="dy-cap-meta">
                        {capsuleDay(c.opensOn)}
                        {c.once && (
                          <>
                            {" · "}
                            <Flame size={12} /> una sola vez
                          </>
                        )}
                      </span>
                      <span
                        className="dy-cap-bar"
                        role="progressbar"
                        aria-label="Tiempo que falta"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progressOf(e, today) * 100)}
                      >
                        <i style={{ width: `${progressOf(e, today) * 100}%` }} />
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="dy-draft-x"
                    aria-label="Romper la cápsula"
                    title="Romper (borrar sin abrir)"
                    onClick={() => void smash(e)}
                  >
                    <X size={13} />
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}
      {reading &&
        createPortal(
          <CapsuleReader entry={reading} onDone={() => setReading(null)} />,
          document.body,
        )}
    </section>
  );
}

/** La cápsula abierta. La de una sola vez se borra al cerrarla. */
export function CapsuleReader({ entry, onDone }: { entry: Entry; onDone: () => void }) {
  const { burnCapsule, confirm, notify, viewEntry } = useApp();
  const once = Boolean(entry.details.capsule?.once);
  const written = capsuleDay(dayOf(entry));
  const feelings = feelingsOf(entry.details);
  const [closing, setClosing] = useState(false);

  const close = async () => {
    if (closing) return;
    if (!once) return onDone();
    const ok = await confirm({
      title: "¿Cerrar la cápsula?",
      message: "Es de una sola vez: al cerrarla se borra y no podrás volver a leerla.",
      confirmLabel: "Cerrar y borrar",
      cancelLabel: "Seguir leyendo",
      danger: true,
      icon: "warning",
    });
    if (!ok) return;
    setClosing(true);
    const burned = await burnCapsule(entry);
    setClosing(false);
    if (!burned) return;
    notify("La cápsula se borró. Solo queda en tu memoria.");
    onDone();
  };

  return (
    <Sheet label="Cápsula del tiempo" className="dyy dy-cap-sheet" onRequestClose={() => void close()}>
      <header className="dy-cap-head">
        <span className="dy-cap-seal" aria-hidden="true">
          <LockOpen size={18} />
        </span>
        <div>
          <small>Cápsula del tiempo</small>
          <strong>Escrita el {written}</strong>
        </div>
        <button type="button" className="dy-cap-x" aria-label="Cerrar" onClick={() => void close()}>
          <X size={20} />
        </button>
      </header>
      <div className="dy-cap-read">
        {feelings.length > 0 && (
          <p className="dy-cap-moods">
            {feelings.slice(0, 3).map((f) => {
              const m = moodOf(f.mood);
              return m ? <MoodIcon key={f.mood} mood={m} size={22} /> : null;
            })}
          </p>
        )}
        {entry.title.trim() && entry.title !== entry.kind && <h2>{entry.title}</h2>}
        {entry.body.trim() && (
          <div className="dy-cap-body">
            <RichText text={entry.body} />
          </div>
        )}
        <PhotoThumbs images={entry.images} />
      </div>
      <footer className={"dy-cap-foot" + (once ? " once" : "")}>
        {once ? (
          <>
            <span>
              <Flame size={14} /> Es de una sola vez: al cerrarla se borra.
            </span>
            <button type="button" className="dy-cap-btn" disabled={closing} onClick={() => void close()}>
              {closing ? <LoaderCircle className="spin" size={15} /> : <Flame size={15} />}
              Cerrar y borrar
            </button>
          </>
        ) : (
          <>
            <span>Ya está en tu diario, el día en que la escribiste.</span>
            <button
              type="button"
              className="dy-cap-btn ghost"
              onClick={() => {
                onDone();
                viewEntry(entry);
              }}
            >
              Ver en el diario <ArrowUpRight size={14} />
            </button>
            <button type="button" className="dy-cap-btn" onClick={onDone}>
              Listo
            </button>
          </>
        )}
      </footer>
    </Sheet>
  );
}
