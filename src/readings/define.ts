import { supabase } from '../backend';

/** Ficha de una palabra del diccionario, generada con IA (columna `definition`, migración 202611090005). */
export type Definition = {
  /** Categoría gramatical: «sustantivo femenino», «expresión», «oración»… */
  kind: string;
  meaning: string;
  /** Raíz o etimología. */
  root: string;
  history: string;
  /** Truco para no olvidarla. */
  hook: string;
  example: string;
  synonyms: string[];
  antonyms: string[];
  /** Palabras de la misma familia o raíz. */
  family: string[];
  /** Con qué se suele confundir y en qué se diferencia. */
  confusions: string;
  /** Mini ejercicio para fijarla. */
  practice: { q: string; a: string };
};

export const DEFINITIONS_SQL = 'supabase/migrations/202611090005_word_definitions.sql';

const OUTDATED =
  'Actualiza la función assistant para definir palabras: npx supabase functions deploy assistant --remote=imdvmlzdbmbvwkfoisgs --use-api --yes';

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const texts = (v: unknown) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

/** Una definición guardada (o recibida) en forma segura; null si no sirve. */
export function asDefinition(v: unknown): Definition | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const d = v as Record<string, unknown>;
  const meaning = text(d.meaning);
  if (!meaning) return null;
  const p = (d.practice ?? {}) as Record<string, unknown>;
  return {
    kind: text(d.kind),
    meaning,
    root: text(d.root),
    history: text(d.history),
    hook: text(d.hook),
    example: text(d.example),
    synonyms: texts(d.synonyms),
    antonyms: texts(d.antonyms),
    family: texts(d.family),
    confusions: text(d.confusions),
    practice: { q: text(p.q), a: text(p.a) },
  };
}

/**
 * Pide a la IA la ficha de un término. El contexto (la frase donde apareció) solo sirve para
 * elegir el sentido correcto; no se guarda.
 */
export async function defineWord(term: string, context = ''): Promise<Definition> {
  const { data, error } = await supabase.functions.invoke('assistant', {
    body: { mode: 'word-define', term: term.slice(0, 200), context: context.slice(0, 1200) },
  });
  if (error) {
    const res = (error as { context?: Response }).context;
    const detail = (await res?.json?.().catch(() => null)) as { error?: string } | null;
    // Una versión anterior de la función no conoce este modo y pide «el texto».
    if (res?.status === 400 && detail?.error !== 'Consulta inválida.') throw Error(OUTDATED);
    throw Error(detail?.error || 'No se pudo consultar la IA.');
  }
  const definition = asDefinition(data?.definition);
  if (!definition) throw Error(OUTDATED);
  return definition;
}
