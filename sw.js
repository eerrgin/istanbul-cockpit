const VERSION = 'v7-open-data';
const STATIC_CACHE = `istanbul-cockpit-static-${VERSION}`;
const API_CACHE = `istanbul-cockpit-api-${VERSION}`;
const ASSETS = ['./index.html', './style.css', './app.js', './utils.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== STATIC_CACHE && key !== API_CACHE).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const url = new URL(request.url);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (url.pathname === '/' || url.pathname.endsWith('/')) {
    const index = await cache.match('./index.html');
    if (index) return index;
  }
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
    return new Response('Çevrimdışı', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok && (response.type === 'basic' || response.type === 'cors')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 504,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
