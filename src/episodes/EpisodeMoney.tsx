import { useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  Check,
  ExternalLink,
  Link2,
  PiggyBank,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Target,
  Unlink,
  Wallet,
  X,
} from 'lucide-react';
import { useApp, type AppContextValue } from '../AppContext';
import type { Entry, Episode } from '../data';
import { ChargeBar, PartSheet, paidPct } from '../finance/Charges';
import {
  chargeStats,
  goalSaved,
  isOpenCharge,
  itemsOf,
  pocketStats,
  type ChargePart,
  type FinItem,
} from '../finance/model';
import { categoryOf, daysBetween, flowOf, isMoney, moneyShort } from '../finance/money';
import { amountLook, flowIcon } from '../finance/Movements';
import { financeState, updateItem, useFinance } from '../finance/store';
import { MoreMenu, openFinanceTab } from '../finance/ui';
import { Popover } from '../instants/Popover';
import {
  suggestFinance,
  suggestMoves,
  type EpisodeFinItem,
  type EpisodeSummary,
  type FinSuggestion,
  type MoveSuggestion,
} from '../lib/episodes';
import { friendlyDate, money, normalizeText, todayInputValue } from '../lib/format';
import { dismiss, useDismissed } from '../relations/dismissed';

/** Movimientos que se ven de una (los demás, con «Ver todos»). */
const SHOWN = 6;
const dismissKey = (ep: Episode, item: EpisodeFinItem) => `ep-fin|${ep.id}|${item.id}`;
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round(Math.min(1, Math.max(0, part / whole)) * 100) : 0;

/** Conecta (o suelta) algo de Finanzas a un episodio: solo cambia el episodio que lleva. */
const setEpisode = (item: EpisodeFinItem, episodeId: string | undefined) =>
  updateItem(item as FinItem<'cobro'>, { data: { episodeId } });

