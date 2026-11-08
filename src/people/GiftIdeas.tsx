import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  BookmarkCheck,
  BookmarkPlus,
  Cake,
  ChevronDown,
  Gift,
  HandHeart,
  Handshake,
  Heart,
  House,
  Palette,
  Plus,
  RefreshCw,
  Sparkles,
  Sprout,
  Ticket,
  TreePine,
  Trophy,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { giftIdeas, type GiftIdea, type GiftKind, type GiftPrice } from '../assistant';
import type { Person, Workspace } from '../data';
import { addDays, errorMessage, friendlyDate, normalizeText, todayInputValue } from '../lib/format';
import { genderOf } from '../lib/gender';
import { ageOf, daysToBirthday, interestsOf, relationMeta, relationOf } from '../lib/people';
import { ME, groupsOf, kindWord, tiesOf } from '../lib/relations';
import { updatesOf } from '../lib/updates';
import './gifts.css';

const kinds: Record<GiftKind, { label: string; icon: LucideIcon; tone: string }> = {
  objeto: { label: 'Objeto', icon: Gift, tone: 'obj' },
  experiencia: { label: 'Experiencia', icon: Ticket, tone: 'exp' },
  'hecho a mano': { label: 'Hecho a mano', icon: Palette, tone: 'diy' },
  gesto: { label: 'No se compra', icon: HandHeart, tone: 'det' },
};
const prices: Record<GiftPrice, string> = {
  gratis: 'Gratis',
  bajo: 'Económico',
  medio: 'Precio medio',
  alto: 'Especial',
};

/** Para qué es el regalo. `ai`: cómo se le explica la ocasión a la IA. */
type Occasion =
  | 'cumple'
  | 'detalle'
  | 'navidad'
  | 'gracias'
  | 'visita'
  | 'aniversario'
  | 'perdon'
  | 'animo'
  | 'logro';
const occasions: Record<Occasion, { label: string; icon: LucideIcon; ai: string }> = {
  cumple: { label: 'Cumpleaños', icon: Cake, ai: 'su cumpleaños' },
  detalle: { label: 'Sin motivo', icon: Sparkles, ai: 'un detalle sin motivo, cualquier día' },
  navidad: { label: 'Navidad', icon: TreePine, ai: 'Navidad' },
  gracias: { label: 'Agradecer', icon: HandHeart, ai: 'agradecerle algo que hizo por el usuario' },
  visita: { label: 'Visita', icon: House, ai: 'llevarle algo al visitarle en su casa' },
  aniversario: {
    label: 'Aniversario',
    icon: Heart,
    ai: 'un aniversario de su relación con el usuario',
  },
  perdon: { label: 'Disculpa', icon: Handshake, ai: 'pedirle disculpas y reconciliarse' },
  animo: { label: 'Ánimo', icon: Sprout, ai: 'darle ánimo en un momento difícil' },
  logro: { label: 'Un logro', icon: Trophy, ai: 'celebrar un logro suyo' },
};
const occasionList = Object.keys(occasions) as Occasion[];

/** Tope de ideas en la lista (cada «Más ideas» suma unas 6). */
const MAX_IDEAS = 30;

/** Ideas ya pedidas en esta visita, por persona y ocasión (volver a abrir no gasta otra consulta). */
const cache = new Map<string, GiftIdea[]>();

type Birthday = { turns: number | null; date: string };

/** Su próximo cumpleaños (si se sabe). */
function nextBirthday(p: Person): Birthday | null {
  const today = todayInputValue();
  const d = daysToBirthday(p, today);
  if (d === null) return null;
  const date = addDays(today, d);
  return { turns: ageOf(p, date), date };
}

/** Todo lo que se sabe de la persona y de su historia contigo, para inspirar los regalos. */
function giftContext(p: Person, ws: Workspace, birthday: Birthday | null) {
  const pr = p.profile;
  const g = genderOf(p);
  const tie = tiesOf(ME, ws.ties).find((v) => v.other === p.id);
  const together = ws.entries
    .filter((e) => e.person_ids.includes(p.id) && e.kind !== 'Movimiento')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const gifts = (pr.exchanges ?? []).filter((x) => x.kind === 'regalo');
  const given = (dir: 'dar' | 'recibir') =>
    gifts
      .filter((x) => x.dir === dir)
      .slice(0, 10)
      .map((x) => `${x.date}: ${x.note || 'un regalo'}`);
  return {
    nombre: p.name,
    cumpleanos: birthday?.date,
    cumple_anos: birthday?.turns ?? undefined,
    sexo: g === 'f' ? 'mujer' : g === 'm' ? 'hombre' : undefined,
    relacion: relationMeta[relationOf(p)].label,
    es_tu: tie ? kindWord(tie.kind, g) : undefined,
    cercania_1_a_5: pr.closeness,
    rol: p.role || undefined,
    ciudad: pr.city,
    ocupacion: pr.occupation,
    empresa: pr.company,
    antes: pr.history?.map((h) => `${h.field}: ${h.value} (hasta ${h.until})`),
    intereses: interestsOf(p),
    le_gusta: pr.likes,
    no_le_gusta: pr.dislikes,
    ideas_que_ya_anotaste: pr.gifts,
    datos: (pr.facts ?? []).map((f) => `${f.label}: ${f.value}`),
    palabras_clave: pr.keywords,
    novedades: updatesOf(p)
      .slice(0, 8)
      .map((u) => `${u.date}: ${u.text}`),
    regalos_que_le_diste: given('dar'),
    regalos_que_te_dio: given('recibir'),
    recuerdos_juntos: together.slice(0, 15).map((e) => ({
      fecha: e.created_at.slice(0, 10),
      tipo: e.kind,
      titulo: e.title.slice(0, 100),
      texto: e.body ? e.body.replace(/\s+/g, ' ').slice(0, 160) : undefined,
    })),
    libros_y_peliculas_juntos: together
      .filter((e) => e.kind === 'Libro' || e.kind === 'Película')
      .slice(0, 10)
      .map((e) => e.title),
    grupos: groupsOf(p.id, ws.groups).map((x) => x.name),
    su_gente: pr.family,
    su_historia: p.bio ? p.bio.slice(0, 500) : undefined,
  };
}

