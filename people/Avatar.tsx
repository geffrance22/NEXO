import type { CSSProperties } from 'react';
import type { Person } from '../data';
import { initials } from '../lib/format';
import { relationMeta } from '../lib/people';

/** Foto de la persona o sus iniciales, con el color de su tipo de relación. */
export function Avatar({
  person,
  size = 44,
  className = '',
}: {
  person: Person;
  size?: number;
  className?: string;
}) {
  const meta = person.profile.relation ? relationMeta[person.profile.relation] : null;
  const photo = person.profile.photo;
  const src = photo
    ? size > 90
      ? (photo.medium ?? photo.url)
      : (photo.thumb ?? photo.medium ?? photo.url)
    : null;
  return (
    <span
      className={'pp-avatar ' + className}
      style={
        {
          width: size,
          height: size,
          fontSize: Math.round(size * 0.36),
          background: meta?.soft ?? person.color,
          color: meta?.ink ?? '#4c5642',
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" loading="lazy" /> : initials(person.name).toUpperCase()}
    </span>
  );
}
