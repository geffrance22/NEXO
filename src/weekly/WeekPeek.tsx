import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Check, Clock, Highlighter, MapPin, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { supabase } from '../backend';
import { Sheet } from '../components/Sheet';
import type { Entry, Episode, Person } from '../data';
import { kindMeta } from '../composer/kinds';
import { episodeKinds, episodeUpdateKinds } from '../lib/episodes';
import { friendlyDate } from '../lib/format';
import { placeKinds } from '../lib/places';
import { Avatar } from '../people/Avatar';
import { MarkNote } from '../readings/AiText';
import { inkOf } from '../readings/ArticleMarks';
import { preview } from '../readings/media';
import { day, type PlaceVisit, type ReadRow, type Week } from './week';

export type Peek =
  | { kind: 'reading'; row: ReadRow }
  | { kind: 'episode'; item: Week['episodes'][number] }
  | { kind: 'place'; visit: PlaceVisit };

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
/** Por encima: la ficha de un recuerdo, una persona o un formulario. */
const ABOVE = '.nx-peek, .modal-backdrop, .sheet-backdrop:not(:has(> .sheet.wk, > .sheet.wkp))';

/**
 * Detalle de algo del periódico sin salir de él: una lectura terminada, un episodio o un lugar.
 * Los recuerdos y las personas se abren encima; «Ver en…» sí lleva a su sección.
 */
export function WeekPeek({ peek, onClose }: { peek: Peek; onClose: () => void }) {
  const label =
    peek.kind === 'reading'
      ? peek.row.title
      : peek.kind === 'episode'
        ? peek.item.episode.title
        : peek.visit.name;
  return (
    <Sheet label={label} className="wkp" yieldTo={ABOVE} onRequestClose={onClose}>
      <button type="button" className="wkp-x" aria-label="Cerrar" onClick={onClose}>
        <X size={18} />
      </button>
      <div className="wkp-scroll">
        {peek.kind === 'reading' && <ReadingDetail row={peek.row} />}
        {peek.kind === 'episode' && <EpisodeDetail item={peek.item} />}
        {peek.kind === 'place' && <PlaceDetail visit={peek.visit} />}
      </div>
    </Sheet>
  );
}

type Mark = { id: string; quote: string | null; note: string; color: string };

function ReadingDetail({ row }: { row: ReadRow }) {
  const { go } = useApp();
  const [excerpt, setExcerpt] = useState('');
  const [marks, setMarks] = useState<Mark[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([
      supabase.from('readings').select('excerpt').eq('id', row.id).maybeSingle(),
      supabase
        .from('reading_marks')
        .select('id,quote,note,color')
        .eq('reading_id', row.id)
        .order('start_offset')
        .limit(40),
    ]).then(([a, m]) => {
      if (!live) return;
      setExcerpt(preview((a.data?.excerpt as string) || '').slice(0, 320));
      setMarks(((m.data ?? []) as Mark[]).filter((x) => x.quote?.trim()));
    });
    return () => {
      live = false;
    };
  }, [row.id]);
  return (
    <>
      {row.cover && (
        <img
          className="wkp-banner"
          src={row.cover}
          alt=""
          referrerPolicy="no-referrer"
          onError={(e) => (e.currentTarget.hidden = true)}
        />
      )}
      <span className="wkp-kicker done">
        <Check size={13} /> Lectura terminada · {friendlyDate(day(row.read_at)).toLowerCase()}
      </span>
      <h2>{row.title}</h2>
      <p className="wkp-meta">
        {host(row.url)}
        {row.minutes ? (
          <>
            {' '}
            · <Clock size={12} /> {row.minutes} min
          </>
        ) : null}
        {row.marks > 0 && (
          <>
            {' '}
            · <Highlighter size={12} /> {row.marks}
          </>
        )}
      </p>
      {excerpt && <p className="wkp-lead">{excerpt}…</p>}
      {marks && marks.length > 0 && (
        <section className="wkp-sec">
          <h3>Lo que resaltaste</h3>
          <ul className="wkp-marks">
            {marks.slice(0, 8).map((m) => (
              <li key={m.id} style={{ '--mc': inkOf(m.color) } as CSSProperties}>
                <blockquote>{m.quote!.trim()}</blockquote>
                {m.note.trim() && <MarkNote text={m.note.trim()} />}
              </li>
            ))}
          </ul>
          {marks.length > 8 && <small className="wkp-more">y {marks.length - 8} más</small>}
        </section>
      )}
      <footer className="wkp-foot">
        <button type="button" className="wkp-go" onClick={() => go('Lecturas', { id: row.id })}>
          Abrir en Lecturas <ArrowUpRight size={14} />
        </button>
      </footer>
    </>
  );
}

