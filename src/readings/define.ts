import { supabase } from '../backend';
import { fetchEtymology, type Etymology } from './etymology';

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
  /**
   * La etimología de Wiktionary con la que se escribió la raíz (null: Wiktionary no la tiene, así
   * que la raíz es solo de la IA). Falta en las definiciones de antes de usar Wiktionary.
   */
  source?: Etymology | null;
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
    ...(d.source !== undefined && { source: asEtymology(d.source) }),
  };
}

/** Una etimología guardada en forma segura; null si no sirve. */
function asEtymology(v: unknown): Etymology | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  const body = text(e.text);
  const url = text(e.url);
  if (!body || !/^https:\/\/(es|en)\.wiktionary\.org\//.test(url)) return null;
  return { text: body, url, lang: e.lang === 'en' ? 'en' : 'es', language: text(e.language) };
}

/**
 * Pide a la IA la ficha de un término. El contexto (la frase donde apareció) solo sirve para
 * elegir el sentido correcto; no se guarda. Antes se busca su etimología en Wiktionary: si la
 * tiene, la IA escribe la raíz y la historia a partir de ella (no de memoria) y la ficha guarda
 * la fuente.
 */
export async function defineWord(term: string, context = ''): Promise<Definition> {
  const source = await fetchEtymology(term).catch(() => null);
  const { data, error } = await supabase.functions.invoke('assistant', {
    body: {
      mode: 'word-define',
      term: term.slice(0, 200),
      context: context.slice(0, 1200),
      ...(source && { etymology: source.text.slice(0, 1500) }),
    },
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
  return { ...definition, source };
}
