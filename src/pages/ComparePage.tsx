import { useState } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Kind, Person } from '../data';
import { initials, normalizeText, splitList } from '../lib/format';

const comparedKinds: Kind[] = ['Trabajo', 'Aprendizaje', 'Libro', 'Película', 'Encuentro'];

function commonInterests(a: Person | undefined, b: Person | undefined) {
  if (!a || !b) return 'Para tu perfil, todavía no se han registrado intereses explícitos.';
  const theirs = new Set(splitList(b.interests).map(normalizeText));
  const common = splitList(a.interests).filter((s) => theirs.has(normalizeText(s)));
  return common.join(' · ') || 'No hay coincidencias explícitas registradas.';
}

export function ComparePage() {
  const { workspace } = useApp();
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const picks = [
    { value: first, set: setFirst },
    { value: second, set: setSecond },
  ];
  const find = (id: string) => workspace.people.find((p) => p.id === id);

  return (
    <>
      <div className="compare-intro">
        <GitCompareArrows size={28} />
        <p>
          Elige dos perfiles para explorar intereses en común y actividad registrada. Los vacíos de
          información no son diferencias personales.
        </p>
      </div>
      <div className="compare-selects">
        {picks.map(({ value, set }, i) => (
          <select key={i} value={value} onChange={(e) => set(e.target.value)}>
            <option value="">Selecciona un perfil</option>
            <option value="me">Yo · mi historial</option>
            {workspace.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ))}
      </div>
      {first && second ? (
        <>
          <div className="compare-grid">
            {[first, second].map((id, i) => {
              const p = find(id);
              const records =
                id === 'me'
                  ? workspace.entries
                  : workspace.entries.filter((e) => e.person_ids.includes(id));
              return (
                <div className="panel" key={i}>
                  <span className="big-avatar" style={{ background: p?.color || '#dce8ce' }}>
                    {p ? initials(p.name) : 'Yo'}
                  </span>
                  <h2>{p?.name || 'Mi historial'}</h2>
                  <p>{p?.role || 'Mi actividad registrada'}</p>
                  <h4>Intereses declarados</h4>
                  <p>{p?.interests || 'Sin datos explícitos'}</p>
                  <h4>Contexto disponible</h4>
                  <p>{records.length} apuntes vinculados</p>
                  {comparedKinds.map((k) => (
                    <div className="comparison-row" key={k}>
                      <span>{k}</span>
                      <strong>{records.filter((e) => e.kind === k).length}</strong>
                    </div>
                  ))}
                  <small>
                    Basado en tus registros actuales. No mide capacidades ni patrimonio.
                  </small>
                </div>
              );
            })}
          </div>
          <div className="panel">
            <h3>Intereses en común</h3>
            <p>{commonInterests(find(first), find(second))}</p>
          </div>
        </>
      ) : (
        <div className="empty">
          <GitCompareArrows size={32} />
          <h3>Cada historia tiene su propio contexto.</h3>
          <p>Selecciona dos perfiles para comenzar.</p>
        </div>
      )}
    </>
  );
}
