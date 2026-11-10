import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "retry-after",
};
const json = (
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, "Content-Type": "application/json", ...extra },
  });

const API = "https://yourimageshare.com/api";
/** YourImageShare admite 100 MB por petición; una captura nunca se acerca. */
const MAX_BYTES = 60 * 1024 * 1024;
const COLUMNS =
  "id,folder_id,name,note,tags,yis_id,src,url,thumb,width,height,size,mime,created_at,updated_at";
const https = (v: unknown) =>
  typeof v === "string" && /^https:\/\//.test(v) ? v : null;
const retryAfter = (res: Response) =>
  Math.max(1, Number(res.headers.get("retry-after")) || 20);
const yisError = (body: unknown, status: number) => {
  const e = (body as { errors?: unknown } | null)?.errors;
  const text = typeof e === "string" ? e : Array.isArray(e) ? e.join(" ") : "";
  return text
    ? `YourImageShare: ${text}`
    : `YourImageShare respondió con el error ${status}.`;
};

/**
 * CAPTURAS: sube a YourImageShare y guarda la fila, o borra de YourImageShare lo que marcaste para
 * borrar. La clave (YIS_API_KEY) vive en los secretos: con ella se puede borrar todo lo subido, así
 * que nunca viaja al navegador. Solo para usuarios con sesión, y solo sobre sus propias filas.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST")
    return json({ error: "Método no permitido." }, 405);
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Inicia sesión." }, 401);
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: auth } },
      },
    );
    const { data: who, error: authError } = await db.auth.getUser();
    if (authError || !who.user) return json({ error: "Inicia sesión." }, 401);

    const key = Deno.env.get("YIS_API_KEY");
    if (!key)
      return json({ error: "Falta configurar YIS_API_KEY en Supabase." }, 503);

    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await req.json().catch(() => null);
      if (body?.action === "purge") return await purge(db, key);
      return json({ error: "Acción desconocida." }, 400);
    }
    return await upload(db, key, req);
  } catch {
    return json({ error: "No se pudo conectar con YourImageShare." }, 502);
  }
});

type Db = ReturnType<typeof createClient>;

async function upload(db: Db, key: string, req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return json({ error: "No llegó ninguna imagen." }, 400);
  if (!file.type.startsWith("image/"))
    return json({ error: "El archivo no es una imagen." }, 400);
  if (file.size > MAX_BYTES)
    return json({ error: "La imagen pasa de 60 MB." }, 413);

  const name =
    String(form?.get("name") ?? file.name ?? "")
      .trim()
      .slice(0, 200) || "Captura";
  const note = String(form?.get("note") ?? "").slice(0, 4000);
  let tags: string[] = [];
  try {
    const raw = JSON.parse(String(form?.get("tags") ?? "[]"));
    if (Array.isArray(raw))
      tags = [
        ...new Set(
          raw.map((t) => String(t).trim().slice(0, 40)).filter(Boolean),
        ),
      ].slice(0, 30);
  } catch {
    /* sin etiquetas */
  }
  const folderRaw = String(form?.get("folder_id") ?? "");
  let folder_id: string | null = null;
  if (folderRaw) {
    // La carpeta tiene que ser tuya (las políticas filtran la consulta).
    const { data } = await db
      .from("screenshot_folders")
      .select("id")
      .eq("id", folderRaw)
      .maybeSingle();
    if (!data) return json({ error: "Esa carpeta ya no existe." }, 404);
    folder_id = folderRaw;
  }

  const upstream = new FormData();
  upstream.append("uploads", file, file.name || "captura.png");
  // Tal cual: sin pasar a WebP (la dirección no cambia y se descarga el archivo original).
  upstream.append("keep_original", "1");
  // Cada fila es dueña de su archivo: borrar una no puede dejar a otra sin imagen.
  upstream.append("allow_duplicate", "1");
  upstream.append("visibility", "private");
  upstream.append("title", name.slice(0, 90));
  const res = await fetch(API, {
    method: "POST",
    headers: { "X-API-Key": key },
    body: upstream,
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  if (res.status === 429) {
    const wait = retryAfter(res);
    return json({ error: "Límite de YourImageShare.", retryAfter: wait }, 429, {
      "Retry-After": String(wait),
    });
  }
  const d = body?.data;
  if (!res.ok || body?.type !== "success" || !d?.id)
    return json({ error: yisError(body, res.status) }, 502);

  const url = https(d.path) ?? https(d.src);
  const src = https(d.src) ?? url;
  if (!url || !src)
    return json({ error: "YourImageShare no devolvió la dirección." }, 502);
  const { data: row, error } = await db
    .from("screenshots")
    .insert({
      folder_id,
      name,
      note,
      tags,
      yis_id: String(d.id),
      src,
      url,
      thumb: https(d.thumb),
      width: Number.isFinite(d.width) ? d.width : null,
      height: Number.isFinite(d.height) ? d.height : null,
      size: Number.isFinite(d.size) ? d.size : file.size,
      mime: file.type.slice(0, 60),
    })
    .select(COLUMNS)
    .single();
  if (error || !row) {
    // Sin fila no hay forma de verla ni borrarla: se quita también de YourImageShare.
    await fetch(`${API}/${encodeURIComponent(String(d.id))}`, {
      method: "DELETE",
      headers: { "X-API-Key": key },
    }).catch(() => null);
    return json(
      { error: error?.message ?? "No se pudo guardar la captura." },
      500,
    );
  }
  return json({ data: row });
}

/**
 * Borra de YourImageShare las capturas marcadas y luego sus filas. Para en cuanto YourImageShare
 * pide esperar (o se acaba el tiempo) y dice cuántas faltan: el navegador vuelve a llamar.
 */
async function purge(db: Db, key: string) {
  const started = Date.now();
  const { data: rows, error } = await db
    .from("screenshots")
    .select("id,yis_id")
    .not("deleted_at", "is", null)
    .limit(60);
  if (error) return json({ error: error.message }, 500);
  const done: string[] = [];
  let wait = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    if (Date.now() - started > 45_000) break;
    const res = await fetch(
      `${API}/${encodeURIComponent(String(row.yis_id))}`,
      {
        method: "DELETE",
        headers: { "X-API-Key": key },
        signal: AbortSignal.timeout(20_000),
      },
    ).catch(() => null);
    if (!res) {
      failed++;
      continue;
    }
    await res.body?.cancel();
    if (res.status === 429) {
      wait = retryAfter(res);
      break;
    }
    // 404: ya no estaba en YourImageShare. También se quita la fila.
    if (res.ok || res.status === 404) done.push(String(row.id));
    else failed++;
  }
  if (done.length) {
    const { error: delError } = await db
      .from("screenshots")
      .delete()
      .in("id", done);
    if (delError) return json({ error: delError.message }, 500);
  }
  const { count } = await db
    .from("screenshots")
    .select("id", { count: "exact", head: true })
    .not("deleted_at", "is", null);
  return json({
    purged: done.length,
    remaining: count ?? 0,
    retryAfter: wait,
    failed,
  });
}
