import { useEffect, useLayoutEffect, useRef, type FormEvent, type ReactNode } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  Calculator,
  FileText,
  Layers,
  MapPin,
  Newspaper,
  RotateCcw,
  Search,
  Sparkles,
  SquarePen,
  StickyNote,
  UserRound,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { AssistantSource } from '../assistant';
import type { Assistant, ChatMessage } from '../hooks/useAssistant';

const suggestions = [
  '¿Qué compromisos tengo abiertos y con quién?',
  '¿Cuánto gasté este mes y en qué?',
  '¿Qué sé de Laura y qué novedades tiene?',
  '¿Quién me recomendó un libro?',
];

const sourceIcon = {
  entry: FileText,
  person: UserRound,
  place: MapPin,
  episode: Layers,
  reading: Newspaper,
  note: StickyNote,
};
/** Lo que no cabe en la burbuja: las fuentes que se ven a la vista. */
const VISIBLE_SOURCES = 4;

/** Una respuesta de Nexo: texto con sus citas como enlaces, fuentes y qué consultó. */
function Answer({ m, open }: { m: ChatMessage; open: (s: AssistantSource) => void }) {
  const byRef = new Map((m.sources ?? []).map((s) => [s.ref, s]));
  /** Convierte las citas [r3] en enlaces a sus fuentes. */
  const render = (text: string): ReactNode[] =>
    text.split(/(\[[a-z]\d+(?:\s*,\s*[a-z]\d+)*\])/g).map((part, i) => {
      const refs = part.match(/^\[(.+)\]$/)?.[1].split(/\s*,\s*/);
      if (!refs) return part;
      return refs.map((r) => {
        const s = byRef.get(r);
        if (!s) return null;
        const Icon = sourceIcon[s.type];
        return (
          <button
            type="button"
            key={i + r}
            className="chat-cite"
            title={s.title}
            onClick={() => open(s)}
          >
            <Icon size={11} />
            {s.title.length > 26 ? s.title.slice(0, 24) + '…' : s.title}
          </button>
        );
      });
    });
  const sources = m.sources ?? [];
  const cov = m.coverage;
  return (
    <div className="chat-msg bot">
      <div className="chat-bubble">
        {m.text
          .split('\n')
          .filter((line) => line.trim())
          .map((line, i) => (
            <p key={i} className={/^\s*[-•]\s/.test(line) ? 'li' : undefined}>
              {render(line)}
            </p>
          ))}
      </div>
      {sources.length > 0 && (
        <div className="chat-sources">
          {sources.slice(0, VISIBLE_SOURCES).map((s) => {
            const Icon = sourceIcon[s.type];
            return (
              <button type="button" key={s.ref} onClick={() => open(s)} title={s.title}>
                <Icon size={12} /> <span>{s.title}</span>
              </button>
            );
          })}
          {sources.length > VISIBLE_SOURCES && (
            <details className="chat-more">
              <summary>+{sources.length - VISIBLE_SOURCES}</summary>
              {sources.slice(VISIBLE_SOURCES, 16).map((s) => {
                const Icon = sourceIcon[s.type];
                return (
                  <button type="button" key={s.ref} onClick={() => open(s)} title={s.title}>
                    <Icon size={12} /> <span>{s.title}</span>
                    {s.date && <small>{s.date}</small>}
                  </button>
                );
              })}
            </details>
          )}
        </div>
      )}
      {cov && (cov.calculations.length > 0 || cov.matching > cov.consulted) && (
        <details className="chat-coverage">
          <summary>
            <Search size={12} /> {cov.consulted} de {cov.matching}{' '}
            {cov.matching === 1 ? 'recuerdo' : 'recuerdos'}
            {cov.calculations.length > 0 && (
              <>
                {' · '}
                <Calculator size={12} /> cálculos exactos
              </>
            )}
          </summary>
          {cov.filters.length > 0 && <span>{cov.filters.join(' · ')}</span>}
          {cov.calculations.map((c) => (
            <span key={c} className="calc">
              {c}
            </span>
          ))}
        </details>
      )}
    </div>
  );
}

