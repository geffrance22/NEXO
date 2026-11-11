import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bug,
  CalendarClock,
  Coffee,
  Flame,
  Frown,
  HandCoins,
  MapPin,
  PenLine,
  PiggyBank,
  Receipt,
  Smile,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { addDays, friendlyDate, money, todayInputValue } from '../lib/format';
import { dismiss, useDismissed } from '../relations/dismissed';
import { Bars, catColor, Donut, Line, Progress, type Bar } from './charts';
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
  previousLabel,
  priceChanges,
  shiftMonth,
  shiftPeriod,
  signed,
  totals,
  type Period,
} from './money';
import {
  debtBalances,
  invStats,
  itemsOf,
  monthActual,
  occurrences,
  projectionTotals,
  recurringStatus,
  remainingOf,
  isOpenDebt,
  verdictOf,
} from './model';
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
  const trend = useMemo((): { bars: Bar[]; avg: number; every: number; two: boolean } => {
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
  const budget = settings.monthBudget;
  const pendingMonth = moves.filter((e) => e.details.pending && monthKey(dayOf(e)) === month);
  const toPay = pendingMonth.filter((e) => e.direction === 'egreso').reduce((s, e) => s + e.amount, 0);
  const toCollect = pendingMonth.filter((e) => e.direction === 'ingreso').reduce((s, e) => s + e.amount, 0);

  // Carta del mes.
  const letters = itemsOf(fin.items, 'proyeccion');
  const letter = letters.find((l) => l.data.month === month);
  const letterTotals = letter ? projectionTotals(letter.data) : null;
  const letterActual = letter ? monthActual(moves, month) : null;
  const verdict = letter && letterTotals && letterActual ? verdictOf(letterActual.income, letterTotals.target) : null;
  const nextMonth = shiftMonth(monthKey(today), 1);
  const nextLetter = letters.find((l) => l.data.month === nextMonth);

  // Deudas e inversiones.
  const debtRows = debtBalances(itemsOf(fin.items, 'deuda'));
  const owedToMe = debtRows.filter((r) => r.net > 0).reduce((s, r) => s + r.net, 0);
  const iOwe = debtRows.filter((r) => r.net < 0).reduce((s, r) => s - r.net, 0);
  const invs = itemsOf(fin.items, 'inversion').filter((i) => !i.archived && !i.data.closedOn);
  const invValue = invs.reduce((s, i) => s + invStats(i.data).value, 0);
  const invPnl = invs.reduce((s, i) => s + invStats(i.data).pnl, 0);

  // Presupuestos.
  const budgets = Object.entries(settings.budgets)
    .map(([name, limit]) => ({ name, limit, used: cats.find((c) => c.name === name)?.total ?? 0 }))
    .sort((a, b) => b.used / b.limit - a.used / a.limit);

  // Lo que viene: fijos, por pagar y por cobrar, y deudas con fecha.
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
  const startCash = accounts.length ? accountBalances(moves, accounts).reduce((s, a) => s + a.balance, 0) : null;
  const cashLine = useMemo(() => {
    if (startCash === null || !upcoming.length) return null;
    const values: number[] = [];
    let cash = startCash;
    for (let i = 0, d = today; i <= 30; i++, d = addDays(d, 1)) {
      for (const u of upcoming) if ((i === 0 ? u.d <= d : u.d === d)) cash += u.sign * u.amount;
      values.push(cash);
    }
    return values;
  }, [startCash, upcoming, today]);

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
            Donde más gastaste: <b>{place.name}</b>, {money(topPlace[1].total)} en {topPlace[1].n}{' '}
            {topPlace[1].n === 1 ? 'vez' : 'veces'}.
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
            Con quien más gastaste: <b>{person.name.split(' ')[0]}</b>, {money(topPerson[1].total)} en{' '}
            {topPerson[1].n} {topPerson[1].n === 1 ? 'salida' : 'salidas'}.
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
            Te hizo feliz: <b>{money(happy.reduce((s, e) => s + costOf(e), 0))}</b> en {happy.length}. Te
            arrepientes de <b>{money(regret.reduce((s, e) => s + costOf(e), 0))}</b> en {regret.length}.
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
            Deducible para la declaración: <b>{money(deductible.reduce((s, e) => s + e.amount, 0))}</b> en{' '}
            {deductible.length} {deductible.length === 1 ? 'pago' : 'pagos'}.
          </>
        ),
      });
    for (const p of priceChanges(moves, today))
      out.push({
        key: 'price' + p.title,
        icon: <TrendingUp size={15} />,
        text: (
          <>
            «{p.title}» te cuesta <b>{p.change > 0 ? '+' : '−'}{percent(Math.abs(p.change))}</b> que hace unos meses
            ({money(Math.round(p.before))} → {money(Math.round(p.now))}).
          </>
        ),
      });
    return out;
  }, [list, moves, t.income, t.spent, t.saved, workspace.places, workspace.people, today, viewEntry]);

  const forgotten = isNow ? forgottenSpends(workspace, today).filter((e) => !skip.has('fin-forgot|' + e.id)) : [];

  return (
    <div className="fz-summary">
      <PeriodBar period={period} onChange={setPeriod} />

      <div className="fz-kpis">
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
        <Kpi label="Balance" value={t.balance} sub={t.n ? `${t.n} movimientos` : 'Sin movimientos'} />
        <Kpi label="Ahorro" value={t.saved} change={vs && tp.saved ? delta(t.saved, tp.saved) : null} vs={vs} tone="save" sub="A metas, bolsillos e inversiones" />
      </div>

      <div className="fz-pulse">
        {monthIsNow ? (
          <div className="fz-pulse-card main">
            <span className="fz-pulse-label">
              <Sparkles size={14} /> Este mes
            </span>
            {budget > 0 ? (
              t.spent <= budget ? (
                <p>
                  Te quedan <b>{money(budget - t.spent)}</b> para {daysLeft} {daysLeft === 1 ? 'día' : 'días'}: unos{' '}
                  <b>{money(Math.round((budget - t.spent) / daysLeft))}</b> al día.
                </p>
              ) : (
                <p>
                  Te pasaste <b>{money(t.spent - budget)}</b> de tu presupuesto del mes.
                </p>
              )
            ) : (
              <p>
                Al ritmo de este mes cerrarías con <b>{money(Math.round(pace))}</b> de gastos.
              </p>
            )}
            {budget > 0 && (
              <Progress value={t.spent} max={budget} tone={t.spent > budget ? 'bad' : t.spent > budget * 0.8 ? 'warn' : 'out'} />
            )}
            <small>
              {budget > 0 && <>Ritmo: {money(Math.round(pace))} al cierre · </>}
              {toPay > 0 && <>Por pagar {moneyShort(toPay)} · </>}
              {toCollect > 0 && <>Por cobrar {moneyShort(toCollect)} · </>}
              {budget > 0 ? (
                <>Presupuesto {moneyShort(budget)}</>
              ) : (
                <button type="button" onClick={() => go('ajustes')}>
                  Define un presupuesto
                </button>
              )}
            </small>
          </div>
        ) : (
          <div className="fz-pulse-card main">
            <span className="fz-pulse-label">
              <Sparkles size={14} /> En este periodo
            </span>
            <p>
              Gastaste en promedio <b>{money(Math.round(trend.avg))}</b> {period.kind === 'semana' || period.kind === 'mes' ? 'al día' : 'al mes'}.
            </p>
            <small>{t.n} movimientos</small>
          </div>
        )}

        <button type="button" className="fz-pulse-card" onClick={() => go('proyeccion')}>
          <span className="fz-pulse-label">
            <PenLine size={14} /> Carta de {monthName(month)}
          </span>
          {letter && letterTotals && letterActual ? (
            <>
              <p>
                Proyectaste <b>{moneyShort(letterTotals.target)}</b>; {monthIsNow ? 'van' : 'llegaron'}{' '}
                <b>{moneyShort(letterActual.income)}</b>.
              </p>
              <Progress
                value={letterActual.income}
                max={letterTotals.target}
                marks={[
                  ...(letter.data.low ? [{ at: letter.data.low, label: 'Mín.' }] : []),
                  ...(letter.data.high ? [{ at: letter.data.high, label: 'Ideal' }] : []),
                ]}
              />
              <small>{monthIsNow ? `${percent(letterActual.income / (letterTotals.target || 1))} de lo realista` : verdict?.label}</small>
            </>
          ) : (
            <>
              <p>Escribe cómo te ves este mes: lo que esperas que entre y lo que piensas gastar.</p>
              <small>
                Escribir la carta <ArrowRight size={12} />
              </small>
            </>
          )}
          {!nextLetter && Number(today.slice(8)) >= 20 && (
            <em className="fz-pulse-tag">Ya puedes escribir la de {monthName(nextMonth)}</em>
          )}
        </button>

        <div className="fz-pulse-card stack">
          <button type="button" onClick={() => go('deudas')}>
            <span className="fz-pulse-label">
              <HandCoins size={14} /> Deudas
            </span>
            {owedToMe || iOwe ? (
              <p>
                Te deben <b className="in">{moneyShort(owedToMe)}</b> · debes <b className="out">{moneyShort(iOwe)}</b>
              </p>
            ) : (
              <p className="muted">Nadie te debe ni le debes a nadie.</p>
            )}
          </button>
          <button type="button" onClick={() => go('inversiones')}>
            <span className="fz-pulse-label">
              <TrendingUp size={14} /> Inversiones
            </span>
            {invs.length ? (
              <p>
                <b>{moneyShort(invValue)}</b>{' '}
                <span className={invPnl > 0 ? 'in' : invPnl < 0 ? 'out' : ''}>{signed(Math.round(invPnl))}</span>
              </p>
            ) : (
              <p className="muted">Sigue cada día cómo van.</p>
            )}
          </button>
        </div>
      </div>

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

      <div className="fz-grid">
        <Card title="¿En qué se fue?" className="fz-cats">
          {cats.length ? (
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
                    <li key={c.name} onMouseEnter={() => setHoverCat(c.name)} onMouseLeave={() => setHoverCat(null)} className={hoverCat === c.name ? 'on' : ''}>
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
          ) : (
            <p className="fz-muted">Sin gastos en este periodo.</p>
          )}
        </Card>

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

        <Card
          title="Presupuestos"
          icon={<PiggyBank size={15} />}
          action={
            <button type="button" className="fz-link" onClick={() => go('ajustes')}>
              {budgets.length ? 'Editar' : 'Definir'}
            </button>
          }
        >
          {period.kind !== 'mes' ? (
            <p className="fz-muted">Los presupuestos son mensuales: elige un mes para verlos.</p>
          ) : budgets.length ? (
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
          ) : (
            <p className="fz-muted">Pon un tope por categoría (comida, transporte, ocio…) y aquí verás cuánto te queda cada día.</p>
          )}
        </Card>

        <Card
          title="Lo que viene"
          icon={<CalendarClock size={15} />}
          action={
            <button type="button" className="fz-link" onClick={() => go('fijos')}>
              Fijos
            </button>
          }
        >
          {upcoming.length ? (
            <>
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
            </>
          ) : (
            <p className="fz-muted">Nada por pagar ni por cobrar en los próximos 30 días.</p>
          )}
        </Card>
      </div>

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
    </div>
  );
}
