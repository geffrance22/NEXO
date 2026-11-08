import { Receipt } from 'lucide-react';
import { ChoiceChips, Label, Segmented } from '../controls';
import { DateChips } from '../DateChips';
import { expenseCategories, incomeCategories } from '../logic';
import { CoverDrop } from '../PhotoBlocks';
import { thousands } from '../../lib/format';
import type { ViewProps } from './shared';

const quick = [5000, 10000, 20000, 50000, 100000];
const methods = ['Efectivo', 'Tarjeta', 'Transferencia'];
const MAX_AMOUNT = 999_999_999_999;

/** Movimiento: el monto es lo principal; lo demás son toques rápidos. */
export function MoneyView({ c }: ViewProps) {
  const income = c.direction === 'ingreso';
  const categories = income ? incomeCategories : expenseCategories;

  return (
    <div className="cp-money">
      <div className="cp-money-switch">
        <Segmented
          label="Tipo de movimiento"
          value={c.direction}
          onChange={(v) => {
            c.setDirection(v);
            const list = v === 'ingreso' ? incomeCategories : expenseCategories;
            if (c.category && !list.includes(c.category)) c.setCategory(undefined);
          }}
          options={[
            { value: 'egreso', label: 'Egreso' },
            { value: 'ingreso', label: 'Ingreso' },
          ]}
        />
      </div>

      <label className="cp-amount" data-enter-saves>
        <span className="cp-cur">{income ? '+' : '−'}$</span>
        <input
          inputMode="numeric"
          size={Math.max(thousands(c.amount).length, 1)}
          value={thousands(c.amount)}
          placeholder="0"
          onChange={(e) =>
            c.setAmount(Math.min(Number(e.target.value.replace(/\D/g, '')) || 0, MAX_AMOUNT))
          }
          aria-label="Monto en pesos colombianos"
          data-autofocus
        />
        <span className="cp-cop">COP</span>
      </label>

      <div className="cp-quick">
        {quick.map((n) => (
          <button
            type="button"
            key={n}
            onClick={() => c.setAmount(Math.min(c.amount + n, MAX_AMOUNT))}
          >
            +{thousands(n)}
          </button>
        ))}
        {c.amount > 0 && (
          <button type="button" className="clear" onClick={() => c.setAmount(0)}>
            Borrar
          </button>
        )}
      </div>

      <Label>Categoría</Label>
      <ChoiceChips
        label="Categoría"
        options={categories}
        clearable
        value={c.category}
        onChange={c.setCategory}
      />

      <Label hint="Opcional">¿En qué?</Label>
      <input
        className="cp-ghost-input"
        value={c.title}
        maxLength={180}
        placeholder={c.suggestedTitle}
        onChange={(e) => c.setTitle(e.target.value)}
        aria-label="Descripción"
      />

      <div className="cp-two">
        <div>
          <Label>Fecha</Label>
          <DateChips
            label="Fecha"
            options={['today', 'yesterday']}
            value={c.date}
            onChange={c.setDate}
          />
        </div>
        <div>
          <Label>Forma de pago</Label>
          <ChoiceChips
            label="Forma de pago"
            options={methods}
            clearable
            value={c.details.method}
            onChange={(v) => c.setDetail('method', v)}
          />
        </div>
      </div>

      <Label hint="Opcional">Comprobante</Label>
      <CoverDrop
        uploads={c.uploads}
        icon={Receipt}
        shape="wide"
        title="Foto del recibo"
        hint="Toca para subirla"
      />
    </div>
  );
}
