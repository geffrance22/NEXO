import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function ReaderDialog({
  title,
  close,
  children,
  busy = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('[data-initial-focus]')?.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="reader-dialog"
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
          <button aria-label="Cerrar" disabled={busy} onClick={close}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
