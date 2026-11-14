import { useMemo, useState, type CSSProperties } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  Pencil,
  Plus,
  ShoppingBag,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Segmented } from '../composer/controls';
import { friendlyDate, money, todayInputValue } from '../lib/format';
import { Progress } from './charts';
import { defaultAccounts, itemsOf, pocketColors, pocketStats, type FinItem, type Pocket, type PocketUse } from './model';
import { isMoney, moneyShort, percent, signed } from './money';
import { createItem, removeItem, restoreItem, settingsOf, updateItem, useFinance } from './store';
import { CardsBlock } from './Cards';
import { EpisodeSelect, Field, FinSheet, FormSection, MoneyField, moneyInput } from './ui';

const emojis = ['💰', '🛟', '✈️', '🏠', '🛒', '🎉', '🎁', '🎓', '🚗', '🐾', '💻', '❤️'];
const starters: { title: string; emoji: string; use: PocketUse; color: string }[] = [
  { title: 'Emergencias', emoji: '🛟', use: 'ahorro', color: '#3c9186' },
  { title: 'Viajes', emoji: '✈️', use: 'ahorro', color: '#4f6bb5' },
  { title: 'Mercado', emoji: '🛒', use: 'gasto', color: '#c58a1c' },
  { title: 'Salidas', emoji: '🎉', use: 'gasto', color: '#a0527f' },
  { title: 'Regalos', emoji: '🎁', use: 'gasto', color: '#c0674a' },
];

type Move = { pocket: FinItem<'bolsillo'>; mode: 'in' | 'out' | 'move' };

