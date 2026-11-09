import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowDownWideNarrow,
  Archive,
  ArrowRight,
  Ban,
  Copy,
  Gauge,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { Sheet } from '../components/Sheet';
import {
  actionInfo,
  actionOrder,
  actionText,
  condInfo,
  condOrder,
  condText,
  conditionsHold,
  dueLabels,
  emptyRules,
  priorityLabels,
  recipes,
  sortLabels,
  triggerInfo,
  triggerText,
  type Action,
  type ActionType,
  type ColumnRules,
  type CondType,
  type Condition,
  type DueMode,
  type Rule,
  type RuleCtx,
  type SortKey,
  type TriggerType,
} from './boardRules';
import type { BoardCard, Column, Priority } from './boardStore';
import { tones, toneOf } from './boardTheme';
import './rules.css';

const colorName = (k: string) => (k ? (toneOf(k)?.label.toLowerCase() ?? k) : 'sin color');
const PRIOS: Priority[] = ['alta', 'media', 'baja', ''];
const TRIGGER_GROUPS: { label: string; items: TriggerType[] }[] = [
  { label: 'Al mover', items: ['create', 'enter', 'leave'] },
  { label: 'Al trabajarla', items: ['done', 'undone', 'checks'] },
  { label: 'Con el tiempo', items: ['overdue', 'due_soon', 'idle'] },
];

/** Una frase que cuenta la regla: «Cuando llega aquí · si tiene «x» → Completar, Mover…». */
export function ruleSentence(rule: Rule, _cols?: Column[]) {
  const when = rule.when.length
    ? ' · si ' +
      rule.when.map((c) => condText(c, colorName)).join(rule.match === 'any' ? ' o ' : ' y ')
    : '';
  return `${triggerText(rule.trigger)}${when}`;
}

/**
 * Reglas de una columna: su comportamiento (límite, orden, archivar solas) y automatizaciones
 * «Cuando… si… entonces…». El comportamiento se guarda solo; cada regla, al pulsar Guardar.
 */
