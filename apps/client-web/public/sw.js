/**
 * Cureocity Mind client-web Service Worker — Sprint 8 PR 1 baseline.
 *
 * V1 responsibilities:
 *   - skipWaiting + clients.claim so the SW activates immediately on
 *     first install (necessary for the install prompt to be eligible).
 *   - A handful of static assets pre-cached so the home shell renders
 *     when offline. Network-first for everything else so logged-in
 *     content always pulls fresh.
 *   - Push event hook for FCM Web Push (Sprint 8 PR 4 fills the body).
 *
 * Out of scope for V1: full Workbox-style routing tables. The patient
 * use cases (today's exercises, mood log, journal) all require server
 * data; offline-mode is a stretch deliverable in Sprint 10.
 */

const CACHE = 'cureocity-mind-client-v1';
const SHELL_ASSETS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // best-effort — missing icons in dev shouldn't abort install
      await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!SHELL_ASSETS.includes(url.pathname)) return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
      }
    })(),
  );
});

// Sprint 8 PR 4 will fill in 'push' to surface FCM web push notifications.
self.addEventListener('message', (event) => {
  if (event.data === 'ping') event.source && event.source.postMessage('pong');
});