/** Bolsillos de ahorro y carteras para gastar: cada uno con su saldo, su meta y su historia. */
export function PocketsTab() {
  const { workspace, notify, openEntry, go } = useApp();
  const fin = useFinance();
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const all = itemsOf(fin.items, 'bolsillo');
  const active = all.filter((p) => !p.archived);
  const archived = all.filter((p) => p.archived);
  const [editing, setEditing] = useState<FinItem<'bolsillo'> | Partial<Pocket & { title: string }> | null>(null);
  const [moving, setMoving] = useState<Move | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const stats = new Map(active.map((p) => [p.id, pocketStats(p, moves)]));
  const total = active.reduce((s, p) => s + (stats.get(p.id)?.balance ?? 0), 0);
  const added = active.reduce((s, p) => s + (stats.get(p.id)?.added ?? 0), 0);
  const taken = active.reduce((s, p) => s + (stats.get(p.id)?.taken ?? 0), 0);
  const positive = active.filter((p) => (stats.get(p.id)?.balance ?? 0) > 0);

  const remove = async (p: FinItem<'bolsillo'>) => {
    const r = await removeItem(p);
    if (r !== true) return notify(r);
    notify('Bolsillo eliminado. Sus movimientos siguen en Movimientos.', { label: 'Deshacer', run: () => void restoreItem(p) });
  };

  if (!all.length)
    return (
      <div className="fz-pockets">
        <section className="fz-block fz-pockets-empty">
          <header className="fz-block-head">
            <h3>
              <Wallet size={16} /> Bolsillos y carteras
            </h3>
            <button type="button" className="fz-btn primary sm" onClick={() => setEditing({})}>
              <Plus size={14} /> Nuevo bolsillo
            </button>
            <small>
              Un bolsillo de ahorro (emergencias, viaje) crece con lo que guardas. Una cartera para gastar (mercado, salidas) se recarga y se
              vacía con cada gasto que sale de ella.
            </small>
          </header>
          <div className="fz-starters">
            {starters.map((s) => (
              <button type="button" key={s.title} onClick={() => setEditing({ ...s, initial: 0 })}>
                <span>{s.emoji}</span>
                {s.title}
                <small>{s.use === 'ahorro' ? 'Ahorro' : 'Para gastar'}</small>
              </button>
            ))}
          </div>
        </section>
        <CardsBlock />
        {editing && <PocketSheet init={editing} onClose={() => setEditing(null)} />}
      </div>
    );

  return (
    <div className="fz-pockets">
      <section className="fz-pocket-hero">
        <div className="fz-pocket-total">
          <span>En tus bolsillos</span>
          <b>{money(total)}</b>
          <small>
            {active.length} {active.length === 1 ? 'bolsillo' : 'bolsillos'}
            {added > 0 && (
              <>
                {' '}
                · <em className="in">+{moneyShort(added)}</em> este mes
              </>
            )}
            {taken > 0 && (
              <>
                {' '}
                · <em className="out">−{moneyShort(taken)}</em>
              </>
            )}
          </small>
        </div>
        {positive.length > 1 && total > 0 && (
          <div className="fz-pocket-mix">
            <div className="fz-alloc">
              {positive.map((p) => (
                <i key={p.id} title={`${p.title}: ${money(stats.get(p.id)!.balance)}`} style={{ width: (stats.get(p.id)!.balance / total) * 100 + '%', background: p.data.color }} />
              ))}
            </div>
            <ul className="fz-alloc-legend">
              {positive.map((p) => (
                <li key={p.id}>
                  <i style={{ background: p.data.color }} />
                  {p.title} <b>{percent(stats.get(p.id)!.balance / total)}</b>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="fz-pocket-actions">
          {active.length > 1 && (
            <button type="button" className="fz-btn ghost sm" onClick={() => setMoving({ pocket: active[0], mode: 'move' })}>
              <ArrowLeftRight size={14} /> Mover entre bolsillos
            </button>
          )}
          <button type="button" className="fz-btn primary sm" onClick={() => setEditing({})}>
            <Plus size={14} /> Nuevo bolsillo
          </button>
        </div>
      </section>

      <div className="fz-pocket-grid">
        {active.map((p) => {
          const s = stats.get(p.id)!;
          const saving = p.data.use === 'ahorro';
          const ep = p.data.episodeId ? workspace.episodes.find((e) => e.id === p.data.episodeId) : undefined;
          const isOpen = open === p.id;
          return (
            <article key={p.id} className={'fz-pocket' + (s.balance < 0 ? ' neg' : '')} style={{ '--c': p.data.color } as CSSProperties}>
              <header>
                <span className="fz-pocket-emoji">{p.data.emoji || p.title.charAt(0).toUpperCase()}</span>
                <div>
                  <strong>{p.title}</strong>
                  <small>
                    {saving ? 'Ahorro' : 'Para gastar'}
                    {p.data.account && ` · en ${p.data.account}`}
                  </small>
                </div>
                <span className="fz-row-tools">
                  <button type="button" className="fz-icon" aria-label="Editar" title="Editar" onClick={() => setEditing(p)}>
                    <Pencil size={13} />
                  </button>
                  <button type="button" className="fz-icon" aria-label="Archivar" title="Archivar" onClick={() => void updateItem(p, { archived: true })}>
                    <Archive size={13} />
                  </button>
                </span>
              </header>
              <b className="fz-pocket-balance">{money(s.balance)}</b>
              {saving && p.data.target ? (
                <div className="fz-pocket-goal">
                  <Progress value={Math.max(0, s.balance)} max={p.data.target} tone="in" />
                  <small>
                    {s.balance >= p.data.target
                      ? `¡Llegaste a ${moneyShort(p.data.target)}!`
                      : `${percent(Math.max(0, s.balance) / p.data.target)} de ${moneyShort(p.data.target)} · faltan ${moneyShort(p.data.target - Math.max(0, s.balance))}`}
                  </small>
                </div>
              ) : !saving && p.data.monthly ? (
                <div className="fz-pocket-goal">
                  <Progress value={s.spent} max={p.data.monthly} tone={s.spent > p.data.monthly ? 'bad' : s.spent > p.data.monthly * 0.8 ? 'warn' : 'out'} />
                  <small>
                    Gastaste {moneyShort(s.spent)} de {moneyShort(p.data.monthly)} este mes
                  </small>
                </div>
              ) : (
                (s.added > 0 || s.taken > 0) && (
                  <small className="fz-pocket-month">
                    Este mes {s.added > 0 && <em className="in">+{moneyShort(s.added)}</em>} {s.taken > 0 && <em className="out">−{moneyShort(s.taken)}</em>}
                  </small>
                )
              )}
              {ep && (
                <button type="button" className="fz-chip fz-pocket-ep" onClick={() => go('Episodios', ep)}>
                  {ep.title}
                </button>
              )}
              <footer>
                <button type="button" className="fz-btn soft sm" onClick={() => setMoving({ pocket: p, mode: 'in' })}>
                  <ArrowDownLeft size={14} /> {saving ? 'Guardar' : 'Recargar'}
                </button>
                {saving ? (
                  <button type="button" className="fz-btn ghost sm" disabled={s.balance <= 0} onClick={() => setMoving({ pocket: p, mode: 'out' })}>
                    <ArrowUpRight size={14} /> Sacar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="fz-btn ghost sm"
                    onClick={() => openEntry('Movimiento', [], { flow: 'gasto', pocketId: p.id, ...(p.data.account && { method: p.data.account }) })}
                  >
                    <ShoppingBag size={14} /> Gastar
                  </button>
                )}
                {s.lines.length > 0 && (
                  <button type="button" className={'fz-icon fz-pocket-more' + (isOpen ? ' open' : '')} aria-expanded={isOpen} aria-label="Historial" title="Historial" onClick={() => setOpen(isOpen ? null : p.id)}>
                    <ChevronDown size={15} />
                  </button>
                )}
              </footer>
              {isOpen && (
                <ul className="fz-pocket-log">
                  {s.lines.slice(0, 12).map((l) => (
                    <li key={l.key}>
                      <span className="fz-when">{friendlyDate(l.d)}</span>
                      <span className="fz-pocket-log-title">{l.title}</span>
                      <b className={l.v >= 0 ? 'in' : 'out'}>{signed(l.v)}</b>
                    </li>
                  ))}
                  {s.lines.length > 12 && <li className="fz-muted">Y {s.lines.length - 12} más.</li>}
                </ul>
              )}
            </article>
          );
        })}
      </div>

      {archived.length > 0 && (
        <div className="fz-closed">
          <button type="button" className="fz-link" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Ocultar' : 'Ver'} archivados ({archived.length})
          </button>
          {showArchived && (
            <ul>
              {archived.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.data.emoji} <b>{p.title}</b>
                  </span>
                  <b>{money(pocketStats(p, moves).balance)}</b>
                  <button type="button" className="fz-icon" aria-label="Restaurar" title="Restaurar" onClick={() => void updateItem(p, { archived: false })}>
                    <ArchiveRestore size={13} />
                  </button>
                  <button type="button" className="fz-icon" aria-label="Eliminar" title="Eliminar" onClick={() => void remove(p)}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <CardsBlock />

      {editing && <PocketSheet init={editing} onClose={() => setEditing(null)} />}
      {moving && <MoveSheet init={moving} pockets={active} onClose={() => setMoving(null)} />}
    </div>
  );
}

function PocketSheet({ init, onClose }: { init: FinItem<'bolsillo'> | Partial<Pocket & { title: string }>; onClose: () => void }) {
  const { notify, workspace } = useApp();
  const fin = useFinance();
  const item = 'kind' in init ? (init as FinItem<'bolsillo'>) : null;
  const base: Partial<Pocket & { title: string }> = item ? { ...item.data, title: item.title } : (init as Partial<Pocket & { title: string }>);
  const accounts = (settingsOf(fin.items).accounts.length ? settingsOf(fin.items).accounts : defaultAccounts).map((a) => a.name);
  const [title, setTitle] = useState(base.title ?? '');
  const [use, setUse] = useState<PocketUse>(base.use ?? 'ahorro');
  const [emoji, setEmoji] = useState(base.emoji ?? '');
  const [color, setColor] = useState(base.color ?? pocketColors[itemsOf(fin.items, 'bolsillo').length % pocketColors.length]);
  const [account, setAccount] = useState(base.account ?? '');
  const [initial, setInitial] = useState(base.initial ?? 0);
  const [target, setTarget] = useState(base.target ?? 0);
  const [monthly, setMonthly] = useState(base.monthly ?? 0);
  const [episodeId, setEpisodeId] = useState(base.episodeId);
  const [note, setNote] = useState(base.note ?? '');
  const ok = title.trim().length > 0;

  const save = async () => {
    if (!ok) return;
    const data: Pocket = {
      use,
      color,
      emoji: emoji.trim() || undefined,
      account: account || undefined,
      initial,
      target: use === 'ahorro' ? target || undefined : undefined,
      monthly: use === 'gasto' ? monthly || undefined : undefined,
      note: note.trim() || undefined,
      episodeId,
      log: item?.data.log ?? [],
    };
    const r = item ? await updateItem(item, { title, data }) : await createItem('bolsillo', title, data);
    if (typeof r === 'string') return notify(r);
    onClose();
  };

  return (
    <FinSheet
      icon={<Wallet size={18} />}
      title={item ? 'Editar bolsillo' : 'Nuevo bolsillo'}
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
        label="Tipo de bolsillo"
        value={use}
        onChange={setUse}
        options={[
          { value: 'ahorro', label: 'Para ahorrar' },
          { value: 'gasto', label: 'Para gastar' },
        ]}
      />
      <p className="fz-muted fz-sheet-lead">
        {use === 'ahorro'
          ? 'Guardar y sacar quedan como ahorro (no cuentan como gasto) y suman en tu Resumen.'
          : 'Una cartera: la recargas con lo que piensas gastar en algo y cada gasto que sale de ella la va vaciando.'}
      </p>
      <div className="fz-pocket-preview" style={{ '--c': color } as CSSProperties}>
        <span className="fz-pocket-emoji">{emoji || (title.trim().charAt(0).toUpperCase() || '·')}</span>
        <div>
          <strong>{title.trim() || (use === 'ahorro' ? 'Tu bolsillo' : 'Tu cartera')}</strong>
          <small>
            {use === 'ahorro' ? 'Ahorro' : 'Para gastar'}
            {account && ` · en ${account}`}
          </small>
        </div>
        <b>{money(initial)}</b>
      </div>
      <FormSection title="Lo básico">
        <div className="fz-form">
          <Field label="Nombre" wide>
            <input className="fz-input" value={title} autoFocus maxLength={80} placeholder={use === 'ahorro' ? 'Emergencias, viaje, carro…' : 'Mercado, salidas, gasolina…'} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Ícono" wide group>
            <div className="fz-emojis">
              {emojis.map((x) => (
                <button type="button" key={x} className={emoji === x ? 'on' : ''} onClick={() => setEmoji(emoji === x ? '' : x)}>
                  {x}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Color" wide group>
            <div className="fz-swatches">
              {pocketColors.map((c) => (
                <button type="button" key={c} aria-label={c} className={color === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </Field>
        </div>
      </FormSection>
      <FormSection title={use === 'ahorro' ? 'Saldo y meta' : 'Saldo y tope'}>
        <div className="fz-form">
          <Field label="Ya tiene" hint="Saldo de arranque">
            <MoneyField value={initial} onChange={setInitial} />
          </Field>
          {use === 'ahorro' ? (
            <Field label="¿A cuánto quieres llegar?" hint="Opcional">
              <MoneyField value={target} onChange={setTarget} />
            </Field>
          ) : (
            <Field label="¿Cuánto le pones al mes?" hint="Opcional">
              <MoneyField value={monthly} onChange={setMonthly} />
            </Field>
          )}
          <Field label="¿En qué cuenta vive?" hint="Opcional">
            <select className="fz-input" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">Ninguna en especial</option>
              {accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          {workspace.episodes.length > 0 && (
            <Field label="Episodio" hint="Opcional">
              <EpisodeSelect episodes={workspace.episodes} value={episodeId} onChange={setEpisodeId} />
            </Field>
          )}
          <Field label="Nota" hint="Opcional" wide>
            <input className="fz-input" value={note} maxLength={300} placeholder="Para qué es, reglas que te pones…" onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </FormSection>
    </FinSheet>
  );
}

function MoveSheet({ init, pockets, onClose }: { init: Move; pockets: FinItem<'bolsillo'>[]; onClose: () => void }) {
  const { notify, createEntry, workspace } = useApp();
  const fin = useFinance();
  const accounts = (settingsOf(fin.items).accounts.length ? settingsOf(fin.items).accounts : defaultAccounts).map((a) => a.name);
  const [mode, setMode] = useState(init.mode);
  const [fromId, setFromId] = useState(init.pocket.id);
  const [toId, setToId] = useState(pockets.find((p) => p.id !== init.pocket.id)?.id ?? '');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayInputValue());
  const [method, setMethod] = useState(init.pocket.data.account ?? '');
  const [note, setNote] = useState('');
  const pocket = pockets.find((p) => p.id === fromId) ?? init.pocket;
  const target = pockets.find((p) => p.id === toId);
  const moves = workspace.entries.filter(isMoney);
  const balance = pocketStats(pocket, moves).balance;
  const ok = amount > 0 && (mode !== 'move' || (target && target.id !== pocket.id));

  /** Entra o sale plata de un bolsillo: ahorro con movimiento; cartera, en su propia historia. */
  const apply = async (p: FinItem<'bolsillo'>, sign: 1 | -1, title: string) => {
    if (p.data.use === 'gasto') {
      const r = await updateItem(p, {
        data: { log: [...p.data.log, { id: crypto.randomUUID(), d: date, v: sign * amount, ...(note.trim() && { n: note.trim().slice(0, 120) }) }] },
      });
      return r === true;
    }
    const e = await createEntry(
      moneyInput({
        title,
        body: note.trim(),
        amount,
        date,
        direction: sign > 0 ? 'egreso' : 'ingreso',
        tags: ['Ahorro'],
        details: { flow: 'ahorro', pocketId: p.id, ...(method && { method }) },
        episodeId: p.data.episodeId,
      }),
      true,
    );
    return Boolean(e);
  };

  const save = async () => {
    if (!ok) return;
    if (mode === 'move' && target) {
      if (!(await apply(pocket, -1, `Pasé a ${target.title}`))) return;
      if (!(await apply(target, 1, `Llegó de ${pocket.title}`))) return;
      notify(`Moviste ${money(amount)} de ${pocket.title} a ${target.title}.`);
    } else {
      const saving = pocket.data.use === 'ahorro';
      const title = mode === 'in' ? (saving ? `Guardé en ${pocket.title}` : `Recargué ${pocket.title}`) : `Saqué de ${pocket.title}`;
      if (!(await apply(pocket, mode === 'in' ? 1 : -1, title))) return;
      notify(`${mode === 'in' ? (saving ? 'Guardaste' : 'Recargaste') : 'Sacaste'} ${money(amount)} ${mode === 'in' ? 'en' : 'de'} ${pocket.title}.`);
    }
    onClose();
  };

  return (
    <FinSheet
      icon={mode === 'move' ? <ArrowLeftRight size={18} /> : <span className="fz-sheet-emoji">{pocket.data.emoji || <Wallet size={18} />}</span>}
      title={mode === 'move' ? 'Mover entre bolsillos' : pocket.title}
      sub={`Saldo ${money(balance)}`}
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
        label="Qué hacer"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'in', label: pocket.data.use === 'ahorro' ? 'Guardar' : 'Recargar' },
          { value: 'out', label: 'Sacar' },
          ...(pockets.length > 1 ? [{ value: 'move' as const, label: 'Mover' }] : []),
        ]}
      />
      <div className="fz-form">
        {mode === 'move' && (
          <>
            <Field label="De">
              <select className="fz-input" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                {pockets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.data.emoji} {p.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="A">
              <select className="fz-input" value={toId} onChange={(e) => setToId(e.target.value)}>
                {pockets
                  .filter((p) => p.id !== fromId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.data.emoji} {p.title}
                    </option>
                  ))}
              </select>
            </Field>
          </>
        )}
        <Field label="¿Cuánto?">
          <MoneyField value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="Fecha">
          <input className="fz-input" type="date" value={date} max={todayInputValue()} onChange={(e) => setDate(e.target.value || todayInputValue())} />
        </Field>
        {(pocket.data.use === 'ahorro' || target?.data.use === 'ahorro') && (
          <Field label="Cuenta" hint="Opcional">
            <select className="fz-input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Sin cuenta</option>
              {accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Nota" hint="Opcional" wide>
          <input className="fz-input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {mode === 'out' && amount > balance && <p className="fz-result down">Es más de lo que tiene: el bolsillo quedaría en {money(balance - amount)}.</p>}
      {pocket.data.use === 'gasto' && mode !== 'move' && (
        <p className="fz-muted">En una cartera, recargar y sacar solo mueven su saldo: no son gasto ni ahorro.</p>
      )}
    </FinSheet>
  );
}
