import { useEffect, useMemo, useState } from 'react';
import { Check, LoaderCircle, RefreshCw, Sparkles, Users, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { selfReading } from '../assistant';
import { supabase } from '../backend';
import { Sheet } from '../components/Sheet';
import { AutoTextarea } from '../composer/controls';
import { TagInput } from '../composer/TagInput';
import type { Gender, MyProfile } from '../data';
import { MY_PROFILE_SQL } from '../hooks/useMyProfile';
import { errorMessage, initials, normalizeText } from '../lib/format';
import { genderLabels, genderOf } from '../lib/gender';
import { relativeDay } from '../lib/people';
import { ME, kindWord, surnamesOf, tieKinds, tiesOf } from '../lib/relations';
import { buildSelfDigest, selfBasis, type ReadingLite } from '../lib/selfDigest';
import { Avatar } from './Avatar';
import './myprofile.css';

const STEPS = [
  'Mirando a tu gente…',
  'Repasando tus recuerdos…',
  'Hojeando tus lecturas…',
  'Escribiendo tu lectura…',
];

/** Sin textos ni listas vacías: así la ficha guardada queda limpia. */
function tidy(p: MyProfile): MyProfile {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    const val = typeof v === 'string' ? v.trim() : v;
    if (val === '' || val === undefined || val === null) continue;
    if (Array.isArray(val) && !val.length) continue;
    out[k] = val;
  }
  return out as MyProfile;
}

/** Tus lecturas recientes (títulos y temas). Sin la migración 012 no hay «terminadas». */
async function loadReadings(): Promise<ReadingLite[]> {
  const recent = (columns: string) =>
    supabase.from('readings').select(columns).order('created_at', { ascending: false }).limit(60);
  const full = await recent('title,tags,read_at');
  if (!full.error) return full.data as unknown as ReadingLite[];
  const basic = await recent('title,tags');
  return basic.error
    ? []
    : (basic.data as unknown as Omit<ReadingLite, 'read_at'>[]).map((r) => ({
        ...r,
        read_at: null,
      }));
}

/** Qué tanto has contado de ti (para animarte a completar). */
const filled = (p: MyProfile) => {
  const checks = [
    surnamesOf(p.name ?? '').length > 0,
    Boolean(p.birthday),
    Boolean(p.city),
    Boolean(p.occupation),
    Boolean(p.interests?.length),
    Boolean(p.likes?.length),
    Boolean(p.goals?.length),
    Boolean(p.about?.trim()),
  ];
  return Math.round((100 * checks.filter(Boolean).length) / checks.length);
};

