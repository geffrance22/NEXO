import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, PiggyBank, Plus, Target, TrendingUp, X } from 'lucide-react';
import { useApp } from '../../AppContext';
import type { AllotDraft, SpendDraft } from '../../data';
import { CategoryPanel } from '../../finance/CategoryPicker';
import { CatIcon } from '../../finance/catIcons';
import { goalSaved, invStats, itemsOf, pocketStats } from '../../finance/model';
import { incomeUse, isMoney, moneyShort } from '../../finance/money';
import { evalAmount, parseQuickLine } from '../../finance/parse';
import { useFinance } from '../../finance/store';
import { money, thousands } from '../../lib/format';
import { Label } from '../controls';
import { allotAmount, allotTotal } from '../logic';
import type { ComposerApi } from '../useComposer';
import '../../finance/income-extras.css';

const MAX_AMOUNT = 999_999_999_999;
const presets = [10, 20, 50];
const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Dest = { to: AllotDraft['to']; id: string; label: string; emoji?: string; sub: string };
const destIcon = { meta: Target, bolsillo: PiggyBank, inversion: TrendingUp };
const sameDest = (a: Pick<AllotDraft, 'to' | 'id'>, b: Pick<AllotDraft, 'to' | 'id'>) =>
  a.to === b.to && a.id === b.id;

/** Un monto pequeño y sin etiqueta («25k», «12.000+8.500»). Enter llama a `onEnter`. */
function MoneyInline({
  value,
  onChange,
  onEnter,
  placeholder = '0',
  label,
  allowPct = false,
  onPct,
}: {
  value: number;
  onChange: (n: number) => void;
  onEnter?: () => void;
  placeholder?: string;
  label: string;
  /** Acepta también «15 %» (lo pasa a `onPct`). */
  allowPct?: boolean;
  onPct?: (pct: number) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const shown = raw ?? (value ? thousands(value) : '');
  return (
    <span className="fm-inline-money">
      <b>$</b>
      <input
        inputMode="decimal"
        value={shown}
        placeholder={placeholder}
        aria-label={label}
        onFocus={() => setRaw(shown)}
        onBlur={() => setRaw(null)}
        onChange={(e) => {
          const text = e.target.value;
          setRaw(text);
          const pct = allowPct ? /^\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*$/.exec(text) : null;
          if (pct && onPct) {
            const p = Math.min(100, Number(pct[1].replace(',', '.')));
            if (p > 0) onPct(p);
            return;
          }
          const n = evalAmount(text);
          onChange(n && n > 0 ? Math.min(n, MAX_AMOUNT) : 0);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !onEnter) return;
          e.preventDefault();
          onEnter();
        }}
      />
    </span>
  );
}

/**
 * «Destinar una parte»: de un ingreso nuevo, un porcentaje o un valor fijo va a una meta, a un
 * bolsillo de ahorro o a una inversión. Al guardar se crean los ahorros anexados al ingreso.
 */
