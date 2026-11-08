import { ChoiceChips, Label, MoodPicker } from '../controls';
import { DateChips } from '../DateChips';
import { PeopleField, PlaceField, useLinks } from '../LinkFields';
import { PhotoStrip } from '../PhotoBlocks';
import { RichTextarea } from '../RichTextarea';
import { TagInput } from '../TagInput';
import type { ViewProps } from './shared';

const activities = [
  'Café',
  'Comida',
  'Fiesta',
  'Visita',
  'Paseo',
  'Viaje',
  'Llamada',
  'Videollamada',
  'Trabajo',
  'Deporte',
];

/** Encuentro: con quién, dónde y cuándo; luego qué hicieron, el título, cómo estuvo y lo que quedó. */
export function MeetingView({ c }: ViewProps) {
  const links = useLinks(c);
  return (
    <div className="cp-meet">
      <Label>¿Con quién?</Label>
      <PeopleField c={c} links={links} />

      <div className="cp-two mt-where">
        <div>
          <Label>¿Dónde?</Label>
          <PlaceField c={c} links={links} />
        </div>
        <div>
          <Label>¿Cuándo?</Label>
          <DateChips
            label="Fecha"
            options={['today', 'yesterday']}
            value={c.date}
            onChange={c.setDate}
          />
        </div>
      </div>

      <Label hint="Opcional">¿Qué hicieron?</Label>
      <ChoiceChips
        label="Qué hicieron"
        options={activities}
        clearable
        value={c.details.activity}
        onChange={(v) => c.setDetail('activity', v)}
      />

      <input
        className="cp-title-input mt-title"
        value={c.title}
        maxLength={180}
        placeholder={c.suggestedTitle}
        onChange={(e) => c.setTitle(e.target.value)}
        aria-label="Título (opcional)"
      />

      <Label>¿Cómo estuvo?</Label>
      <MoodPicker
        label="Cómo estuvo"
        value={c.details.mood}
        onChange={(v) => c.setDetail('mood', v)}
      />

      <Label hint="Selecciona texto para resaltar, tachar o vincular">Lo que quedó</Label>
      <RichTextarea
        className="cp-soft-area"
        minRows={4}
        label="Lo que quedó"
        placeholder="¿De qué hablaron? ¿Algo que quieras recordar?"
        value={c.body}
        onChange={c.setBody}
        names={links.names}
        actions={links.actions}
        autoFocusTarget
      />

      <Label hint="Opcional">Fotos del momento</Label>
      <PhotoStrip uploads={c.uploads} addLabel="Añadir fotos" />

      <Label hint="Opcional">Etiquetas</Label>
      <TagInput tags={c.tags} onChange={c.setTags} />
      {links.dialogs}
    </div>
  );
}
