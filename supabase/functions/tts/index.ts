import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/*
 * Voces neuronales para «Escuchar» en Lecturas. Convierte un tramo del artículo (unas frases) en
 * un MP3. Con audio de verdad, el celular lo sigue reproduciendo con la pantalla apagada y lo
 * controla desde la pantalla bloqueada y los auriculares (la voz del sistema no lo permite).
 *
 * Proveedor según el secreto que configures en Supabase (puede haber varios):
 *   GEMINI_API_KEY                           Gemini (Google AI Studio): gratis y sin tarjeta, con
 *                                            pocas peticiones al día. GEMINI_TTS_MODEL cambia el modelo.
 *   AZURE_SPEECH_KEY + AZURE_SPEECH_REGION   Azure Speech (nivel F0: 500.000 caracteres gratis al mes)
 *   GOOGLE_TTS_API_KEY                       Google Cloud Text-to-Speech (con facturación activada)
 *   OPENAI_API_KEY                           OpenAI (de pago)
 *
 * POST { action: 'voices' }                  → { voices: Voice[] }
 * POST { voice: 'azure:es-CO-SalomeNeural', sentences: string[] }
 *                                            → { audio: base64, type: 'audio/mpeg' | 'audio/wav', marks: number[] | null }
 * `marks`: segundo en que empieza cada frase (solo Google Cloud lo da; si falta, Nexo lo estima).
 */

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

type Provider = 'azure' | 'google' | 'gemini' | 'openai';
type Voice = {
  id: string;
  provider: Provider;
  name: string;
  /** es, en o any (las de Gemini y OpenAI leen cualquier idioma). */
  lang: 'es' | 'en' | 'any';
  region: string;
};

/**
 * Hasta este largo por petición. Gemini cuenta peticiones por día (no caracteres): ahí los
 * tramos son largos, para que un artículo entero gaste pocas.
 */
const MAX_CHARS: Record<Provider, number> = { azure: 2400, google: 2400, openai: 2400, gemini: 4200 };
const MAX_SENTENCES = 120;

const REGIONS: Record<string, string> = {
  'es-CO': 'Colombia',
  'es-MX': 'México',
  'es-US': 'Latinoamérica',
  'es-AR': 'Argentina',
  'es-ES': 'España',
  'en-US': 'EE. UU.',
  'en-GB': 'Reino Unido',
};
const LOCALES = Object.keys(REGIONS);
/** Las que mejor suenan van primero (si existen en tu región de Azure o en Google). */
const PREFERRED = [
  'es-CO-SalomeNeural',
  'es-CO-GonzaloNeural',
  'es-MX-DaliaNeural',
  'es-MX-JorgeNeural',
  'es-ES-ElviraNeural',
  'es-ES-AlvaroNeural',
  'en-US-JennyNeural',
  'en-US-AndrewNeural',
  'en-GB-SoniaNeural',
];
const PER_LOCALE = 3;

const azure = () => {
  const key = Deno.env.get('AZURE_SPEECH_KEY');
  const region = Deno.env.get('AZURE_SPEECH_REGION')?.trim().toLowerCase();
  return key && region && /^[a-z0-9]+$/.test(region) ? { key, region } : null;
};
const googleKey = () => Deno.env.get('GOOGLE_TTS_API_KEY') || null;
const geminiKey = () => Deno.env.get('GEMINI_API_KEY') || null;
const openaiKey = () => Deno.env.get('OPENAI_API_KEY') || null;
const geminiModel = () => Deno.env.get('GEMINI_TTS_MODEL')?.trim() || 'gemini-3.8-flash-tts';

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