export function ChatPanel({
  assistant,
  onClose,
  title = 'Nexo',
  intro = {
    heading: 'Conectemos los puntos.',
    text: 'Personas, lugares, compromisos, gastos, recuerdos… y tú.',
  },
  prompts = suggestions,
  placeholder = 'Pregúntale a tu memoria…',
  className = '',
}: {
  assistant: Assistant;
  onClose: () => void;
  /** Nombre en la cabecera (p. ej. el del cuaderno). */
  title?: string;
  intro?: { heading: string; text: string };
  /** Preguntas sugeridas para empezar. */
  prompts?: string[];
  placeholder?: string;
  /** Clases extra (p. ej. para acoplarlo dentro de un lienzo). */
  className?: string;
}) {
  const { messages, input, setInput, busy, send, retry, reset } = assistant;
  const { workspace, go, viewEntry, peekPerson } = useApp();
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Siempre a la vista lo último (y el «escribiendo…»).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: messages.length ? 'smooth' : 'auto' });
  }, [messages.length, busy]);

  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, []);

  // El campo crece con el texto (hasta un tope) y vuelve a una línea al enviar.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, [input]);

  // Esc cierra el chat, salvo que haya algo abierto encima (la ficha de alguien, un recuerdo…).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (
        document.querySelector(
          '.nx-peek, .sheet-backdrop, .confirm-backdrop, .modal-backdrop, .lightbox',
        )
      )
        return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function submit(ev: FormEvent) {
    ev.preventDefault();
    void send(input);
  }

  const open = (s: AssistantSource) => {
    if (s.type === 'entry') {
      const e = workspace.entries.find((x) => x.id === s.id);
      if (e) viewEntry(e);
    } else if (s.type === 'person') {
      const p = workspace.people.find((x) => x.id === s.id);
      if (p) peekPerson(p);
    } else if (s.type === 'place') {
      const p = workspace.places.find((x) => x.id === s.id);
      if (p) go('Lugares', p);
    } else if (s.type === 'reading') {
      go('Lecturas', { id: s.id });
    } else if (s.type === 'note') {
      go('Notas', { id: s.id });
    } else {
      const ep = workspace.episodes.find((x) => x.id === s.id);
      if (ep) go('Episodios', ep);
    }
  };

  const empty = !messages.length && !busy;
  const lastError = messages[messages.length - 1]?.error;

  return (
    <div
      className={'chat-panel' + (className ? ' ' + className : '')}
      role="dialog"
      aria-label={title === 'Nexo' ? 'Asistente Nexo' : `Asistente: ${title}`}
    >
      <header>
        <span>
          <Sparkles size={18} /> <b className="chat-title">{title}</b>
        </span>
        <div className="chat-tools">
          {messages.length > 0 && (
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                reset();
                area.current?.focus();
              }}
              aria-label="Nueva conversación"
              title="Nueva conversación"
            >
              <SquarePen size={18} />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Cerrar asistente"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      <div className="chat-content" ref={scroller} aria-live="polite">
        {empty ? (
          <div className="chat-intro">
            <span className="chat-emblem">
              <Sparkles size={26} />
            </span>
            <h2>{intro.heading}</h2>
            <p>{intro.text}</p>
            <div className="suggestions">
              {prompts.map((s) => (
                <button type="button" key={s} onClick={() => void send(s)}>
                  {s}
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-thread">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div className="chat-msg me" key={m.id}>
                  <div className="chat-bubble">{m.text}</div>
                </div>
              ) : m.error ? (
                <div className="chat-msg bot error" key={m.id}>
                  <div className="chat-bubble">{m.text}</div>
                  {m === messages[messages.length - 1] && !busy && (
                    <button type="button" className="chat-retry" onClick={retry}>
                      <RotateCcw size={13} /> Reintentar
                    </button>
                  )}
                </div>
              ) : (
                <Answer key={m.id} m={m} open={open} />
              ),
            )}
            {busy && (
              <div className="chat-msg bot">
                <div className="chat-bubble chat-typing" aria-label="Nexo está pensando">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={submit} className={lastError ? 'after-error' : ''}>
        <textarea
          ref={area}
          rows={1}
          value={input}
          maxLength={2000}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder={messages.length ? 'Escribe…' : placeholder}
          aria-label="Mensaje para Nexo"
        />
        <button
          className="primary"
          disabled={busy || !input.trim()}
          aria-label="Enviar"
          title="Enviar"
        >
          <ArrowUp size={18} />
        </button>
      </form>
    </div>
  );
}
