/* 생각별 v12: Cache UI files only. Never cache API traffic or keys. */
const CACHE = 'saenggakbyeol-shell-v42-guardian-media-20261124';
const SHELL = ['/', '/index.html', '/privacy.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-192.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('saenggakbyeol-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy))); }
    return response;
  }).catch(() => caches.match(request, {ignoreSearch:true}).then(cached => cached || (request.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
