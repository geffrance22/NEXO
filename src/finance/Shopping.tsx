import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  CalendarClock,
  Check,
  ChevronDown,
  Eraser,
  ListPlus,
  Minus,
  Pencil,
  Plus,
  ShoppingBasket,
  ShoppingCart,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { useDismiss } from '../hooks/useDismiss';
import { friendlyDate, money, todayInputValue } from '../lib/format';
import { Progress } from './charts';
import {
  itemsOf,
  shopWhens,
  type FinItem,
  type ShopEntry,
  type ShopItem,
  type ShopWhen,
} from './model';
import { dayOf, monthName, moneyShort } from './money';
import {
  dueOfWhen,
  entryCost,
  listStats,
  matchPurchase,
  parseShopLine,
  shopStats,
  shopWhenMeta,
  whenLabel,
} from './shopCalc';
import { createItem, financeState, removeItem, restoreItem, updateItem, useFinance } from './store';
import { Empty, Field, FinSheet, MoneyField, MoreMenu } from './ui';
import './shopping.css';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Varias cosas de una vez: «leche, huevos, pan» (la coma de «$1,5M» no separa). */
const splitLines = (raw: string) => raw.split(/\s*(?:[;\n]|,\s)\s*/).filter((x) => x.trim());
const EMOJIS = ['🛒', '🏠', '🍳', '👕', '🎁', '💻', '✈️', '🧴', '🐾', '🛠️', '📚', '🌱'];

/** La lista tal como está ahora en la memoria (para no pisar un cambio reciente). */
const freshList = (id: string) => itemsOf(financeState().items, 'compras').find((x) => x.id === id);

// ───────────────────────── Listas generales (Metas y compras) ─────────────────────────

/** Tus listas de compras: cada una con su «para cuándo», su presupuesto y sus cosas por tachar. */
export function ShoppingLists() {
  const fin = useFinance();
  const today = todayInputValue();
  const lists = itemsOf(fin.items, 'compras')
    .filter((l) => !l.archived)
    .sort(
      (a, b) =>
        (a.data.due ?? '9999').localeCompare(b.data.due ?? '9999') ||
        b.created_at.localeCompare(a.created_at),
    );
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [editing, setEditing] = useState<FinItem<'compras'> | null>(null);
  const left = lists.reduce((s, l) => s + listStats(l.data).left, 0);
  const pending = lists.reduce((s, l) => s + listStats(l.data).pending.length, 0);

  return (
    <section className="fz-block fz-shop-block">
      <header className="fz-block-head">
        <h3>
          <ShoppingCart size={16} /> Listas de compras
        </h3>
        <span className="fz-row-tools">
          {pending > 0 && (
            <span className="fz-shop-total">
              {plural(pending, 'cosa', 'cosas')} por comprar
              {left > 0 && <> · ≈ {moneyShort(left)}</>}
            </span>
          )}
          {!adding && (
            <button type="button" className="fz-btn primary sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> Nueva lista
            </button>
          )}
        </span>
      </header>
      {lists.length || adding ? (
        <div className="fz-shop-grid">
          {adding && (
            <NewList
              today={today}
              onDone={(id) => {
                setAdding(false);
                if (id) setFresh(id);
              }}
            />
          )}
          {lists.map((l) => (
            <ListCard
              key={l.id}
              list={l}
              today={today}
              autoFocus={fresh === l.id}
              onEdit={() => setEditing(l)}
            />
          ))}
        </div>
      ) : (
        <Empty
          icon={<ShoppingBasket size={22} />}
          title="¿Qué piensas comprar?"
          text="Arma listas (el mercado, lo del apartamento, el viaje) con un tiempo aproximado. Tachas lo que compras y, en la carta del mes, traes lo que toca."
        >
          <button type="button" className="fz-btn primary sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Crear una lista
          </button>
        </Empty>
      )}
      {editing && <ListSheet list={editing} today={today} onClose={() => setEditing(null)} />}
    </section>
  );
}

function WhenChips({ value, onChange }: { value: ShopWhen; onChange: (w: ShopWhen) => void }) {
  return (
    <div className="fz-shop-whens" role="radiogroup" aria-label="Para cuándo, más o menos">
      {shopWhens.map((w) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === w}
          key={w}
          className={value === w ? 'on' : ''}
          onClick={() => onChange(w)}
        >
          {shopWhenMeta[w].label}
        </button>
      ))}
    </div>
  );
}

