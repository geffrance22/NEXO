import { ArrowDownLeft, ArrowUpRight, Pencil, Receipt, Trash2 } from 'lucide-react';
import { useApp } from '../AppContext';
import { money, shortDate } from '../lib/format';

export function FinancePage() {
  const { workspace, openEntry, openImages, editEntry, removeEntry } = useApp();
  const movements = workspace.entries.filter((e) => e.kind === 'Movimiento');
  const sum = (direction: string) =>
    movements.filter((e) => e.direction === direction).reduce((a, e) => a + e.amount, 0);
  const income = sum('ingreso');
  const expense = sum('egreso');

  return (
    <>
      <div className="finance-summary">
        {(
          [
            ['Ingresos', income],
            ['Egresos', expense],
            ['Balance', income - expense],
          ] as const
        ).map(([label, value]) => (
          <div className="panel" key={label}>
            <span>{label} · todos los registros</span>
            <h2>{money(value)}</h2>
            <small>COP · calculado desde tus movimientos</small>
          </div>
        ))}
      </div>
      <div className="section-title">
        <h2>Movimientos</h2>
        <button className="text-button" onClick={() => openEntry('Movimiento')}>
          + Registrar
        </button>
      </div>
      <div className="transactions">
        {movements.map((e) => (
          <div key={e.id}>
            <span className={'transaction-icon ' + e.direction}>
              {e.direction === 'ingreso' ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}
            </span>
            <div>
              <strong>{e.title}</strong>
              <small>
                {shortDate(e.created_at)} · {e.tags.join(', ') || 'Sin categoría'}
              </small>
            </div>
            <b className={e.direction === 'ingreso' ? 'positive' : ''}>
              {e.direction === 'ingreso' ? '+' : '−'}
              {money(e.amount)}
            </b>
            {e.images.length > 0 && (
              <button
                className="icon-button"
                aria-label="Ver comprobante"
                title="Ver comprobante"
                onClick={() => openImages(e.images, 0)}
              >
                <Receipt size={15} />
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Editar movimiento"
              onClick={() => editEntry(e)}
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-button"
              aria-label="Eliminar movimiento"
              onClick={() => removeEntry(e)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {!movements.length && <p className="empty">Registra tu primer ingreso o egreso.</p>}
      </div>
    </>
  );
}
