import { useMemo } from 'react';
import { CalendarClock, HandCoins, PenLine, PiggyBank, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { useApp } from '../../AppContext';
import { catColor } from '../../finance/charts';
import {
  debtBalances,
  goalSaved,
  invStats,
  isOpenDebt,
  itemsOf,
  monthActual,
  occurrences,
  projectionTotals,
  recurringStatus,
  remainingOf,
  tone,
} from '../../finance/model';
import {
  byCategory,
  dayOf,
  flowOf,
  isMoney,
  monthBounds,
  monthKey,
  monthName,
  moneyShort,
  signed,
  totals,
} from '../../finance/money';
import { settingsOf, useFinance } from '../../finance/store';
import { openFinanceTab, type FinTab } from '../../finance/ui';
import { addDays, friendlyDate, money, todayInputValue } from '../../lib/format';
import { Card } from '../Card';
import { bool, num, str, type BlockProps } from '../types';

function useGoFin() {
  const { go } = useApp();
  return (tab: FinTab) => openFinanceTab(go, tab);
}
const missingText = 'Prepara Finanzas (migración 202611110001) para usar este bloque.';

/** Tu plata del mes: lo que entró, lo que salió, el presupuesto y en qué se fue. */
export function MoneyMonthBlock({ opts, zone }: BlockProps) {
  const { workspace } = useApp();
  const fin = useFinance();
  const open = useGoFin();
  const today = todayInputValue();
  const month = monthKey(today);
  const moves = useMemo(() => {
    const { from, to } = monthBounds(month);
    return workspace.entries.filter((e) => isMoney(e) && dayOf(e) >= from && dayOf(e) <= to);
  }, [workspace.entries, month]);
  const t = totals(moves);
  const cats = byCategory(moves).slice(0, num(opts, 'cats', 3));
  const budget = settingsOf(fin.items).monthBudget;
  const daysLeft = Number(monthBounds(month).to.slice(8)) - Number(today.slice(8)) + 1;
  const pct = budget ? Math.min(100, Math.round((t.spent / budget) * 100)) : 0;
  return (
    <Card zone={zone} opts={opts} icon={Wallet} tone="#3f6b4f" title={`Tu plata de ${monthName(month)}`} link="Finanzas" onLink={() => open('resumen')}>
      <div className="hk-money">
        <div>
          <span>Gastos</span>
          <b className="out">{moneyShort(t.spent)}</b>
        </div>
        <div>
          <span>Ingresos</span>
          <b className="in">{moneyShort(t.income)}</b>
        </div>
        <div>
          <span>Balance</span>
          <b>{t.balance < 0 ? '−' + moneyShort(-t.balance) : moneyShort(t.balance)}</b>
        </div>
      </div>
      {budget > 0 && bool(opts, 'budget', true) && (
        <>
          <span className={'hk-bar big' + (pct >= 100 ? ' bad' : pct >= 80 ? ' warn' : '')}>
            <i style={{ width: pct + '%' }} />
          </span>
          <p className="hk-note">
            {t.spent <= budget
              ? `Te quedan ${money(budget - t.spent)}: unos ${money(Math.round((budget - t.spent) / daysLeft))} al día.`
              : `Te pasaste ${money(t.spent - budget)} del presupuesto.`}
          </p>
        </>
      )}
      {cats.length > 0 && (
        <ul className="hk-cats">
          {cats.map((c) => (
            <li key={c.name}>
              <i style={{ background: catColor(c.name) }} />
              <span>{c.name}</span>
              <b>{money(c.total)}</b>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Up = { key: string; d: string; title: string; amount: number; sign: 1 | -1; what: string };

/** Lo que toca pagar o cobrar en los próximos días: fijos, pendientes y deudas con fecha. */
export function MoneyAheadBlock({ opts, zone }: BlockProps) {
  const { workspace } = useApp();
  const fin = useFinance();
  const open = useGoFin();
  const today = todayInputValue();
  const days = num(opts, 'days', 7);
  const horizon = addDays(today, days);
  const rows = useMemo(() => {
    const out: Up[] = [];
    for (const r of itemsOf(fin.items, 'recurrente')) {
      if (r.archived || r.data.paused) continue;
      const s = recurringStatus(r.data, today);
      const late = s.inDays < 0 ? [{ d: s.due, period: s.period }] : [];
      for (const o of [...late, ...occurrences(r.data, today, horizon)])
        out.push({ key: r.id + o.period, d: o.d, title: r.title, amount: r.data.amount, sign: r.data.dir === 'ingreso' ? 1 : -1, what: 'Fijo' });
    }
    for (const e of workspace.entries)
      if (isMoney(e) && e.details.pending && dayOf(e) <= horizon)
        out.push({ key: e.id, d: dayOf(e), title: e.title, amount: e.amount, sign: e.direction === 'ingreso' ? 1 : -1, what: e.direction === 'ingreso' ? 'Por cobrar' : 'Por pagar' });
    for (const d of itemsOf(fin.items, 'deuda'))
      if (isOpenDebt(d.data) && d.data.due && d.data.due <= horizon)
        out.push({ key: d.id, d: d.data.due, title: d.data.who.split(' ')[0], amount: remainingOf(d.data), sign: d.data.dir === 'debo' ? -1 : 1, what: 'Deuda' });
    return out.sort((a, b) => a.d.localeCompare(b.d));
  }, [fin.items, workspace.entries, today, horizon]);
  const net = rows.reduce((s, r) => s + r.sign * r.amount, 0);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={CalendarClock}
      tone="#3f6b4f"
      title="Pagos que vienen"
      count={rows.length}
      link="Fijos"
      onLink={() => open('fijos')}
      empty={!rows.length}
      emptyText={`Nada por pagar ni cobrar en los próximos ${days} días.`}
    >
      <ul className="hk-ahead money">
        {rows.slice(0, num(opts, 'count', 5)).map((r) => (
          <li key={r.key} className={r.d < today ? 'late' : ''}>
            <span className="hk-row-static">
              <span className="hk-when">{r.d < today ? 'Vencido' : friendlyDate(r.d, today)}</span>
              <span className="hk-text">
                <strong>{r.title}</strong>
                <small>{r.what}</small>
              </span>
              <b className={r.sign > 0 ? 'in' : 'out'}>{signed(r.sign * r.amount)}</b>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 1 && <p className="hk-note muted">Neto de los próximos {days} días: {signed(net)}</p>}
    </Card>
  );
}

/** Lo que te deben y lo que debes, por persona. */
export function DebtsBlock({ opts, zone }: BlockProps) {
  const fin = useFinance();
  const open = useGoFin();
  const rows = debtBalances(itemsOf(fin.items, 'deuda'));
  const owed = rows.filter((r) => r.net > 0).reduce((s, r) => s + r.net, 0);
  const owe = rows.filter((r) => r.net < 0).reduce((s, r) => s - r.net, 0);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={HandCoins}
      tone="#b0703a"
      title="Deudas"
      link="Ver"
      onLink={() => open('deudas')}
      empty={fin.missing || !rows.length}
      emptyText={fin.missing ? missingText : 'Cuentas claras: nadie te debe ni le debes a nadie.'}
    >
      <div className="hk-money two">
        <div>
          <span>Te deben</span>
          <b className="in">{moneyShort(owed)}</b>
        </div>
        <div>
          <span>Debes</span>
          <b className="out">{moneyShort(owe)}</b>
        </div>
      </div>
      <ul className="hk-cats">
        {rows.slice(0, num(opts, 'count', 4)).map((r) => (
          <li key={r.key}>
            <span>{r.net > 0 ? `${r.who.split(' ')[0]} te debe` : `Le debes a ${r.who.split(' ')[0]}`}</span>
            <b className={r.net > 0 ? 'in' : 'out'}>{money(Math.abs(r.net))}</b>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Tus inversiones: cuánto valen, cómo van y cómo les fue el último día. */
export function InvestmentsBlock({ opts, zone }: BlockProps) {
  const fin = useFinance();
  const open = useGoFin();
  const list = itemsOf(fin.items, 'inversion')
    .filter((i) => !i.archived && !i.data.closedOn)
    .map((i) => ({ i, s: invStats(i.data) }))
    .sort((a, b) => b.s.value - a.s.value);
  const value = list.reduce((s, x) => s + x.s.value, 0);
  const pnl = list.reduce((s, x) => s + x.s.pnl, 0);
  const stale = list.filter((x) => !x.s.updatedToday).length;
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={TrendingUp}
      tone="#4f6bb5"
      title="Inversiones"
      link="Ver"
      onLink={() => open('inversiones')}
      empty={fin.missing || !list.length}
      emptyText={fin.missing ? missingText : 'Agrega tus inversiones en Finanzas y sigue cada día cómo van.'}
    >
      <div className="hk-money two">
        <div>
          <span>Valen</span>
          <b>{moneyShort(value)}</b>
        </div>
        <div>
          <span>Resultado</span>
          <b className={pnl > 0 ? 'in' : pnl < 0 ? 'out' : ''}>{signed(Math.round(pnl))}</b>
        </div>
      </div>
      <ul className="hk-cats">
        {list.slice(0, num(opts, 'count', 4)).map(({ i, s }) => {
          const t = s.lastDay ? tone(s.lastDay.change, s.lastDay.v) : 'flat';
          return (
            <li key={i.id}>
              <span>{i.title}</span>
              <b className={t === 'up' ? 'in' : t === 'down' ? 'out' : ''}>
                {s.lastDay ? signed(Math.round(s.lastDay.change)) : moneyShort(s.value)}
              </b>
            </li>
          );
        })}
      </ul>
      {stale > 0 && (
        <button type="button" className="hk-cta" onClick={() => open('inversiones')}>
          Registrar el día ({stale} sin actualizar)
        </button>
      )}
    </Card>
  );
}

/** Tu carta del mes frente a lo que va entrando. */
export function LetterBlock({ opts, zone }: BlockProps) {
  const { workspace } = useApp();
  const fin = useFinance();
  const open = useGoFin();
  const today = todayInputValue();
  const month = monthKey(today);
  const letter = itemsOf(fin.items, 'proyeccion').find((l) => l.data.month === month);
  const t = letter ? projectionTotals(letter.data) : null;
  const actual = monthActual(workspace.entries, month);
  const pct = t && t.target ? Math.round((actual.income / t.target) * 100) : 0;
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={PenLine}
      tone="#9a8455"
      title={`Carta de ${monthName(month)}`}
      link={letter ? 'Abrir' : 'Escribir'}
      onLink={() => open('proyeccion')}
      empty={fin.missing || !t || !t.target}
      emptyText={
        fin.missing
          ? missingText
          : 'Escribe cómo te proyectas este mes (lo que esperas que entre y lo que piensas gastar) y compáralo después.'
      }
    >
      {t && (
        <>
          <div className="hk-goal">
            <b>
              {moneyShort(actual.income)} <small>de {moneyShort(t.target)}</small>
            </b>
            <span>ha entrado de lo que proyectaste</span>
          </div>
          <span className="hk-bar big in">
            <i style={{ width: Math.min(100, pct) + '%' }} />
          </span>
          <p className="hk-note">
            {pct >= 100 ? 'Ya llegó lo que proyectaste.' : `Llevas el ${pct} %.`}
            {t.spendTarget ? ` Gastaste ${moneyShort(actual.spent)} de ${moneyShort(t.spendTarget)}.` : ''}
          </p>
        </>
      )}
    </Card>
  );
}

/** Tus metas de ahorro y cuánto les falta. */
export function GoalsBlock({ opts, zone }: BlockProps) {
  const { workspace } = useApp();
  const fin = useFinance();
  const open = useGoFin();
  const goals = itemsOf(fin.items, 'meta').filter((g) => !g.archived);
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={PiggyBank}
      tone="#2f7d6d"
      title="Metas de ahorro"
      link="Ver"
      onLink={() => open('metas')}
      empty={fin.missing || !goals.length}
      emptyText={fin.missing ? missingText : 'Un viaje, un equipo, tu fondo de emergencias: crea una meta en Finanzas.'}
    >
      <ul className="hk-goals-list">
        {goals.slice(0, num(opts, 'count', 3)).map((g) => {
          const saved = goalSaved(g, workspace.entries);
          const pct = g.data.target ? Math.min(100, Math.round((saved / g.data.target) * 100)) : 0;
          return (
            <li key={g.id}>
              <div>
                <span>{g.title}</span>
                <b>{pct} %</b>
              </div>
              <span className="hk-bar in">
                <i style={{ width: pct + '%' }} />
              </span>
              <small>
                {moneyShort(saved)} de {moneyShort(g.data.target)}
              </small>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Tus últimos movimientos. */
export function MovesBlock({ opts, zone }: BlockProps) {
  const { workspace, viewEntry, openEntry } = useApp();
  const today = todayInputValue();
  const which = str(opts, 'which', 'todo');
  const rows = useMemo(
    () =>
      workspace.entries
        .filter((e) => isMoney(e) && (which === 'todo' || flowOf(e) === which))
        .sort((a, b) => (b.recorded_at ?? b.created_at).localeCompare(a.recorded_at ?? a.created_at))
        .slice(0, num(opts, 'count', 5)),
    [workspace.entries, which, opts.count],
  );
  return (
    <Card
      zone={zone}
      opts={opts}
      icon={Receipt}
      tone="#c0674a"
      title="Últimos movimientos"
      action={
        <button type="button" className="hc-link" onClick={() => openEntry('Movimiento', [])}>
          + Registrar
        </button>
      }
      empty={!rows.length}
      emptyText="Aún no registras movimientos."
    >
      <ul className="hk-ahead money">
        {rows.map((e) => {
          const f = flowOf(e);
          const neutral = f === 'transferencia' || f === 'prestamo' || f === 'ahorro';
          return (
            <li key={e.id}>
              <button type="button" onClick={() => viewEntry(e)}>
                <span className="hk-when">{friendlyDate(dayOf(e), today)}</span>
                <span className="hk-text">
                  <strong>{e.title}</strong>
                  <small>{e.tags[0] ?? ''}</small>
                </span>
                <b className={neutral ? '' : e.direction === 'ingreso' ? 'in' : 'out'}>
                  {e.direction === 'ingreso' ? '+' : '−'}
                  {moneyShort(e.amount)}
                </b>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
