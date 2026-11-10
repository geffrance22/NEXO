/**
 * Etimología de una fuente verificable: Wiktionary (primero en español; si no tiene la palabra,
 * en inglés). Se consulta directo desde el navegador con la API de MediaWiki (`origin=*` permite
 * CORS sin clave). El texto es de Wiktionary (CC BY-SA 4.0) y se muestra con su enlace.
 */
export type Etymology = {
  /** El texto de la sección «Etimología», tal cual (sin notas al pie). */
  text: string;
  /** La página de Wiktionary. */
  url: string;
  /** Edición consultada. */
  lang: "es" | "en";
  /** La lengua de la entrada (p. ej. «Español», «Inglés», «English»). */
  language: string;
};

const SITES = [
  {
    lang: "es",
    host: "es.wiktionary.org",
    heading: /^etimolog/i,
    prefer: /^español$/i,
  },
  {
    lang: "en",
    host: "en.wiktionary.org",
    heading: /^etymology/i,
    prefer: /^english$/i,
  },
] as const;

/** Textos de relleno de Wiktionary cuando la etimología está pendiente. */
const PLACEHOLDER =
  /incorpórala|si puedes|please add|this etymology is missing|etymology needed/i;

const cache = new Map<string, Promise<Etymology | null>>();

/** La sección de etimología de una página (HTML de la API), prefiriendo la lengua dada. */
function extract(html: string, site: (typeof SITES)[number]) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".mw-parser-output") ?? doc.body;
  root
    .querySelectorAll("sup.reference, .mw-editsection, style, script")
    .forEach((n) => n.remove());
  const found: { language: string; text: string }[] = [];
  let language = "";
  let collecting: string[] | null = null;
  const flush = () => {
    if (collecting?.length)
      found.push({ language, text: collecting.join("\n\n") });
    collecting = null;
  };
  for (const el of Array.from(root.children)) {
    const heading = el.matches(".mw-heading, h2, h3, h4, h5")
      ? (el.querySelector("h2, h3, h4, h5") ?? el)
      : null;
    if (heading) {
      flush();
      const title = (heading.textContent ?? "").trim();
      if (heading.tagName === "H2") language = title;
      else if (site.heading.test(title)) collecting = [];
      continue;
    }
    if (collecting && el.tagName === "P") {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text && !PLACEHOLDER.test(text)) collecting.push(text);
    }
  }
  flush();
  return found.find((f) => site.prefer.test(f.language)) ?? found[0] ?? null;
}

async function lookup(term: string): Promise<Etymology | null> {
  const pages = [...new Set([term, term.toLowerCase()])];
  for (const site of SITES)
    for (const page of pages) {
      const url =
        `https://${site.host}/w/api.php?action=parse&format=json&formatversion=2` +
        `&prop=text&redirects=1&origin=*&page=${encodeURIComponent(page)}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          parse?: { title?: string; text?: string };
        };
        if (!data.parse?.text) continue;
        const hit = extract(data.parse.text, site);
        if (!hit) continue;
        const title = data.parse.title ?? page;
        return {
          text: hit.text.slice(0, 900),
          url: `https://${site.host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
          lang: site.lang,
          language: hit.language,
        };
      } catch {
        // Sin red o sin respuesta a tiempo: se prueba lo siguiente.
      }
    }
  return null;
}

/**
 * La etimología de un término en Wiktionary, o null si no la tiene (o es una frase larga).
 * Se recuerda durante la visita.
 */
export function fetchEtymology(term: string) {
  const t = term.replace(/\s+/g, " ").trim();
  if (!t || t.length > 60 || t.split(" ").length > 4)
    return Promise.resolve(null);
  const key = t.toLowerCase();
  let hit = cache.get(key);
  if (!hit) {
    hit = lookup(t);
    cache.set(key, hit);
  }
  return hit;
}

/** Búsqueda en Wiktionary (para verificar a mano). */
export const wiktionarySearch = (term: string) =>
  `https://es.wiktionary.org/w/index.php?search=${encodeURIComponent(term.trim())}`;
