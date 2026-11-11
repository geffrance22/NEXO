import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Archive,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Minus,
  Pencil,
  Plus,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { ChoiceChips, Segmented } from '../composer/controls';
import { friendlyDate, money, todayInputValue } from '../lib/format';
import { DayBars, Line, MonthGrid } from './charts';
import {
  addMark,
  defaultAccounts,
  invStats,
  invTypeMeta,
  invTypes,
  itemsOf,
  tone,
  type DayResult,
  type FinItem,
  type InvType,
  type Investment,
  type Mark,
} from './model';
import { daysBetween, monthKey, monthName, moneyShort, percent, shiftMonth, signed } from './money';
import { createItem, removeItem, restoreItem, settingsOf, updateItem, useFinance } from './store';
import { Empty, Field, FinSheet, MoneyField, moneyInput, relDays } from './ui';

const toneLabel = { up: 'Ganancia', down: 'Pérdida', flat: 'Neutral' } as const;

/** Cómo le fue un día: ganancia, pérdida, neutral, y si hubo aporte o retiro. */
function dayLabel(x: DayResult) {
  const t = tone(x.change, x.v);
  const parts: string[] = [];
  if (x.f > 0) parts.push(`Aporte ${moneyShort(x.f)}`);
  if (x.f < 0) parts.push(`Retiro ${moneyShort(-x.f)}`);
  if (t !== 'flat' || !x.f) parts.push(toneLabel[t]);
  return { tone: t, text: parts.join(' · ') };
}

function Delta({ value, base, big = false }: { value: number; base: number; big?: boolean }) {
  const t = tone(value, base);
  const Icon = t === 'up' ? ArrowUpRight : t === 'down' ? ArrowDownRight : Minus;
  return (
    <span className={'fz-delta ' + t + (big ? ' big' : '')}>
      <Icon size={big ? 15 : 13} />
      {signed(Math.round(value))}
      {base ? <small>{percent(Math.abs(value / base))}</small> : null}
    </span>
  );
}

