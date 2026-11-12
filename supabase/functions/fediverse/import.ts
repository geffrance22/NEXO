import { cmpId, htmlToText } from './text.ts';

/*
 * Lo que publicas en Mastodon llega a Nexo como instantes. Se lee tu cuenta de forma pública (sin
 * token: no hace falta ningún permiso de lectura) desde el último post que ya se revisó. Entran
 * tus posts públicos y sin listar, y tus respuestas a ti mismo (quedan como hilo). No entran los
 * boosts, las respuestas a otras personas ni lo que publicó Nexo. Lo editado en Mastodon se
 * actualiza; lo borrado allí no se borra de Nexo.
 */

const PHOTOS = 4;
const PAGES = 5;
const PAGE = 40;
/** Entre una revisión y otra (aunque sea desde otra pestaña) pasan al menos estos segundos. */
const LOCK_SECONDS = 20;
const BODY_MAX = 4000;
/** Lo publicado con la aplicación de Nexo ya está en Nexo. */
const NEXO_APP = 'NEXO';
/** Una revisión no pasa de aquí; si quedó trabajo, sigue en la próxima. */
const BUDGET_MS = 90_000;

type Image = { url: string; medium?: string; thumb?: string };
type Status = {
  id: string;
  created_at: string;
  edited_at: string | null;
  visibility: string;
  content: string;
  spoiler_text: string;
  url: string | null;
  uri: string;
  in_reply_to_id: string | null;
  in_reply_to_account_id: string | null;
  reblog: unknown | null;
  application?: { name?: string } | null;
  media_attachments?: { type: string; url: string }[];
};
export type Imported = { id: string; body: string };
export type ImportResult = {
  imported: Imported[];
  updated: Imported[];
  /** Otra revisión acababa de correr: no se hizo nada. */
  busy?: boolean;
  /** Motivo de que se detuviera a medias (lo ya traído queda traído). */
  error?: string;
};
type Api = (path: string, init?: RequestInit, timeout?: number) => Promise<Response>;
// deno-lint-ignore no-explicit-any
type Db = any;

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Error desconocido.');

/** Los posts públicos de tu cuenta, sin token (con uno sin permiso de lectura, Mastodon rechaza). */
async function statuses(base: string, account: string, query: string): Promise<Status[]> {
  const res = await fetch(
    `${base}/api/v1/accounts/${encodeURIComponent(account)}/statuses?exclude_reblogs=true&${query}`,
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) },
  ).catch(() => null);
  if (!res) throw new Error('No se pudo conectar con el servidor.');
  if (res.status === 401 || res.status === 403)
    throw new Error('El servidor no deja leer tus posts sin sesión: haría falta un token con read:statuses.');
  if (!res.ok) throw new Error(`El servidor respondió con el error ${res.status}.`);
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? (data as Status[]) : [];
}

/** El texto del post como se guarda en Nexo (con el aviso de contenido delante, si lo tenía). */
function bodyOf(s: Status): { body: string; photos: string[] } {
  const text = [s.spoiler_text, htmlToText(s.content)].filter((t) => t.trim()).join('\n\n');
  const media = s.media_attachments ?? [];
  const photos = media.filter((m) => m.type === 'image' && m.url).map((m) => m.url).slice(0, PHOTOS);
  const left = media.length - photos.length;
  // Un video o un audio no se trae: queda el enlace al post para verlo allí.
  const note = left > 0 ? `(Con ${left} adjunto${left > 1 ? 's' : ''} que no se trajo: ${s.url ?? s.uri})` : '';
  return { body: [text, note].filter(Boolean).join('\n\n').slice(0, BODY_MAX).trim(), photos };
}

/** Copia la foto a ImgBB (como el resto de fotos de Nexo); si no se puede, se enlaza la original. */
async function keepPhoto(url: string): Promise<Image> {
  const key = Deno.env.get('IMGBB_API_KEY');
  if (key) {
    try {
      const form = new FormData();
      form.append('key', key);
      form.append('image', url);
      const res = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const d = (await res.json().catch(() => null))?.data;
      const asUrl = (v: unknown) =>
        typeof v === 'object' && v && typeof (v as { url?: unknown }).url === 'string'
          ? (v as { url: string }).url
          : undefined;
      const full = typeof d?.url === 'string' ? d.url : asUrl(d?.image);
      if (res.ok && full) return { url: full, medium: asUrl(d.medium), thumb: asUrl(d.thumb) };
    } catch {
      /* Se enlaza la original. */
    }
  }
  return { url };
}

