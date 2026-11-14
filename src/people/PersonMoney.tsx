import { useMemo, useState, type CSSProperties } from 'react';
import { ArrowRight, Banknote, Plus } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Person } from '../data';
import { money, shortDate } from '../lib/format';
import { moneyRoleList, moneyRoles, moneyWith, type PersonMoney } from '../lib/personMoney';
import { categoryOf } from '../finance/money';
import { debtBalances, itemsOf } from '../finance/model';
import { PersonMoneyIcon } from '../finance/PeopleMoney';
import { useFinance } from '../finance/store';
import { openFinanceTab } from '../finance/ui';
import '../finance/people-money.css';

/** El dinero con una persona y lo que te debe o le debes (de Cobros y deudas). */
function usePersonMoney(person: Person) {
  const { workspace } = useApp();
  const fin = useFinance();
  const m = useMemo(() => moneyWith(person, workspace.entries), [person, workspace.entries]);
  const debt =
    debtBalances(itemsOf(fin.items, 'deuda')).find((r) => r.personId === person.id)?.net ?? 0;
  return { m, debt };
}

/** Le pagaste · Te pagó · Gastaron juntos: solo los que tienen algo. */
function Sides({ m }: { m: PersonMoney }) {
  return (
    <div className="pmo-sides">
      {moneyRoleList
        .filter((r) => m[r].n > 0)
        .map((r) => {
          const meta = moneyRoles[r];
          return (
            <div
              key={r}
              className="pmo-side"
              style={{ '--c': meta.color, '--s': meta.soft } as CSSProperties}
              title={`${m[r].n} ${m[r].n === 1 ? 'movimiento' : 'movimientos'}`}
            >
              <span>{meta.label}</span>
              <b>{money(m[r].total)}</b>
              <small>{meta.hint}</small>
            </div>
          );
        })}
    </div>
  );
}

function Debt({ person, debt }: { person: Person; debt: number }) {
  const { go } = useApp();
  if (!debt) return null;
  const first = person.name.split(' ')[0];
  return (
    <button
      type="button"
      className={'pmo-debt ' + (debt > 0 ? 'in' : 'out')}
      onClick={() => openFinanceTab(go, 'deudas')}
    >
      {debt > 0 ? `${first} te debe ${money(debt)}` : `Le debes ${money(-debt)} a ${first}`}
      <ArrowRight size={13} />
    </button>
  );
}

/** En Resumen: lo esencial del dinero con esta persona (nada si no hay). */
export function MoneySummary({ person, onDetail }: { person: Person; onDetail?: () => void }) {
  const { openPeopleMoney } = useApp();
  const { m, debt } = usePersonMoney(person);
  if (!m.lines.length && !debt) return null;
  return (
    <section className="pmo">
      <div className="pmo-head">
        <h4>
          <Banknote size={15} /> Dinero
        </h4>
        {onDetail && m.lines.length > 0 && (
          <button type="button" className="pp-text-btn" onClick={onDetail}>
            Ver detalle <ArrowRight size={13} />
          </button>
        )}
        <button
          type="button"
          className="pmo-open"
          title="Dinero con personas"
          aria-label="Ver en Dinero con personas"
          onClick={() => openPeopleMoney(person)}
        >
          <PersonMoneyIcon size={16} />
        </button>
      </div>
      {m.lines.length > 0 && <Sides m={m} />}
      <Debt person={person} debt={debt} />
    </section>
  );
}

/** En Juntos: el detalle, con en qué se le pagó y cada movimiento. */
export function MoneyDetail({ person }: { person: Person }) {
  const { openEntry, openPeopleMoney, viewEntry } = useApp();
  const { m, debt } = usePersonMoney(person);
  const [all, setAll] = useState(false);
  if (!m.lines.length && !debt) return null;
  const lines = all ? m.lines : m.lines.slice(0, 6);
  return (
    <section className="pmo" id="pmo-detail">
      <div className="pmo-head">
        <h4>
          <Banknote size={15} /> Dinero
        </h4>
        <button
          type="button"
          className="pp-text-btn"
          onClick={() => openEntry('Movimiento', [person.id])}
        >
          <Plus size={13} /> Movimiento
        </button>
        <button
          type="button"
          className="pmo-open"
          title="Dinero con personas"
          aria-label="Ver en Dinero con personas"
          onClick={() => openPeopleMoney(person)}
        >
          <PersonMoneyIcon size={16} />
        </button>
      </div>
      {m.lines.length > 0 && <Sides m={m} />}
      {m.categories.length > 0 && (
        <div className="pmo-cats" aria-label="En qué le pagaste">
          {m.categories.slice(0, 5).map((c) => (
            <span key={c.name}>
              {c.name}
              <b>{money(c.total)}</b>
            </span>
          ))}
        </div>
      )}
      <Debt person={person} debt={debt} />
      {lines.length > 0 && (
        <ol className="pmo-lines">
          {lines.map(({ entry: e, role, amount }) => {
            const meta = moneyRoles[role];
            return (
              <li key={e.id} style={{ '--c': meta.color } as CSSProperties}>
                <button type="button" onClick={() => viewEntry(e)}>
                  <i className="pmo-dot" aria-hidden="true" />
                  <span>
                    <strong>{e.title}</strong>
                    <small>
                      {meta.label} · {categoryOf(e)} · {shortDate(e.created_at)}
                    </small>
                  </span>
                  <b>
                    {role === 'cobro' ? '+' : '−'}
                    {money(amount)}
                  </b>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {m.lines.length > 6 && (
        <button type="button" className="pp-text-btn" onClick={() => setAll((v) => !v)}>
          {all ? 'Ver menos' : `Ver los ${m.lines.length} movimientos`}
        </button>
      )}
    </section>
  );
}
