import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  CheckSquare,
  Download,
  HandCoins,
  Pencil,
  PiggyBank,
  Receipt,
  Search,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { LoadMore, useInfinite } from '../components/LoadMore';
import { isMoneyCategory } from '../composer/logic';
import type { Entry, MoneyFlow } from '../data';
import { friendlyDate, money, normalizeText, thousands, todayInputValue } from '../lib/format';
import { ImportSheet } from './Import';
import {
  categoryOf,
  costOf,
  dayOf,
  entryAsInput,
  flowMeta,
  flowOf,
  inPeriod,
  isMoney,
  totals,
  type Period,
} from './money';
import { PeriodBar } from './PeriodBar';
import { useFinance } from './store';
import { download, noonISO } from './ui';

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

  const options = useMemo(() => {
    const cats = new Set<string>();
    const accounts = new Set<string>();
    const who = new Set<string>();
    for (const e of inP) {
      cats.add(categoryOf(e));
      if (e.details.method) accounts.add(e.details.method);
      if (e.details.toMethod) accounts.add(e.details.toMethod);
      e.person_ids.forEach((id) => who.add(id));
    }
    return {
      cats: [...cats].sort((a, b) => a.localeCompare(b, 'es')),
      accounts: [...accounts].sort((a, b) => a.localeCompare(b, 'es')),
      people: [...who]
        .map((id) => ({ id, name: nameOf(id) }))
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    };
  }, [inP, people]);

  const words = normalizeText(query.trim()).split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () =>
      inP.filter((e) => {
        const f = flowOf(e);
        if (filter === 'pendientes' ? !e.details.pending : filter !== 'todos' && f !== filter) return false;
        if (cat && categoryOf(e) !== cat) return false;
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
    [inP, filter, cat, account, personId, words.join(' '), people],
  );
  const sum = totals(shown);
  const reset = [period.kind, period.from, filter, cat, account, personId, query].join('|');
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
  const bulkCategory = async (name: string) => {
    for (const e of selected)
      await patchEntry(e, { tags: [name, ...e.tags.filter((t) => !isMoneyCategory(t))] });
    notify(`${selected.length} movimientos en ${name}.`);
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
        <div className="fz-selects">
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {options.cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {options.accounts.length > 0 && (
            <select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Cuenta">
              <option value="">Todas las cuentas</option>
              {options.accounts.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          {options.people.length > 0 && (
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="Persona">
              <option value="">Con cualquiera</option>
              {options.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
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
          <select value="" onChange={(e) => e.target.value && void bulkCategory(e.target.value)} aria-label="Cambiar categoría">
            <option value="">Cambiar categoría…</option>
            {[...new Set([...options.cats.filter(isMoneyCategory), 'Comida', 'Transporte', 'Hogar', 'Salud', 'Ocio', 'Educación', 'Trabajo', 'Compras', 'Otro'])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
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
                        {e.details.worth === 1 && <em className="fz-chip good">Valió la pena</em>}
                        {e.details.worth === -1 && <em className="fz-chip bad">Me arrepiento</em>}
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
    </div>
  );
}
