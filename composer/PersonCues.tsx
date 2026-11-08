import { useState } from 'react';
import { Check, LoaderCircle, Sparkles, UserPlus, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { genderOf } from '../lib/gender';
import { cueSaved } from '../lib/recognize';
import type { ComposerApi, PeopleCue } from './useComposer';

type PeopleApi = ComposerApi['people'];
const SUGGESTED = 5;

/**
 * Preguntas sobre las personas del texto: «¿Quién es tu mamá?», «¿Carlos es tu tío?»,
 * «¿Rosa es tu tía?» (persona nueva) o «¿Cuál Laura?». Al responder se vincula al recuerdo y,
 * si es un parentesco, el vínculo queda guardado para la próxima vez.
 */
export function PersonCues({ api }: { api: PeopleApi }) {
  if (!api.cues.length) return null;
  return (
    <div className="lf-cues">
      {api.cues.map((c) => (
        <CueRow key={c.key} cue={c} api={api} />
      ))}
    </div>
  );
}

function CueRow({ cue, api }: { cue: PeopleCue; api: PeopleApi }) {
  const { workspace, saveTie, patchPerson, createPerson, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const kin = cue.kin;
  const byId = new Map(workspace.people.map((p) => [p.id, p]));

  const resolve = async (id: string, created = false) => {
    let person = byId.get(id);
    if (!person && !created) return;
    setBusy(true);
    api.accept(id);
    if (kin) {
      // «Tú» o la otra persona es el dueño: la elegida es <vínculo> de él.
      const tie = await saveTie({ a: id, b: kin.owner, kind: kin.kind }, true);
      person = person ?? workspace.people.find((p) => p.id === id);
      if (person && kin.gender && !person.profile.gender)
        await patchPerson(person, { profile: { ...person.profile, gender: kin.gender } }, true);
      if (tie && person) notify(cueSaved(kin, person.name.split(' ')[0]));
    }
    api.dismissCue(cue.key);
    setBusy(false);
  };

  const create = async () => {
    if (!kin?.newName) return;
    setBusy(true);
    const p = await createPerson(kin.newName);
    if (!p) return setBusy(false);
    if (kin.gender) await patchPerson(p, { profile: { ...p.profile, gender: kin.gender } }, true);
    const tie = await saveTie({ a: p.id, b: kin.owner, kind: kin.kind }, true);
    api.accept(p.id);
    if (tie) notify(`${p.name.split(' ')[0]} quedó en tu universo como ${kin.label}.`);
    api.dismissCue(cue.key);
    setBusy(false);
  };

  const single = kin?.status === 'confirm' && cue.options.length === 1;
  const top = cue.options.slice(0, SUGGESTED);
  const rest = cue.options.slice(SUGGESTED);
  const label = (id: string) => {
    const p = byId.get(id);
    if (!p) return '?';
    const g = genderOf(p);
    return p.name + (kin?.gender && g && g !== kin.gender ? ' (otro sexo)' : '');
  };

  return (
    <div className={'lf-cue' + (kin ? ' kin' : '')}>
      <Sparkles size={13} />
      <span className="lf-cue-q">{cue.question}</span>
      {busy ? (
        <LoaderCircle className="spin" size={14} />
      ) : kin?.newName ? (
        <button type="button" className="lf-cue-yes" onClick={() => void create()}>
          <UserPlus size={13} /> Crear y vincular
        </button>
      ) : single ? (
        <button type="button" className="lf-cue-yes" onClick={() => void resolve(cue.options[0])}>
          <Check size={13} /> Sí, guardar
        </button>
      ) : (
        <select
          className="lf-cue-pick"
          value=""
          aria-label={cue.question}
          onChange={(e) => e.target.value && void resolve(e.target.value)}
        >
          <option value="">Elegir…</option>
          {rest.length ? (
            <>
              <optgroup label="Más probables">
                {top.map((id) => (
                  <option key={id} value={id}>
                    {label(id)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Todas">
                {rest.map((id) => (
                  <option key={id} value={id}>
                    {label(id)}
                  </option>
                ))}
              </optgroup>
            </>
          ) : (
            top.map((id) => (
              <option key={id} value={id}>
                {label(id)}
              </option>
            ))
          )}
        </select>
      )}
      <button
        type="button"
        className="lf-cue-x"
        aria-label="Ahora no"
        title="Ahora no"
        onClick={() => api.dismissCue(cue.key)}
      >
        <X size={12} />
      </button>
    </div>
  );
}