export function RulesEditor({
  column,
  columns,
  cards,
  tags,
  power,
  ctx,
  onSave,
  onRunNow,
  onClose,
}: {
  column: Column;
  columns: Column[];
  /** Las tarjetas que hay ahora en la columna. */
  cards: BoardCard[];
  /** Etiquetas usadas en el tablero (para sugerir). */
  tags: string[];
  /** Existe la migración nueva. */
  power: boolean;
  ctx: RuleCtx;
  onSave: (rules: ColumnRules) => void;
  /** Aplica las acciones de la regla ahora a las tarjetas que cumplen sus condiciones. */
  onRunNow: (rule: Rule) => number;
  onClose: () => void;
}) {
  const [rules, setRules] = useState<ColumnRules>(column.rules ?? emptyRules());
  const [editing, setEditing] = useState<Rule | null>(null);
  const [isNew, setIsNew] = useState(false);
  const dirty = useRef(false);
  const latest = useRef({ rules, onSave });
  latest.current = { rules, onSave };
  const timer = useRef<number | undefined>(undefined);
  const flush = () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    latest.current.onSave(latest.current.rules);
  };
  useEffect(() => () => flush(), []);
  const change = (fn: (r: ColumnRules) => ColumnRules, now = false) => {
    setRules((r) => {
      const next = fn(r);
      latest.current.rules = next;
      return next;
    });
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, now ? 0 : 500);
  };

  const others = columns.filter((c) => c.id !== column.id);
  const tone = toneOf(column.color);
  const active = rules.rules.filter((r) => r.on).length;
  const startNew = (base?: Omit<Rule, 'id' | 'on'>) => {
    setIsNew(true);
    setEditing({
      id: crypto.randomUUID(),
      on: true,
      ...(base ?? {
        trigger: { type: 'enter' },
        match: 'all',
        when: [],
        then: [{ type: 'complete' }],
      }),
    });
  };
  const saveRule = (r: Rule) => {
    change(
      (x) => ({
        ...x,
        rules: x.rules.some((y) => y.id === r.id)
          ? x.rules.map((y) => (y.id === r.id ? r : y))
          : [...x.rules, r],
      }),
      true,
    );
    setEditing(null);
    setIsNew(false);
  };

  return (
    <Sheet
      label={`Reglas de ${column.name}`}
      size="lg"
      className="bdr"
      yieldTo=".bd-pop"
      onRequestClose={() => {
        flush();
        onClose();
      }}
    >
      <header className="bdr-head" style={tone ? ({ '--lc': tone.c } as CSSProperties) : undefined}>
        <span className="bdr-mark" aria-hidden="true">
          <Zap size={18} />
        </span>
        <div>
          <h2>Reglas de «{column.name}»</h2>
          <p>Automatiza lo que pasa con las tarjetas de esta columna. Se guarda solo.</p>
        </div>
        <button
          type="button"
          className="bdr-x"
          aria-label="Cerrar"
          onClick={() => {
            flush();
            onClose();
          }}
        >
          <X size={18} />
        </button>
      </header>

      {!power && (
        <p className="bdr-notice">
          Para guardar reglas ejecuta <code>supabase/migrations/202611090002_board_power.sql</code> en
          el SQL Editor de Supabase.
        </p>
      )}

      <div className="bdr-body">
        <section className="bdr-sec">
          <h3>Comportamiento de la columna</h3>
          <div className="bdr-grid">
            <div className="bdr-box">
              <span className="bdr-box-head">
                <Gauge size={15} /> Límite de tarjetas
              </span>
              <div className="bdr-stepper">
                <button
                  type="button"
                  aria-label="Menos"
                  disabled={!rules.limit}
                  onClick={() => change((r) => ({ ...r, limit: Math.max(0, r.limit - 1) }))}
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={rules.limit || ''}
                  placeholder="Sin límite"
                  aria-label="Límite de tarjetas"
                  onChange={(e) =>
                    change((r) => ({
                      ...r,
                      limit: Math.max(0, Math.min(999, Number(e.target.value) || 0)),
                    }))
                  }
                />
                <button
                  type="button"
                  aria-label="Más"
                  onClick={() => change((r) => ({ ...r, limit: Math.min(999, r.limit + 1) }))}
                >
                  +
                </button>
              </div>
              <Seg
                value={rules.limitMode}
                disabled={!rules.limit}
                options={[
                  ['warn', 'Avisar'],
                  ['block', 'No dejar pasar'],
                ]}
                onChange={(v) => change((r) => ({ ...r, limitMode: v as 'warn' | 'block' }))}
              />
              <small>
                {rules.limit
                  ? rules.limitMode === 'block'
                    ? `Con ${rules.limit} no entra ninguna más.`
                    : `Pasadas ${rules.limit}, la columna se marca en rojo.`
                  : 'Útil para no tener demasiado «En curso».'}
              </small>
            </div>

            <div className="bdr-box">
              <span className="bdr-box-head">
                <ArrowDownWideNarrow size={15} /> Orden automático
              </span>
              <div className="bdr-chips">
                {(Object.keys(sortLabels) as SortKey[]).map((k) => (
                  <button
                    type="button"
                    key={k || 'manual'}
                    className={rules.sort === k ? 'on' : ''}
                    aria-pressed={rules.sort === k}
                    onClick={() => change((r) => ({ ...r, sort: k }))}
                  >
                    {sortLabels[k]}
                  </button>
                ))}
              </div>
              <small>
                {rules.sort
                  ? 'Se ordena sola al mostrarse; tu orden manual se conserva.'
                  : 'Las tarjetas quedan donde las sueltas.'}
              </small>
            </div>

            <div className="bdr-box">
              <span className="bdr-box-head">
                <Archive size={15} /> Archivar completadas
              </span>
              <div className="bdr-chips">
                {(
                  [
                    [0, 'Nunca'],
                    [1, 'Al día'],
                    [3, '3 días'],
                    [7, '1 semana'],
                    [14, '2 semanas'],
                    [30, '1 mes'],
                  ] as const
                ).map(([n, label]) => (
                  <button
                    type="button"
                    key={n}
                    className={rules.autoArchive === n ? 'on' : ''}
                    aria-pressed={rules.autoArchive === n}
                    onClick={() => change((r) => ({ ...r, autoArchive: n }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <small>
                {rules.autoArchive
                  ? 'Lo completado se va solo a Archivados pasado ese tiempo.'
                  : 'Lo completado se queda hasta que lo archives.'}
              </small>
            </div>
          </div>
        </section>

        <section className="bdr-sec">
          <div className="bdr-sec-head">
            <h3>
              Automatizaciones
              {rules.rules.length > 0 && (
                <small>
                  {active} de {rules.rules.length} activas
                </small>
              )}
            </h3>
            {!editing && (
              <button type="button" className="bd-btn primary sm" onClick={() => startNew()}>
                <Plus size={15} /> Nueva regla
              </button>
            )}
          </div>

          {editing && isNew && (
            <RuleBuilder
              rule={editing}
              columns={columns}
              column={column}
              cards={cards}
              tags={tags}
              ctx={ctx}
              onSave={saveRule}
              onCancel={() => (setEditing(null), setIsNew(false))}
            />
          )}

          {rules.rules.length > 0 ? (
            <ul className="bdr-list">
              {rules.rules.map((r) =>
                editing?.id === r.id && !isNew ? (
                  <li key={r.id}>
                    <RuleBuilder
                      rule={editing}
                      columns={columns}
                      column={column}
                      cards={cards}
                      tags={tags}
                      ctx={ctx}
                      onSave={saveRule}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                ) : (
                  <li key={r.id}>
                    <RuleRow
                      rule={r}
                      columns={columns}
                      matching={cards.filter((c) => conditionsHold(r, c, ctx)).length}
                      onToggle={() =>
                        change(
                          (x) => ({
                            ...x,
                            rules: x.rules.map((y) => (y.id === r.id ? { ...y, on: !y.on } : y)),
                          }),
                          true,
                        )
                      }
                      onEdit={() => (setIsNew(false), setEditing(r))}
                      onCopy={() =>
                        change(
                          (x) => ({
                            ...x,
                            rules: [
                              ...x.rules,
                              { ...structuredClone(r), id: crypto.randomUUID(), on: false },
                            ],
                          }),
                          true,
                        )
                      }
                      onDelete={() =>
                        change((x) => ({ ...x, rules: x.rules.filter((y) => y.id !== r.id) }), true)
                      }
                      onRun={() => onRunNow(r)}
                    />
                  </li>
                ),
              )}
            </ul>
          ) : (
            !editing && (
              <div className="bdr-empty">
                <Sparkles size={20} />
                <div>
                  <strong>Sin automatizaciones todavía</strong>
                  <span>Crea una desde cero o empieza con una receta.</span>
                </div>
              </div>
            )
          )}
        </section>

        <section className="bdr-sec">
          <h3>Recetas</h3>
          <div className="bdr-recipes">
            {recipes(column, columns).map((x) => (
              <button
                type="button"
                key={x.key}
                className="bdr-recipe"
                disabled={x.key === 'move-on-done' && !others.length}
                onClick={() => startNew(x.make())}
              >
                <Zap size={14} />
                <span>
                  <b>{x.title}</b>
                  <small>{x.hint}</small>
                </span>
                <Plus size={14} className="bdr-recipe-add" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </Sheet>
  );
}

/** Una regla guardada: interruptor, frase y acciones. */
function RuleRow({
  rule,
  columns,
  matching,
  onToggle,
  onEdit,
  onCopy,
  onDelete,
  onRun,
}: {
  rule: Rule;
  columns: Column[];
  matching: number;
  onToggle: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRun: () => number;
}) {
  const [ran, setRan] = useState<number | null>(null);
  return (
    <div className={'bdr-rule' + (rule.on ? '' : ' off')}>
      <button
        type="button"
        role="switch"
        aria-checked={rule.on}
        className="bdr-switch"
        title={rule.on ? 'Activa · clic para pausarla' : 'En pausa · clic para activarla'}
        onClick={onToggle}
      >
        <i />
      </button>
      <div className="bdr-rule-main" onDoubleClick={onEdit}>
        {rule.name && <strong>{rule.name}</strong>}
        <p className="bdr-when">
          <span className="bdr-kw">Cuando</span> {ruleSentence(rule, columns)}
        </p>
        <div className="bdr-then">
          <ArrowRight size={13} />
          {rule.then.map((a, i) => (
            <span key={i} className={'bdr-act ' + actionInfo[a.type].group}>
              {actionText(a, columns, colorName)}
            </span>
          ))}
        </div>
      </div>
      <div className="bdr-rule-acts">
        <button
          type="button"
          title={`Aplicar ahora a las ${matching} tarjetas que cumplen las condiciones`}
          disabled={!matching}
          onClick={() => setRan(onRun())}
        >
          <Play size={14} />
          <span>{ran !== null ? `Aplicada a ${ran}` : 'Aplicar ahora'}</span>
        </button>
        <button type="button" title="Editar" aria-label="Editar la regla" onClick={onEdit}>
          <Pencil size={14} />
        </button>
        <button type="button" title="Duplicar" aria-label="Duplicar la regla" onClick={onCopy}>
          <Copy size={14} />
        </button>
        <button
          type="button"
          className="danger"
          title="Eliminar"
          aria-label="Eliminar la regla"
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

/** Armar una regla: cuándo, si (opcional) y qué hacer. */
function RuleBuilder({
  rule,
  columns,
  column,
  cards,
  tags,
  ctx,
  onSave,
  onCancel,
}: {
  rule: Rule;
  columns: Column[];
  column: Column;
  cards: BoardCard[];
  tags: string[];
  ctx: RuleCtx;
  onSave: (r: Rule) => void;
  onCancel: () => void;
}) {
  const [r, setR] = useState<Rule>(() => structuredClone(rule));
  const others = columns.filter((c) => c.id !== column.id);
  const info = triggerInfo[r.trigger.type];
  const matching = useMemo(
    () => cards.filter((c) => conditionsHold(r, c, ctx)).length,
    [cards, r, ctx],
  );
  const problems = [
    !r.then.length && 'Añade al menos una acción.',
    r.then.some((a) => a.type === 'move' && !others.some((c) => c.id === a.list)) &&
      'Elige a qué columna mover.',
    r.then.some((a) => (a.type === 'add_tag' || a.type === 'remove_tag') && !a.value?.trim()) &&
      'Escribe la etiqueta.',
    r.when.some((c) => (c.type === 'tag' || c.type === 'no_tag' || c.type === 'title') && !c.value?.trim()) &&
      'Completa las condiciones.',
    r.then.some((a) => a.type === 'add_checks' && !a.items?.some((x) => x.trim())) &&
      'Escribe los puntos de la lista.',
  ].filter(Boolean) as string[];

  const setCond = (i: number, c: Condition) =>
    setR((x) => ({ ...x, when: x.when.map((y, j) => (j === i ? c : y)) }));
  const setAct = (i: number, a: Action) =>
    setR((x) => ({ ...x, then: x.then.map((y, j) => (j === i ? a : y)) }));
  const listId = 'bdr-tags-' + rule.id;

  return (
    <div className="bdr-builder">
      <datalist id={listId}>
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <input
        className="bdr-name"
        value={r.name ?? ''}
        maxLength={80}
        placeholder="Nombre de la regla (opcional)"
        aria-label="Nombre de la regla"
        onChange={(e) => setR((x) => ({ ...x, name: e.target.value }))}
      />

      <Step n={1} label="Cuando">
        <div className="bdr-triggers">
          {TRIGGER_GROUPS.map((g) => (
            <div key={g.label} className="bdr-tgroup">
              <small>{g.label}</small>
              <div>
                {g.items.map((t) => (
                  <button
                    type="button"
                    key={t}
                    className={r.trigger.type === t ? 'on' : ''}
                    aria-pressed={r.trigger.type === t}
                    title={triggerInfo[t].hint}
                    onClick={() =>
                      setR((x) => ({
                        ...x,
                        trigger: {
                          type: t,
                          days: t === 'idle' ? 7 : t === 'due_soon' ? 1 : undefined,
                        },
                      }))
                    }
                  >
                    {triggerInfo[t].label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {info.days && (
          <label className="bdr-inline">
            {info.days}
            <input
              type="number"
              min={r.trigger.type === 'idle' ? 1 : 0}
              max={365}
              value={r.trigger.days ?? 1}
              onChange={(e) =>
                setR((x) => ({
                  ...x,
                  trigger: { ...x.trigger, days: Math.max(0, Math.min(365, Number(e.target.value) || 0)) },
                }))
              }
            />
          </label>
        )}
        <small className="bdr-hint">{info.hint}.</small>
      </Step>

      <Step n={2} label="Y si" optional>
        {r.when.length > 1 && (
          <Seg
            value={r.match}
            options={[
              ['all', 'Se cumplen todas'],
              ['any', 'Se cumple alguna'],
            ]}
            onChange={(v) => setR((x) => ({ ...x, match: v as 'all' | 'any' }))}
          />
        )}
        {r.when.map((c, i) => (
          <div key={i} className="bdr-row">
            <select
              value={c.type}
              aria-label="Condición"
              onChange={(e) => setCond(i, { type: e.target.value as CondType })}
            >
              {condOrder.map((t) => (
                <option key={t} value={t}>
                  {condInfo[t].label}
                </option>
              ))}
            </select>
            {condInfo[c.type].value === 'tag' && (
              <input
                list={listId}
                value={c.value ?? ''}
                placeholder="etiqueta"
                aria-label="Etiqueta"
                onChange={(e) => setCond(i, { ...c, value: e.target.value })}
              />
            )}
            {condInfo[c.type].value === 'text' && (
              <input
                value={c.value ?? ''}
                placeholder="texto"
                aria-label="Texto"
                onChange={(e) => setCond(i, { ...c, value: e.target.value })}
              />
            )}
            {condInfo[c.type].value === 'priority' && (
              <PrioPick value={(c.value ?? '') as Priority} onChange={(v) => setCond(i, { ...c, value: v })} />
            )}
            {condInfo[c.type].value === 'color' && (
              <Swatches value={c.value ?? ''} onChange={(v) => setCond(i, { ...c, value: v })} />
            )}
            <button
              type="button"
              className="bdr-del"
              aria-label="Quitar la condición"
              onClick={() => setR((x) => ({ ...x, when: x.when.filter((_, j) => j !== i) }))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="bdr-add"
          onClick={() => setR((x) => ({ ...x, when: [...x.when, { type: 'tag', value: '' }] }))}
        >
          <Plus size={14} /> Condición
        </button>
        <small className="bdr-hint">
          {r.when.length
            ? `Ahora mismo la cumplen ${matching} de ${cards.length} tarjetas de la columna.`
            : 'Sin condiciones, vale para cualquier tarjeta.'}
        </small>
      </Step>

      <Step n={3} label="Entonces">
        {r.then.map((a, i) => (
          <div key={i} className="bdr-row">
            <select
              value={a.type}
              aria-label="Acción"
              onChange={(e) => {
                const type = e.target.value as ActionType;
                setAct(i, {
                  type,
                  ...(type === 'move' && { list: others[0]?.id, where: 'bottom' as const }),
                  ...(type === 'due' && { value: 'today' }),
                  ...(type === 'priority' && { value: 'alta' }),
                  ...(type === 'highlight' && { on: true }),
                  ...(type === 'snooze' && { days: 1 }),
                  ...(type === 'color' && { value: tones[0].key }),
                });
              }}
            >
              {(['mover', 'estado', 'datos'] as const).map((g) => (
                <optgroup key={g} label={g === 'mover' ? 'Mover' : g === 'estado' ? 'Estado' : 'Datos'}>
                  {actionOrder
                    .filter((t) => actionInfo[t].group === g)
                    .map((t) => (
                      <option key={t} value={t} disabled={t === 'move' && !others.length}>
                        {actionInfo[t].label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <ActionValue a={a} others={others} listId={listId} onChange={(x) => setAct(i, x)} />
            <button
              type="button"
              className="bdr-del"
              aria-label="Quitar la acción"
              onClick={() => setR((x) => ({ ...x, then: x.then.filter((_, j) => j !== i) }))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="bdr-add"
          onClick={() => setR((x) => ({ ...x, then: [...x.then, { type: 'add_tag', value: '' }] }))}
        >
          <Plus size={14} /> Acción
        </button>
        {r.then.some((a) => a.type === 'archive' || a.type === 'move') &&
          r.then.findIndex((a) => a.type === 'archive' || a.type === 'move') < r.then.length - 1 && (
            <small className="bdr-hint">
              Las acciones van en orden: lo que sigue a mover o archivar se aplica igual.
            </small>
          )}
      </Step>

      <footer className="bdr-builder-foot">
        <p className="bdr-preview">
          <Zap size={13} />
          <span>
            <b>Cuando</b> {ruleSentence(r, columns).toLowerCase()} <b>→</b>{' '}
            {r.then.map((a) => actionText(a, columns, colorName)).join(', ') || '…'}
          </span>
        </p>
        {problems[0] && (
          <small className="bdr-problem">
            <Ban size={12} /> {problems[0]}
          </small>
        )}
        <div>
          <button type="button" className="bd-btn sm" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="bd-btn primary sm"
            disabled={problems.length > 0}
            onClick={() =>
              onSave({
                ...r,
                name: r.name?.trim() || undefined,
                then: r.then.map((a) =>
                  a.type === 'add_checks'
                    ? { ...a, items: (a.items ?? []).map((x) => x.trim()).filter(Boolean) }
                    : a,
                ),
              })
            }
          >
            Guardar regla
          </button>
        </div>
      </footer>
    </div>
  );
}

function ActionValue({
  a,
  others,
  listId,
  onChange,
}: {
  a: Action;
  others: Column[];
  listId: string;
  onChange: (a: Action) => void;
}) {
  switch (a.type) {
    case 'move':
      return (
        <>
          <select
            value={a.list ?? ''}
            aria-label="Columna destino"
            onChange={(e) => onChange({ ...a, list: e.target.value })}
          >
            {!others.some((c) => c.id === a.list) && <option value="">Elige una columna</option>}
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Seg
            value={a.where ?? 'bottom'}
            options={[
              ['top', 'Arriba'],
              ['bottom', 'Abajo'],
            ]}
            onChange={(v) => onChange({ ...a, where: v as 'top' | 'bottom' })}
          />
        </>
      );
    case 'due':
      return (
        <>
          <select
            value={a.value ?? 'today'}
            aria-label="Fecha"
            onChange={(e) => onChange({ ...a, value: e.target.value, days: a.days ?? 3 })}
          >
            {(Object.keys(dueLabels) as DueMode[]).map((k) => (
              <option key={k} value={k}>
                {dueLabels[k]}
              </option>
            ))}
          </select>
          {a.value === 'days' && (
            <input
              type="number"
              className="num"
              min={0}
              max={365}
              value={a.days ?? 3}
              aria-label="Días"
              onChange={(e) => onChange({ ...a, days: Math.max(0, Number(e.target.value) || 0) })}
            />
          )}
        </>
      );
    case 'add_tag':
    case 'remove_tag':
      return (
        <input
          list={listId}
          value={a.value ?? ''}
          placeholder="etiqueta"
          aria-label="Etiqueta"
          onChange={(e) => onChange({ ...a, value: e.target.value })}
        />
      );
    case 'priority':
      return <PrioPick value={(a.value ?? '') as Priority} onChange={(v) => onChange({ ...a, value: v })} />;
    case 'color':
      return <Swatches value={a.value ?? ''} onChange={(v) => onChange({ ...a, value: v })} />;
    case 'highlight':
      return (
        <Seg
          value={a.on === false ? 'off' : 'on'}
          options={[
            ['on', 'Resaltar'],
            ['off', 'Quitar'],
          ]}
          onChange={(v) => onChange({ ...a, on: v === 'on' })}
        />
      );
    case 'snooze':
      return (
        <label className="bdr-inline">
          <input
            type="number"
            className="num"
            min={1}
            max={365}
            value={a.days ?? 1}
            aria-label="Días"
            onChange={(e) => onChange({ ...a, days: Math.max(1, Number(e.target.value) || 1) })}
          />
          días
        </label>
      );
    case 'add_checks':
      return (
        <textarea
          rows={3}
          value={(a.items ?? []).join('\n')}
          placeholder={'Un punto por línea'}
          aria-label="Puntos de la lista"
          onChange={(e) => onChange({ ...a, items: e.target.value.split('\n') })}
        />
      );
    default:
      return null;
  }
}

function Step({
  n,
  label,
  optional,
  children,
}: {
  n: number;
  label: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="bdr-step">
      <span className="bdr-step-n">{n}</span>
      <div className="bdr-step-body">
        <span className="bdr-step-label">
          {label} {optional && <small>opcional</small>}
        </span>
        {children}
      </div>
    </div>
  );
}

function Seg({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: [string, string][];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className={'bdr-seg' + (disabled ? ' off' : '')} role="radiogroup">
      {options.map(([k, label]) => (
        <button
          type="button"
          key={k}
          role="radio"
          aria-checked={value === k}
          disabled={disabled}
          className={value === k ? 'on' : ''}
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PrioPick({ value, onChange }: { value: Priority; onChange: (v: Priority) => void }) {
  return (
    <div className="bdr-seg">
      {PRIOS.map((p) => (
        <button
          type="button"
          key={p || 'none'}
          className={(value === p ? 'on ' : '') + 'p-' + (p || 'none')}
          aria-pressed={value === p}
          onClick={() => onChange(p)}
        >
          {priorityLabels[p]}
        </button>
      ))}
    </div>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="bdr-swatches">
      <button
        type="button"
        className={'none' + (!value ? ' on' : '')}
        title="Sin color"
        aria-label="Sin color"
        onClick={() => onChange('')}
      />
      {tones.map((t) => (
        <button
          type="button"
          key={t.key}
          className={value === t.key ? 'on' : ''}
          style={{ background: t.c }}
          title={t.label}
          aria-label={t.label}
          onClick={() => onChange(t.key)}
        />
      ))}
    </div>
  );
}
