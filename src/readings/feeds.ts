import { supabase } from "../backend";
import { publicLink } from "./capture";
import { store } from "./SaveLink";

/**
 * Newsletters y blogs por RSS o Atom: sus artículos nuevos entran solos a «Por leer». El feed lo
 * descarga la función `feed-fetch` (el navegador no puede por CORS); aquí se interpreta y cada
 * artículo se guarda como un enlace más (se captura, se traduce y no se repite).
 */

export type Feed = {
  id: string;
  url: string;
  title: string;
  site: string;
  last_item_at: string | null;
  checked_at: string | null;
  created_at: string;
};
type Item = { link: string; title: string; date: number | null; html: string };
type Parsed = { title: string; site: string; items: Item[] };

export const FEEDS_SQL = "supabase/migrations/202611100002_reading_feeds.sql";
const DEPLOY =
  "Despliega la función feed-fetch: npx supabase functions deploy feed-fetch --no-verify-jwt --project-ref imdvmlzdbmbvwkfoisgs --use-api";
/** Cada cuánto se revisan los feeds solos al abrir Lecturas. */
const EVERY = 30 * 60 * 1000;
/** Al añadir un feed entran sus últimos artículos; luego, como mucho estos por revisión. */
const FIRST = 3;
const PER_CHECK = 10;

/** ¿Falta la tabla (no se ejecutó la migración)? */
export const missingTable = (e: { code?: string; message?: string }) =>
  e.code === "42P01" ||
  e.code === "PGRST205" ||
  /reading_feeds/.test(e.message ?? "");

async function download(url: string) {
  const { data, error } = await supabase.functions.invoke("feed-fetch", {
    body: { url },
  });
  if (error) {
    const status = error.context?.status;
    const detail = await error.context?.json?.().catch(() => null);
    if (status === 404 && !detail?.error) throw Error(DEPLOY);
    throw Error(detail?.error || "No se pudo descargar el feed.");
  }
  if (typeof data?.text !== "string") throw Error(DEPLOY);
  return data as { url: string; type: string; text: string };
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
/** Hijo por nombre local (sirve con y sin espacio de nombres: `content:encoded`, Atom…). */
const child = (el: Element, ...names: string[]) =>
  Array.from(el.children).find((c) =>
    names.includes(c.localName.toLowerCase()),
  ) ?? null;
const when = (raw: string) => {
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
};

function parse(xml: string, base: string): Parsed | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return null;
  const root = doc.documentElement;
  const name = root.localName.toLowerCase();
  const absolute = (href: string) => {
    try {
      return new URL(href, base).href;
    } catch {
      return "";
    }
  };
  if (name === "feed") {
    // Atom.
    const linkOf = (el: Element) => {
      const links = Array.from(el.children).filter(
        (c) => c.localName === "link",
      );
      const best =
        links.find(
          (l) => (l.getAttribute("rel") ?? "alternate") === "alternate",
        ) ?? links[0];
      return absolute(best?.getAttribute("href") ?? "");
    };
    return {
      title: text(child(root, "title")),
      site: linkOf(root),
      items: Array.from(root.children)
        .filter((c) => c.localName === "entry")
        .map((e) => ({
          link: linkOf(e),
          title: text(child(e, "title")),
          date: when(text(child(e, "published", "updated", "issued"))),
          html: child(e, "content", "summary")?.textContent ?? "",
        })),
    };
  }
  if (name === "rss" || name === "rdf") {
    const channel = root.getElementsByTagName("channel")[0] ?? root;
    return {
      title: text(child(channel, "title")),
      site: absolute(text(child(channel, "link"))),
      items: Array.from(root.getElementsByTagName("item")).map((i) => {
        const guid = child(i, "guid");
        const permalink =
          guid && guid.getAttribute("isPermaLink") !== "false"
            ? text(guid)
            : "";
        return {
          link: absolute(text(child(i, "link")) || permalink),
          title: text(child(i, "title")),
          date: when(text(child(i, "pubdate", "date", "published", "updated"))),
          html:
            child(i, "encoded")?.textContent ??
            child(i, "description")?.textContent ??
            "",
        };
      }),
    };
  }
  return null;
}

/** El feed que anuncia una página (`<link rel="alternate" type="application/rss+xml">`). */
function announced(html: string, base: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const link = doc.querySelector<HTMLLinkElement>(
    'link[rel~="alternate"][type*="rss"], link[rel~="alternate"][type*="atom"]',
  );
  const href = link?.getAttribute("href");
  if (!href) return "";
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
}

/** `https://sitio.com/blog?x=1` → `https://sitio.com/blog/feed`. */
function slashFeed(url: string) {
  const u = new URL(url);
  u.pathname = u.pathname.replace(/\/?$/, "/feed");
  u.search = "";
  u.hash = "";
  return u.href;
}

/**
 * Encuentra y lee el feed de un enlace: puede ser el feed mismo, la página que lo anuncia o un
 * sitio con el feed en `/feed` (Substack, WordPress…).
 */
