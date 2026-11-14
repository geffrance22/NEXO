import { useState } from 'react';
import { Check, HandCoins, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../AppContext';
import { Segmented } from '../composer/controls';
import type { Person } from '../data';
import { friendlyDate, initials, money, todayInputValue } from '../lib/format';
import { Avatar } from '../people/Avatar';
import { ChargesBlock } from './Charges';
import { Progress } from './charts';
import {
  debtBalances,
  defaultAccounts,
  isOpenDebt,
  itemsOf,
  paidOf,
  remainingOf,
  type Debt,
  type FinItem,
} from './model';
import { daysBetween, moneyShort } from './money';
import { createItem, removeItem, restoreItem, settingsOf, updateItem, useFinance } from './store';
import { Empty, Field, FinSheet, MoneyField, moneyInput, PersonInput, relDays } from './ui';

const first = (name: string) => name.split(' ')[0] || name;

function whatsapp(person: Person | undefined, text: string) {
  const digits = person?.profile.phone?.replace(/[^\d+]/g, '').replace(/^\+/, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

export function DebtsTab() {
  const { workspace, notify, confirm } = useApp();
  const fin = useFinance();
  const [editing, setEditing] = useState<FinItem<'deuda'> | 'new' | null>(null);
  const [paying, setPaying] = useState<FinItem<'deuda'> | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const debts = itemsOf(fin.items, 'deuda').filter((d) => !d.archived);
  const rows = debtBalances(debts);
  const owed = rows.filter((r) => r.net > 0);
  const owe = rows.filter((r) => r.net < 0);
  const closed = debts.filter((d) => !isOpenDebt(d.data)).sort((a, b) => (b.data.closedOn ?? '').localeCompare(a.data.closedOn ?? ''));
  const today = todayInputValue();
  const person = (id?: string) => (id ? workspace.people.find((p) => p.id === id) : undefined);

  const remove = async (d: FinItem<'deuda'>) => {
    const r = await removeItem(d);
    if (r !== true) return notify(r);
    notify('Deuda eliminada.', { label: 'Deshacer', run: () => void restoreItem(d) });
  };
  const settle = async (d: FinItem<'deuda'>) => {
    const left = remainingOf(d.data);
    const ok = await confirm({
      title: `¿Saldar ${money(left)} con ${first(d.data.who)}?`,
      message: 'Queda como pagada sin registrar un movimiento. Si hubo plata de por medio, usa «Abonar».',
      confirmLabel: 'Saldar',
      icon: 'question',
    });
    if (!ok) return;
    const r = await updateItem(d, {
      data: {
        payments: [...d.data.payments, { id: crypto.randomUUID(), d: today, amount: left, note: 'Saldada' }],
        closedOn: today,
      },
    });
    if (r !== true) notify(r);
  };

  return (
    <div className="fz-debts">
      <ChargesBlock />
      <h4 className="fz-sub">Deudas con personas</h4>
      <div className="fz-kpis two">
        <div className="fz-kpi in">
          <span>Te deben</span>
          <b>{money(owed.reduce((s, r) => s + r.net, 0))}</b>
          <small>{owed.length ? `${owed.length} ${owed.length === 1 ? 'persona' : 'personas'}` : 'Nadie'}</small>
        </div>
        <div className="fz-kpi out">
          <span>Debes</span>
          <b>{money(owe.reduce((s, r) => s - r.net, 0))}</b>
          <small>{owe.length ? `A ${owe.length} ${owe.length === 1 ? 'persona' : 'personas'}` : 'A nadie'}</small>
        </div>
        <button type="button" className="fz-btn primary fz-kpi-action" onClick={() => setEditing('new')}>
          <Plus size={16} /> Nueva deuda
        </button>
      </div>

      {rows.length ? (
        <div className="fz-people">
          {rows.map((r) => {
            const p = person(r.personId);
            const mine = r.net > 0;
            const total = Math.abs(r.net);
            const msg = `Hola ${first(r.who)}, te escribo por ${r.open.length > 1 ? 'lo que quedó pendiente' : `«${r.open[0].title}»`}: son ${money(total)}. ¡Gracias!`;
            const wa = mine ? whatsapp(p, msg) : null;
            return (
              <section key={r.key} className="fz-person">
                <header>
                  {p ? <Avatar person={p} size={40} /> : <span className="fz-avatar">{initials(r.who)}</span>}
                  <div>
                    <strong>{r.who}</strong>
                    <small className={mine ? 'in' : 'out'}>
                      {mine ? `Te debe ${money(total)}` : `Le debes ${money(total)}`}
                    </small>
                  </div>
                  {wa && (
                    <a className="fz-btn ghost sm" href={wa} target="_blank" rel="noreferrer">
                      <MessageCircle size={14} /> Recordarle
                    </a>
                  )}
                </header>
                <ul>
                  {r.open.map((d) => {
                    const left = remainingOf(d.data);
                    const due = d.data.due ? daysBetween(today, d.data.due) : null;
                    return (
                      <li key={d.id}>
                        <div className="fz-debt-main">
                          <span>
                            <b>{d.title || 'Deuda'}</b>
                            <small>
                              {d.data.dir === 'debo' ? 'Debes' : 'Te debe'} · desde {friendlyDate(d.data.date).toLowerCase()}
                              {d.data.origin === 'division' && ' · gasto dividido'}
                              {d.data.origin === 'prestamo' && ' · préstamo'}
                              {due !== null && (
                                <em className={'fz-chip ' + (due < 0 ? 'bad' : due <= 3 ? 'warn' : 'muted')}>
                                  {due < 0 ? `Venció ${relDays(due)}` : `Vence ${relDays(due)}`}
                                </em>
                              )}
                            </small>
                          </span>
                          <b className={d.data.dir === 'debo' ? 'out' : 'in'}>{money(left)}</b>
                        </div>
                        {d.data.payments.length > 0 && (
                          <div className="fz-debt-paid">
                            <Progress value={paidOf(d.data)} max={d.data.amount} tone="in" />
                            <small>
                              Abonado {money(paidOf(d.data))} de {money(d.data.amount)}
                            </small>
                          </div>
                        )}
                        <div className="fz-debt-tools">
                          <button type="button" className="fz-btn soft sm" onClick={() => setPaying(d)}>
                            <HandCoins size={14} /> Abonar
                          </button>
                          <button type="button" className="fz-btn ghost sm" onClick={() => void settle(d)}>
                            <Check size={14} /> Saldar
                          </button>
                          <button type="button" className="fz-icon" aria-label="Editar" title="Editar" onClick={() => setEditing(d)}>
                            <Pencil size={14} />
                          </button>
                          <button type="button" className="fz-icon" aria-label="Eliminar" title="Eliminar" onClick={() => void remove(d)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={<HandCoins size={22} />}
          title="Cuentas claras"
          text="Lo que prestas, lo que te prestan y los gastos que divides quedan aquí, por persona. Al dividir un gasto en el formulario, la deuda se crea sola."
        >
          <button type="button" className="fz-btn primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Anotar una deuda
          </button>
        </Empty>
      )}

      {closed.length > 0 && (
        <div className="fz-closed">
          <button type="button" className="fz-link" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Ocultar' : 'Ver'} saldadas ({closed.length})
          </button>
          {showClosed && (
            <ul>
              {closed.slice(0, 60).map((d) => (
                <li key={d.id}>
                  <span>
                    {d.data.dir === 'debo' ? 'Le pagaste a' : 'Te pagó'} <b>{first(d.data.who)}</b> · {d.title}
                  </span>
                  <small>{d.data.closedOn ? friendlyDate(d.data.closedOn) : ''}</small>
                  <b>{money(d.data.amount)}</b>
                  <button type="button" className="fz-icon" aria-label="Eliminar" onClick={() => void remove(d)}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && <DebtSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {paying && <PaySheet item={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function DebtSheet({ item, onClose }: { item: FinItem<'deuda'> | null; onClose: () => void }) {
  const { workspace, notify, createEntry } = useApp();
  const fin = useFinance();
  const accounts = (settingsOf(fin.items).accounts.length ? settingsOf(fin.items).accounts : defaultAccounts).map((a) => a.name);
  const d = item?.data;
  const [dir, setDir] = useState<Debt['dir']>(d?.dir ?? 'meDeben');
  const [who, setWho] = useState<{ personId?: string; name: string }>({
    personId: d?.personId,
    name: d?.who ?? '',
  });
  const [amount, setAmount] = useState(d?.amount ?? 0);
  const [title, setTitle] = useState(item?.title ?? '');
  const [date, setDate] = useState(d?.date ?? todayInputValue());
  const [due, setDue] = useState(d?.due ?? '');
  const [register, setRegister] = useState(false);
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const name = (who.personId && workspace.people.find((p) => p.id === who.personId)?.name) || who.name.trim();
  const ok = name && amount > 0;

  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    let entryId = d?.entryId;
    if (!item && register) {
      const e = await createEntry(
        moneyInput({
          title: title || (dir === 'meDeben' ? `Préstamo a ${first(name)}` : `Préstamo de ${first(name)}`),
          amount,
          direction: dir === 'meDeben' ? 'egreso' : 'ingreso',
          personIds: who.personId ? [who.personId] : [],
          date,
          details: { flow: 'prestamo', ...(method && { method }), ...(due && { due }) },
        }),
        true,
      );
      entryId = e?.id;
    }
    const data: Debt = {
      dir,
      personId: who.personId,
      who: name,
      amount,
      date,
      due: due || undefined,
      note: d?.note,
      origin: d?.origin ?? (register ? 'prestamo' : 'otro'),
      entryId,
      payments: d?.payments ?? [],
      closedOn: d?.closedOn,
    };
    const label = title.trim() || (dir === 'meDeben' ? `Le presté a ${first(name)}` : `Me prestó ${first(name)}`);
    const r = item ? await updateItem(item, { title: label, data }) : await createItem('deuda', label, data);
    setBusy(false);
    if (typeof r === 'string') return notify(r);
    notify(item ? 'Deuda actualizada.' : 'Deuda anotada.');
    onClose();
  };

  return (
    <FinSheet
      title={item ? 'Editar deuda' : 'Nueva deuda'}
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
      <Segmented
        label="Dirección"
        value={dir}
        onChange={setDir}
        options={[
          { value: 'meDeben', label: 'Me deben' },
          { value: 'debo', label: 'Debo' },
        ]}
      />
      <div className="fz-form">
        <Field label={dir === 'meDeben' ? '¿Quién te debe?' : '¿A quién le debes?'}>
          <PersonInput people={workspace.people} personId={who.personId} name={who.name} onChange={setWho} />
        </Field>
        <Field label="¿Cuánto?">
          <MoneyField value={amount} onChange={setAmount} autoFocus={!item} />
        </Field>
        <Field label="¿De qué?" hint="Opcional" wide>
          <input className="fz-input" value={title} maxLength={200} placeholder="La cena, el tiquete, un préstamo…" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Desde">
          <input className="fz-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="¿Para cuándo?" hint="Opcional">
          <input className="fz-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      {!item && (
        <label className="fz-check">
          <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} />
          {dir === 'meDeben' ? 'Salió plata de mi cuenta (registrar el préstamo)' : 'Me entró la plata (registrar el préstamo)'}
        </label>
      )}
      {!item && register && (
        <Field label="Cuenta">
          <select className="fz-input" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Sin cuenta</option>
            {accounts.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>
      )}
    </FinSheet>
  );
}

function PaySheet({ item, onClose }: { item: FinItem<'deuda'>; onClose: () => void }) {
  const { notify, createEntry } = useApp();
  const fin = useFinance();
  const accounts = (settingsOf(fin.items).accounts.length ? settingsOf(fin.items).accounts : defaultAccounts).map((a) => a.name);
  const d = item.data;
  const left = remainingOf(d);
  const [amount, setAmount] = useState(left);
  const [date, setDate] = useState(todayInputValue());
  const [note, setNote] = useState('');
  const [register, setRegister] = useState(true);
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const theyPay = d.dir === 'meDeben';

  const save = async () => {
    if (!(amount > 0) || busy) return;
    setBusy(true);
    let entryId: string | undefined;
    if (register) {
      const e = await createEntry(
        moneyInput({
          title: theyPay ? `Abono de ${first(d.who)}` : `Pago a ${first(d.who)}`,
          amount,
          direction: theyPay ? 'ingreso' : 'egreso',
          personIds: d.personId ? [d.personId] : [],
          date,
          details: { flow: 'prestamo', debtId: item.id, ...(method && { method }) },
        }),
        true,
      );
      entryId = e?.id;
    }
    const payments = [...d.payments, { id: crypto.randomUUID(), d: date, amount, ...(note && { note }), ...(entryId && { entryId }) }];
    const done = payments.reduce((s, p) => s + p.amount, 0) >= d.amount;
    const r = await updateItem(item, { data: { payments, ...(done && { closedOn: date }) } });
    setBusy(false);
    if (r !== true) return notify(r);
    notify(done ? `¡Saldada! ${first(d.who)} y tú quedan a paz y salvo.` : `Abono anotado. Quedan ${money(Math.max(0, left - amount))}.`);
    onClose();
  };

  return (
    <FinSheet
      title={theyPay ? `${first(d.who)} te abona` : `Le abonas a ${first(d.who)}`}
      sub={`${item.title} · quedan ${money(left)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={!(amount > 0) || busy} onClick={() => void save()}>
            Anotar abono
          </button>
        </>
      }
    >
      <div className="fz-form">
        <Field label="¿Cuánto?">
          <MoneyField value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="¿Cuándo?">
          <input className="fz-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Nota" hint="Opcional" wide>
          <input className="fz-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="fz-quickamounts">
        {[left, Math.round(left / 2)].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => (
          <button type="button" key={v} onClick={() => setAmount(v)}>
            {v === left ? 'Todo' : 'La mitad'} · {moneyShort(v)}
          </button>
        ))}
      </div>
      <label className="fz-check">
        <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} />
        Registrar el movimiento ({theyPay ? 'te entró la plata' : 'salió de tu cuenta'}; no cuenta como ingreso ni gasto)
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
    </FinSheet>
  );
}
