import { useMemo, useState } from 'react';
import { Frown, Hourglass, Pencil, PiggyBank, Plus, ShieldCheck, ShoppingBag, Smile, Target, Trash2, Trophy } from 'lucide-react';
import { useApp } from '../AppContext';
import { Segmented } from '../composer/controls';
import { addDays, friendlyDate, money, todayInputValue } from '../lib/format';
import { Progress } from './charts';
import { defaultAccounts, goalSaved, itemsOf, type FinItem, type Goal } from './model';
import { costOf, daysBetween, dayOf, flowOf, isMoney, moneyShort, percent } from './money';
import { createItem, removeItem, restoreItem, settingsOf, updateItem, useFinance } from './store';
import { Empty, Field, FinSheet, MoneyField, moneyInput, relDays } from './ui';

const waits = [
  { days: 2, label: '48 horas' },
  { days: 7, label: '1 semana' },
  { days: 30, label: '30 días' },
];

export function GoalsTab() {
  const { workspace, notify, createEntry, viewEntry } = useApp();
  const fin = useFinance();
  const today = todayInputValue();
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const goals = itemsOf(fin.items, 'meta');
  const active = goals.filter((g) => !g.archived);
  const done = goals.filter((g) => g.archived);
  const wishes = itemsOf(fin.items, 'deseo');
  const waiting = wishes.filter((w) => w.data.status === 'esperando').sort((a, b) => a.data.decideOn.localeCompare(b.data.decideOn));
  const skipped = wishes.filter((w) => w.data.status === 'descartado');
  const bought = wishes.filter((w) => w.data.status === 'comprado');
  const [editing, setEditing] = useState<FinItem<'meta'> | 'new' | null>(null);
  const [saving, setSaving] = useState<{ goal: FinItem<'meta'>; out: boolean } | null>(null);
  const [wish, setWish] = useState({ title: '', price: 0, wait: 2 });

  const assets = moves
    .filter((e) => e.details.asset && flowOf(e) === 'gasto')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const happy = moves.filter((e) => e.details.worth === 1).sort((a, b) => costOf(b) - costOf(a));
  const regret = moves.filter((e) => e.details.worth === -1).sort((a, b) => costOf(b) - costOf(a));

  const addWish = async () => {
    if (!wish.title.trim() || !(wish.price > 0)) return;
    const r = await createItem('deseo', wish.title, {
      price: wish.price,
      decideOn: addDays(today, wish.wait),
      status: 'esperando',
    });
    if (typeof r === 'string') return notify(r);
    notify(`Anotado. Te lo recuerdo ${wish.wait === 2 ? 'en 48 horas' : wish.wait === 7 ? 'en una semana' : 'en 30 días'} para decidir con calma.`);
    setWish({ title: '', price: 0, wait: wish.wait });
  };
  const buy = async (w: FinItem<'deseo'>) => {
    const e = await createEntry(
      moneyInput({ title: w.title, amount: w.data.price, direction: 'egreso', tags: ['Compras'], details: { flow: 'gasto' } }),
      true,
    );
    if (!e) return;
    await updateItem(w, { data: { status: 'comprado', decidedOn: today, entryId: e.id } });
    notify(`Compra registrada: ${money(w.data.price)}. Puedes editarla para ponerle cuenta y lugar.`);
  };
  const skip = async (w: FinItem<'deseo'>) => {
    await updateItem(w, { data: { status: 'descartado', decidedOn: today } });
    notify(`Bien: te ahorraste ${money(w.data.price)}.`, {
      label: 'Deshacer',
      run: () => void updateItem(w, { data: { status: 'esperando', decidedOn: undefined } }),
    });
  };
  const removeGoal = async (g: FinItem<'meta'>) => {
    const r = await removeItem(g);
    if (r !== true) return notify(r);
    notify('Meta eliminada.', { label: 'Deshacer', run: () => void restoreItem(g) });
  };

  return (
    <div className="fz-goals">
      <section className="fz-block">
        <header className="fz-block-head">
          <h3>
            <Target size={16} /> Metas de ahorro
          </h3>
          <button type="button" className="fz-btn primary sm" onClick={() => setEditing('new')}>
            <Plus size={14} /> Nueva meta
          </button>
        </header>
        {active.length ? (
          <div className="fz-goal-grid">
            {active.map((g) => {
              const saved = goalSaved(g, moves);
              const left = Math.max(0, g.data.target - saved);
              const days = g.data.due ? daysBetween(today, g.data.due) : null;
              const weeks = days !== null && days > 0 ? Math.max(1, Math.ceil(days / 7)) : null;
              const reached = saved >= g.data.target;
              return (
                <article key={g.id} className={'fz-goal' + (reached ? ' reached' : '')}>
                  <header>
                    <strong>{g.title}</strong>
                    <span className="fz-row-tools">
                      <button type="button" className="fz-icon" aria-label="Editar" onClick={() => setEditing(g)}>
                        <Pencil size={13} />
                      </button>
                      <button type="button" className="fz-icon" aria-label="Eliminar" onClick={() => void removeGoal(g)}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </header>
                  <b className="fz-goal-amount">
                    {money(saved)} <small>de {money(g.data.target)}</small>
                  </b>
                  <Progress value={saved} max={g.data.target} tone="in" />
                  <small className="fz-goal-hint">
                    {reached
                      ? '¡Lo lograste!'
                      : weeks
                        ? `Faltan ${money(left)}: unos ${money(Math.ceil(left / weeks))} por semana hasta el ${friendlyDate(g.data.due!).toLowerCase()}.`
                        : days !== null && days <= 0
                          ? `La fecha pasó; faltan ${money(left)}.`
                          : `Faltan ${money(left)} (${percent(saved / (g.data.target || 1))} logrado).`}
                  </small>
                  <footer>
                    {reached ? (
                      <button type="button" className="fz-btn soft sm" onClick={() => void updateItem(g, { archived: true })}>
                        <Trophy size={14} /> Marcar cumplida
                      </button>
                    ) : (
                      <button type="button" className="fz-btn soft sm" onClick={() => setSaving({ goal: g, out: false })}>
                        <PiggyBank size={14} /> Abonar
                      </button>
                    )}
                    {saved > 0 && (
                      <button type="button" className="fz-btn ghost sm" onClick={() => setSaving({ goal: g, out: true })}>
                        Sacar
                      </button>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty icon={<Target size={22} />} title="¿Para qué estás ahorrando?" text="Un viaje, un computador, el fondo de emergencias. Cada abono es un movimiento de ahorro (no cuenta como gasto) y aquí ves cuánto te falta por semana." />
        )}
        {done.length > 0 && (
          <p className="fz-muted">
            <Trophy size={13} /> Cumplidas: {done.map((g) => g.title).join(', ')}
          </p>
        )}
      </section>

      <section className="fz-block">
        <header className="fz-block-head">
          <h3>
            <Hourglass size={16} /> Antes de comprar, espera
          </h3>
          {skipped.length > 0 && (
            <span className="fz-saved-tag">
              No compraste {money(skipped.reduce((s, w) => s + w.data.price, 0))} en {skipped.length} {skipped.length === 1 ? 'deseo' : 'deseos'}
            </span>
          )}
        </header>
        <div className="fz-wish-form">
          <input
            className="fz-input"
            value={wish.title}
            maxLength={200}
            placeholder="¿Qué quieres comprar?"
            onChange={(e) => setWish((w) => ({ ...w, title: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && void addWish()}
          />
          <MoneyField value={wish.price} onChange={(price) => setWish((w) => ({ ...w, price }))} ariaLabel="Precio" />
          <div className="fz-chips">
            {waits.map((w) => (
              <button type="button" key={w.days} className={wish.wait === w.days ? 'on' : ''} onClick={() => setWish((x) => ({ ...x, wait: w.days }))}>
                {w.label}
              </button>
            ))}
          </div>
          <button type="button" className="fz-btn primary sm" disabled={!wish.title.trim() || !(wish.price > 0)} onClick={() => void addWish()}>
            Anotar
          </button>
        </div>
        {waiting.length > 0 ? (
          <ul className="fz-wishes">
            {waiting.map((w) => {
              const n = daysBetween(today, w.data.decideOn);
              const ready = n <= 0;
              return (
                <li key={w.id} className={ready ? 'ready' : ''}>
                  <span>
                    <b>{w.title}</b>
                    <small>{ready ? 'Ya puedes decidir con calma' : `Decides ${relDays(n)}`}</small>
                  </span>
                  <b>{money(w.data.price)}</b>
                  <span className="fz-row-tools">
                    <button type="button" className="fz-btn soft sm" disabled={!ready} title={ready ? undefined : 'Espera un poco más'} onClick={() => void buy(w)}>
                      <ShoppingBag size={13} /> Comprar
                    </button>
                    <button type="button" className="fz-btn ghost sm" onClick={() => void skip(w)}>
                      Ya no lo quiero
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="fz-muted">Anota lo que quieres comprar y decide después de unos días. Muchas ganas se pasan solas.</p>
        )}
        {bought.length > 0 && <p className="fz-muted">Compraste después de esperar: {bought.map((w) => w.title).slice(0, 6).join(', ')}.</p>}
      </section>

      <section className="fz-block">
        <header className="fz-block-head">
          <h3>
            <ShieldCheck size={16} /> Compras duraderas
          </h3>
        </header>
        {assets.length ? (
          <ul className="fz-assets">
            {assets.map((e) => {
              const days = Math.max(1, daysBetween(dayOf(e), today));
              const w = e.details.warrantyUntil ? daysBetween(today, e.details.warrantyUntil) : null;
              return (
                <li key={e.id}>
                  <button type="button" className="fz-link" onClick={() => viewEntry(e)}>
                    {e.title}
                  </button>
                  <small>
                    {money(costOf(e))} · {friendlyDate(dayOf(e)).toLowerCase()}
                  </small>
                  <span className="fz-asset-day">
                    <b>{money(Math.round(costOf(e) / days))}</b> por día
                  </span>
                  {w !== null && (
                    <em className={'fz-chip ' + (w < 0 ? 'muted' : w <= 30 ? 'warn' : 'good')}>
                      {w < 0 ? 'Sin garantía' : `Garantía ${relDays(w)}`}
                    </em>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="fz-muted">Marca «Compra duradera» en un gasto (un portátil, una cámara, un mueble) y verás cuánto te cuesta por día y cuándo vence su garantía.</p>
        )}
      </section>

      {(happy.length > 0 || regret.length > 0) && (
        <section className="fz-block fz-worth">
          <header className="fz-block-head">
            <h3>¿Valió la pena?</h3>
          </header>
          <div className="fz-worth-cols">
            <div>
              <h4 className="good">
                <Smile size={15} /> Te hicieron feliz · {moneyShort(happy.reduce((s, e) => s + costOf(e), 0))}
              </h4>
              <ul>
                {happy.slice(0, 6).map((e) => (
                  <li key={e.id}>
                    <button type="button" className="fz-link" onClick={() => viewEntry(e)}>
                      {e.title}
                    </button>
                    <b>{money(costOf(e))}</b>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="bad">
                <Frown size={15} /> Te arrepientes · {moneyShort(regret.reduce((s, e) => s + costOf(e), 0))}
              </h4>
              <ul>
                {regret.slice(0, 6).map((e) => (
                  <li key={e.id}>
                    <button type="button" className="fz-link" onClick={() => viewEntry(e)}>
                      {e.title}
                    </button>
                    <b>{money(costOf(e))}</b>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {editing && <GoalSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {saving && <SaveSheet goal={saving.goal} out={saving.out} onClose={() => setSaving(null)} />}
    </div>
  );
}

function GoalSheet({ item, onClose }: { item: FinItem<'meta'> | null; onClose: () => void }) {
  const { notify, workspace } = useApp();
  const [title, setTitle] = useState(item?.title ?? '');
  const [target, setTarget] = useState(item?.data.target ?? 0);
  const [due, setDue] = useState(item?.data.due ?? '');
  const [initial, setInitial] = useState(item?.data.initial ?? 0);
  const [episodeId, setEpisodeId] = useState(item?.data.episodeId ?? '');
  const ok = title.trim() && target > 0;
  const save = async () => {
    if (!ok) return;
    const data: Goal = { target, due: due || undefined, initial, note: item?.data.note, episodeId: episodeId || undefined };
    const r = item ? await updateItem(item, { title, data }) : await createItem('meta', title, data);
    if (typeof r === 'string') return notify(r);
    onClose();
  };
  return (
    <FinSheet
      title={item ? 'Editar meta' : 'Nueva meta'}
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
      <div className="fz-form">
        <Field label="¿Para qué?" wide>
          <input className="fz-input" value={title} autoFocus maxLength={200} placeholder="Viaje a Japón, fondo de emergencias…" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="¿Cuánto necesitas?">
          <MoneyField value={target} onChange={setTarget} />
        </Field>
        <Field label="¿Para cuándo?" hint="Opcional">
          <input className="fz-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Ya tienes" hint="Opcional">
          <MoneyField value={initial} onChange={setInitial} />
        </Field>
        {workspace.episodes.length > 0 && (
          <Field label="Episodio" hint="Opcional">
            <select className="fz-input" value={episodeId} onChange={(e) => setEpisodeId(e.target.value)}>
              <option value="">Ninguno</option>
              {workspace.episodes.slice(0, 80).map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.title}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </FinSheet>
  );
}

function SaveSheet({ goal, out, onClose }: { goal: FinItem<'meta'>; out: boolean; onClose: () => void }) {
  const { notify, createEntry } = useApp();
  const fin = useFinance();
  const settings = settingsOf(fin.items);
  const accounts = (settings.accounts.length ? settings.accounts : defaultAccounts).map((a) => a.name);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('');
  const [dir, setDir] = useState<'in' | 'out'>(out ? 'out' : 'in');
  const save = async () => {
    if (!(amount > 0)) return;
    const e = await createEntry(
      moneyInput({
        title: `${dir === 'in' ? 'Ahorro para' : 'Saqué de'} ${goal.title}`,
        amount,
        direction: dir === 'in' ? 'egreso' : 'ingreso',
        tags: ['Meta'],
        details: { flow: 'ahorro', goalId: goal.id, ...(method && { method }) },
        episodeId: goal.data.episodeId,
      }),
      true,
    );
    if (!e) return;
    notify(dir === 'in' ? `Abonaste ${money(amount)} a ${goal.title}.` : `Sacaste ${money(amount)} de ${goal.title}.`);
    onClose();
  };
  return (
    <FinSheet
      title={goal.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={!(amount > 0)} onClick={() => void save()}>
            Guardar
          </button>
        </>
      }
    >
      <Segmented
        label="Abonar o sacar"
        value={dir}
        onChange={setDir}
        options={[
          { value: 'in', label: 'Abonar' },
          { value: 'out', label: 'Sacar' },
        ]}
      />
      <div className="fz-form">
        <Field label="¿Cuánto?">
          <MoneyField value={amount} onChange={setAmount} autoFocus />
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
    </FinSheet>
  );
}
