import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, Check, ListPlus, ListTodo, Plus, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { todayInputValue } from '../lib/format';
import { goSection } from '../library/shelf';
import {
  QUICK_MAX,
  QUICK_MIGRATION,
  STALE_DAYS,
  addQuickTask,
  ageOf,
  arrangeQuickTasks,
  dayOf,
  dayTag,
  editQuickTask,
  loadQuickTasks,
  removeQuickTask,
  restoreQuickTask,
  sweepQuickTasks,
  toggleQuickTask,
  useQuickTasks,
  type QuickTask,
} from './quickTasksStore';
import './quickTasks.css';

/** El título de un pendiente completo admite 180 caracteres (ver TaskView). */
const TITLE_MAX = 180;

const longDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const s = new Date(y, m - 1, d).toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Hoy, y se actualiza solo a medianoche o al volver a la pestaña. */
function useToday() {
  const [today, setToday] = useState(todayInputValue);
  useEffect(() => {
    const tick = () => setToday(todayInputValue());
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return today;
}

/**
 * Dónde se muestra: «note», la nota fija de Agenda → Pendientes; «block», el bloque de Mi espacio
 * (centro o lateral); «sheet», la ventana que se abre desde el «+» para apuntar desde cualquier lado.
 */
type Variant = 'note' | 'block' | 'sheet';

/**
 * «Pendientes rápidos de hoy»: apuntar y tachar al vuelo. Lo tachado se queda tachado hoy y se
 * borra mañana; lo que no, pasa al día siguiente al final de la lista, con la etiqueta de su día.
 * Lo que lleva 3 días o más se destaca y se puede pasar a un pendiente completo (o borrar).
 * Tocar el texto lo edita.
 */
export function QuickTasks({
  variant = 'note',
  title = 'Pendientes rápidos de hoy',
  onClose,
}: {
  variant?: Variant;
  title?: string;
  /** Solo en la ventana. */
  onClose?: () => void;
}) {
  const { notify, openEntry, go } = useApp();
  const { list, local, error } = useQuickTasks();
  const today = useToday();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const cancelEdit = useRef(false);
  const addRef = useRef<HTMLInputElement>(null);

  // Con el día nuevo, lo tachado antes de hoy se va.
  const loaded = list !== null;
  useEffect(() => {
    if (loaded) void sweepQuickTasks(today);
  }, [today, loaded]);
  // En la ventana, listo para escribir apenas se abre.
  useEffect(() => {
    if (variant !== 'sheet' || !loaded) return;
    const t = window.setTimeout(() => addRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(t);
  }, [variant, loaded]);

  const { fresh, carried } = useMemo(() => arrangeQuickTasks(list ?? [], today), [list, today]);
  const total = fresh.length + carried.length;
  const done = fresh.filter((t) => t.done_at).length + carried.filter((t) => t.done_at).length;
  const stale = carried.filter(
    (t) => !t.done_at && ageOf(dayOf(t.created_at), today) >= STALE_DAYS,
  ).length;

  const fail = (err: string) => {
    if (err) notify(err);
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    // La línea para escribir baja con la lista: que siga a la vista.
    requestAnimationFrame(() => addRef.current?.scrollIntoView({ block: 'nearest' }));
    fail(await addQuickTask(v));
  };
  const remove = async (t: QuickTask) => {
    const err = await removeQuickTask(t);
    if (err) return notify(err);
    notify('Pendiente rápido eliminado.', {
      label: 'Deshacer',
      icon: 'undo',
      run: () => void restoreQuickTask(t).then(fail),
    });
  };
  /** Abre «Nuevo pendiente» con este texto; al guardarlo, sale de la lista. */
  const promote = (t: QuickTask) => {
    const long = t.body.length > TITLE_MAX;
    const short = long
      ? t.body.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/, '') + '…'
      : t.body;
    openEntry('Pendiente', [], undefined, { title: short, body: long ? t.body : undefined }, () =>
      void removeQuickTask(t).then(fail),
    );
  };
  const toAgenda = () => {
    onClose?.();
    goSection(go, 'Agenda', 'pendientes');
  };
  const startEdit = (t: QuickTask) => {
    cancelEdit.current = false;
    setDraft(t.body);
    setEditing(t.id);
  };
  const commitEdit = (t: QuickTask) => {
    setEditing(null);
    if (cancelEdit.current) return;
    if (!draft.trim()) return void remove(t);
    void editQuickTask(t, draft).then(fail);
  };

  const row = (t: QuickTask, other: boolean) => {
    const isDone = Boolean(t.done_at);
    const day = dayOf(t.created_at);
    const age = ageOf(day, today);
    const tag = other ? dayTag(day, today) : null;
    const old = !isDone && age >= STALE_DAYS;
    return (
      <li key={t.id} className={'qt-item' + (isDone ? ' done' : '') + (old ? ' stale' : '')}>
        <button
          type="button"
          className="qt-check"
          aria-pressed={isDone}
          aria-label={isDone ? `Quitar la tachadura de «${t.body}»` : `Tachar «${t.body}»`}
          title={isDone ? 'Quitar la tachadura' : 'Tachar'}
          onClick={() => void toggleQuickTask(t).then(fail)}
        >
          <Check size={11} strokeWidth={3.2} />
        </button>
        {editing === t.id ? (
          <input
            className="qt-edit"
            aria-label="Editar el pendiente"
            autoFocus
            maxLength={QUICK_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)}
            onBlur={() => commitEdit(t)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelEdit.current = true;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="qt-text"
            title="Tocar para editar"
            onClick={() => startEdit(t)}
          >
            {/* La tachadura va en el texto mismo (así sigue cada renglón si se parte en dos). */}
            <span>{t.body}</span>
          </button>
        )}
        {tag && (
          <small
            className="qt-tag"
            title={old ? `${tag.long} · lleva ${age} días aquí` : tag.long}
          >
            {tag.short}
          </small>
        )}
        {!isDone && (
          <button
            type="button"
            className="qt-act qt-up"
            aria-label={`Pasar «${t.body}» a pendiente completo`}
            title="Pasar a pendiente completo (con fecha, persona…)"
            onClick={() => promote(t)}
          >
            <ListPlus size={13} />
          </button>
        )}
        <button
          type="button"
          className="qt-act qt-x"
          aria-label={`Eliminar «${t.body}»`}
          title="Eliminar"
          onClick={() => void remove(t)}
        >
          <X size={13} />
        </button>
      </li>
    );
  };

  const body = (
    <div className="qt-scroll">
      {list === null ? (
        <div className="qt-sk" aria-label="Cargando" aria-busy="true">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <div className="qt-body">
          {fresh.length > 0 && <ul className="qt-list">{fresh.map((t) => row(t, false))}</ul>}
          <form className="qt-add" onSubmit={add}>
            <Plus size={14} />
            <input
              ref={addRef}
              value={text}
              maxLength={QUICK_MAX}
              enterKeyHint="done"
              aria-label="Añadir un pendiente rápido"
              placeholder={total ? 'Añade otro…' : 'Apunta algo rápido…'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                // Con algo escrito, Esc lo borra; vacío, la ventana se cierra como siempre.
                if (text) {
                  e.stopPropagation();
                  setText('');
                } else if (variant !== 'sheet') e.currentTarget.blur();
              }}
            />
          </form>
          {!total && <p className="qt-hint">Lo que taches se borra mañana; lo demás sigue.</p>}
          {carried.length > 0 && (
            <div className="qt-carried">
              {stale > 0 && (
                <p className="qt-stale-note">
                  {stale === 1
                    ? `1 lleva ${STALE_DAYS} días o más: pásalo a pendiente o bórralo.`
                    : `${stale} llevan ${STALE_DAYS} días o más: pásalos a pendiente o bórralos.`}
                </p>
              )}
              <ul className="qt-list" aria-label="De días anteriores">
                {carried.map((t) => row(t, true))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const notes: ReactNode = (
    <>
      {local && (
        <p className="qt-note">
          Por ahora se guardan solo en este equipo. Ejecuta <code>{QUICK_MIGRATION}</code> en
          Supabase para tenerlos en tu cuenta.
        </p>
      )}
      {error && (
        <p className="qt-note warn">
          {error}{' '}
          <button type="button" onClick={() => void loadQuickTasks(true)}>
            Reintentar
          </button>
        </p>
      )}
    </>
  );
  const count = total > 0 && (
    <span className="qt-count" title={`${done} de ${total} tachados`}>
      {done}/{total}
    </span>
  );

  if (variant === 'block')
    return (
      <section className="hc qt-block" aria-label={title}>
        <header className="hc-head">
          <h3>
            <ListTodo size={15} /> {title} {count}
          </h3>
          <button type="button" className="hc-link" onClick={toAgenda}>
            Agenda <ArrowUpRight size={12} />
          </button>
        </header>
        {body}
        {notes}
      </section>
    );

  if (variant === 'sheet')
    return (
      <div className="qt-sheet-in">
        <header className="qt-head">
          <div>
            <h3>{title}</h3>
            <small>{longDay(today)}</small>
          </div>
          {count}
          <button type="button" className="qt-close" aria-label="Cerrar" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        {body}
        {notes}
        <footer className="qt-foot">
          <small>Enter añade otro · Esc cierra</small>
          <button type="button" onClick={toAgenda}>
            Ver en Agenda <ArrowUpRight size={12} />
          </button>
        </footer>
      </div>
    );

  return (
    <aside className="qt" aria-label={title}>
      <header className="qt-head">
        <div>
          <h3>{title}</h3>
          <small>{longDay(today)}</small>
        </div>
        {count}
      </header>
      {body}
      {notes}
    </aside>
  );
}

/** Apuntar desde cualquier lado: la lista del día en una ventana pequeña (desde el «+»). */
export function QuickTasksSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet label="Pendientes rápidos de hoy" className="qt-sheet" onRequestClose={onClose}>
      <QuickTasks variant="sheet" onClose={onClose} />
    </Sheet>
  );
}
