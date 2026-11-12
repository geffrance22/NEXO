import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownRight, ArrowUpRight, Minus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import type { Person, ThermoAdjust } from '../data';
import { itemsOf } from '../finance/model';
import { useFinance } from '../finance/store';
import { useInstants } from '../instants/store';
import { addDays, friendlyDate, todayInputValue } from '../lib/format';
import type { PersonStats } from '../lib/people';
import {
  factorLabels,
  FRACTURE,
  celsius,
  rhythmLabel,
  signedCelsius,
  thermoAt,
  thermoColor,
  thermoHistory,
  thermoLabel,
  thermoModel,
  thermoOf,
  thermoReasons,
  type ThermoInput,
  type ThermoSummary,
} from '../lib/thermo';
import './thermo.css';

/** Lo que el termómetro necesita además de la persona: deudas, instantes y episodios. */
export function useThermoData() {
  const { workspace } = useApp();
  const fin = useFinance();
  const { list } = useInstants();
  const debts = useMemo(() => itemsOf(fin.items, 'deuda'), [fin.items]);
  return useMemo(
    () => ({ episodes: workspace.episodes, debts, instants: list }),
    [workspace.episodes, debts, list],
  );
}

/** La temperatura de una persona hoy (null si está en memoria). */
export function useThermo(person: Person, stats: PersonStats) {
  const extra = useThermoData();
  const input = useMemo<ThermoInput>(
    () => ({ person, entries: stats.entries, ...extra }),
    [person, stats.entries, extra],
  );
  const reading = useMemo(() => thermoOf(input), [input]);
  return { input, reading };
}

const trendText = (t: number) =>
  t >= 2 ? `subió ${celsius(t)}` : t <= -2 ? `bajó ${celsius(-t)}` : 'estable';
function TrendIcon({ t, size = 13 }: { t: number; size?: number }) {
  if (t >= 2) return <ArrowUpRight size={size} />;
  if (t <= -2) return <ArrowDownRight size={size} />;
  return <Minus size={size} />;
}

