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
export async function capture(url: string) {
  const res = await fetch('https://r.jina.ai/' + url, {
    headers: {
      Accept: 'application/json',
      'X-With-Images-Summary': 'true',
      'X-Remove-Selector': 'nav,footer,aside,[role="navigation"],[role="banner"],.advertisement',
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw Error('No se pudo capturar la página. Puedes pegar el texto manualmente.');
  const { data } = await res.json();
  if (typeof data?.content !== 'string') throw Error('No se encontró texto legible.');
  const title = String(data.title || new URL(url).hostname);
  const seen = new Set<string>();
  function image(alt: string, src: string) {
    try {
      const link = new URL(src, url);
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
        !/^(skip to content|saltar al contenido|advertisement|publicidad)$/i.test(l.trim()),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!content) throw Error('La página no tiene texto legible.');
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
  return { title, content };
}
