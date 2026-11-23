/* FD-keruu – service worker (network first)
 * Hakee aina ensin verkosta (ohi HTTP-välimuistin) ja käyttää välimuistia vain offline-tilassa.
 * Jaettu origin (tkoljonen-wq.github.io): käsitellään vain omia välimuisteja (etuliite fd-keruu-).
 */
const CACHE_PREFIX = 'fd-keruu-';
const CACHE_NAME = CACHE_PREFIX + 'v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // Vain oman sovelluksen GET-pyynnöt. Apps Script -kutsut (POST/GET toiseen originiin) menevät suoraan verkkoon.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Kyselyparametrilliset pyynnöt ovat rajapintakutsuja (esim. ?action=stats) – niitä ei välimuisteta.
  if (url.search) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const kopio = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, kopio));
        }
        return res;
      })
      .catch(() => caches.match(req).then(vastaus =>
        vastaus || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())
      ))
  );
});
