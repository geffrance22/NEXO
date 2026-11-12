import { ArrowUpRight, X } from 'lucide-react';
import './embed.css';

/**
 * Barra de una ficha abierta en una ventana (en lugar de en su sección): un acceso para ir a la
 * sección y el botón de cerrar.
 */
export function EmbedBar({
  label,
  onOpen,
  onClose,
}: {
  label: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <div className="nx-embed-bar">
      <button type="button" className="nx-embed-open" onClick={onOpen}>
        {label} <ArrowUpRight size={14} />
      </button>
      <button type="button" className="nx-embed-x" aria-label="Cerrar" title="Cerrar" onClick={onClose}>
        <X size={18} />
      </button>
    </div>
  );
}
