import { ArrowRight, Undo2, X } from 'lucide-react';
import type { ToastAction } from '../hooks/useToast';

export function Toast({
  message,
  action,
  onClose,
}: {
  message: string;
  action?: ToastAction;
  onClose: () => void;
}) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
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