/** La barra del termómetro, bajo la cercanía: el color y la marca dicen qué tan cálida está. */
export function ThermoBar({ reading, onOpen }: { reading: ThermoSummary; onOpen: () => void }) {
  const v = reading.value;
  return (
    <button
      type="button"
      className="pp-thermo"
      style={{ '--tv': `${v}%`, '--tc': reading.color, '--t0': thermoColor(Math.max(0, v - 55)) } as CSSProperties}
      title={`Termómetro de la relación: ${celsius(v)} · ${reading.label} · ${trendText(reading.trend)} en 30 días. Toca para ver su historia.`}
      aria-label={`Termómetro: ${v} grados centígrados, ${reading.label}. Ver su historia`}
      onClick={onOpen}
    >
      <span className="pp-thermo-track" aria-hidden="true">
        <i />
      </span>
      <span className="pp-thermo-label">
        <b>{celsius(v)}</b> {reading.label}
        <span className={'pp-thermo-trend' + (reading.trend >= 2 ? ' up' : reading.trend <= -2 ? ' down' : '')}>
          <TrendIcon t={reading.trend} size={12} />
        </span>
      </span>
    </button>
  );
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const W = 640;
const H = 210;
const PAD = { l: 44, r: 12, t: 14, b: 26 };

/** Gráfico del último año: la línea toma el color de su temperatura (azul abajo, naranja arriba). */
function ThermoChart({
  points,
  adjusts,
  gradId,
}: {
  points: { day: string; value: number; auto: number }[];
  adjusts: ThermoAdjust[];
  gradId: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (iw * i) / Math.max(1, points.length - 1);
  const y = (v: number) => PAD.t + ih * (1 - v / 100);
  // Curva suave (puntos medios) para que no se vea a saltos.
  const path = (key: 'value' | 'auto') =>
    points
      .map((p, i) => {
        const px = x(i);
        const py = y(p[key]);
        if (!i) return `M${px.toFixed(1)},${py.toFixed(1)}`;
        const prev = points[i - 1];
        const mx = (x(i - 1) + px) / 2;
        return `C${mx.toFixed(1)},${y(prev[key]).toFixed(1)} ${mx.toFixed(1)},${py.toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(' ');
  const line = path('value');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`;
  const showAuto = points.some((p) => Math.abs(p.value - p.auto) >= 1);
  // Una etiqueta por mes, donde empieza.
  const ticks = points
    .map((p, i) => ({ i, m: Number(p.day.slice(5, 7)), d: Number(p.day.slice(8, 10)) }))
    .filter((t, k, all) => k === 0 || t.m !== all[k - 1].m)
    .slice(1);
  const first = points[0]?.day ?? '';
  const marks = adjusts
    .filter((a) => a.at >= first)
    .map((a) => {
      const i = points.findIndex((p) => p.day >= a.at);
      return { a, i: i < 0 ? points.length - 1 : i };
    });

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / iw) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="th-chart">
      <svg
        ref={box}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Temperatura de la relación en los últimos 12 meses"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          {/* El color depende de la altura: cada punto de la línea toma su temperatura. */}
          <linearGradient id={gradId + 'l'} gradientUnits="userSpaceOnUse" x1="0" y1={y(100)} x2="0" y2={y(0)}>
            {[100, 80, 60, 45, 25, 8, 0].map((v) => (
              <stop key={v} offset={`${100 - v}%`} stopColor={thermoColor(v)} />
            ))}
          </linearGradient>
          <linearGradient id={gradId + 'a'} gradientUnits="userSpaceOnUse" x1="0" y1={y(100)} x2="0" y2={y(0)}>
            <stop offset="0%" stopColor={thermoColor(85)} stopOpacity="0.26" />
            <stop offset="55%" stopColor={thermoColor(50)} stopOpacity="0.1" />
            <stop offset="100%" stopColor={thermoColor(10)} stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {[20, 40, 60, 80].map((v) => (
          <g key={v} className="th-grid">
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text x={PAD.l - 8} y={y(v) + 3.5}>
              {v} °C
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t.i} className="th-tick" x={x(t.i)} y={H - 7}>
            {MONTHS[t.m - 1]}
          </text>
        ))}
        <path d={area} fill={`url(#${gradId}a)`} />
        {showAuto && <path d={path('auto')} className="th-auto" />}
        <path d={line} className="th-line" stroke={`url(#${gradId}l)`} />
        {marks.map(({ a, i }) => (
          <g key={a.id} className="th-mark">
            <line x1={x(i)} x2={x(i)} y1={PAD.t} y2={y(0)} />
            <circle cx={x(i)} cy={y(points[i].value)} r="4.5" />
          </g>
        ))}
        {h && hover !== null && (
          <g className="th-hover">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={y(0)} />
            <circle cx={x(hover)} cy={y(h.value)} r="5" fill={thermoColor(h.value)} />
          </g>
        )}
        <circle
          cx={x(points.length - 1)}
          cy={y(points[points.length - 1].value)}
          r="5.5"
          className="th-now"
          fill={thermoColor(points[points.length - 1].value)}
        />
      </svg>
      {h && hover !== null && (
        <div
          // Junto al punto, siempre dentro del gráfico: cerca de un borde se abre hacia adentro, y
          // si el punto está arriba, el globo va debajo.
          className={
            'th-tip' +
            (x(hover) / W < 0.22 ? ' start' : x(hover) / W > 0.78 ? ' end' : '') +
            (y(h.value) / H < 0.4 ? ' below' : '')
          }
          style={
            {
              left: `${(x(hover) / W) * 100}%`,
              top: `${(y(h.value) / H) * 100}%`,
            } as CSSProperties
          }
        >
          <b style={{ color: thermoColor(h.value) }}>{celsius(h.value)}</b> {thermoLabel(h.value)}
          <small>{hover === points.length - 1 ? 'Hoy' : `Semana del ${friendlyDate(h.day)}`}</small>
        </div>
      )}
    </div>
  );
}

/**
 * La historia del termómetro en una ventana translúcida: cómo cambió en los últimos 12 meses, qué
 * lo calienta y qué lo enfría hoy, y el ajuste a mano (con su razón, si quieres).
 */
export function ThermoSheet({
  person,
  input,
  onClose,
}: {
  person: Person;
  input: ThermoInput;
  onClose: () => void;
}) {
  const { patchPerson, notify } = useApp();
  const today = todayInputValue();
  const model = useMemo(() => thermoModel(input, today), [input, today]);
  const points = useMemo(() => thermoHistory(model, today), [model, today]);
  const now = useMemo(() => thermoAt(model, today), [model, today]);
  const month = useMemo(() => thermoAt(model, addDays(today, -30)), [model, today]);
  const fresh = model.created > addDays(today, -30);
  const year = points.length > 1 && points[0].day <= addDays(today, -300) ? points[0] : null;
  const reasons = useMemo(() => thermoReasons(input, now, today), [input, now, today]);
  const warm = reasons.filter((r) => r.degrees > 0).slice(0, 6);
  const cold = reasons.filter((r) => r.degrees < 0).slice(0, 6);
  const adjusts = useMemo(
    () => [...(person.profile.thermo ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
    [person.profile.thermo],
  );
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(now.value);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const gradId = useMemo(() => 'th' + Math.random().toString(36).slice(2, 8), []);
  const first = person.name.split(' ')[0];
  const color = thermoColor(now.value);
  const trend = fresh ? 0 : now.value - month.value;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const item: ThermoAdjust = {
      id: crypto.randomUUID(),
      at: today,
      value: Math.round(Math.max(0, Math.min(100, target))),
      computed: now.auto,
      ...(why.trim() && { why: why.trim().replace(/\s+/g, ' ').slice(0, 200) }),
    };
    // Un ajuste por día: el de hoy reemplaza al anterior de hoy.
    const list = [item, ...adjusts.filter((a) => a.at !== today)].slice(0, 30);
    const ok = await patchPerson(person, { profile: { ...person.profile, thermo: list } }, true);
    setBusy(false);
    if (!ok) return;
    setEditing(false);
    setWhy('');
    notify(`Termómetro de ${first} en ${celsius(item.value)}. Nexo sigue sumando desde ahí.`);
  };
  const remove = (id: string) =>
    void patchPerson(
      person,
      { profile: { ...person.profile, thermo: adjusts.filter((a) => a.id !== id) } },
      true,
    );

  // A document.body: dentro de la ficha (o de la ficha lateral) el encabezado de la app la tapaba.
  return createPortal(
    <Sheet label={`Termómetro de ${person.name}`} className="th-sheet" onRequestClose={onClose}>
      <div className="th" style={{ '--tc': color } as CSSProperties}>
        <header className="th-head">
          <span>
            <small>Termómetro de la relación</small>
            <h2>{person.name}</h2>
          </span>
          <button type="button" className="th-x" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="th-hero">
          <b className="th-value">
            {now.value}
            <small>°C</small>
          </b>
          <span className="th-hero-text">
            <strong>{thermoLabel(now.value)}</strong>
            <small>
              {now.value < FRACTURE
                ? 'Pesan más los roces y lo que no se cumplió que lo bueno'
                : rhythmLabel(person)}
            </small>
          </span>
          <span className="th-stats">
            <span className={trend >= 2 ? 'up' : trend <= -2 ? 'down' : ''}>
              <TrendIcon t={trend} /> {signedCelsius(trend)} <small>en 30 días</small>
            </span>
            {year && (
              <span>
                {signedCelsius(now.value - year.value)} <small>en el año</small>
              </span>
            )}
          </span>
        </div>

        <ThermoChart points={points} adjusts={adjusts} gradId={gradId} />

        {(warm.length > 0 || cold.length > 0) && (
          <div className="th-reasons">
            <section>
              <h3>Lo que la calienta</h3>
              {!warm.length && <p className="th-empty">Aún nada reciente.</p>}
              <ul>
                {warm.map((r) => (
                  <li key={r.factor}>
                    <em className="warm">{signedCelsius(r.degrees)}</em>
                    <span>
                      <b>{factorLabels[r.factor]}</b>
                      <small>{r.text}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3>Lo que la enfría</h3>
              {!cold.length && <p className="th-empty">Nada la está enfriando.</p>}
              <ul>
                {cold.map((r) => (
                  <li key={r.factor}>
                    <em className="cold">{signedCelsius(r.degrees)}</em>
                    <span>
                      <b>{factorLabels[r.factor]}</b>
                      <small>{r.text}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        <div className="th-adjust">
          {editing ? (
            <div className="th-adjust-form">
              <div className="th-slider-row">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={target}
                  aria-label="Temperatura"
                  style={{ '--sv': `${target}%`, '--sc': thermoColor(target) } as CSSProperties}
                  onChange={(e) => setTarget(Number(e.target.value))}
                />
                <b style={{ color: thermoColor(target) }}>
                  {celsius(target)} <small>{thermoLabel(target)}</small>
                </b>
              </div>
              <input
                className="th-why"
                value={why}
                maxLength={200}
                placeholder="¿Por qué? (opcional) · nos reconciliamos, está distante…"
                onChange={(e) => setWhy(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void save();
                  }
                }}
              />
              <p className="th-note">
                Desde tu ajuste, Nexo sigue sumando y restando lo que pase. Tu ajuste pesa completo
                hoy y se va diluyendo en el año.
              </p>
              <div className="th-actions">
                <button type="button" className="th-btn ghost" onClick={() => setEditing(false)}>
                  Cancelar
                </button>
                <button type="button" className="th-btn" disabled={busy} onClick={() => void save()}>
                  Guardar ajuste
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="th-btn ghost"
              onClick={() => {
                setTarget(now.value);
                setEditing(true);
              }}
            >
              <SlidersHorizontal size={15} /> Ajustar a mano
            </button>
          )}
          {adjusts.length > 0 && (
            <ul className="th-adjusts">
              {adjusts.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <i style={{ background: thermoColor(a.value) }} />
                  <span>
                    <b>
                      {celsius(a.value)} <small>(el cálculo marcaba {celsius(a.computed)})</small>
                    </b>
                    {a.why && <small>«{a.why}»</small>}
                  </span>
                  <time>{friendlyDate(a.at)}</time>
                  <button type="button" aria-label="Quitar ajuste" onClick={() => remove(a.id)}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>,
    document.body,
  );
}
