import { useLayoutEffect, useRef } from 'react';
import { ArrowRight, Undo2, X } from 'lucide-react';
import type { ToastAction } from '../hooks/useToast';

/* El aviso vive en la capa superior del navegador (popover), así queda por
   encima de cualquier z-index y también de los <dialog> modales. */
function raise(el: HTMLElement) {
  if (typeof el.showPopover !== 'function') return;
  if (el.matches(':popover-open')) el.hidePopover();
  el.showPopover();
}

export function Toast({
  message,
  action,
  onClose,
}: {
  message: string;
  action?: ToastAction;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

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
  }, [message]);

  if (!message) return null;
  return (
    <div ref={ref} className="toast" role="status" popover="manual">
      {message}
      {action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            onClose();
            action.run();
          }}
        >
          {action.icon === 'open' ? <ArrowRight size={14} /> : <Undo2 size={14} />} {action.label}
        </button>
      )}
      <button onClick={onClose} aria-label="Cerrar">
        <X size={15} />
      </button>
    </div>
  );
}
