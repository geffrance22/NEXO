import { useMemo, useState } from 'react';
import {
  BellPlus,
  CalendarClock,
  CalendarPlus,
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Segmented } from '../composer/controls';
import { incomeCategories } from '../composer/logic';
import { addDays, friendlyDate, initials, money, todayInputValue } from '../lib/format';
import { Avatar } from '../people/Avatar';
import { closeCharge, dropPart, ensureChargeTask, postponePart, receiveCharge } from './chargeActions';
import {
  chargeStats,
  defaultAccounts,
  isOpenCharge,
  itemsOf,
  partDelay,
  type Charge,
  type ChargePart,
  type ChargeStats,
  type FinItem,
} from './model';
import { daysBetween, isMoney, moneyShort, percent } from './money';
import { createItem, removeItem, restoreItem, settingsOf, updateItem, useFinance } from './store';
import { EpisodeSelect, Field, FinSheet, FormSection, MoneyField, PersonInput, relDays } from './ui';

const first = (s?: string) => (s ?? '').split(' ')[0];

/** Cuándo toca una parte, dicho corto: «Hoy», «En 3 días», «Atrasada 2 días». */
function dueText(due: string, today: string) {
  const n = daysBetween(today, due);
  if (n === 0) return { text: 'Hoy', tone: 'warn' };
  if (n < 0) return { text: `Atrasada ${-n} ${n === -1 ? 'día' : 'días'}`, tone: 'bad' };
  if (n <= 3) {
    const t = relDays(n);
    return { text: t.charAt(0).toUpperCase() + t.slice(1), tone: 'warn' };
  }
  return { text: friendlyDate(due), tone: 'muted' };
}

/** Barra del cobro: lo que llegó, lo programado, lo que falta sin fecha y lo perdido. */
export function ChargeBar({ total, s }: { total: number; s: ChargeStats }) {
  const w = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0) + '%';
  return (
    <div className="fz-charge-bar" aria-hidden="true">
      <i className="got" style={{ width: w(s.received) }} />
      <i className="planned" style={{ width: w(s.scheduled) }} />
      <i className="free" style={{ width: w(s.unscheduled) }} />
      <i className="lost" style={{ width: w(s.lost) }} />
    </div>
  );
}

type PartAction = { charge: FinItem<'cobro'>; part: ChargePart | null; mode: 'receive' | 'postpone' | 'drop' };

