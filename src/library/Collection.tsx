import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowUpDown,
  Check,
  Images,
  LayoutDashboard,
  List,
  Star,
  TrendingUp,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { Avatar } from '../people/Avatar';
import { isActive, progressOf } from './progress';
import { useApp } from '../AppContext';
import type { Entry } from '../data';
import { Masonry } from '../components/Masonry';
import { kindMeta } from '../composer/kinds';
import {
  bookPace,
  entryFacts,
  entrySummary,
  etaLabel,
  isSeries,
  signedAmount,
} from '../lib/entries';
import { friendlyDate, todayInputValue } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { MenuItem, Popover } from '../planner/BoardPopover';
import {
  captionOf,
  sortLabels,
  statusOf,
  toneOf,
  type SortId,
  type Status,
  type ViewMode,
} from './shelf';

export const toneVars = (t: { accent: string; soft: string; ink: string }) =>
  ({ '--c': t.accent, '--s': t.soft, '--k': t.ink }) as CSSProperties;

const viewMeta: Record<ViewMode, { label: string; icon: LucideIcon }> = {
  portadas: { label: 'Portadas', icon: Images },
  tarjetas: { label: 'Tarjetas', icon: LayoutDashboard },
  lista: { label: 'Lista', icon: List },
};

/** Portadas · Tarjetas · Lista. */
export function ViewSwitch({
  views,
  value,
  onChange,
}: {
  views: ViewMode[];
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  if (views.length < 2) return null;
  return (
    <div className="lt-views" role="radiogroup" aria-label="Vista">
      {views.map((v) => {
        const { label, icon: Icon } = viewMeta[v];
        return (
          <button
            type="button"
            role="radio"
            key={v}
            aria-checked={value === v}
            aria-label={label}
            title={label}
            className={value === v ? 'on' : ''}
            onClick={() => onChange(v)}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}

/** Botón «Ordenar» con su menú. */
export function SortMenu<T extends string = SortId>({
  options,
  value,
  onChange,
  labels = sortLabels as Record<string, string>,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Record<string, string>;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  if (options.length < 2) return null;
  return (
    <>
      <button
        type="button"
        className="lt-tool"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <ArrowUpDown size={14} /> <span>{labels[value]}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} label="Ordenar" width={210} onClose={() => setAnchor(null)}>
          {options.map((o) => (
            <MenuItem
              key={o}
              icon={<Check size={14} style={{ opacity: o === value ? 1 : 0 }} />}
              onClick={() => {
                onChange(o);
                setAnchor(null);
              }}
            >
              {labels[o]}
            </MenuItem>
          ))}
        </Popover>
      )}
    </>
  );
}

/** Estantes de una sección («Todos», «Por ver», «Vistas»…), cada uno con cuántos tiene. */
export type ShelfToggle = {
  label: string;
  icon: LucideIcon;
  count: number;
  on: boolean;
  onToggle: () => void;
  /** Color con el que se enciende. */
  tone?: { accent: string; soft: string; ink: string };
  /** Se muestra aunque esté en cero (p. ej. «Citas», para poder añadir la primera). */
  keep?: boolean;
};

/**
 * Estantes de una sección («Todos», «Por ver», «Vistas»…), cada uno con cuántos tiene. `toggles`
 * son pastillas aparte que se encienden o apagan (p. ej. «Series» o «Citas»).
 */
export function ShelfChips({
  items,
  value,
  onChange,
  toggles = [],
}: {
  items: { id: string; label: string; count: number }[];
  value: string;
  onChange: (id: string) => void;
  toggles?: ShelfToggle[];
}) {
  const shown = toggles.filter((t) => t.count > 0 || t.on || t.keep);
  return (
    <div className="lt-shelves">
      <span className="lt-shelf-group" role="radiogroup" aria-label="Estante">
        {items
          .filter((s) => s.count > 0 || s.id === value || s.id === 'todos')
          .map((s) => (
            <button
              type="button"
              role="radio"
              key={s.id}
              aria-checked={value === s.id}
              className={value === s.id ? 'on' : ''}
              onClick={() => onChange(s.id)}
            >
              {s.label} <i>{s.count}</i>
            </button>
          ))}
      </span>
      {shown.length > 0 && <span className="lt-shelves-div" aria-hidden="true" />}
      {shown.map((t) => (
        <button
          type="button"
          key={t.label}
          aria-pressed={t.on}
          className={'lt-toggle' + (t.on ? ' on' : '')}
          style={t.tone ? toneVars(t.tone) : undefined}
          onClick={t.onToggle}
        >
          <t.icon size={13} /> {t.label} <i>{t.count}</i>
        </button>
      ))}
    </div>
  );
}

/** Píldora de estado sobre una portada. */
export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={'lt-pill ' + status.tone}>
      {status.tone === 'done' && <Check size={11} strokeWidth={3} />}
      {status.label}
    </span>
  );
}

export function RatingPill({ value }: { value?: number }) {
  if (!value) return null;
  return (
    <span className="lt-rate" aria-label={`${value} de 5`}>
      <Star size={11} /> {value}
    </span>
  );
}

/** Portada sin imagen: el título en grande, como la tapa de un libro o un póster tipográfico. */
export function CoverPlaceholder({
  icon: Icon,
  title,
  sub,
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
}) {
  return (
    <span className="lt-ph">
      <Icon size={16} />
      <b>{title}</b>
      {sub && <small>{sub}</small>}
    </span>
  );
}

/**
 * Póster de una película o serie, o portada de un libro. Si no hay (o no carga), una portada
 * tipográfica con el título.
 */
export function Poster({ entry }: { entry: Entry }) {
  const img = entryImages(entry)[0];
  const src = img ? (img.medium ?? img.url) : '';
  const [broken, setBroken] = useState('');
  if (src && broken !== src)
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(src)}
      />
    );
  const Icon = isSeries(entry) ? Tv : kindMeta[entry.kind].icon;
  return <CoverPlaceholder icon={Icon} title={entry.title} sub={captionOf(entry)} />;
}

