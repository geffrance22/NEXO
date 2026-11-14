import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarRange,
  Check,
  CircleCheck,
  Clock,
  Copy,
  Feather,
  GraduationCap,
  Layers,
  ListPlus,
  Lock,
  PenLine,
  Pencil,
  PiggyBank,
  Plus,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { AutoTextarea } from '../composer/controls';
import { expenseCategories, incomeCategories } from '../composer/logic';
import type { Entry } from '../data';
import { friendlyDate, money, todayInputValue } from '../lib/format';
import { waitingParts } from './chargeActions';
import { Bars, Progress, Ring } from './charts';
import {
  budgetFor,
  dueOn,
  itemsOf,
  letterScore,
  letterWindow,
  monthActual,
  periodKeyOf,
  planHit,
  PLAN_LOCK_DAY,
  projectionTotals,
  scenarioOf,
  sureMeta,
  verdictOf,
  type FinItem,
  type PlanItem,
  type PlanSure,
  type Projection,
} from './model';
import {
  byCategory,
  daysBetween,
  dayOf,
  flowOf,
  isMoney,
  monthBounds,
  monthKey,
  monthName,
  moneyShort,
  percent,
  shiftMonth,
} from './money';
import { createItem, financeState, removeItem, restoreItem, settingsOf, updateItem, useFinance } from './store';
import { Field, FinSheet, MoneyField, moneyInput } from './ui';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthTitle = (m: string) => `${cap(monthName(m))} ${m.slice(0, 4)}`;
const lockDay = (m: string) => `${PLAN_LOCK_DAY} de ${monthName(m)}`;
const sures: PlanSure[] = ['seguro', 'probable', 'quizas'];

const blankLetter = (month: string): Projection => ({
  month,
  letter: '',
  items: [],
  hits: [],
  skip: [],
  flip: [],
  writtenOn: todayInputValue(),
});

/** Cómo le fue a una carta: lo planeado, lo real, el veredicto y su índice. */
function makeReview(fin: readonly FinItem[] | null, moves: readonly Entry[]) {
  return (l: FinItem<'proyeccion'>) => {
    const t = projectionTotals(l.data, fin);
    const a = monthActual(moves, l.data.month);
    const budget = budgetFor(fin, l.data.month).total;
    const score = letterScore({ target: t.target, income: a.income, spendTarget: t.spendTarget, spent: a.spent, budget, planned: t.planned, done: t.done });
    return { l, t, a, budget, score, v: verdictOf(a.income, t.target) };
  };
}

/** La carta del mes: tu plan con tiempo, lo que pasó de verdad y qué tan cerca estuviste. */
export function LetterTab() {
  const { workspace } = useApp();
  const fin = useFinance();
  const today = todayInputValue();
  const day = Number(today.slice(8));
  const thisMonth = monthKey(today);
  const nextMonth = shiftMonth(thisMonth, 1);
  const letters = itemsOf(fin.items, 'proyeccion').sort((a, b) => b.data.month.localeCompare(a.data.month));
  const byMonth = new Map(letters.map((l) => [l.data.month, l]));
  const nowOpen = letterWindow(thisMonth, today).editable;
  const [month, setMonth] = useState(() =>
    day <= PLAN_LOCK_DAY ? thisMonth : day >= 20 || !byMonth.has(thisMonth) ? nextMonth : thisMonth,
  );
  const [all, setAll] = useState(false);
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const review = makeReview(fin.items, moves);

  // De la más antigua a la más nueva: tus últimas 6 cartas escritas, la de este mes si aún se puede
  // escribir y la del mes que viene. Las anteriores, en «Ver todas».
  const written = letters
    .map((l) => l.data.month)
    .filter((m) => m <= thisMonth)
    .sort();
  const rail = [...new Set([...written.slice(-6), ...(nowOpen ? [thisMonth] : []), nextMonth, month])].sort();
  const older = Math.max(0, written.length - 6);
  const item = byMonth.get(month) ?? null;

  const past = letters.filter((l) => l.data.month < thisMonth).map(review).filter((x) => x.t.target > 0 || x.score);
  const ratios = past.filter((x) => x.t.target > 0).map((x) => x.a.income / x.t.target);
  const avg = ratios.length ? ratios.reduce((s, r) => s + r, 0) / ratios.length : null;
  const scores = past.map((x) => x.score?.score).filter((x): x is number => typeof x === 'number');
  const avgScore = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null;

  return (
    <div className="fz-letters">
      <nav className="fz-rail" aria-label="Cartas por mes">
        {older > 0 && (
          <button type="button" className="fz-rail-more" onClick={() => setAll(true)} title="Ver todas tus cartas">
            <CalendarRange size={16} />
            <small>+{older} anteriores</small>
          </button>
        )}
        {rail.map((m) => {
          const l = byMonth.get(m);
          const w = letterWindow(m, today);
          const r = l && m <= thisMonth ? review(l) : null;
          const status = !l
            ? w.editable
              ? 'Escribir'
              : 'Sin carta'
            : m > thisMonth
              ? 'Planeando'
              : m === thisMonth
                ? w.editable
                  ? `Ajustas hasta el ${PLAN_LOCK_DAY}`
                  : 'En curso'
                : r?.score
                  ? r.score.label
                  : l.data.closedOn
                    ? 'Cerrada'
                    : 'Sin cifras';
          return (
            <button
              type="button"
              key={m}
              className={(m === month ? 'on' : '') + (l ? '' : ' empty') + (m > thisMonth ? ' next' : '') + (!l && !w.editable ? ' dead' : '')}
              onClick={() => setMonth(m)}
            >
              <span>
                {cap(monthName(m))}
                {m.slice(0, 4) !== today.slice(0, 4) && ` ${m.slice(2, 4)}`}
              </span>
              <small>
                {!l && w.editable && <Plus size={11} />}
                {status}
              </small>
              {r && m < thisMonth && r.score ? (
                <em className={'fz-rail-score ' + r.score.tone}>{r.score.score}</em>
              ) : r && r.t.target > 0 ? (
                <i className="fz-rail-bar">
                  <i style={{ width: Math.min(100, (r.a.income / r.t.target) * 100) + '%' }} />
                </i>
              ) : null}
            </button>
          );
        })}
      </nav>

      <LetterView key={month} month={month} item={item} onGo={setMonth} />

      {past.length > 0 && (
        <section className="fz-card fz-aim">
          <header className="fz-card-head">
            <h3>
              <Target size={15} /> Tu puntería
            </h3>
            <span className="fz-aim-avg">
              {avgScore !== null && <b>Índice promedio {avgScore}</b>}
              {avg !== null &&
                (avg >= 1.03
                  ? ` · Sueles quedarte corto: entra un ${percent(avg - 1)} más de lo que proyectas.`
                  : avg <= 0.97
                    ? ` · Sueles proyectar de más: llega el ${percent(avg)} de lo que esperas.`
                    : ' · Sueles atinarle: tus cartas son realistas.')}
            </span>
          </header>
          <Bars
            data={[...past]
              .reverse()
              .slice(-12)
              .map((x) => ({
                key: x.l.id,
                label: monthName(x.l.data.month).slice(0, 3),
                value: x.t.target,
                value2: x.a.income,
                tip: `${monthTitle(x.l.data.month)} · proyectaste ${money(x.t.target)} · llegó ${money(x.a.income)}${x.score ? ` · índice ${x.score.score}` : ''}`,
              }))}
            color="#c9cfbf"
            color2="var(--fz-in)"
            height={110}
          />
        </section>
      )}

      {all && (
        <AllMonths
          letters={letters}
          review={review}
          today={today}
          onPick={(m) => {
            setMonth(m);
            setAll(false);
          }}
          onClose={() => setAll(false)}
        />
      )}
    </div>
  );
}

