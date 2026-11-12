import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { importPosts } from './import.ts';
import { pieces } from './text.ts';

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

/*
 * Publica tus Instantes en tu cuenta de Mastodon (o un servidor compatible: GoToSocial, Akkoma,
 * Hollo…). Todo vive en los secretos de Supabase, nada en el navegador:
 *   MASTODON_INSTANCE   servidor, p. ej. mastodon.social
 *   MASTODON_TOKEN      token de acceso de la aplicación (permisos write:statuses y write:media)
 *   FEDIVERSE_OWNER_ID  id (auth.users) de quien puede publicar: solo esa persona usa la cuenta
 * Lo que sale es solo el texto y hasta 4 fotos, siempre en público. Un texto largo se parte en un
 * hilo y un hilo de Instantes queda como respuestas encadenadas. Ánimo, personas, lugares,
 * cuadernos y piezas no viajan.
 */

const PHOTOS = 4;
const MAX_IDS = 20;
const MAX_PIECES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Las fotos de los Instantes viven en ImgBB: no se descarga nada de otro sitio. */
const IMAGE_HOSTS = /(^|\.)(ibb\.co|imgbb\.com)$/i;

type Image = { url: string; medium?: string };
type Row = { id: string; thread_id: string; pos: number; body: string; images: Image[] };
type Share = {
  instant_id: string;
  status: 'posted' | 'error';
  remote_ids: string[];
  remote_url: string | null;
};
type Result = {
  id: string;
  status: 'posted' | 'error' | 'removed';
  url: string | null;
  ids: string[];
  note: string;
};
type Limits = { chars: number; media: number; imageBytes: number };
type Api = (path: string, init?: RequestInit, timeout?: number) => Promise<Response>;

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Error desconocido.');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** El servidor de los secretos como origen https, o null si falta o no es válido. */
function origin(): string | null {
  const raw = Deno.env.get('MASTODON_INSTANCE')?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function client(base: string, token: string): Api {
  return (path, init = {}, timeout = 25_000) =>
    fetch(base + path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeout),
    });
}

/** Convierte la respuesta de error de Mastodon en un mensaje que se entienda. */
async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const detail = typeof body?.error === 'string' ? body.error : '';
  const base =
    res.status === 401
      ? 'El token de Mastodon no es válido o expiró.'
      : res.status === 403
        ? 'El token no tiene permiso: necesita write:statuses y write:media.'
        : res.status === 429
          ? 'Mastodon pide esperar un poco (límite de peticiones).'
          : `${what} (error ${res.status}).`;
  throw new Error(detail && res.status !== 401 ? `${base} ${detail}` : base);
}

/** Cuánto admite el servidor (por defecto, lo de Mastodon: 500 caracteres). */
async function limits(api: Api): Promise<Limits> {
  const out: Limits = { chars: 500, media: PHOTOS, imageBytes: 16 * 1024 * 1024 };
  for (const path of ['/api/v2/instance', '/api/v1/instance']) {
    const res = await api(path).catch(() => null);
    if (!res?.ok) continue;
    const cfg = ((await res.json().catch(() => null)) as { configuration?: Record<string, any> } | null)
      ?.configuration;
    const chars = Number(cfg?.statuses?.max_characters);
    const media = Number(cfg?.statuses?.max_media_attachments);
    const bytes = Number(cfg?.media_attachments?.image_size_limit);
    if (chars > 0) out.chars = chars;
    if (media > 0) out.media = Math.min(media, PHOTOS);
    if (bytes > 0) out.imageBytes = bytes;
    break;
  }
  return out;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

async function download(url: string, maxBytes: number): Promise<Blob | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !IMAGE_HOSTS.test(u.hostname)) return null;
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes) return null;
  const blob = await res.blob();
  return blob.size > 0 && blob.size <= maxBytes && blob.type.startsWith('image/') ? blob : null;
}

