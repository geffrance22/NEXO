/*
 * Service worker de Nexo (app instalable). Mínimo a propósito:
 * - La página: primero la red (siempre la versión publicada); sin conexión, la última guardada.
 * - Los archivos de la compilación (assets/, con huella en el nombre): de la caché, no cambian.
 * - Íconos, manifiesto y demás archivos propios: de la caché y se refrescan por detrás.
 * - Nada de otros dominios (Supabase, fuentes, portadas): pasan directo, sin tocarlos.
 */
const SHELL = 'nexo-shell-v1';
const ASSETS = 'nexo-assets-v1';
const KEEP = [SHELL, ASSETS];
const MAX_ASSETS = 80;
const scope = new URL(self.registration.scope);
const home = new URL('./', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) =>
        cache.addAll(
          ['./', './manifest.webmanifest', './nexo-favicon.svg', './icon-192.png'].map(
            (p) => new URL(p, scope).href,
          ),
        ),
      )
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** La caché de archivos no crece sin fin: se quedan los más recientes. */
async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.href.startsWith(scope.href)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(SHELL).then((c) => c.put(home, copy));
          }
          return res;
        })
        .catch(() => caches.match(home).then((hit) => hit || Response.error())),
    );
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) {
          await cache.put(request, res.clone());
          void trim(cache);
        }
        return res;
      }),
    );
    return;
  }

  const fresh = caches.open(SHELL).then((cache) =>
    fetch(request).then(async (res) => {
      if (res.ok) await cache.put(request, res.clone());
      return res;
    }),
  );
  event.waitUntil(fresh.catch(() => undefined));
  event.respondWith(
    caches.match(request).then((hit) => hit || fresh.catch(() => Response.error())),
  );
});
