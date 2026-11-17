import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Link2,
  NotebookPen,
  Palette,
  Pin,
  PinOff,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { useDismiss } from '../hooks/useDismiss';
import { expenseCategories, incomeCategories } from '../composer/logic';
import { guessCategory } from '../lib/captureCategories';
import { friendlyDate, money, normalizeText, todayInputValue } from '../lib/format';
import { CatIcon } from './catIcons';
import { CategoryPanel } from './CategoryPicker';
import { itemsOf, noteTints, type FinItem, type FinNote, type NoteTint } from './model';
import { calcNote, noteSegments, noteTitle, type NoteHit } from './noteCalc';
import { dayOf, moneyShort, signed } from './money';
import { createItem, financeState, removeItem, restoreItem, settingsOf, updateItem, useFinance } from './store';
import { Empty, EpisodeSelect, FinSheet, moneyInput } from './ui';

const OPEN_KEY = 'nexo-fin-note';
const tintLabel: Record<NoteTint, string> = {
  papel: 'Papel',
  menta: 'Menta',
  cielo: 'Cielo',
  rosa: 'Rosa',
  arena: 'Arena',
  lila: 'Lila',
};
const sample = `Viaje a Santa Marta:
Ahorro que tengo $1,2M
Tiquetes -$480k
Hotel 3 noches -$180k x3
Comidas -$60k x4

Esta semana:
Me deben de la venta $350.000
Mercado -$185.000
Gasolina -$90k`;

const blank = (text = ''): FinNote => ({ text, tint: 'papel', done: {} });
const updatedOf = (n: FinItem<'apunte'>) => n.updated_at || n.created_at;

