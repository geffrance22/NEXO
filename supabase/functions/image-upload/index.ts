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

/** ImgBB admite hasta 32 MB por imagen. */
const MAX_BYTES = 32 * 1024 * 1024;
const asUrl = (v: unknown) =>
  typeof v === 'object' && v && typeof (v as { url?: unknown }).url === 'string'
    ? { url: (v as { url: string }).url }
    : undefined;

/**
 * Sube una foto a ImgBB con la clave guardada en los secretos (IMGBB_API_KEY), para que no viaje
 * en el código del navegador. Solo para usuarios con sesión.
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

    const key = Deno.env.get('IMGBB_API_KEY');
    if (!key) return json({ error: 'Falta configurar IMGBB_API_KEY en Supabase.' }, 503);

    const form = await req.formData().catch(() => null);
    const image = form?.get('image');
    if (!(image instanceof File)) return json({ error: 'No llegó ninguna imagen.' }, 400);
    if (!image.type.startsWith('image/')) return json({ error: 'El archivo no es una imagen.' }, 400);
    if (image.size > MAX_BYTES) return json({ error: 'La imagen pasa de 32 MB.' }, 413);

    const upstream = new FormData();
    upstream.append('key', key);
    upstream.append('image', image, image.name || 'foto.jpg');
    const res = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: upstream,
      signal: AbortSignal.timeout(80_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.data) {
      const message = body?.error?.message;
      return json(
        { error: message ? `ImgBB: ${message}` : `ImgBB respondió con el error ${res.status}.` },
        502,
      );
    }
    const d = body.data;
    return json({
      data: {
        url: typeof d.url === 'string' ? d.url : asUrl(d.image)?.url,
        medium: asUrl(d.medium),
        thumb: asUrl(d.thumb),
      },
    });
  } catch {
    return json({ error: 'No se pudo conectar con ImgBB.' }, 502);
  }
});
