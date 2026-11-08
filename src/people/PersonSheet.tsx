import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AtSign,
  Briefcase,
  Building2,
  Cake,
  Camera,
  Check,
  Heart,
  Home,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Plus,
  RotateCw,
  Search,
  Smile,
  Sparkles,
  Star,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { AutoTextarea, ChoiceChips, Label } from '../composer/controls';
import { DateChips } from '../composer/DateChips';
import { TagInput } from '../composer/TagInput';
import { useImageUploads } from '../composer/useImageUploads';
import type {
  Person,
  PersonFact,
  PersonInput,
  PersonProfile,
  Relation,
  Tie,
  TieKind,
} from '../data';
import type { TieInput } from '../hooks/useWorkspace';
import { addDays, initials, normalizeText, splitList, todayInputValue } from '../lib/format';
import { genderLabels, genderOf, guessGender } from '../lib/gender';
import {
  ageOf,
  cadenceOptions,
  closenessLabels,
  completeness,
  daysToBirthday,
  relationMeta,
  relations,
  searchText,
  type PersonSection,
} from '../lib/people';
import {
  ME,
  groupKinds,
  guessGroupKind,
  kindTitle,
  kindWord,
  kindsForRelation,
  relationForKind,
  surnamesOf,
  tieCategories,
  tieCategoryList,
  tieKinds,
  kindsByCategory,
  tiesOf,
} from '../lib/relations';
import { GroupPicker } from '../relations/GroupPicker';
import { Avatar } from './Avatar';

const relationIcons: Record<Relation, LucideIcon> = {
  familia: Home,
  pareja: Heart,
  amistad: Smile,
  trabajo: Briefcase,
  conocido: UserRound,
  otro: Sparkles,
};
const sections: { id: PersonSection; label: string }[] = [
  { id: 'esencia', label: 'Esencia' },
  { id: 'vinculos', label: 'Vínculos' },
  { id: 'contacto', label: 'Contacto' },
  { id: 'fechas', label: 'Fechas' },
  { id: 'vida', label: 'Vida' },
  { id: 'gustos', label: 'Gustos' },
  { id: 'historia', label: 'Historia' },
  { id: 'datos', label: 'Datos libres' },
];
const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
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
/** Días del mes (febrero admite el 29). */
const daysIn = (m: number) => (m ? new Date(2024, m, 0).getDate() : 31);
const pad = (n: number) => String(n).padStart(2, '0');
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Vínculo con otra persona en el formulario: «other» es «kind» de esta persona. */
type LinkDraft = { key: string; other: string; kind: TieKind; tieId?: string };
const defaultKind = (r?: Relation): TieKind =>
  r === 'familia'
    ? 'familiar'
    : r === 'trabajo'
      ? 'colega'
      : r === 'amistad'
        ? 'amigo'
        : 'conocido';
const factIdeas = [
  'Signo',
  'Comida favorita',
  'Alergia',
  'Talla',
  'Mascota',
  'Música',
  'Equipo',
  'Pronombres',
];

