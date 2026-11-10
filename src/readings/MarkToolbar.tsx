import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  BookA,
  BookCheck,
  BookmarkPlus,
  Check,
  Copy,
  Layers,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  StickyNote,
  Trash2,
  UserRound,
} from 'lucide-react';
import { AiText } from './AiText';

/** Caja de la selección (o del resaltado) en coordenadas de la ventana. */
export type Box = { top: number; bottom: number; left: number; right: number };

const GAP = 10;
const EDGE = 8;

/** Caja de un rango: primera línea arriba, última abajo (sirve para selecciones largas). */
export function boxOfRange(r: Range): Box | null {
  const lines = Array.from(r.getClientRects()).filter((x) => x.width > 0 || x.height > 0);
  const all = r.getBoundingClientRect();
  if (!lines.length && !all.width && !all.height) return null;
  const first = lines[0] ?? all;
  const last = lines[lines.length - 1] ?? all;
  return { top: first.top, bottom: last.bottom, left: all.left, right: all.right };
}

/** Color del resaltado con su significado (el tooltip lo explica). */
export type Swatch = { label: string; name: string; hint: string };

/** Tooltip de la barra: título y, debajo, una línea que lo explica. */
function Tip({ title, hint, dot }: { title: string; hint?: string; dot?: string }) {
  return (
    <span className="rd-tip" role="tooltip" aria-hidden="true">
      <b>
        {dot && <i className={'rd-tip-dot lit ' + dot} />}
        {title}
      </b>
      {hint && <small>{hint}</small>}
    </span>
  );
}

/** Atajos para preguntar sin escribir. */
const QUICK = [
  { label: 'Explícalo', prompt: '' },
  { label: 'Resúmelo', prompt: 'Resume este fragmento en una o dos frases.' },
  { label: 'Un ejemplo', prompt: 'Dame un ejemplo concreto que lo ilustre.' },
  { label: '¿Por qué importa?', prompt: '¿Por qué importa esto y qué implica?' },
  { label: '¿Es cierto?', prompt: '¿Qué tan sólido es este argumento? ¿Qué objeciones tiene?' },
  { label: 'Tradúcelo', prompt: 'Tradúcelo al español (o al inglés si ya está en español).' },
];

type Ask = {
  prompt: string;
  /** La indicación con la que se pidió la respuesta actual. */
  asked: string;
  answer: string;
  loading: boolean;
  error: string;
  saved: boolean;
  /** Pediste cerrar con una respuesta sin guardar. */
  confirming: boolean;
};
const freshAsk: Ask = {
  prompt: '',
  asked: '',
  answer: '',
  loading: false,
  error: '',
  saved: false,
  confirming: false,
};

/**
 * Barra flotante para resaltar: aparece centrada sobre el texto (o debajo si no cabe), con
 * los colores, la nota, preguntar a la IA y, si ya existía, borrar. Va en un portal para que
 * ningún contenedor con animación o desplazamiento la descoloque.
 */
