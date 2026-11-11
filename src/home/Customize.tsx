import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  GripVertical,
  Minus,
  PanelRight,
  Plus,
  RotateCcw,
  Search,
  SquareStack,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import type { HomeBlock, HomeLayout } from '../data';
import { normalizeText } from '../lib/format';
import {
  addBlock,
  commonOpts,
  DEFAULT_LAYOUT,
  defaultsOf,
  moveToZone,
  patchBlock,
  placeBlock,
  removeBlock,
  setOpt,
  stepBlock,
} from './layout';
import { blockDefs, defOf, groups } from './registry';
import { titleOf, type BlockDef, type Choice, type GroupId, type OptDef, type Opts, type Zone } from './types';
import { useDragList } from './useDragList';

type Update = (f: (l: HomeLayout) => HomeLayout) => void;
export type CustomizeTab = Zone | 'add';

const zoneLabel: Record<Zone, string> = { main: 'Centro', side: 'Panel derecho' };

/**
 * «Personalizar Mi espacio»: qué bloques ves en el centro y en el panel, en qué orden, con qué
 * ajustes (cantidad, filtros, cuándo se muestran) y el catálogo para agregar más.
 */
export function Customize({
  layout,
  update,
  onClose,
  tab: initialTab = 'side',
}: {
  layout: HomeLayout;
  update: Update;
  onClose: () => void;
  tab?: CustomizeTab;
}) {
  const { confirm } = useApp();
  const [tab, setTab] = useState<CustomizeTab>(initialTab);
  const [open, setOpen] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const add = (def: BlockDef, zone: Zone) => {
    let key = '';
    update((l) => {
      const [next, k] = addBlock(l, def, zone);
      key = k;
      return next;
    });
    setTab(zone);
    setOpen(def.opts?.length ? key : null);
    requestAnimationFrame(() => {
      body.current?.querySelector(`[data-drag-key="${key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };
  const reset = async () => {
    const ok = await confirm({
      title: '¿Volver a Mi espacio de siempre?',
      message: 'Se quitan los bloques que agregaste y vuelven los de siempre, en su orden.',
      confirmLabel: 'Restablecer',
      icon: 'question',
    });
    if (ok) update(() => DEFAULT_LAYOUT);
  };
  const shown = (z: Zone) => layout[z].filter((b) => b.on && defOf(b.type)).length;

  return (
    <Sheet label="Personalizar Mi espacio" size="lg" className="hbs" onRequestClose={onClose}>
      <header className="hbs-head">
        <div>
          <h3>Personaliza Mi espacio</h3>
          <p>Elige qué bloques ves, dónde y cómo. Los del panel también se mueven arrastrándolos desde su encabezado.</p>
        </div>
        <button type="button" className="hbs-x" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <nav className="hbs-tabs" role="tablist">
        {(['side', 'main'] as Zone[]).map((z) => (
          <button
            type="button"
            role="tab"
            key={z}
            aria-selected={tab === z}
            className={tab === z ? 'on' : ''}
            onClick={() => setTab(z)}
          >
            {z === 'side' ? <PanelRight size={15} /> : <SquareStack size={15} />}
            {zoneLabel[z]}
            <i>{shown(z)}</i>
          </button>
        ))}
        <button type="button" role="tab" aria-selected={tab === 'add'} className={'add' + (tab === 'add' ? ' on' : '')} onClick={() => setTab('add')}>
          <Plus size={15} /> Agregar bloques
        </button>
      </nav>

      <div className="hbs-body" ref={body}>
        {tab === 'add' ? (
          <Catalog layout={layout} onAdd={add} onShow={(z, key) => (setTab(z), setOpen(key))} />
        ) : (
          <ZoneList
            key={tab}
            zone={tab}
            layout={layout}
            update={update}
            open={open}
            setOpen={setOpen}
            scroller={() => body.current}
            onAdd={() => setTab('add')}
          />
        )}
      </div>

      <footer className="hbs-foot">
        <button type="button" className="hbs-btn ghost" onClick={() => void reset()}>
          <RotateCcw size={14} /> Restablecer
        </button>
        <span>Se guarda solo, en tu cuenta.</span>
        <button type="button" className="hbs-btn primary" onClick={onClose}>
          <Check size={15} /> Listo
        </button>
      </footer>
    </Sheet>
  );
}

function ZoneList({
  zone,
  layout,
  update,
  open,
  setOpen,
  scroller,
  onAdd,
}: {
  zone: Zone;
  layout: HomeLayout;
  update: Update;
  open: string | null;
  setOpen: (k: string | null) => void;
  scroller: () => HTMLElement | null;
  onAdd: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  useDragList({
    container: list,
    touch: true,
    scroller,
    handle: (target) => Boolean(target.closest('[data-drag-grip]')),
    onMove: (key, target, after) => update((l) => placeBlock(l, key, target, after)),
  });
  const items = layout[zone].filter((b) => defOf(b.type));
  return (
    <>
      <p className="hbs-hint">
        {zone === 'side'
          ? 'Arrastra desde ⋮⋮ para ordenar. En Mi espacio también puedes mover estos bloques desde su encabezado.'
          : 'Arrastra desde ⋮⋮ para ordenar el centro. Cada bloque puede ocupar todo el ancho o la mitad.'}
      </p>
      <ul className="hbs-list" ref={list}>
        {items.map((b, i) => (
          <BlockRow
            key={b.key}
            inst={b}
            def={defOf(b.type)!}
            zone={zone}
            first={i === 0}
            last={i === items.length - 1}
            open={open === b.key}
            onOpen={() => setOpen(open === b.key ? null : b.key)}
            update={update}
          />
        ))}
      </ul>
      {!items.length && <p className="hbs-empty">No hay bloques aquí.</p>}
      <button type="button" className="hbs-add" onClick={onAdd}>
        <Plus size={15} /> Agregar un bloque {zone === 'side' ? 'al panel' : 'al centro'}
      </button>
    </>
  );
}

/** Lo que distingue a este bloque de otro igual (la carpeta, el filtro…), para la lista. */
function SummaryText({ def, opts }: { def: BlockDef; opts: Opts }) {
  const first = def.opts?.find((o): o is Extract<OptDef, { type: 'select' }> => o.type === 'select');
  if (!first) return <small>{def.desc}</small>;
  return first.useChoices ? (
    <DynSummary def={first} value={opts[first.key]} />
  ) : (
    <small>{labelOf(first.choices ?? [], opts[first.key])}</small>
  );
}
function DynSummary({ def, value }: { def: Extract<OptDef, { type: 'select' }>; value: unknown }) {
  const choices = def.useChoices!();
  return <small>{labelOf(choices, value).trim().replace(/^└ /, '')}</small>;
}
const labelOf = (choices: Choice[], v: unknown) => choices.find((c) => c.value === v)?.label ?? '';

function BlockRow({
  inst,
  def,
  zone,
  first,
  last,
  open,
  onOpen,
  update,
}: {
  inst: HomeBlock;
  def: BlockDef;
  zone: Zone;
  first: boolean;
  last: boolean;
  open: boolean;
  onOpen: () => void;
  update: Update;
}) {
  const Icon = def.icon;
  const opts = useMemo(() => ({ ...defaultsOf(def, zone), ...inst.opts }), [def, zone, inst.opts]);
  const other: Zone = zone === 'side' ? 'main' : 'side';
  const fields = [...(def.opts ?? []), ...commonOpts(def, zone)];
  const half = zone === 'main' && opts._w === 'half';
  const [c, s] = groupColors[def.group];
  return (
    <li
      data-drag-key={inst.key}
      className={'hbs-row' + (inst.on ? '' : ' off') + (open ? ' open' : '')}
      style={{ '--c': c, '--s': s } as CSSProperties}
    >
      <div className="hbs-row-main">
        <button type="button" className="hbs-grip" data-drag-grip aria-label="Arrastrar para ordenar" title="Arrastrar para ordenar">
          <GripVertical size={16} />
        </button>
        <span className="hbs-ico">
          <Icon size={16} />
        </span>
        <button type="button" className="hbs-name" onClick={onOpen} aria-expanded={open}>
          <strong>
            {titleOf(opts, def.label)}
            {half && <em>Mitad</em>}
          </strong>
          {titleOf(opts, '') ? <small>{def.label}</small> : <SummaryText def={def} opts={opts} />}
        </button>
        <label className="hbs-switch" title={inst.on ? 'Ocultar' : 'Mostrar'}>
          <input
            type="checkbox"
            checked={inst.on}
            onChange={(e) => update((l) => patchBlock(l, inst.key, { on: e.target.checked }))}
            aria-label={inst.on ? `Ocultar ${def.label}` : `Mostrar ${def.label}`}
          />
          <span aria-hidden="true" />
        </label>
        <button type="button" className={'hbs-chev' + (open ? ' on' : '')} onClick={onOpen} aria-label="Ajustes del bloque">
          <ChevronDown size={16} />
        </button>
      </div>

      {open && (
        <div className="hbs-opts">
          <p className="hbs-desc">{def.desc}</p>
          <div className="hbs-fields">
            {fields.map((f) => (
              <OptField
                key={f.key}
                def={f}
                value={opts[f.key]}
                onChange={(v) => update((l) => setOpt(l, inst.key, f.key, v))}
              />
            ))}
          </div>
          <div className="hbs-actions">
            <button type="button" className="hbs-btn ghost sm" disabled={first} onClick={() => update((l) => stepBlock(l, inst.key, -1))}>
              <ArrowUp size={13} /> Subir
            </button>
            <button type="button" className="hbs-btn ghost sm" disabled={last} onClick={() => update((l) => stepBlock(l, inst.key, 1))}>
              <ArrowDown size={13} /> Bajar
            </button>
            {def.zones.includes(other) && (
              <button type="button" className="hbs-btn ghost sm" onClick={() => update((l) => moveToZone(l, inst.key, other))}>
                <ArrowLeftRight size={13} /> Pasar {other === 'main' ? 'al centro' : 'al panel'}
              </button>
            )}
            {def.multi && (
              <button
                type="button"
                className="hbs-btn ghost sm"
                onClick={() =>
                  update((l) => {
                    const [next, key] = addBlock(l, def, zone, { ...inst.opts });
                    return placeBlock(next, key, inst.key, true);
                  })
                }
              >
                <Copy size={13} /> Duplicar
              </button>
            )}
            <button type="button" className="hbs-btn danger sm" onClick={() => update((l) => removeBlock(l, inst.key))}>
              <Trash2 size={13} /> Quitar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function OptField({ def, value, onChange }: { def: OptDef; value: unknown; onChange: (v: unknown) => void }) {
  return (
    <div className={'hbs-field' + (def.type === 'multi' || def.type === 'text' ? ' wide' : '')}>
      <span className="hbs-label">
        {def.label}
        {def.hint && <em>{def.hint}</em>}
      </span>
      {def.type === 'text' && (
        <input
          className="hbs-text"
          value={typeof value === 'string' ? value : ''}
          maxLength={def.max ?? 80}
          placeholder={def.placeholder}
          aria-label={def.label}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {def.type === 'number' && <Stepper def={def} value={typeof value === 'number' ? value : def.def} onChange={onChange} />}
      {def.type === 'toggle' && (
        <label className="hbs-switch">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-label={def.label} />
          <span aria-hidden="true" />
        </label>
      )}
      {def.type === 'select' &&
        (def.useChoices ? (
          <DynSelect def={def} value={value} onChange={onChange} />
        ) : (
          <Choices choices={def.choices ?? []} value={String(value ?? def.def)} onChange={onChange} />
        ))}
      {def.type === 'multi' && <Multi choices={def.choices} value={Array.isArray(value) ? (value as string[]) : def.def} onChange={onChange} />}
    </div>
  );
}

function Stepper({ def, value, onChange }: { def: Extract<OptDef, { type: 'number' }>; value: number; onChange: (v: number) => void }) {
  const step = def.step ?? 1;
  const set = (v: number) => onChange(Math.min(def.max, Math.max(def.min, Math.round(v / step) * step)));
  return (
    <span className="hbs-stepper">
      <button type="button" aria-label="Menos" disabled={value <= def.min} onClick={() => set(value - step)}>
        <Minus size={13} />
      </button>
      <input
        type="number"
        min={def.min}
        max={def.max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set(n);
        }}
        aria-label={def.label}
      />
      <button type="button" aria-label="Más" disabled={value >= def.max} onClick={() => set(value + step)}>
        <Plus size={13} />
      </button>
      {def.unit && <small>{def.unit}</small>}
    </span>
  );
}

/** Pocas opciones: fichas. Muchas: una lista desplegable. */
function Choices({ choices, value, onChange }: { choices: Choice[]; value: string; onChange: (v: string) => void }) {
  if (choices.length > 4)
    return (
      <select className="hbs-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    );
  return (
    <span className="hbs-chips">
      {choices.map((c) => (
        <button type="button" key={c.value} className={c.value === value ? 'on' : ''} onClick={() => onChange(c.value)}>
          {c.label}
        </button>
      ))}
    </span>
  );
}
function DynSelect({ def, value, onChange }: { def: Extract<OptDef, { type: 'select' }>; value: unknown; onChange: (v: string) => void }) {
  const choices = def.useChoices!();
  return (
    <select className="hbs-select" value={String(value ?? def.def)} onChange={(e) => onChange(e.target.value)}>
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}
function Multi({ choices, value, onChange }: { choices: Choice[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <span className="hbs-chips">
      {choices.map((c) => {
        const on = value.includes(c.value);
        return (
          <button
            type="button"
            key={c.value}
            className={on ? 'on' : ''}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== c.value) : [...value, c.value])}
          >
            {on && <Check size={11} />} {c.label}
          </button>
        );
      })}
    </span>
  );
}

const groupColors: Record<GroupId, [string, string]> = {
  dia: ['#5f8247', '#eaf1e0'],
  gente: ['#4f6bb5', '#e7ecf7'],
  memoria: ['#b07f4f', '#f6eee3'],
  cultura: ['#a0527f', '#f6e9f1'],
  trabajo: ['#c4705a', '#f9e8e2'],
  dinero: ['#3f6b4f', '#e6efe7'],
  imagenes: ['#4f6b3d', '#e8f0df'],
  atajos: ['#c58a1c', '#fbf0d9'],
};

function Catalog({
  layout,
  onAdd,
  onShow,
}: {
  layout: HomeLayout;
  onAdd: (def: BlockDef, zone: Zone) => void;
  onShow: (zone: Zone, key: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<GroupId | 'todos'>('todos');
  const needle = normalizeText(query.trim());
  const where = (type: string) => {
    for (const z of ['side', 'main'] as Zone[]) {
      const b = layout[z].find((x) => x.type === type);
      if (b) return { zone: z, key: b.key, on: b.on };
    }
    return null;
  };
  const list = blockDefs.filter(
    (d) =>
      (group === 'todos' || d.group === group) &&
      (!needle || normalizeText(`${d.label} ${d.desc}`).includes(needle)),
  );
  return (
    <div className="hbs-cat">
      <div className="hbs-cat-bar">
        <label className="hbs-search">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar un bloque…" aria-label="Buscar un bloque" />
        </label>
        <span className="hbs-chips">
          <button type="button" className={group === 'todos' ? 'on' : ''} onClick={() => setGroup('todos')}>
            Todos <i>{blockDefs.length}</i>
          </button>
          {groups.map((g) => (
            <button type="button" key={g.id} className={group === g.id ? 'on' : ''} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </span>
      </div>
      <div className="hbs-grid">
        {list.map((d) => {
          const Icon = d.icon;
          const at = where(d.type);
          const [c, s] = groupColors[d.group];
          return (
            <article key={d.type} className="hbs-card" style={{ '--c': c, '--s': s } as CSSProperties}>
              <header>
                <span className="hbs-ico">
                  <Icon size={17} />
                </span>
                <strong>{d.label}</strong>
                {d.multi && <em title="Puedes agregarlo varias veces, cada uno con sus ajustes">Varios</em>}
              </header>
              <p>{d.desc}</p>
              <footer>
                {at && !d.multi ? (
                  <>
                    <span className="hbs-in">
                      <Check size={12} /> {at.on ? 'En' : 'Oculto en'} {at.zone === 'main' ? 'el centro' : 'el panel'}
                    </span>
                    <button type="button" className="hbs-btn ghost sm" onClick={() => onShow(at.zone, at.key)}>
                      Ajustar
                    </button>
                  </>
                ) : (
                  d.zones.map((z) => (
                    <button type="button" key={z} className="hbs-btn soft sm" onClick={() => onAdd(d, z)}>
                      <Plus size={13} /> {z === 'main' ? 'Centro' : 'Panel'}
                    </button>
                  ))
                )}
              </footer>
            </article>
          );
        })}
        {!list.length && <p className="hbs-empty">Ningún bloque con ese nombre.</p>}
      </div>
    </div>
  );
}