export function InvestmentsTab() {
  const fin = useFinance();
  const [adding, setAdding] = useState(false);
  const [marking, setMarking] = useState<FinItem<'inversion'> | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [daily, setDaily] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const all = itemsOf(fin.items, 'inversion').filter((i) => !i.archived);
  const active = all.filter((i) => !i.data.closedOn);
  const closed = all.filter((i) => i.data.closedOn);
  const today = todayInputValue();

  const stats = active.map((i) => ({ item: i, s: invStats(i.data) }));
  const value = stats.reduce((s, x) => s + x.s.value, 0);
  const invested = stats.reduce((s, x) => s + x.s.invested, 0);
  const contributed = stats.reduce((s, x) => s + x.s.contributed, 0);
  const pnl = stats.reduce((s, x) => s + x.s.pnl, 0);
  const todayChange = stats.reduce((s, x) => s + (x.s.lastDay?.d === today ? x.s.lastDay.change : 0), 0);
  const updatedToday = stats.filter((x) => x.s.updatedToday).length;
  const byType = new Map<InvType, number>();
  for (const x of stats) byType.set(x.item.data.type, (byType.get(x.item.data.type) ?? 0) + x.s.value);
  const viewed = all.find((i) => i.id === viewing) ?? null;

  return (
    <div className="fz-invest">
      <div className="fz-kpis">
        <div className="fz-kpi">
          <span>Valor de hoy</span>
          <b>{money(value)}</b>
          <small>
            {active.length} {active.length === 1 ? 'inversión' : 'inversiones'}
          </small>
        </div>
        <div className="fz-kpi">
          <span>Lo que has puesto</span>
          <b>{money(invested)}</b>
          <small>Aportes menos retiros</small>
        </div>
        <div className={'fz-kpi ' + (pnl > 0 ? 'in' : pnl < 0 ? 'out' : '')}>
          <span>Ganancia o pérdida</span>
          <b>{signed(Math.round(pnl))}</b>
          <small>{contributed ? `${pnl >= 0 ? '+' : '−'}${percent(Math.abs(pnl / contributed))} sobre lo aportado` : '\u00a0'}</small>
        </div>
        <div className={'fz-kpi ' + (todayChange > 0 ? 'in' : todayChange < 0 ? 'out' : '')}>
          <span>Hoy</span>
          <b>{updatedToday ? signed(Math.round(todayChange)) : '—'}</b>
          <small>
            {updatedToday}/{active.length} actualizadas hoy
          </small>
        </div>
      </div>

      <div className="fz-invest-bar">
        {value > 0 && (
          <div className="fz-alloc" aria-label="Distribución">
            {[...byType.entries()]
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([t, v]) => (
                <i
                  key={t}
                  style={{ width: (v / value) * 100 + '%', background: invTypeMeta[t].color }}
                  title={`${invTypeMeta[t].label}: ${money(v)} (${percent(v / value)})`}
                />
              ))}
          </div>
        )}
        <div className="fz-invest-actions">
          {active.length > 0 && (
            <button type="button" className="fz-btn soft" onClick={() => setDaily(true)}>
              <ClipboardList size={15} /> Registro del día
            </button>
          )}
          <button type="button" className="fz-btn primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Nueva inversión
          </button>
        </div>
      </div>
      {value > 0 && (
        <ul className="fz-alloc-legend">
          {[...byType.entries()]
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([t, v]) => (
              <li key={t}>
                <i style={{ background: invTypeMeta[t].color }} /> {invTypeMeta[t].label} <b>{percent(v / value)}</b>
              </li>
            ))}
        </ul>
      )}

      {stats.length ? (
        <div className="fz-inv-grid">
          {stats.map(({ item, s }) => {
            const meta = invTypeMeta[item.data.type];
            const last = s.lastDay ? dayLabel(s.lastDay) : null;
            return (
              <article key={item.id} className="fz-inv" style={{ '--c': meta.color } as CSSProperties}>
                <header>
                  <button type="button" className="fz-inv-name" onClick={() => setViewing(item.id)}>
                    <strong>{item.title}</strong>
                    <small>
                      {meta.label}
                      {item.data.platform && ` · ${item.data.platform}`}
                    </small>
                  </button>
                  <span className={'fz-chip ' + (s.updatedToday ? 'good' : s.staleDays && s.staleDays > 3 ? 'warn' : 'muted')}>
                    {s.last ? (s.updatedToday ? 'Hoy' : relDays(-(s.staleDays ?? 0))) : 'Sin datos'}
                  </span>
                </header>
                <div className="fz-inv-value">
                  <b>{money(s.value)}</b>
                  <Delta value={s.pnl} base={s.contributed} />
                </div>
                <Line series={[{ values: item.data.log.slice(-60).map((m) => m.v), color: meta.color, fill: true }]} height={56} />
                {s.days.length > 0 && <DayBars days={s.days} count={30} />}
                <footer>
                  {last && s.lastDay ? (
                    <span className={'fz-inv-last ' + last.tone}>
                      {friendlyDate(s.lastDay.d)}: {last.text} {s.lastDay.change !== 0 && <b>{signed(Math.round(s.lastDay.change))}</b>}
                    </span>
                  ) : (
                    <span className="fz-inv-last flat">Registra su valor cada día para ver cómo le va.</span>
                  )}
                  <button type="button" className="fz-btn soft sm" onClick={() => setMarking(item)}>
                    Actualizar
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={<TrendingUp size={22} />}
          title="Tus inversiones, día a día"
          text="Acciones, cripto, un CDT, un negocio, un bolsillo: anota cuánto pusiste y cuánto vale cada día. Verás si fue ganancia, pérdida o neutral, y tus aportes y retiros."
        >
          <button type="button" className="fz-btn primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Agregar la primera
          </button>
        </Empty>
      )}

      {closed.length > 0 && (
        <div className="fz-closed">
          <button type="button" className="fz-link" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Ocultar' : 'Ver'} cerradas ({closed.length})
          </button>
          {showClosed && (
            <ul>
              {closed.map((i) => {
                const s = invStats(i.data);
                return (
                  <li key={i.id}>
                    <button type="button" className="fz-link" onClick={() => setViewing(i.id)}>
                      {i.title}
                    </button>
                    <small>Cerrada {i.data.closedOn ? friendlyDate(i.data.closedOn).toLowerCase() : ''}</small>
                    <Delta value={s.withdrawn + s.value - s.contributed} base={s.contributed} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {adding && <NewInvestment onClose={() => setAdding(false)} />}
      {marking && <MarkSheet item={marking} onClose={() => setMarking(null)} />}
      {daily && <DailySheet items={active} onClose={() => setDaily(false)} />}
      {viewed && <InvDetail item={viewed} onClose={() => setViewing(null)} onMark={() => setMarking(viewed)} />}
    </div>
  );
}

function useAccounts() {
  const fin = useFinance();
  const s = settingsOf(fin.items);
  return (s.accounts.length ? s.accounts : defaultAccounts).map((a) => a.name);
}

function NewInvestment({ onClose, item }: { onClose: () => void; item?: FinItem<'inversion'> }) {
  const { notify, createEntry } = useApp();
  const accounts = useAccounts();
  const [name, setName] = useState(item?.title ?? '');
  const [type, setType] = useState<InvType>(item?.data.type ?? 'acciones');
  const [platform, setPlatform] = useState(item?.data.platform ?? '');
  const [date, setDate] = useState(todayInputValue());
  const [put, setPut] = useState(0);
  const [value, setValue] = useState(0);
  const [register, setRegister] = useState(false);
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = name.trim() && (item || put > 0 || value > 0);

  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    if (item) {
      const r = await updateItem(item, { title: name, data: { type, platform: platform.trim() || undefined } });
      setBusy(false);
      if (r !== true) return notify(r);
      return onClose();
    }
    const log: Mark[] = [{ d: date, v: value || put, ...(put ? { f: put } : {}) }];
    const data: Investment = { type, platform: platform.trim() || undefined, log };
    const r = await createItem('inversion', name, data);
    if (typeof r !== 'string' && register && put)
      await createEntry(
        moneyInput({
          title: `Inversión en ${name.trim()}`,
          amount: put,
          direction: 'egreso',
          date,
          tags: ['Inversión'],
          details: { flow: 'ahorro', ...(method && { method }) },
        }),
        true,
      );
    setBusy(false);
    if (typeof r === 'string') return notify(r);
    notify('Inversión agregada. Actualízala cada día para ver cómo le va.');
    onClose();
  };

  return (
    <FinSheet
      title={item ? 'Editar inversión' : 'Nueva inversión'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={!ok || busy} onClick={() => void save()}>
            Guardar
          </button>
        </>
      }
    >
      <div className="fz-form">
        <Field label="Nombre" wide>
          <input className="fz-input" value={name} maxLength={200} autoFocus placeholder="Bitcoin, CDT Bancolombia, el negocio de café…" onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <ChoiceChips
        label="Tipo"
        options={invTypes.map((t) => ({ value: t, label: invTypeMeta[t].label }))}
        value={type}
        onChange={(v) => v && setType(v)}
      />
      <div className="fz-form">
        <Field label="Plataforma" hint="Opcional">
          <input className="fz-input" value={platform} maxLength={80} placeholder="Binance, trii, Nu, banco…" onChange={(e) => setPlatform(e.target.value)} />
        </Field>
        {!item && (
          <>
            <Field label="Desde">
              <input className="fz-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="¿Cuánto pusiste?">
              <MoneyField value={put} onChange={setPut} />
            </Field>
            <Field label="¿Cuánto vale hoy?" hint="Si es distinto">
              <MoneyField value={value} onChange={setValue} placeholder={put ? money(put).replace('$', '').trim() : '0'} />
            </Field>
          </>
        )}
      </div>
      {!item && put > 0 && (
        <>
          <label className="fz-check">
            <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} />
            Registrar el aporte como movimiento (ahorro: no cuenta como gasto)
          </label>
          {register && (
            <Field label="Cuenta">
              <select className="fz-input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Sin cuenta</option>
                {accounts.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
    </FinSheet>
  );
}

function MarkSheet({ item, onClose }: { item: FinItem<'inversion'>; onClose: () => void }) {
  const { notify, createEntry } = useApp();
  const accounts = useAccounts();
  const s = invStats(item.data);
  const [date, setDate] = useState(todayInputValue());
  const [value, setValue] = useState(s.value);
  const [move, setMove] = useState<'nada' | 'aporte' | 'retiro'>('nada');
  const [flowAmount, setFlowAmount] = useState(0);
  const [note, setNote] = useState('');
  const [register, setRegister] = useState(false);
  const [method, setMethod] = useState('');
  const f = move === 'aporte' ? flowAmount : move === 'retiro' ? -flowAmount : 0;
  const prev = [...item.data.log].filter((m) => m.d < date).pop() ?? null;
  const change = prev ? value - prev.v - f : 0;
  const t = tone(change, prev?.v ?? 0);

  const save = async () => {
    const log = addMark(item.data.log, { d: date, v: value, ...(f ? { f } : {}), ...(note.trim() ? { n: note.trim() } : {}) });
    const r = await updateItem(item, { data: { log } });
    if (r !== true) return notify(r);
    if (register && f)
      await createEntry(
        moneyInput({
          title: `${f > 0 ? 'Aporte a' : 'Retiro de'} ${item.title}`,
          amount: Math.abs(f),
          direction: f > 0 ? 'egreso' : 'ingreso',
          date,
          tags: ['Inversión'],
          details: { flow: 'ahorro', ...(method && { method }) },
        }),
        true,
      );
    notify(prev ? `${item.title}: ${toneLabel[t].toLowerCase()} de ${money(Math.abs(Math.round(change)))}.` : 'Valor guardado.');
    onClose();
  };

  return (
    <FinSheet
      title={`Actualizar ${item.title}`}
      sub={s.last ? `Último valor: ${money(s.last.v)} (${friendlyDate(s.last.d).toLowerCase()})` : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={value < 0} onClick={() => void save()}>
            Guardar
          </button>
        </>
      }
    >
      <div className="fz-form">
        <Field label="¿Cuánto vale?">
          <MoneyField value={value} onChange={setValue} autoFocus />
        </Field>
        <Field label="Día">
          <input className="fz-input" type="date" value={date} max={todayInputValue()} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Segmented
        label="Movimiento"
        value={move}
        onChange={setMove}
        options={[
          { value: 'nada', label: 'Solo el valor' },
          { value: 'aporte', label: 'Aporté' },
          { value: 'retiro', label: 'Retiré' },
        ]}
      />
      {move !== 'nada' && (
        <div className="fz-form">
          <Field label={move === 'aporte' ? '¿Cuánto aportaste?' : '¿Cuánto retiraste?'}>
            <MoneyField value={flowAmount} onChange={setFlowAmount} />
          </Field>
          <Field label="Cuenta" hint="Opcional">
            <select className="fz-input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Sin cuenta</option>
              {accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {move !== 'nada' && (
        <label className="fz-check">
          <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} />
          Registrar el {move} como movimiento
        </label>
      )}
      <Field label="Nota" hint="Opcional">
        <input className="fz-input" value={note} maxLength={200} placeholder="Qué pasó hoy" onChange={(e) => setNote(e.target.value)} />
      </Field>
      {prev && (
        <p className={'fz-result ' + t}>
          {toneLabel[t]} de <b>{money(Math.abs(Math.round(change)))}</b>
          {prev.v ? ` (${percent(Math.abs(change / prev.v))})` : ''} frente al {friendlyDate(prev.d).toLowerCase()}
          {f ? ` · sin contar el ${f > 0 ? 'aporte' : 'retiro'}` : ''}.
        </p>
      )}
    </FinSheet>
  );
}

/** Todas las inversiones en una sola pantalla: escribes el valor de hoy y listo. */
function DailySheet({ items, onClose }: { items: FinItem<'inversion'>[]; onClose: () => void }) {
  const { notify } = useApp();
  const today = todayInputValue();
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.id, invStats(i.data).value])),
  );
  const [busy, setBusy] = useState(false);
  const rows = items.map((i) => {
    const prev = [...i.data.log].filter((m) => m.d < today).pop() ?? null;
    const v = values[i.id] ?? 0;
    const change = prev ? v - prev.v : 0;
    return { i, prev, v, change };
  });
  const total = rows.reduce((s, r) => s + r.change, 0);

  const save = async () => {
    setBusy(true);
    for (const r of rows) {
      // Lo que no cambió también se guarda: queda como un día neutral.
      const log = addMark(r.i.data.log, { d: today, v: r.v });
      const res = await updateItem(r.i, { data: { log } });
      if (res !== true) {
        setBusy(false);
        return notify(res);
      }
    }
    setBusy(false);
    notify(`Día registrado: ${total > 0 ? 'ganancia' : total < 0 ? 'pérdida' : 'neutral'} de ${money(Math.abs(Math.round(total)))}.`);
    onClose();
  };

  return (
    <FinSheet
      title="Registro del día"
      sub="Escribe cuánto vale cada una hoy. Lo que no cambió queda como neutral."
      onClose={onClose}
      footer={
        <>
          <span className={'fz-foot-note ' + tone(total)}>
            Hoy: <b>{signed(Math.round(total))}</b>
          </span>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={busy} onClick={() => void save()}>
            Guardar el día
          </button>
        </>
      }
    >
      <div className="fz-daily">
        {rows.map(({ i, prev, v, change }) => {
          const t = tone(change, prev?.v ?? 0);
          return (
            <div key={i.id} className="fz-daily-row">
              <span>
                <b>{i.title}</b>
                <small>{prev ? `Antes ${moneyShort(prev.v)} · ${friendlyDate(prev.d).toLowerCase()}` : 'Primer registro'}</small>
              </span>
              <MoneyField value={v} onChange={(n) => setValues((x) => ({ ...x, [i.id]: n }))} ariaLabel={`Valor de ${i.title}`} />
              <em className={'fz-delta ' + t}>{prev ? `${toneLabel[t]} ${signed(Math.round(change))}` : '—'}</em>
            </div>
          );
        })}
      </div>
    </FinSheet>
  );
}

function InvDetail({ item, onClose, onMark }: { item: FinItem<'inversion'>; onClose: () => void; onMark: () => void }) {
  const { notify, confirm } = useApp();
  const [editing, setEditing] = useState(false);
  const s = invStats(item.data);
  const meta = invTypeMeta[item.data.type];
  const [month, setMonth] = useState(monthKey(s.last?.d ?? todayInputValue()));
  const byDay = useMemo(() => new Map(s.days.map((x) => [x.d, x])), [s.days]);
  const best = [...s.days].sort((a, b) => b.change - a.change)[0];
  const worst = [...s.days].sort((a, b) => a.change - b.change)[0];
  const history = [...item.data.log].reverse();
  const dayOfMark = new Map(s.days.map((x) => [x.d, x]));

  const removeMark = async (d: string) => {
    const r = await updateItem(item, { data: { log: item.data.log.filter((m) => m.d !== d) } });
    if (r !== true) notify(r);
  };
  const close = async () => {
    const ok = await confirm({
      title: `¿Cerrar «${item.title}»?`,
      message: 'Queda en «cerradas» con su resultado final. Antes registra el retiro final si sacaste la plata.',
      confirmLabel: 'Cerrar inversión',
      icon: 'question',
    });
    if (!ok) return;
    const r = await updateItem(item, { data: { closedOn: todayInputValue() } });
    if (r !== true) notify(r);
    else onClose();
  };
  const remove = async () => {
    const r = await removeItem(item);
    if (r !== true) return notify(r);
    notify('Inversión eliminada.', { label: 'Deshacer', run: () => void restoreItem(item) });
    onClose();
  };

  if (editing) return <NewInvestment item={item} onClose={() => setEditing(false)} />;
  return (
    <FinSheet
      title={item.title}
      sub={`${meta.label}${item.data.platform ? ` · ${item.data.platform}` : ''}${item.data.closedOn ? ' · cerrada' : ''}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="fz-icon" aria-label="Editar" title="Editar" onClick={() => setEditing(true)}>
            <Pencil size={15} />
          </button>
          {!item.data.closedOn && (
            <button type="button" className="fz-icon" aria-label="Cerrar inversión" title="Cerrar inversión" onClick={() => void close()}>
              <Archive size={15} />
            </button>
          )}
          <button type="button" className="fz-icon" aria-label="Eliminar" title="Eliminar" onClick={() => void remove()}>
            <Trash2 size={15} />
          </button>
          <span className="fz-foot-note" />
          {!item.data.closedOn && (
            <button type="button" className="fz-btn primary" onClick={onMark}>
              Actualizar valor
            </button>
          )}
        </>
      }
    >
      <div className="fz-inv-head">
        <div>
          <span>Vale</span>
          <b>{money(s.value)}</b>
          <Delta value={s.pnl} base={s.contributed} big />
        </div>
        <dl>
          <div>
            <dt>Aportado</dt>
            <dd>{money(s.contributed)}</dd>
          </div>
          <div>
            <dt>Retirado</dt>
            <dd>{money(s.withdrawn)}</dd>
          </div>
          <div>
            <dt>Días</dt>
            <dd>
              <span className="up">{s.wins} ▲</span> <span className="down">{s.losses} ▼</span>
            </dd>
          </div>
          {best && best.change > 0 && (
            <div>
              <dt>Mejor día</dt>
              <dd className="up">
                {signed(Math.round(best.change))} <small>{friendlyDate(best.d)}</small>
              </dd>
            </div>
          )}
          {worst && worst.change < 0 && (
            <div>
              <dt>Peor día</dt>
              <dd className="down">
                {signed(Math.round(worst.change))} <small>{friendlyDate(worst.d)}</small>
              </dd>
            </div>
          )}
        </dl>
      </div>

      <Line series={[{ values: item.data.log.map((m) => m.v), color: meta.color, fill: true }]} height={130} />

      <div className="fz-inv-month">
        <header>
          <button type="button" className="fz-icon" aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft size={15} />
          </button>
          <strong>
            {monthName(month)} {month.slice(0, 4)}
          </strong>
          <button type="button" className="fz-icon" aria-label="Mes siguiente" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight size={15} />
          </button>
          <span className="fz-key">
            <i className="up" /> Ganancia <i className="down" /> Pérdida <i className="flat" /> Neutral
          </span>
        </header>
        <MonthGrid
          month={month}
          cell={(d) => {
            const x = byDay.get(d);
            if (!x) return null;
            const t = tone(x.change, x.v);
            return { tone: t, tip: `${friendlyDate(d)}: ${dayLabel(x).text} ${signed(Math.round(x.change))}` };
          }}
        />
      </div>

      <h4 className="fz-sub">Historial</h4>
      <ul className="fz-history">
        {history.map((m) => {
          const x = dayOfMark.get(m.d);
          const l = x ? dayLabel(x) : null;
          return (
            <li key={m.d}>
              <span className="fz-when">{friendlyDate(m.d)}</span>
              <span className="fz-h-main">
                <b>{money(m.v)}</b>
                <small>
                  {l ? l.text : m.f ? `Aporte inicial ${moneyShort(m.f)}` : 'Primer registro'}
                  {m.n && ` · ${m.n}`}
                </small>
              </span>
              {x ? <em className={'fz-delta ' + l!.tone}>{signed(Math.round(x.change))}</em> : <em />}
              <button type="button" className="fz-icon" aria-label="Borrar registro" onClick={() => void removeMark(m.d)}>
                <Trash2 size={13} />
              </button>
            </li>
          );
        })}
      </ul>
      {s.staleDays !== null && s.staleDays > 0 && !item.data.closedOn && (
        <p className="fz-muted">Último registro {relDays(-s.staleDays)}. {daysBetween(s.last!.d, todayInputValue()) > 1 ? 'Los días sin registro no cuentan.' : ''}</p>
      )}
    </FinSheet>
  );
}
