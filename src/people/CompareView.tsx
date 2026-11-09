import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Building2,
  ChevronDown,
  GitCompareArrows,
  Handshake,
  Heart,
  MapPin,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Entry, Kind, Person } from '../data';
import { useDismiss } from '../hooks/useDismiss';
import { normalizeText, splitList, todayInputValue } from '../lib/format';
import { isAt, placeKinds } from '../lib/places';
import { isInteraction, relationMeta, relationOf, relativeDay, statsFor } from '../lib/people';
import { Avatar } from './Avatar';
import { BondRing } from './PersonPanel';
import './compare.css';

/** Tipos que dicen algo de lo vivido con cada persona (sin pendientes ni movimientos). */
const comparedKinds: Kind[] = ['Encuentro', 'Nota', 'Trabajo', 'Aprendizaje', 'Libro', 'Película'];

const firstName = (p: Person) => p.name.split(' ')[0];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Intereses y gustos declarados, sin repetir y con su forma original. */
function tastesOf(p: Person) {
  const out = new Map<string, string>();
  for (const s of [...splitList(p.interests), ...(p.profile.likes ?? [])]) {
    const key = normalizeText(s.trim());
    if (key && !out.has(key)) out.set(key, s.trim());
  }
  return out;
}

/** Selector de una persona con búsqueda: más cómodo que un desplegable con cientos de nombres. */
function PersonSlot({
  person,
  people,
  exclude,
  side,
  onPick,
}: {
  person: Person | null;
  people: Person[];
  exclude: string | null;
  side: 'a' | 'b';
  onPick: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  useDismiss(open, ref, close);
  const q = normalizeText(query.trim());
  const options = people
    .filter((p) => p.id !== exclude && (!q || normalizeText(p.name).includes(q)))
    .slice(0, 40);
  const meta = person ? relationMeta[relationOf(person)] : null;

  return (
    <div className={'cmp-slot ' + side + (person ? ' filled' : '')} ref={ref}>
      <button
        type="button"
        className="cmp-slot-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={meta ? ({ '--accent': meta.color, '--soft': meta.soft } as CSSProperties) : {}}
      >
        {person ? (
          <Avatar person={person} size={46} />
        ) : (
          <span className="cmp-slot-empty">
            <Users size={18} />
          </span>
        )}
        <span className="cmp-slot-text">
          <strong>{person ? person.name : 'Elige a alguien'}</strong>
          <small>
            {person
              ? [meta?.label, person.role].filter(Boolean).join(' · ')
              : side === 'a'
                ? 'Primera persona'
                : 'Segunda persona'}
          </small>
        </span>
        <ChevronDown size={16} className="cmp-slot-chev" />
      </button>
      {person && (
        <button
          type="button"
          className="cmp-slot-clear"
          aria-label={`Quitar a ${person.name}`}
          onClick={() => onPick(null)}
        >
          <X size={13} />
        </button>
      )}
      {open && (
        <div className="cmp-pop" role="listbox">
          <label className="cmp-pop-search">
            <Search size={15} />
            <input
              autoFocus
              value={query}
              placeholder="Buscar persona…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="cmp-pop-list">
            {options.length ? (
              options.map((p) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === person?.id}
                  key={p.id}
                  className={p.id === person?.id ? 'on' : ''}
                  onClick={() => {
                    onPick(p.id);
                    close();
                  }}
                >
                  <Avatar person={p} size={30} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{relationMeta[relationOf(p)].label}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="cmp-pop-none">Nadie coincide con «{query}».</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Resumen de una de las dos personas: relación, cercanía y última vez. */
function Side({ person, entries }: { person: Person; entries: Entry[] }) {
  const { workspace, go } = useApp();
  const stats = useMemo(() => statsFor(person, workspace.entries), [person, workspace.entries]);
  const meta = relationMeta[relationOf(person)];
  const n = entries.filter((e) => e.person_ids.includes(person.id) && isInteraction(e)).length;
  return (
    <section
      className="cmp-side"
      style={
        {
          '--accent': meta.color,
          '--soft': meta.soft,
          '--ink': meta.ink,
        } as CSSProperties
      }
    >
      <div className="cmp-side-head">
        <Avatar person={person} size={56} />
        <div>
          <strong>{person.name}</strong>
          <span>
            {meta.label}
            {person.role ? ` · ${person.role}` : ''}
          </span>
        </div>
      </div>
      <div className="cmp-side-stats">
        <BondRing value={stats.bond} size={40} />
        <div>
          <b>{n}</b>
          <span>momentos en el periodo</span>
        </div>
        <div>
          <b>{relativeDay(stats.last)}</b>
          <span>última vez</span>
        </div>
      </div>
      <button type="button" className="cmp-side-link" onClick={() => go('Personas', person)}>
        Ver ficha <ArrowRight size={13} />
      </button>
    </section>
  );
}

/** Compara a dos personas con lo que has registrado de cada una, sin puntuarlas. */
export function CompareView({ entries }: { entries: Entry[] }) {
  const { workspace, viewEntry } = useApp();
  const [ids, setIds] = useState<[string | null, string | null]>([null, null]);
  const a = workspace.people.find((p) => p.id === ids[0]) ?? null;
  const b = workspace.people.find((p) => p.id === ids[1]) ?? null;

  // Personas ordenadas por cuántos momentos compartes con ellas: las de siempre, arriba.
  const people = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of workspace.entries)
      if (isInteraction(e)) for (const id of e.person_ids) n.set(id, (n.get(id) ?? 0) + 1);
    return [...workspace.people].sort(
      (x, y) => (n.get(y.id) ?? 0) - (n.get(x.id) ?? 0) || x.name.localeCompare(y.name),
    );
  }, [workspace.people, workspace.entries]);

  // Parejas que más aparecen juntas en el periodo: atajos para empezar.
  const pairs = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      if (!isInteraction(e)) continue;
      const list = [...new Set(e.person_ids)].sort();
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const k = list[i] + '|' + list[j];
          m.set(k, (m.get(k) ?? 0) + 1);
        }
    }
    return [...m.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 4)
      .flatMap(([k, n]) => {
        const [x, y] = k.split('|').map((id) => workspace.people.find((p) => p.id === id));
        return x && y ? [{ a: x, b: y, n }] : [];
      });
  }, [entries, workspace.people]);

  const result = useMemo(() => {
    if (!a || !b) return null;
    const of = (p: Person) =>
      entries.filter((e) => e.person_ids.includes(p.id) && isInteraction(e));
    const ea = of(a);
    const eb = of(b);
    const together = ea
      .filter((e) => e.person_ids.includes(b.id))
      .sort((x, y) => y.created_at.localeCompare(x.created_at));
    const kinds = comparedKinds
      .map((k) => ({
        kind: k,
        a: ea.filter((e) => e.kind === k).length,
        b: eb.filter((e) => e.kind === k).length,
      }))
      .filter((k) => k.a + k.b > 0);
    const maxKind = Math.max(1, ...kinds.flatMap((k) => [k.a, k.b]));

    const ta = tastesOf(a);
    const tb = tastesOf(b);
    const tastes = [...ta.entries()].filter(([k]) => tb.has(k)).map(([, v]) => v);

    // Coincidencias de contexto que ya registraste en sus fichas.
    const same: { icon: typeof MapPin; text: string }[] = [];
    const eq = (x?: string, y?: string) =>
      !!x?.trim() && !!y?.trim() && normalizeText(x.trim()) === normalizeText(y.trim());
    if (eq(a.profile.city, b.profile.city))
      same.push({ icon: MapPin, text: `Viven en ${a.profile.city}` });
    if (eq(a.profile.company, b.profile.company))
      same.push({ icon: Building2, text: `Trabajan en ${a.profile.company}` });
    else if (eq(a.profile.occupation, b.profile.occupation))
      same.push({
        icon: Building2,
        text: `Se dedican a ${a.profile.occupation}`,
      });
    if (relationOf(a) === relationOf(b))
      same.push({
        icon: Heart,
        text: `Mismo vínculo contigo: ${relationMeta[relationOf(a)].label}`,
      });

    // Personas que aparecen con ambas (sin contarlas a ellas).
    const companions = (list: Entry[], skip: string[]) => {
      const m = new Map<string, number>();
      for (const e of list)
        for (const id of e.person_ids) if (!skip.includes(id)) m.set(id, (m.get(id) ?? 0) + 1);
      return m;
    };
    const ca = companions(ea, [a.id, b.id]);
    const cb = companions(eb, [a.id, b.id]);
    const mutual = [...ca.entries()]
      .filter(([id]) => cb.has(id))
      .map(([id, n]) => ({ id, n: Math.min(n, cb.get(id)!) }))
      .sort((x, y) => y.n - x.n)
      .flatMap(({ id }) => workspace.people.find((p) => p.id === id) ?? []);

    const places = workspace.places
      .map((pl) => ({
        place: pl,
        a: ea.filter((e) => isAt(e, pl)).length,
        b: eb.filter((e) => isAt(e, pl)).length,
      }))
      .filter((x) => x.a > 0 && x.b > 0)
      .sort((x, y) => y.a + y.b - (x.a + x.b));

    return { ea, eb, together, kinds, maxKind, tastes, same, mutual, places };
  }, [a, b, entries, workspace.people, workspace.places]);

  if (workspace.people.length < 2) {
    return (
      <div className="wr-empty">
        <GitCompareArrows size={28} />
        <h3>Necesitas al menos dos personas para comparar.</h3>
        <p>Agrega personas a tus recuerdos y vuelve aquí.</p>
      </div>
    );
  }

  return (
    <div className="cmp">
      <div className="cmp-pickers">
        <PersonSlot
          side="a"
          person={a}
          people={people}
          exclude={ids[1]}
          onPick={(id) => setIds([id, ids[1]])}
        />
        <button
          type="button"
          className="cmp-swap"
          aria-label="Intercambiar"
          title="Intercambiar"
          disabled={!a && !b}
          onClick={() => setIds([ids[1], ids[0]])}
        >
          <ArrowLeftRight size={16} />
        </button>
        <PersonSlot
          side="b"
          person={b}
          people={people}
          exclude={ids[0]}
          onPick={(id) => setIds([ids[0], id])}
        />
      </div>

      {!a || !b || !result ? (
        <div className="cmp-start">
          <GitCompareArrows size={26} />
          <h3>Dos historias, otra perspectiva.</h3>
          <p>
            Elige dos personas para ver qué comparten: momentos juntos, gente y lugares en común,
            gustos parecidos. Los vacíos de información no son diferencias personales.
          </p>
          {pairs.length > 0 && (
            <div className="cmp-pairs">
              <span>Suelen aparecer juntas</span>
              <div>
                {pairs.map((p) => (
                  <button
                    type="button"
                    key={p.a.id + p.b.id}
                    onClick={() => setIds([p.a.id, p.b.id])}
                  >
                    <span className="cmp-duo">
                      <Avatar person={p.a} size={28} />
                      <Avatar person={p.b} size={28} />
                    </span>
                    <span className="cmp-pair-names">
                      {firstName(p.a)} y {firstName(p.b)}
                    </span>
                    <em>{p.n}</em>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="cmp-result" key={a.id + b.id}>
          <div className="cmp-sides">
            <Side person={a} entries={entries} />
            <div className="cmp-bridge">
              <span className="cmp-bridge-n">{result.together.length}</span>
              <span>
                {result.together.length === 1 ? 'recuerdo compartido' : 'recuerdos compartidos'}
              </span>
            </div>
            <Side person={b} entries={entries} />
          </div>

          <div className="cmp-grid">
            <section className="cmp-card wide">
              <span className="wr-eyebrow">Lo vivido con cada una</span>
              {result.kinds.length ? (
                <div className="cmp-bars">
                  <div className="cmp-bars-head">
                    <span>{firstName(a)}</span>
                    <span />
                    <span>{firstName(b)}</span>
                  </div>
                  {result.kinds.map((k) => (
                    <div className="cmp-bar-row" key={k.kind}>
                      <div className="cmp-bar left">
                        <em>{k.a || ''}</em>
                        <i style={{ width: `${(k.a / result.maxKind) * 100}%` }} />
                      </div>
                      <span className="cmp-bar-label">{k.kind}</span>
                      <div className="cmp-bar right">
                        <i style={{ width: `${(k.b / result.maxKind) * 100}%` }} />
                        <em>{k.b || ''}</em>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="cmp-none">Sin recuerdos con ninguna de las dos en este periodo.</p>
              )}
            </section>

            <section className="cmp-card">
              <span className="wr-eyebrow">
                <Heart size={13} /> En común
              </span>
              {result.tastes.length > 0 ? (
                <div className="cmp-chips">
                  {result.tastes.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              ) : (
                <p className="cmp-none">No hay gustos en común registrados.</p>
              )}
              {result.same.length > 0 && (
                <ul className="cmp-same">
                  {result.same.map((s) => (
                    <li key={s.text}>
                      <s.icon size={14} /> {s.text}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="cmp-card">
              <span className="wr-eyebrow">
                <Users size={13} /> Gente en común
              </span>
              {result.mutual.length > 0 ? (
                <>
                  <div className="wr-faces wrap">
                    {result.mutual.slice(0, 12).map((p) => (
                      <span key={p.id} title={p.name}>
                        <Avatar person={p} size={34} />
                      </span>
                    ))}
                  </div>
                  <p className="cmp-note">
                    {plural(result.mutual.length, 'persona aparece', 'personas aparecen')} con las
                    dos.
                  </p>
                </>
              ) : (
                <p className="cmp-none">Nadie aparece con las dos en este periodo.</p>
              )}
            </section>

            <section className="cmp-card">
              <span className="wr-eyebrow">
                <MapPin size={13} /> Lugares en común
              </span>
              {result.places.length > 0 ? (
                <ul className="cmp-places">
                  {result.places.slice(0, 5).map(({ place, a: na, b: nb }) => {
                    const m = placeKinds[place.kind] ?? placeKinds.otro;
                    return (
                      <li key={place.id}>
                        <span
                          className="cmp-place-dot"
                          style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
                        >
                          <m.icon size={14} />
                        </span>
                        <strong>{place.name}</strong>
                        <small>
                          {firstName(a)} {na} · {firstName(b)} {nb}
                        </small>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="cmp-none">Aún no han coincidido en un mismo lugar contigo.</p>
              )}
            </section>

            <section className="cmp-card">
              <span className="wr-eyebrow">
                <Handshake size={13} /> Con las dos
              </span>
              {result.together.length > 0 ? (
                <ul className="cmp-moments">
                  {result.together.slice(0, 5).map((e) => (
                    <li key={e.id}>
                      <button type="button" onClick={() => viewEntry(e)}>
                        <strong>{e.title || e.kind}</strong>
                        <small>
                          {e.kind} · {relativeDay(todayInputValue(new Date(e.created_at)))}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cmp-none">No hay recuerdos con las dos en este periodo.</p>
              )}
            </section>
          </div>

          <p className="cmp-foot">
            Basado solo en lo que registraste. No mide capacidades, valor ni cariño.
          </p>
        </div>
      )}
    </div>
  );
}
