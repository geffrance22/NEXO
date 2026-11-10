import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { EntryDetails } from "../data";
import { useDismiss } from "../hooks/useDismiss";
import { MoodIcon, moodOf, moods, moodValue, type Mood } from "./moods";

/** Un ánimo de la entrada y, si quieres, su causa. */
export type Feeling = { mood: number; why?: string };

export const MAX_FEELINGS = 3;

/** Los ánimos de una entrada (las antiguas solo tienen `mood`). */
export function feelingsOf(d: EntryDetails): Feeling[] {
  const list = (d.feelings ?? [])
    .map((f) => ({ ...f, mood: moodValue(f.mood) }))
    .filter((f): f is Feeling => f.mood !== undefined);
  if (list.length) return list.slice(0, MAX_FEELINGS);
  const single = moodValue(d.mood);
  return single === undefined ? [] : [{ mood: single }];
}

/** Causas de un toque: las de siempre y unas pocas según cómo te sientes. */
const BASE = ["Trabajo", "Familia", "Pareja", "Amigos", "Salud", "Dinero", "Estudios"];
const BY_TONE: Record<number, string[]> = {
  5: ["Un logro", "Un plan", "Descanso"],
  4: ["Una idea", "Algo que leí", "Descanso"],
  3: ["Recuerdos", "El clima", "Soledad"],
  2: ["Dormí mal", "Estrés", "Pendientes"],
  1: ["Una pérdida", "Una discusión", "Estrés"],
};
const causesFor = (m: Mood) => [...BASE, ...(BY_TONE[m.tone] ?? [])];

/**
 * Hasta tres ánimos a la vez. Al elegir el primero, los demás se apagan (como en el selector de
 * uno). Debajo aparece una ficha por ánimo para contar por qué, sin ocupar espacio si no la usas.
 */
export function MoodTrio({
  value,
  onChange,
}: {
  value: Feeling[];
  onChange: (next: Feeling[]) => void;
}) {
  const [nudge, setNudge] = useState<number | null>(null);
  const full = value.length >= MAX_FEELINGS;
  const toggle = (m: Mood) => {
    if (value.some((f) => f.mood === m.value)) {
      onChange(value.filter((f) => f.mood !== m.value));
      return;
    }
    if (full) {
      setNudge(m.value);
      window.setTimeout(() => setNudge(null), 420);
      return;
    }
    onChange([...value, { mood: m.value }]);
  };
  const setWhy = (mood: number, why: string) =>
    onChange(
      value.map((f) =>
        f.mood === mood ? { mood, ...(why.trim() && { why: why.trim().slice(0, 80) }) } : f,
      ),
    );

  return (
    <div className="cp-trio">
      <div
        className={
          "cp-moods" + (value.length ? " has-value" : "") + (full ? " full" : "")
        }
        role="group"
        aria-label={`Ánimo (hasta ${MAX_FEELINGS})`}
      >
        {moods.map((m) => {
          const at = value.findIndex((f) => f.mood === m.value);
          const on = at >= 0;
          return (
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={m.label}
              key={m.value}
              className={(on ? "on" : "") + (nudge === m.value ? " nudge" : "")}
              style={{ "--mood": m.color } as CSSProperties}
              onClick={() => toggle(m)}
            >
              <MoodIcon mood={m} solid={on} className="cp-mood-icon" />
              {on && value.length > 1 && (
                <i className="cp-mood-order" aria-hidden="true">
                  {at + 1}
                </i>
              )}
              <span className="cp-mood-label" aria-hidden>
                {m.label}
              </span>
              <span className="cp-mood-tip" aria-hidden>
                {full && !on ? `Máximo ${MAX_FEELINGS}` : m.label}
              </span>
            </button>
          );
        })}
      </div>
      {value.length > 0 && (
        <div className="cp-whys">
          {value.map((f) => {
            const m = moodOf(f.mood);
            return m ? (
              <WhyChip
                key={f.mood}
                mood={m}
                why={f.why ?? ""}
                onWhy={(w) => setWhy(f.mood, w)}
              />
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

/** «¿Por qué?» de un ánimo: una ficha diminuta que se abre en un toque. */
function WhyChip({
  mood,
  why,
  onWhy,
}: {
  mood: Mood;
  why: string;
  onWhy: (why: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraftRaw] = useState(why);
  const root = useRef<HTMLSpanElement>(null);
  // Lo que escribiste se guarda también si cierras tocando fuera.
  const typed = useRef<string | null>(null);
  const setDraft = (v: string) => {
    typed.current = v;
    setDraftRaw(v);
  };
  const save = useRef(onWhy);
  save.current = onWhy;
  const close = useCallback(() => {
    if (typed.current !== null) save.current(typed.current);
    typed.current = null;
    setOpen(false);
  }, []);
  useDismiss(open, root, close);
  // La ficha mide 268 px: si el ánimo está cerca del borde, se corre hacia dentro para no
  // salirse de la ventana (y no provocar scroll horizontal).
  const pop = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const el = pop.current;
    if (!el) return;
    let box = el.parentElement?.parentElement ?? null;
    while (box && box !== document.body && getComputedStyle(box).overflowX === "visible")
      box = box.parentElement;
    const area =
      box && box !== document.body
        ? box.getBoundingClientRect()
        : { left: 0, right: document.documentElement.clientWidth };
    const r = el.getBoundingClientRect();
    const pad = 8;
    let dx = 0;
    if (r.right > area.right - pad) dx = area.right - pad - r.right;
    if (r.left + dx < area.left + pad) dx = area.left + pad - r.left;
    setShift(dx);
  }, [open]);
  const pick = (w: string) => {
    onWhy(w);
    typed.current = null;
    setDraftRaw(w);
    setOpen(false);
  };
  const causes = causesFor(mood);

  return (
    <span
      className={"cp-why" + (why ? " set" : "") + (open ? " open" : "")}
      ref={root}
      style={{ "--mood": mood.color } as CSSProperties}
    >
      <button
        type="button"
        className="cp-why-btn"
        aria-expanded={open}
        aria-label={`Por qué te sientes ${mood.label.toLowerCase()}`}
        onClick={() => {
          if (open) return close();
          typed.current = null;
          setDraftRaw(why);
          setOpen(true);
        }}
      >
        <MoodIcon mood={mood} size={20} solid />
        <span>{why || "¿por qué?"}</span>
      </button>
      {why && (
        <button
          type="button"
          className="cp-why-clear"
          aria-label="Quitar la causa"
          onClick={() => pick("")}
        >
          <X size={11} />
        </button>
      )}
      {open && (
        <span
          className="cp-why-pop"
          ref={pop}
          style={{ left: shift }}
          role="dialog"
          aria-label={`Por qué: ${mood.label}`}
        >
          <span className="cp-why-causes">
            {causes.map((c) => (
              <button
                type="button"
                key={c}
                className={why === c ? "on" : ""}
                onClick={() => pick(why === c ? "" : c)}
              >
                {c}
              </button>
            ))}
          </span>
          <input
            className="cp-why-input"
            value={draft}
            maxLength={80}
            placeholder="O dilo con tus palabras…"
            aria-label="La causa, con tus palabras"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                pick(draft);
              }
            }}
          />
        </span>
      )}
    </span>
  );
}
