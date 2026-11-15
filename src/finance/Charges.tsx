import { useMemo, useState } from 'react';
import {
  Archive,
  ArrowRight,
  BellPlus,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Segmented } from '../composer/controls';
import { incomeCategories } from '../composer/logic';
import { Sheet } from '../components/Sheet';
import { addDays, friendlyDate, initials, money, todayInputValue } from '../lib/format';
import { Avatar } from '../people/Avatar';
import { closeCharge, dropPart, ensureChargeTask, postponePart, receiveCharge } from './chargeActions';
import {
  chargeStats,
  defaultAccounts,
  isOpenCharge,
  itemsOf,
  partDelay,
  type Charge,
  type ChargePart,
  type ChargeStats,
  type FinItem,
} from './model';
import { daysBetween, isMoney, moneyShort, percent } from './money';
import { createItem, removeItem, restoreItem, settingsOf, updateItem, useFinance } from './store';
import { EpisodeSelect, Field, FinSheet, FormSection, MoneyField, MoreMenu, PersonInput } from './ui';

const first = (s?: string) => (s ?? '').split(' ')[0];

/** Lo abonado de un trabajo, de 0 a 100 (si pagaron de más, se queda en 100). */
export const paidPct = (s: ChargeStats) => Math.round(Math.min(1, Math.max(0, s.pct)) * 100);

/**
 * Barra del trabajo: lo abonado (lleno), lo pendiente con fecha (suave) y, al final, lo que se
 * perdió. Lo pendiente sin fecha es el fondo. Se mide sobre lo mayor entre el total y lo que
 * suma todo, así nunca se pasa del ancho.
 */
