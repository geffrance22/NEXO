import { useId, useState } from 'react';
import { Clapperboard, Minus, Plus, Tv } from 'lucide-react';
import { useApp } from '../../AppContext';
import { isSeries } from '../../lib/entries';
import { TagInput } from '../TagInput';
import { AutoTextarea, ChoiceChips, Label, Segmented, Stars } from '../controls';
import { DateChips } from '../DateChips';
import { PeoplePicker } from '../PeoplePicker';
import { MoviePoster } from '../MoviePoster';
import type { ViewProps } from './shared';

const platforms = ['Cine', 'Netflix', 'Prime Video', 'Disney+', 'Max', 'Otra'];

/** Película o serie: una ficha con póster, estado, calificación y reseña. */
export function MovieView({ c }: ViewProps) {
  const { workspace } = useApp();
  const list = useId();
  const [other, setOther] = useState(
    !!c.details.platform && !platforms.slice(0, -1).includes(c.details.platform),
  );
  const previous = [
    ...new Set(
      workspace.entries
        .filter((e) => e.kind === 'Película')
        .map((e) => e.details.platform)
        .filter((s): s is string => !!s && !platforms.includes(s)),
    ),
  ].sort();
  const series = isSeries({ kind: 'Película', tags: c.tags, details: c.details });
  // Lo detectó TMDB (o una etiqueta) y no lo elegiste tú.
  const detected = c.details.series === undefined && series;
  const raw = c.details.watch ?? 'vista';
  const watch = !series && raw === 'viendo' ? 'vista' : raw;
  const seasons = c.details.movieInfo?.type === 'tv' ? c.details.movieInfo.seasons : undefined;
  const season = c.details.seasonAt;
  const setSeason = (n: number | undefined) => {
    const next = n && n > 0 ? Math.min(n, seasons || 99) : undefined;
    // Al cambiar de temporada, el episodio vuelve a empezar.
    if (next !== season) c.setDetail('episodeAt', undefined);
    c.setDetail('seasonAt', next);
  };
  const episode = c.details.episodeAt;
  const setEpisode = (n: number | undefined) =>
    c.setDetail('episodeAt', n && n > 0 ? Math.min(n, 999) : undefined);

  const setType = (toSeries: boolean) => {
    c.setDetail('series', toSeries);
    if (!toSeries && raw === 'viendo') c.setDetail('watch', 'vista');
  };

  return (
    <div className="cp-media">
      <div className="cp-media-side">
        <MoviePoster c={c} />
      </div>
      <div className="cp-media-main">
        <div className="cp-mtype" role="radiogroup" aria-label="Película o serie">
          <button
            type="button"
            role="radio"
            aria-checked={!series}
            className={!series ? 'on' : ''}
            onClick={() => setType(false)}
          >
            <Clapperboard size={13} /> Película
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={series}
            className={series ? 'on' : ''}
            title={detected ? 'Detectada como serie' : undefined}
            onClick={() => setType(true)}
          >
            <Tv size={13} /> Serie
          </button>
          {detected && <small>detectada</small>}
        </div>
        <input
          className="cp-title-input"
          placeholder={series ? '¿Qué serie?' : '¿Qué película?'}
          maxLength={180}
          value={c.title}
          onChange={(e) => {
            c.setTitle(e.target.value);
            c.setDetail('movieInfo', undefined);
            c.setDetail('tmdbPoster', undefined);
            c.setDetail('year', undefined);
          }}
          aria-label={series ? 'Título de la serie' : 'Título de la película'}
          data-autofocus
        />
        <div className="cp-year-row">
          <ChoiceChips
            label="Dónde la viste"
            options={platforms}
            clearable
            value={other ? 'Otra' : c.details.platform}
            onChange={(v) => {
              setOther(v === 'Otra');
              c.setDetail('platform', v === 'Otra' ? '' : v);
            }}
          />
        </div>

        {other && (
          <label className="mp-platform">
            Otra plataforma
            <input
              autoFocus
              list={list}
              placeholder="Escribe dónde la viste…"
              maxLength={100}
              value={c.details.platform === 'Otra' ? '' : c.details.platform || ''}
              onChange={(e) => c.setDetail('platform', e.target.value)}
            />
            <datalist id={list}>
              {previous.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
        )}
        <Segmented
          label="Estado"
          value={watch}
          onChange={(v) => {
            c.setDetail('watch', v);
            // Fija «serie» para que «Viéndola» no se pierda si solo la deducía una etiqueta.
            if (v === 'viendo' && c.details.series === undefined) c.setDetail('series', true);
          }}
          options={
            series
              ? [
                  { value: 'quiero', label: 'Quiero verla' },
                  { value: 'viendo', label: 'Viéndola' },
                  { value: 'vista', label: 'Ya la vi' },
                ]
              : [
                  { value: 'quiero', label: 'Quiero verla' },
                  { value: 'vista', label: 'Ya la vi' },
                ]
          }
        />

        {watch === 'viendo' && (
          <div className="cp-season">
            <span>Vas en la temporada</span>
            <div>
              <button
                type="button"
                aria-label="Temporada anterior"
                disabled={!season || season <= 1}
                onClick={() => setSeason((season ?? 1) - 1)}
              >
                <Minus size={14} />
              </button>
              <input
                inputMode="numeric"
                placeholder="1"
                aria-label="Temporada"
                value={season ?? ''}
                onChange={(e) => setSeason(Number(e.target.value.replace(/\D/g, '')) || undefined)}
              />
              <button
                type="button"
                aria-label="Temporada siguiente"
                disabled={Boolean(seasons && season && season >= seasons)}
                onClick={() => setSeason((season ?? 0) + 1)}
              >
                <Plus size={14} />
              </button>
            </div>
            {seasons ? <small>de {seasons}</small> : null}
          </div>
        )}
        {watch === 'viendo' && (
          <div className="cp-season">
            <span>Episodio</span>
            <div>
              <button
                type="button"
                aria-label="Episodio anterior"
                disabled={!episode || episode <= 1}
                onClick={() => setEpisode((episode ?? 1) - 1)}
              >
                <Minus size={14} />
              </button>
              <input
                inputMode="numeric"
                placeholder="1"
                aria-label="Episodio"
                value={episode ?? ''}
                onChange={(e) => setEpisode(Number(e.target.value.replace(/\D/g, '')) || undefined)}
              />
              <button
                type="button"
                aria-label="Episodio siguiente"
                onClick={() => setEpisode((episode ?? 0) + 1)}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        )}

        {watch !== 'quiero' && (
          <>
            <Label>{watch === 'viendo' ? 'Lo que llevas' : 'Tu calificación'}</Label>
            <Stars
              label="Calificación"
              value={c.details.rating}
              onChange={(v) => c.setDetail('rating', v)}
            />
          </>
        )}
        {watch === 'vista' && (
          <>
            <Label>¿Cuándo la viste?</Label>
            <DateChips
              label="Fecha"
              options={['today', 'yesterday']}
              value={c.date}
              onChange={c.setDate}
            />
          </>
        )}

        <Label>{watch === 'quiero' ? '¿Por qué quieres verla?' : 'Tu reseña'}</Label>
        <AutoTextarea
          className="cp-soft-area"
          minRows={3}
          placeholder={
            watch === 'quiero'
              ? 'Lo que te llamó la atención…'
              : series
                ? '¿Qué te está pareciendo? ¿Qué personaje te atrapa?'
                : '¿Qué te dejó? ¿Qué escena recuerdas?'
          }
          value={c.body}
          onChange={(e) => c.setBody(e.target.value)}
          aria-label="Reseña"
        />
        <Label>{watch === 'quiero' ? 'Quién te la recomendó' : 'Con quién la viste'}</Label>
        <PeoplePicker api={c.people} variant="compact" />

        <Label>Etiquetas</Label>
        <TagInput tags={c.tags} onChange={c.setTags} placeholder="Añadir etiqueta…" />
      </div>
    </div>
  );
}