export async function importPosts(
  db: Db,
  userId: string,
  base: string,
  api: Api,
): Promise<ImportResult> {
  const started = Date.now();
  const out: ImportResult = { imported: [], updated: [] };

  const { data: row, error: syncError } = await db
    .from('fediverse_sync')
    .select('account_id,since_id')
    .eq('owner_id', userId)
    .maybeSingle();
  if (syncError)
    throw new Error('Falta ejecutar supabase/migrations/202611120006_instant_import.sql.');

  // La primera vez solo se marca dónde estás: lo anterior no se trae, empieza desde ahora.
  if (!row) {
    const me = await api('/api/v1/accounts/verify_credentials');
    const account = ((await me.json().catch(() => null)) as { id?: unknown } | null)?.id;
    if (!me.ok || !account) throw new Error(`No se pudo leer tu cuenta (error ${me.status}).`);
    const [latest] = await statuses(base, String(account), 'limit=1');
    const { error } = await db
      .from('fediverse_sync')
      .insert({ owner_id: userId, account_id: String(account), since_id: latest?.id ?? '0' });
    if (error && error.code !== '23505') throw new Error('No se pudo guardar dónde empezar.');
    return out;
  }

  // Un solo lector a la vez: si otra pestaña acaba de revisar, esta espera a la próxima.
  const now = new Date();
  const { data: locked } = await db
    .from('fediverse_sync')
    .update({ checked_at: now.toISOString() })
    .eq('owner_id', userId)
    .lt('checked_at', new Date(now.getTime() - LOCK_SECONDS * 1000).toISOString())
    .select('owner_id');
  if (!locked?.length) return { ...out, busy: true };

  const account = String(row.account_id);
  let cursor = String(row.since_id);

  try {
    // ── Posts nuevos, del más antiguo al más reciente ──
    const fetched: Status[] = [];
    let from = cursor;
    for (let p = 0; p < PAGES; p++) {
      const page = await statuses(base, account, `min_id=${encodeURIComponent(from)}&limit=${PAGE}`);
      if (!page.length) break;
      fetched.push(...page);
      from = page.reduce((m, s) => (cmpId(s.id, m) > 0 ? s.id : m), from);
      if (page.length < PAGE) break;
    }
    fetched.sort((a, b) => cmpId(a.id, b.id));

    // Los que Nexo ya conoce (los que publicó él) no se vuelven a traer.
    const known = new Set<string>();
    if (fetched.length) {
      const { data } = await db
        .from('instant_shares')
        .select('remote_ids')
        .eq('owner_id', userId)
        .overlaps('remote_ids', fetched.map((s) => s.id));
      for (const r of (data ?? []) as { remote_ids: string[] }[])
        for (const id of r.remote_ids) known.add(id);
    }

    for (const s of fetched) {
      if (Date.now() - started > BUDGET_MS) break;
      const wanted =
        (s.visibility === 'public' || s.visibility === 'unlisted') &&
        !s.reblog &&
        s.application?.name !== NEXO_APP &&
        !known.has(s.id) &&
        (!s.in_reply_to_id || s.in_reply_to_account_id === account);
      if (wanted) {
        const made = await bring(db, userId, account, s);
        if (made) out.imported.push(made);
      }
      cursor = s.id;
    }

    // ── Lo editado en Mastodon desde que se trajo ──
    const { data: mine } = await db
      .from('instant_shares')
      .select('instant_id,remote_ids,remote_edited_at')
      .eq('owner_id', userId)
      .eq('origin', 'mastodon')
      .order('shared_at', { ascending: false })
      .limit(60);
    const brought = (
      (mine ?? []) as { instant_id: string; remote_ids: string[]; remote_edited_at: string | null }[]
    ).filter((m) => m.remote_ids.length);
    if (brought.length && Date.now() - started < BUDGET_MS) {
      const recent = await statuses(base, account, `limit=${PAGE}`);
      const by = new Map(brought.map((m) => [m.remote_ids[0], m]));
      const changed = recent.filter((s) => {
        const m = by.get(s.id);
        return m && s.edited_at && Date.parse(s.edited_at) > (m.remote_edited_at ? Date.parse(m.remote_edited_at) : 0) + 1000;
      });
      if (changed.length) {
        const { data: current } = await db
          .from('instants')
          .select('id,body')
          .eq('owner_id', userId)
          .in('id', changed.map((s) => by.get(s.id)!.instant_id));
        const bodies = new Map(((current ?? []) as { id: string; body: string }[]).map((c) => [c.id, c.body]));
        for (const s of changed) {
          const m = by.get(s.id)!;
          const { body } = bodyOf(s);
          if (body && bodies.has(m.instant_id) && bodies.get(m.instant_id) !== body) {
            const at = new Date().toISOString();
            const { error } = await db
              .from('instants')
              .update({ body, edited_at: s.edited_at, updated_at: at })
              .eq('id', m.instant_id)
              .eq('owner_id', userId);
            if (!error) out.updated.push({ id: m.instant_id, body });
          }
          await db
            .from('instant_shares')
            .update({ remote_edited_at: s.edited_at, updated_at: new Date().toISOString() })
            .eq('instant_id', m.instant_id)
            .eq('owner_id', userId);
        }
      }
    }
  } catch (e) {
    out.error = message(e);
  }

  if (cursor !== String(row.since_id))
    await db.from('fediverse_sync').update({ since_id: cursor }).eq('owner_id', userId);
  return out;
}

