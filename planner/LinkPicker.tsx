import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, LoaderCircle, Plus, Search, X } from 'lucide-react';
import { normalizeText } from '../lib/format';

export type PickItem = {
  id: string;
  title: string;
  sub?: string;
  icon?: ReactNode;
  /** Texto donde buscar (ya normalizado); si falta, el título y el subtítulo. */
  match?: string;
};

/** Resalta lo que escribiste dentro del título. */
function Mark({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const hay = normalizeText(text);
  const at = hay.indexOf(needle);
  if (at < 0 || hay.length !== text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

/**
 * Buscador pequeño para vincular algo a una tarjeta: sugerencias al abrirlo y resultados a
 * medida que escribes, con ↑ ↓ y Enter. Puede crear lo que no existe. Con `multi` se eligen
 * varios (se marcan y desmarcan) y se guardan al terminar.
 */
export function LinkPicker({
  title,
  placeholder,
  items,
  search,
  current,
  hint,
  create,
  multi,
  onPick,
  onClose,
}: {
  title: string;
  placeholder: string;
  /** Opciones fijas (se filtran aquí)… */
  items?: PickItem[];
  /** …o búsqueda propia (p. ej. en la base). */
  search?: (needle: string) => Promise<PickItem[]>;
  current?: string | null;
  /** Texto bajo el buscador cuando no has escrito nada. */
  hint?: string;
  /** Crear con lo escrito (o sin texto, si `blank` es verdadero). Devuelve el id creado. */
  create?: {
    label: (q: string) => string;
    run: (q: string) => Promise<string | null | void> | void;
    blank?: boolean;
  };
  /** Varios a la vez: los elegidos al abrir y qué hacer con la selección al terminar. */
  multi?: { initial: string[]; onSave: (ids: string[]) => void };
  onPick?: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PickItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<string[]>(multi?.initial ?? []);
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const needle = normalizeText(q.trim());

  /** Cerrar: en modo varios guarda lo elegido (si cambió). */
  const finish = useRef(() => {});
  finish.current = () => {
    if (multi) {
      const a = [...multi.initial].sort().join();
      const b = [...chosen].sort().join();
      if (a !== b) multi.onSave(chosen);
    }
    onClose();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish.current();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);

  useEffect(() => {
    if (!search) return;
    let live = true;
    setLoading(true);
    const t = window.setTimeout(
      async () => {
        const rows = await search(q.trim()).catch(() => []);
        if (!live) return;
        setFound(rows);
        setLoading(false);
      },
      q.trim() ? 220 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const shown = useMemo(() => {
    if (search) return found ?? [];
    return (items ?? [])
      .filter(
        (i) => !needle || (i.match ?? normalizeText(`${i.title} ${i.sub ?? ''}`)).includes(needle),
      )
      .slice(0, 60);
  }, [items, found, needle, search]);
  const exact = shown.some((i) => normalizeText(i.title) === needle);
  const canCreate = Boolean(create && (q.trim() || create.blank) && !exact);
  const total = shown.length + (canCreate ? 1 : 0);
  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);

  useEffect(() => setActive(0), [needle]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const toggle = (id: string) =>
    setChosen((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const choose = async (i: number) => {
    if (i < shown.length) {
      if (multi) {
        toggle(shown[i].id);
        if (q) setQ('');
        input.current?.focus();
        return;
      }
      onPick?.(shown[i].id);
      onClose();
    } else if (canCreate && create && !busy) {
      setBusy(true);
      try {
        const id = await create.run(q.trim());
        if (multi) {
          if (id) setChosen((v) => [...v, id]);
          setQ('');
          input.current?.focus();
        } else onClose();
      } finally {
        setBusy(false);
      }
    }
  };

  return createPortal(
    <div
      className="bdp-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && finish.current()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={'bdp' + (multi ? ' multi' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="bdp-head">
          <h3>{title}</h3>
          <button
            type="button"
            className="bdp-x"
            aria-label="Cerrar"
            onClick={() => finish.current()}
          >
            <X size={17} />
          </button>
        </header>
        <label className="bdp-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            autoFocus
            value={q}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-controls="bdp-options"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(total - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (total) void choose(active);
                else if (multi && !q.trim()) finish.current();
              } else if (e.key === 'Backspace' && multi && !q && chosen.length) {
                setChosen((v) => v.slice(0, -1));
              }
            }}
          />
          {loading && <LoaderCircle className="spin" size={15} />}
        </label>
        {multi && chosen.length > 0 && (
          <div className="bdp-chosen">
            {chosen.map((id) => {
              const it = byId.get(id);
              return (
                <span key={id}>
                  {it?.icon && <span className="bdp-chip-icon">{it.icon}</span>}
                  {it?.title.split(' ').slice(0, 2).join(' ') ?? 'Persona'}
                  <button
                    type="button"
                    aria-label={`Quitar a ${it?.title ?? 'esta persona'}`}
                    onClick={() => toggle(id)}
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <small className="bdp-label">
          {needle ? (shown.length ? 'Resultados' : '') : (hint ?? 'Sugerencias')}
        </small>
        <ul
          className="bdp-list"
          id="bdp-options"
          role="listbox"
          aria-multiselectable={Boolean(multi)}
          ref={list}
        >
          {shown.map((it, i) => {
            const picked = multi ? chosen.includes(it.id) : current === it.id;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  role="option"
                  data-i={i}
                  aria-selected={multi ? picked : i === active}
                  className={(i === active ? 'on' : '') + (picked ? ' picked' : '')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void choose(i)}
                >
                  {it.icon && <span className="bdp-icon">{it.icon}</span>}
                  <span className="bdp-text">
                    <b>
                      <Mark text={it.title} needle={needle} />
                    </b>
                    {it.sub && <small>{it.sub}</small>}
                  </span>
                  {multi ? (
                    <span className={'bdp-tick' + (picked ? ' on' : '')} aria-hidden="true">
                      <Check size={11} strokeWidth={3.2} />
                    </span>
                  ) : (
                    picked && <Check size={16} className="bdp-current" />
                  )}
                </button>
              </li>
            );
          })}
          {canCreate && create && (
            <li>
              <button
                type="button"
                role="option"
                data-i={shown.length}
                aria-selected={active === shown.length}
                className={'create' + (active === shown.length ? ' on' : '')}
                disabled={busy}
                onMouseEnter={() => setActive(shown.length)}
                onClick={() => void choose(shown.length)}
              >
                <span className="bdp-icon">
                  {busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}
                </span>
                <span className="bdp-text">
                  <b>{create.label(q.trim())}</b>
                </span>
              </button>
            </li>
          )}
        </ul>
        {!total && !loading && (
          <p className="bdp-empty">
            {needle ? `Nada coincide con «${q.trim()}».` : 'No hay nada para elegir todavía.'}
          </p>
        )}
        {multi && (
          <footer className="bdp-foot">
            <small>
              {chosen.length
                ? `${chosen.length} ${chosen.length === 1 ? 'elegida' : 'elegidas'}`
                : 'Elige una o varias'}
            </small>
            <button type="button" className="bd-btn primary sm" onClick={() => finish.current()}>
              Listo
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
