import { useApp } from '../AppContext';
import type { Person } from '../data';
import { initials } from '../lib/format';

export function PersonChip({ person }: { person: Person }) {
  const { peekPerson } = useApp();
  return (
    <button
      className="person-chip"
      title={`Ver la ficha de ${person.name}`}
      onClick={() => peekPerson(person)}
    >
      <span style={{ background: person.color }}>{initials(person.name)}</span>
      {person.name.split(' ')[0]}
    </button>
  );
}
