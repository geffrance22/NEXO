import { Lightbulb } from 'lucide-react';
import { AutoTextarea, ChoiceChips, ConfidenceDots, Label } from '../controls';
import { PhotoStrip } from '../PhotoBlocks';
import { TagInput } from '../TagInput';
import { DocBlock, type ViewProps } from './shared';

const sources = ['Libro', 'Curso', 'Video', 'Artículo', 'Persona', 'Práctica'];

/** Aprendizaje: una tarjeta de estudio con la idea clave. */
export function LearningView({ c }: ViewProps) {
  return (
    <div className="cp-learn">
      <div className="cp-eyebrow">HOY APRENDÍ</div>
      <input
        className="cp-title-input big"
        placeholder="Un tema, una idea…"
        maxLength={180}
        value={c.title}
        onChange={(e) => c.setTitle(e.target.value)}
        aria-label="Qué aprendiste"
        data-autofocus
      />

      <div className="cp-idea">
        <Lightbulb size={20} />
        <div>
          <span>La idea clave</span>
          <AutoTextarea
            minRows={3}
            placeholder="Explícalo con tus palabras, como si se lo contaras a alguien…"
            value={c.body}
            onChange={(e) => c.setBody(e.target.value)}
            aria-label="La idea clave"
          />
        </div>
      </div>

      <Label>¿De dónde viene?</Label>
      <ChoiceChips
        label="Fuente"
        options={sources}
        clearable
        value={c.details.source}
        onChange={(v) => c.setDetail('source', v)}
      />
      {c.details.source && (
        <input
          className="cp-ghost-input"
          value={c.details.sourceName ?? ''}
          maxLength={120}
          placeholder={`Nombre${c.details.source === 'Persona' ? ' de quien te lo enseñó' : ' (título, canal, curso…)'}`}
          onChange={(e) => c.setDetail('sourceName', e.target.value)}
          aria-label="Nombre de la fuente"
        />
      )}

      <Label>¿Cómo lo aplicarás?</Label>
      <input
        className="cp-ghost-input"
        value={c.details.apply ?? ''}
        maxLength={200}
        placeholder="Lo primero que harás con esto"
        onChange={(e) => c.setDetail('apply', e.target.value)}
        aria-label="Cómo lo aplicarás"
      />

      <Label>¿Qué tan bien lo entendiste?</Label>
      <ConfidenceDots value={c.details.confidence} onChange={(v) => c.setDetail('confidence', v)} />

      <Label hint="Opcional">Capturas</Label>
      <PhotoStrip uploads={c.uploads} addLabel="Añadir capturas" />

      <Label hint="Opcional">Etiquetas</Label>
      <TagInput tags={c.tags} onChange={c.setTags} />
      <DocBlock c={c} />
    </div>
  );
}
