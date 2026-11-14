import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bug,
  CalendarClock,
  Check,
  Coffee,
  Flame,
  Frown,
  HandCoins,
  Landmark,
  Layers,
  MapPin,
  NotebookPen,
  PenLine,
  PiggyBank,
  Plus,
  Receipt,
  Smile,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { addDays, friendlyDate, money, todayInputValue } from '../lib/format';
import { dismiss, useDismissed } from '../relations/dismissed';
import { ChargeBar, PartSheet } from './Charges';
import { waitingParts } from './chargeActions';
import { Bars, catColor, Donut, Line, Progress, Ring, type Bar } from './charts';
import {
  accountBalances,
  antSpending,
  byCategory,
  costOf,
  daily,
  dayOf,
  daysBetween,
  delta,
  flowOf,
  forgottenSpends,
  inPeriod,
  isMoney,
  lastMonths,
  monthBounds,
  monthKey,
  monthName,
  monthly,
  moneyShort,
  percent,
  periodLabel,
  previousLabel,
  priceChanges,
  shiftMonth,
  shiftPeriod,
  signed,
  totals,
  type Period,
} from './money';
import {
  budgetFor,
  cardMethod,
  cardStats,
  chargeStats,
  debtBalances,
  invStats,
  isOpenCharge,
  isOpenDebt,
  itemsOf,
  letterScore,
  letterWindow,
  monthActual,
  occurrences,
  PLAN_LOCK_DAY,
  pocketStats,
  projectionTotals,
  recurringStatus,
  remainingOf,
  verdictOf,
  type ChargePart,
  type FinItem,
} from './model';
import { calcNote, noteTitle } from './noteCalc';
import { PeriodBar } from './PeriodBar';
import { settingsOf, useFinance } from './store';
import type { FinTab } from './ui';