function NewList({ today, onDone }: { today: string; onDone: (id?: string) => void }) {
  const { notify } = useApp();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState<ShopWhen>('mes');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    const r = await createItem('compras', title, { when, due: dueOfWhen(when, today), items: [] });
    setBusy(false);
    if (typeof r === 'string') return notify(r);
    onDone(r.id);
  };
  return (
    <article className="fz-shop-list new">
      <input
        className="fz-shop-title-input"
        value={title}
        autoFocus
        maxLength={120}
        placeholder="Nombre: mercado, para el apartamento…"
        aria-label="Nombre de la lista"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void create();
          if (e.key === 'Escape') onDone();
        }}
      />
      <small className="fz-shop-label">¿Para cuándo, más o menos?</small>
      <WhenChips value={when} onChange={setWhen} />
      <footer className="fz-shop-new-foot">
        <button type="button" className="fz-btn ghost sm" onClick={() => onDone()}>
          Cancelar
        </button>
        <button
          type="button"
          className="fz-btn primary sm"
          disabled={!title.trim() || busy}
          onClick={() => void create()}
        >
          Crear lista
        </button>
      </footer>
    </article>
  );
}

/** El «para cuándo» de una lista: se cambia ahí mismo. */
function WhenButton({
  list,
  today,
  onPick,
}: {
  list: FinItem<'compras'>;
  today: string;
  onPick: (w: ShopWhen) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  const w = whenLabel(list.data, today);
  return (
    <span ref={ref} className="fz-shop-when-pick">
      <button
        type="button"
        className={'fz-shop-when ' + w.tone}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Para cuándo, más o menos"
        onClick={() => setOpen((v) => !v)}
      >
        <CalendarClock size={11} /> {w.text}
      </button>
      {open && (
        <div className="fz-shop-when-pop" role="menu" aria-label="Para cuándo">
          {shopWhens.map((x) => {
            const due = dueOfWhen(x, today);
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={list.data.when === x}
                key={x}
                onClick={() => {
                  close();
                  onPick(x);
                }}
              >
                <span>{shopWhenMeta[x].label}</span>
                {due && <small>{cap(monthName(due))}</small>}
                {list.data.when === x && <Check size={13} />}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

function ListCard({
  list,
  today,
  autoFocus,
  onEdit,
}: {
  list: FinItem<'compras'>;
  today: string;
  autoFocus: boolean;
  onEdit: () => void;
}) {
  const { notify, confirm } = useApp();
  const st = listStats(list.data);
  const [draft, setDraft] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(true);

  const save = (f: (items: ShopEntry[]) => ShopEntry[]) => {
    const now = freshList(list.id) ?? list;
    void updateItem(now, { data: { items: f(now.data.items) } }).then(
      (r) => r !== true && notify(r),
    );
  };
  const add = () => {
    const rows = splitLines(draft).map((p) => {
      const x = parseShopLine(p);
      return {
        id: crypto.randomUUID(),
        text: x.text,
        qty: x.qty,
        price: x.price,
      } satisfies ShopEntry;
    });
    if (!rows.length) return;
    save((items) => [...items, ...rows]);
    setDraft('');
  };
  const toggle = (e: ShopEntry) =>
    save((items) =>
      items.map((x) =>
        x.id === e.id
          ? {
              ...x,
              done: x.done ? undefined : today,
              via: undefined,
              ...(x.done && { entryId: undefined }),
            }
          : x,
      ),
    );
  const removeEntry = (e: ShopEntry) => {
    const at = list.data.items.findIndex((x) => x.id === e.id);
    save((items) => items.filter((x) => x.id !== e.id));
    notify(`«${e.text.slice(0, 40)}» quitado.`, {
      label: 'Deshacer',
      run: () =>
        save((items) =>
          items.some((x) => x.id === e.id) ? items : [...items.slice(0, at), e, ...items.slice(at)],
        ),
    });
  };
  const clearDone = () => {
    const gone = list.data.items.filter((x) => x.done);
    save((items) => items.filter((x) => !x.done));
    notify(`${plural(gone.length, 'tachado quitado', 'tachados quitados')}.`, {
      label: 'Deshacer',
      run: () =>
        save((items) => [...items, ...gone.filter((g) => !items.some((x) => x.id === g.id))]),
    });
  };
  const removeList = async () => {
    const ok = await confirm({
      title: `¿Eliminar «${list.title}»?`,
      message: list.data.items.length
        ? `Tiene ${plural(list.data.items.length, 'cosa', 'cosas')}. Podrás deshacerlo justo después.`
        : 'Podrás deshacerlo justo después.',
      confirmLabel: 'Eliminar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    const r = await removeItem(list);
    if (r !== true) return notify(r);
    notify('Lista eliminada.', { label: 'Deshacer', run: () => void restoreItem(list) });
  };
  const setWhen = (w: ShopWhen) => {
    const now = freshList(list.id) ?? list;
    void updateItem(now, { data: { when: w, due: dueOfWhen(w, today) } }).then(
      (r) => r !== true && notify(r),
    );
  };

  const budget = list.data.budget;
  const row = (e: ShopEntry) =>
    editId === e.id ? (
      <EntryEditor
        key={e.id}
        entry={e}
        onCancel={() => setEditId(null)}
        onSave={(next) => {
          save((items) => items.map((x) => (x.id === e.id ? { ...x, ...next } : x)));
          setEditId(null);
        }}
      />
    ) : (
      <li key={e.id} className={'fz-shop-item' + (e.done ? ' done' : '')}>
        <button
          type="button"
          className="fz-shop-check"
          role="checkbox"
          aria-checked={Boolean(e.done)}
          aria-label={e.done ? `Desmarcar ${e.text}` : `Tachar ${e.text}`}
          onClick={() => toggle(e)}
        >
          {e.done && <Check size={12} strokeWidth={3} />}
        </button>
        <button
          type="button"
          className="fz-shop-name"
          title="Editar"
          onClick={() => setEditId(e.id)}
        >
          <span>{e.text}</span>
          {(e.qty || e.where || e.note) && (
            <small>{[e.qty && `×${e.qty}`, e.where, e.note].filter(Boolean).join(' · ')}</small>
          )}
        </button>
        {e.price ? <b className="fz-shop-cost">{moneyShort(entryCost(e))}</b> : null}
        <button
          type="button"
          className="fz-shop-x"
          aria-label={`Quitar ${e.text}`}
          title="Quitar"
          onClick={() => removeEntry(e)}
        >
          <X size={13} />
        </button>
      </li>
    );

  return (
    <article className="fz-shop-list">
      <header className="fz-shop-head">
        <span className="fz-shop-emoji" aria-hidden="true">
          {list.data.emoji || <ShoppingBasket size={16} />}
        </span>
        <div>
          <strong title={list.title}>{list.title}</strong>
          <span className="fz-shop-meta">
            <WhenButton list={list} today={today} onPick={setWhen} />
            <small>
              {st.pending.length
                ? `${st.pending.length} por comprar`
                : list.data.items.length
                  ? 'Todo comprado'
                  : 'Vacía'}
              {st.left > 0 && ` · ≈ ${moneyShort(st.left)}`}
            </small>
          </span>
        </div>
        <MoreMenu
          label="Opciones de la lista"
          items={[
            { label: 'Editar detalles', icon: <Pencil size={15} />, run: onEdit },
            st.done.length > 0 && {
              label: 'Quitar los tachados',
              icon: <Eraser size={15} />,
              run: clearDone,
            },
            {
              label: 'Eliminar lista',
              icon: <Trash2 size={15} />,
              run: () => void removeList(),
              danger: true,
            },
          ]}
        />
      </header>

      {budget ? (
        <div className="fz-shop-budget">
          <Progress
            value={st.total}
            max={budget}
            tone={st.total > budget ? 'bad' : st.total > budget * 0.85 ? 'warn' : 'in'}
          />
          <small className={st.total > budget ? 'bad' : ''}>
            ≈ {moneyShort(st.total)} de {moneyShort(budget)}
            {st.total > budget ? ` · te pasas ${moneyShort(st.total - budget)}` : ''}
          </small>
        </div>
      ) : null}
      {list.data.note && <p className="fz-shop-note">{list.data.note}</p>}

      {st.pending.length > 0 && <ul className="fz-shop-items">{st.pending.map(row)}</ul>}
      <label className="fz-shop-add">
        <Plus size={14} />
        <input
          value={draft}
          autoFocus={autoFocus}
          maxLength={400}
          placeholder="Agregar… (ej. Sartén $80k x2)"
          aria-label={`Agregar a ${list.title}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        {draft.trim() && (
          <button type="button" className="fz-shop-add-go" onClick={add}>
            Agregar
          </button>
        )}
      </label>

      {st.done.length > 0 && (
        <>
          <button
            type="button"
            className={'fz-shop-done-toggle' + (showDone ? ' on' : '')}
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            <ChevronDown size={13} /> Tachados · {st.done.length}
          </button>
          {showDone && (
            <ul className="fz-shop-items">
              {[...st.done].sort((a, b) => (b.done ?? '').localeCompare(a.done ?? '')).map(row)}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

/** Editar una cosa de la lista: nombre, cantidad, precio aproximado, dónde y una nota. */
function EntryEditor({
  entry,
  onSave,
  onCancel,
}: {
  entry: ShopEntry;
  onSave: (e: Partial<ShopEntry>) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(entry.text);
  const [qty, setQty] = useState(entry.qty ?? 1);
  const [price, setPrice] = useState(entry.price ?? 0);
  const [where, setWhere] = useState(entry.where ?? '');
  const [note, setNote] = useState(entry.note ?? '');
  const save = () => {
    if (!text.trim()) return;
    onSave({
      text: text.trim().slice(0, 200),
      qty: qty > 1 ? qty : undefined,
      price: price || undefined,
      where: where.trim() || undefined,
      note: note.trim() || undefined,
    });
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };
  return (
    <li className="fz-shop-item editing">
      <div className="fz-shop-edit" onKeyDown={keys}>
        <input
          className="fz-input"
          value={text}
          autoFocus
          maxLength={200}
          aria-label="Nombre"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="fz-shop-edit-row">
          <span className="fz-shop-qty" role="group" aria-label="Cantidad">
            <button
              type="button"
              aria-label="Menos"
              disabled={qty <= 1}
              onClick={() => setQty((q) => Math.max(1, q - 1))}
            >
              <Minus size={12} />
            </button>
            <b>{qty}</b>
            <button
              type="button"
              aria-label="Más"
              onClick={() => setQty((q) => Math.min(999, q + 1))}
            >
              <Plus size={12} />
            </button>
          </span>
          <MoneyField
            value={price}
            onChange={setPrice}
            ariaLabel="Precio aproximado por unidad"
            placeholder="Precio"
          />
        </div>
        <input
          className="fz-input"
          value={where}
          maxLength={80}
          placeholder="¿Dónde? Tienda, página…"
          aria-label="Dónde comprarlo"
          onChange={(e) => setWhere(e.target.value)}
        />
        <input
          className="fz-input"
          value={note}
          maxLength={200}
          placeholder="Nota: talla, color, marca…"
          aria-label="Nota"
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="fz-shop-edit-foot">
          {qty > 1 && price > 0 && <small>≈ {money(qty * price)} en total</small>}
          <button type="button" className="fz-btn ghost sm" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="fz-btn primary sm"
            disabled={!text.trim()}
            onClick={save}
          >
            Guardar
          </button>
        </div>
      </div>
    </li>
  );
}

/** Los detalles de una lista: nombre, ícono, para cuándo (aprox. o un mes exacto), presupuesto y nota. */
function ListSheet({
  list,
  today,
  onClose,
}: {
  list: FinItem<'compras'>;
  today: string;
  onClose: () => void;
}) {
  const { notify } = useApp();
  const [title, setTitle] = useState(list.title);
  const [emoji, setEmoji] = useState(list.data.emoji ?? '');
  const [when, setWhen] = useState<ShopWhen | 'fecha'>(
    list.data.when ?? (list.data.due ? 'fecha' : 'algun'),
  );
  const [due, setDue] = useState(list.data.due ?? '');
  const [budget, setBudget] = useState(list.data.budget ?? 0);
  const [note, setNote] = useState(list.data.note ?? '');
  const save = async () => {
    if (!title.trim()) return;
    const now = freshList(list.id) ?? list;
    const r = await updateItem(now, {
      title,
      data: {
        emoji: emoji || undefined,
        when: when === 'fecha' ? undefined : when,
        // Si no cambiaste «para cuándo», se queda el mes al que ya apuntaba.
        due:
          when === 'fecha'
            ? due || undefined
            : when === list.data.when
              ? list.data.due
              : dueOfWhen(when, today),
        budget: budget || undefined,
        note: note.trim() || undefined,
      },
    });
    if (r !== true) return notify(r);
    onClose();
  };
  return (
    <FinSheet
      title="Editar lista"
      icon={<ShoppingBasket size={18} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="fz-btn primary"
            disabled={!title.trim()}
            onClick={() => void save()}
          >
            Guardar
          </button>
        </>
      }
    >
      <div className="fz-form">
        <Field label="Nombre" wide>
          <input
            className="fz-input"
            value={title}
            maxLength={120}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      </div>
      <div className="fz-shop-sheet-sec">
        <small className="fz-shop-label">Ícono</small>
        <div className="fz-shop-emojis" role="radiogroup" aria-label="Ícono">
          <button
            type="button"
            role="radio"
            aria-checked={!emoji}
            className={!emoji ? 'on' : ''}
            onClick={() => setEmoji('')}
            aria-label="Sin ícono"
          >
            <ShoppingBasket size={15} />
          </button>
          {EMOJIS.map((x) => (
            <button
              type="button"
              role="radio"
              aria-checked={emoji === x}
              key={x}
              className={emoji === x ? 'on' : ''}
              onClick={() => setEmoji(x)}
            >
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className="fz-shop-sheet-sec">
        <small className="fz-shop-label">¿Para cuándo, más o menos?</small>
        <div className="fz-shop-whens" role="radiogroup" aria-label="Para cuándo">
          {shopWhens.map((w) => (
            <button
              type="button"
              role="radio"
              aria-checked={when === w}
              key={w}
              className={when === w ? 'on' : ''}
              onClick={() => setWhen(w)}
            >
              {shopWhenMeta[w].label}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={when === 'fecha'}
            className={when === 'fecha' ? 'on' : ''}
            onClick={() => setWhen('fecha')}
          >
            Un mes exacto
          </button>
        </div>
        {when === 'fecha' && (
          <input
            className="fz-input fz-shop-month"
            type="month"
            value={due}
            min={today.slice(0, 7)}
            aria-label="Mes"
            onChange={(e) => setDue(e.target.value)}
          />
        )}
      </div>
      <div className="fz-form">
        <Field label="Presupuesto" hint="Opcional">
          <MoneyField value={budget} onChange={setBudget} ariaLabel="Presupuesto de la lista" />
        </Field>
        <Field label="Nota" hint="Opcional" wide>
          <input
            className="fz-input"
            value={note}
            maxLength={300}
            placeholder="Para qué es, qué tener en cuenta…"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </FinSheet>
  );
}

// ───────────────────────── Compras de la carta del mes ─────────────────────────

/** Tacha (o destacha) la cosa de su lista general cuando la compra de la carta cambia. */
function syncListEntry(ref: string, month: string, bought: boolean, entryId?: string) {
  const [lid, iid] = ref.split(':');
  const l = freshList(lid);
  const it = l?.data.items.find((x) => x.id === iid);
  if (!l || !it) return;
  if (bought && !it.done)
    void updateItem(l, {
      data: {
        items: l.data.items.map((x) =>
          x.id === iid ? { ...x, done: todayInputValue(), via: month, entryId } : x,
        ),
      },
    });
  if (!bought && it.done && it.via === month)
    void updateItem(l, {
      data: {
        items: l.data.items.map((x) =>
          x.id === iid ? { ...x, done: undefined, via: undefined, entryId: undefined } : x,
        ),
      },
    });
}

/**
 * Las compras de la carta: lo que piensas comprar ese mes. Cuando el mes empieza, Nexo busca en tus
 * gastos lo que ya compraste y lo tacha (te avisa una vez); tú marcas el resto con ✓ o ✗. Al cerrar
 * el mes, lo que quedó sin marcar cuenta como no comprado.
 */
export function MonthShopping({
  month,
  items,
  editable,
  canMark,
  ended,
  moves,
  onChange,
}: {
  month: string;
  items: ShopItem[];
  /** Se pueden agregar y quitar cosas (la carta aún se puede ajustar). */
  editable: boolean;
  /** Se puede marcar sí o no (el mes empezó y no se ha cerrado). */
  canMark: boolean;
  ended: boolean;
  /** Movimientos del mes. */
  moves: readonly Entry[];
  onChange: (f: (list: ShopItem[]) => ShopItem[]) => void;
}) {
  const { workspace, notify, viewEntry } = useApp();
  const fin = useFinance();
  const [text, setText] = useState('');
  const [price, setPrice] = useState(0);
  const [priceKey, setPriceKey] = useState(0);
  const [bringing, setBringing] = useState(false);
  const st = shopStats(items, workspace.entries);
  const lists = itemsOf(fin.items, 'compras').filter((l) => !l.archived);
  const refs = new Set(items.map((i) => i.ref).filter(Boolean));
  const bringable = lists
    .map((l) => ({
      l,
      entries: l.data.items.filter((e) => !e.done && !refs.has(`${l.id}:${e.id}`)),
    }))
    .filter((g) => g.entries.length);
  const used = new Set(items.flatMap((i) => (i.entryId ? [i.entryId] : [])));
  const listName = (ref?: string) =>
    ref ? lists.find((l) => l.id === ref.split(':')[0])?.title : undefined;

  const add = () => {
    const parts = splitLines(text);
    if (!parts.length) return;
    const rows = parts.map((p) => {
      const x = parseShopLine(p);
      const unit = parts.length === 1 && price > 0 ? price : x.price;
      return {
        id: crypto.randomUUID(),
        text: x.qty ? `${x.text} ×${x.qty}` : x.text,
        price: unit ? unit * (x.qty ?? 1) : undefined,
        status: 'pendiente',
      } satisfies ShopItem;
    });
    onChange((list) => [...list, ...rows]);
    setText('');
    setPrice(0);
    setPriceKey((k) => k + 1);
  };
  const mark = (i: ShopItem, status: 'si' | 'no') => {
    const next = i.status === status ? 'pendiente' : status;
    onChange((list) =>
      list.map((x) =>
        x.id === i.id
          ? {
              ...x,
              status: next,
              by: 'manual' as const,
              entryId: next === 'si' ? x.entryId : undefined,
            }
          : x,
      ),
    );
    if (i.ref) syncListEntry(i.ref, month, next === 'si', next === 'si' ? i.entryId : undefined);
  };
  const link = (i: ShopItem, e: Entry) => {
    onChange((list) =>
      list.map((x) =>
        x.id === i.id ? { ...x, status: 'si' as const, by: 'manual' as const, entryId: e.id } : x,
      ),
    );
    if (i.ref) syncListEntry(i.ref, month, true, e.id);
  };
  const drop = (i: ShopItem) => onChange((list) => list.filter((x) => x.id !== i.id));
  const restNo = () =>
    onChange((list) =>
      list.map((x) =>
        x.status === 'pendiente' ? { ...x, status: 'no' as const, by: 'manual' as const } : x,
      ),
    );

  // Lo que ya compraste: se busca en los gastos del mes y queda marcado (y avisado) una sola vez.
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (!canMark) return;
    const taken = new Set(used);
    const found: { item: ShopItem; entry: Entry }[] = [];
    for (const i of items) {
      if (i.status !== 'pendiente' || i.by === 'manual') continue;
      const e = matchPurchase(i, moves, taken);
      if (!e || tried.current.has(i.id + '|' + e.id)) continue;
      tried.current.add(i.id + '|' + e.id);
      taken.add(e.id);
      found.push({ item: i, entry: e });
    }
    if (!found.length) return;
    const by = new Map(found.map((f) => [f.item.id, f.entry.id]));
    onChange((list) =>
      list.map((x) =>
        by.has(x.id) && x.status === 'pendiente'
          ? { ...x, status: 'si' as const, by: 'auto' as const, entryId: by.get(x.id) }
          : x,
      ),
    );
    for (const f of found) if (f.item.ref) syncListEntry(f.item.ref, month, true, f.entry.id);
    const names = found.map((f) => `«${f.item.text}»`);
    notify(
      `Ya compraste ${names.slice(0, 2).join(' y ')}${names.length > 2 ? ` y ${names.length - 2} más` : ''}: lo vi en tus gastos de ${monthName(month)}.`,
      {
        label: 'Deshacer',
        run: () => {
          onChange((list) =>
            list.map((x) =>
              by.has(x.id)
                ? { ...x, status: 'pendiente' as const, by: 'manual' as const, entryId: undefined }
                : x,
            ),
          );
          for (const f of found) if (f.item.ref) syncListEntry(f.item.ref, month, false);
        },
      },
    );
  }, [canMark, items, moves]);

  const total = items.length;
  const showMarks = canMark || st.si.length > 0 || st.no.length > 0;

  return (
    <section className="fz-card fz-mshop-card">
      <header className="fz-card-head">
        <h3>
          <ShoppingCart size={15} /> Compras del mes
        </h3>
        <span className="fz-row-tools">
          {st.planned > 0 && <small className="fz-mshop-sum">≈ {moneyShort(st.planned)}</small>}
          {editable && bringable.length > 0 && (
            <button
              type="button"
              className="fz-btn ghost sm"
              title="Trae cosas de tus listas de compras"
              onClick={() => setBringing(true)}
            >
              <ListPlus size={13} /> De tus listas
            </button>
          )}
        </span>
      </header>

      {editable && (
        <form
          className="fz-mshop-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            className="fz-input"
            value={text}
            maxLength={400}
            placeholder="¿Qué piensas comprar? Zapatos, mercado…"
            aria-label="Qué piensas comprar"
            onChange={(e) => setText(e.target.value)}
          />
          <MoneyField
            key={priceKey}
            value={price}
            onChange={setPrice}
            placeholder="≈ precio"
            ariaLabel="Precio aproximado"
          />
          <button
            type="submit"
            className="fz-btn primary sm"
            disabled={!text.trim()}
            aria-label="Agregar"
          >
            <Plus size={15} />
          </button>
        </form>
      )}

      {ended && canMark && st.pending.length > 0 && (
        <div className="fz-mshop-end">
          <span>
            {cap(monthName(month))} terminó: {plural(st.pending.length, 'cosa', 'cosas')} sin
            marcar. ¿Las compraste?
          </span>
          <button type="button" className="fz-btn ghost sm" onClick={restNo}>
            Lo demás, no
          </button>
        </div>
      )}

      {total ? (
        <ul className="fz-mshop-list">
          {items.map((i) => {
            const entry = i.entryId ? workspace.entries.find((e) => e.id === i.entryId) : undefined;
            const hint =
              canMark && i.status === 'pendiente' && i.by === 'manual'
                ? matchPurchase(i, moves, used)
                : undefined;
            const from = listName(i.ref);
            return (
              <li key={i.id} className={'fz-mshop ' + i.status}>
                <span className="fz-mshop-mark" aria-hidden="true">
                  {i.status === 'si' ? (
                    <Check size={12} strokeWidth={3} />
                  ) : i.status === 'no' ? (
                    <X size={12} strokeWidth={3} />
                  ) : null}
                </span>
                <span className="fz-mshop-text">
                  <b>{i.text}</b>
                  {(entry || i.by === 'auto' || from) && (
                    <small>
                      {entry && (
                        <button type="button" className="fz-link" onClick={() => viewEntry(entry)}>
                          «{entry.title.slice(0, 40)}» · {friendlyDate(dayOf(entry)).toLowerCase()}
                        </button>
                      )}
                      {i.by === 'auto' && (
                        <em
                          className="fz-mshop-auto"
                          title={
                            i.status === 'si'
                              ? 'Lo detectó Nexo en tus gastos'
                              : 'Quedó sin marcar al cerrar el mes'
                          }
                        >
                          <Sparkles size={10} /> {i.status === 'si' ? 'Detectado' : 'Al cerrar'}
                        </em>
                      )}
                      {from && <span>De «{from}»</span>}
                    </small>
                  )}
                  {hint && (
                    <button type="button" className="fz-line-hint" onClick={() => link(i, hint)}>
                      ¿Es «{hint.title}» del {friendlyDate(dayOf(hint)).toLowerCase()}?{' '}
                      <Check size={11} />
                    </button>
                  )}
                </span>
                {entry || i.price ? (
                  <em className="fz-mshop-price">
                    {entry ? moneyShort(entry.amount) : `≈ ${moneyShort(i.price!)}`}
                  </em>
                ) : null}
                <span className="fz-mshop-acts">
                  {canMark && (
                    <>
                      <button
                        type="button"
                        className={'yes' + (i.status === 'si' ? ' on' : '')}
                        aria-pressed={i.status === 'si'}
                        title={i.status === 'si' ? 'Quitar el «sí»' : 'Sí, lo compré'}
                        aria-label="Sí, lo compré"
                        onClick={() => mark(i, 'si')}
                      >
                        <Check size={14} strokeWidth={2.6} />
                      </button>
                      <button
                        type="button"
                        className={'nope' + (i.status === 'no' ? ' on' : '')}
                        aria-pressed={i.status === 'no'}
                        title={i.status === 'no' ? 'Quitar el «no»' : 'No lo compré'}
                        aria-label="No lo compré"
                        onClick={() => mark(i, 'no')}
                      >
                        <X size={14} strokeWidth={2.6} />
                      </button>
                    </>
                  )}
                  {editable && (
                    <button
                      type="button"
                      className="fz-mshop-x"
                      title="Quitar de la lista"
                      aria-label={`Quitar ${i.text}`}
                      onClick={() => drop(i)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="fz-muted">
          {editable
            ? 'Anota lo que quieres comprar este mes (o tráelo de tus listas). Al final verás qué compraste y qué no.'
            : 'Esta carta no tiene compras.'}
        </p>
      )}

      {total > 0 && showMarks && (
        <footer className="fz-mshop-foot">
          <i className="fz-mshop-bar" aria-hidden="true">
            <i className="si" style={{ width: (st.si.length / total) * 100 + '%' }} />
            <i className="no" style={{ width: (st.no.length / total) * 100 + '%' }} />
          </i>
          <span>
            <b className="in">{st.si.length} sí</b> · <b className="bad">{st.no.length} no</b>
            {st.pending.length > 0 && ` · ${st.pending.length} por decidir`}
          </span>
          {st.spent > 0 && (
            <small>
              Gastaste ≈ {moneyShort(st.spent)}
              {st.planned > 0 && ` de ≈ ${moneyShort(st.planned)}`}
            </small>
          )}
        </footer>
      )}

      {bringing && (
        <BringSheet
          month={month}
          groups={bringable}
          onClose={() => setBringing(false)}
          onAdd={(rows) => {
            onChange((list) => [...list, ...rows]);
            setBringing(false);
            notify(
              `${plural(rows.length, 'compra agregada', 'compras agregadas')} desde tus listas.`,
            );
          }}
        />
      )}
    </section>
  );
}

/** Traer cosas de tus listas a la carta: ya marcadas las de las listas que tocan este mes. */
function BringSheet({
  month,
  groups,
  onAdd,
  onClose,
}: {
  month: string;
  groups: { l: FinItem<'compras'>; entries: ShopEntry[] }[];
  onAdd: (rows: ShopItem[]) => void;
  onClose: () => void;
}) {
  const today = todayInputValue();
  const keyOf = (l: FinItem<'compras'>, e: ShopEntry) => `${l.id}:${e.id}`;
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        groups
          .filter((g) => g.l.data.due && g.l.data.due <= month)
          .flatMap((g) => g.entries.map((e) => keyOf(g.l, e))),
      ),
  );
  const toggle = (k: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const toggleGroup = (keys: string[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)));
      return n;
    });
  const rows = groups.flatMap((g) =>
    g.entries
      .filter((e) => picked.has(keyOf(g.l, e)))
      .map(
        (e) =>
          ({
            id: crypto.randomUUID(),
            text: e.qty ? `${e.text} ×${e.qty}` : e.text,
            price: entryCost(e) || undefined,
            status: 'pendiente',
            ref: keyOf(g.l, e),
          }) satisfies ShopItem,
      ),
  );
  const sum = rows.reduce((s, r) => s + (r.price ?? 0), 0);
  return (
    <FinSheet
      title="Traer de tus listas"
      sub={`Lo que piensas comprar en ${monthName(month)}. Al comprarlo, se tacha también en su lista.`}
      icon={<ListPlus size={18} />}
      className="fz-bring"
      onClose={onClose}
      footer={
        <>
          <span className="fz-foot-note">
            {rows.length
              ? `${plural(rows.length, 'cosa', 'cosas')}${sum ? ` · ≈ ${money(sum)}` : ''}`
              : 'Elige qué traer'}
          </span>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="fz-btn primary"
            disabled={!rows.length}
            onClick={() => onAdd(rows)}
          >
            Agregar {rows.length || ''}
          </button>
        </>
      }
    >
      {groups.map(({ l, entries }) => {
        const keys = entries.map((e) => keyOf(l, e));
        const all = keys.every((k) => picked.has(k));
        const w = whenLabel(l.data, today);
        return (
          <section key={l.id} className="fz-bring-group">
            <header>
              <span className="fz-shop-emoji sm" aria-hidden="true">
                {l.data.emoji || <ShoppingBasket size={13} />}
              </span>
              <strong>{l.title}</strong>
              <em className={'fz-shop-when ' + w.tone}>{w.text}</em>
              <button
                type="button"
                className="fz-note-pick"
                onClick={() => toggleGroup(keys, !all)}
              >
                {all ? 'Ninguno' : 'Todos'}
              </button>
            </header>
            <ul>
              {entries.map((e) => {
                const k = keyOf(l, e);
                const on = picked.has(k);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className={'fz-bring-row' + (on ? ' on' : '')}
                      onClick={() => toggle(k)}
                    >
                      <i className="fz-note-tick" aria-hidden="true">
                        {on && <Check size={11} strokeWidth={3} />}
                      </i>
                      <span>
                        {e.text}
                        {e.qty ? <small> ×{e.qty}</small> : null}
                      </span>
                      {e.price ? <b>{moneyShort(entryCost(e))}</b> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </FinSheet>
  );
}