/** Ingresos que llegan por partes: cada cobro con su total, sus abonos y lo que esperas. */
export function ChargesBlock() {
  const { workspace, notify, confirm, go, viewEntry, createEntry, patchEntry, resolveTask } = useApp();
  const fin = useFinance();
  const today = todayInputValue();
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const all = itemsOf(fin.items, 'cobro');
  const open = all.filter(isOpenCharge).sort((a, b) => {
    const na = chargeStats(a, moves, today).next?.due ?? '9999';
    const nb = chargeStats(b, moves, today).next?.due ?? '9999';
    return na.localeCompare(nb);
  });
  const closed = all.filter((c) => !isOpenCharge(c));
  const [editing, setEditing] = useState<FinItem<'cobro'> | 'new' | null>(null);
  const [action, setAction] = useState<PartAction | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const fullApp = { workspace, notify, createEntry, patchEntry, resolveTask };

  const remove = async (c: FinItem<'cobro'>) => {
    const ok = await confirm({
      title: `¿Eliminar «${c.title}»?`,
      message: 'Los abonos quedan como ingresos normales en Movimientos.',
      confirmLabel: 'Eliminar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    const r = await removeItem(c);
    if (r !== true) return notify(r);
    notify('Cobro eliminado.', { label: 'Deshacer', run: () => void restoreItem(c) });
  };

  return (
    <section className="fz-block fz-charges">
      <header className="fz-block-head">
        <h3>
          <Layers size={16} /> Cobros por partes
        </h3>
        <button type="button" className="fz-btn primary sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Nuevo cobro
        </button>
        <small>Un proyecto, una venta o un pago que llega en abonos: el total, lo que llegó, cuándo esperas lo demás y si se cumplió.</small>
      </header>

      {open.length ? (
        <div className="fz-charge-grid">
          {open.map((c) => {
            const s = chargeStats(c, moves, today);
            const person = c.data.personId ? workspace.people.find((p) => p.id === c.data.personId) : undefined;
            const ep = c.data.episodeId ? workspace.episodes.find((e) => e.id === c.data.episodeId) : undefined;
            const task = c.data.taskId ? workspace.entries.find((e) => e.id === c.data.taskId) : undefined;
            const partOf = new Map(c.data.parts.filter((p) => p.entryId).map((p) => [p.entryId!, p]));
            const looseParts = c.data.parts.filter((p) => p.status !== 'esperando' && !(p.entryId && s.abonos.some((e) => e.id === p.entryId)));
            return (
              <article key={c.id} className={'fz-charge' + (s.late.length ? ' late' : '') + (s.done ? ' done' : '')}>
                <header>
                  {person ? <Avatar person={person} size={36} /> : <span className="fz-avatar sm">{c.data.who ? initials(c.data.who) : <Layers size={15} />}</span>}
                  <div>
                    <strong>{c.title}</strong>
                    <small>
                      {c.data.who ? `${first(c.data.who)} · ` : ''}desde {friendlyDate(c.data.start).toLowerCase()}
                    </small>
                  </div>
                  <span className="fz-row-tools">
                    <button type="button" className="fz-icon" aria-label="Editar" title="Editar" onClick={() => setEditing(c)}>
                      <Pencil size={13} />
                    </button>
                    <button type="button" className="fz-icon" aria-label="Eliminar" title="Eliminar" onClick={() => void remove(c)}>
                      <Trash2 size={13} />
                    </button>
                  </span>
                </header>

                <div className="fz-charge-sum">
                  <b>{money(s.received)}</b>
                  <small>de {money(c.data.total)}</small>
                  <em className={s.done ? 'good' : ''}>{s.done ? 'Completo' : `Faltan ${moneyShort(s.left)}`}</em>
                </div>
                <ChargeBar total={c.data.total} s={s} />
                <div className="fz-charge-key">
                  <span>
                    <i className="got" /> Llegó {percent(s.pct)}
                  </span>
                  {s.scheduled > 0 && (
                    <span>
                      <i className="planned" /> Con fecha {moneyShort(s.scheduled)}
                    </span>
                  )}
                  {s.unscheduled > 0 && (
                    <span>
                      <i className="free" /> Sin fecha {moneyShort(s.unscheduled)}
                    </span>
                  )}
                  {s.lost > 0 && (
                    <span>
                      <i className="lost" /> Perdido {moneyShort(s.lost)}
                    </span>
                  )}
                </div>

                <ol className="fz-charge-line">
                  {s.abonos.map((e) => {
                    const part = partOf.get(e.id);
                    const delay = part ? partDelay(part) : null;
                    return (
                      <li key={e.id} className="got">
                        <CircleCheck size={15} />
                        <button type="button" className="fz-charge-what" onClick={() => viewEntry(e)}>
                          {friendlyDate(todayInputValue(new Date(e.created_at)))}
                          {delay !== null && (
                            <em className={'fz-chip ' + (delay > 0 ? 'warn' : 'good')}>{delay > 0 ? `${delay} d tarde` : 'A tiempo'}</em>
                          )}
                        </button>
                        <b className="in">+{moneyShort(e.amount)}</b>
                      </li>
                    );
                  })}
                  {looseParts.map((p) => (
                    <li key={p.id} className={p.status === 'no' ? 'no' : 'got'}>
                      {p.status === 'no' ? <CircleX size={15} /> : <CircleCheck size={15} />}
                      <span className="fz-charge-what">
                        {friendlyDate(p.due)} · {p.status === 'no' ? p.note || 'No se dio' : 'Llegó'}
                      </span>
                      <b className={p.status === 'no' ? 'muted' : 'in'}>{moneyShort(p.got ?? p.amount)}</b>
                    </li>
                  ))}
                  {s.waiting.map((p) => {
                    const d = dueText(p.due, today);
                    return (
                      <li key={p.id} className={'wait ' + d.tone}>
                        <CircleDashed size={15} />
                        <span className="fz-charge-what">
                          <em className={'fz-chip ' + d.tone}>{d.text}</em>
                          {p.moved?.length ? <small>aplazada {p.moved.length}×</small> : null}
                        </span>
                        <b>{moneyShort(p.amount)}</b>
                        <span className="fz-charge-acts">
                          <button type="button" className="fz-btn soft sm" onClick={() => setAction({ charge: c, part: p, mode: 'receive' })}>
                            <Check size={13} /> Llegó
                          </button>
                          <button type="button" className="fz-icon" title="Aplazar" aria-label="Aplazar" onClick={() => setAction({ charge: c, part: p, mode: 'postpone' })}>
                            <Clock size={14} />
                          </button>
                          <button type="button" className="fz-icon" title="No se dio" aria-label="No se dio" onClick={() => setAction({ charge: c, part: p, mode: 'drop' })}>
                            <X size={14} />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ol>

                <footer>
                  <button type="button" className="fz-btn ghost sm" onClick={() => setAction({ charge: c, part: null, mode: 'receive' })}>
                    <Plus size={13} /> Abono
                  </button>
                  {s.unscheduled > 0 && (
                    <button type="button" className="fz-btn ghost sm" onClick={() => setEditing(c)}>
                      <CalendarPlus size={13} /> Poner fecha a lo que falta
                    </button>
                  )}
                  {!task && s.left > 0 && (
                    <button type="button" className="fz-icon" title="Crear un pendiente para cobrarlo" onClick={() => void ensureChargeTask(fullApp, c).then((ok) => notify(ok ? 'Pendiente creado: está en tu Agenda.' : 'No se pudo crear el pendiente.'))}>
                      <BellPlus size={14} />
                    </button>
                  )}
                  {(s.done || (!s.waiting.length && s.left > 0)) && (
                    <button type="button" className="fz-btn ghost sm" onClick={() => void closeCharge(fullApp, c)}>
                      {s.done ? 'Archivar' : 'Cerrar cobro'}
                    </button>
                  )}
                </footer>
                {(ep || task || s.punctuality !== null) && (
                  <div className="fz-charge-meta">
                    {ep && (
                      <button type="button" className="fz-chip" onClick={() => go('Episodios', ep)}>
                        {ep.title}
                      </button>
                    )}
                    {task && (
                      <button type="button" className={'fz-chip ' + (task.status === 'pendiente' ? 'warn' : 'good')} onClick={() => viewEntry(task)}>
                        <CalendarClock size={11} /> {task.status === 'pendiente' ? 'Pendiente abierto' : 'Pendiente cerrado'}
                      </button>
                    )}
                    {s.punctuality !== null && (
                      <span className={'fz-chip ' + (s.punctuality >= 0.8 ? 'good' : s.punctuality >= 0.5 ? 'warn' : 'bad')}>
                        Puntualidad {percent(s.punctuality)}
                        {s.avgDelay ? ` · ${Math.round(s.avgDelay)} d de retraso medio` : ''}
                      </span>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="fz-muted">
          Nada por cobrar en partes. Al registrar un ingreso marca «Es un abono de un total mayor» y queda aquí solo.
        </p>
      )}

      {closed.length > 0 && (
        <div className="fz-closed">
          <button type="button" className="fz-link" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Ocultar' : 'Ver'} cerrados ({closed.length})
          </button>
          {showClosed && (
            <ul>
              {closed.map((c) => {
                const s = chargeStats(c, moves, today);
                return (
                  <li key={c.id}>
                    <span>
                      <b>{c.title}</b> · {c.data.closedOn ? friendlyDate(c.data.closedOn).toLowerCase() : ''}
                      {s.lost > 0 && <small> · no llegaron {moneyShort(s.lost)}</small>}
                    </span>
                    <b>
                      {moneyShort(s.received)} <small>de {moneyShort(c.data.total)}</small>
                    </b>
                    <button type="button" className="fz-icon" aria-label="Reabrir" title="Reabrir" onClick={() => void updateItem(c, { archived: false, data: { closedOn: undefined } })}>
                      <CircleDashed size={13} />
                    </button>
                    <button type="button" className="fz-icon" aria-label="Eliminar" onClick={() => void remove(c)}>
                      <Trash2 size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {editing && <ChargeSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {action && <PartSheet action={action} onClose={() => setAction(null)} />}
    </section>
  );
}

/** Lo que llegó (o no) de una parte: recibir, aplazar o dar por perdida. */
export function PartSheet({ action, onClose }: { action: PartAction; onClose: () => void }) {
  const { workspace, notify, createEntry, patchEntry, resolveTask } = useApp();
  const fin = useFinance();
  const app = { workspace, notify, createEntry, patchEntry, resolveTask };
  const today = todayInputValue();
  const { charge, part } = action;
  const s = chargeStats(charge, workspace.entries, today);
  const accounts = (settingsOf(fin.items).accounts.length ? settingsOf(fin.items).accounts : defaultAccounts).map((a) => a.name);
  const [mode, setMode] = useState(action.mode);
  const [amount, setAmount] = useState(part ? Math.min(part.amount, s.left || part.amount) : s.left);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState(charge.data.method ?? '');
  const [newDue, setNewDue] = useState(part ? addDays(part.due < today ? today : part.due, 7) : addDays(today, 7));
  const [lost, setLost] = useState(false);
  const [note, setNote] = useState('');
  const delay = part ? daysBetween(part.moved?.[0] ?? part.due, date) : null;

  const save = async () => {
    if (mode === 'receive') {
      if (!(amount > 0)) return;
      if (await receiveCharge(app, charge, part, { amount, date, method: method || undefined, note: note.trim() || undefined })) onClose();
      return;
    }
    if (!part) return onClose();
    if (mode === 'postpone') await postponePart(app, charge, part, newDue, note.trim() || undefined);
    else await dropPart(app, charge, part, lost, note.trim() || undefined);
    onClose();
  };

  return (
    <FinSheet
      icon={<Layers size={18} />}
      title={charge.title}
      sub={part ? `Esperabas ${money(part.amount)} ${friendlyDate(part.due).toLowerCase()}` : `Faltan ${money(s.left)} de ${money(charge.data.total)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={mode === 'receive' && !(amount > 0)} onClick={() => void save()}>
            {mode === 'receive' ? 'Registrar' : mode === 'postpone' ? 'Aplazar' : 'Guardar'}
          </button>
        </>
      }
    >
      {part && (
        <Segmented
          label="¿Qué pasó?"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'receive', label: 'Llegó' },
            { value: 'postpone', label: 'Se aplazó' },
            { value: 'drop', label: 'No se dio' },
          ]}
        />
      )}
      {mode === 'receive' && (
        <>
          <div className="fz-form">
            <Field label="¿Cuánto llegó?">
              <MoneyField value={amount} onChange={setAmount} autoFocus />
            </Field>
            <Field label="¿Cuándo?">
              <input className="fz-input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
            </Field>
            <Field label="¿A dónde llegó?" hint="Opcional">
              <select className="fz-input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Sin cuenta</option>
                {accounts.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </Field>
            <Field label="Nota" hint="Opcional">
              <input className="fz-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {delay !== null && (
            <p className={'fz-result ' + (delay > 0 ? 'down' : 'up')}>
              {delay > 0 ? `Llegaría con ${delay} ${delay === 1 ? 'día' : 'días'} de retraso.` : 'Llegó a tiempo.'}
              {part && amount > 0 && amount < part.amount && ` Faltarían ${money(part.amount - amount)} de esta parte.`}
              {part && amount > part.amount && ` Llegó ${money(amount - part.amount)} más de lo esperado.`}
            </p>
          )}
          {amount >= s.left && s.left > 0 && <p className="fz-result up">Con esto queda completo.</p>}
        </>
      )}
      {mode === 'postpone' && part && (
        <div className="fz-form">
          <Field label="Nueva fecha">
            <input className="fz-input" type="date" value={newDue} min={today} onChange={(e) => setNewDue(e.target.value || newDue)} />
          </Field>
          <Field label="¿Por qué?" hint="Opcional">
            <input className="fz-input" value={note} maxLength={300} placeholder="El cliente pidió unos días…" onChange={(e) => setNote(e.target.value)} />
          </Field>
          {part.moved?.length ? <p className="fz-muted fz-field wide">Ya se aplazó {part.moved.length} {part.moved.length === 1 ? 'vez' : 'veces'}: la fecha acordada era el {friendlyDate(part.moved[0]).toLowerCase()}.</p> : null}
        </div>
      )}
      {mode === 'drop' && part && (
        <>
          <Segmented
            label="¿Y esa plata?"
            value={lost ? 'lost' : 'later'}
            onChange={(v) => setLost(v === 'lost')}
            options={[
              { value: 'later', label: 'Sigue pendiente, sin fecha' },
              { value: 'lost', label: 'Se perdió' },
            ]}
          />
          <Field label="¿Qué pasó?" hint="Opcional">
            <input className="fz-input" value={note} maxLength={300} placeholder="Se canceló el proyecto, no respondió…" onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p className="fz-muted">{lost ? `Lo que falta baja en ${money(part.amount)}.` : 'Queda en lo que falta por cobrar y puedes ponerle otra fecha cuando sepas.'}</p>
        </>
      )}
    </FinSheet>
  );
}

type PartRow = { id: string; due: string; amount: number; keep?: ChargePart };

/** Crear o editar un cobro: el total, con quién, su episodio y las partes que esperas. */
function ChargeSheet({ item, onClose }: { item: FinItem<'cobro'> | null; onClose: () => void }) {
  const { workspace, notify, createEntry, patchEntry, resolveTask } = useApp();
  const fin = useFinance();
  const app = { workspace, notify, createEntry, patchEntry, resolveTask };
  const today = todayInputValue();
  const settings = settingsOf(fin.items);
  const cats = [...incomeCategories.filter((c) => c !== 'Reembolso'), ...settings.extraIn];
  const s = item ? chargeStats(item, workspace.entries, today) : null;
  const [title, setTitle] = useState(item?.title ?? '');
  const [total, setTotal] = useState(item?.data.total ?? 0);
  const [who, setWho] = useState<{ personId?: string; name: string }>({ personId: item?.data.personId, name: item?.data.who ?? '' });
  const [start, setStart] = useState(item?.data.start ?? today);
  const [category, setCategory] = useState(item?.data.category ?? '');
  const [episodeId, setEpisodeId] = useState(item?.data.episodeId);
  const [note, setNote] = useState(item?.data.note ?? '');
  const [firstAbono, setFirstAbono] = useState(0);
  const [task, setTask] = useState(!item);
  const [rows, setRows] = useState<PartRow[]>(() =>
    item ? item.data.parts.filter((p) => p.status === 'esperando').map((p) => ({ id: p.id, due: p.due, amount: p.amount, keep: p })) : [],
  );
  const received = (s?.received ?? 0) + firstAbono;
  const planned = rows.reduce((a, r) => a + r.amount, 0);
  const free = Math.max(0, total - received - (item?.data.lost ?? 0) - planned);
  const ok = title.trim() && total > 0 && firstAbono < total;

  const addRow = () =>
    setRows((r) => [...r, { id: crypto.randomUUID(), due: addDays(r[r.length - 1]?.due ?? today, 30), amount: free }]);

  const save = async () => {
    if (!ok) return;
    const person = who.personId ? workspace.people.find((p) => p.id === who.personId) : undefined;
    const kept = item ? item.data.parts.filter((p) => p.status !== 'esperando') : [];
    const parts: ChargePart[] = [
      ...kept,
      ...rows
        .filter((r) => r.amount > 0 && r.due)
        .map((r) =>
          r.keep
            ? { ...r.keep, amount: r.amount, due: r.due, moved: r.keep.due !== r.due ? [...(r.keep.moved ?? []), r.keep.due] : r.keep.moved }
            : { id: r.id, due: r.due, amount: r.amount, status: 'esperando' as const },
        ),
    ];
    const data: Charge = {
      total,
      personId: person?.id,
      who: person?.name ?? (who.name.trim() || undefined),
      episodeId,
      taskId: item?.data.taskId,
      start,
      category: category || undefined,
      method: item?.data.method,
      note: note.trim() || undefined,
      parts,
      lost: item?.data.lost,
      closedOn: item?.data.closedOn,
    };
    const made = item ? await updateItem(item, { title, data }) : await createItem('cobro', title, data);
    if (typeof made === 'string') return notify(made);
    const saved = item ?? (made as FinItem<'cobro'>);
    if (!item && firstAbono > 0) await receiveCharge(app, saved, null, { amount: firstAbono, date: start <= today ? start : today });
    if (!item && task && total - firstAbono > 0) await ensureChargeTask(app, saved, total - firstAbono);
    onClose();
  };

  return (
    <FinSheet
      wide
      icon={<Layers size={18} />}
      title={item ? 'Editar cobro' : 'Nuevo cobro por partes'}
      sub="El total acordado y lo que esperas recibir: cada abono que llegue se descuenta solo."
      onClose={onClose}
      footer={
        <>
          {total > 0 && (
            <span className="fz-foot-note">
              {free > 0 ? `Sin fecha: ${money(free)}` : planned > 0 ? 'Todo lo que falta tiene fecha.' : ''}
            </span>
          )}
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={!ok} onClick={() => void save()}>
            Guardar
          </button>
        </>
      }
    >
      <FormSection title="El cobro">
        <div className="fz-form three">
          <Field label="¿Qué es?" wide>
            <input className="fz-input" value={title} autoFocus maxLength={200} placeholder="Proyecto web, venta del carro, liquidación…" onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Total acordado">
            <MoneyField value={total} onChange={setTotal} />
          </Field>
          {!item ? (
            <Field label="Ya recibí" hint="Primer abono">
              <MoneyField value={firstAbono} onChange={setFirstAbono} />
            </Field>
          ) : (
            <Field label="Ya llegó">
              <span className="fz-static">{money(s?.received ?? 0)}</span>
            </Field>
          )}
          <Field label="Desde">
            <input className="fz-input" type="date" value={start} onChange={(e) => setStart(e.target.value || today)} />
          </Field>
          <Field label="¿Quién te paga?" hint="Opcional" wide>
            <PersonInput people={workspace.people} personId={who.personId} name={who.name} onChange={setWho} />
          </Field>
        </div>
        {total > 0 && (
          <div className="fz-charge-preview">
            <span>
              Llegó <b className="in">{money(received)}</b>
            </span>
            <span>
              Con fecha <b>{money(planned)}</b>
            </span>
            <span>
              Sin fecha <b>{money(free)}</b>
            </span>
          </div>
        )}
      </FormSection>

      <FormSection title="Detalles" hint="Opcional">
        <div className="fz-form three">
          <Field label="Categoría">
            <select className="fz-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Sin categoría</option>
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          {workspace.episodes.length > 0 && (
            <Field label="Episodio">
              <EpisodeSelect episodes={workspace.episodes} value={episodeId} onChange={setEpisodeId} />
            </Field>
          )}
          <Field label="Nota" wide={workspace.episodes.length === 0}>
            <input className="fz-input" value={note} maxLength={400} placeholder="Condiciones, factura…" onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <div className="fz-parts">
        <div className="fz-parts-head">
          <strong>¿Cuándo esperas lo demás?</strong>
          <button type="button" className="fz-btn ghost sm" disabled={!(total > 0)} onClick={addRow}>
            <Plus size={13} /> Agregar parte
          </button>
        </div>
        {rows.length ? (
          <ul>
            {rows.map((r, i) => (
              <li key={r.id}>
                <span className="fz-parts-n">{i + 1}</span>
                <input className="fz-input" type="date" value={r.due} aria-label="Fecha" onChange={(e) => setRows((x) => x.map((y) => (y.id === r.id ? { ...y, due: e.target.value } : y)))} />
                <MoneyField value={r.amount} ariaLabel="Monto" onChange={(amount) => setRows((x) => x.map((y) => (y.id === r.id ? { ...y, amount } : y)))} />
                <button type="button" className="fz-icon" aria-label="Quitar" onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fz-muted">Opcional. Sin fechas, lo que falta queda «sin fecha» y lo ves igual.</p>
        )}
      </div>
      {!item && (
        <label className="fz-check">
          <input type="checkbox" checked={task} onChange={(e) => setTask(e.target.checked)} />
          Crear un pendiente «espero» para no olvidar cobrarlo (sale en tu Agenda con la fecha de la próxima parte)
        </label>
      )}
    </FinSheet>
  );
}
