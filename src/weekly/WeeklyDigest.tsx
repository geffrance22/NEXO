import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clapperboard,
  Copy,
  Gift,
  Layers,
  Lightbulb,
  LoaderCircle,
  MapPin,
  Newspaper,
  PenLine,
  Quote,
  Smile,
  Sparkles,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { Sheet } from '../components/Sheet';
import { kindMeta } from '../composer/kinds';
import { commitmentKinds, commitmentOf, counterpartOf } from '../lib/commitments';
import { addDays, friendlyDate, money, todayInputValue } from '../lib/format';
import { exchangeKinds } from '../lib/people';
import { placeKinds } from '../lib/places';
import { updateKinds } from '../lib/updates';
import { episodeKindOf } from '../lib/episodes';
import { Avatar } from '../people/Avatar';
import { AiText } from '../readings/AiText';
import { dismiss, useDismissed } from '../relations/dismissed';
import { day, frontPage, moodOf, readingsOf, weekOf, weekRange, type WeekReading } from './week';
import { WeekPeek, type Peek } from './WeekPeek';
import './weekly.css';

export { weekOf, weekRange } from './week';

const pretty = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(d + 'T12:00:00').toLocaleDateString('es-CO', opts).replace(/\./g, '');
const first = (name: string) => name.split(' ')[0];
const stars = (n?: number) => (n ? '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n)) : '');
const stageLabel = { idea: 'Idea', curso: 'En curso', pausa: 'En pausa', listo: 'Listo' };
/** Lo que se abre encima del periódico: él no cierra con Esc mientras exista. */
const ABOVE = '.nx-peek, .modal-backdrop, .sheet-backdrop:not(:has(> .sheet.wk))';

/** Una sección del periódico: si no hay nada que contar, no se muestra. */
function Sec({
  icon,
  title,
  className = '',
  children,
}: {
  icon: ReactNode;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={'wk-sec ' + className}>
      <h3>
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Periódico personal de la semana: portada con titular, a quién viste y dónde, cómo te sentiste,
 * lo que terminaste de leer, aprendiste y escribiste, la vida de tu gente, tus episodios, el
 * dinero y lo que viene. Solo aparecen las secciones con algo que contar. Todo se abre encima,
 * sin salir del periódico.
 */
export function WeeklyDigest({ onClose }: { onClose: () => void }) {
  const { workspace, viewEntry, peekPerson, openImages, notify } = useApp();
  const [back, setBack] = useState(0);
  const { start, end } = weekRange(addDays(todayInputValue(), -7 * back));
  const w = useMemo(() => weekOf(workspace, start, end), [workspace, start, end]);
  const [reading, setReading] = useState<WeekReading | null>(null);
  const [chronicle, setChronicle] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState(false);
  const [aiError, setAiError] = useState('');
  const [peek, setPeek] = useState<Peek | null>(null);

  useEffect(() => {
    let live = true;
    setReading(null);
    setAiError('');
    setPeek(null);
    void readingsOf(start, end)
      .then((r) => live && setReading(r))
      .catch(() => live && setReading({ articles: [], marks: 0, quote: null, missing: false }));
    return () => {
      live = false;
    };
  }, [start, end]);

  const range = `${pretty(start, { day: 'numeric', month: 'short' })} – ${pretty(end, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
  const finished = reading?.articles ?? [];
  const stats = [
    { n: w.meetings.length, label: w.meetings.length === 1 ? 'encuentro' : 'encuentros' },
    { n: w.people.length, label: w.people.length === 1 ? 'persona' : 'personas' },
    { n: w.places.length, label: w.places.length === 1 ? 'lugar' : 'lugares' },
    { n: finished.length, label: finished.length === 1 ? 'lectura' : 'lecturas' },
    { n: reading?.marks ?? 0, label: 'resaltados' },
    { n: w.learnings.length, label: w.learnings.length === 1 ? 'aprendizaje' : 'aprendizajes' },
    { n: w.notes.length, label: w.notes.length === 1 ? 'nota' : 'notas' },
  ].filter((s) => s.n > 0);
  // Se decide cuando ya llegaron las lecturas (si no, parpadea al abrir).
  const quiet =
    reading !== null &&
    !w.entries.length &&
    !finished.length &&
    !reading?.marks &&
    !w.news.length &&
    !w.episodes.length &&
    !w.exchanges.length &&
    !w.met.length;
  const front = frontPage(w, reading);
  const text = chronicle[start];
  const hasMood = w.moodDays.some((d) => d.mood !== null);
  const top = w.topMood !== null ? moodOf(w.topMood) : null;
  const maxCat = w.categories[0]?.[1] ?? 1;

  const writeChronicle = async () => {
    setWriting(true);
    setAiError('');
    try {
      const name = (id: string) => workspace.people.find((p) => p.id === id)?.name;
      const digest = {
        semana: range,
        titular: front.headline,
        encuentros: w.meetings.slice(0, 12).map((e) => ({
          título: e.title,
          con: e.person_ids.map(name).filter(Boolean),
          lugar: e.details.place,
        })),
        personas: w.people.slice(0, 12).map((x) => ({ nombre: x.person.name, veces: x.n })),
        lugares: w.places.slice(0, 8).map((p) => ({ lugar: p.name, visitas: p.visits.length })),
        ánimo: top?.label,
        lecturas_terminadas: finished.slice(0, 10).map((a) => a.title),
        cita: reading?.quote,
        aprendizajes: w.learnings.slice(0, 8).map((e) => e.title),
        libros_y_películas: w.media.slice(0, 6).map((e) => `${e.kind}: ${e.title}`),
        trabajo: w.work.slice(0, 6).map((e) => e.title),
        notas: w.notes.slice(0, 6).map((e) => e.title),
        novedades: w.news.slice(0, 8).map((x) => `${x.person.name}: ${x.update.text}`),
        gente_nueva: w.met.slice(0, 6).map((p) => p.name),
        dar_y_recibir: w.exchanges
          .slice(0, 6)
          .map(
            ({ person, x }) =>
              `${x.dir === 'dar' ? 'Diste' : 'Recibiste'} ${exchangeKinds[x.kind].toLowerCase()} ${x.dir === 'dar' ? 'a' : 'de'} ${person.name}`,
          ),
        episodios: w.episodes.slice(0, 6).map((x) => x.episode.title),
        cerrados: w.closed.slice(0, 6).map((e) => e.title),
        dinero: { gastado: w.spent, ingresos: w.earned, categoría: w.topCategory?.[0] },
        pendientes: w.ahead.map((e) => ({
          qué: e.title,
          tipo: commitmentKinds[commitmentOf(e)].label,
          con: counterpartOf(e, workspace.people)?.name,
          para: e.details.due,
        })),
        cumpleaños: w.birthdays.map((b) => b.person.name),
      };
      const { data, error } = await supabase.functions.invoke('assistant', {
        body: { mode: 'weekly-editorial', digest },
      });
      if (error) {
        const detail = (await (error as { context?: Response }).context
          ?.json?.()
          .catch(() => null)) as { error?: string } | null;
        // La versión desplegada de assistant aún no conoce este modo.
        if (/pregunta debe tener/i.test(detail?.error ?? ''))
          throw Error(
            'La crónica necesita la versión nueva de la función assistant. Despliégala y vuelve a intentarlo.',
          );
        throw Error(detail?.error || 'No se pudo escribir la crónica.');
      }
      if (typeof data?.answer !== 'string') throw Error('No se pudo escribir la crónica.');
      setChronicle((x) => ({ ...x, [start]: data.answer }));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'No se pudo escribir la crónica.');
    } finally {
      setWriting(false);
    }
  };

  return (
    <>
      {/* Va primero: si se cierran juntos, el scroll de la página se restaura en orden. */}
      {peek && <WeekPeek peek={peek} onClose={() => setPeek(null)} />}
      <Sheet label="Tu semana" size="lg" className="wk" yieldTo={ABOVE} onRequestClose={onClose}>
        <div className="wk-wrap">
          <header className="wk-mast">
            <div className="wk-nav">
              <button
                type="button"
                aria-label="Semana anterior"
                onClick={() => setBack((b) => b + 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>{range}</span>
              <button
                type="button"
                aria-label="Semana siguiente"
                disabled={back === 0}
                onClick={() => setBack((b) => Math.max(0, b - 1))}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
              <X size={20} />
            </button>
            <h2>
              <Newspaper size={22} /> El Nexo semanal
            </h2>
            {stats.length > 0 && (
              <div className="wk-stats">
                {stats.map((s) => (
                  <span key={s.label}>
                    <b>{s.n}</b> {s.label}
                  </span>
                ))}
              </div>
            )}
          </header>

          <div className="wk-scroll">
            {quiet ? (
              <div className="wk-quiet">
                <Newspaper size={26} />
                <strong>Una semana tranquila</strong>
                <p>
                  No registraste encuentros, lugares, lecturas terminadas ni novedades entre el{' '}
                  {pretty(start, { day: 'numeric', month: 'long' })} y el{' '}
                  {pretty(end, { day: 'numeric', month: 'long' })}.
                </p>
                <button type="button" onClick={() => setBack((b) => b + 1)}>
                  <ChevronLeft size={14} /> Ver la semana anterior
                </button>
              </div>
            ) : (
              <>
                <section className="wk-front">
                  <span className="wk-kicker">Portada</span>
                  <h3 className="wk-headline">{front.headline}</h3>
                  {front.deck && <p className="wk-deck">{front.deck}</p>}
                  {w.photos.length > 0 && (
                    <div className="wk-photos">
                      {w.photos.slice(0, 5).map((img, i) => (
                        <button
                          type="button"
                          key={img.url}
                          aria-label="Ver la foto"
                          onClick={() => openImages(w.photos, i)}
                        >
                          <img src={img.thumb ?? img.medium ?? img.url} alt="" loading="lazy" />
                          {i === 4 && w.photos.length > 5 && <i>+{w.photos.length - 5}</i>}
                        </button>
                      ))}
                    </div>
                  )}
                  {text ? (
                    <div className="wk-chronicle">
                      <AiText text={text} />
                      <div className="wk-ed-tools">
                        <button
                          type="button"
                          onClick={() =>
                            void navigator.clipboard
                              ?.writeText(text)
                              .then(() => notify('Crónica copiada.'))
                          }
                        >
                          <Copy size={13} /> Copiar
                        </button>
                        <button
                          type="button"
                          disabled={writing}
                          onClick={() => void writeChronicle()}
                        >
                          {writing ? (
                            <LoaderCircle className="spin" size={13} />
                          ) : (
                            <Sparkles size={13} />
                          )}{' '}
                          Reescribir
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="wk-ai">
                      <button
                        type="button"
                        className="wk-ai-btn"
                        disabled={writing}
                        onClick={() => void writeChronicle()}
                      >
                        {writing ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : (
                          <Sparkles size={14} />
                        )}
                        {writing ? 'Escribiendo…' : 'Crónica con IA'}
                      </button>
                      <small>La IA cuenta tu semana en dos o tres párrafos con estos datos.</small>
                    </div>
                  )}
                  {aiError && <p className="wk-ai-error">{aiError}</p>}
                </section>

                <div className="wk-grid">
                  {w.people.length > 0 && (
                    <Sec icon={<Users size={14} />} title="A quién viste">
                      <div className="wk-faces">
                        {w.people.slice(0, 12).map(({ person, n }) => (
                          <button
                            type="button"
                            key={person.id}
                            title={person.name}
                            onClick={() => peekPerson(person)}
                          >
                            <Avatar person={person} size={36} />
                            <span>{first(person.name)}</span>
                            {n > 1 && <i>×{n}</i>}
                          </button>
                        ))}
                      </div>
                      <ul className="wk-list">
                        {w.meetings.slice(0, 5).map((e) => (
                          <li key={e.id}>
                            <button type="button" onClick={() => viewEntry(e)}>
                              <span>{e.title}</span>
                              <small>{friendlyDate(day(e.created_at))}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Sec>
                  )}

                  {w.places.length > 0 && (
                    <Sec icon={<MapPin size={14} />} title="Lugares visitados">
                      <ul className="wk-list">
                        {w.places.slice(0, 6).map((v) => {
                          const k = placeKinds[v.place?.kind ?? 'otro'] ?? placeKinds.otro;
                          return (
                            <li key={v.key}>
                              <button
                                type="button"
                                onClick={() => setPeek({ kind: 'place', visit: v })}
                              >
                                <k.icon size={14} style={{ color: k.color, flex: 'none' }} />
                                <span>
                                  {v.name}
                                  {v.isNew && <em className="wk-new"> nuevo</em>}
                                  {v.people.length > 0 && (
                                    <em>
                                      {' '}
                                      · con{' '}
                                      {v.people
                                        .slice(0, 2)
                                        .map((p) => first(p.name))
                                        .join(' y ')}
                                      {v.people.length > 2 && ` +${v.people.length - 2}`}
                                    </em>
                                  )}
                                </span>
                                <small>
                                  {v.visits.length > 1
                                    ? `${v.visits.length} veces`
                                    : friendlyDate(day(v.visits[0].created_at))}
                                </small>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </Sec>
                  )}

                  {hasMood && (
                    <Sec icon={<Smile size={14} />} title="Cómo te sentiste">
                      <div className="wk-mood">
                        {w.moodDays.map((d) => {
                          const m = d.mood !== null ? moodOf(d.mood) : null;
                          return (
                            <span key={d.date} title={m ? m.label : 'Sin registro'}>
                              <i>{m ? m.emoji : '·'}</i>
                              <small>{pretty(d.date, { weekday: 'short' })}</small>
                            </span>
                          );
                        })}
                      </div>
                      {top && (
                        <p className="wk-muted">
                          Predominó {top.emoji} {top.label.toLowerCase()}
                          {w.bestDay &&
                            w.bestDay.mood !== w.topMood &&
                            ` · tu mejor día fue el ${pretty(w.bestDay.date, { weekday: 'long' })}`}
                        </p>
                      )}
                    </Sec>
                  )}

                  {finished.length > 0 && (
                    <Sec icon={<BookOpen size={14} />} title="Lo que terminaste de leer">
                      <ul className="wk-list">
                        {finished.slice(0, 6).map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => setPeek({ kind: 'reading', row: a })}
                            >
                              <CircleCheck size={14} className="wk-done" />
                              <span>{a.title}</span>
                              {a.marks > 0 && (
                                <small>
                                  {a.marks} {a.marks === 1 ? 'resaltado' : 'resaltados'}
                                </small>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Sec>
                  )}

                  {reading?.quote && (
                    <section className="wk-sec wk-quote">
                      <Quote size={18} />
                      <blockquote>{reading.quote.text}</blockquote>
                      <small>— de «{reading.quote.title}»</small>
                    </section>
                  )}

                  {w.learnings.length > 0 && (
                    <Sec icon={<Lightbulb size={14} />} title="Lo que aprendiste">
                      <ul className="wk-list">
                        {w.learnings.slice(0, 6).map((e) => (
                          <li key={e.id}>
                            <button type="button" onClick={() => viewEntry(e)}>
                              <span>{e.title}</span>
                              {e.details.source && <small>{e.details.source}</small>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Sec>
                  )}

                  {w.media.length > 0 && (
                    <Sec icon={<Clapperboard size={14} />} title="Libros y películas">
                      <ul className="wk-list">
                        {w.media.slice(0, 6).map((e) => {
                          const k = kindMeta[e.kind];
                          return (
                            <li key={e.id}>
                              <button type="button" onClick={() => viewEntry(e)}>
                                <k.icon size={14} style={{ color: k.accent, flex: 'none' }} />
                                <span>
                                  {e.title}
                                  {e.details.author && <em> · {e.details.author}</em>}
                                </span>
                                {e.details.rating ? (
                                  <small className="wk-stars">{stars(e.details.rating)}</small>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </Sec>
                  )}

                  {w.work.length > 0 && (
                    <Sec icon={<Briefcase size={14} />} title="En el trabajo">
                      <ul className="wk-list">
                        {w.work.slice(0, 6).map((e) => (
                          <li key={e.id}>
                            <button type="button" onClick={() => viewEntry(e)}>
                              <span>
                                {e.title}
                                {e.details.nextStep && <em> · sigue: {e.details.nextStep}</em>}
                              </span>
                              {e.details.stage && <small>{stageLabel[e.details.stage]}</small>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Sec>
                  )}

                  {w.notes.length > 0 && (
                    <Sec icon={<PenLine size={14} />} title="Lo que escribiste">
                      <ul className="wk-list">
                        {w.notes.slice(0, 5).map((e) => (
                          <li key={e.id}>
                            <button type="button" onClick={() => viewEntry(e)}>
                              <span>{e.title || 'Nota'}</span>
                              <small>{friendlyDate(day(e.created_at))}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {w.notes.length > 5 && <p className="wk-muted">y {w.notes.length - 5} más</p>}
                    </Sec>
                  )}

                  {w.news.length > 0 && (
                    <Sec icon={<Sparkles size={14} />} title="Novedades de tu gente">
                      <ul className="wk-list">
                        {w.news.slice(0, 6).map(({ person, update }) => {
                          const m = updateKinds[update.kind] ?? updateKinds.otro;
                          return (
                            <li key={update.id}>
                              <button type="button" onClick={() => peekPerson(person)}>
                                <m.icon size={13} style={{ color: m.color, flex: 'none' }} />
                                <span>
                                  <b>{first(person.name)}</b> · {update.text}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </Sec>
                  )}

                  {w.met.length > 0 && (
                    <Sec icon={<UserPlus size={14} />} title="Gente nueva">
                      <div className="wk-faces">
                        {w.met.slice(0, 10).map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            title={p.name}
                            onClick={() => peekPerson(p)}
                          >
                            <Avatar person={p} size={36} />
                            <span>{first(p.name)}</span>
                          </button>
                        ))}
                      </div>
                      {w.met.some((p) => p.profile.metHow) && (
                        <p className="wk-muted">
                          {w.met
                            .filter((p) => p.profile.metHow)
                            .slice(0, 2)
                            .map((p) => `${first(p.name)}: ${p.profile.metHow}`)
                            .join(' · ')}
                        </p>
                      )}
                    </Sec>
                  )}

                  {w.exchanges.length > 0 && (
                    <Sec icon={<Gift size={14} />} title="Dar y recibir">
                      <ul className="wk-list">
                        {w.exchanges.slice(0, 6).map(({ person, x }) => (
                          <li key={x.id}>
                            <button type="button" onClick={() => peekPerson(person)}>
                              <span>
                                {x.dir === 'dar' ? 'Le diste' : 'Recibiste'}{' '}
                                <b>{exchangeKinds[x.kind].toLowerCase()}</b>{' '}
                                {x.dir === 'dar' ? 'a' : 'de'} {first(person.name)}
                                {x.note && <em> · {x.note}</em>}
                              </span>
                              <small className={x.dir === 'dar' ? 'give' : 'get'}>
                                {x.dir === 'dar' ? 'diste' : 'recibiste'}
                              </small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Sec>
                  )}

                  {w.episodes.length > 0 && (
                    <Sec icon={<Layers size={14} />} title="Tus episodios">
                      <ul className="wk-list">
                        {w.episodes.slice(0, 5).map((item) => {
                          const k = episodeKindOf(item.episode.kind);
                          const last = item.updates[0];
                          return (
                            <li key={item.episode.id}>
                              <button
                                type="button"
                                onClick={() => setPeek({ kind: 'episode', item })}
                              >
                                <k.icon size={14} style={{ color: k.color, flex: 'none' }} />
                                <span>
                                  {item.episode.title}
                                  {last && <em> · {last.text}</em>}
                                </span>
                                <small>
                                  {item.episode.status === 'activo' ? 'En curso' : 'Cerrado'}
                                </small>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </Sec>
                  )}

                  {w.closed.length > 0 && (
                    <Sec icon={<CircleCheck size={14} />} title="Lo que cerraste">
                      <ul className="wk-list">
                        {w.closed.slice(0, 6).map((e) => (
                          <li key={e.id}>
                            <button type="button" onClick={() => viewEntry(e)}>
                              <span className="wk-struck">{e.title}</span>
                              <small>{commitmentKinds[commitmentOf(e)].short}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Sec>
                  )}

                  {(w.spent > 0 || w.earned > 0) && (
                    <Sec icon={<Wallet size={14} />} title="Dinero" className="wk-money">
                      <div>
                        {w.spent > 0 && (
                          <span>
                            <b className="out">−{money(w.spent)}</b> gastado
                          </span>
                        )}
                        {w.earned > 0 && (
                          <span>
                            <b className="in">+{money(w.earned)}</b> ingresos
                          </span>
                        )}
                      </div>
                      {w.categories.length > 0 && (
                        <ul className="wk-bars">
                          {w.categories.map(([cat, amount]) => (
                            <li key={cat}>
                              <span>{cat}</span>
                              <i
                                style={{ '--w': `${(100 * amount) / maxCat}%` } as CSSProperties}
                              />
                              <small>{money(amount)}</small>
                            </li>
                          ))}
                        </ul>
                      )}
                      {w.biggest && (
                        <button
                          type="button"
                          className="wk-biggest"
                          onClick={() => viewEntry(w.biggest!)}
                        >
                          El gasto más grande: <b>{w.biggest.title}</b> · {money(w.biggest.amount)}
                        </button>
                      )}
                    </Sec>
                  )}

                  {(w.ahead.length > 0 || w.birthdays.length > 0 || w.followUps.length > 0) && (
                    <Sec
                      icon={<CalendarClock size={14} />}
                      title="Para la semana que viene"
                      className="wk-ahead"
                    >
                      <ul className="wk-list">
                        {w.birthdays.map(({ person, inDays }) => (
                          <li key={'b' + person.id}>
                            <button type="button" onClick={() => peekPerson(person)}>
                              <span>🎂 Cumpleaños de {first(person.name)}</span>
                              <small>
                                en {inDays} {inDays === 1 ? 'día' : 'días'}
                              </small>
                            </button>
                          </li>
                        ))}
                        {w.followUps.slice(0, 4).map(({ person, update }) => (
                          <li key={'f' + update.id}>
                            <button type="button" onClick={() => peekPerson(person)}>
                              <span>
                                Pregúntale a {first(person.name)}: <em>{update.text}</em>
                              </span>
                              <small>{friendlyDate(update.followUp!).toLowerCase()}</small>
                            </button>
                          </li>
                        ))}
                        {w.ahead.map((e) => {
                          const late = Boolean(e.details.due && e.details.due < todayInputValue());
                          const who = counterpartOf(e, workspace.people)?.name;
                          return (
                            <li key={e.id}>
                              <button type="button" onClick={() => viewEntry(e)}>
                                <span>
                                  {e.title}
                                  {who && <em> · {first(who)}</em>}
                                </span>
                                <small className={late ? 'late' : ''}>
                                  {e.details.due
                                    ? (late ? 'venció ' : '') +
                                      friendlyDate(e.details.due).toLowerCase()
                                    : commitmentKinds[commitmentOf(e)].short}
                                </small>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </Sec>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Sheet>
    </>
  );
}

/** El domingo (y el lunes) la agenda avisa que el periódico de la semana está listo. */
export function WeeklyAgendaCard() {
  const { workspace, openWeekly } = useApp();
  const skip = useDismissed();
  const today = todayInputValue();
  const weekday = new Date().getDay();
  const sunday = weekday === 0 ? today : addDays(today, -1);
  const key = `weekly|${sunday}`;
  const w = useMemo(() => weekOf(workspace, addDays(sunday, -6), sunday), [workspace, sunday]);
  if ((weekday !== 0 && weekday !== 1) || skip.has(key)) return null;
  const bits = [
    w.meetings.length &&
      `${w.meetings.length} ${w.meetings.length === 1 ? 'encuentro' : 'encuentros'}`,
    w.places.length && `${w.places.length} ${w.places.length === 1 ? 'lugar' : 'lugares'}`,
    w.learnings.length &&
      `${w.learnings.length} ${w.learnings.length === 1 ? 'aprendizaje' : 'aprendizajes'}`,
    w.ahead.length && `${w.ahead.length} cosas por cerrar`,
  ].filter(Boolean);
  return (
    <div className="ag-card" style={{ '--c': '#b0703a', '--s': '#f8ecdf' } as CSSProperties}>
      <span className="ag-icon">
        <Newspaper size={17} />
      </span>
      <div className="ag-main">
        <strong>Tu periódico de la semana está listo</strong>
        <p>
          {bits.length ? bits.join(', ') + '.' : 'Lo que leíste, a quién viste y lo que viene.'}
        </p>
        <div className="ag-why">
          <i>{weekday === 0 ? 'Es domingo' : 'Resumen semanal'}</i>
        </div>
      </div>
      <div className="ag-actions">
        <button type="button" className="ag-primary" onClick={openWeekly}>
          Leer <ArrowRight size={13} />
        </button>
        <div className="ag-minor">
          <button
            type="button"
            aria-label="Descartar"
            title="Descartar"
            onClick={() => dismiss(key)}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
