import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './backend';

const FALLBACK =
  'No se pudo consultar la IA. Comprueba que la función assistant esté desplegada y que GROQ_API_KEY esté configurada.';

/** Una fuente que la respuesta cita como [r3]: se puede abrir desde el chat. */
export type AssistantSource = {
  ref: string;
  type: 'entry' | 'person' | 'place' | 'episode';
  id: string;
  title: string;
  date?: string;
};

/** Qué consultó y qué quedó fuera (para saber cuánto confiar en la respuesta). */
export type AssistantCoverage = {
  filters: string[];
  consulted: number;
  matching: number;
  people: number;
  places: number;
  episodes: number;
  calculations: string[];
};

export type AssistantAnswer = {
  answer: string;
  sources: AssistantSource[];
  coverage: AssistantCoverage | null;
};

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('assistant', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = (await error.context.json().catch(() => null)) as { error?: unknown } | null;
      if (typeof res?.error === 'string') throw new Error(res.error);
      if (error.context.status === 404) {
        throw new Error('La función assistant no está desplegada en tu proyecto de Supabase.');
      }
    }
    throw new Error(FALLBACK);
  }
  return data as Record<string, unknown> | null;
}

/** Consulta la función `assistant`. Si el servidor responde con un error, lanza su mensaje real. */
export async function askAssistant(question: string): Promise<AssistantAnswer> {
  // «Hoy» del usuario (su zona horaria) para entender «este mes», «ayer»…
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const data = await call({ question, today });
  return {
    answer: typeof data?.answer === 'string' ? data.answer : 'No hay respuesta disponible.',
    sources: Array.isArray(data?.sources) ? (data.sources as AssistantSource[]) : [],
    coverage: (data?.coverage as AssistantCoverage | undefined) ?? null,
  };
}

/**
 * Pide a la IA que proponga las piezas de una experiencia (encuentro, gasto, novedades,
 * compromisos…). Devuelve el JSON tal cual; `planFromAi` lo valida antes de usarlo.
 */
export async function captureWithAssistant(
  text: string,
  context: {
    today: string;
    /** `kin`: lo que la persona es para ti («tu mamá»), para entender «mi mamá». */
    people: { id: string; name: string; alias?: string; kin?: string }[];
    places: { id: string; name: string }[];
  },
): Promise<unknown> {
  const data = await call({ mode: 'capture', text, ...context });
  if (!data?.plan) throw new Error('La IA no devolvió una propuesta válida.');
  return data.plan;
}
