import { ArrowRight, NotebookTabs } from 'lucide-react';
import { useApp } from '../AppContext';
import { friendlyDate, todayInputValue } from '../lib/format';
import { goSection } from '../library/shelf';
import { notebookVars } from './Cuadernos';
import { useCuadernos } from './useCuadernos';
import './cuadernos.css';

/** Como mucho tres: los demás, en «Ver todos». */
const SHOWN = 3;

/**
 * Los cuadernos que tocaste hace poco (para «Recientes» en Mi espacio): una tira de una sola línea.
 * Cada uno abre su lienzo en Agenda.
 */
export function RecentNotebooks() {
  const { go } = useApp();
  const { list, missing } = useCuadernos();
  if (missing || !list?.length) return null;
  const shown = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, SHOWN);
  const today = todayInputValue();

  return (
    <div className="cz-recent">
      <div className="cz-recent-head">
        <span>
          <NotebookTabs size={13} /> Cuadernos
        </span>
        <button type="button" onClick={() => goSection(go, 'Agenda', 'cuadernos')}>
          Ver todos <i>{list.length.toLocaleString('es-CO')}</i> <ArrowRight size={13} />
        </button>
      </div>
      <div className="cz-strip">
        {shown.map((nb) => (
          <button
            type="button"
            key={nb.id}
            className="cz-pill"
            style={notebookVars(nb)}
            title={nb.description || nb.name}
            onClick={() => go('Agenda', nb)}
          >
            <span className="cz-pill-mark" aria-hidden="true">
              <NotebookTabs size={14} />
            </span>
            <span className="cz-pill-body">
              <strong>{nb.name}</strong>
              <small>
                {nb.items.length} {nb.items.length === 1 ? 'elemento' : 'elementos'} ·{' '}
                {friendlyDate(todayInputValue(new Date(nb.updated_at)), today).toLowerCase()}
              </small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
