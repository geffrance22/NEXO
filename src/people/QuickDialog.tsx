import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
} from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Check,
  DoorOpen,
  Gift,
  HandHelping,
  HeartHandshake,
  Hourglass,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  Plus,
  Scale,
  Sparkles,
  StickyNote,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { QuickMode } from '../AppContext';
import { useApp } from '../AppContext';
import type { Exchange, ExchangeKind, Person, PersonUpdate, UpdateKind } from '../data';
import { AutoTextarea, ChoiceChips, Label, Segmented } from '../composer/controls';
import { DateChips } from '../composer/DateChips';
import { MiniPhotos, pastedImages } from '../composer/PhotoBlocks';
import { useImageUploads } from '../composer/useImageUploads';
import { addDays, todayInputValue } from '../lib/format';
import { exchangeKinds, reciprocityOf } from '../lib/people';
import { updateKindList, updateKinds } from '../lib/updates';
import { deduceTastes, hasTastes, tastesLabel, withTastes } from '../lib/tastes';
import { Avatar } from './Avatar';

const followOptions = [
  { value: '7', label: 'En una semana' },
  { value: '15', label: 'En 15 días' },
  { value: '30', label: 'En un mes' },
];

const factIdeas = [
  'Signo',
  'Comida favorita',
  'Bebida',
  'Alergia',
  'Talla',
  'Mascota',
  'Música',
  'Equipo',
  'Pronombres',
  'Sueño',
];
const weights = [
  { value: '1', label: 'Un detalle' },
  { value: '2', label: 'Importante' },
  { value: '3', label: 'Enorme' },
] as const;

const exchangeIcons: Record<ExchangeKind, LucideIcon> = {
  favor: HandHelping,
  regalo: Gift,
  apoyo: HeartHandshake,
  tiempo: Hourglass,
  consejo: Lightbulb,
  oportunidad: DoorOpen,
  dinero: Banknote,
  iniciativa: MessageCircle,
};

/** Qué escribir según lo que fue y quién dio: «Le ayudé con…», «Me presentó a…». */
function notePlaceholder(kind: ExchangeKind, dir: 'dar' | 'recibir', name: string) {
  const give = dir === 'dar';
  switch (kind) {
    case 'favor':
      return give ? 'Le ayudé con…' : 'Me ayudó con…';
    case 'regalo':
      return give ? 'Le regalé…' : 'Me regaló…';
    case 'apoyo':
      return give ? `Estuve para ${name} cuando…` : 'Estuvo para mí cuando…';
    case 'tiempo':
      return give ? 'Le dediqué tiempo para…' : 'Me dedicó tiempo para…';
    case 'consejo':
      return give ? 'Le aconsejé sobre…' : 'Me aconsejó sobre…';
    case 'oportunidad':
      return give ? 'Le presenté a… / le recomendé para…' : 'Me presentó a… / me recomendó para…';
    case 'dinero':
      return give ? 'Le presté o le di…' : 'Me prestó o me dio…';
    case 'iniciativa':
      return give ? 'Le escribí para…' : 'Me buscó para…';
  }
}

