import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  CheckSquare,
  CreditCard,
  Download,
  HandCoins,
  ListTree,
  Pencil,
  PiggyBank,
  Receipt,
  Search,
  Tag,
  Trash2,
  Undo2,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { LoadMore, useInfinite } from '../components/LoadMore';
import { expenseCategories, incomeCategories, isMoneyCategory } from '../composer/logic';
import type { Entry, MoneyFlow } from '../data';
import { friendlyDate, money, normalizeText, thousands, todayInputValue } from '../lib/format';
import { Avatar } from '../people/Avatar';
import { CatIcon } from './catIcons';
import { CategoryPanel } from './CategoryPicker';
import { FilterPick } from './FilterPick';
import { ImportSheet } from './Import';
import { IncomePicker, IncomeSheet } from './IncomeLinks';
import { cardMethod, itemsOf } from './model';
import {
  categoryOf,
  costOf,
  dayOf,
  entryAsInput,
  flowMeta,
  flowOf,
  inPeriod,
  isMoney,
  moneyShort,
  totals,
  worthOf,
  type Period,
} from './money';
import { PeriodBar } from './PeriodBar';
import { settingsOf, useFinance } from './store';
import { download, noonISO } from './ui';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Filter = 'todos' | MoneyFlow | 'pendientes';
const filters: { key: Filter; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'gasto', label: 'Gastos' },
  { key: 'ingreso', label: 'Ingresos' },
  { key: 'ahorro', label: 'Ahorro' },
  { key: 'transferencia', label: 'Transferencias' },
  { key: 'prestamo', label: 'Préstamos' },
  { key: 'reembolso', label: 'Reembolsos' },
  { key: 'pendientes', label: 'Pendientes' },
];

export const flowIcon: Record<MoneyFlow, typeof Check> = {
  gasto: ArrowUpRight,
  ingreso: ArrowDownLeft,
  ahorro: PiggyBank,
  transferencia: ArrowLeftRight,
  prestamo: HandCoins,
  reembolso: Undo2,
};

/** Signo y color de un movimiento: lo que no es gasto ni ingreso va en gris. */
export function amountLook(e: Entry) {
  const f = flowOf(e);
  const neutral = f === 'transferencia' || f === 'prestamo' || f === 'ahorro';
  return {
    sign: f === 'transferencia' ? '' : e.direction === 'ingreso' ? '+' : '−',
    cls: neutral ? 'neutral' : e.direction === 'ingreso' ? 'in' : 'out',
  };
}

const csvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function MovementsTab({ period, setPeriod }: { period: Period; setPeriod: (p: Period) => void }) {
  const {
    workspace,
    editEntry,
    viewEntry,
    removeEntry,
    createEntry,
    patchEntry,
    linkEntries,
    openImages,
    notify,
    confirm,
  } = useApp();
  const today = todayInputValue();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [cat, setCat] = useState('');
  /** El filtro de categoría también encuentra los movimientos donde es secundaria. */
  const [catAny, setCatAny] = useState(false);
  const [account, setAccount] = useState('');
  const [personId, setPersonId] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const people = workspace.people;
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '';
  const fin = useFinance();
  // Nombres de bolsillos y cobros por partes (para mostrar a cuál pertenece cada movimiento).
  const finTitle = useMemo(
    () =>
      new Map(
        (fin.items ?? [])
          .filter((i) => i.kind === 'bolsillo' || i.kind === 'cobro')
          .map((i) => [i.id, i.kind === 'bolsillo' && i.data.emoji ? `${i.data.emoji} ${i.title}` : i.title]),
      ),
    [fin.items],
  );
  const moves = useMemo(
    () =>
      workspace.entries
        .filter(isMoney)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || (b.recorded_at ?? '').localeCompare(a.recorded_at ?? '')),
    [workspace.entries],
  );
  const inP = useMemo(() => moves.filter((e) => inPeriod(e, period)), [moves, period]);
  // Lo que ya salió de cada ingreso y el nombre del ingreso de cada gasto anexado.
  const incomeLinks = useMemo(() => {
    const used = new Map<string, number>();
    const byId = new Map(moves.map((e) => [e.id, e]));
    for (const e of moves) {
      const id = e.details.fromIncome;
      if (id && !e.details.pending) used.set(id, (used.get(id) ?? 0) + costOf(e));
    }
    return { used, byId };
  }, [moves]);
  const [breakdown, setBreakdown] = useState<Entry | null>(null);
  const [attachAt, setAttachAt] = useState<HTMLElement | null>(null);

  const options = useMemo(() => {
    // Cuántos movimientos tiene cada categoría como principal y cuántos solo como secundaria.
    const cats = new Map<string, { main: number; also: number }>();
    const accounts = new Map<string, number>();
    const who = new Map<string, number>();
    const bump = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const e of inP) {
      const main = categoryOf(e);
      const c = cats.get(main) ?? { main: 0, also: 0 };
      c.main++;
      cats.set(main, c);
      for (const t of e.tags.filter(isMoneyCategory)) {
        if (t === main) continue;
        const x = cats.get(t) ?? { main: 0, also: 0 };
        x.also++;
        cats.set(t, x);
      }
      if (e.details.method) bump(accounts, e.details.method);
      if (e.details.toMethod && e.details.toMethod !== e.details.method) bump(accounts, e.details.toMethod);
      e.person_ids.forEach((id) => bump(who, id));
    }
    const byName = <T,>(m: Map<string, T>) => [...m.keys()].sort((a, b) => a.localeCompare(b, 'es'));
    return {
      cats: byName(cats),
      catCount: cats,
      accounts: byName(accounts),
      accountCount: accounts,
      people: [...who.keys()]
        .map((id) => ({ id, name: nameOf(id), n: who.get(id) ?? 0 }))
        .filter((p) => p.name)
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'es')),
    };
  }, [inP, people]);
  const cardNames = useMemo(
    () => new Set(itemsOf(fin.items, 'tarjeta').map((c) => cardMethod(c).toLowerCase())),
    [fin.items],
  );

  const words = normalizeText(query.trim()).split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () =>
      inP.filter((e) => {
        const f = flowOf(e);
        if (filter === 'pendientes' ? !e.details.pending : filter !== 'todos' && f !== filter) return false;
        // La principal; o, si lo pides, también donde es secundaria.
        if (cat && categoryOf(e) !== cat && !(catAny && e.tags.includes(cat))) return false;
        if (account && e.details.method !== account && e.details.toMethod !== account) return false;
        if (personId && !e.person_ids.includes(personId)) return false;
        if (!words.length) return true;
        const text = normalizeText(
          [
            e.title,
            e.body,
            ...e.tags,
            e.details.method,
            e.details.toMethod,
            e.details.place,
            flowMeta[f].label,
            ...e.person_ids.map(nameOf),
            String(e.amount),
            thousands(e.amount),
          ].join(' '),
        );
        return words.every((w) => text.includes(w) || text.includes(w.replace(/[.,]/g, '')));
      }),
    [inP, filter, cat, catAny, account, personId, words.join(' '), people],
  );
  const sum = totals(shown);
  const reset = [period.kind, period.from, filter, cat, catAny, account, personId, query].join('|');
  const page = useInfinite(shown, 60, reset);

  // Agrupados por día, con lo que salió y entró ese día.
  const groups = useMemo(() => {
    const out: { day: string; items: Entry[]; out: number; in: number }[] = [];
    for (const e of page.visible) {
      const d = dayOf(e);
      let g = out[out.length - 1];
      if (!g || g.day !== d) out.push((g = { day: d, items: [], out: 0, in: 0 }));
      g.items.push(e);
      if (e.details.pending) continue;
      const f = flowOf(e);
      if (f === 'gasto') g.out += costOf(e);
      else if (f === 'ingreso') g.in += e.amount;
      else if (f === 'reembolso') g.out -= e.amount;
    }
    return out;
  }, [page.visible]);

  const remove = (e: Entry) => {
    removeEntry(e, true);
    notify('Movimiento eliminado.', {
      label: 'Deshacer',
      run: () => void createEntry(entryAsInput(e), true),
    });
  };

  const markDone = async (e: Entry) => {
    const { pending: _p, ...rest } = e.details;
    const ok = await patchEntry(e, { details: { ...rest, paidOn: today }, created_at: noonISO(today) });
    if (ok)
      notify(e.direction === 'ingreso' ? 'Marcado como cobrado.' : 'Marcado como pagado.', {
        label: 'Deshacer',
        run: () => void patchEntry({ ...e, details: { ...rest, paidOn: today }, created_at: noonISO(today) }, { details: e.details, created_at: e.created_at }),
      });
  };

  const selected = shown.filter((e) => picked.has(e.id));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // ── Categorías en lote: varias a la vez, reemplazando o sumándolas a las que ya tienen.
  const [catAt, setCatAt] = useState<HTMLElement | null>(null);
  const [catAdd, setCatAdd] = useState(false);
  const categorizable = selected.filter((e) => {
    const f = flowOf(e);
    return f !== 'transferencia' && f !== 'prestamo';
  });
  const selFlows = new Set(categorizable.map(flowOf));
  const settings = settingsOf(fin.items);
  const outCats = [...expenseCategories.filter((x) => x !== 'Ahorro' && x !== 'Otro'), ...settings.extraOut];
  const inCats = [...incomeCategories.filter((x) => x !== 'Reembolso' && x !== 'Otro'), ...settings.extraIn];
  const onlyIn = selFlows.size > 0 && [...selFlows].every((f) => f === 'ingreso');
  const onlyOut = selFlows.size > 0 && [...selFlows].every((f) => f === 'gasto');
  const bulkCatOptions = [
    ...new Set([
      ...(onlyIn ? inCats : onlyOut ? outCats : [...outCats, ...inCats]),
      ...categorizable.flatMap((e) => e.tags.filter(isMoneyCategory)),
      'Otro',
    ]),
  ];
  const bulkCreateIn: 'out' | 'in' | undefined = onlyIn ? 'in' : onlyOut ? 'out' : undefined;
  // Si todas tienen las mismas categorías, el panel arranca con ellas (para reemplazar).
  const firstCats = categorizable[0]?.tags.filter(isMoneyCategory) ?? [];
  const bulkCatStart =
    !catAdd && categorizable.every((e) => e.tags.filter(isMoneyCategory).join('|') === firstCats.join('|'))
      ? firstCats
      : [];
  const bulkCategory = async (list: string[], add: boolean) => {
    const before: { e: Entry; tags: string[] }[] = [];
    for (const e of categorizable) {
      const own = e.tags.filter(isMoneyCategory);
      const rest = e.tags.filter((t) => !isMoneyCategory(t));
      const cats = add ? [...own, ...list.filter((x) => !own.includes(x))] : list;
      if (cats.join('|') === own.join('|')) continue;
      if (await patchEntry(e, { tags: [...cats, ...rest] })) before.push({ e, tags: e.tags });
    }
    setPicked(new Set());
    if (!before.length) return notify('Nada que cambiar: ya tenían esas categorías.');
    notify(
      add
        ? `${list.join(', ')} ${list.length === 1 ? 'añadida' : 'añadidas'} a ${plural(before.length, 'movimiento', 'movimientos')}.`
        : list.length
          ? `${plural(before.length, 'movimiento', 'movimientos')} en ${list.join(', ')}.`
          : `${plural(before.length, 'movimiento', 'movimientos')} sin categoría.`,
      {
        label: 'Deshacer',
        run: () =>
          void (async () => {
            for (const b of before) await patchEntry({ ...b.e }, { tags: b.tags });
          })(),
      },
    );
  };
  /** Anexa los gastos elegidos a un ingreso (o los saca de él, con null). */
  const bulkIncome = async (income: Entry | null) => {
    const list = selected.filter((e) => {
      const f = flowOf(e);
      return f === 'gasto' || (f === 'ahorro' && e.direction === 'egreso');
    });
    if (!list.length) return notify('Solo los gastos (y lo que ahorras) salen de un ingreso.');
    for (const e of list) {
      const { fromIncome: _old, ...rest } = e.details;
      await patchEntry(e, { details: income ? { ...rest, fromIncome: income.id } : rest });
    }
    notify(
      income
        ? `${list.length === 1 ? 'Gasto anexado' : `${list.length} gastos anexados`} a «${income.title || 'el ingreso'}».`
        : 'Gastos sacados de su ingreso.',
      income ? { label: 'Ver', icon: 'open', run: () => setBreakdown(income) } : undefined,
    );
    setPicked(new Set());
  };
  const bulkEpisode = async (id: string) => {
    const ok = await linkEntries(
      selected.map((e) => e.id),
      id || null,
      true,
    );
    if (ok) notify(id ? 'Movimientos llevados al episodio.' : 'Movimientos sacados del episodio.');
    setPicked(new Set());
  };
  const bulkDelete = async () => {
    const list = selected;
    const ok = await confirm({
      title: `¿Eliminar ${list.length} movimientos?`,
      message: 'Podrás deshacerlo justo después.',
      confirmLabel: 'Eliminar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    for (const e of list) removeEntry(e, true);
    setPicked(new Set());
    notify(`${list.length} movimientos eliminados.`, {
      label: 'Deshacer',
      run: () => {
        void (async () => {
          for (const e of list) await createEntry(entryAsInput(e), true);
        })();
      },
    });
  };

  const exportCsv = () => {
    const head = ['Fecha', 'Tipo', 'Categoría', 'Concepto', 'Monto', 'Medio', 'Hacia', 'Personas', 'Lugar', 'Estado', 'Nota'];
    const rows = shown.map((e) => {
      const f = flowOf(e);
      const look = amountLook(e);
      return [
        dayOf(e),
        flowMeta[f].label,
        categoryOf(e),
        e.title,
        (look.sign === '−' ? '-' : '') + e.amount,
        e.details.method ?? '',
        e.details.toMethod ?? '',
        e.person_ids.map(nameOf).join(', '),
        e.details.place ?? '',
        e.details.pending ? 'Pendiente' : 'Listo',
        e.body.replace(/\s+/g, ' '),
      ];
    });
    const csv = '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
    download(`nexo-movimientos-${period.kind === 'todo' ? 'todo' : period.from}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <div className="fz-moves">
      <PeriodBar period={period} onChange={setPeriod}>
        <label className="fz-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por concepto, monto, persona, lugar…"
            aria-label="Buscar movimientos"
          />
          {query && (
            <button type="button" aria-label="Limpiar" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </label>
      </PeriodBar>

      <div className="fz-filters">
        <div className="fz-chips" role="radiogroup" aria-label="Tipo">
          {filters.map((f) => (
            <button
              type="button"
              role="radio"
              aria-checked={filter === f.key}
              key={f.key}
              className={filter === f.key ? 'on' : ''}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="fz-fpicks">
          <FilterPick
            icon={<Tag size={14} />}
            placeholder="Categoría"
            title="Filtrar por categoría"
            allLabel="Todas las categorías"
            value={cat}
            onChange={setCat}
            valueSuffix={cat && catAny && (options.catCount.get(cat)?.also ?? 0) > 0 ? '+ secundaria' : undefined}
            options={options.cats.flatMap((c) => {
              const n = options.catCount.get(c)!;
              const count = catAny ? n.main + n.also : n.main;
              return count ? [{ value: c, label: c, icon: <CatIcon name={c} size={11} />, count }] : [];
            })}
            extra={
              <button
                type="button"
                role="switch"
                aria-checked={catAny}
                className={'fz-fmode' + (catAny ? ' on' : '')}
                onClick={() => {
                  // Sin secundarias, una categoría que solo era secundaria deja de filtrar.
                  if (catAny && cat && !options.catCount.get(cat)?.main) setCat('');
                  setCatAny(!catAny);
                }}
              >
                <span className="fz-fmode-track" aria-hidden="true">
                  <i />
                </span>
                <span>
                  <b>Incluir donde es secundaria</b>
                  <small>
                    {cat && options.catCount.get(cat)?.also
                      ? `${plural(options.catCount.get(cat)!.also, 'movimiento más', 'movimientos más')} con «${cat}»`
                      : 'Los gráficos cuentan solo la principal.'}
                  </small>
                </span>
              </button>
            }
          />
          {options.accounts.length > 0 && (
            <FilterPick
              icon={<Wallet size={14} />}
              placeholder="Cuenta"
              title="Filtrar por cuenta"
              allLabel="Todas las cuentas"
              value={account}
              onChange={setAccount}
              options={options.accounts.map((a) => ({
                value: a,
                label: a,
                icon: cardNames.has(a.toLowerCase()) ? <CreditCard size={14} /> : <Wallet size={14} />,
                count: options.accountCount.get(a),
              }))}
            />
          )}
          {options.people.length > 0 && (
            <FilterPick
              icon={<Users size={14} />}
              placeholder="Persona"
              title="Filtrar por persona"
              allLabel="Con cualquiera"
              value={personId}
              onChange={setPersonId}
              options={options.people.map((p) => {
                const person = people.find((x) => x.id === p.id);
                return {
                  value: p.id,
                  label: p.name,
                  icon: person ? <Avatar person={person} size={20} /> : <Users size={14} />,
                  count: p.n,
                };
              })}
            />
          )}
        </div>
      </div>

      <div className="fz-moves-bar">
        <p>
          <b>{shown.length}</b> {shown.length === 1 ? 'movimiento' : 'movimientos'}
          {sum.spent > 0 && (
            <>
              {' '}
              · gastos <b className="out">{money(sum.spent)}</b>
            </>
          )}
          {sum.income > 0 && (
            <>
              {' '}
              · ingresos <b className="in">{money(sum.income)}</b>
            </>
          )}
        </p>
        <div>
          <button
            type="button"
            className={'fz-btn ghost sm' + (selecting ? ' on' : '')}
            onClick={() => {
              setSelecting((v) => !v);
              setPicked(new Set());
            }}
          >
            <CheckSquare size={14} /> {selecting ? 'Listo' : 'Seleccionar'}
          </button>
          <button type="button" className="fz-btn ghost sm" onClick={() => setImporting(true)}>
            <Upload size={14} /> Importar extracto
          </button>
          <button type="button" className="fz-btn ghost sm" onClick={exportCsv} disabled={!shown.length}>
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {selecting && selected.length > 0 && (
        <div className="fz-bulk">
          <b>{selected.length} seleccionados</b>
          <button
            type="button"
            className="fz-btn ghost sm"
            aria-haspopup="dialog"
            aria-expanded={Boolean(catAt)}
            onClick={(e) => setCatAt(catAt ? null : e.currentTarget)}
          >
            <Tag size={14} /> Categoría
          </button>
          {catAt && (
            <CategoryPanel
              compact
              anchor={catAt}
              title="Categorías de la selección"
              context={`${plural(categorizable.length, 'movimiento', 'movimientos')}${categorizable.length < selected.length ? ` (sin ${selected.length - categorizable.length} transferencias o préstamos)` : ''}`}
              options={bulkCatOptions}
              value={bulkCatStart}
              createIn={bulkCreateIn}
              confirmLabel={catAdd ? 'Añadir' : 'Aplicar'}
              onConfirm={(list) => {
                setCatAt(null);
                void bulkCategory(list, catAdd);
              }}
              onClose={() => setCatAt(null)}
              extra={
                <div className="fz-fseg" role="radiogroup" aria-label="Cómo aplicarlas">
                  <button type="button" role="radio" aria-checked={!catAdd} className={!catAdd ? 'on' : ''} onClick={() => setCatAdd(false)}>
                    Reemplazar
                  </button>
                  <button type="button" role="radio" aria-checked={catAdd} className={catAdd ? 'on' : ''} onClick={() => setCatAdd(true)}>
                    Añadir a las que tienen
                  </button>
                </div>
              }
            />
          )}
          {workspace.episodes.length > 0 && (
            <select value="-" onChange={(e) => e.target.value !== '-' && void bulkEpisode(e.target.value)} aria-label="Llevar a un episodio">
              <option value="-">Llevar a un episodio…</option>
              <option value="">Ninguno (sacar)</option>
              {workspace.episodes.slice(0, 80).map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.title}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="fz-btn ghost sm"
            aria-haspopup="dialog"
            title="Di de qué ingreso salieron estos gastos"
            onClick={(e) => setAttachAt(attachAt ? null : e.currentTarget)}
          >
            <ArrowDownLeft size={14} /> Anexar a un ingreso
          </button>
          {attachAt && <IncomePicker anchor={attachAt} onPick={(inc) => void bulkIncome(inc)} onClose={() => setAttachAt(null)} />}
          <button type="button" className="fz-btn danger sm" onClick={() => void bulkDelete()}>
            <Trash2 size={14} /> Eliminar
          </button>
          <button type="button" className="fz-link" onClick={() => setPicked(new Set(shown.map((e) => e.id)))}>
            Todos ({shown.length})
          </button>
        </div>
      )}

      {groups.length ? (
        <div className="fz-days">
          {groups.map((g) => (
            <section key={g.day} className="fz-dgroup">
              <header>
                <strong>{friendlyDate(g.day, today)}</strong>
                <span>
                  {g.in > 0 && <b className="in">+{money(g.in)}</b>}
                  {g.out > 0 && <b className="out">−{money(g.out)}</b>}
                </span>
              </header>
              {g.items.map((e) => {
                const f = flowOf(e);
                const Icon = flowIcon[f];
                const look = amountLook(e);
                const names = e.person_ids.map((id) => nameOf(id).split(' ')[0]).filter(Boolean);
                const bits = [
                  f === 'transferencia'
                    ? `${e.details.method ?? '?'} → ${e.details.toMethod ?? '?'}`
                    : e.tags.filter(isMoneyCategory).length > 1
                      ? e.tags.filter(isMoneyCategory).join(' + ')
                      : categoryOf(e),
                  f !== 'transferencia' && e.details.method,
                  names.length && names.slice(0, 3).join(', '),
                  e.details.place,
                ].filter(Boolean);
                return (
                  <div
                    key={e.id}
                    className={'fz-row' + (picked.has(e.id) ? ' picked' : '') + (e.details.pending ? ' pending' : '')}
                    onClick={selecting ? () => toggle(e.id) : undefined}
                  >
                    {selecting && (
                      <span className={'fz-tick' + (picked.has(e.id) ? ' on' : '')} aria-hidden="true">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                    <span className={'fz-ico ' + look.cls}>
                      <Icon size={17} />
                    </span>
                    <button type="button" className="fz-row-main" onClick={selecting ? undefined : () => viewEntry(e)}>
                      <strong>{e.title || flowMeta[f].label}</strong>
                      <small>
                        {bits.join(' · ')}
                        {e.details.pending && (
                          <em className="fz-chip warn">{e.direction === 'ingreso' ? 'Por cobrar' : 'Por pagar'}</em>
                        )}
                        {e.details.split && <em className="fz-chip">Tu parte {money(e.details.split.mine)}</em>}
                        {e.details.recurringId && <em className="fz-chip muted">Fijo</em>}
                        {e.details.chargeId && finTitle.get(e.details.chargeId) && (
                          <em className="fz-chip good">Abono · {finTitle.get(e.details.chargeId)}</em>
                        )}
                        {e.details.pocketId && finTitle.get(e.details.pocketId) && (
                          <em className="fz-chip muted">{finTitle.get(e.details.pocketId)}</em>
                        )}
                        {e.details.fromIncome && incomeLinks.byId.get(e.details.fromIncome) && (
                          <em className="fz-chip muted fz-from-inc">
                            <ArrowDownLeft size={10} /> de «{(incomeLinks.byId.get(e.details.fromIncome)!.title || 'un ingreso').slice(0, 28)}»
                          </em>
                        )}
                        {f === 'ingreso' && incomeLinks.used.has(e.id) && (
                          <em className={'fz-chip ' + (e.amount - incomeLinks.used.get(e.id)! < 0 ? 'bad' : 'good')}>
                            {e.amount - incomeLinks.used.get(e.id)! < 0
                              ? `Te pasaste ${moneyShort(incomeLinks.used.get(e.id)! - e.amount)}`
                              : `Quedan ${moneyShort(e.amount - incomeLinks.used.get(e.id)!)}`}
                          </em>
                        )}
                        {worthOf(e.details.worth) && (
                          <em className={'fz-chip worth-' + worthOf(e.details.worth)!.tone}>{worthOf(e.details.worth)!.label}</em>
                        )}
                      </small>
                    </button>
                    <span className="fz-row-amount">
                      <b className={look.cls}>
                        {look.sign}
                        {money(e.amount)}
                      </b>
                      {e.details.currency && e.details.original && (
                        <small>
                          {e.details.original.toLocaleString('es-CO')} {e.details.currency}
                        </small>
                      )}
                    </span>
                    {!selecting && (
                      <span className="fz-row-tools">
                        {e.details.pending && (
                          <button type="button" className="fz-icon ok" title={e.direction === 'ingreso' ? 'Marcar cobrado' : 'Marcar pagado'} aria-label="Marcar como listo" onClick={() => void markDone(e)}>
                            <Check size={15} />
                          </button>
                        )}
                        {f === 'ingreso' && !e.details.pending && (
                          <button type="button" className="fz-icon" title="En qué se fue este ingreso" aria-label="En qué se fue este ingreso" onClick={() => setBreakdown(e)}>
                            <ListTree size={15} />
                          </button>
                        )}
                        {e.images.length > 0 && (
                          <button type="button" className="fz-icon" title="Ver comprobante" aria-label="Ver comprobante" onClick={() => openImages(e.images, 0)}>
                            <Receipt size={15} />
                          </button>
                        )}
                        <button type="button" className="fz-icon" title="Editar" aria-label="Editar movimiento" onClick={() => editEntry(e)}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" className="fz-icon" title="Eliminar" aria-label="Eliminar movimiento" onClick={() => remove(e)}>
                          <Trash2 size={15} />
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
          <LoadMore rest={page.rest} onMore={page.loadMore} shown={page.visible.length} />
        </div>
      ) : (
        <div className="fz-empty">
          <strong>{moves.length ? 'Nada con esos filtros.' : 'Registra tu primer gasto o ingreso.'}</strong>
          <p>
            {moves.length
              ? 'Prueba con otro periodo o quita algún filtro.'
              : 'Escríbelo como lo dirías («taxi 12 mil nequi») o importa el extracto de tu banco.'}
          </p>
        </div>
      )}

      {importing && <ImportSheet onClose={() => setImporting(false)} />}
      {breakdown && <IncomeSheet income={breakdown} onClose={() => setBreakdown(null)} />}
    </div>
  );
}
