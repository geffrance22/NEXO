import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Minus,
  Pencil,
  Plus,
  Target,
  Trophy,
  X,
} from 'lucide-react';
import type { Entry } from '../data';
import { kindMeta } from '../composer/kinds';
import { todayInputValue } from '../lib/format';
import { toneVars } from './Collection';
import { booksFinishedIn, finishedOn, useReadingGoals, yearProgress } from './goals';
import './readingGoal.css';

const PRESETS = [12, 24, 36, 52];
const books = (n: number) => `${n.toLocaleString('es-CO')} ${n === 1 ? 'libro' : 'libros'}`;

type Pace = {
  label: string;
  tone: 'ahead' | 'even' | 'behind' | 'done' | 'missed';
};

/** Cómo vas frente a la meta: adelantado, al día o atrasado (o cómo terminó un año pasado). */
function paceOf(done: number, goal: number, year: string, today: string) {
  const current = year === today.slice(0, 4);
  const { day, days } = yearProgress(today);
  const expected = current ? (goal * day) / days : goal;
  const left = Math.max(0, goal - done);
  let pace: Pace;
  let hint = '';
  if (done >= goal) {
    pace = { label: 'Meta cumplida', tone: 'done' };
    hint = done > goal ? `${books(done - goal)} de más` : 'Justo lo que te propusiste';
  } else if (!current) {
    pace = { label: `Faltaron ${left}`, tone: 'missed' };
  } else {
    const diff = done - expected;
    pace =
      diff >= 1
        ? { label: `${Math.floor(diff)} por delante`, tone: 'ahead' }
        : diff <= -1
          ? { label: `${Math.ceil(-diff)} por detrás`, tone: 'behind' }
          : { label: 'Al día', tone: 'even' };
    const daysLeft = days - day + 1;
    const perMonth = left / (daysLeft / 30.44);
    const rate =
      perMonth < 10 ? perMonth.toFixed(1).replace('.0', '') : String(Math.round(perMonth));
    hint =
      `Te ${left === 1 ? 'falta' : 'faltan'} ${left} · ` +
      (perMonth >= 1
        ? `unos ${rate.replace('.', ',')} al mes`
        : `uno cada ${Math.max(1, Math.round(daysLeft / 7 / left))} semanas`);
  }
  return {
    pace,
    hint,
    expected: current ? Math.min(100, (expected / goal) * 100) : null,
  };
}

/** Editor en línea de la meta: − número +, atajos y guardar. */
function GoalEditor({
  initial,
  onSave,
  onCancel,
  onRemove,
}: {
  initial: number;
  onSave: (n: number) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [n, setN] = useState(initial || 12);
  const set = (v: number) => setN(Math.max(1, Math.min(999, Math.round(v) || 1)));
  return (
    <form
      className="rg-edit"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(n);
      }}
    >
      <div className="rg-step">
        <button type="button" aria-label="Uno menos" onClick={() => set(n - 1)}>
          <Minus size={13} />
        </button>
        <input
          autoFocus
          inputMode="numeric"
          aria-label="Libros"
          value={n}
          onChange={(e) => set(Number(e.target.value.replace(/\D/g, '')))}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') (e.preventDefault(), set(n + 1));
            if (e.key === 'ArrowDown') (e.preventDefault(), set(n - 1));
            if (e.key === 'Escape') (e.stopPropagation(), onCancel());
          }}
        />
        <button type="button" aria-label="Uno más" onClick={() => set(n + 1)}>
          <Plus size={13} />
        </button>
      </div>
      <div className="rg-presets" role="group" aria-label="Atajos">
        {PRESETS.map((p) => (
          <button
            type="button"
            key={p}
            className={p === n ? 'on' : ''}
            onClick={() => setN(p)}
            title={p === 12 ? 'Uno al mes' : p === 52 ? 'Uno por semana' : undefined}
          >
            {p}
          </button>
        ))}
      </div>
      <span className="rg-edit-end">
        {onRemove && (
          <button type="button" className="rg-link" onClick={onRemove}>
            Quitar
          </button>
        )}
        <button type="button" className="rg-icon" aria-label="Cancelar" onClick={onCancel}>
          <X size={14} />
        </button>
        <button type="submit" className="rg-icon ok" aria-label="Guardar meta">
          <Check size={14} />
        </button>
      </span>
    </form>
  );
}

/**
 * Meta de lectura del año en una franja discreta: cuántos libros llevas, la barra con la marca de
 * dónde deberías ir hoy y tu ritmo. Se puede revisar años anteriores.
 */
