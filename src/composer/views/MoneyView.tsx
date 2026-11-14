import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  CornerDownLeft,
  Frown,
  History,
  Layers,
  Plus,
  Receipt,
  Repeat,
  ShieldCheck,
  Smile,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../AppContext';
import type { MoneyFlow } from '../../data';
import { currencies, rateToCop, type Currency } from '../../finance/fx';
import { cardMethod, chargeStats, defaultAccounts, isOpenCharge, itemsOf } from '../../finance/model';
import {
  categoryAverage,
  dayOf,
  flowMeta,
  flowOf,
  frequentTemplates,
  isMoney,
  learnedFor,
  monthKey,
  type MoneyTemplate,
} from '../../finance/money';
import { evalAmount, isExpression, parseQuickLine } from '../../finance/parse';
import { settingsOf, useFinance } from '../../finance/store';
import { addDays, friendlyDate, money, thousands, todayInputValue } from '../../lib/format';
import { paidToPeople } from '../../lib/personMoney';
import { AutoTextarea, ChoiceChips, Label, Segmented } from '../controls';
import { DateChips } from '../DateChips';
import { PeopleField, PlaceField, useLinks } from '../LinkFields';
import { expenseCategories, incomeCategories, savingCategories } from '../logic';
import { CoverDrop } from '../PhotoBlocks';
import type { ViewProps } from './shared';
import '../../finance/money-form.css';

const quick = [5000, 10000, 20000, 50000, 100000];
const MAX_AMOUNT = 999_999_999_999;
const otherFlows: MoneyFlow[] = ['ahorro', 'transferencia', 'prestamo', 'reembolso'];

