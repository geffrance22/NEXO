import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleHelp, Trash2, TriangleAlert } from 'lucide-react';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tercera opción (p. ej. «Descartar»): si se elige, la promesa devuelve "alt". */
  altLabel?: string;
  /** Acción destructiva: el botón se pinta de rojo y el foco empieza en «cancelar». */
  danger?: boolean;
  icon?: 'trash' | 'warning' | 'question';
};
type ConfirmResult = boolean | 'alt';
export type ConfirmFn = {
  (options: ConfirmOptions & { altLabel: string }): Promise<ConfirmResult>;
  (options: ConfirmOptions): Promise<boolean>;
};

const icons = { trash: Trash2, warning: TriangleAlert, question: CircleHelp };

function ConfirmDialog({
  options,
  onResult,
}: {
  options: ConfirmOptions;
  onResult: (result: ConfirmResult) => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const alt = useRef<HTMLButtonElement>(null);
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
        const buttons = [cancel, alt, accept]
          .map((r) => r.current)
          .filter((b): b is HTMLButtonElement => Boolean(b));
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.shiftKey ? -1 : 1;
        buttons[(at + step + buttons.length) % buttons.length]?.focus();
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
        className={
          'confirm' + (options.danger ? ' danger' : '') + (options.altLabel ? ' has-alt' : '')
        }
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
          {options.altLabel && (
            <button
              ref={alt}
              type="button"
              className="cp-btn ghost confirm-alt"
              onClick={() => onResult('alt')}
            >
              {options.altLabel}
            </button>
          )}
          <button ref={accept} type="button" className="cp-btn cta" onClick={() => onResult(true)}>
            {options.confirmLabel ?? 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Reemplaza a `confirm()` del navegador: `await confirm({...})` devuelve true o false
 * (o "alt" si se pidió una tercera opción con `altLabel` y se eligió).
 */
export function useConfirm() {
  const [request, setRequest] = useState<{
    options: ConfirmOptions;
    resolve: (result: ConfirmResult) => void;
  } | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<ConfirmResult>((resolve) => {
        // Si ya había una pregunta abierta, se da por cancelada.
        setRequest((current) => {
          current?.resolve(false);
          return { options, resolve };
        });
      }),
    [],
  ) as ConfirmFn;

  const dialog = request ? (
    <ConfirmDialog
      options={request.options}
      onResult={(result) => {
        request.resolve(result);
        setRequest(null);
      }}
    />
  ) : null;

  return { confirm, dialog };
}
