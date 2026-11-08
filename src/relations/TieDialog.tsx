import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  Search,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import type { Gender, Person, TieKind, TieNature } from '../data';
import type { TieInput } from '../hooks/useWorkspace';
import { normalizeText } from '../lib/format';
import { genderOf } from '../lib/gender';
import { relationMeta, relationOf, searchText } from '../lib/people';
import {
  ME,
  groupKinds,
  kindTitle,
  kindWord,
  kindsByCategory,
  naturesFor,
  surnamesOf,
  tieCategories,
  tieCategoryList,
  tieKinds,
  tiesOf,
  type TieCategory,
} from '../lib/relations';
import { Avatar } from '../people/Avatar';
import './relations.css';

/** Vínculos que suelen valer también entre las personas elegidas («hermanos entre sí»). */
const PEER: TieKind[] = ['hermano', 'amigo', 'companero', 'colega', 'socio', 'vecino'];

const listNames = (names: string[]) =>
  names.length <= 3
    ? names.join(names.length === 2 ? ' y ' : ', ').replace(/, ([^,]*)$/, ' y $1')
    : `${names.slice(0, 2).join(', ')} y ${names.length - 2} más`;

/**
 * Vincular de una vez a varias personas con alguien (o contigo): «estas son mis hermanas»,
 * «estos son los hijos de Ana». Los elegidos son <vínculo> de la persona.
 */
