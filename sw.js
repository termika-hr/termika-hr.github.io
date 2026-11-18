// Termika service worker: keeps the app usable offline. Forecast data is cached by the app itself.
const CACHE = 'termika-v25';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'css/fonts.css',
  'js/app.js', 'js/meteo.js', 'js/sites.js', 'js/i18n.js', 'js/map.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/qr.svg',
  "fonts/Barlow-400-latin-ext.woff2",
  "fonts/Barlow-400-latin.woff2",
  "fonts/Barlow-500-latin-ext.woff2",
  "fonts/Barlow-500-latin.woff2",
  "fonts/Barlow-600-latin-ext.woff2",
  "fonts/Barlow-600-latin.woff2",
  "fonts/BarlowCondensed-500-latin-ext.woff2",
  "fonts/BarlowCondensed-500-latin.woff2",
  "fonts/BarlowCondensed-600-latin-ext.woff2",
  "fonts/BarlowCondensed-600-latin.woff2",
  "fonts/BarlowCondensed-700-latin-ext.woff2",
  "fonts/BarlowCondensed-700-latin.woff2",
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin files: network first (revalidated, so updates arrive at once), cache when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' }))
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
