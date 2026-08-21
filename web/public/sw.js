// Wend service worker.
//
// The one rule that matters: this worker must never answer a navigation to a
// short link. It is registered at the root, so every visit to
// <your-domain>/<slug> passes through it, and a cached shell served there
// would break links that are already in people's hands - silently, and for
// exactly the people who have used the interface. Only the shell and its own
// assets are handled here; everything else goes straight to the network.

const VERSION = 'wend-v1';
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll([SHELL])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A kill switch: unregistering here lets a bad worker be evicted remotely
// rather than lingering in browsers that already installed it.
self.addEventListener('message', (event) => {
  if (event.data === 'unregister') {
    self.registration.unregister().then(() => self.clients.claim());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch the API, the sign-in routes, or anything that is not the shell.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    // Only the app shell itself. Any other path is a slug: hands off.
    if (url.pathname !== '/') return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(SHELL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL).then((hit) => hit || Response.error()))
    );
    return;
  }

  // Fingerprinted assets and fonts: cache first, they never change in place.
  if (url.pathname.startsWith('/_/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
});
