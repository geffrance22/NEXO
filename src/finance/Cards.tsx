import { useEffect, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Segmented } from '../composer/controls';
import { friendlyDate, money, todayInputValue } from '../lib/format';
import { seal, touchVault, unseal, useVault } from '../notes/vault';
import { Progress } from './charts';
import {
  cardMethod,
  cardNetLabel,
  cardNets,
  cardSkins,
  cardStats,
  defaultAccounts,
  formatCardNumber,
  itemsOf,
  luhnOk,
  netOf,
  type Card,
  type CardNet,
  type CardSecret,
  type CardType,
  type FinItem,
} from './model';
import { daysBetween, isMoney, moneyShort, percent } from './money';
import { createItem, removeItem, restoreItem, settingsOf, updateItem, useFinance } from './store';
import { Field, FinSheet, FormSection, MoneyField, relDays } from './ui';

const typeLabel: Record<CardType, string> = { credito: 'Crédito', debito: 'Débito', prepago: 'Prepago' };
const REVEAL_MS = 30_000;
const expiryText = (e?: string) => (e ? `${e.slice(5, 7)}/${e.slice(2, 4)}` : '••/••');

/** La franquicia dibujada (sin imágenes externas). */
function NetMark({ net }: { net: CardNet }) {
  if (net === 'mastercard')
    return (
      <span className="fz-net mc" aria-label="Mastercard">
        <i />
        <i />
      </span>
    );
  if (net === 'otra') return null;
  return <span className={'fz-net ' + net}>{net === 'visa' ? 'VISA' : net === 'amex' ? 'AMEX' : 'Diners'}</span>;
}

/** La tarjeta como se ve en la mano: lo delicado, oculto salvo que lo pidas. */
export function CardFace({ card, secret }: { card: Pick<FinItem<'tarjeta'>, 'title' | 'data'>; secret?: CardSecret | null }) {
  const skin = cardSkins[card.data.skin] ?? cardSkins.noche;
  const number = secret?.number ? formatCardNumber(secret.number) : `•••• •••• •••• ${card.data.last4 ?? '••••'}`;
  return (
    <div className={'fz-cardface' + (secret ? ' open' : '')} style={{ background: skin.bg, color: skin.ink }}>
      <div className="fz-cardface-top">
        <span>{card.data.bank || card.title || 'Tu tarjeta'}</span>
        <em>{typeLabel[card.data.type]}</em>
      </div>
      <i className="fz-cardface-chip" aria-hidden="true" />
      <div className="fz-cardface-num" aria-label={secret?.number ? 'Número completo' : `Termina en ${card.data.last4 ?? 'sin dato'}`}>
        {number}
      </div>
      <div className="fz-cardface-bottom">
        <div>
          <small>Titular</small>
          <b>{card.data.holder || '—'}</b>
        </div>
        <div>
          <small>Vence</small>
          <b>{expiryText(card.data.expiry)}</b>
        </div>
        {secret?.cvv && (
          <div>
            <small>CVV</small>
            <b>{secret.cvv}</b>
          </div>
        )}
        <NetMark net={card.data.network} />
      </div>
    </div>
  );
}

/** Pide el PIN de la bóveda (o lo crea) antes de ver o guardar datos delicados. */
function PinGate({ onOpen, text }: { onOpen?: () => void; text?: string }) {
  const vault = useVault();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (vault.status === 'open') return null;
  if (vault.status === 'loading') return <p className="fz-muted">Revisando tu bóveda…</p>;
  if (vault.status === 'missing')
    return (
      <p className="fz-pin-note">
        <Lock size={14} /> Para guardar el número completo y el CVV hace falta la bóveda de Notas (su migración aún no está en Supabase). Mientras tanto, guarda solo los últimos 4 dígitos.
      </p>
    );
  const creating = vault.status === 'none';
  const go = async () => {
    setBusy(true);
    const r = creating ? await vault.create(pin) : await vault.unlock(pin);
    setBusy(false);
    if (r) return setError(r);
    setPin('');
    setError('');
    onOpen?.();
  };
  return (
    <div className="fz-pin">
      <KeyRound size={16} />
      <div>
        <strong>{creating ? 'Crea un PIN para tus datos delicados' : 'Abre tu bóveda'}</strong>
        <small>
          {text ??
            (creating
              ? 'De 4 a 8 números. Es el mismo PIN de la bóveda de Notas y del diario; nunca sale de tu navegador.'
              : 'Escribe el PIN de tu bóveda (el mismo de Notas y del diario).')}
        </small>
        <span className="fz-pin-row">
          <input
            className="fz-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            placeholder="PIN"
            aria-label="PIN de la bóveda"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && void go()}
          />
          <button type="button" className="fz-btn primary sm" disabled={busy || pin.length < 4} onClick={() => void go()}>
            {creating ? 'Crear PIN' : 'Abrir'}
          </button>
        </span>
        {error && <small className="bad">{error}</small>}
      </div>
    </div>
  );
}

