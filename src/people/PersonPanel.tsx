import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BellPlus,
  Cake,
  CalendarClock,
  Camera,
  Check,
  ClipboardCheck,
  Clock,
  Feather,
  Flower2,
  Gift,
  MessageCircle,
  Minus,
  NotebookPen,
  Plus,
  Scale,
  Star,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Person, PersonUpdate } from '../data';
import { useInstants } from '../instants/store';
import { missedText, outcomeHint } from '../lib/commitments';
import { updateKinds, updatesOf } from '../lib/updates';
import { addDays, friendlyDate, normalizeText, shortDate, todayInputValue } from '../lib/format';
import {
  ageOf,
  closenessLabels,
  closenessOf,
  companionsOf,
  completeness,
  daysToBirthday,
  exchangeKinds,
  interestsOf,
  relationMeta,
  relationOf,
  relativeDay,
  statsFor,
  statusMeta,
  statusOf,
  type PersonStats,
} from '../lib/people';
import { MiniPhotos, pastedImages } from '../composer/PhotoBlocks';
import { useImageUploads } from '../composer/useImageUploads';
import { PhotoThumbs } from '../components/PhotoThumbs';
import { celsius, thermoColor, thermoLabel } from '../lib/thermo';
import { Avatar } from './Avatar';
import { GiftIdeas } from './GiftIdeas';
import { PersonMenu } from './PersonMenu';
import { ThermoBar, ThermoSheet, useThermo } from './Thermo';
import { Moments, Together } from './Together';
import { MoneySummary } from './PersonMoney';
import { TieChips, TiesTab } from '../relations/TiesTab';

type Tab =
  'resumen' | 'vinculos' | 'identidad' | 'historia' | 'reciprocidad' | 'red' | 'pendientes';
const tabLabels: Record<Tab, string> = {
  resumen: 'Resumen',
  vinculos: 'Vínculos',
  identidad: 'Identidad',
  historia: 'Juntos',
  reciprocidad: 'Dar y recibir',
  red: 'Red',
  pendientes: 'Pendientes',
};
const monthNames = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * Anillo con el índice de vínculo. Con `thermo`, un segundo anillo por dentro con la temperatura
 * de la relación: un degradado de azul al color de su temperatura (naranja cuando está cálida).
 */
export function BondRing({
  value,
  size = 52,
  thermo,
  both = false,
}: {
  value: number;
  size?: number;
  thermo?: number | null;
  /** Escribe los dos números dentro: «55/73» (vínculo grande, termómetro pequeño a su lado). */
  both?: boolean;
}) {
  const dual = typeof thermo === 'number';
  const pair = dual && both;
  const stroke = dual ? (size >= 44 ? 3.5 : 3) : 4;
  const r = (size - stroke - 2) / 2;
  const c = 2 * Math.PI * r;
  // Con los dos números, el anillo de dentro va más pegado y más fino: deja sitio al texto.
  const inner = dual ? (pair ? 2.5 : size >= 44 ? 3 : 2.5) : 0;
  const gap = pair ? 2 : 2.5;
  const t = dual ? Math.round(thermo) : 0;
  // «100/100» no cabe con la letra de «55/73»: con más de cuatro cifras, un poco más pequeña.
  const scale = pair && String(value).length + String(t).length > 4 ? 0.21 : 0.26;
  return (
    <span
      className={'pp-ring' + (dual ? ' dual' : '') + (pair ? ' pair' : '')}
      style={
        {
          width: size,
          height: size,
          ...(dual && {
            '--tv': `${t}%`,
            '--tc': thermoColor(t),
            '--t0': thermoColor(Math.max(0, t - 55)),
            '--ti': `${stroke + gap}px`,
            '--tw': `${inner}px`,
            fontSize: pair
              ? Math.max(9, Math.round(size * scale))
              : Math.max(9, Math.round(size * 0.3)),
          }),
        } as CSSProperties
      }
      title={
        dual
          ? `Vínculo ${value}/100 · Termómetro ${celsius(t)} (${thermoLabel(t)})`
          : `Índice de vínculo: ${value}/100`
      }
    >
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="track" style={{ strokeWidth: stroke }} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="bar"
          style={{ strokeWidth: stroke }}
          strokeDasharray={`${(c * value) / 100} ${c}`}
        />
      </svg>
      {dual && <i className="pp-ring-thermo" aria-hidden="true" />}
      {pair ? (
        <b className="pp-ring-pair">
          {value}
          <small>/{t}</small>
        </b>
      ) : (
        <b>{value}</b>
      )}
    </span>
  );
}