export function MarkToolbar({
  box,
  palette,
  color,
  editing,
  busy,
  quote,
  noteOpen,
  note,
  askOpen,
  onPick,
  onToggleNote,
  onNote,
  onSaveNote,
  onToggleAsk,
  onAsk,
  onKeep,
  onDelete,
  onClose,
  sharePanel,
  shareOpen = false,
  onToggleShare,
  shareHint = 0,
  onWord,
  wordSaved = false,
  onCard,
}: {
  box: Box;
  palette: Record<string, Swatch>;
  color: string;
  editing: boolean;
  busy: boolean;
  /** Texto seleccionado o resaltado. */
  quote: string;
  noteOpen: boolean;
  note: string;
  askOpen: boolean;
  onPick: (color: string) => void;
  onToggleNote: () => void;
  onNote: (note: string) => void;
  onSaveNote: () => void;
  onToggleAsk: () => void;
  onAsk: (prompt: string) => Promise<string>;
  /** Guarda la pregunta y la respuesta como nota del resaltado. */
  onKeep: (prompt: string, answer: string) => Promise<boolean>;
  onDelete?: () => void;
  onClose: () => void;
  /** Panel «¿A quién le sirve?» (personas a las que les interesa el fragmento). */
  sharePanel?: ReactNode;
  shareOpen?: boolean;
  onToggleShare?: () => void;
  /** Cuántas personas parecen interesadas (un punto avisa que hay alguien). */
  shareHint?: number;
  /** Añade (o quita) lo seleccionado del diccionario de palabras por aprender. */
  onWord?: () => void;
  /** Ya está en el diccionario. */
  wordSaved?: boolean;
  /** Convierte el fragmento en una flashcard (de huecos o de pregunta). */
  onCard?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; side: 'top' | 'bottom'; arrow: number }>();
  const [ask, setAsk] = useState<Ask>(freshAsk);
  const patch = (p: Partial<Ask>) => setAsk((a) => ({ ...a, ...p }));
  const pending = Boolean(ask.answer) && !ask.saved;

  // Sin botón de cerrar: un toque fuera de la barra la cierra (Esc también).
  const outside = useRef(() => {});
  outside.current = () => (pending ? patch({ confirming: true }) : onClose());
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (root.current?.contains(t)) return;
      // Ventanas abiertas encima (confirmaciones, la ficha de alguien…): no cuentan como fuera.
      if (t.closest?.('.confirm-backdrop, .sheet-backdrop, .nx-peek, .nx-peek-backdrop, .toast'))
        return;
      outside.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  // Se mide antes de pintar y cada vez que cambia de tamaño (nota, respuesta de la IA…).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const place = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const topbar =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0;
      const minTop = topbar + EDGE;
      const center = (box.left + box.right) / 2;
      const x = Math.min(Math.max(center - w / 2, EDGE), Math.max(EDGE, vw - w - EDGE));
      // En pantallas táctiles el menú del sistema sale encima: la barra va debajo.
      const preferBelow = window.matchMedia('(pointer: coarse)').matches;
      const above = box.top - h - GAP;
      const below = box.bottom + GAP;
      let side: 'top' | 'bottom' = preferBelow ? 'bottom' : 'top';
      if (side === 'top' && above < minTop) side = 'bottom';
      else if (side === 'bottom' && below + h > vh - EDGE && above >= minTop) side = 'top';
      const y = Math.min(Math.max(side === 'top' ? above : below, minTop), vh - h - EDGE);
      setPos({ x, y, side, arrow: Math.min(Math.max(center - x, 16), w - 16) });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);

  const send = async (prompt: string) => {
    if (ask.loading) return;
    patch({ loading: true, error: '', answer: '', saved: false, confirming: false, asked: prompt });
    try {
      const answer = await onAsk(prompt);
      patch({ loading: false, answer, prompt: '' });
    } catch (e) {
      patch({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const keep = async () => {
    if (!ask.answer || busy) return;
    if (await onKeep(ask.asked, ask.answer)) patch({ saved: true, confirming: false });
  };
  // Con una respuesta sin guardar, cerrar pregunta primero.
  const requestClose = () => (pending ? patch({ confirming: true }) : onClose());

  return createPortal(
    <div
      ref={root}
      className={'rd-marktools' + (pos ? ' ' + pos.side : '') + (askOpen ? ' asking' : '')}
      role="toolbar"
      aria-label={editing ? 'Editar resaltado' : 'Resaltar selección'}
      style={
        pos
          ? ({ left: pos.x, top: pos.y, '--arrow': pos.arrow + 'px' } as CSSProperties)
          : { left: 0, top: 0, visibility: 'hidden' }
      }
      // Pulsar la barra no debe quitar la selección (salvo al escribir).
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('textarea, input')) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        requestClose();
      }}
    >
      <div className="rd-mt-row">
        <div className="rd-mt-colors">
          {Object.entries(palette).map(([key, sw]) => {
            const on = editing && color === key;
            return (
              <button
                type="button"
                key={key}
                className={'rd-mt-swatch lit ' + key + (on ? ' on' : '')}
                aria-label={`Resaltar como ${sw.label.toLowerCase()} (${sw.name.toLowerCase()}): ${sw.hint.toLowerCase()}`}
                aria-pressed={editing ? on : undefined}
                disabled={busy}
                onClick={() => onPick(key)}
              >
                {on && <Check size={12} strokeWidth={3} />}
                <Tip title={sw.label} hint={on ? `${sw.hint} · actual` : sw.hint} dot={key} />
              </button>
            );
          })}
        </div>
        <span className="rd-mt-sep" aria-hidden="true" />
        <button
          type="button"
          className={'rd-mt-btn ai' + (askOpen ? ' on' : '')}
          aria-label="Preguntar a la IA"
          aria-expanded={askOpen}
          onClick={onToggleAsk}
        >
          <Sparkles size={15} />
          <Tip title="Preguntar a la IA" hint="Explicar, resumir o traducir" />
        </button>
        <button
          type="button"
          className={'rd-mt-btn' + (noteOpen ? ' on' : '')}
          aria-label="Nota"
          aria-expanded={noteOpen}
          onClick={onToggleNote}
        >
          <StickyNote size={15} />
          <Tip title={note.trim() ? 'Editar la nota' : 'Añadir una nota'} hint="Por qué te importa" />
        </button>
        {onWord && (
          <button
            type="button"
            className={'rd-mt-btn word' + (wordSaved ? ' saved' : '')}
            aria-label={wordSaved ? 'Quitar del diccionario' : 'Añadir al diccionario'}
            aria-pressed={wordSaved}
            onClick={onWord}
          >
            {wordSaved ? <BookCheck size={15} /> : <BookA size={15} />}
            <Tip
              title={wordSaved ? 'En tu diccionario' : 'Añadir al diccionario'}
              hint={wordSaved ? 'Toca para quitarla' : 'Con su definición, para aprenderla'}
            />
          </button>
        )}
        {onCard && (
          <button
            type="button"
            className="rd-mt-btn"
            aria-label="Crear flashcard"
            onClick={onCard}
          >
            <Layers size={15} />
            <Tip title="Crear flashcard" hint="Entra a tu repaso" />
          </button>
        )}
        {sharePanel && (
          <button
            type="button"
            className={'rd-mt-btn people' + (shareOpen ? ' on' : '')}
            aria-label="Compartir con alguien"
            aria-expanded={shareOpen}
            onClick={onToggleShare}
          >
            <UserRound size={15} />
            {shareHint > 0 && !shareOpen && <i className="rd-mt-dot" aria-hidden="true" />}
            <Tip
              title="¿A quién le sirve?"
              hint={
                shareHint > 0
                  ? shareHint === 1
                    ? 'A 1 persona le puede interesar'
                    : `A ${shareHint} personas les puede interesar`
                  : 'Compártelo con alguien'
              }
            />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="rd-mt-btn danger"
            aria-label="Quitar el resaltado"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 size={15} />
            <Tip title="Quitar el resaltado" hint="También su nota" />
          </button>
        )}
      </div>

      {shareOpen && sharePanel}

      {noteOpen && (
        <form
          className="rd-mt-panel"
          onSubmit={(e) => {
            e.preventDefault();
            onSaveNote();
          }}
        >
          <textarea
            autoFocus
            rows={3}
            maxLength={4000}
            aria-label="Nota del resaltado"
            placeholder="¿Por qué te importa este fragmento?"
            value={note}
            onChange={(e) => onNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onSaveNote();
              }
            }}
          />
          <div className="rd-mt-foot">
            <small>Ctrl + Enter</small>
            <button type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Guardar
            </button>
          </div>
        </form>
      )}

      {askOpen && (
        <div className="rd-mt-panel rd-mt-ask">
          <blockquote className="rd-mt-quote" title={quote}>
            {quote}
          </blockquote>

          {(ask.answer || ask.loading || ask.error) && (
            <div className="rd-mt-answer" aria-live="polite">
              {ask.loading ? (
                <span className="rd-mt-thinking">
                  <i />
                  <i />
                  <i /> Leyendo el artículo…
                </span>
              ) : ask.error ? (
                <p className="rd-mt-error">{ask.error}</p>
              ) : (
                <>
                  {ask.asked && <small className="rd-mt-asked">{ask.asked}</small>}
                  <AiText text={ask.answer} />
                </>
              )}
            </div>
          )}

          {ask.answer && !ask.loading && (
            <div className={'rd-mt-keep' + (ask.confirming ? ' confirm' : '')}>
              {ask.saved ? (
                <span className="rd-mt-saved">
                  <Check size={13} /> Guardado en el artículo
                </span>
              ) : (
                <>
                  <span>{ask.confirming ? '¿Guardar esta respuesta?' : '¿La guardas?'}</span>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => void keep()}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : (
                      <BookmarkPlus size={13} />
                    )}{' '}
                    Guardar
                  </button>
                  <button
                    type="button"
                    onClick={() => (ask.confirming ? onClose() : patch({ answer: '', asked: '' }))}
                  >
                    Descartar
                  </button>
                </>
              )}
              <button
                type="button"
                className="icon"
                title="Copiar la respuesta"
                aria-label="Copiar la respuesta"
                onClick={() => void navigator.clipboard?.writeText(ask.answer)}
              >
                <Copy size={13} />
              </button>
            </div>
          )}

          {!ask.loading && (
            <>
              {!ask.answer && (
                <div className="rd-mt-chips">
                  {QUICK.map((q) => (
                    <button type="button" key={q.label} onClick={() => void send(q.prompt)}>
                      {q.label}
                    </button>
                  ))}
                </div>
              )}
              <form
                className="rd-mt-prompt"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(ask.prompt.trim() || (ask.answer ? ask.asked : ''));
                }}
              >
                <textarea
                  autoFocus
                  rows={1}
                  maxLength={1500}
                  aria-label="Pregunta o indicación para la IA"
                  placeholder={
                    ask.answer ? 'Pregunta algo más…' : 'Pregunta o indica algo (vacío: explicarlo)'
                  }
                  value={ask.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(ask.prompt.trim() || (ask.answer ? ask.asked : ''));
                    }
                  }}
                />
                <button type="submit" title="Preguntar (Enter)" aria-label="Preguntar">
                  {ask.answer && !ask.prompt.trim() ? (
                    <RotateCcw size={14} />
                  ) : (
                    <ArrowUp size={15} />
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