const key = (s: string) => normalizeText(s.trim());

/**
 * Ideas de regalo hechas por la IA con todo lo que sabes de la persona y lo que han vivido, para
 * su cumpleaños o cualquier otra ocasión. `standalone`: se abre sola (desde la ficha), con su
 * propio fondo y su propio Esc; si no, vive dentro de «Próximos cumpleaños».
 */
export function GiftIdeas({
  person,
  birthday,
  standalone = false,
  onClose,
}: {
  person: Person;
  /** Si se abre por su cumpleaños: años que cumple y fecha (AAAA-MM-DD). */
  birthday?: Birthday;
  standalone?: boolean;
  onClose: () => void;
}) {
  const { workspace, patchPerson, notify } = useApp();
  const first = person.name.split(' ')[0];
  const bday = birthday ?? nextBirthday(person);
  // Desde la ficha, el cumpleaños solo es la ocasión por defecto si está cerca.
  const soon = bday ? Date.parse(bday.date) - Date.now() < 45 * 86_400_000 : false;
  const [occasion, setOccasion] = useState<Occasion>(birthday || soon ? 'cumple' : 'detalle');
  const available = occasionList.filter((o) => o !== 'cumple' || bday);
  const cacheKey = (o: Occasion) => person.id + '|' + o;
  const cached = cache.get(cacheKey(occasion));
  const [ideas, setIdeas] = useState<GiftIdea[]>(cached ?? []);
  // «first»: la primera tanda; «more»: sumando ideas debajo de las que ya hay.
  const [busy, setBusy] = useState<'first' | 'more' | null>(cached ? null : 'first');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const started = useRef(false);
  // Cada pedido lleva un número: si cambias de ocasión a mitad, la respuesta vieja se descarta.
  const seq = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const pr = person.profile;
  const saved = new Set((pr.gifts ?? []).map(key));

  async function ask(more: boolean, occ: Occasion = occasion) {
    if (more && busy) return;
    started.current = true;
    const n = ++seq.current;
    setBusy(more ? 'more' : 'first');
    setError('');
    const before = more ? ideas : [];
    try {
      const fresh = await giftIdeas(
        giftContext(person, workspace, occ === 'cumple' ? bday : null),
        [...before.map((i) => i.title), ...(pr.gifts ?? [])],
        occ === 'cumple' && bday?.turns != null
          ? `su cumpleaños (cumple ${bday.turns})`
          : occasions[occ].ai,
      );
      if (n !== seq.current) return;
      const seen = new Set(before.map((i) => key(i.title)));
      const next = [...before, ...fresh.filter((i) => !seen.has(key(i.title)))].slice(0, MAX_IDEAS);
      cache.set(cacheKey(occ), next);
      setIdeas(next);
      // Las nuevas quedan a la vista.
      if (more)
        requestAnimationFrame(() =>
          list.current
            ?.querySelector(`[data-n="${before.length}"]`)
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
        );
    } catch (e) {
      if (n === seq.current) setError(errorMessage(e));
    } finally {
      if (n === seq.current) setBusy(null);
    }
  }

  useEffect(() => {
    // Una sola consulta al abrir (también en desarrollo, donde los efectos corren dos veces).
    if (cached || started.current) return;
    void ask(false);
  }, []);

  // Sola, encima de la ficha: Esc la cierra a ella y a nada más.
  useEffect(() => {
    if (!standalone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [standalone]);

  const pick = (o: Occasion) => {
    if (o === occasion) return;
    setOccasion(o);
    setOpen(new Set());
    setError('');
    const c = cache.get(cacheKey(o));
    if (c) {
      seq.current++;
      setBusy(null);
      setIdeas(c);
      return;
    }
    setIdeas([]);
    void ask(false, o);
  };

  const toggle = (title: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const keep = async (idea: GiftIdea) => {
    const current = workspace.people.find((p) => p.id === person.id) ?? person;
    const gifts = current.profile.gifts ?? [];
    if (gifts.some((g) => key(g) === key(idea.title))) return;
    const ok = await patchPerson(
      current,
      { profile: { ...current.profile, gifts: [...gifts, idea.title.slice(0, 80)] } },
      true,
    );
    if (ok) notify(`«${idea.title}» quedó en las ideas de regalo de ${first}.`);
  };

  const skeleton = (n: number) =>
    Array.from({ length: n }, (_, i) => <div className="gi-skel" key={'s' + i} />);

  const dialog = (
    <div
      className={'gi-backdrop' + (standalone ? ' gi-solo' : '')}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onPointerDown={(e) => standalone && e.stopPropagation()}
    >
      <div
        className="gi"
        role="dialog"
        aria-modal="true"
        aria-label={`Ideas de regalo para ${first}`}
      >
        <header className="gi-head">
          <span className="gi-icon">
            <Gift size={20} />
          </span>
          <div>
            <h3>Ideas de regalo para {first}</h3>
            {occasion === 'cumple' && bday && (
              <p>
                {bday.turns !== null ? `Cumple ${bday.turns} · ` : ''}
                {friendlyDate(bday.date).toLowerCase()}
              </p>
            )}
          </div>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="gi-occ" role="radiogroup" aria-label="Ocasión">
          {available.map((o) => {
            const m = occasions[o];
            return (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={occasion === o}
                className={occasion === o ? 'on' : ''}
                onClick={() => pick(o)}
              >
                <m.icon size={13} /> {m.label}
              </button>
            );
          })}
        </div>

        <div className="gi-body" ref={list} aria-busy={Boolean(busy)}>
          {ideas.map((idea, i) => {
            const k = kinds[idea.kind] ?? kinds.objeto;
            const isSaved = saved.has(key(idea.title));
            const expanded = open.has(idea.title);
            return (
              <article
                className={'gi-card' + (expanded ? ' open' : '')}
                key={idea.title}
                data-n={i}
                style={{ '--i': i % 6 } as CSSProperties}
              >
                <div className="gi-top">
                  <span className={'gi-kind ' + k.tone} title={k.label}>
                    <k.icon size={17} />
                  </span>
                  <div className="gi-text">
                    <strong>{idea.title}</strong>
                    <span className="gi-meta">
                      <em className={idea.kind === 'gesto' ? 'free' : ''}>{k.label}</em>
                      <em className={'p-' + idea.price}>{prices[idea.price] ?? prices.bajo}</em>
                    </span>
                  </div>
                  <button
                    type="button"
                    className={'gi-save' + (isSaved ? ' on' : '')}
                    disabled={isSaved}
                    title={isSaved ? 'Ya está en sus ideas de regalo' : 'Guardar en sus ideas'}
                    aria-label={
                      isSaved
                        ? `${idea.title}: ya está en sus ideas`
                        : `Guardar «${idea.title}» en sus ideas de regalo`
                    }
                    onClick={() => void keep(idea)}
                  >
                    {isSaved ? <BookmarkCheck size={17} /> : <BookmarkPlus size={17} />}
                  </button>
                </div>
                {(idea.what || idea.why) && (
                  <>
                    <button
                      type="button"
                      className="gi-why-btn"
                      aria-expanded={expanded}
                      onClick={() => toggle(idea.title)}
                    >
                      ¿Por qué esta idea?
                      <ChevronDown size={14} />
                    </button>
                    {expanded && (
                      <div className="gi-why">
                        {idea.what && <p>{idea.what}</p>}
                        {idea.why && (
                          <p className="reason">
                            <Sparkles size={13} /> {idea.why}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
          {busy === 'first' && (
            <>
              {skeleton(3)}
              <p className="gi-wait" aria-live="polite">
                <Sparkles size={14} /> Pensando en {first}…
              </p>
            </>
          )}
          {busy === 'more' && skeleton(2)}
          {error && (
            <div className="gi-error" role="alert">
              <p>{error}</p>
              {!ideas.length && (
                <button type="button" className="cp-btn ghost" onClick={() => void ask(false)}>
                  <RefreshCw size={15} /> Reintentar
                </button>
              )}
            </div>
          )}
        </div>

        <footer className="gi-foot">
          <small>
            {ideas.length > 0 && `${ideas.length} ${ideas.length === 1 ? 'idea' : 'ideas'}`}
          </small>
          <button
            type="button"
            className="cp-btn cta gi-more"
            disabled={Boolean(busy) || ideas.length >= MAX_IDEAS}
            onClick={() => void ask(true)}
          >
            {busy === 'more' ? <RefreshCw className="spin" size={15} /> : <Plus size={15} />} Más
            ideas
          </button>
        </footer>
      </div>
    </div>
  );
  return standalone ? createPortal(dialog, document.body) : dialog;
}
