import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

const when = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
};

/**
 * Final del artículo: «Completado» con un chulito si ya lo leíste (al pasar el cursor, una X
 * para desmarcarlo) o «Marcar como leído» si no. Si bajas tú mismo hasta aquí en un artículo
 * largo, se marca solo.
 */
export function ReadEnd({
  readAt,
  onToggle,
}: {
  readAt?: string | null;
  onToggle: (done: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = Boolean(readAt);
  // Animar el chulito solo cuando se completa ahora (no al abrir uno ya leído).
  const [fresh, setFresh] = useState(false);
  const live = useRef({ done, onToggle });
  live.current = { done, onToggle };
  // Si lo desmarcas, no se vuelve a marcar solo mientras sigas en este artículo.
  const undone = useRef(false);

  useEffect(() => {
    const el = ref.current;
    const pane = el?.closest<HTMLElement>('.readings > main');
    if (!el || !pane) return;
    // Solo cuenta si lo desplazas tú (no al retomar la lectura donde ibas).
    let engaged = false;
    let frame = 0;
    const engage = () => {
      engaged = true;
    };
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!engaged || live.current.done || undone.current) return;
        // Artículos que caben en pantalla: lo marcas tú.
        if (pane.scrollHeight <= pane.clientHeight + 160) return;
        if (el.getBoundingClientRect().top < pane.getBoundingClientRect().bottom - 48) {
          setFresh(true);
          live.current.onToggle(true);
        }
      });
    };
    const intents = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;
    intents.forEach((e) => pane.addEventListener(e, engage, { passive: true }));
    pane.addEventListener('scroll', check, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      intents.forEach((e) => pane.removeEventListener(e, engage));
      pane.removeEventListener('scroll', check);
    };
  }, []);

  return (
    <div ref={ref} className={'rd-end' + (done ? ' done' : '') + (fresh && done ? ' fresh' : '')}>
      <button
        type="button"
        aria-pressed={done}
        title={done ? 'Marcar como no leído' : 'Marcar como leído'}
        onClick={() => {
          if (done) undone.current = true;
          setFresh(!done);
          onToggle(!done);
        }}
      >
        <span className="rd-end-icon" aria-hidden="true">
          <Check className="rd-end-check" size={30} strokeWidth={2.4} />
          {done && <X className="rd-end-x" size={26} strokeWidth={2.2} />}
        </span>
        <span className="rd-end-label">{done ? 'Completado' : 'Marcar como leído'}</span>
        {done && readAt && <small>{when(readAt)}</small>}
      </button>
    </div>
  );
}
