/* Service worker: full offline, including every question.
 *
 * The whole app is ~1.3 MB of JSON plus a small shell, so it is all precached
 * on install. That means the first visit is the only one that needs a network,
 * and every module works on a train with no signal.
 *
 * BUMP CACHE ON EVERY DEPLOY — the old cache is only discarded when the name
 * changes, so an unchanged name serves stale code forever.
 *
 * Update model: a new worker installs in the background and then *waits*. It
 * never swaps the assets out from under a session in progress. js/pwa.js spots
 * the waiting worker, offers "Update", and posts SKIP_WAITING when the user
 * accepts — so a reload is always a deliberate act, and a half-answered quiz is
 * never rebuilt against a different question bank.
 */

const CACHE = 'study-v7';

/* The app shell: if any of this is missing the install must fail, because a
   partially cached shell is worse than no offline mode at all. */
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/bank.js',
  'js/pwa.js',
  'js/quiz.js',
  'js/store.js',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'data/index.json',
];

/* The question banks: cached one by one and best-effort. A single failed module
   leaves the other twelve offline-ready and is refetched on first use, rather
   than aborting the install and leaving the visitor with no service worker. */
const DATA = [
  'data/ec-1.json',
  'data/ec-2.json',
  'data/ec-3.json',
  'data/ec-4.json',
  'data/se-1.json',
  'data/se-2.json',
  'data/se-3.json',
  'data/se-4.json',
  'data/cc-1.json',
  'data/cc-2.json',
  'data/cc-3.json',
  'data/cc-4.json',
  'data/cc-5.json',
];

// Bypass the HTTP cache so a deploy never precaches yesterday's files.
const fresh = (path) => new Request(path, { cache: 'reload' });

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map(fresh));
      await Promise.all(
        DATA.map((path) => cache.add(fresh(path)).catch((err) => {
          console.warn('Precache skipped', path, err);
        })),
      );
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

/* The page's half of the update handshake — see js/pwa.js. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') self.skipWaiting();
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
      } catch {
        return new Response('Offline and not cached.', {
          status: 504,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })(),
  );
});
