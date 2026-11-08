import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function ReaderDialog({
  title,
  close,
  children,
  busy = false,
  className = '',
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={'reader-dialog' + (className ? ' ' + className : '')}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) close();
      }}
    >
      <div>
        <header>
          <h3>{title}</h3>
          <button
            type="button"
            className="rd-dlg-x"
            aria-label="Cerrar"
            disabled={busy}
            onClick={close}
          >
            <X size={16} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
