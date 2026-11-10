import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './backend';

const FALLBACK =
  'No se pudo consultar la IA. Comprueba que la función assistant esté desplegada y que GROQ_API_KEY esté configurada.';

/** Una fuente que la respuesta cita como [r3]: se puede abrir desde el chat. */
export type AssistantSource = {
  ref: string;
  type: 'entry' | 'person' | 'place' | 'episode' | 'reading' | 'note';
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

/** Un mensaje anterior de la conversación con Nexo. */
export type ChatTurn = { role: 'user' | 'assistant'; text: string };

/** Lo justo de la conversación para entender la pregunta: los últimos turnos, recortados. */
const HISTORY_TURNS = 6;
const HISTORY_CHARS = 600;

/** Hoy en la zona horaria del usuario (AAAA-MM-DD). */
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
/** La conversación recortada (sin las citas [r3], que no significan nada en la consulta nueva). */
const trimHistory = (history: ChatTurn[]) =>
  history.slice(-HISTORY_TURNS).map((t) => ({
    role: t.role,
    text: (t.role === 'assistant'
      ? t.text.replace(/\s*\[[a-z]\d+(?:\s*,\s*[a-z]\d+)*\]/g, '')
      : t.text
    ).slice(0, HISTORY_CHARS),
  }));

/**
 * Consulta la función `assistant`. `history` es la conversación hasta ahora (para entender
 * «¿y ella?»). Si el servidor responde con un error, lanza su mensaje real.
 */
export async function askAssistant(
  question: string,
  history: ChatTurn[] = [],
): Promise<AssistantAnswer> {
  // «Hoy» del usuario (su zona horaria) para entender «este mes», «ayer»…
  const data = await call({
    question,
    today: localToday(),
    history: trimHistory(history),
  });
  return {
    answer: typeof data?.answer === 'string' ? data.answer : 'No hay respuesta disponible.',
    sources: Array.isArray(data?.sources) ? (data.sources as AssistantSource[]) : [],
    coverage: (data?.coverage as AssistantCoverage | undefined) ?? null,
  };
}

/**
 * Pregunta sobre un cuaderno de Agenda: la IA solo ve lo que hay en él (`notebook` ya viene
 * resumido, con una referencia `c3` por elemento para citarlo).
 */
export async function askNotebook(
  notebook: Record<string, unknown>,
  question: string,
  history: ChatTurn[] = [],
): Promise<string> {
  const data = await callMode({
    mode: 'agenda-notebook',
    notebook,
    question,
    today: localToday(),
    history: trimHistory(history),
  });
  // Una función anterior no conoce el modo y respondería con toda tu memoria: se avisa.
  if (data?.mode !== 'agenda-notebook') throw new Error(OUTDATED);
  if (typeof data?.answer !== 'string' || !data.answer.trim())
    throw new Error('La IA no devolvió una respuesta. Inténtalo de nuevo.');
  return data.answer.trim();
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

const OUTDATED =
  'Esta función necesita la versión nueva de la IA. Despliega la función assistant: npx supabase functions deploy assistant --remote=imdvmlzdbmbvwkfoisgs --use-api --yes';

/** Llama a un modo nuevo: si la función desplegada es anterior, lo dice claro. */
async function callMode(body: Record<string, unknown>) {
  try {
    return await call(body);
  } catch (e) {
    // Una función vieja no conoce el modo y lo trata como pregunta vacía.
    if (e instanceof Error && /pregunta debe tener/i.test(e.message)) throw new Error(OUTDATED);
    throw e;
  }
}

/**
 * Lectura de quién eres hoy a partir de todo lo que hay de ti en Nexo (tu ficha, tu gente, tus
 * recuerdos, lecturas y episodios). `digest` es un resumen ya preparado.
 */
export async function selfReading(
  digest: Record<string, unknown>,
): Promise<{ reading: string; highlights: string[] }> {
  const data = await callMode({ mode: 'self-reading', digest });
  if (typeof data?.reading !== 'string' || !data.reading.trim())
    throw new Error('La IA no devolvió una lectura. Inténtalo de nuevo.');
  return {
    reading: data.reading.trim(),
    highlights: Array.isArray(data.highlights)
      ? data.highlights.filter((h): h is string => typeof h === 'string').slice(0, 6)
      : [],
  };
}

export type GiftKind = 'objeto' | 'experiencia' | 'hecho a mano' | 'gesto';
export type GiftPrice = 'gratis' | 'bajo' | 'medio' | 'alto';
/** `what`: qué es exactamente y dónde conseguirlo. `why`: por qué le va a encantar. */
export type GiftIdea = {
  title: string;
  what: string;
  why: string;
  kind: GiftKind;
  price: GiftPrice;
};

/** Ideas de regalo para una persona, a partir de todo lo que sabes de ella y de su historia contigo. */
export async function giftIdeas(
  person: Record<string, unknown>,
  avoid: string[] = [],
  /** Para qué es el regalo («su cumpleaños», «Navidad», «agradecerle algo»…). */
  occasion = 'su cumpleaños',
): Promise<GiftIdea[]> {
  const data = await callMode({ mode: 'gift-ideas', person, avoid, occasion });
  const ideas = (Array.isArray(data?.ideas) ? (data.ideas as Partial<GiftIdea>[]) : [])
    .filter((i) => typeof i?.title === 'string' && i.title.trim())
    .map((i) => ({
      title: i.title!.trim(),
      what: typeof i.what === 'string' ? i.what.trim() : '',
      why: typeof i.why === 'string' ? i.why.trim() : '',
      kind: i.kind ?? 'objeto',
      price: i.price ?? 'bajo',
    }));
  if (!ideas.length) throw new Error('La IA no devolvió ideas. Inténtalo de nuevo.');
  return ideas;
}

export type SparkIdea = { idea: string; step: string; why: string };

/**
 * Pregunta o pide algo a la IA sobre un fragmento de la entrada del diario que escribes.
 * `rewrite` es true cuando la respuesta es el fragmento transformado (para reemplazarlo).
 */
export async function askEntry(input: {
  selection: string;
  prompt: string;
  text: string;
  title?: string;
}): Promise<{ answer: string; rewrite: boolean }> {
  const data = await callMode({
    mode: 'entry-ask',
    selection: input.selection.slice(0, 4000),
    prompt: input.prompt.slice(0, 1500),
    text: input.text.slice(0, 40000),
    title: input.title?.slice(0, 200),
  });
  const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
  if (!answer) throw new Error(OUTDATED);
  return { answer, rewrite: data?.rewrite === true };
}

/**
 * Una idea concreta para sacarle partido a algo que guardaste (una cita, un resaltado) a partir de
 * lo que conecta con ello (un proyecto, una persona…). `avoid` son las ideas que ya viste.
 */
export async function reviewSpark(input: {
  idea: Record<string, unknown>;
  link: Record<string, unknown> | null;
  me: Record<string, unknown>;
  avoid: string[];
}): Promise<SparkIdea> {
  const data = await callMode({ mode: 'review-spark', ...input });
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const idea = text(data?.idea);
  if (!idea) throw new Error('La IA no devolvió una idea. Inténtalo de nuevo.');
  return { idea, step: text(data?.step), why: text(data?.why) };
}

/** Una pregunta de opción múltiple del test de cierre. `answer` es el índice de la correcta. */
export type QuizQuestion = {
  q: string;
  options: string[];
  answer: number;
  why: string;
};

/**
 * Test de cierre de un libro, una película o una serie: cinco preguntas de opción múltiple sobre
 * sus ideas, personajes y temas (no sobre detalles triviales). `known` es false cuando la IA no
 * conoce bien la obra y se apoyó solo en la sinopsis.
 */
export async function closingQuiz(work: {
  tipo: 'libro' | 'película' | 'serie';
  titulo: string;
  autor?: string;
  año?: string;
  generos?: string[];
  sinopsis?: string;
}): Promise<{ questions: QuizQuestion[]; known: boolean }> {
  const data = await callMode({ mode: 'closing-quiz', work });
  const list = Array.isArray(data?.questions) ? (data.questions as Partial<QuizQuestion>[]) : [];
  const questions = list
    .filter(
      (x) =>
        typeof x?.q === 'string' &&
        x.q.trim() &&
        Array.isArray(x.options) &&
        x.options.length >= 2 &&
        x.options.every((o) => typeof o === 'string' && o.trim()) &&
        Number.isInteger(x.answer) &&
        x.answer! >= 0 &&
        x.answer! < x.options.length,
    )
    .slice(0, 5)
    .map((x) => ({
      q: x.q!.trim(),
      options: x.options!.map((o) => o.trim()),
      answer: x.answer!,
      why: typeof x.why === 'string' ? x.why.trim() : '',
    }));
  if (questions.length < 3)
    throw new Error('La IA no devolvió un test válido. Inténtalo de nuevo.');
  return { questions, known: data?.known !== false };
}
