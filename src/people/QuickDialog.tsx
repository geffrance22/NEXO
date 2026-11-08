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
  ArrowUpRight,
  Check,
  LoaderCircle,
  Plus,
  Sparkles,
  StickyNote,
  X,
} from 'lucide-react';
import type { QuickMode } from '../AppContext';
import { useApp } from '../AppContext';
import type { Exchange, ExchangeKind, Person, PersonUpdate, UpdateKind } from '../data';
import { AutoTextarea, ChoiceChips, Label, Segmented } from '../composer/controls';
import { DateChips } from '../composer/DateChips';
import { MiniPhotos, pastedImages } from '../composer/PhotoBlocks';
import { useImageUploads } from '../composer/useImageUploads';
import { addDays, todayInputValue } from '../lib/format';
import { exchangeKinds } from '../lib/people';
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
      ok = await app.patchPerson(current, { profile: { ...current.profile, exchanges } }, true);
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
              onChange={(v) => setMode(v)}
              options={[
                { value: 'dar', label: 'Yo di', icon: <ArrowUpRight size={15} /> },
                { value: 'recibir', label: 'Recibí', icon: <ArrowDownLeft size={15} /> },
              ]}
            />
            <div className="qd-row">
              <ChoiceChips
                label="Qué fue"
                options={(Object.keys(exchangeKinds) as ExchangeKind[]).map((k) => ({
                  value: k,
                  label: exchangeKinds[k],
                }))}
                value={kind}
                onChange={(v) => v && setKind(v)}
              />
            </div>
            <div className="qd-row">
              <ChoiceChips
                label="Cuánto pesó"
                options={[...weights]}
                value={weight}
                onChange={(v) => v && setWeight(v)}
              />
            </div>
            <div className="qd-row">
              <DateChips
                label="Cuándo"
                options={['today', 'yesterday']}
                value={date}
                onChange={setDate}
              />
            </div>
            <input
              ref={(el) => {
                first.current = el;
              }}
              className="cp-ghost-input"
              maxLength={300}
              placeholder={
                kind === 'iniciativa'
                  ? mode === 'dar'
                    ? 'Le escribí para…'
                    : 'Me buscó para…'
                  : 'Qué fue (opcional)'
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
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
            ) : (
              'Alimenta el balance de reciprocidad'
            )}
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
