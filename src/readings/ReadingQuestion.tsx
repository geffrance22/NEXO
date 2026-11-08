import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BookmarkPlus,
  Check,
  CircleHelp,
  Copy,
  CornerDownRight,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Scale,
  Sparkles,
  X,
} from 'lucide-react';
import { AiText } from './AiText';
import type { ReadingAnswer } from './ask';

/** Etiquetas con las que se guardan en la nota del resaltado (así se reconocen después). */
export const QUESTION_LABEL = 'Pregunta guía: ';
export const DEBATE_LABEL = 'Contraargumentos';

const DEBATE_PROMPT =
  'Contraargumenta este artículo (hasta 280 palabras). Estructura: **Qué defiende** (una frase con su tesis). ' +
  '**Posturas contrarias**: 3 ideas o argumentos opuestos sólidos, cada uno en un guion. ' +
  '**Su punto más débil**: cuál es y por qué. **Para pensar**: una pregunta que ponga a prueba la tesis. ' +
  'Usa como cita la afirmación más discutible del artículo.';

/** Algo que ya guardaste desde este botón: la respuesta a tu pregunta o los contraargumentos. */
export type SavedAi = {
  id: string;
  kind: 'pregunta' | 'debate';
  title: string;
  body: string;
  start: number;
  date: string;
};

type Tab = 'pregunta' | 'debate' | 'guardado';
type Result = {
  answer: ReadingAnswer | null;
  state: 'idle' | 'asking' | 'saving' | 'saved';
  error: string;
};
const emptyResult: Result = { answer: null, state: 'idle', error: '' };

/** Pide a la IA, muestra la respuesta y permite guardarla en el artículo. */
function useAiResult(
  ask: () => Promise<ReadingAnswer>,
  keep: (answer: ReadingAnswer) => Promise<boolean>,
) {
  const [r, setR] = useState<Result>(emptyResult);
  return {
    ...r,
    run: async () => {
      setR({ answer: null, state: 'asking', error: '' });
      try {
        setR({ answer: await ask(), state: 'idle', error: '' });
      } catch (e) {
        setR({ answer: null, state: 'idle', error: e instanceof Error ? e.message : String(e) });
      }
    },
    keep: async () => {
      if (!r.answer) return;
      setR((x) => ({ ...x, state: 'saving' }));
      const ok = await keep(r.answer);
      setR((x) => ({ ...x, state: ok ? 'saved' : 'idle' }));
    },
    reset: () => setR(emptyResult),
  };
}

