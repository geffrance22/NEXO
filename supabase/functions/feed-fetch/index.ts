import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

/** Tope del documento descargado: un feed normal pesa mucho menos. */
const MAX_BYTES = 3_000_000;

/** ¿Es una dirección privada, local o reservada? (No se descarga nada de la red interna.) */
function privateAddress(ip: string) {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe80') ||
    v6.startsWith('::ffff:')
  );
}

async function publicTarget(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
  if (u.port && !['80', '443'].includes(u.port)) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (privateAddress(host)) return null;
  // El nombre no puede apuntar a la red interna.
  const ips = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  const all = ips.flat();
  if (!all.length || all.some(privateAddress)) return null;
  return u;
}

/**
 * Descarga un feed RSS o Atom (o la página que lo anuncia) para el navegador, que no puede
 * leerlo directamente por CORS. No interpreta nada: devuelve el texto tal cual.
 */
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

    const { url } = await req.json().catch(() => ({}));
    if (typeof url !== 'string' || url.length > 2000)
      return json({ error: 'Enlace no válido.' }, 400);
    // Las redirecciones se siguen a mano para revisar cada destino.
    let target = await publicTarget(url);
    let res: Response | null = null;
    for (let hop = 0; target && hop < 5; hop++) {
      res = await fetch(target, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NexoFeedReader/1.0)',
          Accept:
            'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
        },
        signal: AbortSignal.timeout(10000),
      });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      await res.body?.cancel();
      target = await publicTarget(new URL(next, target).href);
      res = null;
    }
    if (!target) return json({ error: 'Introduce un enlace web público.' }, 400);
    if (!res) return json({ error: 'Demasiadas redirecciones.' }, 502);
    if (!res.ok) {
      await res.body?.cancel();
      return json({ error: `El sitio respondió con el error ${res.status}.` }, 502);
    }

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return json({ error: 'El feed es demasiado grande.' }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    const type = res.headers.get('content-type') ?? '';
    const charset = type.match(/charset=([\w-]+)/i)?.[1] ?? 'utf-8';
    let text: string;
    try {
      text = new TextDecoder(charset).decode(bytes);
    } catch {
      text = new TextDecoder().decode(bytes);
    }
    return json({ url: target.href, type, text });
  } catch (e) {
    if ((e as Error)?.name === 'TimeoutError')
      return json({ error: 'El sitio tardó demasiado en responder.' }, 504);
    return json({ error: 'No se pudo descargar el feed.' }, 502);
  }
});
