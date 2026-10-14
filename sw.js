const CACHE = 'imgtools-v10';
const ASSETS = ['./','./index.html','./batchcomp.html','./exif.html','./imgconv.html','./common.css','./settings.js','./theme-init.js','./handoff.js','./raw.js','./gifenc.js','./manifest.json','./icon-192.png','./icon-512.png'];
const CROSS = ['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(ASSETS.map(a => c.add(a)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const store = (req, r) => { if (r.ok || r.type === 'opaque') caches.open(CACHE).then(c => c.put(req, r.clone())); return r; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // network-first: пользователь всегда получает свежую версию, офлайн — из кэша
    e.respondWith(fetch(req).then(r => store(req, r)).catch(() => caches.match(req, { ignoreSearch: true })));
  } else if (CROSS.includes(url.hostname)) {
    // stale-while-revalidate для библиотек и шрифтов
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(r => store(req, r)).catch(() => hit);
      return hit || net;
    }));
  }
});
