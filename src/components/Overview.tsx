import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import type { HomeBlock } from '../data';
import { BlockBoundary } from '../home/Card';
import { Customize, type CustomizeTab } from '../home/Customize';
import { defaultsOf, placeBlock, useHomeLayout, visibleNow } from '../home/layout';
import { defOf, isKnown } from '../home/registry';
import type { Zone } from '../home/types';
import { headerHandle, useDragList } from '../home/useDragList';
import './home.css';
import '../home/home-blocks.css';

const WIDE = '(min-width: 981px)';
const subscribeWide = (f: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener('change', f);
  return () => m.removeEventListener('change', f);
};
const isWide = () => window.matchMedia(WIDE).matches;

/** Un bloque en su sitio: con sus ajustes, solo cuando toca y aislado si algo falla. */
function Frame({ inst, zone }: { inst: HomeBlock; zone: Zone }) {
  const def = defOf(inst.type);
  const opts = useMemo(
    () => (def ? { ...defaultsOf(def, zone), ...inst.opts } : {}),
    [def, zone, inst.opts],
  );
  if (!def || !inst.on || !visibleNow(opts._when)) return null;
  const Block = def.Component;
  return (
    <div
      className={'hb' + (zone === 'main' && opts._w === 'half' ? ' half' : '')}
      data-drag-key={inst.key}
      data-type={inst.type}
    >
      {zone === 'side' && <span className="hb-grip" data-drag-grip aria-hidden="true" />}
      <BlockBoundary>
        <Block opts={opts} zone={zone} inst={inst} />
      </BlockBoundary>
    </div>
  );
}

/**
 * Mi espacio. El centro y el panel derecho se arman con los bloques que elijas en «Personalizar»
 * (qué, dónde, en qué orden y con qué ajustes). Los del panel se reordenan arrastrándolos desde su
 * encabezado. Todo se guarda en tu ficha.
 */
export function Overview() {
  const { layout, update } = useHomeLayout(isKnown);
  const [customize, setCustomize] = useState<CustomizeTab | null>(null);
  const side = useRef<HTMLElement>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide);
  useDragList({
    container: side,
    enabled: wide,
    handle: headerHandle,
    onMove: (key, target, after) => update((l) => placeBlock(l, key, target, after)),
  });

  return (
    <div className="home">
      <div className="home-main">
        {layout.main.map((b) => (
          <Frame key={b.key} inst={b} zone="main" />
        ))}
      </div>
      <aside className={'home-side' + (wide ? ' can-drag' : '')} aria-label="Tu panel" ref={side}>
        <div className="hb-tools">
          <span>Tu panel</span>
          <button
            type="button"
            className="pp-icon-btn"
            title="Personalizar Mi espacio"
            aria-label="Personalizar Mi espacio"
            onClick={() => setCustomize('side')}
          >
            <Settings2 size={17} />
          </button>
        </div>
        {layout.side.map((b) => (
          <Frame key={b.key} inst={b} zone="side" />
        ))}
        <button type="button" className="hb-add" onClick={() => setCustomize('add')}>
          <Plus size={14} /> Agregar un bloque
        </button>
      </aside>
      {customize && (
        <Customize layout={layout} update={update} tab={customize} onClose={() => setCustomize(null)} />
      )}
    </div>
  );
}
