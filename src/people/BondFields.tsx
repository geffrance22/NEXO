import { useEffect, useRef, useState } from 'react';
import { History, MapPin, Repeat, Telescope, UserRound, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { PeopleDialog, type PeopleChoice } from '../composer/PeopleDialog';
import type { BondDetail, ClientStage, Person, TieKind } from '../data';
import { clientStages } from '../lib/relations';

const stageIcons: Record<ClientStage, typeof Repeat> = {
  potencial: Telescope,
  recurrente: Repeat,
  anterior: History,
};

/** Un texto sin caja: aparece solo al tocar su palabra («Dónde», «Definirla»). */
function QuietInput({
  value,
  placeholder,
  label,
  autoFocus,
  onChange,
}: {
  value: string;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      className="ps-quiet"
      value={value}
      maxLength={120}
      placeholder={placeholder}
      aria-label={label}
      size={Math.max(placeholder.length, value.length, 8)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * El detalle de lo que es para ti, según el vínculo elegido: quién te la presentó, dónde son
 * vecinos o qué clase de cliente es. Solo palabras: nada de cajas hasta que las tocas.
 */
export function BondFields({
  kind,
  bond,
  self,
  onChange,
}: {
  kind: TieKind | null;
  bond: BondDetail;
  /** La persona de la ficha (no puede presentarse a sí misma). */
  self?: string;
  onChange: (b: BondDetail) => void;
}) {
  const { workspace } = useApp();
  const [picking, setPicking] = useState(false);
  const [whereOpen, setWhereOpen] = useState(Boolean(bond.where));
  const by = bond.by ? workspace.people.find((p) => p.id === bond.by) : undefined;

  if (kind === 'presentado') {
    const api: PeopleChoice = {
      all: workspace.people.filter((p) => p.id !== self),
      selected: bond.by ? [bond.by] : [],
      suggested: [] as Person[],
      // Una sola persona: elegirla la deja y cierra la ventana.
      toggle: (id) => {
        onChange({ ...bond, by: bond.by === id ? undefined : id });
        setPicking(false);
      },
      accept: (id) => {
        onChange({ ...bond, by: id });
        setPicking(false);
      },
      dismiss: () => {},
      autoLink: false,
    };
    return (
      <div className="ps-bond">
        {by ? (
          <span className="ps-bond-val">
            Nos presentó{' '}
            <button type="button" className="ps-quiet-btn strong" onClick={() => setPicking(true)}>
              {by.name.split(' ')[0]}
            </button>
            <button
              type="button"
              className="ps-bond-x"
              aria-label="Quitar quién te la presentó"
              onClick={() => onChange({ ...bond, by: undefined })}
            >
              <X size={12} />
            </button>
          </span>
        ) : (
          <button type="button" className="ps-quiet-btn" onClick={() => setPicking(true)}>
            <UserRound size={13} /> ¿Quién?
          </button>
        )}
        {picking && (
          <PeopleDialog
            api={api}
            title="¿Quién te la presentó?"
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    );
  }

  if (kind === 'vecino')
    return (
      <div className="ps-bond">
        {whereOpen || bond.where ? (
          <span className="ps-bond-val">
            <MapPin size={13} />
            <QuietInput
              value={bond.where ?? ''}
              placeholder="Barrio, dirección o lugar"
              label="Dónde son vecinos"
              autoFocus={!bond.where}
              onChange={(where) => onChange({ ...bond, where: where || undefined })}
            />
          </span>
        ) : (
          <button type="button" className="ps-quiet-btn" onClick={() => setWhereOpen(true)}>
            <MapPin size={13} /> Dónde
          </button>
        )}
      </div>
    );

  if (kind === 'cliente')
    return (
      <div className="ps-bond" role="radiogroup" aria-label="Qué clase de cliente">
        {(Object.keys(clientStages) as ClientStage[]).map((s) => {
          const Icon = stageIcons[s];
          const on = bond.client === s;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={on}
              key={s}
              className={'ps-quiet-btn' + (on ? ' on' : '')}
              onClick={() => onChange({ ...bond, client: on ? undefined : s })}
            >
              <Icon size={13} /> {clientStages[s]}
            </button>
          );
        })}
      </div>
    );

  if (kind === 'otro' && bond.label !== undefined)
    return (
      <div className="ps-bond">
        <QuietInput
          value={bond.label}
          placeholder="Escríbela: padrino, compadre, ex jefe…"
          label="Qué es para ti"
          autoFocus={!bond.label}
          onChange={(label) => onChange({ ...bond, label })}
        />
      </div>
    );

  return null;
}
