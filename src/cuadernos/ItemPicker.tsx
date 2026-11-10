import { useEffect, useMemo, useState } from 'react';
import { Check, Search, Tv, X, type LucideIcon } from 'lucide-react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { Sheet } from '../components/Sheet';
import { plainText } from '../components/RichText';
import { kindMeta } from '../composer/kinds';
import type { Entry, Person } from '../data';
import { entrySummary, isSeries, kindLabel } from '../lib/entries';
import { friendlyDate, normalizeText, todayInputValue } from '../lib/format';
import { entryImages } from '../lib/moviePosters';
import { toneVars } from '../library/Collection';
import { toneOf, type Tone } from '../library/shelf';
import { Avatar } from '../people/Avatar';
import { hostOf } from './digest';
import { hasRef, type Notebook, type NotebookItemType } from './model';
import { typeMeta } from './resolve';

type Filter =
  | 'todo'
  | 'pendientes'
  | 'trabajo'
  | 'encuentros'
  | 'notas'
  | 'aprendizajes'
  | 'peliculas'
  | 'series'
  | 'libros'
  | 'personas'
  | 'lugares'
  | 'episodios'
  | 'lecturas'
  | 'rapidas';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'pendientes', label: 'Pendientes' },
  { id: 'encuentros', label: 'Encuentros' },
  { id: 'notas', label: 'Diario' },
  { id: 'trabajo', label: 'Trabajo' },
  { id: 'aprendizajes', label: 'Aprendizajes' },
  { id: 'libros', label: 'Libros' },
  { id: 'peliculas', label: 'Películas' },
  { id: 'series', label: 'Series' },
  { id: 'personas', label: 'Personas' },
  { id: 'lugares', label: 'Lugares' },
  { id: 'episodios', label: 'Episodios' },
  { id: 'lecturas', label: 'Lecturas' },
  { id: 'rapidas', label: 'Notas rápidas' },
];

const entryFilter: Partial<Record<Filter, (e: Entry) => boolean>> = {
  pendientes: (e) => e.kind === 'Pendiente',
  trabajo: (e) => e.kind === 'Trabajo',
  encuentros: (e) => e.kind === 'Encuentro',
  notas: (e) => e.kind === 'Nota',
  aprendizajes: (e) => e.kind === 'Aprendizaje',
  libros: (e) => e.kind === 'Libro',
  peliculas: (e) => e.kind === 'Película' && !isSeries(e),
  series: isSeries,
};

type Candidate = {
  type: NotebookItemType;
  id: string;
  title: string;
  sub: string;
  hay: string;
  date: string;
  icon: LucideIcon;
  tone: Tone;
  cover?: string;
  person?: Person;
};

type Remote = {
  id: string;
  title: string;
  url?: string;
  body?: string;
  created_at: string;
};

const MAX = 80;

