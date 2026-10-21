// Offline support: app shell + public data + any file that has been opened are cached on the device.
const SHELL = 'ece-shell-v1', DATA = 'ece-data-v1';
const SHELL_FILES = ['/', '/index.html', '/style.css', '/app.js', '/config.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, DATA].includes(k)).map(k => caches.delete(k)))));
  self.clients.claim();
});
const cacheable = u => {
  if (u.pathname === '/api/subjects' || u.pathname === '/api/notices') return true;
  if (u.pathname === '/api/resources') return !u.searchParams.has('mine') && !u.searchParams.has('status');
  return /^\/api\/resources\/\d+(\/(view|download))?$/.test(u.pathname);
};
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (!cacheable(url)) return;
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || new Response(JSON.stringify({ error: 'You are offline and this has not been saved on this device yet.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('/index.html'))));
});