export function TieDialog({
  person,
  initialOthers,
  onClose,
}: {
  person: Person | null;
  initialOthers?: string[];
  onClose: () => void;
}) {
  const { workspace, saveTies, patchPerson, me } = useApp();
  const subject = person?.id ?? ME;
  // Tus apellidos (de «Mi ficha») cuando los vínculos son tuyos.
  const myName = me.profile.name ?? '';
  // Sexo elegido aquí (si no, el de la ficha o el que se deduce del nombre).
  const [genders, setGenders] = useState<Record<string, Gender>>({});
  const first = person?.name.split(' ')[0] ?? null;
  const [picked, setPicked] = useState<string[]>(initialOthers ?? []);
  const [step, setStep] = useState<'who' | 'what'>(initialOthers?.length ? 'what' : 'who');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<TieCategory>('familia');
  const [kind, setKind] = useState<TieKind | null>(null);
  const [among, setAmong] = useState<boolean | null>(null);
  const [nature, setNature] = useState<TieNature | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    if (step === 'who') input.current?.focus();
  }, [step]);

  const byId = useMemo(() => new Map(workspace.people.map((p) => [p.id, p])), [workspace.people]);
  const nameOf = (id: string) => (id === ME ? 'Tú' : (byId.get(id)?.name.split(' ')[0] ?? '?'));
  const gOf = (id: string): Gender | null =>
    id === ME ? null : (genders[id] ?? genderOf(byId.get(id)));
  const current = useMemo(() => tiesOf(subject, workspace.ties), [subject, workspace.ties]);
  const already = (id: string) =>
    current.filter((v) => v.other === id).map((v) => kindWord(v.kind, gOf(id)));

  const needle = normalizeText(query.trim());
  const candidates = workspace.people
    .filter((p) => p.id !== subject && (!needle || searchText(p).includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const toggle = (id: string) =>
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const pickAll = (ids: string[]) => setPicked((list) => [...new Set([...list, ...ids])]);

  // Atajos para elegir en lote: quienes comparten apellido y los miembros de tus grupos.
  const shortcuts = useMemo(() => {
    const others = workspace.people.filter((p) => p.id !== subject);
    const counts = new Map<string, string[]>();
    for (const p of others)
      for (const s of surnamesOf(p.name)) counts.set(s, [...(counts.get(s) ?? []), p.id]);
    const mine = surnamesOf(person ? person.name : myName);
    const surnames = [...counts]
      .filter(([s, ids]) => (mine.length ? mine.includes(s) : !person && ids.length >= 2))
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3)
      .map(([s, ids]) => {
        const sample = byId.get(ids[0])!.name.split(/\s+/);
        const label = sample.find((w) => normalizeText(w) === s) ?? s;
        return { key: 's' + s, label: `Los ${label}`, ids, icon: Users };
      });
    const groups = workspace.groups
      .filter((g) => g.member_ids.some((m) => m !== subject && byId.has(m)))
      .slice(0, 4)
      .map((g) => ({
        key: 'g' + g.id,
        label: g.name,
        ids: g.member_ids.filter((m) => m !== subject && byId.has(m)),
        icon: (groupKinds[g.kind] ?? groupKinds.otro).icon,
      }));
    return [...surnames, ...groups];
  }, [workspace.people, workspace.groups, subject, person, byId, myName]);

  const peer = kind !== null && PEER.includes(kind) && picked.length >= 2;
  const amongOn = peer && (among ?? kind === 'hermano');
  const pairs: [string, string][] = [];
  if (amongOn)
    for (let i = 0; i < picked.length; i++)
      for (let j = i + 1; j < picked.length; j++) pairs.push([picked[i], picked[j]]);
  const repeated = picked.filter((id) => already(id).length);

  const save = async () => {
    if (!kind || !picked.length || busy) return;
    setBusy(true);
    const inputs: TieInput[] = [
      ...picked.map((id) => ({ a: id, b: subject, kind, note, nature })),
      ...pairs.map(([x, y]) => ({ a: x, b: y, kind, nature })),
    ];
    const rows = await saveTies(inputs);
    // El sexo que elegiste aquí queda en la ficha («madre», no «padre/madre»).
    for (const [id, g] of Object.entries(genders)) {
      const p = byId.get(id);
      if (p && p.profile.gender !== g)
        await patchPerson(p, { profile: { ...p.profile, gender: g } }, true);
    }
    setBusy(false);
    if (rows.length) onClose();
  };

  const cmeta = tieCategories[cat];
  const names = picked.map(nameOf);
  const title = person ? `Vincular a ${first}` : 'Tus vínculos';
  // Personas cuyo sexo cambia la palabra: las elegidas y a quien vinculas.
  const sexed = [...picked.filter((id) => id !== ME), ...(person ? [person.id] : [])];
  const gendered = kind ? tieKinds[kind].m !== tieKinds[kind].f : cat === 'familia';
  const pickedG = picked.filter((id) => id !== ME).map(gOf);
  // Todas las elegidas del mismo sexo: los botones dicen «Madre», «Tía»…
  const sameG = pickedG.length && pickedG.every((g) => g && g === pickedG[0]) ? pickedG[0] : null;
  const each = picked.length > 1 ? (sameG === 'f' ? 'cada una es ' : 'cada uno es ') : '';
  const subjectG = person ? gOf(person.id) : null;

  return createPortal(
    <div
      className="confirm-backdrop picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className="pk rl-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ '--accent': cmeta.color, '--soft': cmeta.soft } as CSSProperties}
      >
        <header className="pk-head">
          <div className="rl-pair">
            {person ? <Avatar person={person} size={34} /> : <span className="rl-me">Tú</span>}
          </div>
          <h3>
            {title}
            <small>
              {step === 'who'
                ? 'Marca una o varias personas'
                : `${picked.length} ${picked.length === 1 ? 'persona' : 'personas'}`}
            </small>
          </h3>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {step === 'who' ? (
          <>
            <label className="pk-search">
              <Search size={16} />
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && candidates.length === 1) {
                    toggle(candidates[0].id);
                    setQuery('');
                  }
                }}
                placeholder={person ? `¿Quiénes se relacionan con ${first}?` : '¿Con quiénes?'}
              />
            </label>
            {!needle && shortcuts.length > 0 && (
              <div className="rl-shortcuts">
                {shortcuts.map((s) => {
                  const all = s.ids.every((id) => picked.includes(id));
                  return (
                    <button
                      type="button"
                      key={s.key}
                      className={all ? 'on' : ''}
                      onClick={() =>
                        all
                          ? setPicked((l) => l.filter((id) => !s.ids.includes(id)))
                          : pickAll(s.ids)
                      }
                    >
                      <s.icon size={13} /> {s.label} <i>{s.ids.length}</i>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="pk-list">
              {person && !needle && (
                <button
                  type="button"
                  className={'pk-row' + (picked.includes(ME) ? ' on' : '')}
                  onClick={() => toggle(ME)}
                >
                  <span className="pk-tile">
                    <UserRound size={17} />
                  </span>
                  <span>
                    <strong>Tú</strong>
                    <small>
                      {already(ME).length
                        ? `Ya: ${already(ME).join(', ')}`
                        : `Qué eres para ${first}`}
                    </small>
                  </span>
                  <i className={'pk-tick' + (picked.includes(ME) ? ' on' : '')}>
                    <Check size={13} strokeWidth={3} />
                  </i>
                </button>
              )}
              {candidates.map((p) => {
                const on = picked.includes(p.id);
                const was = already(p.id);
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={'pk-row' + (on ? ' on' : '')}
                    onClick={() => toggle(p.id)}
                  >
                    <Avatar person={p} size={36} />
                    <span>
                      <strong>{p.name}</strong>
                      <small className={was.length ? 'rl-was' : ''}>
                        {was.length
                          ? `Ya: ${was.join(', ')}`
                          : `${relationMeta[relationOf(p)].label}${p.role ? ` · ${p.role}` : ''}`}
                      </small>
                    </span>
                    <i className={'pk-tick' + (on ? ' on' : '')}>
                      <Check size={13} strokeWidth={3} />
                    </i>
                  </button>
                );
              })}
              {!candidates.length && (
                <p className="pp-empty pk-empty">Nadie coincide con «{query}».</p>
              )}
            </div>
            <footer className="pk-foot">
              <span className="rl-faces-mini">
                {picked.slice(0, 6).map((id) =>
                  id === ME ? (
                    <span key={id} className="rl-me sm">
                      Tú
                    </span>
                  ) : (
                    byId.get(id) && <Avatar key={id} person={byId.get(id)!} size={26} />
                  ),
                )}
                {picked.length > 0 ? (
                  <button type="button" className="ps-link" onClick={() => setPicked([])}>
                    Quitar todas
                  </button>
                ) : (
                  <span className="rl-hint">Puedes elegir varias a la vez.</span>
                )}
              </span>
              <button
                type="button"
                className="cp-btn cta"
                disabled={!picked.length}
                onClick={() => setStep('what')}
              >
                Siguiente {picked.length > 0 && `(${picked.length})`} <ArrowRight size={15} />
              </button>
            </footer>
          </>
        ) : (
          <>
            <div className="rl-body">
              <div className="rl-picked">
                <button
                  type="button"
                  className="rl-back"
                  aria-label="Cambiar personas"
                  onClick={() => setStep('who')}
                >
                  <ArrowLeft size={15} />
                </button>
                {picked.map((id) => (
                  <span key={id}>
                    {id === ME ? (
                      <span className="rl-me sm">Tú</span>
                    ) : (
                      byId.get(id) && <Avatar person={byId.get(id)!} size={22} />
                    )}
                    {nameOf(id)}
                    <button type="button" aria-label="Quitar" onClick={() => toggle(id)}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <span className="rl-q">
                {picked.length > 1 ? 'Cada uno es…' : 'Es…'} {person ? `de ${first}` : 'para ti'}
              </span>
              <nav className="rl-cats">
                {tieCategoryList.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={cat === c ? 'on' : ''}
                    style={{ '--c': tieCategories[c].color } as CSSProperties}
                    onClick={() => setCat(c)}
                  >
                    {tieCategories[c].label}
                  </button>
                ))}
              </nav>
              <div className="cp-chips rl-kinds">
                {kindsByCategory(cat).map((k) => (
                  <button
                    type="button"
                    key={k}
                    className={'cp-chip' + (kind === k ? ' on' : '')}
                    onClick={() => {
                      setKind(k);
                      setNature(null);
                    }}
                  >
                    {sameG ? kindTitle(k, sameG) : tieKinds[k].label}
                  </button>
                ))}
              </div>
              {gendered && sexed.length > 0 && (
                <div className="rl-genders" role="group" aria-label="Sexo de cada persona">
                  <span>Para escribirlo bien:</span>
                  {sexed.map((id) => {
                    const g = gOf(id);
                    const explicit = Boolean(genders[id] ?? byId.get(id)?.profile.gender);
                    return (
                      <span key={id} className="rl-g">
                        <b>{nameOf(id)}</b>
                        {(['f', 'm'] as const).map((x) => (
                          <button
                            type="button"
                            key={x}
                            aria-pressed={g === x}
                            className={
                              (g === x ? 'on' : '') + (g === x && !explicit ? ' guess' : '')
                            }
                            title={g === x && !explicit ? 'Deducido del nombre' : undefined}
                            onClick={() => setGenders((all) => ({ ...all, [id]: x }))}
                          >
                            {x === 'f' ? 'Mujer' : 'Hombre'}
                          </button>
                        ))}
                      </span>
                    );
                  })}
                </div>
              )}
              {kind && naturesFor(kind).length > 0 && (
                <div
                  className="rl-natures"
                  role="radiogroup"
                  aria-label="Naturaleza del parentesco"
                >
                  <span>¿De qué tipo?</span>
                  {naturesFor(kind).map((n) => (
                    <button
                      type="button"
                      role="radio"
                      key={n.value}
                      aria-checked={nature === n.value}
                      className={nature === n.value ? 'on' : ''}
                      onClick={() => setNature(nature === n.value ? null : n.value)}
                    >
                      {n.label}
                    </button>
                  ))}
                  <small>
                    Opcional · los de crianza no se usan para deducir otros parentescos.
                  </small>
                </div>
              )}
              {kind && picked.length > 0 && (
                <div className="rl-sentence">
                  <strong>
                    {listNames(names)}
                    {picked.length > 1 ? `: ${each}` : picked[0] === ME ? ': eres ' : ': es '}
                    {(() => {
                      const g = picked.length > 1 ? sameG : gOf(picked[0]);
                      return person
                        ? `${kindWord(kind, g)} de ${first}`
                        : `tu ${kindWord(kind, g)}`;
                    })()}
                    .
                  </strong>
                  <span>
                    {person ? `Y ${first} es ` : 'Y tú eres '}
                    {kindWord(tieKinds[kind].inverse, subjectG)} de{' '}
                    {picked.length > 1
                      ? sameG === 'f'
                        ? 'cada una'
                        : 'cada uno'
                      : picked[0] === ME
                        ? 'ti'
                        : names[0]}
                    .
                  </span>
                </div>
              )}
              {peer && (
                <label className="rl-among">
                  <input
                    type="checkbox"
                    checked={amongOn}
                    onChange={(e) => setAmong(e.target.checked)}
                  />
                  <span>
                    <strong>
                      También son{' '}
                      {(() => {
                        // «hermanas», «amigos»; si son de ambos sexos, «hermano/a».
                        const w = kindWord(kind!, sameG);
                        return sameG && !w.includes(' ') ? w + 's' : w;
                      })()}{' '}
                      entre sí
                    </strong>
                    <small>
                      {amongOn
                        ? `Se ${pairs.length === 1 ? 'guarda 1 vínculo más' : `guardan ${pairs.length} vínculos más`} entre ellos.`
                        : 'Solo se vincula cada uno con ' + (person ? first : 'contigo') + '.'}
                    </small>
                  </span>
                </label>
              )}
              {repeated.length > 0 && (
                <p className="rl-existing">
                  Ya vinculados:{' '}
                  {repeated.map((id) => `${nameOf(id)} (${already(id).join(', ')})`).join(' · ')}.
                  Se añade el vínculo nuevo.
                </p>
              )}
              <input
                className="cp-ghost-input"
                maxLength={300}
                placeholder="Nota (opcional): se conocieron en…, trabajan juntos en…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <footer className="pk-foot">
              <span className="rl-hint">
                Los parentescos se combinan solos: tíos, primos, cuñados…
              </span>
              <button
                type="button"
                className="cp-btn cta"
                disabled={!kind || !picked.length || busy}
                onClick={() => void save()}
              >
                {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Vincular
                {picked.length > 1 && ` a ${picked.length}`}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