function EpisodeDetail({
  item,
}: {
  item: { episode: Episode; updates: Episode['updates']; items: Entry[] };
}) {
  const { workspace, go, viewEntry } = useApp();
  const ep = item.episode;
  const meta = episodeKinds[ep.kind] ?? episodeKinds.otro;
  const people = workspace.people.filter(
    (p) => ep.person_ids.includes(p.id) || item.items.some((e) => e.person_ids.includes(p.id)),
  );
  const range = [ep.starts_on, ep.ends_on]
    .filter(Boolean)
    .map((d) => friendlyDate(d!).toLowerCase())
    .join(' – ');
  return (
    <>
      <span className="wkp-kicker" style={{ color: meta.color }}>
        <meta.icon size={13} /> {meta.label} · {ep.status === 'activo' ? 'En curso' : 'Cerrado'}
        {range && ` · ${range}`}
      </span>
      <h2>{ep.title}</h2>
      {ep.summary && <p className="wkp-lead">{ep.summary}</p>}
      {item.updates.length > 0 && (
        <section className="wkp-sec">
          <h3>Esta semana en la bitácora</h3>
          <ul className="wkp-list">
            {item.updates.map((u) => {
              const k = episodeUpdateKinds[u.kind] ?? episodeUpdateKinds.nota;
              return (
                <li key={u.id}>
                  <span className="wkp-row">
                    <k.icon size={13} style={{ color: k.color, flex: 'none' }} />
                    <span>{u.text}</span>
                    <small>{friendlyDate(u.date).toLowerCase()}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <EntryList title="Recuerdos de esta semana" entries={item.items} onOpen={viewEntry} />
      <Faces people={people} />
      <footer className="wkp-foot">
        <button type="button" className="wkp-go" onClick={() => go('Episodios', ep)}>
          Ver el episodio completo <ArrowUpRight size={14} />
        </button>
      </footer>
    </>
  );
}

function PlaceDetail({ visit }: { visit: PlaceVisit }) {
  const { go, viewEntry, openImages } = useApp();
  const place = visit.place;
  const meta = placeKinds[place?.kind ?? 'otro'] ?? placeKinds.otro;
  const photos = [...(place?.images ?? []), ...visit.visits.flatMap((e) => e.images)];
  const cover = photos[0];
  return (
    <>
      {cover && (
        <button
          type="button"
          className="wkp-banner-btn"
          aria-label="Ver las fotos"
          onClick={() => openImages(photos, 0)}
        >
          <img className="wkp-banner" src={cover.medium ?? cover.url} alt="" />
        </button>
      )}
      <span className="wkp-kicker" style={{ color: meta.color }}>
        <meta.icon size={13} /> {meta.label}
        {place?.city && ` · ${place.city}`}
        {visit.isNew && ' · lugar nuevo'}
      </span>
      <h2>{visit.name}</h2>
      {place?.address && (
        <p className="wkp-meta">
          <MapPin size={12} /> {place.address}
        </p>
      )}
      {place?.story && <p className="wkp-lead">{place.story}</p>}
      <EntryList
        title={visit.visits.length === 1 ? 'Tu visita' : `Tus ${visit.visits.length} visitas`}
        entries={visit.visits}
        onOpen={viewEntry}
      />
      <Faces people={visit.people} title="Con quién estuviste" />
      {place && (
        <footer className="wkp-foot">
          <button type="button" className="wkp-go" onClick={() => go('Lugares', place)}>
            Ver en Lugares <ArrowUpRight size={14} />
          </button>
        </footer>
      )}
    </>
  );
}

function EntryList({
  title,
  entries,
  onOpen,
}: {
  title: string;
  entries: Entry[];
  onOpen: (e: Entry) => void;
}) {
  if (!entries.length) return null;
  return (
    <section className="wkp-sec">
      <h3>{title}</h3>
      <ul className="wkp-list">
        {[...entries]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((e) => {
            const k = kindMeta[e.kind];
            return (
              <li key={e.id}>
                <button type="button" className="wkp-row" onClick={() => onOpen(e)}>
                  <k.icon size={13} style={{ color: k.accent, flex: 'none' }} />
                  <span>{e.title || e.kind}</span>
                  <small>{friendlyDate(day(e.created_at)).toLowerCase()}</small>
                </button>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

function Faces({ people, title = 'Personas' }: { people: Person[]; title?: string }) {
  const { peekPerson } = useApp();
  if (!people.length) return null;
  return (
    <section className="wkp-sec">
      <h3>{title}</h3>
      <div className="wkp-faces">
        {people.slice(0, 10).map((p) => (
          <button type="button" key={p.id} title={p.name} onClick={() => peekPerson(p)}>
            <Avatar person={p} size={30} />
            <span>{p.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
