import { useState } from 'react';
import { AtSign, Hash, MapPin } from 'lucide-react';
import { MoodPicker } from '../controls';
import { DateChips } from '../DateChips';
import { PeopleField, PlaceField, useLinks } from '../LinkFields';
import { PhotoButton, PhotoStrip } from '../PhotoBlocks';
import { RichTextarea } from '../RichTextarea';
import { TagInput } from '../TagInput';
import { DocBlock, type ViewProps } from './shared';

/** Nota: una hoja en blanco para escribir sin distracciones. Lo demás aparece cuando lo necesitas. */
export function NoteView({ c }: ViewProps) {
  const links = useLinks(c);
  const [showTags, setShowTags] = useState(c.tags.length > 0);
  const words = c.body.trim() ? c.body.trim().split(/\s+/).length : 0;
  const hasPeople =
    c.people.selected.length > 0 || c.people.suggested.length > 0 || c.people.cues.length > 0;
  const hasPlace = Boolean(c.details.place);

  return (
    <div className="cp-note">
      <input
        className="cp-title-input"
        placeholder="Título (opcional)"
        maxLength={180}
        value={c.title}
        onChange={(e) => c.setTitle(e.target.value)}
        aria-label="Título"
      />
      <RichTextarea
        className="cp-writing"
        minRows={9}
        label="Tu nota"
        placeholder="Empieza a escribir… Selecciona texto para resaltarlo, tacharlo o vincular a alguien."
        value={c.body}
        onChange={c.setBody}
        names={links.names}
        actions={links.actions}
        autoFocusTarget
      />
      {(hasPeople || hasPlace) && (
        <div className="lf-row">
          {hasPeople && <PeopleField c={c} links={links} compact />}
          {hasPlace && <PlaceField c={c} links={links} />}
        </div>
      )}
      {c.uploads.items.length > 0 ? (
        <PhotoStrip uploads={c.uploads} />
      ) : (
        c.uploads.notice && <p className="cp-notice">{c.uploads.notice}</p>
      )}
      <div className="cp-note-mood">
        <span>¿Cómo te sientes?</span>
        <MoodPicker label="Ánimo" value={c.details.mood} onChange={(v) => c.setDetail('mood', v)} />
      </div>
      <div className="cp-tray">
        <PhotoButton uploads={c.uploads} label="Foto" />
        <button
          type="button"
          className={'cp-tray-btn' + (hasPeople ? ' on' : '')}
          onClick={links.openPeople}
        >
          <AtSign size={17} />
          Personas
          {c.people.selected.length > 0 && <b>{c.people.selected.length}</b>}
        </button>
        <button
          type="button"
          className={'cp-tray-btn' + (hasPlace ? ' on' : '')}
          onClick={links.openPlace}
        >
          <MapPin size={17} />
          Lugar
        </button>
        <button
          type="button"
          className={'cp-tray-btn' + (showTags ? ' on' : '')}
          onClick={() => setShowTags((v) => !v)}
          aria-expanded={showTags}
        >
          <Hash size={17} />
          Etiquetas
          {c.tags.length > 0 && <b>{c.tags.length}</b>}
        </button>
        <span className="cp-tray-spacer" />
        <span className="cp-count">
          {words} {words === 1 ? 'palabra' : 'palabras'}
        </span>
      </div>
      {showTags && <TagInput tags={c.tags} onChange={c.setTags} />}
      <div className="cp-note-when">
        <span>Fecha</span>
        <DateChips
          label="Fecha"
          options={['today', 'yesterday']}
          value={c.date}
          onChange={c.setDate}
        />
      </div>
      <DocBlock c={c} />
      {links.dialogs}
    </div>
  );
}
