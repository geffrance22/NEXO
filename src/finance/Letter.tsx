import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CircleCheck,
  Feather,
  GraduationCap,
  ListPlus,
  Lock,
  PenLine,
  Plus,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { AutoTextarea } from '../composer/controls';
import { friendlyDate, money, todayInputValue } from '../lib/format';
import { Bars, Progress } from './charts';
import {
  doneNow,
  itemsOf,
  monthActual,
  monthlyCost,
  projectionTotals,
  scenarioOf,
  verdictOf,
  type FinItem,
  type Projection,
} from './model';
import { dayOf, flowOf, isMoney, monthBounds, monthKey, monthName, moneyShort, percent, shiftMonth } from './money';
import { createItem, financeState, removeItem, restoreItem, updateItem, useFinance } from './store';
import { Field, MoneyField, moneyInput } from './ui';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthTitle = (m: string) => `${cap(monthName(m))} ${m.slice(0, 4)}`;

const blankLetter = (month: string): Projection => ({
  month,
  letter: '',
  hits: [],
  skip: [],
  flip: [],
  writtenOn: todayInputValue(),
});

/** La carta del mes: escribes cómo te proyectas y luego comparas con lo que pasó. */
export function LetterTab() {
  const { workspace } = useApp();
  const fin = useFinance();
  const today = todayInputValue();
  const thisMonth = monthKey(today);
  const nextMonth = shiftMonth(thisMonth, 1);
  const letters = itemsOf(fin.items, 'proyeccion').sort((a, b) => b.data.month.localeCompare(a.data.month));
  const byMonth = new Map(letters.map((l) => [l.data.month, l]));
  const [month, setMonth] = useState(() =>
    byMonth.has(thisMonth) || Number(today.slice(8)) < 20 ? thisMonth : nextMonth,
  );
  const rail = [...new Set([nextMonth, thisMonth, ...letters.map((l) => l.data.month)])].sort((a, b) => b.localeCompare(a));
  const item = byMonth.get(month) ?? null;
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);

  // Tu puntería: cartas de meses que ya terminaron.
  const past = letters
    .filter((l) => l.data.month < thisMonth)
    .map((l) => {
      const t = projectionTotals(l.data);
      const a = monthActual(moves, l.data.month);
      return { l, target: t.target, actual: a.income, spendTarget: t.spendTarget, spent: a.spent, v: verdictOf(a.income, t.target) };
    })
    .filter((x) => x.target > 0);
  const ratios = past.map((x) => x.actual / x.target);
  const avg = ratios.length ? ratios.reduce((s, r) => s + r, 0) / ratios.length : null;

  return (
    <div className="fz-letters">
      <nav className="fz-rail" aria-label="Cartas por mes">
        {rail.map((m) => {
          const l = byMonth.get(m);
          const v = l && m < thisMonth ? past.find((x) => x.l.id === l.id)?.v : null;
          return (
            <button type="button" key={m} className={(m === month ? 'on' : '') + (l ? '' : ' empty')} onClick={() => setMonth(m)}>
              <span>
                {cap(monthName(m))}
                {m.slice(0, 4) !== today.slice(0, 4) && ` ${m.slice(2, 4)}`}
              </span>
              <small>
                {!l ? (
                  <>
                    <Plus size={11} /> Escribir
                  </>
                ) : v ? (
                  v.label
                ) : m === thisMonth ? (
                  'En curso'
                ) : m > thisMonth ? (
                  'Por venir'
                ) : l.data.closedOn ? (
                  'Cerrada'
                ) : (
                  'Sin cifras'
                )}
              </small>
            </button>
          );
        })}
      </nav>

      <LetterView key={month} month={month} item={item} />

      {past.length > 0 && (
        <section className="fz-card fz-aim">
          <header className="fz-card-head">
            <h3>
              <Target size={15} /> Tu puntería
            </h3>
            {avg !== null && (
              <span className="fz-aim-avg">
                {avg >= 1.03
                  ? `Sueles quedarte corto: entra un ${percent(avg - 1)} más de lo que proyectas.`
                  : avg <= 0.97
                    ? `Sueles proyectar de más: llega el ${percent(avg)} de lo que esperas.`
                    : 'Sueles atinarle: tus cartas son realistas.'}
              </span>
            )}
          </header>
          <Bars
            data={[...past].reverse().slice(-12).map((x) => ({
              key: x.l.id,
              label: monthName(x.l.data.month).slice(0, 3),
              value: x.target,
              value2: x.actual,
              tip: `${monthTitle(x.l.data.month)} · proyectaste ${money(x.target)} · llegó ${money(x.actual)}`,
            }))}
            color="#c9cfbf"
            color2="var(--fz-in)"
            height={110}
          />
          <ul className="fz-aim-list">
            {past.map((x) => (
              <li key={x.l.id}>
                <button type="button" className="fz-link" onClick={() => setMonth(x.l.data.month)}>
                  {monthTitle(x.l.data.month)}
                </button>
                <span>
                  {moneyShort(x.target)} → <b>{moneyShort(x.actual)}</b>
                </span>
                <em className={'fz-verdict ' + (x.v?.key ?? '')}>
                  {x.v?.label} · {percent(x.actual / x.target)}
                </em>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LetterView({ month, item }: { month: string; item: FinItem<'proyeccion'> | null }) {
  const { workspace, notify, createEntry, confirm } = useApp();
  const fin = useFinance();
  const today = todayInputValue();
  const thisMonth = monthKey(today);
  const data = item?.data ?? blankLetter(month);
  const [text, setText] = useState(data.letter);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const creating = useRef<Promise<unknown> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(item);
  latest.current = item;

  /** Guarda cambios de la carta (la crea la primera vez que escribes algo). */
  const persist = async (patch: Partial<Projection>) => {
    setSaved('saving');
    if (creating.current) await creating.current;
    const current =
      itemsOf(financeState().items, 'proyeccion').find((l) => l.data.month === month) ?? latest.current;
    let r: unknown;
    if (current) r = await updateItem(current, { data: patch });
    else {
      const p = createItem('proyeccion', `Carta de ${monthTitle(month)}`, { ...blankLetter(month), ...patch });
      creating.current = p;
      r = await p;
      creating.current = null;
    }
    if (typeof r === 'string') {
      notify(r);
      setSaved('idle');
    } else setSaved('saved');
  };

  useEffect(() => {
    if (text === data.letter) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist({ letter: text }), 700);
    return () => window.clearTimeout(timer.current);
  }, [text]);

  const live: Projection = { ...data, letter: text };
  const t = projectionTotals(live);
  const started = month <= thisMonth;
  const ended = month < thisMonth;
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const actual = monthActual(moves, month);
  const { from, to } = monthBounds(month);
  const daysIn = Number(to.slice(8));
  const elapsed = ended ? daysIn : started ? Number(today.slice(8)) : 0;
  const verdict = verdictOf(actual.income, t.target);
  const spendVerdict = t.spendTarget ? actual.spent / t.spendTarget : null;
  const closed = Boolean(data.closedOn);

  // Movimientos del mes que parecen ser una línea de la carta.
  const monthMoves = moves.filter((e) => {
    const d = dayOf(e);
    return d >= from && d <= to && !e.details.pending;
  });
  const suggestFor = (amount: number, dir: 'in' | 'out') =>
    monthMoves.find((e) => {
      const f = flowOf(e);
      const ok = dir === 'in' ? f === 'ingreso' : f === 'gasto' || f === 'ahorro';
      return ok && Math.abs(e.amount - amount) <= amount * 0.12;
    });

  const toggleIn = (list: 'hits' | 'skip' | 'flip', key: string) => {
    const cur = data[list];
    void persist({ [list]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] });
  };
  const setNum = (key: 'low' | 'mid' | 'high' | 'spend', v: number) => void persist({ [key]: v || undefined });

  const addFixed = () => {
    const fixed = itemsOf(fin.items, 'recurrente').filter((r) => !r.archived && !r.data.paused);
    if (!fixed.length) return notify('Aún no tienes fijos: agrégalos en la pestaña Fijos.');
    const ins = fixed.filter((r) => r.data.dir === 'ingreso');
    const outs = fixed.filter((r) => r.data.dir === 'egreso');
    const line = (r: (typeof fixed)[number]) =>
      `${r.data.dir === 'ingreso' ? 'Me entra' : 'Pago'} ${r.title.toLowerCase()}: ${money(Math.round(monthlyCost(r.data)))}`;
    const block = [...ins.map(line), ...outs.map(line)].join('\n');
    setText((x) => (x.trim() ? `${x.trimEnd()}\n\n${block}` : block));
  };

  // Cerrar el mes.
  const [reflection, setReflection] = useState(data.reflection ?? '');
  const [asLearning, setAsLearning] = useState(true);
  const closeMonth = async () => {
    let learningId = data.learningId;
    if (asLearning && reflection.trim() && !learningId) {
      const summary = [
        `Proyecté ${money(t.target)} de ingresos y entraron ${money(actual.income)}${verdict ? ` (${verdict.label.toLowerCase()})` : ''}.`,
        t.spendTarget ? `Pensé gastar ${money(t.spendTarget)} y gasté ${money(actual.spent)}.` : '',
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
    await persist({ reflection: reflection.trim() || undefined, closedOn: today, learningId });
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

  const fixedHint = itemsOf(fin.items, 'recurrente').some((r) => !r.archived && !doneNow(r.data));

  return (
    <div className="fz-letter">
      <div className="fz-paper-wrap">
        <article className={'fz-paper' + (closed ? ' closed' : '')}>
          <header>
            <span>
              <Feather size={14} /> Carta a mi yo de {monthName(month)}
            </span>
            <small>
              {saved === 'saving' ? 'Guardando…' : saved === 'saved' ? 'Guardado' : data.writtenOn ? `Escrita el ${friendlyDate(data.writtenOn).toLowerCase()}` : ''}
              {closed && (
                <>
                  {' '}
                  · <Lock size={11} /> Cerrada
                </>
              )}
            </small>
          </header>
          <AutoTextarea
            className="fz-paper-text"
            minRows={10}
            value={text}
            maxLength={12000}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Querido yo de ${monthName(month)}:\n\nEste mes espero cobrar 2,5 millones del proyecto con Andrés y el sueldo de 3,2 millones.\nVoy a pagar el arriendo, 1,2 millones, y la tarjeta, 400 mil.\nQuiero ahorrar 500 mil para el viaje.\n\nSi todo sale bien…`}
            aria-label="Tu carta del mes"
          />
          <footer>
            <button type="button" className="fz-btn ghost sm" onClick={addFixed} title={fixedHint ? 'Agrega tus fijos como líneas' : undefined}>
              <ListPlus size={14} /> Traer mis fijos
            </button>
            {item && (
              <button type="button" className="fz-icon" aria-label="Eliminar carta" title="Eliminar carta" onClick={() => void remove()}>
                <Trash2 size={14} />
              </button>
            )}
          </footer>
        </article>
      </div>

      <aside className="fz-letter-side">
        <section className="fz-card">
          <header className="fz-card-head">
            <h3>
              <Sparkles size={15} /> Lo que entendí
            </h3>
          </header>
          {t.lines.length ? (
            <ul className="fz-lines">
              {t.lines.map((l) => {
                const hint = started && !l.hit && !l.off ? suggestFor(l.amount, l.dir) : undefined;
                return (
                  <li key={l.key} className={(l.off ? 'off' : '') + (l.hit ? ' hit' : '')}>
                    <button
                      type="button"
                      className={'fz-line-dir ' + l.dir}
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
                    <input type="checkbox" checked={!l.off} title="Cuenta en la proyección" aria-label="Cuenta" onChange={() => toggleIn('skip', l.key)} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="fz-muted">Escribe montos en tu carta («2 millones del sueldo», «arriendo 1,2 M») y aquí aparecen solos.</p>
          )}
          {t.lines.length > 0 && (
            <div className="fz-lines-total">
              <span>
                Entra <b className="in">{money(t.income)}</b>
              </span>
              <span>
                Sale <b className="out">{money(t.spend)}</b>
              </span>
              <span>
                Neto <b>{money(t.income - t.spend)}</b>
              </span>
            </div>
          )}
        </section>

        <section className="fz-card">
          <header className="fz-card-head">
            <h3>
              <Target size={15} /> Tus escenarios
            </h3>
          </header>
          <div className="fz-form three">
            <Field label="Mínimo">
              <MoneyField value={data.low ?? 0} onChange={(v) => setNum('low', v)} />
            </Field>
            <Field label="Realista">
              <MoneyField value={data.mid ?? 0} onChange={(v) => setNum('mid', v)} placeholder={t.income ? moneyShort(t.income).replace('$', '') : '0'} />
            </Field>
            <Field label="Ideal">
              <MoneyField value={data.high ?? 0} onChange={(v) => setNum('high', v)} />
            </Field>
            <Field label="Pienso gastar" wide>
              <MoneyField value={data.spend ?? 0} onChange={(v) => setNum('spend', v)} placeholder={t.spend ? moneyShort(t.spend).replace('$', '') : '0'} />
            </Field>
          </div>
          {!data.mid && t.income > 0 && <small className="fz-muted">Sin realista escrito, cuenta lo que suman las entradas de tu carta.</small>}
        </section>
      </aside>

      {started && t.target > 0 && (
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
                marks={[
                  ...(data.low ? [{ at: data.low, label: 'Mín.' }] : []),
                  { at: t.target, label: 'Realista' },
                  ...(data.high ? [{ at: data.high, label: 'Ideal' }] : []),
                ]}
              />
              <small>
                {ended ? verdict?.text : `Día ${elapsed} de ${daysIn}: llevas el ${percent(actual.income / t.target)}.`} {scenarioOf(actual.income, live)}
              </small>
            </div>
            {t.spendTarget > 0 && (
              <div>
                <span>Gastos</span>
                <b>
                  {money(actual.spent)} <small>de {money(t.spendTarget)}</small>
                </b>
                <Progress
                  value={actual.spent}
                  max={t.spendTarget}
                  tone={spendVerdict && spendVerdict > 1 ? 'bad' : spendVerdict && spendVerdict > 0.85 ? 'warn' : 'out'}
                />
                <small>
                  {spendVerdict === null
                    ? ''
                    : spendVerdict > 1
                      ? `Gastaste ${percent(spendVerdict - 1)} más de lo que pensabas.`
                      : ended
                        ? `Te sobraron ${money(t.spendTarget - actual.spent)} de lo que pensabas gastar.`
                        : `Al ritmo de hoy cerrarías en ${money(Math.round((actual.spent / Math.max(1, elapsed)) * daysIn))}.`}
                </small>
              </div>
            )}
          </div>
          {t.lines.some((l) => !l.off) && (
            <p className="fz-muted">
              {t.lines.filter((l) => l.hit && !l.off).length} de {t.lines.filter((l) => !l.off).length} cosas de tu carta ya pasaron.
            </p>
          )}
        </section>
      )}

      {started && (ended || Number(today.slice(8)) >= daysIn - 2) && (
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
            <button type="button" className="fz-btn primary" disabled={!text.trim()} onClick={() => void closeMonth()}>
              {closed ? 'Guardar' : 'Cerrar el mes'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