/** «Mi ficha»: tus datos, tu familia en Nexo y la lectura que hace la IA de todo lo que guardas. */
export function MyProfileSheet({ onClose }: { onClose: () => void }) {
  const { user, workspace, me, meMissing, saveMe, saveMyReading, confirm, openTie } = useApp();
  const [d, setD] = useState<MyProfile>(() => ({ ...me.profile }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');

  const set = <K extends keyof MyProfile>(key: K, value: MyProfile[K]) => {
    setDirty(true);
    setD((x) => ({ ...x, [key]: value }));
  };

  // Mientras la IA trabaja, se cuenta qué está mirando.
  useEffect(() => {
    if (!thinking) return;
    setStep(0);
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1900);
    return () => window.clearInterval(t);
  }, [thinking]);

  // ── Tu familia en Nexo: la que ya vinculaste y quienes comparten tus apellidos ──
  const byId = useMemo(() => new Map(workspace.people.map((p) => [p.id, p])), [workspace.people]);
  const mine = useMemo(() => tiesOf(ME, workspace.ties), [workspace.ties]);
  const family = mine.filter(
    (v) => v.other !== ME && byId.has(v.other) && tieKinds[v.kind].category === 'familia',
  );
  const surnames = surnamesOf(d.name ?? '');
  const tied = new Set(mine.map((v) => v.other));
  const myName = normalizeText((d.name ?? '').trim());
  const kin = surnames.length
    ? workspace.people
        .filter(
          (p) =>
            !tied.has(p.id) &&
            normalizeText(p.name.trim()) !== myName &&
            surnamesOf(p.name).some((s) => surnames.includes(s)),
        )
        .slice(0, 12)
    : [];
  // La forma original de tus apellidos («Gómez», no «gomez»).
  const pretty = surnames.map(
    (s) => (d.name ?? '').split(/\s+/).find((w) => normalizeText(w) === s) ?? s,
  );

  const basis = selfBasis(workspace);
  const percent = filled(d);
  const birthDate = d.birthday && d.birthYear ? `${d.birthYear}-${d.birthday}` : '';

  async function save() {
    if (saving) return false;
    setSaving(true);
    const ok = await saveMe(tidy(d));
    setSaving(false);
    if (ok) setDirty(false);
    return ok;
  }

  /** Pide a la IA una lectura nueva con todo lo que hay de ti (y lo que acabas de escribir). */
  async function generate() {
    if (thinking || meMissing) return;
    setError('');
    if (dirty && !(await save())) return;
    setThinking(true);
    try {
      const readings = await loadReadings();
      const result = await selfReading(buildSelfDigest(workspace, tidy(d), readings));
      await saveMyReading(result.reading, result.highlights);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setThinking(false);
    }
  }

  const requestClose = async () => {
    if (thinking) return;
    if (dirty) {
      const ok = await confirm({
        title: '¿Descartar los cambios?',
        message: 'Lo que no hayas guardado de tu ficha se perderá.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir editando',
        danger: true,
        icon: 'warning',
      });
      if (!ok) return;
    }
    onClose();
  };

  const field = (
    key: 'alias' | 'city' | 'occupation' | 'company',
    label: string,
    placeholder: string,
  ) => (
    <label className="mf-field">
      <span>{label}</span>
      <input
        value={d[key] ?? ''}
        maxLength={80}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );

  return (
    <Sheet label="Mi ficha" size="md" className="mf" onRequestClose={() => void requestClose()}>
      <header className="mf-head">
        <span className="mf-avatar" aria-hidden="true">
          {initials(d.name?.trim() || user.email || 'Yo').toUpperCase()}
        </span>
        <div className="mf-id">
          <h2>{d.name?.trim() || 'Tu ficha'}</h2>
          <p>
            {[d.occupation?.trim(), d.city?.trim()].filter(Boolean).join(' · ') || user.email}
            <span className="mf-meter" title="Qué tanto has contado de ti">
              <b>
                <i style={{ width: `${percent}%` }} />
              </b>
              {percent}%
            </span>
          </p>
        </div>
        <button
          type="button"
          className="cp-close"
          aria-label="Cerrar"
          onClick={() => void requestClose()}
        >
          <X size={18} />
        </button>
      </header>

      <div className="mf-scroll">
        {meMissing && (
          <p className="mf-notice" role="status">
            Para guardar tu ficha ejecuta <code>{MY_PROFILE_SQL}</code> en el SQL Editor de
            Supabase.
          </p>
        )}

        {/* ── Lectura de la IA: la descripción general de la ficha ── */}
        <section className={'mf-reading' + (thinking ? ' busy' : '')} aria-busy={thinking}>
          <div className="mf-reading-head">
            <span className="mf-spark">
              <Sparkles size={16} />
            </span>
            <div>
              <strong>Lectura de Nexo</strong>
              <small>
                {me.reading_at
                  ? `Actualizada ${relativeDay(me.reading_at.slice(0, 10)).toLowerCase()}`
                  : 'Quién eres hoy, según todo lo que guardas'}
              </small>
            </div>
            <button
              type="button"
              className="mf-gen"
              disabled={thinking || meMissing}
              onClick={() => void generate()}
            >
              {thinking ? (
                <LoaderCircle className="spin" size={14} />
              ) : me.reading ? (
                <RefreshCw size={14} />
              ) : (
                <Sparkles size={14} />
              )}
              {thinking ? 'Leyendo…' : me.reading ? 'Actualizar' : 'Generar lectura'}
            </button>
          </div>

          {thinking ? (
            <div className="mf-shimmer" aria-live="polite">
              <i />
              <i />
              <i />
              <i />
              <span key={step}>{STEPS[step]}</span>
            </div>
          ) : me.reading ? (
            <>
              <div className="mf-reading-text">
                {me.reading
                  .split(/\n{2,}/)
                  .filter((p) => p.trim())
                  .map((p, i) => (
                    <p key={i}>{p.trim()}</p>
                  ))}
              </div>
              {me.highlights.length > 0 && (
                <div className="mf-traits">
                  {me.highlights.map((h) => (
                    <span key={h}>{h}</span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="mf-reading-empty">
              Nexo lee a tu gente, tus recuerdos, tus lecturas y tus episodios, y escribe una
              descripción de quién eres hoy. Pídela cuando quieras: se actualiza con lo nuevo.
            </p>
          )}
          {error && (
            <p className="mf-error" role="alert">
              {error}
            </p>
          )}
          <small className="mf-basis">
            Con {basis.people} {basis.people === 1 ? 'persona' : 'personas'}, {basis.entries}{' '}
            {basis.entries === 1 ? 'recuerdo' : 'recuerdos'}, {basis.episodes}{' '}
            {basis.episodes === 1 ? 'episodio' : 'episodios'} y tus lecturas.
          </small>
        </section>

        {/* ── Lo esencial ── */}
        <section className="mf-sec">
          <h3>Lo esencial</h3>
          <div className="mf-grid">
            <label className="mf-field full">
              <span>Nombre completo</span>
              <input
                value={d.name ?? ''}
                maxLength={120}
                placeholder="Con tus apellidos"
                onChange={(e) => set('name', e.target.value)}
              />
              <small>
                {pretty.length
                  ? `Tus apellidos: ${pretty.join(' · ')}. Con ellos Nexo reconoce a tu familia.`
                  : 'Escríbelo con tus apellidos: así Nexo reconoce a tu familia.'}
              </small>
            </label>
            {field('alias', 'Cómo te dicen', 'Apodo')}
            <div className="mf-field">
              <span>Sexo</span>
              <div className="mf-seg" role="radiogroup" aria-label="Sexo">
                {(['f', 'm'] as Gender[]).map((g) => (
                  <button
                    type="button"
                    role="radio"
                    key={g}
                    aria-checked={d.gender === g}
                    className={d.gender === g ? 'on' : ''}
                    onClick={() => set('gender', d.gender === g ? undefined : g)}
                  >
                    {genderLabels[g]}
                  </button>
                ))}
              </div>
            </div>
            <label className="mf-field">
              <span>Cumpleaños</span>
              <input
                type="date"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  const v = e.target.value;
                  setDirty(true);
                  setD((x) => ({
                    ...x,
                    birthday: v ? v.slice(5) : undefined,
                    birthYear: v ? Number(v.slice(0, 4)) : undefined,
                  }));
                }}
              />
            </label>
            {field('city', 'Ciudad', 'Dónde vives')}
            {field('occupation', 'A qué te dedicas', 'Diseñadora, estudiante…')}
            {field('company', 'Dónde trabajas o estudias', 'Empresa o institución')}
          </div>
        </section>

        {/* ── Tu familia en Nexo ── */}
        <section className="mf-sec">
          <h3>Tu familia en Nexo</h3>
          {family.length > 0 ? (
            <div className="mf-kin-list">
              {family.map((v) => {
                const p = byId.get(v.other)!;
                return (
                  <span className="mf-kin" key={v.tie.id}>
                    <Avatar person={p} size={26} />
                    <strong>{p.name.split(' ')[0]}</strong>
                    <small>{kindWord(v.kind, genderOf(p))}</small>
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="mf-muted">Aún no vinculas a tu familia.</p>
          )}
          {kin.length > 0 && (
            <div className="mf-kin-box">
              <div>
                <strong>
                  {kin.length === 1
                    ? `${kin[0].name.split(' ')[0]} comparte tu apellido`
                    : `${kin.length} personas comparten tus apellidos`}
                </strong>
                <div className="mf-faces">
                  {kin.slice(0, 8).map((p) => (
                    <Avatar key={p.id} person={p} size={26} />
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="mf-link-btn"
                onClick={() =>
                  openTie(
                    null,
                    kin.map((p) => p.id),
                  )
                }
              >
                <Users size={14} /> ¿Son tu familia?
              </button>
            </div>
          )}
        </section>

        {/* ── Gustos ── */}
        <section className="mf-sec">
          <h3>Tus gustos</h3>
          <div className="mf-tags">
            <span className="mf-label">Te interesa</span>
            <TagInput
              tags={d.interests ?? []}
              max={20}
              onChange={(v) => set('interests', v)}
              placeholder="Fotografía, historia, correr…"
            />
            <span className="mf-label">Te encanta</span>
            <TagInput
              tags={d.likes ?? []}
              max={20}
              onChange={(v) => set('likes', v)}
              placeholder="Café de la mañana, el mar…"
            />
            <span className="mf-label">No te gusta</span>
            <TagInput
              tags={d.dislikes ?? []}
              max={20}
              onChange={(v) => set('dislikes', v)}
              placeholder="Madrugar, el ruido…"
            />
          </div>
        </section>

        {/* ── Ahora mismo ── */}
        <section className="mf-sec">
          <h3>Ahora mismo</h3>
          <div className="mf-tags">
            <span className="mf-label">En qué estás</span>
            <TagInput
              tags={d.goals ?? []}
              max={12}
              onChange={(v) => set('goals', v)}
              placeholder="Aprender inglés, terminar la tesis…"
            />
            <span className="mf-label">En tus palabras</span>
            <AutoTextarea
              className="cp-soft-area mf-about"
              minRows={3}
              maxLength={3000}
              placeholder="Lo que quieras que Nexo tenga en cuenta de ti."
              value={d.about ?? ''}
              onChange={(e) => set('about', e.target.value)}
            />
          </div>
        </section>
      </div>

      <footer className="mf-foot">
        <small>
          {dirty
            ? 'Tienes cambios sin guardar.'
            : 'La lectura usa tu ficha y todo lo que guardas en Nexo.'}
        </small>
        <button type="button" className="cp-btn ghost" onClick={() => void requestClose()}>
          Cerrar
        </button>
        <button
          type="button"
          className="cp-btn cta"
          disabled={!dirty || saving || meMissing}
          onClick={() => void save()}
        >
          {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Guardar
        </button>
      </footer>
    </Sheet>
  );
}
