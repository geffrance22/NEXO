import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  BookMarked,
  Briefcase,
  Check,
  ChevronDown,
  Clapperboard,
  Contact,
  Gift,
  GraduationCap,
  Layers,
  Lightbulb,
  Link2,
  ListChecks,
  LoaderCircle,
  MapPin,
  MessageCircleQuestion,
  Network,
  PenLine,
  Quote,
  Smile,
  Sparkles,
  UserPlus,
  Users,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { captureWithAssistant } from '../assistant';
import { Sheet } from '../components/Sheet';
import type { CommitmentKind, EpisodeKind, UpdateKind } from '../data';
import {
  proposeCapture,
  planFromAi,
  pieceName,
  type CapturePlan,
  type KinLink,
  type Piece,
  type PieceKind,
} from '../lib/capture';
import { exchangeKinds } from '../lib/people';
import { placeKindList, placeKinds } from '../lib/places';
import { MoodPicker, Stars, moods } from '../composer/controls';
import type { ExchangeKind, PlaceKind } from '../data';
import { cueOptions } from '../lib/recognize';
import { genderOf } from '../lib/gender';
import { ME, kinCall, tiesOf } from '../lib/relations';
import { commitmentKindList, commitmentKinds } from '../lib/commitments';
import { episodeKindList, episodeKinds } from '../lib/episodes';
import { errorMessage, friendlyDate, money, thousands, todayInputValue } from '../lib/format';
import { updateKindList, updateKinds } from '../lib/updates';
import { expenseCategories, incomeCategories } from '../composer/logic';
import { saveCapture } from './saveCapture';
import './capture.css';

type PieceMeta = { icon: LucideIcon; color: string; soft: string };
const pieceIcons: Record<PieceKind, PieceMeta> = {
  encuentro: { icon: Users, color: '#8a6fa8', soft: '#f0e9f6' },
  movimiento: { icon: Banknote, color: '#c0674a', soft: '#f9e9e2' },
  novedad: { icon: Sparkles, color: '#6b62b5', soft: '#eeebfa' },
  compromiso: { icon: ListChecks, color: '#c4705a', soft: '#f9e8e2' },
  conexion: { icon: Network, color: '#3c9186', soft: '#dff2ef' },
  aprendizaje: { icon: GraduationCap, color: '#3c9186', soft: '#dff2ef' },
  nota: { icon: PenLine, color: '#5f8247', soft: '#eaf1e0' },
  obra: { icon: Clapperboard, color: '#6b75b8', soft: '#e9ebf8' },
  idea: { icon: Lightbulb, color: '#c48a2a', soft: '#fbf1dc' },
  trabajo: { icon: Briefcase, color: '#4d7b9d', soft: '#e3eef6' },
  intercambio: { icon: Gift, color: '#c25683', soft: '#f8e5ee' },
  dato: { icon: Contact, color: '#9a6b45', soft: '#f5ebe1' },
  preguntar: { icon: MessageCircleQuestion, color: '#6b62b5', soft: '#eeebfa' },
  visita: { icon: MapPin, color: '#3c9186', soft: '#dff2ef' },
  enlace: { icon: Link2, color: '#5f8247', soft: '#eaf1e0' },
};
const bookMeta: PieceMeta = { icon: BookMarked, color: '#b08843', soft: '#f8f0dd' };
const metaOf = (p: Piece) =>
  p.kind === 'obra' && p.media === 'Libro' ? bookMeta : pieceIcons[p.kind];
const platforms = ['Cine', 'Netflix', 'Prime Video', 'Disney+', 'Max', 'Apple TV', 'YouTube'];
const learnSources = ['Libro', 'Curso', 'Video', 'Artículo', 'Persona', 'Práctica'];
const factFields = [
  ['likes', 'Le gusta'],
  ['dislikes', 'No le gusta'],
  ['gifts', 'Idea de regalo'],
  ['birthday', 'Cumpleaños'],
  ['fact', 'Otro dato'],
] as const;
const activities = [
  'Café',
  'Comida',
  'Fiesta',
  'Visita',
  'Paseo',
  'Viaje',
  'Llamada',
  'Videollamada',
  'Trabajo',
  'Deporte',
];
/** Ejemplos que muestran todo lo que entiende (se alternan). */
const EXAMPLES = [
  'Ayer almorcé con Laura en Café Norte. Pagué 48.000. Está buscando trabajo y le prometí enviarle el contacto de Andrés el viernes.',
  'Anoche vimos «Dune: Parte dos» con Pedro en Netflix, buenísima. Me recomendó leer «El problema de los tres cuerpos».',
  'Se me ocurrió montar una tienda online de plantas. Tengo que preguntarle a Sofía cómo le fue con su emprendimiento.',
  'Hoy entregué la propuesta al cliente, falta enviar la factura. Laura me ayudó con el diseño; le encanta el café de especialidad.',
  'Fui al Jardín Botánico, la pasé muy tranquila. Terminé de leer «Hábitos atómicos» y aprendí que los sistemas pesan más que las metas.',
];
const EXAMPLE = EXAMPLES[0];
/** Lo que Nexo sabe reconocer, para el texto de ayuda. */
const UNDERSTANDS =
  'Encuentros, gastos, libros, películas y series, ideas, trabajo, aprendizajes, regalos y favores, gustos y cumpleaños de tu gente, preguntas pendientes, lugares, enlaces y cómo te sentiste.';

