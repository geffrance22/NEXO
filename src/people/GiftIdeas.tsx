import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  BookmarkCheck,
  BookmarkPlus,
  Gift,
  Heart,
  Palette,
  RefreshCw,
  Sparkles,
  Ticket,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { giftIdeas, type GiftIdea, type GiftKind, type GiftPrice } from '../assistant';
import type { Person, Workspace } from '../data';
import { errorMessage, friendlyDate, normalizeText } from '../lib/format';
import { genderOf } from '../lib/gender';
import { interestsOf, relationMeta, relationOf } from '../lib/people';
import { ME, groupsOf, kindWord, tiesOf } from '../lib/relations';
import { updatesOf } from '../lib/updates';
import './gifts.css';

const kinds: Record<GiftKind, { label: string; icon: LucideIcon; tone: string }> = {
  objeto: { label: 'Objeto', icon: Gift, tone: 'obj' },
  experiencia: { label: 'Experiencia', icon: Ticket, tone: 'exp' },
  detalle: { label: 'Detalle', icon: Heart, tone: 'det' },
  'hecho a mano': { label: 'Hecho a mano', icon: Palette, tone: 'diy' },
};
const prices: Record<GiftPrice, string> = {
  bajo: 'Económico',
  medio: 'Precio medio',
  alto: 'Especial',
};

/** Ideas ya pedidas en esta visita (volver a abrir no gasta otra consulta). */
const cache = new Map<string, { ideas: GiftIdea[]; seen: string[] }>();

/** Todo lo que se sabe de la persona y de su historia contigo, para inspirar los regalos. */
function giftContext(p: Person, ws: Workspace, turns: number | null, date: string) {
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
    cumpleanos: date,
    cumple_anos: turns ?? undefined,
    sexo: g === 'f' ? 'mujer' : g === 'm' ? 'hombre' : undefined,
    relacion: relationMeta[relationOf(p)].label,
    es_tu: tie ? kindWord(tie.kind, g) : undefined,
    cercania_1_a_5: pr.closeness,
    rol: p.role || undefined,
    ciudad: pr.city,
    ocupacion: pr.occupation,
    empresa: pr.company,
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

/** Ideas de regalo hechas por la IA con todo lo que sabes de la persona y lo que han vivido. */
export function GiftIdeas({
  person,
  turns,
  date,
  onClose,
}: {
  person: Person;
  /** Años que cumple (si se sabe su año de nacimiento). */
  turns: number | null;
  /** AAAA-MM-DD de su próximo cumpleaños. */
  date: string;
  onClose: () => void;
}) {
  const { workspace, patchPerson, notify } = useApp();
  const first = person.name.split(' ')[0];
  const cached = cache.get(person.id);
  const [ideas, setIdeas] = useState<GiftIdea[] | null>(cached?.ideas ?? null);
  const [busy, setBusy] = useState(!cached);
  const [error, setError] = useState('');
  const started = useRef(false);

  const pr = person.profile;
  const known = interestsOf(person).length + (pr.likes?.length ?? 0) + (pr.gifts?.length ?? 0);
  const news = pr.updates?.length ?? 0;
  const shared = workspace.entries.filter((e) => e.person_ids.includes(person.id)).length;
  const thin = known + news + shared < 2;
  const saved = new Set((pr.gifts ?? []).map((g) => normalizeText(g)));

  async function ask(more: boolean) {
    setBusy(true);
    setError('');
    const seen = cache.get(person.id)?.seen ?? [];
    try {
      const list = await giftIdeas(
        giftContext(person, workspace, turns, date),
        more ? [...seen, ...(pr.gifts ?? [])] : (pr.gifts ?? []),
      );
      cache.set(person.id, {
        ideas: list,
        seen: [...seen, ...list.map((i) => i.title)].slice(-30),
      });
      setIdeas(list);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // Una sola consulta al abrir (también en desarrollo, donde los efectos corren dos veces).
    if (cached || started.current) return;
    started.current = true;
    void ask(false);
  }, []);

  const keep = async (idea: GiftIdea) => {
    const current = workspace.people.find((p) => p.id === person.id) ?? person;
    const list = current.profile.gifts ?? [];
    if (list.some((g) => normalizeText(g) === normalizeText(idea.title))) return;
    const ok = await patchPerson(
      current,
      { profile: { ...current.profile, gifts: [...list, idea.title.slice(0, 80)] } },
      true,
    );
    if (ok) notify(`«${idea.title}» quedó en las ideas de regalo de ${first}.`);
  };

  return (
    <div className="gi-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
            <p>
              {turns !== null ? `Cumple ${turns} · ` : 'Su cumpleaños: '}
              {friendlyDate(date).toLowerCase()}
            </p>
          </div>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="gi-body" aria-busy={busy}>
          {thin && !busy && (
            <p className="gi-thin">
              Sé poco de {first}: las ideas son generales. Añade sus gustos o una novedad para
              afinarlas.
            </p>
          )}
          {busy ? (
            <>
              <div className="gi-skel" />
              <div className="gi-skel" />
              <div className="gi-skel" />
              <p className="gi-wait" aria-live="polite">
                <Sparkles size={14} /> Pensando en {first}…
              </p>
            </>
          ) : error ? (
            <div className="gi-error" role="alert">
              <p>{error}</p>
              <button type="button" className="cp-btn ghost" onClick={() => void ask(false)}>
                <RefreshCw size={15} /> Reintentar
              </button>
            </div>
          ) : (
            ideas?.map((idea, i) => {
              const k = kinds[idea.kind] ?? kinds.objeto;
              const isSaved = saved.has(normalizeText(idea.title));
              return (
                <article className="gi-card" key={idea.title} style={{ '--i': i } as CSSProperties}>
                  <span className={'gi-kind ' + k.tone} title={k.label}>
                    <k.icon size={17} />
                  </span>
                  <div className="gi-text">
                    <strong>{idea.title}</strong>
                    {idea.why && <p>{idea.why}</p>}
                    <span className="gi-meta">
                      <em>{k.label}</em>
                      <em className={'p-' + idea.price}>{prices[idea.price] ?? prices.medio}</em>
                    </span>
                  </div>
                  <button
                    type="button"
                    className={'gi-save' + (isSaved ? ' on' : '')}
                    disabled={isSaved}
                    title={
                      isSaved ? 'Ya está en sus ideas de regalo' : 'Guardar en sus ideas de regalo'
                    }
                    aria-label={
                      isSaved
                        ? `${idea.title}: ya está en sus ideas`
                        : `Guardar «${idea.title}» en sus ideas de regalo`
                    }
                    onClick={() => void keep(idea)}
                  >
                    {isSaved ? <BookmarkCheck size={17} /> : <BookmarkPlus size={17} />}
                  </button>
                </article>
              );
            })
          )}
        </div>

        <footer className="gi-foot">
          <small>
            Con {known} {known === 1 ? 'gusto' : 'gustos'}, {news}{' '}
            {news === 1 ? 'novedad' : 'novedades'} y {shared}{' '}
            {shared === 1 ? 'recuerdo juntos' : 'recuerdos juntos'}.
          </small>
          <button
            type="button"
            className="cp-btn ghost"
            disabled={busy}
            onClick={() => void ask(true)}
          >
            <RefreshCw size={15} /> Otras ideas
          </button>
        </footer>
      </div>
    </div>
  );
}
