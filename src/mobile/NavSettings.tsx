import { useMemo, useState } from 'react';
import { Check, ChevronRight, House, PanelBottom, Plus, RotateCcw, Search, X } from 'lucide-react';
import { Sheet } from '../components/Sheet';
import { normalizeText } from '../lib/format';
import { MyFace } from '../people/MyFace';
import { useNavSlots } from './navSlots';
import { shortcutGroups, shortcutOf, shortcuts } from './shortcuts';

/** Qué número de botón es cada acceso editable (el 1.º, el 3.º y el 5.º son fijos). */
const slotNumber = (slot: 0 | 1) => (slot === 0 ? 2 : 4);

/**
 * Configuración (solo en el celular): qué abren el 2.º y el 4.º botón de la barra inferior. Se
 * aplica al instante y se guarda.
 */
export function NavSettings() {
  const { slots, setSlot, reset, isDefault } = useNavSlots();
  const [picking, setPicking] = useState<0 | 1 | null>(null);
  const chosen = slots.map(shortcutOf);
  const editable = (slot: 0 | 1) => {
    const s = chosen[slot];
    return s ? (
      <button
        type="button"
        className="mnav-slot"
        aria-label={`Cambiar el botón ${slotNumber(slot)}: ${s.name}`}
        onClick={() => setPicking(slot)}
      >
        <s.icon size={19} />
        <small>{s.label}</small>
      </button>
    ) : (
      <span />
    );
  };

  return (
    <section className="panel mnav-set" aria-labelledby="mnav-set-title">
      <PanelBottom size={23} />
      <h2 id="mnav-set-title">Barra inferior</h2>
      <p>
        Elige qué abren el 2.º y el 4.º botón: una sección, una de sus pestañas o una acción. Mi
        espacio, «+» y tu perfil quedan fijos.
      </p>

      <div className="mnav-preview" role="group" aria-label="Así se ve tu barra">
        <span className="mnav-fixed">
          <House size={19} />
          <small>Mi espacio</small>
        </span>
        {editable(0)}
        <span className="mnav-fixed add" aria-hidden="true">
          <span>
            <Plus size={19} strokeWidth={2.4} />
          </span>
        </span>
        {editable(1)}
        <span className="mnav-fixed">
          <span className="mnav-face">
            <MyFace size={22} />
          </span>
          <small>Perfil</small>
        </span>
      </div>

      <div className="mnav-rows">
        {([0, 1] as const).map((slot) => {
          const s = chosen[slot];
          if (!s) return null;
          return (
            <button type="button" key={slot} className="mnav-row" onClick={() => setPicking(slot)}>
              <span className="mnav-row-ico">
                <s.icon size={18} />
              </span>
              <span className="mnav-row-text">
                <small>Botón {slotNumber(slot)}</small>
                <strong>{s.name}</strong>
              </span>
              <span className="mnav-row-go">
                Cambiar <ChevronRight size={15} />
              </span>
            </button>
          );
        })}
      </div>

      {!isDefault && (
        <button type="button" className="mnav-reset" onClick={reset}>
          <RotateCcw size={14} /> Volver a los de siempre
        </button>
      )}

      {picking !== null && (
        <ShortcutPicker
          slot={picking}
          current={slots[picking]}
          other={slots[picking === 0 ? 1 : 0]}
          onPick={(id) => {
            setSlot(picking, id);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </section>
  );
}

/** Todas las secciones, pestañas y acciones, por grupos y con buscador. */
function ShortcutPicker({
  slot,
  current,
  other,
  onPick,
  onClose,
}: {
  slot: 0 | 1;
  current: string;
  other: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const needle = normalizeText(query.trim());
  const groups = useMemo(
    () =>
      shortcutGroups
        .map((g) => ({
          ...g,
          items: shortcuts.filter(
            (s) =>
              s.group === g.id &&
              (!needle || normalizeText(`${s.name} ${s.label} ${g.label}`).includes(needle)),
          ),
        }))
        .filter((g) => g.items.length > 0),
    [needle],
  );
  const otherNumber = slotNumber(slot === 0 ? 1 : 0);

  return (
    <Sheet label={`Elegir el botón ${slotNumber(slot)}`} className="mnav-pick" onRequestClose={onClose}>
      <header className="mnav-pick-head">
        <div>
          <h3>Botón {slotNumber(slot)}</h3>
          <p>¿Qué quieres tener a un toque?</p>
        </div>
        <button type="button" className="bn-acc-x" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <label className="mnav-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar una sección, pestaña o acción"
          aria-label="Buscar un acceso"
          enterKeyHint="search"
        />
      </label>
      <div className="mnav-pick-body">
        {groups.length === 0 && <p className="mnav-none">Nada coincide con «{query.trim()}».</p>}
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <h4>{g.label}</h4>
            <div className="mnav-grid">
              {g.items.map((s) => {
                const on = s.id === current;
                return (
                  <button
                    type="button"
                    key={s.id}
                    className={'mnav-opt' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => (on ? onClose() : onPick(s.id))}
                  >
                    <span className="mnav-opt-ico">
                      <s.icon size={18} />
                    </span>
                    <span className="mnav-opt-text">
                      <strong>{s.label}</strong>
                      {s.name !== s.label && <small>{s.name}</small>}
                    </span>
                    {on && <Check size={16} className="mnav-opt-check" />}
                    {s.id === other && <em>En el botón {otherNumber}</em>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
