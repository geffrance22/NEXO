import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  ChevronDown,
  ClipboardPaste,
  CornerDownLeft,
  Handshake,
  History,
  Link2,
  LoaderCircle,
  Paperclip,
  Plus,
  Repeat,
  RotateCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useApp } from '../../AppContext';
import type { MoneyFlow } from '../../data';
import { CategoryField } from '../../finance/CategoryPicker';
import { worthIcons } from '../../finance/catIcons';
import { DebtSheet } from '../../finance/Debts';
import { currencies, rateToCop, type Currency } from '../../finance/fx';
import { IncomeField } from '../../finance/IncomeLinks';
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
  worthOf,
  worthScale,
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
import type { ImageUploads } from '../useImageUploads';
import { IncomeAllot, IncomeSpends } from './IncomeExtras';
import type { ViewProps } from './shared';
import '../../finance/money-form.css';

/** Lo que pasa en una ventana encima del formulario no le llega al formulario (Enter, pegar…). */
const keep = (e: SyntheticEvent) => e.stopPropagation();

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
export function MoneyView({ c, onClose }: ViewProps) {
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
    else if (c.categories.length) {
      // Solo quedan las categorías que existen en el tipo nuevo (de gasto o de ingreso).
      const allowed = f === 'ingreso' ? [...incomeCategories, ...settings.extraIn] : [...expenseCategories, ...settings.extraOut];
      const kept = c.categories.filter((x) => allowed.includes(x) && x !== 'Ahorro' && x !== 'Reembolso');
      if (kept.length !== c.categories.length) c.setCategories(kept);
    }
    if (f !== 'gasto' && f !== 'ingreso') c.setDetail('pending', undefined);
    if (f !== 'gasto') c.setDetail('split', undefined);
    if (f !== 'ingreso') {
      c.setDetail('allotNew', undefined);
      c.setDetail('spendsNew', undefined);
    }
  };
  // Los gastos que se anexan a un ingreso usan las categorías de gasto.
  const spendCategories = useMemo(
    () => [...expenseCategories.filter((x) => x !== 'Ahorro' && x !== 'Otro'), ...settings.extraOut, 'Otro'],
    [settings.extraOut],
  );

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
    c.details.repeat ||
      c.details.asset ||
      c.details.worth !== undefined ||
      c.details.deductible ||
      c.details.spendsNew?.length ||
      c.body ||
      c.uploads.items.length,
  );
  const [more, setMore] = useState(hasMore);
  // Un comprobante pegado (Ctrl+V) o arrastrado sobre el formulario se ve de una.
  const receipts = c.uploads.items.length;
  useEffect(() => {
    if (receipts) setMore(true);
  }, [receipts]);
  const worth = worthOf(c.details.worth);

  // ── Tus categorías más usadas en este tipo (para elegir con un toque).
  const frequent = useMemo(() => {
    const count = new Map<string, number>();
    let n = 0;
    for (const e of entries) {
      if (!isMoney(e) || flowOf(e) !== flow) continue;
      const t = e.tags[0];
      if (t && t !== 'Otro') count.set(t, (count.get(t) ?? 0) + 1);
      if (++n >= 300) break;
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  }, [entries, flow]);

  // ── De qué ingreso sale (solo un gasto o lo que guardas).
  const canFromIncome = flow === 'gasto' || (flow === 'ahorro' && c.direction === 'egreso');
  useEffect(() => {
    if (!canFromIncome && c.details.fromIncome) c.setDetail('fromIncome', undefined);
  }, [canFromIncome]);

  // ── Escribirlo en una línea (se abre al pedirlo) y convertirlo en deuda.
  const [lineOpen, setLineOpen] = useState(false);
  const [debtOpen, setDebtOpen] = useState(false);
  const firstPerson = [...chosen][0];
  const firstName = firstPerson ? workspace.people.find((p) => p.id === firstPerson)?.name : undefined;

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
          {!c.editing && (
            <button
              type="button"
              className="fm-flow-debt"
              title="Alguien te debe o le debes y aún no se mueve plata: no es gasto ni ingreso, queda en Deudas"
              onClick={() => setDebtOpen(true)}
            >
              <Handshake size={13} /> Deuda
            </button>
          )}
        </div>
      </div>

      <div className="fm-hero">
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
          <select className="fm-cur" value={cur} aria-label="Moneda" onChange={(e) => void setCurrency(e.target.value as Currency)}>
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
      </div>

      {!c.editing && (
        <div className="fm-assist">
          {lineOpen && (
            <div className="fm-line">
              <Sparkles size={15} />
              <input
                value={line}
                autoFocus
                maxLength={200}
                placeholder="«Almuerzo con Laura 38 mil nequi», «me pagaron 2 millones ayer»"
                aria-label="Escribir el movimiento en una línea"
                onChange={(e) => setLine(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && !line) {
                    e.stopPropagation();
                    setLineOpen(false);
                  }
                  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && line.trim()) {
                    e.preventDefault();
                    applyLine();
                  }
                }}
              />
              {line.trim() ? (
                <button type="button" className="fm-line-go" onClick={applyLine} aria-label="Llenar el formulario">
                  <CornerDownLeft size={13} /> Llenar
                </button>
              ) : (
                <button type="button" className="fm-line-x" aria-label="Cerrar" title="Cerrar" onClick={() => setLineOpen(false)}>
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          <div className="fm-templates" aria-label="Atajos">
            {!lineOpen && (
              <button type="button" className="fm-line-open" onClick={() => setLineOpen(true)}>
                <Sparkles size={13} /> Escríbelo en una línea
              </button>
            )}
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
          {filled && <p className="fm-filled">{filled}</p>}
        </div>
      )}

      {/* ── Qué es ── */}
      <section className="fm-sec">
        <div className="fm-field">
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
        </div>

        {categories.length > 0 && (
          <div className="fm-field">
            <Label hint={c.categories.length > 1 ? 'la primera es la principal' : undefined}>
              {c.categories.length > 1 ? 'Categorías' : 'Categoría'}
            </Label>
            <CategoryField
              options={categories}
              value={c.categories}
              onChange={c.setCategories}
              frequent={frequent}
              multiple={flow !== 'ahorro'}
              createIn={flow === 'ingreso' ? 'in' : flow === 'gasto' ? 'out' : undefined}
            />
          </div>
        )}

        {flow === 'ahorro' && (
          <>
            <div className="fm-field">
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
            </div>
            {goals.length > 0 && (
              <div className="fm-field">
                <Label hint="Opcional">¿Para qué meta?</Label>
                <ChoiceChips
                  label="Meta"
                  clearable
                  options={goals.map((g) => ({ value: g.id, label: g.title }))}
                  value={c.details.goalId}
                  onChange={(v) => c.setDetail('goalId', v)}
                />
              </div>
            )}
          </>
        )}

        {flow === 'prestamo' && (
          <div className="fm-field">
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
          </div>
        )}
      </section>

      {/* ── Cuándo y cómo ── */}
      <section className="fm-sec">
        {flow === 'transferencia' ? (
          <div className="cp-two">
            <div className="fm-field">
              <Label>De</Label>
              <ChoiceChips label="Cuenta de origen" options={accountNames} value={c.details.method} onChange={(v) => c.setDetail('method', v)} />
            </div>
            <div className="fm-field">
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
            <div className="fm-field">
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
            <div className="fm-field">
              <Label>{income ? '¿A dónde llegó?' : 'Medio de pago'}</Label>
              <ChoiceChips label="Medio de pago" options={accountNames} clearable value={c.details.method} onChange={(v) => c.setDetail('method', v)} />
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
            {pending && <small>No cuenta en tus totales hasta que lo marques {income ? 'cobrado' : 'pagado'}.</small>}
          </div>
        )}

        {flow === 'prestamo' && (
          <div className="fm-field">
            <Label hint="Opcional">{income ? '¿Para cuándo lo devuelves?' : '¿Para cuándo te lo devuelven?'}</Label>
            <DateChips
              label="Fecha de devolución"
              options={['nextweek', 'none']}
              value={c.details.due ?? ''}
              onChange={(v) => c.setDetail('due', v || undefined)}
            />
          </div>
        )}

        {(showPockets || canFromIncome) && (
          <div className={'cp-two' + (showPockets && canFromIncome ? '' : ' single')}>
            {showPockets && (
              <div className="fm-field">
                <Label hint="Opcional">{pocketLabel}</Label>
                <ChoiceChips
                  label="Bolsillo"
                  clearable
                  options={pockets.map((p) => ({ value: p.id, label: `${p.data.emoji ? p.data.emoji + ' ' : ''}${p.title}` }))}
                  value={c.details.pocketId}
                  onChange={pickPocket}
                />
              </div>
            )}
            {canFromIncome && (
              <div className="fm-field">
                <Label hint="Opcional">¿De qué ingreso sale?</Label>
                <IncomeField
                  value={c.details.fromIncome}
                  onChange={(id) => c.setDetail('fromIncome', id)}
                  amount={c.amount}
                  entryId={c.entry?.id}
                />
              </div>
            )}
          </div>
        )}

        {flow === 'ingreso' && (
          <label className={'fm-toggle' + (abonoOn ? ' on' : '')}>
            <input type="checkbox" checked={abonoOn} onChange={(e) => toggleAbono(e.target.checked)} />
            <span className="fm-switch" aria-hidden="true" />
            <span>
              <b>
                <BriefcaseBusiness size={13} /> Es el abono de un trabajo
              </b>
              <small>
                {linked && linkedStats
                  ? `Con este llevas ${money(linkedStats.received + (pending ? 0 : c.amount))} abonado de ${money(linked.data.total)} · pendiente ${money(Math.max(0, linkedStats.left - (pending ? 0 : c.amount)))}.`
                  : draft && draft.total > 0
                    ? draft.total > c.amount
                      ? `Quedarán pendientes ${money(draftLeft)} de ${money(draft.total)}: queda en Trabajos por cobrar.`
                      : 'El valor del trabajo debe ser mayor que este abono.'
                    : 'Un trabajo que te pagan por partes (por ejemplo, la mitad al empezar): define cuánto vale y cuándo llega lo demás.'}
              </small>
            </span>
          </label>
        )}
        {abonoOn && (
          <div className="fm-charge">
            {charges.length > 0 && (
              <ChoiceChips
                label="¿De qué trabajo?"
                options={[
                  ...charges.map((x) => {
                    const s = chargeStats(x, entries.filter((e) => e.id !== c.entry?.id));
                    return { value: x.id, label: `${x.title} · pendiente ${money(s.left)}` };
                  }),
                  { value: 'new', label: 'Nuevo trabajo', icon: <Plus size={13} /> },
                ]}
                value={c.details.chargeId ?? (draft ? 'new' : undefined)}
                onChange={chooseCharge}
              />
            )}
            {linked && linkedStats?.next && (
              <p className="fm-charge-note">
                Esperabas {money(linkedStats.next.amount)} {friendlyDate(linkedStats.next.due).toLowerCase()}
                {Math.abs(linkedStats.next.amount - c.amount) <= linkedStats.next.amount * 0.15 ? ': este abono la cumple.' : '.'}
              </p>
            )}
            {draft && (
              <>
                <div className="fm-charge-grid">
                  <AmountBox label="Valor del trabajo" value={draft.total} onChange={(total) => setDraft({ total })} />
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
                  placeholder={`Nombre del trabajo (opcional): ${c.title || 'Página web, diseño de logo…'}`}
                  onChange={(e) => setDraft({ title: e.target.value || undefined })}
                  aria-label="Nombre del trabajo"
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

        {flow === 'ingreso' && !c.editing && !pending && !fin.missing && <IncomeAllot c={c} />}
      </section>

      {/* ── Con quién y dónde ── */}
      <section className="fm-sec">
        <div className="cp-two fm-links">
          <div className="fm-field">
            <Label hint={flow === 'prestamo' ? undefined : 'Opcional'}>
              {flow === 'prestamo' ? (income ? '¿Quién te prestó?' : '¿A quién?') : 'Con quién'}
            </Label>
            <PeopleField c={c} links={links} compact />
          </div>
          {flow !== 'transferencia' && flow !== 'prestamo' && (
            <div className="fm-field">
              <Label hint="Opcional">Dónde</Label>
              <PlaceField c={c} links={links} />
            </div>
          )}
        </div>

        {flow === 'gasto' && chosen.size > 0 && !split && (
          <label className={'fm-toggle' + (paidTo ? ' on' : '')}>
            <input type="checkbox" checked={paidTo} onChange={(e) => c.setDetail('paidTo', e.target.checked)} />
            <span className="fm-switch" aria-hidden="true" />
            <span>
              <b>Se lo pagué a {payees}</b>
              <small>
                {paidTo
                  ? 'Un pago, un regalo, un trabajo o un servicio: la plata fue para ' + (chosen.size === 1 ? 'esa persona.' : 'esas personas.')
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
      </section>

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

      <button type="button" className={'fm-more' + (more ? ' open' : '')} aria-expanded={more} onClick={() => setMore((v) => !v)}>
        <span>
          <b>Más detalles</b>
          <small>
            {[
              (flow === 'gasto' || flow === 'ingreso' || flow === 'ahorro') && 'se repite',
              flow === 'ingreso' && !pending && 'gastos de este ingreso',
              flow === 'gasto' && 'compra duradera',
              flow === 'gasto' && '¿valió la pena?',
              'comprobante',
              'nota',
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </span>
        <ChevronDown size={16} />
      </button>

      {more && (
        <section className="fm-sec fm-more-body">
          {(flow === 'gasto' || flow === 'ingreso' || flow === 'ahorro') && (
            <div className="fm-toggle-group">
              <label className={'fm-toggle' + (c.details.repeat ? ' on' : '')}>
                <input
                  type="checkbox"
                  checked={Boolean(c.details.repeat)}
                  onChange={(e) =>
                    c.setDetail('repeat', e.target.checked ? { day: Number(c.date.slice(8)) || 1, every: 'mes' } : undefined)
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
              {c.details.repeat && (
                <div className="fm-sub">
                  <div className="fm-mini-seg" role="radiogroup" aria-label="Cada cuánto">
                    {(['mes', 'año'] as const).map((x) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={c.details.repeat!.every === x}
                        key={x}
                        className={c.details.repeat!.every === x ? 'on' : ''}
                        onClick={() => c.setDetail('repeat', { ...c.details.repeat!, every: x })}
                      >
                        {x === 'mes' ? 'Cada mes' : 'Cada año'}
                      </button>
                    ))}
                  </div>
                  <label className="fm-sub-field">
                    el día
                    <input
                      type="number"
                      min={1}
                      max={31}
                      aria-label="Día"
                      value={c.details.repeat.day}
                      onChange={(e) =>
                        c.setDetail('repeat', { ...c.details.repeat!, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {flow === 'ingreso' && !pending && <IncomeSpends c={c} options={spendCategories} />}

          {flow === 'gasto' && (
            <div className="fm-toggle-group">
              <label className={'fm-toggle' + (c.details.asset ? ' on' : '')}>
                <input type="checkbox" checked={c.details.asset === true} onChange={(e) => c.setDetail('asset', e.target.checked || undefined)} />
                <span className="fm-switch" aria-hidden="true" />
                <span>
                  <b>
                    <ShieldCheck size={13} /> Compra duradera
                  </b>
                  <small>Un equipo, un mueble, ropa buena: verás cuánto te cuesta por día y su garantía.</small>
                </span>
              </label>
              {c.details.asset && (
                <div className="fm-sub">
                  <label className="fm-sub-field">
                    Garantía hasta
                    <input
                      type="date"
                      value={c.details.warrantyUntil ?? ''}
                      aria-label="Garantía hasta"
                      onChange={(e) => c.setDetail('warrantyUntil', e.target.value || undefined)}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {flow === 'gasto' && (
            <div className="fm-field">
              <Label hint="Opcional">¿Valió la pena?</Label>
              <div className="fm-worth" role="radiogroup" aria-label="¿Valió la pena?">
                {worthScale.map((w) => {
                  const Icon = worthIcons[w.tone];
                  const on = c.details.worth === w.value;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      key={w.value}
                      className={'fm-worth-opt ' + w.tone + (on ? ' on' : '')}
                      title={w.hint}
                      onClick={() => c.setDetail('worth', on ? undefined : w.value)}
                    >
                      <Icon size={19} strokeWidth={1.9} />
                      <span>{w.label}</span>
                    </button>
                  );
                })}
              </div>
              {worth && <small className={'fm-worth-hint ' + worth.tone}>{worth.hint}</small>}
            </div>
          )}

          {flow === 'gasto' && (
            <label className="fm-check">
              <input type="checkbox" checked={c.details.deductible === true} onChange={(e) => c.setDetail('deductible', e.target.checked || undefined)} />
              Deducible en la declaración de renta (salud, educación, intereses…)
            </label>
          )}

          <div className="fm-field">
            <Label hint="Opcional">Comprobante</Label>
            <ReceiptAttach uploads={c.uploads} />
          </div>

          <div className="fm-field">
            <Label hint="Opcional">Nota</Label>
            <AutoTextarea
              className="cp-soft-area"
              minRows={2}
              value={c.body}
              maxLength={4000}
              placeholder="Algo que quieras recordar de este movimiento"
              onChange={(e) => c.setBody(e.target.value)}
            />
          </div>
        </section>
      )}

      {links.dialogs}
      {debtOpen &&
        createPortal(
          <div onKeyDown={keep} onPaste={keep} onDrop={keep} onDragOver={keep} onSubmit={keep}>
            <DebtSheet
              item={null}
              className="fm-debt-sheet"
              prefill={{
                dir: income ? 'meDeben' : 'debo',
                amount: c.amount || undefined,
                title: c.title || undefined,
                date: c.date,
                personId: firstPerson,
                name: firstName,
              }}
              onSaved={() => onClose?.()}
              onClose={() => setDebtOpen(false)}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * El comprobante: una línea discreta para adjuntar la foto del recibo, pegarla (Ctrl+V o el
 * botón) o traerla desde una dirección web; luego se puede cambiar o quitar.
 */
function ReceiptAttach({ uploads }: { uploads: ImageUploads }) {
  const item = uploads.items[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [hint, setHint] = useState('');
  // El selector de archivos se abre desde un botón: el campo oculto nunca recibe el foco (al
  // enfocarlo, el navegador corría toda la ventana para mostrarlo y la dejaba en blanco).
  const pickFile = () => {
    setHint('');
    fileRef.current?.click();
  };
  const useLink = () => {
    if (!uploads.addUrl(link, true)) return;
    setLink('');
    setLinkOpen(false);
    setHint('');
  };
  const paste = async () => {
    setHint('');
    try {
      if (!navigator.clipboard?.read) throw Error('sin portapapeles');
      for (const clip of await navigator.clipboard.read()) {
        const type = clip.types.find((t) => t.startsWith('image/'));
        if (type) {
          const blob = await clip.getType(type);
          const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
          uploads.add([new File([blob], `recibo.${ext}`, { type })], true);
          return;
        }
        if (clip.types.includes('text/plain')) {
          const text = (await (await clip.getType('text/plain')).text()).trim();
          if (/^https?:\/\//i.test(text)) {
            uploads.addUrl(text, true);
            return;
          }
        }
      }
      setHint('No hay una imagen copiada. Copia la foto o su dirección y vuelve a intentarlo.');
    } catch {
      setHint('El navegador no dejó leer el portapapeles: pulsa Ctrl+V aquí en el formulario.');
    }
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="cp-sr"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (files.length) uploads.add(files.slice(0, 1), true);
      }}
    />
  );
  const note = hint || uploads.notice;

  if (!item)
    return (
      <div className="fm-receipt">
        {input}
        <div className="fm-receipt-opts">
          <button type="button" className="fm-receipt-add" onClick={pickFile}>
            <Paperclip size={14} /> Adjuntar foto
          </button>
          <button
            type="button"
            className="fm-receipt-opt"
            title="Pegar una imagen copiada (también con Ctrl+V)"
            onClick={() => void paste()}
          >
            <ClipboardPaste size={14} /> Pegar
          </button>
          <button
            type="button"
            className={'fm-receipt-opt' + (linkOpen ? ' on' : '')}
            aria-expanded={linkOpen}
            title="Desde la dirección de una imagen en la web"
            onClick={() => {
              setLinkOpen((v) => !v);
              setHint('');
            }}
          >
            <Link2 size={14} /> URL
          </button>
        </div>
        {linkOpen && (
          <div className="fm-receipt-link">
            <input
              type="url"
              inputMode="url"
              autoFocus
              value={link}
              maxLength={2000}
              placeholder="https://… (la dirección de la imagen)"
              aria-label="Dirección de la imagen"
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  useLink();
                } else if (e.key === 'Escape') {
                  // Cierra solo este campo, no el formulario.
                  e.stopPropagation();
                  setLinkOpen(false);
                }
              }}
            />
            <button type="button" className="fm-receipt-go" disabled={!link.trim()} onClick={useLink}>
              Usar
            </button>
          </div>
        )}
        {note && <small className="fm-receipt-note">{note}</small>}
      </div>
    );
  return (
    <div className={'fm-receipt has ' + item.status}>
      {input}
      <span className="fm-receipt-thumb">
        <img src={item.preview} alt="" />
        {item.status === 'uploading' && (
          <span className="fm-receipt-spin">
            <LoaderCircle size={14} className="spin" />
          </span>
        )}
      </span>
      <span className="fm-receipt-info">
        <b>Comprobante</b>
        <small title={item.status === 'error' ? item.error : undefined}>
          {item.status === 'uploading'
            ? item.source && !item.progress
              ? 'Trayendo la imagen…'
              : `Subiendo… ${Math.round(item.progress * 100)} %`
            : item.status === 'error'
              ? item.error || 'No se pudo subir.'
              : item.linked
                ? 'Listo · enlazado a la dirección web'
                : 'Listo'}
        </small>
      </span>
      {item.status === 'error' && (
        <button type="button" className="fm-receipt-btn" onClick={() => uploads.retry(item.id)}>
          <RotateCw size={13} /> Reintentar
        </button>
      )}
      <button type="button" className="fm-receipt-btn" onClick={pickFile}>
        Cambiar
      </button>
      <button type="button" className="fm-receipt-x" aria-label="Quitar comprobante" title="Quitar" onClick={() => uploads.remove(item.id)}>
        <X size={14} />
      </button>
    </div>
  );
}
