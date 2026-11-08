import { ArrowRight } from 'lucide-react';
import { AutoTextarea, Label, PriorityPicker, Segmented } from '../controls';
import { DateChips } from '../DateChips';
import { PeoplePicker } from '../PeoplePicker';
import { PhotoStrip } from '../PhotoBlocks';
import { DocBlock, type ViewProps } from './shared';

/** Trabajo: una ficha de proyecto con etapa, siguiente paso y prioridad. */
export function WorkView({ c }: ViewProps) {
  return (
    <div className="cp-work">
      <Segmented
        label="Etapa del proyecto"
        value={c.details.stage ?? 'curso'}
        onChange={(v) => c.setDetail('stage', v)}
        options={[
          { value: 'idea', label: 'Idea' },
          { value: 'curso', label: 'En curso' },
          { value: 'pausa', label: 'En pausa' },
          { value: 'listo', label: 'Terminado' },
        ]}
      />

      <input
        className="cp-title-input"
        placeholder="¿En qué trabajas?"
        maxLength={180}
        value={c.title}
        onChange={(e) => c.setTitle(e.target.value)}
        aria-label="Proyecto o tarea"
        data-autofocus
      />

      <div className="cp-next">
        <span className="cp-next-icon">
          <ArrowRight size={18} />
        </span>
        <label>
          <span>Siguiente paso</span>
          <input
            value={c.details.nextStep ?? ''}
            maxLength={200}
            placeholder="Lo próximo que hay que hacer"
            onChange={(e) => c.setDetail('nextStep', e.target.value)}
          />
        </label>
      </div>

      <div className="cp-two">
        <div>
          <Label>Prioridad</Label>
          <PriorityPicker
            value={c.details.priority ?? 'media'}
            onChange={(v) => c.setDetail('priority', v)}
          />
        </div>
        <div>
          <Label>Fecha límite</Label>
          <DateChips
            label="Fecha límite"
            options={['none', 'today', 'tomorrow', 'weekend', 'nextweek']}
            value={c.details.due ?? ''}
            onChange={(v) => c.setDetail('due', v || undefined)}
          />
        </div>
      </div>

      <Label>Quién participa</Label>
      <PeoplePicker api={c.people} variant="compact" />

      <Label>Notas</Label>
      <AutoTextarea
        className="cp-soft-area"
        minRows={3}
        placeholder="Contexto, decisiones, enlaces…"
        value={c.body}
        onChange={(e) => c.setBody(e.target.value)}
        aria-label="Notas"
      />

      <Label hint="Opcional">Capturas y documentos</Label>
      <PhotoStrip uploads={c.uploads} addLabel="Añadir capturas" />
      <DocBlock c={c} />
    </div>
  );
}
