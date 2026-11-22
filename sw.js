// Cache per uso offline: file dell'app + librerie dai CDN
const V = 'coord-v1';
const APP = ['./', 'index.html', 'core.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const CDN = /^(https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com))\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = r.url;
  if (CDN.test(u)) {
    // librerie: prima la cache, poi la rete
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {
      if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
      return res;
    })));
  } else if (new URL(u).origin === location.origin) {
    // file dell'app: prima la rete (aggiornamenti), poi la cache se offline
    e.respondWith(fetch(r).then(res => {
      const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); return res;
    }).catch(() => caches.match(r).then(h => h || caches.match('index.html'))));
  }
});
