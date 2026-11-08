import { useCallback, useState } from 'react';
import { askAssistant, type AssistantAnswer } from '../assistant';
import { errorMessage } from '../lib/format';

export function useAssistant() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AssistantAnswer | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await askAssistant(question));
    } catch (e) {
      setResult({ answer: errorMessage(e), sources: [], coverage: null });
    } finally {
      setBusy(false);
    }
  }, [question]);

  return { question, setQuestion, result, busy, ask };
}

export type Assistant = ReturnType<typeof useAssistant>;