export function ChargeBar({
  total,
  s,
  plain = false,
}: {
  total: number;
  s: ChargeStats;
  /** Solo lo recibido (y lo perdido): sin el tramo de lo que tiene fecha. */
  plain?: boolean;
}) {
  const base = Math.max(total, s.received + s.lost + s.left, 1);
  const w = (n: number) => ({ width: (Math.min(n, base) / base) * 100 + '%' });
  const pct = paidPct(s);
  return (
    <div
      className="fz-charge-bar"
      role="progressbar"
      aria-label="Recibido"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct} % recibido`}
    >
      {s.received > 0 && <i className="got" style={w(s.received)} />}
      {!plain && s.scheduled > 0 && <i className="planned" style={w(s.scheduled)} />}
      {s.lost > 0 && <i className="lost" style={w(s.lost)} />}
    </div>
  );
}

type PartAction = { charge: FinItem<'cobro'>; part: ChargePart | null; mode: 'receive' | 'postpone' | 'drop' };

/** Trabajos que te pagan por partes: cada uno con su total, lo abonado y lo pendiente. */
export function ChargesBlock() {
  const { workspace, notify, confirm } = useApp();
  const fin = useFinance();
  const today = todayInputValue();
  const moves = useMemo(() => workspace.entries.filter(isMoney), [workspace.entries]);
  const all = itemsOf(fin.items, 'cobro');
  const open = all.filter(isOpenCharge).sort((a, b) => {
    const na = chargeStats(a, moves, today).next?.due ?? '9999';
    const nb = chargeStats(b, moves, today).next?.due ?? '9999';
    return na.localeCompare(nb);
  });
  const closed = all.filter((c) => !isOpenCharge(c));
  const [editing, setEditing] = useState<FinItem<'cobro'> | 'new' | null>(null);
  const [action, setAction] = useState<PartAction | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const remove = async (c: FinItem<'cobro'>) => {
    const ok = await confirm({
      title: `¿Eliminar «${c.title}»?`,
      message: 'Los abonos quedan como ingresos normales en Movimientos.',
      confirmLabel: 'Eliminar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    const r = await removeItem(c);
    if (r !== true) return notify(r);
    notify('Trabajo eliminado.', { label: 'Deshacer', run: () => void restoreItem(c) });
  };

  return (
    <section className="fz-block fz-charges">
      <header className="fz-block-head">
        <h3>
          <BriefcaseBusiness size={16} /> Trabajos por cobrar
        </h3>
        <button type="button" className="fz-btn primary sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Nuevo trabajo
        </button>
        <small>Los trabajos que te pagan por partes (un anticipo y lo demás después): cuánto vale, cuánto te han abonado, cuánto falta y cuándo llega.</small>
      </header>

      {open.length ? (
        <div className="fz-charge-grid">
          {open.map((c) => (
            <ChargeCard
              key={c.id}
              charge={c}
              s={chargeStats(c, moves, today)}
              onEdit={() => setEditing(c)}
              onRemove={() => void remove(c)}
              onPart={(part, mode) => setAction({ charge: c, part, mode })}
            />
          ))}
        </div>
      ) : (
        <p className="fz-muted">
          Ningún trabajo por cobrar. Al registrar un ingreso marca «Es el abono de un trabajo» y queda aquí solo.
        </p>
      )}

      {closed.length > 0 && (
        <div className="fz-closed">
          <button type="button" className="fz-link" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Ocultar' : 'Ver'} terminados ({closed.length})
          </button>
          {showClosed && (
            <ul>
              {closed.map((c) => {
                const s = chargeStats(c, moves, today);
                return (
                  <li key={c.id}>
                    <span>
                      <b>{c.title}</b> · {c.data.closedOn ? friendlyDate(c.data.closedOn).toLowerCase() : ''}
                      {s.lost > 0 && <small> · no llegaron {moneyShort(s.lost)}</small>}
                    </span>
                    <b>
                      {moneyShort(s.received)} <small>de {moneyShort(c.data.total)}</small>
                    </b>
                    <button type="button" className="fz-icon" aria-label="Reabrir" title="Reabrir" onClick={() => void updateItem(c, { archived: false, data: { closedOn: undefined } })}>
                      <CircleDashed size={13} />
                    </button>
                    <button type="button" className="fz-icon" aria-label="Eliminar" onClick={() => void remove(c)}>
                      <Trash2 size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {editing && <ChargeSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {action && <PartSheet action={action} onClose={() => setAction(null)} />}
    </section>
  );
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const days = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

/**
 * La tarjeta de un trabajo por cobrar. Primero lo recibido y lo que falta; luego el próximo cobro
 * con su acción, el último abono y, si lo pides, todos los movimientos. Lo demás (editar, crear el
 * pendiente, cerrar, eliminar) va en el menú «…».
 */
function ChargeCard({
  charge: c,
  s,
  onEdit,
  onRemove,
  onPart,
}: {
  charge: FinItem<'cobro'>;
  s: ChargeStats;
  onEdit: () => void;
  onRemove: () => void;
  onPart: (part: ChargePart | null, mode: PartAction['mode']) => void;
}) {
  const { workspace, notify, go, viewEntry, createEntry, patchEntry, resolveTask } = useApp();
  const app = { workspace, notify, createEntry, patchEntry, resolveTask };
  const [movesOpen, setMovesOpen] = useState(false);
  const today = todayInputValue();
  const person = c.data.personId ? workspace.people.find((p) => p.id === c.data.personId) : undefined;
  const ep = c.data.episodeId ? workspace.episodes.find((e) => e.id === c.data.episodeId) : undefined;
  const task = c.data.taskId ? workspace.entries.find((e) => e.id === c.data.taskId) : undefined;
  const looseParts = c.data.parts.filter((p) => p.status !== 'esperando' && !(p.entryId && s.abonos.some((e) => e.id === p.entryId)));
  const who = person?.name ?? c.data.who;
  const sub = [who && first(who), c.data.category].filter(Boolean).join(' · ') || `Desde ${friendlyDate(c.data.start).toLowerCase()}`;
  const next = s.next;
  const n = next ? daysBetween(today, next.due) : 0;
  const late = Boolean(next) && n < 0;
  const later = s.waiting.slice(1);
  const laterNote = [
    later.length === 1 ? `Después: 1 cobro más de ${moneyShort(later[0].amount)}` : later.length > 1 ? `Después: ${later.length} cobros más` : '',
    s.unscheduled > 0 ? `${moneyShort(s.unscheduled)} sin fecha` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const last = s.abonos[s.abonos.length - 1];
  const moves = s.abonos.length + looseParts.length + s.waiting.length;
  const canClose = s.done || (!s.waiting.length && s.left > 0);

  return (
    <article className={'fz-charge' + (late ? ' late' : '') + (s.done ? ' done' : '')}>
      <header className="fz-charge-head">
        {person ? (
          <Avatar person={person} size={40} />
        ) : (
          <span className="fz-avatar fz-charge-face">{who ? initials(who) : <BriefcaseBusiness size={16} />}</span>
        )}
        <div>
          <strong title={c.title}>{c.title}</strong>
          <small>{sub}</small>
        </div>
        <MoreMenu
          label="Opciones del trabajo"
          items={[
            { label: 'Editar', icon: <Pencil size={15} />, run: onEdit },
            next && s.unscheduled > 0 && { label: 'Poner fecha a lo que falta', icon: <CalendarPlus size={15} />, run: onEdit },
            task
              ? { label: task.status === 'pendiente' ? 'Ver su pendiente' : 'Ver su pendiente (cerrado)', icon: <CalendarClock size={15} />, run: () => viewEntry(task) }
              : s.left > 0 && {
                  label: 'Crear un pendiente para cobrarlo',
                  icon: <BellPlus size={15} />,
                  run: () => void ensureChargeTask(app, c).then((ok) => notify(ok ? 'Pendiente creado: está en tu Agenda.' : 'No se pudo crear el pendiente.')),
                },
            ep && { label: `Ir a «${ep.title.slice(0, 32)}»`, icon: <ExternalLink size={15} />, run: () => go('Episodios', ep) },
            canClose && { label: s.done ? 'Archivar' : 'Cerrar trabajo', icon: s.done ? <Archive size={15} /> : <CircleX size={15} />, run: () => void closeCharge(app, c) },
            { label: 'Eliminar', icon: <Trash2 size={15} />, run: onRemove, danger: true },
          ]}
        />
      </header>

      <div className="fz-charge-got">
        <span className="fz-charge-eyebrow">Recibido</span>
        <b>{money(s.received)}</b>
        <small>de {money(c.data.total)} acordados</small>
      </div>
      <div className="fz-charge-progress">
        <ChargeBar total={c.data.total} s={s} plain />
        <small>
          {paidPct(s)} % recibido
          {s.lost > 0 && <span className="lost"> · {moneyShort(s.lost)} no llegaron</span>}
        </small>
      </div>
      <div className="fz-charge-left">
        <span>Saldo pendiente</span>
        {s.done ? (
          <em className="fz-chip good">
            <Check size={12} /> Pagado
          </em>
        ) : (
          <b>{money(s.left)}</b>
        )}
      </div>

      {next ? (
        <div className={'fz-charge-next' + (late ? ' late' : '')}>
          <span className="fz-charge-eyebrow">{late ? 'Cobro atrasado' : 'Próximo cobro'}</span>
          <div className="fz-charge-next-row">
            <span>
              <CalendarDays size={16} />
              {cap(friendlyDate(next.due, today))}
              {(n > 1 || n < -1) && <small>{n < 0 ? `hace ${days(-n)}` : `en ${days(n)}`}</small>}
            </span>
            <b>{money(next.amount)}</b>
          </div>
          {next.moved?.length ? (
            <small className="fz-charge-note">
              Aplazado {next.moved.length === 1 ? 'una vez' : `${next.moved.length} veces`} · lo acordado era el {friendlyDate(next.moved[0]).toLowerCase()}
            </small>
          ) : null}
          <div className="fz-charge-next-acts">
            <button type="button" className="fz-btn primary" onClick={() => onPart(next, 'receive')}>
              <Check size={14} strokeWidth={2.6} /> Confirmar ingreso
            </button>
            <MoreMenu
              label="Más opciones de este cobro"
              items={[
                { label: 'Aplazar', icon: <Clock size={15} />, run: () => onPart(next, 'postpone') },
                { label: 'No se dio', icon: <X size={15} />, run: () => onPart(next, 'drop') },
              ]}
            />
          </div>
          {laterNote && <small className="fz-charge-note">{laterNote}</small>}
        </div>
      ) : !s.done && s.left > 0 ? (
        <div className="fz-charge-next free">
          <span className="fz-charge-eyebrow">Sin fecha de cobro</span>
          <p>Aún no sabes cuándo llega lo que falta.</p>
          <div className="fz-charge-next-acts">
            <button type="button" className="fz-btn ghost sm" onClick={onEdit}>
              <CalendarPlus size={14} /> Poner fecha
            </button>
          </div>
        </div>
      ) : null}

      {last && (
        <button type="button" className="fz-charge-last" title="Ver el movimiento" onClick={() => viewEntry(last)}>
          <CircleCheck size={17} />
          <span>Último abono · {friendlyDate(todayInputValue(new Date(last.created_at)), today)}</span>
          <b className="in">+{money(last.amount)}</b>
        </button>
      )}

      <footer>
        <button type="button" className="fz-btn fz-charge-add" onClick={() => onPart(null, 'receive')}>
          <Plus size={14} strokeWidth={2.4} /> Registrar abono
        </button>
        {moves > 0 && (
          <button type="button" className="fz-charge-toggle" aria-haspopup="dialog" onClick={() => setMovesOpen(true)}>
            Ver movimientos <ArrowRight size={15} />
          </button>
        )}
      </footer>
      {movesOpen && (
        <ChargeMovesSheet charge={c} s={s} onClose={() => setMovesOpen(false)} onPart={onPart} onEdit={onEdit} />
      )}
    </article>
  );
}

/** «jueves, 19 de noviembre» para una fecha AAAA-MM-DD. */
const longDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return cap(new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }));
};

/** Cuándo toca una parte, al lado de su fecha: «Hoy», «Mañana», «En 5 días», «Atrasada 2 días». */
function whenText(due: string, today: string) {
  const n = daysBetween(today, due);
  if (n < 0) return { text: `Atrasada ${days(-n)}`, tone: 'bad' };
  if (n === 0) return { text: 'Hoy', tone: 'warn' };
  if (n === 1) return { text: 'Mañana', tone: 'warn' };
  return { text: `En ${days(n)}`, tone: n <= 3 ? 'warn' : 'muted' };
}

/**
 * Los movimientos de un trabajo en su propia ventana translúcida: el resumen arriba, lo que falta
 * por recibir (con sus acciones) y el historial, del más reciente al acuerdo inicial.
 */
function ChargeMovesSheet({
  charge: c,
  s,
  onClose,
  onPart,
  onEdit,
}: {
  charge: FinItem<'cobro'>;
  s: ChargeStats;
  onClose: () => void;
  onPart: (part: ChargePart | null, mode: PartAction['mode']) => void;
  onEdit: () => void;
}) {
  const { workspace, go, viewEntry } = useApp();
  const today = todayInputValue();
  const person = c.data.personId ? workspace.people.find((p) => p.id === c.data.personId) : undefined;
  const ep = c.data.episodeId ? workspace.episodes.find((e) => e.id === c.data.episodeId) : undefined;
  const task = c.data.taskId ? workspace.entries.find((e) => e.id === c.data.taskId) : undefined;
  const who = person?.name ?? c.data.who;
  const sub = [who && first(who), c.data.category].filter(Boolean).join(' · ') || `Desde ${friendlyDate(c.data.start).toLowerCase()}`;
  const partOf = new Map(c.data.parts.filter((p) => p.entryId).map((p) => [p.entryId!, p]));
  const looseParts = c.data.parts.filter((p) => p.status !== 'esperando' && !(p.entryId && s.abonos.some((e) => e.id === p.entryId)));
  const history = [
    ...s.abonos.map((e) => ({ key: e.id, day: todayInputValue(new Date(e.created_at)), entry: e, part: partOf.get(e.id) })),
    ...looseParts.map((p) => ({ key: p.id, day: p.gotOn ?? p.due, entry: undefined, part: p })),
  ].sort((a, b) => b.day.localeCompare(a.day));
  const waitingSum = s.waiting.reduce((a, p) => a + p.amount, 0);
  // Las acciones abren su propia ventana: esta se cierra antes.
  const act = (part: ChargePart | null, mode: PartAction['mode']) => {
    onClose();
    onPart(part, mode);
  };

  return (
    <Sheet label={`Movimientos de ${c.title}`} className="fz-sheet fz-moves" yieldTo=".sheet.ev" onRequestClose={onClose}>
      <header className="fz-sheet-head">
        {person ? (
          <Avatar person={person} size={40} />
        ) : (
          <span className="fz-avatar fz-moves-face">{who ? initials(who) : <BriefcaseBusiness size={16} />}</span>
        )}
        <div>
          <h3>{c.title}</h3>
          <p>{sub}</p>
        </div>
        <button type="button" className="fz-x" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="fz-sheet-body">
        <div className="fz-mv-sum">
          <div>
            <small>Recibido</small>
            <b className="in">{money(s.received)}</b>
          </div>
          <div>
            <small>Pendiente</small>
            <b>{money(s.left)}</b>
          </div>
          <div>
            <small>Acordado</small>
            <b>{money(c.data.total)}</b>
          </div>
        </div>
        <div className="fz-charge-progress">
          <ChargeBar total={c.data.total} s={s} plain />
          <small>
            {paidPct(s)} % recibido
            {s.lost > 0 && <span className="lost"> · {moneyShort(s.lost)} no llegaron</span>}
          </small>
        </div>
        {(ep || task || s.punctuality !== null) && (
          <div className="fz-mv-tags">
            {s.punctuality !== null && (
              <span className={'fz-chip ' + (s.punctuality >= 0.8 ? 'good' : s.punctuality >= 0.5 ? 'warn' : 'bad')}>
                Puntualidad {percent(s.punctuality)}
                {s.avgDelay ? ` · ${Math.round(s.avgDelay)} d de retraso medio` : ''}
              </span>
            )}
            {ep && (
              <button
                type="button"
                className="fz-chip"
                onClick={() => {
                  onClose();
                  go('Episodios', ep);
                }}
              >
                <ExternalLink size={11} /> {ep.title}
              </button>
            )}
            {task && (
              <button type="button" className={'fz-chip ' + (task.status === 'pendiente' ? 'warn' : 'good')} onClick={() => viewEntry(task)}>
                <CalendarClock size={11} /> {task.status === 'pendiente' ? 'Pendiente abierto' : 'Pendiente cerrado'}
              </button>
            )}
          </div>
        )}

        {(s.waiting.length > 0 || s.unscheduled > 0) && (
          <section className="fz-mv-sec">
            <header>
              <h4>Por recibir</h4>
              {s.waiting.length > 0 && (
                <small>
                  {s.waiting.length === 1 ? '1 cobro' : `${s.waiting.length} cobros`} · {money(waitingSum)}
                </small>
              )}
            </header>
            {s.waiting.length > 0 && (
              <ol className="fz-mv-list">
                {s.waiting.map((p) => {
                  const d = whenText(p.due, today);
                  return (
                    <li key={p.id} className={'fz-mv wait ' + d.tone}>
                      <span className="fz-mv-ic">
                        <CircleDashed size={16} />
                      </span>
                      <div className="fz-mv-main">
                        <strong>{longDate(p.due)}</strong>
                        <small>
                          <em className={'fz-chip ' + d.tone}>{d.text}</em>
                          {p.moved?.length ? <span>Aplazada {p.moved.length === 1 ? 'una vez' : `${p.moved.length} veces`}</span> : null}
                          {p.note && <span>{p.note}</span>}
                        </small>
                      </div>
                      <b>{money(p.amount)}</b>
                      <span className="fz-mv-acts">
                        <button type="button" className="fz-btn soft sm" onClick={() => act(p, 'receive')}>
                          <Check size={13} /> Llegó
                        </button>
                        <button type="button" className="fz-btn ghost sm" onClick={() => act(p, 'postpone')}>
                          <Clock size={13} /> Aplazar
                        </button>
                        <button type="button" className="fz-icon" title="No se dio" aria-label="No se dio" onClick={() => act(p, 'drop')}>
                          <X size={14} />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            {s.unscheduled > 0 && (
              <p className="fz-mv-free">
                {money(s.unscheduled)} aún sin fecha.{' '}
                <button
                  type="button"
                  className="fz-link"
                  onClick={() => {
                    onClose();
                    onEdit();
                  }}
                >
                  Poner fecha
                </button>
              </p>
            )}
          </section>
        )}

        <section className="fz-mv-sec">
          <header>
            <h4>Historial</h4>
            {s.abonos.length > 0 && (
              <small>
                {s.abonos.length === 1 ? '1 abono' : `${s.abonos.length} abonos`} · {money(s.received)}
              </small>
            )}
          </header>
          <ol className="fz-mv-list">
            {history.map(({ key, day, entry, part }) => {
              const no = !entry && part?.status === 'no';
              const delay = part ? partDelay(part) : null;
              const amount = entry?.amount ?? part?.got ?? part?.amount ?? 0;
              const main = (
                <>
                  <strong>{longDate(day)}</strong>
                  <small>
                    <span>{entry ? 'Abono' : no ? 'No se dio' : 'Llegó'}</span>
                    {delay !== null && !no && <em className={'fz-chip ' + (delay > 0 ? 'warn' : 'good')}>{delay > 0 ? `${delay} d tarde` : 'A tiempo'}</em>}
                    {entry?.details.method && <span>{entry.details.method}</span>}
                    {no && part?.note && <span>{part.note}</span>}
                  </small>
                </>
              );
              return (
                <li key={key} className={'fz-mv ' + (no ? 'no' : 'got')}>
                  <span className="fz-mv-ic">{no ? <CircleX size={16} /> : <CircleCheck size={16} />}</span>
                  {entry ? (
                    <button type="button" className="fz-mv-main" title="Ver el movimiento" onClick={() => viewEntry(entry)}>
                      {main}
                    </button>
                  ) : (
                    <div className="fz-mv-main">{main}</div>
                  )}
                  <b className={no ? 'muted' : 'in'}>
                    {no ? '' : '+'}
                    {money(amount)}
                  </b>
                </li>
              );
            })}
            <li className="fz-mv start">
              <span className="fz-mv-ic">
                <BriefcaseBusiness size={15} />
              </span>
              <div className="fz-mv-main">
                <strong>{longDate(c.data.start)}</strong>
                <small>
                  <span>Trabajo acordado</span>
                </small>
              </div>
              <b>{money(c.data.total)}</b>
            </li>
          </ol>
        </section>
      </div>

      <footer className="fz-sheet-foot">
        <button
          type="button"
          className="fz-btn ghost"
          onClick={() => {
            onClose();
            onEdit();
          }}
        >
          <Pencil size={14} /> Editar
        </button>
        <button type="button" className="fz-btn primary" onClick={() => act(null, 'receive')}>
          <Plus size={15} strokeWidth={2.4} /> Registrar abono
        </button>
      </footer>
    </Sheet>
  );
}

/** Lo que llegó (o no) de una parte: recibir, aplazar o dar por perdida. */
export function PartSheet({ action, onClose }: { action: PartAction; onClose: () => void }) {
  const { workspace, notify, createEntry, patchEntry, resolveTask } = useApp();
  const fin = useFinance();
  const app = { workspace, notify, createEntry, patchEntry, resolveTask };
  const today = todayInputValue();
  const { charge, part } = action;
  const s = chargeStats(charge, workspace.entries, today);
  const accounts = (settingsOf(fin.items).accounts.length ? settingsOf(fin.items).accounts : defaultAccounts).map((a) => a.name);
  const [mode, setMode] = useState(action.mode);
  const [amount, setAmount] = useState(part ? Math.min(part.amount, s.left || part.amount) : s.left);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState(charge.data.method ?? '');
  const [newDue, setNewDue] = useState(part ? addDays(part.due < today ? today : part.due, 7) : addDays(today, 7));
  const [lost, setLost] = useState(false);
  const [note, setNote] = useState('');
  const delay = part ? daysBetween(part.moved?.[0] ?? part.due, date) : null;

  const save = async () => {
    if (mode === 'receive') {
      if (!(amount > 0)) return;
      if (await receiveCharge(app, charge, part, { amount, date, method: method || undefined, note: note.trim() || undefined })) onClose();
      return;
    }
    if (!part) return onClose();
    if (mode === 'postpone') await postponePart(app, charge, part, newDue, note.trim() || undefined);
    else await dropPart(app, charge, part, lost, note.trim() || undefined);
    onClose();
  };

  return (
    <FinSheet
      icon={<BriefcaseBusiness size={18} />}
      title={charge.title}
      sub={part ? `Esperabas ${money(part.amount)} ${friendlyDate(part.due).toLowerCase()}` : `Pendiente ${money(s.left)} de ${money(charge.data.total)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={mode === 'receive' && !(amount > 0)} onClick={() => void save()}>
            {mode === 'receive' ? 'Registrar' : mode === 'postpone' ? 'Aplazar' : 'Guardar'}
          </button>
        </>
      }
    >
      {part && (
        <Segmented
          label="¿Qué pasó?"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'receive', label: 'Llegó' },
            { value: 'postpone', label: 'Se aplazó' },
            { value: 'drop', label: 'No se dio' },
          ]}
        />
      )}
      {mode === 'receive' && (
        <>
          <div className="fz-form">
            <Field label="¿Cuánto llegó?">
              <MoneyField value={amount} onChange={setAmount} autoFocus />
            </Field>
            <Field label="¿Cuándo?">
              <input className="fz-input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
            </Field>
            <Field label="¿A dónde llegó?" hint="Opcional">
              <select className="fz-input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Sin cuenta</option>
                {accounts.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </Field>
            <Field label="Nota" hint="Opcional">
              <input className="fz-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {delay !== null && (
            <p className={'fz-result ' + (delay > 0 ? 'down' : 'up')}>
              {delay > 0 ? `Llegaría con ${delay} ${delay === 1 ? 'día' : 'días'} de retraso.` : 'Llegó a tiempo.'}
              {part && amount > 0 && amount < part.amount && ` Faltarían ${money(part.amount - amount)} de esta parte.`}
              {part && amount > part.amount && ` Llegó ${money(amount - part.amount)} más de lo esperado.`}
            </p>
          )}
          {amount >= s.left && s.left > 0 && <p className="fz-result up">Con esto queda completo.</p>}
        </>
      )}
      {mode === 'postpone' && part && (
        <div className="fz-form">
          <Field label="Nueva fecha">
            <input className="fz-input" type="date" value={newDue} min={today} onChange={(e) => setNewDue(e.target.value || newDue)} />
          </Field>
          <Field label="¿Por qué?" hint="Opcional">
            <input className="fz-input" value={note} maxLength={300} placeholder="El cliente pidió unos días…" onChange={(e) => setNote(e.target.value)} />
          </Field>
          {part.moved?.length ? <p className="fz-muted fz-field wide">Ya se aplazó {part.moved.length} {part.moved.length === 1 ? 'vez' : 'veces'}: la fecha acordada era el {friendlyDate(part.moved[0]).toLowerCase()}.</p> : null}
        </div>
      )}
      {mode === 'drop' && part && (
        <>
          <Segmented
            label="¿Y esa plata?"
            value={lost ? 'lost' : 'later'}
            onChange={(v) => setLost(v === 'lost')}
            options={[
              { value: 'later', label: 'Sigue pendiente, sin fecha' },
              { value: 'lost', label: 'Se perdió' },
            ]}
          />
          <Field label="¿Qué pasó?" hint="Opcional">
            <input className="fz-input" value={note} maxLength={300} placeholder="Se canceló el proyecto, no respondió…" onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p className="fz-muted">{lost ? `Lo que falta baja en ${money(part.amount)}.` : 'Queda en lo que falta por cobrar y puedes ponerle otra fecha cuando sepas.'}</p>
        </>
      )}
    </FinSheet>
  );
}

