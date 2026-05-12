/**
 * apps/web · service worker · ollie-shell-v1
 *
 * Cache-first for /videos/* /audio/* /fonts/* (the heavy media we want
 * offline). Pre-caches the shell + media on install. Cleans old caches
 * on activate. Registered from src/main.tsx if 'serviceWorker' in navigator.
 */

const CACHE = 'ollie-shell-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/videos/sky-clear-day.mp4',
  '/videos/sky-clear-night.mp4',
  '/videos/sky-sunset.mp4',
  '/videos/sky-sunrise.mp4',
  '/videos/sky-overcast.mp4',
  '/audio/brown-noise.mp3',
  '/audio/rain.mp3',
  '/audio/ocean.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(
        PRECACHE.map((url) => cache.add(url).catch(() => {})),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  const isMedia =
    url.pathname.startsWith('/videos/') ||
    url.pathname.startsWith('/audio/') ||
    url.pathname.startsWith('/fonts/');
  if (!isMedia) return;

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match('/index.html'));
    }),
  );
});