/** Sube una foto a Mastodon (la original; si pesa de más, la versión media). Null si no se pudo. */
async function uploadPhoto(api: Api, img: Image, maxBytes: number): Promise<string | null> {
  for (const url of [img.url, img.medium]) {
    if (!url) continue;
    const blob = await download(url, maxBytes).catch(() => null);
    if (!blob) continue;
    const form = new FormData();
    form.append('file', blob, `foto.${EXT[blob.type] ?? 'jpg'}`);
    const res = await api('/api/v2/media', { method: 'POST', body: form }, 60_000);
    if (res.status === 401 || res.status === 403 || res.status === 429) await fail(res, 'No se pudo subir la foto');
    if (res.status !== 200 && res.status !== 202) continue;
    const id = String(((await res.json().catch(() => null)) as { id?: unknown } | null)?.id ?? '');
    if (!id) continue;
    // Si el servidor aún la procesa, se espera a que termine.
    for (let n = 0; res.status === 202 && n < 15; n++) {
      await sleep(1000);
      const state = await api(`/api/v1/media/${encodeURIComponent(id)}`).catch(() => null);
      if (state?.status === 200) break;
    }
    return id;
  }
  return null;
}

async function post(api: Api, p: { status: string; media: string[]; parent: string | null }) {
  const body: Record<string, unknown> = { visibility: 'public', language: 'es' };
  if (p.status) body.status = p.status;
  if (p.media.length) body.media_ids = p.media;
  if (p.parent) body.in_reply_to_id = p.parent;
  const res = await api('/api/v1/statuses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, 'No se pudo publicar');
  const d = (await res.json().catch(() => null)) as { id?: unknown; url?: unknown; uri?: unknown } | null;
  if (!d?.id) throw new Error('Mastodon no devolvió la publicación.');
  return {
    id: String(d.id),
    url: typeof d.url === 'string' ? d.url : typeof d.uri === 'string' ? d.uri : '',
  };
}

/** Edita una publicación; devuelve cuándo quedó editada (para no traerla de vuelta como cambio). */
async function edit(api: Api, id: string, status: string, media?: string[]): Promise<string | null> {
  const body: Record<string, unknown> = {};
  if (status) body.status = status;
  if (media) body.media_ids = media;
  const res = await api(`/api/v1/statuses/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, 'No se pudo editar la publicación');
  const d = (await res.json().catch(() => null)) as { edited_at?: unknown } | null;
  return typeof d?.edited_at === 'string' ? d.edited_at : null;
}

/** Borra una publicación; si ya no estaba, da igual. */
async function remove(api: Api, id: string) {
  const res = await api(`/api/v1/statuses/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (res.ok || res.status === 404 || res.status === 410) return;
  await fail(res, 'No se pudo borrar la publicación');
}

/** Comparación que no revela en cuánto coinciden las cadenas. */
function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  try {
    // Una vez al día (pg_cron, migración 202611120007) trae lo que publicaste en Mastodon, aunque
    // Nexo esté cerrado. No hay sesión: lo protege x-cron-secret (FEDIVERSE_CRON_SECRET) y solo
    // trabaja para el dueño de la cuenta (FEDIVERSE_OWNER_ID).
    const sent = req.headers.get('x-cron-secret');
    if (sent !== null) {
      const secret = Deno.env.get('FEDIVERSE_CRON_SECRET');
      if (!secret || !safeEqual(sent, secret)) return json({ error: 'No autorizado.' }, 401);
      const url = Deno.env.get('SUPABASE_URL');
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const server = origin();
      const bearer = Deno.env.get('MASTODON_TOKEN');
      const who = Deno.env.get('FEDIVERSE_OWNER_ID');
      if (!url || !key || !server || !bearer || !who)
        return json({ error: 'Falta configurar los secretos de Mastodon.' }, 503);
      const admin = createClient(url, key, { auth: { persistSession: false } });
      return json(await importPosts(admin, who, server, client(server, bearer)));
    }

    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Inicia sesión.' }, 401);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: session, error: authError } = await db.auth.getUser();
    if (authError || !session.user) return json({ error: 'Inicia sesión.' }, 401);
    const userId = session.user.id;

    const body = (await req.json().catch(() => null)) as { action?: unknown; ids?: unknown } | null;
    const action = body?.action;

    const base = origin();
    const token = Deno.env.get('MASTODON_TOKEN');
    const owner = Deno.env.get('FEDIVERSE_OWNER_ID');
    // Quien no es el dueño de la cuenta (u otra persona con sesión) no la ve ni la usa.
    const allowed = Boolean(base && token && owner && owner === userId);

    if (action === 'status') {
      if (!allowed) return json({ enabled: false });
      const res = await client(base!, token!)('/api/v1/accounts/verify_credentials').catch(() => null);
      if (!res) return json({ enabled: false, reason: 'No se pudo conectar con el servidor.' });
      if (res.status === 401) return json({ enabled: false, reason: 'El token de Mastodon no es válido.' });
      const me = res.ok
        ? ((await res.json().catch(() => null)) as { username?: string; url?: string } | null)
        : null;
      const host = (() => {
        try {
          return new URL(me?.url ?? base!).host;
        } catch {
          return new URL(base!).host;
        }
      })();
      // Sin permiso para leer la cuenta (403) sigue sirviendo para publicar; solo falta el nombre.
      return json({ enabled: true, handle: me?.username ? `@${me.username}@${host}` : '', url: me?.url ?? base });
    }

    if (!allowed) return json({ error: 'Esta cuenta no está configurada para compartir.' }, 403);
    // Traer a Nexo lo que publicas en Mastodon.
    if (action === 'import') return json(await importPosts(db, userId, base!, client(base!, token!)));
    if (action !== 'publish' && action !== 'sync' && action !== 'unpublish')
      return json({ error: 'Acción desconocida.' }, 400);
    const asked: unknown = body?.ids;
    const ids = Array.isArray(asked)
      ? [...new Set(asked.filter((x): x is string => typeof x === 'string' && UUID.test(x)))]
      : [];
    if (!ids.length || ids.length > MAX_IDS) return json({ error: 'Instantes no válidos.' }, 400);

    const api = client(base!, token!);
    const { data: rowData, error: rowError } = await db
      .from('instants')
      .select('id,thread_id,pos,body,images')
      .in('id', ids);
    if (rowError) return json({ error: 'No se pudieron leer los instantes.' }, 500);
    const rows = new Map((rowData as Row[]).map((r) => [r.id, r]));
    const { data: shareData, error: shareError } = await db
      .from('instant_shares')
      .select('instant_id,status,remote_ids,remote_url')
      .in('instant_id', ids);
    if (shareError)
      return json({ error: 'Falta ejecutar supabase/migrations/202611120005_instant_shares.sql.' }, 503);
    const shares = new Map((shareData as Share[]).map((s) => [s.instant_id, s]));

    /** Guarda a qué publicación corresponde el instante (o que falló). */
    const save = async (
      id: string,
      v: {
        status: 'posted' | 'error';
        ids: string[];
        url: string | null;
        note: string;
        first?: boolean;
        /** Cuándo quedó editada la publicación (así la próxima revisión no la toma por un cambio ajeno). */
        edited?: string | null;
      },
    ) => {
      const { error } = await db.from('instant_shares').upsert(
        {
          instant_id: id,
          owner_id: userId,
          status: v.status,
          remote_ids: v.ids,
          remote_url: v.url,
          note: v.note.slice(0, 500),
          ...(v.first && { shared_at: new Date().toISOString() }),
          ...(v.edited && { remote_edited_at: v.edited }),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'instant_id' },
      );
      if (error) throw new Error('No se pudo guardar el estado en Nexo.');
    };

    /** La última publicación de la parte anterior del hilo, si esa también se compartió. */
    const parentOf = async (row: Row): Promise<string | null> => {
      if (row.pos <= 0) return null;
      const { data: prev } = await db
        .from('instants')
        .select('id,pos')
        .eq('thread_id', row.thread_id)
        .lt('pos', row.pos)
        .order('pos', { ascending: false })
        .limit(40);
      const before = (prev ?? []) as { id: string; pos: number }[];
      if (!before.length) return null;
      const { data: done } = await db
        .from('instant_shares')
        .select('instant_id,remote_ids')
        .in('instant_id', before.map((p) => p.id))
        .eq('status', 'posted');
      const last = new Map(
        ((done ?? []) as { instant_id: string; remote_ids: string[] }[]).map((d) => [
          d.instant_id,
          d.remote_ids[d.remote_ids.length - 1],
        ]),
      );
      for (const p of before) if (last.get(p.id)) return last.get(p.id)!;
      return null;
    };

    // Borrar no necesita saber cuánto admite el servidor.
    const lim: Limits =
      action === 'unpublish' ? { chars: 500, media: PHOTOS, imageBytes: 0 } : await limits(api);

    /** Sube las fotos del instante (hasta 4). Devuelve las subidas y cuántas fallaron. */
    const photos = async (row: Row) => {
      const media: string[] = [];
      let missed = 0;
      for (const img of (Array.isArray(row.images) ? row.images : []).slice(0, lim.media)) {
        const id = await uploadPhoto(api, img, lim.imageBytes);
        if (id) media.push(id);
        else missed++;
      }
      return { media, missed };
    };
    const notes = (missed: number, cut: boolean, extra: number) =>
      [
        missed ? `${missed} ${missed === 1 ? 'foto no se pudo subir' : 'fotos no se pudieron subir'}.` : '',
        cut ? 'El texto era muy largo y se cortó.' : '',
        extra > 0 ? `Pasaba de ${lim.media} fotos: solo van las primeras ${lim.media}.` : '',
      ]
        .filter(Boolean)
        .join(' ');

    const publish = async (row: Row): Promise<Result> => {
      const all = pieces(row.body, lim.chars);
      const parts = all.slice(0, MAX_PIECES);
      const { media, missed } = await photos(row);
      if (!parts.length && !media.length)
        throw new Error(missed ? 'No se pudo subir ninguna foto.' : 'Este instante no tiene nada que publicar.');
      const made: { id: string; url: string }[] = [];
      try {
        let parent = await parentOf(row);
        for (let k = 0; k < Math.max(parts.length, 1); k++) {
          const s = await post(api, { status: parts[k] ?? '', media: k === 0 ? media : [], parent });
          made.push(s);
          parent = s.id;
        }
        const note = notes(missed, all.length > MAX_PIECES, (row.images?.length ?? 0) - lim.media);
        const out = { ids: made.map((m) => m.id), url: made[0].url || null, note };
        await save(row.id, { status: 'posted', first: true, ...out });
        return { id: row.id, status: 'posted', ...out };
      } catch (e) {
        // No se deja a medias nada que Nexo no sepa que existe.
        for (const m of made.reverse()) await remove(api, m.id).catch(() => undefined);
        throw e;
      }
    };

    const sync = async (row: Row, share: Share): Promise<Result> => {
      const old = share.remote_ids;
      const all = pieces(row.body, lim.chars);
      const parts = all.slice(0, MAX_PIECES);
      const { media, missed } = await photos(row);
      if (!parts.length && !media.length) throw new Error('Un instante necesita texto o una foto.');
      const count = Math.max(parts.length, 1);
      const kept = old.slice(0, count);
      let edited: string | null = null;
      for (let k = 0; k < kept.length; k++) {
        const at = await edit(api, kept[k], parts[k] ?? '', k === 0 ? media : undefined);
        if (k === 0) edited = at;
      }
      const ids = [...kept];
      let parent = kept[kept.length - 1];
      for (let k = kept.length; k < count; k++) {
        const s = await post(api, { status: parts[k] ?? '', media: [], parent });
        ids.push(s.id);
        parent = s.id;
      }
      for (const extra of old.slice(count).reverse()) await remove(api, extra);
      const note = notes(missed, all.length > MAX_PIECES, (row.images?.length ?? 0) - lim.media);
      const out = { ids, url: share.remote_url, note };
      await save(row.id, { status: 'posted', edited, ...out });
      return { id: row.id, status: 'posted', ...out };
    };

    const results: Result[] = [];
    for (const id of ids) {
      const row = rows.get(id);
      const share = shares.get(id);
      const old = share?.remote_ids ?? [];
      try {
        if (action === 'unpublish') {
          for (const rid of [...old].reverse()) await remove(api, rid);
          if (share) await db.from('instant_shares').delete().eq('instant_id', id);
          results.push({ id, status: 'removed', url: null, ids: [], note: '' });
        } else if (!row) {
          throw new Error('Ese instante ya no existe.');
        } else if (action === 'publish' && share?.status === 'posted' && old.length) {
          results.push({ id, status: 'posted', url: share.remote_url, ids: old, note: '' });
        } else if (action === 'sync' && old.length) {
          results.push(await sync(row, share!));
        } else {
          results.push(await publish(row));
        }
      } catch (e) {
        const note = message(e);
        // Si ya estaba publicado, se conserva a qué publicación corresponde para poder reintentar.
        await save(id, { status: 'error', ids: old, url: share?.remote_url ?? null, note }).catch(
          () => undefined,
        );
        results.push({ id, status: 'error', url: share?.remote_url ?? null, ids: old, note });
      }
    }
    return json({ results });
  } catch (e) {
    return json({ error: message(e) }, 502);
  }
});