type PartRow = { id: string; due: string; amount: number; keep?: ChargePart };

/** Crear o editar un trabajo por cobrar: el total, quién paga, su episodio y las partes que esperas. */
function ChargeSheet({ item, onClose }: { item: FinItem<'cobro'> | null; onClose: () => void }) {
  const { workspace, notify, createEntry, patchEntry, resolveTask } = useApp();
  const fin = useFinance();
  const app = { workspace, notify, createEntry, patchEntry, resolveTask };
  const today = todayInputValue();
  const settings = settingsOf(fin.items);
  const cats = [...incomeCategories.filter((c) => c !== 'Reembolso'), ...settings.extraIn];
  const s = item ? chargeStats(item, workspace.entries, today) : null;
  const [title, setTitle] = useState(item?.title ?? '');
  const [total, setTotal] = useState(item?.data.total ?? 0);
  const [who, setWho] = useState<{ personId?: string; name: string }>({ personId: item?.data.personId, name: item?.data.who ?? '' });
  const [start, setStart] = useState(item?.data.start ?? today);
  const [category, setCategory] = useState(item?.data.category ?? '');
  const [episodeId, setEpisodeId] = useState(item?.data.episodeId);
  const [note, setNote] = useState(item?.data.note ?? '');
  const [firstAbono, setFirstAbono] = useState(0);
  const [task, setTask] = useState(!item);
  const [rows, setRows] = useState<PartRow[]>(() =>
    item ? item.data.parts.filter((p) => p.status === 'esperando').map((p) => ({ id: p.id, due: p.due, amount: p.amount, keep: p })) : [],
  );
  const received = (s?.received ?? 0) + firstAbono;
  const planned = rows.reduce((a, r) => a + r.amount, 0);
  const free = Math.max(0, total - received - (item?.data.lost ?? 0) - planned);
  const ok = title.trim() && total > 0 && firstAbono < total;

  const addRow = () =>
    setRows((r) => [...r, { id: crypto.randomUUID(), due: addDays(r[r.length - 1]?.due ?? today, 30), amount: free }]);

  const save = async () => {
    if (!ok) return;
    const person = who.personId ? workspace.people.find((p) => p.id === who.personId) : undefined;
    const kept = item ? item.data.parts.filter((p) => p.status !== 'esperando') : [];
    const parts: ChargePart[] = [
      ...kept,
      ...rows
        .filter((r) => r.amount > 0 && r.due)
        .map((r) =>
          r.keep
            ? { ...r.keep, amount: r.amount, due: r.due, moved: r.keep.due !== r.due ? [...(r.keep.moved ?? []), r.keep.due] : r.keep.moved }
            : { id: r.id, due: r.due, amount: r.amount, status: 'esperando' as const },
        ),
    ];
    const data: Charge = {
      total,
      personId: person?.id,
      who: person?.name ?? (who.name.trim() || undefined),
      episodeId,
      taskId: item?.data.taskId,
      start,
      category: category || undefined,
      method: item?.data.method,
      note: note.trim() || undefined,
      parts,
      lost: item?.data.lost,
      closedOn: item?.data.closedOn,
    };
    const made = item ? await updateItem(item, { title, data }) : await createItem('cobro', title, data);
    if (typeof made === 'string') return notify(made);
    const saved = item ?? (made as FinItem<'cobro'>);
    if (!item && firstAbono > 0) await receiveCharge(app, saved, null, { amount: firstAbono, date: start <= today ? start : today });
    if (!item && task && total - firstAbono > 0) await ensureChargeTask(app, saved, total - firstAbono);
    onClose();
  };

  return (
    <FinSheet
      wide
      icon={<BriefcaseBusiness size={18} />}
      title={item ? 'Editar trabajo' : 'Nuevo trabajo por cobrar'}
      sub="Lo que vale el trabajo y cuándo te pagan lo demás: cada abono que llegue se descuenta solo."
      onClose={onClose}
      footer={
        <>
          {total > 0 && (
            <span className="fz-foot-note">
              {free > 0 ? `Sin fecha: ${money(free)}` : planned > 0 ? 'Todo lo que falta tiene fecha.' : ''}
            </span>
          )}
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={!ok} onClick={() => void save()}>
            Guardar
          </button>
        </>
      }
    >
      <FormSection title="El trabajo">
        <div className="fz-form three">
          <Field label="¿Qué trabajo es?" wide>
            <input className="fz-input" value={title} autoFocus maxLength={200} placeholder="Página web, diseño de logo, remodelación…" onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Valor total">
            <MoneyField value={total} onChange={setTotal} />
          </Field>
          {!item ? (
            <Field label="Ya me abonaron" hint="Anticipo">
              <MoneyField value={firstAbono} onChange={setFirstAbono} />
            </Field>
          ) : (
            <Field label="Abonado">
              <span className="fz-static">{money(s?.received ?? 0)}</span>
            </Field>
          )}
          <Field label="Desde">
            <input className="fz-input" type="date" value={start} onChange={(e) => setStart(e.target.value || today)} />
          </Field>
          <Field label="¿Quién te paga?" hint="Opcional" wide>
            <PersonInput people={workspace.people} personId={who.personId} name={who.name} onChange={setWho} />
          </Field>
        </div>
        {total > 0 && (
          <div className="fz-charge-preview">
            <span>
              Abonado <b className="in">{money(received)}</b>
            </span>
            <span>
              Con fecha <b>{money(planned)}</b>
            </span>
            <span>
              Sin fecha <b>{money(free)}</b>
            </span>
          </div>
        )}
      </FormSection>

      <FormSection title="Detalles" hint="Opcional">
        <div className="fz-form three">
          <Field label="Categoría">
            <select className="fz-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Sin categoría</option>
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          {workspace.episodes.length > 0 && (
            <Field label="Episodio">
              <EpisodeSelect episodes={workspace.episodes} value={episodeId} onChange={setEpisodeId} />
            </Field>
          )}
          <Field label="Nota" wide={workspace.episodes.length === 0}>
            <input className="fz-input" value={note} maxLength={400} placeholder="Condiciones, factura…" onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <div className="fz-parts">
        <div className="fz-parts-head">
          <strong>¿Cuándo esperas lo demás?</strong>
          <button type="button" className="fz-btn ghost sm" disabled={!(total > 0)} onClick={addRow}>
            <Plus size={13} /> Agregar parte
          </button>
        </div>
        {rows.length ? (
          <ul>
            {rows.map((r, i) => (
              <li key={r.id}>
                <span className="fz-parts-n">{i + 1}</span>
                <input className="fz-input" type="date" value={r.due} aria-label="Fecha" onChange={(e) => setRows((x) => x.map((y) => (y.id === r.id ? { ...y, due: e.target.value } : y)))} />
                <MoneyField value={r.amount} ariaLabel="Monto" onChange={(amount) => setRows((x) => x.map((y) => (y.id === r.id ? { ...y, amount } : y)))} />
                <button type="button" className="fz-icon" aria-label="Quitar" onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fz-muted">Opcional. Sin fechas, lo que falta queda «sin fecha» y lo ves igual.</p>
        )}
      </div>
      {!item && (
        <label className="fz-check">
          <input type="checkbox" checked={task} onChange={(e) => setTask(e.target.checked)} />
          Crear un pendiente «espero» para no olvidar cobrarlo (sale en tu Agenda con la fecha de la próxima parte)
        </label>
      )}
    </FinSheet>
  );
}
