import { useMemo, type CSSProperties } from 'react';
import { Pencil } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Episode } from '../data';
import { episodeKindOf } from '../lib/episodes';
import { friendlyDate, todayInputValue } from '../lib/format';
import type { Fact } from '../lib/entries';
import { Avatar } from '../people/Avatar';

const MAX_FACES = 3;
/** «12 nov» de un AAAA-MM-DD (a mediodía: así no cambia de día por la zona horaria). */
const dayLabel = (d: string) =>
  new Date(d + 'T12:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

/**
 * Un episodio con la misma tarjeta que los recuerdos (ver NoteTile): su tipo, cuándo lo creaste,
 * el título, el resumen, en qué va y con quién. Al tocarla se abre el episodio.
 */
export function EpisodeTile({ episode: ep }: { episode: Episode }) {
  const { workspace, go, openEpisode } = useApp();
  const k = episodeKindOf(ep.kind);
  const people = workspace.people.filter((p) => ep.person_ids.includes(p.id));
  const inside = useMemo(
    () => workspace.entries.filter((e) => e.episode_id === ep.id).length,
    [workspace.entries, ep.id],
  );
  const today = todayInputValue();
  const photo = ep.images?.[0];

  const facts: Fact[] = [
    ep.status === 'cerrado'
      ? { text: 'Cerrado' }
      : ep.starts_on && ep.starts_on > today
        ? { text: 'Próximo', tone: 'warn' }
        : { text: 'En curso' },
  ];
  if (ep.starts_on)
    facts.push({
      text:
        ep.ends_on && ep.ends_on !== ep.starts_on
          ? `${dayLabel(ep.starts_on)} – ${dayLabel(ep.ends_on)}`
          : dayLabel(ep.starts_on),
    });
  if (inside) facts.push({ text: `${inside} ${inside === 1 ? 'recuerdo' : 'recuerdos'}` });

  return (
    <article
      className={'nt' + (photo ? ' has-photo' : '')}
      style={{ '--c': k.color, '--s': k.soft, '--k': k.color } as CSSProperties}
    >
      {photo && (
        <div className="nt-photo">
          <img src={photo.medium ?? photo.url} alt="" loading="lazy" />
          {ep.images.length > 1 && <span>+{ep.images.length - 1}</span>}
        </div>
      )}
      <div className="nt-top">
        <span className="nt-kind">
          <k.icon size={12} /> {k.label}
        </span>
        <time dateTime={ep.created_at}>
          {friendlyDate(todayInputValue(new Date(ep.created_at)))}
        </time>
      </div>

      <div className="nt-main">
        <div>
          <h3>
            <button type="button" className="nt-open" onClick={() => go('Episodios', ep)}>
              <span>{ep.title}</span>
            </button>
          </h3>
          {ep.summary && <p>{ep.summary}</p>}
        </div>
      </div>

      <div className="nt-facts">
        {facts.map((f) => (
          <span key={f.text} className={f.tone}>
            {f.text}
          </span>
        ))}
      </div>

      {people.length > 0 && (
        <footer className="nt-foot">
          <span className="nt-faces" title={people.map((p) => p.name).join(', ')}>
            {people.slice(0, MAX_FACES).map((p) => (
              <Avatar key={p.id} person={p} size={22} />
            ))}
            {people.length > MAX_FACES && <i>+{people.length - MAX_FACES}</i>}
            {people.length === 1 && <em>{people[0].name.split(' ')[0]}</em>}
          </span>
        </footer>
      )}

      <button
        type="button"
        className="nt-edit"
        aria-label="Editar episodio"
        title="Editar"
        onClick={() => openEpisode(ep)}
      >
        <Pencil size={13} />
      </button>
    </article>
  );
}