/**
 * Captura una experiencia en texto libre y deja que Nexo proponga sus piezas: el encuentro, el
 * gasto, la novedad, el compromiso, la conexión… Antes de guardar puedes corregir o excluir cada
 * una. Todas quedan enlazadas entre sí (en un episodio) y al texto original.
 */
export function CaptureDialog({
  initialText = '',
  people: preset = [],
  onClose,
}: {
  initialText?: string;
  people?: string[];
  onClose: () => void;
}) {
  const app = useApp();
  const { workspace, confirm, notify, go } = app;
  const [text, setText] = useState(initialText);
  const [plan, setPlan] = useState<CapturePlan | null>(null);
  const [busy, setBusy] = useState<'ai' | 'save' | null>(null);
  const [showSource, setShowSource] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => area.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  // Vista previa en vivo de lo que Nexo encontraría (y el ánimo, si lo dijiste).
  const draft = useMemo(
    () => (text.trim().length > 8 ? proposeCapture(text, workspace) : null),
    [text, workspace],
  );
  const preview = draft?.pieces ?? [];
  const previewMood = draft?.mood ? moods.find((m) => m.value === draft.mood) : undefined;
  const [example, setExample] = useState(0);

  const propose = () => {
    if (!text.trim()) return;
    const next = proposeCapture(text, workspace);
    // Las personas desde las que se abrió la captura van en el encuentro.
    if (preset.length) {
      const enc = next.pieces.find((p) => p.kind === 'encuentro');
      if (enc) enc.personIds = [...new Set([...preset, ...enc.personIds])];
    }
    setPlan(next);
  };

  /** «tu mamá», «tu jefe»… de cada persona vinculada contigo. */
  const myKin = useMemo(() => {
    const byId = new Map(workspace.people.map((p) => [p.id, p]));
    return new Map(
      tiesOf(ME, workspace.ties)
        .filter((v) => v.other !== ME && byId.has(v.other))
        .map((v) => [v.other, `tu ${kinCall(v.kind, genderOf(byId.get(v.other)))}`]),
    );
  }, [workspace.people, workspace.ties]);

  const refine = async () => {
    if (!text.trim() || busy) return;
    setBusy('ai');
    try {
      const raw = await captureWithAssistant(text, {
        today: todayInputValue(),
        people: workspace.people.slice(0, 400).map((p) => ({
          id: p.id,
          name: p.name,
          ...(p.profile.alias && { alias: p.profile.alias }),
          // Para que entienda «mi mamá», «mi tío»…: lo que es para ti.
          ...(myKin.get(p.id) && { kin: myKin.get(p.id) }),
        })),
        places: workspace.places.slice(0, 200).map((p) => ({ id: p.id, name: p.name })),
      });
      setPlan(planFromAi(raw, plan ?? proposeCapture(text, workspace), workspace));
    } catch (e) {
      notify(errorMessage(e));
      if (!plan) propose();
    } finally {
      setBusy(null);
    }
  };

  const setPiece = (id: string, patch: Partial<Piece>) =>
    setPlan((p) =>
      p
        ? { ...p, pieces: p.pieces.map((x) => (x.id === id ? ({ ...x, ...patch } as Piece) : x)) }
        : p,
    );
  const active = plan?.pieces.filter((p) => p.on) ?? [];

  const save = async () => {
    if (!plan || !active.length || busy) return;
    setBusy('save');
    const { episode, count, people, ties } = await saveCapture(plan, app);
    setBusy(null);
    if (!count && !episode && !people && !ties) return;
    const fresh = people
      ? ` · ${people} ${people === 1 ? 'persona nueva' : 'personas nuevas'}`
      : '';
    const linked = ties ? ` · ${ties} ${ties === 1 ? 'vínculo' : 'vínculos'}` : '';
    notify(
      `Experiencia guardada: ${count} ${count === 1 ? 'pieza' : 'piezas'}${episode ? ` en «${episode.title}»` : ''}${fresh}${linked}.`,
      episode
        ? { label: 'Ver episodio', icon: 'open', run: () => go('Episodios', episode) }
        : undefined,
    );
    onClose();
  };

  const requestClose = async () => {
    if (text.trim() && text !== initialText) {
      const ok = await confirm({
        title: '¿Descartar lo que escribiste?',
        message: 'Nada de esta experiencia se ha guardado todavía.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir',
        danger: true,
        icon: 'warning',
      });
      if (!ok) return;
    }
    onClose();
  };

  // Personas que se pueden elegir en las piezas: las tuyas, las nuevas del texto y los
  // parentescos aún sin elegir («tu mamá»).
  const options = [
    ...workspace.people.map((p) => ({ id: p.id, name: p.name })),
    ...(plan?.newPeople.filter((n) => n.on).map((n) => ({ id: n.id, name: `${n.name} (nueva)` })) ??
      []),
    ...(plan?.kinLinks
      .filter((k) => !k.personId)
      .map((k) => ({ id: k.id, name: `${k.label} (por elegir)` })) ?? []),
  ].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const nameOf = (id: string | null) => options.find((o) => o.id === id)?.name ?? '';

  return (
    <Sheet label="Capturar una experiencia" size="lg" onRequestClose={requestClose}>
      <div
        className="xp"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (plan) void save();
            else propose();
          }
        }}
      >
        <header className="xp-head">
          <span className="xp-chip">
            <Wand2 size={16} /> Capturar experiencia
          </span>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={requestClose}>
            <X size={20} />
          </button>
        </header>

        {!plan ? (
          <div className="xp-write">
            <h2>¿Qué pasó?</h2>
            <p>Cuéntalo como te salga. Nexo propone las piezas y tú decides qué guardar.</p>
            <textarea
              ref={area}
              rows={6}
              maxLength={4000}
              value={text}
              placeholder={`Por ejemplo: «${EXAMPLE}»`}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="xp-preview" aria-live="polite">
              {preview.length ? (
                <>
                  <span>Nexo encontró</span>
                  {preview.map((p) => {
                    const m = metaOf(p);
                    return (
                      <i key={p.id} style={{ '--c': m.color, '--s': m.soft } as CSSProperties}>
                        <m.icon size={12} /> {pieceName(p)}
                      </i>
                    );
                  })}
                  {previewMood && (
                    <i style={{ '--c': '#a8721d', '--s': '#fbf1dc' } as CSSProperties}>
                      {previewMood.emoji} {previewMood.label}
                    </i>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="ps-link"
                  onClick={() => {
                    setText(EXAMPLES[example % EXAMPLES.length]);
                    setExample((n) => n + 1);
                  }}
                >
                  {example ? 'Otro ejemplo' : 'Probar con un ejemplo'}
                </button>
              )}
            </div>
            {!text.trim() && <p className="xp-understands">{UNDERSTANDS}</p>}
          </div>
        ) : (
          <div className="xp-review">
            <EpisodeToggle plan={plan} setPlan={setPlan} disabled={app.experiencesMissing} />

            {active.some(
              (p) => p.kind === 'encuentro' || p.kind === 'visita' || p.kind === 'nota',
            ) && (
              <div className="xp-mood">
                <span className="xp-mood-head">
                  <Smile size={15} /> ¿Cómo te sentiste?
                  {plan.mood !== null && draft?.mood === plan.mood && (
                    <small>Lo noté en tu texto</small>
                  )}
                </span>
                <MoodPicker
                  value={plan.mood ?? undefined}
                  onChange={(m) => setPlan((p) => p && { ...p, mood: m ?? null })}
                  label="Cómo te sentiste"
                />
              </div>
            )}

            {plan.ambiguous.map((a) => (
              <div className="xp-notice" key={a.name}>
                <span>«{a.name}» puede ser varias personas. ¿Cuál es?</span>
                <select
                  value={a.chosen}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPlan((p) => p && swapPerson(p, a.chosen, next, a.name));
                  }}
                >
                  {a.ids.map((id) => (
                    <option key={id} value={id}>
                      {workspace.people.find((p) => p.id === id)?.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}

            {plan.kinLinks.map((k) => (
              <KinLinkRow key={k.id} link={k} plan={plan} setPlan={setPlan} />
            ))}

            {plan.newPeople.map((n) => (
              <label className="xp-newperson" key={n.id}>
                <input
                  type="checkbox"
                  checked={n.on}
                  onChange={(e) =>
                    setPlan(
                      (p) =>
                        p && {
                          ...p,
                          newPeople: p.newPeople.map((x) =>
                            x.id === n.id ? { ...x, on: e.target.checked } : x,
                          ),
                        },
                    )
                  }
                />
                <UserPlus size={15} />
                <span>Persona nueva:</span>
                <input
                  className="xp-inline"
                  value={n.name}
                  maxLength={120}
                  onChange={(e) =>
                    setPlan(
                      (p) =>
                        p && {
                          ...p,
                          newPeople: p.newPeople.map((x) =>
                            x.id === n.id ? { ...x, name: e.target.value } : x,
                          ),
                        },
                    )
                  }
                />
                <small>{n.on ? 'Se añadirá a tu universo' : 'No se creará'}</small>
              </label>
            ))}

            <div className="xp-pieces">
              {plan.pieces.map((p) => (
                <PieceCard key={p.id} piece={p} onToggle={(on) => setPiece(p.id, { on })}>
                  <PieceFields
                    piece={p}
                    set={(patch) => setPiece(p.id, patch)}
                    options={options}
                    nameOf={nameOf}
                  />
                </PieceCard>
              ))}
            </div>

            <button
              type="button"
              className="xp-source-toggle"
              onClick={() => setShowSource((v) => !v)}
            >
              <Quote size={13} /> Texto original{' '}
              <ChevronDown size={14} className={showSource ? 'open' : ''} />
            </button>
            {showSource && <blockquote className="xp-source">{plan.text}</blockquote>}
          </div>
        )}

        <footer className="cp-foot">
          {plan ? (
            <button type="button" className="cp-btn ghost" onClick={() => setPlan(null)}>
              <ArrowLeft size={15} /> Editar texto
            </button>
          ) : (
            <span className="cp-status">Ctrl + Enter para proponer</span>
          )}
          <button
            type="button"
            className="cp-btn ghost xp-ai"
            disabled={!text.trim() || Boolean(busy)}
            onClick={() => void refine()}
            title="Usa la IA para entender textos más complejos (consume una consulta)"
          >
            {busy === 'ai' ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{' '}
            Afinar con IA
          </button>
          {plan ? (
            <button
              type="button"
              className="cp-btn cta"
              disabled={!active.length || Boolean(busy)}
              onClick={() => void save()}
            >
              {busy === 'save' ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{' '}
              Guardar {active.length} {active.length === 1 ? 'pieza' : 'piezas'}
            </button>
          ) : (
            <button type="button" className="cp-btn cta" disabled={!text.trim()} onClick={propose}>
              Proponer piezas <ArrowRight size={16} />
            </button>
          )}
        </footer>
      </div>
    </Sheet>
  );
}

/**
 * Un parentesco del texto: «¿Quién es tu mamá?» (eliges a alguien o escribes un nombre nuevo) o
 * «Guardar a Carlos como tu tío». Lo elegido entra en las piezas y el vínculo se guarda.
 */
function KinLinkRow({
  link,
  plan,
  setPlan,
}: {
  link: KinLink;
  plan: CapturePlan;
  setPlan: (fn: (p: CapturePlan | null) => CapturePlan | null) => void;
}) {
  const { workspace } = useApp();
  const [typing, setTyping] = useState(false);
  const [changing, setChanging] = useState(false);
  const [name, setName] = useState('');
  const cue = {
    key: link.id,
    start: 0,
    end: 0,
    label: link.label,
    kind: link.kind,
    gender: link.gender,
    owner: link.owner,
    plural: false,
    status: 'unknown' as const,
    ids: [],
  };
  const options = useMemo(
    () => cueOptions(cue, workspace.people, workspace.ties),
    // Solo cambia si cambia la gente o el parentesco.
    [workspace.people, workspace.ties, link.kind, link.gender, link.owner],
  );
  const patch = (p: CapturePlan, changes: Partial<KinLink>): CapturePlan => ({
    ...p,
    kinLinks: p.kinLinks.map((x) => (x.id === link.id ? { ...x, ...changes } : x)),
  });
  /** Elegir a alguien: reemplaza el comodín en las piezas por esa persona. */
  const choose = (to: string) => {
    setPlan((p) => {
      if (!p) return p;
      const from = link.personId ?? link.id;
      const next = from === to ? p : swapPerson(p, from, to, '');
      return patch(next, { personId: to, save: true });
    });
    setChanging(false);
  };
  const createNew = () => {
    const n = name.trim();
    if (!n) return;
    const id = 'new:' + crypto.randomUUID();
    setPlan((p) => {
      if (!p) return p;
      const withPerson = { ...p, newPeople: [...p.newPeople, { id, name: n, on: true }] };
      return patch(swapPerson(withPerson, link.personId ?? link.id, id, ''), {
        personId: id,
        save: true,
      });
    });
    setTyping(false);
    setChanging(false);
  };

  const chosen =
    link.personId &&
    (workspace.people.find((p) => p.id === link.personId)?.name ??
      plan.newPeople.find((n) => n.id === link.personId)?.name);

  return (
    <div className={'xp-kin' + (link.personId && !changing ? ' done' : '')}>
      <Network size={15} />
      {link.personId && !changing && !typing ? (
        <label className="xp-kin-save">
          <input
            type="checkbox"
            checked={link.save}
            onChange={(e) => setPlan((p) => p && patch(p, { save: e.target.checked }))}
          />
          <span>
            Guardar a <b>{chosen?.split(' ')[0] ?? '¿?'}</b> como {link.label}
          </span>
          <button type="button" className="ps-link" onClick={() => setChanging(true)}>
            Cambiar
          </button>
        </label>
      ) : typing ? (
        <form
          className="xp-kin-new"
          onSubmit={(e) => {
            e.preventDefault();
            createNew();
          }}
        >
          <span>Nombre de {link.label}:</span>
          <input
            autoFocus
            className="xp-inline"
            maxLength={120}
            value={name}
            placeholder="Nombre completo"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="ps-link" disabled={!name.trim()}>
            Añadir
          </button>
          <button type="button" className="ps-link" onClick={() => setTyping(false)}>
            Cancelar
          </button>
        </form>
      ) : (
        <>
          <span>
            ¿Quién es <b>{link.label}</b>?
          </span>
          <select
            value=""
            aria-label={`Quién es ${link.label}`}
            onChange={(e) => {
              if (e.target.value === '+new') setTyping(true);
              else if (e.target.value) choose(e.target.value);
            }}
          >
            <option value="">Elegir…</option>
            <option value="+new">+ Persona nueva…</option>
            {options.map((id) => (
              <option key={id} value={id}>
                {workspace.people.find((p) => p.id === id)?.name}
              </option>
            ))}
          </select>
          <small>Se recordará para la próxima vez.</small>
        </>
      )}
    </div>
  );
}

/** Cambia una persona por otra en todas las piezas (al aclarar un nombre ambiguo). */
function swapPerson(plan: CapturePlan, from: string, to: string, name: string): CapturePlan {
  const sw = (id: string | null) => (id === from ? to : id);
  const swList = (ids: string[]) => [...new Set(ids.map((id) => sw(id)!))];
  return {
    ...plan,
    ambiguous: plan.ambiguous.map((a) => (a.name === name ? { ...a, chosen: to } : a)),
    pieces: plan.pieces.map((p) => {
      switch (p.kind) {
        case 'encuentro':
          return { ...p, personIds: swList(p.personIds) };
        case 'novedad':
          return { ...p, personId: sw(p.personId)! };
        case 'compromiso':
          return { ...p, personId: sw(p.personId), peopleIds: swList(p.peopleIds) };
        case 'conexion':
          return { ...p, a: sw(p.a)!, b: sw(p.b)! };
        case 'obra':
          return { ...p, personIds: swList(p.personIds), recommendedBy: sw(p.recommendedBy) };
        case 'trabajo':
          return { ...p, personIds: swList(p.personIds) };
        case 'intercambio':
        case 'dato':
        case 'preguntar':
          return { ...p, personId: sw(p.personId)! };
        case 'enlace':
          return { ...p, personId: sw(p.personId) };
        default:
          return p;
      }
    }),
  };
}

function EpisodeToggle({
  plan,
  setPlan,
  disabled,
}: {
  plan: CapturePlan;
  setPlan: (fn: (p: CapturePlan | null) => CapturePlan | null) => void;
  disabled: boolean;
}) {
  const ep = plan.episode;
  const m = episodeKinds[ep.kind];
  const set = (patch: Partial<CapturePlan['episode']>) =>
    setPlan((p) => p && { ...p, episode: { ...p.episode, ...patch } });
  return (
    <div
      className={'xp-episode' + (ep.on && !disabled ? ' on' : '')}
      style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
    >
      <label className="xp-episode-head">
        <input
          type="checkbox"
          checked={ep.on && !disabled}
          disabled={disabled}
          onChange={(e) => set({ on: e.target.checked })}
        />
        <Layers size={16} />
        <span>
          <strong>Agrupar en un episodio</strong>
          <small>
            {disabled
              ? 'Necesita la migración 008. Las piezas se guardan igual, sueltas.'
              : 'Reúne todas las piezas y conserva el texto original.'}
          </small>
        </span>
        <input
          type="date"
          className="xp-date"
          value={plan.date}
          max="2100-12-31"
          onChange={(e) => {
            const date = e.target.value || plan.date;
            setPlan(
              (p) =>
                p && {
                  ...p,
                  date,
                  pieces: p.pieces.map((x) =>
                    x.kind === 'encuentro' ||
                    x.kind === 'movimiento' ||
                    x.kind === 'novedad' ||
                    x.kind === 'intercambio' ||
                    x.kind === 'visita'
                      ? { ...x, date }
                      : x,
                  ),
                },
            );
          }}
          aria-label="Cuándo pasó"
          title="Cuándo pasó"
        />
      </label>
      {ep.on && !disabled && (
        <div className="xp-episode-body">
          <input
            className="xp-title"
            value={ep.title}
            maxLength={120}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Nombre del episodio"
          />
          <div className="xp-kinds">
            {episodeKindList.map((k) => {
              const km = episodeKinds[k];
              return (
                <button
                  type="button"
                  key={k}
                  className={ep.kind === k ? 'on' : ''}
                  onClick={() => set({ kind: k as EpisodeKind })}
                >
                  <km.icon size={13} /> {km.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PieceCard({
  piece,
  onToggle,
  children,
}: {
  piece: Piece;
  onToggle: (on: boolean) => void;
  children: ReactNode;
}) {
  const m = metaOf(piece);
  return (
    <section
      className={'xp-piece' + (piece.on ? '' : ' off')}
      style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
    >
      <header>
        <label className="xp-switch" title={piece.on ? 'Excluir esta pieza' : 'Incluir esta pieza'}>
          <input type="checkbox" checked={piece.on} onChange={(e) => onToggle(e.target.checked)} />
          <i />
        </label>
        <span className="xp-piece-icon">
          <m.icon size={15} />
        </span>
        <strong>{pieceName(piece)}</strong>
        {piece.evidence && (
          <small className="xp-evidence" title={piece.evidence}>
            «{piece.evidence}»
          </small>
        )}
      </header>
      {piece.on && <div className="xp-piece-body">{children}</div>}
      {!piece.on && piece.kind === 'movimiento' && piece.dupOf && (
        <p className="xp-dup">
          Ya estaba registrado: se enlazará al episodio en lugar de duplicarlo.
        </p>
      )}
    </section>
  );
}

type Opt = { id: string; name: string };

function PeoplePick({
  ids,
  onChange,
  options,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  options: Opt[];
}) {
  return (
    <div className="xp-people">
      {ids.map((id) => (
        <span key={id}>
          {options.find((o) => o.id === id)?.name ?? '¿?'}
          <button
            type="button"
            aria-label="Quitar"
            onClick={() => onChange(ids.filter((x) => x !== id))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <select
        value=""
        aria-label="Añadir persona"
        onChange={(e) => e.target.value && onChange([...new Set([...ids, e.target.value])])}
      >
        <option value="">+ Persona</option>
        {options
          .filter((o) => !ids.includes(o.id))
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
      </select>
    </div>
  );
}

function PieceFields({
  piece: p,
  set,
  options,
  nameOf,
}: {
  piece: Piece;
  set: (patch: Partial<Piece>) => void;
  options: Opt[];
  nameOf: (id: string | null) => string;
}) {
  const { workspace } = useApp();
  switch (p.kind) {
    case 'encuentro':
      return (
        <div className="xp-grid">
          <input
            className="xp-wide"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Título"
          />
          <PeoplePick
            ids={p.personIds}
            options={options}
            onChange={(personIds) => set({ personIds })}
          />
          <div className="xp-row">
            <select
              value={p.placeId ?? (p.placeName ? 'new' : '')}
              aria-label="Lugar"
              onChange={(e) =>
                e.target.value === 'new'
                  ? set({ placeId: null })
                  : set({
                      placeId: e.target.value || null,
                      placeName: e.target.value ? '' : p.placeName,
                    })
              }
            >
              <option value="">Sin lugar</option>
              {p.placeName && <option value="new">Nuevo: {p.placeName}</option>}
              {workspace.places.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
            {!p.placeId && (
              <input
                className="xp-inline"
                placeholder="Lugar nuevo (opcional)"
                value={p.placeName}
                maxLength={120}
                onChange={(e) => set({ placeName: e.target.value })}
              />
            )}
            <select
              value={p.activity}
              onChange={(e) => set({ activity: e.target.value })}
              aria-label="Qué hicieron"
            >
              <option value="">Actividad</option>
              {activities.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <input
              type="date"
              value={p.date}
              onChange={(e) => set({ date: e.target.value || p.date })}
              aria-label="Fecha"
            />
          </div>
        </div>
      );
    case 'movimiento': {
      const cats = p.direction === 'ingreso' ? incomeCategories : expenseCategories;
      return (
        <div className="xp-row">
          <div className="xp-seg">
            {(['egreso', 'ingreso'] as const).map((d) => (
              <button
                type="button"
                key={d}
                className={p.direction === d ? 'on' : ''}
                onClick={() => set({ direction: d })}
              >
                {d === 'egreso' ? 'Gasto' : 'Ingreso'}
              </button>
            ))}
          </div>
          <label className="xp-money">
            $
            <input
              inputMode="numeric"
              value={thousands(p.amount)}
              onChange={(e) => set({ amount: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              aria-label="Monto"
            />
          </label>
          <select
            value={p.category}
            onChange={(e) => set({ category: e.target.value, title: e.target.value })}
            aria-label="Categoría"
          >
            {[...new Set([p.category, ...cats])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input
            type="date"
            value={p.date}
            onChange={(e) => set({ date: e.target.value || p.date })}
            aria-label="Fecha"
          />
          {p.dupOf && (
            <small className="xp-warn">
              Hay un movimiento de {money(p.amount)} cerca de esa fecha: ¿es el mismo?
            </small>
          )}
        </div>
      );
    }
    case 'novedad':
      return (
        <div className="xp-grid">
          <div className="xp-row">
            <select
              value={p.personId}
              onChange={(e) => set({ personId: e.target.value })}
              aria-label="De quién"
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select
              value={p.updateKind}
              onChange={(e) => set({ updateKind: e.target.value as UpdateKind })}
              aria-label="Tipo de novedad"
            >
              {updateKindList.map((k) => (
                <option key={k} value={k}>
                  {updateKinds[k].label}
                </option>
              ))}
            </select>
          </div>
          <input
            className="xp-wide"
            value={p.text}
            maxLength={500}
            onChange={(e) => set({ text: e.target.value })}
            aria-label="Novedad"
          />
        </div>
      );
    case 'compromiso': {
      const cm = commitmentKinds[p.commitment];
      return (
        <div className="xp-grid">
          <div className="xp-seg wide">
            {commitmentKindList.map((k) => (
              <button
                type="button"
                key={k}
                className={p.commitment === k ? 'on' : ''}
                onClick={() => set({ commitment: k as CommitmentKind })}
              >
                {commitmentKinds[k].short}
              </button>
            ))}
          </div>
          <input
            className="xp-wide"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Qué"
          />
          <div className="xp-row">
            <span className="xp-label">{cm.who}</span>
            <select
              value={p.personId ?? ''}
              onChange={(e) => set({ personId: e.target.value || null })}
              aria-label={cm.who}
            >
              <option value="">Nadie en particular</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={p.due}
              onChange={(e) => set({ due: e.target.value })}
              aria-label="Para cuándo"
            />
            <small className="xp-hint">{p.due ? friendlyDate(p.due) : 'Sin fecha'}</small>
          </div>
        </div>
      );
    }
    case 'conexion':
      return (
        <div className="xp-grid">
          <small className="xp-hint">
            Entre {nameOf(p.a) || '¿?'} y {nameOf(p.b) || '¿?'} · se guarda como nota en las dos
            fichas. Tú decides si contactar.
          </small>
          <input
            className="xp-wide"
            value={p.text}
            maxLength={300}
            onChange={(e) => set({ text: e.target.value })}
            aria-label="Conexión"
          />
        </div>
      );
    case 'aprendizaje':
      return (
        <div className="xp-grid">
          <input
            className="xp-wide"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Qué aprendiste"
          />
          <div className="xp-row">
            <span className="xp-label">De</span>
            <select
              value={p.source}
              onChange={(e) => set({ source: e.target.value })}
              aria-label="Fuente"
            >
              {learnSources.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <input
              className="xp-inline"
              value={p.sourceName}
              maxLength={120}
              placeholder="Título, curso o quién (opcional)"
              onChange={(e) => set({ sourceName: e.target.value })}
              aria-label="Nombre de la fuente"
            />
          </div>
        </div>
      );
    case 'nota':
      return (
        <textarea
          className="xp-wide"
          rows={3}
          value={p.text}
          maxLength={4000}
          onChange={(e) => set({ text: e.target.value })}
          aria-label="Nota"
        />
      );
    case 'obra': {
      const book = p.media === 'Libro';
      const states = book
        ? ([
            ['quiero', 'Quiero leerlo'],
            ['curso', 'Leyendo'],
            ['listo', 'Terminado'],
          ] as const)
        : ([
            ['quiero', 'Quiero verla'],
            ['curso', 'Viéndola'],
            ['listo', 'Vista'],
          ] as const);
      return (
        <div className="xp-grid">
          <div className="xp-row">
            <div className="xp-seg">
              {(['Película', 'Libro'] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  className={p.media === m ? 'on' : ''}
                  onClick={() =>
                    set(
                      m === 'Libro'
                        ? { media: m, platform: '', series: false }
                        : { media: m, author: '' },
                    )
                  }
                >
                  {m === 'Libro' ? 'Libro' : 'Película o serie'}
                </button>
              ))}
            </div>
            {!book && (
              <label className="xp-check">
                <input
                  type="checkbox"
                  checked={p.series}
                  onChange={(e) => set({ series: e.target.checked })}
                />
                Es una serie
              </label>
            )}
          </div>
          <input
            className="xp-wide xp-strong"
            value={p.title}
            maxLength={120}
            placeholder="Título"
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Título"
          />
          <div className="xp-row">
            {book ? (
              <input
                className="xp-inline"
                value={p.author}
                maxLength={120}
                placeholder="Autor (opcional)"
                onChange={(e) => set({ author: e.target.value })}
                aria-label="Autor"
              />
            ) : (
              <select
                value={p.platform}
                onChange={(e) => set({ platform: e.target.value })}
                aria-label="Dónde"
              >
                <option value="">¿Dónde?</option>
                {[...new Set([...(p.platform ? [p.platform] : []), ...platforms])].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            )}
            <div className="xp-seg">
              {states.map(([v, label]) => (
                <button
                  type="button"
                  key={v}
                  className={p.status === v ? 'on' : ''}
                  onClick={() => set({ status: v, ...(v === 'quiero' && { rating: 0 }) })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {p.status !== 'quiero' && (
            <div className="xp-row">
              <span className="xp-label">Tu calificación</span>
              <Stars
                value={p.rating}
                size={18}
                label="Calificación"
                onChange={(rating) => set({ rating })}
              />
            </div>
          )}
          <div className="xp-row">
            <span className="xp-label">{book ? 'Te lo recomendó' : 'Te la recomendó'}</span>
            <select
              value={p.recommendedBy ?? ''}
              onChange={(e) => set({ recommendedBy: e.target.value || null })}
              aria-label="Quién te la recomendó"
            >
              <option value="">Nadie</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <span className="xp-label">Con</span>
            <PeoplePick
              ids={p.personIds}
              options={options}
              onChange={(personIds) => set({ personIds })}
            />
          </div>
        </div>
      );
    }
    case 'idea':
      return (
        <div className="xp-grid">
          <input
            className="xp-wide"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="La idea"
          />
          <div className="xp-row">
            <span className="xp-label">Guardar como</span>
            <div className="xp-seg">
              {(
                [
                  ['nota', 'Idea suelta'],
                  ['trabajo', 'Proyecto en etapa de idea'],
                ] as const
              ).map(([v, label]) => (
                <button
                  type="button"
                  key={v}
                  className={p.as === v ? 'on' : ''}
                  onClick={() => set({ as: v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    case 'trabajo':
      return (
        <div className="xp-grid">
          <input
            className="xp-wide"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Qué hiciste"
          />
          <div className="xp-row">
            <div className="xp-seg">
              {(
                [
                  ['idea', 'Idea'],
                  ['curso', 'En curso'],
                  ['pausa', 'En pausa'],
                  ['listo', 'Listo'],
                ] as const
              ).map(([v, label]) => (
                <button
                  type="button"
                  key={v}
                  className={p.stage === v ? 'on' : ''}
                  onClick={() => set({ stage: v })}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={p.due}
              onChange={(e) => set({ due: e.target.value })}
              aria-label="Fecha límite"
              title="Fecha límite (opcional)"
            />
          </div>
          <input
            className="xp-wide"
            value={p.nextStep}
            maxLength={180}
            placeholder="Siguiente paso (opcional)"
            onChange={(e) => set({ nextStep: e.target.value })}
            aria-label="Siguiente paso"
          />
          <PeoplePick
            ids={p.personIds}
            options={options}
            onChange={(personIds) => set({ personIds })}
          />
        </div>
      );
    case 'intercambio':
      return (
        <div className="xp-row">
          <div className="xp-seg">
            {(
              [
                ['recibir', 'Recibiste'],
                ['dar', 'Diste'],
              ] as const
            ).map(([v, label]) => (
              <button
                type="button"
                key={v}
                className={p.dir === v ? 'on' : ''}
                onClick={() => set({ dir: v })}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={p.exchange}
            onChange={(e) => set({ exchange: e.target.value as ExchangeKind })}
            aria-label="Qué"
          >
            {(Object.keys(exchangeKinds) as ExchangeKind[]).map((k) => (
              <option key={k} value={k}>
                {exchangeKinds[k]}
              </option>
            ))}
          </select>
          <span className="xp-label">{p.dir === 'dar' ? 'a' : 'de'}</span>
          <select
            value={p.personId}
            onChange={(e) => set({ personId: e.target.value })}
            aria-label="Persona"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <input
            className="xp-inline"
            value={p.note}
            maxLength={120}
            placeholder="Qué fue (opcional)"
            onChange={(e) => set({ note: e.target.value })}
            aria-label="Detalle"
          />
        </div>
      );
    case 'dato': {
      const year = todayInputValue().slice(0, 4);
      return (
        <div className="xp-row">
          <select
            value={p.personId}
            onChange={(e) => set({ personId: e.target.value })}
            aria-label="De quién"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            value={p.field}
            onChange={(e) =>
              set({
                field: e.target.value as typeof p.field,
                ...(e.target.value === 'birthday' && { value: '' }),
              })
            }
            aria-label="Qué dato"
          >
            {factFields.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          {p.field === 'fact' && (
            <input
              className="xp-inline xp-short"
              value={p.label}
              maxLength={40}
              placeholder="Dato (p. ej. Alergia)"
              onChange={(e) => set({ label: e.target.value })}
              aria-label="Nombre del dato"
            />
          )}
          {p.field === 'birthday' ? (
            <input
              type="date"
              value={/^\d{2}-\d{2}$/.test(p.value) ? `${year}-${p.value}` : ''}
              onChange={(e) => set({ value: e.target.value.slice(5) })}
              aria-label="Día del cumpleaños"
            />
          ) : (
            <input
              className="xp-inline"
              value={p.value}
              maxLength={80}
              onChange={(e) => set({ value: e.target.value })}
              aria-label="Valor"
            />
          )}
        </div>
      );
    }
    case 'preguntar':
      return (
        <div className="xp-grid">
          <div className="xp-row">
            <span className="xp-label">La próxima vez que veas a</span>
            <select
              value={p.personId}
              onChange={(e) => set({ personId: e.target.value })}
              aria-label="A quién"
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <input
            className="xp-wide"
            value={p.text}
            maxLength={200}
            onChange={(e) => set({ text: e.target.value })}
            aria-label="Qué preguntarle"
          />
        </div>
      );
    case 'visita':
      return (
        <div className="xp-grid">
          <input
            className="xp-wide"
            value={p.title}
            maxLength={180}
            onChange={(e) => set({ title: e.target.value })}
            aria-label="Título"
          />
          <div className="xp-row">
            <select
              value={p.placeId ?? (p.placeName ? 'new' : '')}
              aria-label="Lugar"
              onChange={(e) =>
                e.target.value === 'new'
                  ? set({ placeId: null })
                  : set({
                      placeId: e.target.value || null,
                      placeName: e.target.value ? '' : p.placeName,
                    })
              }
            >
              <option value="">Sin lugar</option>
              {p.placeName && <option value="new">Nuevo: {p.placeName}</option>}
              {workspace.places.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
            {!p.placeId && (
              <>
                <input
                  className="xp-inline"
                  placeholder="Lugar nuevo"
                  value={p.placeName}
                  maxLength={120}
                  onChange={(e) => set({ placeName: e.target.value })}
                />
                <select
                  value={p.placeKind}
                  onChange={(e) => set({ placeKind: e.target.value as PlaceKind })}
                  aria-label="Tipo de lugar"
                >
                  {placeKindList.map((k) => (
                    <option key={k} value={k}>
                      {placeKinds[k].label}
                    </option>
                  ))}
                </select>
              </>
            )}
            <input
              type="date"
              value={p.date}
              onChange={(e) => set({ date: e.target.value || p.date })}
              aria-label="Fecha"
            />
          </div>
        </div>
      );
    case 'enlace':
      return (
        <div className="xp-grid">
          <a className="xp-link" href={p.url} target="_blank" rel="noreferrer">
            {p.url}
          </a>
          <div className="xp-row">
            <div className="xp-seg">
              {(
                [
                  ['lecturas', 'Guardar en Lecturas'],
                  ['nota', 'Como nota'],
                ] as const
              ).map(([v, label]) => (
                <button
                  type="button"
                  key={v}
                  className={p.save === v ? 'on' : ''}
                  onClick={() => set({ save: v })}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="xp-label">Te lo pasó</span>
            <select
              value={p.personId ?? ''}
              onChange={(e) => set({ personId: e.target.value || null })}
              aria-label="Quién te lo pasó"
            >
              <option value="">Nadie</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <small className="xp-hint">
            {p.save === 'lecturas'
              ? 'Se captura el texto del artículo para leerlo en Lecturas (si no se puede, queda como nota).'
              : 'Queda como nota «Para leer» con el enlace.'}
          </small>
        </div>
      );
  }
}
