import { useMemo, useState } from 'react';
import { ChevronDown, Database, Download, Landmark, PiggyBank, Plus, Scale, Tags, Trash2, Upload, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Segmented } from '../composer/controls';
import { expenseCategories, incomeCategories } from '../composer/logic';
import { money, todayInputValue } from '../lib/format';
import { catColor } from './charts';
import { ImportSheet } from './Import';
import { defaultAccounts, itemsOf, type Settings } from './model';
import { accountBalances, byCategory, categoryOf, dayOf, flowMeta, flowOf, isMoney, monthBounds, monthKey, shiftMonth } from './money';
import { saveSettings, settingsOf, useFinance } from './store';
import { download, Field, FinSheet, MoneyField, moneyInput } from './ui';

const BUDGET_FOLD = 'nexo-fin-budget-open';

export function SettingsTab() {
  const fin = useFinance();
  const current = itemsOf(fin.items, 'ajustes')[0];
  // Se vuelve a montar al guardar: el formulario siempre arranca de lo guardado.
  return <SettingsForm key={current?.updated_at ?? 'none'} initial={settingsOf(fin.items)} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const { workspace, notify } = useApp();
  const fin = useFinance();
  const [s, setS] = useState<Settings>(initial);
  const [newAccount, setNewAccount] = useState('');
  const [newCat, setNewCat] = useState({ out: '', in: '' });
  const [reconcile, setReconcile] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const balances = accountBalances(moves, s.accounts);
  const lastMonth = shiftMonth(monthKey(todayInputValue()), -1);
  const { from, to } = monthBounds(lastMonth);
  const lastSpend = new Map(byCategory(moves.filter((e) => dayOf(e) >= from && dayOf(e) <= to)).map((c) => [c.name, c.total]));
  const outCats = [...expenseCategories.filter((c) => c !== 'Ahorro'), ...s.extraOut];
  const budgetSum = Object.values(s.budgets).reduce((a, b) => a + b, 0);
  const budgetCats = Object.keys(s.budgets).length;
  const thisMonthOwn = itemsOf(fin.items, 'proyeccion').find((l) => l.data.month === monthKey(todayInputValue()))?.data.budget;
  const [budgetOpen, setBudgetOpen] = useState(() => localStorage.getItem(BUDGET_FOLD) !== '0');
  const toggleBudget = (open: boolean) => {
    localStorage.setItem(BUDGET_FOLD, open ? '1' : '0');
    setBudgetOpen(open);
  };

  const save = async () => {
    const r = await saveSettings(s);
    if (r !== true) notify(r);
    else notify('Ajustes guardados.');
  };
  const addAccount = () => {
    const name = newAccount.trim().slice(0, 40);
    if (!name || s.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) return;
    setS({ ...s, accounts: [...s.accounts, { name, initial: 0 }] });
    setNewAccount('');
  };
  const addCat = (kind: 'out' | 'in') => {
    const name = newCat[kind].trim().slice(0, 30);
    const list = kind === 'out' ? s.extraOut : s.extraIn;
    const base = kind === 'out' ? expenseCategories : incomeCategories;
    if (!name || list.includes(name) || base.includes(name)) return;
    setS({ ...s, [kind === 'out' ? 'extraOut' : 'extraIn']: [...list, name] });
    setNewCat({ ...newCat, [kind]: '' });
  };

  const exportAll = () => {
    const head = ['Fecha', 'Tipo', 'Categoría', 'Concepto', 'Monto', 'Medio', 'Estado'];
    const rows = moves.map((e) => [
      dayOf(e),
      flowMeta[flowOf(e)].label,
      categoryOf(e),
      e.title.replace(/;/g, ','),
      (e.direction === 'egreso' ? '-' : '') + e.amount,
      e.details.method ?? '',
      e.details.pending ? 'Pendiente' : 'Listo',
    ]);
    download('nexo-finanzas.csv', '\ufeff' + [head, ...rows].map((r) => r.join(';')).join('\n'), 'text/csv;charset=utf-8');
  };
  const backup = () =>
    download(
      `nexo-finanzas-${todayInputValue()}.json`,
      JSON.stringify({ exportado: new Date().toISOString(), finanzas: fin.items ?? [] }, null, 2),
      'application/json',
    );

  return (
    <div className="fz-settings">
      <section className="fz-block">
        <header className="fz-block-head">
          <h3>
            <Landmark size={16} /> Tus cuentas
          </h3>
          <small>Con el saldo inicial, Nexo calcula cuánto debería haber en cada una.</small>
        </header>
        {s.accounts.length ? (
          <ul className="fz-accounts">
            {s.accounts.map((a, i) => {
              const b = balances.find((x) => x.name === a.name);
              return (
                <li key={a.name}>
                  <strong>{a.name}</strong>
                  <label>
                    <small>Saldo inicial</small>
                    <MoneyField
                      value={Math.abs(a.initial)}
                      onChange={(v) => setS({ ...s, accounts: s.accounts.map((x, j) => (j === i ? { ...x, initial: a.initial < 0 ? -v : v } : x)) })}
                      ariaLabel={`Saldo inicial de ${a.name}`}
                    />
                  </label>
                  <button
                    type="button"
                    className={'fz-chip ' + (a.initial < 0 ? 'bad' : 'muted')}
                    title="Saldo inicial en contra (p. ej. una tarjeta de crédito)"
                    onClick={() => setS({ ...s, accounts: s.accounts.map((x, j) => (j === i ? { ...x, initial: -x.initial } : x)) })}
                  >
                    {a.initial < 0 ? 'En contra' : 'A favor'}
                  </button>
                  <span className="fz-acc-balance">
                    <small>Debería haber</small>
                    <b className={(b?.balance ?? 0) < 0 ? 'out' : ''}>{money(b?.balance ?? a.initial)}</b>
                  </span>
                  <button type="button" className="fz-btn ghost sm" disabled={dirty} title={dirty ? 'Guarda primero los cambios' : undefined} onClick={() => setReconcile(a.name)}>
                    <Scale size={13} /> Cuadrar
                  </button>
                  <button type="button" className="fz-icon" aria-label={`Quitar ${a.name}`} onClick={() => setS({ ...s, accounts: s.accounts.filter((_, j) => j !== i) })}>
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <button type="button" className="fz-btn soft" onClick={() => setS({ ...s, accounts: defaultAccounts })}>
            Empezar con Efectivo, Nequi, Débito y Crédito
          </button>
        )}
        <div className="fz-add">
          <input className="fz-input" value={newAccount} maxLength={40} placeholder="Otra cuenta (Daviplata, Bancolombia, bolsillo…)" onChange={(e) => setNewAccount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAccount()} />
          <button type="button" className="fz-btn ghost sm" onClick={addAccount}>
            <Plus size={14} /> Agregar
          </button>
        </div>
      </section>

      <section className={'fz-block fz-fold' + (budgetOpen ? ' open' : '')}>
        <header className="fz-block-head">
          <button type="button" className="fz-fold-toggle" aria-expanded={budgetOpen} onClick={() => toggleBudget(!budgetOpen)}>
            <h3>
              <PiggyBank size={16} /> Presupuesto del mes
            </h3>
            <ChevronDown size={17} className="fz-fold-chev" />
          </button>
          {budgetOpen ? (
            <small>
              Es tu presupuesto general: aplica a todos los meses. Para un mes puntual, defínelo en su Carta del mes. Te avisa al 80 % y al 100 %.
            </small>
          ) : (
            <button type="button" className="fz-fold-sum" onClick={() => toggleBudget(true)}>
              {s.monthBudget ? (
                <>
                  <b>{money(s.monthBudget)}</b> al mes
                </>
              ) : (
                <span>Sin total definido</span>
              )}
              {budgetCats > 0 && (
                <em>
                  · {budgetCats} {budgetCats === 1 ? 'categoría' : 'categorías'} con tope ({money(budgetSum)})
                </em>
              )}
              {thisMonthOwn ? <em className="fz-chip">Este mes: {money(thisMonthOwn)} (carta)</em> : null}
            </button>
          )}
        </header>
        {budgetOpen && (
          <div className="fz-fold-body">
            <div className="fz-form">
              <Field label="Total del mes" hint={budgetSum ? `Por categoría suman ${money(budgetSum)}` : 'Opcional'}>
                <MoneyField value={s.monthBudget} onChange={(v) => setS({ ...s, monthBudget: v })} />
              </Field>
            </div>
            <ul className="fz-budget-edit">
              {outCats.map((c) => (
                <li key={c}>
                  <span>
                    <i style={{ background: catColor(c) }} />
                    {c}
                  </span>
                  <MoneyField
                    value={s.budgets[c] ?? 0}
                    onChange={(v) => {
                      const budgets = { ...s.budgets };
                      if (v) budgets[c] = v;
                      else delete budgets[c];
                      setS({ ...s, budgets });
                    }}
                    placeholder="Sin tope"
                    ariaLabel={`Presupuesto de ${c}`}
                  />
                  <small>{lastSpend.get(c) ? `El mes pasado: ${money(lastSpend.get(c)!)}` : ''}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="fz-block">
        <header className="fz-block-head">
          <h3>
            <Tags size={16} /> Categorías propias
          </h3>
        </header>
        {(['out', 'in'] as const).map((k) => (
          <div key={k} className="fz-cat-edit">
            <span>{k === 'out' ? 'De gasto' : 'De ingreso'}</span>
            <div className="fz-chips">
              {(k === 'out' ? s.extraOut : s.extraIn).map((c) => (
                <span key={c} className="fz-tag">
                  {c}
                  <button
                    type="button"
                    aria-label={`Quitar ${c}`}
                    onClick={() => setS({ ...s, [k === 'out' ? 'extraOut' : 'extraIn']: (k === 'out' ? s.extraOut : s.extraIn).filter((x) => x !== c) })}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                className="fz-input sm"
                value={newCat[k]}
                maxLength={30}
                placeholder={k === 'out' ? 'Mascotas, Belleza…' : 'Arriendos, Clases…'}
                onChange={(e) => setNewCat({ ...newCat, [k]: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addCat(k)}
              />
              <button type="button" className="fz-btn ghost sm" onClick={() => addCat(k)}>
                <Plus size={13} />
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="fz-block">
        <header className="fz-block-head">
          <h3>
            <Database size={16} /> Tus datos
          </h3>
        </header>
        <div className="fz-data-actions">
          <button type="button" className="fz-btn ghost" onClick={() => setImporting(true)}>
            <Upload size={15} /> Importar extracto (CSV)
          </button>
          <button type="button" className="fz-btn ghost" onClick={exportAll} disabled={!moves.length}>
            <Download size={15} /> Movimientos en CSV (Excel)
          </button>
          <button type="button" className="fz-btn ghost" onClick={backup} disabled={!fin.items?.length}>
            <Download size={15} /> Respaldo de deudas, inversiones y cartas (JSON)
          </button>
        </div>
      </section>

      {dirty && (
        <div className="fz-savebar">
          <span>Tienes cambios sin guardar.</span>
          <button type="button" className="fz-btn ghost sm" onClick={() => setS(initial)}>
            Descartar
          </button>
          <button type="button" className="fz-btn primary sm" onClick={() => void save()}>
            Guardar cambios
          </button>
        </div>
      )}

      {reconcile && <ReconcileSheet account={reconcile} settings={s} expected={balances.find((b) => b.name === reconcile)?.balance ?? 0} onClose={() => setReconcile(null)} />}
      {importing && <ImportSheet onClose={() => setImporting(false)} />}
    </div>
  );
}

/** Cuadrar una cuenta: el saldo real contra el que Nexo calcula. */
function ReconcileSheet({ account, settings, expected, onClose }: { account: string; settings: Settings; expected: number; onClose: () => void }) {
  const { notify, createEntry } = useApp();
  const [real, setReal] = useState(Math.max(0, expected));
  const [negative, setNegative] = useState(expected < 0);
  const [how, setHow] = useState<'mov' | 'ajuste'>('mov');
  const actual = negative ? -real : real;
  const diff = actual - expected;

  const save = async () => {
    if (!diff) return onClose();
    if (how === 'ajuste') {
      const r = await saveSettings({ accounts: settings.accounts.map((a) => (a.name === account ? { ...a, initial: a.initial + diff } : a)) });
      if (r !== true) return notify(r);
    } else {
      const e = await createEntry(
        moneyInput({
          title: diff < 0 ? `Gastos sin anotar (${account})` : `Ingreso sin anotar (${account})`,
          amount: Math.abs(diff),
          direction: diff < 0 ? 'egreso' : 'ingreso',
          tags: ['Otro'],
          details: { flow: diff < 0 ? 'gasto' : 'ingreso', method: account },
        }),
        true,
      );
      if (!e) return;
    }
    notify(`${account} cuadrada en ${money(actual)}.`);
    onClose();
  };

  return (
    <FinSheet
      title={`Cuadrar ${account}`}
      sub={`Nexo calcula ${money(expected)}. ¿Cuánto hay de verdad?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" onClick={() => void save()}>
            {diff ? 'Cuadrar' : 'Ya cuadra'}
          </button>
        </>
      }
    >
      <div className="fz-form">
        <Field label="Saldo real">
          <MoneyField value={real} onChange={setReal} autoFocus />
        </Field>
        <Field label="Signo">
          <select className="fz-input" value={negative ? 'neg' : 'pos'} onChange={(e) => setNegative(e.target.value === 'neg')}>
            <option value="pos">A favor</option>
            <option value="neg">En contra (debes)</option>
          </select>
        </Field>
      </div>
      {diff !== 0 && (
        <>
          <p className={'fz-result ' + (diff < 0 ? 'down' : 'up')}>
            Diferencia: <b>{diff < 0 ? '−' : '+'}{money(Math.abs(diff))}</b>
          </p>
          <Segmented
            label="Cómo cuadrar"
            value={how}
            onChange={setHow}
            options={[
              { value: 'mov', label: diff < 0 ? 'Fue un gasto sin anotar' : 'Fue un ingreso sin anotar' },
              { value: 'ajuste', label: 'Solo ajustar el saldo' },
            ]}
          />
        </>
      )}
    </FinSheet>
  );
}
