import { useState, type CSSProperties } from 'react';
import { Check, Layers, LoaderCircle, Trash2, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { AutoTextarea, Label } from '../composer/controls';
import type { Episode, EpisodeInput, EpisodeKind, EpisodeOrigin } from '../data';
import { episodeKindList, episodeKinds, originLabel } from '../lib/episodes';
import { thousands, todayInputValue } from '../lib/format';
import './episodes.css';

/** Crear o editar un episodio: un viaje, una cena, un proyecto… con fechas, gente y presupuesto. */
export function EpisodeSheet({
  episode,
  init,
  from,
  onClose,
}: {
  episode?: Episode;
  init?: Partial<EpisodeInput>;
  /** El episodio nuevo nace de otro («se convirtió en», «es continuación de»…) y queda enlazado. */
  from?: EpisodeOrigin;
  onClose: () => void;
}) {
  const { workspace, saveEpisode, updateEpisode, removeEpisode, go } = useApp();
  const [d, setD] = useState<EpisodeInput>(() => ({
    title: episode?.title ?? init?.title ?? '',
    kind: episode?.kind ?? init?.kind ?? 'viaje',
    status: episode?.status ?? init?.status ?? 'activo',
    starts_on: episode?.starts_on ?? init?.starts_on ?? todayInputValue(),
    ends_on: episode?.ends_on ?? init?.ends_on ?? null,
    summary: episode?.summary ?? init?.summary ?? '',
    source: episode?.source ?? init?.source ?? '',
    person_ids: episode?.person_ids ?? init?.person_ids ?? [],
    place_ids: episode?.place_ids ?? init?.place_ids ?? [],
    budget: episode?.budget ?? init?.budget ?? null,
    outcome: episode?.outcome ?? init?.outcome ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EpisodeInput>(k: K, v: EpisodeInput[K]) =>
    setD((x) => ({ ...x, [k]: v }));
  const m = episodeKinds[d.kind];
  const badRange = Boolean(d.starts_on && d.ends_on && d.ends_on < d.starts_on);

  const submit = async () => {
    if (!d.title.trim() || busy || badRange) return;
    setBusy(true);
    const clean = {
      ...d,
      title: d.title.trim(),
      summary: d.summary.trim(),
      outcome: d.outcome.trim(),
    };
    if (episode) {
      if (await updateEpisode(episode, clean)) onClose();
    } else {
      const ep = await saveEpisode(clean);
      if (ep) {
        if (from) {
          const source = workspace.episodes.find((x) => x.id === from.episode.id) ?? from.episode;
          if (from.holder === 'new') {
            // «B es continuación de A»: lo guarda el nuevo.
            await updateEpisode(ep, { links: [{ id: source.id, kind: from.kind }] }, true);
          } else {
            // «A se convirtió en B»: lo guarda el de origen.
            await updateEpisode(
              source,
              {
                links: [
                  ...source.links.filter((l) => l.id !== ep.id),
                  { id: ep.id, kind: from.kind },
                ],
              },
              true,
            );
          }
        }
        onClose();
        go('Episodios', ep);
      }
    }
    setBusy(false);
  };

  const people = [...workspace.people].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return (
    <Sheet
      label={episode ? 'Editar episodio' : 'Nuevo episodio'}
      size="md"
      onRequestClose={onClose}
    >
      <form
        className="cp-composer ep-sheet"
        style={{ '--accent': m.color, '--soft': m.soft, '--ink': '#27301f' } as CSSProperties}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="cp-head">
          <span className="cp-kind-chip static">
            <Layers size={17} />
            <strong>{episode ? 'Editar episodio' : 'Nuevo episodio'}</strong>
          </span>
          <button type="button" className="cp-close" aria-label="Cerrar" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="cp-scroll">
          <input
            className="cp-title-input"
            placeholder="Viaje a Medellín, Cena de aniversario, Mudanza…"
            maxLength={120}
            value={d.title}
            autoFocus
            onChange={(e) => set('title', e.target.value)}
            aria-label="Nombre del episodio"
          />
          <Label>Tipo</Label>
          <div className="cp-chips">
            {episodeKindList.map((k) => {
              const km = episodeKinds[k];
              return (
                <button
                  type="button"
                  key={k}
                  className={'cp-chip' + (d.kind === k ? ' on' : '')}
                  onClick={() => set('kind', k as EpisodeKind)}
                >
                  <km.icon size={14} /> {km.label}
                </button>
              );
            })}
          </div>
          <div className="cp-two">
            <div>
              <Label>Desde</Label>
              <input
                type="date"
                className="cp-ghost-input"
                value={d.starts_on ?? ''}
                onChange={(e) => set('starts_on', e.target.value || null)}
              />
            </div>
            <div>
              <Label hint="Opcional">Hasta</Label>
              <input
                type="date"
                className="cp-ghost-input"
                value={d.ends_on ?? ''}
                onChange={(e) => set('ends_on', e.target.value || null)}
              />
            </div>
          </div>
          {badRange && <p className="cp-notice error">La fecha final es anterior a la inicial.</p>}
          <Label>Estado</Label>
          <div className="cp-chips">
            {(['activo', 'cerrado'] as const).map((s) => (
              <button
                type="button"
                key={s}
                className={'cp-chip' + (d.status === s ? ' on' : '')}
                onClick={() => set('status', s)}
              >
                {s === 'activo' ? 'En curso' : 'Cerrado'}
              </button>
            ))}
          </div>
          <Label hint="Se suman también las de sus recuerdos">Personas</Label>
          <div className="cp-chips">
            {people.map((p) => {
              const on = d.person_ids.includes(p.id);
              // Con muchas personas se muestran las elegidas y las favoritas; el resto, en la lista.
              if (people.length > 24 && !on && !p.profile.favorite) return null;
              return (
                <button
                  type="button"
                  key={p.id}
                  className={'cp-chip' + (on ? ' on' : '')}
                  onClick={() =>
                    set(
                      'person_ids',
                      on ? d.person_ids.filter((x) => x !== p.id) : [...d.person_ids, p.id],
                    )
                  }
                >
                  {p.name.split(' ')[0]}
                </button>
              );
            })}
            {people.length > 24 && (
              <select
                className="ep-select"
                value=""
                onChange={(e) =>
                  e.target.value &&
                  set('person_ids', [...new Set([...d.person_ids, e.target.value])])
                }
              >
                <option value="">+ Otra persona</option>
                {people
                  .filter((p) => !d.person_ids.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
          {workspace.places.length > 0 && (
            <>
              <Label>Lugares</Label>
              <div className="cp-chips">
                {workspace.places.map((pl) => {
                  const on = d.place_ids.includes(pl.id);
                  return (
                    <button
                      type="button"
                      key={pl.id}
                      className={'cp-chip' + (on ? ' on' : '')}
                      onClick={() =>
                        set(
                          'place_ids',
                          on ? d.place_ids.filter((x) => x !== pl.id) : [...d.place_ids, pl.id],
                        )
                      }
                    >
                      {pl.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <Label hint="Opcional · se compara con lo que gastes">Presupuesto</Label>
          <label className="cp-pill-input ep-budget">
            <span>$</span>
            <input
              inputMode="numeric"
              placeholder="0"
              value={d.budget ? thousands(d.budget) : ''}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, ''));
                set('budget', n || null);
              }}
            />
          </label>
          <Label>De qué se trata</Label>
          <AutoTextarea
            className="cp-soft-area"
            minRows={2}
            maxLength={4000}
            placeholder="Objetivo, contexto, decisiones previas…"
            value={d.summary}
            onChange={(e) => set('summary', e.target.value)}
          />
          <Label hint="Lo que salió, decisiones, aprendizajes">Resultado</Label>
          <AutoTextarea
            className="cp-soft-area"
            minRows={2}
            maxLength={4000}
            placeholder="¿Cómo terminó? ¿Qué harías distinto?"
            value={d.outcome}
            onChange={(e) => set('outcome', e.target.value)}
          />
        </div>
        <footer className="cp-foot">
          {episode ? (
            <button
              type="button"
              className="cp-btn ghost ep-danger"
              onClick={() => {
                onClose();
                removeEpisode(episode);
              }}
            >
              <Trash2 size={15} /> Eliminar
            </button>
          ) : (
            <span className="cp-status">
              {from
                ? `${originLabel(from)} «${from.episode.title}»`
                : 'Luego podrás añadirle recuerdos, gastos y pendientes.'}
            </span>
          )}
          <button type="button" className="cp-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="cp-btn cta" disabled={!d.title.trim() || busy || badRange}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{' '}
            {episode ? 'Guardar' : 'Crear episodio'}
          </button>
        </footer>
      </form>
    </Sheet>
  );
}