/** Tus tarjetas débito y crédito: cupo, deuda, fechas de corte y pago, y sus datos protegidos. */
export function CardsBlock() {
  const { workspace, notify, openEntry, confirm } = useApp();
  const fin = useFinance();
  const vault = useVault();
  const all = itemsOf(fin.items, 'tarjeta');
  const cards = all.filter((c) => !c.archived);
  const archived = all.filter((c) => c.archived);
  const moves = workspace.entries.filter(isMoney);
  const [editing, setEditing] = useState<FinItem<'tarjeta'> | 'new' | null>(null);
  const [shown, setShown] = useState<{ id: string; s: CardSecret } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  /** La tarjeta que se mostrará apenas se abra la bóveda. */
  const [pending, setPending] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Lo delicado se vuelve a ocultar solo, y también si la bóveda se cierra.
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(null), REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [shown]);
  useEffect(() => {
    if (!vault.key) return setShown(null);
    if (!pending) return;
    const c = cards.find((x) => x.id === pending);
    setPending(null);
    if (c) void reveal(c, vault.key);
  }, [vault.key, pending]);

  const reveal = async (c: FinItem<'tarjeta'>, key = vault.key) => {
    if (!c.data.secret) return;
    if (shown?.id === c.id) return setShown(null);
    if (!key) return setAsking(c.id);
    try {
      const s = await unseal<CardSecret>(key, c.data.secret);
      touchVault();
      setAsking(null);
      setShown({ id: c.id, s });
    } catch {
      notify('No se pudieron abrir los datos de esta tarjeta.');
    }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copiado.`);
    } catch {
      notify('No se pudo copiar.');
    }
  };
  const remove = async (c: FinItem<'tarjeta'>) => {
    const ok = await confirm({
      title: `¿Eliminar «${c.title}»?`,
      message: 'Sus movimientos se quedan como están.',
      confirmLabel: 'Eliminar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    const r = await removeItem(c);
    if (r !== true) return notify(r);
    notify('Tarjeta eliminada.', { label: 'Deshacer', run: () => void restoreItem(c) });
  };

  return (
    <section className="fz-block fz-cards">
      <header className="fz-block-head">
        <h3>
          <CreditCard size={16} /> Tarjetas
        </h3>
        <button type="button" className="fz-btn primary sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Nueva tarjeta
        </button>
        <small>Débito y crédito: cupo, lo que debes, fechas de corte y de pago. El número completo y el CVV se guardan cifrados con tu PIN.</small>
      </header>

      {cards.length ? (
        <div className="fz-card-grid">
          {cards.map((c) => {
            const s = cardStats(c, moves);
            const credit = c.data.type === 'credito';
            const open = shown?.id === c.id ? shown.s : null;
            const payIn = s.nextPay ? daysBetween(todayInputValue(), s.nextPay) : null;
            return (
              <article key={c.id} className="fz-card-item">
                <CardFace card={c} secret={open} />
                <div className="fz-card-info">
                  <header>
                    <div>
                      <strong>{c.title}</strong>
                      <small>
                        {cardNetLabel[c.data.network] !== 'Otra' ? `${cardNetLabel[c.data.network]} · ` : ''}
                        {typeLabel[c.data.type]} · se registra como «{cardMethod(c)}»
                      </small>
                    </div>
                    <span className="fz-row-tools">
                      {c.data.secret && (
                        <button
                          type="button"
                          className={'fz-icon' + (open ? ' ok' : '')}
                          title={open ? 'Ocultar datos' : 'Ver número y CVV (30 s)'}
                          aria-label={open ? 'Ocultar datos' : 'Ver datos'}
                          onClick={() => void reveal(c)}
                        >
                          {open ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      )}
                      <button type="button" className="fz-icon" title="Editar" aria-label="Editar" onClick={() => setEditing(c)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="fz-icon" title="Archivar" aria-label="Archivar" onClick={() => void updateItem(c, { archived: true })}>
                        <Archive size={14} />
                      </button>
                    </span>
                  </header>

                  {asking === c.id && !vault.key && <PinGate onOpen={() => setPending(c.id)} text="Para ver el número completo y el CVV." />}
                  {open?.number && (
                    <div className="fz-card-copy">
                      <button type="button" className="fz-btn ghost sm" onClick={() => void copy(open.number!, 'Número')}>
                        <Copy size={13} /> Copiar número
                      </button>
                      {open.cvv && (
                        <button type="button" className="fz-btn ghost sm" onClick={() => void copy(open.cvv!, 'CVV')}>
                          <Copy size={13} /> Copiar CVV
                        </button>
                      )}
                      <small>Se oculta en 30 segundos.</small>
                    </div>
                  )}

                  {credit ? (
                    <>
                      <div className="fz-card-owed">
                        <span>
                          <small>Debes</small>
                          <b className={s.owed > 0 ? 'out' : ''}>{money(Math.max(0, s.owed))}</b>
                        </span>
                        {s.available !== null && (
                          <span>
                            <small>Disponible</small>
                            <b className={s.available < 0 ? 'bad' : 'in'}>{money(s.available)}</b>
                          </span>
                        )}
                      </div>
                      {c.data.limit ? (
                        <>
                          <Progress value={Math.max(0, s.owed)} max={c.data.limit} tone={(s.used ?? 0) >= 0.9 ? 'bad' : (s.used ?? 0) >= 0.7 ? 'warn' : 'out'} />
                          <small className="fz-card-line">
                            Usas el {percent(s.used ?? 0)} de un cupo de {moneyShort(c.data.limit)}
                            {s.owed < 0 && ` · tienes ${money(-s.owed)} a favor`}
                          </small>
                        </>
                      ) : null}
                      {(s.nextCut || s.nextPay) && (
                        <div className="fz-card-dates">
                          {s.nextCut && (
                            <span>
                              <small>Corte</small>
                              <b>{friendlyDate(s.nextCut)}</b>
                            </span>
                          )}
                          {s.nextPay && (
                            <span className={payIn !== null && payIn <= 3 && s.owed > 0 ? 'warn' : ''}>
                              <small>Pago</small>
                              <b>
                                {friendlyDate(s.nextPay)}
                                {payIn !== null && payIn <= 7 ? ` · ${relDays(payIn)}` : ''}
                              </b>
                            </span>
                          )}
                        </div>
                      )}
                      {(c.data.rate || c.data.fee) && (
                        <small className="fz-card-line">
                          {c.data.rate ? `Tasa ${c.data.rate.toLocaleString('es-CO')} % E.A.` : ''}
                          {c.data.rate && c.data.fee ? ' · ' : ''}
                          {c.data.fee ? `Cuota de manejo ${money(c.data.fee)}` : ''}
                        </small>
                      )}
                    </>
                  ) : (
                    <small className="fz-card-line">{s.spentMonth > 0 ? `Gastaste ${money(s.spentMonth)} con ella este mes.` : 'Sin gastos este mes.'}</small>
                  )}

                  <footer>
                    {credit && s.owed > 0 && (
                      <button
                        type="button"
                        className="fz-btn soft sm"
                        onClick={() =>
                          openEntry('Movimiento', [], { flow: 'transferencia', toMethod: cardMethod(c) }, { title: `Pago ${c.title}`.slice(0, 180), amount: Math.round(s.owed), direction: 'egreso' })
                        }
                      >
                        <CalendarClock size={13} /> Pagar
                      </button>
                    )}
                    <button
                      type="button"
                      className="fz-btn ghost sm"
                      onClick={() => openEntry('Movimiento', [], { flow: 'gasto', method: cardMethod(c) })}
                    >
                      <Plus size={13} /> Gasto con ella
                    </button>
                    {s.expiresIn !== null && s.expiresIn <= 60 && (
                      <em className={'fz-chip ' + (s.expiresIn < 0 ? 'bad' : 'warn')}>{s.expiresIn < 0 ? 'Vencida' : `Vence ${relDays(s.expiresIn)}`}</em>
                    )}
                  </footer>
                  {c.data.benefits && <p className="fz-card-note">{c.data.benefits}</p>}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="fz-muted">Registra tus tarjetas para saber cuánto debes, cuánto cupo te queda y cuándo toca pagar. Los gastos con ellas se suman solos.</p>
      )}

      {archived.length > 0 && (
        <div className="fz-closed">
          <button type="button" className="fz-link" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Ocultar' : 'Ver'} archivadas ({archived.length})
          </button>
          {showArchived && (
            <ul>
              {archived.map((c) => (
                <li key={c.id}>
                  <span>
                    <b>{c.title}</b> · {typeLabel[c.data.type]} {c.data.last4 ? `•••• ${c.data.last4}` : ''}
                  </span>
                  <button type="button" className="fz-icon" aria-label="Restaurar" title="Restaurar" onClick={() => void updateItem(c, { archived: false })}>
                    <ArchiveRestore size={13} />
                  </button>
                  <button type="button" className="fz-icon" aria-label="Eliminar" title="Eliminar" onClick={() => void remove(c)}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && <CardSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function CardSheet({ item, onClose }: { item: FinItem<'tarjeta'> | null; onClose: () => void }) {
  const { notify } = useApp();
  const fin = useFinance();
  const vault = useVault();
  const d = item?.data;
  const accounts = (settingsOf(fin.items).accounts.length ? settingsOf(fin.items).accounts : defaultAccounts).map((a) => a.name);
  const [title, setTitle] = useState(item?.title ?? '');
  const [type, setType] = useState<CardType>(d?.type ?? 'credito');
  const [network, setNetwork] = useState<CardNet>(d?.network ?? 'visa');
  const [bank, setBank] = useState(d?.bank ?? '');
  const [holder, setHolder] = useState(d?.holder ?? '');
  const [last4, setLast4] = useState(d?.last4 ?? '');
  const [expiry, setExpiry] = useState(d?.expiry ?? '');
  const [skin, setSkin] = useState(d?.skin ?? 'noche');
  const [method, setMethod] = useState(d?.method ?? '');
  const [limit, setLimit] = useState(d?.limit ?? 0);
  const [owed, setOwed] = useState(d?.owed ?? 0);
  const [cutDay, setCutDay] = useState(d?.cutDay ? String(d.cutDay) : '');
  const [payDay, setPayDay] = useState(d?.payDay ? String(d.payDay) : '');
  const [rate, setRate] = useState(d?.rate ? String(d.rate) : '');
  const [fee, setFee] = useState(d?.fee ?? 0);
  const [benefits, setBenefits] = useState(d?.benefits ?? '');
  const [note, setNote] = useState(d?.note ?? '');
  // Lo delicado: se descifra al abrir (si la bóveda está abierta) y solo se vuelve a cifrar si lo cambias.
  const [number, setNumber] = useState('');
  const [cvv, setCvv] = useState('');
  const [showCvv, setShowCvv] = useState(false);
  const [touched, setTouched] = useState(false);
  const [clearSecret, setClearSecret] = useState(false);
  const [loaded, setLoaded] = useState(!d?.secret);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!d?.secret || !vault.key || loaded) return;
    void unseal<CardSecret>(vault.key, d.secret)
      .then((s) => {
        setNumber(s.number ?? '');
        setCvv(s.cvv ?? '');
        touchVault();
      })
      .catch(() => notify('No se pudieron abrir los datos guardados de esta tarjeta.'))
      .finally(() => setLoaded(true));
  }, [vault.key, d?.secret, loaded]);

  const digits = number.replace(/\D/g, '');
  const badNumber = digits.length >= 13 && !luhnOk(digits);
  const day = (v: string) => {
    const n = Math.round(Number(v));
    return n >= 1 && n <= 31 ? n : undefined;
  };
  const ok = title.trim().length > 0 && (!last4 || /^\d{4}$/.test(last4)) && !busy;

  const onNumber = (v: string) => {
    const n = v.replace(/\D/g, '').slice(0, 19);
    setNumber(n);
    setTouched(true);
    setClearSecret(false);
    if (n.length >= 12) setLast4(n.slice(-4));
    const net = netOf(n);
    if (net) setNetwork(net);
  };

  const save = async () => {
    if (!ok) return;
    let secret = d?.secret;
    if (clearSecret) secret = undefined;
    else if (touched) {
      if (!digits && !cvv) secret = undefined;
      else if (!vault.key) return notify('Abre tu bóveda para guardar el número y el CVV.');
      else secret = await seal(vault.key, { ...(digits && { number: digits }), ...(cvv && { cvv }) } satisfies CardSecret);
    }
    const data: Card = {
      type,
      network,
      bank: bank.trim() || undefined,
      holder: holder.trim().toUpperCase() || undefined,
      last4: last4 || undefined,
      expiry: expiry || undefined,
      skin,
      method: method || undefined,
      limit: type === 'credito' ? limit || undefined : undefined,
      owed: type === 'credito' ? owed || undefined : undefined,
      cutDay: type === 'credito' ? day(cutDay) : undefined,
      payDay: type === 'credito' ? day(payDay) : undefined,
      rate: type === 'credito' && Number(rate.replace(',', '.')) > 0 ? Number(rate.replace(',', '.')) : undefined,
      fee: fee || undefined,
      benefits: benefits.trim() || undefined,
      note: note.trim() || undefined,
      secret,
    };
    setBusy(true);
    const r = item ? await updateItem(item, { title, data }) : await createItem('tarjeta', title, data);
    setBusy(false);
    if (typeof r === 'string') return notify(r);
    notify(item ? 'Tarjeta actualizada.' : 'Tarjeta guardada.');
    onClose();
  };

  const preview: Pick<FinItem<'tarjeta'>, 'title' | 'data'> = {
    title: title || 'Tu tarjeta',
    data: { type, network, bank, holder: holder.toUpperCase(), last4: last4 || undefined, expiry: expiry || undefined, skin } as Card,
  };

  return (
    <FinSheet
      wide
      icon={<CreditCard size={18} />}
      title={item ? 'Editar tarjeta' : 'Nueva tarjeta'}
      sub="Lo delicado se ve oculto y se guarda cifrado con tu PIN."
      onClose={onClose}
      className="fz-card-sheet"
      footer={
        <>
          <button type="button" className="fz-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="fz-btn primary" disabled={!ok} onClick={() => void save()}>
            Guardar
          </button>
        </>
      }
    >
      <div className="fz-card-form">
        <div className="fz-card-preview">
          <CardFace card={preview} />
          <div className="fz-skins" role="radiogroup" aria-label="Diseño">
            {Object.entries(cardSkins).map(([k, s]) => (
              <button type="button" role="radio" aria-checked={skin === k} key={k} title={k} className={skin === k ? 'on' : ''} style={{ background: s.bg }} onClick={() => setSkin(k)} />
            ))}
          </div>
        </div>

        <div className="fz-card-fields">
          <Segmented
            label="Tipo de tarjeta"
            value={type}
            onChange={setType}
            options={[
              { value: 'credito', label: 'Crédito' },
              { value: 'debito', label: 'Débito' },
              { value: 'prepago', label: 'Prepago' },
            ]}
          />
          <FormSection title="La tarjeta">
            <div className="fz-form">
              <Field label="Nombre" wide>
                <input className="fz-input" value={title} autoFocus maxLength={80} placeholder="Visa Bancolombia, Nu, Débito Davivienda…" onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Banco" hint="Opcional">
                <input className="fz-input" value={bank} maxLength={60} placeholder="Bancolombia, Nu, Davivienda…" onChange={(e) => setBank(e.target.value)} />
              </Field>
              <Field label="Titular" hint="Opcional">
                <input className="fz-input" value={holder} maxLength={60} placeholder="Como aparece en la tarjeta" onChange={(e) => setHolder(e.target.value)} />
              </Field>
              <Field label="Últimos 4 dígitos" hint="Para reconocerla">
                <input
                  className="fz-input"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={last4}
                  placeholder="1234"
                  onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </Field>
              <Field label="Vence" hint="Opcional">
                <input className="fz-input" type="month" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </Field>
              <Field label="Franquicia" wide group>
                <div className="fz-chips">
                  {cardNets.map((n) => (
                    <button type="button" key={n} className={network === n ? 'on' : ''} onClick={() => setNetwork(n)}>
                      {cardNetLabel[n]}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Datos delicados"
            hint={
              <>
                <ShieldCheck size={13} /> Se cifran en tu navegador con el PIN de tu bóveda; en la base solo queda el texto cifrado.
              </>
            }
          >
            {vault.status !== 'open' ? (
              <>
                <PinGate />
                {d?.secret && <p className="fz-muted">Esta tarjeta ya tiene datos guardados. Abre la bóveda para verlos o cambiarlos.</p>}
              </>
            ) : !loaded ? (
              <p className="fz-muted">Abriendo los datos guardados…</p>
            ) : (
              <div className="fz-form">
                <Field label="Número completo" hint="Opcional" wide>
                  <input
                    className={'fz-input fz-card-number' + (badNumber ? ' bad' : '')}
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    value={formatCardNumber(number)}
                    placeholder="0000 0000 0000 0000"
                    onChange={(e) => onNumber(e.target.value)}
                  />
                </Field>
                {badNumber && <small className="fz-field wide bad">Revisa el número: no parece válido.</small>}
                <Field label="CVV" hint="Opcional">
                  <span className="fz-secret">
                    <input
                      className="fz-input"
                      type={showCvv ? 'text' : 'password'}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={4}
                      value={cvv}
                      placeholder="•••"
                      onChange={(e) => {
                        setCvv(e.target.value.replace(/\D/g, '').slice(0, 4));
                        setTouched(true);
                        setClearSecret(false);
                      }}
                    />
                    <button type="button" className="fz-icon" aria-label={showCvv ? 'Ocultar CVV' : 'Ver CVV'} onClick={() => setShowCvv((v) => !v)}>
                      {showCvv ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </span>
                </Field>
                {d?.secret && (
                  <div className="fz-field">
                    <span>&nbsp;</span>
                    <button
                      type="button"
                      className={'fz-btn ghost sm' + (clearSecret ? ' on' : '')}
                      onClick={() => {
                        setClearSecret(true);
                        setNumber('');
                        setCvv('');
                      }}
                    >
                      <Trash2 size={13} /> {clearSecret ? 'Se borrarán al guardar' : 'Borrar datos delicados'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </FormSection>

          <FormSection title={type === 'credito' ? 'Cupo, fechas y costos' : 'Cómo la usas'}>
            <div className="fz-form">
              <Field label="Se registra como" hint="Medio de pago en tus movimientos" wide>
                <select className="fz-input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="">Con su nombre ({title.trim() || 'la tarjeta'})</option>
                  {accounts.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </Field>
              {type === 'credito' && (
                <>
                  <Field label="Cupo total">
                    <MoneyField value={limit} onChange={setLimit} />
                  </Field>
                  <Field label="Ya debes" hint="Al registrarla">
                    <MoneyField value={owed} onChange={setOwed} />
                  </Field>
                  <Field label="Día de corte">
                    <input className="fz-input" type="number" min={1} max={31} value={cutDay} placeholder="15" onChange={(e) => setCutDay(e.target.value)} />
                  </Field>
                  <Field label="Día límite de pago">
                    <input className="fz-input" type="number" min={1} max={31} value={payDay} placeholder="30" onChange={(e) => setPayDay(e.target.value)} />
                  </Field>
                  <Field label="Tasa" hint="% efectivo anual">
                    <input className="fz-input" inputMode="decimal" value={rate} placeholder="28,5" onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, ''))} />
                  </Field>
                </>
              )}
              <Field label="Cuota de manejo" hint="Al mes, opcional">
                <MoneyField value={fee} onChange={setFee} />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Notas">
            <div className="fz-form">
              <Field label="Beneficios" hint="Opcional" wide>
                <input className="fz-input" value={benefits} maxLength={300} placeholder="Millas, cashback 1 %, salas VIP, seguro de viaje…" onChange={(e) => setBenefits(e.target.value)} />
              </Field>
              <Field label="Nota" hint="Opcional" wide>
                <input className="fz-input" value={note} maxLength={300} placeholder="Para qué la usas, reglas que te pones…" onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          </FormSection>
        </div>
      </div>
    </FinSheet>
  );
}