function Kpi({
  label,
  value,
  change,
  goodWhenUp = true,
  vs,
  tone,
  sub,
}: {
  label: string;
  value: number;
  change?: number | null;
  goodWhenUp?: boolean;
  vs?: string;
  tone?: 'in' | 'out' | 'save';
  sub?: string;
}) {
  const up = (change ?? 0) > 0;
  const good = change == null || change === 0 ? null : up === goodWhenUp;
  return (
    <div className={'fz-kpi' + (tone ? ' ' + tone : '')}>
      <span>{label}</span>
      <b>{value < 0 ? '−' + money(-value) : money(value)}</b>
      {change != null && vs ? (
        <small className={good === null ? '' : good ? 'good' : 'bad'}>
          {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          {percent(Math.abs(change))} vs {vs}
        </small>
      ) : (
        <small>{sub ?? '\u00a0'}</small>
      )}
    </div>
  );
}

function Card({
  title,
  icon,
  action,
  children,
  className = '',
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'fz-card ' + className}>
      <header className="fz-card-head">
        <h3>
          {icon}
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}

const More = ({ onClick, children = 'Ver todo' }: { onClick: () => void; children?: ReactNode }) => (
  <button type="button" className="fz-link" onClick={onClick}>
    {children}
  </button>
);

export function SummaryTab({
  period,
  setPeriod,
  go,
}: {
  period: Period;
  setPeriod: (p: Period) => void;
  go: (t: FinTab) => void;
}) {
  const { workspace, openEntry, viewEntry } = useApp();
  const fin = useFinance();
  const skip = useDismissed();
  const settings = settingsOf(fin.items);
  const today = todayInputValue();
  const [hoverCat, setHoverCat] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<{ charge: FinItem<'cobro'>; part: ChargePart } | null>(null);

  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const list = useMemo(() => moves.filter((e) => inPeriod(e, period)), [moves, period]);
  const prevPeriod = shiftPeriod(period, -1);
  const prev = useMemo(
    () => (period.kind === 'todo' ? [] : moves.filter((e) => inPeriod(e, prevPeriod))),
    [moves, period.kind, prevPeriod.from],
  );
  const t = totals(list);
  const tp = totals(prev);
  const vs = period.kind === 'todo' ? undefined : previousLabel(period);
  const isNow = today >= period.from && today <= period.to;

  const cats = byCategory(list);
  const prevCats = new Map(byCategory(prev).map((c) => [c.name, c.total]));
  const top = cats.slice(0, 7);
  const rest = cats.slice(7).reduce((s, c) => s + c.total, 0);
  const slices = [...top.map((c) => ({ name: c.name, value: c.total })), ...(rest ? [{ name: 'Otros', value: rest, color: '#cfd5c6' }] : [])];
  const shownCat = hoverCat ? cats.find((c) => c.name === hoverCat) : null;

  // Tendencia: por día en una semana o un mes; por mes en un año o en todo.
  const trend = useMemo((): { bars: Bar[]; avg: number; every: number; two: boolean; any: boolean } => {
    if (period.kind === 'semana' || period.kind === 'mes') {
      const days = daily(list, period.from, period.to);
      const until = isNow ? today : period.to;
      const elapsed = days.filter((d) => d.d <= until);
      const avg = elapsed.length ? elapsed.reduce((s, d) => s + d.spent, 0) / elapsed.length : 0;
      return {
        bars: days.map((d) => ({
          key: d.d,
          label: period.kind === 'semana' ? friendlyDate(d.d).slice(0, 3) : String(Number(d.d.slice(8))),
          value: Math.max(0, d.spent),
          tip: `${friendlyDate(d.d)} · gastaste ${money(Math.max(0, d.spent))}${d.income ? ` · entró ${money(d.income)}` : ''}`,
          mark: d.d === today,
        })),
        avg,
        every: period.kind === 'mes' ? 5 : 1,
        two: false,
        any: days.some((d) => d.spent > 0),
      };
    }
    const months =
      period.kind === 'año'
        ? Array.from({ length: 12 }, (_, i) => `${period.from.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`)
        : lastMonths(12, today);
    const rows = monthly(period.kind === 'año' ? list : moves, months);
    const withData = rows.filter((r) => r.n > 0);
    return {
      bars: rows.map((r) => ({
        key: r.m,
        label: monthName(r.m).slice(0, 3),
        value: Math.max(0, r.spent),
        value2: r.income,
        tip: `${monthName(r.m)} ${r.m.slice(0, 4)} · gastos ${money(r.spent)} · ingresos ${money(r.income)}`,
        mark: r.m === monthKey(today),
      })),
      avg: withData.length ? withData.reduce((s, r) => s + r.spent, 0) / withData.length : 0,
      every: 1,
      two: true,
      any: withData.length > 1,
    };
  }, [list, moves, period, today, isNow]);

  // Mes en curso: cuánto queda y a qué ritmo vas.
  const month = period.kind === 'mes' ? monthKey(period.from) : monthKey(today);
  const monthIsNow = period.kind === 'mes' && isNow;
  const { to: monthEnd } = monthBounds(month);
  const daysIn = Number(monthEnd.slice(8));
  const dayNum = monthIsNow ? Number(today.slice(8)) : daysIn;
  const daysLeft = daysIn - dayNum + 1;
  const pace = dayNum ? (t.spent / dayNum) * daysIn : 0;
  const budget = period.kind === 'mes' ? budgetFor(fin.items, month) : { total: 0, from: null };
  const pendingMonth = moves.filter((e) => e.details.pending && monthKey(dayOf(e)) === month);
  const toPay = pendingMonth.filter((e) => e.direction === 'egreso').reduce((s, e) => s + e.amount, 0);
  const toCollect = pendingMonth.filter((e) => e.direction === 'ingreso').reduce((s, e) => s + e.amount, 0);

  // Gasto acumulado del mes contra el ritmo del presupuesto.
  const burn = useMemo(() => {
    if (period.kind !== 'mes') return null;
    const days = daily(list, period.from, period.to).slice(0, dayNum);
    let acc = 0;
    const real = days.map((d) => (acc += Math.max(0, d.spent)));
    if (real.length < 2 && !budget.total) return null;
    const ideal = budget.total ? Array.from({ length: daysIn }, (_, i) => (budget.total / daysIn) * (i + 1)) : null;
    return { real, ideal };
  }, [list, period, dayNum, daysIn, budget.total]);

  // Carta del mes.
  const letters = itemsOf(fin.items, 'proyeccion');
  const letter = letters.find((l) => l.data.month === month);
  const letterTotals = letter ? projectionTotals(letter.data, fin.items) : null;
  const letterActual = letter ? monthActual(moves, month) : null;
  const verdict = letter && letterTotals && letterActual ? verdictOf(letterActual.income, letterTotals.target) : null;
  const letterIndex =
    letter && letterTotals && letterActual && month < monthKey(today)
      ? letterScore({
          target: letterTotals.target,
          income: letterActual.income,
          spendTarget: letterTotals.spendTarget,
          spent: letterActual.spent,
          budget: budget.total,
          planned: letterTotals.planned,
          done: letterTotals.done,
        })
      : null;
  const thisMonth = monthKey(today);
  const nextMonth = shiftMonth(thisMonth, 1);
  const nextLetter = letters.find((l) => l.data.month === nextMonth);
  const nowLetter = letters.find((l) => l.data.month === thisMonth);

  // Deudas, inversiones, bolsillos y cobros.
  const debtRows = debtBalances(itemsOf(fin.items, 'deuda'));
  const owedToMe = debtRows.filter((r) => r.net > 0).reduce((s, r) => s + r.net, 0);
  const iOwe = debtRows.filter((r) => r.net < 0).reduce((s, r) => s - r.net, 0);
  const invs = itemsOf(fin.items, 'inversion').filter((i) => !i.archived && !i.data.closedOn);
  const invValue = invs.reduce((s, i) => s + invStats(i.data).value, 0);
  const invPnl = invs.reduce((s, i) => s + invStats(i.data).pnl, 0);
  const pockets = itemsOf(fin.items, 'bolsillo')
    .filter((p) => !p.archived)
    .map((p) => ({ p, s: pocketStats(p, moves) }));
  const savingPockets = pockets.filter((x) => x.p.data.use === 'ahorro').reduce((s, x) => s + x.s.balance, 0);
  const wallets = pockets.filter((x) => x.p.data.use === 'gasto').reduce((s, x) => s + x.s.balance, 0);
  const charges = itemsOf(fin.items, 'cobro')
    .filter(isOpenCharge)
    .map((c) => ({ c, s: chargeStats(c, moves, today) }))
    .sort((a, b) => (a.s.next?.due ?? '9999').localeCompare(b.s.next?.due ?? '9999'));
  const toReceive = charges.reduce((s, x) => s + x.s.left, 0);
  const pinned = itemsOf(fin.items, 'apunte').filter((n) => n.data.pinned);

  // Presupuestos por categoría.
  const budgets = Object.entries(settings.budgets)
    .map(([name, limit]) => ({ name, limit, used: cats.find((c) => c.name === name)?.total ?? 0 }))
    .sort((a, b) => b.used / b.limit - a.used / a.limit);

  // Lo que viene: fijos, por pagar y por cobrar, partes de cobros y deudas con fecha.
  const horizon = addDays(today, 30);
  const upcoming = useMemo(() => {
    type Up = { key: string; d: string; title: string; amount: number; sign: 1 | -1; kind: string; onOpen?: () => void };
    const out: Up[] = [];
    for (const r of itemsOf(fin.items, 'recurrente')) {
      if (r.archived || r.data.paused) continue;
      const s = recurringStatus(r.data, today);
      const late = s.inDays < 0 ? [{ d: s.due, period: s.period }] : [];
      for (const o of [...late, ...occurrences(r.data, today, horizon)])
        out.push({
          key: r.id + o.period,
          d: o.d,
          title: r.title,
          amount: r.data.amount,
          sign: r.data.dir === 'ingreso' ? 1 : -1,
          kind: r.data.kind === 'suscripcion' ? 'Suscripción' : 'Fijo',
        });
    }
    for (const e of moves)
      if (e.details.pending && dayOf(e) <= horizon)
        out.push({
          key: e.id,
          d: dayOf(e),
          title: e.title,
          amount: e.amount,
          sign: e.direction === 'ingreso' ? 1 : -1,
          kind: e.direction === 'ingreso' ? 'Por cobrar' : 'Por pagar',
          onOpen: () => viewEntry(e),
        });
    for (const { charge, part } of waitingParts(fin.items))
      if (part.due <= horizon)
        out.push({
          key: part.id,
          d: part.due,
          title: charge.title,
          amount: part.amount,
          sign: 1,
          kind: 'Parte de un cobro',
          onOpen: () => setReceiving({ charge, part }),
        });
    for (const dbt of itemsOf(fin.items, 'deuda'))
      if (isOpenDebt(dbt.data) && dbt.data.due && dbt.data.due <= horizon)
        out.push({
          key: dbt.id,
          d: dbt.data.due,
          title: `${dbt.data.dir === 'debo' ? 'Pagarle a' : 'Te paga'} ${dbt.data.who.split(' ')[0]}`,
          amount: remainingOf(dbt.data),
          sign: dbt.data.dir === 'debo' ? -1 : 1,
          kind: 'Deuda',
        });
    return out.sort((a, b) => a.d.localeCompare(b.d));
  }, [fin.items, moves, today, horizon, viewEntry]);
  const accounts = settings.accounts;
  const cash = accounts.length ? accountBalances(moves, accounts).reduce((s, a) => s + a.balance, 0) : null;
  const cashLine = useMemo(() => {
    if (cash === null || !upcoming.length) return null;
    const values: number[] = [];
    let c = cash;
    for (let i = 0, d = today; i <= 30; i++, d = addDays(d, 1)) {
      for (const u of upcoming) if (i === 0 ? u.d <= d : u.d === d) c += u.sign * u.amount;
      values.push(c);
    }
    return values;
  }, [cash, upcoming, today]);

  // Dónde está tu plata (solo con lo que tengas registrado).
  const worth = [
    ...(cash !== null ? [{ key: 'cash', label: 'Cuentas', value: cash, color: '#3f6b4f' }] : []),
    ...(savingPockets ? [{ key: 'pockets', label: 'Bolsillos de ahorro', value: savingPockets, color: '#3c9186' }] : []),
    ...(invs.length ? [{ key: 'inv', label: 'Inversiones', value: invValue, color: '#c58a1c' }] : []),
    ...(owedToMe + toReceive ? [{ key: 'owed', label: 'Por cobrar', value: owedToMe + toReceive, color: '#7b9bb5' }] : []),
    ...(iOwe ? [{ key: 'owe', label: 'Debes', value: -iOwe, color: '#c0553f' }] : []),
  ];
  // Lo que debes en tarjetas de crédito que no están ya entre tus cuentas.
  const cardDebt = itemsOf(fin.items, 'tarjeta')
    .filter((c) => !c.archived && c.data.type === 'credito')
    .filter((c) => !accounts.some((a) => a.name.trim().toLowerCase() === cardMethod(c).trim().toLowerCase()))
    .reduce((s, c) => s + Math.max(0, cardStats(c, moves, today).owed), 0);
  if (cardDebt) worth.push({ key: 'cards', label: 'Tarjetas de crédito', value: -cardDebt, color: '#a0527f' });
  const net = worth.reduce((s, w) => s + w.value, 0);
  const worthPos = worth.filter((w) => w.value > 0);
  const worthTotal = worthPos.reduce((s, w) => s + w.value, 0);

  // Lo que dicen tus números.
  const insights = useMemo(() => {
    const out: { key: string; icon: ReactNode; text: ReactNode }[] = [];
    const spends = list.filter((e) => !e.details.pending && flowOf(e) === 'gasto');
    const biggest = [...spends].sort((a, b) => costOf(b) - costOf(a))[0];
    if (biggest)
      out.push({
        key: 'big',
        icon: <Flame size={15} />,
        text: (
          <>
            Tu mayor gasto: <button type="button" onClick={() => viewEntry(biggest)}>«{biggest.title}»</button>{' '}
            <b>{money(costOf(biggest))}</b> ({friendlyDate(dayOf(biggest)).toLowerCase()}).
          </>
        ),
      });
    const ant = antSpending(list);
    if (ant.n >= 5)
      out.push({
        key: 'ant',
        icon: <Bug size={15} />,
        text: (
          <>
            Gasto hormiga: lo de menos de $15.000 sumó <b>{money(ant.total)}</b> en {ant.n} compras
            {ant.top && ant.top.n > 1 ? (
              <>
                ; en «{ant.top.title}» se fueron <b>{money(ant.top.total)}</b>
              </>
            ) : null}
            .
          </>
        ),
      });
    if (t.income > 0) {
      const kept = t.income - t.spent;
      out.push({
        key: 'rate',
        icon: <PiggyBank size={15} />,
        text:
          kept >= 0 ? (
            <>
              Te quedó el <b>{percent(kept / t.income)}</b> de lo que entró
              {t.saved > 0 ? (
                <>
                  {' '}
                  y apartaste <b>{money(t.saved)}</b> para ahorro
                </>
              ) : null}
              .
            </>
          ) : (
            <>
              Gastaste <b>{money(-kept)}</b> más de lo que entró.
            </>
          ),
      });
    }
    const placeSpend = new Map<string, { total: number; n: number }>();
    const personSpend = new Map<string, { total: number; n: number }>();
    for (const e of spends) {
      const pid = e.details.placeId;
      if (pid) {
        const r = placeSpend.get(pid) ?? { total: 0, n: 0 };
        r.total += costOf(e);
        r.n++;
        placeSpend.set(pid, r);
      }
      for (const id of e.person_ids) {
        const r = personSpend.get(id) ?? { total: 0, n: 0 };
        r.total += costOf(e);
        r.n++;
        personSpend.set(id, r);
      }
    }
    const topPlace = [...placeSpend.entries()].sort((a, b) => b[1].total - a[1].total)[0];
    const place = topPlace && workspace.places.find((p) => p.id === topPlace[0]);
    if (place)
      out.push({
        key: 'place',
        icon: <MapPin size={15} />,
        text: (
          <>
            Donde más gastaste: <b>{place.name}</b>, {money(topPlace[1].total)} en {topPlace[1].n} {topPlace[1].n === 1 ? 'vez' : 'veces'}.
          </>
        ),
      });
    const topPerson = [...personSpend.entries()].sort((a, b) => b[1].total - a[1].total)[0];
    const person = topPerson && workspace.people.find((p) => p.id === topPerson[0]);
    if (person)
      out.push({
        key: 'person',
        icon: <Users size={15} />,
        text: (
          <>
            Con quien más gastaste: <b>{person.name.split(' ')[0]}</b>, {money(topPerson[1].total)} en {topPerson[1].n}{' '}
            {topPerson[1].n === 1 ? 'salida' : 'salidas'}.
          </>
        ),
      });
    const happy = spends.filter((e) => e.details.worth === 1);
    const regret = spends.filter((e) => e.details.worth === -1);
    if (happy.length || regret.length)
      out.push({
        key: 'worth',
        icon: happy.length >= regret.length ? <Smile size={15} /> : <Frown size={15} />,
        text: (
          <>
            Te hizo feliz: <b>{money(happy.reduce((s, e) => s + costOf(e), 0))}</b> en {happy.length}. Te arrepientes de{' '}
            <b>{money(regret.reduce((s, e) => s + costOf(e), 0))}</b> en {regret.length}.
          </>
        ),
      });
    const deductible = list.filter((e) => e.details.deductible && !e.details.pending);
    if (deductible.length)
      out.push({
        key: 'tax',
        icon: <Receipt size={15} />,
        text: (
          <>
            Deducible para la declaración: <b>{money(deductible.reduce((s, e) => s + e.amount, 0))}</b> en {deductible.length}{' '}
            {deductible.length === 1 ? 'pago' : 'pagos'}.
          </>
        ),
      });
    for (const p of priceChanges(moves, today))
      out.push({
        key: 'price' + p.title,
        icon: <TrendingUp size={15} />,
        text: (
          <>
            «{p.title}» te cuesta <b>{p.change > 0 ? '+' : '−'}{percent(Math.abs(p.change))}</b> que hace unos meses ({money(Math.round(p.before))} →{' '}
            {money(Math.round(p.now))}).
          </>
        ),
      });
    return out;
  }, [list, moves, t.income, t.spent, t.saved, workspace.places, workspace.people, today, viewEntry]);

  // Avisos cortos: solo cuando hay algo que hacer.
  const nudges: { key: string; text: string; run: () => void }[] = [];
  if (isNow) {
    const day = Number(today.slice(8));
    if (day <= PLAN_LOCK_DAY && !nowLetter)
      nudges.push({ key: 'l-now', text: `Aún puedes escribir la carta de ${monthName(thisMonth)} (hasta el ${PLAN_LOCK_DAY})`, run: () => go('proyeccion') });
    else if (day <= PLAN_LOCK_DAY && nowLetter && letterWindow(thisMonth, today).editable)
      nudges.push({ key: 'l-adj', text: `Ajusta tu carta de ${monthName(thisMonth)}: tienes hasta el ${PLAN_LOCK_DAY}`, run: () => go('proyeccion') });
    if (day >= 20 && !nextLetter) nudges.push({ key: 'l-next', text: `Ya puedes planear ${monthName(nextMonth)}`, run: () => go('proyeccion') });
    const late = waitingParts(fin.items).filter((x) => x.part.due < today);
    if (late.length) nudges.push({ key: 'late', text: `${late.length} ${late.length === 1 ? 'parte de un cobro atrasada' : 'partes de cobros atrasadas'}`, run: () => go('deudas') });
    if (period.kind === 'mes' && !budget.total && t.n >= 12)
      nudges.push({
        key: 'budget',
        text: 'Ponle un presupuesto a tus meses',
        run: () => go(letterWindow(thisMonth, today).editable ? 'proyeccion' : 'ajustes'),
      });
  }
  const forgotten = isNow ? forgottenSpends(workspace, today).filter((e) => !skip.has('fin-forgot|' + e.id)) : [];

  const hasCards =
    worth.length > 1 ||
    Boolean(letter) ||
    pockets.length > 0 ||
    charges.length > 0 ||
    cats.length > 0 ||
    trend.any ||
    (period.kind === 'mes' && budgets.length > 0) ||
    upcoming.length > 0 ||
    owedToMe + iOwe > 0 ||
    invs.length > 0 ||
    pinned.length > 0;

  const used = budget.total ? t.spent / budget.total : 0;
  const ringTone = used >= 1 ? 'bad' : used >= 0.8 ? 'warn' : 'in';

  return (
    <div className="fz-summary">
      <PeriodBar period={period} onChange={setPeriod} />

      {nudges.length > 0 && (
        <div className="fz-nudges">
          {nudges.map((n) => (
            <button type="button" key={n.key} onClick={n.run}>
              <Sparkles size={13} /> {n.text} <ArrowRight size={12} />
            </button>
          ))}
        </div>
      )}

      {t.n === 0 && !hasCards ? (
        <div className="fz-empty">
          <span>
            <Wallet size={22} />
          </span>
          <strong>Nada registrado en {periodLabel(period).toLowerCase()}</strong>
          <p>Registra un gasto o un ingreso, escribe un apunte rápido o planea el mes con tu carta. Este panel se arma solo con lo que vayas teniendo.</p>
          <div className="fz-row-tools">
            <button type="button" className="fz-btn primary" onClick={() => openEntry('Movimiento', [])}>
              <Plus size={16} /> Movimiento
            </button>
            <button type="button" className="fz-btn ghost" onClick={() => go('apuntes')}>
              <NotebookPen size={15} /> Apunte
            </button>
            <button type="button" className="fz-btn ghost" onClick={() => go('proyeccion')}>
              <PenLine size={15} /> Carta del mes
            </button>
          </div>
        </div>
      ) : null}

      {t.n > 0 && (
        <div className="fz-hero-row">
          <section className={'fz-hero' + (budget.total ? ' ' + ringTone : '')}>
            <div className="fz-hero-main">
              {budget.total > 0 ? (
                <Ring value={t.spent} max={budget.total} size={124} thickness={11} tone={ringTone}>
                  <b>{percent(Math.min(9.99, used))}</b>
                  <small>del presupuesto</small>
                </Ring>
              ) : null}
              <div className="fz-hero-text">
                <span className="fz-pulse-label">
                  <Sparkles size={14} /> {monthIsNow ? `${monthName(month)} · día ${dayNum} de ${daysIn}` : periodLabel(period)}
                </span>
                {monthIsNow ? (
                  budget.total > 0 ? (
                    t.spent <= budget.total ? (
                      <p>
                        Te quedan <b>{money(budget.total - t.spent)}</b> para {daysLeft} {daysLeft === 1 ? 'día' : 'días'}: unos{' '}
                        <b>{money(Math.round((budget.total - t.spent) / daysLeft))}</b> al día.
                      </p>
                    ) : (
                      <p>
                        Te pasaste <b>{money(t.spent - budget.total)}</b> de tu presupuesto del mes.
                      </p>
                    )
                  ) : (
                    <p>
                      Al ritmo de este mes cerrarías con <b>{money(Math.round(pace))}</b> de gastos.
                    </p>
                  )
                ) : budget.total > 0 ? (
                  <p>
                    {t.spent <= budget.total ? (
                      <>
                        Cerraste {monthName(month)} con <b>{money(budget.total - t.spent)}</b> sin usar de tu presupuesto.
                      </>
                    ) : (
                      <>
                        Te pasaste <b>{money(t.spent - budget.total)}</b> de tu presupuesto de {monthName(month)}.
                      </>
                    )}
                  </p>
                ) : (
                  <p>
                    Gastaste en promedio <b>{money(Math.round(trend.avg))}</b> {period.kind === 'semana' || period.kind === 'mes' ? 'al día' : 'al mes'}
                    {t.income > 0 && (
                      <>
                        {' '}
                        y te quedó el <b>{percent(Math.max(0, t.income - t.spent) / t.income)}</b> de lo que entró
                      </>
                    )}
                    .
                  </p>
                )}
                <div className="fz-hero-tags">
                  {monthIsNow && budget.total > 0 && (
                    <em className={pace > budget.total ? 'bad' : 'good'}>
                      Ritmo al cierre {moneyShort(Math.round(pace))}
                    </em>
                  )}
                  {budget.from && <em>Presupuesto {moneyShort(budget.total)} · {budget.from === 'mes' ? 'de la carta' : 'general'}</em>}
                  {toPay > 0 && <em className="out">Por pagar {moneyShort(toPay)}</em>}
                  {toCollect > 0 && <em className="in">Por cobrar {moneyShort(toCollect)}</em>}
                </div>
              </div>
            </div>
            {burn && burn.real.length > 1 && (
              <div className="fz-burn">
                <Line
                  points={daysIn}
                  height={64}
                  series={[
                    ...(burn.ideal ? [{ values: burn.ideal, color: '#b7bfac', dashed: true }] : []),
                    { values: burn.real, color: burn.ideal && burn.real[burn.real.length - 1] > burn.ideal[burn.real.length - 1] ? '#c0553f' : '#3f6b4f', fill: true },
                  ]}
                />
                <small>
                  Gasto acumulado{burn.ideal ? ' frente al ritmo del presupuesto (punteado)' : ''}
                </small>
              </div>
            )}
          </section>

          <div className="fz-kpis tight">
            <Kpi label="Ingresos" value={t.income} change={vs ? delta(t.income, tp.income) : null} vs={vs} tone="in" />
            <Kpi
              label="Gastos"
              value={t.spent}
              change={vs ? delta(t.spent, tp.spent) : null}
              goodWhenUp={false}
              vs={vs}
              tone="out"
              sub={t.refunds ? `Descontados ${moneyShort(t.refunds)} de reembolsos` : undefined}
            />
            <Kpi label="Balance" value={t.balance} sub={t.income > 0 ? `Te quedó el ${percent(Math.max(0, t.balance) / t.income)}` : `${t.n} movimientos`} />
            {(t.saved !== 0 || tp.saved !== 0) && (
              <Kpi label="Ahorro" value={t.saved} change={vs && tp.saved ? delta(t.saved, tp.saved) : null} vs={vs} tone="save" sub="A metas, bolsillos e inversiones" />
            )}
          </div>
        </div>
      )}

      {forgotten.length > 0 && (
        <div className="fz-forgot">
          <Coffee size={16} />
          <div>
            <strong>¿Se te quedó algún gasto?</strong>
            {forgotten.map((e) => {
              const names = e.person_ids
                .map((id) => workspace.people.find((p) => p.id === id)?.name.split(' ')[0])
                .filter(Boolean)
                .join(', ');
              return (
                <p key={e.id}>
                  <span>
                    {e.details.activity ?? 'Encuentro'}
                    {names && ` con ${names}`}
                    {e.details.place && ` en ${e.details.place}`} · {friendlyDate(dayOf(e)).toLowerCase()}
                  </span>
                  <button
                    type="button"
                    className="fz-btn sm soft"
                    onClick={() =>
                      openEntry(
                        'Movimiento',
                        e.person_ids,
                        e.details.placeId ? { placeId: e.details.placeId, place: e.details.place } : undefined,
                        { date: dayOf(e), title: e.title.slice(0, 180) },
                      )
                    }
                  >
                    Registrar
                  </button>
                  <button type="button" className="fz-icon" aria-label="No hubo gasto" title="No hubo gasto" onClick={() => dismiss('fin-forgot|' + e.id)}>
                    <X size={14} />
                  </button>
                </p>
              );
            })}
          </div>
        </div>
      )}

      {hasCards && (
        <div className="fz-bento">
          {worth.length > 1 && (
            <Card title="Dónde está tu plata" icon={<Landmark size={15} />} className="fz-worth-card">
              <div className="fz-worth-net">
                <span>Neto</span>
                <b className={net < 0 ? 'out' : ''}>{net < 0 ? '−' + money(-net) : money(net)}</b>
              </div>
              {worthTotal > 0 && (
                <div className="fz-alloc">
                  {worthPos.map((w) => (
                    <i key={w.key} title={`${w.label}: ${money(w.value)}`} style={{ width: (w.value / worthTotal) * 100 + '%', background: w.color }} />
                  ))}
                </div>
              )}
              <ul className="fz-worth-list">
                {worth.map((w) => (
                  <li key={w.key}>
                    <i style={{ background: w.color }} />
                    <span>{w.label}</span>
                    <b className={w.value < 0 ? 'out' : ''}>{w.value < 0 ? '−' + money(-w.value) : money(w.value)}</b>
                  </li>
                ))}
              </ul>
              {wallets > 0 && <small className="fz-muted">Además tienes {money(wallets)} apartados en carteras para gastar (dentro de tus cuentas).</small>}
            </Card>
          )}

          {letter && letterTotals && letterActual && (letterTotals.target > 0 || letterTotals.spendTarget > 0 || letterTotals.planned > 0) && (
            <Card
              title={`Carta de ${monthName(month)}`}
              icon={<PenLine size={15} />}
              action={<More onClick={() => go('proyeccion')}>Abrir</More>}
              className="fz-letter-card"
            >
              <div className="fz-letter-card-body">
                {letterIndex ? (
                  <Ring value={letterIndex.score} max={100} size={84} thickness={8} tone={letterIndex.tone}>
                    <b>{letterIndex.score}</b>
                    <small>{letterIndex.label}</small>
                  </Ring>
                ) : null}
                <div>
                  {letterTotals.target > 0 && (
                    <>
                      <p>
                        Proyectaste <b>{moneyShort(letterTotals.target)}</b>; {monthIsNow ? 'van' : 'llegaron'} <b>{moneyShort(letterActual.income)}</b>.
                      </p>
                      <Progress
                        value={letterActual.income}
                        max={letterTotals.target}
                        marks={[
                          ...(letterTotals.low ? [{ at: letterTotals.low, label: 'Mín.' }] : []),
                          ...(letterTotals.high ? [{ at: letterTotals.high, label: 'Ideal' }] : []),
                        ]}
                      />
                    </>
                  )}
                  <small className="fz-muted">
                    {letterTotals.spendTarget > 0 && `Pensabas gastar ${moneyShort(letterTotals.spendTarget)} · vas en ${moneyShort(letterActual.spent)}. `}
                    {letterTotals.planned > 0 && `${letterTotals.done} de ${letterTotals.planned} cosas del plan. `}
                    {!monthIsNow && verdict ? verdict.label : ''}
                  </small>
                </div>
              </div>
            </Card>
          )}

          {charges.length > 0 && (
            <Card title="Cobros por partes" icon={<Layers size={15} />} action={<More onClick={() => go('deudas')} />} className="fz-charges-card">
              <p className="fz-charges-total">
                Te falta recibir <b className="in">{money(toReceive)}</b>
              </p>
              <ul className="fz-mini-charges">
                {charges.slice(0, 4).map(({ c, s }) => {
                  const n = s.next ? daysBetween(today, s.next.due) : null;
                  return (
                    <li key={c.id}>
                      <div>
                        <strong>{c.title}</strong>
                        <small>
                          {moneyShort(s.received)} de {moneyShort(c.data.total)}
                          {s.next && (
                            <>
                              {' · '}
                              <em className={n! < 0 ? 'bad' : n! <= 3 ? 'warn' : ''}>
                                {n! < 0 ? `atrasada ${-n!} d` : n === 0 ? 'hoy' : `próx. ${friendlyDate(s.next.due).toLowerCase()}`} ({moneyShort(s.next.amount)})
                              </em>
                            </>
                          )}
                        </small>
                      </div>
                      {s.next && n! <= 0 && (
                        <button type="button" className="fz-btn soft sm" onClick={() => setReceiving({ charge: c, part: s.next! })}>
                          <Check size={13} /> Llegó
                        </button>
                      )}
                      <ChargeBar total={c.data.total} s={s} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {pockets.length > 0 && (
            <Card title="Bolsillos" icon={<Wallet size={15} />} action={<More onClick={() => go('bolsillos')} />} className="fz-pockets-card">
              <ul className="fz-mini-pockets">
                {pockets.slice(0, 5).map(({ p, s }) => (
                  <li key={p.id} style={{ '--c': p.data.color } as CSSProperties}>
                    <span className="fz-pocket-emoji sm">{p.data.emoji || p.title.charAt(0).toUpperCase()}</span>
                    <div>
                      <span>
                        <strong>{p.title}</strong>
                        <b className={s.balance < 0 ? 'out' : ''}>{money(s.balance)}</b>
                      </span>
                      {p.data.use === 'ahorro' && p.data.target ? (
                        <Progress value={Math.max(0, s.balance)} max={p.data.target} tone="in" />
                      ) : p.data.use === 'gasto' && p.data.monthly ? (
                        <Progress value={s.spent} max={p.data.monthly} tone={s.spent > p.data.monthly ? 'bad' : 'out'} />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {cats.length > 0 && (
            <Card title="¿En qué se fue?" className="fz-cats">
              <div className="fz-cats-body">
                <Donut slices={slices} active={hoverCat} onActive={setHoverCat}>
                  <small>{shownCat ? shownCat.name : 'Gastos'}</small>
                  <b>{moneyShort(shownCat ? shownCat.total : t.gross)}</b>
                  {shownCat && <small>{percent(shownCat.total / (t.gross || 1))}</small>}
                </Donut>
                <ul className="fz-legend">
                  {top.map((c) => {
                    const before = prevCats.get(c.name) ?? 0;
                    const ch = vs ? delta(c.total, before) : null;
                    return (
                      <li
                        key={c.name}
                        onMouseEnter={() => setHoverCat(c.name)}
                        onMouseLeave={() => setHoverCat(null)}
                        className={hoverCat === c.name ? 'on' : ''}
                      >
                        <i style={{ background: catColor(c.name) }} />
                        <span>{c.name}</span>
                        <b>{money(c.total)}</b>
                        <small className={ch == null ? '' : ch > 0 ? 'bad' : 'good'}>
                          {ch == null ? percent(c.total / (t.gross || 1)) : `${ch > 0 ? '+' : '−'}${percent(Math.abs(ch))}`}
                        </small>
                      </li>
                    );
                  })}
                  {rest > 0 && (
                    <li>
                      <i style={{ background: '#cfd5c6' }} />
                      <span>Otras {cats.length - 7}</span>
                      <b>{money(rest)}</b>
                      <small />
                    </li>
                  )}
                </ul>
              </div>
            </Card>
          )}

          {trend.any && (
            <Card
              title={trend.two ? 'Mes a mes' : 'Día a día'}
              action={
                trend.two ? (
                  <span className="fz-key">
                    <i className="out" /> Gastos <i className="in" /> Ingresos
                  </span>
                ) : undefined
              }
            >
              <Bars data={trend.bars} average={trend.avg} every={trend.every} />
            </Card>
          )}

          {period.kind === 'mes' && budgets.length > 0 && (
            <Card title="Presupuestos" icon={<PiggyBank size={15} />} action={<More onClick={() => go('ajustes')}>Editar</More>}>
              <ul className="fz-budgets">
                {budgets.map((b) => {
                  const r = b.used / b.limit;
                  return (
                    <li key={b.name}>
                      <div>
                        <span>
                          <i style={{ background: catColor(b.name) }} />
                          {b.name}
                        </span>
                        <b>
                          {moneyShort(b.used)} <small>de {moneyShort(b.limit)}</small>
                        </b>
                      </div>
                      <Progress value={b.used} max={b.limit} tone={r >= 1 ? 'bad' : r >= 0.8 ? 'warn' : 'out'} />
                      <small className={r >= 1 ? 'bad' : r >= 0.8 ? 'warn' : ''}>
                        {r >= 1
                          ? `Te pasaste ${money(b.used - b.limit)}`
                          : monthIsNow
                            ? `Quedan ${money(b.limit - b.used)} · ${money(Math.round((b.limit - b.used) / daysLeft))} al día`
                            : `Sobraron ${money(b.limit - b.used)}`}
                      </small>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {upcoming.length > 0 && (
            <Card title="Lo que viene" icon={<CalendarClock size={15} />} action={<More onClick={() => go('fijos')}>Fijos</More>}>
              {cashLine && (
                <div className="fz-cash">
                  <Line series={[{ values: cashLine, color: '#3f6b4f', fill: true }]} height={70} zero />
                  <small>
                    Saldo hoy {moneyShort(cashLine[0])} → en 30 días {moneyShort(cashLine[cashLine.length - 1])}
                  </small>
                </div>
              )}
              <ul className="fz-upcoming">
                {upcoming.slice(0, 8).map((u) => {
                  const n = daysBetween(today, u.d);
                  return (
                    <li key={u.key} className={n < 0 ? 'late' : ''}>
                      <span className="fz-when">{n < 0 ? 'Vencido' : n === 0 ? 'Hoy' : friendlyDate(u.d)}</span>
                      <span className="fz-up-title">
                        {u.onOpen ? (
                          <button type="button" onClick={u.onOpen}>
                            {u.title}
                          </button>
                        ) : (
                          u.title
                        )}
                        <small>{u.kind}</small>
                      </span>
                      <b className={u.sign > 0 ? 'in' : 'out'}>{signed(u.sign * u.amount)}</b>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {(owedToMe + iOwe > 0 || invs.length > 0) && (
            <div className="fz-pulse-card stack">
              {owedToMe + iOwe > 0 && (
                <button type="button" onClick={() => go('deudas')}>
                  <span className="fz-pulse-label">
                    <HandCoins size={14} /> Deudas
                  </span>
                  <p>
                    {owedToMe > 0 && (
                      <>
                        Te deben <b className="in">{moneyShort(owedToMe)}</b>
                      </>
                    )}
                    {owedToMe > 0 && iOwe > 0 && ' · '}
                    {iOwe > 0 && (
                      <>
                        debes <b className="out">{moneyShort(iOwe)}</b>
                      </>
                    )}
                  </p>
                  <small>
                    {debtRows.length} {debtRows.length === 1 ? 'persona' : 'personas'}
                  </small>
                </button>
              )}
              {invs.length > 0 && (
                <button type="button" onClick={() => go('inversiones')}>
                  <span className="fz-pulse-label">
                    <TrendingUp size={14} /> Inversiones
                  </span>
                  <p>
                    <b>{moneyShort(invValue)}</b> <span className={invPnl > 0 ? 'in' : invPnl < 0 ? 'out' : ''}>{signed(Math.round(invPnl))}</span>
                  </p>
                  <small>
                    {invs.length} {invs.length === 1 ? 'activa' : 'activas'}
                  </small>
                </button>
              )}
            </div>
          )}

          {pinned.length > 0 && (
            <Card title="Apuntes fijados" icon={<NotebookPen size={15} />} action={<More onClick={() => go('apuntes')} />}>
              <ul className="fz-mini-notes">
                {pinned.slice(0, 4).map((n) => {
                  const c = calcNote(n.data.text);
                  return (
                    <li key={n.id} className={'tint-' + n.data.tint}>
                      <button type="button" onClick={() => go('apuntes')}>
                        <span>{noteTitle(n.title, n.data.text)}</span>
                        {c.hits.length > 0 && <b className={c.total < 0 ? 'out' : 'in'}>{c.total < 0 ? '−' + moneyShort(-c.total) : moneyShort(c.total)}</b>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      )}

      {insights.length > 0 && (
        <Card title="Lo que dicen tus números" icon={<Sparkles size={15} />} className="fz-insights-card">
          <ul className="fz-insights">
            {insights.map((i) => (
              <li key={i.key}>
                <span>{i.icon}</span>
                <p>{i.text}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {receiving && <PartSheet action={{ charge: receiving.charge, part: receiving.part, mode: 'receive' }} onClose={() => setReceiving(null)} />}
    </div>
  );
}