/** Ventana pequeña para alimentar la ficha de una persona en segundos. */
export function QuickDialog({
  person,
  mode: initial,
  onClose,
}: {
  person: Person;
  mode: QuickMode;
  onClose: () => void;
}) {
  const app = useApp();
  const [mode, setMode] = useState(initial);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ExchangeKind>('favor');
  const [weight, setWeight] = useState<'1' | '2' | '3'>('1');
  const [date, setDate] = useState(todayInputValue());
  const [label, setLabel] = useState('');
  const [updKind, setUpdKind] = useState<UpdateKind>('otro');
  const [follow, setFollow] = useState<string | undefined>(undefined);
  // Idea de regalo de su ficha que le diste (sale de la lista al guardar).
  const [idea, setIdea] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const photos = useImageUploads([], 6);
  const first = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const t = window.setTimeout(() => first.current?.focus(), 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const exchange = mode === 'dar' || mode === 'recibir';
  // Notas y novedades admiten fotos: no se guarda mientras suben ni si alguna falló.
  const withPhotos = mode === 'nota' || mode === 'novedad';
  const photoProblem = !withPhotos
    ? null
    : photos.busy
      ? 'Subiendo foto…'
      : photos.hasError
        ? 'Una foto no se subió: reinténtala o quítala.'
        : null;
  const hasContent =
    mode === 'dato'
      ? Boolean(label.trim() && text.trim())
      : mode === 'nota'
        ? Boolean(text.trim()) || photos.images.length > 0
        : mode === 'novedad'
          ? Boolean(text.trim())
          : true;
  const ready = hasContent && !photoProblem;
  const name = person.name.split(' ')[0];
  const giftIdeas = mode === 'dar' && kind === 'regalo' ? (person.profile.gifts ?? []) : [];
  // Cómo queda el balance con esto (antes y después).
  const balance = useMemo(() => {
    if (!exchange) return null;
    const list = person.profile.exchanges ?? [];
    const before = reciprocityOf(person, list);
    const after = reciprocityOf(person, [
      { id: 'nuevo', date, dir: mode, kind, weight: Number(weight) as 1 | 2 | 3 },
      ...list,
    ]);
    return { before, after };
  }, [exchange, person, date, mode, kind, weight]);
  // Lo nuevo que la novedad dice de sus gustos (lo que ya está en su ficha no se repite).
  const preview = useMemo(
    () =>
      mode === 'novedad' && text.trim()
        ? withTastes(person, deduceTastes(text)).added
        : { interests: [], likes: [], dislikes: [] },
    [mode, text, person],
  );
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = pastedImages(e);
    if (!files.length) return;
    e.preventDefault();
    photos.add(files);
  };

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    // Siempre sobre la versión más reciente de la persona (pudo cambiar con otro acceso rápido).
    const current = app.workspace.people.find((p) => p.id === person.id) ?? person;
    let ok = false;
    if (mode === 'nota') {
      ok = await app.saveQuickNote(current, text, photos.images);
    } else if (mode === 'novedad') {
      const update: PersonUpdate = {
        id: crypto.randomUUID(),
        date: date || todayInputValue(),
        kind: updKind,
        text: text.trim().slice(0, 500),
        created_at: new Date().toISOString(),
        ...(follow && { followUp: addDays(todayInputValue(), Number(follow)) }),
        ...(photos.images.length > 0 && { images: photos.images }),
      };
      const updates = [update, ...(current.profile.updates ?? [])].slice(0, 300);
      // Lo que la novedad deja ver de sus gustos se suma a su perfil en la misma escritura.
      const t = withTastes(current, deduceTastes(text));
      const changes = t.changed
        ? { interests: t.interests, profile: { ...t.profile, updates } }
        : { profile: { ...current.profile, updates } };
      ok = await app.patchPerson(current, changes, true);
      const base = follow
        ? `Novedad guardada. Te recordaremos preguntarle a ${name}.`
        : `Novedad guardada en la historia de ${name}.`;
      if (ok && t.changed) {
        const saved = { ...current, ...changes };
        app.notify(`${base} Su perfil suma: ${tastesLabel(t.added)}.`, {
          label: 'Quitar',
          run: () =>
            void app.patchPerson(
              saved,
              {
                interests: current.interests,
                profile: {
                  ...saved.profile,
                  likes: current.profile.likes,
                  dislikes: current.profile.dislikes,
                },
              },
              true,
            ),
        });
      } else if (ok) app.notify(base);
    } else if (exchange) {
      const item: Exchange = {
        id: crypto.randomUUID(),
        date,
        dir: mode,
        kind,
        weight: Number(weight) as 1 | 2 | 3,
        ...(text.trim() && { note: text.trim().slice(0, 300) }),
      };
      const exchanges = [item, ...(current.profile.exchanges ?? [])].slice(0, 500);
      // Si le diste una de sus ideas de regalo, ya no queda pendiente.
      const gifts = current.profile.gifts ?? [];
      const given = idea && mode === 'dar' && kind === 'regalo' && gifts.includes(idea);
      const profile = {
        ...current.profile,
        exchanges,
        ...(given && { gifts: gifts.filter((g) => g !== idea) }),
      };
      ok = await app.patchPerson(current, { profile }, true);
      if (ok) {
        const saved = { ...current, profile };
        app.notify(
          `Guardado · ${balance ? balance.after.label.toLowerCase() : 'balance actualizado'}${given ? ` · «${idea}» sale de sus ideas de regalo` : ''}.`,
          {
            label: 'Deshacer',
            run: () =>
              void app.patchPerson(
                saved,
                {
                  profile: {
                    ...saved.profile,
                    exchanges: current.profile.exchanges,
                    gifts: current.profile.gifts,
                  },
                },
                true,
              ),
          },
        );
      }
    } else {
      const facts = [
        ...(current.profile.facts ?? []),
        {
          id: crypto.randomUUID(),
          label: label.trim().slice(0, 60),
          value: text.trim().slice(0, 300),
        },
      ];
      ok = await app.patchPerson(current, { profile: { ...current.profile, facts } }, true);
    }
    setBusy(false);
    if (ok) onClose();
  }

  const um = updateKinds[updKind];
  const accent =
    mode === 'novedad'
      ? um.color
      : mode === 'recibir'
        ? '#4f8f5a'
        : mode === 'dar'
          ? '#c0674a'
          : mode === 'dato'
            ? '#4d7b9d'
            : '#5f8247';
  const soft =
    mode === 'novedad'
      ? um.soft
      : mode === 'recibir'
        ? '#e3f1e5'
        : mode === 'dar'
          ? '#f9e9e2'
          : mode === 'dato'
            ? '#e3eef6'
            : '#eaf1e0';
  const title =
    mode === 'nota'
      ? `Nota sobre ${name}`
      : mode === 'novedad'
        ? `¿Qué hay de nuevo con ${name}?`
        : mode === 'dato'
          ? `Un dato sobre ${name}`
          : mode === 'dar'
            ? `Algo que le diste a ${name}`
            : `Algo que ${name} te dio`;

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="qd"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ '--accent': accent, '--soft': soft, '--ink': '#27301f' } as CSSProperties}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
        }}
      >
        <header className="qd-head">
          <Avatar person={person} size={34} />
          <h3>{title}</h3>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {exchange && (
          <>
            <Segmented
              label="Dirección"
              value={mode}
              onChange={(v) => {
                setMode(v);
                setIdea(null);
              }}
              options={[
                { value: 'dar', label: 'Yo di', icon: <ArrowUpRight size={15} /> },
                { value: 'recibir', label: `${name} me dio`, icon: <ArrowDownLeft size={15} /> },
              ]}
            />
            <div className="qx-kinds" role="radiogroup" aria-label="Qué fue">
              {(Object.keys(exchangeKinds) as ExchangeKind[]).map((k) => {
                const Icon = exchangeIcons[k];
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    key={k}
                    className={kind === k ? 'on' : ''}
                    onClick={() => {
                      setKind(k);
                      setIdea(null);
                    }}
                  >
                    <Icon size={17} />
                    {exchangeKinds[k]}
                  </button>
                );
              })}
            </div>
            <input
              ref={(el) => {
                first.current = el;
              }}
              className="cp-ghost-input qx-note"
              maxLength={300}
              placeholder={notePlaceholder(kind, mode as 'dar' | 'recibir', name)}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (idea && e.target.value !== idea) setIdea(null);
              }}
            />
            {/* Regalarle algo de sus ideas: se apunta solo y sale de la lista. */}
            {giftIdeas.length > 0 && (
              <div className="qx-ideas" aria-label="De sus ideas de regalo">
                <Gift size={13} />
                {giftIdeas.slice(0, 6).map((g) => (
                  <button
                    type="button"
                    key={g}
                    className={idea === g ? 'on' : ''}
                    onClick={() => {
                      const on = idea === g;
                      setIdea(on ? null : g);
                      setText(on ? '' : g);
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
            {kind === 'dinero' && (
              <button
                type="button"
                className="qx-finance"
                onClick={() => {
                  onClose();
                  app.openEntry('Movimiento', [person.id]);
                }}
              >
                <Banknote size={14} />
                <span>
                  ¿Fue plata? Regístrala en Finanzas: queda en tus cuentas y se suma aquí sola.
                </span>
                <ArrowRight size={13} />
              </button>
            )}
            <div className="qx-weight" role="radiogroup" aria-label="Cuánto pesó">
              {weights.map((w) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={weight === w.value}
                  key={w.value}
                  className={weight === w.value ? 'on' : ''}
                  onClick={() => setWeight(w.value)}
                >
                  <span className="qx-dots" aria-hidden="true">
                    {[1, 2, 3].map((n) => (
                      <i key={n} className={n <= Number(w.value) ? 'on' : ''} />
                    ))}
                  </span>
                  {w.label}
                </button>
              ))}
            </div>
            <div className="qd-row">
              <DateChips
                label="Cuándo"
                options={['today', 'yesterday']}
                value={date}
                onChange={setDate}
              />
            </div>
          </>
        )}

        {mode === 'dato' && (
          <>
            <div className="qd-row">
              <ChoiceChips
                label="Ideas"
                options={factIdeas}
                value={factIdeas.includes(label) ? label : undefined}
                onChange={(v) => v && setLabel(v)}
              />
            </div>
            <div className="qd-fact">
              <input
                ref={(el) => {
                  first.current = el;
                }}
                className="cp-ghost-input"
                maxLength={60}
                placeholder="Qué (ej. Signo)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <input
                className="cp-ghost-input"
                maxLength={300}
                placeholder="Valor (ej. Leo)"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          </>
        )}

        {mode === 'novedad' && (
          <>
            <div className="qd-kinds" role="radiogroup" aria-label="Qué cambió">
              {updateKindList.map((k) => {
                const m = updateKinds[k];
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={updKind === k}
                    key={k}
                    className={updKind === k ? 'on' : ''}
                    style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
                    onClick={() => setUpdKind(k)}
                  >
                    <m.icon size={15} />
                    {m.label}
                  </button>
                );
              })}
            </div>
            <AutoTextarea
              className="cp-soft-area"
              minRows={3}
              maxLength={500}
              placeholder={um.hint}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={onPaste}
              onFocus={(e) => (first.current = e.currentTarget)}
              autoFocus
            />
            {hasTastes(preview) && (
              <p className="qd-tastes" aria-live="polite">
                <Sparkles size={13} />
                <span>Se suma a su perfil:</span>
                {preview.interests.map((v) => (
                  <b key={'i' + v}>{v}</b>
                ))}
                {preview.likes.map((v) => (
                  <b key={'l' + v}>{v}</b>
                ))}
                {preview.dislikes.map((v) => (
                  <b key={'d' + v} className="no" title="No le gusta">
                    {v}
                  </b>
                ))}
              </p>
            )}
            <MiniPhotos uploads={photos} hint="o pégalas con Ctrl+V" />
            <div className="qd-row">
              <Label>Cuándo pasó</Label>
              <DateChips
                label="Cuándo pasó"
                options={['today', 'yesterday']}
                value={date}
                onChange={setDate}
              />
            </div>
            <div className="qd-row">
              <Label hint="Aparece en tus recordatorios">Preguntarle cómo va</Label>
              <ChoiceChips
                label="Preguntarle cómo va"
                options={followOptions}
                value={follow}
                clearable
                onChange={setFollow}
              />
            </div>
          </>
        )}

        {mode === 'nota' && (
          <>
            <AutoTextarea
              className="cp-soft-area"
              minRows={4}
              maxLength={4000}
              placeholder={`¿Qué quieres recordar de ${name}?`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={onPaste}
              onFocus={(e) => (first.current = e.currentTarget)}
              autoFocus
            />
            <MiniPhotos uploads={photos} hint="o pégalas con Ctrl+V" />
          </>
        )}

        <footer className="qd-foot">
          <span className={photos.hasError && withPhotos ? 'problem' : ''}>
            {photoProblem ? (
              photoProblem
            ) : mode === 'nota' ? (
              <>
                <StickyNote size={13} /> Se guarda como nota en su historia
              </>
            ) : mode === 'novedad' ? (
              <>
                <Activity size={13} /> Se suma a su línea de vida, con su fecha
              </>
            ) : mode === 'dato' ? (
              <>
                <Plus size={13} /> Se suma a su identidad
              </>
            ) : balance ? (
              <span
                className={'qx-balance ' + balance.after.state}
                title="Cómo queda el balance de dar y recibir con esto"
              >
                <Scale size={13} />
                {balance.before.label !== balance.after.label ? (
                  <>
                    {balance.before.label} <ArrowRight size={11} /> <b>{balance.after.label}</b>
                  </>
                ) : (
                  <b>{balance.after.label}</b>
                )}
              </span>
            ) : null}
          </span>
          <button type="button" className="cp-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="cp-btn cta" disabled={!ready || busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Guardar
          </button>
        </footer>
      </form>
    </div>
  );
}