/** Barra de reciprocidad: el centro es «parejo»; a la derecha das más, a la izquierda recibes más. */
export function BalanceBar({ stats, compact = false }: { stats: PersonStats; compact?: boolean }) {
  const r = stats.reciprocity;
  const pos = 50 + r.score / 2;
  return (
    <div className={'pp-balance ' + r.state + (compact ? ' compact' : '')}>
      <div className="pp-balance-track">
        <span
          className="pp-balance-zone"
          style={{ left: `${50 - r.tolerance / 2}%`, width: `${r.tolerance}%` }}
        />
        {r.state !== 'sin-datos' && <i style={{ left: `${pos}%` }} />}
      </div>
      {!compact && (
        <div className="pp-balance-legend">
          <span>Recibes más</span>
          <span>Parejo</span>
          <span>Das más</span>
        </div>
      )}
    </div>
  );
}

/**
 * Lo que de verdad se hace con alguien: escribirle, prepararte antes de verla (qué preguntarle,
 * qué tienen pendiente), contar en 30 segundos cómo te fue después, y que algo no se te olvide.
 */
function ContactActions({ person }: { person: Person }) {
  const { editPerson, openEntry, openBrief } = useApp();
  const first = person.name.split(' ')[0];
  const digits = person.profile.phone?.replace(/[^\d+]/g, '').replace(/^\+/, '');
  // Lo que tienes para preguntarle la próxima vez (preguntas anotadas y novedades por seguir).
  const toAsk =
    (person.profile.askNext?.length ?? 0) +
    (person.profile.updates ?? []).filter((u) => u.followUp && !u.done).length;
  return (
    <div className="pp-actions">
      {digits ? (
        <a
          className="pp-action"
          href={`https://wa.me/${digits}`}
          target="_blank"
          rel="noreferrer"
          title={`Escribirle a ${first}`}
          aria-label={`Escribirle a ${first}`}
        >
          <MessageCircle size={17} />
        </a>
      ) : (
        <button
          type="button"
          className="pp-action off"
          title="Añadir su teléfono para escribirle"
          aria-label="Añadir su teléfono para escribirle"
          onClick={() => editPerson(person, 'contacto')}
        >
          <MessageCircle size={17} />
        </button>
      )}
      <button
        type="button"
        className="pp-action"
        title={
          toAsk
            ? `Preparar el encuentro · ${toAsk} ${toAsk === 1 ? 'cosa' : 'cosas'} para preguntarle`
            : 'Preparar el encuentro: qué preguntarle y qué tienen pendiente'
        }
        aria-label={`Preparar el encuentro con ${first}`}
        onClick={() => openBrief(person, 'antes')}
      >
        <NotebookPen size={17} />
        {toAsk > 0 && <i className="pp-action-n">{toAsk > 9 ? '9+' : toAsk}</i>}
      </button>
      <button
        type="button"
        className="pp-action"
        title="Después de verla: lo que hablaron, lo que prometiste y sus novedades, en 30 s"
        aria-label={`Contar cómo te fue con ${first}`}
        onClick={() => openBrief(person, 'despues')}
      >
        <ClipboardCheck size={17} />
      </button>
      <button
        type="button"
        className="pp-action"
        title="Recordarme algo"
        aria-label={`Recordarme algo sobre ${first}`}
        onClick={() => openEntry('Pendiente', [person.id])}
      >
        <CalendarClock size={17} />
      </button>
    </div>
  );
}

