import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Sheet } from '../components/Sheet';
import type { EntryInput, Episode, Page, Person } from '../data';
import { normalizeText, thousands, todayInputValue } from '../lib/format';
import { evalAmount } from './parse';

export type FinTab =
  | 'resumen'
  | 'movimientos'
  | 'apuntes'
  | 'bolsillos'
  | 'proyeccion'
  | 'deudas'
  | 'inversiones'
  | 'fijos'
  | 'metas'
  | 'ajustes';

const TAB_KEY = 'nexo-fin-tab';
const tabs: FinTab[] = [
  'resumen',
  'movimientos',
  'apuntes',
  'bolsillos',
  'proyeccion',
  'deudas',
  'inversiones',
  'fijos',
  'metas',
  'ajustes',
];

export function readTab(): FinTab {
  const t = sessionStorage.getItem(TAB_KEY) as FinTab | null;
  return t && tabs.includes(t) ? t : 'resumen';
}
export const saveTab = (t: FinTab) => sessionStorage.setItem(TAB_KEY, t);

/** Ir a Finanzas en una pestaña (desde la agenda, Inicio o una ficha). */
export function openFinanceTab(go: (page: Page) => void, tab: FinTab) {
  saveTab(tab);
  go('Finanzas');
}

/** Las fechas se guardan a mediodía de tu zona horaria (como el resto de Nexo). */
export const noonISO = (d: string) => new Date(d + 'T12:00:00').toISOString();

/** Un movimiento listo para guardar, con lo que no se indique vacío. */
export const moneyInput = (
  over: Partial<EntryInput> & Pick<EntryInput, 'title' | 'amount' | 'direction'>,
): EntryInput => ({
  body: '',
  kind: 'Movimiento',
  tags: [],
  personIds: [],
  date: todayInputValue(),
  status: 'pendiente',
  images: [],
  details: {},
  file: null,
  removeFile: false,
  ...over,
});

/** Ventana de Finanzas: título, contenido y pie con las acciones. */
export function FinSheet({
  title,
  sub,
  onClose,
  children,
  footer,
  wide = false,
  className = '',
  icon,
}: {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  /** Ícono junto al título. */
  icon?: ReactNode;
}) {
  return (
    <Sheet label={title} className={'fz-sheet' + (wide ? ' wide' : '') + (className ? ' ' + className : '')} onRequestClose={onClose}>
      <header className="fz-sheet-head">
        {icon && <span className="fz-sheet-icon">{icon}</span>}
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        <button type="button" className="fz-x" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="fz-sheet-body">{children}</div>
      {footer && <footer className="fz-sheet-foot">{footer}</footer>}
    </Sheet>
  );
}

/** Separador con título dentro de un formulario largo. */
export function FormSection({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="fz-form-sec">
      <header>
        <h4>{title}</h4>
        {hint && <small>{hint}</small>}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  wide = false,
  group = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
  /** Varias opciones (fichas): un grupo, no la etiqueta de un solo campo. */
  group?: boolean;
}) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className={'fz-field' + (wide ? ' wide' : '')}>
      <span>
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </Tag>
  );
}

/** Campo de plata: acepta «50k», «1,5 millones» o una cuenta («120.000+35.000»). */
export function MoneyField({
  value,
  onChange,
  placeholder = '0',
  autoFocus = false,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const shown = raw ?? (value ? thousands(value) : '');
  return (
    <span className="fz-money">
      <b>$</b>
      <input
        inputMode="decimal"
        value={shown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onFocus={() => setRaw(shown)}
        onBlur={() => setRaw(null)}
        onChange={(e) => {
          setRaw(e.target.value);
          const n = evalAmount(e.target.value);
          onChange(n && n > 0 ? n : 0);
        }}
      />
    </span>
  );
}

/** Elegir a alguien de tus personas o escribir un nombre. */
export function PersonInput({
  people,
  personId,
  name,
  onChange,
}: {
  people: Person[];
  personId?: string;
  name: string;
  onChange: (v: { personId?: string; name: string }) => void;
}) {
  const id = 'fz-people';
  const current = personId ? people.find((p) => p.id === personId) : undefined;
  return (
    <>
      <input
        className="fz-input"
        list={id}
        value={current?.name ?? name}
        placeholder="Nombre de la persona"
        maxLength={120}
        onChange={(e) => {
          const v = e.target.value;
          const hit = people.find((p) => normalizeText(p.name) === normalizeText(v.trim()));
          onChange({ personId: hit?.id, name: v });
        }}
      />
      <datalist id={id}>
        {people.slice(0, 400).map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
    </>
  );
}

/** Elegir un episodio (los activos primero). */
export function EpisodeSelect({
  episodes,
  value,
  onChange,
}: {
  episodes: Episode[];
  value?: string;
  onChange: (id: string | undefined) => void;
}) {
  const sorted = [...episodes].sort((a, b) =>
    a.status === b.status ? b.created_at.localeCompare(a.created_at) : a.status === 'activo' ? -1 : 1,
  );
  const list = sorted.slice(0, 120);
  const current = value ? episodes.find((e) => e.id === value) : undefined;
  if (current && !list.includes(current)) list.unshift(current);
  return (
    <select className="fz-input" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">Ninguno</option>
      {list.map((ep) => (
        <option key={ep.id} value={ep.id}>
          {ep.title}
          {ep.status === 'cerrado' ? ' (cerrado)' : ''}
        </option>
      ))}
    </select>
  );
}

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="fz-empty">
      <span>{icon}</span>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

/** Descarga un archivo de texto generado aquí (CSV, ICS, JSON). */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** «hace 3 días», «hoy», «en 5 días». */
export function relDays(n: number) {
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}