/** Una huella corta de una lista de ids (para descartar un aviso hasta que cambie). */
const stamp = (ids: string[]) => {
  let h = 5381;
  for (const ch of [...ids].sort().join(',')) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type LinkApp = Pick<AppContextValue, 'workspace' | 'linkEntries' | 'notify'>;

/**
 * Pone recuerdos en un episodio y trae lo que tienen enlazado: un ingreso, sus gastos y ahorros
 * anexados (llegan solos, también los que le anexes después); un abono, su trabajo por cobrar
 * (si no está en otro episodio) con todos sus abonos. Con `quiet` solo avisa si llegó algo más.
 */
export async function linkToEpisode(app: LinkApp, ep: Episode, list: Entry[], quiet = false) {
  if (!list.length) return true;
  const ids = list.map((e) => e.id);
  const before = new Map(list.map((e) => [e.id, e.episode_id ?? null]));
  if (!(await app.linkEntries(ids, ep.id, true))) return false;
  const picked = new Set(ids);
  const anexos = app.workspace.entries.filter(
    (e) =>
      e.kind === 'Movimiento' &&
      !e.episode_id &&
      Boolean(e.details.fromIncome) &&
      picked.has(e.details.fromIncome!),
  ).length;
  const live = new Set(app.workspace.episodes.map((x) => x.id));
  const charges = itemsOf(financeState().items, 'cobro');
  const brought: { item: FinItem<'cobro'>; was?: string }[] = [];
  for (const id of new Set(list.flatMap((e) => (e.details.chargeId ? [e.details.chargeId] : [])))) {
    const c = charges.find((x) => x.id === id);
    if (!c || c.data.episodeId === ep.id || (c.data.episodeId && live.has(c.data.episodeId)))
      continue;
    if ((await updateItem(c, { data: { episodeId: ep.id } })) === true)
      brought.push({ item: c, was: c.data.episodeId });
  }
  if (quiet && !anexos && !brought.length) return true;
  const first = list[0];
  const name =
    list.length === 1
      ? `«${(first.title || first.kind).slice(0, 48)}»`
      : `${list.length} ${list.every(isMoney) ? 'movimientos' : 'recuerdos'}`;
  const extra = [
    anexos > 0 && (anexos === 1 ? 'un anexado' : `${anexos} anexados`),
    brought.length > 0 &&
      (brought.length === 1
        ? `el trabajo «${brought[0].item.title.slice(0, 40)}» con sus abonos`
        : `${brought.length} trabajos con sus abonos`),
  ].filter(Boolean);
  app.notify(`Añadiste ${name} al episodio${extra.length ? `: trae ${extra.join(' y ')}` : ''}.`, {
    label: 'Deshacer',
    run: () => {
      const back = new Map<string | null, string[]>();
      for (const [id, was] of before) back.set(was, [...(back.get(was) ?? []), id]);
      for (const [was, group] of back) void app.linkEntries(group, was, true);
      for (const b of brought) void updateItem(b.item, { data: { episodeId: b.was } });
    },
  });
  return true;
}

function ItemIcon({ item }: { item: EpisodeFinItem }) {
  if (item.kind === 'cobro') return <BriefcaseBusiness size={14} />;
  if (item.kind === 'meta') return <Target size={14} />;
  if (item.data.emoji) return <span className="ep-fin-emoji">{item.data.emoji}</span>;
  return item.data.use === 'gasto' ? <Wallet size={14} /> : <PiggyBank size={14} />;
}

/** Una línea que dice qué es y cómo va (para el selector y las sugerencias). */
function describe(item: EpisodeFinItem, entries: readonly Entry[]) {
  if (item.kind === 'cobro') {
    const s = chargeStats(item, entries);
    return s.done
      ? `Trabajo · pagado ${moneyShort(item.data.total)}`
      : `Trabajo · faltan ${moneyShort(s.left)} de ${moneyShort(item.data.total)}`;
  }
  if (item.kind === 'meta')
    return `Meta · ${moneyShort(goalSaved(item, entries))} de ${moneyShort(item.data.target)}`;
  const balance = pocketStats(item, entries).balance;
  return `${item.data.use === 'gasto' ? 'Cartera' : 'Bolsillo de ahorro'} · ${moneyShort(balance)}`;
}

/**
 * El dinero de un episodio. Lo que conectes de Finanzas (un trabajo por cobrar, una cartera, un
 * bolsillo o una meta) trae aquí sus abonos y sus gastos solos: el valor se escribe una vez.
 */
export function EpisodeMoney({ episode: ep, s }: { episode: Episode; s: EpisodeSummary }) {
  const app = useApp();
  const { workspace, viewEntry, openEntry, go, notify } = app;
  const fin = useFinance();
  const dismissed = useDismissed();
  const [pick, setPick] = useState<{ el: HTMLElement; tab: PickTab } | null>(null);
  const [receiving, setReceiving] = useState<{
    charge: FinItem<'cobro'>;
    part: ChargePart | null;
  } | null>(null);
  const [all, setAll] = useState(false);
  const f = s.finance;
  const ready = Boolean(fin.items) && !fin.missing;
  const today = todayInputValue();

  const episodeIds = useMemo(
    () => new Set(workspace.episodes.map((x) => x.id)),
    [workspace.episodes],
  );
  const suggestions = useMemo(
    () =>
      ready
        ? suggestFinance(ep, fin.items, workspace.people, episodeIds).filter(
            (x) => !dismissed.has(dismissKey(ep, x.item)),
          )
        : [],
    [ready, ep, fin.items, workspace.people, episodeIds, dismissed],
  );
  const connectable =
    ready &&
    (itemsOf(fin.items, 'cobro').some(isOpenCharge) ||
      itemsOf(fin.items, 'bolsillo').some((p) => !p.archived) ||
      itemsOf(fin.items, 'meta').some((g) => !g.archived));
  const anyMoney = useMemo(() => workspace.entries.some(isMoney), [workspace.entries]);
  const moves = useMemo(
    () => [...s.money].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [s.money],
  );
  // Movimientos sueltos que parecen de aquí: un aviso discreto que se descarta hasta que cambien.
  const moveTips = useMemo(
    () => suggestMoves(ep, workspace.entries, workspace.people, f.via),
    [ep, workspace.entries, workspace.people, f.via],
  );
  const tipsKey = `ep-movs|${ep.id}|${stamp(moveTips.map((x) => x.entry.id))}`;
  const showTips = moveTips.length > 0 && !dismissed.has(tipsKey);
  const open = (el: HTMLElement, tab: PickTab) => setPick(pick?.el === el ? null : { el, tab });

  const connect = async (item: EpisodeFinItem, on: boolean) => {
    const before = item.data.episodeId;
    const r = await setEpisode(item, on ? ep.id : undefined);
    if (r !== true) return notify(r);
    const what =
      item.kind === 'cobro'
        ? 'sus abonos se suman aquí solos'
        : item.kind === 'bolsillo' && item.data.use === 'gasto'
          ? 'lo que gastes de ella se suma aquí solo'
          : 'su avance se ve aquí';
    notify(on ? `Conectaste «${item.title}»: ${what}.` : `Desconectaste «${item.title}».`, {
      label: 'Deshacer',
      run: () => void setEpisode(item, before),
    });
  };

  if (!moves.length && !f.count && !suggestions.length && !connectable && !anyMoney) return null;

  const menu = (item: EpisodeFinItem) => {
    const off = {
      label: 'Desconectar',
      icon: <Unlink size={15} />,
      run: () => void connect(item, false),
    };
    if (item.kind === 'cobro') {
      const st = f.charges.find((c) => c.item.id === item.id)?.s;
      return [
        st?.next &&
          !st.done && {
            label: 'Confirmar ingreso',
            icon: <Check size={15} />,
            run: () => setReceiving({ charge: item, part: st.next }),
          },
        st &&
          !st.done && {
            label: 'Registrar abono',
            icon: <Plus size={15} />,
            run: () => setReceiving({ charge: item, part: null }),
          },
        {
          label: 'Ver en Cobros y deudas',
          icon: <ExternalLink size={15} />,
          run: () => openFinanceTab(go, 'deudas'),
        },
        off,
      ];
    }
    if (item.kind === 'meta')
      return [
        {
          label: 'Abonar a la meta',
          icon: <PiggyBank size={15} />,
          run: () =>
            openEntry(
              'Movimiento',
              [],
              { flow: 'ahorro', goalId: item.id },
              { direction: 'egreso', tags: ['Meta'] },
            ),
        },
        {
          label: 'Ver en Metas',
          icon: <ExternalLink size={15} />,
          run: () => openFinanceTab(go, 'metas'),
        },
        off,
      ];
    const method = item.data.account ? { method: item.data.account } : {};
    return [
      item.data.use === 'gasto'
        ? {
            label: 'Registrar un gasto de aquí',
            icon: <ShoppingBag size={15} />,
            run: () =>
              openEntry('Movimiento', ep.person_ids, {
                flow: 'gasto',
                pocketId: item.id,
                ...method,
              }),
          }
        : {
            label: 'Guardar en este bolsillo',
            icon: <PiggyBank size={15} />,
            run: () =>
              openEntry(
                'Movimiento',
                [],
                { flow: 'ahorro', pocketId: item.id, ...method },
                { direction: 'egreso', tags: ['Ahorro'] },
              ),
          },
      {
        label: 'Ver en Ahorro y bolsillos',
        icon: <ExternalLink size={15} />,
        run: () => openFinanceTab(go, 'bolsillos'),
      },
      off,
    ];
  };

  return (
    <section className="ep-panel ep-fin">
      <div className="ep-panel-head">
        <h3>Dinero</h3>
        <button
          type="button"
          className={'ep-fin-connect' + (pick ? ' open' : '')}
          aria-haspopup="dialog"
          aria-expanded={Boolean(pick)}
          title="Enlazar ingresos o movimientos, o conectar un trabajo, una cartera o una meta"
          onClick={(e) => open(e.currentTarget, 'mov')}
        >
          <Link2 size={13} /> Enlazar
        </button>
      </div>

      {showTips && (
        <div className="ep-fin-hint">
          <Sparkles size={13} />
          <span>
            {moveTips.length === 1
              ? '1 movimiento parece de este episodio'
              : `${moveTips.length} movimientos parecen de este episodio`}
          </span>
          <button
            type="button"
            className="ep-fin-hint-go"
            onClick={(e) => open(e.currentTarget, 'mov')}
          >
            Revisar
          </button>
          <button
            type="button"
            className="ep-fin-x"
            aria-label="Ocultar el aviso"
            title="Ocultar"
            onClick={() => dismiss(tipsKey)}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {(moves.length > 0 || f.toCollect > 0) && (
        <div className="ep-money">
          <span>
            Gastos <b>{money(s.spent)}</b>
          </span>
          {s.earned > 0 && (
            <span>
              Ingresos <b className="in">{money(s.earned)}</b>
            </span>
          )}
          {f.toCollect > 0 && (
            <span>
              Por cobrar <b>{money(f.toCollect)}</b>
            </span>
          )}
          {s.earned > 0 && s.spent > 0 && (
            <span>
              Neto <b className={s.net < 0 ? 'neg' : ''}>{money(s.net)}</b>
            </span>
          )}
        </div>
      )}

      {f.count > 0 && (
        <ul className="ep-fin-items">
          {f.charges.map(({ item, s: st }) => {
            const n = st.next ? daysBetween(today, st.next.due) : null;
            return (
              <li key={item.id} className="ep-fin-item">
                <span className="ep-fin-ico cobro">
                  <ItemIcon item={item} />
                </span>
                <span className="ep-fin-main">
                  <strong title={item.title}>{item.title}</strong>
                  <small>
                    Recibido {moneyShort(st.received)} de {moneyShort(item.data.total)}
                    {st.next && !st.done && (
                      <em className={n !== null && n < 0 ? 'late' : ''}>
                        {' '}
                        · {n !== null && n < 0 ? 'atrasado desde' : 'próximo'}{' '}
                        {friendlyDate(st.next.due, today).toLowerCase()}
                      </em>
                    )}
                  </small>
                </span>
                <b className={'ep-fin-amt' + (st.done ? ' done' : '')}>
                  {st.done ? 'Pagado' : moneyShort(st.left)}
                  {!st.done && <small>por cobrar</small>}
                </b>
                <MoreMenu label={`Opciones de ${item.title}`} items={menu(item)} />
                <span className="ep-fin-bar">
                  <ChargeBar total={item.data.total} s={st} plain />
                  <em>{paidPct(st)} %</em>
                </span>
              </li>
            );
          })}
          {f.pockets.map(({ item, balance, spentHere }) => {
            const saving = item.data.use === 'ahorro';
            const target = saving ? item.data.target : undefined;
            return (
              <li key={item.id} className="ep-fin-item">
                <span className="ep-fin-ico bolsillo">
                  <ItemIcon item={item} />
                </span>
                <span className="ep-fin-main">
                  <strong title={item.title}>{item.title}</strong>
                  <small>
                    {saving
                      ? target
                        ? `Bolsillo · ${moneyShort(Math.max(0, balance))} de ${moneyShort(target)}`
                        : 'Bolsillo de ahorro'
                      : `Cartera · gastado aquí ${moneyShort(spentHere)}`}
                  </small>
                </span>
                <b className="ep-fin-amt">
                  {moneyShort(balance)}
                  <small>{saving ? 'ahorrado' : 'saldo'}</small>
                </b>
                <MoreMenu label={`Opciones de ${item.title}`} items={menu(item)} />
                {target ? (
                  <span className="ep-fin-bar">
                    <i className="ep-fin-progress">
                      <i style={{ width: pct(balance, target) + '%' }} />
                    </i>
                    <em>{pct(balance, target)} %</em>
                  </span>
                ) : null}
              </li>
            );
          })}
          {f.goals.map(({ item, saved }) => (
            <li key={item.id} className="ep-fin-item">
              <span className="ep-fin-ico meta">
                <ItemIcon item={item} />
              </span>
              <span className="ep-fin-main">
                <strong title={item.title}>{item.title}</strong>
                <small>
                  Meta · {moneyShort(saved)} de {moneyShort(item.data.target)}
                </small>
              </span>
              <b
                className={
                  'ep-fin-amt' + (saved >= item.data.target && item.data.target > 0 ? ' done' : '')
                }
              >
                {saved >= item.data.target && item.data.target > 0
                  ? 'Lograda'
                  : moneyShort(Math.max(0, item.data.target - saved))}
                {!(saved >= item.data.target && item.data.target > 0) && <small>faltan</small>}
              </b>
              <MoreMenu label={`Opciones de ${item.title}`} items={menu(item)} />
              <span className="ep-fin-bar">
                <i className="ep-fin-progress">
                  <i style={{ width: pct(saved, item.data.target) + '%' }} />
                </i>
                <em>{pct(saved, item.data.target)} %</em>
              </span>
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && (
        <div className="ep-fin-suggest">
          <small className="ep-fin-label">
            <Sparkles size={12} /> Parece de este episodio
          </small>
          {suggestions.map((x) => (
            <div key={x.item.id} className="ep-fin-sug">
              <span className={'ep-fin-ico ' + x.item.kind}>
                <ItemIcon item={x.item} />
              </span>
              <span className="ep-fin-main">
                <strong title={x.item.title}>{x.item.title}</strong>
                <small>{x.why.charAt(0).toUpperCase() + x.why.slice(1)}</small>
              </span>
              <button
                type="button"
                className="ep-fin-sug-go"
                onClick={() => void connect(x.item, true)}
              >
                Conectar
              </button>
              <button
                type="button"
                className="ep-fin-x"
                aria-label="No es de este episodio"
                title="No es de este episodio"
                onClick={() => dismiss(dismissKey(ep, x.item))}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {moves.length > 0 && (
        <ul className="ep-fin-moves">
          {(all ? moves : moves.slice(0, SHOWN)).map((e) => {
            const look = amountLook(e);
            const via = f.via.get(e.id);
            const pending = e.details.pending === true;
            return (
              <li key={e.id}>
                <button type="button" className="ep-fin-move" onClick={() => viewEntry(e)}>
                  <span className="ep-fin-main">
                    <strong>{e.title || categoryOf(e)}</strong>
                    <small>
                      {friendlyDate(todayInputValue(new Date(e.created_at)), today)}
                      {pending && ' · pendiente'}
                      {via && <em> · de «{via}»</em>}
                    </small>
                  </span>
                  <b className={look.cls + (pending ? ' pending' : '')}>
                    {look.sign}
                    {moneyShort(e.amount)}
                  </b>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {moves.length > SHOWN && (
        <button type="button" className="ep-fin-all" onClick={() => setAll((v) => !v)}>
          {all ? 'Ver menos' : `Ver los ${moves.length} movimientos`}
        </button>
      )}

      {!moves.length && !f.count && !suggestions.length ? (
        <p className="ep-fin-empty">
          Enlaza ingresos o gastos que ya registraste, o conecta un trabajo, una cartera, un
          bolsillo o una meta: lo que tengan anexado llega solo.
        </p>
      ) : (
        <small className="ep-muted">
          {f.count || f.via.size
            ? 'Sigue a Finanzas: lo anexado y lo de lo conectado se suma aquí solo.'
            : 'Calculado desde los movimientos de este episodio.'}
        </small>
      )}

      {pick && (
        <ConnectPicker
          anchor={pick.el}
          start={pick.tab}
          episode={ep}
          s={s}
          finReady={ready}
          suggestions={suggestions}
          moveTips={moveTips}
          onMove={(e, on) =>
            void (on ? linkToEpisode(app, ep, [e], true) : app.linkEntries([e.id], null, true))
          }
          onToggle={(item, on) => void connect(item, on)}
          onClose={() => setPick(null)}
        />
      )}
      {receiving && (
        <PartSheet
          action={{ charge: receiving.charge, part: receiving.part, mode: 'receive' }}
          onClose={() => setReceiving(null)}
        />
      )}
    </section>
  );
}

type PickTab = 'mov' | 'fin';
type MoveFilter = 'todos' | 'ingreso' | 'egreso';
const moveFilters: { value: MoveFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'ingreso', label: 'Ingresos' },
  { value: 'egreso', label: 'Gastos' },
];

/**
 * Enlazar al episodio: sus movimientos (varios, con un toque cada uno; lo que tengan anexado llega
 * con ellos) o lo de Finanzas (trabajos por cobrar, carteras, bolsillos y metas).
 */
function ConnectPicker({
  anchor,
  start,
  episode: ep,
  s,
  finReady,
  suggestions,
  moveTips,
  onMove,
  onToggle,
  onClose,
}: {
  anchor: HTMLElement;
  start: PickTab;
  episode: Episode;
  s: EpisodeSummary;
  finReady: boolean;
  suggestions: FinSuggestion[];
  moveTips: MoveSuggestion[];
  onMove: (entry: Entry, on: boolean) => void;
  onToggle: (item: EpisodeFinItem, on: boolean) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PickTab>(finReady ? start : 'mov');
  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      align="end"
      label="Enlazar al episodio"
      className="ep-fin-pick"
    >
      <header className="ep-fin-pick-head">
        <strong>Enlazar al episodio</strong>
        <small>
          {tab === 'mov'
            ? 'Toca los que son de aquí. Un ingreso trae sus gastos anexados; un abono, su trabajo.'
            : 'Sus abonos y sus gastos se suman aquí solos: no los registras dos veces.'}
        </small>
      </header>
      {finReady && (
        <div className="ep-fin-tabs" role="tablist" aria-label="Qué enlazar">
          {(
            [
              ['mov', 'Movimientos'],
              ['fin', 'Trabajos y bolsillos'],
            ] as const
          ).map(([k, label]) => (
            <button
              type="button"
              role="tab"
              key={k}
              aria-selected={tab === k}
              className={tab === k ? 'on' : ''}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'mov' ? (
        <MovesPane episode={ep} s={s} tips={moveTips} onMove={onMove} />
      ) : (
        <FinPane episode={ep} suggestions={suggestions} onToggle={onToggle} />
      )}
    </Popover>
  );
}

/** Los movimientos: los que parecen de aquí, los recientes y, al buscar, todos. */
function MovesPane({
  episode: ep,
  s,
  tips,
  onMove,
}: {
  episode: Episode;
  s: EpisodeSummary;
  tips: MoveSuggestion[];
  onMove: (entry: Entry, on: boolean) => void;
}) {
  const { workspace } = useApp();
  const fin = useFinance();
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<MoveFilter>('todos');
  const today = todayInputValue();
  const via = s.finance.via;
  const moves = useMemo(
    () =>
      workspace.entries.filter(isMoney).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [workspace.entries],
  );
  // Cuántos anexados tiene cada ingreso (llegan con él).
  const anexos = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of moves)
      if (e.details.fromIncome) m.set(e.details.fromIncome, (m.get(e.details.fromIncome) ?? 0) + 1);
    return m;
  }, [moves]);
  const charges = itemsOf(fin.items, 'cobro');
  const typeOk = (e: Entry) => only === 'todos' || e.direction === only;
  const needle = normalizeText(q.trim());
  const digits = q.replace(/\D/g, '');
  const hit = (e: Entry) =>
    normalizeText(
      `${e.title} ${e.tags.join(' ')} ${e.body.slice(0, 200)} ${e.details.method ?? ''}`,
    ).includes(needle) ||
    (digits.length >= 3 && String(e.amount).includes(digits));

  const sug = needle ? [] : tips.filter((x) => typeOk(x.entry));
  const sugIds = new Set(sug.map((x) => x.entry.id));
  const linked = moves.filter((e) => e.episode_id === ep.id && typeOk(e));
  const results = needle ? moves.filter((e) => typeOk(e) && hit(e)).slice(0, 40) : [];
  const recent = needle
    ? []
    : moves
        .filter((e) => typeOk(e) && !e.episode_id && !via.has(e.id) && !sugIds.has(e.id))
        .slice(0, 12);

  const row = (e: Entry, why?: string) => {
    const on = e.episode_id === ep.id;
    const by = via.get(e.id);
    const other =
      e.episode_id && e.episode_id !== ep.id
        ? workspace.episodes.find((x) => x.id === e.episode_id)?.title
        : undefined;
    const look = amountLook(e);
    const Icon = flowIcon[flowOf(e)];
    const n = anexos.get(e.id) ?? 0;
    const job = e.details.chargeId
      ? charges.find((c) => c.id === e.details.chargeId)?.title
      : undefined;
    // Lo que más importa primero (si la línea se corta, se pierde lo menos útil).
    const bits = [
      by && `Ya cuenta por «${by}»`,
      other && `Está en «${other}»`,
      n > 0 && (n === 1 ? '+1 anexado' : `+${n} anexados`),
      job && `abono de «${job}»`,
      why ? cap(why) : friendlyDate(todayInputValue(new Date(e.created_at)), today),
      !why && categoryOf(e),
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <button
        type="button"
        key={e.id}
        className={'ep-fin-opt mv' + (on || by ? ' on' : '')}
        aria-pressed={on || Boolean(by)}
        disabled={Boolean(by)}
        title={
          by ? `Ya cuenta aquí por «${by}»` : on ? 'Quitar del episodio' : 'Enlazar al episodio'
        }
        onClick={() => onMove(e, !on)}
      >
        <span className={'ep-fin-ico mv ' + look.cls}>
          <Icon size={14} />
        </span>
        <span className="ep-fin-main">
          <strong title={e.title || undefined}>{e.title || categoryOf(e)}</strong>
          <small title={bits}>{bits}</small>
        </span>
        <b className={'ep-fin-opt-amt ' + look.cls}>
          {look.sign}
          {moneyShort(e.amount)}
        </b>
        <i className={'ep-fin-tick' + (on || by ? ' on' : '')} aria-hidden="true">
          <Check size={11} strokeWidth={3} />
        </i>
      </button>
    );
  };
  const nothing = needle ? !results.length : !sug.length && !recent.length && !linked.length;

  return (
    <>
      <label className="ep-fin-search">
        <Search size={13} />
        <input
          autoFocus
          value={q}
          placeholder="Buscar por concepto, categoría o monto…"
          aria-label="Buscar movimientos"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div className="ep-fin-seg" role="radiogroup" aria-label="Tipo">
        {moveFilters.map((x) => (
          <button
            type="button"
            role="radio"
            key={x.value}
            aria-checked={only === x.value}
            className={only === x.value ? 'on' : ''}
            onClick={() => setOnly(x.value)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="ep-fin-pick-list">
        {needle ? (
          results.length > 0 && <section>{results.map((e) => row(e))}</section>
        ) : (
          <>
            {sug.length > 0 && (
              <section>
                <h4>
                  <Sparkles size={11} /> Parece de este episodio
                </h4>
                {sug.map((x) => row(x.entry, x.why))}
              </section>
            )}
            {recent.length > 0 && (
              <section>
                <h4>Recientes</h4>
                {recent.map((e) => row(e))}
              </section>
            )}
            {linked.length > 0 && (
              <section>
                <h4>En este episodio · {linked.length}</h4>
                {linked.map((e) => row(e))}
              </section>
            )}
          </>
        )}
        {nothing && (
          <p className="ep-fin-none">
            {needle ? 'Nada coincide.' : 'No hay movimientos sueltos para enlazar.'}
          </p>
        )}
      </div>
    </>
  );
}

/** Lo de Finanzas: primero lo que parece de aquí, luego todo. */
function FinPane({
  episode: ep,
  suggestions,
  onToggle,
}: {
  episode: Episode;
  suggestions: FinSuggestion[];
  onToggle: (item: EpisodeFinItem, on: boolean) => void;
}) {
  const { workspace } = useApp();
  const fin = useFinance();
  const [q, setQ] = useState('');
  const entries = workspace.entries;
  const needle = normalizeText(q.trim());
  const match = (x: EpisodeFinItem) => !needle || normalizeText(x.title).includes(needle);
  const groups: { key: string; title: string; items: EpisodeFinItem[] }[] = [
    {
      key: 'cobro',
      title: 'Trabajos por cobrar',
      items: itemsOf(fin.items, 'cobro').filter(
        (c) => isOpenCharge(c) || c.data.episodeId === ep.id,
      ),
    },
    {
      key: 'bolsillo',
      title: 'Carteras y bolsillos',
      items: itemsOf(fin.items, 'bolsillo').filter(
        (p) => !p.archived || p.data.episodeId === ep.id,
      ),
    },
    {
      key: 'meta',
      title: 'Metas',
      items: itemsOf(fin.items, 'meta').filter((g) => !g.archived || g.data.episodeId === ep.id),
    },
  ];
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const suggested = new Set(suggestions.map((x) => x.item.id));
  const tips = suggestions.filter((x) => match(x.item));
  const otherName = (id?: string) =>
    id && id !== ep.id ? workspace.episodes.find((x) => x.id === id)?.title : undefined;

  const row = (x: EpisodeFinItem, why?: string) => {
    const on = x.data.episodeId === ep.id;
    const other = otherName(x.data.episodeId);
    return (
      <button
        type="button"
        key={x.id}
        className={'ep-fin-opt' + (on ? ' on' : '')}
        aria-pressed={on}
        onClick={() => onToggle(x, !on)}
      >
        <span className={'ep-fin-ico ' + x.kind}>
          <ItemIcon item={x} />
        </span>
        <span className="ep-fin-main">
          <strong title={x.title}>{x.title}</strong>
          <small>
            {why ? cap(why) : describe(x, entries)}
            {other && ` · está en «${other}»`}
          </small>
        </span>
        <i className={'ep-fin-tick' + (on ? ' on' : '')} aria-hidden="true">
          <Check size={11} strokeWidth={3} />
        </i>
      </button>
    );
  };
  const shown = groups.map((g) => ({
    ...g,
    list: g.items.filter((x) => match(x) && !suggested.has(x.id)),
  }));
  const nothing = !tips.length && shown.every((g) => !g.list.length);

  return (
    <>
      {total > 6 && (
        <label className="ep-fin-search">
          <Search size={13} />
          <input
            value={q}
            placeholder="Buscar en Finanzas…"
            aria-label="Buscar en Finanzas"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      )}
      <div className="ep-fin-pick-list">
        {tips.length > 0 && (
          <section>
            <h4>
              <Sparkles size={11} /> Parece de este episodio
            </h4>
            {tips.map((x) => row(x.item, x.why))}
          </section>
        )}
        {shown.map((g) =>
          g.list.length ? (
            <section key={g.key}>
              <h4>{g.title}</h4>
              {g.list.map((x) => row(x))}
            </section>
          ) : null,
        )}
        {nothing && (
          <p className="ep-fin-none">
            {needle
              ? 'Nada coincide.'
              : 'Aún no tienes trabajos por cobrar, carteras, bolsillos ni metas en Finanzas.'}
          </p>
        )}
      </div>
    </>
  );
}