/** Novedades de su vida (trabajo, salud, amor…), cada una con su fecha. */
function Updates({ person, limit }: { person: Person; limit: number }) {
  const { quickPerson, patchPerson, notify, workspace, openInstant } = useApp();
  const { list: instants } = useInstants();
  const instantIds = useMemo(() => new Set((instants ?? []).map((i) => i.id)), [instants]);
  const [all, setAll] = useState(false);
  const list = updatesOf(person);
  const shown = all ? list : list.slice(0, limit);
  const current = () => workspace.people.find((p) => p.id === person.id) ?? person;
  const save = (cur: Person, updates: PersonUpdate[]) =>
    patchPerson(cur, { profile: { ...cur.profile, updates } }, true);

  const remove = async (u: PersonUpdate) => {
    const cur = current();
    const before = cur.profile.updates ?? [];
    if (
      await save(
        cur,
        before.filter((x) => x.id !== u.id),
      )
    )
      notify('Novedad eliminada.', { label: 'Deshacer', run: () => void save(cur, before) });
  };
  const markAsked = (u: PersonUpdate) => {
    const cur = current();
    void save(
      cur,
      (cur.profile.updates ?? []).map((x) => (x.id === u.id ? { ...x, done: true } : x)),
    );
  };

  return (
    <>
      <h4 className="pp-h-row">
        <Activity size={15} /> Novedades
        <button
          type="button"
          className="pp-text-btn"
          onClick={() => quickPerson(person, 'novedad')}
        >
          <Plus size={13} /> Añadir
        </button>
      </h4>
      {!list.length ? (
        <button
          type="button"
          className="pp-update-empty"
          onClick={() => quickPerson(person, 'novedad')}
        >
          ¿Qué hay de nuevo en su vida? Trabajo, salud, amor, un logro… Cada novedad queda con su
          fecha y arma su historia contigo.
        </button>
      ) : (
        <div className="pp-updates">
          {shown.map((u) => {
            const m = updateKinds[u.kind] ?? updateKinds.otro;
            const ask = u.followUp && !u.done;
            return (
              <div
                className="pp-update"
                key={u.id}
                style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
              >
                <span className="pp-update-icon" title={m.label}>
                  <m.icon size={14} />
                </span>
                <div className="pp-update-main">
                  <p>{u.text}</p>
                  {u.images?.length ? <PhotoThumbs images={u.images} /> : null}
                  <small title={friendlyDate(u.date)}>
                    {m.label} · {relativeDay(u.date)}
                    {u.instantId && instantIds.has(u.instantId) && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          className="pp-update-instant"
                          title="Abrir el instante en que lo contaste"
                          onClick={() => openInstant(u.instantId!)}
                        >
                          <Feather size={11} /> Instante
                        </button>
                      </>
                    )}
                    {ask && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          className="pp-update-ask"
                          onClick={() => markAsked(u)}
                        >
                          <Check size={11} /> Preguntar {friendlyDate(u.followUp!).toLowerCase()}
                        </button>
                      </>
                    )}
                  </small>
                </div>
                <button
                  type="button"
                  className="pp-update-x"
                  aria-label="Eliminar novedad"
                  onClick={() => void remove(u)}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
          {list.length > limit && (
            <button type="button" className="pp-text-btn" onClick={() => setAll((v) => !v)}>
              {all ? 'Ver menos' : `Ver las ${list.length} novedades`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function QuickNote({ person }: { person: Person }) {
  const { saveQuickNote } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const photos = useImageUploads([], 6);
  const filled = Boolean(text.trim()) || photos.items.length > 0;
  const ready =
    (Boolean(text.trim()) || photos.images.length > 0) && !photos.busy && !photos.hasError;
  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    if (await saveQuickNote(person, text, photos.images)) {
      setText('');
      photos.reset();
    }
    setBusy(false);
  };
  return (
    <div className="pp-note">
      <textarea
        rows={2}
        maxLength={4000}
        placeholder="¿Qué quieres recordar?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
        }}
        onPaste={(e) => {
          const files = pastedImages(e);
          if (!files.length) return;
          e.preventDefault();
          photos.add(files);
        }}
      />
      <div className="pp-note-bar">
        <MiniPhotos uploads={photos} />
        {filled && (
          <button
            type="button"
            className="pp-btn dark"
            disabled={!ready || busy}
            onClick={() => void save()}
          >
            <Plus size={15} /> {photos.busy ? 'Subiendo…' : 'Guardar nota'}
          </button>
        )}
      </div>
    </div>
  );
}

function Pendings({ stats, person }: { stats: PersonStats; person: Person }) {
  const { toggleEntry, askOutcome, openEntry, viewEntry } = useApp();
  // Cerrados: lo hecho y lo soltado (lo que ya pasó y no se hizo), juntos y desplegables.
  const closed = stats.entries.filter(
    (e) => e.kind === 'Pendiente' && (e.status === 'completado' || e.status === 'no_realizado'),
  );
  const doneCount = closed.filter((e) => e.status === 'completado').length;
  const missedCount = closed.length - doneCount;
  const today = todayInputValue();
  return (
    <div className="pp-pendings">
      {stats.pending.map((e) => (
        <div className="pp-task" key={e.id}>
          <button
            type="button"
            className="pp-check"
            aria-label={outcomeHint(e)}
            title={outcomeHint(e)}
            aria-haspopup="menu"
            onClick={(ev) => askOutcome(e, ev.currentTarget)}
          >
            <Check size={13} />
          </button>
          <button type="button" className="pp-task-main" onClick={() => viewEntry(e)}>
            <strong>{e.title}</strong>
            {e.details.due && (
              <small className={e.details.due < today ? 'late' : ''}>
                <CalendarClock size={12} /> {friendlyDate(e.details.due)}
              </small>
            )}
          </button>
        </div>
      ))}
      {!stats.pending.length && <p className="pp-empty">Nada pendiente con esta persona.</p>}
      <button
        type="button"
        className="pp-text-btn"
        onClick={() => openEntry('Pendiente', [person.id])}
      >
        <BellPlus size={14} /> Nuevo recordatorio
      </button>
      {closed.length > 0 && (
        <details className="pp-done">
          <summary>
            {[
              doneCount > 0 && `${doneCount} ${doneCount === 1 ? 'completado' : 'completados'}`,
              missedCount > 0 && `${missedCount} ${missedCount === 1 ? 'soltado' : 'soltados'}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </summary>
          {closed.map((e) => {
            const missed = e.status === 'no_realizado';
            return (
              <div className={'pp-task ' + (missed ? 'missed' : 'done')} key={e.id}>
                <button
                  type="button"
                  className={'pp-check ' + (missed ? 'miss' : 'on')}
                  aria-label="Reabrir"
                  title="Reabrir"
                  onClick={() => toggleEntry(e)}
                >
                  {missed ? <Minus size={13} strokeWidth={2.6} /> : <Check size={13} />}
                </button>
                <span className="pp-task-main">
                  <strong>{e.title}</strong>
                  {missed && <small>{missedText(e)}</small>}
                </span>
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}

function Alerts({ person, stats }: { person: Person; stats: PersonStats }) {
  const items: { icon: typeof Cake; text: string; tone: string }[] = [];
  if (statusOf(person) === 'memoria') {
    // Sin «escríbele» ni balance: solo la fecha, con respeto.
    const today = todayInputValue();
    const d = daysToBirthday(person, today);
    if (d !== null && d <= 30) {
      const age = ageOf(person, addDays(today, d));
      const turns = age !== null ? ` ${age} años` : ' años';
      items.push({
        icon: Flower2,
        tone: 'memory',
        text:
          d === 0
            ? `Hoy habría cumplido${turns}.`
            : `${d === 1 ? 'Mañana' : `En ${d} días`} habría cumplido${turns}.`,
      });
    }
  } else if (stats.birthdayIn !== null && stats.birthdayIn <= 30) {
    const age = ageOf(person, undefined);
    items.push({
      icon: Cake,
      tone: 'warm',
      text:
        stats.birthdayIn === 0
          ? `¡Hoy es su cumpleaños!${age !== null ? ` Cumple ${age}.` : ''}`
          : `Cumple años ${stats.birthdayIn === 1 ? 'mañana' : `en ${stats.birthdayIn} días`}.`,
    });
  }
  if (stats.overdue) {
    items.push({
      icon: Clock,
      tone: 'alert',
      text:
        stats.daysSince === null
          ? 'Aún no han tenido una interacción registrada.'
          : `Llevan ${stats.daysSince} días sin hablar. Tu meta es cada ${person.profile.cadence} días.`,
    });
  }
  if (
    statusOf(person) === 'activa' &&
    (stats.reciprocity.state === 'das-mas' || stats.reciprocity.state === 'recibes-mas')
  ) {
    items.push({ icon: Scale, tone: 'info', text: stats.reciprocity.hint });
  }
  if (!items.length) return null;
  return (
    <div className="pp-alerts">
      {items.map((a, i) => (
        <div className={'pp-alert ' + a.tone} key={i}>
          <a.icon size={15} />
          {a.text}
        </div>
      ))}
    </div>
  );
}

function KeyFacts({ person }: { person: Person }) {
  const pr = person.profile;
  const age = ageOf(person);
  const rows: [string, string][] = [];
  if (pr.birthday) {
    const [m, d] = pr.birthday.split('-').map(Number);
    rows.push([
      'Cumpleaños',
      `${d} de ${monthNames[m - 1]}${age !== null ? ` · ${age} años` : ''}`,
    ]);
  }
  if (pr.city) rows.push(['Ciudad', pr.city]);
  if (pr.occupation)
    rows.push(['Trabajo', pr.company ? `${pr.occupation} · ${pr.company}` : pr.occupation]);
  if (pr.metHow || pr.metOn)
    rows.push([
      'Se conocieron',
      [pr.metHow, pr.metOn && shortDate(pr.metOn + 'T12:00:00')].filter(Boolean).join(' · '),
    ]);
  if (pr.family) rows.push(['Su gente', pr.family]);
  for (const f of (pr.facts ?? []).slice(0, 3)) rows.push([f.label, f.value]);
  if (!rows.length) return null;
  return (
    <dl className="pp-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Chips({ items, tone = '' }: { items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div className="pp-chips">
      {items.map((t) => (
        <span key={t} className={tone}>
          {t}
        </span>
      ))}
    </div>
  );
}

function Resumen({
  person,
  stats,
  full,
  onMoney,
}: {
  person: Person;
  stats: PersonStats;
  full: boolean;
  /** Abre el detalle del dinero (en «Juntos»). */
  onMoney: () => void;
}) {
  const { askOutcome } = useApp();
  const next = stats.nextPending;
  return (
    <div className="pp-tab">
      <Alerts person={person} stats={stats} />
      <TieChips person={person} />
      {person.profile.keywords?.length ? (
        <div className="pp-keywords" aria-label="Palabras clave">
          {person.profile.keywords.map((k) => (
            <span key={k}>#{k}</span>
          ))}
        </div>
      ) : null}
      <h4>
        <Target size={15} /> Próximo paso
      </h4>
      {next ? (
        <div className="pp-next">
          <button
            type="button"
            className="pp-check"
            aria-label={outcomeHint(next)}
            title={outcomeHint(next)}
            aria-haspopup="menu"
            onClick={(ev) => askOutcome(next, ev.currentTarget)}
          >
            <Check size={13} />
          </button>
          <div>
            <strong>{next.title}</strong>
            {next.details.due && (
              <small>
                <CalendarClock size={12} /> {friendlyDate(next.details.due)}
              </small>
            )}
          </div>
        </div>
      ) : (
        <p className="pp-empty">Sin pendientes. ¿Algo que quieras recordar hacer?</p>
      )}
      <MoneySummary person={person} onDetail={onMoney} />
      <Updates person={person} limit={full ? 6 : 3} />
      <h4>
        <Feather size={15} /> Nota rápida
      </h4>
      <QuickNote person={person} />
      <h4>
        <Clock size={15} /> Últimos recuerdos
      </h4>
      <Moments entries={stats.interactions} limit={full ? 5 : 3} />
      {(interestsOf(person).length > 0 || (person.profile.likes?.length ?? 0) > 0) && (
        <>
          <h4>Intereses</h4>
          <Chips items={[...interestsOf(person), ...(person.profile.likes ?? [])]} />
        </>
      )}
      <KeyFacts person={person} />
    </div>
  );
}

function Identidad({ person }: { person: Person }) {
  const { editPerson, quickPerson, patchPerson } = useApp();
  const done = completeness(person);
  const pr = person.profile;
  const facts = pr.facts ?? [];
  return (
    <div className="pp-tab">
      <div className="pp-complete">
        <div>
          <strong>Ficha {done.percent}% completa</strong>
          <div className="cp-bar">
            <i style={{ width: `${done.percent}%` }} />
          </div>
        </div>
        {done.missing.length > 0 && (
          <div className="pp-missing">
            {done.missing.slice(0, 8).map((m) => (
              <button type="button" key={m.key} onClick={() => editPerson(person, m.section)}>
                <Plus size={12} /> {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="pp-id-grid">
        <section>
          <h5>Contacto</h5>
          <KeyRow k="Teléfono" v={pr.phone} />
          <KeyRow k="Correo" v={pr.email} />
          <KeyRow k="Redes" v={pr.social} />
          <KeyRow k="Ciudad" v={pr.city} />
          <button
            type="button"
            className="pp-text-btn"
            onClick={() => editPerson(person, 'contacto')}
          >
            Editar contacto
          </button>
        </section>
        <section>
          <h5>Vida</h5>
          <KeyRow k="Ocupación" v={pr.occupation} />
          <KeyRow k="Empresa" v={pr.company} />
          {pr.history?.length ? (
            <div className="pp-history">
              {pr.history.slice(0, 4).map((h) => (
                <span key={h.field + h.value + h.until}>
                  Antes {h.field === 'city' ? 'vivía en' : h.field === 'company' ? 'en' : ''}{' '}
                  {h.value} <small>· hasta {shortDate(h.until + 'T12:00:00')}</small>
                </span>
              ))}
            </div>
          ) : null}
          <KeyRow k="Su gente" v={pr.family} />
          <KeyRow
            k="Se conocieron"
            v={[pr.metHow, pr.metOn && shortDate(pr.metOn + 'T12:00:00')]
              .filter(Boolean)
              .join(' · ')}
          />
          <button type="button" className="pp-text-btn" onClick={() => editPerson(person, 'vida')}>
            Editar vida
          </button>
        </section>
        <section>
          <h5>Gustos</h5>
          {pr.likes?.length ? (
            <Chips items={pr.likes} />
          ) : (
            <p className="pp-empty">Qué le encanta…</p>
          )}
          {pr.dislikes?.length ? <Chips items={pr.dislikes} tone="no" /> : null}
          <h5>Ideas de regalo</h5>
          {pr.gifts?.length ? (
            <Chips items={pr.gifts} tone="gift" />
          ) : (
            <p className="pp-empty">Anota ideas cuando las escuches.</p>
          )}
          <button
            type="button"
            className="pp-text-btn"
            onClick={() => editPerson(person, 'gustos')}
          >
            Editar gustos
          </button>
        </section>
        <section>
          <h5>Datos libres</h5>
          {facts.map((f) => (
            <div className="pp-keyrow removable" key={f.id}>
              <span>{f.label}</span>
              <b>{f.value}</b>
              <button
                type="button"
                aria-label={`Quitar ${f.label}`}
                onClick={() =>
                  void patchPerson(
                    person,
                    { profile: { ...pr, facts: facts.filter((x) => x.id !== f.id) } },
                    true,
                  )
                }
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {!facts.length && <p className="pp-empty">Signo, talla, alergias, sueños…</p>}
          <button type="button" className="pp-text-btn" onClick={() => quickPerson(person, 'dato')}>
            <Plus size={13} /> Añadir dato
          </button>
        </section>
      </div>
      {person.bio && (
        <>
          <h4>Su historia</h4>
          <p className="pp-bio">{person.bio}</p>
        </>
      )}
    </div>
  );
}

function KeyRow({ k, v }: { k: string; v?: string }) {
  return (
    <div className="pp-keyrow">
      <span>{k}</span>
      <b className={v ? '' : 'none'}>{v || '—'}</b>
    </div>
  );
}

function Reciprocidad({ person, stats }: { person: Person; stats: PersonStats }) {
  const { quickPerson, patchPerson } = useApp();
  const r = stats.reciprocity;
  const list = person.profile.exchanges ?? [];
  const kinds = (Object.keys(exchangeKinds) as (keyof typeof exchangeKinds)[]).filter(
    (k) => r.byKind[k].give || r.byKind[k].receive,
  );
  const max = Math.max(1, ...kinds.map((k) => Math.max(r.byKind[k].give, r.byKind[k].receive)));
  return (
    <div className="pp-tab">
      <div className={'pp-recip-head ' + r.state}>
        <div>
          <strong>{r.label}</strong>
          <p>{r.hint}</p>
        </div>
        <span className="pp-recip-score">
          {r.state === 'sin-datos' ? '—' : (r.score > 0 ? '+' : '') + r.score}
        </span>
      </div>
      <BalanceBar stats={stats} />
      <div className="pp-recip-totals">
        <div>
          <ArrowUpRight size={16} /> <b>{r.give}</b> <span>puntos dados</span>
        </div>
        <div>
          <ArrowDownLeft size={16} /> <b>{r.receive}</b> <span>puntos recibidos</span>
        </div>
        <div>
          <MessageCircle size={16} />{' '}
          <b>
            {r.initiative.me}:{r.initiative.them}
          </b>{' '}
          <span>iniciativa (tú : {person.name.split(' ')[0]})</span>
        </div>
      </div>
      <div className="pp-recip-actions">
        <button type="button" className="pp-btn give" onClick={() => quickPerson(person, 'dar')}>
          <ArrowUpRight size={15} /> Yo di algo
        </button>
        <button
          type="button"
          className="pp-btn receive"
          onClick={() => quickPerson(person, 'recibir')}
        >
          <ArrowDownLeft size={15} /> Recibí algo
        </button>
      </div>
      {kinds.length > 0 && (
        <>
          <h4>Por tipo</h4>
          <div className="pp-kinds">
            {kinds.map((k) => (
              <div key={k}>
                <span>{exchangeKinds[k]}</span>
                <div className="pp-kind-bars">
                  <i className="give" style={{ width: `${(r.byKind[k].give / max) * 100}%` }} />
                  <i
                    className="receive"
                    style={{ width: `${(r.byKind[k].receive / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <h4>Registro</h4>
      {!list.length && (
        <p className="pp-empty">Cada favor, regalo, apoyo o iniciativa suma al balance.</p>
      )}
      <ul className="pp-ledger">
        {list.slice(0, 60).map((x) => (
          <li key={x.id} className={x.dir}>
            {x.dir === 'dar' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
            <span>
              <strong>{exchangeKinds[x.kind]}</strong>
              {x.note && <small>{x.note}</small>}
            </span>
            <em>{'●'.repeat(x.weight)}</em>
            <time>{friendlyDate(x.date)}</time>
            <button
              type="button"
              aria-label="Quitar registro"
              onClick={() =>
                void patchPerson(
                  person,
                  { profile: { ...person.profile, exchanges: list.filter((y) => y.id !== x.id) } },
                  true,
                )
              }
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Red({ person }: { person: Person }) {
  const { workspace, go } = useApp();
  const companions = useMemo(
    () => companionsOf(person.id, workspace.people, workspace.entries),
    [person.id, workspace],
  );
  const mine = interestsOf(person).map(normalizeText);
  const shared = workspace.people
    .filter((p) => p.id !== person.id)
    .map((p) => ({ p, common: interestsOf(p).filter((i) => mine.includes(normalizeText(i))) }))
    .filter((x) => x.common.length)
    .sort((a, b) => b.common.length - a.common.length)
    .slice(0, 8);
  return (
    <div className="pp-tab">
      <h4>Aparece con</h4>
      {!companions.length && (
        <p className="pp-empty">Aún no comparte recuerdos con otras personas.</p>
      )}
      <div className="pp-people-list">
        {companions.slice(0, 12).map(({ person: p, n }) => (
          <button type="button" key={p.id} onClick={() => go('Personas', p)}>
            <Avatar person={p} size={34} />
            <span>
              <strong>{p.name}</strong>
              <small>
                {n} {n === 1 ? 'recuerdo juntos' : 'recuerdos juntos'}
              </small>
            </span>
            <ArrowRight size={14} />
          </button>
        ))}
      </div>
      <h4>Intereses en común</h4>
      {!shared.length && <p className="pp-empty">Nadie más comparte sus intereses registrados.</p>}
      <div className="pp-people-list">
        {shared.map(({ p, common }) => (
          <button type="button" key={p.id} onClick={() => go('Personas', p)}>
            <Avatar person={p} size={34} />
            <span>
              <strong>{p.name}</strong>
              <small>{common.join(' · ')}</small>
            </span>
            <ArrowRight size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Ficha de una persona. «drawer»: panel lateral rápido con Resumen, Historia y Pendientes.
 * «full»: ficha completa con identidad, dar y recibir, y red.
 */
export function PersonPanel({
  person,
  variant,
  onClose,
}: {
  person: Person;
  variant: 'drawer' | 'full';
  onClose?: () => void;
}) {
  const app = useApp();
  const full = variant === 'full';
  const tabs: Tab[] = full
    ? ['resumen', 'vinculos', 'identidad', 'historia', 'reciprocidad', 'red', 'pendientes']
    : ['resumen', 'vinculos', 'historia', 'pendientes'];
  const [tab, setTab] = useState<Tab>('resumen');
  const [gifts, setGifts] = useState(false);
  const [thermoOpen, setThermoOpen] = useState(false);
  const stats = useMemo(
    () => statsFor(person, app.workspace.entries),
    [person, app.workspace.entries],
  );
  const thermo = useThermo(person, stats);
  const file = useRef<HTMLInputElement>(null);
  const rel = relationOf(person);
  const meta = relationMeta[rel];
  const fav = Boolean(person.profile.favorite);
  const pr = person.profile;
  const status = statusOf(person);

  return (
    <article
      className={'pp-panel ' + variant + (status !== 'activa' ? ' ' + status : '')}
      style={{ '--accent': meta.color, '--soft': meta.soft, '--ink': meta.ink } as CSSProperties}
      aria-label={`Ficha de ${person.name}`}
    >
      {full && (
        <button type="button" className="pp-back" onClick={() => app.go('Personas')}>
          <ArrowLeft size={15} /> Todas las personas
        </button>
      )}
      <header className="pp-panel-head">
        <button
          type="button"
          className="pp-photo-btn"
          title="Cambiar foto"
          onClick={() => file.current?.click()}
        >
          <Avatar person={person} size={full ? 112 : 64} />
          <i>
            <Camera size={14} />
          </i>
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) app.uploadPersonPhoto(person, f);
          }}
        />
        <h2 className="pp-panel-name">{person.name}</h2>
        <div className="pp-panel-id">
          <p>
            <span className="pp-rel">{meta.label}</span>
            {status !== 'activa' && (
              <span className={'pp-status ' + status}>
                {status === 'memoria' && <Flower2 size={12} />}
                {statusMeta[status].label}
              </span>
            )}
            {person.role && <span>{person.role}</span>}
            {pr.alias && <span>«{pr.alias}»</span>}
          </p>
          <div className="pp-closeness" title={`Cercanía: ${closenessLabels[closenessOf(person)]}`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <i key={n} className={n <= closenessOf(person) ? 'on' : ''} />
            ))}
            <span>{closenessLabels[closenessOf(person)]}</span>
          </div>
          {thermo.reading && (
            <ThermoBar reading={thermo.reading} onOpen={() => setThermoOpen(true)} />
          )}
          {status !== 'memoria' && <ContactActions person={person} />}
        </div>
        <div className="pp-panel-tools">
          {status !== 'memoria' && (
            <button
              type="button"
              className="pp-icon-btn"
              title="Ideas de regalo"
              aria-label={`Ideas de regalo para ${person.name.split(' ')[0]}`}
              onClick={() => setGifts(true)}
            >
              <Gift size={17} />
            </button>
          )}
          <button
            type="button"
            className={'pp-icon-btn' + (fav ? ' fav' : '')}
            aria-pressed={fav}
            aria-label={fav ? 'Quitar de favoritos' : 'Marcar favorito'}
            onClick={() =>
              void app.patchPerson(person, { profile: { ...pr, favorite: !fav } }, true)
            }
          >
            <Star size={17} />
          </button>
          <PersonMenu person={person} />
          {onClose && (
            <button
              type="button"
              className="pp-icon-btn"
              aria-label="Cerrar ficha"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </header>

      <div className="pp-metrics">
        {status === 'memoria' ? (
          <div>
            <span
              className="pp-ring pp-ring-memory"
              style={{ width: full ? 56 : 46, height: full ? 56 : 46 }}
            >
              <Flower2 size={full ? 20 : 17} />
            </span>
            <span>En memoria</span>
          </div>
        ) : (
          <div>
            <button
              type="button"
              className="pp-ring-btn"
              title="Ver el termómetro de la relación"
              onClick={() => setThermoOpen(true)}
            >
              <BondRing
                value={stats.bond}
                thermo={thermo.reading?.value}
                size={full ? 58 : 52}
                both
              />
            </button>
            <span>Vínculo</span>
          </div>
        )}
        <div>
          <b>{relativeDay(stats.last)}</b>
          <span>Última vez</span>
        </div>
        <div>
          <b>{stats.interactions.length}</b>
          <span>Recuerdos</span>
        </div>
        <div className={'recip ' + stats.reciprocity.state}>
          <b>{stats.reciprocity.label}</b>
          <span>Dar y recibir</span>
        </div>
      </div>

      <nav className="pp-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === t}
            key={t}
            className={tab === t ? 'on' : ''}
            onClick={() => setTab(t)}
          >
            {tabLabels[t]}
            {t === 'pendientes' && stats.pending.length > 0 && <b>{stats.pending.length}</b>}
          </button>
        ))}
      </nav>

      <div className="pp-tab-wrap" key={tab}>
        {tab === 'resumen' && (
          <Resumen
            person={person}
            stats={stats}
            full={full}
            onMoney={() => {
              setTab('historia');
              // En «Juntos», el bloque del dinero queda a la vista.
              requestAnimationFrame(() =>
                requestAnimationFrame(() =>
                  document
                    .getElementById('pmo-detail')
                    ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                ),
              );
            }}
          />
        )}
        {tab === 'vinculos' && <TiesTab person={person} />}
        {tab === 'identidad' && <Identidad person={person} />}
        {tab === 'historia' && (
          <Together
            person={person}
            stats={stats}
            onReciprocity={full ? () => setTab('reciprocidad') : undefined}
          />
        )}
        {tab === 'reciprocidad' && <Reciprocidad person={person} stats={stats} />}
        {tab === 'red' && <Red person={person} />}
        {tab === 'pendientes' && <Pendings stats={stats} person={person} />}
      </div>

      {!full && (
        <button type="button" className="pp-full-link" onClick={() => app.go('Personas', person)}>
          Ver ficha completa <ArrowRight size={14} />
        </button>
      )}
      {stats.entries.length === 0 && !full && (
        <p className="pp-hint">
          <AlertCircle size={13} /> Vincula recuerdos a {person.name.split(' ')[0]} para ver su
          historia y su red.
        </p>
      )}
      {full && person.created_at && (
        <span className="pp-since">En tu universo desde el {shortDate(person.created_at)}</span>
      )}
      {gifts && (
        <GiftIdeas key={person.id} person={person} standalone onClose={() => setGifts(false)} />
      )}
      {thermoOpen && thermo.reading && (
        <ThermoSheet person={person} input={thermo.input} onClose={() => setThermoOpen(false)} />
      )}
    </article>
  );
}
