// sw.js — lets the installed app open with no signal.
// App files come from the network when it answers within 3 seconds (so updates
// show up right away) and from the cache otherwise; fonts come from the cache.
const CACHE = 'gcs-mobile-v2';
const CORE = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'src/main.js',
  'src/gcs.js',
  'src/store.js',
  'src/ui.js',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return;

  event.respondWith(caches.open(CACHE).then(async cache => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    // Fonts never change: cache first.
    if (fonts) {
      const hit = await cache.match(key);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(key, res.clone());
      return res;
    }
    // App files: try the network (so updates arrive at once), fall back to the
    // cached copy when offline or when the network takes more than 3 seconds.
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    const timeout = new Promise(resolve => setTimeout(resolve, 3000));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch { /* offline */ }
    return (await cache.match(key)) || network;
  }));
});