export function ReadingGoal({ entries }: { entries: Entry[] }) {
  const { goalOf, setGoal } = useReadingGoals();
  const today = todayInputValue();
  const thisYear = today.slice(0, 4);
  const [year, setYear] = useState(thisYear);
  const [editing, setEditing] = useState(false);

  // Primer año con libros terminados: hasta ahí se puede ir hacia atrás.
  const firstYear = useMemo(() => {
    let min = thisYear;
    for (const e of entries)
      if (e.kind === 'Libro' && e.details.read === 'terminado') {
        const y = finishedOn(e).slice(0, 4);
        if (y < min) min = y;
      }
    return min;
  }, [entries, thisYear]);
  const done = useMemo(() => booksFinishedIn(entries, year).length, [entries, year]);
  const goal = goalOf(year);
  const current = year === thisYear;
  const shift = (d: number) => {
    setEditing(false);
    setYear(String(Number(year) + d));
  };
  const save = (n: number) => {
    setEditing(false);
    void setGoal(year, n);
  };

  const nav = (
    <span className="rg-years">
      <button
        type="button"
        aria-label="Año anterior"
        disabled={year <= firstYear}
        onClick={() => shift(-1)}
      >
        <ChevronLeft size={13} />
      </button>
      <b>{year}</b>
      <button type="button" aria-label="Año siguiente" disabled={current} onClick={() => shift(1)}>
        <ChevronRight size={13} />
      </button>
    </span>
  );

  let body;
  if (editing) {
    body = (
      <GoalEditor
        initial={goal || Math.max(12, done)}
        onSave={save}
        onCancel={() => setEditing(false)}
        onRemove={
          goal
            ? () => {
                setEditing(false);
                void setGoal(year, 0);
              }
            : undefined
        }
      />
    );
  } else if (!goal) {
    body = (
      <>
        <span className="rg-ask">
          {current
            ? done
              ? `Llevas ${books(done)}. ¿Te pones una meta?`
              : '¿Cuántos libros quieres leer?'
            : `Leíste ${books(done)} · sin meta`}
        </span>
        {current && (
          <div className="rg-presets" role="group" aria-label="Elegir meta">
            {PRESETS.map((p) => (
              <button type="button" key={p} onClick={() => save(p)}>
                {p}
              </button>
            ))}
            <button type="button" onClick={() => setEditing(true)}>
              Otra
            </button>
          </div>
        )}
      </>
    );
  } else {
    const { pace, hint, expected } = paceOf(done, goal, year, today);
    const percent = Math.min(100, Math.round((done / goal) * 100));
    body = (
      <>
        <span className="rg-count">
          <b>{done.toLocaleString('es-CO')}</b> de {books(goal)}
        </span>
        <span
          className={'rg-bar' + (pace.tone === 'done' ? ' done' : '')}
          role="progressbar"
          aria-label={`Meta de lectura ${year}`}
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={done}
          aria-valuetext={`${done} de ${goal} libros`}
          title={hint ? `${percent}% · ${hint}` : `${percent}%`}
        >
          <i style={{ width: percent + '%' }} />
          {expected !== null && pace.tone !== 'done' && (
            <b style={{ left: expected + '%' }} title="Donde deberías ir hoy" />
          )}
        </span>
        {hint && <span className="rg-hint">{hint}</span>}
        <span className={'rg-pace ' + pace.tone}>
          {pace.tone === 'done' && <Trophy size={11} />}
          {pace.label}
        </span>
        <button
          type="button"
          className="rg-icon"
          aria-label="Cambiar la meta"
          title="Cambiar la meta"
          onClick={() => setEditing(true)}
        >
          <Pencil size={13} />
        </button>
      </>
    );
  }

  return (
    <section
      className={'rg' + (editing ? ' editing' : '')}
      style={toneVars(kindMeta.Libro)}
      aria-label="Meta de lectura"
    >
      <span className="rg-eyebrow">
        <Target size={13} /> Meta
      </span>
      {nav}
      {body}
    </section>
  );
}

/** La meta del año en una línea (para Inicio). Solo aparece si tienes una. */
export function ReadingGoalStrip({ entries, onOpen }: { entries: Entry[]; onOpen: () => void }) {
  const { goalOf } = useReadingGoals();
  const today = todayInputValue();
  const year = today.slice(0, 4);
  const goal = goalOf(year);
  const done = useMemo(() => booksFinishedIn(entries, year).length, [entries, year]);
  if (!goal) return null;
  const { pace, expected } = paceOf(done, goal, year, today);
  const percent = Math.min(100, Math.round((done / goal) * 100));
  return (
    <button
      type="button"
      className="rg-strip"
      style={toneVars(kindMeta.Libro)}
      onClick={onOpen}
      aria-label={`Meta de lectura ${year}: ${done} de ${goal} libros. ${pace.label}.`}
    >
      <span className="rg-strip-icon">
        <Target size={15} />
      </span>
      <span className="rg-strip-main">
        <span className="rg-strip-top">
          <strong>Meta {year}</strong>
          <span>
            <b>{done}</b> de {goal} libros
          </span>
          <em className={'rg-pace ' + pace.tone}>{pace.label}</em>
        </span>
        <span className={'rg-bar sm' + (pace.tone === 'done' ? ' done' : '')} aria-hidden="true">
          <i style={{ width: percent + '%' }} />
          {expected !== null && pace.tone !== 'done' && <b style={{ left: expected + '%' }} />}
        </span>
      </span>
      <ArrowRight size={15} className="rg-strip-go" />
    </button>
  );
}
