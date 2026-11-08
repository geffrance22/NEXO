import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  Cake,
  Check,
  ClipboardCheck,
  Gift,
  Heart,
  History,
  LoaderCircle,
  MessageCircleQuestion,
  Plus,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { MoodPicker } from '../composer/controls';
import type { CommitmentKind, Entry, EntryDetails, EntryInput, Person, UpdateKind } from '../data';
import { commitmentKinds, commitmentsWith } from '../lib/commitments';
import { addDays, friendlyDate, todayInputValue } from '../lib/format';
import { interestsOf, relationMeta, relationOf, relativeDay, statsFor } from '../lib/people';
import { ME, groupsOf, kindWord, tiesOf } from '../lib/relations';
import { genderOf } from '../lib/gender';
import { updateKindList, updateKinds, updatesOf } from '../lib/updates';
import { Avatar } from './Avatar';
import './brief.css';

type Promise_ = { id: string; kind: CommitmentKind; text: string; due: string };
const retake = [
  { days: 7, label: 'En una semana' },
  { days: 14, label: 'En dos semanas' },
  { days: 30, label: 'En un mes' },
];

/**
 * Antes de ver a alguien: lo esencial en una ficha breve (última conversación, novedades,
 * compromisos, qué preguntarle, qué tienen en común). Después: un cierre de 30 segundos.
 */
export function MeetingBrief({
  person,
  mode: initial,
  entry,
  onClose,
}: {
  person: Person;
  mode: 'antes' | 'despues';
  entry?: Entry;
  onClose: () => void;
}) {
  const [mode, setMode] = useState(initial);
  const meta = relationMeta[relationOf(person)];
  return (
    <Sheet
      label={mode === 'antes' ? `Antes de ver a ${person.name}` : `Después de ver a ${person.name}`}
      size="md"
      onRequestClose={onClose}
    >
      <div
        className="mb"
        style={{ '--accent': meta.color, '--soft': meta.soft, '--ink': meta.ink } as CSSProperties}
      >
        <header className="mb-head">
          <Avatar person={person} size={44} />
          <div>
            <small>{mode === 'antes' ? 'Antes del encuentro' : 'Cierre de 30 segundos'}</small>
            <h2>
              {mode === 'antes'
                ? `Vas a ver a ${person.name.split(' ')[0]}`
                : `¿Cómo te fue con ${person.name.split(' ')[0]}?`}
            </h2>
            {entry && (
              <span className="mb-when">
                {friendlyDate(todayInputValue(new Date(entry.created_at)))}
                {entry.details.place && ` · ${entry.details.place}`}
              </span>
            )}
          </div>
          <div className="mb-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'antes'}
              className={mode === 'antes' ? 'on' : ''}
              onClick={() => setMode('antes')}
            >
              Antes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'despues'}
              className={mode === 'despues' ? 'on' : ''}
              onClick={() => setMode('despues')}
            >
              Después
            </button>
          </div>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {mode === 'antes' ? (
          <Before person={person} onNext={() => setMode('despues')} />
        ) : (
          <After person={person} entry={entry} onDone={onClose} />
        )}
      </div>
    </Sheet>
  );
}

