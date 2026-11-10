import { useState } from "react";
import { AtSign, Hash, MapPin, Redo2, Undo2 } from "lucide-react";
import { askEntry } from "../../assistant";
import { MoodPicker } from "../controls";
import { DateChips } from "../DateChips";
import { PeopleField, PlaceField, useLinks } from "../LinkFields";
import { PhotoButton, PhotoStrip } from "../PhotoBlocks";
import { RichTextarea } from "../RichTextarea";
import { TagInput } from "../TagInput";
import { historyKeys, useTextHistory } from "../useTextHistory";
import { DocBlock, type ViewProps } from "./shared";

/**
 * Entrada del diario: una hoja en blanco para escribir sin distracciones. Al seleccionar texto
 * puedes preguntarle o pedirle algo a la IA sobre ese fragmento. Lo demás aparece cuando lo necesitas.
 */
export function NoteView({ c }: ViewProps) {
  const links = useLinks(c);
  const history = useTextHistory(c.body, c.setBody);
  const [showTags, setShowTags] = useState(c.tags.length > 0);
  const words = c.body.trim() ? c.body.trim().split(/\s+/).length : 0;
  const hasPeople =
    c.people.selected.length > 0 ||
    c.people.suggested.length > 0 ||
    c.people.cues.length > 0;
  const hasPlace = Boolean(c.details.place);
  const actions = {
    ...links.actions,
    ask: (selection: string, prompt: string) =>
      askEntry({ selection, prompt, text: c.body, title: c.title }),
  };

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
      <div className="cp-note-page">
        <RichTextarea
          className="cp-writing"
          minRows={9}
          label="Tu entrada"
          placeholder="¿Qué pasó hoy? Escribe con calma… Selecciona texto para resaltarlo, vincular a alguien o preguntarle a la IA."
          value={c.body}
          onChange={c.setBody}
          names={links.names}
          actions={actions}
          history={history}
          autoFocusTarget
        />
      </div>
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
        <MoodPicker
          label="Ánimo"
          value={c.details.mood}
          onChange={(v) => c.setDetail("mood", v)}
        />
      </div>
      <div className="cp-tray">
        <PhotoButton uploads={c.uploads} label="Foto" />
        <button
          type="button"
          className={"cp-tray-btn" + (hasPeople ? " on" : "")}
          onClick={links.openPeople}
        >
          <AtSign size={17} />
          Personas
          {c.people.selected.length > 0 && <b>{c.people.selected.length}</b>}
        </button>
        <button
          type="button"
          className={"cp-tray-btn" + (hasPlace ? " on" : "")}
          onClick={links.openPlace}
        >
          <MapPin size={17} />
          Lugar
        </button>
        <button
          type="button"
          className={"cp-tray-btn" + (showTags ? " on" : "")}
          onClick={() => setShowTags((v) => !v)}
          aria-expanded={showTags}
        >
          <Hash size={17} />
          Etiquetas
          {c.tags.length > 0 && <b>{c.tags.length}</b>}
        </button>
        <span className="cp-tray-spacer" />
        <span
          className="cp-history"
          role="group"
          aria-label="Historial de la entrada"
        >
          <button
            type="button"
            className="cp-history-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={history.undo}
            disabled={!history.canUndo}
            title={`Deshacer (${historyKeys.undo})`}
            aria-label="Deshacer"
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="cp-history-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={history.redo}
            disabled={!history.canRedo}
            title={`Rehacer (${historyKeys.redo})`}
            aria-label="Rehacer"
          >
            <Redo2 size={16} />
          </button>
        </span>
        <span className="cp-count">
          {words} {words === 1 ? "palabra" : "palabras"}
        </span>
      </div>
      {showTags && <TagInput tags={c.tags} onChange={c.setTags} />}
      <div className="cp-note-foot">
        <div className="cp-note-when">
          <span>Fecha</span>
          <DateChips
            label="Fecha"
            options={["today", "yesterday"]}
            value={c.date}
            onChange={c.setDate}
          />
        </div>
        <DocBlock c={c} />
      </div>
      {links.dialogs}
    </div>
  );
}
