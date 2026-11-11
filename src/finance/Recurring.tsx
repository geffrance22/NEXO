import { useMemo, useState } from 'react';
import { CalendarClock, CalendarPlus, Check, Pause, Pencil, Play, Plus, Repeat, Trash2, Tv } from 'lucide-react';
import { useApp } from '../AppContext';
import { ChoiceChips, Segmented } from '../composer/controls';
import { expenseCategories, incomeCategories } from '../composer/logic';
import type { Direction } from '../data';
import { friendlyDate, money, normalizeText, todayInputValue } from '../lib/format';
import {
  defaultAccounts,
  doneNow,
  itemsOf,
  monthlyCost,
  periodKeyOf,
  recurringStatus,
  type FinItem,
  type Recurring,
} from './model';
import { dayOf, isMoney, monthKey, monthName, moneyShort, shiftMonth } from './money';
import { createItem, removeItem, restoreItem, settingsOf, updateItem, useFinance } from './store';
import { download, Empty, Field, FinSheet, MoneyField, moneyInput, relDays } from './ui';

const monthsList = Array.from({ length: 12 }, (_, i) => monthName(`2000-${String(i + 1).padStart(2, '0')}`));

function whenText(r: Recurring) {
  return r.every === 'año' ? `Cada año, el ${r.day} de ${monthsList[(r.month ?? 1) - 1]}` : `Cada mes, el día ${r.day}`;
}

