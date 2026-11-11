import { useMemo, useState } from 'react';
import { FileUp, LoaderCircle } from 'lucide-react';
import { useApp } from '../AppContext';
import { expenseCategories, incomeCategories } from '../composer/logic';
import type { EntryInput } from '../data';
import { guessCategory } from '../lib/captureCategories';
import { friendlyDate, money, normalizeText } from '../lib/format';
import { defaultAccounts } from './model';
import { dayOf, isMoney, learnedFor } from './money';
import { settingsOf, useFinance } from './store';
import { Field, FinSheet, moneyInput } from './ui';

/** Lee un CSV (con «,», «;» o tabulador y comillas). */
function parseCsv(text: string): string[][] {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const count = (c: string) => (sample.match(new RegExp(c === '\t' ? '\t' : '\\' + c, 'g')) ?? []).length;
  const sep = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/** «$ -1.234.567,89», «-1,234.50», «(12.000)» → número con signo. */
function parseMoney(raw: string): number | null {
  let s = raw.replace(/[^\d,.\-()]/g, '');
  if (!/\d/.test(s)) return null;
  const neg = /^-|-$|^\(.*\)$/.test(s) || /^\s*-/.test(raw);
  s = s.replace(/[-()]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let dec = '';
  if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? '.' : ',';
  else if (lastDot >= 0 || lastComma >= 0) {
    const sepc = lastDot >= 0 ? '.' : ',';
    const tail = s.length - s.lastIndexOf(sepc) - 1;
    if (tail !== 3) dec = sepc;
  }
  const clean = dec ? s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.') : s.replace(/[.,]/g, '');
  const n = Number(clean);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 2026-11-03, 03/11/2026, 3-11-26, 2026/11/03 → AAAA-MM-DD. */
function parseDate(raw: string): string | null {
  const s = raw.trim().slice(0, 20);
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const a = Number(m[1]);
    const b = Number(m[2]);
    // Día primero (como en Colombia), salvo que no pueda serlo.
    const [d, mo] = b > 12 ? [b, a] : [a, b];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

type Cols = { date: number; text: number; amount: number; debit: number; credit: number };
const find = (head: string[], re: RegExp) => head.findIndex((h) => re.test(normalizeText(h)));

function guessCols(rows: string[][]): { headerRow: number; cols: Cols } {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const head = rows[r];
    const date = find(head, /fecha|date|dia\b/);
    const text = find(head, /descrip|concepto|detalle|referencia|movimiento|transacci|comercio|description|narrat/);
    const amount = find(head, /^(valor|monto|importe|amount|cantidad|total)/);
    const debit = find(head, /debito|cargo|retiro|egreso|salida|debit/);
    const credit = find(head, /credito|abono|deposito|ingreso|entrada|credit/);
    if (date >= 0 && (amount >= 0 || debit >= 0 || credit >= 0))
      return { headerRow: r, cols: { date, text: text >= 0 ? text : -1, amount, debit, credit } };
  }
  // Sin encabezado: la primera columna con fecha y la última con número.
  const first = rows[0] ?? [];
  const date = first.findIndex((c) => parseDate(c));
  let amount = -1;
  first.forEach((c, i) => {
    if (i !== date && parseMoney(c) !== null && /\d/.test(c)) amount = i;
  });
  const text = first.findIndex((c, i) => i !== date && i !== amount && /[a-z]/i.test(c));
  return { headerRow: -1, cols: { date, text, amount, debit: -1, credit: -1 } };
}

type Row = {
  key: string;
  date: string;
  title: string;
  amount: number;
  direction: 'ingreso' | 'egreso';
  category: string;
  on: boolean;
  dup: boolean;
};

/** Importar el extracto del banco (CSV): revisas, corriges y se guardan de una vez. */
export function ImportSheet({ onClose }: { onClose: () => void }) {
  const { workspace, createEntries, notify } = useApp();
  const fin = useFinance();
  const settings = settingsOf(fin.items);
  const accounts = (settings.accounts.length ? settings.accounts : defaultAccounts).map((a) => a.name);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [name, setName] = useState('');
  const [cols, setCols] = useState<Cols | null>(null);
  const [headerRow, setHeaderRow] = useState(-1);
  const [invert, setInvert] = useState(false);
  const [method, setMethod] = useState('');
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [busy, setBusy] = useState(false);

  const read = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    const g = guessCols(parsed);
    setName(file.name);
    setRows(parsed);
    setCols(g.cols);
    setHeaderRow(g.headerRow);
    setEdits({});
  };

  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const proposed = useMemo((): Row[] => {
    if (!rows || !cols) return [];
    const out: Row[] = [];
    rows.forEach((r, i) => {
      if (i <= headerRow) return;
      const date = parseDate(r[cols.date] ?? '');
      if (!date) return;
      let value: number | null = null;
      if (cols.amount >= 0) value = parseMoney(r[cols.amount] ?? '');
      else {
        const d = cols.debit >= 0 ? parseMoney(r[cols.debit] ?? '') : null;
        const c = cols.credit >= 0 ? parseMoney(r[cols.credit] ?? '') : null;
        if (d) value = -Math.abs(d);
        else if (c) value = Math.abs(c);
      }
      if (!value) return;
      if (invert) value = -value;
      const title = (cols.text >= 0 ? r[cols.text] : '')?.replace(/\s+/g, ' ').trim().slice(0, 180) || 'Movimiento';
      const amount = Math.round(Math.abs(value));
      const direction = value < 0 ? 'egreso' : 'ingreso';
      const learned = learnedFor(moves, title);
      const guess = guessCategory({ near: title, local: title, clause: title, whole: title, direction, entries: moves });
      const dup = moves.some((e) => dayOf(e) === date && e.amount === amount && e.direction === direction);
      const key = `${i}`;
      out.push({
        key,
        date,
        title,
        amount,
        direction,
        category: learned?.category ?? (guess.category !== 'Otro' ? guess.category : ''),
        on: !dup,
        dup,
        ...edits[key],
      });
    });
    return out;
  }, [rows, cols, headerRow, invert, edits, moves]);

  const chosen = proposed.filter((r) => r.on);
  const head = rows && headerRow >= 0 ? rows[headerRow] : rows?.[0]?.map((_, i) => `Columna ${i + 1}`) ?? [];
  const edit = (key: string, patch: Partial<Row>) => setEdits((e) => ({ ...e, [key]: { ...e[key], ...patch } }));

  const save = async () => {
    if (!chosen.length) return;
    setBusy(true);
    const inputs: EntryInput[] = chosen.map((r) =>
      moneyInput({
        title: r.title,
        amount: r.amount,
        direction: r.direction,
        date: r.date,
        tags: r.category ? [r.category] : [],
        details: { flow: r.direction === 'ingreso' ? 'ingreso' : 'gasto', ...(method && { method }) },
      }),
    );
    const saved = await createEntries(inputs);
    setBusy(false);
    if (saved) {
      notify(`${saved.length} movimientos importados.`);
      onClose();
    }
  };

  const colSelect = (label: string, key: keyof Cols, optional = false) =>
    cols && (
      <Field label={label}>
        <select
          className="fz-input"
          value={cols[key]}
          onChange={(e) => setCols({ ...cols, [key]: Number(e.target.value) })}
        >
          {optional && <option value={-1}>—</option>}
          {head.map((h, i) => (
            <option key={i} value={i}>
              {h || `Columna ${i + 1}`}
            </option>
          ))}
        </select>
      </Field>
    );

  return (
    <FinSheet
      title="Importar extracto"
      sub="Descarga el extracto de tu banco o de Nequi en CSV. Revisas todo antes de guardar."
      onClose={onClose}
      wide
      footer={
        <>
          <span className="fz-foot-note">
            {rows ? `${chosen.length} de ${proposed.length} seleccionados` : 'Nada se guarda hasta que lo confirmes.'}
          </span>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={!chosen.length || busy} onClick={() => void save()}>
            {busy && <LoaderCircle className="spin" size={15} />} Importar {chosen.length || ''}
          </button>
        </>
      }
    >
      <label className="fz-drop">
        <FileUp size={22} />
        <span>
          <b>{name || 'Elige el archivo CSV'}</b>
          <small>{name ? 'Toca para cambiarlo' : 'Fecha, descripción y valor (o débito y crédito)'}</small>
        </span>
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />
      </label>

      {rows && cols && (
        <>
          <div className="fz-form fz-import-cols">
            {colSelect('Fecha', 'date')}
            {colSelect('Concepto', 'text', true)}
            {colSelect('Valor', 'amount', true)}
            {cols.amount < 0 && colSelect('Débito', 'debit', true)}
            {cols.amount < 0 && colSelect('Crédito', 'credit', true)}
            <Field label="Cuenta">
              <select className="fz-input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Sin cuenta</option>
                {accounts.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </Field>
          </div>
          <label className="fz-check">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            Mi banco muestra los gastos en positivo (invertir signos)
          </label>

          {proposed.length ? (
            <div className="fz-import-list">
              {proposed.map((r) => {
                const cats = r.direction === 'ingreso' ? incomeCategories : expenseCategories;
                return (
                  <div key={r.key} className={'fz-import-row' + (r.on ? '' : ' off')}>
                    <input type="checkbox" checked={r.on} onChange={(e) => edit(r.key, { on: e.target.checked })} aria-label="Importar" />
                    <span className="fz-when">{friendlyDate(r.date)}</span>
                    <input className="fz-input" value={r.title} onChange={(e) => edit(r.key, { title: e.target.value })} aria-label="Concepto" />
                    <select className="fz-input" value={r.category} onChange={(e) => edit(r.key, { category: e.target.value })} aria-label="Categoría">
                      <option value="">Sin categoría</option>
                      {cats.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <b className={r.direction === 'ingreso' ? 'in' : 'out'}>
                      {r.direction === 'ingreso' ? '+' : '−'}
                      {money(r.amount)}
                    </b>
                    {r.dup && <em className="fz-chip warn">¿Repetido?</em>}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="fz-muted">No encontré filas con fecha y valor. Revisa qué columna es cuál.</p>
          )}
        </>
      )}
    </FinSheet>
  );
}