/** Todas tus cartas, por año. */
function AllMonths({
  letters,
  review,
  today,
  onPick,
  onClose,
}: {
  letters: FinItem<'proyeccion'>[];
  review: ReturnType<typeof makeReview>;
  today: string;
  onPick: (m: string) => void;
  onClose: () => void;
}) {
  const thisMonth = monthKey(today);
  // Solo las cartas que escribiste: el año más reciente arriba, sus meses de enero a diciembre.
  const years = new Map<string, FinItem<'proyeccion'>[]>();
  for (const l of [...letters].sort((a, b) => a.data.month.localeCompare(b.data.month))) {
    const y = l.data.month.slice(0, 4);
    years.set(y, [...(years.get(y) ?? []), l]);
  }
  return (
    <FinSheet
      wide
      icon={<CalendarRange size={18} />}
      title="Todas tus cartas"
      sub={`${letters.length} ${letters.length === 1 ? 'carta escrita' : 'cartas escritas'}`}
      onClose={onClose}
    >
      {[...years.entries()].reverse().map(([y, list]) => (
        <section key={y} className="fz-allm">
          <h4 className="fz-sub">{y}</h4>
          <div className="fz-allm-grid">
            {list.map((l) => {
              const m = l.data.month;
              const r = m <= thisMonth ? review(l) : null;
              return (
                <button type="button" key={m} className="fz-allm-tile" onClick={() => onPick(m)}>
                  <span>{cap(monthName(m))}</span>
                  {r?.score && m < thisMonth ? (
                    <em className={'fz-rail-score ' + r.score.tone}>{r.score.score}</em>
                  ) : (
                    <small>{m > thisMonth ? 'Planeando' : m === thisMonth ? 'En curso' : l.data.closedOn ? 'Cerrada' : 'Sin cifras'}</small>
                  )}
                  {r && r.t.target > 0 && (
                    <small>
                      {moneyShort(r.t.target)} → <b>{moneyShort(r.a.income)}</b>
                    </small>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </FinSheet>
  );
}

type Draft = { id?: string; dir: 'in' | 'out'; amount: number; text: string; source: string; category: string; sure: PlanSure; on: string };
const emptyDraft = (dir: 'in' | 'out' = 'in', sure: PlanSure = 'seguro'): Draft => ({ dir, amount: 0, text: '', source: '', category: '', sure, on: '' });

function LetterView({ month, item, onGo }: { month: string; item: FinItem<'proyeccion'> | null; onGo: (m: string) => void }) {
  const { workspace, notify, createEntry, confirm, viewEntry } = useApp();
  const fin = useFinance();
  const today = todayInputValue();
  const thisMonth = monthKey(today);
  const nextMonth = shiftMonth(thisMonth, 1);
  const prevMonth = shiftMonth(month, -1);
  const data = item?.data ?? blankLetter(month);
  const win = letterWindow(month, today);
  const closed = Boolean(data.closedOn);
  const editable = win.editable && !closed;
  const [text, setText] = useState(data.letter);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const creating = useRef<Promise<unknown> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(item);
  latest.current = item;

  const current = () => itemsOf(financeState().items, 'proyeccion').find((l) => l.data.month === month) ?? latest.current;
  /** Guarda cambios de la carta (la crea la primera vez que escribes algo). */
  const persist = async (patch: Partial<Projection> | ((d: Projection) => Partial<Projection>)) => {
    setSaved('saving');
    if (creating.current) await creating.current;
    const cur = current();
    const p = typeof patch === 'function' ? patch(cur?.data ?? blankLetter(month)) : patch;
    let r: unknown;
    if (cur) r = await updateItem(cur, { data: p });
    else {
      const made = createItem('proyeccion', `Carta de ${monthTitle(month)}`, { ...blankLetter(month), ...p });
      creating.current = made;
      r = await made;
      creating.current = null;
    }
    if (typeof r === 'string') {
      notify(r);
      setSaved('idle');
    } else setSaved('saved');
  };

  useEffect(() => {
    if (text === data.letter || !editable) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist({ letter: text }), 700);
    return () => window.clearTimeout(timer.current);
  }, [text]);

  const live: Projection = { ...data, letter: text };
  const t = projectionTotals(live, fin.items);
  const started = month <= thisMonth;
  const ended = month < thisMonth;
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const actual = monthActual(moves, month);
  const { from, to } = monthBounds(month);
  const daysIn = Number(to.slice(8));
  const elapsed = ended ? daysIn : started ? Number(today.slice(8)) : 0;
  const verdict = verdictOf(actual.income, t.target);
  const budget = budgetFor(fin.items, month);
  const general = settingsOf(fin.items).monthBudget;
  const hitOf = (i: PlanItem) => planHit(i, fin.items, month);

  // Movimientos del mes que parecen ser una línea del plan.
  const monthMoves = moves.filter((e) => {
    const d = dayOf(e);
    return d >= from && d <= to && !e.details.pending;
  });
  const usedIds = new Set(data.items.map((i) => i.entryId).filter(Boolean));
  const suggestFor = (amount: number, dir: 'in' | 'out') =>
    monthMoves.find((e) => {
      if (usedIds.has(e.id)) return false;
      const f = flowOf(e);
      const ok = dir === 'in' ? f === 'ingreso' : f === 'gasto' || f === 'ahorro';
      return ok && Math.abs(e.amount - amount) <= amount * 0.12;
    });

  const toggleIn = (list: 'hits' | 'skip' | 'flip', key: string) =>
    void persist((d) => ({ [list]: d[list].includes(key) ? d[list].filter((k) => k !== key) : [...d[list], key] }));
  const setNum = (key: 'low' | 'mid' | 'high' | 'spend', v: number) => void persist({ [key]: v || undefined });

  // ── El plan en líneas.
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [more, setMore] = useState(false);
  const saveDraft = () => {
    if (!(draft.amount > 0) || !draft.text.trim()) return;
    const row: PlanItem = {
      id: draft.id ?? crypto.randomUUID(),
      dir: draft.dir,
      amount: draft.amount,
      text: draft.text.trim().slice(0, 200),
      source: draft.source.trim() || undefined,
      category: draft.category || undefined,
      sure: draft.dir === 'in' ? draft.sure : 'seguro',
      on: draft.on || undefined,
    };
    void persist((d) => ({
      items: draft.id ? d.items.map((i) => (i.id === draft.id ? { ...i, ...row, hit: i.hit, entryId: i.entryId, ref: i.ref } : i)) : [...d.items, row],
    }));
    setDraft(emptyDraft(draft.dir, draft.sure));
  };
  const editRow = (i: PlanItem) => {
    setDraft({ id: i.id, dir: i.dir, amount: i.amount, text: i.text, source: i.source ?? '', category: i.category ?? '', sure: i.sure, on: i.on ?? '' });
    setMore(Boolean(i.source || i.category || i.on));
  };
  const patchRow = (id: string, p: Partial<PlanItem>) => void persist((d) => ({ items: d.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  const dropRow = (id: string) => void persist((d) => ({ items: d.items.filter((i) => i.id !== id) }));
  const addRows = (rows: PlanItem[], what: string) => {
    if (!rows.length) return notify(`No hay ${what} nuevos para agregar.`);
    void persist((d) => ({ items: [...d.items, ...rows] }));
    notify(`${rows.length} ${rows.length === 1 ? 'línea agregada' : 'líneas agregadas'} desde ${what}.`);
  };

  const refs = new Set(data.items.map((i) => i.ref).filter(Boolean));
  const fixed = itemsOf(fin.items, 'recurrente').filter(
    (r) => !r.archived && !r.data.paused && (r.data.every === 'mes' || r.data.month === Number(month.slice(5, 7))),
  );
  const bringFixed = () =>
    addRows(
      fixed
        .filter((r) => !refs.has('rec:' + r.id))
        .map((r) => ({
          id: crypto.randomUUID(),
          dir: r.data.dir === 'ingreso' ? ('in' as const) : ('out' as const),
          amount: r.data.amount,
          text: r.title,
          source: r.data.method,
          category: r.data.category,
          sure: 'seguro' as const,
          on: dueOn(r.data, periodKeyOf(r.data, month + '-01')),
          ref: 'rec:' + r.id,
        })),
      'tus fijos',
    );
  const parts = waitingParts(fin.items).filter((x) => x.part.due >= from && x.part.due <= to);
  const bringParts = () =>
    addRows(
      parts
        .filter((x) => !refs.has(`part:${x.charge.id}:${x.part.id}`))
        .map((x) => ({
          id: crypto.randomUUID(),
          dir: 'in' as const,
          amount: x.part.amount,
          text: x.charge.title,
          source: x.charge.data.who,
          category: x.charge.data.category,
          sure: 'probable' as const,
          on: x.part.due,
          ref: `part:${x.charge.id}:${x.part.id}`,
        })),
      'tus cobros por partes',
    );
  const prevLetter = itemsOf(fin.items, 'proyeccion').find((l) => l.data.month === prevMonth);
  const copyPrev = () =>
    addRows(
      (prevLetter?.data.items ?? [])
        .filter((i) => !i.ref?.startsWith('part:'))
        .map((i) => ({
          ...i,
          id: crypto.randomUUID(),
          hit: undefined,
          entryId: undefined,
          on: i.on ? `${month}-${String(Math.min(Number(i.on.slice(8)), daysIn)).padStart(2, '0')}` : undefined,
        })),
      `la carta de ${monthName(prevMonth)}`,
    );

  // ── Presupuesto de este mes.
  const [budgetEdit, setBudgetEdit] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState(data.budget ?? general ?? 0);

  // ── Cerrar el mes.
  const [reflection, setReflection] = useState(data.reflection ?? '');
  const [asLearning, setAsLearning] = useState(true);
  const score = letterScore({
    target: t.target,
    income: actual.income,
    spendTarget: t.spendTarget,
    spent: actual.spent,
    budget: budget.total,
    planned: t.planned,
    done: t.done,
  });
  const closeMonth = async () => {
    let learningId = data.learningId;
    if (asLearning && reflection.trim() && !learningId) {
      const summary = [
        `Proyecté ${money(t.target)} de ingresos y entraron ${money(actual.income)}${verdict ? ` (${verdict.label.toLowerCase()})` : ''}.`,
        t.spendTarget ? `Pensé gastar ${money(t.spendTarget)} y gasté ${money(actual.spent)}.` : '',
        score ? `Índice del mes: ${score.score} (${score.label.toLowerCase()}).` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const e = await createEntry(
        {
          ...moneyInput({ title: `Lo que aprendí de mi carta de ${monthName(month)}`, amount: 0, direction: 'egreso' }),
          kind: 'Aprendizaje',
          body: `${reflection.trim()}\n\n${summary}`,
          tags: ['finanzas'],
          details: { source: 'Experiencia', apply: 'En la carta del próximo mes' },
        },
        true,
      );
      learningId = e?.id;
    }
    // El presupuesto con el que se vivió el mes queda guardado en su carta.
    await persist({ reflection: reflection.trim() || undefined, closedOn: today, learningId, budget: data.budget ?? (general || undefined) });
    notify(learningId ? 'Mes cerrado. Quedó también como aprendizaje.' : 'Mes cerrado.');
  };

  const remove = async () => {
    if (!item) return;
    const ok = await confirm({ title: '¿Eliminar esta carta?', message: 'Podrás deshacerlo justo después.', confirmLabel: 'Eliminar', danger: true, icon: 'trash' });
    if (!ok) return;
    const r = await removeItem(item);
    if (r !== true) return notify(r);
    setText('');
    notify('Carta eliminada.', { label: 'Deshacer', run: () => void restoreItem(item) });
  };

  // ── Lo que dice el mes (al cerrar o en los últimos días).
  const notes = useMemo(() => {
    if (!started) return [];
    const out: string[] = [];
    if (t.target > 0) {
      const d = actual.income - t.target;
      out.push(`Entró el ${percent(actual.income / t.target)} de tu realista${d >= 0 ? `: ${money(d)} más de lo esperado.` : `: faltaron ${money(-d)}.`}`);
    }
    if (t.spendTarget > 0)
      out.push(
        actual.spent <= t.spendTarget
          ? `Gastaste ${money(t.spendTarget - actual.spent)} menos de lo que pensabas.`
          : `Gastaste ${money(actual.spent - t.spendTarget)} más de lo planeado (${percent(actual.spent / t.spendTarget - 1)}).`,
      );
    if (budget.total > 0) out.push(`Del presupuesto usaste el ${percent(actual.spent / budget.total)}.`);
    if (t.planned > 0) out.push(`Se cumplieron ${t.done} de ${t.planned} cosas de tu plan.`);
    const missed = data.items.filter((i) => i.dir === 'in' && !hitOf(i));
    if (ended && missed.length)
      out.push(`No llegó: ${missed.slice(0, 2).map((i) => `«${i.text}» (${moneyShort(i.amount)})`).join(' y ')}${missed.length > 2 ? ` y ${missed.length - 2} más` : ''}.`);
    const planned = new Map<string, number>();
    for (const i of data.items) if (i.dir === 'out' && i.category) planned.set(i.category, (planned.get(i.category) ?? 0) + i.amount);
    if (planned.size) {
      const real = byCategory(monthMoves);
      const worst = real
        .map((c) => ({ c, over: c.total - (planned.get(c.name) ?? 0) }))
        .filter((x) => x.over > 0)
        .sort((a, b) => b.over - a.over)[0];
      if (worst)
        out.push(
          planned.has(worst.c.name)
            ? `Lo que más se desvió: ${worst.c.name}, ${money(worst.over)} sobre lo planeado.`
            : `No planeaste ${worst.c.name} y se fueron ${money(worst.c.total)}.`,
        );
    }
    const prev = itemsOf(fin.items, 'proyeccion').find((l) => l.data.month === prevMonth);
    if (prev && score) {
      const pt = projectionTotals(prev.data, fin.items);
      const pa = monthActual(moves, prevMonth);
      const ps = letterScore({ target: pt.target, income: pa.income, spendTarget: pt.spendTarget, spent: pa.spent, budget: budgetFor(fin.items, prevMonth).total, planned: pt.planned, done: pt.done });
      if (ps && ps.score !== score.score)
        out.push(`${score.score > ps.score ? 'Subiste' : 'Bajaste'} ${Math.abs(score.score - ps.score)} puntos frente a ${monthName(prevMonth)}.`);
    }
    return out.slice(0, 6);
  }, [started, ended, t.target, t.spendTarget, t.planned, t.done, actual.income, actual.spent, budget.total, data.items, monthMoves, fin.items, score?.score]);

  const ins = data.items.filter((i) => i.dir === 'in');
  const outs = data.items.filter((i) => i.dir === 'out');
  const showScore = started && score && (ended || closed || Number(today.slice(8)) >= daysIn - 2);
  const lockedNoLetter = !item && !win.editable;

  const Row = (i: PlanItem) => {
    const hit = hitOf(i);
    const hint = started && !hit && !i.entryId ? suggestFor(i.amount, i.dir) : undefined;
    const linked = i.entryId ? workspace.entries.find((e) => e.id === i.entryId) : undefined;
    return (
      <li key={i.id} className={i.dir + (hit ? ' hit' : '') + (draft.id === i.id ? ' editing' : '')}>
        <span className={'fz-line-dir ' + i.dir}>{i.dir === 'in' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}</span>
        <span className="fz-plan-text">
          <b>{i.text}</b>
          {(i.source || i.on || i.category || i.dir === 'in') && (
            <small>
              {i.dir === 'in' && (
                <button
                  type="button"
                  className={'fz-sure ' + i.sure}
                  disabled={!editable}
                  title={editable ? 'Toca para cambiar qué tan seguro es' : sureMeta[i.sure].hint}
                  onClick={() => patchRow(i.id, { sure: sures[(sures.indexOf(i.sure) + 1) % sures.length] })}
                >
                  {sureMeta[i.sure].label}
                </button>
              )}
              {i.source && <span>{i.source}</span>}
              {i.on && <span>{friendlyDate(i.on).toLowerCase()}</span>}
              {i.category && <span>{i.category}</span>}
              {i.ref?.startsWith('rec:') && <span className="fz-chip muted">Fijo</span>}
              {i.ref?.startsWith('part:') && <span className="fz-chip muted">Cobro</span>}
            </small>
          )}
          {hint && (
            <button type="button" className="fz-line-hint" onClick={() => patchRow(i.id, { hit: true, entryId: hint.id })}>
              ¿Es «{hint.title}» del {friendlyDate(dayOf(hint)).toLowerCase()}? <Check size={11} />
            </button>
          )}
          {linked && (
            <button type="button" className="fz-line-hint" onClick={() => viewEntry(linked)}>
              Se cumplió con «{linked.title}»
            </button>
          )}
        </span>
        <b className="fz-plan-amount">{money(i.amount)}</b>
        <span className="fz-plan-tools">
          {started && (
            <button
              type="button"
              className={'fz-line-hit' + (hit ? ' on' : '')}
              title={i.dir === 'in' ? 'Ya llegó' : 'Ya lo pagué'}
              aria-pressed={hit}
              disabled={hit && !i.hit}
              onClick={() => patchRow(i.id, { hit: !i.hit || undefined, ...(i.hit && { entryId: undefined }) })}
            >
              <CircleCheck size={16} />
            </button>
          )}
          {editable && (
            <>
              <button type="button" className="fz-icon" aria-label="Editar" title="Editar" onClick={() => editRow(i)}>
                <Pencil size={13} />
              </button>
              <button type="button" className="fz-icon" aria-label="Quitar" title="Quitar" onClick={() => dropRow(i.id)}>
                <X size={14} />
              </button>
            </>
          )}
        </span>
      </li>
    );
  };

  const cats = draft.dir === 'in' ? incomeCategories.filter((c) => c !== 'Reembolso') : expenseCategories;
  const daysToLock = daysBetween(today, win.until);

  return (
    <div className="fz-letter">
      {lockedNoLetter ? (
        <div className="fz-letter-status cerrada">
          <Lock size={15} />
          <p>
            <b>No escribiste la carta de {monthName(month)}</b> y su plazo pasó (el {lockDay(month)}).
          </p>
          {month <= thisMonth && (
            <button type="button" className="fz-btn soft sm" onClick={() => onGo(nextMonth)}>
              Escribir la de {monthName(nextMonth)}
            </button>
          )}
        </div>
      ) : (
        <div className="fz-letter-grid">
          <article className={'fz-paper' + (!editable ? ' closed' : '')}>
            <header>
              <span>
                <Feather size={14} /> Carta a mi yo de {monthName(month)}
              </span>
              <small>
                {saved === 'saving'
                  ? 'Guardando…'
                  : saved === 'saved'
                    ? 'Guardado'
                    : data.writtenOn
                      ? `Escrita el ${friendlyDate(data.writtenOn).toLowerCase()}`
                      : ''}
              </small>
            </header>
            <p className={'fz-paper-window ' + (closed ? 'closed' : win.state)}>
              {closed ? (
                <>
                  <Lock size={12} /> Mes cerrado el {friendlyDate(data.closedOn!).toLowerCase()}.
                </>
              ) : win.state === 'planear' ? (
                <>
                  <PenLine size={12} /> Puedes escribirla y ajustarla hasta el {lockDay(month)}.
                </>
              ) : win.state === 'ajustar' ? (
                <>
                  <Clock size={12} /> {daysToLock === 0 ? 'Hoy es el último día' : `Te quedan ${daysToLock + 1} días`} para ajustarla (hasta el{' '}
                  {lockDay(month)}).
                </>
              ) : month === thisMonth ? (
                <>
                  <Lock size={12} /> Fija desde el {lockDay(month)}: ahora marca lo que va pasando.
                </>
              ) : (
                <>
                  <Lock size={12} /> {cap(monthName(month))} terminó: mira cómo te fue y ciérralo.
                </>
              )}
            </p>
            <AutoTextarea
              className="fz-paper-text"
              minRows={14}
              value={text}
              maxLength={12000}
              readOnly={!editable}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                editable
                  ? `Querido yo de ${monthName(month)}:\n\nEste mes quiero cerrar el proyecto con Andrés y por fin arrancar el ahorro del viaje.\nEspero cobrar 2,5 millones y el sueldo de 3,2 millones.\nVoy a pagar el arriendo, 1,2 millones…`
                  : 'Sin carta escrita.'
              }
              aria-label="Tu carta del mes"
            />
            {item && editable && (
              <footer>
                <span />
                <button type="button" className="fz-icon" aria-label="Eliminar carta" title="Eliminar carta" onClick={() => void remove()}>
                  <Trash2 size={14} />
                </button>
              </footer>
            )}
          </article>

          <div className="fz-letter-side">
            <section className="fz-card fz-plan-sum">
              <div className="fz-plan-sum-grid">
                <div>
                  <span>Entra</span>
                  <b className="in">{moneyShort(t.income)}</b>
                  {t.income > 0 && (t.inProb > 0 || t.inMaybe > 0) && (
                    <i className="fz-sure-bar" title={`Seguro ${money(t.inSure)} · Probable ${money(t.inProb)} · Quizás ${money(t.inMaybe)}`}>
                      <i className="seguro" style={{ width: (t.inSure / t.income) * 100 + '%' }} />
                      <i className="probable" style={{ width: (t.inProb / t.income) * 100 + '%' }} />
                      <i className="quizas" style={{ width: (t.inMaybe / t.income) * 100 + '%' }} />
                    </i>
                  )}
                </div>
                <div>
                  <span>Sale</span>
                  <b className="out">{moneyShort(t.spend)}</b>
                </div>
                <div>
                  <span>Neto</span>
                  <b className={t.income - t.spend < 0 ? 'out' : ''}>{moneyShort(t.income - t.spend)}</b>
                </div>
              </div>
              <div className="fz-plan-budget">
                <span className="fz-plan-budget-label">
                  <PiggyBank size={14} /> Presupuesto de {monthName(month)}
                  {budget.from && <em className="fz-chip muted">{budget.from === 'mes' ? 'propio' : 'general'}</em>}
                </span>
                {budgetEdit && editable ? (
                  <span className="fz-plan-budget-edit">
                    <MoneyField value={budgetDraft} onChange={setBudgetDraft} autoFocus ariaLabel={`Presupuesto de ${monthName(month)}`} />
                    <button
                      type="button"
                      className="fz-btn primary sm"
                      onClick={() => {
                        void persist({ budget: budgetDraft || undefined });
                        setBudgetEdit(false);
                      }}
                    >
                      Guardar
                    </button>
                    {data.budget ? (
                      <button
                        type="button"
                        className="fz-icon"
                        title="Volver al general de Ajustes"
                        onClick={() => {
                          void persist({ budget: undefined });
                          setBudgetEdit(false);
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                    <button type="button" className="fz-icon" aria-label="Cancelar" onClick={() => setBudgetEdit(false)}>
                      <X size={14} />
                    </button>
                  </span>
                ) : (
                  <span className="fz-plan-budget-value">
                    <b>{budget.total ? money(budget.total) : 'Sin definir'}</b>
                    {editable && (
                      <button
                        type="button"
                        className="fz-btn soft sm"
                        onClick={() => {
                          setBudgetDraft(data.budget ?? (t.spend || general || 0));
                          setBudgetEdit(true);
                        }}
                      >
                        {data.budget ? 'Cambiar' : 'Definir'}
                      </button>
                    )}
                  </span>
                )}
                {budget.total > 0 && t.spend > 0 && !budgetEdit && (
                  <small className={t.spend > budget.total ? 'bad' : 'good'}>
                    {t.spend > budget.total
                      ? `Lo que piensas gastar se pasa ${moneyShort(t.spend - budget.total)}.`
                      : `Lo que piensas gastar cabe: sobran ${moneyShort(budget.total - t.spend)}.`}
                  </small>
                )}
              </div>
            </section>

            <section className="fz-card fz-plan">
              <header className="fz-card-head">
                <h3>
                  <Sparkles size={15} /> Tu plan
                </h3>
                {editable && (
                  <span className="fz-row-tools">
                    {fixed.length > 0 && (
                      <button type="button" className="fz-btn ghost sm" onClick={bringFixed} title="Agrega tus fijos y suscripciones como líneas">
                        <ListPlus size={13} /> Fijos
                      </button>
                    )}
                    {parts.length > 0 && (
                      <button type="button" className="fz-btn ghost sm" onClick={bringParts} title="Lo que esperas de tus cobros por partes este mes">
                        <Layers size={13} /> Cobros
                      </button>
                    )}
                    {(prevLetter?.data.items.length ?? 0) > 0 && (
                      <button type="button" className="fz-btn ghost sm" onClick={copyPrev} title={`Copia las líneas de ${monthName(prevMonth)}`}>
                        <Copy size={13} /> {cap(monthName(prevMonth))}
                      </button>
                    )}
                  </span>
                )}
              </header>

              {editable && (
                <div className={'fz-plan-add ' + draft.dir + (draft.id ? ' editing' : '')}>
                  <div className="fz-plan-add-row">
                    <div className="fz-plan-dir" role="radiogroup" aria-label="Entra o sale">
                      <button type="button" role="radio" aria-checked={draft.dir === 'in'} className={draft.dir === 'in' ? 'on in' : ''} onClick={() => setDraft({ ...draft, dir: 'in' })}>
                        <ArrowDownLeft size={13} /> Entra
                      </button>
                      <button type="button" role="radio" aria-checked={draft.dir === 'out'} className={draft.dir === 'out' ? 'on out' : ''} onClick={() => setDraft({ ...draft, dir: 'out' })}>
                        <ArrowUpRight size={13} /> Sale
                      </button>
                    </div>
                    <MoneyField value={draft.amount} onChange={(amount) => setDraft({ ...draft, amount })} ariaLabel="Monto" />
                  </div>
                  <div className="fz-plan-add-row two">
                    <input
                      className="fz-input"
                      value={draft.text}
                      maxLength={200}
                      placeholder={draft.dir === 'in' ? '¿Qué entra? Sueldo, pago del cliente…' : '¿En qué? Arriendo, mercado, tarjeta…'}
                      aria-label="Descripción"
                      onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && saveDraft()}
                    />
                    <button type="button" className="fz-btn primary" disabled={!(draft.amount > 0) || !draft.text.trim()} onClick={saveDraft}>
                      {draft.id ? <Check size={15} /> : <Plus size={15} />} {draft.id ? 'Guardar' : 'Agregar'}
                    </button>
                    {draft.id && (
                      <button type="button" className="fz-icon" aria-label="Cancelar" title="Cancelar" onClick={() => setDraft(emptyDraft(draft.dir))}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="fz-plan-add-more">
                    {draft.dir === 'in' && (
                      <div className="fz-sures" role="radiogroup" aria-label="Qué tan seguro">
                        {sures.map((s) => (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={draft.sure === s}
                            key={s}
                            className={'fz-sure ' + s + (draft.sure === s ? ' on' : '')}
                            title={sureMeta[s].hint}
                            onClick={() => setDraft({ ...draft, sure: s })}
                          >
                            {sureMeta[s].label}
                          </button>
                        ))}
                      </div>
                    )}
                    {!more && (
                      <button type="button" className="fz-link" onClick={() => setMore(true)}>
                        + de dónde, categoría y fecha
                      </button>
                    )}
                  </div>
                  {more && (
                    <div className="fz-plan-add-extra">
                      <input
                        className="fz-input"
                        value={draft.source}
                        maxLength={80}
                        placeholder={draft.dir === 'in' ? '¿De dónde? Empresa, cliente…' : '¿Cómo lo pagas? Tarjeta, efectivo…'}
                        aria-label="De dónde o cómo"
                        onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                      />
                      <select className="fz-input" value={draft.category} aria-label="Categoría" onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                        <option value="">Categoría</option>
                        {cats.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      <input className="fz-input" type="date" value={draft.on} min={from} max={to} aria-label="¿Cuándo?" onChange={(e) => setDraft({ ...draft, on: e.target.value })} />
                    </div>
                  )}
                </div>
              )}

              {data.items.length > 0 ? (
                <>
                  {ins.length > 0 && (
                    <div className="fz-plan-group">
                      <h4>
                        Lo que entrará <b className="in">{money(ins.reduce((s, i) => s + i.amount, 0))}</b>
                      </h4>
                      <ul className="fz-plan-list">{ins.map(Row)}</ul>
                    </div>
                  )}
                  {outs.length > 0 && (
                    <div className="fz-plan-group">
                      <h4>
                        Lo que saldrá <b className="out">{money(outs.reduce((s, i) => s + i.amount, 0))}</b>
                      </h4>
                      <ul className="fz-plan-list">{outs.map(Row)}</ul>
                    </div>
                  )}
                </>
              ) : (
                !t.lines.length && (
                  <p className="fz-muted">
                    {editable
                      ? 'Agrega lo que esperas que entre y lo que piensas gastar. También puedes escribirlo en la carta: los montos se detectan solos.'
                      : 'Esta carta no tiene líneas.'}
                  </p>
                )
              )}

              {t.lines.length > 0 && (
                <div className="fz-plan-group">
                  <h4>
                    Detectado en tu carta <small>(cuenta como seguro)</small>
                  </h4>
                  <ul className="fz-lines">
                    {t.lines.map((l) => {
                      const hint = started && !l.hit && !l.off ? suggestFor(l.amount, l.dir) : undefined;
                      return (
                        <li key={l.key} className={(l.off ? 'off' : '') + (l.hit ? ' hit' : '')}>
                          <button
                            type="button"
                            className={'fz-line-dir ' + l.dir}
                            disabled={!editable}
                            title={l.dir === 'in' ? 'Entra (toca para cambiar)' : 'Sale (toca para cambiar)'}
                            onClick={() => toggleIn('flip', l.key)}
                          >
                            {l.dir === 'in' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                          </button>
                          <span className="fz-line-text" title={l.text}>
                            {l.text}
                            {hint && (
                              <button type="button" className="fz-line-hint" onClick={() => toggleIn('hits', l.key)}>
                                ¿Es «{hint.title}» del {friendlyDate(dayOf(hint)).toLowerCase()}? <Check size={11} />
                              </button>
                            )}
                          </span>
                          <b>{moneyShort(l.amount)}</b>
                          {started && (
                            <button
                              type="button"
                              className={'fz-line-hit' + (l.hit ? ' on' : '')}
                              title={l.dir === 'in' ? 'Ya llegó' : 'Ya lo pagué'}
                              aria-pressed={l.hit}
                              onClick={() => toggleIn('hits', l.key)}
                            >
                              <CircleCheck size={15} />
                            </button>
                          )}
                          <input type="checkbox" checked={!l.off} disabled={!editable} title="Cuenta en la proyección" aria-label="Cuenta" onChange={() => toggleIn('skip', l.key)} />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>

            <section className="fz-card">
              <header className="fz-card-head">
                <h3>
                  <Target size={15} /> Escenarios
                </h3>
              </header>
              {editable ? (
                <>
                  <div className="fz-form three">
                    <Field label="Mínimo">
                      <MoneyField value={data.low ?? 0} onChange={(v) => setNum('low', v)} placeholder={t.inSure && t.inSure !== t.income ? moneyShort(t.inSure).replace('$', '') : '0'} />
                    </Field>
                    <Field label="Realista">
                      <MoneyField value={data.mid ?? 0} onChange={(v) => setNum('mid', v)} placeholder={t.target ? moneyShort(t.target).replace('$', '') : '0'} />
                    </Field>
                    <Field label="Ideal">
                      <MoneyField value={data.high ?? 0} onChange={(v) => setNum('high', v)} placeholder={t.inMaybe ? moneyShort(t.income).replace('$', '') : '0'} />
                    </Field>
                    <Field label="Pienso gastar" wide>
                      <MoneyField value={data.spend ?? 0} onChange={(v) => setNum('spend', v)} placeholder={t.spend ? moneyShort(t.spend).replace('$', '') : '0'} />
                    </Field>
                  </div>
                  <small className="fz-muted fz-scen-hint">Vacíos, salen solos de tu plan y de qué tan seguro es cada ingreso.</small>
                </>
              ) : (
                <dl className="fz-scen">
                  <div>
                    <dt>Mínimo</dt>
                    <dd>{t.low ? moneyShort(t.low) : '—'}</dd>
                  </div>
                  <div>
                    <dt>Realista</dt>
                    <dd>{t.target ? moneyShort(t.target) : '—'}</dd>
                  </div>
                  <div>
                    <dt>Ideal</dt>
                    <dd>{t.high ? moneyShort(t.high) : '—'}</dd>
                  </div>
                  <div>
                    <dt>Pensabas gastar</dt>
                    <dd>{t.spendTarget ? moneyShort(t.spendTarget) : '—'}</dd>
                  </div>
                </dl>
              )}
            </section>
          </div>
        </div>
      )}

      {started && t.target > 0 && !lockedNoLetter && (
        <section className="fz-card fz-compare">
          <header className="fz-card-head">
            <h3>
              <PenLine size={15} /> {ended ? 'Cómo te fue' : 'Cómo vas'}
            </h3>
            {verdict && (ended || closed) && <em className={'fz-verdict big ' + verdict.key}>{verdict.label}</em>}
          </header>
          <div className="fz-compare-row">
            <div>
              <span>Ingresos</span>
              <b>
                {money(actual.income)} <small>de {money(t.target)}</small>
              </b>
              <Progress
                value={actual.income}
                max={t.target}
                tone="in"
                marks={[...(t.low ? [{ at: t.low, label: 'Mín.' }] : []), { at: t.target, label: 'Realista' }, ...(t.high ? [{ at: t.high, label: 'Ideal' }] : [])]}
              />
              <small>
                {ended ? verdict?.text : `Día ${elapsed} de ${daysIn}: llevas el ${percent(actual.income / t.target)}.`} {scenarioOf(actual.income, { low: t.low, mid: t.target, high: t.high })}
              </small>
            </div>
            {(t.spendTarget > 0 || budget.total > 0) && (
              <div>
                <span>Gastos</span>
                <b>
                  {money(actual.spent)} <small>de {money(t.spendTarget || budget.total)}</small>
                </b>
                <Progress
                  value={actual.spent}
                  max={t.spendTarget || budget.total}
                  marks={budget.total && t.spendTarget && budget.total !== t.spendTarget ? [{ at: budget.total, label: 'Presupuesto' }] : []}
                  tone={actual.spent > (t.spendTarget || budget.total) ? 'bad' : actual.spent > (t.spendTarget || budget.total) * 0.85 ? 'warn' : 'out'}
                />
                <small>
                  {actual.spent > (t.spendTarget || budget.total)
                    ? `Gastaste ${percent(actual.spent / (t.spendTarget || budget.total) - 1)} más de lo que pensabas.`
                    : ended
                      ? `Te sobraron ${money((t.spendTarget || budget.total) - actual.spent)} de lo que pensabas gastar.`
                      : `Al ritmo de hoy cerrarías en ${money(Math.round((actual.spent / Math.max(1, elapsed)) * daysIn))}.`}
                </small>
              </div>
            )}
          </div>
          {t.planned > 0 && (
            <p className="fz-muted">
              {t.done} de {t.planned} cosas de tu plan ya pasaron.
            </p>
          )}
        </section>
      )}

      {showScore && score && (
        <section className={'fz-card fz-score ' + score.tone}>
          <Ring value={score.score} max={100} size={132} thickness={11} tone={score.tone}>
            <b>{score.score}</b>
            <small>{score.label}</small>
          </Ring>
          <div className="fz-score-body">
            <h3>{ended || closed ? `Tu índice de ${monthName(month)}` : 'Así va tu índice'}</h3>
            <ul className="fz-score-parts">
              {score.parts.map((p) => (
                <li key={p.key}>
                  <span>{p.label}</span>
                  <i>
                    <i style={{ width: Math.round(Math.min(1, Math.max(0, p.value)) * 100) + '%' }} />
                  </i>
                  <b>{Math.round(Math.min(1, Math.max(0, p.value)) * 100)}</b>
                </li>
              ))}
            </ul>
            {notes.length > 0 && (
              <ul className="fz-score-notes">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {started && !lockedNoLetter && (ended || Number(today.slice(8)) >= daysIn - 2) && (
        <section className="fz-card fz-close">
          <header className="fz-card-head">
            <h3>
              <GraduationCap size={15} /> {closed ? 'Lo que aprendiste' : `Cerrar ${monthName(month)}`}
            </h3>
          </header>
          <AutoTextarea
            className="cp-soft-area"
            minRows={3}
            value={reflection}
            maxLength={4000}
            onChange={(e) => setReflection(e.target.value)}
            placeholder="¿Cuadró? ¿Qué no llegó y por qué? ¿Qué gasto no viste venir? ¿Qué harías distinto en la próxima carta?"
          />
          <div className="fz-close-foot">
            {!data.learningId && (
              <label className="fz-check">
                <input type="checkbox" checked={asLearning} onChange={(e) => setAsLearning(e.target.checked)} />
                Guardarlo también como aprendizaje
              </label>
            )}
            <button type="button" className="fz-btn primary" disabled={!text.trim() && !data.items.length} onClick={() => void closeMonth()}>
              {closed ? 'Guardar' : 'Cerrar el mes'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