/** Guarda un post como instante (y a qué post corresponde). Null si no había nada que guardar. */
async function bring(db: Db, userId: string, account: string, s: Status): Promise<Imported | null> {
  const { body, photos } = bodyOf(s);
  if (!body && !photos.length) return null;

  // Una respuesta a ti mismo sigue el hilo de aquello a lo que responde, si eso ya está en Nexo.
  const id = crypto.randomUUID();
  let thread = id;
  let pos = 0;
  if (s.in_reply_to_id && s.in_reply_to_account_id === account) {
    const { data: owner } = await db
      .from('instant_shares')
      .select('instant_id')
      .eq('owner_id', userId)
      .contains('remote_ids', [s.in_reply_to_id])
      .limit(1);
    const parent = owner?.[0]?.instant_id as string | undefined;
    const { data: head } = parent
      ? await db.from('instants').select('thread_id').eq('id', parent).eq('owner_id', userId).maybeSingle()
      : { data: null };
    if (head?.thread_id) {
      thread = head.thread_id;
      const { data: last } = await db
        .from('instants')
        .select('pos')
        .eq('owner_id', userId)
        .eq('thread_id', thread)
        .order('pos', { ascending: false })
        .limit(1);
      pos = Math.min(200, Number(last?.[0]?.pos ?? -1) + 1);
    }
  }

  const images: Image[] = [];
  for (const url of photos) images.push(await keepPhoto(url));

  const at = new Date(s.created_at);
  const stamp = (Number.isNaN(at.getTime()) ? new Date() : at).toISOString();
  const { error } = await db
    .from('instants')
    .insert({ id, owner_id: userId, thread_id: thread, pos, body, images, created_at: stamp, updated_at: stamp });
  if (error) throw new Error('No se pudo guardar un post como instante.');
  const { error: linkError } = await db.from('instant_shares').insert({
    instant_id: id,
    owner_id: userId,
    status: 'posted',
    remote_ids: [s.id],
    remote_url: s.url ?? s.uri,
    origin: 'mastodon',
    shared_at: stamp,
    remote_edited_at: s.edited_at,
  });
  if (linkError) {
    // Sin saber a qué post corresponde, se volvería a traer: mejor deshacerlo.
    await db.from('instants').delete().eq('id', id).eq('owner_id', userId);
    throw new Error('No se pudo enlazar el instante con su post.');
  }
  return { id, body };
}