/** Una película, serie o libro en la cuadrícula de portadas: solo el póster. */
function CoverTile({ entry }: { entry: Entry }) {
  const { viewEntry } = useApp();
  const label = [entry.title, captionOf(entry)].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      className="lt-cover"
      style={toneVars(toneOf(entry))}
      title={label}
      aria-label={label}
      onClick={() => viewEntry(entry)}
    >
      <span className="lt-art">
        <Poster entry={entry} />
      </span>
    </button>
  );
}

export function CoverGrid({ children }: { children: ReactNode }) {
  return <div className="lt-covers">{children}</div>;
}

/** Fila de la vista de lista: miniatura, título, datos y fecha. */
function EntryRow({ entry, today }: { entry: Entry; today: string }) {
  const { workspace, viewEntry, toggleEntry } = useApp();
  const tone = toneOf(entry);
  const img = entryImages(entry)[0];
  const media = entry.kind === 'Película' || entry.kind === 'Libro';
  const Icon = isSeries(entry) ? Tv : kindMeta[entry.kind].icon;
  const pace = bookPace(entry);
  // Películas, series y libros: estado y año o autor. El resto: sus datos breves.
  const line = (
    media
      ? [pace ? '' : statusOf(entry)?.label, captionOf(entry)]
      : entryFacts(entry, workspace, today)
          .slice(0, 3)
          .map((f) => f.text)
  )
    .filter(Boolean)
    .join(' · ');
  const done = entry.kind === 'Pendiente' && entry.status === 'completado';
  return (
    <li className={'lt-row' + (done ? ' done' : '')} style={toneVars(tone)}>
      {entry.kind === 'Pendiente' && (
        <button
          type="button"
          className={'lt-check' + (done ? ' on' : '')}
          aria-label={done ? 'Reabrir pendiente' : 'Marcar como hecho'}
          onClick={() => toggleEntry(entry)}
        >
          <Check size={12} />
        </button>
      )}
      <button type="button" className="lt-row-open" onClick={() => viewEntry(entry)}>
        <span className={'lt-thumb' + (media ? ' media' : '')}>
          {img && entry.kind !== 'Movimiento' ? (
            <img src={img.thumb ?? img.medium ?? img.url} alt="" loading="lazy" />
          ) : (
            <Icon size={15} />
          )}
        </span>
        <span className="lt-row-main">
          <strong>{entry.title || entry.kind}</strong>
          <small>{line || entrySummary(entry)}</small>
          {pace && (
            <span className="lt-row-bar">
              <b>
                <i style={{ width: pace.percent + '%' }} />
              </b>
              {pace.percent}%{pace.eta ? ` · ${etaLabel(pace.eta, today).toLowerCase()}` : ''}
            </span>
          )}
        </span>
        <span className="lt-row-side">
          {entry.kind === 'Movimiento' ? (
            <b className={'lt-amount ' + entry.direction}>{signedAmount(entry)}</b>
          ) : entry.details.rating ? (
            <span className="lt-row-rate">
              <Star size={11} /> {entry.details.rating}
            </span>
          ) : null}
          <time dateTime={entry.created_at}>
            {friendlyDate(todayInputValue(new Date(entry.created_at)), today)}
          </time>
        </span>
      </button>
    </li>
  );
}

