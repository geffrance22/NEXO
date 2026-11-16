import { useMemo, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Copy, FileChartColumn } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { friendlyDate, money } from '../lib/format';
import { CatIcon } from './catIcons';
import { catColor } from './charts';
import {
  byCategory,
  categoryOf,
  costOf,
  dayOf,
  delta,
  flowOf,
  percent,
  periodLabel,
  totals,
  type Period,
} from './money';
import { FinSheet } from './ui';

/**
 * El informe del periodo en una ventana: las cifras frente al periodo anterior, en qué se fue la
 * plata, los gastos más grandes y lo que dicen tus números. Se puede copiar como texto.
 */
export function ReportSheet({
  period,
  list,
  prev,
  vs,
  insights,
  onClose,
  onOpen,
}: {
  period: Period;
  list: readonly Entry[];
  prev: readonly Entry[];
  vs?: string;
  insights: { key: string; icon: ReactNode; text: ReactNode }[];
  onClose: () => void;
  onOpen: (e: Entry) => void;
}) {
  const { notify } = useApp();
  const t = totals(list);
  const tp = totals(prev);
  const label = periodLabel(period);
  const cats = useMemo(() => byCategory(list), [list]);
  const prevCats = useMemo(() => new Map(byCategory(prev).map((c) => [c.name, c.total])), [prev]);
  const biggest = useMemo(
    () =>
      list
        .filter((e) => !e.details.pending && flowOf(e) === 'gasto')
        .sort((a, b) => costOf(b) - costOf(a))
        .slice(0, 5),
    [list],
  );
  const topCat = cats[0]?.total ?? 1;
  const kept = t.income > 0 ? (t.income - t.spent) / t.income : null;

  const stats = [
    { key: 'in', label: 'Ingresos', value: t.income, before: tp.income, goodUp: true, cls: 'in' },
    { key: 'out', label: 'Gastos', value: t.spent, before: tp.spent, goodUp: false, cls: 'out' },
    {
      key: 'bal',
      label: 'Balance',
      value: t.balance,
      before: tp.balance,
      goodUp: true,
      cls: t.balance < 0 ? 'out' : '',
    },
    { key: 'save', label: 'Ahorro', value: t.saved, before: tp.saved, goodUp: true, cls: 'save' },
  ];

  const copy = async () => {
    const lines = [
      `Finanzas · ${label}`,
      '',
      ...stats.map(
        (s) =>
          `${s.label}: ${money(s.value)}${vs && s.before ? ` (${money(s.before)} en ${vs})` : ''}`,
      ),
      ...(kept !== null ? [`Te quedó el ${percent(Math.max(0, kept))} de lo que entró.`] : []),
      ...(cats.length
        ? [
            '',
            'En qué se fue:',
            ...cats
              .slice(0, 8)
              .map((c) => `· ${c.name}: ${money(c.total)} (${percent(c.total / (t.gross || 1))})`),
          ]
        : []),
      ...(biggest.length
        ? [
            '',
            'Gastos más grandes:',
            ...biggest.map(
              (e) =>
                `· ${e.title || categoryOf(e)}: ${money(costOf(e))} (${friendlyDate(dayOf(e)).toLowerCase()})`,
            ),
          ]
        : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      notify('Informe copiado.');
    } catch {
      notify('No se pudo copiar.');
    }
  };

  return (
    <FinSheet
      wide
      icon={<FileChartColumn size={18} />}
      title={`Informe · ${label}`}
      sub={vs ? `Comparado con ${vs}` : 'Todo lo que has registrado'}
      className="fz-report"
      onClose={onClose}
      footer={
        <>
          <span className="fz-foot-note">
            {list.length ? `${list.length} movimientos en el periodo` : 'Sin movimientos'}
          </span>
          <button type="button" className="fz-btn ghost" onClick={() => void copy()}>
            <Copy size={14} /> Copiar resumen
          </button>
          <button type="button" className="fz-btn primary" onClick={onClose}>
            Listo
          </button>
        </>
      }
    >
      <div className="fz-rep-stats">
        {stats.map((s) => {
          const ch = vs && s.before ? delta(s.value, s.before) : null;
          const up = (ch ?? 0) > 0;
          const good = ch == null || ch === 0 ? null : up === s.goodUp;
          return (
            <div key={s.key} className={'fz-rep-stat ' + s.cls}>
              <small>{s.label}</small>
              <b>{s.value < 0 ? '−' + money(-s.value) : money(s.value)}</b>
              {ch != null && ch !== 0 ? (
                <em className={good ? 'good' : 'bad'}>
                  {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                  {percent(Math.abs(ch))} vs {vs}
                </em>
              ) : (
                <em>{vs ? `Igual que ${vs}` : '\u00a0'}</em>
              )}
            </div>
          );
        })}
      </div>
      {kept !== null && (
        <p className="fz-rep-lead">
          {kept >= 0 ? (
            <>
              Te quedó el <b>{percent(kept)}</b> de lo que entró.
            </>
          ) : (
            <>
              Gastaste <b>{money(t.spent - t.income)}</b> más de lo que entró.
            </>
          )}
        </p>
      )}

      {cats.length > 0 && (
        <section className="fz-rep-sec">
          <h4>En qué se fue</h4>
          <ul className="fz-rep-cats">
            {cats.slice(0, 8).map((c) => {
              const before = prevCats.get(c.name) ?? 0;
              const ch = vs && before ? delta(c.total, before) : null;
              return (
                <li key={c.name}>
                  <CatIcon name={c.name} size={12} />
                  <span className="fz-rep-cat-main">
                    <span>
                      <strong>{c.name}</strong>
                      <small>{percent(c.total / (t.gross || 1))}</small>
                    </span>
                    <i aria-hidden="true">
                      <i
                        style={{
                          width: (c.total / topCat) * 100 + '%',
                          background: catColor(c.name),
                        }}
                      />
                    </i>
                  </span>
                  <b>{money(c.total)}</b>
                  <em className={ch == null ? '' : ch > 0 ? 'bad' : 'good'}>
                    {ch == null
                      ? before
                        ? ''
                        : vs
                          ? 'Nuevo'
                          : ''
                      : `${ch > 0 ? '+' : '−'}${percent(Math.abs(ch))}`}
                  </em>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {biggest.length > 0 && (
        <section className="fz-rep-sec">
          <h4>Tus gastos más grandes</h4>
          <ol className="fz-rep-big">
            {biggest.map((e, i) => (
              <li key={e.id}>
                <button type="button" onClick={() => onOpen(e)}>
                  <span className="fz-rep-rank">{i + 1}</span>
                  <span className="fz-rep-big-main">
                    <strong>{e.title || categoryOf(e)}</strong>
                    <small>
                      {friendlyDate(dayOf(e))} · {categoryOf(e)}
                    </small>
                  </span>
                  <b>{money(costOf(e))}</b>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {insights.length > 0 && (
        <section className="fz-rep-sec">
          <h4>Lo que dicen tus números</h4>
          <ul className="fz-insights fz-rep-insights">
            {insights.map((i) => (
              <li key={i.key}>
                <span>{i.icon}</span>
                <p>{i.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </FinSheet>
  );
}