/** Buscar y marcar lo que entra en el cuaderno (de cualquier sección). */
export function ItemPicker({
  notebook,
  onAdd,
  onClose,
}: {
  notebook: Notebook;
  onAdd: (refs: { type: NotebookItemType; id: string }[]) => void;
  onClose: () => void;
}) {
  const { workspace } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('todo');
  const [picked, setPicked] = useState<Map<string, { type: NotebookItemType; id: string }>>(
    new Map(),
  );
  const [readings, setReadings] = useState<Remote[]>([]);
  const [notes, setNotes] = useState<Remote[]>([]);
  const today = todayInputValue();

  // Lecturas y notas rápidas no están en memoria: se buscan en la base de datos.
  const remoteQuery = query.trim();
  const wantsRemote = filter === 'todo' || filter === 'lecturas' || filter === 'rapidas';
  useEffect(() => {
    if (!wantsRemote) return;
    let live = true;
    const t = window.setTimeout(async () => {
      // Sin comodines ni signos que la sintaxis de filtros interpretaría.
      const like = `%${remoteQuery.replace(/[%_\\,()"*]/g, ' ').trim()}%`;
      let r = supabase
        .from('reading_cards')
        .select('id,title,url,created_at')
        .order('created_at', { ascending: false })
        .limit(40);
      let n = supabase
        .from('quick_notes')
        .select('id,title,body,created_at')
        .eq('archived', false)
        .eq('vaulted', false)
        .order('created_at', { ascending: false })
        .limit(40);
      if (remoteQuery) {
        r = r.ilike('title', like);
        n = n.or(`title.ilike.${like},body.ilike.${like}`);
      }
      const [rr, first] = await Promise.all([r, n]);
      // Sin la migración de la bóveda no existe `vaulted`: se repite sin ese filtro.
      let nn = first;
      if (first.error?.code === '42703') {
        let plain = supabase
          .from('quick_notes')
          .select('id,title,body,created_at')
          .eq('archived', false)
          .order('created_at', { ascending: false })
          .limit(40);
        if (remoteQuery) plain = plain.or(`title.ilike.${like},body.ilike.${like}`);
        nn = await plain;
      }
      if (!live) return;
      setReadings((rr.data ?? []) as Remote[]);
      setNotes((nn.data ?? []) as Remote[]);
    }, 220);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [remoteQuery, wantsRemote]);

  const candidates = useMemo(() => {
    const out: Candidate[] = [];
    const date = (iso: string) => friendlyDate(todayInputValue(new Date(iso)), today);
    const want = (f: Filter) => filter === 'todo' || filter === f;
    const onlyEntries = entryFilter[filter];
    if (filter === 'todo' || onlyEntries) {
      for (const e of workspace.entries) {
        if (e.kind === 'Movimiento' && filter === 'todo') continue;
        if (onlyEntries && !onlyEntries(e)) continue;
        const img = entryImages(e)[0];
        out.push({
          type: 'entry',
          id: e.id,
          title: e.title || kindLabel(e),
          sub: `${kindLabel(e)} · ${date(e.recorded_at ?? e.created_at)}`,
          hay: normalizeText([e.title, entrySummary(e), e.tags.join(' '), kindLabel(e)].join(' ')),
          date: e.recorded_at ?? e.created_at,
          icon: isSeries(e) ? Tv : kindMeta[e.kind].icon,
          tone: toneOf(e),
          cover: img ? (img.thumb ?? img.medium ?? img.url) : undefined,
        });
      }
    }
    if (want('personas'))
      for (const p of workspace.people)
        out.push({
          type: 'person',
          id: p.id,
          title: p.name,
          sub: ['Persona', p.role].filter(Boolean).join(' · '),
          hay: normalizeText([p.name, p.role, p.profile.alias ?? '', p.interests].join(' ')),
          date: p.created_at,
          icon: typeMeta.person.icon,
          tone: typeMeta.person.tone,
          person: p,
        });
    if (want('lugares'))
      for (const pl of workspace.places)
        out.push({
          type: 'place',
          id: pl.id,
          title: pl.name,
          sub: ['Lugar', pl.city].filter(Boolean).join(' · '),
          hay: normalizeText([pl.name, pl.city, pl.kind].join(' ')),
          date: pl.created_at,
          icon: typeMeta.place.icon,
          tone: typeMeta.place.tone,
        });
    if (want('episodios'))
      for (const ep of workspace.episodes)
        out.push({
          type: 'episode',
          id: ep.id,
          title: ep.title,
          sub: ['Episodio', ep.kind].filter(Boolean).join(' · '),
          hay: normalizeText([ep.title, ep.summary, ep.kind].join(' ')),
          date: ep.created_at,
          icon: typeMeta.episode.icon,
          tone: typeMeta.episode.tone,
        });
    // Lo remoto ya viene filtrado por la búsqueda.
    if (want('lecturas'))
      for (const r of readings)
        out.push({
          type: 'reading',
          id: r.id,
          title: r.title,
          sub: ['Lectura', hostOf(r.url ?? '')].filter(Boolean).join(' · '),
          hay: '',
          date: r.created_at,
          icon: typeMeta.reading.icon,
          tone: typeMeta.reading.tone,
        });
    if (want('rapidas'))
      for (const n of notes)
        out.push({
          type: 'note',
          id: n.id,
          title: n.title || plainText(n.body ?? '').slice(0, 60) || 'Nota',
          sub: `Nota rápida · ${date(n.created_at)}`,
          hay: '',
          date: n.created_at,
          icon: typeMeta.note.icon,
          tone: typeMeta.note.tone,
        });
    return out;
  }, [workspace, filter, readings, notes, today]);

  const needle = normalizeText(query.trim());
  const shown = candidates
    .filter((c) => !needle || !c.hay || c.hay.includes(needle))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX);

  const keyOf = (c: { type: string; id: string }) => c.type + ':' + c.id;
  const toggle = (c: Candidate) =>
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(keyOf(c))) next.delete(keyOf(c));
      else next.set(keyOf(c), { type: c.type, id: c.id });
      return next;
    });

  return (
    <Sheet
      label={`Añadir a ${notebook.name}`}
      size="lg"
      className="cz-picker"
      onRequestClose={onClose}
    >
      <header className="cz-picker-head">
        <div>
          <h2>Añadir al cuaderno</h2>
          <p>Son accesos directos: el original sigue en su sección.</p>
        </div>
        <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <label className="lt-search cz-picker-search">
        <Search size={15} />
        <input
          autoFocus
          type="search"
          placeholder="Buscar recuerdos, personas, lugares, lecturas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="cz-picker-filters" role="radiogroup" aria-label="Tipo">
        {FILTERS.map((f) => (
          <button
            type="button"
            role="radio"
            key={f.id}
            aria-checked={filter === f.id}
            className={filter === f.id ? 'on' : ''}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ul className="cz-picker-list">
        {shown.map((c) => {
          const inside = hasRef(notebook, c.type, c.id);
          const on = picked.has(keyOf(c));
          return (
            <li key={keyOf(c)}>
              <button
                type="button"
                className={(on ? 'on' : '') + (inside ? ' inside' : '')}
                disabled={inside}
                aria-pressed={on}
                style={toneVars(c.tone)}
                onClick={() => toggle(c)}
              >
                <span className="cz-picker-art">
                  {c.person ? (
                    <Avatar person={c.person} size={34} />
                  ) : c.cover ? (
                    <img src={c.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <c.icon size={16} />
                  )}
                </span>
                <span className="cz-picker-main">
                  <strong>{c.title}</strong>
                  <small>{c.sub}</small>
                </span>
                <span className="cz-picker-check" aria-hidden="true">
                  {inside ? 'Ya está' : on ? <Check size={14} /> : null}
                </span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="cz-picker-none">Nada coincide.</li>}
      </ul>
      <footer className="cz-picker-foot">
        <span>
          {picked.size
            ? `${picked.size} ${picked.size === 1 ? 'elegido' : 'elegidos'}`
            : 'Marca lo que quieras reunir'}
        </span>
        <button type="button" className="lt-add soft" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="lt-add"
          disabled={!picked.size}
          onClick={() => onAdd([...picked.values()])}
        >
          Añadir {picked.size || ''}
        </button>
      </footer>
    </Sheet>
  );
}