export function IncomeAllot({ c }: { c: ComposerApi }) {
  const { workspace } = useApp();
  const fin = useFinance();
  const lines = c.details.allotNew ?? [];
  const [on, setOn] = useState(lines.length > 0);
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const pocketId = c.details.pocketId;

  const dests = useMemo<Dest[]>(() => {
    const items = fin.items;
    const saving = itemsOf(items, 'bolsillo').filter((p) => !p.archived && p.data.use === 'ahorro');
    // Si el ingreso ya entra a un bolsillo, ese no se ofrece (contaría dos veces).
    const pockets: Dest[] = saving
      .filter((p) => p.id !== pocketId)
      .map((p) => ({
        to: 'bolsillo',
        id: p.id,
        label: p.title,
        emoji: p.data.emoji,
        sub: `Bolsillo · tiene ${moneyShort(pocketStats(p, moves).balance)}`,
      }));
    const goals: Dest[] = itemsOf(items, 'meta')
      .filter((g) => !g.archived)
      .map((g) => {
        const left = g.data.target - goalSaved(g, moves);
        return {
          to: 'meta',
          id: g.id,
          label: g.title,
          sub: left > 0 ? `Meta · faltan ${moneyShort(left)}` : 'Meta · ya la lograste',
        };
      });
    const invs: Dest[] = itemsOf(items, 'inversion')
      .filter((i) => !i.archived && !i.data.closedOn)
      .map((i) => ({
        to: 'inversion',
        id: i.id,
        label: i.title,
        sub: `Inversión · vale ${moneyShort(invStats(i.data).value)}`,
      }));
    const fresh: Dest[] =
      saving.length || fin.upgrade
        ? []
        : [
            {
              to: 'bolsillo',
              id: 'new',
              label: 'Ahorro',
              emoji: '🐷',
              sub: 'Se crea el bolsillo «Ahorro»',
            },
          ];
    return [...fresh, ...pockets, ...goals, ...invs];
  }, [fin.items, fin.upgrade, moves, pocketId]);

  const set = (next: AllotDraft[]) => c.setDetail('allotNew', next.length ? next : undefined);
  const toggle = (on: boolean) => {
    setOn(on);
    if (!on) set([]);
    // Con un solo destino posible, ya queda elegido (10 %).
    else if (!lines.length && dests.length === 1)
      set([{ to: dests[0].to, id: dests[0].id, pct: 10 }]);
  };
  const pick = (d: Dest) =>
    set(
      lines.some((l) => sameDest(l, d))
        ? lines.filter((l) => !sameDest(l, d))
        : [...lines, { to: d.to, id: d.id, pct: 10 }],
    );
  const patch = (l: AllotDraft, p: Partial<AllotDraft>) =>
    set(lines.map((x) => (sameDest(x, l) ? { to: x.to, id: x.id, ...p } : x)));

  const income = c.amount;
  const total = allotTotal(lines, income);
  const over = total > income;

  return (
    <>
      <label className={'fm-toggle' + (on ? ' on' : '')}>
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
        <span className="fm-switch" aria-hidden="true" />
        <span>
          <b>
            <PiggyBank size={13} /> Destinar una parte
          </b>
          <small className={over ? 'fm-allot-over' : undefined}>
            {!on
              ? 'Guarda un porcentaje en una meta, un bolsillo de ahorro o una inversión: se descuenta de este ingreso.'
              : !lines.length
                ? 'Elige a dónde va y cuánto.'
                : !(income > 0)
                  ? 'Escribe el monto del ingreso para calcular las partes.'
                  : over
                    ? `Supera el ingreso por ${money(total - income)}.`
                    : `Guardas ${money(total)} (${pctOf(total, income)} %) · te quedan ${money(income - total)} de este ingreso.`}
          </small>
        </span>
      </label>

      {on && (
        <div className="fm-charge fm-allot">
          {dests.length ? (
            <div className="fm-allot-dests" role="group" aria-label="¿A dónde va?">
              {dests.map((d) => {
                const chosen = lines.some((l) => sameDest(l, d));
                const Icon = destIcon[d.to];
                return (
                  <button
                    type="button"
                    key={d.to + d.id}
                    aria-pressed={chosen}
                    className={'fm-allot-dest ' + d.to + (chosen ? ' on' : '')}
                    title={d.sub}
                    onClick={() => pick(d)}
                  >
                    {d.emoji ? (
                      <span className="fm-allot-emoji">{d.emoji}</span>
                    ) : (
                      <Icon size={13} />
                    )}
                    {d.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="fm-charge-note">
              Aún no tienes metas, bolsillos de ahorro ni inversiones activas. Créalos en Finanzas y
              aparecerán aquí.
            </p>
          )}

          {lines.length > 0 && (
            <ul className="fm-allot-lines">
              {lines.map((l) => {
                const d = dests.find((x) => sameDest(x, l));
                const amount = allotAmount(l, income);
                const custom = !l.pct || !presets.includes(l.pct);
                const Icon = destIcon[l.to];
                return (
                  <li key={l.to + l.id}>
                    <span className="fm-allot-name">
                      <span className={'fm-allot-ico ' + l.to} aria-hidden="true">
                        {d?.emoji || <Icon size={13} />}
                      </span>
                      <span>
                        <b>{d?.label ?? 'Ya no está disponible'}</b>
                        <small>{d?.sub}</small>
                      </span>
                    </span>
                    <span className="fm-allot-how">
                      <span
                        className="fm-mini-seg"
                        role="radiogroup"
                        aria-label={`Cuánto a ${d?.label ?? ''}`}
                      >
                        {presets.map((p) => (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={l.pct === p}
                            key={p}
                            className={l.pct === p ? 'on' : ''}
                            onClick={() => patch(l, { pct: p })}
                          >
                            {p} %
                          </button>
                        ))}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={custom}
                          className={custom ? 'on' : ''}
                          onClick={() => !custom && patch(l, { amount: amount || undefined })}
                        >
                          Otro
                        </button>
                      </span>
                      {custom && (
                        <MoneyInline
                          label={`Valor para ${d?.label ?? ''}`}
                          placeholder="o 15 %"
                          value={l.pct ? 0 : (l.amount ?? 0)}
                          onChange={(n) => patch(l, { amount: n || undefined })}
                          allowPct
                          onPct={(pct) => patch(l, { pct })}
                        />
                      )}
                    </span>
                    <b className="fm-allot-amt">
                      {income > 0 ? money(amount) : l.pct ? `${l.pct} %` : '—'}
                      {custom && l.pct && income > 0 ? <small>{l.pct} %</small> : null}
                    </b>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Los gastos que ya hiciste con este ingreso, escritos ahí mismo: «almuerzo 25k» y Enter. Al
 * guardar, cada uno queda como un gasto anexado al ingreso, con su fecha y su cuenta.
 */
export function IncomeSpends({ c, options }: { c: ComposerApi; options: string[] }) {
  const { workspace } = useApp();
  const list = c.details.spendsNew ?? [];
  const [text, setText] = useState('');
  const [amount, setAmount] = useState(0);
  const [boxKey, setBoxKey] = useState(0);
  const [pick, setPick] = useState<{ key: string; el: HTMLElement } | null>(null);
  const textRef = useRef<HTMLInputElement>(null);

  const guess = useMemo(
    () => (text.trim() ? parseQuickLine(text, { entries: workspace.entries }) : {}),
    [text, workspace.entries],
  );
  const guessCat = guess.category && options.includes(guess.category) ? guess.category : undefined;
  const value = amount || guess.amount || 0;

  const set = (next: SpendDraft[]) => c.setDetail('spendsNew', next.length ? next : undefined);
  const patch = (key: string, p: Partial<SpendDraft>) =>
    set(list.map((s) => (s.key === key ? { ...s, ...p } : s)));
  const add = () => {
    if (!(value > 0)) return;
    const title = (guess.amount ? (guess.title ?? '') : text).trim().slice(0, 180);
    set([...list, { key: crypto.randomUUID(), title, amount: value, category: guessCat }]);
    setText('');
    setAmount(0);
    setBoxKey((k) => k + 1);
    textRef.current?.focus();
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    add();
  };

  const sum = list.reduce((s, x) => s + x.amount, 0);
  const already = c.entry ? incomeUse(c.entry, workspace.entries) : null;
  const left = c.amount - allotTotal(c.details.allotNew, c.amount) - (already?.used ?? 0) - sum;
  const picked = pick ? list.find((s) => s.key === pick.key) : undefined;

  return (
    <div className="fm-field fm-spends">
      <Label hint="Opcional">Gastos que ya hiciste con este ingreso</Label>
      {list.length > 0 && (
        <ul className="fm-spend-list">
          {list.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className={'fm-spend-cat' + (s.category ? '' : ' empty')}
                title={s.category ? `${s.category} · cambiar` : 'Elegir categoría'}
                aria-label={s.category ? `Categoría: ${s.category}` : 'Elegir categoría'}
                onClick={(e) => setPick({ key: s.key, el: e.currentTarget })}
              >
                <CatIcon name={s.category ?? 'Otro'} size={13} plain />
              </button>
              <input
                className="fm-spend-title"
                value={s.title}
                maxLength={180}
                placeholder={s.category ?? 'Gasto'}
                aria-label="Concepto del gasto"
                onChange={(e) => patch(s.key, { title: e.target.value })}
              />
              <MoneyInline
                label="Monto del gasto"
                value={s.amount}
                onChange={(n) => n > 0 && patch(s.key, { amount: n })}
              />
              <button
                type="button"
                className="fm-spend-x"
                aria-label="Quitar gasto"
                title="Quitar"
                onClick={() => set(list.filter((x) => x.key !== s.key))}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="fm-spend-add">
        <span className="fm-spend-guess" aria-hidden="true" title={guessCat}>
          {guessCat ? <CatIcon name={guessCat} size={13} plain /> : <Plus size={14} />}
        </span>
        <input
          ref={textRef}
          className="fm-spend-text"
          value={text}
          maxLength={200}
          placeholder={list.length ? 'Otro gasto…' : 'Almuerzo 25k, taxi 12.000…'}
          aria-label="Nuevo gasto"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onEnter}
        />
        <MoneyInline
          key={boxKey}
          label="Monto del nuevo gasto"
          value={amount}
          placeholder={guess.amount ? thousands(guess.amount) : '0'}
          onChange={setAmount}
          onEnter={add}
        />
        <button
          type="button"
          className="fm-spend-btn"
          disabled={!(value > 0)}
          aria-label="Añadir gasto"
          title="Añadir (Enter)"
          onClick={add}
        >
          <CornerDownLeft size={13} />
        </button>
      </div>

      <small className={'fm-spend-foot' + (left < 0 && c.amount > 0 ? ' over' : '')}>
        {list.length
          ? `${plural(list.length, 'gasto', 'gastos')} · ${money(sum)}` +
            (c.amount > 0
              ? left >= 0
                ? ` · quedan ${money(left)} de este ingreso`
                : ` · pasan el ingreso por ${money(-left)}`
              : '')
          : 'Se guardan como gastos anexados a este ingreso, con su fecha y su cuenta.'}
        {already && already.spends.length > 0 && (
          <>
            {' '}
            Ya tenía {plural(already.spends.length, 'anexado', 'anexados')} ({money(already.used)}).
          </>
        )}
      </small>

      {pick && (
        <CategoryPanel
          compact
          anchor={pick.el}
          title="Categoría"
          context={picked ? `${picked.title || 'Gasto'} · −${money(picked.amount)}` : undefined}
          options={options}
          value={picked?.category ? [picked.category] : []}
          multiple={false}
          createIn="out"
          onChange={(l) => patch(pick.key, { category: l[0] })}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}
