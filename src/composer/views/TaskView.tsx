import { useState, type CSSProperties } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { commitmentKindList, commitmentKinds, MISSED_ONE } from '../../lib/commitments';
import { AutoTextarea, Label, PriorityPicker } from '../controls';
import { DateChips } from '../DateChips';
import { PeoplePicker } from '../PeoplePicker';
import type { ViewProps } from './shared';

/** Pendiente: lo más rápido de todos; escribe, elige cuándo y listo. */
export function TaskView({ c }: ViewProps) {
  const [more, setMore] = useState(c.body.trim().length > 0);
  const done = c.status === 'completado';
  // No realizado: se conserva al editar (y la casilla lo reabre, como con uno hecho).
  const missed = c.status === 'no_realizado';
  const kind = c.details.commitment ?? 'quiero';

  return (
    <div className="cp-task">
      <div className="cp-task-head" data-enter-saves>
        <button
          type="button"
          className={'cp-check' + (done ? ' done' : '') + (missed ? ' missed' : '')}
          aria-pressed={done}
          aria-label={done || missed ? 'Marcar como pendiente' : 'Marcar como completado'}
          title={
            missed
              ? `${MISSED_ONE}${c.details.missed?.why ? ` · ${c.details.missed.why}` : ''}. Tócalo para reabrirlo.`
              : undefined
          }
          onClick={() => {
            if (missed) {
              // Reabrirlo quita también la razón de por qué no se hizo.
              c.setDetail('missed', undefined);
              c.setStatus('pendiente');
            } else c.setStatus(done ? 'pendiente' : 'completado');
          }}
        >
          {missed ? <Minus size={20} strokeWidth={3} /> : <Check size={20} strokeWidth={3} />}
        </button>
        <input
          className={'cp-task-input' + (done ? ' done' : '')}
          placeholder="¿Qué tienes que hacer?"
          maxLength={180}
          value={c.title}
          onChange={(e) => c.setTitle(e.target.value)}
          aria-label="Pendiente"
          data-autofocus
        />
      </div>

      <Label>¿Para cuándo?</Label>
      <DateChips
        label="Fecha límite"
        options={['today', 'tomorrow', 'weekend', 'nextweek', 'none']}
        value={c.details.due ?? ''}
        onChange={(v) => c.setDetail('due', v || undefined)}
      />

      <Label hint="Cada tipo se sigue distinto en tu agenda">¿Qué clase de compromiso?</Label>
      <div className="cp-commit" role="radiogroup" aria-label="Tipo de compromiso">
        {commitmentKindList.map((k) => {
          const m = commitmentKinds[k];
          const on = kind === k;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={on}
              key={k}
              className={on ? 'on' : ''}
              style={{ '--c': m.color, '--s': m.soft } as CSSProperties}
              onClick={() => c.setDetail('commitment', k)}
            >
              <m.icon size={16} />
              {m.label}
            </button>
          );
        })}
      </div>

      <Label>Prioridad</Label>
      <PriorityPicker
        value={c.details.priority ?? 'media'}
        onChange={(v) => c.setDetail('priority', v)}
      />

      <Label hint={kind === 'quiero' ? 'Opcional' : 'La primera es la persona clave'}>
        {commitmentKinds[kind].who}
      </Label>
      <PeoplePicker api={c.people} variant="compact" />

      {more ? (
        <>
          <Label>Detalle</Label>
          <AutoTextarea
            className="cp-soft-area"
            minRows={3}
            placeholder="Notas, pasos, enlaces…"
            value={c.body}
            onChange={(e) => c.setBody(e.target.value)}
            aria-label="Detalle"
          />
        </>
      ) : (
        <button type="button" className="cp-add-line" onClick={() => setMore(true)}>
          <Plus size={15} /> Añadir detalle
        </button>
      )}
    </div>
  );
}
