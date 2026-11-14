import { useState } from 'react';
import {
  CalendarClock,
  HandCoins,
  LayoutDashboard,
  ListOrdered,
  NotebookPen,
  PenLine,
  Plus,
  Settings2,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { DebtsTab } from '../finance/Debts';
import { GoalsTab } from '../finance/Goals';
import { InvestmentsTab } from '../finance/Investments';
import { LetterTab } from '../finance/Letter';
import { MovementsTab } from '../finance/Movements';
import { periodAt, type Period } from '../finance/money';
import { NotesTab, QuickNoteSheet, rememberOpenNote } from '../finance/Notes';
import { PocketsTab } from '../finance/Pockets';
import { RecurringTab } from '../finance/Recurring';
import { SettingsTab } from '../finance/Settings';
import { FINANCE_MIGRATION, FINANCE_MORE_MIGRATION, useFinance } from '../finance/store';
import { SummaryTab } from '../finance/Summary';
import { readTab, saveTab, type FinTab } from '../finance/ui';
import '../finance/finance.css';
import '../finance/finance-plus.css';

/**
 * Pestañas en una sola línea: «Resumen» va solo con su ícono; con poco espacio se usan los nombres
 * cortos y, más estrecho aún, solo los íconos (el nombre queda en el título y para lectores).
 */
const tabList: { key: FinTab; label: string; short?: string; icon: typeof Plus; iconOnly?: boolean }[] = [
  { key: 'resumen', label: 'Resumen', icon: LayoutDashboard, iconOnly: true },
  { key: 'movimientos', label: 'Movimientos', icon: ListOrdered },
  { key: 'apuntes', label: 'Apuntes', icon: NotebookPen },
  { key: 'bolsillos', label: 'Bolsillos', icon: Wallet },
  { key: 'proyeccion', label: 'Carta del mes', short: 'Carta', icon: PenLine },
  { key: 'deudas', label: 'Cobros y deudas', short: 'Cobros', icon: HandCoins },
  { key: 'inversiones', label: 'Inversiones', icon: TrendingUp },
  { key: 'fijos', label: 'Fijos', icon: CalendarClock },
  { key: 'metas', label: 'Metas y compras', short: 'Metas', icon: Target },
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

/** Pestañas que necesitan la segunda migración (bolsillos, apuntes y cobros por partes). */
const needsMore: FinTab[] = ['apuntes', 'bolsillos', 'deudas'];

export function FinancePage() {
  const { openEntry } = useApp();
  const fin = useFinance();
  const [tab, setTabRaw] = useState<FinTab>(readTab);
  const [period, setPeriodRaw] = useState<Period>(readPeriod);
  const [quickNote, setQuickNote] = useState(false);
  const [notesKey, setNotesKey] = useState(0);
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
        <div className="fz-head-actions">
          <button type="button" className="fz-btn ghost" onClick={() => setQuickNote(true)} title="Escribe un apunte o sigue en uno de los últimos">
            <NotebookPen size={16} /> Apunte rápido
          </button>
          <button type="button" className="fz-btn primary" onClick={() => openEntry('Movimiento', [])}>
            <Plus size={17} /> Nuevo movimiento
          </button>
        </div>
      </header>

      <nav className="fz-tabs" aria-label="Secciones de Finanzas">
        {tabList.map(({ key, label, short, icon: Icon, iconOnly }) => (
          <button
            type="button"
            key={key}
            className={(tab === key ? 'on' : '') + (iconOnly ? ' icon-only' : '')}
            aria-current={tab === key ? 'page' : undefined}
            aria-label={label}
            title={label}
            onClick={() => setTab(key)}
          >
            <Icon size={15} />
            {!iconOnly && (
              <span className="fz-tab-label" aria-hidden="true">
                <span className="long">{label}</span>
                <span className="short">{short ?? label}</span>
              </span>
            )}
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
      {!fin.missing && fin.upgrade && needsMore.includes(tab) && (
        <div className="fz-notice" role="status">
          Para guardar bolsillos, tarjetas, apuntes y cobros por partes ejecuta <code>{FINANCE_MORE_MIGRATION}</code> en el
          SQL Editor de Supabase. Lo demás sigue funcionando.
        </div>
      )}
      {fin.error && <div className="fz-notice bad">{fin.error}</div>}

      {tab === 'resumen' && <SummaryTab period={period} setPeriod={setPeriod} go={setTab} />}
      {tab === 'movimientos' && <MovementsTab period={period} setPeriod={setPeriod} />}
      {tab === 'apuntes' && <NotesTab key={notesKey} />}
      {tab === 'bolsillos' && <PocketsTab />}
      {tab === 'proyeccion' && <LetterTab />}
      {tab === 'deudas' && <DebtsTab />}
      {tab === 'inversiones' && <InvestmentsTab />}
      {tab === 'fijos' && <RecurringTab />}
      {tab === 'metas' && <GoalsTab />}
      {tab === 'ajustes' && <SettingsTab />}

      {quickNote && (
        <QuickNoteSheet
          onClose={() => setQuickNote(false)}
          onOpenFull={(id) => {
            if (id) rememberOpenNote(id);
            setQuickNote(false);
            setNotesKey((k) => k + 1);
            setTab('apuntes');
          }}
        />
      )}
    </div>
  );
}
