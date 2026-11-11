import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Wallet, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { addDays, money, todayInputValue } from '../lib/format';
import { dismiss, useDismissed } from '../relations/dismissed';
import { doneNow, invStats, isOpenDebt, itemsOf, periodKeyOf, recurringStatus, remainingOf } from './model';
import { dayOf, forgottenSpends, isMoney, monthKey, monthName, shiftMonth } from './money';
import { updateItem, useFinance } from './store';
import { moneyInput, noonISO, openFinanceTab, relDays, type FinTab } from './ui';

type Line = { key: string; text: ReactNode; action?: { label: string; run: () => void } };

/**
 * Tarjeta de «Hoy» con lo de plata que toca: fijos que vencen, cobros y pagos pendientes, deudas,
 * deseos listos para decidir, inversiones sin actualizar y la carta del mes.
 */
export function FinanceAgendaCard() {
  const { workspace, go, createEntry, patchEntry, notify, openEntry } = useApp();
  const fin = useFinance();
  const skip = useDismissed();
  const today = todayInputValue();
  const key = 'fin-agenda|' + today;
  const open = (tab: FinTab) => openFinanceTab(go, tab);

  const lines = useMemo((): Line[] => {
    if (!fin.items) return [];
    const out: Line[] = [];
    const soon = addDays(today, 2);
    for (const r of itemsOf(fin.items, 'recurrente')) {
      if (r.archived || r.data.paused || doneNow(r.data, today)) continue;
      const s = recurringStatus(r.data, today);
      if (s.due > soon) continue;
      out.push({
        key: r.id,
        text: (
          <>
            <b>{r.title}</b> {s.inDays < 0 ? `venció ${relDays(s.inDays)}` : s.inDays === 0 ? 'toca hoy' : `toca ${relDays(s.inDays)}`} ·{' '}
            {money(r.data.amount)}
          </>
        ),
        action: {
          label: 'Registrar',
          run: () =>
            void (async () => {
              const e = await createEntry(
                moneyInput({
                  title: r.title,
                  amount: r.data.amount,
                  direction: r.data.dir,
                  tags: r.data.category ? [r.data.category] : [],
                  personIds: r.data.personIds ?? [],
                  details: { flow: r.data.flow ?? (r.data.dir === 'ingreso' ? 'ingreso' : 'gasto'), recurringId: r.id, ...(r.data.method && { method: r.data.method }) },
                }),
                true,
              );
              if (!e) return;
              await updateItem(r, { data: { done: [...new Set([...r.data.done, periodKeyOf(r.data, today)])] } });
              notify(`${r.title} registrado.`);
            })(),
        },
      });
    }
    for (const e of workspace.entries) {
      if (!isMoney(e) || !e.details.pending || dayOf(e) > soon) continue;
      const n = dayOf(e) < today ? 'vencido' : dayOf(e) === today ? 'hoy' : 'pronto';
      out.push({
        key: e.id,
        text: (
          <>
            {e.direction === 'ingreso' ? 'Por cobrar' : 'Por pagar'} <b>{e.title}</b> ({n}) · {money(e.amount)}
          </>
        ),
        action: {
          label: e.direction === 'ingreso' ? 'Cobrado' : 'Pagado',
          run: () => {
            const { pending: _p, ...rest } = e.details;
            void patchEntry(e, { details: { ...rest, paidOn: today }, created_at: noonISO(today) });
          },
        },
      });
    }
    for (const d of itemsOf(fin.items, 'deuda'))
      if (isOpenDebt(d.data) && d.data.due && d.data.due <= soon)
        out.push({
          key: d.id,
          text: (
            <>
              {d.data.dir === 'debo' ? 'Pagarle a' : 'Te paga'} <b>{d.data.who.split(' ')[0]}</b> {money(remainingOf(d.data))} ·{' '}
              {d.data.due < today ? 'ya pasó la fecha' : relDays(Math.round((Date.parse(d.data.due) - Date.parse(today)) / 864e5))}
            </>
          ),
          action: { label: 'Ver', run: () => open('deudas') },
        });
    const ready = itemsOf(fin.items, 'deseo').filter((w) => w.data.status === 'esperando' && w.data.decideOn <= today);
    if (ready.length)
      out.push({
        key: 'wish',
        text: (
          <>
            Ya puedes decidir si compras <b>{ready[0].title}</b>
            {ready.length > 1 ? ` y ${ready.length - 1} más` : ''}
          </>
        ),
        action: { label: 'Decidir', run: () => open('metas') },
      });
    const stale = itemsOf(fin.items, 'inversion').filter((i) => !i.archived && !i.data.closedOn && !invStats(i.data).updatedToday);
    if (stale.length)
      out.push({
        key: 'inv',
        text: (
          <>
            Registra cómo van tus inversiones hoy ({stale.length})
          </>
        ),
        action: { label: 'Actualizar', run: () => open('inversiones') },
      });
    const day = Number(today.slice(8));
    const letters = itemsOf(fin.items, 'proyeccion');
    const next = shiftMonth(monthKey(today), 1);
    const prev = shiftMonth(monthKey(today), -1);
    if (day >= 25 && !letters.some((l) => l.data.month === next))
      out.push({
        key: 'letter-next',
        text: (
          <>
            Escribe tu carta de <b>{monthName(next)}</b>: cómo te proyectas el mes que viene
          </>
        ),
        action: { label: 'Escribir', run: () => open('proyeccion') },
      });
    const prevLetter = letters.find((l) => l.data.month === prev);
    if (day <= 5 && prevLetter && !prevLetter.data.closedOn)
      out.push({
        key: 'letter-close',
        text: (
          <>
            Mira cómo te fue con tu carta de <b>{monthName(prev)}</b> y ciérrala
          </>
        ),
        action: { label: 'Comparar', run: () => open('proyeccion') },
      });
    for (const e of forgottenSpends(workspace, today, 1))
      if (!skip.has('fin-forgot|' + e.id))
        out.push({
          key: 'f' + e.id,
          text: (
            <>
              ¿Gastaste algo en <b>{e.title}</b>? No hay gasto registrado
            </>
          ),
          action: {
            label: 'Registrar',
            run: () =>
              openEntry(
                'Movimiento',
                e.person_ids,
                e.details.placeId ? { placeId: e.details.placeId, place: e.details.place } : undefined,
                { date: dayOf(e) },
              ),
          },
        });
    return out;
  }, [fin.items, workspace, today, skip]);

  if (!lines.length || skip.has(key)) return null;
  return (
    <div className="ag-card fz-ag" style={{ '--c': '#3f6b4f', '--s': '#e6efe7' } as CSSProperties}>
      <span className="ag-icon">
        <Wallet size={17} />
      </span>
      <div className="ag-main">
        <strong>Tu plata hoy</strong>
        <ul className="fz-ag-list">
          {lines.slice(0, 5).map((l) => (
            <li key={l.key}>
              <span>{l.text}</span>
              {l.action && (
                <button type="button" onClick={l.action.run}>
                  {l.action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
        {lines.length > 5 && <div className="ag-why"><i>Y {lines.length - 5} más en Finanzas</i></div>}
      </div>
      <div className="ag-actions">
        <button type="button" className="ag-primary" onClick={() => open('resumen')}>
          Finanzas <ArrowRight size={13} />
        </button>
        <div className="ag-minor">
          <button type="button" aria-label="Descartar por hoy" title="Descartar por hoy" onClick={() => dismiss(key)}>
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