type Draft = Omit<PersonProfile, 'photo' | 'exchanges' | 'updates'> & {
  name: string;
  role: string;
  interests: string[];
  bio: string;
};

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: PersonSection;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="ps-section" data-section={id} id={'ps-' + id}>
      <h3>
        {title}
        {hint && <span>{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

function Field({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <label className="cp-pill-input">
      <Icon size={16} />
      {children}
    </label>
  );
}

/** Ficha completa de una persona: crear o editar, con todo lo que alimenta su identidad. */
export function PersonSheet({
  person,
  section,
  onSave,
  onClose,
}: {
  person?: Person;
  section?: PersonSection;
  onSave: (input: PersonInput) => Promise<Person | null>;
  onClose: () => void;
}) {
  const { confirm, workspace, saveTies, removeTies, updateGroup, saveGroup, notify, me } = useApp();
  const pr = person?.profile ?? {};
  const byId = useMemo(() => new Map(workspace.people.map((p) => [p.id, p])), [workspace.people]);

  // ── Vínculos (se guardan al guardar la ficha) ──
  const initialViews = useMemo(
    () => (person ? tiesOf(person.id, workspace.ties) : []),
    // Solo al abrir: lo que cambie después lo decide el formulario.
    [],
  );
  const meView = initialViews.find((v) => v.other === ME);
  const [meKind, setMeKind] = useState<TieKind | null>(
    meView ? tieKinds[meView.kind].inverse : null,
  );
  const [links, setLinks] = useState<LinkDraft[]>(() =>
    initialViews
      .filter((v) => v.other !== ME && byId.has(v.other))
      .map((v) => ({ key: v.tie.id, other: v.other, kind: v.kind, tieId: v.tie.id })),
  );
  const [groupSel, setGroupSel] = useState<string[]>(() =>
    person ? workspace.groups.filter((g) => g.member_ids.includes(person.id)).map((g) => g.id) : [],
  );
  // Grupos nuevos escritos en el buscador: se crean al guardar la ficha, ya con la persona dentro.
  const [newGroups, setNewGroups] = useState<string[]>([]);
  const [groupPick, setGroupPick] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [linksTouched, setLinksTouched] = useState(false);

  // ── Cumpleaños: el día y el mes se escriben libres y se guardan cuando forman una fecha válida ──
  const [bDay, setBDay] = useState(() => (pr.birthday ? String(Number(pr.birthday.slice(3))) : ''));
  const [bMonth, setBMonth] = useState(() => (pr.birthday ? Number(pr.birthday.slice(0, 2)) : 0));
  const [bYear, setBYear] = useState(() => (pr.birthYear ? String(pr.birthYear) : ''));
  const dayInput = useRef<HTMLInputElement>(null);
  const [d, setD] = useState<Draft>(() => ({
    ...pr,
    name: person?.name ?? '',
    role: person?.role ?? '',
    interests: splitList(person?.interests ?? ''),
    bio: person?.bio ?? '',
    facts: pr.facts ?? [],
  }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<PersonSection>(section ?? 'esencia');
  const photo = useImageUploads(pr.photo ? [pr.photo] : [], 1);
  const scroll = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setTouched(true);
    setD((x) => ({ ...x, [key]: value }));
  };

  const relation = d.relation;
  const meta = relation ? relationMeta[relation] : relationMeta.amistad;
  const photoItem = photo.items[0];

  // Abre en la sección pedida (p. ej. «Contacto» desde el menú de la tarjeta).
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (section && section !== 'esencia') {
        scroll.current?.querySelector('#ps-' + section)?.scrollIntoView({ block: 'start' });
      } else {
        nameInput.current?.focus({ preventScroll: true });
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [section]);

  // Índice lateral: marca la sección visible.
  useEffect(() => {
    const root = scroll.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (items) => {
        const visible = items
          .filter((i) => i.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive((visible.target as HTMLElement).dataset.section as PersonSection);
      },
      { root, rootMargin: '0px 0px -65% 0px' },
    );
    root.querySelectorAll('[data-section]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const profile = useMemo<PersonProfile>(() => {
    const { name: _n, role: _r, interests: _i, bio: _b, ...rest } = d;
    const out: Record<string, unknown> = { ...pr, ...rest };
    out.photo = photo.images[0];
    // Lo que se añade con accesos rápidos mientras el formulario está abierto no se pisa.
    out.exchanges = pr.exchanges;
    out.updates = pr.updates;
    for (const [k, v] of Object.entries(out)) {
      const val = typeof v === 'string' ? v.trim() : v;
      if (
        val === '' ||
        val === undefined ||
        val === null ||
        (Array.isArray(val) && !val.length && k !== 'exchanges')
      )
        delete out[k];
      else out[k] = val;
    }
    if (out.facts)
      out.facts = (out.facts as PersonFact[]).filter((f) => f.label.trim() && f.value.trim());
    if (!(out.facts as PersonFact[] | undefined)?.length) delete out.facts;
    // Memoria en el tiempo: si cambió su empleo, empresa o ciudad, lo anterior queda con su fecha.
    const history = [...(pr.history ?? [])];
    for (const field of ['occupation', 'company', 'city'] as const) {
      const before = (pr[field] ?? '').trim();
      const now = typeof out[field] === 'string' ? (out[field] as string) : '';
      if (before && before !== now && !history.some((h) => h.field === field && h.value === before))
        history.unshift({ field, value: before, until: todayInputValue() });
    }
    if (history.length) out.history = history.slice(0, 40);
    return out as PersonProfile;
  }, [d, pr, photo.images]);

  const preview: Person = {
    id: person?.id ?? 'nuevo',
    name: d.name || 'Persona',
    role: d.role,
    interests: d.interests.join(', '),
    bio: d.bio,
    color: meta.soft,
    created_at: '',
    profile,
  };
  const done = completeness(preview);
  const problem = !d.name.trim()
    ? 'Falta el nombre.'
    : photo.busy
      ? 'Subiendo foto…'
      : photo.hasError
        ? 'La foto no se subió.'
        : null;

  /** Aplica los vínculos y grupos del formulario: crea, cambia o quita lo necesario. */
  async function syncLinks(id: string) {
    const views = tiesOf(id, workspace.ties);
    const removals: Tie[] = [];
    const adds: TieInput[] = [];
    const mine = views.find((v) => v.other === ME);
    const meNow = mine ? tieKinds[mine.kind].inverse : null;
    if (meKind !== meNow) {
      if (mine) removals.push(mine.tie);
      if (meKind) adds.push({ a: id, b: ME, kind: meKind });
    }
    for (const v of views) {
      if (v.other === ME) continue;
      const l = links.find((x) => x.tieId === v.tie.id);
      if (!l || l.kind !== v.kind || l.other !== v.other) removals.push(v.tie);
      if (l && (l.kind !== v.kind || l.other !== v.other))
        adds.push({ a: l.other, b: id, kind: l.kind });
    }
    for (const l of links) if (!l.tieId) adds.push({ a: l.other, b: id, kind: l.kind });
    if (removals.length) await removeTies(removals, true);
    if (adds.length) await saveTies(adds, true);
    for (const g of workspace.groups) {
      const was = g.member_ids.includes(id);
      const now = groupSel.includes(g.id);
      if (was !== now)
        await updateGroup(
          g,
          { member_ids: now ? [...g.member_ids, id] : g.member_ids.filter((m) => m !== id) },
          true,
        );
    }
    for (const name of newGroups)
      await saveGroup(
        { name, kind: guessGroupKind(name), description: '', member_ids: [id] },
        true,
      );
    if (adds.length || removals.length || newGroups.length)
      notify(
        adds.length
          ? `Ficha guardada con ${adds.length} ${adds.length === 1 ? 'vínculo nuevo' : 'vínculos nuevos'}.`
          : 'Ficha y vínculos guardados.',
      );
  }

  async function submit() {
    if (problem || busy) return;
    setBusy(true);
    const saved = await onSave({
      name: d.name.trim().slice(0, 120),
      role: d.role.trim(),
      interests: d.interests.join(', '),
      bio: d.bio.trim(),
      profile,
    });
    if (saved) await syncLinks(saved.id);
    setBusy(false);
    if (saved) onClose();
  }

  const requestClose = async () => {
    if (touched || linksTouched || photo.touched) {
      const ok = await confirm({
        title: '¿Descartar los cambios?',
        message: 'Lo que no hayas guardado de esta ficha se perderá.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir editando',
        danger: true,
        icon: 'warning',
      });
      if (!ok) return;
    }
    onClose();
  };

  const facts = d.facts ?? [];
  const setFact = (i: number, patch: Partial<PersonFact>) =>
    set(
      'facts',
      facts.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    );
  const commitBirthday = (day: string, month: number) => {
    const n = Number(day);
    set('birthday', n >= 1 && month && n <= daysIn(month) ? `${pad(month)}-${pad(n)}` : undefined);
  };
  const dayTooBig = Number(bDay) > daysIn(bMonth);
  const today = todayInputValue();
  const nextIn = daysToBirthday(preview, today);
  const turns = nextIn !== null ? ageOf(preview, addDays(today, nextIn)) : null;

  // ── Vínculos: ayudas para elegir ──
  const first = d.name.trim().split(' ')[0] || 'esta persona';
  /** Sexo indicado o deducido del nombre y del rol. */
  const sex = d.gender ?? guessGender(d.name, d.role);
  const relKinds = relation ? kindsForRelation(relation) : [];
  const pickMeKind = (k: TieKind) => {
    setLinksTouched(true);
    if (meKind === k) return setMeKind(null);
    setMeKind(k);
    const r = relationForKind(k);
    if (r !== relation) set('relation', r);
  };
  const addLink = (other: string, kind: TieKind = defaultKind(relation)) => {
    setLinksTouched(true);
    setLinks((l) =>
      l.some((x) => x.other === other) ? l : [...l, { key: crypto.randomUUID(), other, kind }],
    );
  };
  const myKindOf = (id: string) => {
    const v = tiesOf(ME, workspace.ties).find((x) => x.other === id);
    return v ? v.kind : null;
  };
  const sur = surnamesOf(d.name);
  const kin = sur.length
    ? workspace.people
        .filter(
          (p) =>
            p.id !== person?.id &&
            !links.some((l) => l.other === p.id) &&
            surnamesOf(p.name).some((s) => sur.includes(s)),
        )
        .slice(0, 6)
    : [];
  // Con un parentesco contigo, el de tu familia se deduce solo: no hace falta vincularlos a mano.
  const meFamily = meKind !== null && tieKinds[meKind].category === 'familia';
  const covered = meFamily
    ? kin.filter((p) => {
        const k = myKindOf(p.id);
        return k !== null && tieKinds[k].category === 'familia';
      })
    : [];
  const kinChips = kin.filter((p) => !covered.includes(p));
  // Si comparte apellido con alguien de tu familia, propone el mismo parentesco contigo.
  const familyHint = !meKind
    ? kin
        .map((p) => ({ p, k: myKindOf(p.id) }))
        .find((x) => x.k && tieKinds[x.k].category === 'familia')
    : undefined;
  // Comparte tus apellidos (los de «Mi ficha»): quizá es de tu familia.
  const mySurnames = surnamesOf(me.profile.name ?? '');
  const sharesMine =
    !meKind && !familyHint && relation !== 'familia'
      ? sur.filter((s) => mySurnames.includes(s))
      : [];
  const sharedLabel = sharesMine
    .map((s) => d.name.split(/\s+/).find((w) => normalizeText(w) === s) ?? s)
    .join(' ');

  // ── Grupos: elegir varios en una ventana; sugeridos los de su gente ──
  const toggleGroup = (id: string) => {
    setLinksTouched(true);
    setGroupSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const dropNewGroup = (name: string) => {
    setLinksTouched(true);
    setNewGroups((list) => list.filter((n) => n !== name));
  };
  const near = new Set([...links.map((l) => l.other), ...kin.map((p) => p.id)]);
  const fits: Partial<Record<string, string>> = {
    familia: 'familia',
    trabajo: 'trabajo',
    amistad: 'amigos',
  };
  const groupHints = workspace.groups
    .filter(
      (g) =>
        !groupSel.includes(g.id) &&
        (g.member_ids.some((m) => near.has(m)) || (relation && fits[relation] === g.kind)),
    )
    .map((g) => g.id);

  const needle = normalizeText(linkQuery.trim());
  const linkResults = needle
    ? workspace.people
        .filter(
          (p) =>
            p.id !== person?.id &&
            !links.some((l) => l.other === p.id) &&
            searchText(p).includes(needle),
        )
        .slice(0, 6)
    : [];

  return (
    <Sheet
      label={person ? 'Editar persona' : 'Nueva persona'}
      size="lg"
      onRequestClose={requestClose}
    >
      <form
        className="cp-composer ps"
        style={{ '--accent': meta.color, '--soft': meta.soft, '--ink': meta.ink } as CSSProperties}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault();
          }
        }}
      >
        <header className="cp-head">
          <span className="cp-kind-chip static">
            <Users size={17} />
            <strong>{person ? 'Editar ficha' : 'Nueva persona'}</strong>
          </span>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={requestClose}>
            <X size={20} />
          </button>
        </header>

        <div className="ps-body">
          <nav className="ps-index" aria-label="Secciones">
            <div className="ps-progress" style={{ '--p': done.percent } as CSSProperties}>
              <span>{done.percent}%</span>
              <small>ficha completa</small>
            </div>
            {sections.map((s) => (
              <button
                type="button"
                key={s.id}
                className={active === s.id ? 'on' : ''}
                onClick={() =>
                  scroll.current
                    ?.querySelector('#ps-' + s.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="cp-scroll ps-scroll" ref={scroll}>
            {/* ── Esencia ── */}
            <section className="ps-hero" data-section="esencia" id="ps-esencia">
              <label className={'ps-photo' + (photoItem ? ' filled' : '')} title="Foto">
                <input
                  type="file"
                  accept="image/*"
                  className="cp-sr"
                  onChange={(e) => {
                    const f = Array.from(e.target.files ?? []).slice(0, 1);
                    e.target.value = '';
                    photo.add(f, true);
                  }}
                />
                {photoItem ? (
                  <img src={photoItem.preview} alt="" />
                ) : (
                  <span>{initials(d.name || '?').toUpperCase()}</span>
                )}
                <i className="ps-photo-badge">
                  {photoItem?.status === 'uploading' ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Camera size={14} />
                  )}
                </i>
              </label>
              <div className="ps-hero-main">
                <input
                  ref={nameInput}
                  className="cp-title-input"
                  placeholder="Nombre completo"
                  maxLength={120}
                  value={d.name}
                  onChange={(e) => set('name', e.target.value)}
                  aria-label="Nombre completo"
                />
                <div className="ps-hero-row">
                  <input
                    className="ps-inline"
                    placeholder="Apodo o como le dices"
                    maxLength={60}
                    value={d.alias ?? ''}
                    onChange={(e) => set('alias', e.target.value)}
                    aria-label="Apodo"
                  />
                  <button
                    type="button"
                    className={'ps-fav' + (d.favorite ? ' on' : '')}
                    aria-pressed={Boolean(d.favorite)}
                    onClick={() => set('favorite', !d.favorite)}
                  >
                    <Star size={15} /> {d.favorite ? 'En favoritos' : 'Favorita'}
                  </button>
                </div>
                <div className="ps-gender" role="radiogroup" aria-label="Sexo">
                  {(['f', 'm'] as const).map((g) => (
                    <button
                      type="button"
                      role="radio"
                      key={g}
                      aria-checked={sex === g}
                      className={(sex === g ? 'on' : '') + (sex === g && !d.gender ? ' guess' : '')}
                      onClick={() => set('gender', d.gender === g ? undefined : g)}
                    >
                      {genderLabels[g]}
                    </button>
                  ))}
                  <small>
                    {d.gender
                      ? 'Para decir «madre» o «padre», «tía» o «tío»…'
                      : sex
                        ? 'Deducido del nombre · tócalo para confirmarlo o cambiarlo'
                        : 'Elige para que los vínculos se escriban bien'}
                  </small>
                </div>
                {photoItem?.status === 'error' && (
                  <button
                    type="button"
                    className="cp-cover-retry"
                    onClick={() => photo.retry(photoItem.id)}
                  >
                    <RotateCw size={14} /> Reintentar foto
                  </button>
                )}
                {photoItem && (
                  <button
                    type="button"
                    className="ps-link"
                    onClick={() => photo.remove(photoItem.id)}
                  >
                    Quitar foto
                  </button>
                )}
              </div>
            </section>

            <Label>¿Qué es para ti?</Label>
            <div className="ps-relations" role="radiogroup" aria-label="Tipo de relación">
              {relations.map((r) => {
                const Icon = relationIcons[r];
                const m = relationMeta[r];
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={relation === r}
                    key={r}
                    className={relation === r ? 'on' : ''}
                    style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
                    onClick={() => {
                      set('relation', relation === r ? undefined : r);
                      // Si el vínculo contigo ya no encaja con la relación, se descarta.
                      if (meKind && relationForKind(meKind) !== r) setMeKind(null);
                    }}
                  >
                    <Icon size={20} />
                    {m.label}
                  </button>
                );
              })}
            </div>
            {relKinds.length > 1 && (
              <div className="ps-mekind" role="radiogroup" aria-label={`Qué es ${first} para ti`}>
                <span>{capital(first)} es tu…</span>
                {relKinds.map((k) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={meKind === k}
                    key={k}
                    className={'cp-chip' + (meKind === k ? ' on' : '')}
                    onClick={() => pickMeKind(k)}
                  >
                    {kindTitle(k, sex)}
                  </button>
                ))}
              </div>
            )}
            {familyHint && (
              <button
                type="button"
                className="ps-hint-chip"
                onClick={() => pickMeKind(familyHint.k!)}
              >
                <Sparkles size={14} /> Comparte apellido con {familyHint.p.name}, tu{' '}
                {kindWord(familyHint.k!, genderOf(familyHint.p))}. ¿También es tu{' '}
                {kindWord(familyHint.k!, sex)}?
              </button>
            )}
            {sharesMine.length > 0 && (
              <button
                type="button"
                className="ps-hint-chip"
                onClick={() => set('relation', 'familia')}
              >
                <Sparkles size={14} /> Comparte tu
                {sharesMine.length > 1 ? 's apellidos' : ' apellido'} {sharedLabel}. ¿Es de tu
                familia?
              </button>
            )}
            <input
              className="cp-ghost-input ps-gap"
              placeholder={
                relation === 'familia'
                  ? 'Parentesco: hermana, tío, abuela…'
                  : relation === 'trabajo'
                    ? 'Rol: jefe, cliente, colega…'
                    : 'Contexto: amiga del colegio, vecino…'
              }
              maxLength={120}
              value={d.role}
              onChange={(e) => set('role', e.target.value)}
              aria-label="Contexto o rol"
            />

            <Label hint="Cómo la recuerdas · también le dan contexto a la IA">Palabras clave</Label>
            <TagInput
              tags={d.keywords ?? []}
              onChange={(v) => set('keywords', v)}
              max={20}
              placeholder="La del café, voleibol, Medellín, me ayudó con la mudanza…"
            />

            <Label hint="Qué tan cerca está de ti">Cercanía</Label>
            <div className="ps-orbit" role="radiogroup" aria-label="Cercanía">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={d.closeness === n}
                  key={n}
                  className={(d.closeness ?? 0) >= n ? 'on' : ''}
                  onClick={() => set('closeness', d.closeness === n ? undefined : n)}
                >
                  <i style={{ '--n': n } as CSSProperties} />
                  <span>{closenessLabels[n]}</span>
                </button>
              ))}
            </div>

            {person && (
              <>
                <Label>Estado de la relación</Label>
                <ChoiceChips
                  label="Estado de la relación"
                  options={[
                    { value: 'activa', label: 'Activa' },
                    { value: 'distante', label: 'Ya no en contacto' },
                    { value: 'memoria', label: 'En memoria' },
                  ]}
                  value={d.status ?? 'activa'}
                  onChange={(v) => set('status', v === 'activa' || !v ? undefined : v)}
                />
              </>
            )}

            {!d.status && (
              <>
                <Label hint="Te avisaremos si pasa más tiempo">¿Cada cuánto quieres hablar?</Label>
                <ChoiceChips
                  label="Meta de contacto"
                  options={cadenceOptions.map((c) => ({
                    value: String(c.value),
                    label: c.label,
                  }))}
                  value={d.cadence === undefined ? undefined : String(d.cadence)}
                  clearable
                  onChange={(v) => set('cadence', v === undefined ? undefined : Number(v))}
                />
              </>
            )}

            {/* ── Vínculos ── */}
            <Section
              id="vinculos"
              title="Vínculos"
              hint="Con quién más está conectada · los parentescos se deducen solos"
            >
              {covered.length > 0 && (
                <p className="ps-covered">
                  <Sparkles size={13} /> Nexo deducirá su parentesco con{' '}
                  {covered
                    .slice(0, 3)
                    .map((p) => p.name.split(' ')[0])
                    .join(', ')}
                  {covered.length > 3 && ` y ${covered.length - 3} más`} (tu familia).
                </p>
              )}
              {kinChips.length > 0 && (
                <div className="ps-kin">
                  <span>
                    <Sparkles size={13} /> Comparte apellido con
                  </span>
                  {kinChips.map((p) => {
                    const k = myKindOf(p.id);
                    return (
                      <button
                        type="button"
                        key={p.id}
                        className="cp-chip"
                        onClick={() =>
                          addLink(p.id, surnamesOf(p.name).length > 1 ? 'hermano' : 'familiar')
                        }
                      >
                        <Avatar person={p} size={20} /> {p.name.split(' ')[0]}
                        {k && <small> · tu {kindWord(k, genderOf(p))}</small>} <Plus size={12} />
                      </button>
                    );
                  })}
                </div>
              )}
              {links.length > 0 && (
                <div className="ps-links">
                  {links.map((l) => {
                    const p = byId.get(l.other);
                    if (!p) return null;
                    const cat = tieCategories[tieKinds[l.kind].category];
                    return (
                      <div
                        className="ps-link-row"
                        key={l.key}
                        style={{ '--c': cat.color, '--s': cat.soft } as CSSProperties}
                      >
                        <Avatar person={p} size={30} />
                        <strong>{p.name}</strong>
                        <span>es</span>
                        <select
                          value={l.kind}
                          aria-label={`Qué es ${p.name} de ${first}`}
                          onChange={(e) => {
                            setLinksTouched(true);
                            const kind = e.target.value as TieKind;
                            setLinks((all) =>
                              all.map((x) => (x.key === l.key ? { ...x, kind } : x)),
                            );
                          }}
                        >
                          {tieCategoryList.map((c) => (
                            <optgroup key={c} label={tieCategories[c].label}>
                              {kindsByCategory(c).map((k) => (
                                <option key={k} value={k}>
                                  {kindWord(k, genderOf(p))}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <span>de {first}</span>
                        <button
                          type="button"
                          aria-label={`Quitar vínculo con ${p.name}`}
                          onClick={() => {
                            setLinksTouched(true);
                            setLinks((all) => all.filter((x) => x.key !== l.key));
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="ps-link-search">
                <label className="cp-pill-input">
                  <Search size={16} />
                  <input
                    placeholder="Vincular con alguien: su mamá, su jefe, su mejor amiga…"
                    value={linkQuery}
                    onChange={(e) => setLinkQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && linkResults[0]) {
                        addLink(linkResults[0].id);
                        setLinkQuery('');
                      }
                    }}
                    aria-label="Buscar persona para vincular"
                  />
                </label>
                {linkResults.length > 0 && (
                  <div className="ps-link-results">
                    {linkResults.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => {
                          addLink(p.id);
                          setLinkQuery('');
                        }}
                      >
                        <Avatar person={p} size={26} /> {p.name}
                        <Plus size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Label hint="Iglesia, trabajo, la familia Gómez…">Grupos</Label>
              <div className="ps-groups">
                {workspace.groups
                  .filter((g) => groupSel.includes(g.id))
                  .map((g) => {
                    const m = groupKinds[g.kind] ?? groupKinds.otro;
                    return (
                      <span
                        className="ps-group"
                        key={g.id}
                        style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
                      >
                        <m.icon size={13} /> {g.name}
                        <button
                          type="button"
                          aria-label={`Quitar del grupo ${g.name}`}
                          onClick={() => toggleGroup(g.id)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })}
                {newGroups.map((name) => {
                  const m = groupKinds[guessGroupKind(name)];
                  return (
                    <span
                      className="ps-group"
                      key={'new:' + name}
                      style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
                    >
                      <m.icon size={13} /> {name} <em>nuevo</em>
                      <button
                        type="button"
                        aria-label={`No crear el grupo ${name}`}
                        onClick={() => dropNewGroup(name)}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  className="ps-group-add"
                  aria-haspopup="dialog"
                  onClick={() => setGroupPick(true)}
                >
                  <Plus size={14} />
                  {groupSel.length || newGroups.length ? 'Añadir' : 'Añadir a un grupo'}
                </button>
              </div>
              {groupPick && (
                <GroupPicker
                  title={`Grupos de ${first}`}
                  hint="Elige varios o escribe uno nuevo"
                  selected={groupSel}
                  suggested={groupHints}
                  pending={newGroups}
                  onToggle={toggleGroup}
                  onCreate={(name) => {
                    setLinksTouched(true);
                    setNewGroups((list) =>
                      list.some((n) => normalizeText(n) === normalizeText(name))
                        ? list
                        : [...list, name],
                    );
                  }}
                  onRemovePending={dropNewGroup}
                  onClose={() => setGroupPick(false)}
                />
              )}
            </Section>

            {/* ── Contacto ── */}
            <Section id="contacto" title="Contacto" hint="Accesos directos para llamar o escribir">
              <div className="cp-two">
                <Field icon={Phone}>
                  <input
                    inputMode="tel"
                    placeholder="Teléfono"
                    maxLength={30}
                    value={d.phone ?? ''}
                    onChange={(e) => set('phone', e.target.value)}
                  />
                </Field>
                <Field icon={Mail}>
                  <input
                    type="email"
                    placeholder="Correo"
                    maxLength={120}
                    value={d.email ?? ''}
                    onChange={(e) => set('email', e.target.value)}
                  />
                </Field>
                <Field icon={AtSign}>
                  <input
                    placeholder="Red social (@usuario)"
                    maxLength={80}
                    value={d.social ?? ''}
                    onChange={(e) => set('social', e.target.value)}
                  />
                </Field>
                <Field icon={MapPin}>
                  <input
                    placeholder="Ciudad"
                    maxLength={80}
                    value={d.city ?? ''}
                    onChange={(e) => set('city', e.target.value)}
                  />
                </Field>
              </div>
            </Section>

            {/* ── Fechas ── */}
            <Section id="fechas" title="Fechas que importan">
              <Label hint="Día, mes y, si lo sabes, el año">Cumpleaños</Label>
              <div className="ps-bday">
                <div className="ps-bday-fields">
                  <label className={'ps-bday-box' + (dayTooBig ? ' bad' : '')}>
                    <small>Día</small>
                    <input
                      ref={dayInput}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="15"
                      value={bDay}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                        setBDay(v);
                        commitBirthday(v, bMonth);
                      }}
                      onBlur={() => {
                        if (dayTooBig) {
                          const v = String(daysIn(bMonth));
                          setBDay(v);
                          commitBirthday(v, bMonth);
                        }
                      }}
                      aria-label="Día de cumpleaños"
                    />
                  </label>
                  <label className="ps-bday-box year">
                    <small>Año</small>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="1990"
                      value={bYear}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                        const y = Number(v);
                        setBYear(v);
                        set(
                          'birthYear',
                          v.length === 4 && y >= 1900 && y <= Number(today.slice(0, 4))
                            ? y
                            : undefined,
                        );
                      }}
                      aria-label="Año de nacimiento (opcional)"
                    />
                  </label>
                  <span className="ps-bday-preview" aria-live="polite">
                    <Cake size={16} />
                    {d.birthday ? (
                      <>
                        <b>
                          {Number(d.birthday.slice(3))} de{' '}
                          {monthNames[Number(d.birthday.slice(0, 2)) - 1]}
                        </b>
                        {nextIn === 0
                          ? ' · ¡es hoy!'
                          : nextIn !== null &&
                            ` · faltan ${nextIn} ${nextIn === 1 ? 'día' : 'días'}`}
                        {turns !== null && ` · cumplirá ${turns}`}
                      </>
                    ) : dayTooBig ? (
                      `${capital(monthNames[bMonth - 1])} tiene ${daysIn(bMonth)} días`
                    ) : bDay && !bMonth ? (
                      'Ahora elige el mes'
                    ) : bMonth && !bDay ? (
                      'Escribe el día'
                    ) : (
                      'Sin fecha'
                    )}
                  </span>
                  {(bDay || bMonth || bYear) && (
                    <button
                      type="button"
                      className="ps-link"
                      onClick={() => {
                        setBDay('');
                        setBMonth(0);
                        setBYear('');
                        set('birthday', undefined);
                        set('birthYear', undefined);
                      }}
                    >
                      Borrar
                    </button>
                  )}
                </div>
                <div className="ps-months" role="radiogroup" aria-label="Mes">
                  {months.map((m, i) => (
                    <button
                      type="button"
                      key={m}
                      role="radio"
                      aria-checked={bMonth === i + 1}
                      className={bMonth === i + 1 ? 'on' : ''}
                      onClick={() => {
                        const next = bMonth === i + 1 ? 0 : i + 1;
                        setBMonth(next);
                        commitBirthday(bDay, next);
                        if (next && !bDay) dayInput.current?.focus();
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <Label>¿Cuándo se conocieron?</Label>
              <DateChips
                label="Cuándo se conocieron"
                options={['none']}
                value={d.metOn ?? ''}
                onChange={(v) => set('metOn', v || undefined)}
              />
              <input
                className="cp-ghost-input ps-gap"
                placeholder="Cómo se conocieron: en la universidad, por Ana, en un viaje…"
                maxLength={200}
                value={d.metHow ?? ''}
                onChange={(e) => set('metHow', e.target.value)}
              />
            </Section>

            {/* ── Vida ── */}
            <Section id="vida" title="Su vida">
              <div className="cp-two">
                <Field icon={Briefcase}>
                  <input
                    placeholder="Ocupación"
                    maxLength={80}
                    value={d.occupation ?? ''}
                    onChange={(e) => set('occupation', e.target.value)}
                  />
                </Field>
                <Field icon={Building2}>
                  <input
                    placeholder="Empresa o lugar"
                    maxLength={80}
                    value={d.company ?? ''}
                    onChange={(e) => set('company', e.target.value)}
                  />
                </Field>
              </div>
              <input
                className="cp-ghost-input ps-gap"
                placeholder="Su gente: pareja, hijos, mascotas…"
                maxLength={200}
                value={d.family ?? ''}
                onChange={(e) => set('family', e.target.value)}
              />
            </Section>

            {/* ── Gustos ── */}
            <Section id="gustos" title="Gustos" hint="Enter o coma para añadir">
              <Label>Intereses</Label>
              <TagInput
                tags={d.interests}
                onChange={(v) => set('interests', v)}
                placeholder="Cine, viajes, tecnología…"
              />
              <Label>Le encanta</Label>
              <TagInput
                tags={d.likes ?? []}
                onChange={(v) => set('likes', v)}
                placeholder="Café negro, el mar…"
              />
              <Label>No le gusta</Label>
              <TagInput
                tags={d.dislikes ?? []}
                onChange={(v) => set('dislikes', v)}
                placeholder="Cilantro, el ruido…"
              />
              <Label>Ideas de regalo</Label>
              <TagInput
                tags={d.gifts ?? []}
                onChange={(v) => set('gifts', v)}
                placeholder="Un libro de Murakami…"
              />
            </Section>

            {/* ── Historia ── */}
            <Section id="historia" title="Su historia">
              <AutoTextarea
                className="cp-soft-area"
                minRows={4}
                placeholder="Lo que quieres recordar: cómo es, qué han vivido, qué le importa…"
                value={d.bio}
                onChange={(e) => set('bio', e.target.value)}
              />
            </Section>

            {/* ── Datos libres ── */}
            <Section
              id="datos"
              title="Datos libres"
              hint="Cualquier cosa que alimente su identidad"
            >
              <div className="ps-facts">
                {facts.map((f, i) => (
                  <div className="ps-fact" key={f.id}>
                    <input
                      placeholder="Qué"
                      maxLength={60}
                      value={f.label}
                      onChange={(e) => setFact(i, { label: e.target.value })}
                    />
                    <input
                      placeholder="Valor"
                      maxLength={300}
                      value={f.value}
                      onChange={(e) => setFact(i, { value: e.target.value })}
                    />
                    <button
                      type="button"
                      aria-label="Quitar dato"
                      onClick={() =>
                        set(
                          'facts',
                          facts.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="cp-chips ps-gap">
                {factIdeas
                  .filter((idea) => !facts.some((f) => f.label === idea))
                  .map((idea) => (
                    <button
                      type="button"
                      key={idea}
                      className="cp-chip"
                      onClick={() =>
                        set('facts', [
                          ...facts,
                          { id: crypto.randomUUID(), label: idea, value: '' },
                        ])
                      }
                    >
                      <Plus size={13} /> {idea}
                    </button>
                  ))}
                <button
                  type="button"
                  className="cp-chip"
                  onClick={() =>
                    set('facts', [...facts, { id: crypto.randomUUID(), label: '', value: '' }])
                  }
                >
                  <Plus size={13} /> Otro dato
                </button>
              </div>
            </Section>
          </div>
        </div>

        <footer className="cp-foot">
          <span className={'cp-status' + (problem ? ' problem' : '')} role="status">
            {problem ?? 'Ctrl + Enter para guardar'}
          </span>
          <button type="button" className="cp-btn ghost" onClick={requestClose}>
            Cancelar
          </button>
          <button className="cp-btn cta" disabled={Boolean(problem) || busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
            {person ? 'Guardar ficha' : 'Crear persona'}
          </button>
        </footer>
      </form>
    </Sheet>
  );
}
