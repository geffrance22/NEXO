export function publicLink(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw Error('Introduce un enlace web válido.');
  }
  if (
    !['https:', 'http:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    !u.hostname.includes('.')
  )
    throw Error('Introduce un enlace web público.');
  u.hash = '';
  return u.href;
}
/** Mensaje claro de un fallo al capturar o guardar. `short`: sin la sugerencia de pegar el texto. */
export function failure(e: unknown, short = false) {
  const err = e as { name?: string; message?: string } | null;
  if (err?.name === 'TimeoutError') return 'La página tardó demasiado en responder.';
  const text = err?.message || 'No se pudo guardar el enlace.';
  if (/failed to fetch|networkerror|load failed/i.test(text))
    return 'Sin conexión. Revisa tu red e inténtalo de nuevo.';
  return short ? text.replace(/\s*Puedes pegar el texto manualmente\.?$/, '') : text;
}

const REMOVE = 'nav,footer,aside,[role="navigation"],[role="banner"],.advertisement';
/** Barra y avisos que la Wayback Machine añade a sus copias. */
const WAYBACK_UI = '#wm-ipp-base,#wm-ipp,#wm-ipp-print,#donato';
const FAILED = 'No se pudo descargar el artículo. Puedes pegar el texto manualmente.';
/** Con menos texto que esto, la página pudo llegar a medias: se prueba la siguiente forma de leerla. */
const ENOUGH = 800;

/** Páginas de verificación anti-bots (Cloudflare, Imperva, PerimeterX…) en lugar del artículo. */
const CHALLENGE = new RegExp(
  [
    'performing security verification',
    'security service to protect against malicious bots',
    'verif(?:y|ying) (?:that )?you are (?:a )?human',
    'checking (?:if the site connection is secure|your browser)',
    'enable javascript and cookies to continue',
    'needs to review the security of your connection',
    'attention required! \\| cloudflare',
    'ddos protection by',
    'sorry, you have been blocked',
    'please complete the security check',
    'press (?:&|and) hold to confirm',
    'pardon our interruption',
    'request unsuccessful\\. incapsula',
    'verificando que (?:eres|usted es) (?:un )?(?:ser )?humano',
    'comprobando si la conexión (?:del sitio )?es segura',
    'realizando (?:una )?verificación de seguridad',
  ].join('|'),
  'i',
);
/** Señales más genéricas: solo cuentan en páginas muy cortas. */
const DENIED =
  /access denied|403 forbidden|you don't have permission to access|are you a robot|one more step|acceso denegado/i;

/** La página respondió, pero sin un artículo que sirva. */
class Refused extends Error {}

type Page = { title: string; content: string; warning: string };

const size = (p: Page) =>
  p.content
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;

/** ¿Es una verificación o un bloqueo y no el artículo? Un artículo largo puede hablar de ellos. */
function blocked(p: Page) {
  const n = size(p);
  if (n >= 4000) return false;
  const text = p.title + '\n' + p.content;
  return (
    CHALLENGE.test(text) ||
    /^(?:just a moment|un momento|attention required)/i.test(p.title.trim()) ||
    /captcha/i.test(p.warning) ||
    (n < 1500 && /returned error (?:401|403|429|503)/i.test(p.warning)) ||
    (n < 1200 && DENIED.test(text))
  );
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Pide `target` a Jina Reader. Si limita las peticiones (429), espera y lo vuelve a pedir. */
async function ask(target: string, headers: Record<string, string>, timeout: number) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://r.jina.ai/' + target, {
      headers,
      signal: AbortSignal.timeout(timeout),
    });
    if (res.status !== 429 || attempt === 3) return res;
    const after = Number(res.headers.get('retry-after'));
    await wait(after > 0 ? Math.min(after, 30) * 1000 : 4000 * 2 ** attempt);
  }
}

/**
 * Lee `target` con Jina Reader. `base`: el enlace original (para el título de reserva).
 * `browser`: Chrome completo, sin copia en caché y esperando a que la página termine de cargar.
 */