function Before({ person, onNext }: { person: Person; onNext: () => void }) {
  const { workspace, patchPerson, viewEntry } = useApp();
  const stats = useMemo(() => statsFor(person, workspace.entries), [person, workspace.entries]);
  const last = stats.interactions[0];
  const updates = updatesOf(person).slice(0, 3);
  const { mine, theirs } = commitmentsWith(person.id, workspace.entries);
  const [ask, setAsk] = useState('');
  const askNext = person.profile.askNext ?? [];
  const follow = (person.profile.updates ?? []).filter((u) => u.followUp && !u.done);
  const groups = groupsOf(person.id, workspace.groups);
  const mutual = tiesOf(person.id, workspace.ties)
    .filter((v) => v.other !== ME)
    .map((v) => ({ v, p: workspace.people.find((x) => x.id === v.other) }))
    .filter((x) => x.p)
    .slice(0, 5);
  const interests = [...interestsOf(person), ...(person.profile.likes ?? [])].slice(0, 8);
  const careful = [
    ...(person.profile.dislikes ?? []).map((d) => `No le gusta: ${d}`),
    ...(person.profile.facts ?? [])
      .filter((f) => /alerg|dieta|vegan|vegetar|no come|no bebe/i.test(f.label + f.value))
      .map((f) => `${f.label}: ${f.value}`),
  ];
  const saveAsk = (list: string[]) =>
    void patchPerson(person, { profile: { ...person.profile, askNext: list } }, true);

  return (
    <div className="mb-body">
      <section>
        <h4>
          <History size={15} /> Última conversación
        </h4>
        {last ? (
          <button type="button" className="mb-last" onClick={() => viewEntry(last)}>
            <strong>{last.title}</strong>
            <small>{relativeDay(todayInputValue(new Date(last.created_at)))}</small>
            {last.body && <p>{last.body.slice(0, 220)}</p>}
          </button>
        ) : (
          <p className="pp-empty">Aún no registras encuentros con esta persona.</p>
        )}
      </section>

      {updates.length > 0 && (
        <section>
          <h4>
            <Sparkles size={15} /> Novedades recientes
          </h4>
          {updates.map((u) => {
            const um = updateKinds[u.kind] ?? updateKinds.otro;
            return (
              <div className="mb-line" key={u.id}>
                <um.icon size={14} style={{ color: um.color }} />
                <span>
                  {u.text} <small>· {relativeDay(u.date)}</small>
                </span>
              </div>
            );
          })}
        </section>
      )}

      {(mine.length > 0 || theirs.length > 0) && (
        <section>
          <h4>
            <ClipboardCheck size={15} /> Compromisos abiertos
          </h4>
          {mine.map((e) => (
            <div className="mb-line" key={e.id}>
              <i className="mb-tag you">Le debes</i>
              <span>
                {e.title}
                {e.details.due && <small> · {friendlyDate(e.details.due)}</small>}
              </span>
            </div>
          ))}
          {theirs.map((e) => (
            <div className="mb-line" key={e.id}>
              <i className="mb-tag them">Te debe</i>
              <span>
                {e.title}
                {e.details.due && <small> · {friendlyDate(e.details.due)}</small>}
              </span>
            </div>
          ))}
        </section>
      )}

      <section>
        <h4>
          <MessageCircleQuestion size={15} /> Para preguntarle
        </h4>
        {follow.map((u) => (
          <div className="mb-line" key={u.id}>
            <i className="mb-tag ask">Seguimiento</i>
            <span>¿Cómo va? {u.text}</span>
          </div>
        ))}
        {askNext.map((q, i) => (
          <div className="mb-line" key={q + i}>
            <i className="mb-dot" />
            <span>{q}</span>
            <button
              type="button"
              className="mb-x"
              aria-label="Quitar"
              onClick={() => saveAsk(askNext.filter((_, j) => j !== i))}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <form
          className="mb-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ask.trim()) return;
            saveAsk([...askNext, ask.trim().slice(0, 200)].slice(-20));
            setAsk('');
          }}
        >
          <input
            value={ask}
            maxLength={200}
            placeholder="Algo que quieras preguntarle…"
            onChange={(e) => setAsk(e.target.value)}
          />
          <button type="submit" className="pp-icon-btn" aria-label="Añadir pregunta">
            <Plus size={15} />
          </button>
        </form>
      </section>

      {(interests.length > 0 || groups.length > 0 || mutual.length > 0) && (
        <section>
          <h4>
            <Users size={15} /> En común y de qué hablar
          </h4>
          <div className="mb-chips">
            {groups.map((g) => (
              <span key={g.id} className="grp">
                {g.name}
              </span>
            ))}
            {mutual.map(({ v, p }) => (
              <span key={v.tie.id}>
                {p!.name.split(' ')[0]} · {kindWord(v.kind, genderOf(p))}
              </span>
            ))}
            {interests.map((t) => (
              <span key={t} className="int">
                {t}
              </span>
            ))}
          </div>
        </section>
      )}

      {(stats.birthdayIn !== null && stats.birthdayIn <= 30) ||
      careful.length ||
      person.profile.gifts?.length ? (
        <section>
          <h4>
            <Heart size={15} /> Para tener en cuenta
          </h4>
          {stats.birthdayIn !== null && stats.birthdayIn <= 30 && (
            <div className="mb-line">
              <Cake size={14} />
              <span>
                {stats.birthdayIn === 0
                  ? 'Hoy es su cumpleaños'
                  : `Cumple años en ${stats.birthdayIn} días`}
              </span>
            </div>
          )}
          {careful.map((c) => (
            <div className="mb-line" key={c}>
              <i className="mb-dot warn" />
              <span>{c}</span>
            </div>
          ))}
          {person.profile.gifts?.length ? (
            <div className="mb-line">
              <Gift size={14} />
              <span>Ideas de regalo: {person.profile.gifts.slice(0, 4).join(', ')}</span>
            </div>
          ) : null}
        </section>
      ) : null}

      <footer className="mb-foot">
        <button type="button" className="cp-btn cta" onClick={onNext}>
          Ya nos vimos <ArrowRight size={15} />
        </button>
      </footer>
    </div>
  );
}

function After({ person, entry, onDone }: { person: Person; entry?: Entry; onDone: () => void }) {
  const { workspace, createEntry, patchEntry, patchPerson, notify } = useApp();
  const first = person.name.split(' ')[0];
  const [text, setText] = useState('');
  const [mood, setMood] = useState<number | undefined>(entry?.details.mood);
  const [news, setNews] = useState('');
  const [newsKind, setNewsKind] = useState<UpdateKind>('otro');
  const [promises, setPromises] = useState<Promise_[]>([]);
  const [retakeIn, setRetakeIn] = useState<number | null>(null);
  const [topic, setTopic] = useState('');
  const askNext = person.profile.askNext ?? [];
  const follow = (person.profile.updates ?? []).filter((u) => u.followUp && !u.done);
  const [asked, setAsked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const today = todayInputValue();
  const planned = entry && entry.kind === 'Encuentro' ? entry : undefined;

  const base = (over: Partial<EntryInput> & Pick<EntryInput, 'kind' | 'title'>): EntryInput => ({
    body: '',
    tags: [],
    personIds: [person.id],
    date: today,
    amount: 0,
    direction: 'egreso',
    status: 'pendiente',
    images: [],
    details: {},
    file: null,
    removeFile: false,
    episodeId: entry?.episode_id ?? undefined,
    ...over,
  });

  const save = async () => {
    if (busy) return;
    setBusy(true);
    // 1. El encuentro: completa el agendado o crea uno nuevo.
    let origin: Entry | null = planned ?? null;
    if (planned) {
      const details: EntryDetails = { ...planned.details, ...(mood && { mood }) };
      await patchEntry(planned, {
        details,
        ...(text.trim() && { body: [planned.body, text.trim()].filter(Boolean).join('\n\n') }),
      });
    } else {
      origin = await createEntry(
        base({
          kind: 'Encuentro',
          title: `Encuentro con ${first}`,
          body: text.trim(),
          details: mood ? { mood } : {},
        }),
        true,
      );
    }
    // 2. Promesas y lo que esperas.
    let saved = 0;
    for (const p of promises) {
      if (!p.text.trim()) continue;
      const details: EntryDetails = { priority: 'media', commitment: p.kind };
      if (p.due) details.due = p.due;
      if (p.kind === 'prometi') details.beneficiary = person.id;
      else details.owner = person.id;
      if (origin) details.sourceId = origin.id;
      if (
        await createEntry(
          base({ kind: 'Pendiente', title: p.text.trim().slice(0, 180), details }),
          true,
        )
      )
        saved++;
    }
    // 3. Retomar el tema.
    if (retakeIn) {
      const details: EntryDetails = {
        priority: 'media',
        commitment: 'quiero',
        due: addDays(today, retakeIn),
      };
      if (origin) details.sourceId = origin.id;
      if (
        await createEntry(
          base({
            kind: 'Pendiente',
            title: `Retomar con ${first}${topic.trim() ? `: ${topic.trim()}` : ''}`.slice(0, 180),
            details,
          }),
          true,
        )
      )
        saved++;
    }
    // 4. Su ficha: novedad, preguntas resueltas y seguimientos hechos (una sola escritura).
    const current = workspace.people.find((p) => p.id === person.id) ?? person;
    const updates = (current.profile.updates ?? []).map((u) =>
      asked.includes('u:' + u.id) ? { ...u, done: true } : u,
    );
    if (news.trim())
      updates.unshift({
        id: crypto.randomUUID(),
        date: today,
        kind: newsKind,
        text: news.trim().slice(0, 500),
        created_at: new Date().toISOString(),
        ...(origin && { entryId: origin.id }),
        ...(entry?.episode_id && { episodeId: entry.episode_id }),
      });
    const remaining = (current.profile.askNext ?? []).filter((q) => !asked.includes('q:' + q));
    if (news.trim() || asked.length)
      await patchPerson(
        current,
        { profile: { ...current.profile, updates, askNext: remaining } },
        true,
      );
    setBusy(false);
    notify(
      `Encuentro con ${first} cerrado${saved ? ` · ${saved} ${saved === 1 ? 'pendiente' : 'pendientes'}` : ''}${news.trim() ? ' · novedad guardada' : ''}.`,
    );
    onDone();
  };

  const toggleAsked = (k: string) =>
    setAsked((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));

  return (
    <div className="mb-body">
      <section>
        <h4>Lo que pasó</h4>
        <textarea
          className="mb-text"
          rows={3}
          maxLength={4000}
          placeholder={`¿De qué hablaron con ${first}?`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <MoodPicker label="Cómo estuvo" value={mood} onChange={setMood} />
      </section>

      <section>
        <h4>¿Qué cambió en su vida?</h4>
        <div className="mb-kinds">
          {updateKindList.map((k) => {
            const um = updateKinds[k];
            return (
              <button
                type="button"
                key={k}
                className={newsKind === k ? 'on' : ''}
                style={{ '--c': um.color, '--s': um.soft } as CSSProperties}
                onClick={() => setNewsKind(k)}
              >
                <um.icon size={13} /> {um.label}
              </button>
            );
          })}
        </div>
        <input
          className="mb-input"
          maxLength={500}
          placeholder={updateKinds[newsKind].hint}
          value={news}
          onChange={(e) => setNews(e.target.value)}
        />
      </section>

      <section>
        <h4>¿Quedó alguna promesa?</h4>
        {promises.map((p) => (
          <div className="mb-promise" key={p.id}>
            <div className="xp-seg">
              {(['prometi', 'espero'] as const).map((k) => (
                <button
                  type="button"
                  key={k}
                  className={p.kind === k ? 'on' : ''}
                  onClick={() =>
                    setPromises((l) => l.map((x) => (x.id === p.id ? { ...x, kind: k } : x)))
                  }
                >
                  {k === 'prometi' ? 'Yo prometí' : `${first} quedó en`}
                </button>
              ))}
            </div>
            <input
              className="mb-input"
              maxLength={180}
              placeholder={
                p.kind === 'prometi' ? 'Enviarle el contacto de…' : 'Mandarme la propuesta…'
              }
              value={p.text}
              onChange={(e) =>
                setPromises((l) =>
                  l.map((x) => (x.id === p.id ? { ...x, text: e.target.value } : x)),
                )
              }
            />
            <input
              type="date"
              value={p.due}
              onChange={(e) =>
                setPromises((l) =>
                  l.map((x) => (x.id === p.id ? { ...x, due: e.target.value } : x)),
                )
              }
              aria-label="Para cuándo"
            />
            <button
              type="button"
              className="mb-x"
              aria-label="Quitar"
              onClick={() => setPromises((l) => l.filter((x) => x.id !== p.id))}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="pp-text-btn"
          onClick={() =>
            setPromises((l) => [
              ...l,
              { id: crypto.randomUUID(), kind: 'prometi', text: '', due: '' },
            ])
          }
        >
          <Plus size={13} /> {promises.length ? 'Otra' : 'Añadir'} promesa o espera
        </button>
        <small className="mb-hint">
          {commitmentKinds.prometi.label} y {commitmentKinds.espero.label.toLowerCase()} se siguen
          distinto en tu agenda.
        </small>
      </section>

      <section>
        <h4>¿Cuándo retomar?</h4>
        <div className="cp-chips">
          {retake.map((r) => (
            <button
              type="button"
              key={r.days}
              className={'cp-chip' + (retakeIn === r.days ? ' on' : '')}
              onClick={() => setRetakeIn(retakeIn === r.days ? null : r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {retakeIn && (
          <input
            className="mb-input"
            maxLength={120}
            placeholder="Tema (opcional): su viaje, el proyecto…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        )}
      </section>

      {(askNext.length > 0 || follow.length > 0) && (
        <section>
          <h4>¿Ya le preguntaste?</h4>
          {follow.map((u) => (
            <label className="mb-check" key={u.id}>
              <input
                type="checkbox"
                checked={asked.includes('u:' + u.id)}
                onChange={() => toggleAsked('u:' + u.id)}
              />
              {u.text}
            </label>
          ))}
          {askNext.map((q) => (
            <label className="mb-check" key={q}>
              <input
                type="checkbox"
                checked={asked.includes('q:' + q)}
                onChange={() => toggleAsked('q:' + q)}
              />
              {q}
            </label>
          ))}
        </section>
      )}

      <footer className="mb-foot">
        <button type="button" className="cp-btn cta" disabled={busy} onClick={() => void save()}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Guardar cierre
        </button>
      </footer>
    </div>
  );
}