/** Calendario (.ics) con tus fijos y lo que está por pagar o cobrar. */
function icsFor(items: FinItem<'recurrente'>[]) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nexo//Finanzas//ES', 'CALSCALE:GREGORIAN'];
  for (const r of items) {
    if (r.data.paused) continue;
    const s = recurringStatus(r.data);
    const start = s.due.replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.id}@nexo`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `SUMMARY:${esc(`${r.data.dir === 'ingreso' ? 'Cobrar' : 'Pagar'} ${r.title} · ${money(r.data.amount)}`)}`,
      r.data.every === 'año'
        ? `RRULE:FREQ=YEARLY;BYMONTH=${r.data.month ?? 1};BYMONTHDAY=${Math.min(r.data.day, 28)}`
        : `RRULE:FREQ=MONTHLY;BYMONTHDAY=${Math.min(r.data.day, 28)}`,
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(r.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function RecurringTab() {
  const { workspace, notify, createEntry, removeEntry } = useApp();
  const fin = useFinance();
  const [editing, setEditing] = useState<FinItem<'recurrente'> | 'new' | null>(null);
  const [draft, setDraft] = useState<Partial<Recurring> & { title?: string }>({});
  const today = todayInputValue();
  const items = itemsOf(fin.items, 'recurrente').filter((r) => !r.archived);
  const rows = items
    .map((r) => ({ r, s: recurringStatus(r.data, today), now: doneNow(r.data, today) }))
    .sort((a, b) => Number(a.r.data.paused ?? false) - Number(b.r.data.paused ?? false) || a.s.due.localeCompare(b.s.due));
  const live = items.filter((r) => !r.data.paused);
  const fixedOut = live.filter((r) => r.data.dir === 'egreso' && r.data.kind === 'fijo').reduce((s, r) => s + monthlyCost(r.data), 0);
  const subs = live.filter((r) => r.data.kind === 'suscripcion' && r.data.dir === 'egreso').reduce((s, r) => s + monthlyCost(r.data), 0);
  const fixedIn = live.filter((r) => r.data.dir === 'ingreso').reduce((s, r) => s + monthlyCost(r.data), 0);

  // Lo que parece repetirse cada mes y aún no es un fijo.
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const suggestions = useMemo(() => {
    const since = shiftMonth(monthKey(today), -4);
    const known = new Set(items.map((r) => normalizeText(r.title)));
    const by = new Map<string, { title: string; months: Set<string>; amounts: number[]; dir: Direction; cat?: string; method?: string; day: number }>();
    for (const e of moves) {
      if (e.details.recurringId || e.details.pending) continue;
      const m = monthKey(dayOf(e));
      if (m < since) continue;
      const key = normalizeText(e.title).trim();
      if (key.length < 3 || known.has(key)) continue;
      const g = by.get(key) ?? { title: e.title, months: new Set(), amounts: [], dir: e.direction, cat: e.tags[0], method: e.details.method, day: Number(dayOf(e).slice(8)) };
      g.months.add(m);
      g.amounts.push(e.amount);
      by.set(key, g);
    }
    return [...by.values()]
      .filter((g) => g.months.size >= 3)
      .filter((g) => {
        const min = Math.min(...g.amounts);
        const max = Math.max(...g.amounts);
        return max <= min * 1.25;
      })
      .slice(0, 4);
  }, [moves, items, today]);

  const register = async (item: FinItem<'recurrente'>) => {
    const r = item.data;
    const s = recurringStatus(r, today);
    const period = doneNow(r, today) ? s.period : periodKeyOf(r, today);
    const e = await createEntry(
      moneyInput({
        title: item.title,
        amount: r.amount,
        direction: r.dir,
        tags: r.category ? [r.category] : [],
        personIds: r.personIds ?? [],
        details: { flow: r.flow ?? (r.dir === 'ingreso' ? 'ingreso' : 'gasto'), recurringId: item.id, ...(r.method && { method: r.method }) },
      }),
      true,
    );
    if (!e) return;
    const res = await updateItem(item, { data: { done: [...new Set([...r.done, period])] } });
    if (res !== true) return notify(res);
    notify(`${item.title}: ${money(r.amount)} registrado.`, {
      label: 'Deshacer',
      run: () => {
        removeEntry(e, true);
        void updateItem(item, { data: { done: r.done } });
      },
    });
  };
  const remove = async (item: FinItem<'recurrente'>) => {
    const r = await removeItem(item);
    if (r !== true) return notify(r);
    notify('Fijo eliminado.', { label: 'Deshacer', run: () => void restoreItem(item) });
  };

  return (
    <div className="fz-fixed">
      <div className="fz-kpis">
        <div className="fz-kpi out">
          <span>Fijos al mes</span>
          <b>{money(Math.round(fixedOut))}</b>
          <small>Arriendo, servicios, cuotas…</small>
        </div>
        <div className="fz-kpi out">
          <span>Suscripciones</span>
          <b>{money(Math.round(subs))}</b>
          <small>{subs ? `${moneyShort(subs * 12)} al año: ¿las usas todas?` : 'Ninguna anotada'}</small>
        </div>
        <div className="fz-kpi in">
          <span>Ingresos fijos</span>
          <b>{money(Math.round(fixedIn))}</b>
          <small>Al mes</small>
        </div>
        <div className="fz-kpi-actions">
          <button
            type="button"
            className="fz-btn primary"
            onClick={() => {
              setDraft({});
              setEditing('new');
            }}
          >
            <Plus size={16} /> Nuevo fijo
          </button>
          {live.length > 0 && (
            <button type="button" className="fz-btn ghost sm" onClick={() => download('nexo-pagos.ics', icsFor(live), 'text/calendar')}>
              <CalendarPlus size={14} /> A mi calendario
            </button>
          )}
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="fz-suggest">
          <Repeat size={15} />
          <div>
            <strong>Esto parece repetirse cada mes</strong>
            {suggestions.map((g) => (
              <p key={g.title}>
                <span>
                  {g.title} · ~{money(Math.round(g.amounts.reduce((s, a) => s + a, 0) / g.amounts.length))} · {g.months.size} meses
                </span>
                <button
                  type="button"
                  className="fz-btn sm soft"
                  onClick={() => {
                    setDraft({
                      title: g.title,
                      amount: Math.round(g.amounts[g.amounts.length - 1]),
                      dir: g.dir,
                      category: g.cat,
                      method: g.method,
                      day: g.day,
                    });
                    setEditing('new');
                  }}
                >
                  Agregar a fijos
                </button>
              </p>
            ))}
          </div>
        </div>
      )}

      {rows.length ? (
        <ul className="fz-fixed-list">
          {rows.map(({ r, s, now }) => {
            const late = !now && s.inDays < 0;
            return (
              <li key={r.id} className={(r.data.paused ? 'paused' : '') + (late ? ' late' : '')}>
                <span className={'fz-ico ' + (r.data.dir === 'ingreso' ? 'in' : 'out')}>
                  {r.data.kind === 'suscripcion' ? <Tv size={16} /> : <CalendarClock size={16} />}
                </span>
                <span className="fz-fixed-main">
                  <strong>{r.title}</strong>
                  <small>
                    {whenText(r.data)}
                    {r.data.category && ` · ${r.data.category}`}
                    {r.data.method && ` · ${r.data.method}`}
                  </small>
                </span>
                <span className="fz-fixed-state">
                  {r.data.paused ? (
                    <em className="fz-chip muted">En pausa</em>
                  ) : now ? (
                    <em className="fz-chip good">
                      <Check size={11} /> {r.data.every === 'año' ? 'Este año' : 'Este mes'} · próximo {friendlyDate(s.due).toLowerCase()}
                    </em>
                  ) : (
                    <em className={'fz-chip ' + (late ? 'bad' : s.inDays <= 3 ? 'warn' : 'muted')}>
                      {late ? `Venció ${relDays(s.inDays)}` : s.inDays === 0 ? 'Toca hoy' : `Toca ${relDays(s.inDays)}`}
                    </em>
                  )}
                </span>
                <b className={r.data.dir === 'ingreso' ? 'in' : 'out'}>
                  {r.data.dir === 'ingreso' ? '+' : '−'}
                  {money(r.data.amount)}
                </b>
                <span className="fz-row-tools">
                  {!r.data.paused && (
                    <button type="button" className="fz-btn soft sm" onClick={() => void register(r)}>
                      {now ? 'Adelantar' : 'Registrar'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="fz-icon"
                    aria-label={r.data.paused ? 'Reanudar' : 'Pausar'}
                    title={r.data.paused ? 'Reanudar' : 'Pausar'}
                    onClick={() => void updateItem(r, { data: { paused: !r.data.paused } })}
                  >
                    {r.data.paused ? <Play size={14} /> : <Pause size={14} />}
                  </button>
                  <button type="button" className="fz-icon" aria-label="Editar" title="Editar" onClick={() => setEditing(r)}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="fz-icon" aria-label="Eliminar" title="Eliminar" onClick={() => void remove(r)}>
                    <Trash2 size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          icon={<CalendarClock size={22} />}
          title="Lo que pagas o cobras cada mes"
          text="Arriendo, servicios, el sueldo, Netflix… Nexo te avisa en tu agenda cuando toque y lo registras con un toque. También puedes marcar «Se repite» al guardar un movimiento."
        />
      )}

      {editing && (
        <RecurringSheet
          item={editing === 'new' ? null : editing}
          draft={editing === 'new' ? draft : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RecurringSheet({
  item,
  draft,
  onClose,
}: {
  item: FinItem<'recurrente'> | null;
  draft?: Partial<Recurring> & { title?: string };
  onClose: () => void;
}) {
  const { notify } = useApp();
  const fin = useFinance();
  const settings = settingsOf(fin.items);
  const accounts = (settings.accounts.length ? settings.accounts : defaultAccounts).map((a) => a.name);
  const base = item?.data ?? draft ?? {};
  const [title, setTitle] = useState(item?.title ?? draft?.title ?? '');
  const [amount, setAmount] = useState(base.amount ?? 0);
  const [dir, setDir] = useState<Direction>(base.dir ?? 'egreso');
  const [kind, setKind] = useState<Recurring['kind']>(base.kind ?? 'fijo');
  const [every, setEvery] = useState<Recurring['every']>(base.every ?? 'mes');
  const [day, setDay] = useState(base.day ?? Number(todayInputValue().slice(8)));
  const [month, setMonth] = useState(base.month ?? Number(todayInputValue().slice(5, 7)));
  const [category, setCategory] = useState<string | undefined>(base.category);
  const [method, setMethod] = useState<string | undefined>(base.method);
  const cats = dir === 'ingreso' ? [...incomeCategories, ...settings.extraIn] : [...expenseCategories, ...settings.extraOut];
  const ok = title.trim() && amount > 0;

  const save = async () => {
    if (!ok) return;
    const data: Partial<Recurring> = {
      amount,
      dir,
      flow: dir === 'ingreso' ? 'ingreso' : category === 'Ahorro' ? 'ahorro' : 'gasto',
      kind,
      every,
      day: Math.min(31, Math.max(1, day)),
      month: every === 'año' ? month : undefined,
      category,
      method,
    };
    const r = item
      ? await updateItem(item, { title, data })
      : await createItem('recurrente', title, { done: [], start: todayInputValue(), ...data } as Recurring);
    if (typeof r === 'string') return notify(r);
    notify(item ? 'Fijo actualizado.' : 'Fijo agregado: te avisará en tu agenda.');
    onClose();
  };

  return (
    <FinSheet
      title={item ? 'Editar fijo' : 'Nuevo fijo'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={!ok} onClick={() => void save()}>
            Guardar
          </button>
        </>
      }
    >
      <Segmented
        label="Tipo"
        value={dir}
        onChange={(v) => {
          setDir(v);
          setCategory(undefined);
        }}
        options={[
          { value: 'egreso', label: 'Pago' },
          { value: 'ingreso', label: 'Ingreso' },
        ]}
      />
      <div className="fz-form">
        <Field label="Nombre">
          <input className="fz-input" value={title} maxLength={200} autoFocus placeholder="Arriendo, Internet, Spotify, Sueldo…" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Monto">
          <MoneyField value={amount} onChange={setAmount} />
        </Field>
        <Field label="Cada">
          <select className="fz-input" value={every} onChange={(e) => setEvery(e.target.value as Recurring['every'])}>
            <option value="mes">Mes</option>
            <option value="año">Año</option>
          </select>
        </Field>
        <Field label="Día">
          <input className="fz-input" type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value) || 1)} />
        </Field>
        {every === 'año' && (
          <Field label="Mes">
            <select className="fz-input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {monthsList.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        )}
        {dir === 'egreso' && (
          <Field label="Es">
            <select className="fz-input" value={kind} onChange={(e) => setKind(e.target.value as Recurring['kind'])}>
              <option value="fijo">Un gasto fijo</option>
              <option value="suscripcion">Una suscripción</option>
            </select>
          </Field>
        )}
      </div>
      <Field label="Categoría" hint="Opcional" group>
        <ChoiceChips label="Categoría" options={cats} clearable value={category} onChange={setCategory} />
      </Field>
      <Field label="Cuenta" hint="Opcional" group>
        <ChoiceChips label="Cuenta" options={accounts} clearable value={method} onChange={setMethod} />
      </Field>
    </FinSheet>
  );
}