function AnswerBox({
  result,
  busy,
  savedLabel,
  extra,
}: {
  result: ReturnType<typeof useAiResult>;
  busy: boolean;
  savedLabel: string;
  extra?: ReactNode;
}) {
  if (result.state === 'asking')
    return (
      <span className="rd-qf-thinking">
        <i />
        <i />
        <i /> Leyendo el artículo…
      </span>
    );
  if (result.error) return <p className="rd-qf-error">{result.error}</p>;
  if (!result.answer) return null;
  const a = result.answer;
  return (
    <div className="rd-qf-answer">
      <AiText text={a.answer} />
      {a.quote && <blockquote>«{a.quote}»</blockquote>}
      <div className="rd-qf-row">
        {result.state === 'saved' ? (
          <>
            <span className="rd-qf-saved">
              <Check size={13} /> {savedLabel}
            </span>
            {extra}
          </>
        ) : (
          <button
            type="button"
            className="rd-qf-main"
            disabled={result.state === 'saving' || busy}
            onClick={() => void result.keep()}
          >
            {result.state === 'saving' ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <BookmarkPlus size={13} />
            )}{' '}
            Guardar en el artículo
          </button>
        )}
        <button
          type="button"
          className="rd-qf-icon"
          title="Copiar"
          aria-label="Copiar la respuesta"
          onClick={() => void navigator.clipboard?.writeText(a.answer)}
        >
          <Copy size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * Botón flotante en la esquina del lector con tres cosas: tu pregunta guía (y su respuesta con
 * IA), contraargumentar el artículo y lo que ya guardaste. Lo guardado queda como resaltado en el
 * artículo y un indicador pequeño junto al botón dice cuántas cosas hay.
 */
export function QuestionFab({
  question,
  busy,
  saved,
  onSave,
  onAsk,
  onKeep,
  onJump,
}: {
  question: string;
  busy: boolean;
  saved: SavedAi[];
  onSave: (question: string) => Promise<boolean>;
  onAsk: (prompt: string) => Promise<ReadingAnswer>;
  /** Guarda la respuesta como resaltado; `label` encabeza la nota. */
  onKeep: (label: string, answer: ReadingAnswer) => Promise<boolean>;
  onJump: (start: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('pregunta');
  const [editing, setEditing] = useState(!question);
  const [draft, setDraft] = useState(question);
  const [expanded, setExpanded] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const answer = useAiResult(
    () => onAsk(question),
    (a) => onKeep(QUESTION_LABEL + question, a),
  );
  const debate = useAiResult(
    () => onAsk(DEBATE_PROMPT),
    (a) => onKeep(DEBATE_LABEL, a),
  );
  const pending =
    (Boolean(answer.answer) && answer.state !== 'saved') ||
    (Boolean(debate.answer) && debate.state !== 'saved');

  // Un clic fuera o Esc lo cierran (lo escrito y las respuestas se conservan). Esc se atiende
  // aquí primero, para que no cierre también el artículo.
  const live = useRef({ editing, question });
  live.current = { editing, question };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.confirm-backdrop, .sheet-backdrop, .lightbox')) return;
      e.preventDefault();
      const { editing: isEditing, question: q } = live.current;
      if (isEditing && q) {
        setDraft(q);
        setEditing(false);
      } else setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const save = async (value: string) => {
    if (!(await onSave(value.trim()))) return;
    setDraft(value.trim());
    setEditing(!value.trim());
    answer.reset();
  };

  const tabs: { id: Tab; label: string; icon: typeof Sparkles; n?: number }[] = [
    { id: 'pregunta', label: 'Pregunta', icon: CircleHelp },
    { id: 'debate', label: 'Contraargumentar', icon: Scale },
    ...(saved.length
      ? [{ id: 'guardado' as Tab, label: 'Guardado', icon: BookmarkPlus, n: saved.length }]
      : []),
  ];
  const current = tab === 'guardado' && !saved.length ? 'pregunta' : tab;

  return (
    <div className="rd-qf-dock">
      <div ref={root} className={'rd-qf' + (open ? ' open' : '')}>
        {open ? (
          <section className="rd-qf-panel" aria-label="Pregunta y debate del artículo">
            <header>
              <nav className="rd-qf-tabs" role="tablist">
                {tabs.map((t) => (
                  <button
                    type="button"
                    role="tab"
                    key={t.id}
                    aria-selected={current === t.id}
                    className={current === t.id ? 'on' : ''}
                    onClick={() => setTab(t.id)}
                  >
                    <t.icon size={13} /> {t.label}
                    {t.n ? <i>{t.n}</i> : null}
                  </button>
                ))}
              </nav>
              <button
                type="button"
                className="rd-qf-icon"
                aria-label="Cerrar"
                onClick={() => setOpen(false)}
              >
                <X size={15} />
              </button>
            </header>

            {current === 'pregunta' &&
              (editing ? (
                <form
                  className="rd-qf-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draft.trim()) void save(draft);
                  }}
                >
                  <textarea
                    autoFocus
                    rows={2}
                    value={draft}
                    maxLength={1500}
                    aria-label="Pregunta guía del artículo"
                    placeholder="¿Qué quieres responder con esta lectura?"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (draft.trim()) void save(draft);
                      }
                    }}
                  />
                  <div className="rd-qf-row">
                    <small>Queda en el artículo y la IA puede responderla.</small>
                    {question && (
                      <button
                        type="button"
                        className="rd-qf-ghost"
                        onClick={() => {
                          setDraft(question);
                          setEditing(false);
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      type="submit"
                      className="rd-qf-main"
                      disabled={busy || !draft.trim() || draft.trim() === question}
                    >
                      <Check size={14} /> Guardar
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="rd-qf-question">{question}</p>
                  <div className="rd-qf-row">
                    <button
                      type="button"
                      className="rd-qf-main ai"
                      disabled={answer.state === 'asking'}
                      onClick={() => void answer.run()}
                    >
                      {answer.state === 'asking' ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : answer.answer ? (
                        <RotateCcw size={14} />
                      ) : (
                        <Sparkles size={14} />
                      )}{' '}
                      {answer.answer ? 'Responder otra vez' : 'Responder con IA'}
                    </button>
                    <button
                      type="button"
                      className="rd-qf-icon"
                      title="Editar la pregunta"
                      aria-label="Editar la pregunta"
                      onClick={() => {
                        setDraft(question);
                        setEditing(true);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="rd-qf-icon"
                      title="Ya está resuelta (quitarla)"
                      aria-label="Marcar como resuelta"
                      disabled={busy}
                      onClick={() => void save('')}
                    >
                      <Check size={15} />
                    </button>
                  </div>
                  <AnswerBox
                    result={answer}
                    busy={busy}
                    savedLabel="Guardada como resaltado"
                    extra={
                      <button type="button" className="rd-qf-ghost" onClick={() => void save('')}>
                        Marcar resuelta
                      </button>
                    }
                  />
                </>
              ))}

            {current === 'debate' && (
              <>
                <p className="rd-qf-intro">
                  La IA toma la postura contraria: qué defiende el artículo, ideas opuestas, su
                  punto más débil y una pregunta para pensar.
                </p>
                <div className="rd-qf-row">
                  <button
                    type="button"
                    className="rd-qf-main ai"
                    disabled={debate.state === 'asking'}
                    onClick={() => void debate.run()}
                  >
                    {debate.state === 'asking' ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : debate.answer ? (
                      <RotateCcw size={14} />
                    ) : (
                      <Scale size={14} />
                    )}{' '}
                    {debate.answer ? 'Otra vez' : 'Contraargumentar'}
                  </button>
                </div>
                <AnswerBox result={debate} busy={busy} savedLabel="Guardado en el artículo" />
              </>
            )}

            {current === 'guardado' && (
              <ul className="rd-qf-saved-list">
                {saved.map((s) => {
                  const on = expanded === s.id;
                  return (
                    <li key={s.id} className={s.kind}>
                      <button
                        type="button"
                        className="rd-qf-saved-head"
                        aria-expanded={on}
                        onClick={() => setExpanded(on ? null : s.id)}
                      >
                        {s.kind === 'debate' ? <Scale size={13} /> : <CircleHelp size={13} />}
                        <span>{s.title}</span>
                        <small>
                          {new Date(s.date).toLocaleDateString('es-CO', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </small>
                      </button>
                      <div className={'rd-qf-saved-body' + (on ? ' open' : '')}>
                        <AiText text={s.body} />
                      </div>
                      <button
                        type="button"
                        className="rd-qf-ghost"
                        onClick={() => {
                          setOpen(false);
                          onJump(s.start);
                        }}
                      >
                        <CornerDownRight size={13} /> Ver en el texto
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : (
          <>
            {saved.length > 0 && (
              <button
                type="button"
                className="rd-qf-badge"
                title={`${saved.length} ${saved.length === 1 ? 'cosa guardada' : 'cosas guardadas'}`}
                aria-label="Ver lo guardado"
                onClick={() => {
                  setTab('guardado');
                  setOpen(true);
                }}
              >
                <BookmarkPlus size={11} /> {saved.length}
              </button>
            )}
            <button
              type="button"
              className={'rd-qf-fab' + (question ? ' has' : '') + (pending ? ' pending' : '')}
              title={question ? `Tu pregunta: ${question}` : 'Pregunta guía y contraargumentos'}
              aria-label={question ? 'Ver tu pregunta guía' : 'Añadir una pregunta guía'}
              onClick={() => {
                if (tab === 'guardado') setTab('pregunta');
                setOpen(true);
              }}
            >
              <CircleHelp size={20} />
              {question && <span className="rd-qf-label">{question}</span>}
              {pending && <i className="rd-qf-dot" aria-hidden="true" />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
