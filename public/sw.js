/* Lightweight SW to prevent caching of app shell (HTML/JS/CSS) while caching images. */
const IMAGE_CACHE = 'image-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Optionally cleanup old caches here in future versions
      await self.clients.claim();
    })(),
  );
});

function isNav(event) {
  return event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const dest = request.destination;

  // Never cache the app shell (HTML) and core assets (JS/CSS)
  if (isNav(event) || dest === 'script' || dest === 'style' || dest === 'document') {
    event.respondWith(
      (async () => {
        try {
          const noStoreReq = new Request(request, { cache: 'no-store' });
          return await fetch(noStoreReq);
        } catch (e) {
          // Fallback to normal fetch if no-store fails
          return fetch(request);
        }
      })(),
    );
    return;
  }

  // Cache-first for images
  if (dest === 'image') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMAGE_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const resp = await fetch(request);
        try { await cache.put(request, resp.clone()); } catch {}
        return resp;
      })(),
    );
    return;
  }

  // Default: just fetch
  event.respondWith(fetch(request));
});