export function EntryRows({ entries }: { entries: Entry[] }) {
  const today = todayInputValue();
  return (
    <ul className="lt-list">
      {entries.map((e) => (
        <EntryRow key={e.id} entry={e} today={today} />
      ))}
    </ul>
  );
}

const MAX_FACES = 3;

/**
 * Película, serie o libro en tarjeta (estilo Pinterest): el póster arriba y debajo solo lo que
 * tenga (reseña, frase, con quién). Sin reseña, la tarjeta se queda en póster y título; el texto
 * largo se corta y se lee completo en la ficha.
 */
function MediaCard({ entry }: { entry: Entry }) {
  const { workspace, viewEntry, openProgress } = useApp();
  const status = statusOf(entry);
  const pace = bookPace(entry);
  const caption = captionOf(entry);
  const text = entrySummary(entry);
  const people = workspace.people.filter((p) => entry.person_ids.includes(p.id));
  const active = isActive(entry);
  const where = active && entry.kind === 'Película' ? progressOf(entry).text : '';
  return (
    <article className="lt-mc" style={toneVars(toneOf(entry))}>
      <span className="lt-art">
        <Poster entry={entry} />
        {status && <StatusPill status={status} />}
        <RatingPill value={entry.details.rating} />
        {pace && (
          <span className="lt-bar" aria-hidden="true">
            <i style={{ width: pace.percent + '%' }} />
          </span>
        )}
      </span>
      <div className="lt-mc-body">
        <h3>
          <button type="button" className="lt-mc-open" onClick={() => viewEntry(entry)}>
            {entry.title}
          </button>
        </h3>
        {caption && <small>{caption}</small>}
        {pace?.eta && <small className="lt-eta">{etaLabel(pace.eta)}</small>}
        {where && where !== 'Viéndola' && <small className="lt-eta">{where}</small>}
        {text && <p>{text}</p>}
        {(people.length > 0 || active) && (
          <div className="lt-mc-foot">
            {people.length > 0 && (
              <span className="lt-mc-faces" title={people.map((p) => p.name).join(', ')}>
                {people.slice(0, MAX_FACES).map((p) => (
                  <Avatar key={p.id} person={p} size={20} />
                ))}
                {people.length === 1 && <em>{people[0].name.split(' ')[0]}</em>}
                {people.length > MAX_FACES && <em>+{people.length - MAX_FACES}</em>}
              </span>
            )}
            {active && (
              <button type="button" className="lt-mc-up" onClick={() => openProgress(entry)}>
                <TrendingUp size={13} /> Actualizar
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** Recuerdos en la vista elegida. Con `media`, las tarjetas son de póster (películas y libros). */
export function EntryCollection({
  entries,
  view,
  media,
}: {
  entries: Entry[];
  view: ViewMode;
  media?: boolean;
}) {
  if (view === 'lista') return <EntryRows entries={entries} />;
  if (view === 'portadas')
    return (
      <CoverGrid>
        {entries.map((e) => (
          <CoverTile key={e.id} entry={e} />
        ))}
      </CoverGrid>
    );
  if (media)
    return (
      <Masonry
        entries={entries}
        min={190}
        max={5}
        gap={16}
        render={(e) => <MediaCard entry={e} />}
      />
    );
  return <Masonry entries={entries} />;
}

/** Sin nada que mostrar: lo dice y ofrece añadir. */
export function EmptyState({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon;
  title: string;
  action?: { label: string; run: () => void };
}) {
  return (
    <div className="lt-empty">
      <span>
        <Icon size={20} />
      </span>
      <strong>{title}</strong>
      {action && (
        <button type="button" className="lt-add soft" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}