/** Un monto pequeño del formulario (acepta «5k», «2 millones» o una cuenta). */
function AmountBox({
  label,
  value,
  onChange,
  placeholder = '0',
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const shown = raw ?? (value ? thousands(value) : '');
  return (
    <label className="fm-box">
      <span>{label}</span>
      <span className="fm-box-in">
        <b>$</b>
        <input
          inputMode="decimal"
          value={shown}
          placeholder={placeholder}
          aria-label={label}
          onFocus={() => setRaw(shown)}
          onBlur={() => setRaw(null)}
          onChange={(e) => {
            setRaw(e.target.value);
            const n = evalAmount(e.target.value);
            onChange(n && n > 0 ? Math.min(n, MAX_AMOUNT) : 0);
          }}
        />
      </span>
    </label>
  );
}

/** Movimiento: el monto manda; lo demás se llena solo o con un toque. */
export function MoneyView({ c }: ViewProps) {
  const { workspace } = useApp();
  const fin = useFinance();
  const settings = settingsOf(fin.items);
  const links = useLinks(c);
  const today = todayInputValue();
  const entries = workspace.entries;

  const flow: MoneyFlow = flowOf({ direction: c.direction, tags: c.tags, details: c.details });
  const income = c.direction === 'ingreso';
  const cur = (c.details.currency as Currency | undefined) ?? 'COP';
  const foreign = cur !== 'COP';

  const accountNames = useMemo(() => {
    const base = (settings.accounts.length ? settings.accounts : defaultAccounts).map((a) => a.name);
    // Tus tarjetas también son medios de pago (con el nombre con que se registran).
    const cards = itemsOf(fin.items, 'tarjeta')
      .filter((t) => !t.archived)
      .map(cardMethod)
      .filter((m) => !base.some((b) => b.toLowerCase() === m.toLowerCase()));
    const known = [...base, ...cards];
    const extra = [c.details.method, c.details.toMethod].filter(
      (m): m is string => Boolean(m) && !known.includes(m!),
    );
    return [...known, ...extra];
  }, [settings.accounts, fin.items, c.details.method, c.details.toMethod]);

  const categories = useMemo(() => {
    switch (flow) {
      case 'gasto':
        return [...expenseCategories.filter((x) => x !== 'Ahorro' && x !== 'Otro'), ...settings.extraOut, 'Otro'];
      case 'ingreso':
        return [...incomeCategories.filter((x) => x !== 'Reembolso' && x !== 'Otro'), ...settings.extraIn, 'Otro'];
      case 'ahorro':
        return savingCategories;
      default:
        return [];
    }
  }, [flow, settings.extraOut, settings.extraIn]);

  const setFlow = (f: MoneyFlow, dir = flowMeta[f].dir) => {
    c.setDetail('flow', f);
    c.setDirection(dir);
    if (f === 'reembolso') c.setCategory('Reembolso');
    else if (f === 'ahorro') c.setCategory(c.category && savingCategories.includes(c.category) ? c.category : 'Ahorro');
    else if (f === 'transferencia' || f === 'prestamo') c.setCategory(undefined);
    else if (c.category) {
      const list = f === 'ingreso' ? incomeCategories : expenseCategories;
      if (!list.includes(c.category) && ![...settings.extraOut, ...settings.extraIn].includes(c.category))
        c.setCategory(undefined);
      if (c.category === 'Ahorro' || c.category === 'Reembolso') c.setCategory(undefined);
    }
    if (f !== 'gasto' && f !== 'ingreso') c.setDetail('pending', undefined);
    if (f !== 'gasto') c.setDetail('split', undefined);
  };

  // ── Monto: acepta «50k», «20 mil» o una cuenta («12.000+8.500»).
  const shownNumber = foreign ? (c.details.original ?? 0) : c.amount;
  const [raw, setRaw] = useState<string | null>(null);
  const typed = raw ?? (shownNumber ? thousands(shownNumber) : '');
  const preview = raw !== null && isExpression(raw) ? evalAmount(raw) : null;
  const applyNumber = (n: number) => {
    const v = Math.min(Math.max(0, n), MAX_AMOUNT);
    if (foreign) {
      c.setDetail('original', v);
      c.setAmount(Math.round(v * (c.details.fx ?? 0)));
    } else c.setAmount(v);
  };
  const onAmount = (text: string) => {
    setRaw(text);
    if (!text.trim()) return applyNumber(0);
    const n = evalAmount(text);
    if (n !== null) applyNumber(n);
  };

  // ── Moneda: la tasa del día se busca sola y se puede corregir.
  const [fxBusy, setFxBusy] = useState(false);
  const setCurrency = async (next: Currency) => {
    if (next === 'COP') {
      const original = c.details.original;
      c.setDetail('currency', undefined);
      c.setDetail('original', undefined);
      c.setDetail('fx', undefined);
      if (foreign && original) c.setAmount(Math.round(original));
      return;
    }
    const original = foreign ? (c.details.original ?? 0) : c.amount;
    c.setDetail('currency', next);
    c.setDetail('original', original);
    setFxBusy(true);
    const rate = await rateToCop(next);
    setFxBusy(false);
    const fx = rate ?? c.details.fx ?? 0;
    c.setDetail('fx', fx || undefined);
    c.setAmount(Math.round(original * fx));
  };
  const setFx = (fx: number) => {
    c.setDetail('fx', fx || undefined);
    c.setAmount(Math.round((c.details.original ?? 0) * fx));
  };

  // ── Escribirlo como lo dirías.
  const [line, setLine] = useState('');
  const [filled, setFilled] = useState('');
  const applyLine = () => {
    const g = parseQuickLine(line, { entries, accounts: accountNames, today });
    const done: string[] = [];
    if (g.flow) setFlow(g.flow, g.direction);
    if (g.amount) {
      setRaw(null);
      applyNumber(g.amount);
      done.push(money(g.amount));
    }
    if (g.title) {
      c.setTitle(g.title.slice(0, 180));
      done.push(g.title);
    }
    const learned = g.title ? learnedFor(entries, g.title) : null;
    const cat = g.category ?? learned?.category;
    if (cat && (g.flow ?? 'gasto') !== 'transferencia') {
      c.setCategory(cat);
      done.push(cat);
    }
    const method = g.method ?? learned?.method;
    if (method) {
      c.setDetail('method', method);
      done.push(method);
    }
    if (g.date) {
      c.setDate(g.date);
      done.push(friendlyDate(g.date).toLowerCase());
    }
    if (g.pending && (!g.flow || g.flow === 'gasto' || g.flow === 'ingreso')) {
      c.setDetail('pending', true);
      if (g.date) c.setDetail('due', g.date);
    }
    setFilled(done.length ? done.join(' · ') : 'No encontré un monto: escríbelo abajo.');
    setLine('');
  };

  // ── Lo de siempre y repetir el último.
  const templates = useMemo(() => frequentTemplates(entries, today), [entries, today]);
  const last = useMemo(() => {
    let best: (typeof entries)[number] | null = null;
    for (const e of entries)
      if (isMoney(e) && (!best || (e.recorded_at ?? e.created_at) > (best.recorded_at ?? best.created_at))) best = e;
    return best;
  }, [entries]);
  const fillFrom = (t: Pick<MoneyTemplate, 'title' | 'amount' | 'flow' | 'direction' | 'category' | 'method'>) => {
    setFlow(t.flow, t.direction);
    setRaw(null);
    if (foreign) void setCurrency('COP');
    c.setAmount(t.amount);
    c.setTitle(t.title);
    if (t.category && t.flow !== 'transferencia' && t.flow !== 'prestamo') c.setCategory(t.category);
    if (t.method) c.setDetail('method', t.method);
  };

  // Al escribir el concepto, la categoría y el medio de la última vez (si aún no elegiste).
  const learnFromTitle = () => {
    if (c.editing) return;
    const l = learnedFor(entries, c.title);
    if (!l) return;
    if (!c.category && l.category && categories.includes(l.category)) c.setCategory(l.category);
    if (!c.details.method && l.method) c.setDetail('method', l.method);
  };

  // ── Dividir: tu parte y lo que te debe cada uno.
  const chosen = new Set([
    ...c.people.selected,
    ...(c.people.autoLink ? c.people.suggested.map((p) => p.id) : []),
  ]);
  const parts = chosen.size + 1;
  const share = Math.round(c.amount / parts);
  const split = c.details.split;
  useEffect(() => {
    if (!split) return;
    if (split.n !== parts || split.mine !== share) c.setDetail('split', { n: parts, mine: share });
  }, [split?.n, split?.mine, parts, share]);
  // Dividirlo es gastar juntos: deja de ser un pago a esa persona.
  useEffect(() => {
    if (split && c.details.paidTo) c.setDetail('paidTo', undefined);
  }, [Boolean(split)]);

  // ── ¿Se lo pagaste a esa persona? (lo que elijas manda; si no, lo deduce la categoría).
  const paidTo = paidToPeople({ details: c.details, tags: c.tags });
  const payeeNames = [...chosen].flatMap((id) => {
    const p = workspace.people.find((x) => x.id === id);
    return p ? [p.name.split(' ')[0]] : [];
  });
  const payees =
    payeeNames.length <= 1
      ? (payeeNames[0] ?? 'esa persona')
      : payeeNames.slice(0, -1).join(', ') + ' y ' + payeeNames[payeeNames.length - 1];

  // ── Metas (para el ahorro).
  const goals = itemsOf(fin.items, 'meta').filter((g) => !g.archived);

  // ── Bolsillos: el ahorro y los ingresos los llenan; un gasto puede salir de uno.
  const pockets = itemsOf(fin.items, 'bolsillo').filter((p) => !p.archived || p.id === c.details.pocketId);
  const showPockets = pockets.length > 0 && (flow === 'gasto' || flow === 'ingreso' || flow === 'ahorro' || flow === 'reembolso');
  const pickPocket = (id: string | undefined) => {
    c.setDetail('pocketId', id);
    const account = id ? pockets.find((p) => p.id === id)?.data.account : undefined;
    if (account && !c.details.method) c.setDetail('method', account);
  };
  const pocketLabel =
    flow === 'gasto'
      ? '¿Sale de un bolsillo?'
      : flow === 'ahorro'
        ? c.direction === 'egreso'
          ? '¿A qué bolsillo?'
          : '¿De qué bolsillo?'
        : '¿Entra a un bolsillo?';

  // ── Abono de un total mayor (cobro por partes).
  const charges = itemsOf(fin.items, 'cobro').filter((x) => isOpenCharge(x) || x.id === c.details.chargeId);
  const linked = c.details.chargeId ? charges.find((x) => x.id === c.details.chargeId) : undefined;
  const linkedStats = linked ? chargeStats(linked, entries.filter((e) => e.id !== c.entry?.id)) : null;
  const draft = c.details.chargeNew;
  const [abono, setAbono] = useState(Boolean(c.details.chargeId || draft));
  const abonoOn = flow === 'ingreso' && abono;
  const toggleAbono = (on: boolean) => {
    setAbono(on);
    if (!on) {
      c.setDetail('chargeId', undefined);
      c.setDetail('chargeNew', undefined);
    } else if (!charges.length) c.setDetail('chargeNew', { total: 0 });
  };
  const chooseCharge = (id: string | undefined) => {
    if (id === 'new' || !id) {
      c.setDetail('chargeId', undefined);
      c.setDetail('chargeNew', id ? { total: 0 } : undefined);
      return;
    }
    c.setDetail('chargeNew', undefined);
    c.setDetail('chargeId', id);
    const ch = charges.find((x) => x.id === id);
    if (ch?.data.episodeId && !c.episodeId) c.setEpisodeId(ch.data.episodeId);
    if (ch?.data.category && !c.category) c.setCategory(ch.data.category);
    if (ch?.data.method && !c.details.method) c.setDetail('method', ch.data.method);
  };
  const setDraft = (patch: Partial<NonNullable<typeof draft>>) =>
    c.setDetail('chargeNew', { total: 0, ...draft, ...patch });
  const draftLeft = draft ? Math.max(0, draft.total - c.amount) : 0;

  // ── Más detalles: abierto si ya hay algo ahí.
  const hasMore = Boolean(
    c.details.repeat || c.details.asset || c.details.worth || c.details.deductible || c.body || c.uploads.items.length,
  );
  const [more, setMore] = useState(hasMore);

  // ── Avisos útiles.
  const notes = useMemo(() => {
    const out: { text: string; action?: { label: string; run: () => void } }[] = [];
    if (!(c.amount > 0)) return out;
    const dup = entries.find(
      (e) =>
        isMoney(e) &&
        e.id !== c.entry?.id &&
        dayOf(e) === c.date &&
        e.amount === c.amount &&
        e.direction === c.direction,
    );
    if (dup)
      out.push({
        text: `Ya registraste ${money(dup.amount)} ${friendlyDate(c.date).toLowerCase()}${dup.title ? ` («${dup.title}»)` : ''}.`,
      });
    if (c.date > today && !c.details.pending && (flow === 'gasto' || flow === 'ingreso'))
      out.push({
        text: 'Esa fecha es futura: ¿es un pago programado?',
        action: {
          label: income ? 'Marcar por cobrar' : 'Marcar por pagar',
          run: () => {
            c.setDetail('pending', true);
            c.setDetail('due', c.date);
          },
        },
      });
    if (flow === 'gasto' && c.category) {
      const avg = categoryAverage(entries, c.category, c.entry?.id);
      if (avg && c.amount > avg * 4)
        out.push({
          text: `Es ${Math.round(c.amount / avg)} veces lo que sueles gastar en ${c.category} (${money(Math.round(avg))}).`,
        });
      const budget = settings.budgets[c.category];
      if (budget) {
        const month = monthKey(c.date);
        const used = entries
          .filter(
            (e) =>
              isMoney(e) &&
              e.id !== c.entry?.id &&
              !e.details.pending &&
              flowOf(e) === 'gasto' &&
              e.tags[0] === c.category &&
              monthKey(dayOf(e)) === month,
          )
          .reduce((s, e) => s + e.amount, 0);
        if (used + c.amount > budget)
          out.push({
            text: `Con esto pasas tu presupuesto de ${c.category}: ${money(used + c.amount)} de ${money(budget)}.`,
          });
        else if (used + c.amount > budget * 0.8)
          out.push({ text: `Llevarías el ${Math.round(((used + c.amount) / budget) * 100)} % del presupuesto de ${c.category}.` });
      }
    }
    return out;
  }, [entries, c.amount, c.date, c.direction, c.category, c.details.pending, c.entry?.id, flow, settings.budgets, income, today]);

  const pendingLabel = income ? 'Por cobrar' : 'Por pagar';
  const showStatus = flow === 'gasto' || flow === 'ingreso';
  const pending = c.details.pending === true;

  return (
    <div className="fm">
      {!c.editing && (
        <div className="fm-line">
          <label className="fm-line-input">
            <Sparkles size={16} />
            <input
              value={line}
              maxLength={200}
              placeholder="Escríbelo como lo dirías: «almuerzo con Laura 38 mil nequi»"
              aria-label="Escribir el movimiento en una línea"
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && line.trim()) {
                  e.preventDefault();
                  applyLine();
                }
              }}
            />
            {line.trim() && (
              <button type="button" onClick={applyLine} aria-label="Llenar el formulario">
                <CornerDownLeft size={14} /> Llenar
              </button>
            )}
          </label>
          {filled && <p className="fm-filled">{filled}</p>}
        </div>
      )}

      <div className={'fm-type' + (flow === 'gasto' || flow === 'ingreso' ? '' : ' other')}>
        <Segmented
          label="Tipo de movimiento"
          value={flow === 'gasto' || flow === 'ingreso' ? flow : undefined}
          onChange={(v) => setFlow(v)}
          options={[
            { value: 'gasto', label: 'Gasto' },
            { value: 'ingreso', label: 'Ingreso' },
          ]}
        />
        <div className="fm-flows" role="radiogroup" aria-label="Otros tipos">
          {otherFlows.map((f) => (
            <button
              type="button"
              role="radio"
              aria-checked={flow === f}
              key={f}
              className={flow === f ? 'on' : ''}
              title={flowMeta[f].hint}
              onClick={() => setFlow(flow === f ? 'gasto' : f)}
            >
              {flowMeta[f].label}
            </button>
          ))}
        </div>
      </div>

      <label className="fm-amount" data-enter-saves>
        <span className="fm-sign">
          {income ? '+' : '−'}
          {cur === 'EUR' ? '€' : cur === 'USD' ? 'US$' : '$'}
        </span>
        <input
          inputMode="decimal"
          size={Math.max(typed.length, 1)}
          value={typed}
          placeholder="0"
          onFocus={() => setRaw(typed)}
          onBlur={() => setRaw(null)}
          onChange={(e) => onAmount(e.target.value)}
          aria-label="Monto"
          data-autofocus
        />
        <select
          className="fm-cur"
          value={cur}
          aria-label="Moneda"
          onChange={(e) => void setCurrency(e.target.value as Currency)}
        >
          {currencies.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      {preview !== null && <p className="fm-calc">= {money(preview)}</p>}
      {foreign && (
        <p className="fm-fx">
          ≈ <b>{money(c.amount)}</b> · 1 {cur} ={' '}
          <input
            inputMode="decimal"
            aria-label="Tasa en pesos"
            value={c.details.fx ? thousands(c.details.fx) : ''}
            placeholder={fxBusy ? 'buscando…' : 'tasa'}
            onChange={(e) => setFx(evalAmount(e.target.value) ?? 0)}
          />{' '}
          COP {cur === 'USD' && <small>TRM del día</small>}
        </p>
      )}

      <div className="fm-quick">
        {quick.map((n) => (
          <button
            type="button"
            key={n}
            onClick={() => {
              setRaw(null);
              applyNumber(shownNumber + (foreign ? n / 1000 : n));
            }}
          >
            +{foreign ? n / 1000 : thousands(n)}
          </button>
        ))}
        {c.amount > 0 && (
          <button
            type="button"
            className="clear"
            onClick={() => {
              setRaw(null);
              applyNumber(0);
            }}
          >
            Borrar
          </button>
        )}
      </div>

      {!c.editing && (templates.length > 0 || last) && (
        <div className="fm-templates" aria-label="Lo de siempre">
          {templates.map((t) => (
            <button type="button" key={t.key} onClick={() => fillFrom(t)} title={`${t.n} veces`}>
              <span>{t.title}</span>
              <b>{money(t.amount)}</b>
            </button>
          ))}
          {last && (
            <button
              type="button"
              className="again"
              onClick={() =>
                fillFrom({
                  title: last.title,
                  amount: last.amount,
                  flow: flowOf(last),
                  direction: last.direction,
                  category: last.tags[0],
                  method: last.details.method,
                })
              }
            >
              <History size={13} /> Repetir el último
            </button>
          )}
        </div>
      )}

      <Label hint="Opcional">{flow === 'prestamo' ? '¿Para qué?' : '¿En qué?'}</Label>
      <input
        className="cp-ghost-input"
        value={c.title}
        maxLength={180}
        placeholder={c.suggestedTitle}
        onChange={(e) => c.setTitle(e.target.value)}
        onBlur={learnFromTitle}
        aria-label="Concepto"
      />

      {categories.length > 0 && (
        <>
          <Label>Categoría</Label>
          <ChoiceChips label="Categoría" options={categories} clearable value={c.category} onChange={c.setCategory} />
        </>
      )}

      {flow === 'ahorro' && (
        <>
          <Label>¿Guardaste o sacaste?</Label>
          <Segmented
            label="Ahorro"
            value={c.direction}
            onChange={c.setDirection}
            options={[
              { value: 'egreso', label: 'Guardé' },
              { value: 'ingreso', label: 'Saqué' },
            ]}
          />
          {goals.length > 0 && (
            <>
              <Label hint="Opcional">¿Para qué meta?</Label>
              <ChoiceChips
                label="Meta"
                clearable
                options={goals.map((g) => ({ value: g.id, label: g.title }))}
                value={c.details.goalId}
                onChange={(v) => c.setDetail('goalId', v)}
              />
            </>
          )}
        </>
      )}

      {showPockets && (
        <>
          <Label hint="Opcional">{pocketLabel}</Label>
          <ChoiceChips
            label="Bolsillo"
            clearable
            options={pockets.map((p) => ({ value: p.id, label: `${p.data.emoji ? p.data.emoji + ' ' : ''}${p.title}` }))}
            value={c.details.pocketId}
            onChange={pickPocket}
          />
        </>
      )}

      {flow === 'prestamo' && (
        <>
          <Label>¿Quién a quién?</Label>
          <Segmented
            label="Préstamo"
            value={c.direction}
            onChange={c.setDirection}
            options={[
              { value: 'egreso', label: 'Yo presté' },
              { value: 'ingreso', label: 'Me prestaron' },
            ]}
          />
        </>
      )}

      {flow === 'transferencia' ? (
        <div className="cp-two">
          <div>
            <Label>De</Label>
            <ChoiceChips
              label="Cuenta de origen"
              options={accountNames}
              value={c.details.method}
              onChange={(v) => c.setDetail('method', v)}
            />
          </div>
          <div>
            <Label>A</Label>
            <ChoiceChips
              label="Cuenta de destino"
              options={accountNames.filter((a) => a !== c.details.method)}
              value={c.details.toMethod}
              onChange={(v) => c.setDetail('toMethod', v)}
            />
          </div>
        </div>
      ) : (
        <div className="cp-two">
          <div>
            <Label>{pending ? (income ? '¿Cuándo te pagan?' : '¿Cuándo vence?') : 'Fecha'}</Label>
            <DateChips
              label="Fecha"
              options={pending ? ['today', 'tomorrow', 'nextweek'] : ['today', 'yesterday']}
              value={c.date}
              onChange={(v) => {
                c.setDate(v);
                if (pending) c.setDetail('due', v);
              }}
            />
          </div>
          <div>
            <Label>{income ? '¿A dónde llegó?' : 'Medio de pago'}</Label>
            <ChoiceChips
              label="Medio de pago"
              options={accountNames}
              clearable
              value={c.details.method}
              onChange={(v) => c.setDetail('method', v)}
            />
          </div>
        </div>
      )}

      {showStatus && (
        <div className="fm-status">
          <Segmented
            label="Estado"
            value={pending ? 'pendiente' : 'listo'}
            onChange={(v) => {
              c.setDetail('pending', v === 'pendiente' ? true : undefined);
              if (v === 'pendiente') {
                const due = c.date < today ? addDays(today, 1) : c.date;
                c.setDate(due);
                c.setDetail('due', due);
              } else if (c.date > today) c.setDate(today);
            }}
            options={[
              { value: 'listo', label: income ? 'Cobrado' : 'Pagado' },
              { value: 'pendiente', label: pendingLabel },
            ]}
          />
          {pending && (
            <small>No cuenta en tus totales hasta que lo marques {income ? 'cobrado' : 'pagado'}.</small>
          )}
        </div>
      )}

      {flow === 'ingreso' && (
        <label className={'fm-toggle' + (abonoOn ? ' on' : '')}>
          <input type="checkbox" checked={abonoOn} onChange={(e) => toggleAbono(e.target.checked)} />
          <span className="fm-switch" aria-hidden="true" />
          <span>
            <b>
              <Layers size={13} /> Es un abono de un total mayor
            </b>
            <small>
              {linked && linkedStats
                ? `Con este llevas ${money(linkedStats.received + (pending ? 0 : c.amount))} de ${money(linked.data.total)} · faltan ${money(Math.max(0, linkedStats.left - (pending ? 0 : c.amount)))}.`
                : draft && draft.total > 0
                  ? draft.total > c.amount
                    ? `Faltarán ${money(draftLeft)} de ${money(draft.total)}: queda en Cobros por partes.`
                    : 'El total debe ser mayor que este abono.'
                  : 'Un proyecto, una venta o un sueldo que te pagan en partes: define el total y cuándo llega lo demás.'}
            </small>
          </span>
        </label>
      )}
      {abonoOn && (
        <div className="fm-charge">
          {charges.length > 0 && (
            <ChoiceChips
              label="¿De qué cobro?"
              options={[
                ...charges.map((x) => {
                  const s = chargeStats(x, entries.filter((e) => e.id !== c.entry?.id));
                  return { value: x.id, label: `${x.title} · faltan ${money(s.left)}` };
                }),
                { value: 'new', label: 'Nuevo total', icon: <Plus size={13} /> },
              ]}
              value={c.details.chargeId ?? (draft ? 'new' : undefined)}
              onChange={chooseCharge}
            />
          )}
          {linked && linkedStats?.next && (
            <p className="fm-charge-note">
              Esperabas {money(linkedStats.next.amount)} {friendlyDate(linkedStats.next.due).toLowerCase()}
              {Math.abs(linkedStats.next.amount - c.amount) <= linkedStats.next.amount * 0.15
                ? ': este abono la cumple.'
                : '.'}
            </p>
          )}
          {draft && (
            <>
              <div className="fm-charge-grid">
                <AmountBox label="Total acordado" value={draft.total} onChange={(total) => setDraft({ total })} />
                <label className="fm-box">
                  <span>¿Cuándo llega lo demás?</span>
                  <input
                    type="date"
                    className="fm-box-date"
                    min={c.date}
                    value={draft.nextOn ?? ''}
                    onChange={(e) => setDraft({ nextOn: e.target.value || undefined, task: draft.task ?? Boolean(e.target.value) })}
                  />
                </label>
                {draft.nextOn && (
                  <AmountBox
                    label="¿Cuánto ese día?"
                    value={draft.nextAmount ?? 0}
                    onChange={(nextAmount) => setDraft({ nextAmount: nextAmount || undefined })}
                    placeholder={draftLeft ? thousands(draftLeft) : '0'}
                  />
                )}
              </div>
              <input
                className="cp-ghost-input fm-charge-title"
                value={draft.title ?? ''}
                maxLength={120}
                placeholder={`Nombre del cobro (opcional): ${c.title || 'Proyecto web, venta del carro…'}`}
                onChange={(e) => setDraft({ title: e.target.value || undefined })}
                aria-label="Nombre del cobro"
              />
              {draft.nextOn && (
                <label className="fm-check">
                  <input type="checkbox" checked={draft.task !== false} onChange={(e) => setDraft({ task: e.target.checked })} />
                  Crear un pendiente para no olvidar cobrarlo
                </label>
              )}
            </>
          )}
        </div>
      )}

      {flow === 'prestamo' && (
        <>
          <Label hint="Opcional">{income ? '¿Para cuándo lo devuelves?' : '¿Para cuándo te lo devuelven?'}</Label>
          <DateChips
            label="Fecha de devolución"
            options={['nextweek', 'none']}
            value={c.details.due ?? ''}
            onChange={(v) => c.setDetail('due', v || undefined)}
          />
        </>
      )}

      <div className="cp-two fm-links">
        <div>
          <Label hint={flow === 'prestamo' ? undefined : 'Opcional'}>
            {flow === 'prestamo' ? (income ? '¿Quién te prestó?' : '¿A quién?') : 'Con quién'}
          </Label>
          <PeopleField c={c} links={links} compact />
        </div>
        {flow !== 'transferencia' && flow !== 'prestamo' && (
          <div>
            <Label hint="Opcional">Dónde</Label>
            <PlaceField c={c} links={links} />
          </div>
        )}
      </div>

      {flow === 'gasto' && chosen.size > 0 && !split && (
        <label className={'fm-toggle' + (paidTo ? ' on' : '')}>
          <input
            type="checkbox"
            checked={paidTo}
            onChange={(e) => c.setDetail('paidTo', e.target.checked)}
          />
          <span className="fm-switch" aria-hidden="true" />
          <span>
            <b>Se lo pagué a {payees}</b>
            <small>
              {paidTo
                ? 'Un pago, un regalo, un trabajo o un servicio: la plata fue para ' +
                  (chosen.size === 1 ? 'esa persona.' : 'esas personas.')
                : 'Si no, cuenta como un gasto que hicieron juntos.'}
            </small>
          </span>
        </label>
      )}

      {flow === 'gasto' && (
        <label className={'fm-toggle' + (split ? ' on' : '')}>
          <input
            type="checkbox"
            checked={Boolean(split)}
            onChange={(e) => c.setDetail('split', e.target.checked ? { n: parts, mine: share } : undefined)}
          />
          <span className="fm-switch" aria-hidden="true" />
          <span>
            <b>Pagué yo y lo dividimos</b>
            <small>
              {split
                ? chosen.size
                  ? `${parts} partes: tu parte ${money(share)} · cada uno te debe ${money(share)} (queda en Deudas)`
                  : 'Agrega con quién lo dividiste.'
                : 'Quedará lo que cada uno te debe.'}
            </small>
          </span>
        </label>
      )}

      <button type="button" className={'fm-more' + (more ? ' open' : '')} onClick={() => setMore((v) => !v)}>
        <ChevronDown size={15} />
        Más detalles
        <small>se repite · compra duradera · ¿valió la pena? · nota · comprobante</small>
      </button>

      {more && (
        <div className="fm-more-body">
          {(flow === 'gasto' || flow === 'ingreso' || flow === 'ahorro') && (
            <label className={'fm-toggle' + (c.details.repeat ? ' on' : '')}>
              <input
                type="checkbox"
                checked={Boolean(c.details.repeat)}
                onChange={(e) =>
                  c.setDetail(
                    'repeat',
                    e.target.checked ? { day: Number(c.date.slice(8)) || 1, every: 'mes' } : undefined,
                  )
                }
              />
              <span className="fm-switch" aria-hidden="true" />
              <span>
                <b>
                  <Repeat size={13} /> Se repite
                </b>
                <small>
                  {c.details.repeat
                    ? `Queda en Fijos: ${c.details.repeat.every === 'año' ? 'cada año' : 'cada mes'} el día ${c.details.repeat.day}. Te avisa cuando toque.`
                    : 'Arriendo, servicios, suscripciones, sueldo…'}
                </small>
              </span>
            </label>
          )}
          {c.details.repeat && (
            <div className="fm-warranty">
              Se repite
              <select
                value={c.details.repeat.every}
                aria-label="Cada cuánto"
                onChange={(e) =>
                  c.setDetail('repeat', { ...c.details.repeat!, every: e.target.value as 'mes' | 'año' })
                }
              >
                <option value="mes">cada mes</option>
                <option value="año">cada año</option>
              </select>
              el día
              <input
                type="number"
                min={1}
                max={31}
                aria-label="Día"
                value={c.details.repeat.day}
                onChange={(e) =>
                  c.setDetail('repeat', {
                    ...c.details.repeat!,
                    day: Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                  })
                }
              />
            </div>
          )}

          {flow === 'gasto' && (
            <>
              <label className={'fm-toggle' + (c.details.asset ? ' on' : '')}>
                <input
                  type="checkbox"
                  checked={c.details.asset === true}
                  onChange={(e) => c.setDetail('asset', e.target.checked || undefined)}
                />
                <span className="fm-switch" aria-hidden="true" />
                <span>
                  <b>
                    <ShieldCheck size={13} /> Compra duradera
                  </b>
                  <small>Un equipo, un mueble, ropa buena: verás cuánto te cuesta por día y su garantía.</small>
                </span>
              </label>
              {c.details.asset && (
                <div className="fm-warranty">
                  Garantía hasta
                  <input
                    type="date"
                    value={c.details.warrantyUntil ?? ''}
                    aria-label="Garantía hasta"
                    onChange={(e) => c.setDetail('warrantyUntil', e.target.value || undefined)}
                  />
                </div>
              )}

              <div className="fm-worth">
                <span>¿Valió la pena?</span>
                <button
                  type="button"
                  className={c.details.worth === 1 ? 'on good' : ''}
                  onClick={() => c.setDetail('worth', c.details.worth === 1 ? undefined : 1)}
                >
                  <Smile size={15} /> Me hizo feliz
                </button>
                <button
                  type="button"
                  className={c.details.worth === -1 ? 'on bad' : ''}
                  onClick={() => c.setDetail('worth', c.details.worth === -1 ? undefined : -1)}
                >
                  <Frown size={15} /> Me arrepiento
                </button>
              </div>

              <label className="fm-check">
                <input
                  type="checkbox"
                  checked={c.details.deductible === true}
                  onChange={(e) => c.setDetail('deductible', e.target.checked || undefined)}
                />
                Deducible en la declaración de renta (salud, educación, intereses…)
              </label>
            </>
          )}

          <Label hint="Opcional">Nota</Label>
          <AutoTextarea
            className="cp-soft-area"
            minRows={2}
            value={c.body}
            maxLength={4000}
            placeholder="Algo que quieras recordar de este movimiento"
            onChange={(e) => c.setBody(e.target.value)}
          />

          <Label hint="Opcional">Comprobante</Label>
          <CoverDrop uploads={c.uploads} icon={Receipt} shape="wide" title="Foto del recibo" hint="Toca para subirla" />
        </div>
      )}

      {notes.length > 0 && (
        <ul className="fm-notes">
          {notes.map((n) => (
            <li key={n.text}>
              <AlertTriangle size={14} />
              <span>{n.text}</span>
              {n.action && (
                <button type="button" onClick={n.action.run}>
                  {n.action.label} <ArrowRight size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {links.dialogs}
    </div>
  );
}
