/* Service worker: full offline, including every question.
 *
 * The whole app is ~400 KB of JSON plus a small shell, so it is all precached
 * on install. That means the first visit is the only one that needs a network,
 * and every module works on a train with no signal.
 *
 * BUMP CACHE ON EVERY DEPLOY — the old cache is only discarded when the name
 * changes, so an unchanged name serves stale code forever.
 */

const CACHE = 'study-v3';

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/bank.js',
  'js/quiz.js',
  'js/store.js',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'data/index.json',
  'data/ec-1.json',
  'data/ec-2.json',
  'data/ec-3.json',
  'data/ec-4.json',
  'data/se-1.json',
  'data/se-2.json',
  'data/se-3.json',
  'data/se-4.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Bypass the HTTP cache so a deploy never precaches yesterday's files.
      await cache.addAll(PRECACHE.map((path) => new Request(path, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the shell, so a deep link works offline and on reload.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await caches.match('index.html', { ignoreSearch: true });
        if (cached) return cached;
        try {
          return await fetch(request);
        } catch {
          return new Response('Offline, and the app has not been cached yet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        // Cache anything same-origin we did not know about at install time.
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        return new Response('Offline and not cached.', {
          status: 504,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })(),
  );
});
