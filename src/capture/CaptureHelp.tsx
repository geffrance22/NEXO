import { useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Layers, Sparkles, X } from 'lucide-react';
import { bookMeta, pieceIcons, type PieceMeta } from './meta';

const kinds: [PieceMeta, string][] = [
  [pieceIcons.encuentro, 'Encuentros'],
  [pieceIcons.movimiento, 'Gastos e ingresos'],
  [pieceIcons.compromiso, 'Pendientes'],
  [pieceIcons.novedad, 'Novedades de tu gente'],
  [pieceIcons.obra, 'Películas y series'],
  [bookMeta, 'Libros'],
  [pieceIcons.idea, 'Ideas'],
  [pieceIcons.trabajo, 'Trabajo'],
  [pieceIcons.aprendizaje, 'Aprendizajes'],
  [pieceIcons.intercambio, 'Regalos y favores'],
  [pieceIcons.dato, 'Gustos y cumpleaños'],
  [pieceIcons.preguntar, 'Qué preguntar'],
  [pieceIcons.visita, 'Lugares'],
  [pieceIcons.enlace, 'Enlaces'],
];

/** Ventana translúcida con lo que hace Nexo con tus instantes. */
export function CaptureHelp({ onClose }: { onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  return createPortal(
    <div
      className="confirm-backdrop xp-help-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="xp-help" role="dialog" aria-modal="true" aria-label="Cómo funciona">
        <header>
          <h3>Cómo funciona</h3>
          <button
            ref={button}
            type="button"
            className="cp-close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <ol className="xp-help-steps">
          <li>
            <b>1</b>
            <span>Escribe un instante (o un hilo) como te salga. Se guarda tal cual.</span>
          </li>
          <li>
            <b>2</b>
            <span>
              En segundo plano, Nexo lo separa en piezas y las enlaza con tu gente y tus lugares.
            </span>
          </li>
          <li>
            <b>3</b>
            <span>
              Revisas, corriges y guardas: cada pieza queda vinculada a su instante. Nexo aprende
              de tus correcciones.
            </span>
          </li>
        </ol>

        <p className="xp-help-label">Lo que reconoce</p>
        <div className="xp-help-kinds">
          {kinds.map(([m, label]) => (
            <span key={label} style={{ '--c': m.color, '--s': m.soft } as CSSProperties}>
              <m.icon size={13} /> {label}
            </span>
          ))}
        </div>

        <ul className="xp-help-tips">
          <li>
            <Layers size={15} />
            <span>
              Varias experiencias en un instante: sepáralas con <code>---</code> o en párrafos con
              su fecha. Cada parte de un hilo se lee por separado.
            </span>
          </li>
          <li>
            <Sparkles size={15} />
            <span>La IA afina sola las primeras experiencias de cada publicación.</span>
          </li>
          <li>
            <kbd>Ctrl</kbd>
            <kbd>Enter</kbd>
            <span>Guarda sin tocar el ratón.</span>
          </li>
        </ul>
      </div>
    </div>,
    document.body,
  );
}
