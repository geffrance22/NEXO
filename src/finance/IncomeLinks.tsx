import { useMemo, useState } from 'react';
import { ArrowDownLeft, Check, ChevronDown, ListTree, Plus, Search, Unlink, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import type { Entry } from '../data';
import { addDays, friendlyDate, money, normalizeText, todayInputValue } from '../lib/format';
import { Popover } from '../instants/Popover';
import { CatIcon } from './catIcons';
import { categoryOf, costOf, dayOf, flowOf, incomeUse, moneyShort, recentIncomes } from './money';
import './categories.css';

/** Lo que ya se gastó de cada ingreso (una sola pasada por tus movimientos). */
function usedByIncome(entries: readonly Entry[], skipId?: string) {
  const m = new Map<string, number>();
  for (const e of entries) {
    const id = e.details.fromIncome;
    if (!id || e.kind !== 'Movimiento' || e.details.pending || e.id === skipId) continue;
    m.set(id, (m.get(id) ?? 0) + costOf(e));
  }
  return m;
}

/** Elegir de qué ingreso salió la plata: los recientes, con lo que queda de cada uno. */
export function IncomePicker({
  anchor,
  value,
  onPick,
  onClose,
  skipId,
  align = 'start',
}: {
  anchor: HTMLElement;
  value?: string;
  onPick: (e: Entry | null) => void;
  onClose: () => void;
  /** El movimiento que se está editando (no cuenta en lo usado). */
  skipId?: string;
  align?: 'start' | 'end';
}) {
  const { workspace } = useApp();
  const [q, setQ] = useState('');
  const used = useMemo(() => usedByIncome(workspace.entries, skipId), [workspace.entries, skipId]);
  // Solo los que aún tienen saldo (y el que ya está elegido, aunque no le quede nada).
  const incomes = useMemo(
    () =>
      recentIncomes(workspace.entries).filter(
        (e) => e.id === value || e.amount - (used.get(e.id) ?? 0) > 0,
      ),
    [workspace.entries, used, value],
  );
  const needle = normalizeText(q.trim());
  const shown = (
    needle
      ? incomes.filter((e) => normalizeText(`${e.title} ${e.tags.join(' ')}`).includes(needle))
      : incomes
  ).slice(0, 40);
  return (
    <Popover
      anchor={anchor}
      align={align}
      label="¿De qué ingreso sale?"
      className="fz-catpick fz-incpick"
      onClose={onClose}
    >
      <header className="fz-catpick-head">
        <label className="fz-catpick-search">
          <Search size={14} />
          <input
            value={q}
            autoFocus
            placeholder="Buscar un ingreso"
            aria-label="Buscar un ingreso"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </header>
      <ul className="fz-incpick-list">
        {shown.map((e) => {
          const left = e.amount - (used.get(e.id) ?? 0);
          const pct = e.amount ? Math.min(1, Math.max(0, 1 - left / e.amount)) : 0;
          return (
            <li key={e.id}>
              <button
                type="button"
                className={'fz-incpick-row' + (value === e.id ? ' on' : '')}
                onClick={() => {
                  onPick(e);
                  onClose();
                }}
              >
                <CatIcon name={e.tags[0] || 'Otro'} size={14} />
                <span className="fz-incpick-main">
                  <strong>{e.title || e.tags[0] || 'Ingreso'}</strong>
                  <small>
                    {friendlyDate(dayOf(e))} · {money(e.amount)}
                  </small>
                  <i className="fz-incpick-bar" aria-hidden="true">
                    <i style={{ width: pct * 100 + '%' }} />
                  </i>
                </span>
                <span className={'fz-incpick-left' + (left < 0 ? ' over' : '')}>
                  <small>{left < 0 ? 'Te pasaste' : 'Queda'}</small>
                  <b>{moneyShort(Math.abs(left))}</b>
                </span>
                {value === e.id && <Check size={14} className="fz-incpick-check" />}
              </button>
            </li>
          );
        })}
        {!shown.length && (
          <li className="fz-catpick-none">
            {q ? `Nada con «${q}».` : 'No hay ingresos recientes con saldo.'}
          </li>
        )}
      </ul>
      {value && (
        <footer className="fz-catpick-foot">
          <small>Los totales no cambian: es para seguirle la pista.</small>
          <button
            type="button"
            className="fz-btn ghost sm"
            onClick={() => {
              onPick(null);
              onClose();
            }}
          >
            Quitar
          </button>
        </footer>
      )}
    </Popover>
  );
}

/** En el formulario de un gasto: de qué ingreso sale (opcional) y cuánto quedaría de él. */
export function IncomeField({
  value,
  onChange,
  amount,
  entryId,
}: {
  value?: string;
  onChange: (id: string | undefined) => void;
  /** Lo que vale este gasto (para decir cuánto quedaría). */
  amount: number;
  entryId?: string;
}) {
  const { workspace } = useApp();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const income = value ? workspace.entries.find((e) => e.id === value) : undefined;
  const use = income
    ? incomeUse(
        income,
        workspace.entries.filter((e) => e.id !== entryId),
      )
    : null;
  const after = use ? use.left - amount : 0;
  return (
    <div className="fm-inc">
      {income && use ? (
        <div className="fm-inc-on">
          <button
            type="button"
            className="fm-inc-pick"
            aria-haspopup="dialog"
            onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
          >
            <span className="fm-inc-ico" aria-hidden="true">
              <ArrowDownLeft size={14} />
            </span>
            <span>
              <strong>{income.title || income.tags[0] || 'Ingreso'}</strong>
              <small>
                {friendlyDate(dayOf(income)).toLowerCase()} · {money(income.amount)}
              </small>
            </span>
            <em className={after < 0 ? 'over' : ''}>
              {after < 0 ? `Te pasas ${moneyShort(-after)}` : `Quedarían ${moneyShort(after)}`}
            </em>
          </button>
          <button
            type="button"
            className="fm-inc-x"
            aria-label="Quitar el ingreso"
            title="Quitar"
            onClick={() => onChange(undefined)}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="fm-inc-btn"
          aria-haspopup="dialog"
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        >
          <ArrowDownLeft size={14} /> Elegir un ingreso
          <ChevronDown size={14} />
        </button>
      )}
      {anchor && (
        <IncomePicker
          anchor={anchor}
          value={value}
          skipId={entryId}
          onPick={(e) => onChange(e?.id)}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  );
}

/**
 * Un ingreso, desglosado: cuánto llegó, en qué se fue (los gastos que le anexaste) y cuánto
 * queda. Desde aquí se anexan gastos que ya tenías o se registra uno nuevo que sale de él.
 */
export function IncomeSheet({ income, onClose }: { income: Entry; onClose: () => void }) {
  const { workspace, viewEntry, patchEntry, openEntry, notify } = useApp();
  const live = workspace.entries.find((e) => e.id === income.id) ?? income;
  const use = incomeUse(live, workspace.entries);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const day = dayOf(live);
  const candidates = useMemo(() => {
    const from = addDays(day, -3);
    const to = addDays(day, 75);
    return workspace.entries
      .filter((e) => {
        if (e.kind !== 'Movimiento' || e.details.pending || e.details.fromIncome) return false;
        const f = flowOf(e);
        if (f !== 'gasto' && !(f === 'ahorro' && e.direction === 'egreso')) return false;
        const d = dayOf(e);
        return d >= from && d <= to;
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [workspace.entries, day]);
  const pickedSum = candidates.filter((e) => picked.has(e.id)).reduce((s, e) => s + costOf(e), 0);
  const over = use.left < 0;
  const pct = Math.min(1, use.pct);

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const attach = async () => {
    const list = candidates.filter((e) => picked.has(e.id));
    if (!list.length || busy) return;
    setBusy(true);
    let n = 0;
    for (const e of list)
      if (await patchEntry(e, { details: { ...e.details, fromIncome: live.id } })) n++;
    setBusy(false);
    setAdding(false);
    setPicked(new Set());
    if (n)
      notify(
        `${n === 1 ? 'Gasto anexado' : `${n} gastos anexados`} a «${live.title || 'este ingreso'}».`,
      );
  };
  const detach = async (e: Entry) => {
    const { fromIncome: _gone, ...rest } = e.details;
    if (await patchEntry(e, { details: rest }))
      notify('Gasto desanexado.', {
        label: 'Deshacer',
        run: () => void patchEntry(e, { details: { ...rest, fromIncome: live.id } }),
      });
  };

  return (
    <Sheet
      label={`En qué se fue ${live.title || 'el ingreso'}`}
      className="fz-sheet fz-moves fz-inc-sheet"
      onRequestClose={onClose}
    >
      <header className="fz-sheet-head">
        <span className="fz-avatar fz-moves-face fz-inc-face" aria-hidden="true">
          <ListTree size={17} />
        </span>
        <div>
          <h3>{live.title || live.tags[0] || 'Ingreso'}</h3>
          <p>
            {friendlyDate(day)} ·{' '}
            {[live.tags[0], live.details.method].filter(Boolean).join(' · ') || 'Ingreso'}
          </p>
        </div>
        <button type="button" className="fz-x" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="fz-sheet-body">
        <div className="fz-mv-sum">
          <div>
            <small>Llegó</small>
            <b className="in">{money(live.amount)}</b>
          </div>
          <div>
            <small>{use.spends.some((e) => flowOf(e) === 'ahorro') ? 'Gastado y guardado' : 'Gastado'}</small>
            <b>{money(use.used)}</b>
          </div>
          <div>
            <small>{over ? 'Te pasaste' : 'Queda'}</small>
            <b className={over ? 'out' : ''}>{money(Math.abs(use.left))}</b>
          </div>
        </div>
        <div className="fz-charge-progress">
          <i className={'fz-inc-bar' + (over ? ' over' : '')} aria-hidden="true">
            <i style={{ width: pct * 100 + '%' }} />
          </i>
          <small>
            {Math.round(use.pct * 100)} % usado · tus totales no cambian, es solo para seguirle la
            pista
          </small>
        </div>

        {adding ? (
          <section className="fz-mv-sec">
            <header>
              <h4>Anexar gastos</h4>
              <small>
                Del {friendlyDate(addDays(day, -3)).toLowerCase()} en adelante · {candidates.length}
              </small>
            </header>
            {candidates.length ? (
              <ol className="fz-mv-list">
                {candidates.map((e) => {
                  const on = picked.has(e.id);
                  return (
                    <li key={e.id} className="fz-mv">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        className={'fz-inc-cand' + (on ? ' on' : '')}
                        onClick={() => toggle(e.id)}
                      >
                        <i className="fz-note-tick" aria-hidden="true">
                          {on && <Check size={11} strokeWidth={3} />}
                        </i>
                        <span className="fz-mv-main">
                          <strong>{e.title || categoryOf(e)}</strong>
                          <small>
                            <span>{friendlyDate(dayOf(e))}</span>
                            <span>{categoryOf(e)}</span>
                          </small>
                        </span>
                        <b>−{money(costOf(e))}</b>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="fz-mv-free">No hay gastos sueltos cerca de la fecha de este ingreso.</p>
            )}
          </section>
        ) : (
          <section className="fz-mv-sec">
            <header>
              <h4>En qué se fue</h4>
              {use.spends.length > 0 && (
                <small>{use.spends.length === 1 ? '1 gasto' : `${use.spends.length} gastos`}</small>
              )}
            </header>
            {use.spends.length ? (
              <ol className="fz-mv-list">
                {use.spends.map((e) => (
                  <li key={e.id} className="fz-mv">
                    <span className="fz-mv-ic">
                      <CatIcon name={categoryOf(e)} size={13} />
                    </span>
                    <button
                      type="button"
                      className="fz-mv-main"
                      title="Ver el movimiento"
                      onClick={() => viewEntry(e)}
                    >
                      <strong>{e.title || categoryOf(e)}</strong>
                      <small>
                        <span>{friendlyDate(dayOf(e))}</span>
                        <span>{categoryOf(e)}</span>
                        {e.details.method && <span>{e.details.method}</span>}
                      </small>
                    </button>
                    <b>−{money(costOf(e))}</b>
                    <button
                      type="button"
                      className="fz-icon fz-inc-unlink"
                      title="Desanexar"
                      aria-label={`Desanexar ${e.title}`}
                      onClick={() => void detach(e)}
                    >
                      <Unlink size={13} />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="fz-mv-free">
                Aún no le anexas gastos. Anexa los que ya registraste o registra uno nuevo que salga
                de aquí.
              </p>
            )}
          </section>
        )}
      </div>

      <footer className="fz-sheet-foot">
        {adding ? (
          <>
            <span className="fz-foot-note">
              {picked.size
                ? `${picked.size} · −${money(pickedSum)}`
                : 'Elige qué gastos salieron de aquí'}
            </span>
            <button
              type="button"
              className="fz-btn ghost"
              onClick={() => {
                setAdding(false);
                setPicked(new Set());
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="fz-btn primary"
              disabled={!picked.size || busy}
              onClick={() => void attach()}
            >
              Anexar {picked.size || ''}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="fz-btn ghost" onClick={() => setAdding(true)}>
              <Check size={14} /> Anexar gastos
            </button>
            <button
              type="button"
              className="fz-btn primary"
              onClick={() => {
                onClose();
                openEntry('Movimiento', [], { flow: 'gasto', fromIncome: live.id });
              }}
            >
              <Plus size={15} /> Registrar un gasto
            </button>
          </>
        )}
      </footer>
    </Sheet>
  );
}

/** Todo lo de los ingresos con gastos anexados (para el Resumen): lo usado y lo que queda. */
export function trackedIncomes(entries: readonly Entry[], today = todayInputValue()) {
  return recentIncomes(entries, today, 120)
    .map((e) => ({ e, use: incomeUse(e, entries) }))
    .filter((x) => x.use.spends.length > 0);
}
