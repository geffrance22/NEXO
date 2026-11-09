import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  BookOpen,
  Brain,
  Check,
  Clock,
  Eye,
  LoaderCircle,
  Sparkles,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { todayInputValue } from '../lib/format';
import { AiText } from '../readings/AiText';
import {
  DAILY_REVIEWS,
  dueReviews,
  inDays,
  schedule,
  type Grade,
  type ReviewItem,
} from '../readings/review';
import {
  cardFaces,
  fromHighlight,
  fromQuote,
  interleave,
  rateCard,
  type ReviewCard,
} from '../review/cards';
import { Connect } from '../review/Connect';
import { modeOf, planSession, type Mode } from '../review/links';
import { dueQuotes } from '../review/quotes';

const SNOOZE = 'nexo-review-snooze';
const look = { color: '#5a49b8', soft: '#eeebfa' };

/**
 * Tarjeta de la agenda: «Repasa N ideas de tus lecturas y libros». Aparece cuando hay resaltados
 * de artículos o citas de libros que toca repasar hoy (repaso espaciado) y abre el repaso.
 */
export function ReviewAgendaCard() {
  const { workspace } = useApp();
  const [marks, setMarks] = useState<{ items: ReviewItem[]; total: number } | null>(null);
  // Las tarjetas de esta sesión: se fijan al abrir, aunque lo de debajo cambie mientras repasas.
  const [session, setSession] = useState<ReviewCard[] | null>(null);
  const [snoozed, setSnoozed] = useState(() => localStorage.getItem(SNOOZE) === todayInputValue());

  const load = useCallback(() => {
    // Sin la migración de Lecturas igual puede haber citas de libros que repasar.
    void dueReviews().then((r) => setMarks(r ?? { items: [], total: 0 }));
  }, []);
  useEffect(load, [load]);

  const quotes = useMemo(() => dueQuotes(workspace.entries), [workspace.entries]);
  const cards = useMemo(
    () =>
      marks
        ? interleave(
            marks.items.map(fromHighlight),
            [...quotes.due, ...quotes.fresh].map(fromQuote),
          ).slice(0, DAILY_REVIEWS)
        : [],
    [marks, quotes],
  );
  const total = (marks?.total ?? 0) + quotes.due.length + quotes.fresh.length;

  const showCard = cards.length > 0 && !snoozed;
  if (!showCard && !session) return null;

  const n = cards.length;
  const titles = [...new Set(cards.map((c) => c.from.title))];
  const books = cards.some((c) => c.source === 'cita');
  const articles = cards.some((c) => c.source === 'resaltado');
  const where =
    books && articles ? 'de tus lecturas y libros' : books ? 'de tus libros' : 'de tus lecturas';

  return (
    <>
      {showCard && (
        <div className="ag-card" style={{ '--c': look.color, '--s': look.soft } as CSSProperties}>
          <span className="ag-icon">
            <Brain size={17} />
          </span>
          <div className="ag-main">
            <strong>
              Repasa {n} {n === 1 ? 'idea' : 'ideas'} {where}
            </strong>
            <p>
              De «{titles[0]}»
              {titles.length > 1
                ? ` y ${titles.length - 1} ${titles.length === 2 ? 'fuente' : 'fuentes'} más`
                : ''}
              . Dos minutos para que no se te olviden y, si se da, para darles uso.
            </p>
            <div className="ag-why" title="Por qué aparece">
              <i>Repaso espaciado</i>
              {total > n && <i>{total} pendientes en total</i>}
            </div>
          </div>
          <div className="ag-actions">
            <button type="button" className="ag-primary" onClick={() => setSession(cards)}>
              Repasar <ArrowRight size={13} />
            </button>
            <div className="ag-minor">
              <button
                type="button"
                aria-label="Hoy no"
                title="Hoy no"
                onClick={() => {
                  localStorage.setItem(SNOOZE, todayInputValue());
                  setSnoozed(true);
                }}
              >
                <Clock size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
      {session &&
        createPortal(
          <ReviewDialog
            cards={session}
            onClose={() => {
              setSession(null);
              load();
            }}
          />,
          document.body,
        )}
    </>
  );
}

type GradeOption = { id: Grade; label: string; key: string };
/** Tarjetas con respuesta: lo piensas, lo ves y dices cómo te fue. */
const recallGrades: GradeOption[] = [
  { id: 'otra', label: 'Otra vez', key: '1' },
  { id: 'bien', label: 'Lo recordaba', key: '2' },
  { id: 'facil', label: 'Fácil', key: '3' },
];
/** Citas y resaltados sin respuesta: se leen y dices qué tanto te sirven. */
const reflectGrades: GradeOption[] = [
  { id: 'otra', label: 'Pronto', key: '1' },
  { id: 'bien', label: 'Me sirve', key: '2' },
  { id: 'facil', label: 'Ya la tengo', key: '3' },
];

/**
 * Repaso de ideas. Las tarjetas con pregunta se piensan y se miran; las citas se leen. Casi
 * siempre es solo repasar, pero cuando el momento se da la idea se cruza con algo tuyo (un
 * proyecto, una persona…) y se le puede sacar una idea.
 */
function ReviewDialog({ cards, onClose }: { cards: ReviewCard[]; onClose: () => void }) {
  const { go, notify, workspace, patchEntry, viewEntry } = useApp();
  // Qué tarjetas traen algo más que repasar se decide una vez, al abrir.
  const [plans] = useState(() => planSession(cards, workspace));
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [ideas, setIdeas] = useState(0);
  // La tarjeta en la que pediste sacarle una idea aunque no tocara.
  const [asked, setAsked] = useState<number | null>(null);
  const entries = useRef(workspace.entries);
  entries.current = workspace.entries;

  const card = cards[index];
  const plan = plans[index];
  const f = card ? cardFaces(card) : null;
  const hasBack = Boolean(f?.back);
  const revealed = shown || !hasBack;
  const options = hasBack ? recallGrades : reflectGrades;
  const mode: Mode = !plan
    ? 'recordar'
    : plan.mode !== 'recordar'
      ? plan.mode
      : asked === index
        ? modeOf(plan.links)
        : 'recordar';

  const grade = async (g: Grade) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      await rateCard(card, g, { entries: entries.current, patch: patchEntry });
      setDone((d) => d + 1);
      setIndex((i) => i + 1);
      setShown(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar el repaso.');
    } finally {
      setBusy(false);
    }
  };

  // Atajos: espacio para ver la respuesta; 1, 2, 3 para calificar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || (e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === ' ' && !revealed) {
        e.preventDefault();
        setShown(true);
      } else if (revealed) {
        const g = options.find((x) => x.key === e.key);
        if (g) void grade(g.id);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const extra =
    ideas > 0
      ? ` Y guardaste ${ideas} ${ideas === 1 ? 'idea nueva' : 'ideas nuevas'} en tus proyectos.`
      : '';

  const openSource = () => {
    if (!card) return;
    onClose();
    if (card.source === 'resaltado') go('Lecturas', { id: card.from.id });
    else viewEntry(card.book);
  };

  return (
    <Sheet label="Repaso de tus ideas" size="md" className="rv" onRequestClose={onClose}>
      <div className="rv-wrap">
        <header className="rv-head">
          <span className="rv-chip">
            <Brain size={14} /> Repaso
          </span>
          {card && (
            <span className="rv-progress" aria-label={`Tarjeta ${index + 1} de ${cards.length}`}>
              {cards.map((_, i) => (
                <i key={i} className={i < index ? 'done' : i === index ? 'now' : ''} />
              ))}
            </span>
          )}
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        {card && f ? (
          <div className="rv-body" key={card.id}>
            <div className="rv-scroll">
              <button
                type="button"
                className="rv-source"
                title={card.source === 'cita' ? 'Abrir el libro' : 'Abrir el artículo'}
                onClick={openSource}
              >
                <BookOpen size={13} />
                <span>
                  {card.from.title}
                  {card.from.author ? ` · ${card.from.author}` : ''}
                </span>
              </button>
              <div className={'rv-card ' + f.kind}>
                {f.kind === 'pregunta' ? (
                  <>
                    <h3>{f.front}</h3>
                    {f.quote && <blockquote>«{f.quote}»</blockquote>}
                  </>
                ) : (
                  <blockquote className="big">«{f.front}»</blockquote>
                )}
                {hasBack &&
                  (shown ? (
                    <div className="rv-back">
                      <small>{f.kind === 'pregunta' ? 'Respuesta' : 'Tu nota'}</small>
                      <AiText text={f.back} />
                    </div>
                  ) : (
                    <button type="button" className="rv-reveal" onClick={() => setShown(true)}>
                      <Eye size={15} />{' '}
                      {f.kind === 'pregunta' ? 'Piénsalo y mira la respuesta' : 'Ver tu nota'}
                      <kbd>Espacio</kbd>
                    </button>
                  ))}
              </div>

              {revealed && mode !== 'recordar' && (
                <Connect
                  key={card.id}
                  card={card}
                  links={plan.links}
                  mode={mode}
                  onLeave={onClose}
                  onSaved={() => setIdeas((n) => n + 1)}
                />
              )}
              {revealed && mode === 'recordar' && (
                <button type="button" className="rv-idea" onClick={() => setAsked(index)}>
                  <Sparkles size={13} /> Sacarle una idea
                </button>
              )}
            </div>

            <footer className={'rv-grades' + (revealed ? '' : ' wait')}>
              {options.map((g) => (
                <button
                  type="button"
                  key={g.id}
                  className={g.id}
                  disabled={!revealed || busy}
                  onClick={() => void grade(g.id)}
                >
                  <strong>{g.label}</strong>
                  <small>{inDays(schedule(card.step, g.id).days)}</small>
                </button>
              ))}
              <button
                type="button"
                className="rv-never"
                disabled={busy}
                onClick={() => void grade('nunca')}
              >
                {busy ? <LoaderCircle className="spin" size={13} /> : 'No repasar más'}
              </button>
            </footer>
          </div>
        ) : (
          <div className="rv-end">
            <span>
              <Check size={26} />
            </span>
            <h3>Listo por hoy</h3>
            <p>
              Repasaste {done} {done === 1 ? 'idea' : 'ideas'}.{extra} Volverán justo cuando estén
              por olvidarse.
            </p>
            <button type="button" className="pp-btn dark" onClick={onClose}>
              Volver
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
