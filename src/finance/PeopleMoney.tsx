import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, CircleDollarSign, Plus, UserRound, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import type { Person } from '../data';
import { money, shortDate } from '../lib/format';
import { relativeDay } from '../lib/people';
import {
  moneyByPerson,
  moneyRoleList,
  moneyRoles,
  type MoneyRole,
  type PersonMoney,
} from '../lib/personMoney';
import { Avatar } from '../people/Avatar';
import { categoryOf, dayOf, periodAt, periodLabel, type Period } from './money';
import { PeriodBar } from './PeriodBar';
import './finance.css';
import './people-money.css';

/** Ícono de «dinero con personas»: una persona con una moneda. */
export function PersonMoneyIcon({ size = 17 }: { size?: number }) {
  return (
    <span className="pmi" style={{ width: size + 4, height: size + 2 }} aria-hidden="true">
      <UserRound size={size} />
      <CircleDollarSign size={Math.round(size * 0.62)} className="pmi-coin" />
    </span>
  );
}

/** Lo que se abre encima: Esc es para eso (la ficha de alguien, un recuerdo, un formulario). */
const ABOVE = '.nx-peek, .modal-backdrop, .sheet-backdrop:not(:has(> .sheet.pmd))';
const PERIOD_KEY = 'nexo-people-money-period';

function readPeriod(): Period {
  try {
    const p = JSON.parse(sessionStorage.getItem(PERIOD_KEY) ?? '') as Period;
    if (p?.kind && p.from) return periodAt(p.kind, p.from);
  } catch {
    /* por defecto, todo */
  }
  return periodAt('todo');
}

const count = (n: number, role: MoneyRole) =>
  `${n} ${role === 'juntos' ? (n === 1 ? 'gasto' : 'gastos') : n === 1 ? 'pago' : 'pagos'}`;

/**
 * Dinero con personas: a quién le pagas (pagos, regalos, trabajos y servicios), quién te paga y
 * cuánto gastan juntos. Cada persona se abre en sus movimientos; todo enlaza con su ficha.
 */
