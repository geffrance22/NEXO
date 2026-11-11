import { useState } from 'react';
import {
  CalendarClock,
  HandCoins,
  LayoutDashboard,
  ListOrdered,
  PenLine,
  Plus,
  Settings2,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { DebtsTab } from '../finance/Debts';
import { GoalsTab } from '../finance/Goals';
import { InvestmentsTab } from '../finance/Investments';
import { LetterTab } from '../finance/Letter';
import { MovementsTab } from '../finance/Movements';
import { periodAt, type Period } from '../finance/money';
import { RecurringTab } from '../finance/Recurring';
import { SettingsTab } from '../finance/Settings';
import { FINANCE_MIGRATION, useFinance } from '../finance/store';
import { SummaryTab } from '../finance/Summary';
import { readTab, saveTab, type FinTab } from '../finance/ui';
import '../finance/finance.css';

const tabList: { key: FinTab; label: string; icon: typeof Plus }[] = [
  { key: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { key: 'movimientos', label: 'Movimientos', icon: ListOrdered },
  { key: 'proyeccion', label: 'Carta del mes', icon: PenLine },
  { key: 'deudas', label: 'Deudas', icon: HandCoins },
  { key: 'inversiones', label: 'Inversiones', icon: TrendingUp },
  { key: 'fijos', label: 'Fijos', icon: CalendarClock },
  { key: 'metas', label: 'Metas y compras', icon: Target },
  { key: 'ajustes', label: 'Ajustes', icon: Settings2 },
];

const PERIOD_KEY = 'nexo-fin-period';
function readPeriod(): Period {
  try {
    const p = JSON.parse(sessionStorage.getItem(PERIOD_KEY) ?? '') as Period;
    if (p && p.kind && p.from) return periodAt(p.kind, p.from);
  } catch {
    /* por defecto, este mes */
  }
  return periodAt('mes');
}

export function FinancePage() {
  const { openEntry } = useApp();
  const fin = useFinance();
  const [tab, setTabRaw] = useState<FinTab>(readTab);
  const [period, setPeriodRaw] = useState<Period>(readPeriod);
  const setTab = (t: FinTab) => {
    saveTab(t);
    setTabRaw(t);
  };
  const setPeriod = (p: Period) => {
    sessionStorage.setItem(PERIOD_KEY, JSON.stringify(p));
    setPeriodRaw(p);
  };

  return (
    <div className="fz">
      <header className="fz-head">
        <div>
          <span className="fz-eyebrow">Finanzas</span>
          <h1>Tus números, con contexto.</h1>
        </div>
        <button type="button" className="fz-btn primary" onClick={() => openEntry('Movimiento', [])}>
          <Plus size={17} /> Nuevo movimiento
        </button>
      </header>

      <nav className="fz-tabs" aria-label="Secciones de Finanzas">
        {tabList.map(({ key, label, icon: Icon }) => (
          <button
            type="button"
            key={key}
            className={tab === key ? 'on' : ''}
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => setTab(key)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {fin.missing && tab !== 'resumen' && tab !== 'movimientos' && (
        <div className="fz-notice" role="status">
          Para deudas, inversiones, la carta del mes, fijos, metas y ajustes ejecuta{' '}
          <code>{FINANCE_MIGRATION}</code> en el SQL Editor de Supabase. Tus movimientos ya funcionan
          sin ella.
        </div>
      )}
      {fin.error && <div className="fz-notice bad">{fin.error}</div>}

      {tab === 'resumen' && <SummaryTab period={period} setPeriod={setPeriod} go={setTab} />}
      {tab === 'movimientos' && <MovementsTab period={period} setPeriod={setPeriod} />}
      {tab === 'proyeccion' && <LetterTab />}
      {tab === 'deudas' && <DebtsTab />}
      {tab === 'inversiones' && <InvestmentsTab />}
      {tab === 'fijos' && <RecurringTab />}
      {tab === 'metas' && <GoalsTab />}
      {tab === 'ajustes' && <SettingsTab />}
    </div>
  );
}