/** Apuntes: escribe como en una libreta; los montos con «$» se suman (y restan) solos. */
export function NotesTab() {
  const { notify } = useApp();
  const fin = useFinance();
  const notes = itemsOf(fin.items, 'apunte').sort((a, b) =>
    a.data.pinned === b.data.pinned ? updatedOf(b).localeCompare(updatedOf(a)) : a.data.pinned ? -1 : 1,
  );
  const [openId, setOpenRaw] = useState<string | null>(() => sessionStorage.getItem(OPEN_KEY));
  const [query, setQuery] = useState('');
  const live = useRef<{ id: string; empty: boolean } | null>(null);
  const current = notes.find((n) => n.id === openId) ?? null;
  // Al llegar, se abre el último apunte (en pantallas grandes).
  useEffect(() => {
    if (!openId && notes.length && window.matchMedia('(min-width: 721px)').matches) setOpenRaw(notes[0].id);
  }, [notes.length]);

  /** Cambiar de apunte: el que quedó vacío se va solo. */
  const open = (id: string | null) => {
    const was = live.current;
    if (was && was.empty && was.id !== id) {
      const it = itemsOf(financeState().items, 'apunte').find((n) => n.id === was.id);
      if (it) void removeItem(it);
    }
    live.current = null;
    if (id) sessionStorage.setItem(OPEN_KEY, id);
    else sessionStorage.removeItem(OPEN_KEY);
    setOpenRaw(id);
  };
  const create = async (text = '') => {
    const r = await createItem('apunte', '', blank(text));
    if (typeof r === 'string') return notify(r);
    open(r.id);
  };

  const q = normalizeText(query.trim());
  const shown = q ? notes.filter((n) => normalizeText(n.title + ' ' + n.data.text).includes(q)) : notes;

  if (!notes.length)
    return (
      <div className="fz-notes-empty">
        <Empty
          icon={<NotebookPen size={22} />}
          title="Apuntes con calculadora"
          text="Escribe como en una libreta: «Me pagaron $250.000», «Arriendo -$1,2M», «Almuerzos -$18k x5». Todo monto con $ se suma solo; con «-» junto al $ resta. Termina una línea con «:» y tendrás subtotales."
        >
          <div className="fz-row-tools">
            <button type="button" className="fz-btn primary" onClick={() => void create()}>
              <Plus size={16} /> Nuevo apunte
            </button>
            <button type="button" className="fz-btn ghost" onClick={() => void create(sample)}>
              Ver un ejemplo
            </button>
          </div>
        </Empty>
      </div>
    );

  return (
    <div className={'fz-notes' + (current ? ' has-open' : '')}>
      <aside className="fz-notes-list" aria-label="Tus apuntes">
        <div className="fz-notes-tools">
          <label className="fz-search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en tus apuntes" aria-label="Buscar apuntes" />
            {query && (
              <button type="button" aria-label="Limpiar" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </label>
          <button type="button" className="fz-btn primary sm" onClick={() => void create()}>
            <Plus size={14} /> Nuevo
          </button>
        </div>
        <ul>
          {shown.map((n) => {
            const calc = calcNote(n.data.text);
            const title = noteTitle(n.title, n.data.text);
            const preview = n.data.text
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .filter((l) => l.replace(/:$/, '') !== title)
              .slice(0, 2)
              .join(' · ');
            return (
              <li key={n.id}>
                <button type="button" className={'fz-note-card tint-' + n.data.tint + (n.id === openId ? ' on' : '')} onClick={() => open(n.id)}>
                  <span className="fz-note-card-head">
                    <strong>{title}</strong>
                    {n.data.pinned && <Pin size={12} />}
                  </span>
                  {preview && <span className="fz-note-card-text">{preview}</span>}
                  <span className="fz-note-card-foot">
                    <small>{friendlyDate(dayOf({ created_at: updatedOf(n) }))}</small>
                    {calc.hits.length > 0 && <b className={calc.total < 0 ? 'out' : 'in'}>{calc.total < 0 ? '−' + moneyShort(-calc.total) : moneyShort(calc.total)}</b>}
                  </span>
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="fz-muted">Nada con «{query}».</li>}
        </ul>
      </aside>
      {current ? (
        <NoteEditor key={current.id} item={current} onBack={() => open(null)} onLive={(empty) => (live.current = { id: current.id, empty })} />
      ) : (
        <div className="fz-note-none">
          <NotebookPen size={22} />
          <p>Elige un apunte o empieza uno nuevo.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Área de texto con los montos marcados detrás (mismo tamaño y letra, así coinciden). Las marcas
 * solo se ven con `marks`.
 */
function CalcArea({
  value,
  onChange,
  hits,
  placeholder,
  compact = false,
  marks = false,
  autoFocus = false,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  hits: NoteHit[];
  placeholder: string;
  compact?: boolean;
  /** Resaltar los montos en el texto. */
  marks?: boolean;
  autoFocus?: boolean;
  /** Ctrl/⌘ + Enter. */
  onSubmit?: () => void;
}) {
  const segs = noteSegments(value, hits);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    // Después de que la ventana tome el foco (lo hace al abrirse), el cursor queda al final del texto.
    const t = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }, 40);
    return () => window.clearTimeout(t);
  }, [autoFocus]);
  return (
    <div className={'fz-calc-area' + (compact ? ' compact' : '') + (marks ? ' marks' : '')}>
      <div className="fz-calc-mirror" aria-hidden="true">
        {segs.map((s, i) =>
          s.hit ? (
            <mark key={i} className={s.hit.value < 0 ? 'minus' : 'plus'}>
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
        {'\u200b'}
      </div>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        maxLength={20000}
        placeholder={placeholder}
        aria-label="Apunte"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (onSubmit && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
}

/** El color del apunte: un ícono de paleta que abre las opciones al lado de los demás botones. */
function TintPicker({ value, onChange }: { value: NoteTint; onChange: (t: NoteTint) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  return (
    <span ref={ref} className="fz-tint-pick">
      <button
        type="button"
        className="fz-icon"
        aria-label="Color del apunte"
        aria-haspopup="true"
        aria-expanded={open}
        data-tip={open ? undefined : 'Color'}
        onClick={() => setOpen((v) => !v)}
      >
        <Palette size={15} />
      </button>
      {open && (
        <div className="fz-tint-pop" role="radiogroup" aria-label="Color del apunte">
          <small>Color · {tintLabel[value]}</small>
          <div>
            {noteTints.map((t) => (
              <button
                type="button"
                role="radio"
                aria-checked={value === t}
                aria-label={tintLabel[t]}
                data-tip={tintLabel[t]}
                key={t}
                className={'tint-' + t + (value === t ? ' on' : '')}
                onClick={() => {
                  onChange(t);
                  close();
                }}
              >
                {value === t && <Check size={12} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Abre un apunte en la pestaña Apuntes (lo lee al montarse). */
export const rememberOpenNote = (id: string) => sessionStorage.setItem(OPEN_KEY, id);

/**
 * Apunte rápido (desde el encabezado de Finanzas): escribe uno nuevo o sigue en uno de los tres
 * últimos, con su total al momento, sin salir de donde estás.
 */
export function QuickNoteSheet({ onClose, onOpenFull }: { onClose: () => void; onOpenFull: (id: string) => void }) {
  const { notify } = useApp();
  const fin = useFinance();
  const recent = itemsOf(fin.items, 'apunte')
    .sort((a, b) => updatedOf(b).localeCompare(updatedOf(a)))
    .slice(0, 3);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [base, setBase] = useState({ title: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const calc = useMemo(() => calcNote(text), [text]);
  const dirty = title !== base.title || text !== base.text;
  const empty = !title.trim() && !text.trim();

  /** Guarda lo escrito; devuelve el id del apunte (null si falló o no había nada). */
  const save = async (): Promise<string | null> => {
    if (empty) return noteId;
    if (!dirty && noteId) return noteId;
    setBusy(true);
    const current = noteId ? itemsOf(financeState().items, 'apunte').find((n) => n.id === noteId) : undefined;
    const r = current ? await updateItem(current, { title, data: { text } }) : await createItem('apunte', title, blank(text));
    setBusy(false);
    if (typeof r === 'string') {
      notify(r);
      return null;
    }
    const id = current ? current.id : (r as FinItem<'apunte'>).id;
    setNoteId(id);
    setBase({ title, text });
    return id;
  };
  const pick = async (n: FinItem<'apunte'> | null) => {
    if (dirty && !empty && (await save()) === null) return;
    setNoteId(n?.id ?? null);
    setTitle(n?.title ?? '');
    setText(n?.data.text ?? '');
    setBase({ title: n?.title ?? '', text: n?.data.text ?? '' });
    setFocusKey((k) => k + 1);
  };
  const done = async () => {
    const id = await save();
    if (id === null && !empty) return;
    if (!empty) notify(noteId ? 'Apunte actualizado.' : 'Apunte guardado.');
    onClose();
  };
  const full = async () => {
    const id = await save();
    if (id) onOpenFull(id);
    else if (empty) onOpenFull('');
  };

  return (
    <FinSheet
      title="Apunte rápido"
      sub="Los montos con $ se suman solos; con «-» junto al $ restan."
      onClose={onClose}
      className="fz-quick-note"
      footer={
        <>
          <span className={'fz-foot-note fz-qn-total' + (calc.total < 0 ? ' down' : calc.total > 0 ? ' up' : '')}>
            {calc.hits.length ? (
              <>
                Total <b>{calc.total < 0 ? '−' + money(-calc.total) : money(calc.total)}</b>
                <small>
                  {calc.hits.length} {calc.hits.length === 1 ? 'monto' : 'montos'}
                </small>
              </>
            ) : (
              <small>Ctrl + Enter para guardar</small>
            )}
          </span>
          <button type="button" className="fz-btn ghost" disabled={busy} onClick={() => void full()}>
            Abrir en Apuntes
          </button>
          <button type="button" className="fz-btn primary" disabled={busy || empty} onClick={() => void done()}>
            Guardar
          </button>
        </>
      }
    >
      {recent.length > 0 && (
        <div className="fz-qn-recent" role="radiogroup" aria-label="Seguir en un apunte">
          <button type="button" role="radio" aria-checked={noteId === null} className={'fz-qn-new' + (noteId === null ? ' on' : '')} onClick={() => void pick(null)}>
            <Plus size={14} /> Nuevo
          </button>
          {recent.map((n) => {
            const c = calcNote(n.data.text);
            return (
              <button
                type="button"
                role="radio"
                aria-checked={noteId === n.id}
                key={n.id}
                className={'fz-qn-card tint-' + n.data.tint + (noteId === n.id ? ' on' : '')}
                title={noteTitle(n.title, n.data.text)}
                onClick={() => void pick(n)}
              >
                <strong>{noteTitle(n.title, n.data.text)}</strong>
                <small>
                  <span>{friendlyDate(dayOf({ created_at: updatedOf(n) }))}</span>
                  {c.hits.length > 0 && (
                    <b className={c.total < 0 ? 'out' : 'in'}>· {c.total < 0 ? '−' + moneyShort(-c.total) : moneyShort(c.total)}</b>
                  )}
                </small>
              </button>
            );
          })}
        </div>
      )}
      <div className="fz-qn-paper tint-papel">
        <input
          className="fz-note-title"
          value={title}
          maxLength={200}
          placeholder="Título (opcional)"
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Título del apunte"
        />
        <CalcArea
          key={focusKey}
          compact
          autoFocus
          value={text}
          onChange={setText}
          hits={calc.hits}
          onSubmit={() => void done()}
          placeholder={'Mercado -$185.000\nMe pagaron $250k\nAlmuerzos -$18k x5'}
        />
      </div>
      {calc.sections.length > 0 && (
        <ul className="fz-qn-sections">
          {calc.sections.map((s) => (
            <li key={s.title}>
              {s.title} <b className={s.total < 0 ? 'out' : 'in'}>{signed(s.total)}</b>
            </li>
          ))}
        </ul>
      )}
    </FinSheet>
  );
}

function NoteEditor({ item, onBack, onLive }: { item: FinItem<'apunte'>; onBack: () => void; onLive: (empty: boolean) => void }) {
  const { workspace, notify, createEntry, viewEntry, editEntry, confirm } = useApp();
  const fin = useFinance();
  const [title, setTitle] = useState(item.title);
  const [text, setText] = useState(item.data.text);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [links, setLinks] = useState(Boolean(item.data.episodeId || item.data.pocketId));
  const [asking, setAsking] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<{ title: string; text: string } | null>(null);
  const calc = useMemo(() => calcNote(text), [text]);
  const pockets = itemsOf(fin.items, 'bolsillo').filter((p) => !p.archived || p.id === item.data.pocketId);

  const flush = () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const now = itemsOf(financeState().items, 'apunte').find((n) => n.id === item.id);
    if (!now) return;
    setSaved('saving');
    void updateItem(now, { title: p.title, data: { text: p.text } }).then((r) => {
      if (r !== true) {
        notify(r);
        setSaved('idle');
      } else setSaved('saved');
    });
  };
  const change = (next: { title?: string; text?: string }) => {
    const t = next.title ?? title;
    const x = next.text ?? text;
    if (next.title !== undefined) setTitle(t);
    if (next.text !== undefined) setText(x);
    onLive(!t.trim() && !x.trim());
    pending.current = { title: t, text: x };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 650);
  };
  useEffect(() => {
    onLive(!item.title.trim() && !item.data.text.trim());
    return flush;
  }, []);

  const patch = (data: Partial<FinNote>) => {
    const now = itemsOf(financeState().items, 'apunte').find((n) => n.id === item.id) ?? item;
    void updateItem(now, { data }).then((r) => r !== true && notify(r));
  };

  /** La categoría que sugiere el concepto (y su línea); sin una clara, ninguna. */
  const categoryOf = (h: NoteHit, dir: 'egreso' | 'ingreso') => {
    const line = text.split('\n')[h.line] ?? '';
    const g = guessCategory({ local: h.label, clause: line, whole: text, direction: dir, entries: workspace.entries });
    return g.category !== 'Otro' ? g.category : undefined;
  };
  /** Las categorías que elegiste para un monto al registrarlo en lote (si no, la que se adivina). */
  const [batchCats, setBatchCats] = useState<Record<string, string[]>>({});
  const catsFor = (h: NoteHit, dir: 'egreso' | 'ingreso') => {
    const chosen = batchCats[h.key];
    if (chosen) return chosen;
    const g = categoryOf(h, dir);
    return g ? [g] : [];
  };
  /** Cómo se detectó: con «-» es un gasto; sin él, un ingreso. */
  const dirOf = (h: NoteHit): 'egreso' | 'ingreso' => (h.value < 0 ? 'egreso' : 'ingreso');
  const inputFor = (h: NoteHit, dir: 'egreso' | 'ingreso', cats = catsFor(h, dir)) =>
    moneyInput({
      title: h.label.slice(0, 180),
      amount: Math.abs(h.value),
      direction: dir,
      date: todayInputValue(),
      tags: cats,
      details: { flow: dir === 'egreso' ? 'gasto' : 'ingreso', ...(item.data.pocketId && { pocketId: item.data.pocketId }) },
      episodeId: item.data.episodeId,
    });
  const settings = settingsOf(fin.items);
  const catOptions = (dir: 'egreso' | 'ingreso') =>
    dir === 'egreso'
      ? [...expenseCategories.filter((x) => x !== 'Ahorro' && x !== 'Otro'), ...settings.extraOut, 'Otro']
      : [...incomeCategories.filter((x) => x !== 'Reembolso' && x !== 'Otro'), ...settings.extraIn, 'Otro'];
  /** Elegir la categoría: al registrar un monto (`batch` falso) o al cambiarla en el lote. */
  const [catAsk, setCatAsk] = useState<{ h: NoteHit; dir: 'egreso' | 'ingreso'; anchor: HTMLElement; batch: boolean } | null>(null);

  const register = async (h: NoteHit, dir: 'egreso' | 'ingreso', cats?: string[]) => {
    setAsking(null);
    setCatAsk(null);
    const e = await createEntry(inputFor(h, dir, cats), true);
    if (!e) return;
    const now = itemsOf(financeState().items, 'apunte').find((n) => n.id === item.id) ?? item;
    await updateItem(now, { data: { done: { ...now.data.done, [h.key]: e.id } } });
    notify(`${dir === 'egreso' ? 'Gasto' : 'Ingreso'} de ${money(Math.abs(h.value))} registrado.`, { label: 'Editar', run: () => editEntry(e) });
  };

  // Registrar en lote: «Seleccionar todos» marca lo que falta; se puede desmarcar antes.
  const [picking, setPicking] = useState<ReadonlySet<string> | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const toggle = (key: string) =>
    setPicking((s) => {
      if (!s) return s;
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const registerMany = async (list: NoteHit[]) => {
    if (batchBusy || !list.length) return;
    setBatchBusy(true);
    const made: Record<string, string> = {};
    let out = 0;
    let got = 0;
    for (const h of list) {
      const dir = dirOf(h);
      const e = await createEntry(inputFor(h, dir), true);
      if (!e) break;
      made[h.key] = e.id;
      if (dir === 'egreso') out++;
      else got++;
    }
    const n = out + got;
    if (n) {
      const now = itemsOf(financeState().items, 'apunte').find((x) => x.id === item.id) ?? item;
      await updateItem(now, { data: { done: { ...now.data.done, ...made } } });
    }
    setBatchBusy(false);
    setPicking(null);
    if (!n) return notify('No se pudo registrar ninguno.');
    const what = [out && plural(out, 'gasto', 'gastos'), got && plural(got, 'ingreso', 'ingresos')].filter(Boolean).join(' y ');
    notify(n < list.length ? `Se registraron ${what}; ${list.length - n} no se pudieron guardar.` : `Registrados: ${what}.`);
  };

  const remove = async () => {
    const ok = await confirm({ title: '¿Eliminar este apunte?', message: 'Podrás deshacerlo justo después.', confirmLabel: 'Eliminar', danger: true, icon: 'trash' });
    if (!ok) return;
    window.clearTimeout(timer.current);
    pending.current = null;
    const now = itemsOf(financeState().items, 'apunte').find((n) => n.id === item.id) ?? item;
    const r = await removeItem(now);
    if (r !== true) return notify(r);
    onBack();
    notify('Apunte eliminado.', { label: 'Deshacer', run: () => void restoreItem(now) });
  };

  const copy = async () => {
    const out = `${noteTitle(title, text)}\n\n${text.trim()}\n\nTotal: ${calc.total < 0 ? '−' : ''}${money(Math.abs(calc.total))}`;
    try {
      await navigator.clipboard.writeText(out);
      notify('Apunte copiado con su total.');
    } catch {
      notify('No se pudo copiar.');
    }
  };

  const entryOf = (id?: string) => (id ? workspace.entries.find((e) => e.id === id) : undefined);
  const multiline = calc.sections.length > 0;
  const marks = Boolean(item.data.marks);
  const unregistered = calc.hits.filter((h) => !entryOf(item.data.done[h.key]));
  const chosen = picking ? unregistered.filter((h) => picking.has(h.key)) : [];
  const allOn = chosen.length === unregistered.length && unregistered.length > 0;
  const chosenOut = chosen.filter((h) => h.value < 0).length;
  const chosenIn = chosen.length - chosenOut;

  return (
    <section className={'fz-note tint-' + item.data.tint}>
      <header className="fz-note-head">
        <button type="button" className="fz-icon fz-note-back" aria-label="Volver a tus apuntes" onClick={onBack}>
          <ArrowLeft size={16} />
        </button>
        <input
          className="fz-note-title"
          value={title}
          maxLength={200}
          placeholder={noteTitle('', text) === 'Apunte sin título' ? 'Título (opcional)' : noteTitle('', text)}
          onChange={(e) => change({ title: e.target.value })}
          aria-label="Título del apunte"
        />
        <span className="fz-row-tools fz-note-tools">
          <span className="fz-note-saved">{saved === 'saving' ? 'Guardando…' : saved === 'saved' ? 'Guardado' : ''}</span>
          <button
            type="button"
            className={'fz-icon' + (item.data.pinned ? ' ok' : '')}
            aria-pressed={Boolean(item.data.pinned)}
            aria-label={item.data.pinned ? 'Quitar de fijados' : 'Fijar en el Resumen'}
            data-tip={item.data.pinned ? 'Quitar de fijados' : 'Fijar en el Resumen'}
            onClick={() => patch({ pinned: item.data.pinned ? undefined : true })}
          >
            {item.data.pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <TintPicker value={item.data.tint} onChange={(tint) => patch({ tint })} />
          <button
            type="button"
            className={'fz-icon' + (links ? ' ok' : '')}
            aria-pressed={links}
            aria-label="Vincular a un episodio o un bolsillo"
            data-tip="Vincular"
            onClick={() => setLinks((v) => !v)}
          >
            <Link2 size={15} />
          </button>
          <button type="button" className="fz-icon" aria-label="Copiar con el total" data-tip="Copiar con el total" onClick={() => void copy()}>
            <Copy size={15} />
          </button>
          <button type="button" className="fz-icon" aria-label="Eliminar apunte" data-tip="Eliminar" onClick={() => void remove()}>
            <Trash2 size={15} />
          </button>
        </span>
      </header>

      {links && (
        <div className="fz-note-links">
          {workspace.episodes.length > 0 && (
            <label>
              <small>Episodio</small>
              <EpisodeSelect episodes={workspace.episodes} value={item.data.episodeId} onChange={(episodeId) => patch({ episodeId })} />
            </label>
          )}
          {pockets.length > 0 && (
            <label>
              <small>Bolsillo</small>
              <select className="fz-input" value={item.data.pocketId ?? ''} onChange={(e) => patch({ pocketId: e.target.value || undefined })}>
                <option value="">Ninguno</option>
                {pockets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.data.emoji} {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!workspace.episodes.length && !pockets.length && <small className="fz-muted">Crea un episodio o un bolsillo para vincularlo.</small>}
        </div>
      )}

      <div className="fz-note-body">
        <div className="fz-note-paper">
          <CalcArea
            value={text}
            onChange={(v) => change({ text: v })}
            hits={calc.hits}
            marks={marks}
            placeholder={'Escribe lo que quieras. Los montos con $ cuentan solos:\n\nMe pagaron $250.000\nAlmuerzo con Laura -$38k\nTaxi -$12.000\nPan -$3.500 x4'}
          />
          <footer className="fz-note-foot">
            <button
              type="button"
              role="switch"
              aria-checked={marks}
              className={'fz-note-switch' + (marks ? ' on' : '')}
              onClick={() => patch({ marks: marks ? undefined : true })}
            >
              <span className="fz-note-switch-track" aria-hidden="true">
                <i />
              </span>
              Resaltar montos
            </button>
            <p className="fz-note-help">
              <b>$5k</b>, <b>$5.000</b> o <b>$1,5M</b> suman · <b>-$5k</b> resta · <b>$15k x3</b> multiplica · una línea que termina en <b>:</b> abre una sección
            </p>
          </footer>
        </div>

        <aside className="fz-note-calc" aria-live="polite">
          <div className={'fz-note-total ' + (calc.total < 0 ? 'neg' : calc.total > 0 ? 'pos' : '')}>
            <span>Total</span>
            <b>{calc.total < 0 ? '−' + money(-calc.total) : money(calc.total)}</b>
            {calc.hits.length > 0 && (
              <small>
                <em className="in">+{moneyShort(calc.plus)}</em> · <em className="out">−{moneyShort(calc.minus)}</em> · {calc.hits.length}{' '}
                {calc.hits.length === 1 ? 'monto' : 'montos'}
              </small>
            )}
          </div>
          {multiline && (
            <ul className="fz-note-sections">
              {calc.sections.map((s) => (
                <li key={s.title}>
                  <span>{s.title}</span>
                  <b className={s.total < 0 ? 'out' : 'in'}>{signed(s.total)}</b>
                </li>
              ))}
            </ul>
          )}
          {calc.hits.length > 0 && (
            <div className="fz-note-hits-head">
              <span>
                Detectados <i>{calc.hits.length}</i>
              </span>
              {picking ? (
                <span className="fz-note-hits-tools">
                  <button type="button" className="fz-note-pick" onClick={() => setPicking(allOn ? new Set() : new Set(unregistered.map((h) => h.key)))}>
                    {allOn ? 'Ninguno' : 'Todos'}
                  </button>
                  <button type="button" className="fz-icon" aria-label="Cancelar la selección" title="Cancelar" onClick={() => setPicking(null)}>
                    <X size={14} />
                  </button>
                </span>
              ) : (
                unregistered.length > 1 && (
                  <button
                    type="button"
                    className="fz-note-pick"
                    title="Marcar todos los que faltan para registrarlos de una vez"
                    onClick={() => {
                      setAsking(null);
                      setPicking(new Set(unregistered.map((h) => h.key)));
                    }}
                  >
                    <CheckCheck size={13} /> Seleccionar todos
                  </button>
                )
              )}
            </div>
          )}
          {calc.hits.length > 0 ? (
            <ul className={'fz-note-hits' + (picking ? ' picking' : '')}>
              {calc.hits.map((h) => {
                const done = entryOf(item.data.done[h.key]);
                if (picking && !done) {
                  const on = picking.has(h.key);
                  const dir = dirOf(h);
                  const cats = catsFor(h, dir);
                  return (
                    <li key={h.key + h.start} className={'pick' + (on ? ' on' : '')}>
                      <button type="button" role="checkbox" aria-checked={on} className="fz-note-hit-btn" onClick={() => toggle(h.key)}>
                        <i className="fz-note-tick" aria-hidden="true">
                          {on && <Check size={11} strokeWidth={3} />}
                        </i>
                        <span className="fz-note-hit-label" title={h.label}>
                          {h.label}
                          <small className="fz-note-hit-kind">
                            <em className={dir === 'egreso' ? 'out' : 'in'}>{dir === 'egreso' ? 'Gasto' : 'Ingreso'}</em>
                          </small>
                        </span>
                        <b className={h.value < 0 ? 'out' : 'in'}>{signed(h.value)}</b>
                      </button>
                      <button
                        type="button"
                        className={'fz-note-hit-cat' + (cats.length ? '' : ' none')}
                        title="Cambiar la categoría"
                        aria-haspopup="dialog"
                        onClick={(ev) => setCatAsk({ h, dir, anchor: ev.currentTarget, batch: true })}
                      >
                        {cats.length ? <CatIcon name={cats[0]} size={11} plain /> : <Tag size={11} />}
                        {cats.length ? cats.join(' · ') : 'Sin categoría'}
                        <ChevronDown size={11} />
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={h.key + h.start} className={done && picking ? 'done' : undefined}>
                    <span className="fz-note-hit-label" title={h.label}>
                      {h.label}
                      {h.times !== 1 && <small> · {money(h.unit)} × {h.times.toLocaleString('es-CO')}</small>}
                    </span>
                    <b className={h.value < 0 ? 'out' : 'in'}>{signed(h.value)}</b>
                    {done ? (
                      <button type="button" className="fz-icon ok" title="Ya es un movimiento (ver)" onClick={() => viewEntry(done)}>
                        <Check size={14} />
                      </button>
                    ) : asking === h.key ? (
                      <span className="fz-note-ask">
                        <button
                          type="button"
                          className={'out' + (catAsk?.h.key === h.key && catAsk.dir === 'egreso' ? ' on' : '')}
                          aria-haspopup="dialog"
                          onClick={(ev) => setCatAsk({ h, dir: 'egreso', anchor: ev.currentTarget, batch: false })}
                        >
                          <ArrowUpRight size={12} /> Gasto
                        </button>
                        <button
                          type="button"
                          className={'in' + (catAsk?.h.key === h.key && catAsk.dir === 'ingreso' ? ' on' : '')}
                          aria-haspopup="dialog"
                          onClick={(ev) => setCatAsk({ h, dir: 'ingreso', anchor: ev.currentTarget, batch: false })}
                        >
                          <ArrowDownLeft size={12} /> Ingreso
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="fz-note-reg" title="Registrar como movimiento" onClick={() => setAsking(h.key)}>
                        Registrar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="fz-muted">Aún no hay montos. Escribe uno con $ y aparece aquí con su cuenta.</p>
          )}
          {picking && (
            <div className="fz-note-batch">
              <small>
                {chosen.length
                  ? [chosenOut && plural(chosenOut, 'gasto', 'gastos'), chosenIn && plural(chosenIn, 'ingreso', 'ingresos')].filter(Boolean).join(' · ')
                  : 'Nada marcado'}
              </small>
              <button type="button" className="fz-btn primary sm" disabled={!chosen.length || batchBusy} onClick={() => void registerMany(chosen)}>
                {batchBusy ? 'Registrando…' : `Registrar ${chosen.length}`}
              </button>
            </div>
          )}
          {catAsk && (
            <CategoryPanel
              key={catAsk.h.key + catAsk.dir + catAsk.batch}
              compact
              context={`${catAsk.h.label.slice(0, 40)} · ${signed(catAsk.h.value)}`}
              anchor={catAsk.anchor}
              align="end"
              options={catOptions(catAsk.dir)}
              value={catsFor(catAsk.h, catAsk.dir)}
              createIn={catAsk.dir === 'egreso' ? 'out' : 'in'}
              title={catAsk.dir === 'egreso' ? 'Categoría del gasto' : 'Categoría del ingreso'}
              confirmLabel={catAsk.batch ? 'Listo' : 'Registrar'}
              onConfirm={(list) => {
                if (catAsk.batch) {
                  setBatchCats((m) => ({ ...m, [catAsk.h.key]: list }));
                  setCatAsk(null);
                } else void register(catAsk.h, catAsk.dir, list);
              }}
              onClose={() => setCatAsk(null)}
            />
          )}
        </aside>
      </div>
    </section>
  );
}