function toBase64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
function fromBase64(text: string) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
/** Audio crudo (PCM de 16 bits, mono) dentro de un WAV que el navegador sabe reproducir. */
function wav(pcm: Uint8Array, rate: number) {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

const rank = (name: string) => {
  const i = PREFERRED.indexOf(name);
  return i === -1 ? 99 : i;
};

// ─────────────── Lista de voces (se guarda una hora) ───────────────

let cached: { at: number; voices: Voice[] } | null = null;

async function azureVoices(): Promise<Voice[]> {
  const az = azure();
  if (!az) return [];
  const res = await fetch(`https://${az.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { 'Ocp-Apim-Subscription-Key': az.key },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const all = (await res.json()) as {
    ShortName: string;
    LocalName?: string;
    DisplayName?: string;
    Locale: string;
    VoiceType?: string;
  }[];
  const out: Voice[] = [];
  for (const locale of LOCALES) {
    const list = all
      .filter(
        (v) =>
          v.Locale === locale &&
          v.VoiceType === 'Neural' &&
          !/Multilingual|Dragon|HD|Turbo/i.test(v.ShortName),
      )
      .sort((a, b) => rank(a.ShortName) - rank(b.ShortName) || a.ShortName.localeCompare(b.ShortName))
      .slice(0, PER_LOCALE);
    for (const v of list)
      out.push({
        id: `azure:${v.ShortName}`,
        provider: 'azure',
        name: v.LocalName || v.DisplayName || v.ShortName,
        lang: locale.startsWith('es') ? 'es' : 'en',
        region: REGIONS[locale],
      });
  }
  return out;
}

async function googleVoices(): Promise<Voice[]> {
  const key = googleKey();
  if (!key) return [];
  const res = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(key)}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const { voices = [] } = (await res.json()) as {
    voices?: { name: string; languageCodes: string[]; ssmlGender?: string }[];
  };
  const out: Voice[] = [];
  for (const locale of LOCALES) {
    // Neural2 marca el tiempo de cada frase; si no hay en ese idioma, WaveNet.
    const of = (kind: string) =>
      voices.filter((v) => v.languageCodes.includes(locale) && v.name.includes(`-${kind}-`));
    const list = (of('Neural2').length ? of('Neural2') : of('Wavenet'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, PER_LOCALE);
    for (const v of list) {
      const letter = v.name.split('-').pop();
      const who = v.ssmlGender === 'FEMALE' ? 'Voz femenina' : v.ssmlGender === 'MALE' ? 'Voz masculina' : 'Voz';
      out.push({
        id: `google:${v.name}`,
        provider: 'google',
        name: `${who} ${letter}`,
        lang: locale.startsWith('es') ? 'es' : 'en',
        region: REGIONS[locale],
      });
    }
  }
  return out;
}

const OPENAI_VOICES = ['coral', 'nova', 'sage', 'ash', 'onyx', 'shimmer'];
const openaiVoices = (): Voice[] =>
  openaiKey()
    ? OPENAI_VOICES.map((v) => ({
        id: `openai:${v}`,
        provider: 'openai' as const,
        name: v[0].toUpperCase() + v.slice(1),
        lang: 'any' as const,
        region: 'OpenAI',
      }))
    : [];

/** Voces de Gemini (hablan cualquier idioma; el acento lo toman del texto). */
const GEMINI_VOICES: [string, string][] = [
  ['Kore', 'Kore, femenina'],
  ['Sulafat', 'Sulafat, femenina cálida'],
  ['Aoede', 'Aoede, femenina'],
  ['Charon', 'Charon, masculina'],
  ['Achird', 'Achird, masculina cercana'],
  ['Orus', 'Orus, masculina firme'],
];
const geminiVoices = (): Voice[] =>
  geminiKey()
    ? GEMINI_VOICES.map(([id, name]) => ({
        id: `gemini:${id}`,
        provider: 'gemini' as const,
        name,
        lang: 'any' as const,
        region: 'Gemini',
      }))
    : [];

async function listVoices() {
  if (cached && Date.now() - cached.at < 3600_000) return cached.voices;
  const [a, g] = await Promise.all([azureVoices().catch(() => []), googleVoices().catch(() => [])]);
  const voices = [...a, ...g, ...geminiVoices(), ...openaiVoices()];
  cached = { at: Date.now(), voices };
  return voices;
}

// ─────────────── Sintetizar ───────────────

class Upstream extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}
const busy = (status: number) =>
  status === 429
    ? 'Se acabó la cuota gratis de la voz neuronal por ahora (o el servicio la está limitando).'
    : status === 401 || status === 403
      ? 'El servicio de voz rechazó la clave: revísala (y que su API esté activada).'
      : `El servicio de voz respondió con un error (${status}).`;

/** «es-CO-SalomeNeural» → «es-CO». */
const localeOf = (name: string) => name.split('-').slice(0, 2).join('-');

async function synthAzure(name: string, sentences: string[]) {
  const az = azure();
  if (!az) throw new Upstream('Falta configurar AZURE_SPEECH_KEY y AZURE_SPEECH_REGION en Supabase.', 503);
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${localeOf(name)}">` +
    `<voice name="${escapeXml(name)}">${escapeXml(sentences.join(' '))}</voice></speak>`;
  const res = await fetch(`https://${az.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': az.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'nexo-lecturas',
    },
    body: ssml,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Upstream(busy(res.status));
  return { audio: new Uint8Array(await res.arrayBuffer()), marks: null };
}

async function synthGoogle(name: string, sentences: string[]) {
  const key = googleKey();
  if (!key) throw new Upstream('Falta configurar GOOGLE_TTS_API_KEY en Supabase.', 503);
  // Una marca antes de cada frase: Google dice en qué segundo empieza cada una.
  const ssml = `<speak>${sentences.map((s, i) => `<mark name="s${i}"/>${escapeXml(s)}`).join(' ')}</speak>`;
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { ssml },
        voice: { languageCode: localeOf(name), name },
        audioConfig: { audioEncoding: 'MP3' },
        enableTimePointing: ['SSML_MARK'],
      }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) throw new Upstream(busy(res.status));
  const data = (await res.json()) as {
    audioContent: string;
    timepoints?: { markName: string; timeSeconds: number }[];
  };
  const marks: number[] = sentences.map(() => NaN);
  for (const t of data.timepoints ?? []) {
    const i = Number(t.markName.slice(1));
    if (Number.isInteger(i) && i >= 0 && i < marks.length) marks[i] = t.timeSeconds;
  }
  return {
    audio: data.audioContent,
    marks: marks.every(Number.isFinite) ? marks : null,
  };
}

async function synthGemini(name: string, sentences: string[]) {
  const key = geminiKey();
  if (!key) throw new Upstream('Falta configurar GEMINI_API_KEY en Supabase.', 503);
  const call = () =>
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: sentences.join(' ') }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: name } } },
          },
        }),
        signal: AbortSignal.timeout(110000),
      },
    );
  let res = await call();
  if (res.status === 429) {
    const body = await res.text();
    // El límite del día no se espera; el de cada minuto, sí (una vez, si es poco).
    if (/PerDay/i.test(body))
      throw new Upstream('Se acabó la cuota gratis de Gemini por hoy: mañana vuelve a funcionar.', 429);
    const wait = Number(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1] ?? 0);
    if (!(wait > 0 && wait <= 25)) throw new Upstream(busy(429), 429);
    await new Promise((done) => setTimeout(done, wait * 1000));
    res = await call();
  }
  if (!res.ok) throw new Upstream(busy(res.status), res.status === 429 ? 429 : 502);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  };
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const inline = part?.inlineData;
  if (!inline?.data) throw new Upstream('Gemini no devolvió audio.');
  const mime = inline.mimeType ?? '';
  // Los modelos nuevos ya devuelven un WAV; los anteriores, el audio crudo (se le pone cabecera).
  if (/wav/i.test(mime)) return { audio: inline.data, type: 'audio/wav', marks: null };
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  return { audio: wav(fromBase64(inline.data), rate), type: 'audio/wav', marks: null };
}

async function synthOpenAI(name: string, sentences: string[]) {
  const key = openaiKey();
  if (!key) throw new Upstream('Falta configurar OPENAI_API_KEY en Supabase.', 503);
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: name,
      input: sentences.join(' '),
      response_format: 'mp3',
      instructions: 'Lee en voz alta un artículo, con tono natural y pausado, en el idioma del texto.',
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Upstream(busy(res.status));
  return { audio: new Uint8Array(await res.arrayBuffer()), marks: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Inicia sesión.' }, 401);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) return json({ error: 'Inicia sesión.' }, 401);

    const body = await req.json().catch(() => ({}));
    if (body?.action === 'voices') {
      const configured = Boolean(azure() || googleKey() || geminiKey() || openaiKey());
      return json({ configured, voices: configured ? await listVoices() : [] });
    }

    const voice = typeof body?.voice === 'string' ? body.voice : '';
    const sentences: string[] = Array.isArray(body?.sentences)
      ? body.sentences
          .filter((s: unknown): s is string => typeof s === 'string')
          .map((s: string) => s.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
      : [];
    const [provider, name = ''] = voice.split(':');
    if (!(provider in MAX_CHARS)) return json({ error: 'Voz no válida.' }, 400);
    const chars = sentences.reduce((n, s) => n + s.length, 0);
    if (
      !sentences.length ||
      sentences.length > MAX_SENTENCES ||
      chars > MAX_CHARS[provider as Provider]
    )
      return json({ error: 'Tramo de texto no válido.' }, 400);
    const okName =
      provider === 'openai'
        ? OPENAI_VOICES.includes(name)
        : provider === 'gemini'
          ? GEMINI_VOICES.some(([id]) => id === name)
          : /^[a-z]{2,3}-[A-Z0-9]{2,3}-[A-Za-z0-9-]{1,60}$/.test(name);
    if (!okName) return json({ error: 'Voz no válida.' }, 400);

    const out: { audio: string | Uint8Array; type?: string; marks: number[] | null } =
      provider === 'azure'
        ? await synthAzure(name, sentences)
        : provider === 'google'
          ? await synthGoogle(name, sentences)
          : provider === 'gemini'
            ? await synthGemini(name, sentences)
            : await synthOpenAI(name, sentences);
    return json({
      audio: typeof out.audio === 'string' ? out.audio : toBase64(out.audio),
      type: out.type ?? 'audio/mpeg',
      marks: out.marks,
    });
  } catch (e) {
    if (e instanceof Upstream) return json({ error: e.message }, e.status);
    const timeout = e instanceof DOMException && e.name === 'TimeoutError';
    return json(
      { error: timeout ? 'El servicio de voz tardó demasiado.' : 'No se pudo generar el audio.' },
      timeout ? 504 : 500,
    );
  }
});
