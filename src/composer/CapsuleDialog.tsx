import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Flame, Hourglass, Lock, X } from "lucide-react";
import type { TimeCapsule } from "../data";
import { addDays, todayInputValue } from "../lib/format";
import { capsuleDay, capsulePresets, countdown } from "../diary/capsule";

/**
 * Sellar la entrada como cápsula del tiempo: cuándo se abre y si se conserva o se ve una sola vez.
 */
export function CapsuleDialog({
  onSeal,
  onClose,
}: {
  onSeal: (capsule: TimeCapsule) => void;
  onClose: () => void;
}) {
  const today = todayInputValue();
  const min = addDays(today, 1);
  const presets = useMemo(() => capsulePresets(today), [today]);
  const [date, setDate] = useState(presets[3].date);
  const [once, setOnce] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= min;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const seal = () => {
    if (!valid) return;
    onSeal({ opensOn: date, ...(once && { once: true }) });
  };

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className="pk cps"
        role="dialog"
        aria-modal="true"
        aria-label="Cápsula del tiempo"
      >
        <header className="cps-head">
          <span className="cps-icon" aria-hidden="true">
            <Hourglass size={20} />
          </span>
          <div>
            <h3>Cápsula del tiempo</h3>
            <p>Se guarda sellada: no la verás, ni aparecerá en ningún lado, hasta la fecha que elijas.</p>
          </div>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="cps-body">
          <span className="cps-label">¿Cuándo se abre?</span>
          <div className="cp-chips cps-presets">
            {presets.map((p) => (
              <button
                type="button"
                key={p.label}
                className={"cp-chip" + (date === p.date ? " on" : "")}
                onClick={() => setDate(p.date)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="cps-date">
            <span>O elige el día</span>
            <input
              type="date"
              value={date}
              min={min}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <p className={"cps-when" + (valid ? "" : " bad")} role="status">
            {valid ? (
              <>
                <Lock size={13} /> Se abre el <b>{capsuleDay(date)}</b> · {countdown(date, today)}
              </>
            ) : (
              "Elige una fecha a partir de mañana."
            )}
          </p>

          <span className="cps-label">Al abrirla</span>
          <div className="cps-modes" role="radiogroup" aria-label="Qué pasa al abrirla">
            <button
              type="button"
              role="radio"
              aria-checked={!once}
              className={"cps-mode" + (!once ? " on" : "")}
              onClick={() => setOnce(false)}
            >
              <Eye size={18} />
              <span>
                <b>Se queda en tu diario</b>
                <small>Pasa a ser una entrada más, el día en que la escribiste.</small>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={once}
              className={"cps-mode" + (once ? " on" : "")}
              onClick={() => setOnce(true)}
            >
              <Flame size={18} />
              <span>
                <b>Verla una sola vez</b>
                <small>Al cerrarla después de leerla, se borra para siempre.</small>
              </span>
            </button>
          </div>
        </div>

        <footer className="cps-foot">
          <button type="button" className="cp-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="cp-btn cta" disabled={!valid} onClick={seal}>
            <Lock size={16} /> Sellar cápsula
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
