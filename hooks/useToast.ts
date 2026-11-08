import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastAction = { label: string; run: () => void; icon?: 'undo' | 'open' };
export type Notify = (text: string, action?: ToastAction) => void;

/** Mensaje temporal. Un aviso nuevo reemplaza al anterior y reinicia el temporizador. */
export function useToast() {
  const [message, setMessage] = useState('');
  const [action, setAction] = useState<ToastAction | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    setMessage('');
    setAction(undefined);
  }, []);

  const notify = useCallback<Notify>(
    (text, next) => {
      window.clearTimeout(timer.current);
      setMessage(text);
      setAction(next);
      // Con «Deshacer» el aviso dura un poco más.
      timer.current = window.setTimeout(clear, next ? 8000 : 5500);
    },
    [clear],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { message, action, notify, clear };
}
