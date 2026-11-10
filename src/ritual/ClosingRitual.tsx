import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  Brain,
  Check,
  Clapperboard,
  GraduationCap,
  LoaderCircle,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
  Tv,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { closingQuiz, type QuizQuestion } from '../assistant';
import { AutoTextarea } from '../composer/controls';
import { Sheet } from '../components/Sheet';
import type { Entry, Ritual, RitualAnswer, RitualQuizItem } from '../data';
import { addDays, errorMessage, friendlyDate, normalizeText, todayInputValue } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { toneOf } from '../library/shelf';
import { Avatar } from '../people/Avatar';
import { inDays, schedule, type Memory } from '../readings/review';
import { answered, firstReview, learningInput, learningParts, quizConfidence } from './learning';
import {
  mediumOf,
  phrase,
  pickQuestions,
  rememberAsked,
  swapQuestion,
  topicLabel,
  type Question,
} from './questions';
import './ritual.css';

type Step = 'intro' | 'ask' | 'quiz' | 'summary' | 'done';
type QuizState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; questions: QuizQuestion[]; known: boolean };

const DEPTH_KEY = 'nexo-ritual-depth';
const QUIZ_KEY = 'nexo-ritual-quiz';
const readDepth = () => {
  const n = Number(localStorage.getItem(DEPTH_KEY));
  return n === 1 || n === 2 || n === 3 ? n : 3;
};

const depths = [
  { n: 1, label: 'Rápido', hint: '1 pregunta · 1 min' },
  { n: 2, label: 'Breve', hint: '2 preguntas · 2 min' },
  { n: 3, label: 'Completo', hint: '3 preguntas · 4 min' },
] as const;

/** Los próximos repasos si lo vas recordando: mañana, en 3 días, en 10… (FSRS). */
const reviewPlan = (() => {
  const out: string[] = [inDays(1)];
  let today = addDays(todayInputValue(), 1);
  let memory: Memory = { step: 0 };
  for (let i = 0; i < 3; i++) {
    const next = schedule(memory, 'bien', today);
    out.push(inDays(next.days));
    memory = { step: next.step, s: next.s, d: next.d, last: today };
    today = addDays(today, next.days ?? 1);
  }
  return out;
})();

function verdict(score: number, total: number) {
  const r = total ? score / total : 0;
  if (r === 1)
    return {
      title: 'Dominio total',
      text: 'Te quedó todo. Ahora toca usarlo.',
    };
  if (r >= 0.8)
    return {
      title: 'Muy bien',
      text: 'Lo tienes claro; repasar lo que falló lo afianza.',
    };
  if (r >= 0.6)
    return {
      title: 'Bien',
      text: 'Lo esencial está. El repaso hará el resto.',
    };
  if (r >= 0.4)
    return {
      title: 'A medias',
      text: 'Algunas ideas se están yendo: el repaso las traerá de vuelta.',
    };
  return {
    title: 'Para repasar',
    text: 'Normal al terminar: lo que no se repasa se olvida.',
  };
}

/**
 * Ritual de cierre de un libro, una película o una serie terminados: unas pocas preguntas
 * variadas (qué te llevas, qué cambia en ti, a quién se lo recomendarías…), un test opcional de la
 * IA que te califica y, al final, un aprendizaje enlazado a la obra con su repaso espaciado.
 */
