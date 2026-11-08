import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleHelp, Trash2, TriangleAlert } from 'lucide-react';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva: el botón se pinta de rojo y el foco empieza en «cancelar». */
  danger?: boolean;
  icon?: 'trash' | 'warning' | 'question';
};
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const icons = { trash: Trash2, warning: TriangleAlert, question: CircleHelp };

function ConfirmDialog({
  options,
  onResult,
}: {
  options: ConfirmOptions;
  onResult: (accepted: boolean) => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const accept = useRef<HTMLButtonElement>(null);
  const result = useRef(onResult);
  result.current = onResult;
  const Icon = icons[options.icon ?? 'question'];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (options.danger ? cancel : accept).current?.focus();
    // En fase de captura: así Esc, Tab y Enter no llegan a la ventana que hay debajo.
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        result.current(false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === cancel.current ? accept : cancel).current?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, [options.danger]);

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResult(false);
      }}
    >
      <div
        className={'confirm' + (options.danger ? ' danger' : '')}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={options.message ? 'confirm-message' : undefined}
      >
        <span className="confirm-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <div className="confirm-text">
          <h3 id="confirm-title">{options.title}</h3>
          {options.message && <p id="confirm-message">{options.message}</p>}
        </div>
        <div className="confirm-actions">
          <button
            ref={cancel}
            type="button"
            className="cp-btn ghost"
            onClick={() => onResult(false)}
          >
            {options.cancelLabel ?? 'Cancelar'}
          </button>
          <button ref={accept} type="button" className="cp-btn cta" onClick={() => onResult(true)}>
            {options.confirmLabel ?? 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Reemplaza a `confirm()` del navegador: `await confirm({...})` devuelve true o false. */
export function useConfirm() {
  const [request, setRequest] = useState<{
    options: ConfirmOptions;
    resolve: (accepted: boolean) => void;
  } | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        // Si ya había una pregunta abierta, se da por cancelada.
        setRequest((current) => {
          current?.resolve(false);
          return { options, resolve };
        });
      }),
    [],
  );

  const dialog = request ? (
    <ConfirmDialog
      options={request.options}
      onResult={(accepted) => {
        request.resolve(accepted);
        setRequest(null);
      }}
    />
  ) : null;

  return { confirm, dialog };
}
