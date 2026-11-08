import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Check,
  ChevronDown,
  Columns3,
  LayoutTemplate,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { snapshotBoard, type BoardListApi, type BoardSpec } from './boardStore';
import { backgroundOf, tagTone, toneOf } from './boardTheme';
import { blankSpec, builtinTemplates, countCards } from './boardTemplates';
import './templates.css';

/** Qué está elegido: en blanco, una de Nexo («b:…») o una tuya («m:…»). */
type Key = string;

/**
 * Crear un tablero: en blanco o desde una plantilla (las de Nexo o las tuyas). A la derecha, una
 * vista previa con sus columnas, cómo se usa y el nombre. Las de Nexo se pueden personalizar
 * (se copian a «Mis plantillas»); las tuyas se editan como un tablero.
 */
export function TemplateGallery({
  list,
  initial = 'blank',
  onCreated,
  onEdit,
  onClose,
}: {
  list: BoardListApi;
  initial?: Key;
  onCreated: (id: string) => void;
  /** Abre una plantilla tuya para editarla. */
  onEdit: (id: string) => void;
  onClose: () => void;
}) {
  const { confirm, notify } = useApp();
  const [key, setKey] = useState<Key>(initial);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'create' | 'custom' | null>(null);
  const [specs, setSpecs] = useState<Record<string, BoardSpec | 'error'>>({});
  const [guideOpen, setGuideOpen] = useState(false);

  const mine = list.templates;
  const builtin = key.startsWith('b:') ? builtinTemplates.find((t) => 'b:' + t.id === key) : null;
  const own = key.startsWith('m:') ? mine.find((t) => 'm:' + t.id === key) : null;
  const ownSpec = own ? specs[own.id] : undefined;
  const spec: BoardSpec | null =
    key === 'blank'
      ? blankSpec
      : builtin
        ? builtin.spec
        : ownSpec && ownSpec !== 'error'
          ? ownSpec
          : null;

  // Las plantillas tuyas se leen al elegirlas.
  useEffect(() => {
    if (!own || specs[own.id]) return;
    let live = true;
    void snapshotBoard(own.id)
      .then((s) => live && setSpecs((v) => ({ ...v, [own.id]: s })))
      .catch(() => live && setSpecs((v) => ({ ...v, [own.id]: 'error' })));
    return () => {
      live = false;
    };
  }, [own?.id]);

  // Nombre sugerido según lo elegido: «Boda · » y completas cliente y fecha.
  useEffect(() => {
    setName(builtin ? builtin.prefix : own ? own.name + ' · ' : '');
    setGuideOpen(false);
  }, [key]);

  const title = key === 'blank' ? 'Tablero en blanco' : (builtin?.name ?? own?.name ?? '');
  const summary =
    key === 'blank'
      ? 'Tres columnas para empezar: Por hacer, En curso y Hecho.'
      : (builtin?.summary ?? (own?.description || 'Tu plantilla.'));
  const stats = useMemo(() => {
    if (!spec) return null;
    const cards = countCards(spec);
    const checks = spec.columns.reduce(
      (n, c) => n + c.cards.reduce((m, x) => m + (x.checks?.length ?? 0), 0),
      0,
    );
    return { cols: spec.columns.length, cards, checks };
  }, [spec]);
  const bg = backgroundOf(spec?.background ?? own?.background);

  const create = async () => {
    const n = name.replace(/\s*·\s*$/, '').trim();
    if (!n || busy || !spec) return;
    setBusy('create');
    const id = key === 'blank' ? await list.create(n) : await list.createFrom(spec, n);
    setBusy(null);
    if (id) {
      onCreated(id);
      onClose();
    }
  };
  const customize = async () => {
    if (!builtin || busy) return;
    setBusy('custom');
    const id = await list.createFrom(builtin.spec, builtin.name, {
      template: true,
      description: builtin.summary,
    });
    setBusy(null);
    if (id) {
      notify(`«${builtin.name}» está en Mis plantillas: edítala a tu gusto.`);
      onEdit(id);
      onClose();
    }
  };
  const removeOwn = async () => {
    if (!own) return;
    const ok = await confirm({
      title: `¿Eliminar la plantilla «${own.name.slice(0, 60)}»?`,
      message: 'Los tableros que ya creaste con ella no cambian.',
      confirmLabel: 'Eliminar',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    list.remove(own.id);
    setKey('blank');
  };

  const Item = ({
    k,
    label,
    sub,
    preview,
  }: {
    k: Key;
    label: string;
    sub: string;
    preview?: BoardSpec | null;
  }) => (
    <button
      type="button"
      role="option"
      aria-selected={key === k}
      className={'bdt-item' + (key === k ? ' on' : '')}
      onClick={() => setKey(k)}
    >
      <span className="bdt-thumb" style={{ background: backgroundOf(preview?.background).css }}>
        {(preview?.columns ?? blankSpec.columns).slice(0, 5).map((col, i) => (
          <i
            key={i}
            style={
              {
                '--h': `${30 + Math.min(col.cards.length, 6) * 10}%`,
                '--tc': toneOf(col.color)?.c ?? 'rgba(255,255,255,.9)',
              } as CSSProperties
            }
          />
        ))}
      </span>
      <span className="bdt-item-text">
        <b>{label}</b>
        <small>{sub}</small>
      </span>
    </button>
  );

  return (
    <Sheet label="Nuevo tablero" size="lg" className="bdt" onRequestClose={onClose}>
      <header className="bdt-head">
        <span className="bdt-mark" aria-hidden="true">
          <LayoutTemplate size={18} />
        </span>
        <div>
          <h2>Nuevo tablero</h2>
          <small>Empieza en blanco o con una plantilla.</small>
        </div>
        <button type="button" className="bdt-x" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="bdt-body">
        <nav className="bdt-nav" role="listbox" aria-label="Plantillas">
          <p className="bdt-group">Empezar</p>
          <Item k="blank" label="En blanco" sub="3 columnas" preview={blankSpec} />
          {[...new Set(builtinTemplates.map((t) => t.group))].map((g) => (
            <div key={g}>
              <p className="bdt-group">{g}</p>
              {builtinTemplates
                .filter((t) => t.group === g)
                .map((t) => (
                  <Item
                    key={t.id}
                    k={'b:' + t.id}
                    label={t.name}
                    sub={`${t.spec.columns.length} columnas · ${countCards(t.spec)} tarjetas`}
                    preview={t.spec}
                  />
                ))}
            </div>
          ))}
          <p className="bdt-group">Mis plantillas</p>
          {mine.length ? (
            mine.map((t) => (
              <Item
                key={t.id}
                k={'m:' + t.id}
                label={t.name}
                sub={t.description || 'Plantilla tuya'}
                preview={
                  specs[t.id] && specs[t.id] !== 'error'
                    ? (specs[t.id] as BoardSpec)
                    : { background: t.background, columns: [] }
                }
              />
            ))
          ) : (
            <p className="bdt-hint">
              Guarda cualquier tablero como plantilla desde su menú <b>⋯</b>, o personaliza una de
              las de Nexo.
            </p>
          )}
        </nav>

        <section className="bdt-preview">
          <div className="bdt-stage" style={{ background: bg.css }}>
            {spec ? (
              <div className="bdt-mini">
                {spec.columns.map((col, i) => {
                  const tone = toneOf(col.color);
                  return (
                    <div
                      key={i}
                      className="bdt-col"
                      style={tone ? ({ '--tc': tone.c } as CSSProperties) : undefined}
                    >
                      <b>{col.name}</b>
                      {col.cards.slice(0, 4).map((card, j) => (
                        <span key={j} className="bdt-card">
                          {card.title}
                        </span>
                      ))}
                      {col.cards.length > 4 && <em>+{col.cards.length - 4}</em>}
                      {!col.cards.length && <span className="bdt-card ghost" />}
                    </div>
                  );
                })}
              </div>
            ) : ownSpec === 'error' ? (
              <p className="bdt-stage-msg">No se pudo leer la plantilla.</p>
            ) : (
              <p className="bdt-stage-msg">
                <LoaderCircle className="spin" size={16} />
              </p>
            )}
          </div>

          <div className="bdt-info">
            <h3>{title}</h3>
            <p className="bdt-summary">{summary}</p>
            {stats && (
              <p className="bdt-stats">
                <span>
                  <Columns3 size={13} /> {stats.cols} columnas
                </span>
                {stats.cards > 0 && <span>{stats.cards} tarjetas</span>}
                {stats.checks > 0 && <span>{stats.checks} puntos de lista</span>}
              </p>
            )}
            {builtin && (
              <>
                <div className="bdt-labels">
                  {builtin.labels.map((l) => {
                    const t = tagTone(l);
                    return (
                      <span key={l} style={{ '--tc': t.c, '--ts': t.s } as CSSProperties}>
                        {l}
                      </span>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="bdt-guide-toggle"
                  aria-expanded={guideOpen}
                  onClick={() => setGuideOpen((v) => !v)}
                >
                  Cómo usarla <ChevronDown size={14} />
                </button>
                {guideOpen && (
                  <ul className="bdt-guide">
                    {builtin.guide.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <form
            className="bdt-create"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              <span>Nombre del tablero</span>
              <input
                autoFocus
                value={name}
                maxLength={120}
                placeholder={builtin?.placeholder ?? 'Por ejemplo: Proyectos del mes'}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="bd-btn primary"
              disabled={!name.replace(/\s*·\s*$/, '').trim() || Boolean(busy) || !spec}
            >
              {busy === 'create' ? <LoaderCircle className="spin" size={15} /> : <Plus size={16} />}
              Crear tablero
            </button>
          </form>

          {(builtin || own) && (
            <div className="bdt-actions">
              {builtin && (
                <button type="button" disabled={Boolean(busy)} onClick={() => void customize()}>
                  {busy === 'custom' ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Pencil size={14} />
                  )}
                  Personalizar como plantilla mía
                </button>
              )}
              {own && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onEdit(own.id);
                      onClose();
                    }}
                  >
                    <Pencil size={14} /> Editar plantilla
                  </button>
                  <button type="button" className="danger" onClick={() => void removeOwn()}>
                    <Trash2 size={14} /> Eliminar
                  </button>
                </>
              )}
            </div>
          )}
          {key === 'blank' && (
            <p className="bdt-foot-hint">
              <Check size={13} /> Luego puedes guardar cualquier tablero como plantilla.
            </p>
          )}
        </section>
      </div>
    </Sheet>
  );
}
