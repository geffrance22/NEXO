import { useCallback, useEffect, useRef, useState } from 'react';
import {
  askAssistant,
  type AssistantAnswer,
  type AssistantCoverage,
  type AssistantSource,
  type ChatTurn,
} from '../assistant';
import { errorMessage } from '../lib/format';

/** Un mensaje del chat con Nexo. Las respuestas traen sus fuentes y qué se consultó. */
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: AssistantSource[];
  coverage?: AssistantCoverage | null;
  /** La consulta falló: el texto es el motivo. */
  error?: boolean;
};

const STORE = 'nexo-chat';
const MAX_MESSAGES = 40;

/** La conversación sobrevive a cerrar el panel y a recargar la pestaña (no a cerrarla). */
function restore(store: string): ChatMessage[] {
  try {
    const list = JSON.parse(sessionStorage.getItem(store) ?? '[]');
    return Array.isArray(list)
      ? list
          .filter(
            (m): m is ChatMessage =>
              m &&
              typeof m.id === 'string' &&
              (m.role === 'user' || m.role === 'assistant') &&
              typeof m.text === 'string',
          )
          .slice(-MAX_MESSAGES)
      : [];
  } catch {
    return [];
  }
}

type Ask = (question: string, history: ChatTurn[]) => Promise<AssistantAnswer>;

/**
 * Chat con Nexo: cada pregunta va con lo último de la conversación para no perder el hilo.
 * `store` y `ask` permiten otra conversación con su propio alcance (p. ej. un cuaderno).
 */
export function useAssistant(opts: { store?: string; ask?: Ask } = {}) {
  const store = opts.store ?? STORE;
  const askRef = useRef<Ask>(opts.ask ?? askAssistant);
  askRef.current = opts.ask ?? askAssistant;
  const [messages, setMessages] = useState<ChatMessage[]>(() => restore(store));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef(messages);
  live.current = messages;
  const busyRef = useRef(false);
  // Cada envío lleva un número: «Nueva conversación» descarta la respuesta que venía en camino.
  const seq = useRef(0);

  useEffect(() => {
    try {
      sessionStorage.setItem(store, JSON.stringify(messages.slice(-MAX_MESSAGES)));
    } catch {
      /* sin espacio: la conversación sigue en memoria */
    }
  }, [messages, store]);

  const send = useCallback(async (text?: string) => {
    const question = (text ?? '').trim();
    if (!question || busyRef.current) return;
    // Solo pares que salieron bien: un error no aporta contexto.
    const history: ChatTurn[] = live.current
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', text: question }]);
    setInput('');
    busyRef.current = true;
    setBusy(true);
    const n = ++seq.current;
    try {
      const a = await askRef.current(question, history);
      if (n !== seq.current) return;
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: a.answer,
          sources: a.sources,
          coverage: a.coverage,
        },
      ]);
    } catch (e) {
      if (n !== seq.current) return;
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', text: errorMessage(e), error: true },
      ]);
    } finally {
      if (n === seq.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, []);

  /** Vuelve a enviar la última pregunta (tras un error). */
  const retry = useCallback(() => {
    const list = live.current;
    const last = [...list].reverse().find((m) => m.role === 'user');
    if (!last || busyRef.current) return;
    // Se quita la pregunta y su error: send las vuelve a poner.
    setMessages(list.slice(0, list.lastIndexOf(last)));
    live.current = list.slice(0, list.lastIndexOf(last));
    void send(last.text);
  }, [send]);

  const reset = useCallback(() => {
    seq.current++;
    busyRef.current = false;
    setBusy(false);
    setMessages([]);
    setInput('');
  }, []);

  return { messages, input, setInput, busy, send, retry, reset };
}

export type Assistant = ReturnType<typeof useAssistant>;