async function read(
  target: string,
  base: string,
  { fresh = false, browser = false, remove = REMOVE } = {},
): Promise<Page> {
  const res = await ask(
    target,
    {
      Accept: 'application/json',
      'X-With-Images-Summary': 'true',
      'X-Remove-Selector': remove,
      ...(fresh || browser ? { 'X-No-Cache': 'true' } : {}),
      ...(browser ? { 'X-Engine': 'browser', 'X-Timeout': '15' } : {}),
    },
    browser ? 60000 : 45000,
  );
  if (!res.ok) throw new Refused(FAILED);
  const { data } = await res.json().catch(() => ({}));
  if (typeof data?.content !== 'string') throw new Refused(FAILED);
  const title = String(data.title || new URL(base).hostname);
  const seen = new Set<string>();
  function image(alt: string, src: string) {
    try {
      const link = new URL(src, target);
      if (
        !['http:', 'https:'].includes(link.protocol) ||
        seen.has(link.href) ||
        /favicon|tracking.pixel/i.test(link.pathname)
      )
        return '';
      seen.add(link.href);
      return (
        '![' +
        alt.replace(/[\[\]]/g, '') +
        '](' +
        link.href.replace(/\(/g, '%28').replace(/\)/g, '%29') +
        ')'
      );
    } catch {
      return '';
    }
  }
  let content = data.content
    .replace(/\[(!\[[^\]]*\]\([^)]+\))\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, (_: string, alt: string, src: string) =>
      image(alt, src),
    )
    .replace(/(?<!!)\[([^\]]+)\]\([^\n)]+\)/g, '$1')

    .split('\n')
    .filter(
      (l: string) =>
        l.trim().replace(/^#{1,6}\s+/, '') !== title &&
        !/^(skip to content|saltar al contenido|advertisement|publicidad)$/i.test(l.trim()) &&
        !/^the wayback machine - https?:\/\/web\.archive\.org\//i.test(l.trim()),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!content) throw new Refused(FAILED);
  if (!seen.size && data.images) {
    for (const [alt, src] of Object.entries(data.images)) {
      if (typeof src === 'string') {
        const pic = image(alt, src);
        if (pic) {
          content = pic + '\n\n' + content;
          break;
        }
      }
    }
  }
  return { title, content, warning: typeof data.warning === 'string' ? data.warning : '' };
}

/** La copia más reciente guardada en la Wayback Machine. */
async function archived(url: string) {
  const copy = await read('https://web.archive.org/web/' + url, url, {
    remove: REMOVE + ',' + WAYBACK_UI,
  });
  if (
    /returned error [45]\d\d/i.test(copy.warning) ||
    /wayback machine (?:has not archived|doesn't have) that url|excluded from the wayback machine/i.test(
      copy.content,
    )
  )
    throw new Refused(FAILED);
  return copy;
}

/**
 * Título y texto de un artículo. Prueba, en orden, hasta dar con el artículo completo:
 * 1. Jina Reader normal (con su copia reciente, salvo `fresh`).
 * 2. Chrome completo, sin caché y esperando a que cargue: para webs que solo muestran el texto
 *    con JavaScript o que hacen esperar unos segundos antes de abrir.
 * 3. La copia más reciente de la Wayback Machine.
 * Descarta las páginas de verificación anti-bots. Si nada llega completo, se queda con el texto
 * más largo que sí sea del artículo.
 */
export async function capture(url: string, { fresh = false } = {}) {
  const pages: Page[] = [];
  const errors: unknown[] = [];
  let answered = false,
    slow = false;
  const steps: [string, () => Promise<Page>][] = [
    ['reader', () => read(url, url, { fresh })],
    ['browser', () => read(url, url, { browser: true })],
    ['archive', () => archived(url)],
  ];
  for (const [name, step] of steps) {
    // Si la web ya tardó demasiado, en el navegador completo tardaría más.
    if (name === 'browser' && slow) continue;
    try {
      const page = await step();
      answered = true;
      if (blocked(page)) continue;
      if (size(page) >= ENOUGH) return { title: page.title, content: page.content };
      pages.push(page);
    } catch (e) {
      if (e instanceof Refused) answered = true;
      else {
        errors.push(e);
        if ((e as Error)?.name === 'TimeoutError') slow = true;
      }
    }
  }
  const best = pages.reduce<Page | null>((a, p) => (!a || size(p) > size(a) ? p : a), null);
  if (best) return { title: best.title, content: best.content };
  // Sin respuesta de ningún lado: es la conexión (o la web no contestó a tiempo).
  if (!answered && errors.length) throw errors[0];
  throw Error(FAILED);
}
