import { useLayoutEffect, useRef } from 'react';
import { ArrowRight, Undo2, X } from 'lucide-react';
import type { ToastItem } from '../hooks/useToast';

/* La pila de avisos vive en la capa superior del navegador (popover), así queda
   por encima de cualquier z-index y también de los <dialog> modales. */
function raise(el: HTMLElement) {
  if (typeof el.showPopover !== 'function') return;
  if (el.matches(':popover-open')) el.hidePopover();
  el.showPopover();
}

/** Pila de avisos: el más nuevo abajo; los anteriores se desplazan hacia arriba. */
export function Toasts({ items, onClose }: { items: ToastItem[]; onClose: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const newest = items.length ? items[items.length - 1].id : 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    raise(el);
    // Si se abre un <dialog> modal después del aviso, volvemos a subirlo.
    const watcher = new MutationObserver((changes) => {
      if (changes.some((c) => c.target instanceof HTMLDialogElement && c.target.open)) raise(el);
    });
    watcher.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => watcher.disconnect();
  }, [newest, items.length > 0]);

  if (!items.length) return null;
  return (
    <div ref={ref} className="toast-stack" popover="manual">
      {items.map((t) => (
        <div key={t.id} className={`toast-slot${t.leaving ? ' leaving' : ''}`}>
          <div className="toast" role="status">
            {t.message}
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  onClose(t.id);
                  t.action!.run();
                }}
              >
                {t.action.icon === 'open' ? <ArrowRight size={14} /> : <Undo2 size={14} />}{' '}
                {t.action.label}
              </button>
            )}
            <button onClick={() => onClose(t.id)} aria-label="Cerrar">
              <X size={15} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
