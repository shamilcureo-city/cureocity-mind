/**
 * Cureocity Mind Service Worker — minimal V1 build.
 *
 * V1 responsibilities:
 *   - On install: skip waiting (no shell cache yet; sessions live in IDB).
 *   - On 'online' / message from client: kick a queue drain.
 *
 * The actual chunk uploader runs in the page (main thread) — having the
 * SW manage uploads on its own requires sending Bearer tokens into the
 * SW, which complicates the auth story. We use the SW only for the
 * online-event signal back to the page; chunks remain in the page-side
 * uploader queue.
 *
 * Sprint 8 (client-web PWA) will expand this with a manifest + offline
 * shell + push notifications. For now it is essentially a no-op that
 * registers without errors so the page can rely on its presence.
 */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ping') {
    event.source?.postMessage({ type: 'pong' });
  }
});