export function PeopleMoneyDialog({ focus, onClose }: { focus?: string; onClose: () => void }) {
  const { workspace, viewEntry, peekPerson, openEntry } = useApp();
  const [period, setPeriodRaw] = useState<Period>(readPeriod);
  const setPeriod = (p: Period) => {
    sessionStorage.setItem(PERIOD_KEY, JSON.stringify(p));
    setPeriodRaw(p);
  };
  const byPerson = useMemo(
    () => moneyByPerson(workspace.entries, period),
    [workspace.entries, period],
  );
  // Abre en el lado donde hay algo (con la persona elegida, si viene de su ficha).
  const [role, setRole] = useState<MoneyRole>(() => {
    const m = focus ? byPerson.get(focus) : undefined;
    const has = (r: MoneyRole) => (m ? m[r].n > 0 : [...byPerson.values()].some((x) => x[r].n > 0));
    return moneyRoleList.find(has) ?? 'pago';
  });
  const [open, setOpen] = useState<string | null>(focus ?? null);
  const list = useRef<HTMLDivElement>(null);

  const people = new Map(workspace.people.map((p) => [p.id, p]));
  const sums = Object.fromEntries(
    moneyRoleList.map((r) => [r, [...byPerson.values()].reduce((s, m) => s + m[r].total, 0)]),
  ) as Record<MoneyRole, number>;
  const rows = [...byPerson.entries()]
    .flatMap(([id, m]) => {
      const p = people.get(id);
      return p && m[role].n > 0 ? [{ person: p, m }] : [];
    })
    .sort((a, b) => b.m[role].total - a.m[role].total);
  const total = sums[role];
  const top = rows[0];
  const meta = moneyRoles[role];

  // La persona que viene de su ficha queda a la vista.
  useEffect(() => {
    if (!focus) return;
    requestAnimationFrame(() =>
      list.current
        ?.querySelector(`[data-person="${focus}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  }, []);

  const newMove = (p?: Person) =>
    openEntry(
      'Movimiento',
      p ? [p.id] : [],
      role === 'cobro'
        ? { flow: 'ingreso' }
        : role === 'pago'
          ? { flow: 'gasto', paidTo: true }
          : { flow: 'gasto', paidTo: false },
    );

  return (
    <Sheet
      label="Dinero con personas"
      className="fz-sheet pmd"
      yieldTo={ABOVE}
      onRequestClose={onClose}
    >
      <header className="pmd-head">
        <span className="pmd-icon">
          <PersonMoneyIcon size={20} />
        </span>
        <div>
          <h3>Dinero con personas</h3>
          <p>{periodLabel(period)}</p>
        </div>
        <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="pmd-roles" role="tablist" aria-label="Qué dinero">
        {moneyRoleList.map((r) => {
          const m = moneyRoles[r];
          return (
            <button
              type="button"
              role="tab"
              key={r}
              aria-selected={role === r}
              className={role === r ? 'on' : ''}
              style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
              onClick={() => setRole(r)}
            >
              <span>{m.many}</span>
              <b>{money(sums[r])}</b>
            </button>
          );
        })}
      </div>
      <p className="pmd-hint">{meta.hint}</p>

      <PeriodBar period={period} onChange={setPeriod} />

      <div
        className="pmd-list"
        ref={list}
        style={{ '--c': meta.color, '--s': meta.soft } as CSSProperties}
      >
        {rows.length > 0 && (
          <p className="pmd-sum">
            {money(total)} · {rows.length} {rows.length === 1 ? 'persona' : 'personas'}
            {top && rows.length > 1 && total > 0 && (
              <>
                {' '}
                · {top.person.name.split(' ')[0]} {Math.round((top.m[role].total / total) * 100)} %
              </>
            )}
          </p>
        )}
        {rows.map(({ person: p, m }) => (
          <PersonRow
            key={p.id}
            person={p}
            m={m}
            role={role}
            share={total ? m[role].total / total : 0}
            max={rows[0].m[role].total || 1}
            open={open === p.id}
            onToggle={() => setOpen((o) => (o === p.id ? null : p.id))}
            onEntry={viewEntry}
            onPerson={() => peekPerson(p)}
            onNew={() => newMove(p)}
          />
        ))}
        {!rows.length && (
          <div className="pmd-empty">
            <PersonMoneyIcon size={22} />
            <p>
              {role === 'pago'
                ? 'Aquí aparece a quién le pagas: un servicio, un trabajo, un regalo. Al registrar un gasto con alguien, marca «Se lo pagué a…».'
                : role === 'cobro'
                  ? 'Aquí aparece quién te paga o te devuelve plata.'
                  : 'Aquí aparecen las salidas y los planes que pagan juntos.'}
            </p>
            <button type="button" className="fz-btn ghost sm" onClick={() => newMove()}>
              <Plus size={14} /> Registrar
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function PersonRow({
  person: p,
  m,
  role,
  share,
  max,
  open,
  onToggle,
  onEntry,
  onPerson,
  onNew,
}: {
  person: Person;
  m: PersonMoney;
  role: MoneyRole;
  share: number;
  max: number;
  open: boolean;
  onToggle: () => void;
  onEntry: (e: PersonMoney['lines'][number]['entry']) => void;
  onPerson: () => void;
  onNew: () => void;
}) {
  const side = m[role];
  const lines = m.lines.filter((l) => l.role === role);
  const last = lines[0] ? dayOf(lines[0].entry) : null;
  const cats = role === 'pago' ? m.categories.slice(0, 2).map((c) => c.name) : [];
  const others = (['pago', 'cobro', 'juntos'] as MoneyRole[]).filter(
    (r) => r !== role && m[r].n > 0,
  );
  return (
    <div className={'pmd-row' + (open ? ' open' : '')} data-person={p.id}>
      <button type="button" className="pmd-row-main" aria-expanded={open} onClick={onToggle}>
        <Avatar person={p} size={36} />
        <span className="pmd-who">
          <strong>{p.name}</strong>
          <small>
            {[count(side.n, role), last && relativeDay(last).toLowerCase(), ...cats]
              .filter(Boolean)
              .join(' · ')}
          </small>
          <i className="pmd-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(3, (side.total / max) * 100)}%` }} />
          </i>
        </span>
        <span className="pmd-amount">
          <b>{money(side.total)}</b>
          <small>{Math.round(share * 100)} %</small>
        </span>
        <ChevronDown size={15} className="pmd-chev" />
      </button>
      {open && (
        <div className="pmd-detail">
          {others.length > 0 && (
            <div className="pmd-others">
              {others.map((r) => (
                <span
                  key={r}
                  style={{ '--c': moneyRoles[r].color, '--s': moneyRoles[r].soft } as CSSProperties}
                >
                  {moneyRoles[r].label} <b>{money(m[r].total)}</b>
                </span>
              ))}
            </div>
          )}
          <ol className="pmd-lines">
            {lines.slice(0, 30).map(({ entry: e, amount }) => (
              <li key={e.id}>
                <button type="button" onClick={() => onEntry(e)}>
                  <span>
                    <strong>{e.title}</strong>
                    <small>
                      {categoryOf(e)} · {shortDate(e.created_at)}
                    </small>
                  </span>
                  <b>
                    {role === 'cobro' ? '+' : '−'}
                    {money(amount)}
                  </b>
                </button>
              </li>
            ))}
          </ol>
          <div className="pmd-actions">
            <button type="button" className="fz-btn ghost sm" onClick={onPerson}>
              <UserRound size={14} /> Ver ficha
            </button>
            <button type="button" className="fz-btn ghost sm" onClick={onNew}>
              <Plus size={14} /> {role === 'cobro' ? 'Registrar un pago suyo' : 'Registrar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