export function ClosingRitual({ entry: initial, onClose }: { entry: Entry; onClose: () => void }) {
  const { workspace, createEntry, patchEntry, confirm, viewEntry } = useApp();
  // Siempre la versión más reciente (acaba de marcarse como terminada).
  const entry = workspace.entries.find((e) => e.id === initial.id) ?? initial;
  const medium = mediumOf(entry);
  const tone = toneOf(entry);
  const img = entryImages(entry)[0];
  const previous = entry.details.ritual;
  const Icon = medium === 'libro' ? BookMarked : medium === 'serie' ? Tv : Clapperboard;

  const [step, setStep] = useState<Step>('intro');
  const [depth, setDepth] = useState<number>(readDepth);
  const [withQuiz, setWithQuiz] = useState(() => localStorage.getItem(QUIZ_KEY) === '1');
  const [questions, setQuestions] = useState<Question[]>(() => pickQuestions(medium, readDepth()));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [at, setAt] = useState(0);
  const [recommend, setRecommend] = useState<string[]>(previous?.recommendTo ?? []);
  const [quiz, setQuiz] = useState<QuizState>({ status: 'off' });
  const [quizAt, setQuizAt] = useState(0);
  const [choices, setChoices] = useState<number[]>([]);
  const [review, setReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [learning, setLearning] = useState<Entry | null>(null);
  const quizRun = useRef(0);

  const chooseDepth = (n: number) => {
    setDepth(n);
    setQuestions(pickQuestions(medium, n));
    localStorage.setItem(DEPTH_KEY, String(n));
  };
  const toggleQuiz = () => {
    setWithQuiz((v) => {
      localStorage.setItem(QUIZ_KEY, v ? '0' : '1');
      return !v;
    });
  };

  // ───── Test de la IA: se pide al empezar para que esté listo al terminar las preguntas ─────
  const work = useMemo(() => {
    const d = entry.details;
    const info = d.movieInfo;
    return {
      tipo:
        medium === 'libro'
          ? ('libro' as const)
          : medium === 'serie'
            ? ('serie' as const)
            : ('película' as const),
      titulo: entry.title,
      autor: d.author || info?.director || undefined,
      año: info?.year || d.year || d.bookEdition?.date?.slice(0, 4) || undefined,
      generos: info?.genres?.slice(0, 6),
      sinopsis: info?.overview?.slice(0, 1800),
    };
  }, [entry.title, entry.details, medium]);

  const loadQuiz = () => {
    const run = ++quizRun.current;
    setQuiz({ status: 'loading' });
    setQuizAt(0);
    setChoices([]);
    closingQuiz(work).then(
      (r) => run === quizRun.current && setQuiz({ status: 'ready', ...r }),
      (e) => run === quizRun.current && setQuiz({ status: 'error', message: errorMessage(e) }),
    );
  };

  const start = () => {
    setStep('ask');
    setAt(0);
    if (withQuiz && quiz.status !== 'ready' && quiz.status !== 'loading') loadQuiz();
    if (!withQuiz) setQuiz({ status: 'off' });
  };

  const q = questions[at];
  const isLastQuestion = at === questions.length - 1;
  const next = () => {
    if (!isLastQuestion) return setAt((i) => i + 1);
    setStep(withQuiz ? 'quiz' : 'summary');
  };
  const back = () => {
    if (step === 'ask') return at > 0 ? setAt((i) => i - 1) : setStep('intro');
    if (step === 'quiz') {
      setStep('ask');
      setAt(questions.length - 1);
      return;
    }
    if (step === 'summary') {
      if (withQuiz) return setStep('quiz');
      setStep('ask');
      setAt(questions.length - 1);
    }
  };
  const swap = () => {
    if (!q) return;
    const other = swapQuestion(q, medium, questions);
    if (other.id === q.id) return;
    setQuestions((list) => list.map((x) => (x.id === q.id ? other : x)));
    // La respuesta escrita sigue en su sitio: puede servir para la otra pregunta.
    setAnswers((a) => ({ ...a, [other.id]: a[q.id] ?? '' }));
  };

  // ───── Personas a las que se lo recomendarías ─────
  const [who, setWho] = useState('');
  const reachable = useMemo(
    () => workspace.people.filter((p) => !p.profile.status),
    [workspace.people],
  );
  const matches = useMemo(() => {
    const t = normalizeText(who.trim());
    if (!t) return [];
    return reachable
      .filter((p) => !recommend.includes(p.id) && normalizeText(p.name).includes(t))
      .slice(0, 5);
  }, [who, reachable, recommend]);
  const chosen = recommend.flatMap((id) => workspace.people.find((p) => p.id === id) ?? []);
  const names = chosen.map((p) => p.name.split(' ')[0]);

  // ───── Lo que se guarda ─────
  const list: RitualAnswer[] = questions.map((x) => ({
    id: x.id,
    topic: x.topic,
    q: phrase(x, medium),
    a: (answers[x.id] ?? '').trim(),
  }));
  const quizItems: RitualQuizItem[] | null =
    quiz.status === 'ready' && choices.length === quiz.questions.length
      ? quiz.questions.map((x, i) => ({ ...x, chosen: choices[i] }))
      : null;
  const score = quizItems ? quizItems.filter((x) => x.chosen === x.answer).length : 0;
  const ritual: Ritual = {
    at: todayInputValue(),
    answers: answered(list),
    ...(recommend.length && { recommendTo: recommend }),
    ...(quizItems && {
      quiz: { score, total: quizItems.length, items: quizItems },
    }),
  };
  const hasContent = ritual.answers.length > 0;
  const dirty = hasContent || recommend.length > 0 || choices.length > 0;
  const preview = learningParts(entry, ritual, names, { review });
  const confidence = quizConfidence(ritual.quiz);

  const requestClose = async () => {
    if (busy) return;
    if (step !== 'done' && dirty) {
      const leave = await confirm({
        title: '¿Salir del cierre?',
        message: 'Lo que respondiste no se guardará.',
        confirmLabel: 'Salir',
        cancelLabel: 'Seguir',
        icon: 'warning',
      });
      if (!leave) return;
    }
    onClose();
  };

  const save = async () => {
    if (busy || (!hasContent && !ritual.quiz)) return;
    setBusy(true);
    try {
      let learningId = previous?.learningId;
      let saved: Entry | null = null;
      const old = learningId ? workspace.entries.find((e) => e.id === learningId) : undefined;
      if (hasContent) {
        if (old) {
          // Rehacer el cierre actualiza el mismo aprendizaje (conserva su ritmo de repaso).
          const parts = learningParts(entry, ritual, names, {
            review,
            previous: old.details.review,
          });
          const details = { ...old.details, ...parts.details };
          if (!review) delete details.review;
          if (
            await patchEntry(old, {
              title: parts.title,
              body: parts.body,
              details,
            })
          )
            saved = { ...old, title: parts.title, body: parts.body, details };
        } else {
          saved = await createEntry(learningInput(entry, ritual, names, review), true);
        }
        if (!saved) return;
        learningId = saved.id;
      }
      const ok = await patchEntry(entry, {
        details: {
          ...entry.details,
          ritual: { ...ritual, ...(learningId && { learningId }) },
        },
      });
      if (!ok) return;
      rememberAsked(questions.map((x) => x.id));
      setLearning(saved);
      setStep('done');
    } finally {
      setBusy(false);
    }
  };

  // ───── Atajos: Ctrl+Enter avanza; en el test, 1-4 eligen y Enter sigue ─────
  const quizQ = quiz.status === 'ready' ? quiz.questions[quizAt] : undefined;
  const picked = choices[quizAt];
  const pick = (i: number) => {
    if (!quizQ || picked !== undefined) return;
    setChoices((c) => {
      const out = [...c];
      out[quizAt] = i;
      return out;
    });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.confirm-backdrop')) return;
      if (step === 'ask' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        next();
      } else if (
        step === 'quiz' &&
        quizQ &&
        !(e.target as HTMLElement).closest('textarea, input')
      ) {
        const n = Number(e.key);
        if (n >= 1 && n <= quizQ.options.length && picked === undefined) pick(n - 1);
        else if (e.key === 'Enter' && picked !== undefined) {
          e.preventDefault();
          setQuizAt((i) => i + 1);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // ───── Progreso: preguntas, test y resumen ─────
  const segments = questions.length + (withQuiz ? 1 : 0) + 1;
  const position =
    step === 'ask'
      ? at
      : step === 'quiz'
        ? questions.length
        : step === 'summary'
          ? segments - 1
          : step === 'done'
            ? segments
            : -1;

  const style = {
    '--c': tone.accent,
    '--s': tone.soft,
    '--k': tone.ink,
  } as CSSProperties;
  const noun = medium === 'libro' ? 'el libro' : medium === 'serie' ? 'la serie' : 'la película';

  return (
    <Sheet
      label={`Ritual de cierre de ${entry.title}`}
      className="cr"
      onRequestClose={() => void requestClose()}
    >
      <div className="cr-wrap" style={style}>
        <header className="cr-head">
          <span className="cr-art">
            {img ? <img src={img.thumb ?? img.medium ?? img.url} alt="" /> : <Icon size={20} />}
          </span>
          <div className="cr-title">
            <small>
              <Sparkles size={11} /> Ritual de cierre
            </small>
            <h2>{entry.title}</h2>
            {position >= 0 && step !== 'done' && (
              <span className="cr-steps" aria-hidden="true">
                {Array.from({ length: segments }, (_, i) => (
                  <i key={i} className={i < position ? 'done' : i === position ? 'now' : ''} />
                ))}
              </span>
            )}
          </div>
          <button
            type="button"
            className="cr-x"
            aria-label="Cerrar"
            onClick={() => void requestClose()}
          >
            <X size={18} />
          </button>
        </header>

        {step === 'intro' && (
          <>
            <div className="cr-body cr-intro">
              <p className="cr-lead">
                Terminaste {noun}. Antes de pasar a lo siguiente, dedica un momento a quedarte con
                lo que valió la pena: tus respuestas se convierten en un aprendizaje que Nexo te
                traerá de vuelta para que no se olvide.
              </p>
              {previous && (
                <p className="cr-note">
                  Ya hiciste un cierre {friendlyDate(previous.at).toLowerCase()}. Si lo rehaces, se
                  reemplaza y su aprendizaje se actualiza.
                </p>
              )}
              <div className="cr-depths" role="radiogroup" aria-label="Cuántas preguntas">
                {depths.map((x) => (
                  <button
                    type="button"
                    role="radio"
                    key={x.n}
                    aria-checked={depth === x.n}
                    className={depth === x.n ? 'on' : ''}
                    onClick={() => chooseDepth(x.n)}
                  >
                    <strong>{x.label}</strong>
                    <small>{x.hint}</small>
                  </button>
                ))}
              </div>
              <ol className="cr-preview">
                {questions.map((x) => (
                  <li key={x.id}>{phrase(x, medium)}</li>
                ))}
              </ol>
              <button
                type="button"
                className="cr-shuffle"
                onClick={() =>
                  setQuestions(
                    pickQuestions(
                      medium,
                      depth,
                      questions.map((x) => x.id),
                    ),
                  )
                }
              >
                <Shuffle size={13} /> Otras preguntas
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={withQuiz}
                className={'cr-toggle' + (withQuiz ? ' on' : '')}
                onClick={toggleQuiz}
              >
                <span className="cr-toggle-icon">
                  <GraduationCap size={17} />
                </span>
                <span className="cr-toggle-text">
                  <strong>Ponme a prueba</strong>
                  <small>La IA te hace un test de 5 preguntas y te califica.</small>
                </span>
                <span className="cr-switch" aria-hidden="true" />
              </button>
            </div>
            <footer className="cr-foot">
              <button type="button" className="cr-btn ghost" onClick={onClose}>
                Ahora no
              </button>
              <span className="cr-sp" />
              <button type="button" className="cr-btn main" onClick={start}>
                Empezar <ArrowRight size={15} />
              </button>
            </footer>
          </>
        )}

        {step === 'ask' && q && (
          <>
            <div className="cr-body cr-ask" key={q.id}>
              <div className="cr-qmeta">
                <span>
                  {at + 1} de {questions.length} · {topicLabel[q.topic]}
                </span>
                <button
                  type="button"
                  onClick={swap}
                  title="Cambiar por otra pregunta del mismo tipo"
                >
                  <RefreshCw size={12} /> Otra pregunta
                </button>
              </div>
              <h3 className="cr-q">{phrase(q, medium)}</h3>
              <AutoTextarea
                autoFocus
                value={answers[q.id] ?? ''}
                minRows={4}
                maxLength={2000}
                placeholder={q.hint + '…'}
                aria-label={phrase(q, medium)}
                className="cr-answer"
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
              {q.topic === 'recomendar' && (
                <div className="cr-people">
                  {chosen.length > 0 && (
                    <div className="cr-chosen">
                      {chosen.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          title={`Quitar a ${p.name}`}
                          onClick={() => setRecommend((r) => r.filter((id) => id !== p.id))}
                        >
                          <Avatar person={p} size={22} /> {p.name.split(' ').slice(0, 2).join(' ')}
                          <X size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                  {reachable.length > 0 && (
                    <label className="cr-search">
                      <Search size={14} />
                      <input
                        value={who}
                        placeholder="Busca a alguien de tu gente"
                        onChange={(e) => setWho(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && matches[0]) {
                            e.preventDefault();
                            setRecommend((r) => [...r, matches[0].id]);
                            setWho('');
                          }
                        }}
                      />
                    </label>
                  )}
                  {matches.length > 0 && (
                    <div className="cr-matches">
                      {matches.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => {
                            setRecommend((r) => [...r, p.id]);
                            setWho('');
                          }}
                        >
                          <Avatar person={p} size={22} /> {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <small className="cr-kbd">
                <kbd>Ctrl</kbd> + <kbd>Enter</kbd> para seguir
              </small>
            </div>
            <footer className="cr-foot">
              <button type="button" className="cr-btn ghost" onClick={back}>
                <ArrowLeft size={15} /> Atrás
              </button>
              <span className="cr-sp" />
              {!(answers[q.id] ?? '').trim() && (
                <button type="button" className="cr-btn ghost" onClick={next}>
                  Saltar
                </button>
              )}
              <button
                type="button"
                className="cr-btn main"
                disabled={!(answers[q.id] ?? '').trim()}
                onClick={next}
              >
                {isLastQuestion ? (withQuiz ? 'Ir al test' : 'Ver mi aprendizaje') : 'Siguiente'}
                <ArrowRight size={15} />
              </button>
            </footer>
          </>
        )}

        {step === 'quiz' && (
          <>
            <div className="cr-body cr-quiz">
              {quiz.status === 'loading' && (
                <div className="cr-wait">
                  <LoaderCircle className="spin" size={22} />
                  <strong>Preparando tu test…</strong>
                  <small>La IA está escribiendo 5 preguntas sobre {noun}.</small>
                </div>
              )}
              {quiz.status === 'error' && (
                <div className="cr-wait">
                  <strong>No se pudo preparar el test</strong>
                  <small>{quiz.message}</small>
                  <div className="cr-row">
                    <button type="button" className="cr-btn" onClick={loadQuiz}>
                      <RefreshCw size={14} /> Reintentar
                    </button>
                    <button
                      type="button"
                      className="cr-btn ghost"
                      onClick={() => {
                        setWithQuiz(false);
                        setStep('summary');
                      }}
                    >
                      Seguir sin test
                    </button>
                  </div>
                </div>
              )}
              {quiz.status === 'ready' && quizQ && (
                <div key={quizAt}>
                  <div className="cr-qmeta">
                    <span>
                      Pregunta {quizAt + 1} de {quiz.questions.length}
                    </span>
                    {!quiz.known && quizAt === 0 && (
                      <span className="cr-flag">Basado en la sinopsis</span>
                    )}
                  </div>
                  <h3 className="cr-q">{quizQ.q}</h3>
                  <div className="cr-options" role="radiogroup" aria-label="Opciones">
                    {quizQ.options.map((o, i) => {
                      const state =
                        picked === undefined
                          ? ''
                          : i === quizQ.answer
                            ? ' right'
                            : i === picked
                              ? ' wrong'
                              : ' dim';
                      return (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={picked === i}
                          key={i}
                          className={'cr-option' + state}
                          disabled={picked !== undefined}
                          onClick={() => pick(i)}
                        >
                          <kbd>{i + 1}</kbd>
                          <span>{o}</span>
                          {state === ' right' && <Check size={16} />}
                          {state === ' wrong' && <X size={16} />}
                        </button>
                      );
                    })}
                  </div>
                  {picked !== undefined && (
                    <p className={'cr-why ' + (picked === quizQ.answer ? 'right' : 'wrong')}>
                      <strong>{picked === quizQ.answer ? '¡Correcto!' : 'No era esa.'}</strong>{' '}
                      {quizQ.why}
                    </p>
                  )}
                </div>
              )}
              {quiz.status === 'ready' && !quizQ && (
                <div className="cr-score">
                  <span
                    className="cr-ring"
                    style={
                      {
                        '--p': `${(score / quiz.questions.length) * 100}%`,
                      } as CSSProperties
                    }
                  >
                    <b>
                      {score}
                      <small>/{quiz.questions.length}</small>
                    </b>
                  </span>
                  <strong>{verdict(score, quiz.questions.length).title}</strong>
                  <p>{verdict(score, quiz.questions.length).text}</p>
                  {score < quiz.questions.length && (
                    <small>Lo que fallaste queda en tu aprendizaje para repasarlo.</small>
                  )}
                </div>
              )}
            </div>
            <footer className="cr-foot">
              <button type="button" className="cr-btn ghost" onClick={back}>
                <ArrowLeft size={15} /> Atrás
              </button>
              <span className="cr-sp" />
              {quiz.status === 'ready' && quizQ && (
                <button
                  type="button"
                  className="cr-btn main"
                  disabled={picked === undefined}
                  onClick={() => setQuizAt((i) => i + 1)}
                >
                  {quizAt === quiz.questions.length - 1 ? 'Ver mi nota' : 'Siguiente'}
                  <ArrowRight size={15} />
                </button>
              )}
              {quiz.status === 'ready' && !quizQ && (
                <button type="button" className="cr-btn main" onClick={() => setStep('summary')}>
                  Ver mi aprendizaje <ArrowRight size={15} />
                </button>
              )}
            </footer>
          </>
        )}

        {step === 'summary' && (
          <>
            <div className="cr-body cr-summary">
              {hasContent ? (
                <article className="cr-learning">
                  <span className="cr-kicker">
                    <Brain size={13} /> Tu aprendizaje
                  </span>
                  <h3>{preview.title}</h3>
                  <p className="cr-learning-body">{preview.body}</p>
                  {preview.details.apply && (
                    <p className="cr-apply">
                      <b>Lo aplicaré</b> {preview.details.apply}
                    </p>
                  )}
                  <div className="cr-tags">
                    <span>
                      <Icon size={12} /> {entry.title}
                    </span>
                    {confidence && <span>Dominio {confidence}/5</span>}
                    {ritual.quiz && (
                      <span>
                        Test {ritual.quiz.score}/{ritual.quiz.total}
                      </span>
                    )}
                  </div>
                </article>
              ) : (
                <p className="cr-note">
                  No respondiste ninguna pregunta: se guardará solo el resultado del test, sin
                  aprendizaje.
                </p>
              )}
              {hasContent && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={review}
                  className={'cr-toggle' + (review ? ' on' : '')}
                  onClick={() => setReview((v) => !v)}
                >
                  <span className="cr-toggle-icon">
                    <Brain size={17} />
                  </span>
                  <span className="cr-toggle-text">
                    <strong>Repaso espaciado</strong>
                    <small>
                      {review
                        ? `Te lo traeré ${friendlyDate(firstReview()).toLowerCase()} en tu agenda y luego cada vez más espaciado.`
                        : 'No se repasará: quedará solo como aprendizaje.'}
                    </small>
                    {review && (
                      <span className="cr-plan">
                        {reviewPlan.map((d, i) => (
                          <i key={i}>{d}</i>
                        ))}
                        <i>…</i>
                      </span>
                    )}
                  </span>
                  <span className="cr-switch" aria-hidden="true" />
                </button>
              )}
            </div>
            <footer className="cr-foot">
              <button type="button" className="cr-btn ghost" onClick={back} disabled={busy}>
                <ArrowLeft size={15} /> Atrás
              </button>
              <span className="cr-sp" />
              <button
                type="button"
                className="cr-btn main"
                disabled={busy || (!hasContent && !ritual.quiz)}
                onClick={() => void save()}
              >
                {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                Guardar cierre
              </button>
            </footer>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="cr-body cr-done">
              <span className="cr-done-icon">
                <Check size={26} />
              </span>
              <h3>Cierre guardado</h3>
              <p>
                {learning
                  ? review
                    ? `Tu aprendizaje quedó enlazado a «${entry.title}». El primer repaso es ${friendlyDate(firstReview()).toLowerCase()}.`
                    : `Tu aprendizaje quedó enlazado a «${entry.title}».`
                  : `Guardaste tu resultado del test en «${entry.title}».`}
              </p>
            </div>
            <footer className="cr-foot">
              {learning && (
                <button
                  type="button"
                  className="cr-btn ghost"
                  onClick={() => {
                    onClose();
                    viewEntry(learning);
                  }}
                >
                  Ver aprendizaje
                </button>
              )}
              <span className="cr-sp" />
              <button type="button" className="cr-btn main" onClick={onClose}>
                Listo
              </button>
            </footer>
          </>
        )}
      </div>
    </Sheet>
  );
}