export async function resolveFeed(raw: string) {
  const start = publicLink(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
  const tried = new Set<string>();
  const queue = [start];
  let failure: unknown = null;
  let answered = false;
  while (queue.length && tried.size < 4) {
    const url = queue.shift()!;
    if (tried.has(url)) continue;
    tried.add(url);
    try {
      const page = await download(url);
      answered = true;
      const feed = parse(page.text, page.url);
      if (feed) return { url: page.url, ...feed };
      const found = announced(page.text, page.url);
      if (found) queue.unshift(found);
      queue.push(slashFeed(page.url));
    } catch (e) {
      // Sin la función desplegada no tiene sentido seguir probando.
      if ((e as Error).message === DEPLOY) throw e;
      failure = e;
      if (url === start) queue.push(slashFeed(start));
    }
  }
  if (!answered && failure) throw failure;
  throw Error("No encontré un feed RSS en ese enlace.");
}

/** Texto plano de un HTML (por si la página del artículo no se deja capturar). */
function plain(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = doc.body.querySelectorAll(
    "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre",
  );
  const lines = blocks.length
    ? Array.from(blocks, (b) => {
        const t = text(b);
        if (!t) return "";
        if (/^h[1-6]$/i.test(b.tagName)) return "## " + t;
        if (b.tagName === "LI") return "- " + t;
        if (b.tagName === "BLOCKQUOTE") return "> " + t;
        return t;
      })
    : [text(doc.body)];
  return lines.filter(Boolean).join("\n\n");
}

/** Guarda en «Por leer» los artículos nuevos de un feed. Devuelve cuántos entraron. */
export async function syncFeed(feed: Feed, parsed?: Parsed) {
  const data = parsed ?? (await resolveFeed(feed.url));
  const cutoff = feed.last_item_at ? Date.parse(feed.last_item_at) : null;
  const linked = data.items.filter((i) => i.link);
  // Lo más reciente primero; lo que no trae fecha se queda en su orden.
  const sorted = [...linked].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  const fresh =
    cutoff === null
      ? sorted.slice(0, FIRST)
      : sorted
          .filter((i) => i.date !== null && i.date > cutoff)
          .slice(0, PER_CHECK);
  let added = 0;
  // Del más antiguo al más nuevo: así el último queda arriba en «Por leer».
  for (const item of fresh.reverse()) {
    let link: string;
    try {
      link = publicLink(item.link);
    } catch {
      continue;
    }
    try {
      const { existed } = await store(link, null, () => {});
      if (!existed) added++;
    } catch {
      // La página no se dejó capturar: se guarda el texto que trae el feed, si basta.
      const content = plain(item.html);
      if (content.length < 400) continue;
      try {
        const { existed } = await store(
          link,
          { title: item.title || link, content },
          () => {},
        );
        if (!existed) added++;
      } catch {
        /* Se intenta en la próxima revisión solo si es más nuevo; este se pierde. */
      }
    }
  }
  // Una fecha en el futuro (feeds mal configurados) no puede tapar lo que venga después.
  const newest = Math.min(
    Date.now(),
    Math.max(cutoff ?? 0, ...data.items.map((i) => i.date ?? 0)),
  );
  await supabase
    .from("reading_feeds")
    .update({
      checked_at: new Date().toISOString(),
      // Sin fechas en el feed, se usa ahora: lo de antes ya no se vuelve a traer.
      last_item_at: new Date(newest || Date.now()).toISOString(),
      ...(!feed.title && data.title && { title: data.title.slice(0, 300) }),
    })
    .eq("id", feed.id);
  return added;
}

export async function listFeeds() {
  const { data, error } = await supabase
    .from("reading_feeds")
    .select("*")
    .order("created_at");
  if (error) throw error;
  return data as Feed[];
}

/** Añade un feed y trae sus últimos artículos. */
export async function addFeed(raw: string) {
  const parsed = await resolveFeed(raw);
  const { data, error } = await supabase
    .from("reading_feeds")
    .insert({
      url: parsed.url,
      title: parsed.title.slice(0, 300),
      site: parsed.site.slice(0, 2000),
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw Error("Ya tenías este feed.");
    throw error;
  }
  const added = await syncFeed(data as Feed, parsed);
  return { feed: data as Feed, added };
}

export async function removeFeed(id: string) {
  const { error } = await supabase.from("reading_feeds").delete().eq("id", id);
  if (error) throw error;
}

let running: Promise<number> | null = null;
/**
 * Revisa los feeds (los que no se revisaron hace poco, o todos con `force`). Devuelve cuántos
 * artículos entraron. Si ya se está revisando, espera a esa revisión.
 */
export function syncFeeds(force = false) {
  running ??= (async () => {
    try {
      const feeds = await listFeeds();
      let added = 0;
      for (const feed of feeds) {
        const recent =
          feed.checked_at && Date.now() - Date.parse(feed.checked_at) < EVERY;
        if (recent && !force) continue;
        try {
          added += await syncFeed(feed);
        } catch (e) {
          if (force) console.warn("No se pudo revisar", feed.url, e);
        }
      }
      return added;
    } finally {
      running = null;
    }
  })();
  return running;
}
